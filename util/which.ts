import { execSync } from "child_process"

export function which(cmd: string): string | null {
  try {
    const result = execSync(`which ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim()
    return result || null
  } catch {
    return null
  }
}
