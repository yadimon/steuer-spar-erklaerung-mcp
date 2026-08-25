import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SSE_API_OPERATIONS } from "../dist/api-contract.js";
import { createApiExecutor } from "../dist/api-executor.js";
import {
  SSE_API_OPERATION_SCHEMAS,
  SSE_MCP_TOOL_OPERATIONS,
  SSE_MCP_TOOL_SCHEMAS,
  assertApiArgumentBudget,
  formatOperationArgumentError,
  MAX_API_ARGUMENT_COLLECTION_ITEMS,
  MAX_API_ARGUMENT_STRING_BYTES,
  parseApiOperationArgs,
  parseCheckerReadOnlyClickArgs,
} from "../dist/operation-catalog.js";

assert.equal(Object.keys(SSE_MCP_TOOL_SCHEMAS).length, SSE_API_OPERATIONS.length);
assert.equal(Object.keys(SSE_MCP_TOOL_OPERATIONS).length, SSE_API_OPERATIONS.length);
assert.deepEqual(Object.keys(SSE_API_OPERATION_SCHEMAS).sort(), [...SSE_API_OPERATIONS].sort());

const hasUnknownKeyIssue = (issues) => issues.some((issue) =>
  issue.code === "unrecognized_keys" ||
  (issue.code === "invalid_union" && issue.unionErrors.some((entry) => hasUnknownKeyIssue(entry.issues))));
for (const [operation, schema] of Object.entries(SSE_API_OPERATION_SCHEMAS)) {
  const result = schema.safeParse({ __unknown: true });
  assert.equal(result.success, false, `${operation} darf unbekannte API-Argumente nicht akzeptieren`);
  assert(hasUnknownKeyIssue(result.error.issues), `${operation} muss unbekannte API-Argumente explizit erkennen`);
}

