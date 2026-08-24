// The only JSON.parse in the repo. Every other boundary takes a string (or file) and a zod schema —
// malformed JSON and schema drift both come back as undefined, never a thrown or `as`-cast value.
import { existsSync, readFileSync } from 'node:fs'

import type { z } from 'zod'

export function parseJson<S extends z.ZodType>(schema: S, text: string): z.infer<S> | undefined {
  try {
    const parsed = schema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export function readJsonFile<S extends z.ZodType>(schema: S, path: string): z.infer<S> | undefined {
  if (!existsSync(path)) {
    return undefined
  }
  return parseJson(schema, readFileSync(path, 'utf8'))
}
