import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  defaultApiConfigPath,
  resolveApiConfigValues,
} from "./api-config-file.js";
import { ApiClientError, readApiHealthz, type ApiHealthDocument } from "./api-client.js";
import { requestApiShutdown } from "./api-control-client.js";
import {
  SSE_API_PACKAGE_NAME,
  SSE_PACKAGE_NAME,
  SSE_PACKAGE_VERSION,
  SSE_PLUGIN_NAME,
} from "./version.js";
import { configurationFingerprint } from "./configuration-fingerprint.js";
import {
  SSE_EXPECTED_API_BASE_URL,
  SSE_EXPECTED_API_CONFIGURATION_FINGERPRINT,
} from "./api-supervisor-contract.js";

const MAX_API_MANIFEST_BYTES = 64 * 1024;
const MAX_PLUGIN_RUNTIME_LOCK_BYTES = 1024 * 1024;
const INITIAL_PROBE_TIMEOUT_MS = 1_500;
const READINESS_PROBE_TIMEOUT_MS = 750;
const READINESS_TIMEOUT_MS = 15_000;
const READINESS_POLL_MS = 100;
const API_BIN_NAME = "steuer-spar-erklaerung-api";

type ProbeResult =
  | { state: "compatible"; health: ApiHealthDocument }
  | { state: "absent"; error: ApiClientError }
  | { state: "incompatible"; error: ApiClientError };

interface ApiEndpoint {
  baseUrl: string;
  explicitUrl: boolean;
  configPath?: string;
  expectedConfigurationFingerprint?: string;
}

interface ApiPackageManifest {
  name?: unknown;
  version?: unknown;
  bin?: unknown;
}

interface PluginRuntimeFile {
  path?: unknown;
  sha256?: unknown;
  size?: unknown;
}

interface PluginRuntimeLock {
  schemaVersion?: unknown;
  packageName?: unknown;
  packageVersion?: unknown;
  apiPackageName?: unknown;
  mcpPackageName?: unknown;
  pluginName?: unknown;
  pluginVersion?: unknown;
  entries?: unknown;
  files?: unknown;
}

function loopbackBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("SSE_API_URL ist keine gueltige URL.");
  }
  if (parsed.protocol !== "http:" || !["127.0.0.1", "[::1]", "::1"].includes(parsed.hostname)) {
    throw new Error("SSE_API_URL muss eine lokale HTTP-Loopback-URL sein.");
  }
  if (
    parsed.username || parsed.password ||
    (parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search || parsed.hash
  ) {
    throw new Error("SSE_API_URL darf nur aus Loopback-Host und Port bestehen.");
  }
  return parsed.origin;
}

function absoluteConfigPath(raw: string): string {
  if (!isAbsolute(raw) || /[\u0000-\u001f]/u.test(raw)) {
    throw new Error("SSE_API_CONFIG muss ein absoluter Pfad ohne Steuerzeichen sein.");
  }
  return resolve(raw);
}

function endpointFromConfig(
  configPath: string,
): Pick<ApiEndpoint, "baseUrl" | "expectedConfigurationFingerprint"> {
  const config = resolveApiConfigValues(configPath);
  return {
    baseUrl: `http://${config.host === "::1" ? "[::1]" : config.host}:${config.port}`,
    expectedConfigurationFingerprint: configurationFingerprint(config),
  };
}

function configuredEndpoint(env: NodeJS.ProcessEnv): ApiEndpoint {
  const explicitUrl = env.SSE_API_URL?.trim();
  const rawConfigPath = env.SSE_API_CONFIG?.trim();
  if (explicitUrl && rawConfigPath) {
    throw new Error(
      "SSE_API_URL und SSE_API_CONFIG duerfen nicht gleichzeitig gesetzt sein; " +
      "die API-Identitaet waere sonst mehrdeutig.",
    );
  }
  if (explicitUrl) return { baseUrl: loopbackBaseUrl(explicitUrl), explicitUrl: true };
  const configPath = rawConfigPath ? absoluteConfigPath(rawConfigPath) : defaultApiConfigPath(env);
  return { ...endpointFromConfig(configPath), explicitUrl: false, configPath };
}

