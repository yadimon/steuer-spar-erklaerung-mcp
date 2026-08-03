import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const fixture = process.env.SSE_HIDDEN_FIXTURE;
if (!fixture) throw new Error("SSE_HIDDEN_FIXTURE fehlt.");
const sha256 = () => createHash("sha256").update(readFileSync(fixture)).digest("hex");
const before = sha256();
const here = dirname(fileURLToPath(import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, "..", "dist", "index.js")],
  env: { ...process.env },
});
const client = new Client({ name: "sse-hidden-start-page", version: "1.0.0" });
const parse = (result, name) => {
  const text = result.content?.filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n") ?? "";
  assert.notEqual(result.isError, true, `${name}: ${text}`);
  return JSON.parse(text);
};
let started = false;

try {
  await client.connect(transport);
  const start = parse(await client.callTool(
    { name: "sse_desktop_start", arguments: { file: fixture, mode: "einur", name: `SSEPageProbe${process.pid}`, timeoutSec: 30 } },
    undefined,
    { timeout: 90_000, maxTotalTimeout: 90_000 },
  ), "start");
  started = true;
  const page = parse(await client.callTool(
    { name: "sse_page", arguments: { hwnd: start.instance?.hwnd } },
    undefined,
    { timeout: 60_000, maxTotalTimeout: 60_000 },
  ), "page");
  let bearbeiten = null;
  if (process.env.SSE_HIDDEN_PROBE_MENU === "1") {
    bearbeiten = parse(await client.callTool(
      { name: "sse_menu", arguments: { name: "Bearbeiten", hwnd: start.instance?.hwnd } },
      undefined,
      { timeout: 60_000, maxTotalTimeout: 60_000 },
    ), "menu");
    parse(await client.callTool(
      { name: "sse_menu_close", arguments: { name: "Bearbeiten", hwnd: start.instance?.hwnd } },
      undefined,
      { timeout: 60_000, maxTotalTimeout: 60_000 },
    ), "menu-close");
  }
  process.stdout.write(`${JSON.stringify({ heading: page.ueberschrift, pid: start.pid, bearbeiten })}\n`);
} finally {
  if (started) {
    try {
      parse(await client.callTool(
        { name: "sse_desktop_stop", arguments: { discardChanges: true } },
        undefined,
        { timeout: 90_000, maxTotalTimeout: 90_000 },
      ), "stop");
    } catch {
      // Der aeussere Guard prueft Prozess/Marker/Kopie.
    }
  }
  await client.close();
  assert.equal(sha256(), before, "Arbeitskopie wurde bei der Seitenprobe veraendert.");
}
