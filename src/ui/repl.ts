/**
 * VelixREPL - Interactive terminal REPL with slash commands, AI chat, and swarm mode.
 * This is the main user-facing interface, similar to Claude Code.
 */

import readline from 'node:readline';
import path from 'node:path';
import { sendMessage } from '../services/ai/engine.js';
import {
    loadConfig, saveConfig, getApiKey, setApiKey, DEFAULT_SWARM_SETTINGS,
    setProvider, getCurrentProvider,
} from '../config/store.js';
import { PROVIDERS, ProviderID, ChatMessage } from '../services/ai/types.js';
import { SwarmOrchestrator, SwarmCallbacks } from '../services/swarm/orchestrator.js';
import {
    readFile, writeFile, editFile, listDir, searchInFiles,
    execShell, gitStatus, gitDiff, gitLog, readProjectSources,
} from '../services/tools/index.js';
import { c, VELIX_LOGO, DIVIDER, formatProvider, renderMarkdown, formatTimestamp } from './theme.js';
import { drawInputDivider, drawInputBoxBorder, drawInputSideHint, Spinner } from './components.js';
import { printSwarmActivity, formatElapsed } from './swarm-trace.js';
import { SPECIALIST_ROLES } from '../services/swarm/types.js';

// ─── State ──────────────────────────────────────────────────

let messageHistory: ChatMessage[] = [];
let swarmMode = false;
let swarmOrchestrator: SwarmOrchestrator | null = null;
let currentAbortController: AbortController | null = null;

// ─── REPL ───────────────────────────────────────────────────

export function startREPL(): void {
    printWelcome();

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: getPrompt(),
        historySize: 200,
    });

    let promptVisible = false;
    let lastPromptCursorRows = 0;
    const readlineWithInternals = rl as readline.Interface & { _refreshLine?: () => void };
    const refreshLine = readlineWithInternals._refreshLine?.bind(rl);
    const renderPromptChrome = () => {
        drawInputSideHint(rl);
        drawInputBoxBorder(rl, swarmMode);
        lastPromptCursorRows = rl.getCursorPos().rows;
    };

    if (refreshLine) {
        readlineWithInternals._refreshLine = () => {
            refreshLine();
            renderPromptChrome();
        };
    }

    const showPrompt = () => {
        promptVisible = true;
        drawInputDivider(swarmMode);
        rl.prompt();
    };

    const redrawPrompt = () => {
        if (!promptVisible) return;
        process.stdout.write(`\x1b[${lastPromptCursorRows + 1}A\r\x1b[J`);
        drawInputDivider(swarmMode);
        if (refreshLine) {
            refreshLine();
            renderPromptChrome();
            return;
        }
        rl.prompt(true);
        renderPromptChrome();
    };

    process.stdout.on('resize', redrawPrompt);
    showPrompt();

    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) {
            showPrompt();
            return;
        }

        promptVisible = false;
        // Close the input box (plain bottom border after user submits)
        drawInputDivider(swarmMode);

        // Handle Ctrl-C during processing
        currentAbortController = new AbortController();

        try {
            if (input.startsWith('/')) {
                await handleSlashCommand(input, rl);
            } else if (swarmMode) {
                await handleSwarmInput(input);
            } else {
                await handleChat(input);
            }
        } catch (err) {
            if ((err as Error).name === 'AbortError') {
                console.log(c.yellow('\n  Interrupted.'));
            } else {
                console.log(c.red(`\n  Error: ${err}`));
            }
        }

        currentAbortController = null;
        rl.setPrompt(getPrompt());
        showPrompt();
    });

    rl.on('SIGINT', () => {
        if (currentAbortController) {
            currentAbortController.abort();
            console.log(c.yellow('\n  Interrupting...'));
        } else {
            console.log(c.gray('\n  (Use /exit to quit, Ctrl-C again to force quit)'));
            showPrompt();
        }
    });

    rl.on('close', () => {
        process.stdout.off('resize', redrawPrompt);
        console.log(c.gray('\n  Goodbye!\n'));
        process.exit(0);
    });
}

function getPrompt(): string {
    const modeTag = swarmMode ? c.boldYellow('SWARM ') : '';
    return `${modeTag}${c.purple('❯')} `;
}

