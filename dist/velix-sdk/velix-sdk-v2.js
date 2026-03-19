// Local compatibility shim for the Velix SDK v2 surface.
function now() {
    return Date.now();
}
function randomID() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${now()}`;
}
function withResponse(data) {
    return {
        data,
        response: {
            status: 200,
        },
    };
}
async function* emptyEventStream() { }
function createSession(input) {
    const title = typeof input?.title === "string"
        ? input.title
        : typeof input?.prompt === "string"
            ? input.prompt.slice(0, 80)
            : undefined;
    return {
        id: randomID(),
        title,
        time: {
            created: now(),
            updated: now(),
        },
    };
}
export function createVelixClient(_options = {}) {
    return {
        session: {
            async list() {
                return withResponse([]);
            },
            async create(input) {
                return withResponse(createSession(input));
            },
            async fork() {
                return withResponse(createSession());
            },
            async share() {
                return withResponse({});
            },
            async prompt() {
                return withResponse();
            },
            async command() {
                return withResponse();
            },
            async abort() {
                return withResponse();
            },
            async delete() {
                return withResponse();
            },
            async revert() {
                return withResponse();
            },
            async unrevert() {
                return withResponse();
            },
            async update(input) {
                return withResponse(createSession(input));
            },
            async summarize() {
                return withResponse();
            },
            async shell() {
                return withResponse();
            },
            async messages() {
                return withResponse([]);
            },
            async todo() {
                return withResponse([]);
            },
            async diff() {
                return withResponse([]);
            },
        },
        config: {
            async get() {
                return withResponse({});
            },
            async providers() {
                return withResponse({
                    providers: [],
                    default: {},
                });
            },
        },
        event: {
            async subscribe() {
                return {
                    stream: emptyEventStream(),
                };
            },
        },
        permission: {
            async reply() {
                return withResponse();
            },
        },
        question: {
            async reply() {
                return withResponse();
            },
            async reject() {
                return withResponse();
            },
        },
        provider: {
            async list() {
                return withResponse({
                    all: [],
                    default: {},
                    connected: [],
                });
            },
            oauth: {
                async authorize() {
                    return withResponse({
                        method: "code",
                        url: "",
                        instructions: "",
                    });
                },
                async callback() {
                    return withResponse();
                },
            },
        },
        auth: {
            async set() {
                return withResponse();
            },
        },
        path: {
            async get() {
                return withResponse({
                    state: "",
                    config: "",
                    worktree: process.cwd(),
                    directory: process.cwd(),
                });
            },
        },
        app: {
            async agents() {
                return withResponse([]);
            },
        },
        instance: {
            async dispose() {
                return withResponse();
            },
        },
        mcp: {
            async status() {
                return withResponse({});
            },
            async connect() {
                return withResponse();
            },
            async disconnect() {
                return withResponse();
            },
        },
        lsp: {
            async status() {
                return withResponse([]);
            },
        },
        vcs: {
            async get() {
                return withResponse({});
            },
        },
        experimental: {
            workspace: {
                async list() {
                    return withResponse([]);
                },
                async create() {
                    return withResponse({
                        id: randomID(),
                        type: "workspace",
                        branch: null,
                    });
                },
                async remove() {
                    return withResponse();
                },
            },
            resource: {
                async list() {
                    return withResponse({});
                },
            },
        },
    };
}
//# sourceMappingURL=velix-sdk-v2.js.map