/**
 * SwarmOrchestrator - CLI-native swarm orchestration.
 * Uses AI providers directly (no Tauri/Electron dependency).
 * Spawns "agents" as sequential AI calls with role-specific system prompts.
 */

import { randomUUID } from 'node:crypto';
import { sendMessage } from '../ai/engine.js';
import type { SendMessageParams } from '../ai/engine.js';
import { loadConfig, getApiKey } from '../../config/store.js';
import {
    SwarmTask, TaskPlan, Subtask, Agent, SubtaskResult,
    OrchestratorState, AgentRoleType, SwarmConfig, SwarmActivity, SPECIALIST_ROLES, SpecialistRole,
} from './types.js';
import { getRoleDefinition } from './roles.js';
import { readProjectSources, execShell, readFile, writeFile, searchInFiles, listDir, editFile } from '../tools/index.js';
import type { ChatMessage } from '../ai/types.js';
import path from 'node:path';
import fs from 'node:fs';

type LogFn = (msg: string, type?: 'info' | 'warn' | 'error' | 'success' | 'agent') => void;
type SendMessageFn = (params: SendMessageParams) => Promise<string>;

export interface SwarmCallbacks {
    onLog: LogFn;
    onStateChange: (state: OrchestratorState) => void;
    onAgentUpdate: (agent: Agent) => void;
    onComplete: (task: SwarmTask) => void;
    onActivity?: (activity: SwarmActivity) => void;
}

const DEFAULT_SWARM_CONFIG: SwarmConfig = {
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
    workerCLI: 'claude',
    buildCommand: '',
    testCommand: '',
    dryRunMode: false,
};

const FORBIDDEN_COMMANDS = [
    'rm -rf /', 'rm -rf /*', 'sudo rm', ':(){:|:&};:', '> /dev/sda',
    'dd if=', 'mkfs', 'chmod -R 777 /', 'chown -R',
];

type AgentToolName = 'search' | 'read' | 'list' | 'shell' | 'write' | 'edit' | 'finish';

type AgentAction =
    | { tool: 'search'; pattern: string; path?: string; glob?: string; limit?: number }
    | { tool: 'read'; filePath: string; startLine?: number; maxLines?: number }
    | { tool: 'list'; path?: string }
    | { tool: 'shell'; command: string }
    | { tool: 'write'; filePath: string; content: string }
    | { tool: 'edit'; filePath: string; search: string; replace: string }
    | { tool: 'finish'; summary: string };

type AgentDecision = {
    thought?: string;
    action: AgentAction;
};

type ToolExecutionResult = {
    summary: string;
    observation: string;
    filesModified: string[];
    finished?: boolean;
    finalOutput?: string;
};

type SwarmDependencies = {
    sendMessage?: SendMessageFn;
};

type CoordinatorReview = {
    status: 'continue' | 'complete' | 'follow_up';
    summary: string;
    additionalSubtasks: Subtask[];
};

export class SwarmOrchestrator {
    private state: OrchestratorState = 'idle';
    private currentTask: SwarmTask | null = null;
    private callbacks: SwarmCallbacks;
    private config: SwarmConfig;
    private abortController: AbortController | null = null;
    private send: SendMessageFn;
    private coordinatorAgent: Agent | null = null;
    private subtaskCounter = 1;

    constructor(callbacks: SwarmCallbacks, config?: Partial<SwarmConfig>, dependencies: SwarmDependencies = {}) {
        this.callbacks = callbacks;
        const velixConfig = loadConfig();
        this.config = {
            ...DEFAULT_SWARM_CONFIG,
            ...velixConfig.swarm,
            ...config,
        };
        this.send = dependencies.sendMessage ?? sendMessage;
    }

    getState(): OrchestratorState { return this.state; }
    getCurrentTask(): SwarmTask | null { return this.currentTask; }

    private setState(state: OrchestratorState): void {
        this.state = state;
        this.callbacks.onStateChange(state);
    }

