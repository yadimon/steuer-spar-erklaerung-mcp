import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { win32 } from "node:path";
import { z } from "zod";
import type { WorkerResult } from "./api-contract.js";
import { DesktopMarkerError, desktopMarkerPath, readDesktopMarker, type DesktopMarker } from "./desktop-marker.js";
import { QtNativeTransportError } from "./qt-native-client.js";
import type { QtNativePackage } from "./qt-native-package.js";

export interface NativeDesktopStopOptions {
  package: QtNativePackage;
  executable: string;
  args: Readonly<Record<string, unknown>>;
  timeoutMs: number;
  signal?: AbortSignal;
}
const failure = (kind: string, message: string, unknown = false) => new QtNativeTransportError(message, kind, unknown);
const resultSchema = z.object({
  ok: z.boolean(), hartBeendet: z.boolean(), desktopMarkeEntfernt: z.boolean(), markerBeibehalten: z.boolean(),
  mutationAttempted: z.boolean(), outcomeUnknown: z.boolean(), processExited: z.boolean(),
  speichernAntwort: z.string().max(4096).nullable(), antwortMethode: z.literal("uia-invoke").nullable(),
  dialogFehler: z.string().max(4096).nullable(), gracefulWaitMs: z.number().finite().nonnegative(),
  hauptfensterVorher: z.number().int().min(0).max(256),
  hilfsfenster: z.array(z.object({ hwnd: z.number().int().positive().safe(), title: z.string().max(512),
    closedBeforeMain: z.boolean(), closed: z.boolean() }).strict()).max(256),
  loaderBuildIdentity: z.string(), loaderMs: z.number().finite().nonnegative(),
  discardChanges: z.boolean().optional(), desktop: z.string().optional(), pid: z.number().int().positive().max(0xffffffff).optional(),
  ungespeichert: z.boolean().nullable().optional(), closeSubmitted: z.literal(true).optional(),
  kind: z.string().max(128).optional(), error: z.string().max(4096).optional(),
}).strict();

export function parseNativeDesktopStop(value: unknown, marker: DesktopMarker, options: NativeDesktopStopOptions): WorkerResult {
  const result = resultSchema.parse(value);
  if (result.loaderBuildIdentity !== options.package.manifest.buildIdentity
    || (result.desktop !== undefined && result.desktop !== marker.name) || (result.pid !== undefined && result.pid !== marker.pid)
    || result.discardChanges !== (options.args.discardChanges === true)
    || (result.ok && (!result.processExited || !result.desktopMarkeEntfernt || result.markerBeibehalten || result.outcomeUnknown
      || !result.mutationAttempted || result.pid !== marker.pid || result.desktop !== marker.name))
    || (result.hartBeendet && (options.args.discardChanges !== true || !result.mutationAttempted))
    || (result.speichernAntwort !== null && (!result.mutationAttempted || options.args.discardChanges !== true
      || !["nein", "nicht speichern", "verwerfen"].includes(result.speichernAntwort.toLowerCase()) || result.antwortMethode !== "uia-invoke"))
    || (result.outcomeUnknown !== (result.mutationAttempted && !result.processExited))
    || (!result.ok && (!result.kind || !result.error)))
    throw failure("native-contract", "Native desktop stop returned inconsistent ownership or mutation evidence.", true);
  const { loaderBuildIdentity: _build, loaderMs, kind, error, ...reported } = result;
  return { ...reported, backend: "win32-uia", nativeMs: loaderMs,
    ...(kind === undefined ? {} : { kind }), ...(error === undefined ? {} : { error }),
    ...(result.ok ? { note: "Der versteckte Desktop wird vom System aufgeraeumt, sobald kein Prozess mehr darauf laeuft." } : {}) };
}

/** One external helper retains the exact process object through close, exit and locked marker deletion. */
export async function executeNativeDesktopStop(options: NativeDesktopStopOptions): Promise<WorkerResult> {
  const started = performance.now();
  try {
    if (options.signal?.aborted) throw failure("aborted", "Desktop stop cancelled before submission.");
    if (options.args.save === true && options.args.discardChanges === true) throw failure("bad-args", "Save and discard cannot both be requested.");
    if (options.args.save === true) throw failure("confirmation-required", "Use hash-bound save before stopping; desktop stop never saves a case.");
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 12000 || options.timeoutMs > 120000)
      throw failure("native-deadline", "Native desktop stop needs a bounded deadline including provider checks and verified exit.");
    const markerPath = desktopMarkerPath(), marker = readDesktopMarker(markerPath);
    if (!marker?.pid || marker.owner !== "sse") throw failure("ownership", "A valid owned SSE desktop marker with PID is required.");
    const image = win32.normalize(options.executable);
    if (!/^[A-Za-z]:\\/u.test(image) || /["\u0000-\u001f]/u.test(image)) throw failure("bad-args", "An absolute configured executable is required.");
    const remaining = Math.floor(options.timeoutMs - (performance.now() - started));
    if (remaining < 11500) throw failure("native-deadline", "Insufficient time remains for close ownership checks.");
    const request = { mode: "desktop-stop", desktop: marker.name, pid: marker.pid, markerPath, expectedImage: image,
      expectedProfile: options.package.manifest.profile, discardChanges: options.args.discardChanges === true,
      waitMs: 12000, deadlineUnixMs: Date.now() + remaining - 500 };
    const result = await new Promise<WorkerResult>((resolve, reject) => {
      const child = execFile(options.package.loaderPath, ["--stdin"], {
        windowsHide: true, encoding: "buffer", maxBuffer: 1024 * 1024, timeout: remaining, signal: options.signal,
      }, (error, stdout) => {
        try {
          if (error || options.signal?.aborted) throw failure(options.signal?.aborted ? "aborted" : error?.killed ? "native-timeout" : "native-transport",
            "Native stop response was interrupted; inspect desktop_status before any further close.", Boolean(child.pid));
          const reported = parseNativeDesktopStop(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stdout)), marker, options);
          if (reported.ok && readDesktopMarker(markerPath) !== null)
            throw failure("native-binding", "An ownership marker exists after the confirmed process exit.", true);
          resolve(reported);
        } catch (error) { reject(error instanceof QtNativeTransportError ? error : failure("native-contract", "Native stop result could not be verified.", true)); }
      });
      child.stdin?.on("error", () => {}); child.stdin?.end(JSON.stringify(request));
    });
    return { ...result, ms: performance.now() - started };
  } catch (error) {
    return { ok: false, backend: "win32-uia", kind: error instanceof QtNativeTransportError || error instanceof DesktopMarkerError ? error.kind : "native-contract",
      error: error instanceof Error ? error.message : "Native desktop stop failed.", outcomeUnknown: error instanceof QtNativeTransportError && error.outcomeUnknown,
      ms: performance.now() - started };
  }
}
