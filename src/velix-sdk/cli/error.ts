export function FormatError(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message
  }
  return undefined
}

export function FormatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