    /**
     * Execute a complete swarm task.
     */
    async execute(goal: string, constraints: string[] = []): Promise<SwarmTask> {
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
            this.emitCoordinatorThought(
                `Planned ${plan.subtasks.length} subtasks across ${plan.executionOrder.length} execution phase${plan.executionOrder.length === 1 ? '' : 's'}.`,
            );

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
        } catch (err) {
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
    private async planTask(goal: string, constraints: string[]): Promise<TaskPlan> {
        const plannerRole = getRoleDefinition('planner');
        const velixConfig = loadConfig();
        const apiKey = getApiKey();
        if (!apiKey) throw new Error('No API key configured. Run /config to set one.');

        // Gather project context
        let projectContext = '';
        try {
            const sources = readProjectSources(process.cwd(), 30_000);
            const fileList = Object.keys(sources).join('\n');
            projectContext = `\nProject files:\n${fileList}\n`;
        } catch {
            projectContext = '\n(Could not read project files)\n';
        }

        const prompt = this.buildPlanningPrompt(goal, constraints, projectContext);
        this.updateCoordinatorTask('Planning the team strategy');

        const response = await this.send({
            text: prompt,
            system: plannerRole.systemPrompt,
            provider: velixConfig.provider,
            model: this.resolveModel('planner', velixConfig.model),
            apiKey,
            signal: this.abortController?.signal,
        });

        return this.parsePlan(response);
    }

    private parsePlan(response: string): TaskPlan {
        // Extract JSON from response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return this.fallbackPlan();
        }

        try {
            const parsed = JSON.parse(jsonMatch[0]);
            const subtasks = Array.isArray(parsed.subtasks) ? parsed.subtasks : [];
            if (subtasks.length === 0) {
                return this.fallbackPlan();
            }
            return {
                subtasks: subtasks.map((subtask: Partial<Subtask>, index: number) => ({
                    id: String(subtask.id ?? index + 1),
                    description: String(subtask.description ?? 'Execute the task'),
                    role: this.normalizeWorkerRole(subtask.role),
                    dependencies: Array.isArray(subtask.dependencies) ? subtask.dependencies.map(String) : [],
                    priority: typeof subtask.priority === 'number' ? subtask.priority : 10,
                    status: 'idle' as const,
                })),
                executionOrder: Array.isArray(parsed.executionOrder) && parsed.executionOrder.length > 0
                    ? parsed.executionOrder.map((group: unknown) => Array.isArray(group) ? group.map(String) : [])
                    : [subtasks.map((subtask: { id?: string }, index: number) => String(subtask.id ?? index + 1))],
                estimatedAgents: typeof parsed.estimatedAgents === 'number' ? parsed.estimatedAgents : 1,
            };
        } catch {
            return this.fallbackPlan();
        }
    }

