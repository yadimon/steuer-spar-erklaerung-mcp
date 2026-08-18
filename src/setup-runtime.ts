import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { callApiOperation, readApiDiscovery, type ApiClientOptions } from "./api-client.js";

export interface SetupApiEndpoint {
  host: string;
  port: number;
  token: string;
  expectedConfigurationFingerprint?: string;
}

export interface SetupApiVerification {
  ok: true;
  baseUrl: string;
  operationCount: number;
  workspaceReady: boolean;
  caseDirectoryConfigured: boolean;
  startedBySetup: boolean;
}

function setupBaseUrl(endpoint: SetupApiEndpoint): string {
  const host = endpoint.host === "::1" ? "[::1]" : endpoint.host;
  return `http://${host}:${endpoint.port}`;
}

async function healthResponds(endpoint: SetupApiEndpoint, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(`${setupBaseUrl(endpoint)}/healthz`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

async function verifyOnce(
  endpoint: SetupApiEndpoint,
  fetchImpl: typeof fetch,
  startedBySetup: boolean,
): Promise<SetupApiVerification> {
  const baseUrl = setupBaseUrl(endpoint);
  const health = await fetchImpl(`${baseUrl}/healthz`, {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(2_000),
  });
  if (!health.ok) throw new Error(`API-Health antwortete mit HTTP ${health.status}.`);
  await health.body?.cancel();
  const options: ApiClientOptions = { baseUrl, token: endpoint.token, fetchImpl };
  const discovery = await readApiDiscovery(options);
  const workspace = await callApiOperation("workspace_status", {}, 5_000, options);
  if (
    !workspace.ok ||
    workspace.workspaceReady !== true ||
    workspace.resultAreaReady !== true ||
    workspace.documentAreaReady !== true ||
    workspace.backupAreaReady !== true
  ) {
    throw new Error("API-Arbeitsbereich wurde nicht vollstaendig bestaetigt.");
  }
  if (
    endpoint.expectedConfigurationFingerprint &&
    workspace.configurationFingerprint !== endpoint.expectedConfigurationFingerprint
  ) {
    throw new Error("Laufende API verwendet eine andere lokale Konfiguration.");
  }
  return {
    ok: true,
    baseUrl,
    operationCount: discovery.operations.length,
    workspaceReady: true,
    caseDirectoryConfigured: workspace.caseDirectoryConfigured === true,
    startedBySetup,
  };
}

export async function verifySetupApi(
  endpoint: SetupApiEndpoint,
  options: { fetchImpl?: typeof fetch; attempts?: number; delayMs?: number; startedBySetup?: boolean } = {},
): Promise<SetupApiVerification> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 2_000;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
    throw new Error("Setup-API-Pruefung erlaubt 1 bis 10 Versuche.");
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await verifyOnce(endpoint, options.fetchImpl ?? fetch, options.startedBySetup === true);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(delayMs);
    }
  }
  throw new Error(`Lokale API konnte nicht verifiziert werden: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function startAndVerifySetupApi(
  endpoint: SetupApiEndpoint,
  launcherPath: string,
  options: { fetchImpl?: typeof fetch; windowsDirectory?: string } = {},
): Promise<SetupApiVerification> {
  const fetchOption = options.fetchImpl === undefined
    ? {}
    : { fetchImpl: options.fetchImpl };
  let verificationError: unknown;
  try {
    return await verifySetupApi(endpoint, { ...fetchOption, attempts: 1 });
  } catch (error) {
    verificationError = error;
  }
  if (await healthResponds(endpoint, options.fetchImpl ?? fetch)) {
    const detail = verificationError instanceof Error ? verificationError.message : String(verificationError);
    throw new Error(
      `Port ${endpoint.port} wird bereits von einer API verwendet, die nicht zur Konfiguration passt. ` +
      `Laufende API zuerst beenden oder wiederverwenden. ${detail}`,
    );
  }
  const windowsDirectory = options.windowsDirectory ?? process.env.WINDIR ?? process.env.SystemRoot ?? "C:\\Windows";
  const wscript = join(windowsDirectory, "System32", "wscript.exe");
  if (!existsSync(wscript)) throw new Error(`Fensterloser Windows Script Host fehlt: ${wscript}`);
  if (!existsSync(launcherPath)) throw new Error(`Fensterloser API-Starter fehlt: ${launcherPath}`);
  const child = spawn(wscript, ["//B", "//NoLogo", launcherPath], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });
  child.unref();
  return verifySetupApi(endpoint, {
    ...fetchOption,
    attempts: 3,
    delayMs: 2_000,
    startedBySetup: true,
  });
}
