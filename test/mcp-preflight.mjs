import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateMcpPreflight, MCP_PREFLIGHT_OUTPUT_SCHEMA } from "../dist/mcp-preflight.js";
import { SSE_MCP_TOOL_SCHEMAS } from "../dist/operation-catalog.js";

for (const nextTool of MCP_PREFLIGHT_OUTPUT_SCHEMA.shape.nextTool.options) {
  assert(nextTool in SSE_MCP_TOOL_SCHEMAS, `Preflight-nextTool ist nicht registriert: ${nextTool}`);
}

const resultShape = JSON.parse(readFileSync("test/operation-result-shape.json", "utf8"));
for (const [operation, mode, fields] of [
  ["workspace_status", "offline", [
    "profileId", "workspaceReady", "resultAreaReady", "caseDirectoryConfigured",
    "caseDirectoryReady", "documentAreaReady", "backupAreaReady",
  ]],
  ["product_info", "offline", [
    "profileId", "profileStatus", "operationAccess", "product", "taxYear",
    "defaultExecutable", "catalogCompatibility", "buildDrift",
  ]],
  ["health", "live", ["profileId", "taxYear", "running", "buildDrift", "canaryOk", "dialogs"]],
]) {
  const observed = resultShape.operations?.[operation]?.[mode]?.fields ?? {};
  for (const field of fields) {
    assert(field in observed, `Preflight-Feld fehlt in der Ergebnis-Shape: ${operation}.${field}`);
  }
}

const readyWorkspace = {
  ok: true,
  profileId: "2025",
  workspaceReady: true,
  resultAreaReady: true,
  caseDirectoryConfigured: true,
  caseDirectoryReady: true,
  documentAreaReady: true,
  backupAreaReady: true,
};
const readyProduct = {
  ok: true,
  profileId: "2025",
  profileStatus: "supported",
  operationAccess: "full",
  product: "SteuerSparErklaerung 2025",
  taxYear: 2025,
  defaultExecutable: {
    exists: true,
    supported: true,
    path: "C:\\Private\\SteuerSparErklaerung.exe",
  },
  catalogCompatibility: { compatible: true },
  buildDrift: { drifted: false },
};
const readyHealth = {
  ok: true,
  profileId: "2025",
  taxYear: 2025,
  running: true,
  buildDrift: { drifted: false },
  canaryOk: true,
  dialogs: [],
  advice: "gesund",
  title: "Privater Steuerfall",
};

const ready = evaluateMcpPreflight(readyWorkspace, readyProduct, readyHealth);
assert.equal(ready.ready, true);
assert.equal(ready.setupReady, true);
assert.equal(ready.runtimeReady, true);
assert.equal(ready.nextTool, "sse_instances");
assert.deepEqual(ready.blockers, []);
assert.deepEqual(ready.notices, []);
assert.equal(MCP_PREFLIGHT_OUTPUT_SCHEMA.parse(ready).ok, true);
assert(!JSON.stringify(ready).includes("Private"), "Preflight darf keine lokalen Pfade oder Fenstertitel spiegeln.");

const stoppedWithoutCaseDir = evaluateMcpPreflight(
  { ...readyWorkspace, caseDirectoryConfigured: false, caseDirectoryReady: false },
  readyProduct,
  { ...readyHealth, running: false, canaryOk: false },
);
assert.equal(stoppedWithoutCaseDir.setupReady, true);
assert.equal(stoppedWithoutCaseDir.runtimeReady, false);
assert(stoppedWithoutCaseDir.blockers.some((entry) => entry.code === "SSE_NOT_RUNNING"));
assert(stoppedWithoutCaseDir.notices.some((entry) => entry.code === "CASE_DIRECTORY_NOT_CONFIGURED"));
assert(!stoppedWithoutCaseDir.blockers.some((entry) => entry.code === "CASE_DIRECTORY_NOT_READY"));
assert.equal(stoppedWithoutCaseDir.nextTool, "sse_launch");

const allSetupFailures = evaluateMcpPreflight(
  {
    ...readyWorkspace,
    workspaceReady: false,
    caseDirectoryReady: false,
  },
  {
    ...readyProduct,
    profileStatus: "experimental",
    operationAccess: "verification-only",
    defaultExecutable: { exists: false, supported: false },
    catalogCompatibility: { compatible: false },
    buildDrift: { drifted: true },
  },
  readyHealth,
);
assert.equal(allSetupFailures.setupReady, false);
for (const code of [
  "WORKSPACE_NOT_READY",
  "CASE_DIRECTORY_NOT_READY",
  "PRODUCT_PROFILE_UNSUPPORTED",
  "PRODUCT_NOT_INSTALLED",
  "PRODUCT_CATALOG_INCOMPATIBLE",
]) {
  assert(allSetupFailures.blockers.some((entry) => entry.code === code), `Blocker fehlt: ${code}`);
}
assert(!allSetupFailures.blockers.some((entry) => entry.code === "PRODUCT_BUILD_DRIFT"),
  "Eine fehlende Installation darf nicht zusaetzlich als Build-Drift ausgegeben werden.");

