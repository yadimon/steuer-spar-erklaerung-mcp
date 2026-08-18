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
assert(commit.includes("$vp.SetValue($Value)"), "ValuePattern-Schreibphase fehlt.");
assert(commit.includes("SelectionItemPattern"), "Exakte Qt-Tabellenzellenauswahl fehlt.");
assert(commit.includes("selected-item-focused-table"), "Qt-Tabellenfokus wird nicht streng bestaetigt.");
assert(commit.includes("0x000F0001") && commit.includes("0xC00F0001"), "Posted-Tab-Commit fehlt.");
assert(commit.includes("foregroundLeaseUsed=$false") && commit.includes("physicalInputUsed=$false"),
  "Focusless-Telemetrie deklariert die Eingabegrenze nicht.");
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

process.stdout.write("Focusless-Commit-Vertrag: profilgebunden, ohne sichtbare/physische Eingabe und ohne unbewiesenen WM_CHAR-Tabellenfallback.\n");