async function probe(
  baseUrl: string,
  timeoutMs: number,
  expectedConfigurationFingerprint?: string,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const health = await readApiHealthz({ baseUrl, signal: controller.signal });
    if (
      expectedConfigurationFingerprint &&
      health.configurationFingerprint !== expectedConfigurationFingerprint
    ) {
      throw new ApiClientError(
        "SSE-API-Healthz ist inkompatibel: Die laufende API verwendet eine andere Konfiguration.",
        "protocol",
      );
    }
    return { state: "compatible", health };
  } catch (error) {
    const apiError = error instanceof ApiClientError
      ? error
      : new ApiClientError("SSE-API ist nicht eindeutig identifizierbar.", "protocol");
    return apiError.kind === "network"
      ? { state: "absent", error: apiError }
      : { state: "incompatible", error: apiError };
  } finally {
    clearTimeout(timer);
  }
}

function containedPath(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot !== "" && !fromRoot.startsWith("..") && !isAbsolute(fromRoot);
}

function validRuntimeRelativePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 &&
    !value.includes("\\") && !value.includes("\0") && !isAbsolute(value) &&
    !value.split("/").some((part) => !part || part === "." || part === "..");
}

interface AdjacentPluginRuntime {
  runtimeRoot: string;
  lockPath: string;
}

function adjacentPluginRuntime(): AdjacentPluginRuntime | undefined {
  let runtimeRoot: string;
  try {
    runtimeRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  } catch {
    // `import.meta.url` ist in Node immer eine file:-URL. Diese Fallback-Grenze
    // bleibt absichtlich generisch, damit keine lokale Pfadangabe nach aussen geht.
    throw new Error("Die MCP-Runtime konnte nicht sicher aufgeloest werden.");
  }
  const lockPath = resolve(runtimeRoot, "runtime-lock.json");
  try {
    if (!containedPath(runtimeRoot, lockPath)) throw new Error();
    const lockStat = lstatSync(lockPath);
    if (lockStat.isSymbolicLink() || realpathSync(lockPath) !== lockPath) throw new Error();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("Die benachbarte Plugin-Runtime besitzt kein sicher gebundenes Runtime-Lock.");
  }
  return { runtimeRoot, lockPath };
}

function readBundledPluginApiEntry(runtime: AdjacentPluginRuntime): string {
  const { runtimeRoot, lockPath } = runtime;
  let lockStat;
  try {
    lockStat = statSync(lockPath);
  } catch {
    throw new Error("Die gebuendelte Plugin-Runtime konnte nicht sicher gelesen werden.");
  }
  if (!lockStat.isFile() || lockStat.size <= 0 || lockStat.size > MAX_PLUGIN_RUNTIME_LOCK_BYTES) {
    throw new Error("Die gebuendelte Plugin-Runtime besitzt ungueltige Metadaten.");
  }
  let lock: PluginRuntimeLock;
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf8")) as PluginRuntimeLock;
  } catch {
    throw new Error("Die gebuendelte Plugin-Runtime besitzt kein gueltiges Runtime-Lock.");
  }
  if (
    lock.schemaVersion !== 1 ||
    lock.packageName !== SSE_PACKAGE_NAME ||
    lock.packageVersion !== SSE_PACKAGE_VERSION ||
    lock.apiPackageName !== SSE_API_PACKAGE_NAME ||
    lock.mcpPackageName !== "@yadimon/steuer-spar-erklaerung-mcp" ||
    lock.pluginName !== SSE_PLUGIN_NAME ||
    lock.pluginVersion !== SSE_PACKAGE_VERSION ||
    !lock.entries || typeof lock.entries !== "object" || Array.isArray(lock.entries) ||
    !Array.isArray(lock.files)
  ) {
    throw new Error("Die gebuendelte Plugin-Runtime ist nicht versionsgleich.");
  }
  const apiRelative = (lock.entries as Record<string, unknown>).api;
  if (!validRuntimeRelativePath(apiRelative)) {
    throw new Error("Die gebuendelte Plugin-API besitzt keinen sicheren Einstieg.");
  }
  const matchingFiles = (lock.files as PluginRuntimeFile[]).filter((file) => file?.path === apiRelative);
  if (matchingFiles.length !== 1) {
    throw new Error("Die gebuendelte Plugin-API ist im Runtime-Lock nicht eindeutig gebunden.");
  }
  const record = matchingFiles[0];
  if (!record || typeof record.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(record.sha256) ||
      !Number.isSafeInteger(record.size) || (record.size as number) <= 0) {
    throw new Error("Die gebuendelte Plugin-API besitzt ungueltige Integritaetsmetadaten.");
  }
  let entry: string;
  let content: Buffer;
  try {
    const candidate = resolve(runtimeRoot, apiRelative);
    if (!containedPath(runtimeRoot, candidate) || lstatSync(candidate).isSymbolicLink()) throw new Error();
    entry = realpathSync(candidate);
    if (!containedPath(runtimeRoot, entry) ||
        relative(runtimeRoot, entry).replaceAll("\\", "/") !== apiRelative ||
        !statSync(entry).isFile()) throw new Error();
    content = readFileSync(entry);
  } catch {
    throw new Error("Der gebuendelte Plugin-API-Einstieg ist nicht sicher enthalten.");
  }
  if (content.length !== record.size || createHash("sha256").update(content).digest("hex") !== record.sha256) {
    throw new Error("Der gebuendelte Plugin-API-Einstieg stimmt nicht mit dem Runtime-Lock ueberein.");
  }
  return entry;
}

