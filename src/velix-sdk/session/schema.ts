import { z } from "zod"

export const SessionID = {
  zod: z.string(),
  parse(value: string): string {
    return value
  },
}

export const MessageID = {
  zod: z.string(),
  parse(value: string): string {
    return value
  },
}

export const PartID = {
  zod: z.string(),
  parse(value: string): string {
    return value
  },
}

export type SessionIDType = string
export type MessageIDType = string
export type PartIDType = string