assert.throws(() => SSE_MCP_TOOL_SCHEMAS.sse_health.parse({ unexpected: true }), /Unrecognized key/);
assert.throws(() => parseApiOperationArgs("health", { unexpected: true }), /Unrecognized key/);
assert.deepEqual(parseApiOperationArgs("checker_detail", { name: "Hinweis" }), { name: "Hinweis" });
assert.throws(() => parseApiOperationArgs("checker_detail", { name: "" }));
assert.throws(() => parseApiOperationArgs("click", {}), /Bezeichner/);
assert.throws(() => parseApiOperationArgs("find", {}), /name, aid, type/);
assert.deepEqual(parseApiOperationArgs("find", { type: "Button" }), { type: "Button" });
assert.throws(() => parseApiOperationArgs("find", { type: "Button", contains: true }), /nur zusammen mit 'name'/);
for (const [operation, args] of [
  ["get_value", {}],
  ["combo_options", {}],
  ["toggle", { expectedPage: "Seite", expectedBefore: false, value: true, expectedAfter: true }],
  ["combo_select", { expectedPage: "Seite", expectedCurrent: "A", value: "B", expectedAfter: "B" }],
]) {
  assert.throws(() => parseApiOperationArgs(operation, args), /Bezeichner/);
}
assert.throws(() => parseApiOperationArgs("click", { name: "Prüfer", pattern: "toggle" }), /sse_toggle/);
assert.throws(() => SSE_MCP_TOOL_SCHEMAS.sse_click.parse({ name: "Prüfer", pattern: "toggle" }));
assert.throws(() => parseApiOperationArgs("click", { name: "Ja", pattern: "select" }), /AutomationId/);
assert.deepEqual(
  parseApiOperationArgs("click", { aid: ".Radio", pattern: "select" }),
  { aid: ".Radio", pattern: "select" },
);
assert.throws(() => parseApiOperationArgs("click_point", {}), /Bezeichner/);
assert.deepEqual(
  parseApiOperationArgs("click_point", {
    name: "Prüfen und Abgeben",
    type: "TreeItem",
    expectedPageBefore: "Vorbereitung der Steuererklärung für das Jahr 2024",
    expectedPageAfter: "Prüfen und Abgeben",
  }),
  {
    name: "Prüfen und Abgeben",
    type: "TreeItem",
    expectedPageBefore: "Vorbereitung der Steuererklärung für das Jahr 2024",
    expectedPageAfter: "Prüfen und Abgeben",
  },
);
for (const hwnd of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => parseApiOperationArgs("page", { hwnd }), undefined, `Ungueltiges hwnd akzeptiert: ${hwnd}`);
}
for (const pid of [0, -1, 1.5, 2_147_483_648]) {
  assert.throws(() => parseApiOperationArgs("dialog_list", { pid }), undefined, `Ungueltige pid akzeptiert: ${pid}`);
}
for (const [operation, args] of [
  ["goto", { name: "Einnahmen", maxSteps: 201 }],
  ["table_read", { maxRows: 1_001 }],
  ["snapshot", { maxNodes: 5_001 }],
  ["menu_click", { name: "Extras", waitMs: 10_001 }],
  ["click", { name: "Weiter", waitMs: 10_001 }],
  ["click_point", { name: "Prüfer", waitMs: 10_001 }],
  ["tree_top", { steps: 1.5 }],
  ["read_page", { minX: 500, maxX: 499 }],
]) {
  assert.throws(
    () => parseApiOperationArgs(operation, args),
    undefined,
    `${operation} muss eine ressourcenintensive oder widerspruechliche Zahl ablehnen`,
  );
}
assert.throws(() => parseApiOperationArgs("snapshot", {
  types: Array.from({ length: 51 }, (_, index) => `Type-${index}`),
}));
assert.throws(() => parseApiOperationArgs("table_add", {
  expectedPage: "Seite",
  werte: Array.from({ length: 101 }, () => "x"),
  sumLabel: "Summe",
  expectedBefore: "0,00",
  expectedAfter: "1,00",
}));
assert.throws(() => parseApiOperationArgs("verify", {
  sourceRef: "results:stand.json",
  expectedSourceHash: "0".repeat(64),
  erwartungen: Array.from({ length: 501 }, () => ({ seite: "Seite", label: "Feld", wert: "1" })),
}));
assert.throws(() => parseApiOperationArgs("vast_apply", {
  hwnd: 1,
  expectedMainHwnd: 2,
  expectedCaseRef: "cases:fall.Gew2025",
  expectedCaseHash: "0".repeat(64),
  mappingFingerprint: "1".repeat(64),
  plan: Array.from({ length: 501 }, () => ({ certificate: "Beleg", occurrence: 1, localTarget: "Ziel" })),
  acknowledgeApply: true,
}));
assert.throws(() => parseApiOperationArgs("vast_row_details", {
  mappingFingerprint: "0".repeat(64), certificate: "Beleg", occurrence: 1_001,
}));
assert.throws(
  () => parseApiOperationArgs("find", { name: "x".repeat(MAX_API_ARGUMENT_STRING_BYTES + 1) }),
  /groesser.*UTF-8-Bytes/,
);
assert.throws(
  () => assertApiArgumentBudget("health", {
    liste: Array.from({ length: MAX_API_ARGUMENT_COLLECTION_ITEMS + 1 }, () => null),
  }),
  /hoechstens 2000/,
);
assert.equal(
  parseApiOperationArgs("workspace_file_write_text", {
    ref: "workspace:gross.txt",
    text: "x".repeat(MAX_API_ARGUMENT_STRING_BYTES + 1),
  }).text.length,
  MAX_API_ARGUMENT_STRING_BYTES + 1,
  "Workspace-Text besitzt absichtlich das groessere 1-MiB-Limit",
);

const gotoByMcpNames = parseApiOperationArgs("goto", { name: "Einnahmen", useSearch: false });
assert.deepEqual(gotoByMcpNames, { ziel: "Einnahmen", viaSuche: false });
assert.deepEqual(parseApiOperationArgs("goto", gotoByMcpNames), gotoByMcpNames, "goto-Transform muss idempotent sein");
assert.deepEqual(parseApiOperationArgs("goto", { ziel: "Einnahmen", viaSuche: true }), {
  ziel: "Einnahmen",
  viaSuche: true,
});
assert.throws(() => parseApiOperationArgs("goto", { name: "A", ziel: "B" }));
assert.throws(() => parseApiOperationArgs("goto", { name: "A", useSearch: true, viaSuche: false }));

