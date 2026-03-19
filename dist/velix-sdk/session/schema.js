import { z } from "zod";
export const SessionID = {
    zod: z.string(),
    parse(value) {
        return value;
    },
};
export const MessageID = {
    zod: z.string(),
    parse(value) {
        return value;
    },
};
export const PartID = {
    zod: z.string(),
    parse(value) {
        return value;
    },
};
//# sourceMappingURL=schema.js.map