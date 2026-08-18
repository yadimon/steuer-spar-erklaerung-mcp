import assert from "node:assert/strict";
import { desktopMarkerState, directWorker, ssePids } from "./direct-worker-helpers.mjs";

const pidsBefore = ssePids();
const markerBefore = desktopMarkerState();

for (const [operation, args] of [
  ["snapshot", { maxNodes: 5_001 }],
  ["goto", { ziel: "Einnahmen", maxSteps: 201 }],
  ["table_read", { maxRows: 1_001 }],
  ["menu_click", { name: "Extras", waitMs: 10_001 }],
  ["click", { name: "Weiter", waitMs: 10_001 }],
  ["click_point", { name: "Prüfer", waitMs: 10_001 }],
  ["tree_top", { steps: 81 }],
  ["tree_scroll", { steps: 0 }],
  ["read_page", { minX: 500, maxX: 499 }],
]) {
  const bounded = directWorker(operation, args);
  assert(bounded.ok === false && bounded.kind === "bad-args",
    `Direkter Worker akzeptierte unbeschraenkte Argumente fuer '${operation}': ${JSON.stringify(bounded)}`);
}

assert.equal(ssePids(), pidsBefore, "Ein Ressourcen-Grenztest hat trotzdem eine SSE-PID erzeugt oder beendet.");
assert.equal(desktopMarkerState(), markerBefore, "Ein Ressourcen-Grenztest hat den Desktop-Marker veraendert.");
process.stdout.write("Direkter Worker: numerische Ressourcen- und Wartegrenzen bestanden\n");
