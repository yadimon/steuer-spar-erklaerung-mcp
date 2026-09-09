import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readFileBounded } from "./bounded-files.js";
import type { ProductProfile } from "./product-profiles.js";
import type { QtNativeRuntimeConfig } from "./qt-native-config.js";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const nativeProfileSchema = z.object({
  id: z.string().regex(/^[0-9]{4}$/u),
  taxYear: z.number().int(), engineFileMajor: z.number().int(),
  verifiedBuild: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/u),
  qtVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
}).strict();
const manifestSchema = z.object({
  schemaVersion: z.literal(1), startupAbi: z.literal(2), bridgeProtocol: z.literal(1),
  buildIdentity: z.string().regex(/^SSE_NATIVE_BRIDGE_V2:[a-f0-9]{64}$/u),
  profile: nativeProfileSchema,
  loader: z.object({ file: z.literal("bridge-load.exe"), sha256 }).strict(),
  bridge: z.object({ file: z.literal("sse-qt-read.dll"), sha256 }).strict(),
}).strict();

export interface QtNativePackage {
  directory: string;
  loaderPath: string;
  bridgePath: string;
  manifest: z.infer<typeof manifestSchema>;
}

function verifiedFile(path: string, expected: string, maximumBytes: number): Buffer {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Native package entries must be regular files.");
  const bytes = readFileBounded(path, maximumBytes);
  if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("Native package file digest mismatch.");
  return bytes;
}

export function loadQtNativePackage(config: QtNativeRuntimeConfig, profile: ProductProfile): QtNativePackage {
  if (profile.status !== "supported" || profile.operationAccess !== "full" || !profile.nativeQtVersion) {
    throw new Error("The selected product profile has no supported native Qt binding.");
  }
  const directory = realpathSync(config.directory);
  const bytes = verifiedFile(join(directory, "manifest.json"), config.manifestSha256, 16 * 1024);
  const manifest = manifestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  const expected = {
    id: profile.id, taxYear: profile.taxYear, engineFileMajor: profile.engineFileMajor,
    verifiedBuild: profile.verifiedBuild, qtVersion: profile.nativeQtVersion,
  };
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (manifest.profile[key] !== expected[key]) throw new Error("Native package compatibility differs from the selected product profile.");
  }
  const loaderPath = join(directory, manifest.loader.file), bridgePath = join(directory, manifest.bridge.file);
  verifiedFile(loaderPath, manifest.loader.sha256, 128 * 1024 * 1024);
  verifiedFile(bridgePath, manifest.bridge.sha256, 128 * 1024 * 1024);
  return { directory, loaderPath, bridgePath, manifest };
}
