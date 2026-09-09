import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { win32 } from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { WorkerResult } from "./api-contract.js";
import { DesktopMarkerError, desktopMarkerPath, readDesktopMarker } from "./desktop-marker.js";
import type { ProductProfile } from "./product-profiles.js";
import type { QtNativePackage } from "./qt-native-package.js";
import { QtNativeTransportError } from "./qt-native-client.js";

export interface NativeDesktopStartOptions {
  package: QtNativePackage;
  profile: ProductProfile;
  executable: string;
  args: Readonly<Record<string, unknown>>;
  timeoutMs: number;
  signal?: AbortSignal;
}
const failure = (kind: string, message: string, unknown = false) => new QtNativeTransportError(message, kind, unknown);
const pid = z.number().int().min(1).max(0xffffffff);
const windowSchema = z.object({
  hwnd: z.number().int().positive().safe(), pid, x: z.number().int(), y: z.number().int(),
  w: z.number().int().nonnegative(), h: z.number().int().nonnegative(), cls: z.string().max(256), title: z.string().max(512),
  hung: z.boolean(), minimiert: z.boolean(),
}).strict();
const resultSchema = z.object({
  ok: z.literal(true), desktop: z.string(), pid, startPid: pid, wartesekunden: z.number().nonnegative(), kommandozeile: z.string(),
  fenster: z.array(windowSchema).max(256), dialogWindows: z.array(windowSchema).max(256), ready: z.boolean(), blockedByDialog: z.boolean(),
  instance: z.object({ pid, hwnd: z.number().int().positive().safe(), title: z.string(), bindingMode: z.literal("desktop-launch-window") }).strict().nullable(),
  product: z.object({ image: z.string(), fileMajor: z.number().int().nonnegative(), fileVersion: z.string(), productName: z.string(), companyName: z.string() }).strict(),
  loaderBuildIdentity: z.string(), loaderMs: z.number().nonnegative(),
}).strict();
const failedResultSchema = z.object({
  ok: z.literal(false), kind: z.string(), error: z.string(), desktop: z.string(), pid,
  processStillRunning: z.boolean(), markerBeibehalten: z.boolean(), markerRemoved: z.boolean(),
  cleanupErrors: z.array(z.string()).max(16), outcomeUnknown: z.boolean(), loaderBuildIdentity: z.string(), loaderMs: z.number().nonnegative(),
}).strict();

