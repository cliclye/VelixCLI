import os from "os"
import path from "path"

const home = os.homedir()
const configDir = path.join(home, ".config", "velix")
const stateDir = path.join(home, ".local", "share", "velix")

export const Global = {
  Path: {
    home,
    config: configDir,
    state: stateDir,
    data: stateDir,
    worktree: process.cwd(),
    directory: process.cwd(),
  },
}
