/**
 * Realer, verwerfbarer Mehrinstanztest fuer die Hauptfensterbindung.
 *
 * Voraussetzung:
 *   SSE_MULTI_INSTANCE_FIXTURE=<neutrale .Gew2025-Datei> npm run test:multi-instance
 * Optional:
 *   SSE_MULTI_INSTANCE_EXPECTED_HASH=<SHA256 der neutralen Quelle>
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixture = process.env.SSE_MULTI_INSTANCE_FIXTURE;
if (!fixture) {
  process.stdout.write("SKIP: SSE_MULTI_INSTANCE_FIXTURE ist nicht gesetzt.\n");
  process.exit(0);
}
if (!existsSync(fixture) || extname(fixture).toLowerCase() !== ".gew2025") {
  throw new Error("SSE_MULTI_INSTANCE_FIXTURE muss eine vorhandene neutrale .Gew2025-Datei sein.");
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const fullText = (result) => result?.content?.filter((part) => part.type === "text")
  .map((part) => part.text).join("\n") ?? "";
const parsed = (result, name, allowError = false) => {
  if (result?.isError && !allowError) throw new Error(`${name}: ${fullText(result)}`);
  try { return JSON.parse(fullText(result)); }
  catch {
    if (allowError) return null;
    throw new Error(`${name}: Antwort war kein JSON: ${fullText(result)}`);
  }
};
const ssePids = () => execFileSync(
  "powershell.exe",
  ["-NoLogo", "-NoProfile", "-Command", "@(Get-Process -Name SSE -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id | Sort-Object) -join ','"],
  { encoding: "utf8", windowsHide: true },
).trim();
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const expectedHash = process.env.SSE_MULTI_INSTANCE_EXPECTED_HASH?.toUpperCase();
const fixtureHash = sha256(fixture);
if (expectedHash) assert(fixtureHash === expectedHash, "Fixture-Hash entspricht nicht SSE_MULTI_INSTANCE_EXPECTED_HASH.");
const pidsBefore = ssePids();
assert(!pidsBefore, "Mehrinstanztest startet nur ohne vorhandene SSE-Instanz.");

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..", "dist", "index.js");
const tempDir = mkdtempSync(join(tmpdir(), "sse-multi-instance-"));
const firstPath = join(tempDir, "first.Gew2025");
const secondPath = join(tempDir, "second.Gew2025");
const markerPath = join(tmpdir(), "sse-mcp-desktop.txt");
const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env } });
const client = new Client({ name: "sse-multi-instance-binding", version: "1.0.0" });
let firstPid = null;
let secondPid = null;

const callRaw = (name, args = {}, timeout = 180_000) => client.callTool(
  { name, arguments: args }, undefined, { timeout, maxTotalTimeout: timeout },
);
const call = async (name, args = {}, timeout = 180_000) => parsed(await callRaw(name, args, timeout), name);
const expectAmbiguous = async (name, args) => {
  let lastResult = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    lastResult = await callRaw(name, args);
    const message = fullText(lastResult);
    if (lastResult?.isError === true && /Mehrere SSE-2025-Hauptfenster|Mehrere SSE-Instanzen/i.test(message)) return;
    if (!/Kein SSE-2025-Hauptfenster gefunden/i.test(message)) break;
    await wait(500);
  }
  const diagnosticWindows = await call("sse_windows");
  const marker = existsSync(markerPath) ? readFileSync(markerPath, "utf8").trim() : "<missing>";
  assert(false, `${name} war ohne hwnd nicht eindeutig fail-closed: ${fullText(lastResult)}; ` +
    `marker=${marker}; windows=${JSON.stringify(diagnosticWindows.windows)}`);
};

try {
  await client.connect(transport);
  await call("sse_make_working_copy", { source: fixture, target: firstPath, expectedSourceHash: fixtureHash });
  await call("sse_make_working_copy", { source: fixture, target: secondPath, expectedSourceHash: fixtureHash });

  const first = await call("sse_desktop_start", {
    file: firstPath, mode: "einur", name: `SSEMulti${process.pid}`, timeoutSec: 45,
  }, 180_000);
  firstPid = first.pid;
  const singleSave = await call("sse_save", {
    expectedPath: firstPath,
    expectedHashBefore: sha256(firstPath),
  });
  assert(singleSave.ok === true && singleSave.noChanges === true && singleSave.path === firstPath,
    `sse_save band die einzelne Instanz ohne hwnd nicht sicher: ${JSON.stringify(singleSave)}`);
  const second = await call("sse_launch", { file: secondPath, mode: "einur" }, 120_000);
  secondPid = second.pid;
  assert(Number.isInteger(firstPid) && Number.isInteger(secondPid) && firstPid !== secondPid,
    `Zwei getrennte SSE-Prozesse wurden nicht gestartet: ${firstPid}/${secondPid}`);

  await wait(2000);
  const windows = await call("sse_windows");
  const mainWindows = (windows.windows ?? []).filter((window) => /SteuerSparErklärung/.test(window.title ?? ""));
  assert(mainWindows.length === 2,
    `Zwei stabile Hauptfenster fehlen nach dem Start: ${JSON.stringify(windows.windows)}`);
  const firstMain = (windows.windows ?? []).find((window) => window.pid === firstPid && /SteuerSparErklärung/.test(window.title ?? ""));
  const secondMain = (windows.windows ?? []).find((window) => window.pid === secondPid && /SteuerSparErklärung/.test(window.title ?? ""));
  assert(Number.isInteger(firstMain?.hwnd), `Erstes Hauptfenster fehlt: ${JSON.stringify(windows.windows)}`);
  assert(Number.isInteger(secondMain?.hwnd), `Zweites Hauptfenster fehlt: ${JSON.stringify(windows.windows)}`);

  await expectAmbiguous("sse_save", {
    expectedPath: secondPath,
    expectedHashBefore: sha256(secondPath),
  });
  const firstHashBeforeWrongBinding = sha256(firstPath);
  const secondHashBeforeWrongBinding = sha256(secondPath);
  const wrongSave = await callRaw("sse_save", {
    hwnd: firstMain.hwnd,
    expectedPath: secondPath,
    expectedHashBefore: secondHashBeforeWrongBinding,
  });
  assert(wrongSave?.isError === true && /Pfadvertrag verletzt|nicht nachweisbar/i.test(fullText(wrongSave)),
    `sse_save akzeptierte ein hwnd des falschen Steuerfalls: ${fullText(wrongSave)}`);
  assert(sha256(firstPath) === firstHashBeforeWrongBinding && sha256(secondPath) === secondHashBeforeWrongBinding,
    "Falsche sse_save-HWND-Bindung veraenderte eine Falldatei.");

  const boundSave = await call("sse_save", {
    hwnd: secondMain.hwnd,
    expectedPath: secondPath,
    expectedHashBefore: secondHashBeforeWrongBinding,
  });
  assert(boundSave.ok === true && boundSave.noChanges === true && boundSave.path === secondPath,
    `Explizit gebundenes sse_save traf die Zielinstanz nicht: ${JSON.stringify(boundSave)}`);

  await expectAmbiguous("sse_set_value", {
    aid: ".MainToolBar.QWidget.SearchSSE.QLineEdit", expectedBefore: "", value: "MCP multi", expectedAfter: "",
  });
  await expectAmbiguous("sse_find", { name: "Weiter" });
  await expectAmbiguous("sse_toggle", {
    expectedPage: "irrelevant-before-binding", name: "Roter Faden",
    expectedBefore: false, value: true, expectedAfter: true,
  });
  await expectAmbiguous("sse_table_update", {
    expectedPage: "irrelevant-before-binding", text: "irrelevant", werte: [null, "1,00"],
    sumLabel: "irrelevant", expectedBefore: "0,00", expectedAfter: "1,00",
  });

  const searchSet = await call("sse_set_value", {
    hwnd: secondMain.hwnd,
    aid: ".MainToolBar.QWidget.SearchSSE.QLineEdit", expectedBefore: "", value: "MCP multi", expectedAfter: "MCP multi",
  });
  assert(searchSet.ok === true && searchSet.verified === true && searchSet.after === "MCP multi",
    `Explizit gebundene Suchfeldaktion scheiterte: ${JSON.stringify(searchSet)}`);
  const searchReset = await call("sse_set_value", {
    hwnd: secondMain.hwnd,
    aid: ".MainToolBar.QWidget.SearchSSE.QLineEdit", expectedBefore: "MCP multi", value: "", expectedAfter: "",
  });
  assert(searchReset.ok === true && searchReset.verified === true && searchReset.after === "",
    `Explizit gebundener Suchfeld-Reset scheiterte: ${JSON.stringify(searchReset)}`);
} finally {
  try {
    if (secondPid) {
      try { await callRaw("sse_close", { pid: secondPid, force: true, discardChanges: true }, 90_000); } catch { }
    }
    if (firstPid || existsSync(markerPath)) {
      try { await callRaw("sse_desktop_stop", { discardChanges: true }, 120_000); } catch { }
    }
  } finally {
    try { await client.close(); } catch { }
  }
  for (let attempt = 0; attempt < 20 && existsSync(tempDir); attempt++) {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { }
    if (existsSync(tempDir)) await wait(250);
  }
}

assert(!existsSync(tempDir), "Eigener Mehrinstanz-Testordner blieb gesperrt.");
assert(sha256(fixture) === fixtureHash, "Neutrale Quelldatei wurde veraendert.");
assert(ssePids() === pidsBefore, "Mehrinstanztest hat eine SSE-PID hinterlassen oder fremd veraendert.");
assert(!existsSync(markerPath), "Mehrinstanztest hat den Desktop-Marker hinterlassen.");
process.stdout.write("OK: Mehrere bytegleiche SSE-Faelle brechen ohne hwnd ab; explizite Hauptfensterbindung wirkt nur auf die Zielinstanz.\n");
