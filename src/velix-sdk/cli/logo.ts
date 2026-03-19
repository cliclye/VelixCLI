// Shadow markers for the logo renderer:
// _ = full shadow cell (space with bg=shadow)
// ^ = letter top, shadow bottom (▀ with fg=letter, bg=shadow)
// ~ = shadow top only (▀ with fg=shadow)
// We use different markers so our logo text can use normal ASCII freely
export const marks = "\u00b9\u00b2\u00b3" // ¹²³ - won't appear in logo text

// Velix logo using Unicode block characters
// Left side: dimmed (textMuted), Right side: bright (text)
// Both arrays must be the same length
export const logo = {
  left: [
    "   ",
    "   ",
    "   ",
    "   ",
    "   ",
    "   ",
  ],
  right: [
    "██╗   ██╗███████╗██╗     ██╗██╗  ██╗",
    "██║   ██║██╔════╝██║     ██║╚██╗██╔╝",
    "██║   ██║█████╗  ██║     ██║ ╚███╔╝ ",
    "╚██╗ ██╔╝██╔══╝  ██║     ██║ ██╔██╗ ",
    " ╚████╔╝ ███████╗███████╗██║██╔╝ ██╗",
    "  ╚═══╝  ╚══════╝╚══════╝╚═╝╚═╝  ╚═╝",
  ],
}
