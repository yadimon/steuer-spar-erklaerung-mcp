import assert from "node:assert/strict";
import { readNpmVisibility, REGISTRY_VISIBILITY, waitForNpmVisibility } from "../scripts/wait-npm-visibility.mjs";

const api = "@yadimon/steuer-spar-erklaerung-api";
const mcp = "@yadimon/steuer-spar-erklaerung-mcp";
const version = "0.1.0-beta.123";
const visible = { state: "visible", category: "visible", status: 200 };
const pending = { state: "pending", category: "version-missing", status: 200 };

export async function verifyRegistryVisibility() {
  let clock = 0;
  const progress = [];
  const queryTimeouts = [];
  // Verwendet das echte Defaultbudget: eine Rueckkehr zur alten Minute scheitert.
  const delayed = await waitForNpmVisibility({
    packageNames: [api], version,
    now: () => clock,
    pause: async (milliseconds) => { clock += milliseconds; },
    query: async ({ timeoutMs }) => {
      queryTimeouts.push(timeoutMs);
      clock += 250;
      return clock >= 75_000 ? visible : pending;
    },
    onProgress: (state) => progress.push(state),
  });
  assert(delayed.elapsedMs >= 75_000 && delayed.elapsedMs < REGISTRY_VISIBILITY.timeoutMs);
  assert(progress.some((entry) => entry.category === "version-missing"));
  assert.equal(progress.at(-1).category, "visible");
  assert(queryTimeouts.every((timeoutMs) => timeoutMs <= REGISTRY_VISIBILITY.queryTimeoutMs));

  clock = 0;
  const observedTimeouts = [];
  await assert.rejects(waitForNpmVisibility({
    packageNames: [api], version, timeoutMs: 6_200, pollMs: 5_000, queryTimeoutMs: 2_000,
    now: () => clock,
    pause: async (milliseconds) => { clock += milliseconds; },
    query: async ({ timeoutMs }) => {
      observedTimeouts.push(timeoutMs);
      clock += Math.min(1_000, timeoutMs);
      return pending;
    },
    onProgress: () => {},
  }), (error) => {
    assert.equal(error.code, "REGISTRY_VISIBILITY_TIMEOUT");
    assert.equal(error.detail.elapsedMs, 6_200, "Abfragezeit gehoert zum gemeinsamen Budget.");
    assert.equal(error.detail.states[api].category, "version-missing");
    assert(error.message.includes(api) && error.message.includes(version));
    return true;
  });
  assert.deepEqual(observedTimeouts, [2_000, 200], "Die letzte Abfrage darf das Restbudget nicht ueberziehen.");

  clock = 0;
  const sleeps = [];
  await assert.rejects(waitForNpmVisibility({
    packageNames: [api], version, timeoutMs: 6_200, pollMs: 5_000,
    now: () => clock,
    pause: async (milliseconds) => { sleeps.push(milliseconds); clock += milliseconds; },
    query: async () => pending,
    onProgress: () => {},
  }), { code: "REGISTRY_VISIBILITY_TIMEOUT" });
  assert.deepEqual(sleeps, [5_000, 1_200], "Auch die letzte Pause endet am gemeinsamen Deadline.");
  assert.equal(clock, 6_200);

  clock = 0;
  const checkedNames = [];
  const partial = await waitForNpmVisibility({
    packageNames: [api, mcp], version, requireLatest: true,
    now: () => clock,
    pause: async (milliseconds) => { clock += milliseconds; },
    query: async ({ packageName, requireLatest }) => {
      assert.equal(requireLatest, true);
      checkedNames.push(packageName);
      if (packageName === api && clock === 5_000) return { state: "pending", category: "latest-mismatch", status: 200 };
      if (packageName === mcp && clock === 0) return pending;
      return visible;
    },
    onProgress: () => {},
  });
  assert.equal(partial.states[mcp].state, "visible");
  assert.equal(partial.elapsedMs, 10_000, "Ein frueheres latest darf waehrend der offenen Wartezeit nicht als aktueller Nachweis gelten.");
  assert.deepEqual(checkedNames, [api, mcp, api, mcp, api, mcp], "Mutable Tags werden in jeder Runde neu gelesen.");

  clock = 0;
  const exactNames = [];
  await waitForNpmVisibility({
    packageNames: [api, mcp], version,
    now: () => clock,
    pause: async (milliseconds) => { clock += milliseconds; },
    query: async ({ packageName }) => {
      exactNames.push(packageName);
      return packageName === api || clock >= 10_000 ? visible : pending;
    },
    onProgress: () => {},
  });
  assert.deepEqual(exactNames, [api, mcp, mcp, mcp], "Bestaetigte unveraenderliche Versionen brauchen keinen weiteren Read-Retry.");

  const metadata = {
    name: api,
    versions: { [version]: { name: api, version } },
    "dist-tags": { latest: version },
  };
  const read = (fetchImpl, requireLatest = false) => readNpmVisibility({
    packageName: api, version, timeoutMs: 1_000, requireLatest, fetchImpl,
  });
  const response = (status, body) => async () => ({ status, json: async () => body });
  assert.deepEqual(await read(response(404)), { state: "pending", category: "http-status", status: 404 });
  for (const status of [408, 429, 500, 503]) {
    assert.equal((await read(response(status))).state, "pending", `HTTP ${status} bleibt ein begrenzter Leseversuch.`);
  }
  for (const status of [301, 400, 401, 403]) {
    assert.equal((await read(response(status))).state, "fatal", `HTTP ${status} darf nicht still bis zum Timeout laufen.`);
  }
  assert.equal((await read(response(200, { ...metadata, versions: {} }))).category, "version-missing");
  assert.equal((await read(response(200, { ...metadata, name: mcp }))).category, "package-mismatch");
  assert.equal((await read(response(200, { ...metadata, versions: { [version]: { name: api, version: "0.0.0" } } }))).category, "version-mismatch");
  assert.equal((await read(response(200, { ...metadata, "dist-tags": { latest: "0.0.0" } }), true)).category, "latest-mismatch");
  assert.equal((await read(response(200, { ...metadata, "dist-tags": { latest: "0.0.0" } }))).state, "visible",
    "Die API-Dependency verlangt nur ihre exakte Version, keine Tag-Aenderung.");
  assert.deepEqual(await read(async (url, options) => {
    assert.equal(url, `https://registry.npmjs.org/${encodeURIComponent(api)}`);
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers["cache-control"], "no-cache");
    assert.equal(options.headers.accept, "application/vnd.npm.install-v1+json");
    assert.equal(options.redirect, "manual");
    assert(options.signal instanceof AbortSignal);
    return { status: 200, json: async () => metadata };
  }, true), visible);
  assert.equal((await read(async () => { throw new Error("INTERNAL_RESPONSE_BYTES"); })).category, "network-error");
  assert.equal((await read(async () => ({ status: 200, json: async () => { throw new SyntaxError("INTERNAL_RESPONSE_BYTES"); } }))).category, "invalid-json");
  assert.deepEqual(await read(async () => ({ status: 200, json: async () => {
    throw new TypeError("INTERNAL_RESPONSE_BYTES", { cause: { code: "UND_ERR_SOCKET" } });
  } })), { state: "pending", category: "network-error", status: 200 },
  "Ein Transportabbruch nach den HTTP-Headern ist kein ungueltiges JSON.");

  clock = 0;
  let fatalCalls = 0;
  const fatalProgress = [];
  await assert.rejects(waitForNpmVisibility({
    packageNames: [api], version,
    now: () => clock,
    pause: async () => assert.fail("Ein Authentifizierungsfehler darf keine Pause ausloesen."),
    query: async () => {
      fatalCalls += 1;
      return { state: "fatal", category: "http-status", status: 403, raw: "INTERNAL_RESPONSE_BYTES" };
    },
    onProgress: (state) => fatalProgress.push(state),
  }), (error) => {
    assert.equal(error.code, "REGISTRY_VISIBILITY_FAILED");
    assert.match(error.message, /http-status\(HTTP 403\)/u);
    assert(!JSON.stringify(error.detail).includes("INTERNAL_RESPONSE_BYTES"));
    return true;
  });
  assert.equal(fatalCalls, 1);
  assert(!JSON.stringify(fatalProgress).includes("INTERNAL_RESPONSE_BYTES"));

  clock = 0;
  let transientCalls = 0;
  await waitForNpmVisibility({
    packageNames: [api], version,
    now: () => clock,
    pause: async (milliseconds) => { clock += milliseconds; },
    query: async () => ++transientCalls === 1 ? { state: "pending", category: "query-timeout" } : visible,
    onProgress: () => {},
  });
  assert.equal(transientCalls, 2);
}
