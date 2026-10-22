import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REGISTRY_VISIBILITY = Object.freeze({
  timeoutMs: 10 * 60_000,
  pollMs: 5_000,
  queryTimeoutMs: 20_000,
});

const releasePackages = [
  "@yadimon/steuer-spar-erklaerung-api",
  "@yadimon/steuer-spar-erklaerung-mcp",
];
const sleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

// Nur oeffentliche Registry-Metadaten lesen; keine npm-Konfiguration oder Tokens.
export async function readNpmVisibility({ packageName, version, timeoutMs, requireLatest, fetchImpl = fetch }) {
  const signal = AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, {
      headers: { accept: "application/vnd.npm.install-v1+json", "cache-control": "no-cache" },
      cache: "no-store",
      redirect: "manual",
      signal,
    });
  } catch {
    return { state: "pending", category: signal.aborted ? "query-timeout" : "network-error" };
  }
  const status = response.status;
  if (status !== 200) {
    void response.body?.cancel().catch(() => {});
    const pending = status === 404 || status === 408 || status === 429 || status >= 500 && status <= 599;
    return { state: pending ? "pending" : "fatal", category: "http-status", status };
  }
  let metadata;
  try {
    metadata = await response.json();
  } catch (error) {
    if (signal.aborted) return { state: "pending", category: "query-timeout", status };
    // Ein Verbindungsabbruch nach HTTP 200 ist weiterhin ein begrenzter Leseversuch.
    return error instanceof SyntaxError
      ? { state: "fatal", category: "invalid-json", status }
      : { state: "pending", category: "network-error", status };
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
      !metadata.versions || typeof metadata.versions !== "object" || Array.isArray(metadata.versions)) {
    return { state: "fatal", category: "invalid-metadata", status };
  }
  if (metadata.name !== packageName) return { state: "fatal", category: "package-mismatch", status };
  const published = metadata.versions[version];
  if (published === undefined) return { state: "pending", category: "version-missing", status };
  if (!published || typeof published !== "object" || Array.isArray(published) ||
      published.name !== packageName || published.version !== version) {
    return { state: "fatal", category: "version-mismatch", status };
  }
  if (requireLatest) {
    const latest = metadata["dist-tags"]?.latest;
    if (latest !== undefined && typeof latest !== "string") return { state: "fatal", category: "invalid-metadata", status };
    if (latest !== version) return { state: "pending", category: "latest-mismatch", status };
  }
  return { state: "visible", category: "visible", status };
}

export async function waitForNpmVisibility({
  packageNames,
  version,
  requireLatest = false,
  timeoutMs = REGISTRY_VISIBILITY.timeoutMs,
  pollMs = REGISTRY_VISIBILITY.pollMs,
  queryTimeoutMs = REGISTRY_VISIBILITY.queryTimeoutMs,
  query = readNpmVisibility,
  now = () => performance.now(),
  pause = sleep,
  onProgress = ({ packageName, category, status, elapsedMs, attempts }) => process.stdout.write(
    `npm-Sichtbarkeit ${packageName}@${version}: ${category}${status === undefined ? "" : ` (HTTP ${status})`}; ` +
    `${elapsedMs} ms, Abfrage ${attempts}.\n`,
  ),
}) {
  if (!Array.isArray(packageNames) || packageNames.length === 0 ||
      packageNames.some((name) => !releasePackages.includes(name)) || new Set(packageNames).size !== packageNames.length ||
      typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error("npm-Sichtbarkeit braucht eindeutige Release-Pakete und eine exakte Version.");
  }
  for (const milliseconds of [timeoutMs, pollMs, queryTimeoutMs]) {
    if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) throw new Error("Ungueltiges Registry-Zeitbudget.");
  }
  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  const pending = new Set(packageNames);
  const states = new Map(packageNames.map((name) => [name, { state: "pending", category: "not-checked" }]));
  let attempts = 0;
  const elapsed = () => Math.max(0, Math.ceil(now() - startedAt));
  const fail = (code) => {
    const detail = { version, elapsedMs: elapsed(), attempts, states: Object.fromEntries(states) };
    const last = [...states].map(([name, result]) =>
      `${name}=${result.category}${result.status === undefined ? "" : `(HTTP ${result.status})`}`).join(", ");
    const error = new Error(`npm-Sichtbarkeit ${version}: ${code} nach ${detail.elapsedMs} ms; ${last || "keine Abfrage moeglich"}.`);
    error.code = code;
    error.detail = detail;
    throw error;
  };
  while (pending.size > 0) {
    // Versionen sind unveraenderlich; latest muss in jeder offenen Runde frisch stimmen.
    for (const packageName of requireLatest ? packageNames : pending) {
      const remaining = Math.floor(deadline - now());
      if (remaining < 1) fail("REGISTRY_VISIBILITY_TIMEOUT");
      const result = await query({ packageName, version, requireLatest, timeoutMs: Math.min(queryTimeoutMs, remaining) });
      attempts += 1;
      if (!result || !["visible", "pending", "fatal"].includes(result.state) ||
          !/^[a-z][a-z-]*$/u.test(result.category) ||
          result.status !== undefined && (!Number.isInteger(result.status) || result.status < 100 || result.status > 599)) {
        throw new Error("Ungueltiges Ergebnis der Registry-Abfrage.");
      }
      const safeResult = { state: result.state, category: result.category, ...(result.status === undefined ? {} : { status: result.status }) };
      states.set(packageName, safeResult);
      onProgress({ packageName, ...safeResult, elapsedMs: elapsed(), attempts });
      if (result.state === "fatal") fail("REGISTRY_VISIBILITY_FAILED");
      if (now() >= deadline) fail("REGISTRY_VISIBILITY_TIMEOUT");
      if (result.state === "visible" && !requireLatest) pending.delete(packageName);
    }
    if (requireLatest && packageNames.every((name) => states.get(name).state === "visible")) pending.clear();
    if (pending.size > 0) {
      const remaining = Math.floor(deadline - now());
      if (remaining < 1) fail("REGISTRY_VISIBILITY_TIMEOUT");
      await pause(Math.min(pollMs, remaining));
    }
  }
  return { version, elapsedMs: elapsed(), attempts, states: Object.fromEntries(states) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  try {
    await waitForNpmVisibility({ packageNames: process.argv.slice(2), version });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
