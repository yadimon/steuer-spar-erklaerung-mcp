import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { LocalFileError } from "./local-file-transaction.js";

const TASKLIST_TIMEOUT_MS = 5_000;
const execFileAsync = promisify(execFile);

export function parseTasklistSseOutput(stdout: string): boolean {
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const csvLines = lines.filter((line) => line.startsWith('"'));
  if (csvLines.some((line) => /^"SSE\.exe"(?:,|$)/iu.test(line))) return true;
  if (csvLines.length) {
    throw new LocalFileError("SSE-Prozessliste enthielt eine unerwartete CSV-Antwort.", "precondition-failed");
  }
  // tasklist lokalisiert den Text der leeren Ergebnismenge, behaelt aber das
  // Format "Praefix: Nachricht" bei. Jede andere Form bleibt fail-closed.
  if (lines.length && lines.every((line) => /^[^"\r\n]+:\s+/u.test(line))) return false;
  throw new LocalFileError("SSE-Prozessliste war nicht sicher auswertbar.", "precondition-failed");
}

export async function hasRunningSseProcess(): Promise<boolean> {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot) {
    throw new LocalFileError("Windows-Systempfad fuer die SSE-Prozesspruefung fehlt.", "precondition-failed");
  }
  const executable = join(systemRoot, "System32", "tasklist.exe");
  try {
    const result = await execFileAsync(executable, ["/FI", "IMAGENAME eq SSE.exe", "/NH", "/FO", "CSV"], {
      encoding: "utf8",
      timeout: TASKLIST_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return parseTasklistSseOutput(result.stdout);
  } catch (error) {
    if (error instanceof LocalFileError) throw error;
    throw new LocalFileError(
      `SSE-Prozessstatus konnte nicht sicher gelesen werden: ${error instanceof Error ? error.message : String(error)}`,
      "precondition-failed",
    );
  }
}
