import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  MAX_API_ARGUMENT_STRING_BYTES,
  SSE_MCP_COMPOSED_TOOL_OPERATIONS,
  SSE_MCP_CONTROL_TOOL_ACTIONS,
  SSE_MCP_TOOL_OPERATIONS,
  SSE_MCP_TOOL_SCHEMAS,
} from "../dist/operation-catalog.js";
import { operationAnnotations } from "../dist/operation-traits.js";
import { SSE_API_PACKAGE_NAME, SSE_PACKAGE_VERSION } from "../dist/version.js";
import {
  enumChoices,
  invalidTypeValue,
  sampleEnumVariant,
  sampleJsonSchema,
  validBoundaryValues,
} from "./json-schema-samples.mjs";

const assertPropertyDescriptions = (schema, path) => {
  if (!schema || typeof schema !== "object") return;
  for (const [property, child] of Object.entries(schema.properties ?? {})) {
    assert(
      typeof child.description === "string" && child.description.trim(),
      `${path}.${property} braucht eine eigene JSON-Schema-Beschreibung.`,
    );
    assertPropertyDescriptions(child, `${path}.${property}`);
  }
  if (schema.items) assertPropertyDescriptions(schema.items, `${path}[]`);
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    for (const [index, child] of (schema[key] ?? []).entries()) {
      assertPropertyDescriptions(child, `${path}.${key}[${index}]`);
    }
  }
  for (const definitions of [schema.$defs, schema.definitions]) {
    for (const [name, child] of Object.entries(definitions ?? {})) {
      assertPropertyDescriptions(child, `${path}.${name}`);
    }
  }
};
const expectedToolCount = Object.keys(SSE_MCP_TOOL_SCHEMAS).length;
const operationsForTool = (name) => name in SSE_MCP_TOOL_OPERATIONS
  ? [SSE_MCP_TOOL_OPERATIONS[name]]
  : SSE_MCP_COMPOSED_TOOL_OPERATIONS[name];
const annotationsForTool = (name) => {
  const traits = operationsForTool(name).map((operation) => operationAnnotations(operation));
  return {
    readOnlyHint: traits.every((entry) => entry.readOnlyHint),
    destructiveHint: traits.some((entry) => entry.destructiveHint),
    idempotentHint: traits.every((entry) => entry.idempotentHint),
    openWorldHint: false,
  };
};

const calls = [];
const API_INSTANCE_ID = "44444444-4444-4444-8444-444444444444";
let forcedResult;
let forcedOperationResults = {};
let forceTransportReset = false;
let forceMalformedJson = false;
let forceIncompatibleHealth = false;
const api = createServer(async (request, response) => {
  if (request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      apiVersion: forceIncompatibleHealth ? "v0" : "v1",
      packageName: SSE_API_PACKAGE_NAME,
      packageVersion: SSE_PACKAGE_VERSION,
      processId: process.pid,
      instanceId: API_INSTANCE_ID,
      configurationFingerprint: "0".repeat(64),
      inFlight: null,
      prewarm: null,
    }));
    return;
  }
  if (forceTransportReset) {
    request.socket.destroy();
    return;
  }
  assert.equal(request.headers["x-sse-api-instance-id"], API_INSTANCE_ID,
    "MCP-Operations-POST ist nicht atomar an die zuvor gepruefte API-Instanz gebunden.");
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  // Der MCP ist ein lokaler Prozess und darf keine Browser-Kopfzeilen senden.
  if (request.headers.origin !== undefined || request.headers["sec-fetch-site"] !== undefined) {
    response.writeHead(403, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: "forbidden", message: "Browserkopfzeile" } }));
    return;
  }
  const operation = /\/v1\/operations\/([a-z_]+)$/.exec(request.url ?? "")?.[1];
  assert(operation, `Unerwarteter API-Pfad: ${request.url}`);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  calls.push({ operation, args: body.args ?? {} });
  const defaultResult = {
    ok: true,
    operation,
    args: body.args ?? {},
    shot: { path: "C:\\Temp\\synthetic.png", w: 100, h: 50 },
    windows: operation === "windows"
      ? [{ pid: 88, hwnd: 77, title: "Werte-Info", titleFingerprint: "f".repeat(64) }]
      : [],
    dialogs: [],
    files: [],
    cases: [],
    rows: [],
    fields: [],
    items: [],
    options: [],
    results: [],
    pages: [],
    fragenWarnungen: [],
    tippsZusatzinfos: [],
    sonstige: [],
    aufgeklappt: [],
    product: operation === "product_info"
      ? "SteuerSparErklaerung Testprofil"
      : { supported: true, taxYear: 2025, fileMajor: 31 },
    diagnosticText: "Dokumentation https://example.invalid/home/hilfe; lokaler Test C:\\Temp\\synthetic.png; danach lesbar",
    text: "Original mit C:\\NichtKonfiguriert\\beleg.txt; Ende",
    verzeichnis: operation === "center_cases" ? "Z:\\FremdeFaelle" : undefined,
    uncText: "UNC \\\\server\\freigabe\\datei.txt; Ende",
    extendedPathText: "Erweitert \\\\?\\C:\\Privat\\datei.txt; Ende",
    posixPathText: "POSIX /home/person/steuerfall.txt; file:///Users/person/steuerfall.txt; Ende",
    pathKeyObject: {
      lokalerPfadEntfernt1: "bestehender-nutzschluessel",
      "C:\\Privat\\erstes.txt": "eins",
      "\\\\server\\freigabe\\zweites.txt": "zwei",
      "/home/person/drittes.txt": "drei",
    },
  };
  const result = forcedOperationResults[operation] ?? forcedResult ?? defaultResult;
  forcedResult = undefined;
  const envelope = { apiVersion: "v1", requestId: randomUUID(), operation, durationMs: 0, result };
  const json = forceMalformedJson ? "{invalid-json" : JSON.stringify(envelope);
  forceMalformedJson = false;
  response.writeHead(200, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(json),
  });
  response.end(json);
});

