import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { z } from "zod";
import type { DesktopMarker } from "./desktop-marker.js";
import type { QtNativePackage } from "./qt-native-package.js";
import type { QtNativeTarget } from "./qt-native-broker.js";
import { QtNativeTransportError } from "./qt-native-client.js";

export interface QtNativeDiscoveryOptions {
  package: QtNativePackage;
  expectedImage: string;
  marker: DesktopMarker | null;
  hwnd?: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

const discoverySchema = z.object({
  ok: z.literal(true), pid: z.number().int().positive().max(0xffffffff),
  hwnd: z.number().int().positive().safe(),
  creationTime: z.string().regex(/^[1-9][0-9]{0,19}$/u).refine(value => BigInt(value) <= 0xffffffffffffffffn),
  image: z.string(), desktop: z.string().optional(), sessionId: z.number().int().nonnegative(),
  bindingDiscovered: z.literal(true), binaryIdentityVerified: z.literal(true),
  loaderBuildIdentity: z.string(), profile: z.record(z.unknown()),
}).passthrough();
const failure = (kind: string, message: string) => new QtNativeTransportError(message, kind);

export function parseQtNativeDiscovery(value: unknown, options: QtNativeDiscoveryOptions): QtNativeTarget {
  const found = discoverySchema.parse(value);
  if (found.loaderBuildIdentity !== options.package.manifest.buildIdentity
    || found.image.toLowerCase() !== options.expectedImage.toLowerCase()
    || found.desktop !== options.marker?.name
    || (options.hwnd !== undefined && found.hwnd !== options.hwnd)
    || (options.marker?.pid !== undefined && options.marker?.pid !== null && found.pid !== options.marker.pid)) {
    throw failure("native-binding", "Native discovery did not verify the requested image, desktop, process and window.");
  }
  const expected = options.package.manifest.profile;
  if (Object.keys(found.profile).length !== Object.keys(expected).length
    || Object.entries(expected).some(([key, value]) => found.profile[key] !== value)) {
    throw failure("native-binding", "Native discovery profile differs from its pinned package.");
  }
  return { pid: found.pid, hwnd: found.hwnd, creationTime: found.creationTime, ...(found.desktop ? { desktop: found.desktop } : {}) };
}

/** Read-only Win32 selection and product identity verification; does not load the bridge or open a session. */
export async function discoverQtNativeTarget(options: QtNativeDiscoveryOptions): Promise<QtNativeTarget> {
  if (options.signal?.aborted) throw failure("aborted", "Native discovery cancelled before launch.");
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60_000) {
    throw failure("native-deadline", "Invalid native discovery deadline.");
  }
  if (!isAbsolute(options.expectedImage) || /[\u0000-\u001f]/u.test(options.expectedImage)
    || (options.hwnd !== undefined && (!Number.isSafeInteger(options.hwnd) || options.hwnd < 1))) {
    throw failure("native-binding", "Invalid native discovery selector.");
  }
  const marker = options.marker;
  if (marker && (marker.owner !== "sse" || !/^[A-Za-z0-9_-]{1,64}$/u.test(marker.name)
    || (marker.pid !== null && (!Number.isSafeInteger(marker.pid) || marker.pid < 1 || marker.pid > 0xffffffff)))) {
    throw failure("desktop-marker-invalid", "Native discovery requires a valid SSE desktop marker.");
  }
  const request = { mode: "discover", expectedImage: options.expectedImage, expectedProfile: options.package.manifest.profile,
    ...(options.hwnd !== undefined ? { hwnd: options.hwnd } : {}),
    ...(marker ? { desktop: marker.name, ...(marker.pid !== null ? { pid: marker.pid } : {}) } : {}) };
  const body = Buffer.from(JSON.stringify(request));
  if (body.length > 65536) throw failure("native-request-size", "Native discovery request exceeds its bound.");
  return new Promise<QtNativeTarget>((resolveTarget, reject) => {
    const child = execFile(options.package.loaderPath, ["--stdin"], {
      windowsHide: true, encoding: "buffer", maxBuffer: 65536, timeout: options.timeoutMs, signal: options.signal,
    }, (error, stdout, stderr) => {
      if (options.signal?.aborted) { reject(failure("aborted", "Native discovery cancelled.")); return; }
      if (error) {
        if (error.killed) { reject(failure("native-timeout", "Native discovery exceeded its deadline.")); return; }
        let kind = "native-binding";
        try {
          const diagnostic = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stderr)) as { kind?: unknown };
          if (["no-window", "ambiguous", "desktop-marker-stale", "native-binding"].includes(String(diagnostic.kind))) kind = String(diagnostic.kind);
        } catch { /* Raw native diagnostics are never copied into API errors. */ }
        reject(failure(kind, "Native discovery could not verify an unambiguous current product window.")); return;
      }
      try { resolveTarget(parseQtNativeDiscovery(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stdout)), options)); }
      catch (error) { reject(error instanceof QtNativeTransportError ? error : failure("native-contract", "Native discovery returned an invalid identity.")); }
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(body);
  });
}
