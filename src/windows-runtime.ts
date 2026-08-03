import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export interface WindowsPowerShellRuntime {
  executable: string;
  version: string;
  major: number;
}

export function resolveProductNode(repoRoot: string, fallback = process.execPath): string {
  const bundled = resolve(repoRoot, "runtime", "node.exe");
  return existsSync(bundled) ? bundled : resolve(fallback);
}

/**
 * Resolve the Windows-owned PowerShell runtime without consulting PATH.
 *
 * A portable release must not silently pick up an arbitrary pwsh installation.
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

export function probeWindowsPowerShell(
  env: NodeJS.ProcessEnv = process.env,
): WindowsPowerShellRuntime {
  const executable = resolveWindowsPowerShell(env);
  const probe = spawnSync(
    executable,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$PSVersionTable.PSVersion.ToString()",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (probe.error || probe.status !== 0) {
    throw new Error(
      `Windows PowerShell konnte nicht sicher gestartet werden${probe.stderr ? `: ${probe.stderr.trim()}` : "."}`,
    );
  }
  const version = (probe.stdout ?? "").trim();
  const major = Number(version.split(".")[0]);
  if (!Number.isInteger(major) || major < 5) {
    throw new Error(
      `Windows PowerShell konnte nicht sicher gestartet werden${probe.stderr ? `: ${probe.stderr.trim()}` : "."}`,
    );
  }
  return { executable, version, major };
}
