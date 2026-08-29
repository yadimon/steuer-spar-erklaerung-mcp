import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callApiOperation, readApiDiscovery, readApiJsonResponse, readApiOperationDiscovery, readOpenApiDocument } from "../dist/api-client.js";
import { MAX_API_BODY_BYTES, MAX_API_RESPONSE_BYTES, MAX_OPERATION_TIMEOUT_MS, SSE_API_OPERATIONS } from "../dist/api-contract.js";
import { createApiExecutor } from "../dist/api-executor.js";
import { SSE_API_DISCOVERY } from "../dist/api-discovery.js";
import { createSseApiServer, listenSseApiServer } from "../dist/api-server.js";
import { configurationFingerprint } from "../dist/workspace-status.js";
import { SSE_PACKAGE_VERSION } from "../dist/version.js";

const calls = [];
const logs = [];
const API_INSTANCE_ID = "11111111-1111-4111-8111-111111111111";
let throwOnLog = false;
const temporary = mkdtempSync(join(tmpdir(), "sse-api-contract-"));
const config = {
  host: "127.0.0.1",
  port: 1,
  configPath: "C:\\ApiConfig\\config.json",
  caseDir: "C:\\SSE-Cases",
  workspaceDir: join(temporary, "workspace"),
  documentsDir: join(temporary, "documents"),
  resultDir: "C:\\SSE-Results",
  backupsDir: join(temporary, "backups"),
  sseExecutable: "C:\\Program Files\\SSE 2025\\SSE.exe",
};
config.resultDir = join(temporary, "results");
let markAbortStarted;
let markAbortObserved;
const abortStarted = new Promise((resolve) => { markAbortStarted = resolve; });
const abortObserved = new Promise((resolve) => { markAbortObserved = resolve; });

