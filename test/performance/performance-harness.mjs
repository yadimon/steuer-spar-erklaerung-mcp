import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, availableParallelism, cpus, platform, release, totalmem } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

export const PERFORMANCE_SCHEMA_VERSION = 1;
export const BENCHMARK_ID = "synthetic-api-tax-journeys";
export const DEFAULT_WARMUP = 1;
export const DEFAULT_ITERATIONS = 5;

const here = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = resolve(here, "..", "..");
const JOURNEY_FILE = "test/api-tax-journeys.mjs";
const MAX_RUNS = 1_000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function rounded(value) {
  return Math.round(value * 1_000) / 1_000;
}

/** Nearest-rank percentile: deterministic even for deliberately small smoke runs. */
export function percentile(values, probability) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (!(probability > 0 && probability <= 1)) throw new RangeError("percentile probability must be in (0, 1].");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)];
}

export function summarizeDurations(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { count: 0, min: null, max: null, mean: null, p50: null, p95: null, p99: null };
  }
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    min: rounded(Math.min(...values)),
    max: rounded(Math.max(...values)),
    mean: rounded(sum / values.length),
    p50: rounded(percentile(values, 0.50)),
    p95: rounded(percentile(values, 0.95)),
    p99: rounded(percentile(values, 0.99)),
  };
}

