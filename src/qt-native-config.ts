import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

/** Configuration identity only: the MCP supervisor must not import native execution. */
export interface QtNativeRuntimeConfig {
  directory: string;
  manifestSha256: string;
}

export function parseQtNativeRuntimeConfig(value: unknown): QtNativeRuntimeConfig | undefined {
  if (value === undefined) return undefined;
  const result = z.object({
    directory: z.string().min(1), manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict().safeParse(value);
  if (!result.success || !isAbsolute(result.data.directory) || !/^[A-Za-z]:[\\/]/u.test(result.data.directory)
    || /[\u0000-\u001f]/u.test(result.data.directory)) {
    throw new Error("qtNativeRuntime requires an absolute directory and a lowercase SHA256 manifest pin.");
  }
  return Object.freeze({ directory: resolve(result.data.directory), manifestSha256: result.data.manifestSha256 });
}
