import fs from "fs/promises"

export const Filesystem = {
  async readBytes(filePath: string): Promise<Buffer> {
    return Buffer.from(await fs.readFile(filePath))
  },

  async readJson<T>(filePath: string): Promise<T> {
    const data = await fs.readFile(filePath, "utf-8")
    return JSON.parse(data) as T
  },

  async writeJson(filePath: string, data: unknown): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2))
  },
}