const trackedBySelector = {
  expectedPage: "Seite", expectedBefore: "", value: "15.07.2026", expectedAfter: "15.07.2026",
  name: "DateVon", valueKind: "date",
};
const trackedByPageObject = {
  pageId: "seite", fieldId: "feld", expectedBefore: "1", value: "2", expectedAfter: "2",
};
assert.deepEqual(parseApiOperationArgs("tracked_set_value", trackedBySelector), trackedBySelector);
assert.deepEqual(parseApiOperationArgs("tracked_set_value", trackedByPageObject), trackedByPageObject);
assert.deepEqual(
  parseApiOperationArgs("tracked_set_value", parseApiOperationArgs("tracked_set_value", trackedByPageObject)),
  trackedByPageObject,
  "tracked_set_value muss bei HTTP-Doppelvalidierung idempotent bleiben",
);
assert.throws(() => parseApiOperationArgs("tracked_set_value", { ...trackedBySelector, pageId: "seite" }));
assert.throws(() => parseApiOperationArgs("tracked_set_value", { ...trackedBySelector, valueKind: "datum" }));
assert.throws(() => parseApiOperationArgs("tracked_set_value", { ...trackedByPageObject, expectedCaseRef: "cases:fall.Gew2025" }));
assert.throws(() => parseApiOperationArgs("tracked_set_value", { ...trackedByPageObject, expectedCaseHash: "0".repeat(64) }));
assert.throws(() => parseApiOperationArgs("combo_select", {
  expectedPage: "Seite", aid: ".Combo", expectedCurrent: "A", value: "B", expectedAfter: "B",
  expectedCaseRef: "cases:fall.Gew2025",
}));
assert.throws(() => parseApiOperationArgs("toggle", {
  expectedPage: "Seite", aid: ".Flag", expectedBefore: false, value: true, expectedAfter: true,
  expectedCaseHash: "0".repeat(64),
}));
assert.throws(() => parseApiOperationArgs("save", { caseRef: "cases:fall.Gew2025", expectedHashBefore: "" }));
assert.throws(() => parseApiOperationArgs("dialog_answer", { hwnd: 42, fingerprint: "kurz", button: "OK" }));
assert.deepEqual(parseApiOperationArgs("dialog_answer", {
  hwnd: 42, fingerprint: "a".repeat(64), button: "OK",
}), { hwnd: 42, fingerprint: "a".repeat(64), button: "OK" });

assert.throws(() => parseApiOperationArgs("click_point", { name: "Hinweis", checkerReadOnly: true }));
assert.deepEqual(parseCheckerReadOnlyClickArgs({ name: "Hinweis", checkerReadOnly: true }), {
  name: "Hinweis", checkerReadOnly: true,
});
assert.deepEqual(parseApiOperationArgs("center_refresh", { hwnd: 42, expectedDirectoryRef: "cases:." }), {
  hwnd: 42, expectedDirectoryRef: "cases:.",
});
assert.deepEqual(parseApiOperationArgs("center_refresh", { hwnd: 42, expectedMode: "Zuletzt verwendet" }), {
  hwnd: 42, expectedMode: "Zuletzt verwendet",
});
assert.deepEqual(SSE_MCP_TOOL_SCHEMAS.sse_center_refresh.parse({
  hwnd: 42, expectedMode: "Zuletzt verwendet",
}), { hwnd: 42, expectedMode: "Zuletzt verwendet" });
assert.throws(() => parseApiOperationArgs("center_refresh", { hwnd: 42 }));
assert.throws(() => parseApiOperationArgs("center_refresh", {
  hwnd: 42, expectedDirectoryRef: "cases:.", expectedMode: "Zuletzt verwendet",
}));
assert.throws(() => SSE_MCP_TOOL_SCHEMAS.sse_center_refresh.parse({
  hwnd: 42, expectedMode: "Verzeichnis",
}));
assert.deepEqual(parseApiOperationArgs("window_close", { pid: 7, hwnd: 42, titleFingerprint: "0".repeat(64) }), {
  pid: 7, hwnd: 42, titleFingerprint: "0".repeat(64),
});
assert.throws(() => parseApiOperationArgs("window_close", {
  pid: 7, hwnd: 42, titleFingerprint: "0".repeat(64), expectedTitle: "Werte-Info",
}));
assert.throws(() => parseApiOperationArgs("window_close", { hwnd: 42, titleFingerprint: "0".repeat(64) }));
assert.deepEqual(parseApiOperationArgs("window_restore", {
  pid: 7, hwnd: 42, titleFingerprint: "A".repeat(64), waitMs: 300,
}), { pid: 7, hwnd: 42, titleFingerprint: "A".repeat(64), waitMs: 300 });
assert.throws(() => parseApiOperationArgs("window_restore", { pid: 7, hwnd: 42 }));
assert.throws(() => parseApiOperationArgs("window_restore", {
  pid: 7, hwnd: 42, titleFingerprint: "kurz",
}));

try {
  parseApiOperationArgs("launch", { caseRef: "cases:fall.Gew2025", file: "C:\\Faelle\\fall.Gew2025" });
  assert.fail("Doppelte launch-Fallbindung muss scheitern");
} catch (error) {
  assert.match(formatOperationArgumentError(error), /caseRef.*file.*nicht gemeinsam/);
}

