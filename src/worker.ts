/**
 * Bruecke zum PowerShell-Arbeitsprozess.
 *
 * Bewusst EIN PROZESS PRO AUFRUF: die UI-Automation-Schnittstelle der
 * SteuerSparErklaerung (Qt 6) vergiftet nach einem harten Fehler die gesamte
 * UIA-Verbindung des Prozesses - danach liefert jede weitere Abfrage still
 * "0 Treffer" statt einer Fehlermeldung. Ein frischer Prozess je Aufruf ist
 * die einzige verlaessliche Gegenmassnahme. Der gemessene Aufruf-Floor liegt
 * inklusive Windows-PowerShell- und nativer Hilfstyp-Initialisierung bei rund
 * 2 s; der persistente Node-MCP vermeidet nur den MCP-Handshake. Deshalb
 * werden fachliche Vorher/Nachher-Schritte in einer Worker-Action gebuendelt.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveWindowsPowerShell } from "./windows-runtime.js";
import { MAX_API_BODY_BYTES, MAX_WORKER_QUEUE_DEPTH } from "./api-contract.js";
import { readFileBounded } from "./bounded-files.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const WORKER = join(HERE, "..", "powershell", "sse-worker.ps1");
export const DESKTOP_LAUNCHER = join(HERE, "..", "powershell", "run-on-desktop.ps1");
const TASKKILL = join(
  process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows",
  "System32",
  "taskkill.exe",
);
/** Marke, die sse_desktop_start hinterlaesst: Desktopname und eigene SSE-PID. */
const DESKTOP_MARKER = join(process.env.TEMP ?? process.env.TMP ?? ".", "sse-mcp-desktop.txt");
const VALID_DESKTOP_NAME = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_DESKTOP_MARKER_BYTES = 4 * 1024;

/**
 * Laeuft die Anwendung auf einem eigenen, unsichtbaren Desktop?
 *
 * Dann muss der Arbeiter DORT geboren werden: SetThreadDesktop nachtraeglich
 * scheitert mit Fehler 170, sobald der Thread ein Fenster besitzt - und
 * PowerShell hat beim Start eines. run-on-desktop.ps1 startet ihn per
 * CreateProcess mit lpDesktop und reicht das Ergebnis ueber eine Datei
 * zurueck, weil die Standardausgabe die Desktop-Grenze nicht ueberquert.
 */
function versteckterDesktop(): string | null {
  try {
    const raw = new TextDecoder("utf-8", { fatal: true })
      .decode(readFileBounded(DESKTOP_MARKER, MAX_DESKTOP_MARKER_BYTES))
      .trim();
    if (!raw) return null;
    if (raw.startsWith("{")) {
      const marker = JSON.parse(raw) as { name?: unknown };
      const name = typeof marker.name === "string" ? marker.name.trim() : "";
      return VALID_DESKTOP_NAME.test(name) ? name : null;
    }
    // Rueckwaertskompatibel zu alten Nur-Name-Marken.
    return VALID_DESKTOP_NAME.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Standardfrist je Aufruf. Baumlaeufe brauchen selten mehr als 5 s. */
const DEFAULT_TIMEOUT_MS = 90_000;
export const MAX_WORKER_STDOUT_BYTES = 32 * 1024 * 1024;
export const MAX_WORKER_STDERR_BYTES = 1024 * 1024;
export const MAX_WORKER_DIAGNOSTIC_CHARACTERS = 4_096;
export const MAX_WORKER_ARGUMENT_BYTES = MAX_API_BODY_BYTES;

function createWorkerArgumentsFile(args: Record<string, unknown>): string {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(JSON.stringify(args), "utf8");
  } catch (error) {
    throw new WorkerError(`Worker-Argumente liessen sich nicht serialisieren: ${String(error)}`, "bad-args");
  }
  if (bytes.length > MAX_WORKER_ARGUMENT_BYTES) {
    throw new WorkerError(
      `Worker-Argumente sind groesser als ${MAX_WORKER_ARGUMENT_BYTES} Bytes.`,
      "payload-too-large",
    );
  }
  const path = join(tmpdir(), `sse-args-${randomUUID().replaceAll("-", "")}.json`);
  const descriptor = openSync(path, "wx", 0o600);
  let failure: unknown;
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } catch (error) {
    failure = error;
  } finally {
    try { closeSync(descriptor); } catch (error) { failure ??= error; }
  }
  if (failure !== undefined) {
    const cleanupError = removeWorkerArgumentsFile(path);
    const detail = cleanupError ? ` ${cleanupError.message}` : "";
    throw new WorkerError(`Interne Worker-Argumentdatei liess sich nicht schreiben.${detail}`, "worker-transport");
  }
  return path;
}

