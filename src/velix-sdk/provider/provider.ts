export const Provider = {
  parseModel(str: string): { providerID: string; modelID: string } {
    const idx = str.indexOf("/")
    if (idx === -1) return { providerID: str, modelID: str }
    return {
      providerID: str.slice(0, idx),
      modelID: str.slice(idx + 1),
    }
  },
}
