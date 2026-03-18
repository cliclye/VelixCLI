/**
 * Tool operations - file I/O, shell execution, search, and git operations.
 * These are the capabilities available to the AI and the user.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync, exec } from 'node:child_process';

// ─── File Operations ───────────────────────────────────────

export function readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
}

export function writeFile(filePath: string, content: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
}

export function editFile(filePath: string, oldStr: string, newStr: string): boolean {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content.includes(oldStr)) return false;
    const updated = content.replace(oldStr, newStr);
    fs.writeFileSync(filePath, updated, 'utf-8');
    return true;
}

export function deleteFile(filePath: string): void {
    fs.unlinkSync(filePath);
}

export function fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
}

// ─── Directory Operations ───────────────────────────────────

export function listDir(dirPath: string): string[] {
    return fs.readdirSync(dirPath, { withFileTypes: true }).map(entry => {
        return entry.isDirectory() ? entry.name + '/' : entry.name;
    });
}

const SKIP_DIRS = new Set([
    'node_modules', '.git', 'target', 'dist', 'build',
    '.next', '.cache', '__pycache__', 'coverage', '.turbo',
]);

export function walkDir(dir: string, base: string, files: string[] = []): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return files;
    }

    for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.isDirectory()) continue;
        if (SKIP_DIRS.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkDir(fullPath, base, files);
        } else {
            const rel = path.relative(base, fullPath);
            files.push(rel);
        }
    }
    return files;
}

// ─── Search ────────────────────────────────────────────────

export interface SearchMatch {
    file: string;
    line: number;
    column: number;
    text: string;
}

export function searchInFiles(directory: string, pattern: string, maxResults = 100): SearchMatch[] {
    const matches: SearchMatch[] = [];
    const files = walkDir(directory, directory);
    const lowerPattern = pattern.toLowerCase();

    for (const file of files) {
        if (matches.length >= maxResults) break;
        const fullPath = path.join(directory, file);

        let content: string;
        try {
            content = fs.readFileSync(fullPath, 'utf-8');
        } catch {
            continue;
        }

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (matches.length >= maxResults) break;
            const col = lines[i].toLowerCase().indexOf(lowerPattern);
            if (col !== -1) {
                matches.push({ file, line: i + 1, column: col + 1, text: lines[i] });
            }
        }
    }

    return matches;
}

// ─── Shell Execution ───────────────────────────────────────

export interface ShellResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export function execShell(command: string, cwd?: string): ShellResult {
    try {
        const stdout = execSync(command, {
            cwd: cwd || process.cwd(),
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
            timeout: 120_000,
            env: { ...process.env, TERM: 'xterm-256color', LANG: 'en_US.UTF-8' },
        });
        return { stdout, stderr: '', exitCode: 0 };
    } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; status?: number };
        return {
            stdout: e.stdout ?? '',
            stderr: e.stderr ?? String(err),
            exitCode: e.status ?? 1,
        };
    }
}

export function execShellAsync(command: string, cwd?: string): Promise<ShellResult> {
    return new Promise((resolve) => {
        exec(command, {
            cwd: cwd || process.cwd(),
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
            timeout: 120_000,
            env: { ...process.env, TERM: 'xterm-256color', LANG: 'en_US.UTF-8' },
        }, (err, stdout, stderr) => {
            resolve({
                stdout: stdout ?? '',
                stderr: stderr ?? '',
                exitCode: err ? (err as unknown as { code?: number }).code ?? 1 : 0,
            });
        });
    });
}

// ─── Git Operations ────────────────────────────────────────

export function gitStatus(cwd?: string): string {
    return execShell('git status --short', cwd).stdout;
}

export function gitDiff(cwd?: string, staged = false): string {
    const cmd = staged ? 'git diff --cached' : 'git diff';
    return execShell(cmd, cwd).stdout;
}

export function gitLog(cwd?: string, count = 10): string {
    return execShell(`git log --oneline -n ${count}`, cwd).stdout;
}

export function gitBranch(cwd?: string): string {
    return execShell('git branch --no-color', cwd).stdout;
}

// ─── Project Context ───────────────────────────────────────

const SOURCE_EXTENSIONS = new Set([
    'ts', 'tsx', 'js', 'jsx', 'css', 'html', 'json', 'rs', 'toml',
    'py', 'go', 'java', 'c', 'cpp', 'h', 'swift', 'yaml', 'yml',
    'sh', 'sql', 'md', 'vue', 'svelte', 'rb', 'php',
]);

export function readProjectSources(directory: string, maxTotalChars = 80_000): Record<string, string> {
    const files = walkDir(directory, directory);
    const result: Record<string, string> = {};
    let totalSize = 0;

    for (const file of files) {
        if (totalSize >= maxTotalChars) break;
        const ext = path.extname(file).replace('.', '');
        if (!SOURCE_EXTENSIONS.has(ext)) continue;

        const fullPath = path.join(directory, file);
        try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            if (content.length > 10_000) continue; // skip large files
            result[file] = content;
            totalSize += content.length;
        } catch {
            // skip unreadable files
        }
    }

    return result;
}
