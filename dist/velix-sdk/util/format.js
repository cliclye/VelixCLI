export function formatDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60)
        return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}
export const Format = {
    duration: formatDuration,
    bytes(n) {
        if (n < 1024)
            return `${n}B`;
        if (n < 1024 * 1024)
            return `${(n / 1024).toFixed(1)}KB`;
        return `${(n / 1024 / 1024).toFixed(1)}MB`;
    },
};
//# sourceMappingURL=format.js.map