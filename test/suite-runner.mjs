import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { join } from "node:path";

export const DEFAULT_STEP_TIMEOUT_MS = 300_000;
export const DEFAULT_STEP_OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024;
export const DEFAULT_FAILURE_OUTPUT_LIMIT_BYTES = 64 * 1024;

const appendOutput = (target, value) => {
  if (!value) return;
  target.write(value);
  if (!value.endsWith("\n")) target.write("\n");
};

const tailByBytes = (value, maxBytes) => {
  if (!value || Buffer.byteLength(value) <= maxBytes) return value;
  const buffer = Buffer.from(value);
  return `[... ${buffer.length - maxBytes} Bytes gekuerzt ...]\n${buffer.subarray(-maxBytes).toString("utf8")}`;
};

export function resolveVerboseOutput(configured = process.env.SSE_TEST_VERBOSE) {
  return configured === "1";
}

export function resolveConcurrency(configured = undefined, detectedParallelism = availableParallelism()) {
  if (configured !== undefined && configured !== "") {
    const parsed = Number(configured);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 16) {
      throw new Error("SSE_TEST_CONCURRENCY muss eine ganze Zahl zwischen 1 und 16 sein.");
    }
    return parsed;
  }
  return Math.max(1, Math.min(8, detectedParallelism));
}

function resolveStepTimeout(step) {
  const timeoutMs = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error(`Ungueltiger Testtimeout fuer '${step.name}': ${timeoutMs}`);
  }
  return timeoutMs;
}

function resolveOutputLimit(step) {
  const maxOutputBytes = step.maxOutputBytes ?? DEFAULT_STEP_OUTPUT_LIMIT_BYTES;
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new Error(`Ungueltiges Ausgabelimit fuer '${step.name}': ${maxOutputBytes}`);
  }
  return maxOutputBytes;
}

async function terminateProcessTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== "win32") {
    child.kill("SIGTERM");
    return;
  }

  const taskkill = join(
    process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows",
    "System32",
    "taskkill.exe",
  );
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const killer = spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => {
      child.kill("SIGTERM");
      finish();
    });
    killer.once("close", (code) => {
      if (code !== 0 && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      finish();
    });
  });
}

export async function runStep(step) {
  const startedAt = process.hrtime.bigint();
  const timeoutMs = resolveStepTimeout(step);
  const maxOutputBytes = resolveOutputLimit(step);
  const child = spawn(step.command, step.args, {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  let outputExceeded = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const capture = (stream, chunk) => {
    const chunkBytes = Buffer.byteLength(chunk);
    if (outputExceeded) return;
    if (outputBytes + chunkBytes > maxOutputBytes) {
      outputExceeded = true;
      void terminateProcessTree(child);
      return;
    }
    outputBytes += chunkBytes;
    if (stream === "stdout") stdout += chunk;
    else stderr += chunk;
  };
  child.stdout.on("data", (chunk) => capture("stdout", chunk));
  child.stderr.on("data", (chunk) => capture("stderr", chunk));

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void terminateProcessTree(child);
  }, timeoutMs);

  let result;
  try {
    result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
  } finally {
    clearTimeout(timeout);
  }
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

  const failed = outputExceeded || timedOut || result.signal || result.code !== 0;
  const verbose = resolveVerboseOutput();
  const command = verbose || failed ? ` ${step.command} ${step.args.join(" ")}` : "";
  process.stdout.write(`\n> [${step.name}]${command}\n`);
  if (verbose || failed) {
    appendOutput(process.stdout, failed ? tailByBytes(stdout, DEFAULT_FAILURE_OUTPUT_LIMIT_BYTES) : stdout);
    appendOutput(process.stderr, failed ? tailByBytes(stderr, DEFAULT_FAILURE_OUTPUT_LIMIT_BYTES) : stderr);
  }
  if (outputExceeded) {
    throw new Error(`Testsuite stoppte bei '${step.name}': Ausgabelimit ${maxOutputBytes} Bytes ueberschritten.`);
  }
  if (timedOut) {
    throw new Error(`Testsuite stoppte nach Timeout bei '${step.name}' (${timeoutMs} ms).`);
  }
  if (result.signal || result.code !== 0) {
    throw new Error(
      `Testsuite stoppte nach ${elapsedMs.toFixed(0)} ms bei '${step.name}' ` +
      `(Exit ${result.code}, Signal ${result.signal ?? "-"}).`,
    );
  }
  process.stdout.write(`✓ ${step.name} (${elapsedMs.toFixed(0)} ms)\n`);
}

export async function runSeries(steps, execute) {
  for (const step of steps) await execute(step);
}

export async function runWithConcurrency(items, concurrency, execute) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("concurrency muss eine positive ganze Zahl sein.");
  }
  let cursor = 0;
  let firstFailure;
  const worker = async () => {
    while (!firstFailure) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        await execute(items[index]);
      } catch (error) {
        firstFailure ??= error;
      }
    }
  };
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (firstFailure) throw firstFailure;
}
