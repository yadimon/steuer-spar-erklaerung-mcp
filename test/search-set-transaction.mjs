/**
 * Realer, vollstaendig verwerfbarer Regressionstest fuer den auf das globale
 * Suchfeld begrenzten sse_set_value-Kompatibilitaetspfad.
 *
 * Voraussetzung:
 *   SSE_SEARCH_SET_FIXTURE=<neutrale .Gew2025-Kopie> npm run test:search-set
 * Optional:
 *   SSE_SEARCH_SET_EXPECTED_HASH=<SHA256 der neutralen Quelldatei>
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixture = process.env.SSE_SEARCH_SET_FIXTURE;
if (!fixture) {
  process.stdout.write("SKIP: SSE_SEARCH_SET_FIXTURE ist nicht gesetzt.\n");
  process.exit(0);
}
if (!existsSync(fixture) || extname(fixture).toLowerCase() !== ".gew2025") {
  throw new Error("SSE_SEARCH_SET_FIXTURE muss eine vorhandene neutrale .Gew2025-Kopie sein.");
}

const SEARCH_AID = ".MainToolBar.QWidget.SearchSSE.QLineEdit";
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const assert = (condition, message) => { if (!condition) throw new Error(message); };
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

const expectedHash = process.env.SSE_SEARCH_SET_EXPECTED_HASH?.toUpperCase();
const hashBefore = sha256(fixture);
if (expectedHash) assert(hashBefore === expectedHash, "Fixture-Hash entspricht nicht SSE_SEARCH_SET_EXPECTED_HASH.");
const pidsBefore = ssePids();
const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..", "dist", "index.js");
const client = new Client({ name: "sse-search-set-transaction", version: "1.0.0" });
let started = false;

try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env } }));
  const start = parsed(await client.callTool(
    { name: "sse_desktop_start", arguments: { file: fixture, mode: "einur", name: "SSESearchSetTxn", timeoutSec: 45 } },
    undefined,
    { timeout: 180_000, maxTotalTimeout: 180_000 },
  ), "desktop-start");
  started = true;
  assert(start.product?.taxYear === 2025 && start.case?.taxYear === 2025, "Fixture wurde nicht mit SSE 2025 gestartet.");

  const beforeRead = parsed(await client.callTool({
    name: "sse_get_value",
    arguments: { aid: SEARCH_AID, type: "Edit" },
  }), "read-before");
  const original = String(beforeRead.value ?? "");

  const first = parsed(await client.callTool({
    name: "sse_set_value",
    arguments: { aid: SEARCH_AID, expectedBefore: original, value: "MCP neutral search", expectedAfter: "MCP neutral search" },
  }), "set-success");
  assert(first.ok === true && first.verified === true && first.after === "MCP neutral search" &&
    first.binding?.allowedSuffix === SEARCH_AID && String(first.binding?.aid ?? "").endsWith(SEARCH_AID),
  `Suchtext wurde nicht exakt verifiziert: ${JSON.stringify(first)}`);

  const rollbackResult = await client.callTool({
    name: "sse_set_value",
    arguments: {
      aid: SEARCH_AID,
      expectedBefore: "MCP neutral search",
      value: "MCP neutral rollback",
      expectedAfter: "absichtlich falsche Nachbedingung",
    },
  });
  const rollback = parsed(rollbackResult, "set-rollback", true);
  assert(rollbackResult.isError === true && rollback.kind === "postcondition-failed" &&
    rollback.rollback?.versucht === true && rollback.rollback?.erfolgreich === true &&
    rollback.rollback?.ist === "MCP neutral search",
  `Eigener Nachbedingungsfehler wurde nicht vollstaendig zurueckgesetzt: ${JSON.stringify(rollback)}`);

  const afterRollback = parsed(await client.callTool({
    name: "sse_get_value",
    arguments: { aid: SEARCH_AID, type: "Edit" },
  }), "read-after-rollback");
  assert(afterRollback.value === "MCP neutral search", "Suchfeld stimmt nach Rollback nicht mit dem letzten verifizierten Wert ueberein.");

  const reset = parsed(await client.callTool({
    name: "sse_set_value",
    arguments: { aid: SEARCH_AID, expectedBefore: "MCP neutral search", value: original, expectedAfter: original },
  }), "set-reset");
  assert(reset.ok === true && reset.verified === true && reset.after === original,
    `Suchfeld wurde nicht auf den Ausgangswert zurueckgesetzt: ${JSON.stringify(reset)}`);
} finally {
  try {
    if (started) {
      const stop = parsed(await client.callTool(
        { name: "sse_desktop_stop", arguments: { discardChanges: true } },
        undefined,
        { timeout: 120_000, maxTotalTimeout: 120_000 },
      ), "desktop-stop");
      assert(stop.ok === true && stop.hartBeendet === false && stop.desktopMarkeEntfernt === true,
        `Verwerfendes Beenden war nicht sauber: ${JSON.stringify(stop)}`);
    }
  } finally {
    await client.close();
  }
}

assert(sha256(fixture) === hashBefore, "Neutrale Fixture wurde trotz Verwerfen veraendert.");
assert(ssePids() === pidsBefore, "Test hat eine fremde SSE-PID erzeugt, beendet oder hinterlassen.");
process.stdout.write("OK: sse_set_value akzeptiert nur das globale Suchfeld, verifiziert Vor/Nachwert und rollt eigene Fehler zurueck.\n");