function printWelcome(): void {
    console.log(VELIX_LOGO);
    console.log(`  ${c.bold('Velix AI CLI')} ${c.gray('v0.1.0')}`);
    console.log(`  ${c.gray('Multi-provider AI coding assistant with swarm orchestration')}`);
    console.log();

    const { provider, model } = getCurrentProvider();
    const apiKey = getApiKey();

    console.log(`  ${c.gray('Provider:')} ${formatProvider(provider, model)}`);
    console.log(`  ${c.gray('API Key:')}  ${apiKey ? c.green('configured') : c.red('not set — run /config')}`);
    console.log(`  ${c.gray('Project:')}  ${c.blue(process.cwd())}`);
    console.log();
    console.log(`  ${c.gray('Type a message to chat, or use slash commands:')}`);
    console.log(`  ${c.purple('/help')}  ${c.gray('Show all commands')}    ${c.purple('/swarm')}  ${c.gray('Enter swarm mode')}`);
    console.log(`  ${c.purple('/model')} ${c.gray('Switch AI model')}     ${c.purple('/config')} ${c.gray('Configure API keys')}`);
    console.log(`  ${c.purple('/swarm-setup')} ${c.gray('Tune coordinator and worker settings')}`);
    console.log();
}

// ─── Chat Handler ───────────────────────────────────────────

async function handleChat(input: string): Promise<void> {
    const config = loadConfig();
    const apiKey = getApiKey();
    if (!apiKey) {
        console.log(c.red('\n  No API key configured. Run /config to set one.'));
        return;
    }

    // Build system prompt with project context
    let system = 'You are Velix, an AI coding assistant running in a terminal CLI. Be concise and helpful. When suggesting code changes, output file paths and code blocks clearly.';

    // Add file context if referencing current project
    try {
        const sources = readProjectSources(process.cwd(), 15_000);
        const fileList = Object.keys(sources);
        if (fileList.length > 0) {
            system += `\n\nThe user is working in a project with these files:\n${fileList.slice(0, 30).join('\n')}`;
        }
    } catch { /* ignore */ }

    const spinner = new Spinner('Thinking', 'pulse');
    process.stdout.write('\n');
    spinner.start();
    const startedAt = Date.now();

    let response = '';
    try {
        response = await sendMessage({
            text: input,
            system,
            provider: config.provider,
            model: config.model,
            apiKey,
            messageHistory,
            signal: currentAbortController?.signal,
        });
    } finally {
        spinner.stop(`${c.gray('Responded in')} ${c.cyan(formatElapsed(Date.now() - startedAt))}`);
    }

    // Store in history
    messageHistory.push({ role: 'user', content: input });
    messageHistory.push({ role: 'assistant', content: response });

    // Trim history to last 20 messages
    if (messageHistory.length > 40) {
        messageHistory = messageHistory.slice(-40);
    }

    // Render response
    console.log();
    console.log(renderMarkdown(response));
    console.log();
}

// ─── Swarm Handler ──────────────────────────────────────────

