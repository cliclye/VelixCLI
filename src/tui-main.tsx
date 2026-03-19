/**
 * Velix TUI Entry Point
 * Uses @opentui/solid as the terminal rendering framework,
 * built on the Velix CLI base with Velix's AI engine.
 */
import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { Switch, Match, ErrorBoundary, on, createEffect, Show } from "solid-js"
import type { Args } from "../cli/cmd/tui/context/args"
import { ArgsProvider } from "../cli/cmd/tui/context/args"
import { ExitProvider } from "../cli/cmd/tui/context/exit"
import { KVProvider } from "../cli/cmd/tui/context/kv"
import { ToastProvider, useToast } from "../cli/cmd/tui/ui/toast"
import { RouteProvider, useRoute } from "../cli/cmd/tui/context/route"
import { TuiConfigProvider } from "../cli/cmd/tui/context/tui-config"
import { SDKProvider } from "../cli/cmd/tui/context/sdk"
import { SyncProvider, useSync } from "../cli/cmd/tui/context/sync"
import { ThemeProvider, useTheme } from "../cli/cmd/tui/context/theme"
import { LocalProvider } from "../cli/cmd/tui/context/local"
import { KeybindProvider } from "../cli/cmd/tui/context/keybind"
import { PromptStashProvider } from "../cli/cmd/tui/component/prompt/stash"
import { DialogProvider } from "../cli/cmd/tui/ui/dialog"
import { CommandProvider } from "../cli/cmd/tui/component/dialog-command"
import { FrecencyProvider } from "../cli/cmd/tui/component/prompt/frecency"
import { PromptHistoryProvider } from "../cli/cmd/tui/component/prompt/history"
import { PromptRefProvider } from "../cli/cmd/tui/context/prompt"
import { Home } from "../cli/cmd/tui/routes/home"
import { Clipboard } from "../cli/cmd/tui/util/clipboard"
import { Selection } from "../cli/cmd/tui/util/selection"
import { Flag } from "./velix-sdk/flag/flag"
import { TuiConfig } from "./velix-sdk/config/tui"
import { TextAttributes, RGBA } from "@opentui/core"
import { Installation } from "./velix-sdk/installation"

// Simple VelixChat component for the session screen
function VelixChat() {
  const route = useRoute()
  const sync = useSync()
  const { theme } = useTheme()

  const sessionID = () => (route.data.type === "session" ? route.data.sessionID : "")

  const messages = () => sync.data.message[sessionID()] ?? []
  const parts = (msgID: string) => sync.data.part[msgID] ?? []

  const sessionStatus = () => sync.session.status(sessionID())

  useKeyboard((evt) => {
    if (evt.name === "escape" && !evt.ctrl) {
      route.navigate({ type: "home" })
      evt.preventDefault()
    }
  })

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      paddingLeft={2}
      paddingRight={2}
    >
      {/* Header */}
      <box
        flexDirection="row"
        flexShrink={0}
        paddingTop={1}
        paddingBottom={1}
        borderBottom={true}
        borderColor={theme.border}
      >
        <text fg={theme.textMuted}>Velix </text>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Chat
        </text>
        <box flexGrow={1} />
        <Show when={sessionStatus() === "working"}>
          <text fg={theme.warning}> thinking...</text>
        </Show>
        <text fg={theme.textMuted}> esc to go back</text>
      </box>

      {/* Messages */}
      <box flexGrow={1} flexDirection="column" overflowY="scroll" paddingTop={1} paddingBottom={1}>
        {messages().map((msg) => {
          const msgParts = parts(msg.id)
          const text = msgParts
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("")

          return (
            <box flexDirection="column" marginBottom={1}>
              <text fg={msg.role === "user" ? theme.primary : theme.accent} attributes={TextAttributes.BOLD}>
                {msg.role === "user" ? "You" : "Velix"}
              </text>
              <text fg={theme.text} wrapMode="word" width="100%">
                {text}
              </text>
            </box>
          )
        })}
      </box>

      {/* Footer */}
      <box
        flexShrink={0}
        paddingTop={1}
        borderTop={true}
        borderColor={theme.border}
      >
        <text fg={theme.textMuted}>
          press{" "}
          <span style={{ fg: theme.text }}>esc</span>
          {" "}to return home •{" "}
          <span style={{ fg: theme.text }}>Velix {Installation.VERSION}</span>
        </text>
      </box>
    </box>
  )
}

