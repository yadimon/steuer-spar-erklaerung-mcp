/**
 * Echte Center-Abdeckung auf einem privaten Desktop.
 *
 * Der absolute, vom Center selbst angezeigte Ordner bleibt nur im Speicher:
 * MCP kennt absichtlich keine PC-Pfade, der HTTP-Aufruf nutzt fuer die
 * Refresh-Precondition den dokumentierten lokalen Kompatibilitaetswert.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callApiOperation } from "../dist/api-client.js";
import { DESKTOP_MARKER_PATH } from "../dist/desktop-marker.js";

assert.equal(process.platform, "win32", "Der Center-Livetest benoetigt Windows.");
assert.equal(process.env.SSE_PROFILE_ID ?? "2025", "2025", "Center ist live bislang nur fuer Profil 2025 verifiziert.");
assert.equal(process.env.SSE_CENTER_LIVE_TEST, "1", "Die Center-Test-Owner-Policy ist nicht explizit aktiviert.");
assert(process.env.SSE_API_URL && process.env.SSE_API_TOKEN, "Der Test laeuft nur ueber test/with-api.mjs.");

const powershell = process.env.SSE_POWERSHELL_EXE ?? join(
  process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows",
  "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
);
const desktopName = `SSECenter${process.pid}`;
const launcherPath = join(process.cwd(), "test", "start-center-on-desktop.ps1");
const workerLauncherPath = join(process.cwd(), "powershell", "run-on-desktop.ps1");
const sha256Text = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function centerProcessCount() {
  const probe = spawnSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
      "[Console]::Out.Write(@(Get-Process -Name SteuertippsCenter -ErrorAction SilentlyContinue).Count)"],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(probe.error, undefined, "Center-Prozessstatus konnte nicht gelesen werden.");
  assert.equal(probe.status, 0, "Center-Prozessstatus endete fehlerhaft.");
  return Number.parseInt(probe.stdout.trim() || "0", 10);
}

function waitForLauncherReady(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    const timeout = setTimeout(() => finish(new Error("Center-Testlauncher meldete sich nicht rechtzeitig.")), 75_000);
    const finish = (error, value) => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
      if (error) reject(error); else resolve(value);
    };
    const onExit = () => finish(new Error("Center-Testlauncher endete vor der Bereitschaft."));
    const onData = (chunk) => {
      stdout += String(chunk);
      if (Buffer.byteLength(stdout, "utf8") > 16_384) {
        finish(new Error("Center-Testlauncher ueberschritt sein Ausgabelimit."));
        return;
      }
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      try { finish(null, JSON.parse(stdout.slice(0, newline).trim())); }
      catch { finish(new Error("Center-Testlauncher lieferte kein gueltiges JSON.")); }
    };
    child.stdout.on("data", onData);
    child.once("exit", onExit);
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => {
    let forced = false;
    let hardTimeout;
    const timeout = setTimeout(() => {
      forced = true;
      child.kill();
      hardTimeout = setTimeout(() => resolve({ code: child.exitCode, signal: "timeout-stuck" }), 5_000);
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(hardTimeout);
      resolve({ code, signal: forced ? "timeout" : signal });
    });
  });
}

async function waitForCenterProcessesToExit(timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (centerProcessCount() === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return centerProcessCount() === 0;
}

function writeOwnedMarker(marker) {
  const text = JSON.stringify(marker);
  const descriptor = openSync(DESKTOP_MARKER_PATH, "wx", 0o600);
  try {
    writeFileSync(descriptor, text, "utf8");
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  return text;
}

function removeOwnedMarker(expectedText) {
  if (!existsSync(DESKTOP_MARKER_PATH)) return true;
  if (readFileSync(DESKTOP_MARKER_PATH, "utf8") !== expectedText) return false;
  unlinkSync(DESKTOP_MARKER_PATH);
  return !existsSync(DESKTOP_MARKER_PATH);
}

function directCenterCases(hwnd) {
  const args = Buffer.from(JSON.stringify({ hwnd }), "utf8").toString("base64");
  const probe = spawnSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", workerLauncherPath,
      "-Op", "center_cases", "-B64", args, "-Desktop", desktopName, "-TimeoutSec", "180"],
    {
      cwd: process.cwd(),
      env: { ...process.env, SSE_PROFILE_ID: "2025", SSE_CENTER_LIVE_TEST: "1" },
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 40 * 1024 * 1024,
    },
  );
  assert.equal(probe.error, undefined, "Direkte private Center-Vorabpruefung konnte nicht starten.");
  assert.equal(probe.status, 0, "Direkte private Center-Vorabpruefung schlug fehl.");
  let result;
  try { result = JSON.parse(probe.stdout.trim()); }
  catch { throw new Error("Direkte private Center-Vorabpruefung lieferte kein JSON."); }
  assert.equal(result.ok, true, `Center-Vorabpruefung scheiterte (${result.kind ?? "unknown"}).`);
  assert.equal(result.modus, "Verzeichnis", "Center startet nicht im vorausgesetzten Verzeichnismodus; nichts umgeschaltet.");
  assert.equal(typeof result.verzeichnis, "string", "Center-Vorabpruefung lieferte kein Verzeichnis.");
  return result;
}

function directoryInventory(directory) {
  const entries = readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      const path = join(directory, entry.name);
      const stats = lstatSync(path, { bigint: true });
      return {
        name: sha256Text(entry.name),
        kind: entry.isFile() ? "file" : entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "link" : "other",
        size: stats.size.toString(),
        mtimeNs: stats.mtimeNs.toString(),
        ...(entry.isFile() ? { content: sha256File(path) } : {}),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  return sha256Text(JSON.stringify(entries));
}

function expectOk(result, operation) {
  assert.equal(result?.ok, true, `${operation} scheiterte (${result?.kind ?? "unknown"}).`);
  return result;
}

assert.equal(centerProcessCount(), 0, "Ein vorhandener Steuertipps-Center wird nicht uebernommen.");
assert.equal(existsSync(DESKTOP_MARKER_PATH), false, "Ein vorhandener Desktop-Marker wird nicht uebernommen.");

const launcher = spawn(
  powershell,
  ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", launcherPath,
    "-ProfileId", "2025", "-Desktop", desktopName, "-TimeoutSec", "60"],
  { cwd: process.cwd(), env: { ...process.env }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
);
let launcherStderrBytes = 0;
let launcherStderrOverflow = false;
launcher.stderr.on("data", (chunk) => {
  launcherStderrBytes += Buffer.byteLength(chunk);
  if (launcherStderrBytes > 64 * 1024) launcherStderrOverflow = true;
});
let markerText = "";
let mainFailure;
let checks = 0;
try {
  const ready = await waitForLauncherReady(launcher);
  assert.equal(ready?.ok, true, `Center-Testlauncher scheiterte (${ready?.kind ?? "unknown"}).`);
  assert.equal(ready.desktop, desktopName);
  assert(Number.isInteger(ready.pid) && ready.pid > 0);
  assert(Number.isInteger(ready.hwnd) && ready.hwnd > 0);

  markerText = writeOwnedMarker({
    schemaVersion: 1,
    owner: "center-test",
    name: desktopName,
    pid: ready.pid,
  });

  // Der direkte private Read liefert den Pfad nur in diesen Prozess. Weder
  // Trace noch API/MCP-Antwort erhalten ihn als lokalen Klartext.
  const privateCases = directCenterCases(ready.hwnd);
  const directory = privateCases.verzeichnis;
  const inventoryBefore = directoryInventory(directory);

  const listed = expectOk(await callApiOperation("center_cases", { hwnd: ready.hwnd }, 180_000), "center_cases");
  checks += 1;
  assert.equal(listed.modus, "Verzeichnis");
  assert(Array.isArray(listed.faelle) && Array.isArray(listed.dateisystemFaelle));
  assert(!JSON.stringify(listed).includes(directory), "API-Antwort enthaelt den absoluten Center-Pfad.");

  const refreshed = expectOk(await callApiOperation(
    "center_refresh",
    { hwnd: ready.hwnd, expectedDirectory: directory },
    180_000,
  ), "center_refresh");
  checks += 1;
  assert.equal(refreshed.sucheUnveraendert, true);
  assert.equal(refreshed.sortierungUnveraendert, true);
  assert(Array.isArray(refreshed.vorher) && Array.isArray(refreshed.nachher));
  assert(!JSON.stringify(refreshed).includes(directory), "Refresh-Antwort enthaelt den absoluten Center-Pfad.");

  const after = expectOk(await callApiOperation("center_cases", { hwnd: ready.hwnd }, 180_000), "center_cases nach Refresh");
  checks += 1;
  assert.equal(after.modus, "Verzeichnis");
  const inventoryAfter = directoryInventory(directory);
  assert.equal(inventoryAfter, inventoryBefore, "Center-Lesetest veraenderte den angezeigten Dateibestand.");

  process.stdout.write(
    `Center-Livevertrag: ${checks} API-Schritte, ${listed.faelle.length} sichtbare Faelle, private Desktop- und Datei-Invarianten bestanden\n`,
  );
} catch (error) {
  mainFailure = error;
} finally {
  const cleanupFailures = [];
  try {
    if (launcher.exitCode === null && launcher.signalCode === null) launcher.stdin.end("STOP\n");
  } catch (error) {
    cleanupFailures.push(error);
  }
  let stopped;
  try {
    stopped = await waitForExit(launcher, 15_000);
    if (stopped.signal === "timeout" || stopped.signal === "timeout-stuck") {
      cleanupFailures.push(new Error("Center-Testlauncher brauchte einen erzwungenen Abbruch."));
    } else if (stopped.code !== 0) {
      cleanupFailures.push(new Error(`Center-Testlauncher endete mit Exit ${stopped.code ?? "unknown"}.`));
    }
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    if (!await waitForCenterProcessesToExit()) {
      cleanupFailures.push(new Error("Center-Test hinterliess einen Steuertipps-Center-Prozess."));
    }
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    if (markerText && !removeOwnedMarker(markerText)) {
      cleanupFailures.push(new Error("Center-Testmarker wechselte den Eigentuemer und blieb erhalten."));
    }
  } catch (error) {
    cleanupFailures.push(error);
  }
  if (launcherStderrOverflow) cleanupFailures.push(new Error("Center-Testlauncher ueberschritt sein stderr-Limit."));
  if (mainFailure && cleanupFailures.length) throw new AggregateError([mainFailure, ...cleanupFailures], "Center-Livetest und Cleanup schlugen fehl.");
  if (mainFailure) throw mainFailure;
  if (cleanupFailures.length) throw new AggregateError(cleanupFailures, "Center-Cleanup schlug fehl.");
}
