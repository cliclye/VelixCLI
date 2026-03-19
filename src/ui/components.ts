/**
 * UI components for the Velix CLI — bordered input box, spinner, response frame, status bar.
 */

import readline from 'node:readline';
import { c } from './theme.js';

// ─── Terminal helpers ───────────────────────────────────────

function termCols(): number {
    return process.stdout.columns ?? 80;
}

/** Strip ANSI escape codes to get printable length. */
function stripAnsi(s: string): number {
    // eslint-disable-next-line no-control-regex
    return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/** Repeat a char to fill available width. */
function hLine(char: string, width: number): string {
    return char.repeat(Math.max(0, width));
}

// ─── Box drawing characters ─────────────────────────────────
// Using rounded-corner box set for a polished look.
const BOX = {
    tl: '╭', tr: '╮', bl: '╰', br: '╯',
    h: '─', v: '│',
    ltee: '├', rtee: '┤',
};

// ─── Spinner ────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DOT_FRAMES = ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'];
const PULSE_FRAMES = ['◐', '◓', '◑', '◒'];

export class Spinner {
    private timer: ReturnType<typeof setInterval> | null = null;
    private frameIdx = 0;
    private label: string;
    private frames: string[];

    constructor(label = 'Thinking', style: 'braille' | 'dots' | 'pulse' = 'braille') {
        this.label = label;
        this.frames = style === 'dots' ? DOT_FRAMES : style === 'pulse' ? PULSE_FRAMES : SPINNER_FRAMES;
    }

    start(): void {
        this.frameIdx = 0;
        process.stdout.write('\x1b[?25l'); // hide cursor
        this.render();
        this.timer = setInterval(() => this.render(), 80);
    }

    private render(): void {
        const frame = c.purple(this.frames[this.frameIdx % this.frames.length]);
        process.stdout.write(`\r\x1b[2K  ${frame} ${c.gray(this.label)}`);
        this.frameIdx++;
    }

    stop(finalMessage?: string): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        process.stdout.write('\r\x1b[2K'); // clear line
        process.stdout.write('\x1b[?25h'); // show cursor
        if (finalMessage) {
            process.stdout.write(`  ${finalMessage}\n`);
        }
    }

    update(label: string): void {
        this.label = label;
    }
}

// ─── Input Divider ──────────────────────────────────────────

/**
 * Draw a full-width horizontal rule.
 * showHint = true   → "↵ send" appears right-aligned (used as the top/opening border)
 * showHint = false  → plain line (used as the closing bottom border after submit)
 */
export function drawInputDivider(swarm = false, showHint = false): void {
    const width = process.stdout.columns ?? 100;
    const lineFn = swarm ? c.yellow : c.dim;

    if (showHint) {
        const hintText = ' ↵ send ';
        const leftLen = Math.max(0, width - hintText.length);
        process.stdout.write(lineFn(hLine('─', leftLen)) + c.dim(hintText) + '\n');
    } else {
        process.stdout.write(lineFn(hLine('─', width)) + '\n');
    }
}

/**
 * Call this immediately AFTER rl.prompt() to paint a bottom border one row
 * below the prompt line using cursor save/restore.
 *
 * readline only calls _refreshLine() (which would erase this via clearScreenDown)
 * when the user edits with backspace/arrows — normal forward typing is fine.
 */
export function drawInputBoxBorder(swarm = false): void {
    const width = process.stdout.columns ?? 100;
    const lineFn = swarm ? c.yellow : c.dim;
    process.stdout.write(
        '\x1b[s' +                      // save cursor (right after ❯ )
        '\x1b[1B\r' +                   // move down 1 row, column 0
        lineFn(hLine('─', width)) +     // bottom border
        '\x1b[u',                        // restore cursor
    );
}

// ─── Input Box ──────────────────────────────────────────────

export interface InputBoxOptions {
    /** Label shown above the input area. */
    label?: string;
    /** Hint shown at the bottom of the box in gray. */
    hint?: string;
    /** Whether the box is in swarm mode (changes accent colour). */
    swarm?: boolean;
    /** Provider/model tag shown top-right. */
    tag?: string;
    /** The working directory name shown in the label. */
    cwd?: string;
}

/**
 * Draw the top border of the input box and position the cursor inside.
 * The actual text input is still handled by readline; this just frames it.
 */
