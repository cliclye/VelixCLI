/**
 * UI components for Velix CLI - Clean, stable terminal UI like Claude Code.
 */
import { c } from './theme.js';
// ─── Terminal utilities ───────────────────────────────────────
let terminalWidth = 80;
export function getWidth() {
    return terminalWidth;
}
export function updateWidth() {
    terminalWidth = Math.max(40, (process.stdout.columns ?? 80) - 2);
}
updateWidth();
process.stdout.on('resize', updateWidth);
export function stripAnsi(s) {
    return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}
// ─── Divider ─────────────────────────────────────────────────
const DIVIDER_CHARS = {
    light: '─',
    heavy: '━',
    dotted: '┅',
};
export function divider(char = 'light') {
    return c.gray(DIVIDER_CHARS[char].repeat(getWidth()));
}
// ─── Spinner ─────────────────────────────────────────────────
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export class Spinner {
    interval = null;
    frame = 0;
    label;
    constructor(label = 'Thinking') {
        this.label = label;
    }
    start() {
        this.frame = 0;
        process.stdout.write('\x1b[?25l'); // hide cursor
        this.render();
        this.interval = setInterval(() => this.render(), 80);
    }
    render() {
        const f = SPINNER[this.frame % SPINNER.length];
        process.stdout.write(`\r${c.purple(f)} ${c.gray(this.label)}`);
        this.frame++;
    }
    stop(message) {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        process.stdout.write('\r\x1b[2K\x1b[?25h'); // clear line, show cursor
        if (message) {
            process.stdout.write(`  ${message}\n`);
        }
    }
}
// ─── Message output ──────────────────────────────────────────
export function printUserMessage(text) {
    console.log();
    console.log(`  ${c.blue('you')}`);
    for (const line of text.split('\n')) {
        console.log(`  ${c.gray('│')} ${line}`);
    }
}
export function printAssistantMessage(text) {
    console.log();
    console.log(`  ${c.purple('velix')}`);
    for (const line of text.split('\n')) {
        console.log(`  ${c.gray('│')} ${line}`);
    }
}
// ─── Section header ──────────────────────────────────────────
export function section(title) {
    console.log();
    console.log(c.boldPurple(`  ${title}`));
    console.log(divider('dotted'));
}
// ─── Status bar ──────────────────────────────────────────────
export function statusBar(items) {
    const parts = items.map(({ label, value }) => `${c.gray(label + ':')} ${c.cyan(value)}`);
    console.log(c.gray('  │ ') + parts.join(c.gray('  │ ')));
}
// ─── Input hint ──────────────────────────────────────────────
export function inputHint(text) {
    const width = getWidth();
    const len = stripAnsi(text);
    const padding = Math.max(0, width - len - 1);
    process.stdout.write(`\r${' '.repeat(padding)}${c.dim(text)}`);
}
//# sourceMappingURL=components.js.map