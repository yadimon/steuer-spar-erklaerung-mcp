import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const powershell = process.env.SSE_POWERSHELL_EXE ?? join(
  process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows",
  "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
);
const sandbox = mkdtempSync(join(tmpdir(), "sse-static-marker-prewarm-"));
const markerPath = join(sandbox, "sse-mcp-desktop.txt");
const desktopName = `SSEStatic${randomUUID().replaceAll("-", "")}`;
const holder = spawn(
  powershell,
  ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
    join(root, "test", "desktop-holder.ps1"), "-Name", desktopName],
  { cwd: root, windowsHide: true },
);
let pool;
let holderStderr = "";
holder.stderr.on("data", (chunk) => {
  if (holderStderr.length < 4_096) holderStderr += chunk.toString("utf8");
});

async function waitFor(predicate, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(20);
  }
  assert.fail(message);
}

async function waitForReadyLine(timeoutMs = 20_000) {
  let stdout = "";
  await new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      holder.stdout.off("data", onData);
      holder.off("error", onError);
      holder.off("close", onClose);
      if (error) reject(error); else resolve();
    };
    const onData = (chunk) => {
      stdout += chunk.toString("utf8");
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      try {
        assert.deepEqual(JSON.parse(stdout.slice(0, newline).trim()), { ready: true });
        finish();
      } catch (error) {
        finish(error);
      }
    };
    const onError = (error) => finish(error);
    const onClose = () => finish(new Error(
      `Privater Testdesktop endete vor seiner Bereitschaft.${holderStderr.trim() ? ` stderr: ${holderStderr.trim()}` : ""}`,
    ));
    const timer = setTimeout(() => finish(new Error(
      `Privater Testdesktop meldete sich nicht innerhalb von ${timeoutMs} ms bereit.`,
    )), timeoutMs);
    holder.stdout.on("data", onData);
    holder.once("error", onError);
    holder.once("close", onClose);
  });
}

async function waitForHolderClose(timeoutMs) {
  if (holder.exitCode !== null || holder.signalCode !== null) return true;
  return Promise.race([
    once(holder, "close").then(() => true, () => true),
    delay(timeoutMs).then(() => false),
  ]);
}

async function stopHolder() {
  if (holder.exitCode !== null || holder.signalCode !== null) return;
  try { holder.stdin.end(); } catch { /* Holder ist bereits beendet. */ }
  if (await waitForHolderClose(5_000)) return;
  // Ausschliesslich das von diesem Test gestartete, exakt gebundene Kind
  // beenden; niemals nach Prozessnamen suchen oder fremde Prozesse anfassen.
  try { holder.kill(); } catch { /* Das exakte Kind endete gleichzeitig. */ }
  assert.equal(await waitForHolderClose(5_000), true,
    `Privater Testdesktop-Prozess ${holder.pid ?? "?"} liess sich nicht beenden.`);
}

try {
  await waitForReadyLine();
  writeFileSync(markerPath, `${JSON.stringify({
    schemaVersion: 1,
    owner: "sse",
    name: desktopName,
    pid: holder.pid,
  })}\n`, "utf8");

  // Vor dem ersten Runtime-Import setzen: Markerpfad und Poolgroesse werden
  // absichtlich einmal pro dauerhaftem API-Prozess gebunden.
  process.env.TEMP = sandbox;
  process.env.TMP = sandbox;
  process.env.SSE_WORKER_PREWARM_POOL_SIZE = "1";
  pool = await import("../dist/worker-prewarm.js");
  const worker = await import("../dist/worker.js");
  pool.enableWorkerPrewarm();
  await waitFor(() => pool.warmSparePoolStatus().ready === 1,
    "Statischer Marker-Test erhielt keinen vorgewaermten Arbeiter.");

  const productPromise = worker.callWorker("product_info", {}, 30_000);
  assert.equal(pool.warmSparePoolStatus().ready, 0,
    "product_info muss trotz gueltigem Privatdesktop-Marker die bereite Reserve entnehmen.");
  const product = await productPromise;
  assert.equal(product.ok, true);
  assert.equal(Number.isFinite(product.workerInitializationMs?.dispatcherRegistrationMs), true,
    "product_info wurde nicht vom vorregistrierten Warm-Dispatcher ausgefuehrt.");

  await waitFor(() => pool.warmSparePoolStatus().ready === 1,
    "Reserve wurde nach product_info nicht wieder aufgefuellt.");
  const catalogPromise = worker.callWorker("page_objects", {}, 30_000);
  assert.equal(pool.warmSparePoolStatus().ready, 0,
    "page_objects muss trotz gueltigem Privatdesktop-Marker die bereite Reserve entnehmen.");
  const catalog = await catalogPromise;
  assert.equal(catalog.ok, true);
  assert.equal(typeof catalog.catalog?.schemaVersion, "number");

  await waitFor(() => pool.warmSparePoolStatus().ready === 1,
    "Reserve wurde nach page_objects nicht wieder aufgefuellt.");

  // Der nun absichtlich verwaiste, aber weiterhin syntaktisch gueltige Marker
  // macht das Routing beobachtbar: Nur der markierte Launcher scheitert am
  // inzwischen geschlossenen Desktop; ein sichtbarer Direktstart waere gruen.
  await stopHolder();
  const healthPromise = worker.callWorker("health", {}, 30_000);
  assert.equal(pool.warmSparePoolStatus().ready, 1,
    "health darf die sichtbare Reserve bei gesetztem Privatdesktop-Marker nicht entnehmen.");
  const health = await healthPromise;
  assert.equal(health.ok, false);
  assert(["launch", "worker-exit"].includes(health.kind),
    "health muss am nicht mehr existierenden markierten Desktop statt sichtbar erfolgreich zu starten scheitern.");

  pool.shutdownWarmSpare();
  assert.equal(pool.warmSparePoolStatus().ready, 0);
  const coldProduct = await worker.callWorker("product_info", {}, 30_000);
  assert.equal(coldProduct.ok, false);
  assert(["launch", "worker-exit"].includes(coldProduct.kind),
    "Ohne bereite Reserve muss product_info auf dem markierten Kaltpfad bleiben.");
} finally {
  pool?.shutdownWarmSpare();
  await stopHolder();
  rmSync(sandbox, { recursive: true, force: true });
}

process.stdout.write("Statische Worker: gueltiger Privatdesktop-Marker nutzt den Warm-Pool\n");
