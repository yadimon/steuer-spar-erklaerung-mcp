import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, mkdirSync } from "node:fs";
import { removeDirectoryWhenFree } from "./remove-when-free.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiExecutor } from "../dist/api-executor.js";
import { createQtNativeRuntime } from "../dist/qt-native-runtime.js";
import { withQtNativeLifecycle } from "../dist/qt-native-worker.js";
import { loadQtNativePackage } from "../dist/qt-native-package.js";
import { loadProductProfile } from "../dist/product-profiles.js";
import { createSseApiServer } from "../dist/api-server.js";
import { callWorker } from "../dist/worker.js";
import {
  enableWorkerPrewarm,
  isWarmSpareReady,
  lastPrewarmFailure,
  prewarmStartupTimeoutMs,
  shutdownWarmSpare,
  warmSparePoolStatus,
} from "../dist/worker-prewarm.js";
import { SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS } from "../dist/receipt-interaction-policy.js";
import { resolveWindowsPowerShell } from "../dist/windows-runtime.js";
import { traceOperations } from "./operation-trace.mjs";
import { createExecutionTelemetry } from "../dist/execution-telemetry.js";
import { createExecutionTraceLog } from "./execution-trace-log.mjs";
import { fileURLToPath } from "node:url";
import { listenOnFetchablePort } from "./fetchable-port.mjs";

const [, , command, ...args] = process.argv;
if (!command) {
  process.stderr.write("Aufruf: node test/with-api.mjs <befehl> [argumente...]\n");
  process.exit(2);
}

const temporary = mkdtempSync(join(tmpdir(), "sse-api-test-"));
const preserveTemporaryOnFailure = process.env.SSE_PRESERVE_TEST_SANDBOX_ON_FAILURE === "1";
const caseDir = process.env.SSE_CASE_DIR ?? join(temporary, "cases");
const workspaceDir = join(temporary, "workspace");
const resultDir = join(temporary, "results");
const documentsDir = join(temporary, "documents");
const backupsDir = join(temporary, "backups");
let server, native, executionLog;
const nativeShutdown = new AbortController();
let prewarmStarted = false;
let childFailed = false;
let childExitCode = 1;
let primaryFailure;
let primaryPhase = "Test-API-Start";

