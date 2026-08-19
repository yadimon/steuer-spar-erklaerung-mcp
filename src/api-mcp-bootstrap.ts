#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  environmentForExplicitApiConfig,
  loadApiServerConfig,
  SSE_API_CONFIG_ENVIRONMENT_KEYS,
} from "./api-config.js";

export interface McpLauncherArguments {
  configPath: string;
  mcpEntry: string;
}

export function parseMcpLauncherArguments(args: readonly string[]): McpLauncherArguments {
  let configPath: string | undefined;
  let mcpEntry: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    const value = args[index + 1];
    if (argument !== "--config" && argument !== "--mcp-entry") {
      throw new Error("Erwartet werden genau --config <config.json> und --mcp-entry <index.js>.");
    }
    if (!value || value.startsWith("--")) throw new Error(`Wert fuer ${argument} fehlt.`);
    if (argument === "--config") {
      if (configPath) throw new Error("--config darf nur einmal angegeben werden.");
      configPath = value;
    } else {
      if (mcpEntry) throw new Error("--mcp-entry darf nur einmal angegeben werden.");
      mcpEntry = value;
    }
    index += 1;
  }
  if (!configPath || !mcpEntry) {
    throw new Error("Erwartet werden genau --config <config.json> und --mcp-entry <index.js>.");
  }
  for (const [name, path] of [["--config", configPath], ["--mcp-entry", mcpEntry]] as const) {
    if (!isAbsolute(path) || /[\u0000-\u001f]/u.test(path)) {
      throw new Error(`${name} muss ein absoluter Pfad ohne Steuerzeichen sein.`);
    }
  }
  const resolvedEntry = resolve(mcpEntry);
  if (!existsSync(resolvedEntry) || !statSync(resolvedEntry).isFile()) {
    throw new Error(`Dauerhafter MCP-Einstieg fehlt: ${resolvedEntry}`);
  }
  if (resolvedEntry === resolve(fileURLToPath(import.meta.url))) {
    throw new Error("Der MCP-Bootstrap darf sich nicht selbst als Server starten.");
  }
  return { configPath: resolve(configPath), mcpEntry: resolvedEntry };
}

export async function runMcpLauncher(args: readonly string[]): Promise<number> {
  const options = parseMcpLauncherArguments(args);
  const config = loadApiServerConfig(environmentForExplicitApiConfig(options.configPath));
  const host = config.host === "::1" ? "[::1]" : config.host;
  const environment = { ...process.env };
  for (const key of SSE_API_CONFIG_ENVIRONMENT_KEYS) delete environment[key];
  environment.SSE_API_URL = `http://${host}:${config.port}`;
  environment.SSE_API_TOKEN = config.token;

  return new Promise<number>((resolveExit, reject) => {
    const child = spawn(process.execPath, [options.mcpEntry], {
      env: environment,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`MCP-Server wurde durch Signal ${signal} beendet.`));
        return;
      }
      resolveExit(code ?? 1);
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runMcpLauncher(process.argv.slice(2)).then(
    (exitCode) => { process.exitCode = exitCode; },
    (error: unknown) => {
      process.stderr.write(`MCP-Bootstrap fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
