import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createApiExecutor } from "../dist/api-executor.js";
import { createSseApiServer } from "../dist/api-server.js";
import { callWorker } from "../dist/worker.js";
import { desktopMarkerState, directWorker, powershell, root, ssePids } from "./direct-worker-helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const peerScript = join(here, "worker-controller-mutex-peer.ps1");
const workerPath = join(root, "powershell", "sse-worker.ps1");
const workerSource = readFileSync(workerPath, "utf8");
const nativeSource = readFileSync(join(root, "powershell", "sse-native.cs"), "utf8");
const mutexName = "Local\\SteuerSparErklaerungApi.SseWorkerController";
const spawnedChildren = new Set();
const controllerProcessIds = () => {
  const output = execFileSync(powershell, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
    "$names = 'sse-worker.ps1|worker-controller-mutex-peer.ps1|dist[\\\\/]index.js'; " +
      "@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match $names } | " +
      "Select-Object -ExpandProperty ProcessId) -join ','",
  ], { windowsHide: true, encoding: "utf8" }).trim();
  return new Set(output ? output.split(",").map(Number) : []);
};
const controllerProcessesBefore = controllerProcessIds();

assert.equal(ssePids(), "", "Der Controllervertrag startet nur ohne laufende SSE.");
const markerBefore = desktopMarkerState();

const mutexLiteral = `$script:SSE_WORKER_CONTROLLER_MUTEX_NAME = '${mutexName}'`;
assert.equal(workerSource.split(mutexLiteral).length - 1, 1, "Der sitzungsweite Mutex braucht genau einen festen Namen.");
assert.doesNotMatch(mutexLiteral, /profile|year|port|pid|path|env/iu);
assert(workerSource.includes("@('page_objects','product_info') -ccontains $profilePolicyOperation"),
  "Nur die beiden statischen Workerpfade duerfen den Mutex umgehen.");
const nativeController = nativeSource.slice(
  nativeSource.indexOf("public sealed class SSEWorkerControllerLease"),
  nativeSource.indexOf("public class SW"),
);
assert.match(nativeController, /CreateMutex[\s\S]*WaitForSingleObject\(handle, 0\)/u,
  "Der native Controller muss den festen Kernel-Mutex ohne Wartezeit versuchen.");
const busyBranch = nativeController.slice(
  nativeController.indexOf("if (wait == WAIT_TIMEOUT)"),
  nativeController.indexOf("if (wait == WAIT_OBJECT_0"),
);
assert(busyBranch.indexOf("DSK.CloseHandle(handle)") >= 0 &&
  busyBranch.indexOf('Result("busy", "session-controller-busy")') > busyBranch.indexOf("DSK.CloseHandle(handle)"),
"Busy muss den nicht besessenen Handle vor der Ergebnisbildung schliessen.");
const acquiredBranch = nativeController.slice(
  nativeController.indexOf("if (wait == WAIT_OBJECT_0"),
  nativeController.indexOf("DSK.CloseHandle(handle)", nativeController.indexOf("if (wait == WAIT_OBJECT_0")),
);
assert.match(acquiredBranch, /WAIT_ABANDONED[\s\S]*"abandoned"[\s\S]*true,[\s\S]*DSK\.GetCurrentThreadId\(\)/u,
  "Beobachtete Aufgabe muss als eigenes, threadgebundenes Mutex-Eigentum zurueckkommen.");

const exitLeaseSource = nativeController.slice(
  nativeController.indexOf("public static string ReleaseAndClose"),
);
const threadCheck = exitLeaseSource.indexOf("DSK.GetCurrentThreadId() != lease.ownerThreadId");
const releaseMutex = exitLeaseSource.indexOf("ReleaseMutex(lease.handle)");
const closeHandle = exitLeaseSource.indexOf("DSK.CloseHandle(lease.handle)");
const clearHandle = exitLeaseSource.indexOf("lease.handle = IntPtr.Zero");
assert(threadCheck >= 0 && releaseMutex > threadCheck && closeHandle > releaseMutex && clearHandle > closeHandle,
  "Owner-Thread muss vor Release geprueft, danach freigegeben, geschlossen und erst zuletzt lokal geloescht werden.");
for (const reason of [
  "controller-lock-thread-changed", "controller-lock-release-failed", "controller-lock-dispose-failed",
]) {
  assert(exitLeaseSource.includes(reason), `Fail-closed Freigabegrund '${reason}' fehlt.`);
}

