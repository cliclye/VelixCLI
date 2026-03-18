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

import { startREPL } from './ui/repl.js';
import { loadConfig, getCurrentProvider, getApiKey, setApiKey, setProvider } from './config/store.js';
import { sendMessage } from './services/ai/engine.js';
import { c, VELIX_LOGO, renderMarkdown } from './ui/theme.js';
import { PROVIDERS, ProviderID } from './services/ai/types.js';

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    // --help
    if (args.includes('--help') || args.includes('-h')) {
        printUsage();
        process.exit(0);
    }

    // --version
    if (args.includes('--version') || args.includes('-v')) {
        console.log('velix-cli 0.1.0');
        process.exit(0);
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

    // -c "message" — single shot
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
    console.log(`
${c.boldPurple('Velix CLI')} ${c.gray('— Multi-provider AI coding assistant')}

${c.bold('USAGE')}
  velix                         Launch interactive REPL
  velix -c "message"            Send a single message
  velix --config <provider> <key>   Configure API key
  velix --provider <provider>   Switch AI provider

${c.bold('OPTIONS')}
  -h, --help        Show this help
  -v, --version     Show version
  -c <message>      Single-shot message (non-interactive)
  --config          Configure API key
  --provider        Set default provider

${c.bold('PROVIDERS')}
${PROVIDERS.map(p => `  ${c.cyan(p.id.padEnd(12))} ${c.gray(p.name)}`).join('\n')}

${c.bold('INTERACTIVE COMMANDS')}
  /help             Show all slash commands
  /config           Configure API keys
  /model <name>     Switch AI model
  /provider <name>  Switch AI provider
  /swarm            Toggle swarm mode
  /shell <cmd>      Run shell command
  /git [status|log] Git operations
  /exit             Quit

${c.bold('EXAMPLES')}
  ${c.gray('# Set up Claude')}
  velix --config claude sk-ant-api03-...

  ${c.gray('# Quick question')}
  velix -c "How do I reverse a linked list in Python?"

  ${c.gray('# Interactive session')}
  velix

  ${c.gray('# Use swarm mode for complex tasks')}
  velix    ${c.gray('(then type /swarm to activate)')}
`);
}

main().catch(err => {
    console.error(`Fatal error: ${err}`);
    process.exit(1);
});