// Main Velix App component
function VelixApp() {
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  renderer.disableStdoutInterception()
  const toast = useToast()
  const sync = useSync()

  useKeyboard((evt) => {
    if (!Flag.VELIX_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
    if (!renderer.getSelection()) return
    if (evt.ctrl && evt.name === "c") {
      if (!Selection.copy(renderer, toast)) {
        renderer.clearSelection()
        return
      }
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if (evt.name === "escape") {
      renderer.clearSelection()
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    renderer.clearSelection()
  })

  renderer.console.onCopySelection = async (text: string) => {
    if (!text || text.length === 0) return
    await Clipboard.copy(text)
      .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
      .catch(toast.error)
    renderer.clearSelection()
  }

  // Show provider setup if no providers configured
  createEffect(
    on(
      () => sync.status === "complete" && sync.data.provider.length === 0,
      (isEmpty, wasEmpty) => {
        if (!isEmpty || wasEmpty) return
        toast.show({
          variant: "warning",
          message: "No providers configured. Run 'velix --config' to set up API keys.",
          duration: 8000,
        })
      },
    ),
  )

  return (
    <box width={dimensions().width} height={dimensions().height} flexDirection="column">
      <Switch>
        <Match when={route.data.type === "home"}>
          <Home />
        </Match>
        <Match when={route.data.type === "session"}>
          <VelixChat />
        </Match>
      </Switch>
    </box>
  )
}

// Error display component
function ErrorComponent(props: {
  error: unknown
  reset: () => void
  onExit: () => Promise<void>
  mode: "dark" | "light"
}) {
  const message = props.error instanceof Error ? props.error.message : String(props.error)

  useKeyboard((evt) => {
    if (evt.name === "escape" || (evt.ctrl && evt.name === "c")) {
      props.onExit()
    }
  })

  return (
    <box
      flexDirection="column"
      padding={2}
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent="center"
    >
      <text fg={RGBA.fromHex("#ff6b6b")} attributes={TextAttributes.BOLD}>
        Velix TUI Error
      </text>
      <box height={1} />
      <text fg={RGBA.fromHex("#ffffff")} wrapMode="word" maxWidth={80}>
        {message}
      </text>
      <box height={1} />
      <text fg={RGBA.fromHex("#888888")}>
        Press Escape or Ctrl+C to exit
      </text>
    </box>
  )
}

async function getTerminalBackgroundColor(): Promise<"dark" | "light"> {
  if (!process.stdin.isTTY) return "dark"

  return new Promise((resolve) => {
    let timeout: NodeJS.Timeout

    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.removeListener("data", handler)
      clearTimeout(timeout)
    }

    const handler = (data: Buffer) => {
      const str = data.toString()
      const match = str.match(/\x1b]11;([^\x07\x1b]+)/)
      if (match) {
        cleanup()
        const color = match[1]
        let r = 0, g = 0, b = 0

        if (color.startsWith("rgb:")) {
          const parts = color.substring(4).split("/")
          r = parseInt(parts[0], 16) >> 8
          g = parseInt(parts[1], 16) >> 8
          b = parseInt(parts[2], 16) >> 8
        } else if (color.startsWith("#")) {
          r = parseInt(color.substring(1, 3), 16)
          g = parseInt(color.substring(3, 5), 16)
          b = parseInt(color.substring(5, 7), 16)
        }

        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        resolve(luminance > 0.5 ? "light" : "dark")
      }
    }

    process.stdin.setRawMode(true)
    process.stdin.on("data", handler)
    process.stdout.write("\x1b]11;?\x07")

    timeout = setTimeout(() => {
      cleanup()
      resolve("dark")
    }, 1000)
  })
}

export async function tui(args: Args = {}) {
  return new Promise<void>(async (resolve) => {
    const mode = await getTerminalBackgroundColor()
    const config = TuiConfig.defaults

    const onExit = async () => {
      resolve()
    }

    render(
      () => (
        <ErrorBoundary
          fallback={(error, reset) => (
            <ErrorComponent error={error} reset={reset} onExit={onExit} mode={mode} />
          )}
        >
          <ArgsProvider {...args}>
            <ExitProvider onExit={onExit}>
              <KVProvider>
                <ToastProvider>
                  <RouteProvider>
                    <TuiConfigProvider config={config}>
                      <SDKProvider directory={process.cwd()}>
                        <SyncProvider>
                          <ThemeProvider mode={mode}>
                            <LocalProvider>
                              <KeybindProvider>
                                <PromptStashProvider>
                                  <DialogProvider>
                                    <CommandProvider>
                                      <FrecencyProvider>
                                        <PromptHistoryProvider>
                                          <PromptRefProvider>
                                            <VelixApp />
                                          </PromptRefProvider>
                                        </PromptHistoryProvider>
                                      </FrecencyProvider>
                                    </CommandProvider>
                                  </DialogProvider>
                                </PromptStashProvider>
                              </KeybindProvider>
                            </LocalProvider>
                          </ThemeProvider>
                        </SyncProvider>
                      </SDKProvider>
                    </TuiConfigProvider>
                  </RouteProvider>
                </ToastProvider>
              </KVProvider>
            </ExitProvider>
          </ArgsProvider>
        </ErrorBoundary>
      ),
      {
        targetFps: 60,
        gatherStats: false,
        exitOnCtrlC: false,
        useKittyKeyboard: {},
        autoFocus: false,
        openConsoleOnError: false,
      },
    )
  })
}

// CLI entry point - run directly with bun
if (import.meta.main) {
  tui().then(() => process.exit(0))
}