function readApiPackageEntry(): string {
  // Ein vorhandenes benachbartes Runtime-Lock kennzeichnet die selbstenthaltene
  // Plugin-Auslieferung. Es ist autoritativ: Weder ein ancestor node_modules noch
  // ein ungueltiges Lock darf die hashgebundene Plugin-API umgehen.
  const bundledRuntime = adjacentPluginRuntime();
  if (bundledRuntime) return readBundledPluginApiEntry(bundledRuntime);

  const require = createRequire(import.meta.url);
  let manifestPath: string;
  try {
    manifestPath = require.resolve(`${SSE_API_PACKAGE_NAME}/package.json`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") {
      throw new Error("Die exakte installierte API-Dependency konnte nicht sicher aufgeloest werden.");
    }
    throw new Error("Die exakte installierte API-Dependency fehlt und es ist keine Plugin-Runtime gebunden.");
  }
  let manifestStat;
  try {
    manifestStat = statSync(manifestPath);
  } catch {
    throw new Error("Installierte API-Paketmetadaten konnten nicht sicher gelesen werden.");
  }
  if (!manifestStat.isFile() || manifestStat.size > MAX_API_MANIFEST_BYTES) {
    throw new Error("Installierte API-Paketmetadaten sind ungueltig.");
  }
  let manifest: ApiPackageManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ApiPackageManifest;
  } catch {
    throw new Error("Installierte API-Paketmetadaten sind kein gueltiges JSON.");
  }
  if (manifest.name !== SSE_API_PACKAGE_NAME || manifest.version !== SSE_PACKAGE_VERSION) {
    throw new Error(
      `Installierte API-Dependency ist inkompatibel: erwartet ${SSE_API_PACKAGE_NAME}@${SSE_PACKAGE_VERSION}.`,
    );
  }
  if (!manifest.bin || typeof manifest.bin !== "object" || Array.isArray(manifest.bin)) {
    throw new Error("Installierte API-Dependency besitzt keinen gueltigen Bin-Vertrag.");
  }
  const relativeEntry = (manifest.bin as Record<string, unknown>)[API_BIN_NAME];
  if (typeof relativeEntry !== "string" || !relativeEntry || isAbsolute(relativeEntry)) {
    throw new Error("Installierte API-Dependency besitzt keinen gueltigen API-Einstieg.");
  }
  let packageRoot: string;
  let entry: string;
  try {
    packageRoot = realpathSync(dirname(manifestPath));
    entry = realpathSync(resolve(packageRoot, relativeEntry));
  } catch {
    throw new Error("Der API-Einstieg der installierten Dependency fehlt.");
  }
  const fromPackage = relative(packageRoot, entry);
  let entryIsFile = false;
  try {
    entryIsFile = statSync(entry).isFile();
  } catch {
    throw new Error("Der API-Einstieg der installierten Dependency ist nicht lesbar.");
  }
  if (!fromPackage || fromPackage.startsWith("..") || isAbsolute(fromPackage) || !entryIsFile) {
    throw new Error("API-Einstieg liegt ausserhalb der installierten Dependency.");
  }
  return entry;
}

function cleanApiEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("SSE_")) delete env[key];
  }
  return env;
}

interface StartedApi {
  pid: number | undefined;
  exited: () => boolean;
  spawnError: () => Error | undefined;
}

function startApiDependency(endpoint: ApiEndpoint): StartedApi {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("Die automatische SSE-API benoetigt Windows x64.");
  }
  const entry = readApiPackageEntry();
  let didExit = false;
  let startError: Error | undefined;
  const env = cleanApiEnvironment();
  if (endpoint.expectedConfigurationFingerprint) {
    env[SSE_EXPECTED_API_CONFIGURATION_FINGERPRINT] = endpoint.expectedConfigurationFingerprint;
  }
  env[SSE_EXPECTED_API_BASE_URL] = endpoint.baseUrl;
  const child = spawn(process.execPath, [entry, ...(endpoint.configPath ? ["--config", endpoint.configPath] : [])], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    shell: false,
    env,
  });
  child.once("error", (error) => { startError = error; });
  child.once("exit", () => { didExit = true; });
  child.unref();
  return { pid: child.pid, exited: () => didExit, spawnError: () => startError };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

let ensurePromise: Promise<ApiHealthDocument> | undefined;
let activeEndpoint: ApiEndpoint | undefined;
let activeProcessId: number | undefined;
let activeInstanceId: string | undefined;
let activeChild: StartedApi | undefined;
type ApiControlState = "running" | "stopping" | "stopped" | "starting" | "unknown";
let controlState: ApiControlState = "running";
let controlBusy = false;
let pendingRestart = false;
let shutdownAccepted: boolean | null = null;

function assertApiRunningIntent(): void {
  if (controlState !== "running") {
    throw new ApiClientError(
      "Die API ist absichtlich gestoppt oder ihr Lebenszyklus noch ungeklärt. Mit sse_api_control den Status lesen; ein Neustart braucht einen eigenen Auftrag.",
      controlState === "stopped" ? "api-stopped" : "api-lifecycle-pending",
    );
  }
}

async function ensureApiSingletonInner(
  endpoint: ApiEndpoint = configuredEndpoint(process.env),
  restarting = false,
): Promise<ApiHealthDocument> {
  const initial = await probe(
    endpoint.baseUrl,
    INITIAL_PROBE_TIMEOUT_MS,
    endpoint.expectedConfigurationFingerprint,
  );
  if (initial.state === "compatible") {
    if (restarting) throw new ApiClientError("Am Endpunkt laeuft bereits eine andere API; sie wird nicht uebernommen oder beendet.", "api-replaced");
    activeEndpoint = endpoint;
    activeProcessId = initial.health.processId;
    activeInstanceId = initial.health.instanceId;
    process.env.SSE_API_URL = endpoint.baseUrl;
    return initial.health;
  }
  if (initial.state === "incompatible") throw initial.error;
  if (endpoint.explicitUrl) {
    throw new Error(
      "Die ausdruecklich konfigurierte SSE_API_URL ist nicht erreichbar; " +
        "es wird keine API auf dem Standardport gestartet.",
    );
  }

  const started = startApiDependency(endpoint);
  activeChild = started;
  activeEndpoint = endpoint;
  activeProcessId = started.pid;
  activeInstanceId = undefined;
  const deadline = performance.now() + READINESS_TIMEOUT_MS;
  while (performance.now() < deadline) {
    const startError = started.spawnError();
    if (startError) throw new Error("Die installierte API-Dependency konnte nicht gestartet werden.");
    const current = await probe(
      endpoint.baseUrl,
      READINESS_PROBE_TIMEOUT_MS,
      endpoint.expectedConfigurationFingerprint,
    );
    if (current.state === "compatible") {
      if (restarting && current.health.processId !== started.pid) {
        throw new ApiClientError("Die antwortende API gehoert nicht zum ausdruecklich gestarteten Prozess.", "api-replaced");
      }
      activeEndpoint = endpoint;
      activeProcessId = current.health.processId;
      activeInstanceId = current.health.instanceId;
      process.env.SSE_API_URL = endpoint.baseUrl;
      return current.health;
    }
    if (current.state === "incompatible") throw current.error;
    await delay(READINESS_POLL_MS);
  }
  throw new Error(
    started.exited()
      ? "Die installierte API-Dependency endete, bevor eine kompatible SSE-API bereit war."
      : "Die installierte API-Dependency erreichte ihre Readiness nicht rechtzeitig.",
  );
}