const drift = evaluateMcpPreflight(
  readyWorkspace,
  { ...readyProduct, buildDrift: { drifted: true } },
  readyHealth,
);
assert(drift.blockers.some((entry) => entry.code === "PRODUCT_BUILD_DRIFT"));

const dialog = evaluateMcpPreflight(
  readyWorkspace,
  readyProduct,
  { ...readyHealth, dialogs: [{ title: "C:\\Private\\Dialog" }] },
);
assert.equal(dialog.nextTool, "sse_dialog_list");
assert(dialog.blockers.some((entry) => entry.code === "SSE_DIALOG_OPEN"));
assert(!JSON.stringify(dialog).includes("Private"));

const driftWithDialog = evaluateMcpPreflight(
  readyWorkspace,
  readyProduct,
  { ...readyHealth, buildDrift: { drifted: true }, dialogs: [{ title: "Modal" }] },
);
assert.equal(driftWithDialog.nextTool, "sse_dialog_list");
assert(driftWithDialog.blockers.some((entry) => entry.code === "SSE_DIALOG_OPEN"));
assert(driftWithDialog.blockers.some((entry) => entry.code === "SSE_BUILD_DRIFT"));

const unhealthy = evaluateMcpPreflight(
  readyWorkspace,
  readyProduct,
  { ...readyHealth, canaryOk: false },
);
assert(unhealthy.blockers.some((entry) => entry.code === "SSE_UNHEALTHY"));

for (const runtimeBuildDrift of [
  { drifted: true },
  { drifted: "false" },
  undefined,
]) {
  const runtimeDrift = evaluateMcpPreflight(
    readyWorkspace,
    readyProduct,
    { ...readyHealth, buildDrift: runtimeBuildDrift },
  );
  assert.equal(runtimeDrift.ready, false, "Der laufende Build braucht einen exakten Drift-Negativnachweis.");
  assert.equal(runtimeDrift.application.buildCompatible, false);
  assert(runtimeDrift.blockers.some((entry) => entry.code === "SSE_BUILD_DRIFT"));
  assert(!runtimeDrift.blockers.some((entry) => entry.code === "SSE_UNHEALTHY"));
}

for (const malformedProduct of [
  { ...readyProduct, buildDrift: undefined },
  { ...readyProduct, buildDrift: { drifted: "false" } },
]) {
  const unknownBuild = evaluateMcpPreflight(readyWorkspace, malformedProduct, readyHealth);
  assert.equal(unknownBuild.ready, false, "Fehlender Buildnachweis muss fail-closed bleiben.");
  assert(unknownBuild.blockers.some((entry) => entry.code === "PRODUCT_BUILD_DRIFT"));
}

for (const malformedHealth of [
  { ...readyHealth, dialogs: undefined },
  { ...readyHealth, dialogs: {} },
]) {
  const unknownHealth = evaluateMcpPreflight(readyWorkspace, readyProduct, malformedHealth);
  assert.equal(unknownHealth.ready, false, "Unvollstaendiger Health-Nachweis muss fail-closed bleiben.");
  assert(unknownHealth.blockers.some((entry) => entry.code === "SSE_UNHEALTHY"));
}

const translatedAdvice = evaluateMcpPreflight(
  readyWorkspace,
  readyProduct,
  { ...readyHealth, advice: "healthy" },
);
assert.equal(translatedAdvice.ready, true, "Freigabe darf nicht von einem uebersetzten Hinweistext abhaengen.");

const incompatibleInstallation = evaluateMcpPreflight(
  readyWorkspace,
  { ...readyProduct, defaultExecutable: { exists: true, supported: false } },
  readyHealth,
);
assert(incompatibleInstallation.blockers.some((entry) => entry.code === "PRODUCT_INSTALLATION_INCOMPATIBLE"));
assert(!incompatibleInstallation.blockers.some((entry) => entry.code === "PRODUCT_NOT_INSTALLED"));

const identityMismatch = evaluateMcpPreflight(
  readyWorkspace,
  readyProduct,
  { ...readyHealth, profileId: "2024", taxYear: 2024 },
);
assert.equal(identityMismatch.product.identityCompatible, false);
assert(identityMismatch.blockers.some((entry) => entry.code === "PROFILE_IDENTITY_MISMATCH"));

process.stdout.write("MCP-Preflight: setup, runtime, Blockercodes und PC-blinde Projektion bestanden\n");
