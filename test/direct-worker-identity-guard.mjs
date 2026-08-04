import assert from "node:assert/strict";
import { desktopMarkerState, directWorker, ssePids } from "./direct-worker-helpers.mjs";

const pidsBefore = ssePids();
const markerBefore = desktopMarkerState();

for (const identityArgs of [
  { hwnd: 1.5 },
  { pid: 2_147_483_648 },
  { expectedMainHwnd: -1 },
]) {
  const identity = directWorker("health", identityArgs);
  assert(identity.ok === false && identity.kind === "bad-args",
    `Direkter Worker akzeptierte ungueltige Windows-Identitaet: ${JSON.stringify(identityArgs)}`);
}

assert.equal(ssePids(), pidsBefore, "Ein Identitaets-Grenztest hat trotzdem eine SSE-PID erzeugt oder beendet.");
assert.equal(desktopMarkerState(), markerBefore, "Ein Identitaets-Grenztest hat den Desktop-Marker veraendert.");
process.stdout.write("Direkter Worker: HWND-, PID- und Main-Window-Identitaetsgrenzen bestanden\n");