export function ensureApiSingleton(): Promise<ApiHealthDocument> {
  assertApiRunningIntent();
  ensurePromise ??= ensureApiSingletonInner();
  return ensurePromise;
}

export async function assertApiSingletonIdentity(): Promise<ApiHealthDocument> {
  assertApiRunningIntent();
  const endpoint = activeEndpoint;
  if (!endpoint) return ensureApiSingleton();
  let current = await probe(
    endpoint.baseUrl,
    INITIAL_PROBE_TIMEOUT_MS,
    endpoint.expectedConfigurationFingerprint,
  );
  // Ein Transportfehler kann von einer beim Prozesswechsel abgerissenen
  // Verbindung stammen. Genau ein frisches, lesendes /healthz-GET unterscheidet
  // diesen Austausch von einer unerreichbaren API, ohne einen Ersatz zu starten.
  if (current.state === "absent") {
    current = await probe(
      endpoint.baseUrl,
      INITIAL_PROBE_TIMEOUT_MS,
      endpoint.expectedConfigurationFingerprint,
    );
  }
  assertApiRunningIntent();
  if (current.state === "compatible") {
    if (activeProcessId !== undefined && current.health.processId !== activeProcessId) {
      throw new ApiClientError(
        "SSE-API-Healthz ist inkompatibel: Der Prozess am konfigurierten Port wurde ausgetauscht. " +
          "Nach einem beabsichtigten API-Neustart die MCP-Verbindung neu starten und sse_preflight erneut aufrufen.",
        "protocol",
      );
    }
    if (activeInstanceId !== undefined && current.health.instanceId !== activeInstanceId) {
      throw new ApiClientError(
        "SSE-API-Healthz ist inkompatibel: Die Instanz am konfigurierten Port wurde ausgetauscht. " +
          "Nach einem beabsichtigten API-Neustart die MCP-Verbindung neu starten und sse_preflight erneut aufrufen.",
        "protocol",
      );
    }
    return current.health;
  }
  throw current.error;
}

export type ApiControlRequest =
  | { action: "status" }
  | { action: "shutdown" | "start"; confirm: true; instanceId: string };

function boundProcessExited(): boolean {
  if (activeProcessId === undefined) return false;
  if (activeChild && activeChild.pid === activeProcessId && activeChild.exited()) return true;
  try {
    // Signal 0 ist eine Existenzabfrage, keine Prozessbeendigung.
    process.kill(activeProcessId, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
    throw new ApiClientError("Das Ende des gebundenen API-Prozesses ist nicht sicher pruefbar.", "shutdown-unknown");
  }
}

function controlSnapshot(ok = true, detail: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok, state: controlState,
    ...(activeInstanceId ? { instanceId: activeInstanceId } : {}),
    ...(activeProcessId !== undefined ? { processId: activeProcessId } : {}),
    accepted: shutdownAccepted,
    processExited: controlState === "stopped",
    ...detail,
  };
}

async function controlStatus(): Promise<Record<string, unknown>> {
  if (controlBusy) return controlSnapshot();
  if (controlState === "running") {
    await assertApiSingletonIdentity();
    return controlSnapshot();
  }
  if (boundProcessExited()) {
    controlState = "stopped";
    pendingRestart = false;
    return controlSnapshot();
  }
  if (pendingRestart && activeEndpoint && activeChild && activeChild.pid === activeProcessId) {
    const observed = await probe(activeEndpoint.baseUrl, INITIAL_PROBE_TIMEOUT_MS, activeEndpoint.expectedConfigurationFingerprint);
    if (observed.state === "compatible" && observed.health.processId === activeChild.pid) {
      activeInstanceId = observed.health.instanceId;
      controlState = "running";
      pendingRestart = false;
      shutdownAccepted = null;
      ensurePromise = Promise.resolve(observed.health);
    }
  }
  return controlSnapshot();
}

