# Velix CLI

Velix AI CLI - A multi-provider AI coding assistant with swarm orchestration, inspired by Claude Code.

## Features

- **Multi-Provider Support**: Use Claude, ChatGPT, Gemini, DeepSeek, Groq, Mistral, MiniMax, Kimi, or GLM
- **Swarm Mode**: Coordinate multiple AI agents for complex tasks
- **Clean UI**: Claude Code-inspired terminal interface
- **Mode Switching**: Build, Plan, or Debug modes
- **Approval Mode**: Control when AI can edit files or run commands
- **Auto-Apply**: Toggle automatic file edits

## Installation

### Via npm (Recommended)

```bash
npm install -g velix-cli
```

### Via Homebrew

```bash
brew tap cliclye/velix
brew install velix
```

### Via curl

```bash
curl -fsSL https://raw.githubusercontent.com/cliclye/velix-cli/main/bin/velix.mjs -o /usr/local/bin/velix
chmod +x /usr/local/bin/velix
```

## Configuration

1. Set up your API key:
   ```bash
   velix /config claude sk-ant-your-api-key
   ```

2. Or use environment variables:
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-your-api-key
   ```

## Usage

### Basic Chat
```
velix
❯ Your question here
```

### Commands
- `/help` - Show all commands
- `/model <model>` - Switch AI model
- `/provider <provider>` - Switch AI provider
- `/config` - Configure API keys
- `/swarm` - Toggle swarm mode
- `/mode <build|plan|debug>` - Set completion mode
- `/auto-apply` - Toggle auto-apply edits
- `/approval` - Toggle approval mode
- `/clear` - Clear conversation history
- `/exit` - Quit

### Tab to Cycle Modes
Press Tab to cycle between:
- `● build` - Implement features and write code
- `○ plan` - Analyze and plan without making changes
- `◉ debug` - Find and fix bugs

## Swarm Mode

Swarm mode coordinates multiple AI agents:
- **Coordinator**: Plans tasks and reviews results
- **Workers**: Specialists for building, testing, reviewing, etc.

```bash
velix
/swarm
Describe your complex task here
```

## Requirements

- Node.js 18+ (20+ recommended)
- API keys for your chosen AI provider

## License

MIT
