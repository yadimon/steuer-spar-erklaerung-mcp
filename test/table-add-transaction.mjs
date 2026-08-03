/**
 * Realer, aber vollstaendig verwerfbarer Regressionstest fuer sse_table_add.
 *
 * Voraussetzung:
 *   SSE_TABLE_ADD_FIXTURE=<neutrale .Gew2025-Kopie> npm run test:table-add
 * Optional:
 *   SSE_TABLE_ADD_EXPECTED_HASH=<SHA256 der neutralen Quelldatei>
 *
 * Der Test speichert nie. Er beweist an einer Seite mit mehreren Tabellen:
 * 1. Die Leerzeile wird an die gewaehlte Summenregion gebunden.
 * 2. Ein erfolgreicher Eintrag veraendert genau die erwartete Summe.
 * 3. Eine absichtlich falsche Nachsumme rollt alle eigenen Zellen zurueck.
 * 4. Der Quellhash und die Menge fremder SSE-Prozesse bleiben unveraendert.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixture = process.env.SSE_TABLE_ADD_FIXTURE;
if (!fixture) {
  process.stdout.write("SKIP: SSE_TABLE_ADD_FIXTURE ist nicht gesetzt.\n");
  process.exit(0);
}
if (!existsSync(fixture) || !/\.Gew2025$/i.test(fixture)) {
  throw new Error("SSE_TABLE_ADD_FIXTURE muss eine vorhandene neutrale .Gew2025-Kopie sein.");
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const text = (result) => result?.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n") ?? "";
const json = (result, name, allowError = false) => {
  if (result?.isError && !allowError) throw new Error(`${name}: ${text(result)}`);
  return JSON.parse(text(result));
};
const ssePids = () => execFileSync(
  "powershell.exe",
  ["-NoLogo", "-NoProfile", "-Command", "@(Get-Process -Name SSE -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id | Sort-Object) -join ','"],
  { encoding: "utf8", windowsHide: true },
).trim();

const expectedHash = process.env.SSE_TABLE_ADD_EXPECTED_HASH?.toUpperCase();
const hashBefore = sha256(fixture);
if (expectedHash) assert(hashBefore === expectedHash, "Der neutrale Fixture-Hash entspricht nicht SSE_TABLE_ADD_EXPECTED_HASH.");
const pidsBefore = ssePids();

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..", "dist", "index.js");
const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env } });
const client = new Client({ name: "sse-table-add-transaction", version: "1.0.0" });
let started = false;
let instance = null;
const visible = process.env.SSE_TABLE_VISIBLE === "1";

try {
  await client.connect(transport);
  const start = json(await client.callTool(
    visible
      ? { name: "sse_launch", arguments: { file: fixture, mode: "einur" } }
      : { name: "sse_desktop_start", arguments: { file: fixture, mode: "einur", name: "SSETableAddTxn", timeoutSec: 45 } },
    undefined,
    { timeout: 180_000, maxTotalTimeout: 180_000 },
  ), "desktop-start");
  started = true;
  instance = start.instance ?? { pid: start.pid };
  assert(start.product?.taxYear === 2025 && start.case?.taxYear === 2025, "Fixture wurde nicht mit SSE 2025 gestartet.");
  const targetPage = "Kapitalerträge und sonstige Einnahmen";
  const navigation = json(await client.callTool(
    { name: "sse_goto", arguments: { name: targetPage, maxSteps: 80, useSearch: true } },
    undefined,
    { timeout: 300_000, maxTotalTimeout: 300_000 },
  ), "goto-target-page");
  assert(navigation.erreicht === true && navigation.ueberschrift === targetPage,
    `Tabellenzielseite wurde nicht erreicht: ${JSON.stringify(navigation)}`);

  const successResult = await client.callTool({
    name: "sse_table_add",
    arguments: {
      expectedPage: targetPage,
      werte: ["", "01.01.2025", "MCP neutral success", "0,01"],
      sumLabel: "Summe Sonstige Einnahmen",
      expectedBefore: "1,50",
      expectedAfter: "1,51",
    },
  }, undefined, { timeout: 300_000, maxTotalTimeout: 300_000 });
  const success = json(successResult, "table-add-success");
  assert(success.ok === true && success.verified === true, "Erster Eintrag wurde nicht vollstaendig verifiziert.");
  assert(success.sumBefore === "1,50" && success.sumAfter === "1,51", "Erfolgs-Summendifferenz ist unerwartet.");
  assert(Number.isFinite(success.tableBinding?.rowY) &&
    success.tableBinding.previousSummaryY < success.tableBinding.rowY &&
    success.tableBinding.rowY < success.tableBinding.sumY,
  `Zielzeile liegt nicht in der gebundenen Summenregion: ${JSON.stringify(success.tableBinding)}`);

  const rollbackResult = await client.callTool({
    name: "sse_table_add",
    arguments: {
      expectedPage: targetPage,
      werte: ["", "02.01.2025", "MCP neutral rollback", "0,02"],
      sumLabel: "Summe Sonstige Einnahmen",
      expectedBefore: "1,51",
      expectedAfter: "999,99",
    },
  }, undefined, { timeout: 300_000, maxTotalTimeout: 300_000 });
  const rollback = json(rollbackResult, "table-add-rollback", true);
  assert(rollbackResult.isError === true && rollback.kind === "postcondition-failed",
    "Absichtlich falsche Nachsumme wurde nicht als postcondition-failed abgewiesen.");
  assert(rollback.sumAfter === "1,53" && rollback.rollback?.versucht === true &&
    rollback.rollback?.erfolgreich === true && rollback.rollback?.summe === "1,51",
  `Rollback ist nicht vollstaendig belegt: ${JSON.stringify(rollback.rollback)}`);
  assert(rollback.tableBinding?.rowY > rollback.tableBinding?.previousSummaryY &&
    rollback.tableBinding?.rowY < rollback.tableBinding?.sumY,
  `Rollback-Zeile lag nicht in der gebundenen Summenregion: ${JSON.stringify(rollback.tableBinding)}`);

  const page = json(await client.callTool({ name: "sse_read_page", arguments: {} }), "read-page");
  const lines = page.lines ?? [];
  assert(lines.some((line) => line.includes("MCP neutral success") && line.includes("0,01")),
    "Erfolgszeile ist nach dem Rollback der zweiten Aktion nicht mehr vorhanden.");
  assert(!lines.some((line) => line.includes("MCP neutral rollback")),
    "Die absichtlich fehlgeschlagene Zeile blieb nach dem Rollback sichtbar.");
  assert(lines.some((line) => line.includes("Summe Sonstige Einnahmen") && line.includes("1,51")),
    "Die wiederhergestellte Seitensumme 1,51 ist nicht sichtbar.");
} finally {
  try {
    if (started) {
      const stopResult = await client.callTool(
        visible
          ? { name: "sse_close", arguments: { pid: instance?.pid, hwnd: instance?.hwnd, force: true, discardChanges: true } }
          : { name: "sse_desktop_stop", arguments: { discardChanges: true } },
        undefined,
        { timeout: 120_000, maxTotalTimeout: 120_000 },
      );
      const stop = json(stopResult, "desktop-stop");
      if (!visible) {
        assert(stop.ok === true && stop.hartBeendet === false && stop.desktopMarkeEntfernt === true,
          `Verwerfendes Beenden war nicht sauber: ${JSON.stringify(stop)}`);
      }
    }
  } finally {
    await client.close();
  }
}

assert(sha256(fixture) === hashBefore, "Der neutrale Fixture-Hash wurde trotz Verwerfen veraendert.");
assert(ssePids() === pidsBefore, "Der Test hat eine fremde SSE-PID erzeugt, beendet oder hinterlassen.");
process.stdout.write(`OK: sse_table_add bindet die richtige Tabelle, verifiziert die Summe und rollt eigene Fehler vollstaendig zurueck (${visible ? "sichtbar" : "versteckt"}).\n`);
