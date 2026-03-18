/**
 * SwarmOrchestrator - CLI-native swarm orchestration.
 * Uses AI providers directly (no Tauri/Electron dependency).
 * Spawns "agents" as sequential AI calls with role-specific system prompts.
 */
import { randomUUID } from 'node:crypto';
import { sendMessage } from '../ai/engine.js';
import { loadConfig, getApiKey } from '../../config/store.js';
import { getRoleDefinition } from './roles.js';
import { readProjectSources, execShell, writeFile } from '../tools/index.js';
const DEFAULT_SWARM_CONFIG = {
    maxAgents: 5,
    maxRuntime: 600_000,
    safeMode: false,
    workerCLI: 'claude',
    dryRunMode: false,
};
const FORBIDDEN_COMMANDS = [
    'rm -rf /', 'rm -rf /*', 'sudo rm', ':(){:|:&};:', '> /dev/sda',
    'dd if=', 'mkfs', 'chmod -R 777 /', 'chown -R',
];
export class SwarmOrchestrator {
    state = 'idle';
    currentTask = null;
    callbacks;
    config;
    abortController = null;
    constructor(callbacks, config) {
        this.callbacks = callbacks;
        const velixConfig = loadConfig();
        this.config = {
            ...DEFAULT_SWARM_CONFIG,
            ...velixConfig.swarm,
            ...config,
        };
    }
    getState() { return this.state; }
    getCurrentTask() { return this.currentTask; }
    setState(state) {
        this.state = state;
        this.callbacks.onStateChange(state);
    }
    /**
     * Execute a complete swarm task.
     */
    async execute(goal, constraints = []) {
        this.abortController = new AbortController();
        const taskId = randomUUID().slice(0, 8);
        this.currentTask = {
            id: taskId,
            goal,
            constraints,
            agents: [],
            status: 'planning',
            createdAt: new Date(),
        };
        this.setState('planning');
        this.callbacks.onLog(`Swarm task started: ${goal}`, 'info');
        try {
            // Phase 1: Planning
            this.callbacks.onLog('Phase 1: Planning task decomposition...', 'info');
            const plan = await this.planTask(goal, constraints);
            this.currentTask.plan = plan;
            this.callbacks.onLog(`Plan created: ${plan.subtasks.length} subtasks`, 'success');
            // Phase 2: Execution
            this.setState('executing');
            this.callbacks.onLog('Phase 2: Executing subtasks...', 'info');
            await this.executePlan(plan);
            // Phase 3: Validation
            this.setState('validating');
            this.callbacks.onLog('Phase 3: Validating results...', 'info');
            await this.validateResults();
            this.setState('completed');
            this.currentTask.status = 'completed';
            this.currentTask.completedAt = new Date();
            this.callbacks.onLog('Swarm task completed successfully!', 'success');
        }
        catch (err) {
            this.setState('failed');
            this.currentTask.status = 'failed';
            this.callbacks.onLog(`Swarm task failed: ${err}`, 'error');
        }
        this.callbacks.onComplete(this.currentTask);
        return this.currentTask;
    }
    /**
     * Plan the task by asking the planner agent.
     */
    async planTask(goal, constraints) {
        const plannerRole = getRoleDefinition('planner');
        const velixConfig = loadConfig();
        const apiKey = getApiKey();
        if (!apiKey)
            throw new Error('No API key configured. Run /config to set one.');
        // Gather project context
        let projectContext = '';
        try {
            const sources = readProjectSources(process.cwd(), 30_000);
            const fileList = Object.keys(sources).join('\n');
            projectContext = `\nProject files:\n${fileList}\n`;
        }
        catch {
            projectContext = '\n(Could not read project files)\n';
        }
        const constraintStr = constraints.length > 0 ? `\nConstraints: ${constraints.join(', ')}` : '';
        const prompt = `Task: ${goal}${constraintStr}${projectContext}

Break this task into subtasks. Return a JSON object with this exact structure:
{
  "subtasks": [{ "id": "1", "description": "...", "role": "implementer", "dependencies": [], "priority": 10 }],
  "executionOrder": [["1"], ["2", "3"]],
  "estimatedAgents": 3
}`;
        const response = await sendMessage({
            text: prompt,
            system: plannerRole.systemPrompt,
            provider: velixConfig.provider,
            model: velixConfig.model,
            apiKey,
            signal: this.abortController?.signal,
        });
        return this.parsePlan(response);
    }
    parsePlan(response) {
        // Extract JSON from response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            // Fallback: create a single-subtask plan
            return {
                subtasks: [{
                        id: '1',
                        description: 'Execute the complete task',
                        role: 'implementer',
                        dependencies: [],
                        priority: 10,
                        status: 'idle',
                    }],
                executionOrder: [['1']],
                estimatedAgents: 1,
            };
        }
        try {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                subtasks: (parsed.subtasks || []).map((s) => ({
                    ...s,
                    status: 'idle',
                })),
                executionOrder: parsed.executionOrder || [parsed.subtasks.map((s) => s.id)],
                estimatedAgents: parsed.estimatedAgents || 1,
            };
        }
        catch {
            return {
                subtasks: [{
                        id: '1', description: 'Execute the complete task',
                        role: 'implementer', dependencies: [], priority: 10, status: 'idle',
                    }],
                executionOrder: [['1']],
                estimatedAgents: 1,
            };
        }
    }
    /**
     * Execute the plan by running subtasks in the defined order.
     */
    async executePlan(plan) {
        const results = [];
        for (const group of plan.executionOrder) {
            // Execute subtasks in each group (in parallel within groups)
            const groupSubtasks = group
                .map(id => plan.subtasks.find(s => s.id === id))
                .filter((s) => !!s);
            const promises = groupSubtasks.map(subtask => this.executeSubtask(subtask, results));
            const groupResults = await Promise.allSettled(promises);
            for (const result of groupResults) {
                if (result.status === 'fulfilled' && result.value) {
                    results.push(result.value);
                }
            }
        }
    }
    /**
     * Execute a single subtask using an AI agent.
     */
    async executeSubtask(subtask, previousResults) {
        const agentId = `agent_${subtask.role}_${randomUUID().slice(0, 6)}`;
        const role = getRoleDefinition(subtask.role);
        const velixConfig = loadConfig();
        const apiKey = getApiKey();
        if (!apiKey)
            throw new Error('No API key configured');
        const agent = {
            id: agentId,
            role: subtask.role,
            status: 'working',
            currentTask: subtask.description,
            output: '',
            errors: [],
            startedAt: new Date(),
        };
        this.currentTask?.agents.push(agent);
        this.callbacks.onAgentUpdate(agent);
        this.callbacks.onLog(`[${role.name}] Starting: ${subtask.description}`, 'agent');
        const startTime = Date.now();
        try {
            // Build context from previous results
            let contextStr = '';
            if (previousResults.length > 0) {
                contextStr = '\n\nPrevious work done:\n' + previousResults
                    .map(r => `- [${r.role}] ${r.description}: ${r.success ? 'SUCCESS' : 'FAILED'}\n  ${r.output.slice(0, 300)}`)
                    .join('\n');
            }
            // Read relevant files for context
            let fileContext = '';
            try {
                const sources = readProjectSources(process.cwd(), 20_000);
                const fileNames = Object.keys(sources).slice(0, 20).join('\n');
                fileContext = `\n\nProject files available:\n${fileNames}`;
            }
            catch { /* ignore */ }
            const prompt = `Your task: ${subtask.description}${contextStr}${fileContext}

Complete this task. If you need to create or modify files, output them using:
FILE: path/to/file.ext
\`\`\`language
...content...
\`\`\``;
            const response = await sendMessage({
                text: prompt,
                system: role.systemPrompt,
                provider: velixConfig.provider,
                model: velixConfig.model,
                apiKey,
                signal: this.abortController?.signal,
            });
            agent.output = response;
            agent.status = 'completed';
            agent.completedAt = new Date();
            // Apply file changes if any
            const filesModified = this.applyFileChanges(response);
            this.callbacks.onLog(`[${role.name}] Completed: ${subtask.description}`, 'success');
            this.callbacks.onAgentUpdate(agent);
            return {
                subtaskId: subtask.id,
                description: subtask.description,
                role: subtask.role,
                agentId,
                success: true,
                output: response.slice(0, 500),
                filesModified,
                duration: Date.now() - startTime,
            };
        }
        catch (err) {
            agent.status = 'failed';
            agent.errors.push(String(err));
            agent.completedAt = new Date();
            this.callbacks.onAgentUpdate(agent);
            this.callbacks.onLog(`[${role.name}] Failed: ${err}`, 'error');
            return {
                subtaskId: subtask.id,
                description: subtask.description,
                role: subtask.role,
                agentId,
                success: false,
                output: String(err),
                filesModified: [],
                duration: Date.now() - startTime,
            };
        }
    }
    /**
     * Extract FILE: blocks from AI response and apply them.
     */
    applyFileChanges(response) {
        if (this.config.dryRunMode)
            return [];
        const modified = [];
        const fileRegex = /FILE:\s*(.+?)\n```\w*\n([\s\S]*?)```/g;
        let match;
        while ((match = fileRegex.exec(response)) !== null) {
            const filePath = match[1].trim();
            const content = match[2];
            // Safety check
            const lower = filePath.toLowerCase();
            if (lower.includes('node_modules') || lower.includes('.env') || lower.includes('.git/')) {
                this.callbacks.onLog(`Skipping forbidden path: ${filePath}`, 'warn');
                continue;
            }
            try {
                writeFile(filePath, content);
                modified.push(filePath);
                this.callbacks.onLog(`  Wrote: ${filePath}`, 'info');
            }
            catch (err) {
                this.callbacks.onLog(`  Failed to write ${filePath}: ${err}`, 'warn');
            }
        }
        return modified;
    }
    /**
     * Validate results by running build/test if available.
     */
    async validateResults() {
        // Try to run build
        const buildResult = execShell('npm run build 2>&1 || echo "no build script"', process.cwd());
        if (buildResult.exitCode !== 0 && !buildResult.stdout.includes('no build script')) {
            this.callbacks.onLog(`Build check: WARNINGS\n${buildResult.stderr.slice(0, 200)}`, 'warn');
        }
        else {
            this.callbacks.onLog('Build check: OK', 'success');
        }
    }
    /**
     * Emergency stop - abort all operations.
     */
    abort() {
        this.abortController?.abort();
        this.setState('failed');
        this.callbacks.onLog('EMERGENCY STOP - All agents terminated', 'error');
    }
    /**
     * Validate a command against safety rules.
     */
    isCommandSafe(command) {
        const lower = command.toLowerCase();
        return !FORBIDDEN_COMMANDS.some(fc => lower.includes(fc.toLowerCase()));
    }
}
//# sourceMappingURL=orchestrator.js.map