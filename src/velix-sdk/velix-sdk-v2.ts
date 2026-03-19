// Local compatibility shim for the Velix SDK v2 surface.

export interface FilePart {
  id: string
  type: "file"
  messageID: string
  sessionID: string
  url: string
  mime: string
  filename: string
  size?: number
  synthetic?: boolean
}

export interface TextPart {
  id: string
  type: "text"
  messageID: string
  sessionID: string
  text: string
  time?: { start: number; end?: number }
  synthetic?: boolean
}

export interface AgentPart {
  id: string
  type: "agent"
  messageID: string
  sessionID: string
  agentID: string
  summary?: string
}

export interface ToolStateBase {
  input: Record<string, any>
  metadata?: Record<string, unknown>
  title?: string
}

export type ToolState =
  | (ToolStateBase & {
      status: "pending" | "running"
      output?: string
    })
  | (ToolStateBase & {
      status: "completed"
      output?: string
    })
  | (ToolStateBase & {
      status: "error"
      error: string
      output?: string
    })

export interface ToolPart {
  id: string
  type: "tool"
  messageID: string
  sessionID: string
  tool: string
  callID?: string
  state: ToolState
  time?: { start: number; end?: number }
}

export interface StepStartPart {
  id: string
  type: "step-start"
  messageID: string
  sessionID: string
  time?: { start: number; end?: number }
}

export interface StepFinishPart {
  id: string
  type: "step-finish"
  messageID: string
  sessionID: string
  time?: { start: number; end?: number }
}

export interface ReasoningPart {
  id: string
  type: "reasoning"
  messageID: string
  sessionID: string
  text: string
  time?: { start: number; end?: number }
  synthetic?: boolean
}

export type Part =
  | FilePart
  | TextPart
  | AgentPart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | ReasoningPart

export interface MessageBase {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: { created: number; completed?: number }
  parentID?: string
  metadata?: Record<string, unknown>
}

export interface UserMessage extends MessageBase {
  role: "user"
}

export interface TokenUsage {
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
  }
}

export interface AssistantMessage extends MessageBase {
  role: "assistant"
  agent: string
  mode: string
  providerID: string
  modelID: string
  cost: number
  tokens: TokenUsage
  finish?: string
  error?: {
    name: string
    data: {
      message?: string
      [key: string]: unknown
    }
    [key: string]: unknown
  }
}

export type Message = UserMessage | AssistantMessage

export interface Session {
  id: string
  title?: string
  time: { created: number; updated: number; compacting?: number }
  parentID?: string
  workspaceID?: string
  share?: { url: string }
  version?: string
}

export interface ProviderModel {
  id: string
  name: string
  capabilities?: { reasoning?: boolean; attachment?: boolean }
  variants?: Record<string, { name: string }>
  limit?: { context?: number }
  cost?: { input?: number; output?: number }
}

export interface Provider {
  id: string
  name: string
  models: Record<string, ProviderModel>
}

export interface Agent {
  name: string
  description?: string
  mode?: "subagent" | "default"
  hidden?: boolean
  model?: { providerID: string; modelID: string }
  color?: string
}

export interface Config {
  model?: string
  theme?: string
  provider?: string
  share?: string
  lsp?: boolean
  plugin?: string[]
  experimental?: Record<string, unknown>
  [key: string]: unknown
}

export interface McpStatus {
  name?: string
  status: "connected" | "failed" | "disabled" | "connecting" | "needs_auth" | "needs_client_registration"
  error?: string
}

export interface McpResource {
  name: string
  uri: string
}

export interface LspStatus {
  id: string
  root?: string
  status: "connected" | "running" | "error" | "failed"
}

export interface FormatterStatus {
  formatter?: string
  status: "available" | "unavailable"
}

export interface SessionStatus {
  type: "idle" | "working" | "compacting"
}

export interface VcsInfo {
  branch?: string
}

export interface PermissionToolReference {
  messageID: string
  callID?: string
}

export interface PermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  always: string[]
  metadata?: Record<string, unknown>
  tool?: PermissionToolReference
  time?: number
}

export interface QuestionOption {
  label: string
  description?: string
}

