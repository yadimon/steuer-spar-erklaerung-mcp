import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  isProductProfileReleased,
  listProductProfileIds,
  loadProductProfile,
  resolvePageObjectDefinition,
} from "../dist/product-profiles.js";
import { SSE_START_MODES } from "../dist/operation-catalog.js";
import { WORKER_RUNTIME_FILES } from "./worker-fixture-files.mjs";

const root = resolve(process.cwd());
const profile = loadProductProfile("2025");
assert.deepEqual(listProductProfileIds(), ["2024", "2025"]);
assert.equal(profile.taxYear, 2025);
assert.equal(profile.engineFileMajor, 31);
assert.equal(profile.status, "supported");
assert.equal(profile.operationAccess, "full");
assert.equal(isProductProfileReleased(profile), true);
assert.equal(profile.verifiedBuild, "31.0.1.0");
assert.equal(profile.executable.name, "SSE.exe");
assert.equal(profile.pageObjectsPath, join(root, "profiles", "2025", "page-objects.json"));
assert.equal(profile.pageObjectsCatalog.schemaVersion, 1);
assert.equal(profile.pageObjectsCatalog.taxYear, 2025);
assert(Object.hasOwn(profile.pageObjectsCatalog.pages, "est.sonstige_werbungskosten_fahrten"));
const firstPage = profile.pageObjectsCatalog.pages["est.sonstige_werbungskosten_fahrten"];
assert.equal(firstPage.headingPrefix, "Sonstige Werbungskosten/Fahrten",
  "Die personengebundene ESt-Seite muss dynamische Ueberschrift-Suffixe akzeptieren.");
// Die Stammdatenseiten eines neu angelegten Folgejahr-Falls sind katalogisiert,
// damit sse_fill_fields sie ohne Bildschirmsuche schreibt; RadioButtons bleiben
// als Hinweis fuer sse_click pattern=select dokumentiert.
for (const [pageId, heading, expectedFields] of [
  ["gew_erfass.allgemeine_angaben_unternehmen", "Allgemeine Angaben zum Unternehmen",
    ["name_unternehmer", "vorname_unternehmer", "firmenname", "postleitzahl", "ort", "rechtsform", "einkunftsart", "gruendungsdatum", "kommentar"]],
  ["gew_erfass.themenfilter_umsatzsteuer", "Themenfilter/Angaben zur Umsatzsteuer",
    ["umsatzsteuererklaerung_voranmeldungen", "lohnsteueranmeldungen", "umsatz_vorjahr", "unternehmereigenschaft_von"]],
]) {
  const page = profile.pageObjectsCatalog.pages[pageId];
  assert(page, `Stammdatenseite ${pageId} fehlt im Katalog.`);
  assert.equal(page.heading, heading);
  assert.equal(page.documentType, "GewErfass2026");
  for (const fieldId of expectedFields) {
    const field = page.fields[fieldId];
    assert(field, `${pageId}.${fieldId} fehlt.`);
    assert.match(field.automationIdRelative, /^\.centralWidget\./u, `${pageId}.${fieldId} braucht einen fensterrelativen Pfad.`);
    assert(field.automationIdRelative.endsWith(field.automationIdSuffix), `${pageId}.${fieldId}: Suffix passt nicht zum Pfad.`);
  }
  assert(Array.isArray(page.notes.radioButtons) && page.notes.radioButtons.length >= 2,
    `${pageId} muss die nicht katalogisierbaren RadioButtons als Hinweis fuehren.`);
}
const masterData = profile.pageObjectsCatalog.pages["gew_erfass.allgemeine_angaben_unternehmen"];
assert.equal(masterData.fields.einkunftsart.controlType, "ComboBox");
assert.deepEqual(masterData.fields.einkunftsart.options, ["Gewerbebetrieb", "selbstständige Tätigkeit", "Land- u. Forstwirtschaft"]);
assert.equal(masterData.fields.gruendungsdatum.valueKind, "date");
const vatPage = profile.pageObjectsCatalog.pages["gew_erfass.themenfilter_umsatzsteuer"];
assert.equal(vatPage.fields.lohnsteueranmeldungen.controlType, "CheckBox");
assert.equal(vatPage.fields.lohnsteueranmeldungen.valueKind, "boolean");
assert.equal(vatPage.fields.umsatz_vorjahr.valueKind, "currency");
assert(vatPage.notes.radioButtons.some((entry) => entry.automationIdSuffixNein === ".AngabenUmsatzsteuer.Besteuerungsart.JaNein.Nein"),
  "Die Soll-/Ist-Entscheidung muss als RadioButton-Hinweis auffindbar sein.");
