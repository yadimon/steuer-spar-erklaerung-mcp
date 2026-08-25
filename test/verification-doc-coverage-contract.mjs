import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const coverage = JSON.parse(readFileSync(new URL("./operation-coverage.json", import.meta.url), "utf8"));
const verification = readFileSync(new URL("../docs/VERIFIKATION.md", import.meta.url), "utf8");
const operations = Object.entries(coverage.operations ?? {});
const live = operations.filter(([, value]) => value.live === "functional");
const missing = operations.filter(([, value]) => value.live !== "functional").map(([name]) => name).sort();
const snapshotVm = operations.filter(([, value]) => value.liveEvidence === "snapshot-vm").map(([name]) => name).sort();

assert(operations.length > 0, "Operation-Coverage-Ledger ist leer");
assert.equal(live.length + missing.length, operations.length);
assert.deepEqual(snapshotVm, [
  "receipt_manager_action",
  "receipt_manager_delete",
  "receipt_manager_import",
  "receipt_manager_list",
  "receipt_manager_read",
], "Der externe Live-Nachweis muss auf die fuenf BelegManager-Operationen begrenzt bleiben.");

const liveClaim = verification.match(
  /Dort stehen am \d{4}-\d{2}-\d{2} (\d+) der (\d+)\s+Operationen/u,
);
assert(liveClaim, "VERIFIKATION.md nennt keinen aktuellen Live-Funktionsstand");
assert.deepEqual(
  liveClaim.slice(1).map(Number),
  [live.length, operations.length],
  "Aktueller Live-Funktionsstand widerspricht operation-coverage.json",
);

const missingClaim = verification.match(
  /Gemessen am \d{4}-\d{2}-\d{2} sind noch (\d+) der (\d+) Operationen nicht\s+live-funktional/u,
);
assert(missingClaim, "VERIFIKATION.md nennt keine aktuelle Live-Restluecke");
assert.deepEqual(
  missingClaim.slice(1).map(Number),
  [missing.length, operations.length],
  "Dokumentierte Live-Restluecke widerspricht operation-coverage.json",
);

const missingStart = verification.indexOf("Noch nie erfolgreich live");
const missingEnd = verification.indexOf("\n\n", missingStart);
assert(missingStart >= 0 && missingEnd > missingStart, "Abschnitt mit fehlenden Live-Operationen ist nicht eindeutig");
const documentedMissing = [...verification.slice(missingStart, missingEnd).matchAll(/`([a-z][a-z0-9_]*)`/gu)]
  .map((match) => match[1])
  .sort();
assert.deepEqual(documentedMissing, missing,
  "Dokumentierte Namen der Live-Restluecke widersprechen operation-coverage.json");

process.stdout.write(
  `Verifikationsdoku: ${live.length}/${operations.length} live, davon ${snapshotVm.length} aus der Snapshot-VM, ` +
  `${missing.length} Restoperationen ledgergebunden.\n`,
);
