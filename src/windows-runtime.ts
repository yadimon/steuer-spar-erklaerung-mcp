import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/**
 * Resolve the Windows-owned PowerShell runtime without consulting PATH.
 *
 * The product must not silently pick up an arbitrary pwsh installation.
 * The optional override exists for deterministic tests and managed deployments;
 * it still has to point to powershell.exe, not to PowerShell 7.
 */
export function resolveWindowsPowerShell(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (process.platform !== "win32") {
    throw new Error("SteuerSparErklaerung-Automation wird nur unter Windows unterstuetzt.");
  }
  const configured = env.SSE_POWERSHELL_EXE?.trim();
  const systemRoot = env.SystemRoot?.trim() || env.WINDIR?.trim();
  const candidates = [
    configured,
    systemRoot ? join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : undefined,
  ].filter((entry): entry is string => Boolean(entry));

  for (const candidate of candidates) {
    const absolute = resolve(candidate);
    if (basename(absolute).toLowerCase() === "powershell.exe" && existsSync(absolute)) return absolute;
  }
  throw new Error(
    "Windows PowerShell (powershell.exe) wurde im Windows-Systemordner nicht gefunden. " +
      "Es wird keine globale PowerShell-7-Installation benoetigt.",
  );
}
