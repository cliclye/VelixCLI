export function lazy<T>(fn: () => T): () => T {
  let evaluated = false
  let result: T
  return () => {
    if (!evaluated) {
      result = fn()
      evaluated = true
    }
    return result
  }
}
