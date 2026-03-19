// Local compatibility shim for the Velix SDK base package.

export interface Path {
  state: string
  config: string
  worktree: string
  directory: string
}

export { createVelixClient, type VelixClient } from "./velix-sdk-v2"