export function drawInputBox(opts: InputBoxOptions = {}): void {
    const width = Math.min(termCols() - 2, 100);
    const accent = opts.swarm ? c.yellow : c.purple;
    const accentDim = opts.swarm ? c.dim : c.dim;

    // ── Build the label bar ─────────────────────────────────
    const leftLabel = opts.swarm
        ? ` ${c.boldYellow('SWARM')} `
        : ` ${c.boldPurple('velix')} `;

    const cwdPart = opts.cwd ? c.blue(` ${opts.cwd} `) : '';
    const tagPart = opts.tag ? c.dim(` ${opts.tag} `) : '';

    const leftContent = leftLabel + cwdPart;
    const leftLen = stripAnsi(leftContent);
    const rightLen = stripAnsi(tagPart);
    const midLen = Math.max(0, width - leftLen - rightLen - 2); // -2 for corners

    // Top border:  ╭─ velix  project ────────── claude:sonnet ─╮
    const topLine = accent(BOX.tl)
        + accent(BOX.h)
        + leftContent
        + accent(hLine(BOX.h, midLen))
        + tagPart
        + accent(BOX.h)
        + accent(BOX.tr);

    console.log(topLine);

    // Input row prefix — the left border + cursor space
    // (readline will draw the actual text after this)
    const inputPrefix = accent(BOX.v) + ' ';

    // We don't close the box here — readline occupies the middle.
    // The bottom border is drawn after the user presses Enter.
    process.stdout.write(inputPrefix);
}

/**
 * Draw the bottom border of the input box, optionally with a hint.
 */
export function drawInputBoxBottom(opts: InputBoxOptions = {}): void {
    const width = Math.min(termCols() - 2, 100);
    const accent = opts.swarm ? c.yellow : c.purple;

    if (opts.hint) {
        const hintText = c.dim(` ${opts.hint} `);
        const hintLen = stripAnsi(hintText);
        const remaining = Math.max(0, width - hintLen - 2);
        console.log(
            accent(BOX.bl) + accent(BOX.h) + hintText + accent(hLine(BOX.h, remaining)) + accent(BOX.h) + accent(BOX.br)
        );
    } else {
        console.log(accent(BOX.bl) + accent(hLine(BOX.h, width)) + accent(BOX.br));
    }
}

// ─── Response Frame ─────────────────────────────────────────

export interface ResponseFrameOptions {
    provider?: string;
    model?: string;
    duration?: number; // ms
    tokens?: number;
    swarm?: boolean;
}

/**
 * Wrap AI response content in a nice bordered frame.
 */
export function drawResponseFrame(content: string, opts: ResponseFrameOptions = {}): void {
    const width = Math.min(termCols() - 2, 100);
    const accent = opts.swarm ? c.yellow : c.purple;

    // Header
    const headerLabel = opts.swarm
        ? ` ${c.boldYellow('SWARM')} `
        : ` ${c.boldPurple('velix')} `;

    let rightInfo = '';
    if (opts.duration) {
        rightInfo += c.dim(` ${(opts.duration / 1000).toFixed(1)}s `);
    }
    if (opts.tokens) {
        rightInfo += c.dim(`${opts.tokens} tok `);
    }

    const headerLeftLen = stripAnsi(headerLabel);
    const rightInfoLen = stripAnsi(rightInfo);
    const headerMidLen = Math.max(0, width - headerLeftLen - rightInfoLen - 2);

    console.log(
        accent(BOX.tl) + accent(BOX.h) + headerLabel
        + accent(hLine(BOX.h, headerMidLen))
        + rightInfo + accent(BOX.h) + accent(BOX.tr)
    );

    // Content lines
    const lines = content.split('\n');
    for (const line of lines) {
        // Pad or truncate each line to fit in the box
        const printLen = stripAnsi(line);
        const padding = Math.max(0, width - printLen - 2); // -2 for border chars
        console.log(`${accent(BOX.v)} ${line}${' '.repeat(padding)}${accent(BOX.v)}`);
    }

    // Footer
    let footerInfo = '';
    if (opts.provider && opts.model) {
        footerInfo = c.dim(` ${opts.provider}:${opts.model} `);
    }
    const footerLen = stripAnsi(footerInfo);
    const footerRemaining = Math.max(0, width - footerLen - 2);
    console.log(
        accent(BOX.bl) + accent(BOX.h) + footerInfo
        + accent(hLine(BOX.h, footerRemaining))
        + accent(BOX.h) + accent(BOX.br)
    );
}