async function handleSwarmInput(input: string): Promise<void> {
    if (!swarmOrchestrator) {
        const callbacks: SwarmCallbacks = {
            onLog: (msg, type) => {
                if (type === 'agent') return;
                if (type === 'info') {
                    if (msg.startsWith('Swarm task started: ')) {
                        console.log(`  ${c.boldBlue('⏺')} ${msg.replace('Swarm task started: ', '')}`);
                        return;
                    }
                    if (msg.startsWith('Phase 1:')) {
                        console.log(`  ${c.boldBlue('⏺')} Planning the task.`);
                        return;
                    }
                    if (msg.startsWith('Phase 2:')) {
                        console.log(`  ${c.boldBlue('⏺')} Executing subtasks.`);
                        return;
                    }
                    if (msg.startsWith('Phase 3:')) {
                        console.log(`  ${c.boldBlue('⏺')} Validating results.`);
                        return;
                    }
                }

                const prefix = type === 'warn'
                    ? c.yellow(' !')
                    : type === 'error'
                        ? c.red(' ✗')
                        : type === 'success'
                            ? c.green(' ✓')
                            : '';
                if (prefix) {
                    console.log(`  ${prefix} ${msg}`);
                }
            },
            onStateChange: () => {},
            onActivity: (activity) => {
                printSwarmActivity(activity);
            },
            onAgentUpdate: (agent) => {
                if (agent.role === 'coordinator') {
                    if (agent.status === 'failed') {
                        console.log(`  ${c.red('✗')} ${c.bold('coordinator')} ${c.gray(agent.errors[0] ?? 'failed')}`);
                    }
                    return;
                }
                if (agent.status === 'working') {
                    console.log(`  ${c.purple('◆')} ${c.bold(agent.role)} ${c.gray(agent.currentTask ?? 'working')}`);
                    return;
                }
                if (agent.status === 'completed') {
                    console.log(`  ${c.green('✓')} ${c.bold(agent.role)} ${c.gray('completed')}`);
                    return;
                }
                if (agent.status === 'failed') {
                    console.log(`  ${c.red('✗')} ${c.bold(agent.role)} ${c.gray(agent.errors[0] ?? 'failed')}`);
                }
            },
            onComplete: (task) => {
                console.log();
                console.log(DIVIDER);
                console.log(`  ${c.boldGreen('Swarm Task Complete')}`);
                console.log(`  ${c.gray('Agents used:')} ${task.agents.length}`);
                console.log(`  ${c.gray('Duration:')} ${task.completedAt ? formatElapsed(task.completedAt.getTime() - task.createdAt.getTime()) : '?'}`);
                console.log(`  ${c.gray('Status:')} ${task.status === 'completed' ? c.green('SUCCESS') : c.red('FAILED')}`);
                if (task.completedAt) {
                    console.log(`  ${c.gray('✻')} ${c.gray('Crunched for')} ${c.cyan(formatElapsed(task.completedAt.getTime() - task.createdAt.getTime()))}`);
                }
                console.log(DIVIDER);
            },
        };

        swarmOrchestrator = new SwarmOrchestrator(callbacks);
    }

    console.log();
    console.log(`  ${c.boldYellow('SWARM')} ${c.gray('Orchestrating task...')}`);
    console.log(DIVIDER);

    await swarmOrchestrator.execute(input);
}

// ─── Slash Commands ─────────────────────────────────────────

async function handleSlashCommand(input: string, rl: readline.Interface): Promise<void> {
    const parts = input.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
        case '/help':
            printHelp();
            break;

        case '/exit':
        case '/quit':
            console.log(c.gray('\n  Goodbye!\n'));
            process.exit(0);

        case '/clear':
            messageHistory = [];
            console.clear();
            printWelcome();
            break;

        case '/config':
            await handleConfig(args, rl);
            break;

        case '/model':
            await handleModelSwitch(args, rl);
            break;

        case '/provider':
            await handleProviderSwitch(args, rl);
            break;

        case '/swarm':
            swarmMode = !swarmMode;
            if (swarmMode) {
                console.log();
                console.log(`  ${c.boldYellow('SWARM MODE ACTIVATED')}`);
                console.log(`  ${c.gray('Your messages will be executed as coordinated multi-agent swarm tasks.')}`);
                console.log(`  ${c.gray('A coordinator will plan, dispatch specialists, review results, and queue follow-up work.')}`);
                console.log(`  ${c.gray('Type /swarm again to return to normal chat mode.')}`);
                console.log(`  ${c.gray('Type /swarm-config to configure swarm settings.')}`);
                console.log(`  ${c.gray('Type /swarm-setup for a guided config overview.')}`);
                console.log(DIVIDER);
            } else {
                swarmOrchestrator = null;
                console.log(`\n  ${c.gray('Swarm mode deactivated. Back to normal chat.')}`);
            }
            break;

        case '/swarm-setup':
            printSwarmSetup();
            break;

        case '/swarm-config':
            handleSwarmConfig(args);
            break;

        case '/swarm-stop':
            if (swarmOrchestrator) {
                swarmOrchestrator.abort();
                console.log(c.red('\n  Swarm emergency stop triggered.'));
            } else {
                console.log(c.gray('\n  No active swarm session.'));
            }
            break;

        case '/status':
            printStatus();
            break;

        case '/files':
            handleFiles(args);
            break;

        case '/search':
            handleSearch(args);
            break;

        case '/shell':
        case '/sh':
            handleShell(args);
            break;

        case '/git':
            handleGit(args);
            break;

        case '/read':
            handleRead(args);
            break;

        case '/history':
            printHistory();
            break;

        case '/compact':
            compactHistory();
            break;

        case '/init':
            handleInit();
            break;

        default:
            console.log(c.yellow(`\n  Unknown command: ${cmd}. Type /help for available commands.`));
    }
}

