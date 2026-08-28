/**
 * Realer, verwerfbarer Mehrinstanztest fuer die Hauptfensterbindung.
 *
 * Voraussetzung:
 *   SSE_CASE_DIR=<Fallordner> und
 *   SSE_MULTI_INSTANCE_FIXTURE=<neutrale .Gew2025-Datei in diesem Ordner>
 *   npm run test:multi-instance
 * Optional:
 *   SSE_MULTI_INSTANCE_EXPECTED_HASH=<SHA256 der neutralen Quelle>
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sameFileIdentity } from "../dist/file-identity.js";
import { fixtureCaseRef } from "./fixture-case-ref.mjs";

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
const sourceRef = fixtureCaseRef(fixture, { extension: ".Gew2025" });
const pidsBefore = ssePids();
assert(!pidsBefore, "Mehrinstanztest startet nur ohne vorhandene SSE-Instanz.");

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..", "dist", "index.js");
const caseDir = process.env.SSE_TEST_CASE_DIR;
assert(caseDir, "SSE_TEST_CASE_DIR aus test/with-api.mjs fehlt.");
const runId = `${process.pid}-${randomBytes(6).toString("hex")}`;
const firstName = `sse-multi-first-${runId}.Gew2025`;
const secondName = `sse-multi-second-${runId}.Gew2025`;
const firstPath = join(caseDir, firstName);
const secondPath = join(caseDir, secondName);
const firstRef = `cases:${firstName}`;
const secondRef = `cases:${secondName}`;
assert(!existsSync(firstPath) && !existsSync(secondPath), "Eindeutige Mehrinstanz-Ziele existieren bereits.");
const markerPath = join(tmpdir(), "sse-mcp-desktop.txt");
const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env } });
const client = new Client({ name: "sse-multi-instance-binding", version: "1.0.0" });
let firstPid = null;
let secondPid = null;
let secondHwnd = null;
let firstIdentity = null;
let secondIdentity = null;
const retainedTargets = [];

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
  await call("sse_make_working_copy", { sourceRef, targetRef: firstRef, expectedSourceHash: fixtureHash });
  firstIdentity = statSync(firstPath, { bigint: true });
  await call("sse_make_working_copy", { sourceRef, targetRef: secondRef, expectedSourceHash: fixtureHash });
  secondIdentity = statSync(secondPath, { bigint: true });

  const first = await call("sse_desktop_start", {
    caseRef: firstRef, mode: "einur", name: `SSEMulti${process.pid}`, timeoutSec: 45,
  }, 180_000);
  firstPid = first.pid;
  const singleSave = await call("sse_save", {
    caseRef: firstRef,
    expectedHashBefore: sha256(firstPath),
  });
  assert(singleSave.ok === true && singleSave.noChanges === true && singleSave.path === firstRef,
    `sse_save band die einzelne Instanz ohne hwnd nicht sicher: ${JSON.stringify(singleSave)}`);
  const second = await call("sse_launch", { caseRef: secondRef, mode: "einur" }, 120_000);
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
  secondHwnd = secondMain.hwnd;

  await expectAmbiguous("sse_save", {
    caseRef: secondRef,
    expectedHashBefore: sha256(secondPath),
  });
  const firstHashBeforeWrongBinding = sha256(firstPath);
  const secondHashBeforeWrongBinding = sha256(secondPath);
  const wrongSave = await callRaw("sse_save", {
    hwnd: firstMain.hwnd,
    caseRef: secondRef,
    expectedHashBefore: secondHashBeforeWrongBinding,
  });
  assert(wrongSave?.isError === true && /Pfadvertrag verletzt|nicht nachweisbar/i.test(fullText(wrongSave)),
    `sse_save akzeptierte ein hwnd des falschen Steuerfalls: ${fullText(wrongSave)}`);
  assert(sha256(firstPath) === firstHashBeforeWrongBinding && sha256(secondPath) === secondHashBeforeWrongBinding,
    "Falsche sse_save-HWND-Bindung veraenderte eine Falldatei.");

  const boundSave = await call("sse_save", {
    hwnd: secondMain.hwnd,
    caseRef: secondRef,
    expectedHashBefore: secondHashBeforeWrongBinding,
  });
  assert(boundSave.ok === true && boundSave.noChanges === true && boundSave.path === secondRef,
    `Explizit gebundenes sse_save traf die Zielinstanz nicht: ${JSON.stringify(boundSave)}`);

  await expectAmbiguous("sse_set_value", {
    rid: "irrelevant-vor-fensterbindung", expectedBefore: "", value: "MCP multi", expectedAfter: "",
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

  const searchFieldBefore = await call("sse_get_value", {
    hwnd: secondMain.hwnd, aid: ".MainToolBar.QWidget.SearchSSE.QLineEdit", type: "Edit",
  });
  const searchRid = String(searchFieldBefore.node?.rid ?? "");
  assert(searchRid, `sse_get_value lieferte keine rid fuer das gebundene Suchfeld: ${JSON.stringify(searchFieldBefore)}`);

  const searchSet = await call("sse_set_value", {
    hwnd: secondMain.hwnd,
    rid: searchRid, expectedBefore: "", value: "MCP multi", expectedAfter: "MCP multi",
  });
  assert(searchSet.ok === true && searchSet.verified === true && searchSet.after === "MCP multi",
    `Explizit gebundene Suchfeldaktion scheiterte: ${JSON.stringify(searchSet)}`);
  const searchReset = await call("sse_set_value", {
    hwnd: secondMain.hwnd,
    rid: searchRid, expectedBefore: "MCP multi", value: "", expectedAfter: "",
  });
  assert(searchReset.ok === true && searchReset.verified === true && searchReset.after === "",
    `Explizit gebundener Suchfeld-Reset scheiterte: ${JSON.stringify(searchReset)}`);
} finally {
  try {
    if (secondPid && secondHwnd) {
      try { await callRaw("sse_close", { pid: secondPid, hwnd: secondHwnd, force: true, discardChanges: true }, 90_000); } catch { }
    }
    if (firstPid || existsSync(markerPath)) {
      try { await callRaw("sse_desktop_stop", { discardChanges: true }, 120_000); } catch { }
    }
  } finally {
    try { await client.close(); } catch { }
  }
  const ownedTargets = new Map([[firstPath, firstIdentity], [secondPath, secondIdentity]]);
  for (const target of [firstPath, secondPath]) {
    const identity = ownedTargets.get(target);
    for (let attempt = 0; attempt < 20 && existsSync(target); attempt += 1) {
      try {
        if (
          !identity ||
          !sameFileIdentity(identity, statSync(target, { bigint: true })) ||
          sha256(target) !== fixtureHash
        ) {
          retainedTargets.push(target);
          break;
        }
      } catch {
        if (existsSync(target)) retainedTargets.push(target);
        break;
      }
      try { rmSync(target, { force: true }); } catch { }
      if (existsSync(target)) await wait(250);
    }
  }
}

assert(!retainedTargets.length,
  `Mehrinstanz-Ziel war nicht mehr eindeutig test-eigen und wurde bewusst nicht geloescht: ${retainedTargets.join(", ")}`);
assert(!existsSync(firstPath) && !existsSync(secondPath), "Eigene Mehrinstanz-Wegwerfkopie blieb gesperrt.");
assert(sha256(fixture) === fixtureHash, "Neutrale Quelldatei wurde veraendert.");
assert(ssePids() === pidsBefore, "Mehrinstanztest hat eine SSE-PID hinterlassen oder fremd veraendert.");
assert(!existsSync(markerPath), "Mehrinstanztest hat den Desktop-Marker hinterlassen.");
process.stdout.write("OK: Mehrere bytegleiche SSE-Faelle brechen ohne hwnd ab; explizite Hauptfensterbindung wirkt nur auf die Zielinstanz.\n");
