#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  REPOSITORY_ROOT,
  RECEIPT_WORKLOAD_SCHEMA_VERSION,
  RECEIPT_WORKLOAD_POPULATIONS,
  cleanupMaterializedReceiptWorkload,
  createReceiptWorkloadPlan,
  materializeReceiptWorkload,
  runReceiptWorkloadEquivalence,
} from "./receipt-workload.mjs";
import { runtimeFingerprint, sourceFingerprint } from "./performance-harness.mjs";

const HELP = `Deterministic synthetic receipt workload

Usage:
  node test/performance/run-receipt-workload.mjs --count 50|250|1000 --seed TOKEN \\
    --fixture-root EXTERNAL_NEW_DIRECTORY --output EXTERNAL_NEW_DIRECTORY

The command is product-free. It never starts SSE.exe and makes no installed-product mutation claim.
`;

function optionValue(argv, index, name) {
  if (argv[index] === name) {
    if (argv[index + 1] === undefined) throw new Error(`${name} requires a value.`);
    return { value: argv[index + 1], consumed: 1 };
  }
  if (argv[index].startsWith(`${name}=`)) return { value: argv[index].slice(name.length + 1), consumed: 0 };
  return null;
}

export function parseReceiptWorkloadOptions(argv) {
  const result = { count: 0, seed: "", fixtureRoot: "", output: "", help: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (["--help", "-h"].includes(argv[index])) {
      result.help = true;
      continue;
    }
    let matched = false;
    for (const [name, key] of [
      ["--count", "count"], ["--seed", "seed"], ["--fixture-root", "fixtureRoot"], ["--output", "output"],
    ]) {
      const option = optionValue(argv, index, name);
      if (!option) continue;
      result[key] = key === "count" ? Number(option.value) : option.value;
      index += option.consumed;
      matched = true;
      break;
    }
    if (!matched) throw new Error(`Unknown option: ${argv[index]}`);
  }
  if (result.help) return result;
  if (!RECEIPT_WORKLOAD_POPULATIONS.includes(result.count)) {
    throw new Error(`--count must be one of ${RECEIPT_WORKLOAD_POPULATIONS.join(", ")}.`);
  }
  if (!result.seed || !result.fixtureRoot || !result.output) {
    throw new Error("--seed, --fixture-root and --output are required.");
  }
  result.fixtureRoot = resolve(result.fixtureRoot);
  result.output = resolve(result.output);
  assertDisjointExternalDirectories(result.fixtureRoot, result.output);
  return result;
}

function isStrictDescendant(parent, candidate) {
  const fromParent = relative(parent, candidate);
  return fromParent !== "" && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent);
}

function assertDisjointExternalDirectories(fixtureRoot, output) {
  if (fixtureRoot.toLocaleLowerCase("en-US") === output.toLocaleLowerCase("en-US") ||
      isStrictDescendant(fixtureRoot, output) || isStrictDescendant(output, fixtureRoot)) {
    throw new Error("fixture root and output must be disjoint directory trees.");
  }
}

function projectExternalNewDirectory(path, name) {
  const absolute = resolve(path);
  const parent = dirname(absolute);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    throw new Error(`${name} parent must already exist.`);
  }
  const realRepository = realpathSync(REPOSITORY_ROOT);
  const projected = resolve(realpathSync(parent), basename(absolute));
  if (projected.toLocaleLowerCase("en-US") === realRepository.toLocaleLowerCase("en-US") ||
      isStrictDescendant(realRepository, projected)) {
    throw new Error(`${name} must stay outside the repository.`);
  }
  return projected;
}

function claimExternalNewDirectory(path, name, projected) {
  try {
    mkdirSync(path);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`${name} already exists.`, { cause: error });
    throw error;
  }
  const realRoot = realpathSync(path);
  if (realRoot.toLocaleLowerCase("en-US") !== projected.toLocaleLowerCase("en-US")) {
    throw new Error(`${name} resolved to an unexpected location after creation.`);
  }
  return realRoot;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function replaceJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "w" });
}

function writeJsonLines(path, values) {
  writeFileSync(path, values.map((value) => JSON.stringify(value)).join("\n") + "\n", {
    encoding: "utf8",
    flag: "wx",
  });
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
}

function filesBelow(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(root, path) : [{
      relativePath: relative(root, path).replaceAll("\\", "/"),
      bytes: statSync(path).size,
      sha256: sha256File(path),
    }];
  });
}