function interactiveReceiptLease() {
  if (process.env.SSE_TEST_INTERACTIVE_RECEIPTS !== "1") return null;
  if (process.platform !== "win32") {
    throw new Error("Der interaktive BelegManager-Testschalter ist nur in einer sichtbaren Windows-Sitzung erlaubt.");
  }
  const nativeDirectory = process.env.SSE_TEST_NATIVE_PACKAGE;
  const nativeDigest = process.env.SSE_TEST_NATIVE_MANIFEST_SHA256;
  if (Boolean(nativeDirectory) !== Boolean(nativeDigest)) throw new Error("Native package and digest must be supplied together.");
  const nativePackage = nativeDirectory ? loadQtNativePackage({ directory: nativeDirectory, manifestSha256: nativeDigest },
    loadProductProfile(process.env.SSE_PROFILE_ID)) : null;
  const probe = nativePackage ? spawnSync(nativePackage.loaderPath, ["--stdin"], {
    input: JSON.stringify({ mode: "interactive-session" }), encoding: "utf8", windowsHide: true,
    timeout: 10_000, maxBuffer: 64 * 1024,
  }) : spawnSync(resolveWindowsPowerShell(), [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
    "$ErrorActionPreference='Stop'; " +
      "Add-Type -Namespace SseMega -Name User32 -MemberDefinition '" +
      "[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); " +
      "[DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);'; " +
      "$foreground=[SseMega.User32]::GetForegroundWindow(); $foregroundPid=[uint32]0; " +
      "if($foreground -ne [IntPtr]::Zero){[void][SseMega.User32]::GetWindowThreadProcessId($foreground,[ref]$foregroundPid)}; " +
      "$session=(Get-Process -Id $PID).SessionId; " +
      "$foregroundSession=$(if($foregroundPid){(Get-Process -Id $foregroundPid -ErrorAction Stop).SessionId}else{-1}); " +
      "[pscustomobject]@{userInteractive=[Environment]::UserInteractive;sessionId=$session;" +
      "foregroundHwnd=[int64]$foreground;foregroundPid=$foregroundPid;foregroundSessionId=$foregroundSession}|ConvertTo-Json -Compress",
  ], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  if (probe.error || probe.status !== 0) {
    throw new Error(`Interaktive Sitzung konnte nicht verifiziert werden: ${probe.error?.message ?? probe.stderr.trim()}`);
  }
  const state = JSON.parse(probe.stdout.trim());
  if (nativePackage && state.ok !== true) throw new Error("Native session probe did not confirm success.");
  if (
    state.userInteractive !== true ||
    !Number.isInteger(state.sessionId) || state.sessionId <= 0 ||
    !Number.isInteger(state.foregroundHwnd) || state.foregroundHwnd <= 0 ||
    !Number.isInteger(state.foregroundPid) || state.foregroundPid <= 0 ||
    state.foregroundSessionId !== state.sessionId
  ) {
    throw new Error(`Interaktive BelegManager-Lease verweigert: ${JSON.stringify(state)}`);
  }
  const token = randomBytes(32).toString("hex").toUpperCase();
  const issuedAtMs = Date.now();
  const issuedAt = new Date(issuedAtMs).toISOString();
  const expiresAt = new Date(issuedAtMs + 60 * 60_000).toISOString();
  process.env.SSE_TEST_INTERACTIVE_RECEIPT_TOKEN = token;
  process.env.SSE_TEST_INTERACTIVE_RECEIPT_EXPIRES_AT = expiresAt;
  process.env.SSE_TEST_INTERACTIVE_RECEIPT_OWNER_PID = String(process.pid);
  return { token, issuedAt, expiresAt, sessionId: state.sessionId };
}

try {
  mkdirSync(caseDir, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(resultDir, { recursive: true });
  mkdirSync(documentsDir, { recursive: true });
  mkdirSync(backupsDir, { recursive: true });
  const receiptLease = interactiveReceiptLease();
  const useWorkerPrewarm = process.env.SSE_TEST_API_PREWARM === "1";
  const foregroundReceiptOperations = new Set(SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS);
  const worker = (operation, args, timeoutMs, signal) => callWorker(
    operation,
    receiptLease && foregroundReceiptOperations.has(operation)
      ? { ...args, __interactiveReceiptLease: receiptLease.token }
      : args,
    timeoutMs,
    signal,
    telemetry,
  );
  const config = {
    host: "127.0.0.1",
    port: 1,
    configPath: join(temporary, "config.json"),
    workspaceDir,
    resultDir,
    documentsDir,
    backupsDir,
    caseDir,
    sseExecutable: process.env.SSE_EXECUTABLE,
    profileId: process.env.SSE_PROFILE_ID,
    // Ein noch unverifiziertes Jahr laesst sich sonst nie verifizieren: seine
    // Betriebsoperationen sind fail-closed. Nur ein ausdruecklich gesetztes
    // SSE_OPERATE_EXPERIMENTAL oeffnet den Weg fuer genau solche Laeufe.
    operateExperimental: process.env.SSE_OPERATE_EXPERIMENTAL === "1",
    ...(receiptLease ? { interactiveReceiptLeaseToken: receiptLease.token } : {}),
  };
  const nativeDirectory = process.env.SSE_TEST_NATIVE_PACKAGE;
  const nativeDigest = process.env.SSE_TEST_NATIVE_MANIFEST_SHA256;
  if (Boolean(nativeDirectory) !== Boolean(nativeDigest)) throw new Error("Native test package and manifest digest must be supplied together.");
  const telemetry = process.env.SSE_MEGA_RAW_REPORT
    ? createExecutionTelemetry({ enabled: true, maxSpansPerTrace: 4096 }) : undefined;
  executionLog = telemetry ? createExecutionTraceLog({
    telemetry, outputPath: `${process.env.SSE_MEGA_RAW_REPORT}.execution.jsonl`,
    repositoryRoot: fileURLToPath(new URL("../", import.meta.url)),
  }) : undefined;
  native = nativeDirectory ? createQtNativeRuntime({ ...config,
    qtNativeRuntime: { directory: nativeDirectory, manifestSha256: nativeDigest },
  }, loadProductProfile(config.profileId), nativeShutdown.signal, { telemetry }) : null;
  if (native && process.env.SSE_TEST_OPERATION_TRACE_DIR) throw new Error("Native benchmark cannot update the Worker coverage ledger.");
  const executor = createApiExecutor(config, native ? withQtNativeLifecycle(worker, native) : worker,
    { telemetry, ...(native ? { qtNativeClientFor: native.client, nativeDesktopStatus: native.desktopStatus,
      nativeDesktopStart: native.desktopStart, nativeDesktopStop: native.desktopStop } : {}) });
  const execute = native ? executor : traceOperations("worker", executor);
  server = createSseApiServer({
    execute,
    ...(executionLog ? { log: record => executionLog.record(record) } : {}),
    ...(useWorkerPrewarm ? {
      prewarmStatus: () => ({ ready: isWarmSpareReady(), failure: lastPrewarmFailure(), poolTarget: warmSparePoolStatus().target }),
    } : {}),
  });
  await listenOnFetchablePort(server);
  if (useWorkerPrewarm) {
    // A partially failed enable can already own workers.
    prewarmStarted = true;
    enableWorkerPrewarm();
    const deadline = performance.now() + prewarmStartupTimeoutMs();
    while (!isWarmSpareReady() && performance.now() < deadline) {
      if (lastPrewarmFailure()) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!isWarmSpareReady()) {
      process.stderr.write(`API-Worker-Prewarm wurde vor dem Test nicht bereit: ${lastPrewarmFailure() ?? "timeout"}\n`);
    }
  }
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("Test-API hat keinen TCP-Port erhalten.");

  primaryPhase = "Testprozess";
  const childEnv = {
    ...process.env,
    SSE_API_URL: `http://127.0.0.1:${address.port}`,
    SSE_TEST_CASE_DIR: caseDir,
    SSE_TEST_SANDBOX_ROOT: temporary,
    SSE_TEST_WORKSPACE_DIR: workspaceDir,
    SSE_TEST_RESULT_DIR: resultDir,
    SSE_TEST_DOCUMENTS_DIR: documentsDir,
    SSE_TEST_BACKUPS_DIR: backupsDir,
    ...(receiptLease ? {
      SSE_TEST_INTERACTIVE_RECEIPT_LEASE_ACTIVE: "1",
      SSE_TEST_INTERACTIVE_RECEIPT_LEASE_ISSUED_AT: receiptLease.issuedAt,
      SSE_TEST_INTERACTIVE_RECEIPT_LEASE_EXPIRES_AT: receiptLease.expiresAt,
      SSE_TEST_INTERACTIVE_RECEIPT_SESSION_ID: String(receiptLease.sessionId),
    } : {}),
  };
  delete childEnv.SSE_TEST_INTERACTIVE_RECEIPT_TOKEN;
  delete childEnv.SSE_TEST_INTERACTIVE_RECEIPT_EXPIRES_AT;
  delete childEnv.SSE_TEST_INTERACTIVE_RECEIPT_OWNER_PID;
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: childEnv,
    stdio: "inherit",
    windowsHide: true,
  });
  const [code, signal] = await once(child, "exit");
  if (signal) {
    childFailed = true;
    throw new Error(`Testprozess wurde durch Signal ${signal} beendet.`);
  }
  childFailed = code !== 0;
  childExitCode = typeof code === "number" ? code : 1;
} catch (error) {
  primaryFailure = { error };
  childFailed = true;
}

