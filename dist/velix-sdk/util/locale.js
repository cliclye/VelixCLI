export const Locale = {
    pluralize(count, singular, plural) {
        const template = count === 1 ? singular : plural;
        return template.replace("{}", String(count));
    },
};
//# sourceMappingURL=locale.js.map