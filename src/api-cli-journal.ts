import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ApiClientError } from "./api-client-error.js";

interface JournalContext {
  command: string;
  targetOperation?: string;
}

interface CliJournal {
  complete(result: unknown, exitCode: number): void;
  error(kind: string, message: string, exitCode: number): void;
  close(): void;
}

function appendDurably(fileDescriptor: number, entry: Record<string, unknown>): void {
  writeSync(fileDescriptor, `${JSON.stringify(entry)}\n`, null, "utf8");
  fsyncSync(fileDescriptor);
}

export function createCliJournal(path: string, context: JournalContext): CliJournal {
  let fileDescriptor: number;
  try {
    fileDescriptor = openSync(path, "wx", 0o600);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "EEXIST") {
      throw new ApiClientError(`Journaldatei existiert bereits und wird nicht ueberschrieben: ${path}`, "bad-args");
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiClientError(`Journaldatei kann nicht sicher angelegt werden: ${message}`, "bad-args");
  }

  const invocationId = randomUUID();
  try {
    appendDurably(fileDescriptor, {
      schemaVersion: 1,
      invocationId,
      status: "pending",
      command: context.command,
      ...(context.targetOperation ? { targetOperation: context.targetOperation } : {}),
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    try { closeSync(fileDescriptor); } catch { /* Der Schreibfehler bleibt massgeblich. */ }
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiClientError(`Journaldatei konnte nicht dauerhaft initialisiert werden: ${message}`, "bad-args");
  }

  let closed = false;
  let finished = false;
  return {
    complete(result, exitCode) {
      appendDurably(fileDescriptor, {
        schemaVersion: 1,
        invocationId,
        status: "complete",
        exitCode,
        finishedAt: new Date().toISOString(),
        result,
      });
      finished = true;
    },
    error(kind, message, exitCode) {
      if (finished) return;
      appendDurably(fileDescriptor, {
        schemaVersion: 1,
        invocationId,
        status: "error",
        exitCode,
        kind,
        error: message,
        finishedAt: new Date().toISOString(),
      });
    },
    close() {
      if (closed) return;
      closed = true;
      closeSync(fileDescriptor);
    },
  };
}