const foregroundGuard = workerSource.indexOf("if ($profilePolicyOperation -in $foregroundRequiredReceiptOps)");
const experimentalGuard = workerSource.indexOf("if ($verificationOnlyProfile -and $profilePolicyOperation");
const acquire = workerSource.indexOf("$controllerLease = if (@('page_objects','product_info')");
const desktopInitialize = workerSource.indexOf("if (Test-Path -LiteralPath $script:DESKTOP_MARKE)", acquire);
const buildGate = workerSource.indexOf("Assert-SSEVerifiedBuildForOperation $profilePolicyOperation $a", acquire);
const warmDispatch = workerSource.indexOf("Invoke-SSEWorkerOperation $Op $a", buildGate);
const coldDispatch = workerSource.lastIndexOf("Invoke-SSEWorkerOperation $Op $a");
assert(foregroundGuard >= 0 && experimentalGuard > foregroundGuard && acquire > experimentalGuard,
  "Profil- und Vordergrundgrenzen muessen vor Controllerkonflikten entscheiden.");
assert(desktopInitialize > acquire && buildGate > desktopInitialize && warmDispatch > buildGate && coldDispatch > warmDispatch,
  "Mutex muss Desktopbindung, Buildaufloesung und beide aeusseren Dispatcher umschliessen.");
const eagerDesktopBlock = workerSource.slice(
  workerSource.indexOf("$script:DESKTOP_OWNER = $null"),
  workerSource.indexOf("# Qt 6 exposes"),
);
assert.doesNotMatch(eagerDesktopBlock, /OpenDesktop|Read-SSEDesktopMarker/,
  "Vor dem Controllerlease darf keine Desktopaktion mehr eager laufen.");
const leasedDesktopBlock = workerSource.slice(desktopInitialize, buildGate);
assert.match(leasedDesktopBlock, /Read-SSEDesktopMarker[\s\S]*OpenDesktop/u,
  "Desktopmarker und Desktopbindung muessen inline im erworbenen Lease bleiben.");
assert.doesNotMatch(workerSource, /function Initialize-SSEDesktopContext/u,
  "Ein nach ready aufgerufener PowerShell-Wrapper wuerde die warme Auftragszeit unnoetig verlaengern.");

const capturedFunction = workerSource.slice(
  workerSource.indexOf("function Invoke-SSECapturedOperation"),
  workerSource.indexOf("function Invoke-SSEMeasuredPlanOperation"),
);
assert.doesNotMatch(capturedFunction, /SSEWorkerControllerLease|ReleaseAndClose/,
  "Interne Bulk-Schritte muessen den aeusseren Lease erben.");
const captureBoundary = workerSource.indexOf("if ($script:SSE_CAPTURE_OPERATION_RESULT)");
const releaseBoundary = workerSource.indexOf("[SSEWorkerControllerLease]::ReleaseAndClose", captureBoundary);
const serializationBoundary = workerSource.indexOf("ConvertTo-Json -Depth 24 -Compress", releaseBoundary);
assert(releaseBoundary > captureBoundary && serializationBoundary > releaseBoundary,
  "Nur das aeussere Emit darf nach Capture und vor Serialisierung freigeben.");
const trapSource = /trap \{([\s\S]*?)\n\}/u.exec(workerSource)?.[1] ?? "";
assert(trapSource.includes("Emit"), "Der globale trap muss durch den gemeinsamen Release-Rand laufen.");
assert(workerSource.includes("Fail 'Vorgewaermter Dispatcher kehrte ohne Ergebnis zurueck.' 'worker-init'"));
assert(workerSource.includes("Fail 'Kalter Dispatcher kehrte ohne Ergebnis zurueck.' 'worker-init'"));
const releaseFailurePayload = workerSource.slice(releaseBoundary, serializationBoundary);
for (const fragment of [
  "kind='worker-isolation-lost'", "retryable=$false", "resultingState='unknown'", "cleanupRequired=$true",
]) {
  assert(releaseFailurePayload.includes(fragment), `Releasefehler muss '${fragment}' melden.`);
}
assert.doesNotMatch(workerSource, /function (?:Enter|Exit)-SSEWorkerControllerLease/u,
  "Controller-Lifecycle darf die Ersatzworker-Bereitschaft nicht mehr mit PowerShell-Funktionsregistrierung belasten.");
