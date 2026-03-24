#!/usr/bin/env node
/**
 * Velix CLI - Multi-provider AI coding assistant with swarm orchestration.
 * A terminal-native tool inspired by Claude Code, supporting 9 AI providers.
 *
 * Usage:
 *   velix              Launch interactive REPL
 *   velix --help       Show help
 *   velix --version    Show version
 *   velix -c "msg"     Send a single message and exit
 */

import updateNotifier from 'update-notifier';
import { startREPL } from './ui/repl.js';
import { loadConfig, getCurrentProvider, getApiKey, setApiKey, setProvider } from './config/store.js';
import { sendMessage } from './services/ai/engine.js';
import { c, VELIX_LOGO, renderMarkdown } from './ui/theme.js';
import { PROVIDERS, ProviderID } from './services/ai/types.js';

updateNotifier({ pkg: { name: 'velix-cli', version: '0.2.0' }, updateCheckInterval: 1000 * 60 * 60 * 24 }).notify();

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    // --help
    if (args.includes('--help') || args.includes('-h')) {
        printUsage();
        process.exit(0);
    }

    // --version
    if (args.includes('--version') || args.includes('-v')) {
        console.log('velix-cli 0.2.0');
        process.exit(0);
    }

    // --tui - launch full TUI mode (requires bun)
    if (args.includes('--tui')) {
        console.log('Launching Velix TUI...');
        const { spawn } = await import('node:child_process');
        const bun = spawn('bun', ['src/tui-main.tsx'], {
            stdio: 'inherit',
            cwd: process.cwd(),
            env: process.env,
        });
        bun.on('exit', (code) => process.exit(code ?? 0));
        return;
    }

    // --config <provider> <key>
    const configIdx = args.indexOf('--config');
    if (configIdx !== -1) {
        const provider = args[configIdx + 1] as ProviderID;
        const key = args[configIdx + 2];
        if (!provider || !key) {
            console.error('Usage: velix --config <provider> <api-key>');
            process.exit(1);
        }
        if (!PROVIDERS.find(p => p.id === provider)) {
            console.error(`Unknown provider: ${provider}`);
            console.error(`Available: ${PROVIDERS.map(p => p.id).join(', ')}`);
            process.exit(1);
        }
        setApiKey(provider, key);
        console.log(`API key saved for ${provider}.`);
        process.exit(0);
    }

    // --provider <provider>
    const providerIdx = args.indexOf('--provider');
    if (providerIdx !== -1 && !args.includes('-c')) {
        const provider = args[providerIdx + 1] as ProviderID;
        if (!provider) {
            console.error('Usage: velix --provider <provider>');
            process.exit(1);
        }
        setProvider(provider);
        console.log(`Switched to provider: ${provider}`);
        process.exit(0);
    }

    // -c "message" - single shot
    const chatIdx = args.indexOf('-c');
    if (chatIdx !== -1) {
        const message = args.slice(chatIdx + 1).join(' ');
        if (!message) {
            console.error('Usage: velix -c "your message"');
            process.exit(1);
        }
        await singleShot(message);
        process.exit(0);
    }

    // Default: launch interactive REPL
    loadConfig();
    startREPL();
}

async function singleShot(message: string): Promise<void> {
    const config = loadConfig();
    const apiKey = getApiKey();
    if (!apiKey) {
        console.error('No API key configured. Run: velix --config <provider> <api-key>');
        process.exit(1);
    }

    const response = await sendMessage({
        text: message,
        system: 'You are Velix, a helpful AI coding assistant. Be concise.',
        provider: config.provider,
        model: config.model,
        apiKey,
    });

    console.log(renderMarkdown(response));
}

function printUsage(): void {
    const lines = [
        '',
        c.boldPurple('Velix CLI') + ' ' + c.gray('- Multi-provider AI coding assistant'),
        '',
        c.bold('USAGE'),
        '  velix                         Launch interactive REPL',
        '  velix -c "message"            Send a single message',
        '  velix --config <provider> <key>   Configure API key',
        '  velix --provider <provider>   Switch AI provider',
        '  velix --tui                   Launch full TUI (requires bun)',
        '',
        c.bold('OPTIONS'),
        '  -h, --help        Show this help',
        '  -v, --version     Show version',
        '  -c <message>      Single-shot message (non-interactive)',
        '  --config          Configure API key',
        '  --provider        Set default provider',
        '  --tui             Launch full terminal UI (experimental)',
        '',
        c.bold('PROVIDERS'),
    ];

    for (const p of PROVIDERS) {
        lines.push('  ' + c.cyan(p.id.padEnd(12)) + ' ' + c.gray(p.name));
    }

    lines.push('');
    lines.push(c.bold('INTERACTIVE COMMANDS'));
    lines.push('  /help             Show all slash commands');
    lines.push('  /config           Configure API keys');
    lines.push('  /model <name>     Switch AI model');
    lines.push('  /provider <name>  Switch AI provider');
    lines.push('  /swarm            Toggle swarm mode');
    lines.push('  /swarm-setup      Show swarm team setup guidance');
    lines.push('  /swarm-config     Inspect or change swarm settings');
    lines.push('  /shell <cmd>      Run shell command');
    lines.push('  /git [status|log] Git operations');
    lines.push('  /exit             Quit');
    lines.push('');
    lines.push(c.bold('EXAMPLES'));
    lines.push('  ' + c.gray('# Set up Claude'));
    lines.push('  velix --config claude sk-ant-api03-...');
    lines.push('');
    lines.push('  ' + c.gray('# Quick question'));
    lines.push('  velix -c "How do I reverse a linked list in Python?"');
    lines.push('');
    lines.push('  ' + c.gray('# Interactive session'));
    lines.push('  velix');
    lines.push('');
    lines.push('  ' + c.gray('# Full TUI (experimental)'));
    lines.push('  velix --tui');
    lines.push('');
    lines.push('  ' + c.gray('# Use swarm mode for complex tasks'));
    lines.push('  velix    ' + c.gray('(then type /swarm to activate)'));

    console.log(lines.join('\n'));
}

main().catch(err => {
    console.error('Fatal error: ' + err);
    process.exit(1);
});
