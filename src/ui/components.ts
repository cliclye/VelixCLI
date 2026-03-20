/**
 * UI components for Velix CLI - Clean, stable terminal UI like Claude Code.
 */

import { c } from './theme.js';

// ─── Terminal utilities ───────────────────────────────────────

let terminalWidth = 80;

export function getWidth(): number {
    return terminalWidth;
}

export function updateWidth(): void {
    terminalWidth = Math.max(40, (process.stdout.columns ?? 80) - 2);
}

updateWidth();
process.stdout.on('resize', updateWidth);

export function stripAnsi(s: string): number {
    return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

// ─── Divider ─────────────────────────────────────────────────

const DIVIDER_CHARS = {
    light: '─',
    heavy: '━',
    dotted: '┅',
};

export function divider(char: keyof typeof DIVIDER_CHARS = 'light'): string {
    return c.gray(DIVIDER_CHARS[char].repeat(getWidth()));
}

// ─── Spinner ─────────────────────────────────────────────────

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Spinner {
    private interval: ReturnType<typeof setInterval> | null = null;
    private frame = 0;
    private label: string;

    constructor(label = 'Thinking') {
        this.label = label;
    }

    start(): void {
        this.frame = 0;
        process.stdout.write('\x1b[?25l'); // hide cursor
        this.render();
        this.interval = setInterval(() => this.render(), 80);
    }

    private render(): void {
        const f = SPINNER[this.frame % SPINNER.length];
        process.stdout.write(`\r${c.purple(f)} ${c.gray(this.label)}`);
        this.frame++;
    }

    stop(message?: string): void {
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

export function printUserMessage(text: string): void {
    console.log();
    console.log(`  ${c.blue('you')}`);
    for (const line of text.split('\n')) {
        console.log(`  ${c.gray('│')} ${line}`);
    }
}

export function printAssistantMessage(text: string): void {
    console.log();
    console.log(`  ${c.purple('velix')}`);
    for (const line of text.split('\n')) {
        console.log(`  ${c.gray('│')} ${line}`);
    }
}

// ─── Section header ──────────────────────────────────────────

export function section(title: string): void {
    console.log();
    console.log(c.boldPurple(`  ${title}`));
    console.log(divider('dotted'));
}

// ─── Status bar ──────────────────────────────────────────────

export function statusBar(items: Array<{ label: string; value: string }>): void {
    const parts = items.map(({ label, value }) => 
        `${c.gray(label + ':')} ${c.cyan(value)}`
    );
    console.log(c.gray('  │ ') + parts.join(c.gray('  │ ')));
}

// ─── Input hint ──────────────────────────────────────────────

export function inputHint(text: string): void {
    const width = getWidth();
    const len = stripAnsi(text);
    const padding = Math.max(0, width - len - 1);
    process.stdout.write(`\r${' '.repeat(padding)}${c.dim(text)}`);
}