export type ParsedKey = {
  name: string
  ctrl?: boolean
  meta?: boolean
  alt?: boolean
  shift?: boolean
  super?: boolean
}

export namespace Keybind {
  export interface Info {
    name: string
    ctrl?: boolean
    meta?: boolean
    alt?: boolean
    shift?: boolean
    super?: boolean
    leader?: boolean
  }

  export function parse(value: string): Info[] {
    if (!value || value === "none") return []

    const info: Info = { name: "" }
    const lower = value.toLowerCase()

    // Handle space-separated chord: "ctrl+x c" -> parse as one sequence
    // We just parse the simple single keybind for now
    const parts = lower.split("+")

    for (const part of parts) {
      const trimmed = part.trim()
      if (trimmed === "ctrl") info.ctrl = true
      else if (trimmed === "meta" || trimmed === "alt") info.meta = true
      else if (trimmed === "shift") info.shift = true
      else if (trimmed === "super") info.super = true
      else if (trimmed === "<leader>" || trimmed === "leader") info.leader = true
      else if (trimmed) info.name = trimmed
    }

    if (!info.name) return []
    return [info]
  }

  export function fromParsedKey(evt: ParsedKey, leader: boolean): Info {
    return {
      name: evt.name,
      ctrl: evt.ctrl || undefined,
      meta: evt.meta || undefined,
      alt: (evt as any).alt || undefined,
      shift: evt.shift || undefined,
      super: (evt as any).super || undefined,
      leader: leader || undefined,
    }
  }

  export function match(a: Info, b: Info): boolean {
    return (
      a.name === b.name &&
      !!a.ctrl === !!b.ctrl &&
      !!a.meta === !!b.meta &&
      !!a.alt === !!b.alt &&
      !!a.shift === !!b.shift &&
      !!a.super === !!b.super &&
      !!a.leader === !!b.leader
    )
  }

  export function toString(info: Info): string {
    const parts: string[] = []
    if (info.leader) parts.push("<leader>")
    if (info.ctrl) parts.push("ctrl")
    if (info.meta) parts.push("meta")
    if (info.shift) parts.push("shift")
    if (info.super) parts.push("super")
    parts.push(info.name)
    return parts.join("+")
  }
}
