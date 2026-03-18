/**
 * Swarm orchestration types - ported from Velix desktop
 */

export type AgentRoleType = 'planner' | 'implementer' | 'tester' | 'reviewer' | 'refactorer' | 'architect' | 'debugger' | 'documenter';

export type AgentStatus = 'idle' | 'working' | 'completed' | 'failed' | 'terminated';

export type OrchestratorState = 'idle' | 'planning' | 'executing' | 'validating' | 'completed' | 'failed' | 'paused';

export interface Agent {
    id: string;
    role: AgentRoleType;
    status: AgentStatus;
    currentTask?: string;
    output: string;
    errors: string[];
    startedAt?: Date;
    completedAt?: Date;
}

export interface SwarmTask {
    id: string;
    goal: string;
    constraints: string[];
    agents: Agent[];
    status: OrchestratorState;
    plan?: TaskPlan;
    createdAt: Date;
    completedAt?: Date;
}

export interface TaskPlan {
    subtasks: Subtask[];
    executionOrder: string[][];
    estimatedAgents: number;
}

export interface Subtask {
    id: string;
    description: string;
    role: AgentRoleType;
    dependencies: string[];
    priority: number;
    status: AgentStatus;
    assignedAgent?: string;
    output?: string;
}

export interface SubtaskResult {
    subtaskId: string;
    description: string;
    role: AgentRoleType;
    agentId: string;
    success: boolean;
    output: string;
    filesModified: string[];
    duration: number;
}

export interface SafetyConfig {
    maxRuntimePerAgent: number;
    maxTotalRuntime: number;
    maxRetriesPerFailure: number;
    maxFileModifications: number;
    maxNewFiles: number;
    forbiddenPaths: string[];
    forbiddenCommands: string[];
    sandboxEnabled: boolean;
    dryRunMode: boolean;
}

export interface SwarmConfig {
    maxAgents: number;
    maxRuntime: number;
    safeMode: boolean;
    workerCLI: string;
    dryRunMode: boolean;
}
