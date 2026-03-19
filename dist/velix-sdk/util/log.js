export const Log = {
    Default: {
        error(_message, _data) {
            // Silent in TUI mode - errors handled via toast/exit
        },
        info(_message, _data) {
            // noop
        },
        warn(_message, _data) {
            // noop
        },
    },
};
//# sourceMappingURL=log.js.map