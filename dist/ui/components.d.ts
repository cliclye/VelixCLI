/**
 * UI components for the Velix CLI — bordered input box, spinner, response frame, status bar.
 */
/// <reference types="node" />
import readline from 'node:readline';
export declare class Spinner {
    private timer;
    private frameIdx;
    private label;
    private frames;
    constructor(label?: string, style?: 'braille' | 'dots' | 'pulse');
    start(): void;
    private render;
    stop(finalMessage?: string): void;
    update(label: string): void;
}
/**
 * Draw a full-width horizontal rule.
 * The submit hint is rendered on the input row, not in this divider.
 */
export declare function drawInputDivider(swarm?: boolean, showHint?: boolean): void;
/**
 * Draw a right-aligned submit hint on the current input row while preserving the cursor.
 */
export declare function drawInputSideHint(rl: readline.Interface): void;
/**
 * Call this immediately AFTER rl.prompt() to paint a bottom border one row
 * below the rendered input area using cursor save/restore.
 */
export declare function drawInputBoxBorder(rl: readline.Interface, swarm?: boolean): void;
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
export declare function drawInputBox(opts?: InputBoxOptions): void;
/**
 * Draw the bottom border of the input box, optionally with a hint.
 */
export declare function drawInputBoxBottom(opts?: InputBoxOptions): void;
export interface ResponseFrameOptions {
    provider?: string;
    model?: string;
    duration?: number;
    tokens?: number;
    swarm?: boolean;
}
/**
 * Wrap AI response content in a nice bordered frame.
 */
export declare function drawResponseFrame(content: string, opts?: ResponseFrameOptions): void;
export declare function drawStatusBar(items: Array<{
    label: string;
    value: string;
}>): void;
export declare function drawSection(title: string, accent?: (s: string) => string): void;
export declare class ThinkingAnimation {
    private spinner;
    private stepTimer;
    private stepIdx;
    constructor();
    start(): void;
    stop(): void;
}
export declare function drawUserMessage(text: string): void;
export declare function drawAssistantHeader(): void;
export declare function drawAssistantMessage(content: string, renderedContent: string, opts?: ResponseFrameOptions): void;
export declare function drawWelcomeBanner(provider: string, model: string, hasKey: boolean, cwd: string): void;
//# sourceMappingURL=components.d.ts.map