function parseBoundedInteger(value, name, { minimum }) {
  if (!/^(?:0|[1-9]\d*)$/u.test(String(value ?? ""))) {
    throw new Error(`${name} muss eine ganze Zahl sein.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > MAX_RUNS) {
    throw new Error(`${name} muss zwischen ${minimum} und ${MAX_RUNS} liegen.`);
  }
  return parsed;
}

function optionValue(argv, index, name) {
  const token = argv[index];
  const prefix = `${name}=`;
  if (token.startsWith(prefix)) return { value: token.slice(prefix.length), consumed: 0 };
  if (token === name) {
    if (argv[index + 1] === undefined) throw new Error(`${name} erwartet einen Wert.`);
    return { value: argv[index + 1], consumed: 1 };
  }
  return null;
}

export function parseOptions(argv, env = process.env) {
  let warmup = env.SSE_PERF_WARMUP ?? String(DEFAULT_WARMUP);
  let iterations = env.SSE_PERF_ITERATIONS ?? String(DEFAULT_ITERATIONS);
  let output = env.SSE_PERF_OUTPUT ?? "";
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }
    const warmupOption = optionValue(argv, index, "--warmup");
    if (warmupOption) {
      warmup = warmupOption.value;
      index += warmupOption.consumed;
      continue;
    }
    const iterationOption = optionValue(argv, index, "--iterations");
    if (iterationOption) {
      iterations = iterationOption.value;
      index += iterationOption.consumed;
      continue;
    }
    const outputOption = optionValue(argv, index, "--output");
    if (outputOption) {
      output = outputOption.value;
      index += outputOption.consumed;
      continue;
    }
    throw new Error(`Unbekannte Option: ${token}`);
  }

  return {
    warmup: parseBoundedInteger(warmup, "warmup", { minimum: 0 }),
    iterations: parseBoundedInteger(iterations, "iterations", { minimum: 1 }),
    output: output ? resolve(output) : "",
    help,
  };
}

function git(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch (error) {
    if (allowFailure) return "";
    throw error;
  }
}

export function sourceFingerprint() {
  const packageJson = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8"));
  const commit = git(["rev-parse", "HEAD"], { allowFailure: true }) || null;
  const tree = git(["rev-parse", "HEAD^{tree}"], { allowFailure: true }) || null;
  const status = git(["status", "--porcelain=v1", "--untracked-files=normal"], { allowFailure: true });
  const trackedDiff = git(["diff", "--no-ext-diff", "--binary", "HEAD", "--"], { allowFailure: true });
  const metadata = {
    packageVersion: packageJson.version,
    commit,
    tree,
    dirty: status.length > 0,
    statusSha256: sha256(status),
    trackedChangesSha256: sha256(trackedDiff),
  };
  return { ...metadata, fingerprint: sha256(stableJson(metadata)) };
}

export function runtimeFingerprint() {
  const cpu = cpus()[0];
  const metadata = {
    node: process.version,
    v8: process.versions.v8,
    platform: platform(),
    release: release(),
    arch: arch(),
    cpuModel: cpu?.model?.trim() || "unknown",
    logicalCpuCount: cpus().length,
    availableParallelism: availableParallelism(),
    totalMemoryBytes: totalmem(),
    executable: basename(process.execPath),
  };
  return { ...metadata, fingerprint: sha256(stableJson(metadata)) };
}

export function aggregateOperationTraces(records) {
  const labels = new Map();
  const operations = new Map();
  let threwCount = 0;
  let okCount = 0;

  for (const record of records) {
    labels.set(record.label, (labels.get(record.label) ?? 0) + 1);
    const current = operations.get(record.operation) ?? { durations: [], count: 0, okCount: 0, threwCount: 0 };
    current.count += 1;
    current.okCount += record.ok === true ? 1 : 0;
    current.threwCount += record.threw === true ? 1 : 0;
    if (Number.isFinite(record.ms) && record.ms >= 0) current.durations.push(record.ms);
    operations.set(record.operation, current);
    okCount += record.ok === true ? 1 : 0;
    threwCount += record.threw === true ? 1 : 0;
  }

  return {
    recordCount: records.length,
    distinctOperationCount: operations.size,
    okCount,
    nonOkCount: records.length - okCount,
    threwCount,
    labels: Object.fromEntries([...labels].sort(([left], [right]) => left.localeCompare(right))),
    operations: [...operations]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([operation, data]) => ({
        operation,
        count: data.count,
        okCount: data.okCount,
        nonOkCount: data.count - data.okCount,
        threwCount: data.threwCount,
        durationMs: summarizeDurations(data.durations),
      })),
  };
}

function readTraceRecords(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => readFileSync(join(directory, entry.name), "utf8")
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line)));
}

function runJourneyProcess(traceDirectory) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["--test", JOURNEY_FILE], {
      cwd: REPOSITORY_ROOT,
      env: { ...process.env, SSE_TEST_OPERATION_TRACE_DIR: traceDirectory },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && !signal) {
        resolvePromise();
        return;
      }
      const diagnostic = Buffer.concat([...stdout, ...stderr]).toString("utf8").slice(-8_000);
      reject(new Error(`Synthetische Journey fehlgeschlagen (code=${code}, signal=${signal ?? "none"}).\n${diagnostic}`));
    });
  });
}

function defaultOutputDirectory(source, generatedAt) {
  const timestamp = generatedAt.replaceAll(":", "-").replaceAll(".", "-");
  const revision = source.commit?.slice(0, 12) ?? "no-git";
  return join(REPOSITORY_ROOT, ".tmp", "performance", BENCHMARK_ID, `${timestamp}-${revision}`);
}

function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

export async function runBenchmark(options) {
  const generatedAt = new Date().toISOString();
  const source = sourceFingerprint();
  const runtime = runtimeFingerprint();
  const outputDirectory = options.output || defaultOutputDirectory(source, generatedAt);
  const samplesPath = join(outputDirectory, "samples.jsonl");
  const summaryPath = join(outputDirectory, "summary.json");
  if (existsSync(samplesPath) || existsSync(summaryPath)) {
    throw new Error("Das Ausgabeverzeichnis enthaelt bereits Performance-Ergebnisse.");
  }
  mkdirSync(outputDirectory, { recursive: true });

  const samples = [];
  const measurementTraceRecords = [];
  const totalRuns = options.warmup + options.iterations;
  for (let run = 0; run < totalRuns; run += 1) {
    const phase = run < options.warmup ? "warmup" : "measurement";
    const phaseIndex = phase === "warmup" ? run + 1 : run - options.warmup + 1;
    const traceDirectory = join(outputDirectory, ".trace", `${phase}-${String(phaseIndex).padStart(4, "0")}`);
    mkdirSync(traceDirectory, { recursive: true });
    const startedAt = performance.now();
    await runJourneyProcess(traceDirectory);
    const wallTimeMs = rounded(performance.now() - startedAt);
    const traceRecords = readTraceRecords(traceDirectory);
    const sample = {
      schemaVersion: PERFORMANCE_SCHEMA_VERSION,
      type: "sample",
      benchmark: BENCHMARK_ID,
      phase,
      index: phaseIndex,
      sourceFingerprint: source.fingerprint,
      runtimeFingerprint: runtime.fingerprint,
      wallTimeMs,
      operationTrace: aggregateOperationTraces(traceRecords),
    };
    appendFileSync(samplesPath, `${JSON.stringify(sample)}\n`, "utf8");
    samples.push(sample);
    if (phase === "measurement") measurementTraceRecords.push(...traceRecords);
    rmSync(traceDirectory, { recursive: true, force: true });
    process.stdout.write(`${phase} ${phaseIndex}/${phase === "warmup" ? options.warmup : options.iterations}: ${wallTimeMs} ms\n`);
  }
  rmSync(join(outputDirectory, ".trace"), { recursive: true, force: true });

  const measurements = samples.filter((sample) => sample.phase === "measurement");
  const summary = {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    type: "summary",
    benchmark: BENCHMARK_ID,
    generatedAt,
    command: "npm run perf:tax-journeys",
    settings: { warmup: options.warmup, iterations: options.iterations },
    source,
    runtime,
    wallTimeMs: summarizeDurations(measurements.map((sample) => sample.wallTimeMs)),
    operationTrace: aggregateOperationTraces(measurementTraceRecords),
    artifacts: { samples: "samples.jsonl", summary: "summary.json" },
  };
  writeJsonAtomic(summaryPath, summary);
  return { outputDirectory, samplesPath, summaryPath, summary };
}

export const HELP = `Synthetischer API-Tax-Journey-Performance-Harness

Aufruf:
  npm run perf:tax-journeys -- [--warmup N] [--iterations N] [--output PFAD]

Defaults: --warmup ${DEFAULT_WARMUP}, --iterations ${DEFAULT_ITERATIONS}
Umgebung: SSE_PERF_WARMUP, SSE_PERF_ITERATIONS, SSE_PERF_OUTPUT
Die Default-Ausgabe liegt unter .tmp/performance/ und ist von Git ignoriert.
`;
