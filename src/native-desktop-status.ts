import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { win32 } from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import type { WorkerResult } from "./api-contract.js";
import { DesktopMarkerError, desktopMarkerPath, readDesktopMarker, type DesktopMarker } from "./desktop-marker.js";
import type { ProductProfile } from "./product-profiles.js";
import type { QtNativePackage } from "./qt-native-package.js";
import { QtNativeTransportError } from "./qt-native-client.js";

export interface NativeDesktopStatusOptions {
  package: QtNativePackage;
  profile: ProductProfile;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Internal test seam; production always reads the bounded ownership marker. */
  readMarker?: () => DesktopMarker | null;
}
const pidSchema = z.number().int().min(0).max(0xffffffff);
const windowSchema = z.object({
  hwnd: z.number().int().positive().safe(), pid: pidSchema,
  x: z.number().int(), y: z.number().int(), w: z.number().int().nonnegative(), h: z.number().int().nonnegative(),
  cls: z.string().max(256), title: z.string().max(512), hung: z.boolean(), minimiert: z.boolean(),
}).strict();
const statusSchema = z.object({
  ok: z.literal(true), desktop: z.string(), pid: pidSchema, reachable: z.boolean(),
  process: z.object({
    image: z.string().max(32768), fileMajor: z.number().int().min(0).max(65535), fileVersion: z.string().max(4096),
    productName: z.string().max(4096), creationTime: z.string().regex(/^[1-9][0-9]{0,19}$/u)
      .refine(value => BigInt(value) <= 0xffffffffffffffffn),
  }).strict().nullable(),
  windows: z.array(windowSchema).max(256), loaderBuildIdentity: z.string(), loaderMs: z.number().finite().nonnegative(),
}).strict();
const failure = (message: string, kind = "native-contract") => new QtNativeTransportError(message, kind);

export function parseNativeDesktopStatus(value: unknown, marker: DesktopMarker, options: NativeDesktopStatusOptions): WorkerResult {
  const status = statusSchema.parse(value), profile = options.profile;
  if (status.loaderBuildIdentity !== options.package.manifest.buildIdentity || status.desktop !== marker.name
    || status.pid !== (marker.pid ?? 0) || status.windows.some(window => window.pid !== marker.pid)
    || (!status.reachable && status.windows.length)) throw failure("Native status returned a different ownership binding.", "native-binding");
  let identity: Record<string, unknown> | null = null;
  if (status.process) {
    const process = status.process, name = win32.basename(process.image), folder = win32.basename(win32.dirname(process.image));
    if (!marker.pid || !win32.isAbsolute(process.image)) throw failure("Native process identity is invalid.");
    const fallbackMajor = /^\s*(\d+)/u.exec(process.fileVersion)?.[1];
    const major = process.fileMajor || (fallbackMajor ? Number(fallbackMajor) : null);
    const fileNameOk = name.toLowerCase() === profile.executable.name.toLowerCase();
    const folderOk = folder.toLowerCase() === profile.executable.installationFolderName.toLowerCase();
    const supported = fileNameOk && folderOk && major === profile.engineFileMajor;
    const reason = !fileNameOk ? `Dateiname '${name}' ist nicht ${profile.executable.name}.`
      : !folderOk ? `Installationsordner '${folder}' ist nicht ${profile.executable.installationFolderName}.`
      : major !== profile.engineFileMajor ? `Engine-Hauptversion '${major ?? ""}' ist nicht ${profile.engineFileMajor}.`
      : `${profile.product} verifiziert.`;
    identity = { pid: marker.pid, processName: win32.basename(name, win32.extname(name)), path: process.image, supported, reason,
      fileMajor: major, fileMajorSource: process.fileMajor ? "FileMajorPart" : "FileVersion-fallback", fileVersion: process.fileVersion,
      folder, productName: process.productName, taxYear: supported ? profile.taxYear : null };
  }
  const running = identity?.supported === true;
  const windows = running ? status.windows.map(window => ({ ...window,
    titleFingerprint: createHash("sha256").update(window.title, "utf8").digest("hex").toUpperCase(),
  })) : [];
  const active = Boolean(marker.pid && running && status.reachable && windows.length);
  return { ok: true, backend: "win32", aktiv: active, desktop: marker.name, pid: marker.pid ?? 0,
    sseLaeuft: running, processIdentity: identity, desktopErreichbar: status.reachable, markeVeraltet: !active,
    fenster: windows, nativeMs: status.loaderMs,
    note: marker.owner === "center-test"
      ? "Status hat einen Center-Testmarker nur diagnostiziert; keine SSE-Instanz wurde uebernommen oder veraendert."
      : `Status hat den markierten Desktop '${marker.name}' explizit geoeffnet und nur PID ${marker.pid ?? 0} geprueft.` };
}

async function readNativeStatus(marker: DesktopMarker, options: NativeDesktopStatusOptions): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(options.package.loaderPath, ["--stdin"], {
      windowsHide: true, encoding: "buffer", maxBuffer: 1024 * 1024, timeout: options.timeoutMs, signal: options.signal,
    }, (error, stdout, stderr) => {
      if (options.signal?.aborted) { reject(failure("Native status cancelled.", "aborted")); return; }
      if (error) {
        let kind = error.killed ? "native-timeout" : "native-binding";
        try {
          const diagnostic = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stderr)) as { kind?: unknown };
          if (["worker-busy", "worker-isolation-lost", "desktop-marker-invalid"].includes(String(diagnostic.kind))) kind = String(diagnostic.kind);
        } catch { /* Do not expose raw native diagnostics through the API. */ }
        reject(failure("Native desktop status could not complete its bounded read.", kind)); return;
      }
      try { resolve(parseNativeDesktopStatus(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stdout)), marker, options)); }
      catch (error) { reject(error instanceof QtNativeTransportError ? error : failure("Native status returned an invalid result.")); }
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(JSON.stringify({ mode: "desktop-status", desktop: marker.name, pid: marker.pid ?? 0 }));
  });
}

/** A fresh diagnostic read; no cached status, attachment, replay or Worker fallback. */
export async function executeNativeDesktopStatus(options: NativeDesktopStatusOptions): Promise<WorkerResult> {
  const start = performance.now();
  try {
    if (options.signal?.aborted) throw failure("Native status cancelled before launch.", "aborted");
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60_000)
      throw failure("Invalid native status deadline.", "native-deadline");
    const readMarker = options.readMarker ?? (() => readDesktopMarker(desktopMarkerPath()));
    const marker = readMarker();
    const remaining = Math.floor(options.timeoutMs - (performance.now() - start));
    if (remaining < 1) throw failure("Native status deadline exceeded before launch.", "native-timeout");
    const result = marker ? await readNativeStatus(marker, { ...options, timeoutMs: remaining }) : {
      ok: true, backend: "win32", aktiv: false, desktop: null, pid: 0, sseLaeuft: false, processIdentity: null,
      desktopErreichbar: false, markeVeraltet: false, fenster: [], note: "Keine gueltige Desktopmarke geladen.",
    };
    if (options.signal?.aborted) throw failure("Native status cancelled.", "aborted");
    if (JSON.stringify(readMarker()) !== JSON.stringify(marker)) throw failure("Desktop ownership changed during native status.", "native-binding");
    return { ...result, ms: performance.now() - start };
  } catch (error) {
    return { ok: false, backend: "win32", kind: error instanceof QtNativeTransportError || error instanceof DesktopMarkerError ? error.kind : "native-contract",
      error: error instanceof QtNativeTransportError || error instanceof DesktopMarkerError ? error.message : "Native desktop status failed.",
      ms: performance.now() - start };
  }
}