function printHelp(): void {
    console.log(`
${c.boldPurple('  Velix CLI Commands')}
${DIVIDER}

  ${c.bold('Chat & AI')}
    ${c.purple('/model')}  [model]        ${c.gray('Switch AI model')}
    ${c.purple('/provider')} [provider]   ${c.gray('Switch AI provider')}
    ${c.purple('/config')}                ${c.gray('Configure API keys')}
    ${c.purple('/clear')}                 ${c.gray('Clear conversation history')}
    ${c.purple('/history')}               ${c.gray('Show conversation history')}
    ${c.purple('/compact')}               ${c.gray('Summarize and compact history')}

  ${c.bold('Swarm Mode')}
    ${c.purple('/swarm')}                 ${c.gray('Toggle swarm mode on/off')}
    ${c.purple('/swarm-setup')}           ${c.gray('Show coordinator/team setup guidance')}
    ${c.purple('/swarm-config')}          ${c.gray('Configure swarm settings')}
    ${c.purple('/swarm-stop')}            ${c.gray('Emergency stop all agents')}

  ${c.bold('Tools')}
    ${c.purple('/files')}                 ${c.gray('List project files')}
    ${c.purple('/search')} <pattern>      ${c.gray('Search in project files')}
    ${c.purple('/read')} <file>           ${c.gray('Read a file')}
    ${c.purple('/shell')} <command>       ${c.gray('Execute a shell command')}
    ${c.purple('/git')} [status|log|diff] ${c.gray('Git operations')}
    ${c.purple('/init')}                  ${c.gray('Show setup guide')}

  ${c.bold('General')}
    ${c.purple('/status')}                ${c.gray('Show current configuration')}
    ${c.purple('/help')}                  ${c.gray('Show this help')}
    ${c.purple('/exit')}                  ${c.gray('Quit Velix CLI')}
`);
}

async function handleConfig(args: string[], rl: readline.Interface): Promise<void> {
    if (args.length >= 2) {
        // Direct set: /config <provider> <key>
        const provider = args[0] as ProviderID;
        const key = args[1];
        if (!PROVIDERS.find(p => p.id === provider)) {
            console.log(c.red(`\n  Unknown provider: ${provider}`));
            console.log(c.gray(`  Available: ${PROVIDERS.map(p => p.id).join(', ')}`));
            return;
        }
        setApiKey(provider, key);
        console.log(c.green(`\n  API key saved for ${provider}.`));
        return;
    }

    console.log(`\n${c.bold('  API Key Configuration')}`);
    console.log(DIVIDER);
    for (const provider of PROVIDERS) {
        const key = getApiKey(provider.id);
        const status = key ? c.green('✓ configured') : c.red('✗ not set');
        const envHint = c.gray(`(env: ${provider.envVar})`);
        console.log(`  ${c.bold(provider.name.padEnd(25))} ${status}  ${envHint}`);
    }
    console.log();
    console.log(`  ${c.gray('Set a key: /config <provider> <api-key>')}`);
    console.log(`  ${c.gray('Or set environment variables listed above.')}`);
    console.log(`  ${c.gray(`Example: /config claude sk-ant-api...`)}`);
}

async function handleModelSwitch(args: string[], rl: readline.Interface): Promise<void> {
    const { provider } = getCurrentProvider();
    const providerDef = PROVIDERS.find(p => p.id === provider)!;

    if (args.length > 0) {
        const model = args[0];
        saveConfig({ model });
        console.log(c.green(`\n  Switched to model: ${model}`));
        return;
    }

    console.log(`\n${c.bold(`  Available models for ${providerDef.name}:`)}`);
    const config = loadConfig();
    for (const model of providerDef.models) {
        const current = model === config.model ? c.green(' (current)') : '';
        console.log(`    ${c.cyan(model)}${current}`);
    }
    console.log(`\n  ${c.gray('Usage: /model <model-name>')}`);
}