// ─── Status Bar ─────────────────────────────────────────────

export function drawStatusBar(items: Array<{ label: string; value: string }>): void {
    const width = Math.min(termCols() - 2, 100);
    const parts = items.map(({ label, value }) => `${c.dim(label + ':')} ${c.cyan(value)}`);
    const content = parts.join(c.dim('  │  '));
    const contentLen = stripAnsi(content);
    const padding = Math.max(0, width - contentLen - 4);

    console.log(c.dim(BOX.tl + hLine(BOX.h, width) + BOX.tr));
    console.log(`${c.dim(BOX.v)} ${content}${' '.repeat(padding)} ${c.dim(BOX.v)}`);
    console.log(c.dim(BOX.bl + hLine(BOX.h, width) + BOX.br));
}

// ─── Section Divider ────────────────────────────────────────

export function drawSection(title: string, accent: (s: string) => string = c.purple): void {
    const width = Math.min(termCols() - 2, 100);
    const titleFormatted = ` ${title} `;
    const titleLen = stripAnsi(titleFormatted);
    const remaining = Math.max(0, width - titleLen - 4);
    const left = Math.floor(remaining / 2);
    const right = remaining - left;

    console.log(
        accent(hLine(BOX.h, left + 2)) + c.bold(titleFormatted) + accent(hLine(BOX.h, right + 2))
    );
}

// ─── Thinking animation (inline, multi-step) ───────────────

const THINKING_STEPS = [
    'Reading project context...',
    'Analyzing your question...',
    'Generating response...',
];

export class ThinkingAnimation {
    private spinner: Spinner;
    private stepTimer: ReturnType<typeof setInterval> | null = null;
    private stepIdx = 0;

    constructor() {
        this.spinner = new Spinner(THINKING_STEPS[0], 'braille');
    }

    start(): void {
        this.stepIdx = 0;
        this.spinner.update(THINKING_STEPS[0]);
        this.spinner.start();
        this.stepTimer = setInterval(() => {
            this.stepIdx++;
            if (this.stepIdx < THINKING_STEPS.length) {
                this.spinner.update(THINKING_STEPS[this.stepIdx]);
            }
        }, 2000);
    }

    stop(): void {
        if (this.stepTimer) {
            clearInterval(this.stepTimer);
            this.stepTimer = null;
        }
        this.spinner.stop();
    }
}

// ─── User / Assistant message bubbles ───────────────────────

export function drawUserMessage(text: string): void {
    const width = Math.min(termCols() - 6, 96);
    const lines = wrapText(text, width);

    console.log();
    console.log(`  ${c.blue('you')}`);
    for (const line of lines) {
        console.log(`  ${c.dim(BOX.v)} ${line}`);
    }
}

export function drawAssistantHeader(): void {
    console.log();
    console.log(`  ${c.purple('velix')}`);
}

export function drawAssistantMessage(content: string, renderedContent: string, opts: ResponseFrameOptions = {}): void {
    const lines = renderedContent.split('\n');

    for (const line of lines) {
        console.log(`  ${c.dim(BOX.v)} ${line}`);
    }

    // Footer metadata
    const parts: string[] = [];
    if (opts.duration) parts.push(c.dim(`${(opts.duration / 1000).toFixed(1)}s`));
    if (opts.tokens) parts.push(c.dim(`${opts.tokens} tokens`));
    if (opts.provider && opts.model) parts.push(c.dim(`${opts.provider}:${opts.model}`));

    if (parts.length > 0) {
        console.log(`  ${c.dim(BOX.bl + BOX.h)} ${parts.join(c.dim(' · '))}`);
    }
}

// ─── Text wrapping helper ───────────────────────────────────

function wrapText(text: string, width: number): string[] {
    const result: string[] = [];
    for (const paragraph of text.split('\n')) {
        if (paragraph.length <= width) {
            result.push(paragraph);
            continue;
        }
        let remaining = paragraph;
        while (remaining.length > 0) {
            if (remaining.length <= width) {
                result.push(remaining);
                break;
            }
            let breakPoint = remaining.lastIndexOf(' ', width);
            if (breakPoint <= 0) breakPoint = width;
            result.push(remaining.slice(0, breakPoint));
            remaining = remaining.slice(breakPoint).trimStart();
        }
    }
    return result;
}

// ─── Welcome banner (improved) ──────────────────────────────

