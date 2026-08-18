import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Mindestmenge pro Profil für echte, nicht allgemein mutierende API-Wege.
 * Beide Jahre müssen den Kern aus Ergebnislesen, Prüfer, UStVA und
 * hashgebundener Wegwerfkopie selbst belegen. Die gleichartige Menge macht
 * den Nachweis vergleichbar, bedeutet aber keine Gleichstellung der Profile:
 * 2024 bleibt für Tabellen-/Feldmutationen weiterhin experimental gesperrt.
 */
const CORE_READ_OPERATIONS = Object.freeze([
  "capabilities", "health", "case_hash", "make_working_copy", "launch", "ui_state", "page",
  "result_details", "read_page", "subpages", "find", "windows", "help", "read_table", "read_full",
  "scroll_page", "scroll", "table_read", "snapshot", "accessibility_probe", "snapshot_compare", "goto",
  "ustva_read", "dialog_list", "checker_run", "checker_results", "checker_open", "checker_reset",
  "checker_close", "checker_detail", "known_page_state", "positions", "check", "tree_scroll", "tree_top",
  "warning_popup_read", "get_value", "close",
]);

export const PROFILE_LIVE_READ_OPERATIONS = Object.freeze({
  "2024": CORE_READ_OPERATIONS,
  "2025": CORE_READ_OPERATIONS,
});
export const EXPERIMENTAL_2024_LIVE_READ_OPERATIONS = PROFILE_LIVE_READ_OPERATIONS["2024"];

export function verifyProfileReadCoverage(traceDirectory, profileId) {
  const required = PROFILE_LIVE_READ_OPERATIONS[profileId];
  assert(required, `Kein profilgenauer Lesevertrag fuer '${profileId}' definiert.`);
  const successful = new Set();
  const files = readdirSync(traceDirectory).filter((name) => name.endsWith(".jsonl"));
  assert(files.length > 0, `Kein Operationsprotokoll vorhanden; reale ${profileId}-Abdeckung ist nicht nachweisbar.`);
  for (const name of files) {
    for (const line of readFileSync(join(traceDirectory, name), "utf8").split("\n")) {
      if (!line) continue;
      const entry = JSON.parse(line);
      if (entry.label === "worker" && entry.profileId === profileId && entry.ok === true) {
        successful.add(entry.operation);
      }
    }
  }
  const missing = required.filter((operation) => !successful.has(operation));
  assert.deepEqual(
    missing,
    [],
    `${profileId}-Profil hat nicht jede zugesicherte Leseoperation real erfolgreich ausgefuehrt:\n  ${missing.join("\n  ")}`,
  );
  return { profileId, operations: required.length, successful: successful.size };
}

/** Rückwärtskompatible Benennung für externe 2024-Verifikationsaufrufe. */
export function verifyExperimentalProfileReadCoverage(traceDirectory, profileId) {
  assert.equal(profileId, "2024", "Dieser Nachweis ist bewusst nur fuer den experimentellen 2024-Lesevertrag definiert.");
  return verifyProfileReadCoverage(traceDirectory, profileId);
}
