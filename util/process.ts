import { execFile, spawn as nodeSpawn } from "child_process"
import type { SpawnOptions } from "child_process"

interface RunOptions {
  nothrow?: boolean
}

interface RunResult {
  stdout: Buffer
  stderr: Buffer
  exitCode: number
}

interface TextResult {
  text: string
}

interface SpawnedProcess {
  stdin: NodeJS.WritableStream | null
  stdout: NodeJS.ReadableStream | null
  exited: Promise<number>
}

export const Process = {
  async run(cmd: string[], options: RunOptions = {}): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const [bin, ...args] = cmd
      execFile(bin, args, { encoding: "buffer" }, (err, stdout, stderr) => {
        if (err && !options.nothrow) {
          reject(err)
          return
        }
        resolve({
          stdout: stdout ?? Buffer.alloc(0),
          stderr: stderr ?? Buffer.alloc(0),
          exitCode: err?.code !== undefined ? Number(err.code) : 0,
        })
      })
    })
  },

  async text(cmd: string[], options: RunOptions = {}): Promise<TextResult> {
    const result = await Process.run(cmd, options)
    return { text: result.stdout.toString("utf-8") }
  },

  spawn(
    cmd: string[],
    options: { stdin?: "pipe" | "ignore"; stdout?: "pipe" | "ignore"; stderr?: "pipe" | "ignore" } = {},
  ): SpawnedProcess {
    const [bin, ...args] = cmd
    const spawnOptions: SpawnOptions = {
      stdio: [
        options.stdin ?? "inherit",
        options.stdout ?? "inherit",
        options.stderr ?? "inherit",
      ],
    }
    const child = nodeSpawn(bin, args, spawnOptions)
    const exited = new Promise<number>((resolve) => {
      child.on("exit", (code) => resolve(code ?? 0))
      child.on("error", () => resolve(1))
    })
    return { stdin: child.stdin, stdout: child.stdout, exited }
  },
}