async function handleProviderSwitch(args: string[], rl: readline.Interface): Promise<void> {
    if (args.length > 0) {
        const providerId = args[0] as ProviderID;
        try {
            setProvider(providerId, args[1]);
            const { provider, model } = getCurrentProvider();
            console.log(c.green(`\n  Switched to ${formatProvider(provider, model)}`));
        } catch (err) {
            console.log(c.red(`\n  ${err}`));
            console.log(c.gray(`  Available: ${PROVIDERS.map(p => p.id).join(', ')}`));
        }
        return;
    }

    console.log(`\n${c.bold('  Available AI Providers:')}`);
    const config = loadConfig();
    for (const p of PROVIDERS) {
        const current = p.id === config.provider ? c.green(' (current)') : '';
        const hasKey = getApiKey(p.id) ? c.green('✓') : c.red('✗');
        console.log(`    ${hasKey} ${c.bold(p.id.padEnd(12))} ${c.gray(p.name)}${current}`);
    }
    console.log(`\n  ${c.gray('Usage: /provider <provider-id>')}`);
}

type SwarmSettings = ReturnType<typeof loadConfig>['swarm'];
type SwarmSettingKey = keyof SwarmSettings;

const SWARM_SETTING_HELP: Array<{ key: SwarmSettingKey; description: string; example: string }> = [
    { key: 'strategy', description: 'Team planning style: fast, balanced, or thorough', example: 'balanced' },
    { key: 'maxAgents', description: 'Maximum worker agents running at once', example: '4' },
    { key: 'maxRuntime', description: 'Total swarm runtime budget in milliseconds', example: '600000' },
    { key: 'maxStepsPerAgent', description: 'Maximum tool-loop steps each worker can take', example: '12' },
    { key: 'maxFollowUpTasks', description: 'Maximum extra tasks the coordinator can add after reviews', example: '6' },
    { key: 'safeMode', description: 'Preview-oriented mode that blocks risky execution', example: 'true' },
    { key: 'autoApplyChanges', description: 'Apply write/edit actions automatically', example: 'true' },
    { key: 'allowShell', description: 'Allow workers to run shell commands', example: 'true' },
    { key: 'coordinatorReview', description: 'Let the coordinator review each worker batch and add follow-up work', example: 'true' },
    { key: 'validateBuild', description: 'Run build validation after swarm execution', example: 'true' },
    { key: 'validateTests', description: 'Run test validation after swarm execution', example: 'false' },
    { key: 'specialistRoles', description: 'Comma-separated worker roles the coordinator can assign', example: 'implementer,tester,reviewer,debugger' },
    { key: 'plannerModel', description: 'Override model used for the planning pass', example: 'claude-sonnet-4-6' },
    { key: 'coordinatorModel', description: 'Override model used by the coordinator review pass', example: 'claude-sonnet-4-6' },
    { key: 'workerModel', description: 'Override model used by worker agents', example: 'claude-sonnet-4-6' },
    { key: 'buildCommand', description: 'Override the build validation command', example: 'npm run build' },
    { key: 'testCommand', description: 'Override the test validation command', example: 'npm test' },
    { key: 'dryRunMode', description: 'Never apply file changes, only simulate them', example: 'false' },
    { key: 'workerCLI', description: 'Reserved worker backend label for future external workers', example: 'claude' },
];

function parseBoolean(value: string): boolean | null {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return null;
}

function parseSpecialistRoles(value: string): SwarmSettings['specialistRoles'] | null {
    const roles = value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
    if (roles.length === 0) return null;
    if (!roles.every(role => SPECIALIST_ROLES.includes(role as typeof SPECIALIST_ROLES[number]))) {
        return null;
    }
    return Array.from(new Set(roles)) as SwarmSettings['specialistRoles'];
}

function formatSwarmSettingValue(value: unknown): string {
    if (Array.isArray(value)) return value.join(', ');
    if (value === '') return '(auto)';
    return String(value);
}

