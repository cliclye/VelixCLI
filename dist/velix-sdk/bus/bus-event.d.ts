import { z } from "zod";
export declare const BusEvent: {
    define<T extends Readonly<{
        [k: string]: z.core.$ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
    }>>(name: string, schema: z.ZodObject<T>): {
        name: string;
        properties: z.ZodObject<T, z.core.$strip>;
    };
};
//# sourceMappingURL=bus-event.d.ts.map