export async function runReceiptWorkload(options, testOnly = {}) {
  const projectedFixtureRoot = projectExternalNewDirectory(options.fixtureRoot, "fixture root");
  const projectedOutputRoot = projectExternalNewDirectory(options.output, "output");
  assertDisjointExternalDirectories(projectedFixtureRoot, projectedOutputRoot);
  const source = sourceFingerprint();
  const runtime = runtimeFingerprint();
  const outputRoot = claimExternalNewDirectory(options.output, "output", projectedOutputRoot);
  const scratchRoot = join(outputRoot, ".scratch");
  let materialized;
  let result;
  let summary;
  let primaryError;
  let failureStage = "initialization";
  try {
    testOnly.afterOutputCreated?.();
    const plan = testOnly.plan ?? createReceiptWorkloadPlan({ count: options.count, seed: options.seed });
    if (testOnly.plan && (
      plan.testOnlyCompact !== true || plan.count !== options.count || plan.seed !== options.seed
    )) {
      throw new Error("A test-only plan must be compact and match the requested count and seed.");
    }
    failureStage = "materialization";
    materialized = materializeReceiptWorkload(plan, options.fixtureRoot, {
      allowTestDocumentSizes: testOnly.plan !== undefined,
    });
    assertDisjointExternalDirectories(materialized.root, outputRoot);
    testOnly.afterMaterialization?.();
    failureStage = "execution";
    mkdirSync(scratchRoot, { recursive: true });
    result = await runReceiptWorkloadEquivalence({
      manifest: materialized.manifest,
      fixtureRoot: materialized.root,
      scratchRoot,
    });
    const callRecords = [
      ...result.individual.callRecords,
      ...result.batch.callRecords,
    ];
    const itemRecords = result.individual.dispositionVector.flatMap((individual, index) => ([
      { schemaVersion: RECEIPT_WORKLOAD_SCHEMA_VERSION, type: "logical-item", mode: "individual", sequence: index + 1, ...individual },
      { schemaVersion: RECEIPT_WORKLOAD_SCHEMA_VERSION, type: "logical-item", mode: "batch-20", sequence: index + 1, ...result.batch.dispositionVector[index] },
    ]));
    summary = {
      schemaVersion: RECEIPT_WORKLOAD_SCHEMA_VERSION,
      type: "summary",
      benchmark: result.benchmark,
      command: "npm run perf:receipt-workload",
      generatedAt: new Date().toISOString(),
      settings: { count: options.count, seedFingerprint: createHash("sha256").update(options.seed).digest("hex") },
      source,
      runtime,
      manifest: {
        generatorVersion: materialized.manifest.generatorVersion,
        planFingerprint: materialized.manifest.planFingerprint,
        manifestFingerprint: materialized.manifest.manifestFingerprint,
        expectedStateDigest: materialized.manifest.expectedStateDigest,
        totalDocumentBytes: materialized.manifest.totalDocumentBytes,
        scenarioCounts: materialized.manifest.scenarioCounts,
        documentSizeCounts: materialized.manifest.documentSizeCounts,
        filenameShapeCounts: materialized.manifest.filenameShapeCounts,
      },
      semanticClaim: result.semanticClaim,
      installedProductMutationClaim: false,
      timingClaim: result.timingClaim,
      equivalent: result.equivalent,
      expectedStateDigest: result.expectedStateDigest,
      stateDigest: result.stateDigest,
      dispositionDigest: result.dispositionDigest,
      sourceHashChecks: result.sourceHashChecks,
      individual: {
        workloadLogicalItemCount: result.individual.workloadLogicalItemCount,
        workerExecutedLogicalItemCount: result.individual.workerExecutedLogicalItemCount,
        schemaRejectedLogicalItemCount: result.individual.schemaRejectedLogicalItemCount,
        directWorkerCallCount: result.individual.directWorkerCallCount,
        operationCounts: result.individual.operationCounts,
        dispositionCounts: result.individual.dispositionCounts,
        callOutcomes: result.individual.callOutcomes,
        elapsedMs: result.individual.elapsedMs,
        workloadLogicalItemsPerSecond: result.individual.workloadLogicalItemsPerSecond,
        workerExecutedItemsPerSecond: result.individual.workerExecutedItemsPerSecond,
        millisecondsPerWorkloadLogicalItem: result.individual.millisecondsPerWorkloadLogicalItem,
        millisecondsPerWorkerExecutedItem: result.individual.millisecondsPerWorkerExecutedItem,
        callDurationMs: result.individual.callDurationMs,
      },
      batch: {
        workloadLogicalItemCount: result.batch.workloadLogicalItemCount,
        workerExecutedLogicalItemCount: result.batch.workerExecutedLogicalItemCount,
        schemaRejectedLogicalItemCount: result.batch.schemaRejectedLogicalItemCount,
        directWorkerCallCount: result.batch.directWorkerCallCount,
        operationCounts: result.batch.operationCounts,
        dispositionCounts: result.batch.dispositionCounts,
        callOutcomes: result.batch.callOutcomes,
        elapsedMs: result.batch.elapsedMs,
        workloadLogicalItemsPerSecond: result.batch.workloadLogicalItemsPerSecond,
        workerExecutedItemsPerSecond: result.batch.workerExecutedItemsPerSecond,
        millisecondsPerWorkloadLogicalItem: result.batch.millisecondsPerWorkloadLogicalItem,
        millisecondsPerWorkerExecutedItem: result.batch.millisecondsPerWorkerExecutedItem,
        callDurationMs: result.batch.callDurationMs,
      },
      amortization: result.amortization,
      artifacts: {
        run: "run.json",
        directWorkerCalls: "direct-worker-calls.jsonl",
        items: "logical-items.jsonl",
        cleanup: "cleanup.json",
        summary: "summary.json",
        hashes: "artifacts.json",
        hashCoverage: "run/direct-worker-calls/logical-items/summary; cleanup is finalized afterward",
      },
    };
    failureStage = "result-artifacts";
    writeJson(join(outputRoot, "run.json"), {
      schemaVersion: RECEIPT_WORKLOAD_SCHEMA_VERSION,
      benchmark: result.benchmark,
      command: "npm run perf:receipt-workload",
      generatedAt: summary.generatedAt,
      settings: summary.settings,
      source,
      runtime,
      productFree: true,
      installedProductMutationAttempted: false,
    });
    writeJsonLines(join(outputRoot, "direct-worker-calls.jsonl"), callRecords);
    writeJsonLines(join(outputRoot, "logical-items.jsonl"), itemRecords);
    writeJson(join(outputRoot, "summary.json"), summary);
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      rmSync(scratchRoot, { recursive: true, force: true });
    } catch (error) {
      primaryError = primaryError ? new AggregateError([primaryError, error], "Workload and scratch cleanup failed.") : error;
      failureStage = "scratch-cleanup";
    }
  }
  const cleanupPath = join(outputRoot, "cleanup.json");
  const cleanupRecord = (completionStatus, stage) => ({
    schemaVersion: RECEIPT_WORKLOAD_SCHEMA_VERSION,
    completionStatus,
    ...(stage ? { failureStage: stage } : {}),
    scratchRemoved: !existsSync(scratchRoot),
    fixtureState: existsSync(options.fixtureRoot)
      ? completionStatus === "passed" ? "retained" : "retained-after-failure"
      : "absent",
    sseStarted: false,
    apiStarted: false,
    mcpStarted: false,
    installedProductMutationAttempted: false,
  });
  if (primaryError) {
    if (materialized) {
      try {
        cleanupMaterializedReceiptWorkload(materialized);
      } catch (cleanupError) {
        primaryError = new AggregateError([primaryError, cleanupError], "Workload and verified fixture cleanup failed.");
        failureStage = "fixture-cleanup";
      }
    }
    try {
      writeJson(cleanupPath, cleanupRecord("failed", failureStage));
    } catch (cleanupRecordError) {
      throw new AggregateError([primaryError, cleanupRecordError], "Workload and cleanup evidence write failed.");
    }
    throw primaryError;
  }

  writeJson(cleanupPath, cleanupRecord("pending-artifact-index"));
  try {
    testOnly.beforeArtifactIndex?.();
    writeJson(join(outputRoot, "artifacts.json"), filesBelow(outputRoot)
      .filter((entry) => !["artifacts.json", "cleanup.json"].includes(entry.relativePath))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath)));
    replaceJson(cleanupPath, cleanupRecord("passed"));
  } catch (error) {
    let finalError = error;
    let finalFailureStage = "artifact-index";
    rmSync(join(outputRoot, "artifacts.json"), { force: true });
    try {
      cleanupMaterializedReceiptWorkload(materialized);
    } catch (cleanupError) {
      finalError = new AggregateError([error, cleanupError], "Artifact indexing and verified fixture cleanup failed.");
      finalFailureStage = "fixture-cleanup";
    }
    try {
      replaceJson(cleanupPath, cleanupRecord("failed", finalFailureStage));
    } catch (cleanupRecordError) {
      finalError = new AggregateError([finalError, cleanupRecordError], "Run failure and cleanup evidence write failed.");
    }
    throw finalError;
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseReceiptWorkloadOptions(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(HELP);
    } else {
      const summary = await runReceiptWorkload(options);
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