function printSwarmSetup(): void {
    const config = loadConfig();
    console.log(`\n${c.bold('  Swarm Setup')}`);
    console.log(DIVIDER);
    console.log(`  ${c.gray('Controller:')} ${c.bold('You')}`);
    console.log(`  ${c.gray('Coordinator:')} ${c.cyan('Plans the task, dispatches specialists, reviews results, and decides follow-up work')}`);
    console.log(`  ${c.gray('Workers:')} ${c.cyan('Implementer, tester, reviewer, debugger, architect, refactorer, documenter')}`);
    console.log();
    console.log(`  ${c.gray('Current strategy:')} ${c.cyan(config.swarm.strategy)}`);
    console.log(`  ${c.gray('Current specialists:')} ${c.cyan(config.swarm.specialistRoles.join(', '))}`);
    console.log(`  ${c.gray('Max workers at once:')} ${c.cyan(String(config.swarm.maxAgents))}`);
    console.log(`  ${c.gray('Coordinator follow-up cap:')} ${c.cyan(String(config.swarm.maxFollowUpTasks))}`);
    console.log(`  ${c.gray('Current worker model:')} ${c.cyan(config.swarm.workerModel || '(inherits main model)')}`);
    console.log(`  ${c.gray('Current coordinator model:')} ${c.cyan(config.swarm.coordinatorModel || '(inherits main model)')}`);
    console.log(`  ${c.gray('Build validation command:')} ${c.cyan(config.swarm.buildCommand || '(auto: npm run build if available)')}`);
    console.log(`  ${c.gray('Test validation command:')} ${c.cyan(config.swarm.testCommand || '(auto: npm test if available)')}`);
    console.log();
    console.log(`  ${c.bold('Recommended starter profile')}`);
    console.log(`    ${c.cyan('/swarm-config strategy balanced')}`);
    console.log(`    ${c.cyan('/swarm-config maxAgents 4')}`);
    console.log(`    ${c.cyan('/swarm-config maxFollowUpTasks 6')}`);
    console.log(`    ${c.cyan('/swarm-config specialistRoles implementer,tester,reviewer,debugger')}`);
    console.log(`    ${c.cyan('/swarm-config coordinatorReview true')}`);
    console.log(`    ${c.cyan('/swarm-config validateBuild true')}`);
    console.log(`    ${c.cyan('/swarm-config autoApplyChanges true')}`);
    console.log();
    console.log(`  ${c.bold('All swarm settings')}`);
    for (const item of SWARM_SETTING_HELP) {
        console.log(`    ${c.purple(item.key.padEnd(18))} ${c.gray(item.description)} ${c.dim(`(example: ${item.example})`)}`);
    }
    console.log();
    console.log(`  ${c.gray('Use /swarm-config <key> <value> to change a setting, or /swarm-config reset to restore defaults.')}`);
}

function handleSwarmConfig(args: string[]): void {
    const config = loadConfig();

    if (args[0] === 'reset') {
        config.swarm = { ...DEFAULT_SWARM_SETTINGS };
        saveConfig(config);
        swarmOrchestrator = null;
        console.log(c.green('\n  Swarm config reset to defaults.'));
        return;
    }

    if (args.length >= 2) {
        const key = args[0] as SwarmSettingKey;
        const rawValue = args.slice(1).join(' ');

        if (!SWARM_SETTING_HELP.some(item => item.key === key)) {
            console.log(c.red(`\n  Unknown setting: ${key}`));
            console.log(c.gray('  Type /swarm-config to list valid settings.'));
            return;
        }

        switch (key) {
            case 'maxAgents':
            case 'maxRuntime':
            case 'maxStepsPerAgent':
            case 'maxFollowUpTasks': {
                const numeric = parseInt(rawValue, 10);
                if (!Number.isFinite(numeric) || numeric <= 0) {
                    console.log(c.red(`\n  ${key} must be a positive number.`));
                    return;
                }
                config.swarm[key] = numeric as never;
                break;
            }
            case 'safeMode':
            case 'autoApplyChanges':
            case 'allowShell':
            case 'coordinatorReview':
            case 'validateBuild':
            case 'validateTests':
            case 'dryRunMode': {
                const parsed = parseBoolean(rawValue);
                if (parsed == null) {
                    console.log(c.red(`\n  ${key} must be true or false.`));
                    return;
                }
                config.swarm[key] = parsed as never;
                break;
            }
            case 'strategy':
                if (!['fast', 'balanced', 'thorough'].includes(rawValue)) {
                    console.log(c.red(`\n  strategy must be one of: fast, balanced, thorough.`));
                    return;
                }
                config.swarm.strategy = rawValue as SwarmSettings['strategy'];
                break;
            case 'specialistRoles': {
                const parsed = parseSpecialistRoles(rawValue);
                if (!parsed) {
                    console.log(c.red(`\n  specialistRoles must be a comma-separated list from: ${SPECIALIST_ROLES.join(', ')}`));
                    return;
                }
                config.swarm.specialistRoles = parsed;
                break;
            }
            case 'plannerModel':
            case 'coordinatorModel':
            case 'workerModel':
            case 'workerCLI':
            case 'buildCommand':
            case 'testCommand':
                config.swarm[key] = rawValue as never;
                break;
        }

        saveConfig(config);
        swarmOrchestrator = null;
        console.log(c.green(`\n  Swarm config updated: ${key} = ${rawValue}`));
        return;
    }

    console.log(`\n${c.bold('  Swarm Configuration')}`);
    console.log(DIVIDER);
    for (const item of SWARM_SETTING_HELP) {
        const value = formatSwarmSettingValue(config.swarm[item.key]);
        console.log(`  ${c.gray(item.key + ':')} ${c.cyan(value)} ${c.gray(`— ${item.description}`)}`);
    }
    console.log();
    console.log(`  ${c.gray('Usage: /swarm-config <key> <value>')}`);
    console.log(`  ${c.gray('Reset defaults: /swarm-config reset')}`);
    console.log(`  ${c.gray(`Valid specialist roles: ${SPECIALIST_ROLES.join(', ')}`)}`);
}

