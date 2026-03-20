/**
 * SwarmOrchestrator - CLI-native swarm orchestration.
 * Uses AI providers directly (no Tauri/Electron dependency).
 * Spawns "agents" as sequential AI calls with role-specific system prompts.
 */
import { randomUUID } from 'node:crypto';
import { sendMessage } from '../ai/engine.js';
import { loadConfig, getApiKey } from '../../config/store.js';
import { SPECIALIST_ROLES, } from './types.js';
import { getRoleDefinition } from './roles.js';
import { readProjectSources, execShell, readFile, writeFile, searchInFiles, listDir, editFile } from '../tools/index.js';
import { PROVIDERS } from '../ai/types.js';
import path from 'node:path';
import fs from 'node:fs';
const DEFAULT_SWARM_CONFIG = {
    maxAgents: 5,
    maxRuntime: 600_000,
    maxStepsPerAgent: 12,
    maxFollowUpTasks: 6,
    safeMode: false,
    autoApplyChanges: true,
    allowShell: true,
    coordinatorReview: true,
    validateBuild: true,
    validateTests: false,
    specialistRoles: [...SPECIALIST_ROLES],
    strategy: 'balanced',
    plannerModel: '',
    coordinatorModel: '',
    workerModel: '',
    coordinatorProvider: '',
    workerProvider: '',
    workerCLI: 'claude',
    buildCommand: '',
    testCommand: '',
    dryRunMode: false,
};
const FORBIDDEN_COMMANDS = [
    'rm -rf /', 'rm -rf /*', 'sudo rm', ':(){:|:&};:', '> /dev/sda',
    'dd if=', 'mkfs', 'chmod -R 777 /', 'chown -R',
];
/**
 * Extract the first balanced JSON object from a string.
 * Avoids the greedy-regex pitfall where /\{[\s\S]*\}/ matches from the first
 * opening brace to the very last closing brace, spanning across multiple objects.
 */
