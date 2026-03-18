/**
 * Configuration store - Persists API keys, provider selection, and settings.
 * Uses a JSON file in ~/.config/velix/config.json
 */
import { ProviderID } from '../services/ai/types.js';
export interface VelixConfig {
    provider: ProviderID;
    model: string;
    apiKeys: Partial<Record<ProviderID, string>>;
    swarm: {
        maxAgents: number;
        maxRuntime: number;
        safeMode: boolean;
        workerCLI: string;
    };
    theme: 'default';
}
export declare function loadConfig(): VelixConfig;
export declare function saveConfig(config?: Partial<VelixConfig>): void;
export declare function getApiKey(provider?: ProviderID): string | undefined;
export declare function setApiKey(provider: ProviderID, key: string): void;
export declare function setProvider(provider: ProviderID, model?: string): void;
export declare function getCurrentProvider(): {
    provider: ProviderID;
    model: string;
};
//# sourceMappingURL=store.d.ts.map