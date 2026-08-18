import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desktopMarkerState, directWorker, ssePids } from "./direct-worker-helpers.mjs";

const pidsBefore = ssePids();
const markerBefore = desktopMarkerState();
const fileRoot = mkdtempSync(join(tmpdir(), "sse-direct-file-guards-"));
try {
  const sourcePath = join(fileRoot, "quelle.Gew2025");
  const targetPath = join(fileRoot, "ziel.Gew2025");
  const workingCopyPath = join(fileRoot, "arbeitskopie.Gew2025");
  writeFileSync(sourcePath, "synthetische-quelle\n", "utf8");
  writeFileSync(targetPath, "vorhandenes-ziel\n", "utf8");
  const sourceHash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex").toUpperCase();
  const copied = directWorker("make_working_copy", {
    source: sourcePath, target: workingCopyPath, expectedSourceHash: sourceHash,
  });
  assert(copied.ok === true && copied.verified === true && copied.targetHash === sourceHash,
    `Direkte Arbeitskopie war nicht bytegleich verifiziert: ${JSON.stringify(copied)}`);
  const duplicateCopy = directWorker("make_working_copy", {
    source: sourcePath, target: workingCopyPath, expectedSourceHash: sourceHash,
  });
  assert(duplicateCopy.ok === false && duplicateCopy.kind === "exists" &&
    createHash("sha256").update(readFileSync(workingCopyPath)).digest("hex").toUpperCase() === sourceHash,
  `Vorhandene Arbeitskopie wurde ersetzt oder falsch klassifiziert: ${JSON.stringify(duplicateCopy)}`);
  const interferedCopyPath = join(fileRoot, "fremd-geaendert.Gew2025");
  const interferedCopy = directWorker("make_working_copy", {
    source: sourcePath, target: interferedCopyPath, expectedSourceHash: sourceHash,
  }, { SSE_MCP_TEST_FAULT: "working-copy-after-copy" });
  assert(interferedCopy.ok === false && interferedCopy.kind === "postcondition-failed" &&
    interferedCopy.targetStillOwned === false && interferedCopy.rolledBack === false && existsSync(interferedCopyPath),
  `Fremd geaendertes Arbeitskopieziel wurde blind geloescht: ${JSON.stringify(interferedCopy)}`);
  const overwriteAttempt = directWorker("save_as", {
    expectedSourcePath: sourcePath,
    expectedSourceHash: sourceHash,
    targetPath,
    allowOverwrite: true,
    expectedTargetHash: createHash("sha256").update(readFileSync(targetPath)).digest("hex").toUpperCase(),
  });
  assert(overwriteAttempt.ok === false && overwriteAttempt.kind === "exists",
    `Direkter save_as-Bypass akzeptierte ein vorhandenes Ziel: ${JSON.stringify(overwriteAttempt)}`);
  assert.equal(readFileSync(targetPath, "utf8"), "vorhandenes-ziel\n");
  const collectPath = join(fileRoot, "vorhandener-teilstand.json");
  writeFileSync(collectPath, '{"fremd":true}\n', "utf8");
  const collectBefore = readFileSync(collectPath);
  const collectOverwrite = directWorker("collect", {
    path: collectPath,
    maxPages: 1,
    expectedOutputHashBefore: createHash("sha256").update(collectBefore).digest("hex").toUpperCase(),
  });
  assert(collectOverwrite.ok === false && collectOverwrite.kind === "blocked",
    `Direkter collect-Bypass akzeptierte eine alte Overwrite-Freigabe: ${JSON.stringify(collectOverwrite)}`);
  assert.deepEqual(readFileSync(collectPath), collectBefore, "Bestehender collect-Teilstand wurde veraendert.");

  const invalidUtf8 = join(fileRoot, "ungueltig.json");
  writeFileSync(invalidUtf8, Buffer.from([0x7b, 0x80, 0x7d]));
  const invalidUtf8Hash = createHash("sha256").update(readFileSync(invalidUtf8)).digest("hex").toUpperCase();
  const invalidVerify = directWorker("verify", {
    from: invalidUtf8, expectedSourceHash: invalidUtf8Hash,
    erwartungen: [{ seite: "Seite", label: "Feld", wert: "1" }],
  });
  assert(invalidVerify.ok === false && invalidVerify.kind === "invalid-source" && /UTF-8|lesbar/.test(invalidVerify.error ?? ""),
    `Verify akzeptierte ungueltiges UTF-8: ${JSON.stringify(invalidVerify)}`);

  const oversizedJson = join(fileRoot, "zu-gross.json");
  writeFileSync(oversizedJson, "{}", "utf8");
  truncateSync(oversizedJson, 16 * 1024 * 1024 + 1);
  const oversizedHash = createHash("sha256").update(readFileSync(oversizedJson)).digest("hex").toUpperCase();
  const oversizedVerify = directWorker("verify", {
    from: oversizedJson, expectedSourceHash: oversizedHash,
    erwartungen: [{ seite: "Seite", label: "Feld", wert: "1" }],
  });
  assert(oversizedVerify.ok === false && oversizedVerify.kind === "invalid-source" && /groesser/.test(oversizedVerify.error ?? ""),
    `Verify akzeptierte eine uebergrosse JSON-Quelle: ${JSON.stringify(oversizedVerify)}`);
} finally {
  rmSync(fileRoot, { recursive: true, force: true });
}

assert.equal(ssePids(), pidsBefore, "Ein Dateigrenztest hat eine SSE-PID erzeugt oder beendet.");
assert.equal(desktopMarkerState(), markerBefore, "Ein Dateigrenztest hat den Desktop-Marker veraendert.");
process.stdout.write("Direkter Worker: exklusive Datei-, Kopie- und Ergebnisgrenzen bestanden\n");
