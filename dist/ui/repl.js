/**
 * Velix REPL - Clean terminal UI like Claude Code.
 */
import readline from 'node:readline';
import path from 'node:path';
import { sendMessage } from '../services/ai/engine.js';
import { loadConfig, saveConfig, getApiKey, setApiKey, DEFAULT_SWARM_SETTINGS, DEFAULT_CONFIG, setProvider, getCurrentProvider, } from '../config/store.js';
import { PROVIDERS } from '../services/ai/types.js';
import { SwarmOrchestrator } from '../services/swarm/orchestrator.js';
import { readFile, listDir, searchInFiles, execShell, gitStatus, gitDiff, gitLog, readProjectSources, } from '../services/tools/index.js';
import { c, formatProvider, renderMarkdown } from './theme.js';
import { Spinner, divider, getWidth, printUserMessage, section, stripAnsi } from './components.js';
import { printSwarmActivity, formatElapsed } from './swarm-trace.js';
let messageHistory = [];
let swarmMode = false;
let swarmOrchestrator = null;
let currentAbortController = null;
let completionMode = 'build';
let autoApply = true;
let approvalMode = true; // Ask before editing/writing files
// ─── Yes/No Prompt ───────────────────────────────────────────
async function promptYesNo(question, rl) {
    return new Promise((resolve) => {
        let selected = 0;
        const options = ['Yes', 'No'];
        const render = () => {
            process.stdout.write('\r\x1b[2K'); // Clear line
            process.stdout.write(`  ${question}\n`);
            for (let i = 0; i < options.length; i++) {
                const arrow = i === selected ? c.green('▶') : ' ';
                const highlight = i === selected ? c.bold : (s) => s;
                console.log(`    ${arrow} ${highlight(options[i])}`);
            }
            process.stdout.write('\r');
        };
        render();
        const handler = (ch, key) => {
            if (key.name === 'up' || key.name === 'k') {
                selected = (selected - 1 + options.length) % options.length;
                render();
            }
            else if (key.name === 'down' || key.name === 'j') {
                selected = (selected + 1) % options.length;
                render();
            }
            else if (key.name === 'enter') {
                process.stdin.off('keypress', handler);
                process.stdout.write('\x1b[2K\r'); // Clear prompts
                resolve(selected === 0);
            }
            else if (key.name === 'escape' || key.name === 'q') {
                process.stdin.off('keypress', handler);
                process.stdout.write('\x1b[2K\r');
                resolve(false); // Default to No on cancel
            }
        };
        process.stdin.on('keypress', handler);
    });
}
// ─── Approval Handler ─────────────────────────────────────────
async function checkApproval(action, target, rl) {
    if (!approvalMode)
        return true;
    const question = `${action} ${c.cyan(target)}?`;
    return promptYesNo(question, rl);
}
// ─── REPL ───────────────────────────────────────────────────
export function startREPL() {
    printWelcome();
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: getPrompt(),
        historySize: 200,
    });
    rl.on('line', async (input) => {
        const trimmed = input.trim();
        if (!trimmed) {
            rl.prompt();
            return;
        }
        // User message
        printUserMessage(trimmed);
        console.log(divider('light'));
        // Handle Ctrl-C during processing
        currentAbortController = new AbortController();
        try {
            if (trimmed.startsWith('/')) {
                await handleSlashCommand(trimmed, rl);
            }
            else if (swarmMode) {
                await handleSwarmInput(trimmed);
            }
            else {
                await handleChat(trimmed, rl);
            }
        }
        catch (err) {
            if (err.name === 'AbortError') {
                console.log(c.yellow('\n  Interrupted.'));
            }
            else {
                console.log(c.red(`\n  Error: ${err}`));
            }
        }
        currentAbortController = null;
        rl.setPrompt(getPrompt());
        rl.prompt();
    });
    rl.on('SIGINT', () => {
        if (currentAbortController) {
            currentAbortController.abort();
            console.log(c.yellow('\n  Interrupting...'));
        }
        else {
            console.log(c.gray('\n  (Use /exit to quit)'));
            rl.prompt();
        }
    });
    rl.on('close', () => {
        console.log(c.gray('\n  Goodbye!\n'));
        process.exit(0);
    });
    // Tab to cycle completion modes
    process.stdin.on('keypress', (_ch, key) => {
        if (key && key.name === 'tab') {
            const modes = ['build', 'plan', 'debug'];
            const idx = modes.indexOf(completionMode);
            completionMode = modes[(idx + 1) % modes.length];
            rl.setPrompt(getPrompt());
            rl.prompt(true);
        }
    });
    rl.prompt();
}
function getPrompt() {
    const prefix = swarmMode ? c.boldYellow('◆') : c.purple('❯');
    return `${prefix} `;
}
function printFooter() {
    console.log(divider('light'));
    console.log(c.dim('  ? for shortcuts') + c.gray('                              ') + c.dim('Use meta+t to toggle thinking'));
    console.log(); // Bottom margin
    console.log(); // Bottom margin
    console.log(); // Bottom margin
}
// ═══════════════════════════════════════════════════════════════
// Welcome Box - Claude Code style
// ═══════════════════════════════════════════════════════════════
const BOX = {
    tl: '╭', tr: '╮', bl: '╰', br: '╯',
    h: '─', v: '│',
};
function printWelcome() {
    const { provider, model } = getCurrentProvider();
    const width = getWidth();
    const innerWidth = Math.max(60, width - 2);
    // Single column centered layout
    const lines = [
        '',
        '                 Welcome back!                 ',
        '',
        '      ██╗   ██╗███████╗██╗     ██╗██╗  ██╗      ',
        '      ██║   ██║██╔════╝██║     ██║╚██╗██╔╝      ',
        '      ██║   ██║█████╗  ██║     ██║ ╚███╔╝       ',
        '      ╚██╗ ██╔╝██╔══╝  ██║     ██║ ██╔██╗       ',
        '       ╚████╔╝ ███████╗███████╗██║██╔╝ ██╗      ',
        '        ╚═══╝  ╚══════╝╚══════╝╚═╝╚═╝  ╚═╝      ',
        '',
        `                  ${c.boldCyan('Velix')}                   `,
        `               ${c.gray(model)}               `,
        `       ${c.blue('~' + process.cwd().replace(process.env.HOME || '/', ''))}       `,
        '',
    ];
    // Top border with title
    const title = c.bold(' Velix CLI ');
    const titleLen = stripAnsi(title);
    const leftBar = innerWidth - titleLen;
    const leftChars = Math.floor(leftBar / 2);
    const rightChars = leftBar - leftChars;
    console.log(c.gray(BOX.tl + BOX.h.repeat(leftChars) + title + BOX.h.repeat(rightChars) + BOX.tr));
    for (const line of lines) {
        const len = stripAnsi(line);
        const pad = Math.max(0, innerWidth - len);
        const left = Math.floor(pad / 2);
        const right = pad - left;
        console.log(c.gray(BOX.v) + ' '.repeat(left) + line + ' '.repeat(right) + c.gray(BOX.v));
    }
    // Bottom border
    console.log(c.gray(BOX.bl + BOX.h.repeat(innerWidth) + BOX.br));
    console.log();
}
// ─── Chat ───────────────────────────────────────────────────
async function handleChat(input, rl) {
    const config = loadConfig();
    const apiKey = getApiKey();
    if (!apiKey) {
        console.log(c.red('\n  No API key configured. Run /config to set one.'));
        return;
    }
    let system = `You are Velix, an expert AI coding assistant in a terminal.
Be concise and direct. Use code blocks with file paths for changes.
Working directory: ${process.cwd()}

Current mode: ${completionMode}
- build: Implement features, write code, run tests
- plan: Analyze and plan approach, don't make changes
- debug: Find and fix bugs, add logging

${approvalMode
        ? 'APPROVAL REQUIRED: When you want to edit a file or run a shell command, ask first using: [CONFIRM] Should I <action>? Then wait for user confirmation before proceeding.'
        : 'No approval required - proceed with edits automatically.'}`;
    // Get project context
    try {
        const sources = readProjectSources(process.cwd(), 15_000);
        const fileList = Object.keys(sources);
        if (fileList.length > 0) {
            system += `\n\nProject files:\n${fileList.slice(0, 30).join('\n')}`;
        }
    }
    catch { /* ignore */ }
    const spinner = new Spinner('Thinking');
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
    }
    finally {
        spinner.stop(`${c.gray('Responded in')} ${c.cyan(formatElapsed(Date.now() - startedAt))}`);
    }
    // Store in history
    if (response) {
        messageHistory.push({ role: 'user', content: input });
        messageHistory.push({ role: 'assistant', content: response });
    }
    // Trim history
    if (messageHistory.length > 40) {
        messageHistory = messageHistory.slice(-40);
    }
    // Print response
    console.log();
    console.log(renderMarkdown(response));
    // Check for confirmation requests and handle them
    if (approvalMode) {
        const confirmMatch = response.match(/\[CONFIRM\](.+?)(?:\n|$)/i);
        if (confirmMatch) {
            const question = confirmMatch[1].trim();
            const approved = await promptYesNo(question, rl);
            if (approved) {
                console.log(c.green('\n  ✓ Approved - continuing...\n'));
                // Continue with the action - send a follow-up to the AI
                const followUp = await sendMessage({
                    text: 'User approved. Please proceed with the action you planned.',
                    system,
                    provider: config.provider,
                    model: config.model,
                    apiKey,
                    messageHistory: [...messageHistory, { role: 'user', content: input }, { role: 'assistant', content: response }],
                    signal: currentAbortController?.signal,
                });
                console.log();
                console.log(renderMarkdown(followUp));
            }
            else {
                console.log(c.yellow('\n  ✗ Denied - cancelled.\n'));
            }
        }
    }
    printFooter();
}
// ─── Swarm ──────────────────────────────────────────────────
async function handleSwarmInput(input) {
    if (!swarmOrchestrator) {
        const callbacks = {
            onLog: (msg, type) => {
                if (type === 'agent')
                    return;
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
                const prefix = type === 'warn' ? c.yellow(' !')
                    : type === 'error' ? c.red(' ✗')
                        : type === 'success' ? c.green(' ✓')
                            : '';
                if (prefix)
                    console.log(`  ${prefix} ${msg}`);
            },
            onStateChange: () => { },
            onActivity: (activity) => printSwarmActivity(activity),
            onAgentUpdate: (agent) => {
                if (agent.role === 'coordinator') {
                    if (agent.status === 'failed') {
                        console.log(`  ${c.red('✗')} ${c.bold('coordinator')} ${c.gray(agent.errors[0] ?? 'failed')}`);
                    }
                    return;
                }
                if (agent.status === 'working') {
                    console.log(`  ${c.yellow('◆')} ${c.bold(agent.role)} ${c.gray(agent.currentTask ?? 'working')}`);
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
                console.log(divider('dotted'));
                console.log(`  ${c.boldGreen('Swarm Task Complete')}`);
                console.log(`  ${c.gray('Agents:')} ${task.agents.length}`);
                console.log(`  ${c.gray('Duration:')} ${task.completedAt ? formatElapsed(task.completedAt.getTime() - task.createdAt.getTime()) : '?'}`);
                console.log(`  ${c.gray('Status:')} ${task.status === 'completed' ? c.green('SUCCESS') : c.red('FAILED')}`);
                console.log(divider('dotted'));
            },
        };
        swarmOrchestrator = new SwarmOrchestrator(callbacks);
    }
    console.log();
    console.log(`  ${c.boldYellow('SWARM')} ${c.gray('Orchestrating task...')}`);
    console.log(divider('light'));
    await swarmOrchestrator.execute(input);
}
// ─── Slash commands ──────────────────────────────────────────
async function handleSlashCommand(input, rl) {
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
            await handleConfig(args);
            break;
        case '/model':
            await handleModelSwitch(args);
            break;
        case '/provider':
            await handleProviderSwitch(args);
            break;
        case '/swarm':
            swarmMode = !swarmMode;
            rl.setPrompt(getPrompt());
            if (swarmMode) {
                console.log();
                console.log(`  ${c.boldYellow('SWARM MODE')} ${c.gray('activated')}`);
                console.log(`  ${c.gray('Your messages will be executed as coordinated multi-agent tasks.')}`);
                console.log(divider('light'));
            }
            else {
                swarmOrchestrator = null;
                console.log(`  ${c.gray('Swarm mode deactivated.')}`);
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
                console.log(c.red('\n  Swarm stopped.'));
            }
            else {
                console.log(c.gray('\n  No active swarm session.'));
            }
            break;
        case '/agents':
            printAgents();
            break;
        case '/status':
            printStatus();
            break;
        case '/reset':
            saveConfig(DEFAULT_CONFIG);
            console.log(c.green('\n  Config reset to defaults.'));
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
        case '/auto-apply':
            autoApply = !autoApply;
            console.log(c.green(`\n  Auto-apply: ${autoApply ? 'ON' : 'OFF'}`));
            if (!autoApply) {
                console.log(c.gray('  AI will ask for permission before applying changes.'));
            }
            else {
                console.log(c.gray('  AI will apply changes automatically.'));
            }
            break;
        case '/approval':
            approvalMode = !approvalMode;
            console.log(c.green(`\n  Approval mode: ${approvalMode ? 'ON' : 'OFF'}`));
            if (approvalMode) {
                console.log(c.gray('  AI will ask before editing files or running commands.'));
            }
            else {
                console.log(c.gray('  AI will run commands without asking.'));
            }
            break;
        case '/mode':
            if (args.length > 0) {
                const mode = args[0];
                if (['build', 'plan', 'debug'].includes(mode)) {
                    completionMode = mode;
                    console.log(c.green(`\n  Mode: ${completionMode}`));
                }
                else {
                    console.log(c.red('\n  Invalid mode. Use: build, plan, or debug'));
                }
            }
            else {
                console.log(c.gray(`\n  Current mode: ${completionMode}`));
                console.log(c.gray('  Use /mode <build|plan|debug> to switch'));
                console.log(c.gray('  Or press Tab to cycle through modes'));
            }
            break;
        default:
            console.log(c.yellow(`\n  Unknown command: ${cmd}. Type /help for available commands.`));
    }
}
function printHelp() {
    console.log(`
${c.boldPurple('  Velix CLI Commands')}
${divider('light')}

${c.bold('Chat & AI')}
  ${c.purple('/model')}      Switch AI model
  ${c.purple('/provider')}   Switch AI provider  
  ${c.purple('/config')}    Configure API keys
  ${c.purple('/clear')}     Clear conversation history
  ${c.purple('/history')}   Show conversation history

${c.bold('Mode (Tab to cycle)')}
  ${c.purple('/mode')}        Show/set mode (build/plan/debug)
  ${c.purple('/auto-apply')}  Toggle auto-apply edits
  ${c.purple('/approval')}   Toggle approval mode (ask before edits)

${c.bold('Swarm Mode')}
  ${c.purple('/swarm')}       Toggle swarm mode
  ${c.purple('/swarm-setup')} Show swarm setup guidance
  ${c.purple('/swarm-config')} Configure swarm settings
  ${c.purple('/swarm-stop')}  Emergency stop all agents

${c.bold('Tools')}
  ${c.purple('/files')}      List project files
  ${c.purple('/search')}      Search in project files
  ${c.purple('/read')}       Read a file
  ${c.purple('/shell')}      Execute a shell command
  ${c.purple('/git')}        Git operations

${c.bold('General')}
  ${c.purple('/status')}     Show current configuration
  ${c.purple('/reset')}     Reset config to defaults
  ${c.purple('/help')}       Show this help
  ${c.purple('/exit')}       Quit
`);
}
// ─── Config commands ─────────────────────────────────────────
async function handleConfig(args) {
    if (args.length >= 2) {
        const provider = args[0];
        const key = args[1];
        if (!PROVIDERS.find(p => p.id === provider)) {
            console.log(c.red(`\n  Unknown provider: ${provider}`));
            return;
        }
        setApiKey(provider, key);
        console.log(c.green(`\n  API key saved for ${provider}.`));
        return;
    }
    section('API Key Configuration');
    for (const provider of PROVIDERS) {
        const key = getApiKey(provider.id);
        const status = key ? c.green('✓ configured') : c.red('✗ not set');
        console.log(`  ${c.bold(provider.name.padEnd(20))} ${status}  ${c.dim(`(${provider.envVar})`)}`);
    }
    console.log();
    console.log(c.gray('  Usage: /config <provider> <api-key>'));
}
async function handleModelSwitch(args) {
    const { provider } = getCurrentProvider();
    const providerDef = PROVIDERS.find(p => p.id === provider);
    if (args.length > 0) {
        const model = args[0];
        saveConfig({ model });
        console.log(c.green(`\n  Switched to model: ${model}`));
        return;
    }
    section(`Available models for ${providerDef.name}`);
    const config = loadConfig();
    for (const model of providerDef.models) {
        const current = model === config.model ? c.green(' (current)') : '';
        console.log(`    ${c.cyan(model)}${current}`);
    }
    console.log(c.gray('\n  Usage: /model <model-name>'));
}
async function handleProviderSwitch(args) {
    if (args.length > 0) {
        const providerId = args[0];
        try {
            setProvider(providerId, args[1]);
            const { provider, model } = getCurrentProvider();
            console.log(c.green(`\n  Switched to ${formatProvider(provider, model)}`));
        }
        catch (err) {
            console.log(c.red(`\n  ${err}`));
        }
        return;
    }
    section('Available AI Providers');
    const config = loadConfig();
    for (const p of PROVIDERS) {
        const current = p.id === config.provider ? c.green(' (current)') : '';
        const hasKey = getApiKey(p.id) ? c.green('✓') : c.red('✗');
        console.log(`    ${hasKey} ${c.bold(p.id.padEnd(12))} ${c.gray(p.name)}${current}`);
    }
    console.log(c.gray('\n  Usage: /provider <provider-id>'));
}
// ─── Swarm config ─────────────────────────────────────────────
function printSwarmSetup() {
    const config = loadConfig();
    section('Swarm Setup');
    console.log(`  ${c.gray('Strategy:')} ${c.cyan(config.swarm.strategy)}`);
    console.log(`  ${c.gray('Max agents:')} ${c.cyan(String(config.swarm.maxAgents))}`);
    console.log(`  ${c.gray('Specialists:')} ${c.cyan(config.swarm.specialistRoles.join(', '))}`);
    console.log();
    console.log(c.gray('  Use /swarm-config <key> <value> to change settings.'));
    console.log(c.gray('  Use /swarm-config reset to restore defaults.'));
}
const SWARM_SETTINGS = [
    { key: 'strategy', desc: 'Planning style', ex: 'balanced' },
    { key: 'maxAgents', desc: 'Max concurrent agents', ex: '4' },
    { key: 'specialistRoles', desc: 'Worker roles', ex: 'builder,reviewer' },
    { key: 'safeMode', desc: 'Preview-only mode', ex: 'true' },
    { key: 'coordinatorReview', desc: 'Coordinator reviews results', ex: 'true' },
    { key: 'validateBuild', desc: 'Run build after swarm', ex: 'true' },
];
function handleSwarmConfig(args) {
    const config = loadConfig();
    if (args[0] === 'reset') {
        config.swarm = { ...DEFAULT_SWARM_SETTINGS };
        saveConfig(config);
        swarmOrchestrator = null;
        console.log(c.green('\n  Swarm config reset to defaults.'));
        return;
    }
    if (args.length >= 2) {
        const key = args[0];
        const value = args.slice(1).join(' ');
        if (key === 'specialistRoles') {
            const roles = value.split(',').map(r => r.trim()).filter(Boolean);
            config.swarm.specialistRoles = roles;
        }
        else if (key === 'maxAgents' || key === 'maxFollowUpTasks') {
            config.swarm[key] = parseInt(value, 10);
        }
        else if (key === 'safeMode' || key === 'coordinatorReview' || key === 'validateBuild') {
            config.swarm[key] = (value === 'true');
        }
        else if (key === 'strategy') {
            config.swarm.strategy = value;
        }
        else {
            config.swarm[key] = value;
        }
        saveConfig(config);
        swarmOrchestrator = null;
        console.log(c.green(`\n  Updated: ${key} = ${value}`));
        return;
    }
    section('Swarm Configuration');
    for (const s of SWARM_SETTINGS) {
        const value = config.swarm[s.key];
        const valStr = Array.isArray(value) ? value.join(', ') : String(value);
        console.log(`  ${c.purple(s.key.padEnd(18))} ${c.cyan(valStr)}  ${c.dim(s.desc)}`);
    }
    console.log(c.gray('\n  Usage: /swarm-config <key> <value>'));
}
// ─── Status ──────────────────────────────────────────────────
function printStatus() {
    const { provider, model } = getCurrentProvider();
    const config = loadConfig();
    section('Status');
    console.log(`  ${c.gray('Provider:')}   ${formatProvider(provider, model)}`);
    console.log(`  ${c.gray('API Key:')}    ${getApiKey() ? c.green('configured') : c.red('not set')}`);
    console.log(`  ${c.gray('Project:')}   ${c.blue(process.cwd())}`);
    console.log(`  ${c.gray('Mode:')}       ${completionMode === 'build' ? c.green(completionMode) : completionMode === 'plan' ? c.yellow(completionMode) : c.red(completionMode)}`);
    console.log(`  ${c.gray('Auto-apply:')} ${autoApply ? c.green('ON') : c.yellow('OFF')}`);
    console.log(`  ${c.gray('Approval:')}  ${approvalMode ? c.green('ON (ask)') : c.yellow('OFF (auto)')}`);
    console.log(`  ${c.gray('Swarm:')}      ${swarmMode ? c.yellow('ON') : c.gray('OFF')}`);
    console.log(`  ${c.gray('History:')}   ${messageHistory.length} messages`);
    const configured = PROVIDERS.filter(p => getApiKey(p.id));
    console.log(`  ${c.gray('Keys set:')}   ${configured.map(p => c.green(p.id)).join(', ') || c.red('none')}`);
}
// ─── Tools ──────────────────────────────────────────────────
function handleFiles(args) {
    const dir = args[0] || process.cwd();
    try {
        const files = listDir(dir);
        section(`Files in ${dir}`);
        for (const file of files.slice(0, 50)) {
            const icon = file.endsWith('/') ? c.blue('📁') : c.gray('  ');
            console.log(`  ${icon} ${file}`);
        }
    }
    catch (err) {
        console.log(c.red(`\n  Error: ${err}`));
    }
}
function handleSearch(args) {
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
        console.log(`  ${c.blue(match.file)}:${c.gray(String(match.line))}  ${match.text.trim().slice(0, 60)}`);
    }
    console.log(c.gray(`\n  ${matches.length} matches`));
}
function handleShell(args) {
    if (args.length === 0) {
        console.log(c.gray('\n  Usage: /shell <command>'));
        return;
    }
    const command = args.join(' ');
    console.log(c.gray(`\n  $ ${command}`));
    const result = execShell(command, process.cwd());
    if (result.stdout)
        console.log(result.stdout);
    if (result.stderr)
        console.log(c.red(result.stderr));
    if (result.exitCode !== 0)
        console.log(c.yellow(`  Exit: ${result.exitCode}`));
}
function handleGit(args) {
    const subcmd = args[0] || 'status';
    switch (subcmd) {
        case 'status':
            console.log(gitStatus(process.cwd()) || c.green('  Clean'));
            break;
        case 'log':
            console.log(gitLog(process.cwd(), parseInt(args[1]) || 10));
            break;
        case 'diff':
            console.log(gitDiff(process.cwd(), args[1] === '--staged') || c.gray('  No changes'));
            break;
        default:
            const result = execShell(`git ${args.join(' ')}`, process.cwd());
            if (result.stdout)
                console.log(result.stdout);
            if (result.stderr)
                console.log(c.red(result.stderr));
    }
}
function handleRead(args) {
    if (args.length === 0) {
        console.log(c.gray('\n  Usage: /read <file>'));
        return;
    }
    const filePath = path.resolve(process.cwd(), args[0]);
    try {
        const content = readFile(filePath);
        const lines = content.split('\n');
        section(args[0]);
        for (let i = 0; i < Math.min(lines.length, 80); i++) {
            console.log(c.gray(`${String(i + 1).padStart(4)} │`) + ` ${lines[i]}`);
        }
        if (lines.length > 80)
            console.log(c.gray(`  ... ${lines.length - 80} more lines`));
    }
    catch (err) {
        console.log(c.red(`\n  Error: ${err}`));
    }
}
function printHistory() {
    if (messageHistory.length === 0) {
        console.log(c.gray('\n  No history.'));
        return;
    }
    section(`History (${messageHistory.length} messages)`);
    for (const msg of messageHistory.slice(-10)) {
        const role = msg.role === 'user' ? c.blue('you') : c.purple('velix');
        const preview = msg.content.slice(0, 80).replace(/\n/g, ' ');
        console.log(`  ${role}: ${c.gray(preview)}${msg.content.length > 80 ? '...' : ''}`);
    }
}
function printAgents() {
    if (!swarmOrchestrator) {
        console.log(c.gray('\n  No active swarm. Use /swarm first.'));
        return;
    }
    const agents = swarmOrchestrator.getAgents();
    section('Swarm Agents');
    for (const agent of agents) {
        const statusColor = agent.status === 'completed' ? c.green
            : agent.status === 'failed' ? c.red
                : agent.status === 'working' ? c.yellow
                    : c.gray;
        console.log(`  ${c.bold(agent.role.padEnd(12))} ${statusColor(agent.status)}`);
    }
}
//# sourceMappingURL=repl.js.map