/** Kontrolliert nur die gebundene API. Ein SSE-/Fallauftrag wird nie ausgefuehrt. */
export async function controlApiSingleton(request: ApiControlRequest): Promise<Record<string, unknown>> {
  if (!["status", "shutdown", "start"].includes(request.action)) {
    throw new ApiClientError("Unbekannte API-Lebenszyklusaktion.", "bad-args");
  }
  if (request.action === "status") return controlStatus();
  if (request.confirm !== true || !request.instanceId || request.instanceId !== activeInstanceId) {
    throw new ApiClientError("API-Steuerung verlangt confirm=true und die zuletzt gelesene exakte instanceId.", "api-instance-mismatch");
  }
  if (controlBusy) throw new ApiClientError("Eine API-Lebenszyklusaktion laeuft bereits.", "busy");
  controlBusy = true;
  try {
    if (request.action === "start") {
      if (controlState !== "stopped" || !boundProcessExited()) {
        throw new ApiClientError("Neustart verlangt das nachgewiesene Ende der zuvor gebundenen API.", "api-lifecycle-pending");
      }
      const endpoint = activeEndpoint;
      if (!endpoint?.configPath || endpoint.explicitUrl) {
        throw new ApiClientError(
          "Die API wurde nur ueber SSE_API_URL gebunden; ihre Startkonfiguration ist unbekannt. " +
            "API mit ihrer urspruenglichen Konfiguration manuell starten.",
          "api-start-unavailable",
        );
      }
      const current = endpointFromConfig(endpoint.configPath);
      if (current.baseUrl !== endpoint.baseUrl || current.expectedConfigurationFingerprint !== endpoint.expectedConfigurationFingerprint) {
        throw new ApiClientError("Die urspruengliche API-Konfiguration wurde geaendert; kein automatischer Wechsel beim Neustart.", "api-configuration-changed");
      }
      controlState = "starting";
      pendingRestart = true;
      try {
        ensurePromise = ensureApiSingletonInner(endpoint, true);
        await ensurePromise;
        controlState = "running";
        pendingRestart = false;
        shutdownAccepted = null;
        return controlSnapshot();
      } catch (error) {
        controlState = "unknown";
        throw error;
      }
    }

    assertApiRunningIntent();
    const health = await assertApiSingletonIdentity();
    if (health.instanceId !== request.instanceId) {
      throw new ApiClientError("API-Instanz hat sich vor dem Stopp geaendert.", "api-instance-mismatch");
    }
    controlState = "stopping";
    shutdownAccepted = null;
    try {
      const accepted = await requestApiShutdown({ confirm: true, instanceId: health.instanceId }, {
        baseUrl: activeEndpoint!.baseUrl, expectedInstanceId: health.instanceId,
      });
      if (accepted.processId !== health.processId) {
        throw new ApiClientError("Shutdown-Annahme meldet einen anderen API-Prozess.", "protocol");
      }
      shutdownAccepted = true;
    } catch (error) {
      // Nur eine eindeutige API-Ablehnung beweist, dass kein Stopp angenommen
      // wurde. Transport-/Protokollfehler lassen die Startabsicht gesperrt.
      const rejected = error instanceof ApiClientError && [
        "busy", "api-instance-mismatch", "bad-request", "shutdown-unavailable",
        "forbidden", "unsupported-media-type", "method-not-allowed", "not-found",
      ].includes(error.kind);
      controlState = rejected ? "running" : "unknown";
      shutdownAccepted = rejected ? false : null;
      return controlSnapshot(false, {
        kind: error instanceof ApiClientError ? error.kind : "shutdown-unknown",
        error: error instanceof Error ? error.message : "Shutdown-Ausgang ist unbekannt.",
      });
    }
    const deadline = performance.now() + 10_000;
    while (performance.now() < deadline) {
      if (boundProcessExited()) {
        controlState = "stopped";
        return controlSnapshot();
      }
      await delay(100);
    }
    return controlSnapshot(false, { kind: "shutdown-pending", error: "Stopp angenommen; Prozessende noch nicht nachgewiesen. Status lesen." });
  } finally {
    controlBusy = false;
  }
}
