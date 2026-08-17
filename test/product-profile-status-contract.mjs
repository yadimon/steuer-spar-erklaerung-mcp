import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProductProfileReleased, loadProductProfile } from "../dist/product-profiles.js";

const root = mkdtempSync(join(tmpdir(), "sse-profile-status-"));
const dir = join(root, "2024");
mkdirSync(dir, { recursive: true });

const manifest = {
  schemaVersion: 1, id: "2024", status: "experimental", operationAccess: "verification-only",
  product: "SteuerSparErklaerung 2024", taxYear: 2024, engineFileMajor: 30,
  verifiedBuild: "30.0.127.0",
  executable: {
    name: "SSE.exe", installationFolderName: "Steuerjahr 2024",
    defaultRelativePath: "Steuertipps/SteuerSparErklaerung/Steuerjahr 2024/SSE.exe",
  },
  startModes: { normal: "ESt" }, additionalCaseYears: {},
  pageObjects: "page-objects.json", policy: "Fail closed.",
};
const catalog = {
  schemaVersion: 1, product: "SteuerSparErklaerung 2024", taxYear: 2024,
  engineFileMajor: 30,
  compatibility: { executableName: "SSE.exe", installationFolderName: "Steuerjahr 2024" },
  windows: { main: { process: "SSE", role: "main" } },
  pages: { "est.start": { heading: "Start" } },
};
writeFileSync(join(dir, "profile.json"), JSON.stringify(manifest), "utf8");
writeFileSync(join(dir, "page-objects.json"), JSON.stringify(catalog), "utf8");

const profile = loadProductProfile("2024", root);
assert.equal(profile.status, "experimental", "experimental muss ladbar sein");
assert.equal(profile.operationAccess, "verification-only");
assert.equal(profile.verifiedBuild, "30.0.127.0", "verifiedBuild muss durchgereicht werden");

const {
  createApiExecutor,
  EXPERIMENTAL_PROFILE_BASE_OPERATIONS,
  EXPERIMENTAL_PROFILE_VERIFICATION_OPERATIONS,
} = await import("../dist/api-executor.js");
const stubConfig = {
  host: "127.0.0.1", port: 1, token: "t".repeat(43),
  configPath: join(root, "config.json"),
  profileId: "2024",
  workspaceDir: join(root, "ws"), resultDir: join(root, "res"), caseDir: join(root, "cases"),
};
mkdirSync(stubConfig.workspaceDir, { recursive: true });
mkdirSync(stubConfig.resultDir, { recursive: true });
mkdirSync(stubConfig.caseDir, { recursive: true });

// createApiExecutor loest Betriebsfehler nicht ab, sondern liefert sie als
// { ok: false, kind, error } zurueck (siehe api-executor.ts catch-Zweig).
const blocked = createApiExecutor(stubConfig, async () => ({ ok: true, stub: true }));
const blockedResult = await blocked("windows", {}, 5000);
assert.equal(blockedResult.ok, false, "Ohne operateExperimental muss eine Betriebsoperation scheitern");
assert.match(
  `${blockedResult.kind} ${blockedResult.error}`,
  /profile-unverified|nicht verifiziert/u,
);

// Auch ohne operateExperimental muss eine zulaessige Katalog-/Dateiauskunft
// aus dem Basiskatalog den Worker erreichen, nicht nur eine mit dem Flag.
const allowlistedResult = await blocked("health", {}, 5000);
assert.equal(allowlistedResult.ok, true, "Erlaubte Katalogoperation muss auch ohne operateExperimental den Worker erreichen");
assert.equal(allowlistedResult.stub, true);

// Eine reine Status-Promotion darf weder Setup noch den vollen Operationsraum
// oeffnen. Dazu muss operationAccess separat und bewusst freigegeben werden.
manifest.status = "supported";
writeFileSync(join(dir, "profile.json"), JSON.stringify(manifest), "utf8");
const promotedProfile = loadProductProfile("2024", root);
assert.equal(isProductProfileReleased(promotedProfile), false);
const promotedWithoutAccess = createApiExecutor(stubConfig, async () => ({ ok: true, stub: true }));
const promotedWindows = await promotedWithoutAccess("windows", {}, 5000);
assert.equal(promotedWindows.kind, "profile-unverified", "Status allein darf Betriebsoperationen nicht freigeben");

const reachedOperations = [];
const allowed = createApiExecutor(
  { ...stubConfig, operateExperimental: true },
  async (operation) => {
    reachedOperations.push(operation);
    return { ok: true, stub: true };
  },
);
const viaStub = await allowed("windows", {}, 5000);
assert.equal(viaStub.ok, true);
assert.equal(viaStub.stub, true, "Mit operateExperimental muss der Worker erreicht werden");

