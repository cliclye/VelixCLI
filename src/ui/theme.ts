/**
 * Terminal styling and theme constants for VelixCLI.
 */

// ANSI escape codes for styling (no chalk dependency needed at runtime)
const ESC = '\x1b[';
const RESET = `${ESC}0m`;

export const c = {
    // Colors
    purple: (s: string) => `${ESC}38;5;141m${s}${RESET}`,
    blue: (s: string) => `${ESC}38;5;75m${s}${RESET}`,
    cyan: (s: string) => `${ESC}36m${s}${RESET}`,
    green: (s: string) => `${ESC}32m${s}${RESET}`,
    yellow: (s: string) => `${ESC}33m${s}${RESET}`,
    red: (s: string) => `${ESC}31m${s}${RESET}`,
    gray: (s: string) => `${ESC}90m${s}${RESET}`,
    white: (s: string) => `${ESC}37m${s}${RESET}`,
    magenta: (s: string) => `${ESC}35m${s}${RESET}`,

    // Styles
    bold: (s: string) => `${ESC}1m${s}${RESET}`,
    dim: (s: string) => `${ESC}2m${s}${RESET}`,
    italic: (s: string) => `${ESC}3m${s}${RESET}`,
    underline: (s: string) => `${ESC}4m${s}${RESET}`,

    // Combined
    boldPurple: (s: string) => `${ESC}1;38;5;141m${s}${RESET}`,
    boldGreen: (s: string) => `${ESC}1;32m${s}${RESET}`,
    boldCyan: (s: string) => `${ESC}1;36m${s}${RESET}`,
    boldRed: (s: string) => `${ESC}1;31m${s}${RESET}`,
    boldYellow: (s: string) => `${ESC}1;33m${s}${RESET}`,
    boldBlue: (s: string) => `${ESC}1;38;5;75m${s}${RESET}`,
};

export const VELIX_LOGO = `
${c.boldPurple('  ██╗   ██╗███████╗██╗     ██╗██╗  ██╗')}
${c.boldPurple('  ██║   ██║██╔════╝██║     ██║╚██╗██╔╝')}
${c.boldPurple('  ██║   ██║█████╗  ██║     ██║ ╚███╔╝ ')}
${c.boldPurple('  ╚██╗ ██╔╝██╔══╝  ██║     ██║ ██╔██╗ ')}
${c.boldPurple('   ╚████╔╝ ███████╗███████╗██║██╔╝ ██╗')}
${c.boldPurple('    ╚═══╝  ╚══════╝╚══════╝╚═╝╚═╝  ╚═╝')}
`;

export const DIVIDER = c.gray('─'.repeat(60));

export function formatProvider(provider: string, model: string): string {
    return `${c.boldPurple(provider)}${c.gray(':')}${c.cyan(model)}`;
}

export function formatPath(p: string): string {
    return c.blue(p);
}

export function formatTimestamp(): string {
    const now = new Date();
    return c.gray(`[${now.toLocaleTimeString()}]`);
}

/**
 * Simple markdown-to-terminal renderer.
 * Handles code blocks, bold, inline code, headers, and lists.
 */
export function renderMarkdown(text: string): string {
    const lines = text.split('\n');
    const result: string[] = [];
    let inCodeBlock = false;
    let codeLanguage = '';

    for (const line of lines) {
        // Code block start/end
        if (line.trimStart().startsWith('```')) {
            if (!inCodeBlock) {
                inCodeBlock = true;
                codeLanguage = line.trim().slice(3);
                result.push(c.gray(`  ┌─ ${codeLanguage || 'code'} ${'─'.repeat(Math.max(0, 45 - (codeLanguage.length || 4)))}`));
            } else {
                inCodeBlock = false;
                codeLanguage = '';
                result.push(c.gray('  └' + '─'.repeat(50)));
            }
            continue;
        }

        if (inCodeBlock) {
            result.push(c.green(`  │ ${line}`));
            continue;
        }

        // Headers
        if (line.startsWith('### ')) {
            result.push(c.boldCyan(line.slice(4)));
            continue;
        }
        if (line.startsWith('## ')) {
            result.push(c.boldPurple(line.slice(3)));
            continue;
        }
        if (line.startsWith('# ')) {
            result.push(c.boldPurple(line.slice(2)));
            continue;
        }

        // Bold
        let processed = line.replace(/\*\*(.+?)\*\*/g, (_m, p1) => c.bold(p1));
        // Inline code
        processed = processed.replace(/`(.+?)`/g, (_m, p1) => c.cyan(p1));
        // Bullet lists
        if (processed.match(/^\s*[-*]\s/)) {
            processed = processed.replace(/^(\s*)[-*]\s/, `$1${c.purple('●')} `);
        }
        // Numbered lists
        processed = processed.replace(/^(\s*)(\d+)\.\s/, `$1${c.purple('$2.')} `);

        result.push(processed);
    }

    return result.join('\n');
}
