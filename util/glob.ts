export const Glob = {
  async files(_pattern: string, _base?: string): Promise<string[]> {
    return []
  },
  async scan(_pattern: string, _options?: Record<string, unknown>): Promise<string[]> {
    return []
  },
}
