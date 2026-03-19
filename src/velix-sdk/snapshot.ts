export namespace Snapshot {
  export interface FileDiff {
    file: string
    added: number
    removed: number
    patch: string
  }
}
