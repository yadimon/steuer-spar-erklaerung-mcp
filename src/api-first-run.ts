import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createTextFileExclusive } from "./atomic-files.js";
import { DEFAULT_API_HOST, DEFAULT_API_PORT } from "./api-contract.js";
import { defaultApiConfigPath } from "./api-config.js";
import { detectSseExecutables } from "./setup.js";

export interface ForegroundApiFirstRun {
  configPath: string;
  created: boolean;
}

export function assertForegroundCaseDirectory(caseDir: string): void {
  if (!existsSync(caseDir) || !statSync(caseDir).isDirectory()) {
    throw new Error(`Bestaetigter Fallordner fehlt oder ist kein Ordner: ${caseDir}`);
  }
}

/**
 * Erzeugt nur fuer den einfachen Foreground-Start eine minimale lokale
 * Standardkonfiguration. Ausdrueckliche Konfigurationen und Umgebungswerte
 * bleiben autoritativ; insbesondere wird eine fehlende benannte Datei nie
 * still ersetzt.
 *
 * Der First Run schreibt absichtlich keinen Launcher. Dadurch darf die
 * ausfuehrbare Runtime aus einem fluechtigen npx-Cache kommen, ohne dass ein
 * dauerhafter Pfad in diesen Cache gespeichert wird.
 */
export function ensureForegroundApiFirstRun(
  explicitConfigPath?: string,
  env: NodeJS.ProcessEnv = process.env,
): ForegroundApiFirstRun {
  const namedEnvironmentConfig = env.SSE_API_CONFIG?.trim();
  const configPath = resolve(explicitConfigPath ?? namedEnvironmentConfig ?? defaultApiConfigPath(env));
  if (explicitConfigPath || namedEnvironmentConfig || env.SSE_API_TOKEN?.trim() || existsSync(configPath)) {
    return { configPath, created: false };
  }

  const workspaceDir = join(dirname(configPath), "workspace");
  const documentsDir = join(workspaceDir, "documents");
  const resultDir = join(workspaceDir, "results");
  const backupsDir = join(workspaceDir, "backups");
  for (const path of [dirname(configPath), workspaceDir, documentsDir, resultDir, backupsDir]) {
    mkdirSync(path, { recursive: true });
  }
  // Nur eine eindeutige Installation wird uebernommen. Damit findet auch ein
  // 32-Bit-Setup unter "Program Files (x86)" seine SSE.exe, ohne dass der
  // Foreground-Start je zwischen mehreren Kandidaten raten muesste.
  const detected = detectSseExecutables("2025", env);
  const sseExecutable = detected.length === 1 ? detected[0] : undefined;
  const created = createTextFileExclusive({
    path: configPath,
    mode: 0o600,
    content: `${JSON.stringify({
      profileId: "2025",
      host: DEFAULT_API_HOST,
      port: DEFAULT_API_PORT,
      token: randomBytes(32).toString("base64url"),
      ...(sseExecutable ? { sseExecutable } : {}),
      documentsDir,
      workspaceDir,
      resultDir,
      backupsDir,
    }, null, 2)}\n`,
  });
  return { configPath, created };
}
