import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../powershell/sse-worker.ps1", import.meta.url), "utf8");
const profile = JSON.parse(readFileSync(new URL("../profiles/2025/page-objects.json", import.meta.url), "utf8"));
const commit = /function Commit-TrackedValueFocusless\([\s\S]*?\n\}\r?\n\r?\nfunction Get-SSETrackedDateParts/u.exec(worker)?.[0];
assert(commit, "Focusless-Commitfunktion fehlt.");

for (const forbidden of [
  "Show-SSEWindow", "SetForegroundWindow", "AttachThreadInput", "SendKeys",
  "SetCursorPos", "mouse_event", "keybd_event", "Click-VerifiedPoint",
]) {
  assert(!commit.includes(forbidden), `Focusless-Commit darf ${forbidden} nicht verwenden.`);
}
for (const removedFallback of ["WM_CHAR", "VK_F2", "VK_END", "VK_BACK", "verified-posted-char-replace"]) {
  assert(!commit.includes(removedFallback), `Nicht bewiesener Tastatur-Fallback blieb aktiv: ${removedFallback}`);
}
// Eine Tabellenzelle uebernimmt ValuePattern direkt in ihr Modell. Auswahl und
// Tabellenfokus gehoeren deshalb nicht mehr zum Commit; der Fokusnachweis bleibt
// dem Feld vorbehalten, das seinen Wert erst mit dem eingereihten Tab uebernimmt.
for (const removedCellFocus of ["SelectionItemPattern", "selected-item-focused-table", "selectedByPattern"]) {
  assert(!commit.includes(removedCellFocus), `Zellschreibweg haengt weiter an Auswahl oder Tabellenfokus: ${removedCellFocus}`);
}
const methodCount = (method) => commit.split(`'${method}'`).length - 1;
assert.equal(methodCount("verified-focusless-value-pattern"), 1, "Zellschreibweg meldet seine eigene Methode nicht genau einmal.");
assert.equal(methodCount("verified-focusless-value-pattern-tab"), 1, "Feldschreibweg mit eingereihtem Tab fehlt.");
assert.equal(commit.split("$vp.SetValue($Value)").length - 1, 1, "Beide Schreibwege teilen genau eine ValuePattern-Schreibung.");
assert(commit.includes("0x000F0001") && commit.includes("0xC00F0001"), "Posted-Tab-Commit fehlt.");
assert.equal(commit.split("foregroundLeaseUsed=$false; physicalInputUsed=$false").length - 1, 2,
  "Focusless-Telemetrie deklariert die Eingabegrenze nicht fuer beide Schreibwege.");
assert(!worker.includes("SSE_ENABLE_WM_CHAR_PROBE"), "Experimenteller Hidden-Schreibschalter blieb im Worker.");
assert(worker.includes("Resolve-SSEFocuslessCommitPolicy $heading $node $valueKind $sumChecks $beforeTree"),
  "Hidden-Transaktion ist nicht an den Profilkatalog gebunden.");

const policy = profile.focuslessCommits?.["gew.beitraege_gebuehren_abgaben.betrag"];
assert(policy, "Live-getestete Focusless-Policy fehlt.");
assert.equal(policy.heading, "Beiträge, Gebühren und Abgaben");
assert.equal(policy.controlType, "DataItem");
assert.equal(policy.valueKind, "currency");
assert.equal(policy.automationIdSuffix, ".Bankgebuehren.Tab");
assert.equal(policy.columnHeader, "Betrag");
assert.equal(policy.resultTracking, false);
assert.deepEqual(policy.requiredSumChecks, [{ label: "Summe", occurrence: 1 }]);

// Der Katalog nennt je Steuerelementart den Weg, den der Worker tatsaechlich
// geht. Ein Eintrag, der einen anderen Weg verspricht, waere eine falsche Zusage.
const COMMIT_METHOD_BY_CONTROL_TYPE = { DataItem: "value-pattern", Edit: "value-pattern-plus-posted-tab" };
const FOCUS_PROOF_BY_CONTROL_TYPE = { DataItem: false, Edit: true };
for (const [policyId, entry] of Object.entries(profile.focuslessCommits)) {
  assert.equal(entry.commitMethod, COMMIT_METHOD_BY_CONTROL_TYPE[entry.controlType],
    `Focusless-Policy ${policyId} nennt nicht den Schreibweg ihrer Steuerelementart.`);
  assert.equal(entry.verification.some((step) => /focus/u.test(step)), FOCUS_PROOF_BY_CONTROL_TYPE[entry.controlType],
    `Focusless-Policy ${policyId} nennt einen Fokusnachweis, den ihr Schreibweg nicht fuehrt, oder verschweigt ihn.`);
  for (const proof of ["exact-runtime-id-and-automation-id", "field-readback", "page-total-readback", "dirty-state",
    "rollback-on-postcondition-failure"]) {
    assert(entry.verification.includes(proof), `Focusless-Policy ${policyId} nennt den Nachweis ${proof} nicht.`);
  }
}

process.stdout.write("Focusless-Commit-Vertrag: profilgebunden, ohne sichtbare/physische Eingabe, Tabellenzelle ohne Auswahl, Fokus und Tab.\n");
