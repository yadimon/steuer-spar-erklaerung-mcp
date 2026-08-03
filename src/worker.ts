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
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveWindowsPowerShell } from "./windows-runtime.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const WORKER = join(HERE, "..", "powershell", "sse-worker.ps1");
export const DESKTOP_LAUNCHER = join(HERE, "..", "powershell", "run-on-desktop.ps1");
/** Marke, die sse_desktop_start hinterlaesst: Desktopname und eigene SSE-PID. */
const DESKTOP_MARKER = join(process.env.TEMP ?? process.env.TMP ?? ".", "sse-mcp-desktop.txt");
const VALID_DESKTOP_NAME = /^[A-Za-z0-9_-]{1,64}$/;

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
    const raw = readFileSync(DESKTOP_MARKER, "utf8").trim();
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

/** PowerShell liefert einelementige Listen als Einzelobjekt - hier geradeziehen. */
export function asArray<T>(v: unknown): T[] {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? (v as T[]) : [v as T];
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

export function callWorker(
  op: string,
  args: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<WorkerResult> {
  const run = () => {
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
  schlange = naechster.catch(() => undefined);
  return naechster;
}

async function callWorkerUnsynchronised(
  op: string,
  args: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<WorkerResult> {
  const b64 = Object.keys(args).length
    ? Buffer.from(JSON.stringify(args), "utf8").toString("base64")
    : "";

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
       "-Op", op, "-B64", b64, "-Desktop", desk, "-TimeoutSec", String(Math.max(30, Math.floor(timeoutMs / 1000) - 5))]
    : ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", WORKER, "-Op", op, "-B64", b64];

  return new Promise((resolve, reject) => {
    // Auch der Launcher fuer den alternativen Desktop bleibt unsichtbar. Der
    // aktuelle Launcher erzeugt den eigentlichen UIA-Arbeiter selbst mit
    // CREATE_NEW_CONSOLE auf dem Ziel-Desktop; er braucht deshalb kein
    // sichtbares Konsolenfenster des Elternprozesses mehr. So gibt es pro
    // API-Aufruf weiterhin einen frischen UIA-Prozess, aber kein schwarzes
    // PowerShell-/Batch-Fenster auf dem Benutzer-Desktop.
    const child = spawn(
      resolveWindowsPowerShell(),
      ["-ExecutionPolicy", "Bypass", ...argv],
      { windowsHide: true },
    );

    let out = "";
    let err = "";
    let settled = false;
    let timeoutError: WorkerError | null = null;
    let graceTimer: NodeJS.Timeout | undefined;
    let hardTimer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      if (hardTimer) clearTimeout(hardTimer);
      signal?.removeEventListener("abort", onAbort);
    };

    const rejectTermination = () => {
      if (settled || !timeoutError) return;
      settled = true;
      cleanup();
      reject(timeoutError);
    };

    const killTree = () => {
      if (settled) return;
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
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

    child.stdout.on("data", (d) => (out += d.toString("utf8")));
    child.stderr.on("data", (d) => (err += d.toString("utf8")));
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new WorkerError(`PowerShell liess sich nicht starten: ${e.message}`, "spawn"));
    });

    child.on("close", () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (timeoutError) {
        reject(timeoutError);
        return;
      }
      const text = out.trim();
      if (!text) {
        reject(
          new WorkerError(
            `Arbeitsprozess '${op}' lieferte keine Ausgabe.` + (err ? ` stderr: ${err.trim()}` : ""),
            "empty",
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(text) as WorkerResult);
      } catch {
        reject(
          new WorkerError(
            `Antwort von '${op}' war kein JSON. Anfang: ${text.slice(0, 400)}` +
              (err ? ` | stderr: ${err.trim()}` : ""),
            "parse",
          ),
        );
      }
    });
  });
}
