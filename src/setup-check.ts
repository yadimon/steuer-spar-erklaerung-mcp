import { existsSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultApiConfigPath,
  environmentForExplicitApiConfig,
  loadApiServerConfig,
} from "./api-config.js";
import { readJsonFileStrict } from "./json-files.js";
import { isProductProfileReleased, loadProductProfile } from "./product-profiles.js";
import { loadStoredSetupPreferences } from "./setup-preferences.js";
import { verifySetupApi } from "./setup-runtime.js";
import { validateSseExecutable } from "./setup.js";
import { SSE_PACKAGE_VERSION } from "./version.js";
import { probeWindowsPowerShell } from "./windows-runtime.js";
import { configurationFingerprint } from "./workspace-status.js";

const MAX_MCP_CONFIG_BYTES = 1024 * 1024;

interface McpServerObject {
  command?: unknown;
  args?: unknown;
  env?: unknown;
}

function assertExistingFile(path: unknown, label: string): string {
  if (typeof path !== "string" || !isAbsolute(path) || !existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} fehlt oder ist kein absoluter Dateipfad.`);
  }
  return resolve(path);
}

function verifyMcpTemplate(configPath: string, templatePath: string): {
  templatePath: string;
  command: string;
  launcher: string;
  entry: string;
  containsToken: false;
} {
  const document = readJsonFileStrict(templatePath, "MCP-Mergevorlage", MAX_MCP_CONFIG_BYTES) as {
    mcpServers?: Record<string, McpServerObject>;
  };
  const server = document?.mcpServers?.["steuer-spar-erklaerung"];
  if (!server || typeof server !== "object") throw new Error("MCP-Mergevorlage enthaelt keinen SSE-Server.");
  if (server.env !== undefined) {
    throw new Error("MCP-Mergevorlage enthaelt noch Umgebungswerte. Setup erneut ausfuehren, damit kein Token im Client steht.");
  }
  const command = assertExistingFile(server.command, "MCP-Node-Befehl");
  if (!Array.isArray(server.args) || !server.args.every((value) => typeof value === "string")) {
    throw new Error("MCP-Mergevorlage enthaelt keine gueltige Argumentliste.");
  }
  const args = server.args as string[];
  if (args.length !== 5 || args[1] !== "--config" || args[3] !== "--mcp-entry") {
    throw new Error("MCP-Mergevorlage verwendet nicht den tokenfreien Bootstrap-Vertrag.");
  }
  const launcher = assertExistingFile(args[0], "MCP-Bootstrap");
  if (resolve(args[2]!) !== resolve(configPath)) throw new Error("MCP-Bootstrap verweist auf eine andere API-Konfiguration.");
  const entry = assertExistingFile(args[4], "MCP-Paketeinstieg");
  return { templatePath, command, launcher, entry, containsToken: false };
}

/**
 * Eine Konfiguration aus dem NPX-Foreground-Start ist absichtlich unvollstaendig:
 * sie hat weder `sseExecutable` noch `setup-decisions.json`. Das ist kein Defekt,
 * sondern "noch kein dauerhaftes Setup" und wird deshalb als maschinenlesbarer
 * Status gemeldet statt als Fehler geworfen.
 */
function reportForegroundOnlyConfig(config: { configPath: string; caseDir?: string }, reason: string): void {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    ok: false,
    kind: "foreground-only-config",
    version: SSE_PACKAGE_VERSION,
    reason,
    config: { path: config.configPath, tokenConfigured: true, caseDirectoryConfigured: Boolean(config.caseDir) },
    hint: "Noch kein vollstaendiges Setup, nur eine NPX-Foreground-Konfiguration. " +
      "Laufende Foreground-API zuerst mit Strg+C beenden, dann 'steuer-spar-erklaerung-setup --defaults' ausfuehren.",
  }, null, 2)}\n`);
}

/** Gibt `true` zurueck, wenn ein vollstaendiges dauerhaftes Setup vorliegt. */
export async function runSetupCheck(configPathInput?: string): Promise<boolean> {
  const here = dirname(fileURLToPath(import.meta.url));
  const configPath = resolve(configPathInput ?? defaultApiConfigPath());
  if (!existsSync(configPath)) throw new Error(`Lokale API-Konfiguration fehlt: ${configPath}`);
  const config = loadApiServerConfig(environmentForExplicitApiConfig(configPath));
  const profile = loadProductProfile(config.profileId);
  if (!isProductProfileReleased(profile)) throw new Error(`Produktprofil '${config.profileId}' ist nicht freigegeben.`);
  const preferences = loadStoredSetupPreferences(config.workspaceDir);
  if (!config.sseExecutable) {
    reportForegroundOnlyConfig(config, "SSE.exe ist in der lokalen Konfiguration nicht gesetzt.");
    return false;
  }
  if (!preferences) {
    reportForegroundOnlyConfig(config, `Setup-Entscheidungen fehlen im Arbeitsbereich: ${config.workspaceDir}`);
    return false;
  }
  validateSseExecutable(config.sseExecutable, config.profileId);
  const powershell = probeWindowsPowerShell();
  const api = await verifySetupApi({
    host: config.host,
    port: config.port,
    token: config.token,
    expectedConfigurationFingerprint: configurationFingerprint(config),
  });

  let mcp: ReturnType<typeof verifyMcpTemplate> | { configured: false } = { configured: false };
  if (preferences.transport === "api-and-mcp") {
    const stem = basename(config.configPath, extname(config.configPath)) || "config";
    const templatePath = join(dirname(config.configPath), `mcp-client.${stem}.json`);
    if (!existsSync(templatePath)) throw new Error(`MCP-Mergevorlage fehlt: ${templatePath}`);
    mcp = verifyMcpTemplate(config.configPath, templatePath);
  }

  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    ok: true,
    version: SSE_PACKAGE_VERSION,
    platform: { windowsX64: process.platform === "win32" && process.arch === "x64", windowsPowerShell: powershell.version },
    profile: { id: profile.id, status: profile.status, operationAccess: profile.operationAccess },
    config: { path: config.configPath, tokenConfigured: true, caseDirectoryConfigured: Boolean(config.caseDir) },
    api,
    mcp,
    clientVerificationRequired: preferences.transport === "api-and-mcp",
    clientVerificationHint: preferences.transport === "api-and-mcp"
      ? "Client neu laden, Serverliste pruefen und MCP-Health aufrufen."
      : "Direkte API ist der konfigurierte Transport.",
    runtimeRoot: resolve(here, ".."),
  }, null, 2)}\n`);
  return true;
}