// Ein falsch geratener Feldname ist der haeufigste Aufruferfehler. Ohne die
// erlaubten Namen kostet er eine zusaetzliche Runde ueber describe.
try {
  parseApiOperationArgs("close", { discardUnsaved: true });
  assert.fail("Unbekanntes close-Argument muss scheitern");
} catch (error) {
  const ohneOperation = formatOperationArgumentError(error);
  assert.match(ohneOperation, /discardUnsaved/);
  assert.equal(ohneOperation.includes("Erlaubt sind"), false,
    "Ohne Operation darf die Meldung keine Feldliste erfinden.");
  const mitOperation = formatOperationArgumentError(error, "close");
  assert.match(mitOperation, /Erlaubt sind: discardChanges, force, hwnd, pid, save$/);
  assert.equal(mitOperation.includes(".."), false, "Kein doppelter Punkt vor der Feldliste.");
}

// Union-Operationen muessen die Namen aller Zweige nennen, sonst fehlt genau
// der Name, den der Aufrufer eigentlich gesucht hat.
try {
  parseApiOperationArgs("tracked_set_value", { unbekannt: 1 });
  assert.fail("Unbekanntes tracked_set_value-Argument muss scheitern");
} catch (error) {
  const meldung = formatOperationArgumentError(error, "tracked_set_value");
  for (const name of ["expectedPage", "pageId", "fieldId", "rid", "trackResults"]) {
    assert.match(meldung, new RegExp(`\\b${name}\\b`), `${name} fehlt in der Feldliste.`);
  }
}

// Ein Wertfehler ohne unbekanntes Feld braucht die Liste nicht.
try {
  parseApiOperationArgs("collect", { maxPages: 99 });
  assert.fail("Zu grosses maxPages muss scheitern");
} catch (error) {
  assert.equal(formatOperationArgumentError(error, "collect").includes("Erlaubt sind"), false);
}

