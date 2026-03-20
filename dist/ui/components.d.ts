/**
 * UI components for Velix CLI - Clean, stable terminal UI like Claude Code.
 */
export declare function getWidth(): number;
export declare function updateWidth(): void;
export declare function stripAnsi(s: string): number;
declare const DIVIDER_CHARS: {
    light: string;
    heavy: string;
    dotted: string;
};
export declare function divider(char?: keyof typeof DIVIDER_CHARS): string;
export declare class Spinner {
    private interval;
    private frame;
    private label;
    constructor(label?: string);
    start(): void;
    private render;
    stop(message?: string): void;
}
export declare function printUserMessage(text: string): void;
export declare function printAssistantMessage(text: string): void;
export declare function section(title: string): void;
export declare function statusBar(items: Array<{
    label: string;
    value: string;
}>): void;
export declare function inputHint(text: string): void;
export {};
//# sourceMappingURL=components.d.ts.map