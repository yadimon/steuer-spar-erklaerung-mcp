import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SSE_API_OPERATIONS } from "../dist/api-contract.js";
import { createApiExecutor } from "../dist/api-executor.js";
import { SSE_MCP_TOOL_OPERATIONS } from "../dist/operation-catalog.js";
import {
  RECEIPT_FOREGROUND_BLOCK_REASON,
  SSE_FOCUSLESS_RECEIPT_OPERATIONS,
  SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS,
  SSE_RECEIPT_MANAGER_OPERATIONS,
  receiptBlock,
  receiptInteractionRequirement,
} from "../dist/receipt-interaction-policy.js";

const hash = "A".repeat(64);
const foregroundArguments = {
  receipt_manager_action: { actionId: "showAllReceipts" },
  receipt_manager_read: {
    rowRid: "1.2.3", rowFingerprint: hash, expectedListFingerprint: hash,
  },
  receipt_manager_update: {
    rowRid: "1.2.3", rowFingerprint: hash, expectedListFingerprint: hash,
    expectedDetailFingerprint: hash, values: { title: "Neu" }, acknowledgeUpdate: true,
  },
  receipt_manager_classification_options: {
    rowRid: "1.2.3", rowFingerprint: hash, expectedListFingerprint: hash,
    expectedDetailFingerprint: hash, kind: "categories",
  },
  receipt_manager_classify: {
    rowRid: "1.2.3", rowFingerprint: hash, expectedListFingerprint: hash,
    expectedDetailFingerprint: hash, values: { categories: ["Reisekosten"] },
    acknowledgeClassification: true,
  },
  receipt_manager_link: {
    items: [{ expectedReceiptTitle: "Beleg", linked: true }],
    expectedTargetPage: "Einnahmen/Ausgaben", expectedLinkTarget: "Reisekosten",
    acknowledgeLinkChange: true,
  },
  receipt_manager_import: {
    resourceRef: "documents:not-created.pdf", expectedHash: hash,
    expectedListFingerprint: hash, expectedCountBefore: 0, acknowledgeImport: true,
  },
  receipt_manager_delete: {
    rowRid: "1.2.3", rowFingerprint: hash, expectedListFingerprint: hash,
    expectedCountBefore: 1, acknowledgeDelete: true,
  },
  receipt_manager_bulk_upsert: {
    items: [{
      resourceRef: "documents:not-created.pdf",
      expectedHash: hash,
      identity: { exactTitle: "Beleg", documentNumber: "B-1" },
      values: { title: "Beleg", documentNumber: "B-1" },
    }],
    acknowledgeBulkUpsert: true,
    stopOnError: true,
  },
};

assert.deepEqual(
  [...SSE_FOCUSLESS_RECEIPT_OPERATIONS, ...SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS].sort(),
  [...SSE_RECEIPT_MANAGER_OPERATIONS].sort(),
  "Focusless- und Vordergrundkatalog muessen alle BelegManager-Operationen partitionieren.",
);
assert.deepEqual(
  SSE_API_OPERATIONS.filter((operation) => operation.startsWith("receipt_manager_")).sort(),
  [...SSE_RECEIPT_MANAGER_OPERATIONS].sort(),
  "Der Interaktionskatalog muss jede oeffentliche BelegManager-Operation enthalten.",
);
assert.deepEqual(
  [...new Set(Object.values(SSE_MCP_TOOL_OPERATIONS)
    .filter((operation) => operation.startsWith("receipt_manager_")))].sort(),
  [...SSE_RECEIPT_MANAGER_OPERATIONS].sort(),
  "Der MCP-Katalog darf keine BelegManager-Operation an der Interaktionspolicy vorbeifuehren.",
);
assert.equal(new Set(SSE_RECEIPT_MANAGER_OPERATIONS).size, SSE_RECEIPT_MANAGER_OPERATIONS.length);
assert.equal(new Set(SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS).size, 9);
assert.deepEqual(SSE_FOCUSLESS_RECEIPT_OPERATIONS, ["receipt_manager_list"]);
for (const operation of SSE_RECEIPT_MANAGER_OPERATIONS) {
  assert.equal(
    receiptInteractionRequirement(operation),
    operation === "receipt_manager_list" ? "focusless-read" : "foreground-required",
  );
}
assert.equal(receiptInteractionRequirement("health"), null);
for (const operation of SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS) {
  assert.equal(receiptBlock(operation, foregroundArguments[operation], true), null,
    `${operation}: eine intern verifizierte Lease darf nur den zentralen API-Block oeffnen.`);
}

const temporary = mkdtempSync(join(tmpdir(), "sse-receipt-interaction-"));
let workerCalls = 0;
const config = {
  host: "127.0.0.1",
  port: 43127,
  configPath: join(temporary, "config.json"),
  profileId: "2025",
  caseDir: join(temporary, "cases"),
  workspaceDir: join(temporary, "workspace"),
  documentsDir: join(temporary, "documents"),
  resultDir: join(temporary, "results"),
  backupsDir: join(temporary, "backups"),
};
const execute = createApiExecutor(config, async (operation) => {
  workerCalls += 1;
  return { ok: false, kind: "synthetic-worker", error: `worker reached for ${operation}` };
});