function printStatus(): void {
    const { provider, model } = getCurrentProvider();
    const config = loadConfig();

    console.log(`\n${c.bold('  Velix Status')}`);
    console.log(DIVIDER);
    console.log(`  ${c.gray('Provider:')}    ${formatProvider(provider, model)}`);
    console.log(`  ${c.gray('API Key:')}     ${getApiKey() ? c.green('configured') : c.red('not set')}`);
    console.log(`  ${c.gray('Project:')}     ${c.blue(process.cwd())}`);
    console.log(`  ${c.gray('Swarm Mode:')}  ${swarmMode ? c.yellow('ON') : c.gray('OFF')}`);
    console.log(`  ${c.gray('Swarm Team:')}  ${c.cyan(`${config.swarm.strategy} · ${config.swarm.maxAgents} workers max · ${config.swarm.coordinatorReview ? 'coordinator review on' : 'coordinator review off'}`)}`);
    console.log(`  ${c.gray('Specialists:')} ${c.cyan(config.swarm.specialistRoles.join(', '))}`);
    console.log(`  ${c.gray('Swarm Safety:')} ${c.cyan(`${config.swarm.safeMode ? 'safe mode' : 'live mode'} · apply=${config.swarm.autoApplyChanges} · shell=${config.swarm.allowShell}`)}`);
    console.log(`  ${c.gray('Validation:')}  ${c.cyan(`build=${config.swarm.validateBuild ? (config.swarm.buildCommand || 'auto') : 'off'} · test=${config.swarm.validateTests ? (config.swarm.testCommand || 'auto') : 'off'}`)}`);
    console.log(`  ${c.gray('History:')}     ${messageHistory.length} messages`);

    // Configured providers
    const configured = PROVIDERS.filter(p => getApiKey(p.id));
    console.log(`  ${c.gray('Providers:')}   ${configured.map(p => c.green(p.id)).join(', ') || c.red('none')}`);
}

function handleFiles(args: string[]): void {
    const dir = args[0] || process.cwd();
    try {
        const files = listDir(dir);
        console.log(`\n  ${c.bold('Files in')} ${c.blue(dir)}`);
        for (const file of files) {
            const icon = file.endsWith('/') ? c.blue('📁') : c.gray('  ');
            console.log(`  ${icon} ${file}`);
        }
    } catch (err) {
        console.log(c.red(`\n  Error: ${err}`));
    }
}

function handleSearch(args: string[]): void {
    if (args.length === 0) {
        console.log(c.gray('\n  Usage: /search <pattern>'));
        return;
    }

    const pattern = args.join(' ');
    console.log(c.gray(`\n  Searching for "${pattern}"...`));

    const matches = searchInFiles(process.cwd(), pattern, 20);
    if (matches.length === 0) {
        console.log(c.yellow('  No matches found.'));
        return;
    }

    for (const match of matches) {
        console.log(`  ${c.blue(match.file)}${c.gray(`:${match.line}:${match.column}`)}  ${match.text.trim().slice(0, 80)}`);
    }
    console.log(c.gray(`\n  ${matches.length} match(es) found`));
}