export interface QuestionDefinition {
  header?: string
  id?: string
  question?: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export type QuestionAnswer = string[]

export interface QuestionRequest {
  id: string
  sessionID: string
  questions: QuestionDefinition[]
  time?: number
}

export interface Todo {
  id: string
  sessionID: string
  content: string
  status: "pending" | "in_progress" | "completed"
}

export interface Command {
  name: string
  description?: string
}

export interface ProviderAuthPrompt {
  key: string
  label: string
  description?: string
  placeholder?: string
  secret?: boolean
}

export interface ProviderAuthMethod {
  type: "api" | "oauth"
  label: string
  prompts?: ProviderAuthPrompt[]
}

export interface ProviderAuthAuthorization {
  method: "auto" | "code"
  url: string
  instructions: string
}

export interface ProviderListResponse {
  all: Provider[]
  default: Record<string, string>
  connected: string[]
}

export interface Workspace {
  id: string
  name?: string
  directory?: string
  type?: string
  branch?: string | null
}

export interface PathInfo {
  state: string
  config: string
  worktree: string
  directory: string
}

export type Event =
  | { type: "server.instance.disposed" }
  | { type: "session.updated"; properties: { info: Session } }
  | { type: "session.deleted"; properties: { info: Session } }
  | { type: "session.status"; properties: { sessionID: string; status: SessionStatus } }
  | { type: "session.error"; properties: { sessionID: string; error?: AssistantMessage["error"] } }
  | { type: "session.diff"; properties: { sessionID: string; diff: unknown[] } }
  | { type: "message.updated"; properties: { info: Message } }
  | { type: "message.removed"; properties: { sessionID: string; messageID: string } }
  | { type: "message.part.updated"; properties: { part: Part } }
  | { type: "message.part.delta"; properties: { messageID: string; partID: string; field: string; delta: string } }
  | { type: "message.part.removed"; properties: { messageID: string; partID: string } }
  | { type: "permission.asked"; properties: PermissionRequest }
  | { type: "permission.replied"; properties: { requestID: string; sessionID: string } }
  | { type: "question.asked"; properties: QuestionRequest }
  | { type: "question.replied"; properties: { requestID: string; sessionID: string } }
  | { type: "question.rejected"; properties: { requestID: string; sessionID: string } }
  | { type: "todo.updated"; properties: { sessionID: string; todos: Todo[] } }
  | { type: "lsp.updated" }
  | { type: "vcs.branch.updated"; properties: { branch: string } }

export interface ClientResponse {
  status: number
}

export interface ClientResult<T = unknown> {
  data?: T
  error?: unknown
  response: ClientResponse
}

export interface EventSubscription {
  stream: AsyncIterable<Event>
}

type HeaderMap = Record<string, string> | Array<[string, string]>

export interface VelixClientOptions {
  baseUrl?: string
  directory?: string
  experimental_workspaceID?: string
  headers?: HeaderMap
  fetch?: typeof globalThis.fetch
  signal?: AbortSignal
}

export interface VelixClient {
  session: {
    list(input?: Record<string, unknown>): Promise<ClientResult<Session[]>>
    create(input?: Record<string, unknown>): Promise<ClientResult<Session>>
    fork(input: { sessionID: string }): Promise<ClientResult<Session>>
    share(input: { sessionID: string }): Promise<ClientResult<{ share?: { url?: string } }>>
    prompt(input: Record<string, unknown>): Promise<ClientResult<void>>
    command(input: Record<string, unknown>): Promise<ClientResult<void>>
    abort(input: { sessionID: string }): Promise<ClientResult<void>>
    delete(input: { sessionID: string }): Promise<ClientResult<void>>
    revert(input: Record<string, unknown>): Promise<ClientResult<void>>
    unrevert(input: Record<string, unknown>): Promise<ClientResult<void>>
    update(input: Record<string, unknown>): Promise<ClientResult<Session>>
    summarize(input: Record<string, unknown>): Promise<ClientResult<void>>
    shell(input: Record<string, unknown>): Promise<ClientResult<void>>
    messages(input: Record<string, unknown>): Promise<ClientResult<Message[]>>
    todo(input: Record<string, unknown>): Promise<ClientResult<Todo[]>>
    diff(input: Record<string, unknown>): Promise<ClientResult<unknown[]>>
  }
  config: {
    get(): Promise<ClientResult<Config>>
    providers(): Promise<ClientResult<{ providers: Provider[]; default: Record<string, string> }>>
  }
  event: {
    subscribe(
      input?: Record<string, unknown>,
      options?: { signal?: AbortSignal },
    ): Promise<EventSubscription>
  }
  permission: {
    reply(input: Record<string, unknown>): Promise<ClientResult<void>>
  }
  question: {
    reply(input: Record<string, unknown>): Promise<ClientResult<void>>
    reject(input: Record<string, unknown>): Promise<ClientResult<void>>
  }
  provider: {
    list(): Promise<ClientResult<ProviderListResponse>>
    oauth: {
      authorize(input: Record<string, unknown>): Promise<ClientResult<ProviderAuthAuthorization>>
      callback(input: Record<string, unknown>): Promise<ClientResult<void>>
    }
  }
  auth: {
    set(input: Record<string, unknown>): Promise<ClientResult<void>>
  }
  path: {
    get(): Promise<ClientResult<PathInfo>>
  }
  app: {
    agents(
      input?: Record<string, unknown>,
      options?: { throwOnError?: boolean },
    ): Promise<ClientResult<Agent[]>>
  }
  instance: {
    dispose(): Promise<ClientResult<void>>
  }
  mcp: {
    status(): Promise<ClientResult<Record<string, McpStatus>>>
    connect(input: Record<string, unknown>): Promise<ClientResult<void>>
    disconnect(input: Record<string, unknown>): Promise<ClientResult<void>>
  }
  lsp: {
    status(): Promise<ClientResult<LspStatus[]>>
  }
  vcs: {
    get(): Promise<ClientResult<VcsInfo>>
  }
  experimental: {
    workspace: {
      list(): Promise<ClientResult<Workspace[]>>
      create(input: Record<string, unknown>): Promise<ClientResult<Workspace>>
      remove(input: Record<string, unknown>): Promise<ClientResult<void>>
    }
    resource: {
      list(): Promise<ClientResult<Record<string, McpResource>>>
    }
  }
}

function now() {
  return Date.now()
}

function randomID() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${now()}`
}

function withResponse<T>(data?: T): ClientResult<T> {
  return {
    data,
    response: {
      status: 200,
    },
  }
}

async function* emptyEventStream(): AsyncIterable<Event> {}

function createSession(input?: Record<string, unknown>): Session {
  const title =
    typeof input?.title === "string"
      ? input.title
      : typeof input?.prompt === "string"
        ? input.prompt.slice(0, 80)
        : undefined
  return {
    id: randomID(),
    title,
    time: {
      created: now(),
      updated: now(),
    },
  }
}

export function createVelixClient(_options: VelixClientOptions = {}): VelixClient {
  return {
    session: {
      async list() {
        return withResponse([])
      },
      async create(input) {
        return withResponse(createSession(input))
      },
      async fork() {
        return withResponse(createSession())
      },
      async share() {
        return withResponse({})
      },
      async prompt() {
        return withResponse()
      },
      async command() {
        return withResponse()
      },
      async abort() {
        return withResponse()
      },
      async delete() {
        return withResponse()
      },
      async revert() {
        return withResponse()
      },
      async unrevert() {
        return withResponse()
      },
      async update(input) {
        return withResponse(createSession(input))
      },
      async summarize() {
        return withResponse()
      },
      async shell() {
        return withResponse()
      },
      async messages() {
        return withResponse([])
      },
      async todo() {
        return withResponse([])
      },
      async diff() {
        return withResponse([])
      },
    },
    config: {
      async get() {
        return withResponse({})
      },
      async providers() {
        return withResponse({
          providers: [],
          default: {},
        })
      },
    },
    event: {
      async subscribe() {
        return {
          stream: emptyEventStream(),
        }
      },
    },
    permission: {
      async reply() {
        return withResponse()
      },
    },
    question: {
      async reply() {
        return withResponse()
      },
      async reject() {
        return withResponse()
      },
    },
    provider: {
      async list() {
        return withResponse({
          all: [],
          default: {},
          connected: [],
        })
      },
      oauth: {
        async authorize() {
          return withResponse({
            method: "code",
            url: "",
            instructions: "",
          })
        },
        async callback() {
          return withResponse()
        },
      },
    },
    auth: {
      async set() {
        return withResponse()
      },
    },
    path: {
      async get() {
        return withResponse({
          state: "",
          config: "",
          worktree: process.cwd(),
          directory: process.cwd(),
        })
      },
    },
    app: {
      async agents() {
        return withResponse([])
      },
    },
    instance: {
      async dispose() {
        return withResponse()
      },
    },
    mcp: {
      async status() {
        return withResponse({})
      },
      async connect() {
        return withResponse()
      },
      async disconnect() {
        return withResponse()
      },
    },
    lsp: {
      async status() {
        return withResponse([])
      },
    },
    vcs: {
      async get() {
        return withResponse({})
      },
    },
    experimental: {
      workspace: {
        async list() {
          return withResponse([])
        },
        async create() {
          return withResponse({
            id: randomID(),
            type: "workspace",
            branch: null,
          })
        },
        async remove() {
          return withResponse()
        },
      },
      resource: {
        async list() {
          return withResponse({})
        },
      },
    },
  }
}
