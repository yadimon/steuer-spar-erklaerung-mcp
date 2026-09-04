import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, mkdirSync } from "node:fs";
import { removeDirectoryWhenFree } from "./remove-when-free.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiExecutor } from "../dist/api-executor.js";
import { createSseApiServer } from "../dist/api-server.js";
import { callWorker } from "../dist/worker.js";
import {
  enableWorkerPrewarm,
  isWarmSpareReady,
  lastPrewarmFailure,
  shutdownWarmSpare,
  warmSparePoolStatus,
} from "../dist/worker-prewarm.js";
import { SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS } from "../dist/receipt-interaction-policy.js";
import { resolveWindowsPowerShell } from "../dist/windows-runtime.js";
import { traceOperations } from "./operation-trace.mjs";

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
mkdirSync(caseDir, { recursive: true });
mkdirSync(workspaceDir, { recursive: true });
mkdirSync(resultDir, { recursive: true });
mkdirSync(documentsDir, { recursive: true });
mkdirSync(backupsDir, { recursive: true });

function interactiveReceiptLease() {
  if (process.env.SSE_TEST_INTERACTIVE_RECEIPTS !== "1") return null;
  if (process.platform !== "win32") {
    throw new Error("Der interaktive BelegManager-Testschalter ist nur in einer sichtbaren Windows-Sitzung erlaubt.");
  }
  const probe = spawnSync(resolveWindowsPowerShell(), [
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
const execute = traceOperations("worker", createApiExecutor(config, worker));
const server = createSseApiServer({
  execute,
  ...(useWorkerPrewarm ? {
    prewarmStatus: () => ({ ready: isWarmSpareReady(), failure: lastPrewarmFailure(), poolTarget: warmSparePoolStatus().target }),
  } : {}),
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
if (useWorkerPrewarm) {
  enableWorkerPrewarm();
  const deadline = Date.now() + 15_000;
  while (!isWarmSpareReady() && Date.now() < deadline) {
    if (lastPrewarmFailure()) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!isWarmSpareReady()) {
    process.stderr.write(`API-Worker-Prewarm wurde vor dem Test nicht bereit: ${lastPrewarmFailure() ?? "timeout"}\n`);
  }
}
const address = server.address();
if (!address || typeof address !== "object") throw new Error("Test-API hat keinen TCP-Port erhalten.");

let childFailed = false;
try {
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
  process.exitCode = typeof code === "number" ? code : 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
  if (useWorkerPrewarm) shutdownWarmSpare();
  if (childFailed && preserveTemporaryOnFailure) {
    process.stderr.write(`Test-Sandbox zur Diagnose erhalten: ${temporary}\n`);
  } else {
    await removeDirectoryWhenFree(temporary);
  }
}