const readPage = await allowed("read_page", { hwnd: 123 }, 5000);
assert.equal(readPage.ok, true, "Expliziter Leseweg muss den Worker erreichen");
assert.deepEqual(reachedOperations, ["windows", "read_page"]);

// checker_open darf seinen intern erzeugten, exakt gebundenen Weiter-Schritt
// ausfuehren. Ein oeffentlicher click bleibt weiter unten trotzdem gesperrt.
const checkerCalls = [];
const checkerExecutor = createApiExecutor(
  { ...stubConfig, operateExperimental: true },
  async (operation, args) => {
    checkerCalls.push({ operation, args });
    if (operation === "checker_results") return { ok: true, aktiv: false };
    if (operation === "page") return { ok: true, ueberschrift: "Prüfen und Abgeben" };
    if (operation === "click") return { ok: false, kind: "checker-navigation-sentinel", error: "stop" };
    return { ok: false, kind: "unexpected", error: operation };
  },
);
const checkerOpen = await checkerExecutor("checker_open", { name: "Testmeldung", hwnd: 123 }, 5000);
assert.equal(checkerOpen.kind, "checker-navigation-sentinel");
const checkerNavigation = checkerCalls.find(({ operation }) => operation === "click");
assert(checkerNavigation, "checker_open muss den gebundenen Weiter-Schritt erreichen");
assert.equal(checkerNavigation.args.experimentalCheckerNavigation, true,
  "Der Worker braucht die nicht oeffentlich parsbare interne Navigationsmarke");
assert.equal(checkerNavigation.args.expectedPageBefore, "Prüfen und Abgeben",
  "Der interne Weiter-Schritt muss an die zuvor gelesene Ausgangsseite gebunden sein");

// Das Flag ist kein Generalschluessel. Unverifizierte Mutationen scheitern
// vor Argumentvalidierung und Worker-Aufruf mit einer eigenen Fehlerart.
for (const operation of ["click", "dialog_answer", "table_update", "tracked_set_value", "vast_apply"]) {
  const before = reachedOperations.length;
  const result = await allowed(operation, {}, 5000);
  assert.equal(result.ok, false, `${operation} muss trotz operateExperimental scheitern`);
  assert.equal(result.kind, "profile-operation-unverified", `${operation}: falsche Fehlerart`);
  assert.match(result.error, new RegExp(`Operation '${operation}'.*Verifikationskatalog`, "u"));
  assert.equal(reachedOperations.length, before, `${operation} darf den Worker nicht erreichen`);
}

for (const button of ["Ja", "Nein", "Speichern", "Klicken Sie hier, um Ihre Daten zu exportieren"]) {
  const before = reachedOperations.length;
  const result = await allowed("dialog_answer", {
    hwnd: 1, fingerprint: "A".repeat(64), button,
  }, 5000);
  assert.equal(result.kind, "profile-operation-unverified",
    `Experimentelle Dialogantwort '${button}' muss vor dem Worker scheitern`);
  assert.equal(reachedOperations.length, before, `Dialogantwort '${button}' erreichte den Worker`);
}
const passiveDialogCandidate = await allowed("dialog_answer", {
  hwnd: 1, fingerprint: "A".repeat(64), button: "OK",
}, 5000);
assert.equal(passiveDialogCandidate.ok, true,
  "Passiver Dialogkandidat muss die API-Gate bis zur titel-/textgebundenen Worker-Pruefung passieren");
assert.equal(reachedOperations.at(-1), "dialog_answer");

const base = new Set(EXPERIMENTAL_PROFILE_BASE_OPERATIONS);
const verification = new Set(EXPERIMENTAL_PROFILE_VERIFICATION_OPERATIONS);
for (const operation of [
  "click", "set_value", "tracked_set_value", "combo_select", "toggle",
  "table_add", "table_update", "table_delete",
  "dialog_answer", "save", "save_as", "collect", "export_csv",
  "ustva_change_value", "ustva_select_period", "ustva_set_flag", "ustva_open_section",
  "vast_apply", "vast_mapping_select", "vast_row_set_expanded",
  "archive_cases", "backup_cases", "workspace_file_write_text", "scenario_run",
]) {
  assert(!base.has(operation) && !verification.has(operation), `${operation} darf in keinem Experimental-Katalog stehen`);
}
for (const operation of [
  "health", "case_hash", "make_working_copy", "launch", "dialog_list",
  "ui_state", "page", "result_details", "read_page", "subpages", "find", "windows", "help",
  "read_table", "read_full", "scroll_page", "table_read", "snapshot", "accessibility_probe",
  "snapshot_compare", "goto", "click_point", "checker_run", "checker_results", "checker_close",
  "ustva_read", "close",
]) {
  assert(base.has(operation) || verification.has(operation),
    `Live-Muster-Lebenszyklus fehlt im Experimental-Katalog: ${operation}`);
}

process.stdout.write("Profilstatus: experimental ist ladbar und fail-closed verifizierbar\n");
