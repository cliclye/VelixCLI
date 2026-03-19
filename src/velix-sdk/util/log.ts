export const Log = {
  Default: {
    error(_message: string, _data?: Record<string, unknown>) {
      // Silent in TUI mode - errors handled via toast/exit
    },
    info(_message: string, _data?: Record<string, unknown>) {
      // noop
    },
    warn(_message: string, _data?: Record<string, unknown>) {
      // noop
    },
  },
}
