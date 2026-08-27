/**
 * Vorgewaermter Reservearbeiter fuer den PowerShell-Arbeitsprozess.
 *
 * Der Aufruf-Floor lag bei rund 2,5 s, wovon das blosse ZERLEGEN des
 * 14000-Zeilen-Workerskripts den groessten Teil ausmachte. Ein Reservearbeiter
 * erledigt genau diese Vorbereitung im Voraus - Skript zerlegen, Produktprofil
 * lesen, Assemblies und native Interop-DLL laden - und wartet dann auf GENAU
 * EINEN Auftrag auf seiner Standardeingabe. Zwei solcher Prozesse bilden
 * einen kleinen Vorrat, damit ihre laengere Nachfuellzeit nicht jeden zweiten
 * seriellen API-Aufruf wieder kalt starten laesst.
 *
 * Die Isolationsregel "ein Auftrag je Prozess" bleibt unangetastet: Der
 * wartende Prozess hat noch keine einzige UIA-Abfrage gestellt und kann
 * deshalb auch keine vergiftete UIA-Verbindung an den naechsten Aufruf
 * weiterreichen. Nach seinem Auftrag endet er wie jeder andere Arbeiter.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants as osConstants, setPriority } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveWindowsPowerShell } from "./windows-runtime.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = join(HERE, "..", "powershell", "sse-worker.ps1");

/**
 * Das Vorwaermen laeuft absichtlich parallel zu einer laufenden Operation, denn
 * ein Nachfuellen erst danach macht bei zuegiger Aufruffolge jeden zweiten
 * Aufruf wieder kalt (gemessen: 0,25 s mit Reserve gegen 2,2 s ohne).
 *
 * Damit das nicht auf Kosten der UI-Fernsteuerung geht, startet der wartende
 * Prozess mit verminderter Prioritaet: Sein einziger teurer Abschnitt ist das
 * Zerlegen des Workerskripts, und das darf einem echten UIA-Auftrag auch auf
 * einem kleinen Rechner nicht die CPU wegnehmen. Beim Entnehmen bekommt er
 * wieder normale Prioritaet, denn dann fuehrt er selbst den Auftrag aus.
 */
function setSparePriority(child: ChildProcessWithoutNullStreams, priority: number): void {
  if (child.pid === undefined) return;
  try {
    setPriority(child.pid, priority);
  } catch {
    // Prioritaeten sind eine Optimierung. Scheitert sie, bleibt der
    // Reservearbeiter trotzdem gueltig und vollstaendig brauchbar.
  }
}

/** Eine Bereitschaftszeile ist kurz. Alles Laengere ist keine. */
const MAX_HANDSHAKE_BYTES = 4_096;
/** Ein Kind ohne Bereitschaft darf den Pool nicht dauerhaft blockieren. */
const PREWARM_STARTUP_TIMEOUT_MS = positiveDurationFromEnvironment(
  "SSE_WORKER_PREWARM_STARTUP_TIMEOUT_MS",
  15_000,
);
/** Nach einem fehlgeschlagenen Vorwaermen nicht sofort wieder versuchen. */
const PREWARM_RETRY_DELAY_MS = positiveDurationFromEnvironment(
  "SSE_WORKER_PREWARM_RETRY_DELAY_MS",
  30_000,
);
/** Zwei Reserven sind der sparsame Default; schnelle Hosts duerfen vier halten. */
const PREWARM_POOL_SIZE = boundedPoolSizeFromEnvironment();
/** Ohne diesen Schalter liesse sich das Vorwaermen im Test nicht abschalten. */
const PREWARM_DISABLED = process.env.SSE_WORKER_PREWARM === "0";

