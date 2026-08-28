import assert from "node:assert/strict";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createApiExecutor } from "../../dist/api-executor.js";
import { createSseApiServer } from "../../dist/api-server.js";
import { parseApiOperationArgs } from "../../dist/operation-catalog.js";
import { RECEIPT_FOREGROUND_BLOCK_REASON } from "../../dist/receipt-interaction-policy.js";
import { createStatefulSseWorker, seedSyntheticCases } from "../mock/stateful-sse-worker.mjs";
import {
  RECEIPT_WORKLOAD_POPULATIONS,
  REPOSITORY_ROOT,
  createReceiptWorkloadPlan,
  materializeReceiptWorkload,
  readReceiptWorkloadManifest,
  runReceiptWorkloadEquivalence,
  sha256,
  stableJson,
  validateMaterializedReceiptWorkloadManifest,
  validateReceiptWorkloadPlan,
  writeDeterministicDocument,
} from "./receipt-workload.mjs";
import { parseReceiptWorkloadOptions, runReceiptWorkload } from "./run-receipt-workload.mjs";

const expectedScenarioCounts = (count) => ({
  "already-linked-noop": count * 0.06,
  "ambiguous-identity": count * 0.02,
  "duplicate-content": count * 0.04,
  "existing-noop": count * 0.10,
  "existing-skip": count * 0.08,
  "existing-update": count * 0.18,
  "invalid-input": count * 0.02,
  "missing-metadata": count * 0.06,
  "new-import": count * 0.36,
  "stale-source-hash": count * 0.02,
  "unsupported-foreign-currency": count * 0.06,
});
const expectedSizeCounts = (count) => ({
  "8192": count * 0.10,
  "65536": count * 0.40,
  "524288": count * 0.30,
  "2097152": count * 0.16,
  "8388608": count * 0.04,
});

function compactPlan(plan, bytes = 2_048) {
  const compact = {
    ...plan,
    testOnlyCompact: true,
    totalDocumentBytes: plan.count * bytes,
    documentSizeCounts: { [String(bytes)]: plan.count },
    items: plan.items.map((item) => ({ ...item, bytes })),
  };
  delete compact.planFingerprint;
  compact.planFingerprint = sha256(stableJson(compact));
  return compact;
}

function publicItem(item, serial) {
  return {
    resourceRef: `documents:synthetic-${serial}.pdf`,
    expectedHash: "A".repeat(64),
    identity: item.identity,
    onExisting: item.onExisting,
    values: item.values,
    ...(item.classification ? { classification: item.classification } : {}),
  };
}

function blockShape(value) {
  return {
    ok: value.ok,
    kind: value.kind,
    reason: value.reason,
    retryable: value.retryable,
    interactionRequirement: value.interactionRequirement,
    mutationStarted: value.mutationStarted,
    resultingState: value.resultingState,
    cleanupRequired: value.cleanupRequired,
    physicalInputUsed: value.physicalInputUsed,
    foregroundLeaseUsed: value.foregroundLeaseUsed,
  };
}

const expectedBlock = {
  ok: false,
  kind: "blocked",
  reason: RECEIPT_FOREGROUND_BLOCK_REASON,
  retryable: false,
  interactionRequirement: "foreground-required",
  mutationStarted: false,
  resultingState: "unchanged",
  cleanupRequired: false,
  physicalInputUsed: false,
  foregroundLeaseUsed: false,
};

