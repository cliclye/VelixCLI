/**
 * SwarmOrchestrator - CLI-native swarm orchestration.
 * Uses AI providers directly (no Tauri/Electron dependency).
 * Spawns "agents" as sequential AI calls with role-specific system prompts.
 */
import type { SendMessageParams } from '../ai/engine.js';
import { SwarmTask, Agent, OrchestratorState, SwarmConfig, SwarmActivity } from './types.js';
type LogFn = (msg: string, type?: 'info' | 'warn' | 'error' | 'success' | 'agent') => void;
type SendMessageFn = (params: SendMessageParams) => Promise<string>;
export interface SwarmCallbacks {
    onLog: LogFn;
    onStateChange: (state: OrchestratorState) => void;
    onAgentUpdate: (agent: Agent) => void;
    onComplete: (task: SwarmTask) => void;
    onActivity?: (activity: SwarmActivity) => void;
}
type SwarmDependencies = {
    sendMessage?: SendMessageFn;
};
export declare class SwarmOrchestrator {
    private state;
    private currentTask;
    private callbacks;
    private config;
    private abortController;
    private send;
    private coordinatorAgent;
    private subtaskCounter;
    constructor(callbacks: SwarmCallbacks, config?: Partial<SwarmConfig>, dependencies?: SwarmDependencies);
    getState(): OrchestratorState;
    getCurrentTask(): SwarmTask | null;
    private setState;
    /**
     * Execute a complete swarm task.
     */
    execute(goal: string, constraints?: string[]): Promise<SwarmTask>;
    /**
     * Plan the task by asking the planner agent.
     */
    private planTask;
    private parsePlan;
    private fallbackPlan;
    private getAvailableSpecialistRoles;
    private defaultSpecialistRole;
    private normalizeWorkerRole;
    private createAgentRecord;
    private updateCoordinatorTask;
    private emitCoordinatorThought;
    private resolveModel;
    private ensureRuntimeBudget;
    private buildPlanningPrompt;
    /**
     * Execute the plan by running subtasks in the defined order.
     */
    private executePlan;
    private reviewBatch;
    private parseCoordinatorReview;
    private heuristicCoordinatorReview;
    private makeFollowUpSubtask;
    /**
     * Execute a single subtask using an AI agent.
     */
    private executeSubtask;
    /**
     * Extract FILE: blocks from AI response and apply them.
     */
    private applyFileChanges;
    private buildToolSystemPrompt;
    private buildInitialAgentPrompt;
    private parseDecision;
    private actionArgs;
    private executeAction;
    private isToolAllowed;
    private runSearch;
    private runRead;
    private runList;
    private runShell;
    private runWrite;
    private runEdit;
    private resolvePath;
    private relativeToCwd;
    /**
     * Validate results by running build/test if available.
     */
    private validateResults;
    /**
     * Emergency stop - abort all operations.
     */
    abort(): void;
    /**
     * Validate a command against safety rules.
     */
    isCommandSafe(command: string): boolean;
}
export {};
//# sourceMappingURL=orchestrator.d.ts.map