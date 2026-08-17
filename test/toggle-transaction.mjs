/**
 * Realer, vollstaendig verwerfbarer Regressionstest fuer sse_toggle.
 * Verwendet ausschliesslich die steuerneutrale Toolbar-CheckBox "Roter Faden".
 *
 * Voraussetzung:
 *   SSE_TOGGLE_FIXTURE=<neutrale .Gew2025-Kopie> npm run test:toggle
 * Optional:
 *   SSE_TOGGLE_EXPECTED_HASH=<SHA256 der neutralen Quelldatei>
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureCaseRef } from "./fixture-case-ref.mjs";

const fixture = process.env.SSE_TOGGLE_FIXTURE;
if (!fixture) {
  process.stdout.write("SKIP: SSE_TOGGLE_FIXTURE ist nicht gesetzt.\n");
  process.exit(0);
}
if (!existsSync(fixture) || extname(fixture).toLowerCase() !== ".gew2025") {
  throw new Error("SSE_TOGGLE_FIXTURE muss eine vorhandene neutrale .Gew2025-Kopie sein.");
}

const AID_SUFFIX = ".MainToolBar.tb_faden";
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

const expectedHash = process.env.SSE_TOGGLE_EXPECTED_HASH?.toUpperCase();
const hashBefore = sha256(fixture);
if (expectedHash) assert(hashBefore === expectedHash, "Fixture-Hash entspricht nicht SSE_TOGGLE_EXPECTED_HASH.");
const pidsBefore = ssePids();
const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..", "dist", "index.js");
const client = new Client({ name: "sse-toggle-transaction", version: "1.0.0" });
let started = false;

try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env } }));
  const start = parsed(await client.callTool(
    {
      name: "sse_desktop_start",
      arguments: { caseRef: fixtureCaseRef(fixture, { extension: ".Gew2025" }), mode: "einur", name: "SSEToggleTxn", timeoutSec: 45 },
    },
    undefined,
    { timeout: 180_000, maxTotalTimeout: 180_000 },
  ), "desktop-start");
  started = true;
  assert(start.product?.taxYear === 2025 && start.case?.taxYear === 2025, "Fixture wurde nicht mit SSE 2025 gestartet.");

  const page = parsed(await client.callTool({ name: "sse_read_page", arguments: {} }), "read-page");
  const heading = page.heading;
  assert(typeof heading === "string" && heading.length > 0, "Aktuelle Seitenueberschrift fehlt.");
  const snapshot = parsed(await client.callTool({
    name: "sse_snapshot",
    arguments: { types: ["CheckBox"], namedOnly: true },
  }), "snapshot-before");
  const target = (snapshot.nodes ?? []).find((node) => String(node.aid ?? "").endsWith(AID_SUFFIX));
  assert(target && target.name === "Roter Faden" && typeof target.checked === "boolean",
    "Steuerneutrale Toolbar-CheckBox 'Roter Faden' ist nicht eindeutig lesbar.");
  const original = target.checked;
  const changed = !original;

  const first = parsed(await client.callTool({
    name: "sse_toggle",
    arguments: {
      expectedPage: heading,
      aid: AID_SUFFIX,
      expectedBefore: original,
      value: changed,
      expectedAfter: changed,
    },
  }), "toggle-success");
  assert(first.ok === true && first.verified === true && first.before === original && first.after === changed,
    `Toolbar-CheckBox wurde nicht exakt verifiziert: ${JSON.stringify(first)}`);

  const rollbackResult = await client.callTool({
    name: "sse_toggle",
    arguments: {
      expectedPage: heading,
      aid: AID_SUFFIX,
      expectedBefore: changed,
      value: original,
      expectedAfter: changed,
    },
  });
  const rollback = parsed(rollbackResult, "toggle-rollback", true);
  assert(rollbackResult.isError === true && rollback.kind === "postcondition-failed" &&
    rollback.rollback?.versucht === true && rollback.rollback?.erfolgreich === true &&
    rollback.rollback?.ist === changed,
  `Eigener Toggle-Nachbedingungsfehler wurde nicht vollstaendig zurueckgesetzt: ${JSON.stringify(rollback)}`);

  const reset = parsed(await client.callTool({
    name: "sse_toggle",
    arguments: {
      expectedPage: heading,
      aid: AID_SUFFIX,
      expectedBefore: changed,
      value: original,
      expectedAfter: original,
    },
  }), "toggle-reset");
  assert(reset.ok === true && reset.verified === true && reset.after === original,
    `Toolbar-CheckBox wurde nicht auf den Ausgangszustand zurueckgesetzt: ${JSON.stringify(reset)}`);

  const finalSnapshot = parsed(await client.callTool({
    name: "sse_snapshot",
    arguments: { types: ["CheckBox"], namedOnly: true },
  }), "snapshot-final");
  const finalTarget = (finalSnapshot.nodes ?? []).find((node) => String(node.aid ?? "").endsWith(AID_SUFFIX));
  assert(finalTarget?.checked === original, "Toolbar-CheckBox stimmt am Ende nicht mit dem Ausgangszustand ueberein.");
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
process.stdout.write("OK: sse_toggle bindet CheckBox/Seite/Vor-Nachzustand und rollt eigene Fehler vollstaendig zurueck.\n");