function removeWorkerArgumentsFile(path: string): WorkerError | null {
  try {
    unlinkSync(path);
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return new WorkerError(
      "Interne Worker-Argumentdatei konnte nicht entfernt werden; lokalen Temp-Ordner kontrollieren.",
      "worker-transport-cleanup",
    );
  }
}

export function summarizeWorkerDiagnostic(value: string): string {
  if (value.length <= MAX_WORKER_DIAGNOSTIC_CHARACTERS) return value;
  const bytes = Buffer.from(value, "utf8");
  const digest = createHash("sha256").update(bytes).digest("hex");
  return `${value.slice(0, MAX_WORKER_DIAGNOSTIC_CHARACTERS)}\n` +
    `[Diagnose gekuerzt: ${bytes.length} UTF-8-Bytes, sha256=${digest}]`;
}

export interface WorkerResult {
  ok: boolean;
  kind?: string;
  error?: string;
  ms?: number;
  [k: string]: unknown;
}

export class WorkerError extends Error {
  constructor(message: string, readonly kind: string = "worker") {
    super(message);
    this.name = "WorkerError";
  }
}

export function parseWorkerResult(text: string, operation: string): WorkerResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new WorkerError(
      `Antwort von '${operation}' war kein JSON. Anfang: ${text.slice(0, 400)}`,
      "parse",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof (parsed as { ok?: unknown }).ok !== "boolean") {
    throw new WorkerError(
      `Antwort von '${operation}' war kein Ergebnisobjekt mit booleschem ok-Status.`,
      "parse",
    );
  }
  return parsed as WorkerResult;
}

/**
 * Serialisierung ALLER Aufrufe.
 *
 * Zwei gleichzeitige Aufrufe wuerden dieselbe Anwendung bearbeiten: Ein
 * Lesevorgang koennte einen Mischzustand aus zwei Seiten sehen, ein Schreiben
 * das falsche Feld treffen, weil zwischen Baumlauf und Zugriff geblaettert
 * wurde, und zwei Klicks streiten sich um denselben Mauszeiger. Deshalb
 * laeuft immer nur ein Arbeitsprozess.
 */
let schlange: Promise<unknown> = Promise.resolve();
let queueDepth = 0;
let workerRuntimeFailure: WorkerError | null = null;

