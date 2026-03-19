/**
 * Velix Sync Context - replaces Velix's sync context
 * Builds provider/agent/session data from Velix's config and AI engine
 */
import { createStore, produce, reconcile } from "solid-js/store"
import { useSDK } from "@tui/context/sdk"
import { createSimpleContext } from "./helper"
import type { Snapshot } from "@/snapshot"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, onMount } from "solid-js"
import { Log } from "@/util/log"
import type {
  Agent,
  Config,
  McpStatus,
  McpResource,
  LspStatus,
  FormatterStatus,
  SessionStatus,
  VcsInfo,
  Provider,
  Message,
  Part,
  Session,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  ProviderListResponse,
  ProviderAuthMethod,
  Workspace,
} from "@velix-ai/sdk/v2"

interface SyncStore {
  status: "loading" | "partial" | "complete"
  provider: Provider[]
  provider_default: Record<string, string>
  provider_next: ProviderListResponse
  provider_auth: Record<string, ProviderAuthMethod[]>
  agent: Agent[]
  command: Command[]
  permission: { [sessionID: string]: PermissionRequest[] }
  question: { [sessionID: string]: QuestionRequest[] }
  config: Config
  session: Session[]
  session_status: { [sessionID: string]: SessionStatus }
  session_diff: { [sessionID: string]: Snapshot.FileDiff[] }
  todo: { [sessionID: string]: Todo[] }
  message: { [sessionID: string]: Message[] }
  part: { [messageID: string]: Part[] }
  lsp: LspStatus[]
  mcp: { [key: string]: McpStatus }
  mcp_resource: { [key: string]: McpResource }
  formatter: FormatterStatus[]
  vcs: VcsInfo | undefined
  path: { state: string; config: string; worktree: string; directory: string }
  workspaceList: Workspace[]
}

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<SyncStore>({
      provider_next: { all: [], default: {}, connected: [] },
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
      path: { state: "", config: "", worktree: "", directory: "" },
      workspaceList: [],
    })

    const sdk = useSDK()
    const exit = useExit()
    const args = useArgs()

    // Listen for events from the Velix SDK
    sdk.event.listen((e) => {
      const event = e.details as any
      switch (event.type) {
        case "session.updated": {
          const session = event.properties.info as Session
          const result = findIndex(store.session, session.id, (s) => s.id)
          if (result.found) {
            setStore("session", result.index, reconcile(session))
          } else {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 0, session)
              }),
            )
          }
          break
        }

        case "session.deleted": {
          const session = event.properties.info as Session
          const result = findIndex(store.session, session.id, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }

        case "session.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status)
          break
        }

        case "message.updated": {
          const msg = event.properties.info as Message
          const messages = store.message[msg.sessionID]
          if (!messages) {
            setStore("message", msg.sessionID, [msg])
            break
          }
          const result = findIndex(messages, msg.id, (m) => m.id)
          if (result.found) {
            setStore("message", msg.sessionID, result.index, reconcile(msg))
          } else {
            setStore(
              "message",
              msg.sessionID,
              produce((draft) => {
                draft.splice(result.index, 0, msg)
              }),
            )
          }
          break
        }

        case "message.part.updated": {
          const part = event.properties.part as Part
          const parts = store.part[(part as any).messageID]
          if (!parts) {
            setStore("part", (part as any).messageID, [part])
            break
          }
          const result = findIndex(parts, part.id, (p) => p.id)
          if (result.found) {
            setStore("part", (part as any).messageID, result.index, reconcile(part))
          } else {
            setStore(
              "part",
              (part as any).messageID,
              produce((draft) => {
                draft.splice(result.index, 0, part)
              }),
            )
          }
          break
        }

        case "message.part.delta": {
          const parts = store.part[event.properties.messageID]
          if (!parts) break
          const result = findIndex(parts, event.properties.partID, (p) => p.id)
          if (!result.found) break
          setStore(
            "part",
            event.properties.messageID,
            produce((draft) => {
              const part = draft[result.index] as any
              const existing = part[event.properties.field] as string | undefined
              part[event.properties.field] = (existing ?? "") + event.properties.delta
            }),
          )
          break
        }

        case "message.removed": {
          const messages = store.message[event.properties.sessionID]
          if (!messages) break
          const result = findIndex(messages, event.properties.messageID, (m) => m.id)
          if (result.found) {
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }

        case "message.part.removed": {
          const parts = store.part[event.properties.messageID]
          if (!parts) break
          const result = findIndex(parts, event.properties.partID, (p) => p.id)
          if (result.found) {
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }

        case "vcs.branch.updated": {
          setStore("vcs", { branch: event.properties.branch })
          break
        }
      }
    })

    async function bootstrap() {
      try {
        const [providersResponse, providerListResponse, agentsResponse, configResponse, pathResponse] =
          await Promise.all([
            sdk.client.config.providers(),
            sdk.client.provider.list(),
            sdk.client.app.agents(),
            sdk.client.config.get(),
            sdk.client.path.get(),
          ])

        batch(() => {
          const providersData = providersResponse.data!
          setStore("provider", reconcile((providersData as any).providers ?? []))
          setStore("provider_default", reconcile((providersData as any).default ?? {}))
          setStore("provider_next", reconcile(providerListResponse.data!))
          setStore("agent", reconcile(agentsResponse.data ?? []))
          setStore("config", reconcile(configResponse.data!))
          setStore("path", reconcile(pathResponse.data!))
        })

        setStore("status", "partial")

        // Non-blocking secondary data
        Promise.all([
          sdk.client.mcp.status().then((x) => setStore("mcp", reconcile((x.data as any) ?? {}))),
          sdk.client.lsp.status().then((x) => setStore("lsp", reconcile((x.data as any) ?? []))),
          sdk.client.vcs.get().then((x) => {
            const vcs = x.data as any
            if (vcs) setStore("vcs", reconcile(vcs))
          }),
        ]).then(() => {
          setStore("status", "complete")
        })
      } catch (e) {
        Log.Default.error("velix tui bootstrap failed", {
          error: e instanceof Error ? e.message : String(e),
        })
        await exit(e)
      }
    }

    onMount(() => {
      bootstrap()
    })

    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        return store.status !== "loading"
      },
      session: {
        get(sessionID: string) {
          const match = findIndex(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        status(sessionID: string): "idle" | "working" | "compacting" {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if ((session as any).time?.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return (last.time as any).completed ? "idle" : "working"
        },
        async sync(sessionID: string) {
          // For Velix, messages are already in sync via events
          const session = result.session.get(sessionID)
          if (!session) return
        },
      },
      workspace: {
        get(_workspaceID: string) {
          return undefined
        },
        async sync() {
          // Workspaces not supported in Velix
        },
      },
      bootstrap,
    }

    return result
  },
})

// Simple binary-search-compatible index finder
function findIndex<T>(
  arr: T[],
  id: string,
  getID: (item: T) => string,
): { found: boolean; index: number } {
  // Linear search (simpler than binary search, fine for small arrays)
  const index = arr.findIndex((item) => getID(item) === id)
  if (index !== -1) return { found: true, index }
  // Return insertion point (end of array)
  return { found: false, index: arr.length }
}
