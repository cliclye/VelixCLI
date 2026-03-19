// Session API stubs for Velix
export const Session = {
    async list() {
        return [];
    },
    async create(input) {
        return {
            id: crypto.randomUUID(),
            title: input.prompt?.slice(0, 50),
            time: {
                created: Date.now(),
                updated: Date.now(),
            },
        };
    },
    isDefaultTitle(title) {
        return !title;
    },
};
//# sourceMappingURL=index.js.map