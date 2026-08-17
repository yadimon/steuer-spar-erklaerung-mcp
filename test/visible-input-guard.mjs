/**
 * Reale, sichtbare Regression fuer den Eingabe-/Fenster-Guard.
 *
 * Aufruf nur mit einer entbehrlich kopierbaren ESt2025-Datei:
 *   $env:SSE_VISIBLE_FIXTURE='G:\\...\\fall.ESt2025'
 *   npm run test:visible-guard
 *
 * MCP erstellt selbst eine bytegleiche Temp-Kopie. Eine eindeutig gelesene
 * leere Tabellenzelle wird nur erneut leer committed. Danach wird
 * kuenstliche fremde Mausbewegung eingespeist; sie muss als `interference`
 * erkannt werden. Gespeichert wird nie, die Temp-Kopie wird zuletzt entfernt.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { copyFileSync, existsSync, readdirSync, unlinkSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = process.env.SSE_VISIBLE_FIXTURE;
if (!source || extname(source).toLowerCase() !== ".est2025") {
  process.stderr.write("SSE_VISIBLE_FIXTURE mit einer entbehrlich kopierbaren .ESt2025-Datei ist Pflicht.\n");
  process.exit(2);
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const fullText = (result) => result?.content?.filter((part) => part.type === "text")
  .map((part) => part.text).join("\n") ?? "";
const parsedText = (result, name) => {
  const value = fullText(result);
  try { return JSON.parse(value); }
  catch { throw new Error(`${name}: Antwort war kein JSON: ${value}`); }
};

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const server = join(root, "dist", "index.js");
const nativeLoader = join(root, "powershell", "load-native.ps1").replaceAll("'", "''");
const testCaseDir = process.env.SSE_TEST_CASE_DIR;
if (!testCaseDir) throw new Error("SSE_TEST_CASE_DIR aus dem isolierten Test-API-Wrapper fehlt.");
const stagedSource = join(testCaseDir, `sse-visible-source-${process.pid}-${Date.now()}.ESt2025`);
const target = join(testCaseDir, `sse-visible-guard-${process.pid}-${Date.now()}.ESt2025`);
const sourceRef = `cases:${basename(stagedSource)}`;
const targetRef = `cases:${basename(target)}`;
const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env } });
const client = new Client({ name: "sse-visible-input-guard", version: "1.0.0" });
let instance = null;
let launchedPid = null;
let sourceHash = null;
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();

const callRaw = (name, args = {}, timeout = 120_000) => client.callTool(
  { name, arguments: args }, undefined, { timeout, maxTotalTimeout: timeout },
);
const call = async (name, args = {}, timeout = 120_000) => {
  const result = await callRaw(name, args, timeout);
  if (result?.isError) throw new Error(`${name}: ${fullText(result)}`);
  return parsedText(result, name);
};
const startMouseInterference = () => {
  const script = [
    `. '${nativeLoader}'`,
    "$null=Import-SSENativeInterop",
    "Start-Sleep -Milliseconds 350",
    // Ein frischer Worker braucht auf einem belasteten Windows-Rechner mehrere
    // Sekunden fuer PowerShell, UIA und Qt. Die Testinterferenz muss diese
    // Anlaufzeit ueberdecken und noch waehrend der Commit-Epoche aktiv sein.
    "for($i=0;$i -lt 360;$i++){",
    "  $dx=$(if(($i % 2) -eq 0){[uint32]1}else{[uint32]::MaxValue})",
    "  [SW]::mouse_event(1,$dx,0,0,[IntPtr]::Zero)",
    "  Start-Sleep -Milliseconds 25",
    "}",
  ].join("\n");
  return spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    cwd: root, windowsHide: true, stdio: "ignore",
  });
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const removeOwnedTempCopy = async (path) => {
  const owned = dirname(path) === testCaseDir &&
    basename(path).startsWith("sse-visible-") &&
    extname(path).toLowerCase() === ".est2025";
  assert(owned, `Temp-Cleanup verweigert fremdes Ziel: ${path}`);
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!existsSync(path)) return true;
    try { unlinkSync(path); } catch (error) {
      if (error?.code !== "EBUSY" && error?.code !== "EPERM") throw error;
    }
    await wait(250);
  }
  return !existsSync(path);
};

try {
  await client.connect(transport);
  const health = await call("sse_health");
  assert(health.running === false, "Sichtbarer Guard-Test startet nur ohne vorhandene SSE-Instanz.");
  for (const name of readdirSync(testCaseDir).filter((entry) =>
    entry.startsWith("sse-visible-") && entry.toLowerCase().endsWith(".est2025"))) {
    assert(await removeOwnedTempCopy(join(testCaseDir, name)), `Alte eigene Temp-Kopie blieb gesperrt: ${name}`);
  }

  sourceHash = sha256(source);
  assert(/^[A-F0-9]{64}$/.test(sourceHash), "Quelldatei hat keinen belastbaren SHA256-Hash.");
  copyFileSync(source, stagedSource);
  const sourceInfo = await call("sse_case_hash", { ref: sourceRef });
  assert(sourceInfo.sha256 === sourceHash, "Isolierte MCP-Quelldatei ist nicht bytegleich zum Fixture.");
  await call("sse_make_working_copy", { sourceRef, targetRef, expectedSourceHash: sourceHash });
  const copyInfo = await call("sse_case_hash", { ref: targetRef });
  assert(copyInfo.sha256 === sourceHash, "MCP-Arbeitskopie ist nicht bytegleich.");

  const launched = await call("sse_launch", { caseRef: targetRef, mode: "normal" }, 60_000);
  launchedPid = launched.pid;
  if (Number.isInteger(launched.instance?.pid) && Number.isInteger(launched.instance?.hwnd)) {
    instance = launched.instance;
  }
  for (let dialogRound = 0; dialogRound < 4; dialogRound++) {
    const dialogs = await call("sse_dialog_list", { pid: launched.pid });
    const realDialogs = (dialogs.dialogs ?? []).filter((dialog) =>
      dialog.kind === "native-dialog" || dialog.kind === "qt-dialog");
    if (!realDialogs.length) break;
    const recovery = realDialogs.find((dialog) =>
      dialog.title === "Steuerprogramm" &&
      (dialog.texts ?? []).join(" ").toLowerCase().includes("wiederherstell") &&
      (dialog.buttons ?? []).some((button) => button.name === "Nein"));
    const staleImport = realDialogs.find((dialog) =>
      dialog.title === "Aktualisierung fehlgeschlagen!" &&
      (dialog.texts ?? []).join(" ").includes("importierte Steuerfall") &&
      (dialog.buttons ?? []).some((button) => button.name.toLowerCase() === "ok"));
    const profitUpdated = realDialogs.find((dialog) =>
      dialog.title === "Gewinn aktualisiert!" &&
      (dialog.texts ?? []).some((text) => /^Der Gewinn des Betriebs ».+« wurde aktualisiert\.$/u.test(text)) &&
      (dialog.buttons ?? []).length === 1 && dialog.buttons[0].name === "OK");
    const expected = recovery ?? staleImport ?? profitUpdated;
    assert(expected && realDialogs.length === 1,
      `Unerwarteter Startdialog; nichts beantwortet: ${JSON.stringify(realDialogs)}`);
    await call("sse_dialog_answer", {
      hwnd: expected.hwnd,
      fingerprint: expected.fingerprint,
      button: recovery ? "Nein" : "OK",
    });
    if (dialogRound === 3) throw new Error("Startdialog-Kette ueberschritt vier strikt gebundene Antworten.");
  }

  const state = await call("sse_ui_state",
    Number.isInteger(launched.instance?.hwnd) ? { hwnd: launched.instance.hwnd } : {});
  instance = state.instance;
  assert(Number.isInteger(instance?.pid) && Number.isInteger(instance?.hwnd),
    "SSE-Instanz wurde nicht eindeutig gebunden.");
  const targetPage = "Nebenkosten zu sonstigen Fahrten";
  let page = await call("sse_page", { hwnd: instance.hwnd });
  if (page.ueberschrift !== targetPage) {
    const navigation = await call("sse_goto", {
      name: targetPage, maxSteps: 200, useSearch: true, hwnd: instance.hwnd,
    }, 300_000);
    assert(navigation.erreicht === true && navigation.ueberschrift === targetPage,
      `Neutrale Testseite wurde nicht erreicht: ${JSON.stringify(navigation)}`);
    page = await call("sse_page", { hwnd: instance.hwnd });
  }
  assert(page.ueberschrift === targetPage,
    `Erwartete neutrale Tabellenseite ist nicht offen: ${page.ueberschrift}`);
  const emptyCell = page.tabelle?.ersteFreieZeile?.[0];
  assert(typeof emptyCell?.rid === "string" && emptyCell.rid.length > 0,
    "Leere Tabellenzelle fuer den Guard-Test ist nicht eindeutig lesbar.");
  const args = {
    expectedPage: page.ueberschrift, rid: emptyCell.rid,
    expectedBefore: "", value: "", expectedAfter: "", trackResults: false,
    hwnd: instance.hwnd, pid: instance.pid,
    expectedCaseRef: targetRef, expectedCaseHash: copyInfo.sha256,
  };

  const normalResult = await callRaw("sse_change_field", args, 90_000);
  if (normalResult?.isError) {
    const blocked = parsedText(normalResult, "foreground-guard-result");
    const safeGuardCommits = new Set([
      "epoch-obstructed", "focus-mismatch", "stale-window",
      "interference-input-guard-unavailable", "interference-before-click", "interference-before-input",
    ]);
    assert(blocked.kind === "interference" && blocked.rollback?.versucht === false &&
      blocked.feld?.zustand === "unchanged" && safeGuardCommits.has(blocked.commit),
    `Vordergrundblock war nicht fail-closed und rollbackfrei: ${JSON.stringify(blocked)}`);
    assert(blocked.focusTelemetry?.raises <= 1 && blocked.focusTelemetry?.topmostCycles <= 1 &&
      blocked.focusTelemetry?.releases === 1 && !blocked.focusTelemetry?.cleanupError,
    `Vordergrundblock wurde nicht mit genau einer sauberen Lease beendet: ${JSON.stringify(blocked.focusTelemetry)}`);
    process.stdout.write(
      `SKIP: Codex-Fenster blieb vor SSE; epoch-obstructed wurde rollbackfrei erkannt. ` +
      `Normal-/Fremdeingabe-Commit auf ${basename(source)} braucht manuell sichtbares SSE.\n`,
    );
  } else {
    const normal = parsedText(normalResult, "normal-guard-result");
    assert(normal.verified === true && normal.commit === "verified-keyboard-replace",
      `Normaler Guard-Commit ist nicht verifiziert: ${JSON.stringify(normal)}`);
    assert(normal.inputGuard?.eingriffErkannt === false && normal.fensterGuard?.geaendert === false,
      `Normaler Commit meldet falsche Interferenz: ${JSON.stringify(normal)}`);
    assert(normal.focusTelemetry?.raises === 1 && normal.focusTelemetry?.topmostCycles === 1 &&
      normal.focusTelemetry?.releases === 1 && !normal.focusTelemetry?.cleanupError,
    `Normaler Commit verwendete nicht genau einen sauberen Vordergrundzyklus: ${JSON.stringify(normal.focusTelemetry)}`);
    assert(normal.focusTelemetry?.releasedByEmit === false &&
      Number.isFinite(normal.focusTelemetry?.foregroundHeldMs) && normal.focusTelemetry.foregroundHeldMs < 1_800,
    `Normaler Commit gab den Benutzerfokus nicht frueh genug zurueck: ${JSON.stringify(normal.focusTelemetry)}`);
    assert(normal.commitDetails?.settledEarly === true && normal.commitDetails?.settleMs < 700,
      `Normaler Commit nutzte keinen erfolgreichen bounded settle: ${JSON.stringify(normal.commitDetails)}`);

    const stateAfter = await call("sse_ui_state", { hwnd: instance.hwnd });
    assert(stateAfter.heading === page.ueberschrift, "Seite wechselte nach dem neutralen Commit.");
    const helper = startMouseInterference();
    const helperExit = once(helper, "exit");
    const interferedResult = await callRaw("sse_change_field", args, 90_000);
    await helperExit;
    assert(interferedResult?.isError === true,
      `Fremde Eingabe wurde unerwartet akzeptiert: ${fullText(interferedResult)}`);
    const interfered = parsedText(interferedResult, "interference-result");
    assert(interfered.kind === "interference" && interfered.rollback?.versucht === false,
      `Fremde Eingabe loeste keinen fail-closed Stop ohne Rollback aus: ${JSON.stringify(interfered)}`);
    assert(interfered.inputGuard?.eingriffErkannt === true || interfered.fensterGuard?.geaendert === true ||
      interfered.commit?.startsWith("epoch-"),
    `Interference-Ergebnis nennt keinen ausgeloesten Guard: ${JSON.stringify(interfered)}`);
    assert(interfered.focusTelemetry?.topmostCycles <= 1 && interfered.focusTelemetry?.releases === 1 &&
      !interfered.focusTelemetry?.cleanupError,
    `Interference liess eine unsaubere Vordergrund-Lease zurueck: ${JSON.stringify(interfered.focusTelemetry)}`);

    process.stdout.write(
      `OK: sichtbarer Input-/Fenster-Guard auf MCP-Kopie von ${basename(source)} normal und mit Fremdeingabe verifiziert.\n` +
      `PERF: foreground ${normal.focusTelemetry.foregroundHeldMs} ms, commit settle ${normal.commitDetails.settleMs} ms.\n`,
    );
  }
} finally {
  if (instance?.pid && instance?.hwnd) {
    try {
      await callRaw("sse_close", {
        pid: instance.pid, hwnd: instance.hwnd, force: true, discardChanges: true,
      }, 60_000);
    } catch { }
  } else if (launchedPid) {
    // Ohne gebundenes Hauptfenster wird kein fremder Prozess beendet. Der
    // Test startete nur bei leerer SSE-Prozessliste; PID ist damit test-eigen.
    try {
      await callRaw("sse_close", { pid: launchedPid, force: true, discardChanges: true }, 60_000);
    } catch { }
  }
  if (sourceHash) {
    try {
      const stagedSourceAfter = await call("sse_case_hash", { ref: sourceRef });
      assert(stagedSourceAfter.sha256 === sourceHash, "Isolierte MCP-Quelldatei wurde veraendert.");
      assert(sha256(source) === sourceHash, "Original-Fixture wurde im sichtbaren Guard-Test veraendert.");
    } catch (error) {
      process.stderr.write(`${error?.stack ?? error}\n`);
      process.exitCode = 1;
    }
  }
  try { await client.close(); } catch { }
  try {
    if (!await removeOwnedTempCopy(target)) {
      process.stderr.write(`Temp-Kopie blieb nach 5 Sekunden gesperrt: ${target}\n`);
      process.exitCode = 1;
    }
    if (!await removeOwnedTempCopy(stagedSource)) {
      process.stderr.write(`Isolierte Fixture-Kopie blieb nach 5 Sekunden gesperrt: ${stagedSource}\n`);
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`Temp-Cleanup fehlgeschlagen: ${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
