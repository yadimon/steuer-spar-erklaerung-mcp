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
import { once } from "node:events";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
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
const target = join(tmpdir(), `sse-visible-guard-${process.pid}-${Date.now()}.ESt2025`);
const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env } });
const client = new Client({ name: "sse-visible-input-guard", version: "1.0.0" });
let instance = null;
let launchedPid = null;
let sourceHash = null;

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
    "for($i=0;$i -lt 140;$i++){",
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
  const owned = dirname(path) === tmpdir() &&
    basename(path).startsWith("sse-visible-guard-") &&
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
  for (const name of readdirSync(tmpdir()).filter((entry) =>
    entry.startsWith("sse-visible-guard-") && entry.toLowerCase().endsWith(".est2025"))) {
    assert(await removeOwnedTempCopy(join(tmpdir(), name)), `Alte eigene Temp-Kopie blieb gesperrt: ${name}`);
  }

  const sourceInfo = await call("sse_case_hash", { path: source });
  sourceHash = sourceInfo.sha256;
  assert(/^[A-F0-9]{64}$/.test(sourceHash), "Quelldatei hat keinen belastbaren SHA256-Hash.");
  await call("sse_make_working_copy", { source, target, expectedSourceHash: sourceHash });
  const copyInfo = await call("sse_case_hash", { path: target });
  assert(copyInfo.sha256 === sourceHash, "MCP-Arbeitskopie ist nicht bytegleich.");

  const launched = await call("sse_launch", { file: target, mode: "normal" }, 60_000);
  launchedPid = launched.pid;
  const dialogs = await call("sse_dialog_list");
  const realDialogs = (dialogs.dialogs ?? []).filter((dialog) =>
    dialog.kind === "native-dialog" || dialog.kind === "qt-dialog");
  if (realDialogs.length) {
    const recovery = realDialogs.find((dialog) =>
      dialog.title === "Steuerprogramm" &&
      (dialog.texts ?? []).join(" ").toLowerCase().includes("wiederherstell") &&
      (dialog.buttons ?? []).some((button) => button.name === "Nein"));
    const staleImport = realDialogs.find((dialog) =>
      dialog.title === "Aktualisierung fehlgeschlagen!" &&
      (dialog.texts ?? []).join(" ").includes("importierte Steuerfall") &&
      (dialog.buttons ?? []).some((button) => button.name.toLowerCase() === "ok"));
    const expected = recovery ?? staleImport;
    assert(expected && realDialogs.length === 1,
      `Unerwarteter Startdialog; nichts beantwortet: ${JSON.stringify(realDialogs)}`);
    await call("sse_dialog_answer", {
      hwnd: expected.hwnd,
      fingerprint: expected.fingerprint,
      button: recovery ? "Nein" : "OK",
    });
  }

  const state = await call("sse_ui_state",
    Number.isInteger(launched.instance?.hwnd) ? { hwnd: launched.instance.hwnd } : {});
  instance = state.instance;
  assert(Number.isInteger(instance?.pid) && Number.isInteger(instance?.hwnd),
    "SSE-Instanz wurde nicht eindeutig gebunden.");
  const page = await call("sse_page", { hwnd: instance.hwnd });
  assert(page.ueberschrift === "Nebenkosten zu sonstigen Fahrten",
    `Erwartete neutrale Tabellen-Startseite ist nicht offen: ${page.ueberschrift}`);
  const emptyCell = page.tabelle?.ersteFreieZeile?.[0];
  assert(typeof emptyCell?.rid === "string" && emptyCell.rid.length > 0,
    "Leere Tabellenzelle fuer den Guard-Test ist nicht eindeutig lesbar.");
  const args = {
    expectedPage: page.ueberschrift, rid: emptyCell.rid,
    expectedBefore: "", value: "", expectedAfter: "", trackResults: false,
    hwnd: instance.hwnd, pid: instance.pid,
    expectedCasePath: target, expectedCaseHash: copyInfo.sha256,
  };

  const normalResult = await callRaw("sse_change_field", args, 90_000);
  if (normalResult?.isError) {
    const blocked = parsedText(normalResult, "foreground-guard-result");
    assert(blocked.kind === "interference" && blocked.rollback?.versucht === false &&
      blocked.feld?.zustand === "unchanged" && blocked.commit === "epoch-obstructed",
    `Vordergrundblock war nicht fail-closed und rollbackfrei: ${JSON.stringify(blocked)}`);
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

    process.stdout.write(
      `OK: sichtbarer Input-/Fenster-Guard auf MCP-Kopie von ${basename(source)} normal und mit Fremdeingabe verifiziert.\n`,
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
      const sourceAfter = await call("sse_case_hash", { path: source });
      assert(sourceAfter.sha256 === sourceHash, "Quelldatei wurde im sichtbaren Guard-Test veraendert.");
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
  } catch (error) {
    process.stderr.write(`Temp-Cleanup fehlgeschlagen: ${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
