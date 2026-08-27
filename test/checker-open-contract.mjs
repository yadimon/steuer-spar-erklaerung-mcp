import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHECKER_OPEN_WORKER_OPERATION,
  executeCheckerOpen,
} from "../dist/checker-executor.js";
import { directWorker, ssePids } from "./direct-worker-helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const workerSource = readFileSync(join(here, "..", "powershell", "sse-worker.ps1"), "utf8");

// Der oeffentliche Aufruf kompiliert nach der API-Validierung exakt einen
// privaten Plan. Weder freie Aktionen noch UI-Selektoren gelangen hinein.
{
  const calls = [];
  const signal = new AbortController().signal;
  const result = await executeCheckerOpen({ name: "ELSTER-Pflicht für Selbstständige", hwnd: 4242 }, 12_345, signal,
    async (operation, args, timeoutMs, nestedSignal) => {
      calls.push({ operation, args, timeoutMs, signal: nestedSignal });
      return {
        ok: true,
        meldung: args.name,
        text: "Volltext",
        bildBase64: "aW1hZ2U=",
        resultingState: "detail-verified",
        cleanupRequired: false,
        performance: { workerProcessCount: 1, internalOperationCount: 3, reusedReadbackCount: 1 },
      };
    });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, CHECKER_OPEN_WORKER_OPERATION);
  assert.deepEqual(calls[0].args, {
    schemaVersion: 1,
    planKind: "checker-open",
    name: "ELSTER-Pflicht für Selbstständige",
    hwnd: 4242,
  });
  assert.equal(calls[0].timeoutMs, 12_345);
  assert.equal(calls[0].signal, signal);
  assert.equal(result.ok, true);
  assert.equal(result.kontrollbildEnthalten, true);
  assert.equal(result.performance.workerProcessCount, 1);
  assert.equal(result.performance.reusedReadbackCount, 1);
}

// Ein bereits abgebrochener Aufruf startet keinen Prozess. Nach einem Fehler
// am Worker-Rand ist der Zustand dagegen unbekannt und es gibt keinen Retry.
{
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const aborted = await executeCheckerOpen({ name: "Hinweis" }, 5_000, controller.signal, async () => {
    calls += 1;
    return { ok: true };
  });
  assert.equal(calls, 0);
  assert.equal(aborted.kind, "aborted");
  assert.equal(aborted.resultingState, "unchanged");
  assert.equal(aborted.cleanupRequired, false);
  assert.equal(aborted.performance.workerProcessCount, 0);

  const timeout = new Error("synthetischer Timeout nach Workerstart");
  timeout.kind = "timeout";
  const timedOut = await executeCheckerOpen({ name: "Hinweis" }, 5_000, undefined, async () => {
    calls += 1;
    throw timeout;
  });
  assert.equal(calls, 1, "Timeout darf keinen internen oder externen Retry starten.");
  assert.equal(timedOut.kind, "timeout");
  assert.equal(timedOut.resultingState, "unknown");
  assert.equal(timedOut.cleanupRequired, true);
  assert.equal(timedOut.performance.workerProcessCount, 1);
}

// Auch ein kanonischer Workerfehler bleibt in seiner Art erhalten; der
// additive Planvertrag darf ihn nicht in einen scheinbaren Erfolg umdeuten.
{
  const missing = await executeCheckerOpen({ name: "Nicht vorhanden" }, 5_000, undefined, async () => ({
    ok: false,
    kind: "checker-message",
    error: "Meldung fehlt.",
    resultingState: "checker-active",
    cleanupRequired: false,
    performance: { workerProcessCount: 1, internalOperationCount: 1, internalTimings: [] },
  }));
  assert.equal(missing.ok, false);
  assert.equal(missing.kind, "checker-message");
  assert.equal(missing.resultingState, "checker-active");
  assert.equal(missing.cleanupRequired, false);
}

// Source-Vertrag der privaten PowerShell-Grenze: strikter Plan, explizite
// Policy-Vererbung, kanonische Capture-Schritte und nur der eng gebundene
// checkerReadOnly-Klick. Insbesondere gibt es kein caller-gesteuertes actions[].
assert(workerSource.includes("'checker_open_plan' {"));
assert(workerSource.includes("elseif ($Op -eq 'checker_open_plan') { 'checker_open' }"));
assert(workerSource.includes("Test-SSEExactProperties $a $expectedPlanProperties"));
assert(workerSource.includes("planKind='checker-open'") || workerSource.includes("$payload.planKind = 'checker-open'"));
assert(workerSource.includes("checkerReadOnly=$true"));
assert(workerSource.includes("Invoke-SSEMeasuredPlanOperation $NestedOperation"));
assert(workerSource.includes("$current = $reset") && workerSource.includes("$current = $started"),
  "checker_reset- und checker_run-Ergebnisse muessen ohne sofortigen Doppelread wiederverwendet werden.");
const checkerPlanBlock = workerSource.slice(
  workerSource.indexOf("  'checker_open_plan' {"),
  workerSource.indexOf("  'bulk_action' {"),
);
assert(!checkerPlanBlock.includes("$a.actions"));
assert(!checkerPlanBlock.includes("Arg $a 'aid'"));
assert(!checkerPlanBlock.includes("Arg $a 'rid'"));
assert(checkerPlanBlock.includes("Assert-SSEVerifiedBuildForOperation") === false,
  "Build-Pruefung bleibt zentral in jedem Invoke-SSECapturedOperation statt als leicht vergessbarer Sonderpfad.");
for (const operation of ["checker_run", "click", "click_point"]) {
  assert(workerSource.includes(`'${operation}'`), `${operation} muss im build-drift-geprueften Capture-Katalog stehen.`);
}

// Nicht nur die Sourceform, sondern auch die echte PowerShell-Grenze muss den
// privaten Plan in einem Prozess ausfuehren und dessen kanonischen Fehler
// auffangen. Ohne geoeffnetes SSE-Fenster bleibt dieser Probe rein lesend.
{
  const pidsBefore = ssePids();
  const noWindow = directWorker("checker_open_plan", {
    schemaVersion: 1,
    planKind: "checker-open",
    name: "Synthetische Meldung",
  });
  assert.equal(noWindow.ok, false);
  assert.equal(noWindow.kind, "no-window");
  assert.equal(noWindow.planKind, "checker-open");
  assert.equal(noWindow.resultingState, "unchanged");
  assert.equal(noWindow.cleanupRequired, false);
  assert.equal(noWindow.performance?.workerProcessCount, 1);
  assert.deepEqual(noWindow.performance?.internalTimings?.map((entry) => entry.operation), ["checker_results"]);
  assert(!JSON.stringify(noWindow).includes("SSE_INTERNAL_OPERATION_RESULT_CAPTURED"));
  assert.equal(ssePids(), pidsBefore, "Der Checker-Vertrag darf keine SSE-Instanz starten oder beenden.");
}

process.stdout.write("checker_open: strikter Ein-Worker-Plan, Policy und Fehlervertrag bestanden\n");
