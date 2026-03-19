/// <reference types="node" />
/// <reference types="node" />
export declare const Filesystem: {
    readJson<T = any>(filePath: string): Promise<T>;
    writeJson(filePath: string, data: any): Promise<void>;
    write(filePath: string, content: string): Promise<void>;
    readText(filePath: string): Promise<string>;
    readBytes(filePath: string): Promise<Buffer>;
};
//# sourceMappingURL=filesystem.d.ts.map