const abandonedWorkerBranch = workerSource.slice(
  workerSource.indexOf("'abandoned' {", acquire),
  workerSource.indexOf("default {", workerSource.indexOf("'abandoned' {", acquire)),
);
assert(abandonedWorkerBranch.indexOf("$script:SSE_WORKER_CONTROLLER_LEASE = $controllerLease") >= 0 &&
  abandonedWorkerBranch.indexOf("Fail '") > abandonedWorkerBranch.indexOf("$script:SSE_WORKER_CONTROLLER_LEASE = $controllerLease"),
"Beobachtete Aufgabe muss vor Fail am aeusseren Emit-Rand gebunden werden.");

const waitForChildClose = async (child, label, timeoutMs = 15_000) => {
  if (child.exitCode !== null) return child.exitCode;
  const outcome = await Promise.race([
    once(child, "close").then(([code]) => ({ closed: true, code })),
    new Promise((resolve) => setTimeout(() => resolve({ closed: false }), timeoutMs)),
  ]);
  assert.equal(outcome.closed, true, `${label} endete nicht binnen ${timeoutMs} ms.`);
  return outcome.code;
};

const killChild = async (child, label = "Testkindprozess") => {
  if (child.exitCode !== null) return;
  assert(Number.isInteger(child.pid) && child.pid > 0, "Nur der verifizierte Testkindprozess darf beendet werden.");
  try {
    execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } catch (error) {
    if (child.exitCode === null) throw error;
  }
  await waitForChildClose(child, label);
};