    private fallbackPlan(): TaskPlan {
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

    private getAvailableSpecialistRoles(): SpecialistRole[] {
        const configured = Array.isArray(this.config.specialistRoles) ? this.config.specialistRoles : [];
        const unique = Array.from(new Set(configured));
        const valid = unique.filter((role): role is SpecialistRole => SPECIALIST_ROLES.includes(role as SpecialistRole));
        return valid.length > 0 ? valid : [...SPECIALIST_ROLES];
    }

    private defaultSpecialistRole(): SpecialistRole {
        const roles = this.getAvailableSpecialistRoles();
        return roles.includes('implementer') ? 'implementer' : roles[0];
    }

    private normalizeWorkerRole(role: unknown): SpecialistRole {
        const value = String(role ?? this.defaultSpecialistRole()) as SpecialistRole;
        return this.getAvailableSpecialistRoles().includes(value) ? value : this.defaultSpecialistRole();
    }

    private createAgentRecord(role: AgentRoleType, currentTask: string): Agent {
        const agent: Agent = {
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

    private updateCoordinatorTask(task: string): void {
        if (!this.coordinatorAgent) return;
        this.coordinatorAgent.currentTask = task;
        this.callbacks.onAgentUpdate(this.coordinatorAgent);
    }

    private emitCoordinatorThought(text: string): void {
        if (!this.coordinatorAgent) return;
        this.callbacks.onActivity?.({
            type: 'thought',
            agentId: this.coordinatorAgent.id,
            role: 'coordinator',
            text,
        });
    }

    private resolveModel(kind: 'planner' | 'coordinator' | 'worker', fallback: string): string {
        if (kind === 'planner') return this.config.plannerModel || this.config.coordinatorModel || fallback;
        if (kind === 'coordinator') return this.config.coordinatorModel || this.config.plannerModel || fallback;
        return this.config.workerModel || fallback;
    }

    private ensureRuntimeBudget(): void {
        if (!this.currentTask) return;
        const elapsed = Date.now() - this.currentTask.createdAt.getTime();
        if (elapsed > this.config.maxRuntime) {
            throw new Error(`Swarm runtime exceeded ${this.config.maxRuntime}ms`);
        }
    }

    private buildPlanningPrompt(goal: string, constraints: string[], projectContext: string): string {
        const constraintStr = constraints.length > 0 ? `\nConstraints: ${constraints.join(', ')}` : '';
        const specialistRoles = this.getAvailableSpecialistRoles().join(', ');
        const strategy =
            this.config.strategy === 'fast'
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
    private async executePlan(plan: TaskPlan): Promise<void> {
        const results: SubtaskResult[] = [];
        const pendingGroups = plan.executionOrder.map(group => [...group]);
        let followUpTasksQueued = 0;

        while (pendingGroups.length > 0) {
            this.ensureRuntimeBudget();
            const group = pendingGroups.shift()!;
            const groupSubtasks = group
                .map(id => plan.subtasks.find(s => s.id === id))
                .filter((s): s is Subtask => !!s);
            if (groupSubtasks.length === 0) continue;

            const roles = groupSubtasks.map(subtask => subtask.role).join(', ');
            this.updateCoordinatorTask(`Dispatching ${groupSubtasks.length} agent(s): ${roles}`);
            this.emitCoordinatorThought(
                `Dispatching ${groupSubtasks.length} specialist${groupSubtasks.length === 1 ? '' : 's'}: ${roles}.`,
            );

            const batchSize = Math.max(1, this.config.maxAgents);
            for (let index = 0; index < groupSubtasks.length; index += batchSize) {
                const batch = groupSubtasks.slice(index, index + batchSize);
                const promises = batch.map(subtask => this.executeSubtask(subtask, results));
                const groupResults = await Promise.allSettled(promises);
                const completedBatch: SubtaskResult[] = [];
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
                        this.callbacks.onLog(
                            `Coordinator queued ${additionalSubtasks.length} follow-up task${additionalSubtasks.length === 1 ? '' : 's'}.`,
                            'info',
                        );
                    }
                    if (review.status === 'complete') {
                        this.callbacks.onLog('Coordinator marked the task complete.', 'success');
                        return;
                    }
                }
            }
        }
    }

    private async reviewBatch(
        plan: TaskPlan,
        completedBatch: SubtaskResult[],
        allResults: SubtaskResult[],
    ): Promise<CoordinatorReview> {
        if (completedBatch.length === 0) {
            return { status: 'continue', summary: '', additionalSubtasks: [] };
        }

        const velixConfig = loadConfig();
        const apiKey = getApiKey();
        if (!apiKey) throw new Error('No API key configured');

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
            provider: velixConfig.provider,
            model: this.resolveModel('coordinator', velixConfig.model),
            apiKey,
            signal: this.abortController?.signal,
        });

        return this.parseCoordinatorReview(response, completedBatch);
    }

    private parseCoordinatorReview(response: string, completedBatch: SubtaskResult[]): CoordinatorReview {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return this.heuristicCoordinatorReview(completedBatch);
        }

