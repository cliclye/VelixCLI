import { z } from "zod"

export const BusEvent = {
  define<T extends z.ZodRawShape>(name: string, schema: z.ZodObject<T>) {
    return {
      name,
      properties: schema,
    }
  },
}
