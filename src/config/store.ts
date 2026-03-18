/**
 * Configuration store - Persists API keys, provider selection, and settings.
 * Uses a JSON file in ~/.config/velix/config.json
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProviderID, PROVIDERS } from '../services/ai/types.js';

export interface VelixConfig {
    provider: ProviderID;
    model: string;
    apiKeys: Partial<Record<ProviderID, string>>;
    swarm: {
        maxAgents: number;
        maxRuntime: number; // ms
        safeMode: boolean;
        workerCLI: string;
    };
    theme: 'default';
}

const DEFAULT_CONFIG: VelixConfig = {
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    apiKeys: {},
    swarm: {
        maxAgents: 5,
        maxRuntime: 600000,
        safeMode: false,
        workerCLI: 'claude',
    },
    theme: 'default',
};

function getConfigDir(): string {
    return path.join(os.homedir(), '.config', 'velix');
}

function getConfigPath(): string {
    return path.join(getConfigDir(), 'config.json');
}

let _config: VelixConfig | null = null;

export function loadConfig(): VelixConfig {
    if (_config) return _config;

    const configPath = getConfigPath();
    try {
        if (fs.existsSync(configPath)) {
            const raw = fs.readFileSync(configPath, 'utf-8');
            const loaded = JSON.parse(raw);
            _config = { ...DEFAULT_CONFIG, ...loaded, swarm: { ...DEFAULT_CONFIG.swarm, ...loaded.swarm } };
        } else {
            _config = { ...DEFAULT_CONFIG };
        }
    } catch {
        _config = { ...DEFAULT_CONFIG };
    }

    // Also check environment variables for API keys
    for (const provider of PROVIDERS) {
        const envKey = process.env[provider.envVar];
        if (envKey && !_config!.apiKeys[provider.id]) {
            _config!.apiKeys[provider.id] = envKey;
        }
    }

    return _config!;
}

export function saveConfig(config?: Partial<VelixConfig>): void {
    const current = loadConfig();
    if (config) {
        Object.assign(current, config);
        if (config.swarm) {
            current.swarm = { ...current.swarm, ...config.swarm };
        }
    }
    _config = current;

    const configDir = getConfigDir();
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }

    // Don't persist env-var-only keys
    const serializable = { ...current };
    fs.writeFileSync(getConfigPath(), JSON.stringify(serializable, null, 2));
}

export function getApiKey(provider?: ProviderID): string | undefined {
    const config = loadConfig();
    const p = provider ?? config.provider;

    // Check config first, then env var
    if (config.apiKeys[p]) return config.apiKeys[p];

    const providerDef = PROVIDERS.find(pr => pr.id === p);
    if (providerDef) {
        const envKey = process.env[providerDef.envVar];
        if (envKey) return envKey;
    }

    return undefined;
}

export function setApiKey(provider: ProviderID, key: string): void {
    const config = loadConfig();
    config.apiKeys[provider] = key;
    saveConfig();
}

export function setProvider(provider: ProviderID, model?: string): void {
    const providerDef = PROVIDERS.find(p => p.id === provider);
    if (!providerDef) throw new Error(`Unknown provider: ${provider}`);

    const config = loadConfig();
    config.provider = provider;
    config.model = model ?? providerDef.models[0];
    saveConfig();
}

export function getCurrentProvider(): { provider: ProviderID; model: string } {
    const config = loadConfig();
    return { provider: config.provider, model: config.model };
}