const ambiguousCatalog = {
  ...profile.pageObjectsCatalog,
  pages: { Beispiel: firstPage, bEISPIEL: firstPage },
};
assert.equal(resolvePageObjectDefinition(ambiguousCatalog, "Beispiel").status, "found");
assert.equal(resolvePageObjectDefinition(ambiguousCatalog, "BEISPIEL").status, "ambiguous");
assert.equal(resolvePageObjectDefinition(ambiguousCatalog, "fehlt").status, "missing");
assert.deepEqual(profile.additionalCaseYears, { einurvor: [2026] });
assert.deepEqual(Object.keys(profile.startModes).sort(), [...SSE_START_MODES].sort(),
  "Oeffentliche Startmodi und produktives Profil muessen identisch sein.");
assert.deepEqual(Object.keys(profile.startModes).sort(),
  ["einur", "einurvor", "ermaess", "fest", "normal", "vorweg"],
  "Das Profil darf nur die von SSEKonf.ini als ValidModes akzeptierten Direktstarts anbieten.");
for (const unsupportedMode of ["KonsUst", "KonsUSt", "zulage", "NVBescheinigung"]) {
  assert.equal(profile.startModes[unsupportedMode], undefined,
    `Nicht direkt startbarer SSE-Modus ${unsupportedMode} darf nicht veroeffentlicht werden.`);
}
const profile2024 = loadProductProfile("2024");
assert.equal(profile2024.status, "experimental");
assert.equal(profile2024.operationAccess, "verification-only");
assert.equal(isProductProfileReleased(profile2024), false);
assert.equal(profile2024.verifiedBuild, "30.0.127.0");
assert.throws(() => loadProductProfile("..\\2025"), /Ungueltige/);

