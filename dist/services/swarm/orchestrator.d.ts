/**
 * SwarmOrchestrator - CLI-native swarm orchestration.
 * Uses AI providers directly (no Tauri/Electron dependency).
 * Spawns "agents" as sequential AI calls with role-specific system prompts.
 */
import { SwarmTask, Agent, OrchestratorState, SwarmConfig } from './types.js';
type LogFn = (msg: string, type?: 'info' | 'warn' | 'error' | 'success' | 'agent') => void;
export interface SwarmCallbacks {
    onLog: LogFn;
    onStateChange: (state: OrchestratorState) => void;
    onAgentUpdate: (agent: Agent) => void;
    onComplete: (task: SwarmTask) => void;
}
export declare class SwarmOrchestrator {
    private state;
    private currentTask;
    private callbacks;
    private config;
    private abortController;
    constructor(callbacks: SwarmCallbacks, config?: Partial<SwarmConfig>);
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
    /**
     * Execute the plan by running subtasks in the defined order.
     */
    private executePlan;
    /**
     * Execute a single subtask using an AI agent.
     */
    private executeSubtask;
    /**
     * Extract FILE: blocks from AI response and apply them.
     */
    private applyFileChanges;
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