async function waitForWithin(promise, timeoutMs, message) {
  let timer;
  try {
    await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const checkerState = {
  active: true,
  expanded: true,
  page: "Steuererklärung prüfen",
  consistent: true,
  messageVisible: true,
  resetRecovers: false,
};

const execute = createApiExecutor(config, async (operation, args, timeoutMs, signal) => {
  calls.push({ operation, args, timeoutMs });
  if (operation === "launch") {
    return { ok: true, launched: true, pid: 4242, args: ["-meinur"], product: { supported: true }, case: null };
  }
  if (operation === "launch_probe") {
    return {
      ok: true,
      outcome: "observed",
      windows: [{
        pid: 4242,
        hwnd: 2424,
        title: "Einkommensteuer 2025: SteuerSparErklärung für das Steuerjahr 2025",
        w: 1200,
        h: 800,
        minimiert: false,
      }],
      dialogs: [],
    };
  }
  if (operation === "product_info") return { ok: true, supportedRunning: [], ignoredRunning: [] };
  if (operation === "close") return { ok: true, killed: true, stillRunning: false };
  if (operation === "find" && args.name === "__wait_for_abort__") {
    markAbortStarted();
    if (!signal?.aborted) await new Promise((resolve) => signal?.addEventListener("abort", resolve, { once: true }));
    markAbortObserved();
    return { ok: false, kind: "aborted", error: "aborted" };
  }
  if (operation === "find" && args.name === "__oversized_response__") {
    return { ok: true, value: "x".repeat(MAX_API_RESPONSE_BYTES) };
  }
  if (operation === "find" && args.name === "__session_controller_busy__") {
    return {
      ok: false,
      kind: "busy",
      error: "Controller belegt.",
      reason: "session-controller-busy",
      retryable: true,
      waited: false,
      mutationStarted: false,
      resultingState: "unchanged",
      cleanupRequired: false,
      physicalInputUsed: false,
      foregroundLeaseUsed: false,
    };
  }
  if (operation === "find" && args.name === "__malformed_result__") {
    return { ok: "kein-boolean", leaked: "C:\\Privat\\darf-nicht-zum-client.txt" };
  }
  if (operation === "checker_open_plan") {
    assert.deepEqual(
      Object.keys(args).sort(),
      ["name", "planKind", "schemaVersion"],
      "Privater Checkerplan darf keine freien Aktionen oder Selektoren tragen",
    );
    assert.equal(args.schemaVersion, 1);
    assert.equal(args.planKind, "checker-open");
    assert.equal(typeof args.name, "string");
    const internalTimings = [];
    let reusedReadbackCount = 0;
    internalTimings.push({ operation: "checker_results", ms: 1 });
    if (checkerState.active && !checkerState.consistent && !checkerState.messageVisible) {
      internalTimings.push({ operation: "checker_reset", ms: 1 });
      reusedReadbackCount += 1;
      if (checkerState.resetRecovers) {
        checkerState.consistent = true;
        checkerState.messageVisible = true;
        checkerState.expanded = false;
      }
    }
    if (!checkerState.active) {
      if (checkerState.page === "Prüfen und Abgeben") {
        checkerState.page = "Steuererklärung prüfen";
        internalTimings.push({ operation: "click", ms: 1 });
      }
      checkerState.active = true;
      internalTimings.push({ operation: "checker_run", ms: 1 });
      reusedReadbackCount += 1;
    }
    if (!checkerState.messageVisible || args.name !== "Pruefhinweis") {
      return {
        ok: false,
        kind: checkerState.consistent ? "checker-message" : "checker-incomplete",
        error: "Meldung fehlt.",
        schemaVersion: 1,
        planKind: "checker-open",
        resultingState: "checker-active",
        cleanupRequired: false,
        performance: {
          workerProcessCount: 1,
          internalOperationCount: internalTimings.length,
          internalTimings,
          reusedReadbackCount,
        },
      };
    }
    if (!checkerState.expanded) {
      checkerState.expanded = true;
      internalTimings.push({ operation: "click_point", ms: 1 });
    }
    internalTimings.push({ operation: "checker_detail", ms: 1 });
    return {
      ok: true,
      schemaVersion: 1,
      planKind: "checker-open",
      resultingState: "detail-verified",
      cleanupRequired: false,
      meldung: args.name,
      text: "Detail",
      bildBase64: "aW1hZ2U=",
      performance: {
        workerProcessCount: 1,
        internalOperationCount: internalTimings.length,
        internalTimings,
        reusedReadbackCount,
      },
    };
  }
  if (operation === "checker_results") {
    return {
      ok: true,
      aktiv: checkerState.active,
      konsistent: true,
      fragenWarnungen: [{ text: "Pruefhinweis" }],
      tippsZusatzinfos: [],
      sonstige: [],
      aufgeklappt: checkerState.expanded ? ["Pruefhinweis"] : [],
    };
  }
  if (operation === "page") return { ok: true, ueberschrift: checkerState.page };
  if (operation === "click" && args.name === "Weiter") {
    checkerState.page = "Steuererklärung prüfen";
    return { ok: true };
  }
  if (operation === "checker_run") {
    checkerState.active = true;
    return { ok: true };
  }
  if (operation === "click_point" && args.checkerReadOnly === true) {
    checkerState.expanded = true;
    return { ok: true };
  }
  if (operation === "checker_detail") {
    return { ok: true, meldung: args.name, text: "Detail", bildBase64: "aW1hZ2U=" };
  }
  return { ok: true, operation, args, stable: "same-result" };
});

const server = createSseApiServer({
  execute,
  instanceId: API_INSTANCE_ID,
  log: (record) => {
    if (throwOnLog) throw new Error("synthetischer Logfehler");
    logs.push(record);
  },
});
assert.equal(server.headersTimeout, 10_000);
assert.equal(server.requestTimeout, 30_000);
assert.equal(server.keepAliveTimeout, 5_000);
assert.equal(server.maxHeadersCount, 64);
const unsafeBindServer = createSseApiServer({ execute });
await assert.rejects(listenSseApiServer(unsafeBindServer, "0.0.0.0", 43127), /Loopback/);
await assert.rejects(listenSseApiServer(unsafeBindServer, "127.0.0.1", 0), /zwischen 1 und 65535/);

server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("cache-control"), "no-store");
  assert.equal(health.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await health.json(), {
    ok: true,
    apiVersion: "v1",
    packageName: "@yadimon/steuer-spar-erklaerung-api",
    packageVersion: SSE_PACKAGE_VERSION,
    processId: process.pid,
    instanceId: API_INSTANCE_ID,
    configurationFingerprint: "0".repeat(64),
    inFlight: null,
    prewarm: null,
  },
    "healthz muss Lebendigkeit und laufende Operation melden.");
  const queryRejected = await fetch(`${baseUrl}/healthz?quiet=true`);
  assert.equal(queryRejected.status, 400);
  assert.equal((await queryRejected.json()).error.code, "bad-request");

  // Ein Browser darf diese API nicht erreichen. Genau die Kopfzeilen, die ein
  // Browser zwingend mitsendet und eine Webseite nicht faelschen kann, werden
  // hier einzeln geprueft - inklusive DNS-Rebinding ueber einen fremden 'Host'.
  for (const [label, headers] of [
    ["Origin", { origin: "https://boese.example" }],
    ["Sec-Fetch-Site", { "sec-fetch-site": "cross-site" }],
  ]) {
    const blocked = await fetch(`${baseUrl}/v1/operations`, { headers });
    assert.equal(blocked.status, 403, `${label} muss abgewiesen werden.`);
    assert.equal((await blocked.json()).error.code, "forbidden");
    const blockedPost = await fetch(`${baseUrl}/v1/operations/health`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ args: {} }),
    });
    assert.equal(blockedPost.status, 403, `${label} muss auch bei POST abgewiesen werden.`);
    const blockedHealth = await fetch(`${baseUrl}/healthz`, { headers });
    assert.equal(blockedHealth.status, 403, `${label} darf nicht einmal /healthz erreichen.`);
  }
  // 'Host' laesst sich mit fetch nicht setzen - der rohe Klient zeigt, dass ein
  // umgebogener Name (DNS-Rebinding) trotzdem nicht durchkommt.
  const rebindStatus = await new Promise((resolve, reject) => {
    const rebind = httpRequest(`${baseUrl}/healthz`, { headers: { host: "boese.example" } }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    rebind.once("error", reject);
    rebind.end();
  });
  assert.equal(rebindStatus, 403, "Ein fremder Host-Name muss abgewiesen werden.");

  // Node behaelt bei doppeltem 'Host' stillschweigend die erste Kopfzeile; die
  // Anfrage bleibt trotzdem mehrdeutig und darf nicht interpretiert werden.
  const duplicateHostStatus = await new Promise((resolve, reject) => {
    const socket = connect(address.port, "127.0.0.1", () => {
      socket.write([
        "GET /healthz HTTP/1.1",
        "Host: 127.0.0.1",
        "Host: boese.example",
        "Connection: close",
        "",
        "",
      ].join("\r\n"));
    });
    let received = "";
    socket.on("data", (chunk) => { received += chunk.toString("utf8"); });
    socket.once("end", () => resolve(Number(/^HTTP\/1\.\d (\d{3})/u.exec(received)?.[1])));
    socket.once("error", reject);
  });
  assert.equal(duplicateHostStatus, 403, "Mehrere Host-Kopfzeilen muessen abgewiesen werden.");

  // 'none' ist die Kennzeichnung einer direkt eingegebenen Adresse und der
  // einzige Sec-Fetch-Wert, der keinen Seitenkontext bedeutet.
  const directNavigation = await fetch(`${baseUrl}/healthz`, { headers: { "sec-fetch-site": "none" } });
  assert.equal(directNavigation.status, 200);

  const listed = await fetch(`${baseUrl}/v1/operations`);
  assert.equal(listed.status, 200);
  const catalog = await listed.json();
  assert.deepEqual(catalog, SSE_API_DISCOVERY);
  assert.deepEqual(catalog.operations, SSE_API_OPERATIONS);
  assert.equal(Object.keys(catalog.argumentSchemas).length, SSE_API_OPERATIONS.length);
  assert.equal(catalog.safety.elsterAndSubmissionBlocked, true);
  assert.equal(catalog.operationTraits.health.readOnlyHint, true);
  assert.equal(catalog.operationTraits.click.destructiveHint, true);
  assert(catalog.planning.fallbackStages.some((stage) => stage.operations.includes("snapshot")));
  assert.equal(catalog.argumentSchemas.goto.properties.maxSteps.maximum, 200);
  assert(catalog.argumentSchemas.tracked_set_value.anyOf.length >= 2);
  assert(!catalog.operations.includes("keys"), "freie Tastatureingabe darf nicht in die API gelangen");

  const singleDiscoveryResponse = await fetch(`${baseUrl}/v1/operations/find`);
  assert.equal(singleDiscoveryResponse.status, 200);
  const singleDiscovery = await singleDiscoveryResponse.json();
  assert.equal(singleDiscovery.operation, "find");
  assert.deepEqual(singleDiscovery.argumentSchema, catalog.argumentSchemas.find);
  assert.deepEqual(singleDiscovery.operationTraits, catalog.operationTraits.find);
  assert.deepEqual(singleDiscovery.planning, catalog.planning);
  assert.equal(singleDiscovery.safety.elsterAndSubmissionBlocked, true);
  assert(Buffer.byteLength(JSON.stringify(singleDiscovery)) < Buffer.byteLength(JSON.stringify(catalog)) / 4);

  const unknownSingleDiscovery = await fetch(`${baseUrl}/v1/operations/keys`);
  assert.equal(unknownSingleDiscovery.status, 404);
  assert.equal((await unknownSingleDiscovery.json()).error.code, "operation-not-allowed");
  const invalidMethod = await fetch(`${baseUrl}/v1/operations/find`, { method: "DELETE" });
  assert.equal(invalidMethod.status, 405);
  assert.equal(invalidMethod.headers.get("allow"), "GET, POST");
  assert.equal((await invalidMethod.json()).error.code, "method-not-allowed");

  const openApiResponse = await fetch(`${baseUrl}/v1/openapi.json`);
  assert.equal(openApiResponse.status, 200);
  const openApi = await openApiResponse.json();
  assert.equal(openApi.openapi, "3.1.0");
  assert.equal(Object.keys(openApi.paths).length, SSE_API_OPERATIONS.length + 3);
  assert.equal(openApi.security, undefined, "Ohne Anmeldung darf die Beschreibung kein Sicherheitsschema fordern.");
  assert.equal(openApi.components.securitySchemes, undefined);

  const clientDiscovery = await readApiDiscovery({ baseUrl });
  assert.deepEqual(clientDiscovery.operations, SSE_API_OPERATIONS);
  assert.equal(Object.keys(clientDiscovery.argumentSchemas).length, SSE_API_OPERATIONS.length);
  const clientSingleDiscovery = await readApiOperationDiscovery("find", { baseUrl });
  assert.equal(clientSingleDiscovery.operation, "find");
  assert.deepEqual(clientSingleDiscovery.argumentSchema, clientDiscovery.argumentSchemas.find);
  await assert.rejects(
    readApiOperationDiscovery("keys", { baseUrl, fetchImpl: async () => { throw new Error("darf nicht senden"); } }),
    (error) => error?.kind === "operation",
  );
  const clientOpenApi = await readOpenApiDocument({ baseUrl });
  assert.equal(Object.keys(clientOpenApi.paths).length, SSE_API_OPERATIONS.length + 3);

  await assert.rejects(
    readApiDiscovery({
      baseUrl,
      fetchImpl: async () => new Response(JSON.stringify({
        apiVersion: "v1",
        operations: ["health"],
        argumentSchemas: { health: {} },
        operationTraits: { health: {} },
        limits: {},
        safety: {},
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    }),
    (error) => error?.kind === "protocol",
  );
  await assert.rejects(
    readApiDiscovery({
      baseUrl,
      fetchImpl: async () => new Response(JSON.stringify({
        ...catalog,
        argumentSchemas: { ...catalog.argumentSchemas, nicht_freigegeben: catalog.argumentSchemas.health },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    }),
    (error) => error?.kind === "protocol",
  );
  await assert.rejects(
    readApiDiscovery({
      baseUrl,
      fetchImpl: async () => new Response(JSON.stringify({
        ...catalog,
        planning: { ...catalog.planning, fallbackStages: [] },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    }),
    (error) => error?.kind === "protocol",
  );
  await assert.rejects(
    readApiDiscovery({
      baseUrl,
      fetchImpl: async () => new Response(JSON.stringify({
        ...catalog,
        argumentSchemas: { ...catalog.argumentSchemas, health: {} },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    }),
    (error) => error?.kind === "protocol",
  );
  await assert.rejects(
    readOpenApiDocument({
      baseUrl,
      fetchImpl: async () => new Response(JSON.stringify({ openapi: "3.1.0", info: {}, paths: {}, components: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    }),
    (error) => error?.kind === "protocol",
  );
  await assert.rejects(
    readOpenApiDocument({
      baseUrl,
      fetchImpl: async () => new Response(JSON.stringify({
        ...openApi,
        paths: { ...openApi.paths, "/v1/operations/health": {} },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    }),
    (error) => error?.kind === "protocol",
  );

  const oversizedResponse = await fetch(`${baseUrl}/v1/operations/find`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: { name: "__oversized_response__" }, timeoutMs: 1_000 }),
  });
  assert.equal(oversizedResponse.status, 502);
  const oversizedResponseError = await oversizedResponse.json();
  assert.equal(oversizedResponseError.error.code, "response-too-large");
  assert(!JSON.stringify(oversizedResponseError).includes("xxx"));

  const malformedResult = await fetch(`${baseUrl}/v1/operations/find`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: { name: "__malformed_result__" }, timeoutMs: 1_000 }),
  });
  assert.equal(malformedResult.status, 502);
  const malformedResultError = await malformedResult.json();
  assert.equal(malformedResultError.error.code, "invalid-operation-result");
  assert.match(malformedResultError.error.message, /Result_find/);
  assert.match(malformedResultError.error.message, /ok:invalid_type/);
  assert(!JSON.stringify(malformedResultError).includes("Privat"), "Malformed Worker-Daten duerfen nicht reflektiert werden.");

  const blocked = await fetch(`${baseUrl}/v1/operations/keys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: {} }),
  });
  assert.equal(blocked.status, 404);
  assert.equal((await blocked.json()).error.code, "operation-not-allowed");

  const direct = await fetch(`${baseUrl}/v1/operations/find`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: { name: "private-tax-value-must-not-be-logged" }, timeoutMs: 1_000 }),
  });
  assert.equal(direct.status, 200);
  const directEnvelope = await direct.json();
  assert.equal(directEnvelope.result.stable, "same-result");
  assert.equal(calls.at(-1).timeoutMs, 1_000);

  const crossProcessBusy = await fetch(`${baseUrl}/v1/operations/find`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: { name: "__session_controller_busy__" } }),
  });
  assert.equal(crossProcessBusy.status, 200,
    "Worker-Controller-Busy bleibt ein strukturiertes Operationsergebnis, nicht API-prozesslokales HTTP 409.");
  const crossProcessBusyEnvelope = await crossProcessBusy.json();
  assert.equal(crossProcessBusyEnvelope.result.kind, "busy");
  assert.equal(crossProcessBusyEnvelope.result.reason, "session-controller-busy");
  assert.equal(crossProcessBusyEnvelope.result.waited, false);

  const throughClient = await callApiOperation("health", {}, 1_000, { baseUrl });
  assert.equal(throughClient.stable, directEnvelope.result.stable);
  const callsBeforeInstanceMismatch = calls.length;
  await assert.rejects(
    callApiOperation("health", {}, 1_000, {
      baseUrl,
      expectedInstanceId: "22222222-2222-4222-8222-222222222222",
    }),
    /Instanz|Health-Bindung/iu,
  );
  assert.equal(calls.length, callsBeforeInstanceMismatch,
    "Falsche API-Instanzbindung erreichte unerwartet den Executor.");
  let invalidClientFetches = 0;
  await assert.rejects(
    callApiOperation("find", {}, 1_000, {
      baseUrl,
      fetchImpl: async () => { invalidClientFetches += 1; throw new Error("darf nicht senden"); },
    }),
    (error) => error?.kind === "bad-args",
  );
  assert.equal(invalidClientFetches, 0, "Direkter API-Client muss ungueltige Argumente vor HTTP ablehnen");
  await assert.rejects(
    callApiOperation("vast_apply", {
      hwnd: 1,
      expectedMainHwnd: 2,
      expectedCaseRef: "cases:fall.Gew2025",
      expectedCaseHash: "0".repeat(64),
      mappingFingerprint: "1".repeat(64),
      plan: Array.from({ length: 500 }, (_, index) => ({
        certificate: `Beleg-${index}`,
        occurrence: 1,
        localTarget: "x".repeat(17_000),
      })),
      acknowledgeApply: true,
    }, 1_000, {
      baseUrl,
      fetchImpl: async () => { invalidClientFetches += 1; throw new Error("darf nicht senden"); },
    }),
    (error) => error?.kind === "payload-too-large",
  );
  assert.equal(invalidClientFetches, 0, "Uebergrosse API-Anfrage darf den Loopback-Server nicht erreichen");
  throwOnLog = true;
  const succeedsWithoutLog = await callApiOperation("health", {}, 1_000, { baseUrl });
  throwOnLog = false;
  assert.equal(succeedsWithoutLog.ok, true, "Logfehler darf eine gueltige API-Antwort nicht verhindern");
  for (const invalidTimeout of [199, MAX_OPERATION_TIMEOUT_MS + 1, 1_000.5]) {
    await assert.rejects(
      callApiOperation("health", {}, invalidTimeout, { baseUrl }),
      /Zeitlimit.*zwischen/,
    );
  }
  const externalAbort = new AbortController();
  const externallyCancelled = callApiOperation("health", {}, 1_000, {
    baseUrl,
      signal: externalAbort.signal,
    fetchImpl: (_url, init) => new Promise((_, reject) => {
      const rejectWithReason = () => reject(init.signal.reason);
      if (init.signal.aborted) rejectWithReason();
      else init.signal.addEventListener("abort", rejectWithReason, { once: true });
    }),
  });
  externalAbort.abort(new Error("synthetischer Aufruferabbruch"));
  await assert.rejects(externallyCancelled, (error) => error?.kind === "aborted");
  await assert.rejects(
    callApiOperation("health", {}, 1_000, { baseUrl: "http://192.0.2.10:43127" }),
    /Loopback/,
  );
  await assert.rejects(
    callApiOperation("health", {}, 1_000, { baseUrl: `${baseUrl}/v1` }),
    /Host und Port/,
  );
  const responseFor = (payload, body = JSON.stringify({ requestId: randomUUID(), durationMs: 0, ...payload })) => async () => new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  await assert.rejects(
    callApiOperation("health", {}, 1_000, {
      baseUrl,
      fetchImpl: responseFor({ apiVersion: "v1", operation: "find", result: { ok: true } }),
    }),
    /andere Operation/,
  );
  await assert.rejects(
    callApiOperation("health", {}, 1_000, {
      baseUrl,
      fetchImpl: responseFor({ apiVersion: "v2", operation: "health", result: { ok: true } }),
    }),
    /Version/,
  );
  await assert.rejects(
    callApiOperation("health", {}, 1_000, { baseUrl, fetchImpl: responseFor({}, "kein-json") }),
    /kein gueltiges JSON/,
  );
  await assert.rejects(
    callApiOperation("health", {}, 1_000, {
      baseUrl,
      fetchImpl: async () => new Response("{}", { status: 200, headers: { "content-type": "text/plain" } }),
    }),
    /Content-Type application\/json/,
  );
  await assert.rejects(
    callApiOperation("health", {}, 1_000, {
      baseUrl,
      fetchImpl: responseFor({
        apiVersion: "v1", requestId: "keine-uuid", durationMs: 0, operation: "health", result: { ok: true },
      }),
    }),
    /requestId oder durationMs/,
  );
  await assert.rejects(
    callApiOperation("health", {}, 1_000, {
      baseUrl,
      fetchImpl: responseFor({
        apiVersion: "v1", requestId: randomUUID(), durationMs: -1, operation: "health", result: { ok: true },
      }),
    }),
    /requestId oder durationMs/,
  );
  let operationFetchInit;
  const transportChecked = await callApiOperation("health", {}, 1_000, {
    baseUrl,
      fetchImpl: async (_url, init) => {
      operationFetchInit = init;
      return new Response(JSON.stringify({
        apiVersion: "v1",
        requestId: randomUUID(),
        operation: "health",
        durationMs: 0,
        result: { ok: true },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(transportChecked.ok, true);
  assert.equal(operationFetchInit.redirect, "error");
  assert.equal(operationFetchInit.headers.accept, "application/json");
  await assert.rejects(
    callApiOperation("health", {}, 1_000, {
      baseUrl,
      fetchImpl: async () => new Response(JSON.stringify({
        apiVersion: "v1",
        requestId: randomUUID(),
        operation: "health",
        durationMs: 0,
        result: { ok: true, running: "ja" },
      }), { status: 200, headers: { "content-type": "application/json" } }),
    }),
    (error) => error?.kind === "protocol" && /versionierten Ergebnisvertrag/.test(error.message),
  );
  let discoveryFetchInit;
  await readApiDiscovery({
    baseUrl,
      fetchImpl: async (_url, init) => {
      discoveryFetchInit = init;
      return new Response(JSON.stringify(SSE_API_DISCOVERY), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(discoveryFetchInit.redirect, "error");
  assert.equal(discoveryFetchInit.headers.accept, "application/json");
  await assert.rejects(
    callApiOperation("health", {}, 1_000, {
      baseUrl,
      fetchImpl: async () => new Response(JSON.stringify({
        apiVersion: "v1",
        error: { code: "busy", message: "Queue voll" },
      }), { status: 503, headers: { "content-type": "application/json" } }),
    }),
    (error) => error?.kind === "protocol" && /Fehlerantwort.*Antworthuelle/.test(error.message),
  );
  await assert.rejects(
    callApiOperation("health", {}, 1_000, {
      baseUrl,
      fetchImpl: async () => new Response(JSON.stringify({
        apiVersion: "v1",
        requestId: randomUUID(),
        error: { code: "busy", message: "Queue voll" },
      }), { status: 503, headers: { "content-type": "application/json" } }),
    }),
    (error) => error?.kind === "busy" && /Queue voll/.test(error.message),
  );
  await assert.rejects(
    readApiDiscovery({
      baseUrl,
      fetchImpl: async () => new Response(JSON.stringify({
        apiVersion: "v1",
        requestId: randomUUID(),
        error: { code: "forbidden", message: "Aufruf aus einem Browser" },
      }), { status: 403, headers: { "content-type": "application/json" } }),
    }),
    (error) => error?.kind === "forbidden" && /Browser/.test(error.message),
  );
  await assert.rejects(
    readApiJsonResponse(new Response(Buffer.from([0x7b, 0x22, 0x80, 0x22, 0x7d]), {
      status: 200,
      headers: { "content-type": "application/json" },
    })),
    /kein gueltiges UTF-8/,
  );
  await assert.rejects(
    readApiJsonResponse(new Response(JSON.stringify({ value: "zu gross" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }), 8),
    /groesser als 8 Bytes/,
  );
  await assert.rejects(
    readApiJsonResponse(new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json", "content-length": "999" },
    }), 8),
    /groesser als 8 Bytes/,
  );

  await callApiOperation("list_cases", {}, 1_000, { baseUrl });
  assert.equal(calls.at(-1).args.dir, config.caseDir, "API muss lokalen Fallordner injizieren");

  await callApiOperation("list_cases", { dir: "D:\\Explicit" }, 1_000, { baseUrl });
  assert.equal(calls.at(-1).args.dir, "D:\\Explicit", "explizite kompatible Argumente bleiben erhalten");

  const launched = await callApiOperation("launch", { mode: "einur" }, 30_000, { baseUrl });
  const launchCall = calls.findLast((entry) => entry.operation === "launch");
  assert.equal(launchCall.args.exe, config.sseExecutable, "nur die API kennt den lokalen SSE-Pfad");
  assert.deepEqual(
    calls.slice(calls.indexOf(launchCall), calls.length).map((entry) => entry.operation),
    ["launch", "launch_probe"],
    "SSE-Start muss Prozessstart und den intern pollenden Readback auf genau zwei frische Worker trennen",
  );
  assert.equal(launched.ready, true);
  const launchProbeCall = calls.findLast((entry) => entry.operation === "launch_probe");
  assert.equal(launchProbeCall.args.pid, 4242);
  assert.equal(launchProbeCall.args.planKind, "launch-readiness");
  assert.equal(launchProbeCall.args.schemaVersion, 1);
  assert.deepEqual(launched.instance, {
    pid: 4242,
    hwnd: 2424,
    title: "Einkommensteuer 2025: SteuerSparErklärung für das Steuerjahr 2025",
    bindingMode: "launch-window",
  });
  const callsBeforeRejectedExe = calls.length;
  const rejectedExe = await fetch(`${baseUrl}/v1/operations/launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: { exe: "C:\\Other\\program.exe" }, timeoutMs: 1_000 }),
  });
  assert.equal(rejectedExe.status, 400);
  const rejectedExeError = (await rejectedExe.json()).error;
  assert.equal(rejectedExeError.code, "bad-args");
  assert.match(rejectedExeError.message, /exe/, "bad-args muss das ungueltige Feld benennen");
  assert.equal(calls.length, callsBeforeRejectedExe, "ungueltige Argumente duerfen den Executor nicht erreichen");

  mkdirSync(config.workspaceDir, { recursive: true });
  writeFileSync(
    join(config.workspaceDir, "config-injection.json"),
    JSON.stringify({
      schemaVersion: 1,
      name: "config-injection",
      resultFile: "config-injection-result.json",
      steps: [{ id: "cases", operation: "list_cases", capture: ["args.dir"], expect: { "args.dir": "cases:." } }],
    }),
  );
  const scenario = await callApiOperation(
    "scenario_run",
    { scenarioRef: "config-injection.json" },
    5_000,
    { baseUrl },
  );
  assert.equal(
    scenario.ok,
    true,
    `Szenario muss dieselbe API-Konfiguration wie der Direktaufruf sehen: ${JSON.stringify(scenario)}`,
  );
  assert(
    calls.some((entry) => entry.operation === "list_cases" && entry.args.dir === config.caseDir),
    "Szenario muss den lokalen Fallordner nur bis zum Worker injizieren",
  );

  const checker = await callApiOperation("checker_open", { name: "Pruefhinweis" }, 5_000, { baseUrl });
  assert.equal(checker.ok, true);
  assert.equal(checker.text, "Detail");
  assert.equal(checker.kontrollbildEnthalten, true);
  assert.equal(calls.at(-1).operation, "checker_open_plan", "checker_open muss genau einen privaten Workerplan starten");
  assert.equal(checker.performance.workerProcessCount, 1);

  checkerState.active = true;
  checkerState.expanded = false;
  const collapsedStart = calls.length;
  const expandedChecker = await callApiOperation("checker_open", { name: "Pruefhinweis" }, 5_000, { baseUrl });
  assert.equal(expandedChecker.ok, true);
  const collapsedCalls = calls.slice(collapsedStart);
  assert.deepEqual(collapsedCalls.map((entry) => entry.operation), ["checker_open_plan"]);
  assert.equal(expandedChecker.performance.internalTimings.some((entry) => entry.operation === "click_point"), true,
    "Privater Plan muss eine eingeklappte Meldung intern katalogkonform oeffnen");

  checkerState.active = false;
  checkerState.expanded = false;
  checkerState.page = "Prüfen und Abgeben";
  const inactiveStart = calls.length;
  const startedChecker = await callApiOperation("checker_open", { name: "Pruefhinweis" }, 5_000, { baseUrl });
  assert.equal(startedChecker.ok, true);
  const inactiveEntries = calls.slice(inactiveStart);
  assert.deepEqual(inactiveEntries.map((entry) => entry.operation), ["checker_open_plan"]);
  assert.equal(startedChecker.performance.workerProcessCount, 1);
  assert.equal(startedChecker.performance.reusedReadbackCount, 1,
    "checker_run-Ergebnis muss ohne zusaetzliches checker_results weiterverwendet werden");
  for (const nestedOperation of ["click", "checker_run", "click_point", "checker_detail"]) {
    assert(startedChecker.performance.internalTimings.some((entry) => entry.operation === nestedOperation),
      `Privater checker_open-Plan muss '${nestedOperation}' intern ausfuehren`);
  }

  checkerState.active = true;
  checkerState.expanded = false;
  checkerState.consistent = false;
  checkerState.messageVisible = false;
  checkerState.resetRecovers = true;
  const resetStart = calls.length;
  const resetRecovered = await callApiOperation("checker_open", { name: "Pruefhinweis" }, 5_000, { baseUrl });
  assert.equal(resetRecovered.ok, true);
  assert.deepEqual(calls.slice(resetStart).map((entry) => entry.operation), ["checker_open_plan"]);
  assert.equal(resetRecovered.performance.reusedReadbackCount, 1);
  assert(resetRecovered.performance.internalTimings.some((entry) => entry.operation === "checker_reset"));

  checkerState.expanded = false;
  checkerState.consistent = false;
  checkerState.messageVisible = false;
  checkerState.resetRecovers = false;
  const incompleteStart = calls.length;
  const incompleteChecker = await callApiOperation("checker_open", { name: "Pruefhinweis" }, 5_000, { baseUrl });
  assert.equal(incompleteChecker.ok, false);
  assert.equal(incompleteChecker.kind, "checker-incomplete");
  assert.equal(incompleteChecker.cleanupRequired, false);
  assert.deepEqual(calls.slice(incompleteStart).map((entry) => entry.operation), ["checker_open_plan"]);

  checkerState.consistent = true;
  checkerState.messageVisible = true;
  checkerState.resetRecovers = false;
  const missingStart = calls.length;
  const missingChecker = await callApiOperation("checker_open", { name: "Nicht vorhanden" }, 5_000, { baseUrl });
  assert.equal(missingChecker.ok, false);
  assert.equal(missingChecker.kind, "checker-message");
  assert.deepEqual(calls.slice(missingStart).map((entry) => entry.operation), ["checker_open_plan"]);

  const abortController = new AbortController();
  const aborting = fetch(`${baseUrl}/v1/operations/find`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: { name: "__wait_for_abort__" }, timeoutMs: 2_000 }),
    signal: abortController.signal,
  });
  await waitForWithin(abortStarted, 5_000, "API-Abbruchtest erreichte den Executor nicht");
  abortController.abort();
  await assert.rejects(aborting, /abort/i);
  await waitForWithin(abortObserved, 5_000, "API-Abbruchsignal erreichte Executor nicht");
  const abortedOperationLog = logs.findLast((record) =>
    record.event === "operation" && record.operation === "find" && record.kind === "aborted",
  );
  assert.equal(abortedOperationLog?.delivered, false,
    "Ein bereits ausgefuehrtes Ergebnis muss auch nach Client-Abbruch datenarm geloggt werden.");

  const badBody = await fetch(`${baseUrl}/v1/operations/health`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: [] }),
  });
  assert.equal(badBody.status, 400);

  const callsBeforeTransportRejections = calls.length;
  const missingContentType = await fetch(`${baseUrl}/v1/operations/health`, {
    method: "POST",
    body: JSON.stringify({ args: {} }),
  });
  assert.equal(missingContentType.status, 415);
  assert.equal((await missingContentType.json()).error.code, "unsupported-media-type");

  const emptyJsonBody = await fetch(`${baseUrl}/v1/operations/health`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "",
  });
  assert.equal(emptyJsonBody.status, 400);
  assert.match((await emptyJsonBody.json()).error.message, /nicht leer/);

  const invalidUtf8 = await fetch(`${baseUrl}/v1/operations/find`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: Buffer.concat([
      Buffer.from('{"args":{"name":"', "ascii"),
      Buffer.from([0x80]),
      Buffer.from('"}}', "ascii"),
    ]),
  });
  assert.equal(invalidUtf8.status, 400);
  assert.match((await invalidUtf8.json()).error.message, /UTF-8/);
  assert.equal(calls.length, callsBeforeTransportRejections, "ungueltiger Transport darf den Executor nicht erreichen");

  const callsBeforeUnknownArg = calls.length;
  const unknownArg = await fetch(`${baseUrl}/v1/operations/health`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: { unexpected: true } }),
  });
  assert.equal(unknownArg.status, 400);
  assert.equal((await unknownArg.json()).error.code, "bad-args");
  assert.equal(calls.length, callsBeforeUnknownArg, "unbekannte Argumente duerfen den Executor nicht erreichen");

  const unknownEnvelopeField = await fetch(`${baseUrl}/v1/operations/health`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: {}, "private-field-name-must-not-be-logged": 5_000 }),
  });
  assert.equal(unknownEnvelopeField.status, 400);
  const unknownEnvelopeError = (await unknownEnvelopeField.json()).error;
  assert.equal(unknownEnvelopeError.code, "bad-request");
  assert.match(unknownEnvelopeError.message, /private-field-name-must-not-be-logged/);
  assert.equal(calls.length, callsBeforeUnknownArg, "unbekannte Anfragefelder duerfen den Executor nicht erreichen");

  const badTimeout = await fetch(`${baseUrl}/v1/operations/health`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: {}, timeoutMs: 199 }),
  });
  assert.equal(badTimeout.status, 400);

  const oversized = await fetch(`${baseUrl}/v1/operations/health`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: { value: "x".repeat(MAX_API_BODY_BYTES) } }),
  });
  assert.equal(oversized.status, 413);

  const oddHostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(
      `${baseUrl}/healthz`,
      { headers: { host: "a b" } },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      },
    );
    request.once("error", reject);
    request.end();
  });
  assert.equal(oddHostStatus, 403, "Ein ungewoehnlicher Host-Header ist kein Loopback-Name und wird abgewiesen");

  const serializedLogs = JSON.stringify(logs);
  assert(!serializedLogs.includes("private-tax-value"));
  assert(!serializedLogs.includes("private-field-name-must-not-be-logged"));
  assert(logs.every((record) => !Object.hasOwn(record, "message")), "API-Log darf keine request-abgeleiteten Meldungen speichern");
  assert(logs.every((record) => !Object.hasOwn(record, "args") && !Object.hasOwn(record, "result")));

  process.stdout.write(`API-Vertrag: ${calls.length} Aufrufe, ${SSE_API_OPERATIONS.length} freigegebene Operationen\n`);
} finally {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  rmSync(temporary, { recursive: true, force: true });
}