api.listen(0, "127.0.0.1");
await once(api, "listening");
const address = api.address();
assert(address && typeof address === "object");
const here = dirname(fileURLToPath(import.meta.url));
const mcpEntry = process.env.SSE_TEST_MCP_ENTRY
  ? resolve(process.env.SSE_TEST_MCP_ENTRY)
  : join(here, "..", "dist", "index.js");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [mcpEntry],
  env: {
    ...process.env,
    SSE_API_URL: `http://127.0.0.1:${address.port}`,
  },
});
const client = new Client({ name: "sse-all-tools-wrapper", version: "1.0.0" });
const catalogStartedAt = performance.now();

try {
  await client.connect(transport);
  const catalog = await client.listTools();
  const catalogReadyMs = Math.round(performance.now() - catalogStartedAt);
  const catalogBytes = Buffer.byteLength(JSON.stringify(catalog), "utf8");
  assert(catalogBytes <= 512 * 1024, `MCP-Werkzeugkatalog ist mit ${catalogBytes} Bytes zu gross.`);
  assert(catalogReadyMs <= 10_000, `MCP-Werkzeugkatalog brauchte ${catalogReadyMs} ms bis zur Bereitschaft.`);
  const toolTexts = new Map();
  assert.equal(catalog.tools.length, expectedToolCount, `Unerwartete MCP-Werkzeugzahl: ${catalog.tools.length}`);
  const catalogToolNames = new Set(catalog.tools.map((tool) => tool.name));
  const operationTools = catalog.tools.filter((tool) => !Object.hasOwn(SSE_MCP_CONTROL_TOOL_ACTIONS, tool.name));
  const controlTools = catalog.tools.filter((tool) => Object.hasOwn(SSE_MCP_CONTROL_TOOL_ACTIONS, tool.name));
  assert.deepEqual(controlTools.map((tool) => tool.name).sort(), Object.keys(SSE_MCP_CONTROL_TOOL_ACTIONS).sort());
  const catalogTitles = new Set(catalog.tools.map((tool) => tool.title));
  assert.equal(catalogTitles.size, catalog.tools.length, "MCP-Werkzeugtitel muessen eindeutig sein.");
  for (const tool of catalog.tools) {
    assert(tool.title?.trim(), `${tool.name} braucht einen sichtbaren Titel.`);
    assert(tool.description?.trim(), `${tool.name} braucht eine Agentenbeschreibung.`);
    assert(tool.outputSchema, `${tool.name} braucht ein deklariertes MCP-Ergebnisschema.`);
    assert.equal(tool.outputSchema?.properties?.ok?.type, "boolean", `${tool.name}: outputSchema.ok fehlt.`);
    assert(tool.outputSchema?.required?.includes("ok"), `${tool.name}: outputSchema muss ok verlangen.`);
    assertPropertyDescriptions(tool.inputSchema, tool.name);
    const references = `${tool.title}\n${tool.description}`.match(/\bsse_[a-z0-9_]+\b/g) ?? [];
    for (const reference of references) {
      assert(catalogToolNames.has(reference), `${tool.name} verweist auf das unbekannte MCP-Werkzeug ${reference}.`);
    }
  }
  const clickCatalogTool = catalog.tools.find((tool) => tool.name === "sse_click");
  assert.equal(clickCatalogTool?.outputSchema?.type, "object");
  assert.equal(clickCatalogTool?.outputSchema?.properties?.ok?.type, "boolean");
  assert(clickCatalogTool?.outputSchema?.required?.includes("ok"));
  assert.deepEqual(clickCatalogTool?.outputSchema?.additionalProperties, {},
    "Das generische API-Ergebnisschema muss unbekannte Operationsfelder erhalten.");
  assert(catalog.tools.find((tool) => tool.name === "sse_ustva_change_value")?.outputSchema,
    "Der folgende isError-Test muss wirklich trotz deklariertem Erfolgsschema laufen.");
  const launchDescription = catalog.tools.find((tool) => tool.name === "sse_launch")?.description ?? "";
  assert.match(launchDescription, /sse_dialog_list/);
  assert.match(launchDescription, /sse_dialog_answer/);
  assert(!/sse_click\s+'(?:Ja|Nein)'/.test(launchDescription), "Startdialog darf keinen generischen Klick empfehlen.");
  for (const tool of operationTools) {
    assert.deepEqual(
      tool.annotations,
      annotationsForTool(tool.name),
      `${tool.name} hat driftende MCP-Sicherheitshinweise.`,
    );
  }
  let controlStrictRejections = 0;
  for (const tool of controlTools) {
    assert.deepEqual(tool.annotations, {
      readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false,
    });
    assert.deepEqual(tool.inputSchema.properties.action.enum, SSE_MCP_CONTROL_TOOL_ACTIONS[tool.name]);
    const before = calls.length;
    const status = await client.callTool({ name: tool.name, arguments: { action: "status" } });
    assert.notEqual(status.isError, true);
    assert.equal(status.structuredContent.state, "running");
    assert.equal(status.structuredContent.instanceId, API_INSTANCE_ID);
    assert.equal(status.structuredContent.processExited, false);
    const unknown = await client.callTool({ name: tool.name, arguments: { action: "status", unknown: true } });
    assert.equal(unknown.isError, true);
    controlStrictRejections += 1;
    assert.equal(calls.length, before, "API lifecycle status must not be disguised as a worker operation.");
  }
  const pathBearingTools = new Set([
    "sse_case_hash", "sse_center_refresh", "sse_window_close", "sse_vast_apply", "sse_desktop_start",
    "sse_export_csv", "sse_collect", "sse_verify",
    "sse_screenshot", "sse_launch", "sse_save", "sse_dialog_answer", "sse_file_dialog_select", "sse_save_as",
    "sse_change_field", "sse_change_known_field", "sse_list_cases", "sse_backup_cases",
    "sse_archive_cases", "sse_make_working_copy",
    "sse_ustva_select_period", "sse_ustva_set_flag", "sse_ustva_change_value",
  ]);
  const forbiddenPathFields = new Set([
    "path", "file", "from", "dir", "dest", "source", "target", "expectedPath",
    "expectedCasePath", "expectedDirectory", "expectedTitle", "expectedSourcePath", "targetPath",
  ]);
  for (const tool of catalog.tools.filter((entry) => pathBearingTools.has(entry.name))) {
    const properties = Object.keys(tool.inputSchema?.properties ?? {});
    assert.deepEqual(
      properties.filter((property) => forbiddenPathFields.has(property)),
      [],
      `${tool.name} veroeffentlicht weiterhin lokale PC-Pfadfelder`,
    );
  }
  for (const tool of operationTools) {
    const args = sampleJsonSchema(tool.inputSchema, tool.name);
    const result = await client.callTool(
      { name: tool.name, arguments: args },
      undefined,
      { timeout: 10_000, maxTotalTimeout: 10_000 },
    );
    const text = result.content?.filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n") ?? "";
    toolTexts.set(tool.name, text);
    assert.notEqual(result.isError, true, `${tool.name} scheiterte mit ${JSON.stringify(args)}: ${text}`);
    assert(!text.includes("C:\\Temp\\synthetic.png") && !text.includes("/home/person") && !text.includes("/Users/person"),
      `${tool.name} darf keinen lokalen API-/Wrapper-Pfad ausgeben`);
  }
  const expectedInitialApiCalls = Object.keys(SSE_MCP_TOOL_OPERATIONS).length +
    Object.values(SSE_MCP_COMPOSED_TOOL_OPERATIONS).reduce((sum, operations) => sum + operations.length, 0);
  assert.equal(calls.length, expectedInitialApiCalls,
    `Direkte und komponierte MCP-Aufrufe erzeugten unerwartet ${calls.length} API-Aufrufe.`);

  // Exercise the real MCP boundary: omission must never select an implicit
  // active cursor, while an explicit compatibility request stays available.
  for (const fixture of [
    { args: { hwnd: 77, maxRows: 7 }, expected: { hwnd: 77, maxRows: 7, noKeys: true } },
    { args: { noKeys: true }, expected: { noKeys: true } },
    { args: { noKeys: false }, expected: { noKeys: false } },
    { args: { readMode: "grid" }, expected: { readMode: "grid", noKeys: true } },
  ]) {
    const before = calls.length;
    const result = await client.callTool({ name: "sse_table_read", arguments: fixture.args });
    assert.notEqual(result.isError, true);
    assert.deepEqual(calls.slice(before), [{ operation: "table_read", args: fixture.expected }],
      "MCP table reads must default to passive without replacing explicit modes or adding fallback calls.");
  }
  const beforeInvalidCursor = calls.length;
  const invalidCursor = await client.callTool({ name: "sse_table_read", arguments: { readMode: "grid", noKeys: false } });
  // The synthetic peer accepts every payload. The real API owns the existing
  // incompatible-mode guard; MCP must not silently repair an explicit choice.
  assert.notEqual(invalidCursor.isError, true);
  assert.deepEqual(calls.slice(beforeInvalidCursor), [{ operation: "table_read", args: { readMode: "grid", noKeys: false } }]);

  const fallbackNames = ["sse_click", "sse_click_point", "sse_tree_top", "sse_tree_scroll",
    "sse_scroll", "sse_scroll_page", "sse_menu", "sse_menu_click", "sse_read_table", "sse_set_value"];
  for (const name of fallbackNames) {
    const tool = catalog.tools.find((entry) => entry.name === name);
    assert.match(tool.title, /^\[Fallback\]/u, `${name} needs a visible fallback group.`);
    assert.match(tool.description, /^\[Fallback\]/u, `${name} needs agent-visible fallback guidance.`);
  }
  for (const name of ["sse_snapshot_compare", "sse_accessibility_probe", "sse_screenshot"]) {
    const tool = catalog.tools.find((entry) => entry.name === name);
    assert.match(tool.title, /^\[Diagnose\]/u);
    assert.match(tool.description, /^\[Diagnose\]/u);
  }
  const screenshotDescription = catalog.tools.find((tool) => tool.name === "sse_screenshot").description;
  assert(!/zuverlaessigste Werkzeug|Bei jedem Zweifel|zuerst hierher/u.test(screenshotDescription),
    "Diagnostic screenshot guidance must not override the preferred structured read path.");
  for (const name of ["sse_table_read", "sse_table_add", "sse_table_update", "sse_table_delete",
    "sse_find", "sse_get_value", "sse_snapshot", "sse_toggle", "sse_combo_select"]) {
    assert(!/^\[(Fallback|Diagnose)\]/u.test(catalog.tools.find((entry) => entry.name === name).title),
      `${name} must remain a normal structured transaction or useful discovery tool.`);
  }
  const routing = client.getInstructions() ?? "";
  assert.match(routing, /Werkzeugwahl/u);
  assert.match(routing, /noKeys:true/u);
  assert.match(routing, /readMode:'grid'/u);
  assert.match(routing, /outcomeUnknown/u);
  assert.match(routing, /kein automatischer Backendwechsel/u);
  assert.match(routing, /nachweislich benoetigter UIA-Schreibposition/u);
  assert.match(routing, /nicht eine beliebige Zielzeile/u);

  const tableUpdateTool = catalog.tools.find((entry) => entry.name === "sse_table_update");
  const updateArgs = sampleJsonSchema(tableUpdateTool.inputSchema, tableUpdateTool.name);
  for (const failure of [
    { ok: false, kind: "timeout", error: "Synthetic pending write timeout", mutationAttempted: true, outcomeUnknown: true, reconciliationRequired: true, retryable: false },
    { ok: false, kind: "stale-window", error: "Synthetic stale target", mutationAttempted: false, outcomeUnknown: false, retryable: false },
  ]) {
    const before = calls.length;
    forcedResult = failure;
    const result = await client.callTool({ name: "sse_table_update", arguments: updateArgs });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.kind, failure.kind, JSON.stringify(result.structuredContent));
    assert.equal(result.structuredContent.outcomeUnknown, failure.outcomeUnknown, JSON.stringify(result.structuredContent));
    assert.deepEqual(calls.slice(before).map((call) => call.operation), ["table_update"],
      "Fallback guidance must not replay a failed write through another tool/backend.");
  }

  // An incompatible preflight response must prevent the operation POST.
  const beforeIncompatibleHealth = calls.length;
  forceIncompatibleHealth = true;
  const incompatibleHealth = await client.callTool({ name: "sse_table_update", arguments: updateArgs });
  forceIncompatibleHealth = false;
  assert.equal(incompatibleHealth.isError, true);
  assert.equal(incompatibleHealth.structuredContent.kind, "protocol");
  assert.equal(incompatibleHealth.structuredContent.outcomeUnknown, undefined);
  assert.equal(incompatibleHealth.structuredContent.reconciliationRequired, undefined);
  assert.match(incompatibleHealth.structuredContent.error, /Healthz/u);
  assert.equal(calls.length, beforeIncompatibleHealth, "Incompatible health must not dispatch a write.");

  // A POST has already reached the API when its response fails parsing or
  // result validation. A protocol error cannot prove that no write happened.
  for (const failureMode of ["result-schema", "json"]) {
    const before = calls.length;
    forcedResult = failureMode === "result-schema" ? { ok: true, verified: "invalid-boolean" } : undefined;
    forceMalformedJson = failureMode === "json";
    const result = await client.callTool({ name: "sse_table_update", arguments: updateArgs });
    assert.equal(result.isError, true, failureMode);
    assert.equal(result.structuredContent.kind, "protocol", failureMode);
    assert.equal(result.structuredContent.outcomeUnknown, true, failureMode);
    assert.equal(result.structuredContent.reconciliationRequired, true, failureMode);
    assert.equal(result.structuredContent.retryable, false, failureMode);
    assert.match(result.structuredContent.hint, /keine automatische Schreibwiederholung/u, failureMode);
    assert.deepEqual(calls.slice(before).map((call) => call.operation), ["table_update"],
      `${failureMode}: an invalid response must not replay the already received write.`);
  }

  const desktopPeers = [{ pid: 102, hwnd: 43, title: "Synthetic additional instance" }];
  forcedResult = { ok: true, aktiv: true, desktop: "Synthetic", pid: 101, sseLaeuft: true,
    desktopErreichbar: true, markeVeraltet: false, fenster: [], weitereInstanzen: desktopPeers };
  const desktopStatus = await client.callTool({ name: "sse_desktop_status", arguments: {} });
  assert.notEqual(desktopStatus.isError, true);
  assert.deepEqual(desktopStatus.structuredContent.weitereInstanzen, desktopPeers);
  const desktopStatusText = JSON.parse(desktopStatus.content.filter(entry => entry.type === "text").map(entry => entry.text).join("\n"));
  assert.deepEqual(desktopStatusText.weitereInstanzen, desktopPeers, "Compact status must retain actionable PID/HWND peers");

  forcedResult = {
    ok: true,
    ref: "workspace:.",
    files: [{ ref: "workspace:eins.txt", bytes: 4, sha256: null, hashOmitted: true }],
    truncated: true,
  };
  const limitedWorkspace = await client.callTool({
    name: "sse_workspace_files",
    arguments: { ref: "workspace:.", limit: 1, includeHashes: false },
  });
  assert.notEqual(limitedWorkspace.isError, true);
  assert.equal(limitedWorkspace.structuredContent?.truncated, true,
    "MCP structuredContent muss die kanonische API-Trunkierungsmarkierung erhalten");
  assert.match(
    limitedWorkspace.content.filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n"),
    /"truncated": true/u,
    "Auch die lesbare MCP-Textantwort muss die abgeschnittene Liste kenntlich machen",
  );

  const visibleTable = {
    headers: ["Bezeichnung", "Betrag", "N"], rowCount: 1,
    rows: [["Synthetic row", "11,11", ""]], ausgeschlosseneFenster: [],
  };
  const visibleDetails = [{ rowIndex: 0, typedValues: ["Synthetic row", "11,11", false],
    checkboxStates: [null, null, "Off"], cellTypes: ["text", "text", "boolean"],
    semanticsComplete: true, semanticReadErrors: [] }];
  for (const fixture of [
    { label: "complete", fields: { incomplete: false }, truncated: false },
    { label: "truncated", fields: { incomplete: true }, truncated: true },
    { label: "unreported", fields: {}, truncated: false },
  ]) {
    const expected = { ok: true, ...visibleTable, rowDetails: visibleDetails,
      stats: { n: 20, err: 0, truncated: fixture.truncated }, note: "Visible rows only", ...fixture.fields };
    forcedResult = structuredClone(expected);
    const start = calls.length;
    const result = await client.callTool({ name: "sse_read_table", arguments: { hwnd: 77 } });
    assert.notEqual(result.isError, true, `${fixture.label}: visible table result failed.`);
    const compact = JSON.parse(result.content.filter(entry => entry.type === "text").map(entry => entry.text).join("\n"));
    assert.deepEqual(compact, { ...visibleTable, ...fixture.fields },
      `${fixture.label}: compact table output lost or invented the incompleteness observation.`);
    assert.deepEqual(result.structuredContent, expected,
      `${fixture.label}: canonical table output lost statistics or typed row details.`);
    assert.deepEqual(calls.slice(start), [{ operation: "read_table", args: { hwnd: 77 } }],
      `${fixture.label}: visible table projection changed the API operation or repeated its read.`);
  }

  forcedResult = {
    ok: true,
    clicked: "Weiter",
    pattern: "invoke",
    syntheticAdditionalField: {
      detail: "Nur im vollstaendigen API-Ergebnis",
      localPath: "C:\\Privat\\synthetisch.json",
    },
    focusTelemetry: {
      acquisitions: 2,
      raises: 1,
      topmostCycles: 1,
      releases: 1,
      foregroundHeldMs: 640,
      foregroundRestored: true,
      cursorRestored: true,
      releasedByEmit: false,
    },
  };
  const focusedClick = await client.callTool({ name: "sse_click", arguments: { name: "Weiter" } });
  const focusedClickText = focusedClick.content
    .filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n");
  assert.notEqual(focusedClick.isError, true);
  assert(focusedClickText.includes('"focusTelemetry"'), "Geformte MCP-Antwort verlor Focus-Telemetrie.");
  assert(focusedClickText.includes('"raises": 1') && focusedClickText.includes('"foregroundRestored": true'));
  assert(!focusedClickText.includes("syntheticAdditionalField"),
    "Die bestehende kompakte Textprojektion einer geformten Operation muss stabil bleiben.");
  assert.equal(focusedClick.structuredContent?.syntheticAdditionalField?.detail,
    "Nur im vollstaendigen API-Ergebnis");
  assert.equal(focusedClick.structuredContent?.syntheticAdditionalField?.localPath,
    "[Lokaler PC-Pfad von der MCP-Ausgabe entfernt.]");
  assert.equal(focusedClick.structuredContent?.focusTelemetry?.raises, 1);

  let optionVariants = 0;
  let boundaryVariants = 0;
  let strictRejections = controlStrictRejections;
  let typeRejections = 0;
  for (const tool of operationTools) {
    const baseArgs = sampleJsonSchema(tool.inputSchema, tool.name);
    const beforeUnknown = calls.length;
    const unknown = await client.callTool(
      { name: tool.name, arguments: { ...baseArgs, nichtImVertrag: true } },
      undefined,
      { timeout: 10_000, maxTotalTimeout: 10_000 },
    );
    assert.equal(unknown.isError, true, `${tool.name} akzeptiert ein unbekanntes Argument.`);
    assert.equal(calls.length, beforeUnknown, `${tool.name} leitete ein unbekanntes Argument an die API weiter.`);
    strictRejections += 1;

    for (const [property, propertySchema] of Object.entries(tool.inputSchema?.properties ?? {})) {
      const choices = enumChoices(propertySchema);
      if (choices.length >= 2) {
        for (const choice of choices) {
          const beforeVariant = calls.length;
          const variantArgs = sampleEnumVariant(tool.name, baseArgs, property, choice);
          if (tool.name === "sse_click" && property === "pattern" && choice === "select") {
            variantArgs.aid = ".Synthetic.Radio";
          }
          const variant = await client.callTool(
            { name: tool.name, arguments: variantArgs },
            undefined,
            { timeout: 10_000, maxTotalTimeout: 10_000 },
          );
          assert.notEqual(variant.isError, true, `${tool.name}.${property} transportiert '${choice}' nicht.`);
          assert.equal(calls.length, beforeVariant + 1);
          assert.equal(calls.at(-1).operation, SSE_MCP_TOOL_OPERATIONS[tool.name]);
          assert.equal(calls.at(-1).args[property], choice);
          optionVariants += 1;
        }

        const beforeInvalid = calls.length;
        const invalid = await client.callTool(
          { name: tool.name, arguments: { ...baseArgs, [property]: "__ungueltige_option__" } },
          undefined,
          { timeout: 10_000, maxTotalTimeout: 10_000 },
        );
        assert.equal(invalid.isError, true, `${tool.name}.${property} akzeptiert einen unbekannten Enumwert.`);
        assert.equal(calls.length, beforeInvalid, `${tool.name}.${property} leitete einen unbekannten Enumwert weiter.`);
        strictRejections += 1;
      }

      for (const value of validBoundaryValues(propertySchema)) {
        const beforeBoundary = calls.length;
        const boundary = await client.callTool(
          { name: tool.name, arguments: { ...baseArgs, [property]: value } },
          undefined,
          { timeout: 10_000, maxTotalTimeout: 10_000 },
        );
        assert.notEqual(boundary.isError, true, `${tool.name}.${property} lehnt gueltige Grenze '${value}' ab.`);
        assert.equal(calls.length, beforeBoundary + 1);
        assert.equal(calls.at(-1).args[property], value);
        boundaryVariants += 1;
      }

      const wrongType = invalidTypeValue(propertySchema);
      if (wrongType !== undefined) {
        const beforeWrongType = calls.length;
        const invalid = await client.callTool(
          { name: tool.name, arguments: { ...baseArgs, [property]: wrongType } },
          undefined,
          { timeout: 10_000, maxTotalTimeout: 10_000 },
        );
        assert.equal(invalid.isError, true, `${tool.name}.${property} akzeptiert einen falschen Typ.`);
        assert.equal(calls.length, beforeWrongType, `${tool.name}.${property} leitete einen falschen Typ weiter.`);
        typeRejections += 1;
      }
    }
  }
  assert(optionVariants >= 100, `Zu wenige Optionsvarianten dynamisch geprueft: ${optionVariants}`);
  assert(boundaryVariants >= 100, `Zu wenige boolesche/numerische Grenzwerte geprueft: ${boundaryVariants}`);
  assert(typeRejections >= 300, `Zu wenige falsche Argumenttypen geprueft: ${typeRejections}`);
  assert(strictRejections >= catalog.tools.length, "Nicht jedes Tool wurde auf strikte Argumente geprueft.");

  forcedResult = {
    ok: false,
    kind: "manual-input-disabled",
    error: "Manuelle Erfassung ist nicht aktiv.",
    effects: { taxDataChanged: false, savePerformed: false, submissionPerformed: false },
    localDiagnosticPath: "C:\\Privat\\fall.Gew2025",
  };
  const structuredError = await client.callTool({
    name: "sse_ustva_change_value",
    arguments: {
      field: "input_tax_adjustment",
      expectedBefore: "0,00",
      value: "1,00",
      expectedAfter: "1,00",
      expectedCaseRef: "cases:fixture.Gew2025",
      expectedCaseHash: "0".repeat(64),
    },
  });
  const structuredErrorText = structuredError.content
    .filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n");
  assert.equal(structuredError.isError, true);
  assert(structuredErrorText.includes('"kind": "manual-input-disabled"'));
  assert(structuredErrorText.includes('"submissionPerformed": false'));
  assert(!structuredErrorText.includes("Privat") && structuredErrorText.includes("Lokaler PC-Pfad"));

  for (const [name, args] of [
    ["sse_warning_popup_read", {}],
    ["sse_checker_open", { name: "Synthetischer Hinweis" }],
    ["sse_screenshot", { resultRef: "results:spezialfehler.png" }],
  ]) {
    forcedResult = {
      ok: false,
      kind: "synthetic-special-error",
      error: "Strukturierter Spezialfehler",
      recovery: { stateReadRequired: true },
    };
    const specialError = await client.callTool({ name, arguments: args });
    const specialErrorText = specialError.content
      .filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n");
    assert.equal(specialError.isError, true, `${name} muss strukturierte API-Fehler als MCP-Fehler markieren`);
    assert(specialErrorText.includes('"kind": "synthetic-special-error"'), `${name} verlor den Fehlercode`);
    assert(specialErrorText.includes('"stateReadRequired": true'), `${name} verlor Recovery-Felder`);
  }

  forcedResult = { ok: false, kind: "worker-isolation-lost", error: "Prozessende nicht nachgewiesen." };
  const isolationLost = await client.callTool({ name: "sse_health", arguments: {} });
  const isolationLostText = isolationLost.content
    .filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n");
  assert.equal(isolationLost.isError, true);
  assert(isolationLostText.includes('"kind": "worker-isolation-lost"'));
  assert(isolationLostText.includes("API-Prozess neu starten") && isolationLostText.includes("nicht blind wiederholen"));

  forcedResult = { ok: true, shot: { path: "results:kaputt.png", w: "100", h: 50 } };
  const malformedScreenshot = await client.callTool({
    name: "sse_screenshot",
    arguments: { resultRef: "results:kaputt.png" },
  });
  const malformedScreenshotText = malformedScreenshot.content
    .filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n");
  assert.equal(malformedScreenshot.isError, true);
  assert(malformedScreenshotText.includes('"kind": "protocol"'));

  forcedResult = {
    ok: true,
    shot: { path: "results:kein-png.png", w: 100, h: 50 },
    imageBase64: Buffer.from("kein-png", "utf8").toString("base64"),
  };
  const invalidScreenshotImage = await client.callTool({
    name: "sse_screenshot",
    arguments: { resultRef: "results:kein-png.png", includeImage: true },
  });
  const invalidScreenshotText = invalidScreenshotImage.content
    .filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n");
  assert.notEqual(invalidScreenshotImage.isError, true, "Ungueltiger optionaler Bildinhalt darf den Screenshot-Ref nicht verlieren");
  assert(invalidScreenshotText.includes('"imageAttached": false'));
  assert.match(invalidScreenshotText, /PNG-Signatur/);
  assert.equal(invalidScreenshotImage.content.some((entry) => entry.type === "image"), false);

  forcedResult = { ok: false, kind: "blocked", error: "Versand ist gesperrt." };
  const blockedClick = await client.callTool({
    name: "sse_click",
    arguments: { name: "ELSTER", pattern: "invoke" },
  });
  const blockedClickText = blockedClick.content
    .filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n");
  assert.equal(blockedClick.isError, true);
  assert(blockedClickText.includes('"kind": "blocked"'));
  assert(blockedClickText.includes('"hint"') && blockedClickText.includes("uebermittelt nichts"));

  forcedResult = {
    ok: true,
    kopf: ["Bezeichnung"],
    zeilen: [["gleich"], ["gleich"]],
    anzahl: 2,
    vollstaendig: false,
    schritte: 7,
    steps: 7,
    stopKind: "max-rows",
    limitReached: true,
    tabelleAnzahl: 1,
  };
  const partialTable = await client.callTool({
    name: "sse_table_read",
    arguments: { maxRows: 7 },
  });
  const partialTableText = partialTable.content
    .filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n");
  assert.notEqual(partialTable.isError, true);
  const partialTablePayload = JSON.parse(partialTableText);
  assert.equal(partialTablePayload.vollstaendig, false);
  assert.equal(partialTablePayload.schritte, 7);
  assert.equal(partialTablePayload.steps, 7);
  assert.equal(partialTablePayload.stopKind, "max-rows");
  assert.equal(partialTablePayload.limitReached, true);
  assert.deepEqual(partialTablePayload.zeilen, [["gleich"], ["gleich"]],
    "Der MCP-Wrapper darf legitime identische Tabellenzeilen nicht verlieren.");

  forcedResult = {
    ok: true,
    vollstaendig: true,
    stopKind: "end-of-branch",
    stopReason: "Ende erreicht.",
    anzahl: 1,
    ueberschriften: ["Erfasste Seite"],
    currentHeadingAfter: "Erfasste Seite",
    advancedAfterLastCaptured: false,
  };
  const completedCollection = await client.callTool({
    name: "sse_collect",
    arguments: { maxPages: 1 },
  });
  const completedCollectionText = completedCollection.content
    .filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n");
  assert.notEqual(completedCollection.isError, true);
  const completedCollectionPayload = JSON.parse(completedCollectionText);
  assert.equal(completedCollectionPayload.currentHeadingAfter, "Erfasste Seite");
  assert.equal(completedCollectionPayload.advancedAfterLastCaptured, false);

  const readText = toolTexts.get("sse_workspace_read_text") ?? "";
  assert(readText.includes("Dokumentation https://example.invalid/home/hilfe"), "URL und Nutztext muessen erhalten bleiben");
  assert(readText.includes("danach lesbar"), "Text nach einem lokalen Pfad muss erhalten bleiben");
  assert(readText.includes("Lokaler PC-Pfad"), "nur der lokale Pfad muss sichtbar redigiert werden");
  assert(readText.includes('"textRedigiert": true'), "redigierter Dateiinhalt muss explizit markiert sein");
  assert(!readText.includes("NichtKonfiguriert") && !readText.includes("server\\freigabe"),
    "auch nicht konfigurierte Laufwerks-/UNC-Pfade duerfen MCP nicht erreichen");
  assert(readText.includes("lokalerPfadEntfernt") && readText.includes("eins") &&
    readText.includes("zwei") && readText.includes("drei"),
    "Pfadschluessel muessen ohne Datenverlust eindeutig redigiert werden");
  assert(readText.includes("bestehender-nutzschluessel"),
    "Vorhandene Nutzschluessel duerfen nicht mit generierten Redaktionsschluesseln kollidieren");

  const centerText = toolTexts.get("sse_center_cases") ?? "";
  assert(centerText.includes('"verzeichnisRef": null') && centerText.includes('"verzeichnisImFallbereich": false'),
    "Center ausserhalb des Fallbereichs braucht einen expliziten fail-closed Hinweis");
  assert(!centerText.includes("FremdeFaelle"));

  forcedResult = {
    ok: true,
    modus: "Zuletzt verwendet",
    verzeichnis: null,
    dateisystemVerglichen: false,
    faelle: [{ name: "Synthetischer Fall" }],
    dateisystemFaelle: [],
    nurImCenter: [],
    nurImDateisystem: [],
  };
  const recentCenter = await client.callTool({ name: "sse_center_cases", arguments: {} });
  const recentCenterText = recentCenter.content
    .filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n");
  assert.notEqual(recentCenter.isError, true);
  assert(recentCenterText.includes('"dateisystemVerglichen": false') &&
    recentCenterText.includes('"verzeichnisImFallbereich": null') &&
    recentCenterText.includes("nicht an einen einzelnen Fallordner gebunden"),
  "Center-MCP muss den fehlenden Ordnervergleich im Modus 'Zuletzt verwendet' ausdruecklich melden");

  const windowsText = toolTexts.get("sse_windows") ?? "";
  assert(windowsText.includes("f".repeat(64)), "Titel-Fingerprint muss PC-blind erhalten bleiben");
  const beforeWindowRoundtrip = calls.length;
  const closedByFingerprint = await client.callTool(
    { name: "sse_window_close", arguments: { pid: 88, hwnd: 77, titleFingerprint: "f".repeat(64) } },
    undefined,
    { timeout: 10_000, maxTotalTimeout: 10_000 },
  );
  assert.notEqual(closedByFingerprint.isError, true);
  assert.equal(calls.length, beforeWindowRoundtrip + 1);
  assert.deepEqual(calls.at(-1).args, { pid: 88, hwnd: 77, titleFingerprint: "f".repeat(64) });
  const beforeWindowRestore = calls.length;
  const restoredByFingerprint = await client.callTool(
    { name: "sse_window_restore", arguments: { pid: 88, hwnd: 77, titleFingerprint: "f".repeat(64) } },
    undefined,
    { timeout: 10_000, maxTotalTimeout: 10_000 },
  );
  assert.notEqual(restoredByFingerprint.isError, true);
  assert.equal(calls.length, beforeWindowRestore + 1);
  assert.deepEqual(calls.at(-1), {
    operation: "window_restore",
    args: { pid: 88, hwnd: 77, titleFingerprint: "f".repeat(64) },
  });

  const beforeRedactedWrite = calls.length;
  const redactedWrite = await client.callTool(
    {
      name: "sse_workspace_write_text",
      arguments: { ref: "workspace:fixture.txt", text: "[Lokaler PC-Pfad von der MCP-Ausgabe entfernt.]" },
    },
    undefined,
    { timeout: 10_000, maxTotalTimeout: 10_000 },
  );
  assert.equal(redactedWrite.isError, true, "Redaktionsplatzhalter darf nicht auf Platte geschrieben werden");
  assert.equal(calls.length, beforeRedactedWrite, "gesperrter Redaktions-Roundtrip darf die API nicht erreichen");

  const beforeInvalid = calls.length;
  const invalidLaunch = await client.callTool(
    { name: "sse_launch", arguments: { exe: "C:\\Other\\SSE.exe" } },
    undefined,
    { timeout: 10_000, maxTotalTimeout: 10_000 },
  );
  assert.equal(invalidLaunch.isError, true, "MCP muss das lokale exe-Feld am Schemrand ablehnen");
  assert.equal(calls.length, beforeInvalid, "ungueltige MCP-Argumente duerfen die API nicht erreichen");
  const oversizedFind = await client.callTool(
    { name: "sse_find", arguments: { name: "x".repeat(MAX_API_ARGUMENT_STRING_BYTES + 1) } },
    undefined,
    { timeout: 10_000, maxTotalTimeout: 10_000 },
  );
  assert.equal(oversizedFind.isError, true, "MCP muss uebergrosse UI-Texte vor HTTP ablehnen");
  assert.equal(calls.length, beforeInvalid, "uebergrosse MCP-Argumente duerfen die API nicht erreichen");
  for (const [name, argumentsValue] of [
    ["sse_find", {}],
    ["sse_click", { pattern: "invoke" }],
    ["sse_combo_select", {
      expectedPage: "Seite", expectedCurrent: "A", value: "B", expectedAfter: "B",
    }],
  ]) {
    const semanticInvalid = await client.callTool({ name, arguments: argumentsValue });
    assert.equal(semanticInvalid.isError, true, `${name} muss einen fehlenden Selektor lokal ablehnen`);
    assert.equal(calls.length, beforeInvalid, `${name} darf semantisch ungueltig keinen HTTP-Aufruf ausloesen`);
    strictRejections += 1;
  }
  for (const [index, operation] of ["workspace_status", "product_info", "health"].entries()) {
    const beforePreflightError = calls.length;
    forcedOperationResults = { [operation]: {
      ok: false, kind: "busy", error: "Synthetic session guard", reason: "session-controller-busy", waited: false,
      retryable: true, mutationStarted: false, resultingState: "unchanged", cleanupRequired: false,
      physicalInputUsed: false, foregroundLeaseUsed: false,
    } };
    const preflightError = await client.callTool({ name: "sse_preflight", arguments: {} });
    forcedOperationResults = {};
    assert.equal(preflightError.isError, true, `${operation}: MCP muss den Fehler durchreichen`);
    assert.equal(preflightError.structuredContent.ok, false);
    assert.equal(preflightError.structuredContent.kind, "busy");
    assert.equal(preflightError.structuredContent.reason, "session-controller-busy");
    assert.equal(preflightError.structuredContent.waited, false);
    assert.equal(preflightError.structuredContent.mutationStarted, false);
    assert.equal(preflightError.structuredContent.physicalInputUsed, false);
    assert.equal(preflightError.structuredContent.ready, undefined,
      "Eine abgebrochene Pruefung darf keine erfundene Bereitschaft liefern.");
    assert.match(preflightError.structuredContent.hint, /keine parallelen Retries/u);
    assert.deepEqual(calls.slice(beforePreflightError).map((call) => call.operation),
      ["workspace_status", "product_info", "health"].slice(0, index + 1),
      "Preflight darf nach der fehlgeschlagenen Basisoperation nicht weiterlaufen.");
  }
  forceTransportReset = true;
  const transportReset = await client.callTool(
    { name: "sse_health", arguments: {} },
    undefined,
    { timeout: 10_000, maxTotalTimeout: 10_000 },
  );
  const preflightTransportReset = await client.callTool({ name: "sse_preflight", arguments: {} });
  forceTransportReset = false;
  assert.equal(preflightTransportReset.isError, true);
  assert.equal(preflightTransportReset.structuredContent.kind, "transport-unknown",
    "Auch ein abgefangener Transportfehler muss durch den echten SDK-Client strukturiert lesbar bleiben.");
  const transportResetText = transportReset.content
    .filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n");
  assert.equal(transportReset.isError, true);
  assert.equal(transportReset.structuredContent?.kind, "transport-unknown",
    "MCP muss einen Operations-Reset als zustandsunklar klassifizieren");
  assert(
    transportResetText.includes('"kind": "transport-unknown"') &&
      /Zustand ist unbekannt/u.test(transportResetText),
    "MCP-Text muss die strukturierte Unknown-State-Warnung behalten",
  );
  process.stdout.write(
    `MCP-Katalog-Smoke: ${catalog.tools.length} Werkzeuge, ${catalogBytes} Bytes/${catalogReadyMs} ms, ` +
    `${optionVariants} Optionsvarianten, ` +
    `${boundaryVariants} Grenzwerte, ${strictRejections + typeRejections + 1} Ablehnungen, ` +
    `${calls.length} API-Roundtrips\n`,
  );
} finally {
  await client.close();
  await new Promise((resolve) => api.close(resolve));
}