function positiveDurationFromEnvironment(name: string, fallback: number): number {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function boundedPoolSizeFromEnvironment(): number {
  const configured = Number(process.env.SSE_WORKER_PREWARM_POOL_SIZE);
  if (!Number.isInteger(configured)) return 2;
  return Math.max(1, Math.min(4, configured));
}

export interface WarmSpare {
  child: ChildProcessWithoutNullStreams;
  /** Bytes, die nach der Bereitschaftszeile eintrafen - normalerweise keine. */
  residualStdout: Buffer[];
}

interface PooledSpare extends WarmSpare {
  environmentFingerprint: string;
  ready: boolean;
  discarded: boolean;
  startupPending: boolean;
  release: () => void;
}

/**
 * Vorgewaermt wird nur im dauerhaft laufenden API-Server. Ein kurzlebiger
 * Prozess wuerde sonst nach seinem einzigen Aufruf noch einen Reservearbeiter
 * starten, den niemand mehr abholt.
 */
let enabled = false;
const spares: PooledSpare[] = [];
let starting = 0;
let blockedUntil = 0;
let shuttingDown = false;
let failureReason: string | null = null;

/** Letzter Grund, warum kein Reservearbeiter bereitsteht; null heisst: alles gut. */
export function lastPrewarmFailure(): string | null {
  return failureReason;
}

/** Steht mindestens ein einsatzbereiter Reservearbeiter bereit? */
export function isWarmSpareReady(): boolean {
  return spares.some((candidate) => candidate.ready && !candidate.discarded);
}

/** Begrenzte Pool-Telemetrie fuer Tests und spaetere Health-Ausgabe. */
export function warmSparePoolStatus(): Readonly<{ ready: number; starting: number; target: number }> {
  return {
    ready: spares.filter((candidate) => candidate.ready && !candidate.discarded).length,
    starting,
    target: PREWARM_POOL_SIZE,
  };
}

/**
 * Der Reservearbeiter liest Profil-Id, Programmpfad und Testschalter beim
 * Start aus der Umgebung. Aendert sich davon etwas, passt er nicht mehr zum
 * naechsten Aufruf und wird verworfen, statt still das falsche Profil zu
 * bedienen.
 */
function environmentFingerprint(): string {
  return Object.keys(process.env)
    .filter((name) => name.startsWith("SSE_"))
    .sort()
    .map((name) => `${name}=${process.env[name] ?? ""}`)
    .join("\0");
}

function discard(candidate: PooledSpare, reason: string): void {
  if (candidate.discarded) return;
  candidate.discarded = true;
  candidate.release();
  if (candidate.startupPending) {
    candidate.startupPending = false;
    starting--;
  }
  const index = spares.indexOf(candidate);
  if (index >= 0) spares.splice(index, 1);
  failureReason = reason;
  try { candidate.child.stdin.end(); } catch { /* Pipe ist schon zu. */ }
  try { candidate.child.kill(); } catch { /* Prozess ist schon weg. */ }
}

/**
 * Einen Reservearbeiter im Hintergrund hochziehen.
 *
 * Darf auch waehrend einer laufenden Operation aufgerufen werden: der wartende
 * Prozess laeuft mit verminderter Prioritaet und nimmt der Fernsteuerung damit
 * auch auf einem schwachen Rechner keine CPU weg.
 */
function startWarmSpare(): boolean {
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(
      resolveWindowsPowerShell(),
      ["-ExecutionPolicy", "Bypass", "-NoLogo", "-NoProfile", "-NonInteractive", "-File", WORKER_SCRIPT, "-Prewarm"],
      { windowsHide: true },
    );
  } catch (error) {
    blockedUntil = Date.now() + PREWARM_RETRY_DELAY_MS;
    failureReason = `Reservearbeiter liess sich nicht starten: ${String(error)}`;
    return false;
  }
  setSparePriority(child, osConstants.priority.PRIORITY_BELOW_NORMAL);

  const candidate: PooledSpare = {
    child,
    environmentFingerprint: environmentFingerprint(),
    residualStdout: [],
    ready: false,
    discarded: false,
    startupPending: true,
    release: () => undefined,
  };
  starting++;

  let handshake = "";
  let handshakeDone = false;
  let stderrText = "";
  let startupTimer: NodeJS.Timeout | null = null;

  const clearStartupTimer = () => {
    if (startupTimer === null) return;
    clearTimeout(startupTimer);
    startupTimer = null;
  };

  const onStdout = (chunk: Buffer) => {
    if (handshakeDone) {
      candidate.residualStdout.push(chunk);
      return;
    }
    handshake += chunk.toString("utf8");
    const newline = handshake.indexOf("\n");
    if (newline < 0) {
      if (handshake.length > MAX_HANDSHAKE_BYTES) {
        handshakeDone = true;
        blockedUntil = Date.now() + PREWARM_RETRY_DELAY_MS;
        discard(candidate, "Reservearbeiter meldete keine gueltige Bereitschaftszeile.");
      }
      return;
    }
    const line = handshake.slice(0, newline).trim();
    const rest = handshake.slice(newline + 1);
    handshakeDone = true;
    clearStartupTimer();
    if (rest) candidate.residualStdout.push(Buffer.from(rest, "utf8"));
    if (candidate.startupPending) {
      candidate.startupPending = false;
      starting--;
    }

    let announcement: unknown;
    try { announcement = JSON.parse(line) as unknown; } catch { announcement = null; }
    const ready = Boolean(announcement) && typeof announcement === "object" &&
      (announcement as { prewarm?: unknown }).prewarm === "ready";
    if (!ready) {
      blockedUntil = Date.now() + PREWARM_RETRY_DELAY_MS;
      discard(candidate, `Reservearbeiter meldete statt Bereitschaft: ${line.slice(0, 400)}`);
      return;
    }
    candidate.ready = true;
    failureReason = null;
  };

  const onStderr = (chunk: Buffer) => {
    if (stderrText.length < MAX_HANDSHAKE_BYTES) stderrText += chunk.toString("utf8");
  };

  const onExit = () => {
    clearStartupTimer();
    blockedUntil = Date.now() + PREWARM_RETRY_DELAY_MS;
    const diagnostic = stderrText.trim().slice(0, 400);
    discard(
      candidate,
      `Reservearbeiter endete vor seinem Auftrag.${diagnostic ? ` stderr: ${diagnostic}` : ""}`,
    );
  };

  const onError = (error: Error) => {
    clearStartupTimer();
    blockedUntil = Date.now() + PREWARM_RETRY_DELAY_MS;
    discard(candidate, `Reservearbeiter meldete einen Prozessfehler: ${error.message}`);
  };

  candidate.release = () => {
    clearStartupTimer();
    child.stdout.off("data", onStdout);
    child.stderr.off("data", onStderr);
    child.off("close", onExit);
    child.off("error", onError);
  };

  startupTimer = setTimeout(() => {
    if (handshakeDone || candidate.discarded) return;
    handshakeDone = true;
    blockedUntil = Date.now() + PREWARM_RETRY_DELAY_MS;
    const diagnostic = stderrText.trim().slice(0, 400);
    discard(
      candidate,
      `Reservearbeiter meldete sich nicht innerhalb von ${PREWARM_STARTUP_TIMEOUT_MS} ms bereit.` +
        (diagnostic ? ` stderr: ${diagnostic}` : ""),
    );
  }, PREWARM_STARTUP_TIMEOUT_MS);
  child.stdout.on("data", onStdout);
  child.stderr.on("data", onStderr);
  child.once("close", onExit);
  child.once("error", onError);
  // Ein wartender Reservearbeiter darf den Node-Prozess nicht am Beenden
  // hindern; er ist reine Vorbereitung, kein Auftrag.
  child.unref();
  spares.push(candidate);
  return true;
}

