import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MAX_API_ARGUMENT_STRING_BYTES, SSE_MCP_TOOL_OPERATIONS } from "../dist/operation-catalog.js";
import { operationAnnotations } from "../dist/operation-traits.js";
import {
  enumChoices,
  invalidTypeValue,
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
const expectedToolCount = Object.keys(SSE_MCP_TOOL_OPERATIONS).length;

const token = "all-tools-wrapper-token-with-at-least-24-characters";
const calls = [];
let forcedResult;
let forceNetworkError = false;
const api = createServer(async (request, response) => {
  if (forceNetworkError) {
    request.socket.destroy();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const authorization = request.headers.authorization;
  if (authorization !== `Bearer ${token}`) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: "unauthorized", message: "unauthorized" } }));
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
    product: { supported: true, taxYear: 2025, fileMajor: 31 },
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
  const result = forcedResult ?? defaultResult;
  forcedResult = undefined;
  const envelope = { apiVersion: "v1", requestId: randomUUID(), operation, durationMs: 0, result };
  const json = JSON.stringify(envelope);
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
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, "..", "dist", "index.js")],
  env: {
    ...process.env,
    SSE_API_URL: `http://127.0.0.1:${address.port}`,
    SSE_API_TOKEN: token,
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
  const catalogTitles = new Set(catalog.tools.map((tool) => tool.title));
  assert.equal(catalogTitles.size, catalog.tools.length, "MCP-Werkzeugtitel muessen eindeutig sein.");
  for (const tool of catalog.tools) {
    assert(tool.title?.trim(), `${tool.name} braucht einen sichtbaren Titel.`);
    assert(tool.description?.trim(), `${tool.name} braucht eine Agentenbeschreibung.`);
    assertPropertyDescriptions(tool.inputSchema, tool.name);
    const references = `${tool.title}\n${tool.description}`.match(/\bsse_[a-z0-9_]+\b/g) ?? [];
    for (const reference of references) {
      assert(catalogToolNames.has(reference), `${tool.name} verweist auf das unbekannte MCP-Werkzeug ${reference}.`);
    }
  }
  const launchDescription = catalog.tools.find((tool) => tool.name === "sse_launch")?.description ?? "";
  assert.match(launchDescription, /sse_dialog_list/);
  assert.match(launchDescription, /sse_dialog_answer/);
  assert(!/sse_click\s+'(?:Ja|Nein)'/.test(launchDescription), "Startdialog darf keinen generischen Klick empfehlen.");
  for (const tool of catalog.tools) {
    assert.deepEqual(
      tool.annotations,
      operationAnnotations(SSE_MCP_TOOL_OPERATIONS[tool.name]),
      `${tool.name} hat driftende MCP-Sicherheitshinweise.`,
    );
  }
  const pathBearingTools = new Set([
    "sse_case_hash", "sse_center_refresh", "sse_window_close", "sse_vast_apply", "sse_desktop_start",
    "sse_export_csv", "sse_collect", "sse_verify",
    "sse_screenshot", "sse_launch", "sse_save", "sse_file_dialog_select", "sse_save_as",
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
  for (const tool of catalog.tools) {
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
  assert.equal(calls.length, expectedToolCount, `Erwartet wurde genau ein API-Aufruf je MCP-Werkzeug, erhalten: ${calls.length}`);

  forcedResult = {
    ok: true,
    clicked: "Weiter",
    pattern: "invoke",
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

  let optionVariants = 0;
  let boundaryVariants = 0;
  let strictRejections = 0;
  let typeRejections = 0;
  for (const tool of catalog.tools) {
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
          const variantArgs = { ...baseArgs, [property]: choice };
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
  forceNetworkError = true;
  const networkError = await client.callTool(
    { name: "sse_health", arguments: {} },
    undefined,
    { timeout: 10_000, maxTotalTimeout: 10_000 },
  );
  forceNetworkError = false;
  const networkErrorText = networkError.content
    .filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n");
  assert.equal(networkError.isError, true);
  assert(networkErrorText.includes('"kind": "network"'), "MCP muss Client-/Transportfehler strukturiert klassifizieren");
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
