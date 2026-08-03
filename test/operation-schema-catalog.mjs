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
  formatOperationArgumentError,
  parseApiOperationArgs,
  parseCheckerReadOnlyClickArgs,
} from "../dist/operation-catalog.js";

assert.equal(Object.keys(SSE_MCP_TOOL_SCHEMAS).length, 80);
assert.equal(Object.keys(SSE_MCP_TOOL_OPERATIONS).length, 80);
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
  expectedPage: "Seite", expectedBefore: "1", value: "2", expectedAfter: "2", name: "Feld",
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
assert.throws(() => parseApiOperationArgs("tracked_set_value", { ...trackedByPageObject, expectedCaseRef: "cases:fall.Gew2025" }));
assert.throws(() => parseApiOperationArgs("tracked_set_value", { ...trackedByPageObject, expectedCaseHash: "0".repeat(64) }));
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
assert.deepEqual(parseApiOperationArgs("window_close", { hwnd: 42, titleFingerprint: "0".repeat(64) }), {
  hwnd: 42, titleFingerprint: "0".repeat(64),
});
assert.throws(() => parseApiOperationArgs("window_close", {
  hwnd: 42, titleFingerprint: "0".repeat(64), expectedTitle: "Werte-Info",
}));

try {
  parseApiOperationArgs("launch", { caseRef: "cases:fall.Gew2025", file: "C:\\Faelle\\fall.Gew2025" });
  assert.fail("Doppelte launch-Fallbindung muss scheitern");
} catch (error) {
  assert.match(formatOperationArgumentError(error), /caseRef.*file.*nicht gemeinsam/);
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
assert(!Object.hasOwn(SSE_MCP_TOOL_SCHEMAS.sse_case_hash.shape, "path"));
assert(!Object.hasOwn(SSE_MCP_TOOL_SCHEMAS.sse_vast_apply.shape, "expectedCasePath"));
assert(!Object.hasOwn(SSE_MCP_TOOL_SCHEMAS.sse_change_field.shape, "expectedCasePath"));
assert.equal(SSE_MCP_TOOL_SCHEMAS.sse_vast_apply.shape.expectedCaseRef.parse("cases:fall.Gew2025"), "cases:fall.Gew2025");
for (const ref of ["cases:*.Gew2025", "workspace:../privat.txt", "workspace:/absolut.txt", "workspace:C:/Windows/win.ini"]) {
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
    token: "schema-catalog-token-with-at-least-24-characters",
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

process.stdout.write("Operationsschemas: 80 API-Operationen, 80 PC-blinde MCP-Schemas, interne Validierung aktiv\n");
