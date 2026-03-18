/**
 * Terminal styling and theme constants for VelixCLI.
 */
// ANSI escape codes for styling (no chalk dependency needed at runtime)
const ESC = '\x1b[';
const RESET = `${ESC}0m`;
export const c = {
    // Colors
    purple: (s) => `${ESC}38;5;141m${s}${RESET}`,
    blue: (s) => `${ESC}38;5;75m${s}${RESET}`,
    cyan: (s) => `${ESC}36m${s}${RESET}`,
    green: (s) => `${ESC}32m${s}${RESET}`,
    yellow: (s) => `${ESC}33m${s}${RESET}`,
    red: (s) => `${ESC}31m${s}${RESET}`,
    gray: (s) => `${ESC}90m${s}${RESET}`,
    white: (s) => `${ESC}37m${s}${RESET}`,
    magenta: (s) => `${ESC}35m${s}${RESET}`,
    // Styles
    bold: (s) => `${ESC}1m${s}${RESET}`,
    dim: (s) => `${ESC}2m${s}${RESET}`,
    italic: (s) => `${ESC}3m${s}${RESET}`,
    underline: (s) => `${ESC}4m${s}${RESET}`,
    // Combined
    boldPurple: (s) => `${ESC}1;38;5;141m${s}${RESET}`,
    boldGreen: (s) => `${ESC}1;32m${s}${RESET}`,
    boldCyan: (s) => `${ESC}1;36m${s}${RESET}`,
    boldRed: (s) => `${ESC}1;31m${s}${RESET}`,
    boldYellow: (s) => `${ESC}1;33m${s}${RESET}`,
    boldBlue: (s) => `${ESC}1;38;5;75m${s}${RESET}`,
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
export function formatProvider(provider, model) {
    return `${c.boldPurple(provider)}${c.gray(':')}${c.cyan(model)}`;
}
export function formatPath(p) {
    return c.blue(p);
}
export function formatTimestamp() {
    const now = new Date();
    return c.gray(`[${now.toLocaleTimeString()}]`);
}
/**
 * Simple markdown-to-terminal renderer.
 * Handles code blocks, bold, inline code, headers, and lists.
 */
export function renderMarkdown(text) {
    const lines = text.split('\n');
    const result = [];
    let inCodeBlock = false;
    let codeLanguage = '';
    for (const line of lines) {
        // Code block start/end
        if (line.trimStart().startsWith('```')) {
            if (!inCodeBlock) {
                inCodeBlock = true;
                codeLanguage = line.trim().slice(3);
                result.push(c.gray(`  ┌─ ${codeLanguage || 'code'} ${'─'.repeat(Math.max(0, 45 - (codeLanguage.length || 4)))}`));
            }
            else {
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
//# sourceMappingURL=theme.js.map