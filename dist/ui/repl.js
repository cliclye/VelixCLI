/**
 * VelixREPL - Interactive terminal REPL with slash commands, AI chat, and swarm mode.
 * This is the main user-facing interface, similar to Claude Code.
 */
import readline from 'node:readline';
import path from 'node:path';
import { sendMessage } from '../services/ai/engine.js';
import { loadConfig, saveConfig, getApiKey, setApiKey, setProvider, getCurrentProvider, } from '../config/store.js';
import { PROVIDERS } from '../services/ai/types.js';
import { SwarmOrchestrator } from '../services/swarm/orchestrator.js';
import { readFile, listDir, searchInFiles, execShell, gitStatus, gitDiff, gitLog, readProjectSources, } from '../services/tools/index.js';
import { c, VELIX_LOGO, DIVIDER, formatProvider, renderMarkdown } from './theme.js';
import { drawInputDivider, drawInputBoxBorder } from './components.js';
// ─── State ──────────────────────────────────────────────────
let messageHistory = [];
let swarmMode = false;
let swarmOrchestrator = null;
let currentAbortController = null;
// ─── REPL ───────────────────────────────────────────────────
export function startREPL() {
    printWelcome();
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: getPrompt(),
        historySize: 200,
    });
    drawInputDivider(swarmMode, true);
    rl.prompt();
    drawInputBoxBorder(swarmMode);
    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) {
            drawInputDivider(swarmMode, true);
            rl.prompt();
            drawInputBoxBorder(swarmMode);
            return;
        }
        // Close the input box (plain bottom border after user submits)
        drawInputDivider(swarmMode);
        // Handle Ctrl-C during processing
        currentAbortController = new AbortController();
        try {
            if (input.startsWith('/')) {
                await handleSlashCommand(input, rl);
            }
            else if (swarmMode) {
                await handleSwarmInput(input);
            }
            else {
                await handleChat(input);
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
        drawInputDivider(swarmMode, true);
        rl.prompt();
        drawInputBoxBorder(swarmMode);
    });
    rl.on('SIGINT', () => {
        if (currentAbortController) {
            currentAbortController.abort();
            console.log(c.yellow('\n  Interrupting...'));
        }
        else {
            console.log(c.gray('\n  (Use /exit to quit, Ctrl-C again to force quit)'));
            drawInputDivider(swarmMode, true);
            rl.prompt();
            drawInputBoxBorder(swarmMode);
        }
    });
    rl.on('close', () => {
        console.log(c.gray('\n  Goodbye!\n'));
        process.exit(0);
    });
}
function getPrompt() {
    const modeTag = swarmMode ? c.boldYellow('SWARM ') : '';
    return `${modeTag}${c.purple('❯')} `;
}
function printWelcome() {
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
    console.log();
}
// ─── Chat Handler ───────────────────────────────────────────
async function handleChat(input) {
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
    }
    catch { /* ignore */ }
    process.stdout.write(`\n  ${c.purple('velix')} ${c.gray('thinking...')}\r`);
    const response = await sendMessage({
        text: input,
        system,
        provider: config.provider,
        model: config.model,
        apiKey,
        messageHistory,
        signal: currentAbortController?.signal,
    });
    // Clear the "thinking" line
    process.stdout.write('\x1b[2K\r');
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
async function handleSwarmInput(input) {
    if (!swarmOrchestrator) {
        const callbacks = {
            onLog: (msg, type) => {
                const prefix = {
                    info: c.blue(' i'),
                    warn: c.yellow(' !'),
                    error: c.red(' ✗'),
                    success: c.green(' ✓'),
                    agent: c.purple(' ◆'),
                }[type ?? 'info'];
                console.log(`  ${prefix} ${msg}`);
            },
            onStateChange: (state) => {
                console.log(`  ${c.gray('State:')} ${c.boldCyan(state)}`);
            },
            onAgentUpdate: (agent) => {
                const statusIcon = {
                    idle: c.gray('○'),
                    working: c.yellow('◉'),
                    completed: c.green('●'),
                    failed: c.red('●'),
                    terminated: c.red('⊘'),
                }[agent.status];
                console.log(`  ${statusIcon} ${c.bold(agent.role)} ${c.gray(agent.id.slice(0, 12))} — ${agent.currentTask ?? agent.status}`);
            },
            onComplete: (task) => {
                console.log();
                console.log(DIVIDER);
                console.log(`  ${c.boldGreen('Swarm Task Complete')}`);
                console.log(`  ${c.gray('Agents used:')} ${task.agents.length}`);
                console.log(`  ${c.gray('Duration:')} ${task.completedAt ? Math.round((task.completedAt.getTime() - task.createdAt.getTime()) / 1000) : '?'}s`);
                console.log(`  ${c.gray('Status:')} ${task.status === 'completed' ? c.green('SUCCESS') : c.red('FAILED')}`);
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
                console.log(`  ${c.gray('Your messages will be executed as multi-agent swarm tasks.')}`);
                console.log(`  ${c.gray('Type /swarm again to return to normal chat mode.')}`);
                console.log(`  ${c.gray('Type /swarm-config to configure swarm settings.')}`);
                console.log(DIVIDER);
            }
            else {
                swarmOrchestrator = null;
                console.log(`\n  ${c.gray('Swarm mode deactivated. Back to normal chat.')}`);
            }
            break;
        case '/swarm-config':
            handleSwarmConfig(args);
            break;
        case '/swarm-stop':
            if (swarmOrchestrator) {
                swarmOrchestrator.abort();
                console.log(c.red('\n  Swarm emergency stop triggered.'));
            }
            else {
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
function printHelp() {
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
async function handleConfig(args, rl) {
    if (args.length >= 2) {
        // Direct set: /config <provider> <key>
        const provider = args[0];
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
async function handleModelSwitch(args, rl) {
    const { provider } = getCurrentProvider();
    const providerDef = PROVIDERS.find(p => p.id === provider);
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
async function handleProviderSwitch(args, rl) {
    if (args.length > 0) {
        const providerId = args[0];
        try {
            setProvider(providerId, args[1]);
            const { provider, model } = getCurrentProvider();
            console.log(c.green(`\n  Switched to ${formatProvider(provider, model)}`));
        }
        catch (err) {
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
function handleSwarmConfig(args) {
    const config = loadConfig();
    if (args.length >= 2) {
        const key = args[0];
        const value = args[1];
        switch (key) {
            case 'maxAgents':
                config.swarm.maxAgents = parseInt(value) || 5;
                break;
            case 'maxRuntime':
                config.swarm.maxRuntime = parseInt(value) || 600000;
                break;
            case 'safeMode':
                config.swarm.safeMode = value === 'true';
                break;
            case 'workerCLI':
                config.swarm.workerCLI = value;
                break;
            default:
                console.log(c.red(`\n  Unknown setting: ${key}`));
                return;
        }
        saveConfig(config);
        console.log(c.green(`\n  Swarm config updated: ${key} = ${value}`));
        return;
    }
    console.log(`\n${c.bold('  Swarm Configuration')}`);
    console.log(DIVIDER);
    console.log(`  ${c.gray('maxAgents:')}   ${c.cyan(String(config.swarm.maxAgents))}    ${c.gray('Max concurrent agents')}`);
    console.log(`  ${c.gray('maxRuntime:')}  ${c.cyan(String(config.swarm.maxRuntime))}  ${c.gray('Max total runtime (ms)')}`);
    console.log(`  ${c.gray('safeMode:')}    ${c.cyan(String(config.swarm.safeMode))}   ${c.gray('Require approval for all actions')}`);
    console.log(`  ${c.gray('workerCLI:')}   ${c.cyan(config.swarm.workerCLI)}  ${c.gray('CLI tool for worker agents')}`);
    console.log(`\n  ${c.gray('Usage: /swarm-config <key> <value>')}`);
}
function printStatus() {
    const { provider, model } = getCurrentProvider();
    const config = loadConfig();
    console.log(`\n${c.bold('  Velix Status')}`);
    console.log(DIVIDER);
    console.log(`  ${c.gray('Provider:')}    ${formatProvider(provider, model)}`);
    console.log(`  ${c.gray('API Key:')}     ${getApiKey() ? c.green('configured') : c.red('not set')}`);
    console.log(`  ${c.gray('Project:')}     ${c.blue(process.cwd())}`);
    console.log(`  ${c.gray('Swarm Mode:')}  ${swarmMode ? c.yellow('ON') : c.gray('OFF')}`);
    console.log(`  ${c.gray('History:')}     ${messageHistory.length} messages`);
    // Configured providers
    const configured = PROVIDERS.filter(p => getApiKey(p.id));
    console.log(`  ${c.gray('Providers:')}   ${configured.map(p => c.green(p.id)).join(', ') || c.red('none')}`);
}
function handleFiles(args) {
    const dir = args[0] || process.cwd();
    try {
        const files = listDir(dir);
        console.log(`\n  ${c.bold('Files in')} ${c.blue(dir)}`);
        for (const file of files) {
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
        console.log(`  ${c.blue(match.file)}${c.gray(`:${match.line}:${match.column}`)}  ${match.text.trim().slice(0, 80)}`);
    }
    console.log(c.gray(`\n  ${matches.length} match(es) found`));
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
    if (result.exitCode !== 0) {
        console.log(c.yellow(`  Exit code: ${result.exitCode}`));
    }
}
function handleGit(args) {
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
            if (result.stdout)
                console.log(result.stdout);
            if (result.stderr)
                console.log(c.red(result.stderr));
    }
}
function handleRead(args) {
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
    }
    catch (err) {
        console.log(c.red(`\n  Error reading file: ${err}`));
    }
}
function printHistory() {
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
function compactHistory() {
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
function handleInit() {
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
//# sourceMappingURL=repl.js.map