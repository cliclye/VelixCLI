// Session API stubs for Velix

export interface VelixSession {
  id: string
  title?: string
  time: {
    created: number
    updated: number
    compacting?: number
  }
}

export const Session = {
  async list(): Promise<VelixSession[]> {
    return []
  },

  async create(input: { prompt?: string }): Promise<VelixSession> {
    return {
      id: crypto.randomUUID(),
      title: input.prompt?.slice(0, 50),
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    }
  },

  isDefaultTitle(title?: string): boolean {
    return !title
  },
}