function extractFirstJSON(text) {
    const start = text.indexOf('{');
    if (start === -1)
        return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (ch === '\\' && inString) {
            escape = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString)
            continue;
        if (ch === '{')
            depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0)
                return text.slice(start, i + 1);
        }
    }
    return null;
}
export class SwarmOrchestrator {
    state = 'idle';
    currentTask = null;
    callbacks;
    config;
    abortController = null;
    send;
    coordinatorAgent = null;
    subtaskCounter = 1;
    constructor(callbacks, config, dependencies = {}) {
        this.callbacks = callbacks;
        const velixConfig = loadConfig();
        this.config = {
            ...DEFAULT_SWARM_CONFIG,
            ...velixConfig.swarm,
            ...config,
        };
        this.send = dependencies.sendMessage ?? sendMessage;
    }
    getState() { return this.state; }
    getCurrentTask() { return this.currentTask; }
    /**
     * Get all agents for the current task (allows messaging individual agents).
     */
    getAgents() {
        return this.currentTask?.agents ?? [];
    }
    /**
     * Send a direct message to a specific agent by ID or role.
     * The agent responds in the context of its role and current task.
     */
    async messageAgent(agentIdentifier, message) {
        const agents = this.getAgents();
        const agent = agents.find(a => a.id === agentIdentifier
            || a.role === agentIdentifier
            || a.id.includes(agentIdentifier));
        if (!agent) {
            const available = agents.map(a => `${a.role} (${a.id})`).join(', ');
            throw new Error(`Agent not found: "${agentIdentifier}". Available: ${available || 'none'}`);
        }
        const velixConfig = loadConfig();
        const { provider: workerProvider, apiKey: workerApiKey } = this.resolveProviderAndKey('worker');
        const roleDef = getRoleDefinition(agent.role);
        const systemPrompt = `${roleDef.systemPrompt}\n\nYou are agent "${agent.id}" with role "${agent.role}".`
            + (agent.currentTask ? `\nYour current/last task: ${agent.currentTask}` : '')
            + (agent.output ? `\nYour last output summary: ${agent.output.slice(0, 500)}` : '')
            + '\n\nThe user (operator) is messaging you directly. Respond helpfully about your work, findings, or status.';
        const response = await this.send({
            text: message,
            system: systemPrompt,
            provider: workerProvider,
            model: this.resolveModel('worker', velixConfig.model, workerProvider),
            apiKey: workerApiKey,
            signal: this.abortController?.signal,
        });
        return response;
    }
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
        this.coordinatorAgent = null;
        this.subtaskCounter = 1;
        this.currentTask = {
            id: taskId,
            goal,
            constraints,
            agents: [],
            status: 'planning',
            createdAt: new Date(),
        };
        this.coordinatorAgent = this.createAgentRecord('coordinator', `Coordinate swarm for: ${goal}`);
        this.setState('planning');
        this.callbacks.onLog(`Swarm task started: ${goal}`, 'info');
        this.emitCoordinatorThought(`I’m coordinating the team for: ${goal}`);
        try {
            // Phase 1: Planning
            this.callbacks.onLog('Phase 1: Planning task decomposition...', 'info');
            const plan = await this.planTask(goal, constraints);
            this.currentTask.plan = plan;
            this.subtaskCounter = plan.subtasks.length + 1;
            this.callbacks.onLog(`Plan created: ${plan.subtasks.length} subtasks`, 'success');
            this.emitCoordinatorThought(`Planned ${plan.subtasks.length} subtasks across ${plan.executionOrder.length} execution phase${plan.executionOrder.length === 1 ? '' : 's'}.`);
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
            if (this.coordinatorAgent) {
                this.coordinatorAgent.status = 'completed';
                this.coordinatorAgent.currentTask = 'Swarm completed';
                this.coordinatorAgent.completedAt = new Date();
                this.callbacks.onAgentUpdate(this.coordinatorAgent);
            }
            this.callbacks.onLog('Swarm task completed successfully!', 'success');
        }
        catch (err) {
            this.setState('failed');
            this.currentTask.status = 'failed';
            if (this.coordinatorAgent) {
                this.coordinatorAgent.status = 'failed';
                this.coordinatorAgent.errors.push(String(err));
                this.coordinatorAgent.completedAt = new Date();
                this.callbacks.onAgentUpdate(this.coordinatorAgent);
            }
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
        const { provider, apiKey } = this.resolveProviderAndKey('planner');
        const velixConfig = loadConfig();
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
        const prompt = this.buildPlanningPrompt(goal, constraints, projectContext);
        this.updateCoordinatorTask('Planning the team strategy');
        const response = await this.send({
            text: prompt,
            system: plannerRole.systemPrompt,
            provider,
            model: this.resolveModel('planner', velixConfig.model, provider),
            apiKey,
            signal: this.abortController?.signal,
        });
        return this.parsePlan(response);
    }
    parsePlan(response) {
        // Extract JSON from response
        const jsonMatch = extractFirstJSON(response);
        if (!jsonMatch) {
            return this.fallbackPlan();
        }
        try {
            const parsed = JSON.parse(jsonMatch);
            const subtasks = Array.isArray(parsed.subtasks) ? parsed.subtasks : [];
            if (subtasks.length === 0) {
                return this.fallbackPlan();
            }
            return {
                subtasks: subtasks.map((subtask, index) => ({
                    id: String(subtask.id ?? index + 1),
                    description: String(subtask.description ?? 'Execute the task'),
                    role: this.normalizeWorkerRole(subtask.role),
                    dependencies: Array.isArray(subtask.dependencies) ? subtask.dependencies.map(String) : [],
                    priority: typeof subtask.priority === 'number' ? subtask.priority : 10,
                    status: 'idle',
                })),
                executionOrder: Array.isArray(parsed.executionOrder) && parsed.executionOrder.length > 0
                    ? parsed.executionOrder.map((group) => Array.isArray(group) ? group.map(String) : [])
                    : [subtasks.map((subtask, index) => String(subtask.id ?? index + 1))],
                estimatedAgents: typeof parsed.estimatedAgents === 'number' ? parsed.estimatedAgents : 1,
            };
        }
        catch {
            return this.fallbackPlan();
        }
    }
    fallbackPlan() {
        return {
            subtasks: [{
                    id: '1',
                    description: 'Execute the complete task',
                    role: this.defaultSpecialistRole(),
                    dependencies: [],
                    priority: 10,
                    status: 'idle',
                }],
            executionOrder: [['1']],
            estimatedAgents: 1,
        };
    }
    getAvailableSpecialistRoles() {
        const configured = Array.isArray(this.config.specialistRoles) ? this.config.specialistRoles : [];
        const unique = Array.from(new Set(configured));
        const valid = unique.filter((role) => SPECIALIST_ROLES.includes(role));
        return valid.length > 0 ? valid : [...SPECIALIST_ROLES];
    }
    defaultSpecialistRole() {
        const roles = this.getAvailableSpecialistRoles();
        return roles.includes('implementer') ? 'implementer' : roles[0];
    }
    normalizeWorkerRole(role) {
        const value = String(role ?? this.defaultSpecialistRole());
        return this.getAvailableSpecialistRoles().includes(value) ? value : this.defaultSpecialistRole();
    }
    createAgentRecord(role, currentTask) {
        const agent = {
            id: `agent_${role}_${randomUUID().slice(0, 6)}`,
            role,
            status: 'working',
            currentTask,
            output: '',
            errors: [],
            startedAt: new Date(),
        };
        this.currentTask?.agents.push(agent);
        this.callbacks.onAgentUpdate(agent);
        return agent;
    }
    updateCoordinatorTask(task) {
        if (!this.coordinatorAgent)
            return;
        this.coordinatorAgent.currentTask = task;
        this.callbacks.onAgentUpdate(this.coordinatorAgent);
    }
    emitCoordinatorThought(text) {
        if (!this.coordinatorAgent)
            return;
        this.callbacks.onActivity?.({
            type: 'thought',
            agentId: this.coordinatorAgent.id,
            role: 'coordinator',
            text,
        });
    }
    resolveModel(kind, fallback, effectiveProvider) {
        let modelOverride;
        if (kind === 'planner')
            modelOverride = this.config.plannerModel || this.config.coordinatorModel || '';
        else if (kind === 'coordinator')
            modelOverride = this.config.coordinatorModel || this.config.plannerModel || '';
        else
            modelOverride = this.config.workerModel || '';
        if (modelOverride)
            return modelOverride;
        // When a different provider is explicitly configured, fall back to that provider's
        // first model rather than the main config model (which may belong to a different provider).
        const velixConfig = loadConfig();
        if (effectiveProvider && effectiveProvider !== velixConfig.provider) {
            const providerDef = PROVIDERS.find(p => p.id === effectiveProvider);
            if (providerDef && providerDef.models.length > 0)
                return providerDef.models[0];
        }
        return fallback;
    }
    /**
     * Resolve the provider and API key for a given agent kind.
     * Allows coordinator and workers to run on different AI providers.
     */
    resolveProviderAndKey(kind) {
        const velixConfig = loadConfig();
        const providerOverride = (kind === 'worker' ? this.config.workerProvider : this.config.coordinatorProvider).trim();
        if (providerOverride && !PROVIDERS.find(p => p.id === providerOverride)) {
            const settingKey = kind === 'worker' ? 'workerProvider' : 'coordinatorProvider';
            throw new Error(`Unknown provider "${providerOverride}" set for ${kind}. ` +
                `Run /swarm-config ${settingKey} <provider-id> with one of: ${PROVIDERS.map(p => p.id).join(', ')}`);
        }
        const provider = (providerOverride || velixConfig.provider);
        const apiKey = getApiKey(provider);
        if (!apiKey) {
            throw new Error(`No API key configured for provider "${provider}". Run /config ${provider} <key> to set one.`);
        }
        return { provider, apiKey };
    }
    ensureRuntimeBudget() {
        if (!this.currentTask)
            return;
        const elapsed = Date.now() - this.currentTask.createdAt.getTime();
        if (elapsed > this.config.maxRuntime) {
            throw new Error(`Swarm runtime exceeded ${this.config.maxRuntime}ms`);
        }
    }
    buildPlanningPrompt(goal, constraints, projectContext) {
        const constraintStr = constraints.length > 0 ? `\nConstraints: ${constraints.join(', ')}` : '';
        const specialistRoles = this.getAvailableSpecialistRoles().join(', ');
        const strategy = this.config.strategy === 'fast'
            ? 'Use the smallest effective team and avoid unnecessary follow-up phases.'
            : this.config.strategy === 'thorough'
                ? 'Favor a fuller team with reviewer/tester coverage when it materially improves confidence.'
                : 'Use a balanced team: enough specialization to be reliable without over-delegating.';
        return `Task: ${goal}${constraintStr}${projectContext}

Swarm strategy: ${this.config.strategy}
Coordinator rule: ${strategy}
Available specialist roles: ${specialistRoles}

Break this task into role-based subtasks for a coordinated team. Prefer specialist roles with clear ownership.
Return a JSON object with this exact structure:
{
  "subtasks": [{ "id": "1", "description": "...", "role": "implementer", "dependencies": [], "priority": 10 }],
  "executionOrder": [["1"], ["2", "3"]],
  "estimatedAgents": 3
}

Rules:
- Only assign specialist roles from this list: ${specialistRoles}
- Do not assign coordinator or planner as a subtask role
- Use tester/reviewer roles when they materially improve confidence, not by default.`;
    }
    /**
     * Execute the plan by running subtasks in the defined order.
     */
    async executePlan(plan) {
        const results = [];
        const pendingGroups = plan.executionOrder.map(group => [...group]);
        let followUpTasksQueued = 0;
        while (pendingGroups.length > 0) {
            this.ensureRuntimeBudget();
            const group = pendingGroups.shift();
            const groupSubtasks = group
                .map(id => plan.subtasks.find(s => s.id === id))
                .filter((s) => !!s);
            if (groupSubtasks.length === 0)
                continue;
            const roles = groupSubtasks.map(subtask => subtask.role).join(', ');
            this.updateCoordinatorTask(`Dispatching ${groupSubtasks.length} agent(s): ${roles}`);
            this.emitCoordinatorThought(`Dispatching ${groupSubtasks.length} specialist${groupSubtasks.length === 1 ? '' : 's'}: ${roles}.`);
            const batchSize = Math.max(1, this.config.maxAgents);
            for (let index = 0; index < groupSubtasks.length; index += batchSize) {
                const batch = groupSubtasks.slice(index, index + batchSize);
                const promises = batch.map(subtask => this.executeSubtask(subtask, results));
                const groupResults = await Promise.allSettled(promises);
                const completedBatch = [];
                for (const result of groupResults) {
                    if (result.status === 'fulfilled' && result.value) {
                        results.push(result.value);
                        completedBatch.push(result.value);
                    }
                }
                if (this.config.coordinatorReview) {
                    const review = await this.reviewBatch(plan, completedBatch, results);
                    if (review.summary) {
                        this.emitCoordinatorThought(review.summary);
                    }
                    const followUpSlots = Math.max(0, this.config.maxFollowUpTasks - followUpTasksQueued);
                    const additionalSubtasks = review.additionalSubtasks.slice(0, followUpSlots);
                    if (review.additionalSubtasks.length > additionalSubtasks.length) {
                        this.callbacks.onLog('Coordinator follow-up limit reached; skipping excess tasks.', 'warn');
                    }
                    if (additionalSubtasks.length > 0) {
                        followUpTasksQueued += additionalSubtasks.length;
                        plan.subtasks.push(...additionalSubtasks);
                        pendingGroups.unshift(additionalSubtasks.map(subtask => subtask.id));
                        this.callbacks.onLog(`Coordinator queued ${additionalSubtasks.length} follow-up task${additionalSubtasks.length === 1 ? '' : 's'}.`, 'info');
                    }
                    if (review.status === 'complete') {
                        this.callbacks.onLog('Coordinator marked the task complete.', 'success');
                        return;
                    }
                }
            }
        }
    }
    async reviewBatch(plan, completedBatch, allResults) {
        if (completedBatch.length === 0) {
            return { status: 'continue', summary: '', additionalSubtasks: [] };
        }
        const { provider: coordProvider, apiKey: coordApiKey } = this.resolveProviderAndKey('coordinator');
        const velixConfig = loadConfig();
        this.updateCoordinatorTask('Reviewing worker results');
        const remaining = plan.subtasks
            .filter(subtask => !allResults.some(result => result.subtaskId === subtask.id))
            .map(subtask => `- [${subtask.role}] ${subtask.description}`)
            .join('\n');
        const resultSummary = completedBatch
            .map(result => {
            const status = result.success ? 'SUCCESS' : 'FAILED';
            const files = result.filesModified.length > 0 ? ` files: ${result.filesModified.join(', ')}` : '';
            return `- [${result.role}] ${result.description}: ${status}.${files}\n  ${result.output.slice(0, 300)}`;
        })
            .join('\n');
        const prompt = `Goal: ${this.currentTask?.goal ?? ''}
Swarm strategy: ${this.config.strategy}
Available specialist roles: ${this.getAvailableSpecialistRoles().join(', ')}

Completed worker batch:
${resultSummary}

Remaining planned work:
${remaining || '(none)'}

Decide what the coordinator should do next.
Return exactly one JSON object:
{
  "status": "continue|complete|follow_up",
  "summary": "short coordinator assessment",
  "additionalSubtasks": [
    { "description": "...", "role": "tester", "dependencies": [], "priority": 8 }
  ]
}

Rules:
- Use "complete" only when the task is actually done or no more work is justified.
- Use "follow_up" only when another specialist would materially improve the result.
- Keep additionalSubtasks short, concrete, and owned by a specialist role from the allowed list.
- Do not assign coordinator or planner as a worker subtask.`;
        const response = await this.send({
            text: prompt,
            system: getRoleDefinition('coordinator').systemPrompt,
            provider: coordProvider,
            model: this.resolveModel('coordinator', velixConfig.model, coordProvider),
            apiKey: coordApiKey,
            signal: this.abortController?.signal,
        });
        return this.parseCoordinatorReview(response, completedBatch);
    }
    parseCoordinatorReview(response, completedBatch) {
        const jsonMatch = extractFirstJSON(response);
        if (!jsonMatch) {
            return this.heuristicCoordinatorReview(completedBatch);
        }
        try {
            const parsed = JSON.parse(jsonMatch);
            const status = parsed.status === 'complete' || parsed.status === 'follow_up' ? parsed.status : 'continue';
            const additionalSubtasks = Array.isArray(parsed.additionalSubtasks)
                ? parsed.additionalSubtasks.slice(0, 3).map(subtask => this.makeFollowUpSubtask(subtask))
                : [];
            return {
                status: additionalSubtasks.length > 0 && status === 'continue' ? 'follow_up' : status,
                summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
                additionalSubtasks,
            };
        }
        catch {
            return this.heuristicCoordinatorReview(completedBatch);
        }
    }
    heuristicCoordinatorReview(completedBatch) {
        const failed = completedBatch.find(result => !result.success);
        if (failed) {
            const recoveryRole = this.getAvailableSpecialistRoles().includes('debugger')
                ? 'debugger'
                : this.defaultSpecialistRole();
            return {
                status: 'follow_up',
                summary: `A worker failed, so I’m sending in a ${recoveryRole} to unblock the team.`,
                additionalSubtasks: [
                    this.makeFollowUpSubtask({
                        description: `Investigate and recover from the failed ${failed.role} task: ${failed.description}`,
                        role: recoveryRole,
                        dependencies: [],
                        priority: 10,
                    }),
                ],
            };
        }
        return {
            status: 'continue',
            summary: 'The completed batch looks healthy. Proceeding with the remaining plan.',
            additionalSubtasks: [],
        };
    }
    makeFollowUpSubtask(subtask) {
        return {
            id: `f${this.subtaskCounter++}`,
            description: String(subtask.description ?? 'Follow-up task'),
            role: this.normalizeWorkerRole(subtask.role),
            dependencies: Array.isArray(subtask.dependencies) ? subtask.dependencies.map(String) : [],
            priority: typeof subtask.priority === 'number' ? subtask.priority : 8,
            status: 'idle',
        };
    }
    /**
     * Execute a single subtask using an AI agent.
     */
    async executeSubtask(subtask, previousResults) {
        const role = getRoleDefinition(subtask.role);
        const { provider: workerProvider, apiKey: workerApiKey } = this.resolveProviderAndKey('worker');
        const velixConfig = loadConfig();
        subtask.status = 'working';
        const agent = this.createAgentRecord(subtask.role, subtask.description);
        subtask.assignedAgent = agent.id;
        this.callbacks.onLog(`[${role.name}] Starting: ${subtask.description}`, 'agent');
        const startTime = Date.now();
        const filesModified = new Set();
        const conversation = [];
        try {
            let contextStr = '';
            if (previousResults.length > 0) {
                contextStr = '\n\nPrevious work done:\n' + previousResults
                    .map(r => `- [${r.role}] ${r.description}: ${r.success ? 'SUCCESS' : 'FAILED'}\n  ${r.output.slice(0, 300)}`)
                    .join('\n');
            }
            let fileContext = '';
            try {
                const sources = readProjectSources(process.cwd(), 20_000);
                const fileNames = Object.keys(sources).slice(0, 20).join('\n');
                fileContext = `\n\nProject files available:\n${fileNames}`;
            }
            catch { /* ignore */ }
            let prompt = this.buildInitialAgentPrompt(subtask.description, role.type, contextStr, fileContext);
            let finalOutput = '';
            for (let step = 0; step < this.config.maxStepsPerAgent; step++) {
                this.ensureRuntimeBudget();
                const response = await this.send({
                    text: prompt,
                    system: this.buildToolSystemPrompt(role.type),
                    provider: workerProvider,
                    model: this.resolveModel('worker', velixConfig.model, workerProvider),
                    apiKey: workerApiKey,
                    messageHistory: conversation,
                    signal: this.abortController?.signal,
                });
                conversation.push({ role: 'user', content: prompt });
                conversation.push({ role: 'assistant', content: response });
                const decision = this.parseDecision(response);
                if (!decision) {
                    const fallbackFiles = this.applyFileChanges(response);
                    for (const filePath of fallbackFiles)
                        filesModified.add(filePath);
                    finalOutput = response;
                    break;
                }
                if (decision.thought) {
                    this.callbacks.onActivity?.({
                        type: 'thought',
                        agentId: agent.id,
                        role: subtask.role,
                        text: decision.thought,
                    });
                }
                const execution = this.executeAction(decision.action, role.capabilities);
                for (const filePath of execution.filesModified)
                    filesModified.add(filePath);
                this.callbacks.onActivity?.({
                    type: 'tool',
                    agentId: agent.id,
                    role: subtask.role,
                    tool: decision.action.tool,
                    args: this.actionArgs(decision.action),
                    summary: execution.summary,
                });
                if (execution.finished) {
                    finalOutput = execution.finalOutput ?? execution.summary;
                    break;
                }
                prompt = `Observation:\n${execution.observation}\n\nDecide the next single action. Reply with one JSON object only.`;
            }
            if (!finalOutput) {
                finalOutput = `Agent reached the tool-step limit (${this.config.maxStepsPerAgent}) before producing a final summary.`;
            }
            agent.output = finalOutput;
            agent.status = 'completed';
            agent.completedAt = new Date();
            subtask.status = 'completed';
            subtask.output = finalOutput;
            this.callbacks.onLog(`[${role.name}] Completed: ${subtask.description}`, 'success');
            this.callbacks.onAgentUpdate(agent);
            return {
                subtaskId: subtask.id,
                description: subtask.description,
                role: subtask.role,
                agentId: agent.id,
                success: true,
                output: finalOutput.slice(0, 500),
                filesModified: Array.from(filesModified),
                duration: Date.now() - startTime,
            };
        }
        catch (err) {
            agent.status = 'failed';
            agent.errors.push(String(err));
            agent.completedAt = new Date();
            subtask.status = 'failed';
            this.callbacks.onAgentUpdate(agent);
            this.callbacks.onLog(`[${role.name}] Failed: ${err}`, 'error');
            return {
                subtaskId: subtask.id,
                description: subtask.description,
                role: subtask.role,
                agentId: agent.id,
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
        if (this.config.dryRunMode || this.config.safeMode || !this.config.autoApplyChanges)
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
    buildToolSystemPrompt(role) {
        const rolePrompt = getRoleDefinition(role).systemPrompt;
        const safetyRules = [
            this.config.safeMode ? '- Safe mode is ON: do not rely on shell or file-modifying actions unless absolutely necessary.' : '',
            !this.config.allowShell ? '- Shell actions are disabled for this swarm run.' : '',
            !this.config.autoApplyChanges || this.config.dryRunMode
                ? '- File modifications are preview-only for this swarm run. You can propose write/edit actions, but they will not be applied.'
                : '',
        ].filter(Boolean).join('\n');
        return `${rolePrompt}

You are working inside Velix swarm mode. Work step by step with tools instead of guessing.
Reply with exactly one JSON object and nothing else.

Schema:
{
  "thought": "short sentence about what you want to inspect or do next",
  "action": {
    "tool": "search|read|list|shell|write|edit|finish",
    "...tool specific args..."
  }
}

Tool rules:
- search: { "tool": "search", "pattern": "...", "path": ".", "glob": "**/*.ts", "limit": 20 }
- read: { "tool": "read", "filePath": "src/index.ts", "startLine": 1, "maxLines": 200 }
- list: { "tool": "list", "path": "." }
- shell: { "tool": "shell", "command": "npm run build" }
- write: { "tool": "write", "filePath": "path/to/file", "content": "full file content" }
- edit: { "tool": "edit", "filePath": "path/to/file", "search": "old text", "replace": "new text" }
- finish: { "tool": "finish", "summary": "what you accomplished, files changed, and any remaining risk" }

Behavior rules:
- Prefer search, list, and read before modifying files.
- Use write for full-file creation or replacement.
- Use edit for focused changes when you know the exact text to replace.
- Use shell only when it materially helps verify or inspect the task.
- Never invent tool results. Wait for the observation and then choose the next action.
- Finish as soon as you have enough evidence and the subtask is complete.
${safetyRules ? `\n${safetyRules}` : ''}`;
    }
    buildInitialAgentPrompt(description, role, contextStr, fileContext) {
        return `Subtask role: ${role}
Task: ${description}${contextStr}${fileContext}

Start by inspecting the codebase or relevant files, then make changes or validations as needed. Reply with one JSON object only.`;
    }
    parseDecision(response) {
        const jsonMatch = extractFirstJSON(response);
        if (!jsonMatch)
            return null;
        try {
            const parsed = JSON.parse(jsonMatch);
            if (!parsed.action || typeof parsed.action !== 'object' || typeof parsed.action.tool !== 'string') {
                return null;
            }
            const tool = parsed.action.tool.toLowerCase();
            const action = { ...parsed.action, tool };
            return {
                thought: typeof parsed.thought === 'string' ? parsed.thought.trim() : undefined,
                action,
            };
        }
        catch {
            return null;
        }
    }
    actionArgs(action) {
        switch (action.tool) {
            case 'search':
                return { pattern: action.pattern, path: action.path ?? '.', glob: action.glob, limit: action.limit ?? 20 };
            case 'read':
                return { filePath: action.filePath, startLine: action.startLine ?? 1, maxLines: action.maxLines ?? 200 };
            case 'list':
                return { path: action.path ?? '.' };
            case 'shell':
                return { command: action.command };
            case 'write':
                return { filePath: action.filePath };
            case 'edit':
                return { filePath: action.filePath, search: action.search };
            case 'finish':
                return {};
        }
    }
    executeAction(action, capabilities) {
        if (action.tool === 'finish') {
            return {
                summary: action.summary,
                observation: action.summary,
                filesModified: [],
                finished: true,
                finalOutput: action.summary,
            };
        }
        if (!this.isToolAllowed(action.tool, capabilities)) {
            const message = `Tool "${action.tool}" is not allowed for this role.`;
            return {
                summary: message,
                observation: message,
                filesModified: [],
            };
        }
        try {
            switch (action.tool) {
                case 'search':
                    return this.runSearch(action);
                case 'read':
                    return this.runRead(action);
                case 'list':
                    return this.runList(action);
                case 'shell':
                    return this.runShell(action);
                case 'write':
                    return this.runWrite(action);
                case 'edit':
                    return this.runEdit(action);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                summary: `Tool ${action.tool} failed`,
                observation: message,
                filesModified: [],
            };
        }
    }
    isToolAllowed(tool, capabilities) {
        const capabilityMap = {
            search: ['search_files', 'read_file'],
            read: ['read_file'],
            list: ['read_file'],
            shell: ['execute_command'],
            write: ['write_file'],
            edit: ['edit_file'],
        };
        if (tool === 'finish')
            return true;
        return capabilityMap[tool].some(capability => capabilities.includes(capability));
    }
    runSearch(action) {
        const searchRoot = this.resolvePath(action.path ?? '.');
        const matches = searchInFiles(searchRoot, action.pattern, Math.min(action.limit ?? 20, 50), { glob: action.glob });
        const uniqueFiles = new Set(matches.map(match => match.file));
        const globNote = action.glob ? ` matching ${action.glob}` : '';
        const summary = `Found ${matches.length} matches in ${uniqueFiles.size} files${globNote}`;
        const preview = matches
            .slice(0, 20)
            .map(match => `${match.file}:${match.line}:${match.column} ${match.text.trim()}`)
            .join('\n');
        return {
            summary,
            observation: preview || 'No matches found.',
            filesModified: [],
        };
    }
    runRead(action) {
        const filePath = this.resolvePath(action.filePath);
        const content = readFile(filePath);
        const lines = content.split('\n');
        const start = Math.max(1, action.startLine ?? 1);
        const maxLines = Math.min(action.maxLines ?? 200, 400);
        const slice = lines.slice(start - 1, start - 1 + maxLines);
        const summary = `Read ${slice.length} lines from ${this.relativeToCwd(filePath)} (${lines.length} total lines)`;
        const observation = slice
            .map((line, index) => `${String(start + index).padStart(4, ' ')} ${line}`)
            .join('\n');
        return {
            summary,
            observation,
            filesModified: [],
        };
    }
    runList(action) {
        const target = this.resolvePath(action.path ?? '.');
        const items = listDir(target);
        return {
            summary: `Found ${items.length} items in ${this.relativeToCwd(target)}`,
            observation: items.slice(0, 200).join('\n'),
            filesModified: [],
        };
    }
    runShell(action) {
        if (this.config.safeMode || !this.config.allowShell) {
            return {
                summary: 'Shell execution is disabled for this swarm run',
                observation: `Blocked command: ${action.command}`,
                filesModified: [],
            };
        }
        if (!this.isCommandSafe(action.command)) {
            return {
                summary: 'Blocked unsafe shell command',
                observation: `Blocked command: ${action.command}`,
                filesModified: [],
            };
        }
        const result = execShell(action.command, process.cwd());
        const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
        return {
            summary: `Shell exited with code ${result.exitCode}`,
            observation: output.slice(0, 4000) || '(no output)',
            filesModified: [],
        };
    }
    runWrite(action) {
        const filePath = this.resolvePath(action.filePath);
        if (this.config.safeMode || this.config.dryRunMode || !this.config.autoApplyChanges) {
            const lineCount = action.content.split('\n').length;
            return {
                summary: `Previewed write of ${lineCount} lines to ${this.relativeToCwd(filePath)}`,
                observation: action.content.slice(0, 4000),
                filesModified: [],
            };
        }
        writeFile(filePath, action.content);
        const lineCount = action.content.split('\n').length;
        return {
            summary: `Wrote ${lineCount} lines to ${this.relativeToCwd(filePath)}`,
            observation: `Updated ${this.relativeToCwd(filePath)}`,
            filesModified: [this.relativeToCwd(filePath)],
        };
    }
    runEdit(action) {
        const filePath = this.resolvePath(action.filePath);
        if (this.config.safeMode || this.config.dryRunMode || !this.config.autoApplyChanges) {
            return {
                summary: `Previewed edit for ${this.relativeToCwd(filePath)}`,
                observation: `SEARCH:\n${action.search}\n\nREPLACE:\n${action.replace}`.slice(0, 4000),
                filesModified: [],
            };
        }
        const updated = editFile(filePath, action.search, action.replace);
        return {
            summary: updated
                ? `Updated ${this.relativeToCwd(filePath)}`
                : `Could not find the target text in ${this.relativeToCwd(filePath)}`,
            observation: updated ? 'Edit applied successfully.' : 'No changes were made.',
            filesModified: updated ? [this.relativeToCwd(filePath)] : [],
        };
    }
    resolvePath(input) {
        if (path.isAbsolute(input))
            return input;
        return path.resolve(process.cwd(), input);
    }
    relativeToCwd(input) {
        const relative = path.relative(process.cwd(), input);
        return relative || '.';
    }
    /**
     * Validate results by running build/test if available.
     */
    async validateResults() {
        if (!this.config.validateBuild && !this.config.validateTests) {
            this.callbacks.onLog('Validation skipped by swarm configuration', 'warn');
            return;
        }
        let scripts = {};
        const packageJsonPath = path.join(process.cwd(), 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            try {
                const raw = readFile(packageJsonPath);
                const parsed = JSON.parse(raw);
                scripts = parsed.scripts ?? {};
            }
            catch {
                this.callbacks.onLog('Validation note: could not parse package.json, using explicit swarm commands only.', 'warn');
            }
        }
        if (this.config.validateBuild) {
            const buildCommand = this.config.buildCommand.trim() || (scripts.build ? 'npm run build' : '');
            if (!buildCommand) {
                this.callbacks.onLog('Build check skipped: no build command configured', 'warn');
            }
            else {
                const buildResult = execShell(buildCommand, process.cwd());
                if (buildResult.exitCode === 0) {
                    this.callbacks.onLog('Build check: OK', 'success');
                }
                else {
                    const output = [buildResult.stdout, buildResult.stderr].filter(Boolean).join('\n').slice(0, 400);
                    this.callbacks.onLog(`Build check failed:\n${output}`, 'warn');
                }
            }
        }
        if (this.config.validateTests) {
            const testCommand = this.config.testCommand.trim() || (scripts.test ? 'npm test' : '');
            if (!testCommand) {
                this.callbacks.onLog('Test check skipped: no test command configured', 'warn');
            }
            else {
                const testResult = execShell(testCommand, process.cwd());
                if (testResult.exitCode === 0) {
                    this.callbacks.onLog('Test check: OK', 'success');
                }
                else {
                    const output = [testResult.stdout, testResult.stderr].filter(Boolean).join('\n').slice(0, 400);
                    this.callbacks.onLog(`Test check failed:\n${output}`, 'warn');
                }
            }
        }
    }
    /**
     * Emergency stop - abort all operations.
     */
    abort() {
        this.abortController?.abort();
        this.setState('failed');
        if (this.coordinatorAgent) {
            this.coordinatorAgent.status = 'terminated';
            this.coordinatorAgent.completedAt = new Date();
            this.callbacks.onAgentUpdate(this.coordinatorAgent);
        }
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