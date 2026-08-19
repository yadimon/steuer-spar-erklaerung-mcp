import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { callApiOperation, readApiDiscovery, type ApiClientOptions } from "./api-client.js";

// A cold Windows VM can need several seconds for the first PowerShell-backed
// health snapshot even after the loopback listener is ready. Keep this budget
// local to setup verification; normal API operation deadlines stay unchanged.
export const SETUP_HEALTH_TIMEOUT_MS = 15_000;
export const SETUP_WORKSPACE_TIMEOUT_MS = 15_000;
export const SETUP_START_ATTEMPTS = 6;
export const SETUP_SHUTDOWN_ATTEMPTS = 10;
export const SETUP_SHUTDOWN_DELAY_MS = 500;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
      signal: AbortSignal.timeout(SETUP_HEALTH_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

export async function stopSetupApiForRebind(
  endpoint: SetupApiEndpoint,
  options: { fetchImpl?: typeof fetch; attempts?: number; delayMs?: number } = {},
): Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!endpoint.expectedConfigurationFingerprint) {
    throw new Error("Kontrollierte API-Neubindung benoetigt den bisherigen Konfigurationsfingerprint.");
  }
  if (!await healthResponds(endpoint, fetchImpl)) return false;
  let response: Response;
  try {
    response = await fetchImpl(`${setupBaseUrl(endpoint)}/v1/setup/shutdown`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${endpoint.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        expectedConfigurationFingerprint: endpoint.expectedConfigurationFingerprint,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(SETUP_HEALTH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Kontrollierter API-Shutdown nicht erreichbar: ${errorMessage(error)}`);
  }
  if (response.status !== 202) {
    await response.body?.cancel();
    throw new Error(
      response.status === 404
        ? "Laufende API unterstuetzt die sichere Neubindung noch nicht. Runtime aktualisieren und die API bewusst neu starten."
        : `Laufende API lehnte die sichere Neubindung mit HTTP ${response.status} ab.`,
    );
  }
  await response.body?.cancel();
  const attempts = options.attempts ?? SETUP_SHUTDOWN_ATTEMPTS;
  const delayMs = options.delayMs ?? SETUP_SHUTDOWN_DELAY_MS;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20) {
    throw new Error("Setup-API-Shutdown erlaubt 1 bis 20 Warteversuche.");
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (!await healthResponds(endpoint, fetchImpl)) return true;
    if (attempt < attempts) await wait(delayMs);
  }
  throw new Error("Kontrolliert beendete API blieb am bestaetigten Loopback-Port erreichbar.");
}

async function verifyOnce(
  endpoint: SetupApiEndpoint,
  fetchImpl: typeof fetch,
  startedBySetup: boolean,
): Promise<SetupApiVerification> {
  const baseUrl = setupBaseUrl(endpoint);
  let health: Response;
  try {
    health = await fetchImpl(`${baseUrl}/healthz`, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(SETUP_HEALTH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`API-Health nicht erreichbar: ${errorMessage(error)}`);
  }
  if (!health.ok) throw new Error(`API-Health antwortete mit HTTP ${health.status}.`);
  await health.body?.cancel();
  const options: ApiClientOptions = { baseUrl, token: endpoint.token, fetchImpl };
  const discovery = await readApiDiscovery(options).catch((error: unknown) => {
    throw new Error(`API-Discovery nicht verifiziert: ${errorMessage(error)}`);
  });
  const workspace = await callApiOperation("workspace_status", {}, SETUP_WORKSPACE_TIMEOUT_MS, options)
    .catch((error: unknown) => {
      throw new Error(`API-Arbeitsbereich nicht verifiziert: ${errorMessage(error)}`);
    });
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
  throw new Error(`Lokale API konnte nicht verifiziert werden: ${errorMessage(lastError)}`);
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
    attempts: SETUP_START_ATTEMPTS,
    delayMs: 2_000,
    startedBySetup: true,
  });
}
