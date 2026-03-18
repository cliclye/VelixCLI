/**
 * Role definitions for swarm agents - ported from Velix desktop
 */
import { AgentRoleType } from './types.js';
export interface RoleDefinition {
    type: AgentRoleType;
    name: string;
    description: string;
    systemPrompt: string;
    capabilities: string[];
}
export declare const ROLE_DEFINITIONS: RoleDefinition[];
export declare function getRoleDefinition(role: AgentRoleType): RoleDefinition;
//# sourceMappingURL=roles.d.ts.map