assert.deepEqual(parseApiOperationArgs("case_hash", { ref: "cases:fall.Gew2025" }), {
  ref: "cases:fall.Gew2025",
});
assert.deepEqual(parseApiOperationArgs("case_hash", { path: "C:\\Faelle\\fall.Gew2025" }), {
  path: "C:\\Faelle\\fall.Gew2025",
});
assert.throws(() => parseApiOperationArgs("case_hash", {
  ref: "cases:fall.Gew2025", path: "C:\\Faelle\\fall.Gew2025",
}));
assert.deepEqual(parseApiOperationArgs("save_as", {
  sourceRef: "cases:quelle.Gew2025",
  expectedSourceHash: "a".repeat(64),
  targetPath: "C:\\Faelle\\ziel.Gew2025",
}), {
  sourceRef: "cases:quelle.Gew2025",
  expectedSourceHash: "a".repeat(64),
  targetPath: "C:\\Faelle\\ziel.Gew2025",
});
assert.throws(() => parseApiOperationArgs("save_as", {
  sourceRef: "cases:quelle.Gew2025",
  expectedSourcePath: "C:\\Faelle\\quelle.Gew2025",
  expectedSourceHash: "a".repeat(64),
  targetRef: "cases:ziel.Gew2025",
}));
assert(!Object.hasOwn(SSE_MCP_TOOL_SCHEMAS.sse_save_as.shape, "expectedSourcePath"));
assert(!Object.hasOwn(SSE_MCP_TOOL_SCHEMAS.sse_save_as.shape, "targetPath"));
for (const forbidden of ["allowOverwrite", "expectedTargetHash"]) {
  assert(!Object.hasOwn(SSE_MCP_TOOL_SCHEMAS.sse_save_as.shape, forbidden));
  assert.throws(() => parseApiOperationArgs("save_as", {
    sourceRef: "cases:quelle.Gew2025",
    expectedSourceHash: "a".repeat(64),
    targetRef: "cases:ziel.Gew2025",
    [forbidden]: forbidden === "allowOverwrite" ? true : "b".repeat(64),
  }));
}
assert(!Object.hasOwn(SSE_MCP_TOOL_SCHEMAS.sse_collect.shape, "expectedOutputHashBefore"));
assert.throws(() => parseApiOperationArgs("collect", {
  resultRef: "results:segment.json",
  expectedOutputHashBefore: "b".repeat(64),
}));
assert(!Object.hasOwn(SSE_MCP_TOOL_SCHEMAS.sse_workspace_write_text.shape, "expectedSha256"));
assert(!Object.hasOwn(SSE_MCP_TOOL_SCHEMAS.sse_run_scenario.shape, "expectedResultSha256"));
assert.throws(() => parseApiOperationArgs("workspace_file_write_text", {
  ref: "workspace:neu.txt", text: "neu", expectedSha256: "c".repeat(64),
}));
assert.throws(() => parseApiOperationArgs("scenario_run", {
  scenarioRef: "workspace:szenario.json", expectedResultSha256: "d".repeat(64),
}));
assert(!Object.hasOwn(SSE_MCP_TOOL_SCHEMAS.sse_case_hash.shape, "path"));
assert(!Object.hasOwn(SSE_MCP_TOOL_SCHEMAS.sse_vast_apply.shape, "expectedCasePath"));
assert(!Object.hasOwn(SSE_MCP_TOOL_SCHEMAS.sse_change_field.shape, "expectedCasePath"));
assert.equal(SSE_MCP_TOOL_SCHEMAS.sse_vast_apply.shape.expectedCaseRef.parse("cases:fall.Gew2025"), "cases:fall.Gew2025");
for (const ref of [
  "cases:*.Gew2025",
  "workspace:../privat.txt",
  "workspace:/absolut.txt",
  "workspace:C:/Windows/win.ini",
  "workspace:NUL",
  "workspace:berichte/CON.txt",
  "results:COM1.json",
  "backups:Lpt9/manifest.json",
]) {
  assert.throws(() => SSE_MCP_TOOL_SCHEMAS.sse_workspace_read_text.parse({ ref }), `MCP muss '${ref}' ablehnen`);
}
for (const ref of ["../privat.txt", "/absolut.txt", "C:/Windows/win.ini", "*.json"]) {
  assert.throws(() => parseApiOperationArgs("workspace_file_read_text", { ref }), `API muss '${ref}' ablehnen`);
  assert.throws(() => parseApiOperationArgs("scenario_run", { scenarioRef: ref }), `Szenario muss '${ref}' ablehnen`);
}
assert.deepEqual(parseApiOperationArgs("backup_cases", {
  destinationRef: "backups:sicherung",
  dir: "D:\\SSE-Cases",
}), { destinationRef: "backups:sicherung", dir: "D:\\SSE-Cases" });
assert.deepEqual(parseApiOperationArgs("archive_cases", {
  destinationRef: "backups:archiv",
  dir: "D:\\SSE-Cases",
  cases: [{ name: "alt.Gew2025", expectedSha256: "0".repeat(64) }],
  expectedRemaining: [{ name: "aktuell.Gew2025", expectedSha256: "1".repeat(64) }],
}), {
  destinationRef: "backups:archiv",
  dir: "D:\\SSE-Cases",
  cases: [{ name: "alt.Gew2025", expectedSha256: "0".repeat(64) }],
  expectedRemaining: [{ name: "aktuell.Gew2025", expectedSha256: "1".repeat(64) }],
});

const temporary = mkdtempSync(join(tmpdir(), "sse-schema-catalog-"));
try {
  const workspaceDir = join(temporary, "workspace");
  const resultDir = join(temporary, "results");
  const caseDir = join(temporary, "cases");
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(resultDir, { recursive: true });
  mkdirSync(caseDir, { recursive: true });
  let workerCalls = 0;
  const execute = createApiExecutor({
    host: "127.0.0.1",
    port: 1,
    configPath: join(temporary, "config.json"),
    caseDir,
    workspaceDir,
    resultDir,
  }, async () => {
    workerCalls += 1;
    return { ok: true };
  });

  const invalidDirect = await execute("health", { unexpected: true }, 1_000);
  assert.equal(invalidDirect.ok, false);
  assert.equal(invalidDirect.kind, "bad-args");
  assert.equal(workerCalls, 0);

  writeFileSync(join(workspaceDir, "invalid-step.json"), JSON.stringify({
    schemaVersion: 1,
    name: "invalid-step",
    resultFile: "invalid-step-result.json",
    steps: [{ id: "invalid", operation: "health", args: { unexpected: true } }],
  }));
  const scenario = await execute("scenario_run", { scenarioRef: "invalid-step.json" }, 5_000);
  assert.equal(scenario.ok, false);
  assert.equal(scenario.result.steps[0].kind, "bad-args");
  assert.equal(workerCalls, 0, "ungueltiger Szenarioschritt darf den Worker nicht erreichen");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write(`Operationsschemas: ${SSE_API_OPERATIONS.length} API-Operationen und PC-blinde MCP-Schemas, interne Validierung aktiv\n`);
