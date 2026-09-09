import assert from "node:assert/strict";
import { parseNativeDesktopStop, executeNativeDesktopStop } from "../dist/native-desktop-stop.js";
import { createApiExecutor } from "../dist/api-executor.js";
import { loadApiServerConfig } from "../dist/api-config.js";

export async function verifyNativeDesktopStopContract() {
  const options = { package: { loaderPath: "must-not-run.exe", manifest: { buildIdentity: "SyntheticIdentity" } },
    executable: "C:\\Synthetic\\SSE.exe", args: {}, timeoutMs: 30000 };
  const marker = { schemaVersion: 1, owner: "sse", name: "SyntheticStop", pid: 99 };
  const result = { ok: true, hartBeendet: false, desktopMarkeEntfernt: true, markerBeibehalten: false,
    mutationAttempted: true, outcomeUnknown: false, processExited: true, speichernAntwort: null, antwortMethode: null,
    dialogFehler: null, gracefulWaitMs: 100, hauptfensterVorher: 1, hilfsfenster: [],
    loaderBuildIdentity: options.package.manifest.buildIdentity, loaderMs: 200, discardChanges: false, desktop: marker.name, pid: marker.pid };
  assert.equal(parseNativeDesktopStop(result, marker, options).backend, "win32-uia");
  for (const patch of [{ pid: 98 }, { desktop: "Other" }, { processExited: false }, { desktopMarkeEntfernt: false },
    { markerBeibehalten: true }, { mutationAttempted: false }, { outcomeUnknown: true }, { hartBeendet: true },
    { speichernAntwort: "Ja", antwortMethode: "uia-invoke" }, { loaderBuildIdentity: "Other" }, { ok: false }])
    assert.throws(() => parseNativeDesktopStop({ ...result, ...patch }, marker, options));
  const discardOptions = { ...options, args: { discardChanges: true } };
  assert.equal(parseNativeDesktopStop({ ...result, discardChanges: true, speichernAntwort: "Nein", antwortMethode: "uia-invoke" },
    marker, discardOptions).ok, true);
  assert.throws(() => parseNativeDesktopStop({ ...result, discardChanges: true, speichernAntwort: "Speichern", antwortMethode: "uia-invoke" },
    marker, discardOptions));
  const unknown = { ...result, ok: false, processExited: false, desktopMarkeEntfernt: false, markerBeibehalten: true,
    outcomeUnknown: true, kind: "state-unknown", error: "Synthetic interrupted invocation" };
  assert.equal(parseNativeDesktopStop(unknown, marker, options).outcomeUnknown, true);
  assert.equal((await executeNativeDesktopStop({ ...options, args: { save: true } })).kind, "confirmation-required");
  assert.equal((await executeNativeDesktopStop({ ...options, args: { save: true, discardChanges: true } })).kind, "bad-args");
  assert.equal((await executeNativeDesktopStop({ ...options, timeoutMs: 1000 })).kind, "native-deadline");
  const aborted = new AbortController(); aborted.abort();
  assert.equal((await executeNativeDesktopStop({ ...options, signal: aborted.signal })).outcomeUnknown, false);
  const calls = [];
  const execute = createApiExecutor(loadApiServerConfig({}), async () => assert.fail("Native stop must not fall back to Worker"), {
    nativeDesktopStop: async (args, timeoutMs) => { calls.push({ args, timeoutMs }); return unknown; },
  });
  assert.equal((await execute("desktop_stop", { discardChanges: true }, 30000)).outcomeUnknown, true);
  assert.equal(calls.length, 1, "An uncertain close must never be replayed");
  assert.equal(calls[0].args.discardChanges, true); assert.equal(calls[0].timeoutMs, 30000);
  assert.equal((await execute("desktop_stop", { pid: 123 }, 30000)).ok, false);
  assert.equal(calls.length, 1, "Caller-supplied target overrides must fail before dispatch");
}
