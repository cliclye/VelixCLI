/**
 * Terminal styling and theme constants for VelixCLI.
 */
export declare const c: {
    purple: (s: string) => string;
    blue: (s: string) => string;
    cyan: (s: string) => string;
    green: (s: string) => string;
    yellow: (s: string) => string;
    red: (s: string) => string;
    gray: (s: string) => string;
    white: (s: string) => string;
    magenta: (s: string) => string;
    bold: (s: string) => string;
    dim: (s: string) => string;
    italic: (s: string) => string;
    underline: (s: string) => string;
    boldPurple: (s: string) => string;
    boldGreen: (s: string) => string;
    boldCyan: (s: string) => string;
    boldRed: (s: string) => string;
    boldYellow: (s: string) => string;
    boldBlue: (s: string) => string;
};
export declare const VELIX_LOGO: string;
export declare const DIVIDER: string;
export declare function formatProvider(provider: string, model: string): string;
export declare function formatPath(p: string): string;
export declare function formatTimestamp(): string;
/**
 * Simple markdown-to-terminal renderer.
 * Handles code blocks, bold, inline code, headers, and lists.
 */
export declare function renderMarkdown(text: string): string;
//# sourceMappingURL=theme.d.ts.map