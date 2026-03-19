/**
 * Configuration store - Persists API keys, provider selection, and settings.
 * Uses a JSON file in ~/.config/velix/config.json
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PROVIDERS } from '../services/ai/types.js';
import { SPECIALIST_ROLES } from '../services/swarm/types.js';
export const DEFAULT_SWARM_SETTINGS = {
    maxAgents: 5,
    maxRuntime: 600000,
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
const DEFAULT_CONFIG = {
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    apiKeys: {},
    swarm: { ...DEFAULT_SWARM_SETTINGS },
    theme: 'default',
};
function getConfigDir() {
    return path.join(os.homedir(), '.config', 'velix');
}
function getConfigPath() {
    return path.join(getConfigDir(), 'config.json');
}
let _config = null;
export function loadConfig() {
    if (_config)
        return _config;
    const configPath = getConfigPath();
    try {
        if (fs.existsSync(configPath)) {
            const raw = fs.readFileSync(configPath, 'utf-8');
            const loaded = JSON.parse(raw);
            _config = { ...DEFAULT_CONFIG, ...loaded, swarm: { ...DEFAULT_CONFIG.swarm, ...loaded.swarm } };
        }
        else {
            _config = { ...DEFAULT_CONFIG };
        }
    }
    catch {
        _config = { ...DEFAULT_CONFIG };
    }
    // Also check environment variables for API keys
    for (const provider of PROVIDERS) {
        const envKey = process.env[provider.envVar];
        if (envKey && !_config.apiKeys[provider.id]) {
            _config.apiKeys[provider.id] = envKey;
        }
    }
    return _config;
}
export function saveConfig(config) {
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
export function getApiKey(provider) {
    const config = loadConfig();
    const p = provider ?? config.provider;
    // Check config first, then env var
    if (config.apiKeys[p])
        return config.apiKeys[p];
    const providerDef = PROVIDERS.find(pr => pr.id === p);
    if (providerDef) {
        const envKey = process.env[providerDef.envVar];
        if (envKey)
            return envKey;
    }
    return undefined;
}
export function setApiKey(provider, key) {
    const config = loadConfig();
    config.apiKeys[provider] = key;
    saveConfig();
}
export function setProvider(provider, model) {
    const providerDef = PROVIDERS.find(p => p.id === provider);
    if (!providerDef)
        throw new Error(`Unknown provider: ${provider}`);
    const config = loadConfig();
    config.provider = provider;
    config.model = model ?? providerDef.models[0];
    saveConfig();
}
export function getCurrentProvider() {
    const config = loadConfig();
    return { provider: config.provider, model: config.model };
}
//# sourceMappingURL=store.js.map