export function drawWelcomeBanner(provider: string, model: string, hasKey: boolean, cwd: string): void {
    const width = Math.min(termCols() - 2, 100);
    const accent = c.purple;

    // Top border
    console.log(accent(BOX.tl + hLine(BOX.h, width) + BOX.tr));

    // Logo (centered)
    const logoLines = [
        ' ██╗   ██╗███████╗██╗     ██╗██╗  ██╗',
        ' ██║   ██║██╔════╝██║     ██║╚██╗██╔╝',
        ' ██║   ██║█████╗  ██║     ██║ ╚███╔╝ ',
        ' ╚██╗ ██╔╝██╔══╝  ██║     ██║ ██╔██╗ ',
        '  ╚████╔╝ ███████╗███████╗██║██╔╝ ██╗',
        '   ╚═══╝  ╚══════╝╚══════╝╚═╝╚═╝  ╚═╝',
    ];

    for (const ll of logoLines) {
        const pad = Math.max(0, Math.floor((width - ll.length) / 2));
        const rpad = Math.max(0, width - pad - ll.length);
        console.log(`${accent(BOX.v)}${' '.repeat(pad)}${c.boldPurple(ll)}${' '.repeat(rpad)}${accent(BOX.v)}`);
    }

    // Subtitle
    const subtitle = 'Multi-provider AI coding assistant';
    const version = 'v0.1.0';
    const subLine = `${subtitle}  ${c.dim(version)}`;
    const subLen = subtitle.length + 2 + version.length;
    const subPad = Math.max(0, Math.floor((width - subLen) / 2));
    const subRPad = Math.max(0, width - subPad - subLen);
    console.log(`${accent(BOX.v)}${' '.repeat(subPad)}${c.dim(subtitle)}  ${c.dim(version)}${' '.repeat(subRPad)}${accent(BOX.v)}`);

    // Separator
    console.log(accent(BOX.ltee + hLine(BOX.h, width) + BOX.rtee));

    // Info rows
    const infoRows = [
        ['Provider', `${c.boldPurple(provider)}${c.dim(':')}${c.cyan(model)}`],
        ['API Key', hasKey ? c.green('● configured') : c.red('○ not set — run /config')],
        ['Project', c.blue(cwd)],
    ];

    for (const [label, value] of infoRows) {
        const labelStr = c.dim(`  ${label}:`);
        const labelLen = label.length + 4; // "  Label:"
        const valueLen = stripAnsi(value);
        const gap = Math.max(1, 14 - labelLen);
        const rowContent = `${labelStr}${' '.repeat(gap)}${value}`;
        const rowLen = labelLen + gap + valueLen;
        const rowPad = Math.max(0, width - rowLen);
        console.log(`${accent(BOX.v)}${rowContent}${' '.repeat(rowPad)}${accent(BOX.v)}`);
    }

    // Separator
    console.log(accent(BOX.ltee + hLine(BOX.h, width) + BOX.rtee));

    // Quick commands
    const cmdRows = [
        ['/help', 'Show all commands', '/swarm', 'Enter swarm mode'],
        ['/model', 'Switch AI model', '/config', 'Configure API keys'],
    ];
    for (const [c1, d1, c2, d2] of cmdRows) {
        const left = `  ${c.purple(c1.padEnd(8))} ${c.dim(d1)}`;
        const leftLen = 2 + 8 + 1 + d1.length;
        const gap = Math.max(2, 34 - leftLen);
        const right = `${c.purple(c2.padEnd(8))} ${c.dim(d2)}`;
        const rightLen = 8 + 1 + d2.length;
        const totalLen = leftLen + gap + rightLen;
        const rpad = Math.max(0, width - totalLen);
        console.log(`${accent(BOX.v)}${left}${' '.repeat(gap)}${right}${' '.repeat(rpad)}${accent(BOX.v)}`);
    }

    // Bottom border
    const tipText = ' Shift+Enter for multiline · Ctrl+C to interrupt ';
    const tipLen = tipText.length;
    const tipRemaining = Math.max(0, width - tipLen - 2);
    const tipLeft = Math.floor(tipRemaining / 2);
    const tipRight = tipRemaining - tipLeft;
    console.log(
        accent(BOX.bl) + accent(hLine(BOX.h, tipLeft + 1))
        + c.dim(tipText)
        + accent(hLine(BOX.h, tipRight + 1)) + accent(BOX.br)
    );

    console.log();
}
