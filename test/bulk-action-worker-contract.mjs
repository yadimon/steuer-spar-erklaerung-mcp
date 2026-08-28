import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { directWorker, ssePids, worker } from "./direct-worker-helpers.mjs";

const pidsBefore = ssePids();
const plan = {
  schemaVersion: 1,
  planKind: "fill-fields",
  stopOnError: true,
  rollback: "best-effort",
  finalReadback: true,
  actions: [
    {
      id: "field:bezeichnung",
      operation: "tracked_set_value",
      args: {
        pageId: "gew.fahrzeug",
        fieldId: "bezeichnung",
        expectedBefore: "Alt",
        value: "Neu",
        expectedAfter: "Neu",
      },
    },
    {
      id: "field:kennzeichen",
      operation: "tracked_set_value",
      args: {
        pageId: "gew.fahrzeug",
        fieldId: "kennzeichen",
        expectedBefore: "N-OLD",
        value: "N-NEW",
        expectedAfter: "N-NEW",
      },
    },
  ],
  finalReadbackPlan: { operation: "known_page_state", args: { pageId: "gew.fahrzeug" } },
};

const result = directWorker("bulk_action", plan);
assert.equal(result.ok, false, "Ohne geoeffneten Steuerfall muss die erste Aktion fail-closed abbrechen.");
assert.equal(result.planKind, "fill-fields");
assert.equal(result.failedAction?.index, 0);
assert.equal(result.skipped?.length, 1);
assert(result.finalReadback && typeof result.finalReadback === "object",
  "Der Worker muss nach einer gefangenen Teiloperation bis zum finalen Readback weiterlaufen.");
assert.equal(result.performance?.workerProcessCount, 1);
assert.equal(result.performance?.internalOperationCount, 2,
  "Eine fehlgeschlagene Aktion plus finaler Readback muessen im selben Worker gemessen werden.");
assert(!JSON.stringify(result).includes("SSE_INTERNAL_OPERATION_RESULT_CAPTURED"),
  "Der interne Capture-Sentinel darf nie den Transport verlassen.");

const rejected = directWorker("bulk_action", {
  ...plan,
  actions: [{ operation: "click", args: { aid: "freier-selektor" } }],
});
assert.equal(rejected.ok, false);
assert.equal(rejected.kind, "bad-args");
assert.equal(rejected.performance, undefined,
  "Ein nicht typisierter Plan muss vollstaendig vor der ersten Teiloperation abgewiesen werden.");

const receiptSource = readFileSync(worker);
const receiptWorkerText = receiptSource.toString("utf8");
assert(receiptWorkerText.includes("$metrics.fullUiReadbackCount++") &&
  receiptWorkerText.includes("$expectedContentFingerprint") &&
  receiptWorkerText.includes("$actualContentFingerprint -ceq $expectedContentFingerprint") &&
  receiptWorkerText.includes("$rowMatches.Count -eq 1"),
"Beleg-Bulk muss jede bereits direkt verifizierte Mutation im abschliessenden Voll-Listenread eindeutig und inhaltsidentisch rebound binden.");
assert(receiptWorkerText.includes("Get-SSEReceiptManagerOpenDetailBinding") &&
  receiptWorkerText.includes("Close-SSEReceiptManagerDetailView") &&
  receiptWorkerText.includes("$failedDetailClose = Close-SSEReceiptManagerDetailView") &&
  receiptWorkerText.includes("method='already-open-detail'") &&
  receiptWorkerText.includes("$action -in @('imported','updated')") &&
  receiptWorkerText.includes("$expectedVat -ceq '0' -and -not $observedVat"),
"Beleg-Bulk muss die offene Nach-Update-Detailbindung wiederverwenden, einen danach scheiternden vorhandenen Beleg als Teilmutation melden und Qt-leer als kanonischen Null-USt-Satz lesen.");
const receiptResult = directWorker("receipt_manager_bulk_upsert", {
  items: [{
    resourceRef: "documents:synthetic.pdf",
    expectedPath: worker,
    expectedHash: createHash("sha256").update(receiptSource).digest("hex"),
    identity: { exactTitle: "Synthetischer Beleg", documentNumber: "SYN-1" },
    values: { title: "Synthetischer Beleg", documentNumber: "SYN-1" },
  }],
  acknowledgeBulkUpsert: true,
  stopOnError: true,
});
assert.equal(receiptResult.ok, false);
assert.equal(receiptResult.planKind, "receipt-manager-bulk-upsert");
assert.equal(receiptResult.failedAction?.stage, "initial-list");
assert.equal(receiptResult.performance?.workerProcessCount, 1);
assert.equal(receiptResult.performance?.internalOperationCount, 1);
assert.deepEqual(receiptResult.performance?.internalTimings?.map((entry) => entry.operation), ["receipt_manager_list"]);
assert.equal(receiptResult.performance?.internalTimings?.reduce((sum, entry) => sum + entry.ms, 0),
  receiptResult.performance?.sseActionMs,
  "Phasenmessungen muessen die komplette gemessene interne Aktionszeit erklaeren.");
assert(!JSON.stringify(receiptResult).includes("SSE_INTERNAL_OPERATION_RESULT_CAPTURED"));

assert.equal(ssePids(), pidsBefore, "Der Bulk-Vertrag darf keine SSE-Instanz starten oder beenden.");
process.stdout.write("Bulk-Worker: atomare Aufnahme, interner Capture und Ein-Prozess-Messung bestanden\n");