const invalidAdditionalYearRoot = mkdtempSync(join(tmpdir(), "sse-product-additional-year-"));
try {
  const copiedProfile = join(invalidAdditionalYearRoot, "2025");
  cpSync(join(root, "profiles", "2025"), copiedProfile, { recursive: true });
  const manifestPath = join(copiedProfile, "profile.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.additionalCaseYears.einurvor = [2027];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  assert.throws(() => loadProductProfile("2025", invalidAdditionalYearRoot), /unmittelbar folgende Falljahr/);
} finally {
  rmSync(invalidAdditionalYearRoot, { recursive: true, force: true });
}

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

const invalidEncodingRoot = mkdtempSync(join(tmpdir(), "sse-product-encoding-"));
try {
  const copiedProfile = join(invalidEncodingRoot, "2025");
  cpSync(join(root, "profiles", "2025"), copiedProfile, { recursive: true });
  writeFileSync(join(copiedProfile, "profile.json"), Buffer.from([0x7b, 0x22, 0x80, 0x22, 0x7d]));
  assert.throws(() => loadProductProfile("2025", invalidEncodingRoot), /kein gueltiges UTF-8/);
} finally {
  rmSync(invalidEncodingRoot, { recursive: true, force: true });
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

const incompatibleCatalogRoot = mkdtempSync(join(tmpdir(), "sse-product-catalog-"));
try {
  const copiedProfile = join(incompatibleCatalogRoot, "2025");
  cpSync(join(root, "profiles", "2025"), copiedProfile, { recursive: true });
  const pageObjectsPath = join(copiedProfile, "page-objects.json");
  const pageObjects = JSON.parse(readFileSync(pageObjectsPath, "utf8"));
  pageObjects.compatibility.executableName = "Andere.exe";
  writeFileSync(pageObjectsPath, `${JSON.stringify(pageObjects, null, 2)}\n`, "utf8");
  assert.throws(() => loadProductProfile("2025", incompatibleCatalogRoot), /widersprechen/);
} finally {
  rmSync(incompatibleCatalogRoot, { recursive: true, force: true });
}

const emptyCatalogRoot = mkdtempSync(join(tmpdir(), "sse-product-empty-catalog-"));
try {
  const copiedProfile = join(emptyCatalogRoot, "2025");
  cpSync(join(root, "profiles", "2025"), copiedProfile, { recursive: true });
  const pageObjectsPath = join(copiedProfile, "page-objects.json");
  const pageObjects = JSON.parse(readFileSync(pageObjectsPath, "utf8"));
  pageObjects.pages = {};
  writeFileSync(pageObjectsPath, `${JSON.stringify(pageObjects, null, 2)}\n`, "utf8");
  assert.throws(() => loadProductProfile("2025", emptyCatalogRoot), /Seitenkatalog darf nicht leer/);
} finally {
  rmSync(emptyCatalogRoot, { recursive: true, force: true });
}

const caseCollisionRoot = mkdtempSync(join(tmpdir(), "sse-product-case-collision-"));
try {
  const copiedProfile = join(caseCollisionRoot, "2025");
  cpSync(join(root, "profiles", "2025"), copiedProfile, { recursive: true });
  const pageObjectsPath = join(copiedProfile, "page-objects.json");
  const pageObjects = JSON.parse(readFileSync(pageObjectsPath, "utf8"));
  const firstPage = Object.values(pageObjects.pages)[0];
  pageObjects.pages.Beispiel = firstPage;
  pageObjects.pages.bEISPIEL = firstPage;
  writeFileSync(pageObjectsPath, `${JSON.stringify(pageObjects, null, 2)}\n`, "utf8");
  assert.throws(() => loadProductProfile("2025", caseCollisionRoot), /Gross-\/Kleinschreibung/);
} finally {
  rmSync(caseCollisionRoot, { recursive: true, force: true });
}

const powershell = join(
  process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows",
  "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
);
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
const runWorkerProfileMutation = (mutate, op = "product_info") => {
  const isolatedRoot = mkdtempSync(join(tmpdir(), "sse-worker-profile-"));
  const isolatedPowerShell = join(isolatedRoot, "powershell");
  const isolatedProfiles = join(isolatedRoot, "profiles");
  try {
    mkdirSync(isolatedPowerShell, { recursive: true });
    for (const name of WORKER_RUNTIME_FILES) {
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
        join(isolatedPowerShell, "sse-worker.ps1"), "-Op", op,
      ],
      {
        cwd: isolatedRoot,
        env: { ...process.env, SSE_PROFILE_ID: "2025", SSE_OPERATE_EXPERIMENTAL: "" },
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

// "experimental" laedt jetzt bewusst (Initialize-SSEProductProfile laesst es
// zu). Zuerst beweisen, dass die isolierte Manifestmutation wirklich vom
// Worker gelesen wird; danach die Betriebs-Gate separat pruefen.
const experimentalInfo = runWorkerProfileMutation(({ profilePath }) => {
  const manifest = JSON.parse(readFileSync(profilePath, "utf8"));
  manifest.status = "experimental";
  writeJson(profilePath, manifest);
});
assert.equal(experimentalInfo.profileStatus, "experimental", JSON.stringify(experimentalInfo));
assert.equal(experimentalInfo.operationAccess, "full", JSON.stringify(experimentalInfo));

const unsupportedStatus = runWorkerProfileMutation(({ profilePath }) => {
  const manifest = JSON.parse(readFileSync(profilePath, "utf8"));
  manifest.status = "experimental";
  writeJson(profilePath, manifest);
}, "windows");
assert.equal(unsupportedStatus.ok, false);
assert.equal(unsupportedStatus.kind, "profile-unverified");

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

// 2024 ist ein reales, experimentelles Profil und "product_info" steht in
// EXPERIMENTAL_ALLOWED: der echte Worker muss es gegen das echte 2024-Profil
// erreichen (nicht mehr an der Initialisierung scheitern).
const experimentalWorker = spawnSync(
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
assert.equal(experimentalWorker.status, 0, experimentalWorker.stderr);
const experimentalResult = JSON.parse(experimentalWorker.stdout.trim());
assert.equal(experimentalResult.ok, true);
assert.equal(experimentalResult.profileId, "2024");
assert.equal(experimentalResult.profileStatus, "experimental");
assert.equal(experimentalResult.operationAccess, "verification-only");

process.stdout.write("Produktprofile: explizite Version, Drift- und Unknown-Version-Gates bestanden\n");
