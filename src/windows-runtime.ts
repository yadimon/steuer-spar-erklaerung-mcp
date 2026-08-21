import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SSE_PACKAGE_VERSION } from "./version.js";

export interface WindowsPowerShellRuntime {
  executable: string;
  version: string;
  major: number;
  minor: number;
}

export function resolveProductNode(repoRoot: string, fallback = process.execPath): string {
  const bundled = resolve(repoRoot, "runtime", "node.exe");
  return existsSync(bundled) ? bundled : resolve(fallback);
}

export function assertPersistentProductRoot(repoRoot: string): void {
  const segments = resolve(repoRoot).toLowerCase().split(/[\\/]+/u);
  const npxCacheIndex = segments.lastIndexOf("_npx");
  if (npxCacheIndex >= 0 && segments.slice(npxCacheIndex + 2).includes("node_modules")) {
    throw new Error(
      "Diese Installation liegt im fluechtigen npx-Cache und wuerde ungueltige dauerhafte Startpfade erzeugen. " +
      "Bitte npm install --global @yadimon/steuer-spar-erklaerung-api verwenden oder das portable Release nutzen.",
    );
  }
}

export function resolveProductMcpEntry(repoRoot: string): string {
  const localEntry = resolve(repoRoot, "dist", "index.js");
  if (existsSync(localEntry)) return localEntry;
  try {
    const packageManifest = JSON.parse(readFileSync(
      fileURLToPath(import.meta.resolve("@yadimon/steuer-spar-erklaerung-mcp/package.json")),
      "utf8",
    )) as { version?: unknown };
    if (packageManifest.version !== SSE_PACKAGE_VERSION) {
      throw new Error(
        `Installierte MCP-Version '${String(packageManifest.version)}' passt nicht zur API-Version '${SSE_PACKAGE_VERSION}'.`,
      );
    }
    const installedEntry = fileURLToPath(import.meta.resolve("@yadimon/steuer-spar-erklaerung-mcp/cli"));
    if (existsSync(installedEntry)) return resolve(installedEntry);
  } catch (error) {
    if (error instanceof Error && error.message.includes("passt nicht zur API-Version")) throw error;
    // Die konkrete Fehlermeldung unten ist fuer Nutzer hilfreicher als ERR_MODULE_NOT_FOUND.
  }
  throw new Error(
    "MCP wurde angefordert, aber @yadimon/steuer-spar-erklaerung-mcp ist nicht dauerhaft installiert. " +
    "Installieren Sie das MCP-Paket oder waehlen Sie den direkten API-Transport.",
  );
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
  const [majorText, minorText] = version.split(".");
  const major = Number(majorText);
  const minor = Number(minorText);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || major !== 5 || minor < 1) {
    throw new Error(
      `Windows PowerShell 5.1 ist erforderlich; erkannt wurde '${version || "unbekannt"}'.`,
    );
  }
  return { executable, version, major, minor };
}
