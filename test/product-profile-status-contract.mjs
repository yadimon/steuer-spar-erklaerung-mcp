import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProductProfile } from "../dist/product-profiles.js";

const root = mkdtempSync(join(tmpdir(), "sse-profile-status-"));
const dir = join(root, "2024");
mkdirSync(dir, { recursive: true });

const manifest = {
  schemaVersion: 1, id: "2024", status: "experimental",
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
assert.equal(profile.verifiedBuild, "30.0.127.0", "verifiedBuild muss durchgereicht werden");

const { createApiExecutor } = await import("../dist/api-executor.js");
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
// den Worker erreichen (EXPERIMENTAL_ALLOWED), nicht nur eine mit dem Flag.
const allowlistedResult = await blocked("health", {}, 5000);
assert.equal(allowlistedResult.ok, true, "Erlaubte Katalogoperation muss auch ohne operateExperimental den Worker erreichen");
assert.equal(allowlistedResult.stub, true);

const allowed = createApiExecutor(
  { ...stubConfig, operateExperimental: true },
  async () => ({ ok: true, stub: true }),
);
const viaStub = await allowed("windows", {}, 5000);
assert.equal(viaStub.ok, true);
assert.equal(viaStub.stub, true, "Mit operateExperimental muss der Worker erreicht werden");

process.stdout.write("Profilstatus: experimental ist ladbar und ausgewiesen\n");
