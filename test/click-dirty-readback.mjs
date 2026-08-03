/**
 * Realer, verwerfbarer Regressionstest fuer generische Klicks.
 *
 * Voraussetzung:
 *   SSE_CLICK_FIXTURE=<neutrale .Gew2025-Datei> npm run test:click
 * Optional:
 *   SSE_CLICK_EXPECTED_HASH=<SHA256 der neutralen Quelle>
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixture = process.env.SSE_CLICK_FIXTURE;
if (!fixture) {
  process.stdout.write("SKIP: SSE_CLICK_FIXTURE ist nicht gesetzt.\n");
  process.exit(0);
}
if (!existsSync(fixture) || extname(fixture).toLowerCase() !== ".gew2025") {
  throw new Error("SSE_CLICK_FIXTURE muss eine vorhandene neutrale .Gew2025-Datei sein.");
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
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);
const ssePids = () => execFileSync(
  "powershell.exe",
  ["-NoLogo", "-NoProfile", "-Command", "@(Get-Process -Name SSE -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id | Sort-Object) -join ','"],
  { encoding: "utf8", windowsHide: true },
).trim();

const fixtureHash = sha256(fixture);
const expectedHash = process.env.SSE_CLICK_EXPECTED_HASH?.toUpperCase();
if (expectedHash) assert(fixtureHash === expectedHash, "Fixture-Hash entspricht nicht SSE_CLICK_EXPECTED_HASH.");
const pidsBefore = ssePids();

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..", "dist", "index.js");
const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env } });
const client = new Client({ name: "sse-click-dirty-readback", version: "1.0.0" });
let started = false;

try {
  await client.connect(transport);
  const start = parsed(await client.callTool({
    name: "sse_desktop_start",
    arguments: { file: fixture, mode: "einur", name: `SSEClickTxn${process.pid}`, timeoutSec: 45 },
  }, undefined, { timeout: 180_000, maxTotalTimeout: 180_000 }), "desktop-start");
  started = true;
  assert(Number.isInteger(start.instance?.hwnd),
    `Versteckter Start lieferte kein geladenes Fall-HWND: ${JSON.stringify(start)}`);
  const hwnd = start.instance.hwnd;

  const stateBefore = parsed(await client.callTool({ name: "sse_ui_state", arguments: { hwnd } }), "state-before");
  assert(typeof stateBefore.heading === "string" && stateBefore.heading.length > 0,
    `Startseite ist nicht lesbar: ${JSON.stringify(stateBefore)}`);

  const ambiguous = await client.callTool({
    name: "sse_click", arguments: { name: "e", contains: true, pattern: "invoke", hwnd },
  });
  assert(ambiguous?.isError === true && /Teilstringsuche ist nicht eindeutig/.test(fullText(ambiguous)),
    `Breiter Teilstring wurde nicht vor dem Invoke abgewiesen: ${fullText(ambiguous)}`);
  const stateAfterAmbiguous = parsed(await client.callTool({ name: "sse_ui_state", arguments: { hwnd } }), "state-after-ambiguous");
  assert(stateAfterAmbiguous.heading === stateBefore.heading,
    "Mehrdeutiger Klick hat trotz Abbruch die Seite gewechselt.");

  const clickResult = await client.callTool({
    name: "sse_click",
    arguments: { name: "Weiter", expectedPageBefore: stateBefore.heading, waitMs: 2500, hwnd },
  }, undefined, { timeout: 120_000, maxTotalTimeout: 120_000 });
  const click = parsed(clickResult, "click-next", true);
  assert(click !== null, `Weiter-Antwort war nicht strukturiert: ${fullText(clickResult)}`);
  assert(hasOwn(click, "ungespeichertVorher") && hasOwn(click, "ungespeichertNachher"),
    `Dirty-State-Readback fehlt: ${JSON.stringify(click)}`);
  assert(click.ungespeichertVorher === click.ungespeichertNachher,
    `Reine Navigation veraenderte den Dirty-State: ${JSON.stringify(click)}`);
  if (clickResult?.isError) {
    assert(click.kind === "navigation-blocked" && click.navigiert === false,
      `Weiter scheiterte nicht als nachvollziehbarer Navigationsblock: ${JSON.stringify(click)}`);
  } else {
    assert(click.navigiert === true && click.verified === true && click.ueberschriftNachher !== stateBefore.heading,
      `Weiter wurde nicht per Seiten-Readback bestaetigt: ${JSON.stringify(click)}`);
  }
} finally {
  try {
    if (started) {
      await client.callTool(
        { name: "sse_desktop_stop", arguments: { discardChanges: true } },
        undefined,
        { timeout: 120_000, maxTotalTimeout: 120_000 },
      );
    }
  } finally {
    await client.close();
  }
}

assert(sha256(fixture) === fixtureHash, "Neutrale Fixture wurde durch den Klicktest veraendert.");
assert(ssePids() === pidsBefore, "Klicktest hat eine SSE-PID erzeugt, beendet oder hinterlassen.");
process.stdout.write("OK: Mehrdeutige Klicks brechen vor Invoke ab; Navigation meldet Seite und Dirty-State vorher/nachher.\n");
