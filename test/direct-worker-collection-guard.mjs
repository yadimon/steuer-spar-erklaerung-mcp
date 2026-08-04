import assert from "node:assert/strict";
import { desktopMarkerState, directWorker, ssePids } from "./direct-worker-helpers.mjs";

const pidsBefore = ssePids();
const markerBefore = desktopMarkerState();

for (const [operation, args] of [
  ["snapshot", { types: Array.from({ length: 51 }, () => "Button") }],
  ["table_add", { werte: Array.from({ length: 101 }, () => "x") }],
  ["verify", { erwartungen: Array.from({ length: 501 }, () => null) }],
  ["vast_apply", { plan: Array.from({ length: 501 }, () => null) }],
  ["table_add", { werte: "kein-array" }],
  ["vast_row_details", { occurrence: 1_001 }],
]) {
  const collection = directWorker(operation, args);
  assert(collection.ok === false && collection.kind === "bad-args",
    `Direkter Worker akzeptierte unbeschraenkte Sammlung fuer '${operation}': ${JSON.stringify(collection)}`);
}

assert.equal(ssePids(), pidsBefore, "Ein Sammlungs-Grenztest hat trotzdem eine SSE-PID erzeugt oder beendet.");
assert.equal(desktopMarkerState(), markerBefore, "Ein Sammlungs-Grenztest hat den Desktop-Marker veraendert.");
process.stdout.write("Direkter Worker: Sammlungs-, Tabellen-, VaSt- und Verifikationsgrenzen bestanden\n");
