import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
export const Filesystem = {
    async readJson(filePath) {
        const content = await readFile(filePath, "utf-8");
        return JSON.parse(content);
    },
    async writeJson(filePath, data) {
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    },
    async write(filePath, content) {
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, content, "utf-8");
    },
    async readText(filePath) {
        return readFile(filePath, "utf-8");
    },
    async readBytes(filePath) {
        return Buffer.from(await readFile(filePath));
    },
};
//# sourceMappingURL=filesystem.js.map