// A secondary teardown failure must neither hide the child failure nor prevent
// independent resources from being released. Keep the child's exact exit code.
const cleanupFailures = [];
async function cleanup(phase, action) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => {
        // Native retirement has its own five-second budget. The wrapper also
        // bounds a broken implementation or a callback that is never invoked.
        timer = setTimeout(() => reject(Object.assign(
          new Error(`Cleanup completion remains unproved [${phase}].`),
          { code: "cleanup-timeout", phase },
        )), phase === "sandbox" ? 15_000 : 6_000);
      }),
    ]);
  }
  catch (error) {
    childFailed = true;
    cleanupFailures.push({ phase, error });
  } finally {
    clearTimeout(timer);
  }
}
if (server) await cleanup("http-server", () => new Promise((resolve, reject) => {
  server.close((error) => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
}));
await cleanup("native-shutdown", () => nativeShutdown.abort());
await cleanup("native-runtime", () => native?.close());
if (prewarmStarted) await cleanup("worker-prewarm", () => shutdownWarmSpare());
await cleanup("execution-log", () => executionLog?.close());
let temporaryPreserved = false;
if (childFailed && preserveTemporaryOnFailure) {
  temporaryPreserved = true;
} else if (cleanupFailures.some(({ phase }) => phase === "native-runtime")) {
  // An unproved broker can still reference this workspace; retain its evidence.
  temporaryPreserved = true;
} else {
  await cleanup("sandbox", () => removeDirectoryWhenFree(temporary));
}

if (primaryFailure) console.error(`${primaryPhase} fehlgeschlagen:`, primaryFailure.error);
else if (childExitCode !== 0) process.stderr.write(`Testprozess fehlgeschlagen (Exit-Code ${childExitCode}).\n`);
for (const { phase, error } of cleanupFailures) console.error(`Test-Cleanup fehlgeschlagen [${phase}]:`, error);
if (temporaryPreserved) process.stderr.write(`Test-Sandbox zur Diagnose erhalten: ${temporary}\n`);
if (cleanupFailures.some(({ phase }) => phase === "sandbox")) process.stderr.write(`Test-Sandbox-Cleanup nicht bestätigt: ${temporary}\n`);
process.exitCode = childFailed ? childExitCode || 1 : 0;

if (cleanupFailures.length > 0) {
  // Failed teardown can leave referenced broker handles. Drain queued output,
  // then terminate only this wrapper; a stuck diagnostic stream is bounded.
  const exitCode = process.exitCode;
  const watchdog = setTimeout(() => process.exit(exitCode), 5_000);
  const flush = (stream) => new Promise((resolve) => {
    try { stream.write("", () => resolve()); }
    catch { resolve(); }
  });
  await Promise.all([flush(process.stdout), flush(process.stderr)]);
  clearTimeout(watchdog);
  process.exit(exitCode);
}