test("receipt workload generator is deterministic and has exact canonical quotas", () => {
  for (const count of RECEIPT_WORKLOAD_POPULATIONS) {
    const first = createReceiptWorkloadPlan({ count, seed: "canonical-20260828" });
    const second = createReceiptWorkloadPlan({ count, seed: "canonical-20260828" });
    assert.deepEqual(second, first);
    assert.deepEqual(first.scenarioCounts, expectedScenarioCounts(count));
    assert.deepEqual(first.documentSizeCounts, expectedSizeCounts(count));
    assert.equal(first.items.length, count);
    assert.equal(first.items.every((item) => !item.relativePath.includes("\\") && item.relativePath.startsWith("documents/")), true);
    assert.equal(new Set(first.items.map((item) => item.relativePath.toLocaleLowerCase("en-US"))).size, count);
    assert.equal(new Set(first.items.map((item) => item.logicalId)).size, count);
    assert.match(first.planFingerprint, /^[A-F0-9]{64}$/u);
    assert(!/[A-Z]:\\|Users\\|sse-lab/iu.test(JSON.stringify(first)), "Plan must contain no machine path.");
    const duplicates = first.items.filter((item) => item.scenario === "duplicate-content");
    for (let index = 0; index < duplicates.length; index += 2) {
      assert.equal(duplicates[index].contentKey, duplicates[index + 1].contentKey);
      assert.equal(duplicates[index].bytes, duplicates[index + 1].bytes);
      assert.notDeepEqual(duplicates[index].identity, duplicates[index + 1].identity);
    }
  }
  assert.notEqual(
    createReceiptWorkloadPlan({ count: 50, seed: "canonical-20260828" }).planFingerprint,
    createReceiptWorkloadPlan({ count: 50, seed: "different-20260828" }).planFingerprint,
  );
  assert.throws(() => createReceiptWorkloadPlan({ count: 51, seed: "canonical-20260828" }), /count must be/u);
  assert.throws(() => createReceiptWorkloadPlan({ count: 50, seed: "C:\\private" }), /path-free token/u);
  const tampered = structuredClone(createReceiptWorkloadPlan({ count: 50, seed: "canonical-20260828" }));
  tampered.items[0].relativePath = "documents/../escape.pdf";
  assert.throws(() => validateReceiptWorkloadPlan(tampered), /unsafe relative path/u);
});

