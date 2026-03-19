export const Provider = {
    parseModel(str) {
        const idx = str.indexOf("/");
        if (idx === -1)
            return { providerID: str, modelID: str };
        return {
            providerID: str.slice(0, idx),
            modelID: str.slice(idx + 1),
        };
    },
};
//# sourceMappingURL=provider.js.map