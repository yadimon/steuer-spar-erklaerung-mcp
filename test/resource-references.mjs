import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadApiServerConfig } from "../dist/api-config.js";
import { API_RESOURCE_BINDINGS, createApiExecutor } from "../dist/api-executor.js";
import {
  formatResourceReference,
  parseResourceReference,
  redactResourcePaths,
  resolveResourceReference,
} from "../dist/resources.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-resource-ref-"));
const workspaceDir = join(temporary, "workspace");
const roots = {
  cases: join(temporary, "cases"),
  documents: join(workspaceDir, "documents"),
  workspace: workspaceDir,
  results: join(workspaceDir, "results"),
  backups: join(workspaceDir, "backups"),
};

for (const root of Object.values(roots)) mkdirSync(root, { recursive: true });
writeFileSync(join(roots.cases, "arbeit.Gew2025"), "case-fixture");
writeFileSync(join(roots.documents, "rechnung.txt"), "beleg\n");
writeFileSync(join(roots.workspace, "eingabe.txt"), "input\n");
writeFileSync(join(roots.results, "erfassung.json"), "{}\n");

try {
  assert.deepEqual(parseResourceReference("documents:belege\\rechnung.pdf"), {
    area: "documents",
    relativePath: "belege/rechnung.pdf",
    ref: "documents:belege/rechnung.pdf",
  });
  assert.equal(formatResourceReference("workspace", "./eingaben//werte.json"), "workspace:eingaben/werte.json");
  assert.equal(
    resolveResourceReference(roots, "cases:arbeit.Gew2025").path,
    resolve(join(roots.cases, "arbeit.Gew2025")),
  );

  for (const invalid of [
    "workspace:C:\\Windows\\win.ini",
    "workspace:/Windows/win.ini",
    "workspace:\\\\server\\share\\datei",
    "workspace:../escape.txt",
    "workspace:ordner/../../escape.txt",
    "workspace:datei.txt:stream",
    "workspace:NUL",
    "workspace:berichte/CON.txt",
    "results:COM1.json",
    "backups:lpt9/manifest.json",
    "unknown:file.txt",
    "workspace:",
  ]) {
    assert.throws(() => resolveResourceReference(roots, invalid), /nicht erlaubt|kein|Format|Pfad|Bereich|Doppelpunkte|Windows|leer/i, invalid);
  }

  const outside = join(temporary, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "outside");
  symlinkSync(outside, join(roots.workspace, "junction"), "junction");
  assert.throws(
    () => resolveResourceReference(roots, "workspace:junction/secret.txt"),
    /Junction|Link|Bereich/,
  );
  assert.throws(
    () => resolveResourceReference(roots, "workspace:junction/new/deep.txt"),
    /Junction|Link|Bereich/,
  );

  const configPath = join(temporary, "config", "config.json");
  mkdirSync(join(temporary, "config"), { recursive: true });
  writeFileSync(
    configPath,
    `${JSON.stringify({ token: "resource-test-token-with-at-least-24-characters", workspaceDir }, null, 2)}\n`,
  );
  const loaded = loadApiServerConfig({ SSE_API_CONFIG: configPath });
  assert.equal(loaded.documentsDir, join(workspaceDir, "documents"));
  assert.equal(loaded.backupsDir, join(workspaceDir, "backups"));

  const calls = [];
  const execute = createApiExecutor(
    {
      host: "127.0.0.1",
      port: 43127,
      token: "resource-test-token-with-at-least-24-characters",
      configPath,
      caseDir: roots.cases,
      documentsDir: roots.documents,
      workspaceDir: roots.workspace,
      resultDir: roots.results,
      backupsDir: roots.backups,
    },
    async (operation, args) => {
      calls.push({ operation, args });
      if (operation === "center_cases") return { ok: true, verzeichnis: roots.cases, faelle: [] };
      if (operation === "launch") return { ok: true, launched: true, pid: 5151, operation, path: args.file, args };
      if (operation === "windows") {
        return {
          ok: true,
          windows: [{
            pid: 5151,
            hwnd: 5152,
            title: "Gewinnermittlung 2025: SteuerSparErklärung für das Steuerjahr 2025",
            w: 1200,
            h: 800,
            minimiert: false,
          }],
        };
      }
      if (operation === "dialog_list") return { ok: true, dialogs: [] };
      return { ok: true, operation, path: args.path, args };
    },
  );

  const centerCases = await execute("center_cases", { hwnd: 42 }, 1_000);
  assert.equal(centerCases.verzeichnis, "cases:.");
  const centerRefresh = await execute("center_refresh", {
    hwnd: 42,
    expectedDirectoryRef: centerCases.verzeichnis,
  }, 1_000);
  assert.equal(calls.at(-1).args.expectedDirectory, roots.cases);
  assert.deepEqual(centerRefresh.resourceRefs, { expectedDirectoryRef: "cases:." });

  const csvDirectory = join(roots.results, "csv-neu");
  assert.equal(existsSync(csvDirectory), false);
  const csvExport = await execute("export_csv", { resultRef: "results:csv-neu" }, 1_000);
  assert.equal(csvExport.ok, true);
  assert.equal(existsSync(csvDirectory), true, "API muss einen neuen leeren CSV-Ergebnisordner sicher anlegen");
  assert.equal(calls.at(-1).args.dir, csvDirectory);
  assert.deepEqual(csvExport.resourceRefs, { resultRef: "results:csv-neu" });
  const failedCsvDirectory = join(roots.results, "csv-fehler");
  const failingExport = createApiExecutor(
    {
      host: "127.0.0.1",
      port: 43129,
      token: "failed-export-token-with-at-least-24-characters",
      configPath,
      caseDir: roots.cases,
      documentsDir: roots.documents,
      workspaceDir: roots.workspace,
      resultDir: roots.results,
      backupsDir: roots.backups,
    },
    async () => ({ ok: false, kind: "test", error: "dialog blieb zu" }),
  );
  const failedCsv = await failingExport("export_csv", { resultRef: "results:csv-fehler" }, 1_000);
  assert.equal(failedCsv.ok, false);
  assert.equal(existsSync(failedCsvDirectory), false, "fehlgeschlagener Export darf keinen leeren Restordner hinterlassen");

  const hashed = await execute("case_hash", { ref: "cases:arbeit.Gew2025" }, 1_000);
  assert.equal(calls.at(-1).args.path, join(roots.cases, "arbeit.Gew2025"));
  assert.equal(hashed.path, "cases:arbeit.Gew2025");
  assert.equal(hashed.args.path, "cases:arbeit.Gew2025");
  assert.deepEqual(hashed.resourceRefs, { ref: "cases:arbeit.Gew2025" });
  assert(!JSON.stringify(hashed).includes(roots.cases), "API-Ergebnis darf den lokalen Fallordner nicht enthalten");

  const legacy = await execute("case_hash", { path: join(roots.cases, "arbeit.Gew2025") }, 1_000);
  assert.equal(calls.at(-1).args.path, join(roots.cases, "arbeit.Gew2025"));
  assert.equal(legacy.ok, true, "Direkte API-Pfadfelder bleiben kompatibel");
  const ambiguous = await execute(
    "case_hash",
    { ref: "cases:arbeit.Gew2025", path: join(roots.cases, "arbeit.Gew2025") },
    1_000,
  );
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.kind, "bad-args");
  const wrongArea = await execute("case_hash", { ref: "documents:rechnung.txt" }, 1_000);
  assert.equal(wrongArea.ok, false);
  assert.equal(wrongArea.kind, "bad-args");

  const aliasCases = [
    ["launch", "caseRef", "file", "cases:arbeit.Gew2025", join(roots.cases, "arbeit.Gew2025")],
    ["desktop_start", "caseRef", "file", "cases:arbeit.Gew2025", join(roots.cases, "arbeit.Gew2025")],
    ["center_refresh", "expectedDirectoryRef", "expectedDirectory", "cases:.", roots.cases, { hwnd: 42 }],
    ["collect", "resultRef", "path", "results:neu.json", join(roots.results, "neu.json")],
    ["export_csv", "resultRef", "dir", "results:csv-export", join(roots.results, "csv-export")],
    ["verify", "sourceRef", "from", "results:erfassung.json", join(roots.results, "erfassung.json"), {
      expectedSourceHash: "0".repeat(64),
      erwartungen: [{ seite: "Seite", label: "Feld", wert: "1" }],
    }],
    ["screenshot", "resultRef", "path", "results:kontrolle.png", join(roots.results, "kontrolle.png")],
    ["save", "caseRef", "expectedPath", "cases:arbeit.Gew2025", join(roots.cases, "arbeit.Gew2025"), {
      expectedHashBefore: "0".repeat(64),
    }],
    ["file_dialog_select", "resourceRef", "expectedPath", "documents:rechnung.txt", join(roots.documents, "rechnung.txt"), {
      expectedDialogTitle: "Öffnen",
    }],
    ["vast_apply", "expectedCaseRef", "expectedCasePath", "cases:arbeit.Gew2025", join(roots.cases, "arbeit.Gew2025"), {
      hwnd: 101,
      expectedMainHwnd: 102,
      expectedCaseHash: "0".repeat(64),
      mappingFingerprint: "1".repeat(64),
      plan: [{ certificate: "Bescheinigung", occurrence: 1, localTarget: "Ziel" }],
      acknowledgeApply: true,
    }],
    ["toggle", "expectedCaseRef", "expectedCasePath", "cases:arbeit.Gew2025", join(roots.cases, "arbeit.Gew2025"), {
      expectedPage: "Seite", aid: ".Flag", expectedBefore: false, value: true, expectedAfter: true,
      expectedCaseHash: "0".repeat(64),
    }],
    ["combo_select", "expectedCaseRef", "expectedCasePath", "cases:arbeit.Gew2025", join(roots.cases, "arbeit.Gew2025"), {
      expectedPage: "Seite", aid: ".Combo", expectedCurrent: "A", value: "B", expectedAfter: "B",
      expectedCaseHash: "0".repeat(64),
    }],
    ["backup_cases", "destinationRef", "dest", "backups:sicherung", join(roots.backups, "sicherung")],
    ["archive_cases", "destinationRef", "dest", "backups:archiv", join(roots.backups, "archiv"), {
      cases: [{ name: "alt.Gew2025", expectedSha256: "0".repeat(64) }],
      expectedRemaining: [{ name: "aktuell.Gew2025", expectedSha256: "1".repeat(64) }],
    }],
  ];
  for (const [operation, alias, legacyField, ref, expectedPath, additionalArgs = {}] of aliasCases) {
    const callsBefore = calls.length;
    const result = await execute(operation, { ...additionalArgs, [alias]: ref }, operation === "launch" ? 30_000 : 1_000);
    const operationCall = calls.slice(callsBefore).find((entry) => entry.operation === operation);
    assert(operationCall, `${operation} muss den Worker erreichen`);
    assert.equal(operationCall.args[legacyField], expectedPath, `${operation} muss ${alias} lokal aufloesen`);
    assert.equal(operationCall.args[alias], undefined, `${operation} darf den Alias nicht an den Worker geben`);
    assert.equal(result.resourceRefs[alias], ref);
    assert(!JSON.stringify(result).includes(expectedPath), `${operation} darf den lokalen Pfad nicht zurueckgeben`);
  }

  writeFileSync(join(roots.results, "kontrolle.png"), "vorhandenes-kontrollbild", "utf8");
  const callsBeforeExistingScreenshot = calls.length;
  const existingScreenshot = await execute("screenshot", { resultRef: "results:kontrolle.png" }, 1_000);
  assert.equal(existingScreenshot.ok, false);
  assert.equal(existingScreenshot.kind, "bad-args");
  assert.match(existingScreenshot.error, /existiert bereits/);
  assert.equal(calls.length, callsBeforeExistingScreenshot, "Screenshot darf vorhandene Ergebnisdatei nicht ersetzen");

  const listedCases = await execute("list_cases", {}, 1_000);
  assert.equal(calls.at(-1).args.dir, roots.cases);
  assert(!JSON.stringify(listedCases).includes(roots.cases));
  const archived = await execute("archive_cases", {
    destinationRef: "backups:archiv-2",
    cases: [{ name: "alt.Gew2025", expectedSha256: "0".repeat(64) }],
    expectedRemaining: [{ name: "aktuell.Gew2025", expectedSha256: "1".repeat(64) }],
  }, 1_000);
  assert.equal(calls.at(-1).args.dir, roots.cases);
  assert.equal(calls.at(-1).args.dest, join(roots.backups, "archiv-2"));
  assert(!JSON.stringify(archived).includes(roots.cases));

  const saveAs = await execute(
    "save_as",
    {
      sourceRef: "cases:arbeit.Gew2025",
      expectedSourceHash: "0".repeat(64),
      targetRef: "cases:gespeichert.Gew2025",
    },
    1_000,
  );
  assert.equal(calls.at(-1).args.expectedSourcePath, join(roots.cases, "arbeit.Gew2025"));
  assert.equal(calls.at(-1).args.targetPath, join(roots.cases, "gespeichert.Gew2025"));
  assert.deepEqual(saveAs.resourceRefs, {
    sourceRef: "cases:arbeit.Gew2025",
    targetRef: "cases:gespeichert.Gew2025",
  });

  const tracked = await execute("tracked_set_value", {
    pageId: "seite",
    fieldId: "feld",
    expectedBefore: "1",
    value: "2",
    expectedAfter: "2",
    expectedCaseRef: "cases:arbeit.Gew2025",
    expectedCaseHash: "0".repeat(64),
  }, 1_000);
  assert.equal(calls.at(-1).args.expectedCasePath, join(roots.cases, "arbeit.Gew2025"));
  assert.equal(calls.at(-1).args.expectedCaseRef, undefined);
  assert.deepEqual(tracked.resourceRefs, { expectedCaseRef: "cases:arbeit.Gew2025" });

  const copied = await execute(
    "make_working_copy",
    {
      sourceRef: "cases:arbeit.Gew2025",
      targetRef: "cases:arbeitskopie.Gew2025",
      expectedSourceHash: "0".repeat(64),
    },
    1_000,
  );
  assert.equal(calls.at(-1).args.source, join(roots.cases, "arbeit.Gew2025"));
  assert.equal(calls.at(-1).args.target, join(roots.cases, "arbeitskopie.Gew2025"));
  assert.deepEqual(copied.resourceRefs, {
    sourceRef: "cases:arbeit.Gew2025",
    targetRef: "cases:arbeitskopie.Gew2025",
  });

  const bindingOperationsCovered = new Set([
    ...aliasCases.map(([operation]) => operation),
    "case_hash", "tracked_set_value", "save_as", "make_working_copy",
  ]);
  assert.deepEqual(
    Object.keys(API_RESOURCE_BINDINGS).sort(),
    [...bindingOperationsCovered].sort(),
    "Jeder deklarative Ressourcen-Bindungspfad braucht einen Aufloesungs-/Redaktionsvertrag.",
  );

  const read = await execute("workspace_file_read_text", { ref: "documents:rechnung.txt" }, 1_000);
  assert.equal(read.ok, true);
  assert.equal(read.ref, "documents:rechnung.txt");
  assert.equal(read.text, "beleg\n");
  const written = await execute(
    "workspace_file_write_text",
    { ref: "workspace:ausgaben/antwort.txt", text: "antwort\n" },
    1_000,
  );
  assert.equal(written.ref, "workspace:ausgaben/antwort.txt");
  const listed = await execute("workspace_file_list", { ref: "workspace:." }, 1_000);
  assert.equal(listed.ref, "workspace:.");
  assert(listed.files.every((file) => file.ref.startsWith("workspace:")));

  const escapedWrite = await execute(
    "workspace_file_write_text",
    { ref: "workspace:junction/new.txt", text: "no\n" },
    1_000,
  );
  assert.equal(escapedWrite.ok, false);
  assert.match(escapedWrite.error, /Junction|Link|Bereich/);

  for (const forbiddenRef of [
    "cases:arbeit.Gew2025",
    "documents:rechnung.txt",
    "backups:manuell.txt",
    "workspace:documents/neuer-beleg.txt",
    "workspace:results/falscher-alias.txt",
    "workspace:backups/falscher-alias.txt",
  ]) {
    const refusedWrite = await execute(
      "workspace_file_write_text",
      { ref: forbiddenRef, text: "no\n" },
      1_000,
    );
    assert.equal(refusedWrite.ok, false, `${forbiddenRef} darf nicht ueber den Textwriter beschrieben werden`);
  }

  const areaConflict = await execute(
    "workspace_file_read_text",
    { ref: "documents:rechnung.txt", area: "documents" },
    1_000,
  );
  assert.equal(areaConflict.ok, false);
  assert.match(areaConflict.error, /area.*nicht zusammen/i);

  assert.equal(
    redactResourcePaths(roots, join(roots.results, "erfassung.json")),
    "results:erfassung.json",
  );
  assert.equal(
    redactResourcePaths(roots, join(roots.backups, "archiv", "pruefsummen.csv")),
    "backups:archiv/pruefsummen.csv",
  );
  const embedded = redactResourcePaths(
    roots,
    `Fehler in ${join(roots.results, "unterordner", "erfassung.json")}`,
  );
  assert(!embedded.includes(workspaceDir), "Eingebettete Fehlermeldung darf keinen kanonischen Root enthalten");
  assert.match(embedded, /results:unterordner\/erfassung\.json/);

  const lateCaseDir = join(temporary, "spaeter-eingebundene-faelle");
  const lateExecute = createApiExecutor(
    {
      host: "127.0.0.1",
      port: 43128,
      token: "late-root-token-with-at-least-24-characters",
      configPath,
      caseDir: lateCaseDir,
      workspaceDir: join(temporary, "late-workspace"),
      resultDir: join(temporary, "late-results"),
    },
    async () => ({ ok: true, path: join(lateCaseDir, "spaeter.Gew2025") }),
  );
  const beforeMount = await lateExecute("list_cases", {}, 1_000);
  assert.equal(beforeMount.path, "cases:spaeter.Gew2025", "auch ein noch fehlender Fallroot muss PC-blind bleiben");
  mkdirSync(lateCaseDir, { recursive: true });
  const afterMount = await lateExecute("list_cases", {}, 1_000);
  assert.equal(afterMount.path, "cases:spaeter.Gew2025", "spaeter eingebundener Fallroot muss neu erkannt werden");

  process.stdout.write("Ressourcenreferenzen: 5 Bereiche, stabile Rueckgaben und Escape-Sperren bestanden\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
