import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callApiOperation } from "../dist/api-client.js";
import { MAX_API_BODY_BYTES, SSE_API_OPERATIONS } from "../dist/api-contract.js";
import { createApiExecutor } from "../dist/api-executor.js";
import { createSseApiServer } from "../dist/api-server.js";

const token = "test-token-with-at-least-24-characters";
const calls = [];
const logs = [];
const temporary = mkdtempSync(join(tmpdir(), "sse-api-contract-"));
const config = {
  host: "127.0.0.1",
  port: 1,
  token,
  configPath: "C:\\ApiConfig\\config.json",
  caseDir: "C:\\SSE-Cases",
  workspaceDir: join(temporary, "workspace"),
  resultDir: "C:\\SSE-Results",
  sseExecutable: "C:\\Program Files\\SSE 2025\\SSE.exe",
};
config.resultDir = join(temporary, "results");
let markAbortObserved;
const abortObserved = new Promise((resolve) => { markAbortObserved = resolve; });
const checkerState = {
  active: true,
  expanded: true,
  page: "Steuererklärung prüfen",
};

const execute = createApiExecutor(config, async (operation, args, timeoutMs, signal) => {
  calls.push({ operation, args, timeoutMs });
  if (operation === "find" && args.name === "__wait_for_abort__") {
    if (!signal?.aborted) await new Promise((resolve) => signal?.addEventListener("abort", resolve, { once: true }));
    markAbortObserved();
    return { ok: false, kind: "aborted", error: "aborted" };
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
  config,
  execute,
  log: (record) => logs.push(record),
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, apiVersion: "v1" });

  const unauthorized = await fetch(`${baseUrl}/v1/operations`);
  assert.equal(unauthorized.status, 401);
  for (const authorization of [undefined, "Bearer wrong-token-with-at-least-24-characters"]) {
    const unauthorizedPost = await fetch(`${baseUrl}/v1/operations/health`, {
      method: "POST",
      headers: {
        ...(authorization ? { authorization } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify({ args: {} }),
    });
    assert.equal(unauthorizedPost.status, 401);
  }

  const listed = await fetch(`${baseUrl}/v1/operations`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(listed.status, 200);
  const catalog = await listed.json();
  assert.deepEqual(catalog.operations, SSE_API_OPERATIONS);
  assert(!catalog.operations.includes("keys"), "freie Tastatureingabe darf nicht in die API gelangen");

  const blocked = await fetch(`${baseUrl}/v1/operations/keys`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ args: {} }),
  });
  assert.equal(blocked.status, 404);
  assert.equal((await blocked.json()).error.code, "operation-not-allowed");

  const direct = await fetch(`${baseUrl}/v1/operations/find`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ args: { name: "private-tax-value-must-not-be-logged" }, timeoutMs: 1_000 }),
  });
  assert.equal(direct.status, 200);
  const directEnvelope = await direct.json();
  assert.equal(directEnvelope.result.stable, "same-result");
  assert.equal(calls.at(-1).timeoutMs, 1_000);

  const throughClient = await callApiOperation("health", {}, 1_000, { baseUrl, token });
  assert.equal(throughClient.stable, directEnvelope.result.stable);
  await assert.rejects(
    callApiOperation("health", {}, 1_000, { baseUrl: "http://192.0.2.10:43127", token }),
    /Loopback/,
  );

  await callApiOperation("list_cases", {}, 1_000, { baseUrl, token });
  assert.equal(calls.at(-1).args.dir, config.caseDir, "API muss lokalen Fallordner injizieren");

  await callApiOperation("list_cases", { dir: "D:\\Explicit" }, 1_000, { baseUrl, token });
  assert.equal(calls.at(-1).args.dir, "D:\\Explicit", "explizite kompatible Argumente bleiben erhalten");

  await callApiOperation("launch", { mode: "einur" }, 1_000, { baseUrl, token });
  assert.equal(calls.at(-1).args.exe, config.sseExecutable, "nur die API kennt den lokalen SSE-Pfad");
  const callsBeforeRejectedExe = calls.length;
  const rejectedExe = await fetch(`${baseUrl}/v1/operations/launch`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
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
    { baseUrl, token },
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

  const checker = await callApiOperation("checker_open", { name: "Pruefhinweis" }, 5_000, { baseUrl, token });
  assert.equal(checker.ok, true);
  assert.equal(checker.text, "Detail");
  assert.equal(checker.kontrollbildEnthalten, true);
  assert.equal(calls.at(-1).operation, "checker_detail", "checker_open muss in der API komponiert werden");

  checkerState.active = true;
  checkerState.expanded = false;
  const collapsedStart = calls.length;
  const expandedChecker = await callApiOperation("checker_open", { name: "Pruefhinweis" }, 5_000, { baseUrl, token });
  assert.equal(expandedChecker.ok, true);
  const collapsedCalls = calls.slice(collapsedStart);
  assert(
    collapsedCalls.some((entry) => entry.operation === "click_point" && entry.args.checkerReadOnly === true),
    "checker_open muss eine eingeklappte Meldung katalogkonform read-only oeffnen",
  );

  checkerState.active = false;
  checkerState.expanded = false;
  checkerState.page = "Prüfen und Abgeben";
  const inactiveStart = calls.length;
  const startedChecker = await callApiOperation("checker_open", { name: "Pruefhinweis" }, 5_000, { baseUrl, token });
  assert.equal(startedChecker.ok, true);
  const inactiveEntries = calls.slice(inactiveStart);
  const inactiveCalls = inactiveEntries.map((entry) => entry.operation);
  for (const nestedOperation of ["page", "click", "checker_run", "click_point", "checker_detail"]) {
    assert(inactiveCalls.includes(nestedOperation), `checker_open-Recovery muss '${nestedOperation}' validiert ausfuehren`);
  }
  assert.equal(
    inactiveEntries.find((entry) => entry.operation === "click")?.args.expectedPageAfter,
    "Steuererklärung prüfen",
    "checker_open muss den navigierenden Klick im selben Worker ruecklesen",
  );

  const abortController = new AbortController();
  const aborting = fetch(`${baseUrl}/v1/operations/find`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ args: { name: "__wait_for_abort__" }, timeoutMs: 2_000 }),
    signal: abortController.signal,
  });
  setTimeout(() => abortController.abort(), 50);
  await assert.rejects(aborting, /abort/i);
  await Promise.race([
    abortObserved,
    new Promise((_, reject) => setTimeout(() => reject(new Error("API-Abbruchsignal erreichte Executor nicht")), 2_000)),
  ]);

  const badBody = await fetch(`${baseUrl}/v1/operations/health`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ args: [] }),
  });
  assert.equal(badBody.status, 400);

  const callsBeforeUnknownArg = calls.length;
  const unknownArg = await fetch(`${baseUrl}/v1/operations/health`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ args: { unexpected: true } }),
  });
  assert.equal(unknownArg.status, 400);
  assert.equal((await unknownArg.json()).error.code, "bad-args");
  assert.equal(calls.length, callsBeforeUnknownArg, "unbekannte Argumente duerfen den Executor nicht erreichen");

  const badTimeout = await fetch(`${baseUrl}/v1/operations/health`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ args: {}, timeoutMs: 199 }),
  });
  assert.equal(badTimeout.status, 400);

  const oversized = await fetch(`${baseUrl}/v1/operations/health`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
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
  assert.equal(oddHostStatus, 200, "Ein ungewoehnlicher Host-Header darf die Loopback-API nicht beenden");

  const serializedLogs = JSON.stringify(logs);
  assert(!serializedLogs.includes(token));
  assert(!serializedLogs.includes("private-tax-value"));
  assert(logs.every((record) => !Object.hasOwn(record, "args") && !Object.hasOwn(record, "result")));

  process.stdout.write(`API-Vertrag: ${calls.length} Aufrufe, ${SSE_API_OPERATIONS.length} freigegebene Operationen\n`);
} finally {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  rmSync(temporary, { recursive: true, force: true });
}