export function ensureWarmSpare(): void {
  if (!enabled || PREWARM_DISABLED || shuttingDown) return;
  if (Date.now() < blockedUntil) return;
  while (spares.length < PREWARM_POOL_SIZE) {
    if (!startWarmSpare()) break;
  }
}

/**
 * Einen Reservearbeiter fuer genau diesen Aufruf uebernehmen. Der Aufrufer
 * stoesst unmittelbar danach das begrenzte Nachfuellen des Vorrats an.
 *
 * Der Aufrufer haengt seine eigenen Listener SYNCHRON an - zwischen dem
 * Abloesen hier und dem Anhaengen dort darf keine Ereignisschleifenrunde
 * liegen, sonst ginge Ausgabe verloren.
 */
export function takeWarmSpare(): WarmSpare | null {
  let candidate: PooledSpare | undefined;
  for (const pooled of [...spares]) {
    if (!pooled.ready || pooled.discarded) continue;
    if (pooled.environmentFingerprint !== environmentFingerprint()) {
      discard(pooled, "Reservearbeiter wurde mit einer anderen SSE-Umgebung vorgewaermt.");
      continue;
    }
    candidate = pooled;
    break;
  }
  if (!candidate) return null;
  const index = spares.indexOf(candidate);
  if (index >= 0) spares.splice(index, 1);
  candidate.release();
  candidate.child.ref();
  // Ab jetzt fuehrt dieser Prozess den echten Auftrag aus und darf nicht mehr
  // hinter anderer Arbeit zurueckstehen.
  setSparePriority(candidate.child, osConstants.priority.PRIORITY_NORMAL);
  return { child: candidate.child, residualStdout: candidate.residualStdout };
}

/**
 * Vorwaermen einschalten und sofort den begrenzten Reservevorrat erzeugen.
 * Wird vom API-Server einmal nach dem erfolgreichen Binden aufgerufen.
 */
export function enableWorkerPrewarm(): void {
  enabled = true;
  shuttingDown = false;
  ensureWarmSpare();
}

/** Beim Herunterfahren der API darf kein wartender PowerShell-Prozess bleiben. */
export function shutdownWarmSpare(): void {
  shuttingDown = true;
  enabled = false;
  for (const candidate of [...spares]) discard(candidate, "API wurde beendet.");
}
