/**
 * Velix SDK Context - replaces Velix's SDK context
 * Wraps Velix's direct AI engine for use in the TUI
 */
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { onCleanup } from "solid-js"
import type { Event } from "@velix-ai/sdk/v2"
import { loadConfig } from "../../../../src/config/store"
import { sendMessage } from "../../../../src/services/ai/engine"

export type EventSource = {
  on: (handler: (event: Event) => void) => () => void
  setWorkspace?: (workspaceID?: string) => void
}

type VelixMessage = {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: { created: number; completed?: number }
}

type VelixPart = {
  id: string
  type: "text"
  messageID: string
  sessionID: string
  text: string
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    directory?: string
    events?: EventSource
  }) => {
    const abort = new AbortController()
    const emitter = createGlobalEmitter<{
      [key in Event["type"]]: Extract<Event, { type: key }>
    }>()

    onCleanup(() => {
      abort.abort()
    })

    function emit(event: Event) {
      emitter.emit(event.type, event)
    }

    // Velix AI client - wraps the direct HTTP AI engine
    const client = {
      session: {
        async create(input: {
          prompt?: string
          agentID?: string
          model?: { providerID: string; modelID: string }
          parentID?: string
          workspaceID?: string
        }) {
          const id = crypto.randomUUID()
          const session = {
            id,
            title: input.prompt?.slice(0, 80),
            time: { created: Date.now(), updated: Date.now() },
          }

          emit({ type: "session.updated", properties: { info: session } } as any)

          // If prompt provided, send it as first message
          if (input.prompt) {
            await client.message.send(id, input.prompt, input.model)
          }

          return { data: session }
        },

        async list(_params?: { start?: number }) {
          return { data: [] }
        },

        async get(_params: { sessionID: string }) {
          return { data: null }
        },

        async messages(_params: { sessionID: string; limit?: number }) {
          return { data: [] }
        },

        async delete(_params: { sessionID: string }) {
          return {}
        },

        async abort(_params: { sessionID: string }) {
          abort.abort()
          return {}
        },

        async todo(_params: { sessionID: string }) {
          return { data: [] }
        },

        async diff(_params: { sessionID: string }) {
          return { data: [] }
        },

        async status() {
          return { data: {} }
        },
      },

      message: {
        async send(
          sessionID: string,
          text: string,
          model?: { providerID: string; modelID: string },
        ) {
          const config = loadConfig()
          const providerID = (model?.providerID ?? config.provider) as keyof typeof config.apiKeys
          const modelID = model?.modelID ?? config.model
          const apiKey = config.apiKeys[providerID]

          if (!apiKey) {
            const errorMsg = `No API key configured for provider: ${providerID}. Run "velix --config" to set it up.`
            const msgID = crypto.randomUUID()
            const userMsg: VelixMessage = {
              id: crypto.randomUUID(),
              sessionID,
              role: "user",
              time: { created: Date.now(), completed: Date.now() },
            }
            const userPart: VelixPart = {
              id: crypto.randomUUID(),
              type: "text",
              messageID: userMsg.id,
              sessionID,
              text,
            }
            const aiMsg: VelixMessage = {
              id: msgID,
              sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
            }
            const aiPart: VelixPart = {
              id: crypto.randomUUID(),
              type: "text",
              messageID: msgID,
              sessionID,
              text: errorMsg,
            }

            emit({ type: "message.updated", properties: { info: userMsg } } as any)
            emit({ type: "message.part.updated", properties: { part: userPart } } as any)
            emit({ type: "message.updated", properties: { info: aiMsg } } as any)
            emit({ type: "message.part.updated", properties: { part: aiPart } } as any)
            return
          }

          // User message
          const userMsgID = crypto.randomUUID()
          const userMsg: VelixMessage = {
            id: userMsgID,
            sessionID,
            role: "user",
            time: { created: Date.now() },
          }
          const userPart: VelixPart = {
            id: crypto.randomUUID(),
            type: "text",
            messageID: userMsgID,
            sessionID,
            text,
          }
          emit({ type: "message.updated", properties: { info: userMsg } } as any)
          emit({ type: "message.part.updated", properties: { part: userPart } } as any)

          // AI response message
          const aiMsgID = crypto.randomUUID()
          const aiPartID = crypto.randomUUID()
          const aiMsg: VelixMessage = {
            id: aiMsgID,
            sessionID,
            role: "assistant",
            time: { created: Date.now() },
          }
          emit({ type: "message.updated", properties: { info: aiMsg } } as any)
          emit({
            type: "message.part.updated",
            properties: {
              part: { id: aiPartID, type: "text", messageID: aiMsgID, sessionID, text: "" },
            },
          } as any)

          try {
            let accumulated = ""
            await sendMessage({
              text,
              provider: providerID,
              model: modelID,
              apiKey,
              signal: abort.signal,
              onStream: (chunk) => {
                accumulated += chunk
                emit({
                  type: "message.part.delta",
                  properties: {
                    messageID: aiMsgID,
                    partID: aiPartID,
                    field: "text",
                    delta: chunk,
                  },
                } as any)
              },
            })

            const completed: VelixMessage = { ...aiMsg, time: { ...aiMsg.time, completed: Date.now() } }
            emit({ type: "message.updated", properties: { info: completed } } as any)
          } catch (err) {
            const errText = err instanceof Error ? err.message : String(err)
            emit({
              type: "message.part.delta",
              properties: {
                messageID: aiMsgID,
                partID: aiPartID,
                field: "text",
                delta: `\n\nError: ${errText}`,
              },
            } as any)
          }

          const completedUser: VelixMessage = { ...userMsg, time: { ...userMsg.time, completed: Date.now() } }
          emit({ type: "message.updated", properties: { info: completedUser } } as any)
        },
      },

      config: {
        async providers() {
          const config = loadConfig()
          const { PROVIDERS } = await import("../../../../src/services/ai/types")
          const providers = PROVIDERS.map((p) => ({
            id: p.id,
            name: p.name,
            models: Object.fromEntries(
              p.models.map((m) => [
                m,
                {
                  id: m,
                  name: m,
                  capabilities: { reasoning: m.includes("reasoner") || m.includes("thinking") },
                },
              ]),
            ),
          }))
          const connected = providers.filter((p) => !!config.apiKeys[p.id as keyof typeof config.apiKeys])
          return {
            data: {
              providers: connected.length > 0 ? connected : providers,
              default: Object.fromEntries(providers.map((p) => [p.id, p.models ? Object.keys(p.models)[0] ?? "" : ""])),
            },
          }
        },

        async get() {
          const config = loadConfig()
          return {
            data: {
              model: `${config.provider}/${config.model}`,
              theme: config.theme,
            },
          }
        },
      },

      provider: {
        async list() {
          const { PROVIDERS } = await import("../../../../src/services/ai/types")
          const providers = PROVIDERS.map((p) => ({
            id: p.id,
            name: p.name,
            models: Object.fromEntries(
              p.models.map((m) => [
                m,
                {
                  id: m,
                  name: m,
                  capabilities: { reasoning: m.includes("reasoner") || m.includes("thinking") },
                },
              ]),
            ),
          }))
          return {
            data: {
              all: providers,
              default: Object.fromEntries(
                providers.map((p) => [p.id, Object.keys(p.models)[0] ?? ""]),
              ),
              connected: [],
            },
          }
        },

        async auth() {
          return { data: {} }
        },
      },

      app: {
        async agents() {
          return {
            data: [
              {
                name: "velix",
                description: "Velix AI Assistant",
                mode: "default" as const,
                hidden: false,
              },
            ],
          }
        },
      },

      mcp: {
        async status() {
          return { data: {} }
        },
        async connect(_params: { name: string }) {
          return {}
        },
        async disconnect(_params: { name: string }) {
          return {}
        },
      },

      lsp: {
        async status() {
          return { data: [] }
        },
      },

      formatter: {
        async status() {
          return { data: [] }
        },
      },

      vcs: {
        async get() {
          return { data: { branch: undefined } }
        },
      },

      path: {
        async get() {
          const { Global } = await import("../../../../src/velix-sdk/global")
          return {
            data: {
              state: Global.Path.state,
              config: Global.Path.config,
              worktree: process.cwd(),
              directory: process.cwd(),
            },
          }
        },
      },

      command: {
        async list() {
          return { data: [] }
        },
      },

      experimental: {
        workspace: {
          async list() {
            return { data: [] }
          },
          async create(_input: { type: string; branch: string | null }) {
            return {
              data: {
                id: crypto.randomUUID(),
                type: "workspace",
                branch: null,
              },
              error: undefined,
            }
          },
          async remove(_input: { id: string }) {
            return { error: undefined }
          },
        },
        resource: {
          async list() {
            return { data: {} }
          },
        },
      },
    }

    return {
      get client() {
        return client
      },
      directory: props.directory,
      event: emitter,
      fetch: fetch,
      setWorkspace(_next?: string) {
        // Workspace switching not supported in Velix
      },
      url: "velix://local",
    }
  },
})
