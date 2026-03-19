export function FormatError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return undefined;
}
export function FormatUnknownError(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
//# sourceMappingURL=error.js.map