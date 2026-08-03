/**
 * Realer, vollstaendig verwerfbarer Regressionstest fuer sse_table_update.
 *
 * Voraussetzung:
 *   SSE_TABLE_UPDATE_FIXTURE=<neutrale .Gew2025-Kopie> npm run test:table-update
 * Optional:
 *   SSE_TABLE_UPDATE_EXPECTED_HASH=<SHA256 der neutralen Quelldatei>
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixture = process.env.SSE_TABLE_UPDATE_FIXTURE;
if (!fixture) {
  process.stdout.write("SKIP: SSE_TABLE_UPDATE_FIXTURE ist nicht gesetzt.\n");
  process.exit(0);
}
if (!existsSync(fixture) || extname(fixture).toLowerCase() !== ".gew2025") {
  throw new Error("SSE_TABLE_UPDATE_FIXTURE muss eine vorhandene neutrale .Gew2025-Kopie sein.");
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
  catch { throw new Error(`${name}: Antwort war kein JSON: ${fullText(result)}`); }
};
const ssePids = () => execFileSync(
  "powershell.exe",
  ["-NoLogo", "-NoProfile", "-Command", "@(Get-Process -Name SSE -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id | Sort-Object) -join ','"],
  { encoding: "utf8", windowsHide: true },
).trim();

const expectedHash = process.env.SSE_TABLE_UPDATE_EXPECTED_HASH?.toUpperCase();
const hashBefore = sha256(fixture);
if (expectedHash) assert(hashBefore === expectedHash, "Fixture-Hash entspricht nicht SSE_TABLE_UPDATE_EXPECTED_HASH.");
const pidsBefore = ssePids();
const targetText = "Erstattete steuerliche Nebenleistungen 0,50 + 1,00";
const baseArgs = {
  expectedPage: "Kapitalerträge und sonstige Einnahmen",
  text: targetText,
  sumLabel: "Summe Sonstige Einnahmen",
};

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..", "dist", "index.js");
const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env } });
const client = new Client({ name: "sse-table-update-transaction", version: "1.0.0" });
let started = false;
let instance = null;
const visible = process.env.SSE_TABLE_VISIBLE === "1";

try {
  await client.connect(transport);
  const start = parsed(await client.callTool(
    visible
      ? { name: "sse_launch", arguments: { file: fixture, mode: "einur" } }
      : { name: "sse_desktop_start", arguments: { file: fixture, mode: "einur", name: "SSETableUpdateTxn", timeoutSec: 45 } },
    undefined,
    { timeout: 180_000, maxTotalTimeout: 180_000 },
  ), "desktop-start");
  started = true;
  instance = start.instance ?? { pid: start.pid };
  assert(start.product?.taxYear === 2025 && start.case?.taxYear === 2025, "Fixture wurde nicht mit SSE 2025 gestartet.");
  const navigation = parsed(await client.callTool(
    { name: "sse_goto", arguments: { name: baseArgs.expectedPage, maxSteps: 80, useSearch: true } },
    undefined,
    { timeout: 300_000, maxTotalTimeout: 300_000 },
  ), "goto-target-page");
  assert(navigation.erreicht === true && navigation.ueberschrift === baseArgs.expectedPage,
    `Tabellenzielseite wurde nicht erreicht: ${JSON.stringify(navigation)}`);

  const success1 = parsed(await client.callTool({
    name: "sse_table_update",
    arguments: { ...baseArgs, werte: [null, null, null, "1,51"], expectedBefore: "1,50", expectedAfter: "1,51" },
  }, undefined, { timeout: 120_000, maxTotalTimeout: 120_000 }), "update-success-1");
  assert(success1.ok === true && success1.verified === true &&
    success1.summeVorher === "1,50" && success1.summeNachher === "1,51",
  `Erste Aktualisierung ist nicht vollstaendig verifiziert: ${JSON.stringify(success1)}`);
  assert(success1.tableBinding?.previousSummaryY < success1.tableBinding?.rowY &&
    success1.tableBinding?.rowY < success1.tableBinding?.sumY,
  `Zielzeile liegt nicht in der gebundenen Summenregion: ${JSON.stringify(success1.tableBinding)}`);

  const rollbackResult = await client.callTool({
    name: "sse_table_update",
    arguments: {
      ...baseArgs,
      werte: [null, null, "MCP neutral update rollback", "1,52"],
      expectedBefore: "1,51",
      expectedAfter: "999,99",
    },
  }, undefined, { timeout: 120_000, maxTotalTimeout: 120_000 });
  const rollback = parsed(rollbackResult, "update-rollback", true);
  assert(rollbackResult.isError === true && rollback.kind === "postcondition-failed",
    "Absichtlich falsche Nachsumme wurde nicht als postcondition-failed abgewiesen.");
  assert(rollback.summeNachher === "1,52" && rollback.rollback?.versucht === true &&
    rollback.rollback?.erfolgreich === true && rollback.rollback?.summe === "1,51",
  `Rollback ist nicht vollstaendig belegt: ${JSON.stringify(rollback.rollback)}`);
  assert(rollback.rollback?.zellen?.length === 2 && rollback.rollback.zellen.every((cell) => cell.restored === true),
    `Mehrzellen-Rollback ist nicht vollstaendig belegt: ${JSON.stringify(rollback.rollback?.zellen)}`);

  const success2 = parsed(await client.callTool({
    name: "sse_table_update",
    arguments: { ...baseArgs, werte: [null, null, null, "1,50"], expectedBefore: "1,51", expectedAfter: "1,50" },
  }, undefined, { timeout: 120_000, maxTotalTimeout: 120_000 }), "update-success-2");
  assert(success2.ok === true && success2.verified === true && success2.summeNachher === "1,50",
    "Rueckkehr auf den neutralen Ausgangswert ist nicht verifiziert.");

  const page = parsed(await client.callTool({ name: "sse_read_page", arguments: {} }), "read-page");
  assert((page.lines ?? []).some((line) => line.includes(targetText) && line.includes("1,50")),
    "Neutrale Zielzeile ist am Ende nicht mit 1,50 sichtbar.");
  assert((page.lines ?? []).some((line) => line.includes("Summe Sonstige Einnahmen") && line.includes("1,50")),
    "Neutrale Ausgangssumme 1,50 ist am Ende nicht sichtbar.");
} finally {
  try {
    if (started) {
      const stop = parsed(await client.callTool(
        visible
          ? { name: "sse_close", arguments: { pid: instance?.pid, hwnd: instance?.hwnd, force: true, discardChanges: true } }
          : { name: "sse_desktop_stop", arguments: { discardChanges: true } },
        undefined,
        { timeout: 120_000, maxTotalTimeout: 120_000 },
      ), "desktop-stop");
      if (!visible) {
        assert(stop.ok === true && stop.hartBeendet === false && stop.desktopMarkeEntfernt === true,
          `Verwerfendes Beenden war nicht sauber: ${JSON.stringify(stop)}`);
      }
    }
  } finally {
    await client.close();
  }
}

assert(sha256(fixture) === hashBefore, "Neutrale Fixture wurde trotz Verwerfen veraendert.");
assert(ssePids() === pidsBefore, "Test hat eine fremde SSE-PID erzeugt, beendet oder hinterlassen.");
process.stdout.write("OK: sse_table_update bindet die richtige Tabelle, verifiziert beide Summen und rollt eigene Fehler vollstaendig zurueck.\n");
