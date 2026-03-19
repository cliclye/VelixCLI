/**
 * Tool operations - file I/O, shell execution, search, and git operations.
 * These are the capabilities available to the AI and the user.
 */
export declare function readFile(filePath: string): string;
export declare function writeFile(filePath: string, content: string): void;
export declare function editFile(filePath: string, oldStr: string, newStr: string): boolean;
export declare function deleteFile(filePath: string): void;
export declare function fileExists(filePath: string): boolean;
export declare function listDir(dirPath: string): string[];
export declare function walkDir(dir: string, base: string, files?: string[]): string[];
export interface SearchMatch {
    file: string;
    line: number;
    column: number;
    text: string;
}
export declare function searchInFiles(directory: string, pattern: string, maxResults?: number, options?: {
    glob?: string;
}): SearchMatch[];
export interface ShellResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
export declare function execShell(command: string, cwd?: string): ShellResult;
export declare function execShellAsync(command: string, cwd?: string): Promise<ShellResult>;
export declare function gitStatus(cwd?: string): string;
export declare function gitDiff(cwd?: string, staged?: boolean): string;
export declare function gitLog(cwd?: string, count?: number): string;
export declare function gitBranch(cwd?: string): string;
export declare function readProjectSources(directory: string, maxTotalChars?: number): Record<string, string>;
//# sourceMappingURL=index.d.ts.map