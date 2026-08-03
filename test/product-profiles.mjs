import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { listProductProfileIds, loadProductProfile } from "../dist/product-profiles.js";

const root = resolve(process.cwd());
const profile = loadProductProfile("2025");
assert.deepEqual(listProductProfileIds(), ["2025"]);
assert.equal(profile.taxYear, 2025);
assert.equal(profile.engineFileMajor, 31);
assert.equal(profile.executable.name, "SSE.exe");
assert.equal(profile.pageObjectsPath, join(root, "profiles", "2025", "page-objects.json"));
assert.throws(() => loadProductProfile("2024"), /fehlt/);
assert.throws(() => loadProductProfile("..\\2025"), /Ungueltige/);

const invalidRelativeRoot = mkdtempSync(join(tmpdir(), "sse-product-relative-"));
try {
  const copiedProfile = join(invalidRelativeRoot, "2025");
  cpSync(join(root, "profiles", "2025"), copiedProfile, { recursive: true });
  const manifestPath = join(copiedProfile, "profile.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.executable.defaultRelativePath = "../Steuerjahr 2025/SSE.exe";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  assert.throws(() => loadProductProfile("2025", invalidRelativeRoot), /defaultRelativePath/);
} finally {
  rmSync(invalidRelativeRoot, { recursive: true, force: true });
}

const temporary = mkdtempSync(join(tmpdir(), "sse-product-profile-"));
try {
  const copiedProfile = join(temporary, "2025");
  cpSync(join(root, "profiles", "2025"), copiedProfile, { recursive: true });
  const pageObjectsPath = join(copiedProfile, "page-objects.json");
  const pageObjects = JSON.parse(readFileSync(pageObjectsPath, "utf8"));
  pageObjects.engineFileMajor = 999;
  writeFileSync(pageObjectsPath, `${JSON.stringify(pageObjects, null, 2)}\n`, "utf8");
  assert.throws(() => loadProductProfile("2025", temporary), /widersprechen/);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const powershell = join(
  process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows",
  "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
);
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
const runWorkerProfileMutation = (mutate) => {
  const isolatedRoot = mkdtempSync(join(tmpdir(), "sse-worker-profile-"));
  const isolatedPowerShell = join(isolatedRoot, "powershell");
  const isolatedProfiles = join(isolatedRoot, "profiles");
  try {
    mkdirSync(isolatedPowerShell, { recursive: true });
    for (const name of [
      "sse-worker.ps1", "akad-parser.ps1", "table-region.ps1", "load-native.ps1",
      "sse-native.cs", "sse-native.dll", "sse-native.sha256",
    ]) {
      cpSync(join(root, "powershell", name), join(isolatedPowerShell, name));
    }
    cpSync(join(root, "profiles"), isolatedProfiles, { recursive: true });
    const profilePath = join(isolatedProfiles, "2025", "profile.json");
    const pageObjectsPath = join(isolatedProfiles, "2025", "page-objects.json");
    mutate({ profilePath, pageObjectsPath, isolatedRoot });
    const worker = spawnSync(
      powershell,
      [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
        join(isolatedPowerShell, "sse-worker.ps1"), "-Op", "product_info",
      ],
      {
        cwd: isolatedRoot,
        env: { ...process.env, SSE_PROFILE_ID: "2025" },
        encoding: "utf8",
        windowsHide: true,
      },
    );
    assert.equal(worker.status, 0, worker.stderr);
    return JSON.parse(worker.stdout.trim());
  } finally {
    rmSync(isolatedRoot, { recursive: true, force: true });
  }
};

const unsupportedStatus = runWorkerProfileMutation(({ profilePath }) => {
  const manifest = JSON.parse(readFileSync(profilePath, "utf8"));
  manifest.status = "experimental";
  writeJson(profilePath, manifest);
});
assert.equal(unsupportedStatus.ok, false);
assert.equal(unsupportedStatus.kind, "invalid-profile");

const pageObjectTraversal = runWorkerProfileMutation(({ profilePath }) => {
  const manifest = JSON.parse(readFileSync(profilePath, "utf8"));
  manifest.pageObjects = "../page-objects.json";
  writeJson(profilePath, manifest);
});
assert.equal(pageObjectTraversal.ok, false);
assert.equal(pageObjectTraversal.kind, "invalid-profile");
assert.match(pageObjectTraversal.error, /einfacher JSON-Dateiname/);

const executableTraversal = runWorkerProfileMutation(({ profilePath }) => {
  const manifest = JSON.parse(readFileSync(profilePath, "utf8"));
  manifest.executable.defaultRelativePath = "../Steuerjahr 2025/SSE.exe";
  writeJson(profilePath, manifest);
});
assert.equal(executableTraversal.ok, false);
assert.equal(executableTraversal.kind, "invalid-profile");
assert.match(executableTraversal.error, /defaultRelativePath/);

const pageObjectDrift = runWorkerProfileMutation(({ pageObjectsPath }) => {
  const pageObjects = JSON.parse(readFileSync(pageObjectsPath, "utf8"));
  pageObjects.compatibility.installationFolderName = "Steuerjahr 2099";
  writeJson(pageObjectsPath, pageObjects);
});
assert.equal(pageObjectDrift.ok, false);
assert.equal(pageObjectDrift.kind, "invalid-profile");
assert.match(pageObjectDrift.error, /Kompatibilitaet/);

const invalidWorker = spawnSync(
  powershell,
  [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
    join(root, "powershell", "sse-worker.ps1"), "-Op", "product_info",
  ],
  {
    cwd: root,
    env: { ...process.env, SSE_PROFILE_ID: "2024" },
    encoding: "utf8",
    windowsHide: true,
  },
);
assert.equal(invalidWorker.status, 0, invalidWorker.stderr);
const invalidResult = JSON.parse(invalidWorker.stdout.trim());
assert.equal(invalidResult.ok, false);
assert.equal(invalidResult.kind, "invalid-profile");

process.stdout.write("Produktprofile: explizite Version, Drift- und Unknown-Version-Gates bestanden\n");