        try {
            const parsed = JSON.parse(jsonMatch[0]) as {
                status?: string;
                summary?: string;
                additionalSubtasks?: Array<Partial<Subtask>>;
            };
            const status = parsed.status === 'complete' || parsed.status === 'follow_up' ? parsed.status : 'continue';
            const additionalSubtasks = Array.isArray(parsed.additionalSubtasks)
                ? parsed.additionalSubtasks.slice(0, 3).map(subtask => this.makeFollowUpSubtask(subtask))
                : [];

            return {
                status: additionalSubtasks.length > 0 && status === 'continue' ? 'follow_up' : status,
                summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
                additionalSubtasks,
            };
        } catch {
            return this.heuristicCoordinatorReview(completedBatch);
        }
    }

    private heuristicCoordinatorReview(completedBatch: SubtaskResult[]): CoordinatorReview {
        const failed = completedBatch.find(result => !result.success);
        if (failed) {
            const recoveryRole: SpecialistRole = this.getAvailableSpecialistRoles().includes('debugger')
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

    private makeFollowUpSubtask(subtask: Partial<Subtask>): Subtask {
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
    private async executeSubtask(subtask: Subtask, previousResults: SubtaskResult[]): Promise<SubtaskResult | null> {
        const role = getRoleDefinition(subtask.role);
        const velixConfig = loadConfig();
        const apiKey = getApiKey();
        if (!apiKey) throw new Error('No API key configured');

        subtask.status = 'working';
        const agent = this.createAgentRecord(subtask.role, subtask.description);
        subtask.assignedAgent = agent.id;
        this.callbacks.onLog(`[${role.name}] Starting: ${subtask.description}`, 'agent');

        const startTime = Date.now();
        const filesModified = new Set<string>();
        const conversation: ChatMessage[] = [];

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
            } catch { /* ignore */ }

            let prompt = this.buildInitialAgentPrompt(subtask.description, role.type, contextStr, fileContext);
            let finalOutput = '';

            for (let step = 0; step < this.config.maxStepsPerAgent; step++) {
                this.ensureRuntimeBudget();
                const response = await this.send({
                    text: prompt,
                    system: this.buildToolSystemPrompt(role.type),
                    provider: velixConfig.provider,
                    model: this.resolveModel('worker', velixConfig.model),
                    apiKey,
                    messageHistory: conversation,
                    signal: this.abortController?.signal,
                });
                conversation.push({ role: 'user', content: prompt });
                conversation.push({ role: 'assistant', content: response });

                const decision = this.parseDecision(response);
                if (!decision) {
                    const fallbackFiles = this.applyFileChanges(response);
                    for (const filePath of fallbackFiles) filesModified.add(filePath);
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
                for (const filePath of execution.filesModified) filesModified.add(filePath);
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
        } catch (err) {
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
    private applyFileChanges(response: string): string[] {
        if (this.config.dryRunMode || this.config.safeMode || !this.config.autoApplyChanges) return [];

        const modified: string[] = [];
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
            } catch (err) {
                this.callbacks.onLog(`  Failed to write ${filePath}: ${err}`, 'warn');
            }
        }

        return modified;
    }

    private buildToolSystemPrompt(role: AgentRoleType): string {
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

    private buildInitialAgentPrompt(
        description: string,
        role: AgentRoleType,
        contextStr: string,
        fileContext: string,
    ): string {
        return `Subtask role: ${role}
Task: ${description}${contextStr}${fileContext}

Start by inspecting the codebase or relevant files, then make changes or validations as needed. Reply with one JSON object only.`;
    }

    private parseDecision(response: string): AgentDecision | null {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;

        try {
            const parsed = JSON.parse(jsonMatch[0]) as Partial<AgentDecision>;
            if (!parsed.action || typeof parsed.action !== 'object' || typeof parsed.action.tool !== 'string') {
                return null;
            }

            const tool = parsed.action.tool.toLowerCase() as AgentToolName;
            const action = { ...parsed.action, tool } as AgentAction;
            return {
                thought: typeof parsed.thought === 'string' ? parsed.thought.trim() : undefined,
                action,
            };
        } catch {
            return null;
        }
    }

    private actionArgs(action: AgentAction): Record<string, unknown> {
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

    private executeAction(action: AgentAction, capabilities: string[]): ToolExecutionResult {
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
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                summary: `Tool ${action.tool} failed`,
                observation: message,
                filesModified: [],
            };
        }
    }

    private isToolAllowed(tool: AgentToolName, capabilities: string[]): boolean {
        const capabilityMap: Record<Exclude<AgentToolName, 'finish'>, string[]> = {
            search: ['search_files', 'read_file'],
            read: ['read_file'],
            list: ['read_file'],
            shell: ['execute_command'],
            write: ['write_file'],
            edit: ['edit_file'],
        };

        if (tool === 'finish') return true;
        return capabilityMap[tool].some(capability => capabilities.includes(capability));
    }

    private runSearch(action: Extract<AgentAction, { tool: 'search' }>): ToolExecutionResult {
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

    private runRead(action: Extract<AgentAction, { tool: 'read' }>): ToolExecutionResult {
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

    private runList(action: Extract<AgentAction, { tool: 'list' }>): ToolExecutionResult {
        const target = this.resolvePath(action.path ?? '.');
        const items = listDir(target);
        return {
            summary: `Found ${items.length} items in ${this.relativeToCwd(target)}`,
            observation: items.slice(0, 200).join('\n'),
            filesModified: [],
        };
    }

    private runShell(action: Extract<AgentAction, { tool: 'shell' }>): ToolExecutionResult {
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

    private runWrite(action: Extract<AgentAction, { tool: 'write' }>): ToolExecutionResult {
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

    private runEdit(action: Extract<AgentAction, { tool: 'edit' }>): ToolExecutionResult {
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

    private resolvePath(input: string): string {
        if (path.isAbsolute(input)) return input;
        return path.resolve(process.cwd(), input);
    }

    private relativeToCwd(input: string): string {
        const relative = path.relative(process.cwd(), input);
        return relative || '.';
    }

    /**
     * Validate results by running build/test if available.
     */
    private async validateResults(): Promise<void> {
        if (!this.config.validateBuild && !this.config.validateTests) {
            this.callbacks.onLog('Validation skipped by swarm configuration', 'warn');
            return;
        }

        let scripts: Record<string, string> = {};
        const packageJsonPath = path.join(process.cwd(), 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            try {
                const raw = readFile(packageJsonPath);
                const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
                scripts = parsed.scripts ?? {};
            } catch {
                this.callbacks.onLog('Validation note: could not parse package.json, using explicit swarm commands only.', 'warn');
            }
        }

        if (this.config.validateBuild) {
            const buildCommand = this.config.buildCommand.trim() || (scripts.build ? 'npm run build' : '');
            if (!buildCommand) {
                this.callbacks.onLog('Build check skipped: no build command configured', 'warn');
            } else {
                const buildResult = execShell(buildCommand, process.cwd());
                if (buildResult.exitCode === 0) {
                    this.callbacks.onLog('Build check: OK', 'success');
                } else {
                    const output = [buildResult.stdout, buildResult.stderr].filter(Boolean).join('\n').slice(0, 400);
                    this.callbacks.onLog(`Build check failed:\n${output}`, 'warn');
                }
            }
        }

        if (this.config.validateTests) {
            const testCommand = this.config.testCommand.trim() || (scripts.test ? 'npm test' : '');
            if (!testCommand) {
                this.callbacks.onLog('Test check skipped: no test command configured', 'warn');
            } else {
                const testResult = execShell(testCommand, process.cwd());
                if (testResult.exitCode === 0) {
                    this.callbacks.onLog('Test check: OK', 'success');
                } else {
                    const output = [testResult.stdout, testResult.stderr].filter(Boolean).join('\n').slice(0, 400);
                    this.callbacks.onLog(`Test check failed:\n${output}`, 'warn');
                }
            }
        }
    }

    /**
     * Emergency stop - abort all operations.
     */
    abort(): void {
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
    isCommandSafe(command: string): boolean {
        const lower = command.toLowerCase();
        return !FORBIDDEN_COMMANDS.some(fc => lower.includes(fc.toLowerCase()));
    }
}