try {
  for (const operation of SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS) {
    const result = await execute(operation, foregroundArguments[operation], 30_000);
    assert.equal(result.ok, false, `${operation}: block result`);
    assert.equal(result.kind, "blocked", `${operation}: block kind`);
    assert.equal(result.reason, RECEIPT_FOREGROUND_BLOCK_REASON, `${operation}: reason`);
    assert.equal(result.retryable, false, `${operation}: retryable`);
    assert.equal(result.interactionRequirement, "foreground-required", `${operation}: interaction`);
    assert.equal(result.mutationStarted, false, `${operation}: mutation`);
    assert.equal(result.resultingState, "unchanged", `${operation}: state`);
    assert.equal(result.cleanupRequired, false, `${operation}: cleanup`);
    assert.equal(result.physicalInputUsed, false, `${operation}: physical input`);
    assert.equal(result.foregroundLeaseUsed, false, `${operation}: foreground lease`);
    assert.match(result.error, /Keine UI wurde geaendert.*nicht automatisch wiederholen/u);
  }
  assert.equal(workerCalls, 0, "Vordergrundpflichtige Operationen duerfen keinen Worker starten.");

  writeFileSync(join(config.workspaceDir, "blocked-receipt.json"), JSON.stringify({
    schemaVersion: 1,
    name: "blocked-receipt",
    resultFile: "unused.json",
    steps: [{
      id: "receipt",
      operation: "receipt_manager_action",
      args: foregroundArguments.receipt_manager_action,
      capture: ["ok", "kind", "reason", "mutationStarted"],
    }],
  }), "utf8");
  const scenario = await execute("scenario_run", {
    scenarioRef: "workspace:blocked-receipt.json",
    resultRef: "results:blocked-receipt-result.json",
  }, 30_000);
  assert.equal(scenario.ok, false, "Ein Szenario darf den zentralen Block nicht umgehen.");
  assert.equal(scenario.result.steps[0].kind, "blocked");
  assert.equal(scenario.result.steps[0].values.reason, RECEIPT_FOREGROUND_BLOCK_REASON);
  assert.equal(scenario.result.steps[0].values.mutationStarted, false);
  assert.equal(workerCalls, 0, "Auch ein verschachtelter Szenarioschritt darf keinen Worker starten.");

  const invalid = await execute("receipt_manager_action", { actionId: "free-selector" }, 30_000);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.kind, "bad-args", "Oeffentliche Argumentvalidierung muss vor dem Policy-Block bleiben.");
  assert.equal(workerCalls, 0);

  const list = await execute("receipt_manager_list", {}, 30_000);
  assert.equal(list.kind, "synthetic-worker", "Die focusless Belegliste muss den Worker weiterhin erreichen.");
  assert.equal(workerCalls, 1);

  const capabilities = await execute("capabilities", {}, 30_000);
  assert.equal(workerCalls, 1, "Faehigkeiten duerfen keinen weiteren Worker starten.");
  assert.equal(capabilities.operationPolicy.receipt_manager_list.availability, "allowed");
  assert.equal(capabilities.operationPolicy.receipt_manager_list.interactionRequirement, "focusless-read");
  for (const operation of SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS) {
    assert.equal(capabilities.operationPolicy[operation].availability, "blocked", `${operation}: capability`);
    assert.equal(capabilities.operationPolicy[operation].interactionRequirement, "foreground-required");
    assert.equal(capabilities.operationPolicy[operation].requiresExperimentalOptIn, false);
  }

  let leasedWorkerCalls = 0;
  const leased = createApiExecutor({ ...config, interactiveReceiptLeaseToken: hash }, async (operation) => {
    leasedWorkerCalls += 1;
    return { ok: false, kind: "synthetic-worker", error: `lease reached worker for ${operation}` };
  });
  const leasedAction = await leased("receipt_manager_action", foregroundArguments.receipt_manager_action, 30_000);
  assert.equal(leasedAction.kind, "synthetic-worker");
  assert.equal(leasedWorkerCalls, 1, "Die interne Lease oeffnet den API-Pfad bis zum weiterhin separat pruefenden Worker.");
  const leasedCapabilities = await leased("capabilities", {}, 30_000);
  assert.equal(leasedCapabilities.profile.interactiveReceiptLeaseActive, true);
  for (const operation of SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS) {
    assert.equal(leasedCapabilities.operationPolicy[operation].availability, "conditional");
    assert.equal(leasedCapabilities.operationPolicy[operation].requiresInteractiveReceiptLease, true);
  }
  const malformedLease = createApiExecutor({ ...config, interactiveReceiptLeaseToken: hash.toLowerCase() }, async () => {
    assert.fail("Eine ungueltige Lease darf den Worker nicht erreichen.");
  });
  assert.equal((await malformedLease(
    "receipt_manager_action", foregroundArguments.receipt_manager_action, 30_000,
  )).kind, "blocked");

  for (const operateExperimental of [false, true]) {
    let experimentalWorkerCalls = 0;
    const experimental = createApiExecutor({
      ...config,
      profileId: "2024",
      operateExperimental,
      workspaceDir: join(temporary, `workspace-2024-${operateExperimental}`),
      documentsDir: join(temporary, `documents-2024-${operateExperimental}`),
      resultDir: join(temporary, `results-2024-${operateExperimental}`),
      backupsDir: join(temporary, `backups-2024-${operateExperimental}`),
    }, async () => {
      experimentalWorkerCalls += 1;
      return { ok: true };
    });
    for (const operation of SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS) {
      const result = await experimental(operation, foregroundArguments[operation], 30_000);
      assert.equal(result.reason, RECEIPT_FOREGROUND_BLOCK_REASON,
        `${operation}: experimentelles Profil mit operateExperimental=${operateExperimental}`);
    }
    const invalidExperimental = await experimental(
      "receipt_manager_action",
      { actionId: "free-selector" },
      30_000,
    );
    assert.equal(invalidExperimental.kind, "bad-args");
    assert.equal(experimentalWorkerCalls, 0);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write("BelegManager-Interaktion: neun Vordergrundpfade blockiert, focusless Liste erlaubt\n");
