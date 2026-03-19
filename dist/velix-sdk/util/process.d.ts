/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
export declare function onExit(handler: () => void): void;
interface RunOptions {
    nothrow?: boolean;
}
interface RunResult {
    stdout: Buffer;
    stderr: Buffer;
    exitCode: number;
}
interface SpawnedProcess {
    stdin: NodeJS.WritableStream | null;
    stdout: NodeJS.ReadableStream | null;
    exited: Promise<number>;
}
export declare const Process: {
    run(cmd: string[], options?: RunOptions): Promise<RunResult>;
    text(cmd: string[], options?: RunOptions): Promise<{
        text: string;
    }>;
    spawn(cmd: string[], options?: {
        stdin?: "pipe" | "ignore" | "inherit";
        stdout?: "pipe" | "ignore" | "inherit";
        stderr?: "pipe" | "ignore" | "inherit";
        shell?: boolean;
    }): SpawnedProcess;
};
export {};
//# sourceMappingURL=process.d.ts.map