test("deterministic documents preserve exact bytes, content hashes and no-overwrite behavior", (context) => {
  const root = mkdtempSync(join(tmpdir(), "sse-receipt-document-contract-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const left = join(root, "left.pdf");
  const right = join(root, "right.pdf");
  const different = join(root, "different.pdf");
  const descriptor = { bytes: 12_345, seed: "document-seed", contentKey: "duplicate-1" };
  const leftHash = writeDeterministicDocument(left, descriptor);
  const rightHash = writeDeterministicDocument(right, descriptor);
  const differentHash = writeDeterministicDocument(different, { ...descriptor, contentKey: "different" });
  assert.equal(leftHash, rightHash);
  assert.notEqual(leftHash, differentHash);
  assert.equal(statSync(left).size, descriptor.bytes);
  const pdf = readFileSync(left);
  assert.equal(pdf.subarray(0, 8).toString("ascii"), "%PDF-1.7");
  assert.match(pdf.toString("latin1"), /xref\n0 5\n/u);
  const startXref = /startxref\n(\d+)\n%%EOF\n$/u.exec(pdf.toString("latin1"));
  assert(startXref);
  assert.equal(pdf.subarray(Number(startXref[1]), Number(startXref[1]) + 4).toString("ascii"), "xref");
  const xrefLines = pdf.subarray(Number(startXref[1])).toString("ascii").split("\n").slice(3, 7);
  for (let objectNumber = 1; objectNumber <= 4; objectNumber += 1) {
    const offset = Number(xrefLines[objectNumber - 1].slice(0, 10));
    assert.equal(pdf.subarray(offset, offset + 7).toString("ascii"), `${objectNumber} 0 obj`);
  }
  assert.throws(() => writeDeterministicDocument(left, descriptor), /EEXIST/u);
  const existingRoot = join(root, "existing-fixture");
  mkdirSync(existingRoot);
  const sentinel = join(existingRoot, "sentinel.txt");
  writeFileSync(sentinel, "preserve\n", "utf8");
  assert.throws(
    () => materializeReceiptWorkload(
      createReceiptWorkloadPlan({ count: 50, seed: "collision-20260828" }),
      existingRoot,
    ),
    /already exists/u,
  );
  assert.equal(readFileSync(sentinel, "utf8"), "preserve\n");
});

test("50-item compact corpus is equivalent for one-item and 20-item plans", async (context) => {
  const parent = mkdtempSync(join(tmpdir(), "sse-receipt-equivalence-contract-"));
  const fixtureRoot = join(parent, "fixture");
  const scratchRoot = join(parent, "scratch");
  mkdirSync(scratchRoot, { recursive: true });
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const plan = compactPlan(createReceiptWorkloadPlan({ count: 50, seed: "equivalence-20260828" }));
  const { manifest } = materializeReceiptWorkload(plan, fixtureRoot, { allowTestDocumentSizes: true });
  const result = await runReceiptWorkloadEquivalence({ manifest, fixtureRoot, scratchRoot });
  assert.equal(result.equivalent, true);
  assert.equal(result.expectedStateDigest, result.stateDigest);
  assert.equal(result.individual.stateDigest, result.batch.stateDigest);
  assert.equal(result.individual.dispositionDigest, result.batch.dispositionDigest);
  assert.equal(result.individual.directWorkerCallCount, 48);
  assert.equal(result.batch.directWorkerCallCount, 8);
  assert.equal(result.individual.workerExecutedLogicalItemCount, 46);
  assert.equal(result.batch.workerExecutedLogicalItemCount, 46);
  assert.equal(result.individual.schemaRejectedLogicalItemCount, 4);
  assert.equal(result.batch.schemaRejectedLogicalItemCount, 4);
  assert.equal(result.individual.operationCounts.receipt_manager_bulk_upsert, 43);
  assert.equal(result.batch.operationCounts.receipt_manager_bulk_upsert, 5);
  assert.deepEqual(result.batch.callOutcomes.kinds, { ambiguous: 1, stale: 2 });
  assert.deepEqual(result.batch.dispositionCounts, {
    ambiguous: 1,
    "bad-args": 1,
    imported: 23,
    "link-noop": 3,
    skipped: 4,
    stale: 1,
    "unsupported-currency-schema-rejected": 3,
    updated: 14,
  });
  assert.equal(result.amortization.directWorkerCallReduction, 40);
  assert.equal(result.individual.dispositionVector.length, 50);
  assert.equal(result.batch.dispositionVector.length, 50);
  assert.deepEqual(result.sourceHashChecks, { preflight: 50, postflight: 50, total: 100 });
  const allowedCallFields = new Set([
    "schemaVersion", "type", "benchmark", "phase", "population", "seedFingerprint", "mode", "sequence",
    "operation", "logicalItemCount", "batchSize", "ok", "outcome", "kind", "verified", "resultingState",
    "elapsedMs",
  ]);
  for (const record of [...result.individual.callRecords, ...result.batch.callRecords]) {
    assert.equal(Object.keys(record).every((key) => allowedCallFields.has(key)), true);
    assert.equal(Number.isFinite(record.elapsedMs) && record.elapsedMs >= 0, true);
    assert(!/documents:|[A-Z]:\\|title|note|resource/iu.test(JSON.stringify(record)));
  }
  assert(!/[A-Z]:\\|sse-receipt-equivalence-contract/iu.test(JSON.stringify({
    stateDigest: result.stateDigest,
    dispositionVector: result.batch.dispositionVector,
    callRecords: result.batch.callRecords,
  })));
  const duplicateItems = manifest.items.filter((item) => item.scenario === "duplicate-content");
  assert.equal(duplicateItems[0].actualSha256, duplicateItems[1].actualSha256);
  assert.equal(readReceiptWorkloadManifest(fixtureRoot).manifestFingerprint, manifest.manifestFingerprint);

  const traversal = structuredClone(manifest);
  traversal.items[0].relativePath = "documents/../escape.pdf";
  const traversalPlan = {
    ...traversal,
    items: traversal.items.map(({ actualSha256, expectedHash, ...item }) => item),
  };
  delete traversalPlan.fixtureRootPolicy;
  delete traversalPlan.expectedStateDigest;
  delete traversalPlan.manifestFingerprint;
  delete traversalPlan.planFingerprint;
  traversal.planFingerprint = sha256(stableJson(traversalPlan));
  delete traversal.manifestFingerprint;
  traversal.manifestFingerprint = sha256(stableJson(traversal));
  assert.throws(
    () => validateMaterializedReceiptWorkloadManifest(traversal, fixtureRoot),
    /unsafe relative path|escapes the fixture root/u,
  );

  const rollbackCaseDir = join(parent, "rollback-cases");
  mkdirSync(rollbackCaseDir, { recursive: true });
  const seeded = seedSyntheticCases(rollbackCaseDir);
  const rollbackWorker = createStatefulSseWorker({
    caseDir: rollbackCaseDir,
    initialReceiptManagerState: "list",
    initialReceiptRows: manifest.initialRows,
    initialReceiptLinks: manifest.initialReceiptLinks,
  });
  assert.equal((await rollbackWorker.worker("launch", { file: seeded.freelancerPath, mode: "einur" })).ok, true);
  const beforeRollback = rollbackWorker.model.receiptSnapshot();
  const newItem = manifest.items.find((item) => item.scenario === "new-import");
  const ambiguousItem = manifest.items.find((item) => item.scenario === "ambiguous-identity");
  const logicalItems = [newItem, ambiguousItem];
  const publicArgs = parseApiOperationArgs("receipt_manager_bulk_upsert", {
    items: logicalItems.map((item) => ({
      resourceRef: `documents:${item.relativePath.slice("documents/".length)}`,
      expectedHash: item.actualSha256,
      identity: item.identity,
      onExisting: item.onExisting,
      values: item.values,
      ...(item.classification ? { classification: item.classification } : {}),
    })),
    acknowledgeBulkUpsert: true,
    stopOnError: true,
  });
  const rolledBack = await rollbackWorker.worker("receipt_manager_bulk_upsert", {
    ...publicArgs,
    items: publicArgs.items.map((item, index) => ({
      ...item,
      expectedPath: join(fixtureRoot, ...logicalItems[index].relativePath.split("/")),
    })),
  });
  assert.equal(rolledBack.ok, false);
  assert.equal(rolledBack.kind, "ambiguous");
  assert.equal(rolledBack.rollback.attempted, true);
  assert.equal(rolledBack.resultingState, "rolled-back-verified");
  assert.equal(rolledBack.finalReadbackVerified, true);
  assert.deepEqual(rollbackWorker.model.receiptSnapshot(), beforeRollback,
    "Rollback must restore rows, classifications, links, order and the generated-ID allocator.");
});

test("CLI requires explicit external nonexisting roots and canonical counts", () => {
  assert.deepEqual(parseReceiptWorkloadOptions(["--help"]), {
    count: 0, seed: "", fixtureRoot: "", output: "", help: true,
  });
  const parsed = parseReceiptWorkloadOptions([
    "--count", "250",
    "--seed=canonical-20260828",
    "--fixture-root", join(tmpdir(), "new-receipt-fixture"),
    "--output", join(tmpdir(), "new-receipt-output"),
  ]);
  assert.equal(parsed.count, 250);
  assert.equal(parsed.seed, "canonical-20260828");
  assert.throws(() => parseReceiptWorkloadOptions(["--count", "51"]), /must be one of/u);
  assert.throws(() => parseReceiptWorkloadOptions(["--count", "50", "--seed", "x"]), /required/u);
  assert.throws(() => parseReceiptWorkloadOptions(["--unknown"]), /Unknown option/u);
  assert.throws(() => parseReceiptWorkloadOptions([
    "--count", "50", "--seed", "canonical-20260828",
    "--fixture-root", join(tmpdir(), "receipt-parent"),
    "--output", join(tmpdir(), "receipt-parent", "results"),
  ]), /disjoint directory trees/u);
  assert.throws(() => parseReceiptWorkloadOptions([
    "--count", "50", "--seed", "canonical-20260828",
    "--fixture-root", join(tmpdir(), "result-parent", "fixture"),
    "--output", join(tmpdir(), "result-parent"),
  ]), /disjoint directory trees/u);
});

test("receipt workload runner records failures without deleting unproven fixture roots", async (context) => {
  const parent = mkdtempSync(join(tmpdir(), "sse-receipt-runner-failure-"));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const seed = "failure-20260828";

  const earlyFixture = join(parent, "early-fixture");
  const earlyOutput = join(parent, "early-output");
  await assert.rejects(() => runReceiptWorkload({
    count: 50, seed, fixtureRoot: earlyFixture, output: earlyOutput,
  }, {
    afterOutputCreated: () => { throw new Error("injected early failure"); },
  }), /injected early failure/u);
  assert.equal(existsSync(earlyFixture), false);
  assert.equal(JSON.parse(readFileSync(join(earlyOutput, "cleanup.json"), "utf8")).completionStatus, "failed");

  const collisionFixture = join(parent, "collision-fixture");
  const collisionOutput = join(parent, "collision-output");
  const sentinel = join(collisionFixture, "foreign-sentinel.txt");
  await assert.rejects(() => runReceiptWorkload({
    count: 50, seed, fixtureRoot: collisionFixture, output: collisionOutput,
  }, {
    afterOutputCreated: () => {
      mkdirSync(collisionFixture);
      writeFileSync(sentinel, "must survive\n", "utf8");
    },
  }), /already exists/u);
  assert.equal(readFileSync(sentinel, "utf8"), "must survive\n");
  const collisionCleanup = JSON.parse(readFileSync(join(collisionOutput, "cleanup.json"), "utf8"));
  assert.equal(collisionCleanup.completionStatus, "failed");
  assert.equal(collisionCleanup.fixtureState, "retained-after-failure");

  const finalFixture = join(parent, "final-fixture");
  const finalOutput = join(parent, "final-output");
  const plan = compactPlan(createReceiptWorkloadPlan({ count: 50, seed }));
  await assert.rejects(() => runReceiptWorkload({
    count: 50, seed, fixtureRoot: finalFixture, output: finalOutput,
  }, {
    plan,
    beforeArtifactIndex: () => { throw new Error("injected final failure"); },
  }), /injected final failure/u);
  assert.equal(existsSync(finalFixture), false);
  assert.equal(existsSync(join(finalOutput, "artifacts.json")), false);
  const cleanup = JSON.parse(readFileSync(join(finalOutput, "cleanup.json"), "utf8"));
  assert.equal(cleanup.completionStatus, "failed");
  assert.equal(cleanup.failureStage, "artifact-index");
  assert.equal(cleanup.scratchRemoved, true);
  assert.equal(cleanup.fixtureState, "absent");
});

test("real-path aliases cannot redirect or overlap external workload roots", async (context) => {
  const parent = mkdtempSync(join(tmpdir(), "sse-receipt-root-alias-"));
  const linkType = process.platform === "win32" ? "junction" : "dir";
  const repositoryAlias = join(parent, "repository-alias");
  const firstAlias = join(parent, "first-alias");
  const secondAlias = join(parent, "second-alias");
  context.after(() => {
    for (const alias of [repositoryAlias, firstAlias, secondAlias]) rmSync(alias, { force: true });
    rmSync(parent, { recursive: true, force: true });
  });
  symlinkSync(REPOSITORY_ROOT, repositoryAlias, linkType);
  assert.throws(() => materializeReceiptWorkload(
    createReceiptWorkloadPlan({ count: 50, seed: "alias-20260828" }),
    join(repositoryAlias, "must-not-be-created"),
  ), /outside the repository/u);
  assert.equal(existsSync(join(REPOSITORY_ROOT, "must-not-be-created")), false);

  const sharedTarget = join(parent, "shared-target");
  mkdirSync(sharedTarget);
  symlinkSync(sharedTarget, firstAlias, linkType);
  symlinkSync(sharedTarget, secondAlias, linkType);
  await assert.rejects(() => runReceiptWorkload({
    count: 50,
    seed: "alias-20260828",
    fixtureRoot: join(firstAlias, "same-root"),
    output: join(secondAlias, "same-root"),
  }), /disjoint directory trees/u);
  assert.equal(existsSync(join(sharedTarget, "same-root")), false);
});

test("real HTTP and MCP preserve valid receipt block parity and focusless list parity", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "sse-receipt-public-parity-"));
  const caseDir = join(temporary, "cases");
  const workspaceDir = join(temporary, "workspace");
  const resultDir = join(temporary, "results");
  const documentsDir = join(temporary, "documents");
  for (const directory of [caseDir, workspaceDir, resultDir, documentsDir]) mkdirSync(directory, { recursive: true });
  const plan = createReceiptWorkloadPlan({ count: 50, seed: "public-parity-20260828" });
  const seeded = seedSyntheticCases(caseDir);
  const { worker, model } = createStatefulSseWorker({
    caseDir,
    initialReceiptManagerState: "list",
    initialReceiptRows: plan.initialRows,
    initialReceiptLinks: plan.initialReceiptLinks,
  });
  assert.equal((await worker("launch", { file: seeded.freelancerPath, mode: "einur" })).ok, true);
  const execute = createApiExecutor({
    host: "127.0.0.1",
    port: 1,
    configPath: join(temporary, "config.json"),
    caseDir,
    workspaceDir,
    resultDir,
    documentsDir,
  }, worker, { archiveHasRunningSseProcess: async () => false });
  const server = createSseApiServer({ execute });
  let client;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const request = async (operation, args) => {
      const response = await fetch(`${baseUrl}/v1/operations/${operation}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ args, timeoutMs: 30_000 }),
      });
      return { status: response.status, body: await response.json() };
    };
    const supported = plan.items.filter((item) => [
      "new-import", "existing-update", "existing-noop", "existing-skip", "missing-metadata", "duplicate-content",
    ].includes(item.scenario));
    const oneArgs = { items: [publicItem(supported[0], 1)], acknowledgeBulkUpsert: true, stopOnError: true };
    const twentyArgs = {
      items: supported.slice(0, 20).map((item, index) => publicItem(item, index + 1)),
      acknowledgeBulkUpsert: true,
      stopOnError: true,
    };
    const journalBefore = model.journal.length;
    const apiOne = await request("receipt_manager_bulk_upsert", oneArgs);
    const apiTwenty = await request("receipt_manager_bulk_upsert", twentyArgs);
    assert.equal(apiOne.status, 200);
    assert.equal(apiTwenty.status, 200);
    assert.deepEqual(blockShape(apiOne.body.result), expectedBlock);
    assert.deepEqual(blockShape(apiTwenty.body.result), expectedBlock);
    assert.equal(model.journal.length, journalBefore, "Blocked HTTP plans must not resolve files or reach the worker.");

    const twentyOne = await request("receipt_manager_bulk_upsert", {
      ...twentyArgs,
      items: [...twentyArgs.items, publicItem(supported[20], 21)],
    });
    assert.equal(twentyOne.status, 400);
    assert.equal(twentyOne.body.error.code, "bad-args");
    const duplicate = await request("receipt_manager_bulk_upsert", {
      ...oneArgs,
      items: [oneArgs.items[0], { ...oneArgs.items[0] }],
    });
    assert.equal(duplicate.status, 400);
    assert.equal(model.journal.length, journalBefore);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(process.cwd(), "dist", "index.js")],
      env: { ...process.env, SSE_API_URL: baseUrl },
    });
    client = new Client({ name: "receipt-workload-parity", version: "1.0.0" });
    await client.connect(transport);
    const mcpOne = await client.callTool({ name: "sse_receipt_manager_bulk_upsert", arguments: oneArgs });
    const mcpTwenty = await client.callTool({ name: "sse_receipt_manager_bulk_upsert", arguments: twentyArgs });
    assert.equal(mcpOne.isError, true);
    assert.equal(mcpTwenty.isError, true);
    assert.deepEqual(blockShape(mcpOne.structuredContent), expectedBlock);
    assert.deepEqual(blockShape(mcpTwenty.structuredContent), expectedBlock);
    assert.equal(model.journal.length, journalBefore);
    const mcpTwentyOne = await client.callTool({
      name: "sse_receipt_manager_bulk_upsert",
      arguments: { ...twentyArgs, items: [...twentyArgs.items, publicItem(supported[20], 21)] },
    });
    assert.equal(mcpTwentyOne.isError, true);
    assert.notDeepEqual(blockShape(mcpTwentyOne.structuredContent ?? {}), expectedBlock,
      "Malformed MCP input must fail schema validation instead of masquerading as a policy block.");
    assert.equal(model.journal.length, journalBefore);

    const apiList = await request("receipt_manager_list", { limit: 200 });
    assert.equal(apiList.status, 200);
    assert.equal(apiList.body.result.ok, true);
    const mcpList = await client.callTool({ name: "sse_receipt_manager_list", arguments: { limit: 200 } });
    assert.notEqual(mcpList.isError, true);
    assert.equal(mcpList.structuredContent.count, apiList.body.result.count);
    assert.equal(mcpList.structuredContent.listFingerprint, apiList.body.result.listFingerprint);
    assert.equal(mcpList.structuredContent.physicalInputUsed, false);
    assert.equal(model.journal.length, journalBefore + 2);
    assert(!JSON.stringify(mcpOne).includes(temporary));
  } finally {
    try {
      if (client) await client.close();
    } finally {
      try {
        if (server.listening) await new Promise((resolvePromise) => server.close(resolvePromise));
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    }
  }
  assert.equal(existsSync(temporary), false);
});