export function callWorker(
  op: string,
  args: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<WorkerResult> {
  if (workerRuntimeFailure) {
    return Promise.reject(new WorkerError(workerRuntimeFailure.message, workerRuntimeFailure.kind));
  }
  if (queueDepth >= MAX_WORKER_QUEUE_DEPTH) {
    return Promise.reject(
      new WorkerError(
        `SSE-Arbeitsqueue ist mit ${MAX_WORKER_QUEUE_DEPTH} Auftraegen ausgelastet; Zustand spaeter lesen statt blind wiederholen.`,
        "busy",
      ),
    );
  }
  queueDepth += 1;
  let started = false;
  const run = () => {
    if (workerRuntimeFailure) {
      return Promise.reject(new WorkerError(workerRuntimeFailure.message, workerRuntimeFailure.kind));
    }
    started = true;
    if (signal?.aborted) {
      return Promise.reject(
        new WorkerError("API-Client hat den Aufruf vor dem Start abgebrochen; Zustand vor Wiederholung lesen.", "aborted"),
      );
    }
    return callWorkerUnsynchronised(op, args, timeoutMs, signal);
  };
  const naechster = schlange.then(
    run,
    run,
  );
  // Kette darf nicht durch einen Fehler abreissen.
  const settled = naechster.finally(() => { queueDepth -= 1; });
  schlange = settled.catch(() => undefined);
  if (!signal) return settled;

  // Ein bereits wartender Auftrag soll seinen HTTP-/MCP-Aufrufer sofort
  // freigeben, wenn dieser abbricht. Sein Platzhalter bleibt in der seriellen
  // Kette und wird beim Erreichen wegen desselben Signals ohne Workerstart
  // uebersprungen. Ein bereits laufender Auftrag wartet dagegen weiterhin auf
  // den verifizierten Prozessbaum-Cleanup in callWorkerUnsynchronised.
  return new Promise<WorkerResult>((resolve, reject) => {
    const onAbort = () => {
      if (!started) {
        reject(new WorkerError("API-Client hat den wartenden Auftrag abgebrochen; kein Worker wurde gestartet.", "aborted"));
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    settled.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function callWorkerUnsynchronised(
  op: string,
  args: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<WorkerResult> {
  // JSON in einer exklusiven Tempdatei vermeidet Windows' Kommandozeilenlimit
  // und legt Steuerwerte nicht als Base64 im Prozessargument offen.
  const argsFile = createWorkerArgumentsFile(args);

  // Nur desktop_start muss auf dem sichtbaren Desktop geboren werden, damit
  // es den Ziel-Desktop anlegen kann. status und stop muessen dagegen auf dem
  // bereits markierten Ziel-Desktop laufen: nur dort sieht EnumWindows die
  // SSE-Fenster und nur dort kann ein Speichern-Dialog sicher beantwortet
  // werden. Der fruehere desktop_*-Sonderfall meldete deshalb bei status eine
  // leere Fensterliste und beendete bei stop selbst mit save=true hart.
  // Status laeuft absichtlich sichtbar und oeffnet den markierten Desktop
  // selbst read-only. Ist der Prozess abgestuerzt und das Desktop-Objekt schon
  // verschwunden, koennte der Launcher dort keinen Worker mehr starten und
  // damit gerade den wichtigen Zustand markeVeraltet nicht melden.
  const desk = op === "desktop_start" || op === "desktop_status" ? null : versteckterDesktop();
  const argv: string[] = desk
    ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", DESKTOP_LAUNCHER,
       "-Op", op, "-ArgsFile", argsFile, "-Desktop", desk, "-TimeoutSec", String(Math.max(30, Math.floor(timeoutMs / 1000) - 5))]
    : ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", WORKER, "-Op", op, "-ArgsFile", argsFile];

  return new Promise((resolve, reject) => {
    // Auch der Launcher fuer den alternativen Desktop bleibt unsichtbar. Der
    // aktuelle Launcher erzeugt den eigentlichen UIA-Arbeiter selbst mit
    // CREATE_NEW_CONSOLE auf dem Ziel-Desktop; er braucht deshalb kein
    // sichtbares Konsolenfenster des Elternprozesses mehr. So gibt es pro
    // API-Aufruf weiterhin einen frischen UIA-Prozess, aber kein schwarzes
    // PowerShell-/Batch-Fenster auf dem Benutzer-Desktop.
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(
        resolveWindowsPowerShell(),
        ["-ExecutionPolicy", "Bypass", ...argv],
        { windowsHide: true },
      );
    } catch (error) {
      const spawnError = new WorkerError(`PowerShell liess sich nicht starten: ${String(error)}`, "spawn");
      const cleanupError = removeWorkerArgumentsFile(argsFile);
      reject(cleanupError
        ? new WorkerError(`${spawnError.message} ${cleanupError.message}`, spawnError.kind)
        : spawnError);
      return;
    }

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let settled = false;
    let timeoutError: WorkerError | null = null;
    let argumentCleanupError: WorkerError | null = null;
    let graceTimer: NodeJS.Timeout | undefined;
    let hardTimer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      if (hardTimer) clearTimeout(hardTimer);
      signal?.removeEventListener("abort", onAbort);
      argumentCleanupError ??= removeWorkerArgumentsFile(argsFile);
    };

    const withCleanupResult = (error: WorkerError): WorkerError => argumentCleanupError
      ? new WorkerError(`${error.message} ${argumentCleanupError.message}`, error.kind)
      : error;

    const rejectTermination = () => {
      if (settled || !timeoutError) return;
      if (child.exitCode === null && child.signalCode === null) {
        workerRuntimeFailure ??= new WorkerError(
          "SSE-Workerprozessbaum konnte nicht nachweislich beendet werden. API neu starten und vor weiteren " +
            "Aenderungen laufende SSE-/PowerShell-Prozesse sowie den sichtbaren Fallzustand kontrollieren.",
          "worker-isolation-lost",
        );
      }
      settled = true;
      cleanup();
      const terminationError = workerRuntimeFailure
        ? new WorkerError(`${timeoutError.message} ${workerRuntimeFailure.message}`, timeoutError.kind)
        : timeoutError;
      reject(withCleanupResult(terminationError));
    };

    const killTree = () => {
      if (settled) return;
      if (process.platform === "win32" && child.pid) {
        const killer = spawn(TASKKILL, ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.once("error", () => undefined);
        killer.once("close", () => {
          if (!settled && !hardTimer) hardTimer = setTimeout(rejectTermination, 2_000);
        });
      }
      if (!hardTimer) hardTimer = setTimeout(rejectTermination, 5_000);
    };

    const beginTermination = (error: WorkerError) => {
      if (settled || timeoutError) return;
      timeoutError = error;
      child.kill();
      // Normalfall: Der Launcher schliesst sein Kill-on-close-Jobobjekt und
      // liefert `close`. Falls ein geerbtes Pipe-Handle das verhindert,
      // beendet taskkill nach kurzer Gnadenfrist den gesamten Prozessbaum;
      // ein zweiter Wachhund gibt die globale Queue garantiert wieder frei.
      graceTimer = setTimeout(killTree, 5_000);
    };

    const onAbort = () => {
      beginTermination(
        new WorkerError(
          `API-Client hat '${op}' abgebrochen. Der Zustand ist unbekannt; vor jeder Wiederholung zuerst gezielt lesen.`,
          "aborted",
        ),
      );
    };

    const timer = setTimeout(() => {
      beginTermination(
        new WorkerError(
          `Zeitueberschreitung nach ${timeoutMs} ms bei '${op}'. Der Zustand ist unbekannt; ` +
            "vor jeder Wiederholung zuerst gezielt lesen und danach sse_health pruefen.",
          "timeout",
        ),
      );
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();

    const collect = (
      chunk: Buffer | string,
      chunks: Buffer[],
      currentBytes: number,
      limit: number,
      streamName: string,
    ): number => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const nextBytes = currentBytes + buffer.length;
      if (nextBytes > limit) {
        beginTermination(
          new WorkerError(
            `Arbeitsprozess '${op}' ueberschritt das ${streamName}-Limit von ${limit} Bytes.`,
            "output-too-large",
          ),
        );
        return nextBytes;
      }
      chunks.push(buffer);
      return nextBytes;
    };
    child.stdout.on("data", (chunk) => {
      outBytes = collect(chunk, outChunks, outBytes, MAX_WORKER_STDOUT_BYTES, "Ausgabe");
    });
    child.stderr.on("data", (chunk) => {
      errBytes = collect(chunk, errChunks, errBytes, MAX_WORKER_STDERR_BYTES, "Fehlerausgabe");
    });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(withCleanupResult(new WorkerError(`PowerShell liess sich nicht starten: ${e.message}`, "spawn")));
    });

    child.on("close", () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (timeoutError) {
        reject(withCleanupResult(timeoutError));
        return;
      }
      if (argumentCleanupError) {
        reject(argumentCleanupError);
        return;
      }
      let text: string;
      let err: string;
      try {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        text = decoder.decode(Buffer.concat(outChunks, outBytes)).trim();
        err = decoder.decode(Buffer.concat(errChunks, errBytes)).trim();
      } catch {
        reject(new WorkerError(`Antwort von '${op}' war kein gueltiges UTF-8.`, "parse"));
        return;
      }
      if (!text) {
        const stderr = summarizeWorkerDiagnostic(err);
        reject(
          new WorkerError(
            `Arbeitsprozess '${op}' lieferte keine Ausgabe.` + (stderr ? ` stderr: ${stderr}` : ""),
            "empty",
          ),
        );
        return;
      }
      try {
        resolve(parseWorkerResult(text, op));
      } catch (error) {
        const stderr = summarizeWorkerDiagnostic(err);
        const message = error instanceof Error ? error.message : String(error);
        reject(
          new WorkerError(
            message + (stderr ? ` | stderr: ${stderr}` : ""),
            "parse",
          ),
        );
      }
    });
  });
}
