#!/usr/bin/env node
import { setMaxListeners } from "node:events";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import type { Server } from "node:http";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SseApiOperation, WorkerResult } from "./api-contract.js";
import { loadApiServerConfig } from "./api-config.js";
import { createApiExecutor } from "./api-executor.js";
import { createSseApiServer, listenSseApiServer } from "./api-server.js";
import { callWorker } from "./worker.js";
import { withCombinedAbortSignal } from "./abort.js";

export interface ApiShutdownLifecycle {
  requestShutdown: () => void;
  closed: Promise<void>;
  dispose: () => void;
}

export interface ApiShutdownOptions {
  forceAfterMs?: number;
  registerProcessSignals?: boolean;
}

/**
 * Installiert genau einen kontrollierten Shutdown-Pfad fuer Prozesssignale.
 *
 * Der gemeinsame AbortSignal ist absichtlich ein Fan-out-Signal fuer alle
 * laufenden bzw. wartenden API-Aufrufe. Seine Listener werden je Aufruf wieder
 * entfernt; eine unbegrenzte Listenerzahl verhindert hier nur eine falsche
 * MaxListeners-Leakwarnung bei vielen gleichzeitig wartenden Aufrufen.
 */
export function installApiShutdown(
  server: Server,
  shutdown: AbortController,
  log: (record: Record<string, unknown>) => void,
  options: ApiShutdownOptions = {},
): ApiShutdownLifecycle {
  const forceAfterMs = options.forceAfterMs ?? 10_000;
  if (!Number.isFinite(forceAfterMs) || forceAfterMs < 1) {
    throw new Error("forceAfterMs muss eine positive Zahl sein.");
  }
  setMaxListeners(0, shutdown.signal);

  let closing = false;
  let completed = false;
  let forceTimer: NodeJS.Timeout | undefined;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolvePromise) => { resolveClosed = resolvePromise; });

  const disposeSignals = () => {
    process.off("SIGINT", requestShutdown);
    process.off("SIGTERM", requestShutdown);
  };
  const finish = (error?: Error | null) => {
    if (completed) return;
    completed = true;
    if (forceTimer) clearTimeout(forceTimer);
    disposeSignals();
    log({
      event: "shutdown-complete",
      ...(error ? { errorName: error.name, message: error.message } : {}),
    });
    resolveClosed();
  };
  const requestShutdown = () => {
    if (closing) return;
    closing = true;
    process.exitCode = 0;
    disposeSignals();
    log({ event: "shutdown-requested" });
    shutdown.abort(new Error("SSE-API wird kontrolliert beendet."));

    server.close((error) => finish(error));
    // Seit Node 18 verfuegbar; nach server.close aufrufen, damit keine neue
    // Verbindung zwischen beiden Schritten dem Schliessen entgeht.
    server.closeIdleConnections();
    forceTimer = setTimeout(() => {
      if (completed) return;
      log({ event: "shutdown-forced", afterMs: forceAfterMs });
      server.closeAllConnections();
    }, forceAfterMs);
    forceTimer.unref();
  };

  if (options.registerProcessSignals !== false) {
    process.once("SIGINT", requestShutdown);
    process.once("SIGTERM", requestShutdown);
  }
  return {
    requestShutdown,
    closed,
    dispose: () => {
      disposeSignals();
      if (forceTimer) clearTimeout(forceTimer);
    },
  };
}

/**
 * Haengt ein Kontrollbild nur aus dem konfigurierten Ergebnisbereich an.
 * Ein verschwundenes Bild oder ein alter direkter API-Pfad ausserhalb dieses
 * Bereichs darf den bereits erfolgreichen Worker-Aufruf nicht nachtraeglich
 * in einen 502-Fehler verwandeln; in diesem Fall bleibt das strukturierte
 * Ergebnis erhalten und nur der optionale Bildanhang fehlt.
 */
export function attachScreenshotImage(
  resultDir: string,
  operation: SseApiOperation,
  args: Record<string, unknown>,
  result: WorkerResult,
): WorkerResult {
  if (operation !== "screenshot" || args.includeImage !== true || result.ok === false) return result;
  const shot = result.shot as { path?: unknown } | undefined;
  const path = typeof shot?.path === "string" ? shot.path : "";
  if (!path) return result;
  try {
    const safeRoot = realpathSync(resultDir);
    const imagePath = realpathSync(path);
    const fromRoot = relative(safeRoot, imagePath);
    if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
      return {
        ...result,
        imageReadError: "Kontrollbild liegt ausserhalb des konfigurierten Ergebnisbereichs; Bildinhalt wurde nicht gelesen.",
      };
    }
    if (!statSync(imagePath).isFile()) throw new Error("Kontrollbild ist keine regulaere Datei.");
    return { ...result, imageBase64: readFileSync(imagePath).toString("base64") };
  } catch {
    return {
      ...result,
      imageReadError: "Kontrollbild konnte nach erfolgreichem Worker-Aufruf nicht gelesen werden; Ergebnis bleibt erhalten.",
    };
  }
}

async function main(): Promise<void> {
  const configIndex = process.argv.indexOf("--config");
  if (configIndex >= 0) {
    const configPath = process.argv[configIndex + 1];
    if (!configPath) throw new Error("--config verlangt einen Pfad.");
    process.env.SSE_API_CONFIG = configPath;
  }
  const config = loadApiServerConfig();
  process.env.SSE_PROFILE_ID = config.profileId;
  if (config.caseDir) process.env.SSE_CASE_DIR = config.caseDir;
  if (config.sseExecutable) process.env.SSE_EXECUTABLE = config.sseExecutable;
  const shutdown = new AbortController();

  const execute = createApiExecutor(config, async (operation, args, timeoutMs, signal) => {
    const result = await withCombinedAbortSignal([signal, shutdown.signal], (combinedSignal) =>
      callWorker(operation, args, timeoutMs, combinedSignal));
    return attachScreenshotImage(config.resultDir, operation, args, result);
  });

  const logDir = join(dirname(config.configPath), "logs");
  const logPath = join(logDir, "api.jsonl");
  const maxLogBytes = 5 * 1024 * 1024;
  mkdirSync(logDir, { recursive: true });
  const rotateLog = () => {
    const previous = `${logPath}.1`;
    if (existsSync(previous)) unlinkSync(previous);
    if (existsSync(logPath)) renameSync(logPath, previous);
  };
  if (existsSync(logPath) && statSync(logPath).size > maxLogBytes) rotateLog();
  let logBytes = existsSync(logPath) ? statSync(logPath).size : 0;
  const log = (record: Record<string, unknown>) => {
    const line = `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`;
    const lineBytes = Buffer.byteLength(line);
    if (logBytes + lineBytes > maxLogBytes) {
      rotateLog();
      logBytes = 0;
    }
    appendFileSync(logPath, line, "utf8");
    logBytes += lineBytes;
    process.stderr.write(line);
  };

  const server = createSseApiServer({
    config,
    execute,
    log,
  });
  await listenSseApiServer(server, config.host, config.port);
  log({ event: "ready", host: config.host, port: config.port });
  installApiShutdown(server, shutdown, log);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.on("unhandledRejection", (error) => {
    process.stderr.write(`Unbehandelte Promise-Ablehnung: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });

  main().catch((error) => {
    process.stderr.write(`SSE-API-Start fehlgeschlagen: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
