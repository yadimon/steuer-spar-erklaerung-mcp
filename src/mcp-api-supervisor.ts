import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultApiConfigPath,
  resolveApiConfigValues,
} from "./api-config-file.js";
import { ApiClientError, readApiHealthz, type ApiHealthDocument } from "./api-client.js";
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

function startApiDependency(endpoint: ApiEndpoint): { exited: () => boolean; spawnError: () => Error | undefined } {
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
  return { exited: () => didExit, spawnError: () => startError };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

let ensurePromise: Promise<ApiHealthDocument> | undefined;
let activeEndpoint: ApiEndpoint | undefined;
let activeProcessId: number | undefined;
let activeInstanceId: string | undefined;

async function ensureApiSingletonInner(): Promise<ApiHealthDocument> {
  const endpoint = configuredEndpoint(process.env);
  const initial = await probe(
    endpoint.baseUrl,
    INITIAL_PROBE_TIMEOUT_MS,
    endpoint.expectedConfigurationFingerprint,
  );
  if (initial.state === "compatible") {
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
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const startError = started.spawnError();
    if (startError) throw new Error("Die installierte API-Dependency konnte nicht gestartet werden.");
    const current = await probe(
      endpoint.baseUrl,
      READINESS_PROBE_TIMEOUT_MS,
      endpoint.expectedConfigurationFingerprint,
    );
    if (current.state === "compatible") {
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
  ensurePromise ??= ensureApiSingletonInner();
  return ensurePromise;
}

export async function assertApiSingletonIdentity(): Promise<ApiHealthDocument> {
  const endpoint = activeEndpoint;
  if (!endpoint) return ensureApiSingleton();
  let current = await probe(
    endpoint.baseUrl,
    INITIAL_PROBE_TIMEOUT_MS,
    endpoint.expectedConfigurationFingerprint,
  );
  // Ein Transportfehler ist KEINE Aussage darueber, wer am Port lauscht. Er
  // entsteht auch, wenn eine wiederverwendete Verbindung stirbt - etwa weil
  // genau dieser API-Prozess gerade ausgetauscht wurde. Wer ihn als Befund
  // durchreicht, meldet ausgerechnet dann "nicht erreichbar", wenn die
  // eigentliche Nachricht "der Prozess wurde ausgetauscht" lauten muesste,
  // und verschluckt damit den Hinweis, den der Benutzer braucht: den
  // MCP-Server neu starten, statt einen zweiten API-Prozess zu starten.
  //
  // Genau einmal frisch nachfragen. Die Abfrage ist ein lesendes GET auf
  // /healthz und damit gefahrlos wiederholbar; ist die API wirklich weg,
  // scheitert auch der zweite Versuch und der Netzwerkfehler bleibt.
  if (current.state === "absent") {
    current = await probe(
      endpoint.baseUrl,
      INITIAL_PROBE_TIMEOUT_MS,
      endpoint.expectedConfigurationFingerprint,
    );
  }
  if (current.state === "compatible") {
    if (activeProcessId !== undefined && current.health.processId !== activeProcessId) {
      throw new ApiClientError(
        "SSE-API-Healthz ist inkompatibel: Der Prozess am konfigurierten Port wurde ausgetauscht.",
        "protocol",
      );
    }
    if (activeInstanceId !== undefined && current.health.instanceId !== activeInstanceId) {
      throw new ApiClientError(
        "SSE-API-Healthz ist inkompatibel: Die Instanz am konfigurierten Port wurde ausgetauscht.",
        "protocol",
      );
    }
    return current.health;
  }
  throw current.error;
}
