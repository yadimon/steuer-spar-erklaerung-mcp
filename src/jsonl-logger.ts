import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";

export interface RotatingJsonlLoggerOptions {
  logPath: string;
  maxBytes: number;
  maxLineBytes?: number;
  now?: () => Date;
  writeDiagnostic?: (line: string) => void;
}

export interface RotatingJsonlLogger {
  log: (record: Record<string, unknown>) => void;
  isFileLoggingAvailable: () => boolean;
}

const DEFAULT_MAX_LINE_BYTES = 64 * 1024;

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} muss eine positive Ganzzahl sein.`);
  }
}

function assertRegularFile(path: string): void {
  if (!existsSync(path)) return;
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Logpfad ist keine regulaere Datei: ${path}`);
  }
}

/**
 * Erstellt einen synchronen, begrenzten JSONL-Logger fuer kleine
 * Betriebsereignisse. Dateifehler deaktivieren nur die optionale Dateiablage;
 * die Diagnoseausgabe und damit die API bleiben verfuegbar.
 */
export function createRotatingJsonlLogger(options: RotatingJsonlLoggerOptions): RotatingJsonlLogger {
  requirePositiveInteger(options.maxBytes, "maxBytes");
  const maxLineBytes = options.maxLineBytes ?? Math.min(DEFAULT_MAX_LINE_BYTES, options.maxBytes);
  requirePositiveInteger(maxLineBytes, "maxLineBytes");
  if (maxLineBytes > options.maxBytes) {
    throw new Error("maxLineBytes darf maxBytes nicht ueberschreiten.");
  }

  const previousPath = `${options.logPath}.1`;
  const now = options.now ?? (() => new Date());
  const writeDiagnostic = options.writeDiagnostic ?? ((line: string) => process.stderr.write(line));
  let fileLoggingAvailable = true;
  let logBytes = 0;
  let fileFailureReported = false;

  const timestamp = (): string => {
    try { return now().toISOString(); } catch { return "1970-01-01T00:00:00.000Z"; }
  };
  const diagnosticLine = (record: Record<string, unknown>): string =>
    `${JSON.stringify({ at: timestamp(), ...record })}\n`;
  const safeDiagnostic = (line: string): void => {
    try { writeDiagnostic(line); } catch { /* Diagnoseausgabe bleibt best effort. */ }
  };

  const reportFileFailure = (error: unknown): void => {
    fileLoggingAvailable = false;
    if (fileFailureReported) return;
    fileFailureReported = true;
    safeDiagnostic(diagnosticLine({
      event: "file-log-disabled",
      errorName: error instanceof Error ? error.name : "Error",
    }));
  };

  const rotate = (): void => {
    assertRegularFile(options.logPath);
    assertRegularFile(previousPath);
    if (existsSync(previousPath)) unlinkSync(previousPath);
    if (existsSync(options.logPath)) renameSync(options.logPath, previousPath);
    logBytes = 0;
  };

  try {
    mkdirSync(dirname(options.logPath), { recursive: true });
    assertRegularFile(previousPath);
    if (existsSync(previousPath) && statSync(previousPath).size > options.maxBytes) {
      unlinkSync(previousPath);
    }
    assertRegularFile(options.logPath);
    logBytes = existsSync(options.logPath) ? statSync(options.logPath).size : 0;
    if (logBytes > options.maxBytes) {
      const oversizedBytes = logBytes;
      unlinkSync(options.logPath);
      logBytes = 0;
      safeDiagnostic(diagnosticLine({ event: "file-log-reset", reason: "oversized", originalBytes: oversizedBytes }));
    }
  } catch (error) {
    reportFileFailure(error);
  }

  const log = (record: Record<string, unknown>): void => {
    let line: string;
    try {
      line = diagnosticLine(record);
    } catch (error) {
      line = diagnosticLine({
        event: "log-serialization-failed",
        errorName: error instanceof Error ? error.name : "Error",
      });
    }

    let lineBytes = Buffer.byteLength(line);
    if (lineBytes > maxLineBytes) {
      line = diagnosticLine({ event: "log-record-too-large", originalBytes: lineBytes });
      lineBytes = Buffer.byteLength(line);
    }

    if (fileLoggingAvailable) {
      try {
        if (logBytes + lineBytes > options.maxBytes) rotate();
        appendFileSync(options.logPath, line, "utf8");
        logBytes += lineBytes;
      } catch (error) {
        reportFileFailure(error);
      }
    }
    safeDiagnostic(line);
  };

  return {
    log,
    isFileLoggingAvailable: () => fileLoggingAvailable,
  };
}
