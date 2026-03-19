import { z } from "zod";
export declare const SessionID: {
    zod: z.ZodString;
    parse(value: string): string;
};
export declare const MessageID: {
    zod: z.ZodString;
    parse(value: string): string;
};
export declare const PartID: {
    zod: z.ZodString;
    parse(value: string): string;
};
export type SessionIDType = string;
export type MessageIDType = string;
export type PartIDType = string;
//# sourceMappingURL=schema.d.ts.map