function localPath(value: string): string {
  const path = win32.normalize(value);
  if (!/^[A-Za-z]:\\/u.test(path) || /["\u0000-\u001f]/u.test(path) || path.length > 32767)
    throw failure("bad-args", "Native desktop start requires an absolute local path.");
  return path;
}
export function prepareNativeDesktopStart(options: NativeDesktopStartOptions) {
  const { args, profile } = options;
  const name = args.name ?? "SSEAuto", mode = args.mode ?? "einur";
  if (typeof name !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(name) || typeof mode !== "string" || !Object.hasOwn(profile.startModes, mode))
    throw failure("bad-args", "Invalid desktop name or unsupported SSE start mode.");
  const executable = localPath(typeof args.exe === "string" ? args.exe : options.executable);
  if (win32.basename(executable).toLowerCase() !== profile.executable.name.toLowerCase()
    || win32.basename(win32.dirname(executable)).toLowerCase() !== profile.executable.installationFolderName.toLowerCase())
    throw failure("unsupported-version", "Executable path differs from the selected product profile.");
  const timeoutSec = args.timeoutSec ?? 30;
  if (typeof timeoutSec !== "number" || !Number.isInteger(timeoutSec) || timeoutSec < 3 || timeoutSec > 90)
    throw failure("bad-args", "Native desktop startup timeout must be between 3 and 90 seconds.");
  let caseIdentity: { path: string; documentType: string; taxYear: number; mode: string; supported: true } | null = null;
  if (args.file !== undefined) {
    if (typeof args.file !== "string" || !args.file) throw failure("bad-args", "Invalid case path.");
    const path = localPath(args.file), types = Object.values(profile.startModes);
    const match = new RegExp(`\\.(${types.map(type => type.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})([0-9]{4})(?:_Backup)?$`, "iu")
      .exec(win32.basename(path));
    if (!match) throw failure("unsupported-case", "Case extension is not supported by the selected product profile.");
    if (match[1]!.toLowerCase() !== profile.startModes[mode]!.toLowerCase()) throw failure("mode-mismatch", "Start mode and case type differ.");
    const taxYear = Number(match[2]);
    if (![profile.taxYear, ...(profile.additionalCaseYears[mode] ?? [])].includes(taxYear))
      throw failure("unsupported-year", "Case year is not allowed for the selected start mode.");
    let regular = false;
    try { regular = statSync(path).isFile(); } catch { /* Report the case existence boundary, without raw filesystem diagnostics. */ }
    if (!regular) throw failure("not-found", "Case file does not exist or is not a regular file.");
    caseIdentity = { path, documentType: match[1]!, taxYear, mode, supported: true };
  }
  return { name, mode, executable, caseIdentity, timeoutSec };
}

export function parseNativeDesktopStart(value: unknown, prepared: ReturnType<typeof prepareNativeDesktopStart>, options: NativeDesktopStartOptions): WorkerResult {
  const result = resultSchema.parse(value);
  if (result.loaderBuildIdentity !== options.package.manifest.buildIdentity || result.desktop !== prepared.name
    || result.pid !== result.startPid || result.product.image.toLowerCase() !== prepared.executable.toLowerCase()
    || result.product.fileMajor !== options.profile.engineFileMajor
    || result.fenster.some(window => window.pid !== result.pid) || result.dialogWindows.some(window => window.pid !== result.pid)
    || result.ready !== Boolean(result.instance) || result.blockedByDialog !== Boolean(result.dialogWindows.length)
    || (result.instance && (result.instance.pid !== result.pid || !result.fenster.some(window => window.hwnd === result.instance?.hwnd
      && window.title === result.instance.title))))
    throw failure("native-binding", "Native desktop start returned an inconsistent process ownership binding.", true);
  const profile = options.profile;
  const windows = (items: z.infer<typeof windowSchema>[]) => items.map(window => ({ ...window,
    titleFingerprint: createHash("sha256").update(window.title, "utf8").digest("hex").toUpperCase(),
  }));
  const product = { path: result.product.image, exists: true, supported: true, reason: `${profile.product} verifiziert.`, taxYear: profile.taxYear,
    expectedFileMajor: profile.engineFileMajor, fileMajor: result.product.fileMajor, fileMajorSource: "FileMajorPart",
    fileVersion: result.product.fileVersion, productName: result.product.productName, companyName: result.product.companyName,
    folder: win32.basename(win32.dirname(result.product.image)) };
  return { ok: true, backend: "win32", desktop: result.desktop, pid: result.pid, startPid: result.startPid, wartesekunden: result.wartesekunden,
    kommandozeile: result.kommandozeile, fenster: windows(result.fenster), product, case: prepared.caseIdentity,
    instance: result.instance, ready: result.ready, blockedByDialog: result.blockedByDialog, dialogWindows: windows(result.dialogWindows), nativeMs: result.loaderMs,
    note: `SSE laeuft auf dem unsichtbaren Desktop '${prepared.name}'. Fuer den Nutzer nicht sichtbar; alle Werkzeuge greifen normal darauf zu. Beenden mit sse_desktop_stop.` };
}

/** No UIA startup, input-desktop switch, fallback or retry. An uncertain launch remains explicitly uncertain. */
export async function executeNativeDesktopStart(options: NativeDesktopStartOptions): Promise<WorkerResult> {
  const started = performance.now();
  try {
    if (options.signal?.aborted) throw failure("aborted", "Desktop start cancelled before launch.");
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 6500 || options.timeoutMs > 120000)
      throw failure("native-deadline", "Native desktop start requires a bounded deadline including verified cleanup.");
    const prepared = prepareNativeDesktopStart(options), markerPath = desktopMarkerPath();
    const marker = readDesktopMarker(markerPath);
    if (marker && marker.owner !== "sse") throw failure("desktop-marker-owner", "Desktop belongs to a different controller.");
    const remaining = Math.floor(options.timeoutMs - (performance.now() - started));
    if (remaining < 6500) throw failure("native-deadline", "Not enough time remains for startup and verified cleanup.");
    const request = { mode: "desktop-start", desktop: prepared.name, startMode: prepared.mode, expectedImage: prepared.executable,
      expectedProfile: options.package.manifest.profile, markerPath, waitMs: Math.min(prepared.timeoutSec * 1000, remaining - 6000),
      ...(prepared.caseIdentity ? { casePath: prepared.caseIdentity.path } : {}) };
    const body = Buffer.from(JSON.stringify(request));
    if (body.length > 65536) throw failure("native-request-size", "Native desktop start request exceeds its bound.");
    const result = await new Promise<WorkerResult>((resolve, reject) => {
      const child = execFile(options.package.loaderPath, ["--stdin"], {
        windowsHide: true, encoding: "buffer", maxBuffer: 1024 * 1024, timeout: remaining, signal: options.signal,
      }, (error, stdout, stderr) => {
        try {
          if (options.signal?.aborted || error?.killed) throw failure(options.signal?.aborted ? "aborted" : "native-timeout",
            "Native launch response was interrupted; inspect desktop_status before any further launch.", Boolean(child.pid));
          if (error) {
            let known: string | undefined;
            try {
              const diagnostic = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stderr)) as { kind?: unknown };
              if (["worker-busy", "worker-isolation-lost", "desktop-marker-invalid", "desktop-marker-owner", "stale-marker", "desktop-active",
                "desktop-occupied", "desktop", "marker-cleanup", "bad-args", "unsupported-version", "unsupported-case",
                "mode-mismatch", "unsupported-year", "launch", "aborted"].includes(String(diagnostic.kind)))
                known = String(diagnostic.kind);
            } catch { /* Only structured native pre-launch errors establish that no process was handed off. */ }
            throw failure(known ?? "native-transport", "Native desktop start could not complete; inspect desktop ownership before retrying.", Boolean(child.pid) && !known);
          }
          const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stdout));
          if ((raw as { ok?: unknown })?.ok === false) {
            const failed = failedResultSchema.parse(raw);
            if (failed.loaderBuildIdentity !== options.package.manifest.buildIdentity || failed.desktop !== prepared.name
              || (!failed.outcomeUnknown && (failed.processStillRunning || !failed.markerRemoved)))
              throw failure("native-contract", "Native cleanup result is inconsistent.", true);
            const { loaderBuildIdentity: _identity, loaderMs, ...reported } = failed;
            resolve({ ...reported, backend: "win32", nativeMs: loaderMs }); return;
          }
          const success = parseNativeDesktopStart(raw, prepared, options);
          const owned = readDesktopMarker(markerPath);
          if (!owned || owned.owner !== "sse" || owned.name !== prepared.name || owned.pid !== success.pid)
            throw failure("native-binding", "Desktop ownership changed after launch handoff.", true);
          resolve(success);
        } catch (error) { reject(error instanceof QtNativeTransportError ? error : failure("native-contract", "Native launch result could not be verified.", true)); }
      });
      child.stdin?.on("error", () => {}); child.stdin?.end(body);
    });
    return { ...result, ms: performance.now() - started };
  } catch (error) {
    return { ok: false, backend: "win32", kind: error instanceof QtNativeTransportError || error instanceof DesktopMarkerError ? error.kind : "native-contract",
      error: error instanceof Error ? error.message : "Native desktop start failed.", outcomeUnknown: error instanceof QtNativeTransportError && error.outcomeUnknown,
      ms: performance.now() - started };
  }
}