const startPeer = async (mode) => {
  const child = spawn(powershell, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", peerScript, "-Mode", mode,
  ], { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  assert(Number.isInteger(child.pid) && child.pid > 0, `${mode}-Peer hat keinen Prozessbezeichner.`);
  spawnedChildren.add(child);
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    const deadline = Date.now() + 15_000;
    while (!stdout.includes("\n") && child.exitCode === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(child.exitCode, null, `${mode}-Peer endete vor Bereitschaft: ${stderr}`);
    assert(stdout.includes("\n"), `${mode}-Peer meldete sich nicht rechtzeitig bereit: ${stderr}`);
    const ready = JSON.parse(stdout.slice(0, stdout.indexOf("\n")).trim());
    assert.equal(ready.ready, true);
    assert.equal(ready.mode, mode);
    assert.equal(ready.pid, child.pid);
    return { child, stderr: () => stderr };
  } catch (error) {
    await killChild(child, `${mode}-Peer`);
    throw error;
  }
};

const stopPeer = async (peer, command = "release") => {
  if (peer.child.exitCode !== null) {
    assert.equal(peer.child.exitCode, 0, peer.stderr());
    return;
  }
  peer.child.stdin.end(`${command}\n`, "utf8");
  const code = await waitForChildClose(peer.child, "Mutex-Peer");
  assert.equal(code, 0, peer.stderr());
};

const runPrewarmJob = async (operation) => {
  const argsFile = join(tmpdir(), `sse-args-${randomUUID().replaceAll("-", "")}.json`);
  writeFileSync(argsFile, "{}", "utf8");
  const child = spawn(powershell, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", workerPath, "-Prewarm",
  ], { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  assert(Number.isInteger(child.pid) && child.pid > 0, "Prewarm-Testworker hat keinen Prozessbezeichner.");
  spawnedChildren.add(child);
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    const deadline = Date.now() + 30_000;
    while (!stdout.includes("\n") && child.exitCode === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(child.exitCode, null, `Prewarm endete vor ready: ${stderr}`);
    const newline = stdout.indexOf("\n");
    assert(newline > 0, `Prewarm meldete sich nicht rechtzeitig bereit: ${stderr}`);
    const ready = JSON.parse(stdout.slice(0, newline).trim());
    assert.equal(ready.prewarm, "ready");
    child.stdin.end(`${JSON.stringify({ op: operation, argsFile })}\n`, "utf8");
    const [code] = await once(child, "close");
    assert.equal(code, 0, stderr);
    return JSON.parse(stdout.slice(newline + 1).trim());
  } finally {
    if (child.exitCode === null) await killChild(child, "Prewarm-Testworker");
    rmSync(argsFile, { force: true });
  }
};

const killPeer = async (peer) => {
  await killChild(peer.child, "Mutex-Peer");
};

const runApiAndMcpBusy = async () => {
  const temporary = mkdtempSync(join(tmpdir(), "sse-controller-api-"));
  const caseDir = join(temporary, "cases");
  const workspaceDir = join(temporary, "workspace");
  const resultDir = join(temporary, "results");
  for (const directory of [caseDir, workspaceDir, resultDir]) mkdirSync(directory, { recursive: true });
  const execute = createApiExecutor({
    host: "127.0.0.1",
    port: 1,
    configPath: join(temporary, "config.json"),
    caseDir,
    workspaceDir,
    resultDir,
  }, callWorker);
  const server = createSseApiServer({ execute });
  let client;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}/v1/operations/health`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args: {}, timeoutMs: 30_000 }),
    });
    assert.equal(response.status, 200, "Sitzungs-Busy bleibt am echten HTTP-Rand ein Operationsergebnis.");
    const envelope = await response.json();
    assert.equal(envelope.result?.kind, "busy");
    assert.equal(envelope.result?.reason, "session-controller-busy");

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(root, "dist", "index.js")],
      env: { ...process.env, SSE_API_URL: baseUrl },
    });
    client = new Client({ name: "controller-busy-contract", version: "1.0.0" });
    await client.connect(transport);
    const throughMcp = await client.callTool({ name: "sse_health", arguments: {} });
    assert.equal(throughMcp.isError, true);
    assert.equal(throughMcp.structuredContent?.kind, "busy");
    assert.equal(throughMcp.structuredContent?.reason, "session-controller-busy");
    assert.equal(throughMcp.structuredContent?.waited, false);
    assert.match(throughMcp.structuredContent?.hint ?? "", /frischen Bindungen/);
  } finally {
    try {
      if (client) await client.close();
    } finally {
      try {
        if (server.listening) await new Promise((resolve) => server.close(resolve));
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    }
  }
};

let owner;
let keeper;
let collision;
let controllerTestFailure;
try {
  owner = await startPeer("owner");
  const busyStarted = performance.now();
  const busy = directWorker("health", {});
  const busyMs = performance.now() - busyStarted;
  assert.equal(owner.child.exitCode, null, "Busy muss vor Freigabe des Owners feststehen.");
  assert.equal(busy.ok, false);
  assert.equal(busy.kind, "busy");
  assert.equal(busy.reason, "session-controller-busy");
  assert.equal(busy.retryable, true);
  assert.equal(busy.waited, false);
  assert.equal(busy.mutationStarted, false);
  assert.equal(busy.resultingState, "unchanged");
  assert.equal(busy.cleanupRequired, false);
  assert.equal(busy.physicalInputUsed, false);
  assert.equal(busy.foregroundLeaseUsed, false);
  await runApiAndMcpBusy();

  const blockedReceipt = directWorker("receipt_manager_read", {});
  assert.equal(blockedReceipt.reason, "foreground-required-operation-disabled",
    "Der dauerhafte Vordergrundblock muss vor einer temporaeren Controllerbelegung entscheiden.");
  assert.equal(blockedReceipt.retryable, false);
  assert.equal(owner.child.exitCode, null);

  const prewarmedBusy = await runPrewarmJob("health");
  assert.equal(prewarmedBusy.reason, "session-controller-busy",
    "Ein wartender Reserveworker darf den Lease erst mit seinem Auftrag versuchen.");
  assert.equal(owner.child.exitCode, null);

  for (const operation of ["product_info", "page_objects"]) {
    const bypass = directWorker(operation, {});
    assert.equal(bypass.ok, true, `${operation} darf trotz belegtem Controller laufen: ${JSON.stringify(bypass)}`);
    assert.equal(owner.child.exitCode, null);
  }
  await stopPeer(owner);
  owner = undefined;

  // Der Keeper besitzt den Mutex nicht, haelt aber das Kernelobjekt offen.
  // Fehlt einem erfolgreich oder per Fail endenden Worker ReleaseMutex(),
  // beobachtet der jeweils folgende Worker dadurch sicher eine Aufgabe.
  keeper = await startPeer("keeper");
  const afterRelease = directWorker("health", {});
  assert.equal(afterRelease.ok, true, "Graceful Release muss den Controller explizit freigeben.");
  assert.equal(afterRelease.running, false);
  const afterSuccessfulRelease = directWorker("health", {});
  assert.equal(afterSuccessfulRelease.ok, true,
    "Ein offener Keeper muss eine fehlende Freigabe nach erfolgreichem Emit sichtbar machen.");
  const failedAfterAcquire = directWorker("unknown_operation", {});
  assert.equal(failedAfterAcquire.kind, "bad-args");
  const afterFailedDispatch = directWorker("health", {});
  assert.equal(afterFailedDispatch.ok, true,
    "Ein offener Keeper muss eine fehlende Freigabe nach Fail sichtbar machen.");

  const captured = directWorker("bulk_action", {
    schemaVersion: 1,
    planKind: "fill-fields",
    stopOnError: true,
    rollback: "best-effort",
    finalReadback: true,
    actions: [{
      id: "field:bezeichnung",
      operation: "tracked_set_value",
      args: {
        pageId: "gew.fahrzeug",
        fieldId: "bezeichnung",
        expectedBefore: "Alt",
        value: "Neu",
        expectedAfter: "Neu",
      },
    }],
    finalReadbackPlan: { operation: "known_page_state", args: { pageId: "gew.fahrzeug" } },
  });
  assert.equal(captured.ok, false, "Der produktfreie Capture-Plan muss ohne offenen Fall fail-closed enden.");
  assert.equal(captured.planKind, "fill-fields");
  assert.equal(captured.performance?.internalOperationCount, 2);
  const afterCapturedRelease = directWorker("health", {});
  assert.equal(afterCapturedRelease.ok, true,
    "Interne Capture-Ergebnisse duerfen den geerbten aeusseren Lease nicht behalten.");
  await stopPeer(keeper, "close");
  keeper = undefined;

  collision = await startPeer("event");
  const unavailable = directWorker("health", {});
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.kind, "worker-isolation-lost");
  assert.equal(unavailable.reason, "controller-lock-unavailable");
  assert.equal(unavailable.retryable, false);
  assert.equal(unavailable.mutationStarted, false);
  assert.equal(unavailable.resultingState, "unknown");
  assert.equal(unavailable.cleanupRequired, true);
  await stopPeer(collision, "close");
  collision = undefined;

  owner = await startPeer("owner");
  keeper = await startPeer("keeper");
  await killPeer(owner);
  owner = undefined;
  const abandoned = directWorker("health", {});
  assert.equal(abandoned.ok, false);
  assert.equal(abandoned.kind, "worker-isolation-lost");
  assert.equal(abandoned.reason, "controller-lock-abandoned");
  assert.equal(abandoned.retryable, false);
  assert.equal(abandoned.mutationStarted, false);
  assert.equal(abandoned.resultingState, "unknown");
  assert.equal(abandoned.cleanupRequired, true);
  await stopPeer(keeper, "close");
  keeper = undefined;
  const afterObservedAbandonment = directWorker("health", {});
  assert.equal(afterObservedAbandonment.ok, true, "Beobachtete Aufgabe muss genau einmal freigegeben werden.");

  // Ohne einen offenen Peer-Handle verschwindet das Kernelobjekt mit dem
  // getoeteten Owner. Ein spaeterer Worker darf daraus keine erfundene,
  // dauerhafte Crash-Erkennung ableiten.
  owner = await startPeer("owner");
  await killPeer(owner);
  owner = undefined;
  const afterUnobservedDeath = directWorker("health", {});
  assert.equal(afterUnobservedDeath.ok, true);
  assert.notEqual(afterUnobservedDeath.reason, "controller-lock-abandoned");

  process.stdout.write(`Worker-Controller: zero-wait busy (${busyMs.toFixed(1)} ms E2E), Bypaesse, Release, Typkollision und korrigierte Abandonment-Grenze bestanden\n`);
} catch (error) {
  controllerTestFailure = error;
} finally {
  for (const peer of [keeper, collision, owner]) {
    if (!peer || peer.child.exitCode !== null) continue;
    try { await stopPeer(peer, "close"); }
    catch {
      try { await killPeer(peer); } catch { }
    }
  }
  let cleanupFailure;
  try {
    assert.equal(desktopMarkerState(), markerBefore, "Controllervertrag darf den Desktop-Marker nicht veraendern.");
    assert.equal(ssePids(), "", "Controllervertrag darf keinen SSE-Prozess hinterlassen.");
    for (const child of spawnedChildren) {
      const exited = child.exitCode !== null || child.signalCode !== null;
      assert.equal(exited, true, `Vom Controllervertrag gestarteter PID ${child.pid} blieb zurueck.`);
    }
    const newControllerChildren = [...controllerProcessIds()].filter((pid) => !controllerProcessesBefore.has(pid));
    assert.deepEqual(newControllerChildren, [],
      `Controllervertrag liess neue Worker-/Peer-/MCP-Prozesse zurueck: ${newControllerChildren.join(",")}`);
  } catch (error) {
    cleanupFailure = error;
  }
  if (controllerTestFailure && cleanupFailure) {
    throw new AggregateError([controllerTestFailure, cleanupFailure],
      "Controllervertrag und seine Cleanup-Pruefung sind fehlgeschlagen.");
  }
  if (cleanupFailure) throw cleanupFailure;
  if (controllerTestFailure) throw controllerTestFailure;
}
