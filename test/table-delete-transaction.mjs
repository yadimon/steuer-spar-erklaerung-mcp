/**
 * Sichtbarer, vollstaendig verwerfbarer Regressionstest fuer sse_table_delete.
 *
 * Voraussetzung:
 *   SSE_TABLE_DELETE_FIXTURE=<neutrale .Gew2025-Datei> npm run test:table-delete
 *
 * MCP erzeugt selbst eine bytegleiche Temp-Kopie, speichert nie und entfernt
 * sie wieder. Ist das SSE-Fenster auf dem aktiven Windows-Desktop nicht sicher
 * klickbar, gilt der bewiesene Abbruch vor der Mutation als SKIP, nicht als
 * Scheinerfolg. Mit manuell sichtbarem SSE muss der echte Loeschpfad bestehen.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = process.env.SSE_TABLE_DELETE_FIXTURE;
if (!source) {
  process.stdout.write("SKIP: SSE_TABLE_DELETE_FIXTURE ist nicht gesetzt.\n");
  process.exit(0);
}
if (!existsSync(source) || extname(source).toLowerCase() !== ".gew2025") {
  throw new Error("SSE_TABLE_DELETE_FIXTURE muss eine vorhandene neutrale .Gew2025-Datei sein.");
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

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..", "dist", "index.js");
const target = join(tmpdir(), `sse-table-delete-${process.pid}-${Date.now()}.Gew2025`);
const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env } });
const client = new Client({ name: "sse-table-delete-transaction", version: "1.0.0" });
const sourceHash = sha256(source);
const pidsBefore = ssePids();
let instance = null;
let launchedPid = null;
let resultKind = "unknown";
let skipReason = "";

const callRaw = (name, args = {}, timeout = 120_000) => client.callTool(
  { name, arguments: args }, undefined, { timeout, maxTotalTimeout: timeout },
);
const call = async (name, args = {}, timeout = 120_000) => {
  const result = await callRaw(name, args, timeout);
  return parsed(result, name);
};

try {
  await client.connect(transport);
  const health = await call("sse_health");
  assert(health.running === false, "Sichtbarer Tabellenloeschtest startet nur ohne vorhandene SSE-Instanz.");
  await call("sse_make_working_copy", { source, target, expectedSourceHash: sourceHash });
  assert(sha256(target) === sourceHash, "Temp-Kopie ist nicht bytegleich zur neutralen Quelle.");

  const launch = await call("sse_launch", { file: target, mode: "einur" }, 60_000);
  launchedPid = launch.pid;
  assert(Number.isInteger(launch.instance?.hwnd),
    `sse_launch lieferte kein eindeutiges Start-HWND: ${JSON.stringify(launch)}`);
  const state = await call("sse_ui_state", { hwnd: launch.instance.hwnd });
  instance = state.instance;
  assert(Number.isInteger(instance?.pid) && Number.isInteger(instance?.hwnd), "SSE-Instanz ist nicht eindeutig gebunden.");

  const deleteResult = await callRaw("sse_table_delete", {
    expectedPage: "Kapitalerträge und sonstige Einnahmen",
    text: "Erstattete steuerliche Nebenleistungen 0,50 + 1,00",
    sumLabel: "Summe Sonstige Einnahmen",
    expectedBefore: "1,50",
    expectedAfter: "0,00",
    hwnd: instance.hwnd,
  }, 120_000);
  const deleteText = fullText(deleteResult);
  const deletePayload = parsed(deleteResult, "table-delete", true);
  const page = await call("sse_read_page", { hwnd: instance.hwnd });
  const lines = page.lines ?? [];

  if (deleteResult?.isError) {
    const blockerKind = deletePayload?.obstruction?.blockerKind;
    const skippableObstruction = deletePayload?.kind === "obstructed" &&
      ["lockscreen-shell", "foreign-app"].includes(blockerKind);
    assert(skippableObstruction,
      `Loeschpfad scheiterte ohne skippable Fensterblockade: ${deleteText}`);
    assert(lines.some((line) => line.includes("Erstattete steuerliche Nebenleistungen 0,50 + 1,00")),
      "Zielzeile fehlt trotz Abbruch vor der Mutation.");
    assert(lines.some((line) => line.includes("Summe Sonstige Einnahmen") && line.includes("1,50")),
      "Ausgangssumme 1,50 fehlt trotz Abbruch vor der Mutation.");
    resultKind = "skip-foreground-or-desktop";
    skipReason = deletePayload?.error || deleteText.trim();
  } else {
    assert(deletePayload?.ok === true && deletePayload?.verified === true && deletePayload?.after === "0,00",
      `Loeschung war nicht vollstaendig verifiziert: ${JSON.stringify(deletePayload)}`);
    assert(deletePayload.tableBinding?.previousSummaryY < deletePayload.tableBinding?.rowY &&
      deletePayload.tableBinding?.rowY < deletePayload.tableBinding?.sumY,
    `Zielzeile lag nicht in der gebundenen Summenregion: ${JSON.stringify(deletePayload.tableBinding)}`);
    assert(!lines.some((line) => line.includes("Erstattete steuerliche Nebenleistungen 0,50 + 1,00")),
      "Geloeschte Zielzeile ist noch sichtbar.");
    assert(lines.some((line) => line.includes("Summe Sonstige Einnahmen") && line.includes("0,00")),
      "Erwartete Nachsumme 0,00 fehlt.");
    resultKind = "success";
  }
} finally {
  try {
    if (instance?.pid && instance?.hwnd) {
      await callRaw("sse_close", { pid: instance.pid, hwnd: instance.hwnd, force: true, discardChanges: true }, 60_000);
    } else if (launchedPid) {
      await callRaw("sse_close", { pid: launchedPid, force: true, discardChanges: true }, 60_000);
    }
  } finally {
    try { await client.close(); } catch { }
  }
  for (let attempt = 0; attempt < 20 && existsSync(target); attempt++) {
    try { unlinkSync(target); } catch { }
    if (existsSync(target)) await wait(250);
  }
}

assert(!existsSync(target), `Eigene Temp-Kopie blieb gesperrt: ${basename(target)}`);
assert(sha256(source) === sourceHash, "Neutrale Quelldatei wurde veraendert.");
assert(ssePids() === pidsBefore, "Test hat eine fremde SSE-PID erzeugt, beendet oder hinterlassen.");
if (resultKind === "success") {
  process.stdout.write("OK: sse_table_delete loeschte genau die summenregionsgebundene Zeile und die Sitzung wurde verworfen.\n");
} else {
  assert(process.env.SSE_REQUIRE_DELETE !== "1",
    `SSE_REQUIRE_DELETE=1 verbietet SKIP: ${skipReason}`);
  process.stdout.write(
    `SKIP: Zielpunkt lag nicht sicher auf dem aktiven SSE-Hauptfenster; Abbruch vor Mutation, Quelle unveraendert. Grund: ${skipReason}\n`,
  );
}