function handleShell(args: string[]): void {
    if (args.length === 0) {
        console.log(c.gray('\n  Usage: /shell <command>'));
        return;
    }

    const command = args.join(' ');
    console.log(c.gray(`\n  $ ${command}`));
    const result = execShell(command, process.cwd());
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.log(c.red(result.stderr));
    if (result.exitCode !== 0) {
        console.log(c.yellow(`  Exit code: ${result.exitCode}`));
    }
}

function handleGit(args: string[]): void {
    const subcmd = args[0] || 'status';
    switch (subcmd) {
        case 'status':
            console.log(`\n${c.bold('  Git Status')}`);
            console.log(gitStatus(process.cwd()) || c.green('  Clean working tree'));
            break;
        case 'log':
            console.log(`\n${c.bold('  Git Log')}`);
            console.log(gitLog(process.cwd(), parseInt(args[1]) || 10));
            break;
        case 'diff':
            console.log(`\n${c.bold('  Git Diff')}`);
            const diff = gitDiff(process.cwd(), args[1] === '--staged');
            console.log(diff || c.gray('  No changes'));
            break;
        default:
            // Pass through as git command
            const result = execShell(`git ${args.join(' ')}`, process.cwd());
            if (result.stdout) console.log(result.stdout);
            if (result.stderr) console.log(c.red(result.stderr));
    }
}

function handleRead(args: string[]): void {
    if (args.length === 0) {
        console.log(c.gray('\n  Usage: /read <file-path>'));
        return;
    }

    const filePath = path.resolve(process.cwd(), args[0]);
    try {
        const content = readFile(filePath);
        const ext = path.extname(filePath).slice(1);
        console.log(`\n${c.gray(`  ┌─ ${args[0]} ` + '─'.repeat(Math.max(0, 50 - args[0].length)))}`);
        const lines = content.split('\n');
        for (let i = 0; i < Math.min(lines.length, 100); i++) {
            console.log(`${c.gray(`  │ ${String(i + 1).padStart(4)} `)}${lines[i]}`);
        }
        if (lines.length > 100) {
            console.log(c.gray(`  │ ... (${lines.length - 100} more lines)`));
        }
        console.log(c.gray('  └' + '─'.repeat(55)));
    } catch (err) {
        console.log(c.red(`\n  Error reading file: ${err}`));
    }
}

function printHistory(): void {
    if (messageHistory.length === 0) {
        console.log(c.gray('\n  No conversation history.'));
        return;
    }

    console.log(`\n${c.bold('  Conversation History')} ${c.gray(`(${messageHistory.length} messages)`)}`);
    console.log(DIVIDER);
    for (const msg of messageHistory.slice(-20)) {
        const role = msg.role === 'user' ? c.blue('you') : c.purple('velix');
        const preview = msg.content.slice(0, 100).replace(/\n/g, ' ');
        console.log(`  ${role}: ${c.gray(preview)}${msg.content.length > 100 ? '...' : ''}`);
    }
}

function compactHistory(): void {
    if (messageHistory.length <= 4) {
        console.log(c.gray('\n  History is already compact.'));
        return;
    }

    // Keep last 4 messages, summarize the rest
    const kept = messageHistory.slice(-4);
    const dropped = messageHistory.length - 4;
    messageHistory = kept;
    console.log(c.green(`\n  Compacted history: dropped ${dropped} older messages, kept last 4.`));
}

function handleInit(): void {
    console.log(`
${c.boldPurple('  Getting Started with Velix CLI')}
${DIVIDER}

  ${c.bold('1. Configure an API key:')}
     ${c.cyan('/config claude sk-ant-api03-...')}
     ${c.gray('Or set env: export ANTHROPIC_API_KEY=sk-...')}

  ${c.bold('2. Switch providers:')}
     ${c.cyan('/provider chatgpt')}
     ${c.cyan('/model gpt-4o')}

  ${c.bold('3. Start chatting:')}
     ${c.gray('Just type your message and press Enter.')}

  ${c.bold('4. Use swarm mode for complex tasks:')}
     ${c.cyan('/swarm')}
     ${c.gray('Then describe a multi-step task.')}
     ${c.gray('Agents will plan, implement, test, and review.')}

  ${c.bold('Available Providers:')}
${PROVIDERS.map(p => `     ${c.cyan(p.id.padEnd(12))} ${c.gray(p.name)}`).join('\n')}
`);
}
