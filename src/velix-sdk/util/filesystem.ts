import { readFile, writeFile, mkdir } from "fs/promises"
import path from "path"

export const Filesystem = {
  async readJson<T = any>(filePath: string): Promise<T> {
    const content = await readFile(filePath, "utf-8")
    return JSON.parse(content) as T
  },

  async writeJson(filePath: string, data: any): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8")
  },

  async write(filePath: string, content: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content, "utf-8")
  },

  async readText(filePath: string): Promise<string> {
    return readFile(filePath, "utf-8")
  },

  async readBytes(filePath: string): Promise<Buffer> {
    return Buffer.from(await readFile(filePath))
  },
}
