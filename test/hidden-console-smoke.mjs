import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const fixture = process.env.SSE_HIDDEN_FIXTURE;
if (!fixture) throw new Error("SSE_HIDDEN_FIXTURE mit einer entbehrlichen Arbeitskopie ist Pflicht.");
const sha256 = () => createHash("sha256").update(readFileSync(fixture)).digest("hex");
const before = sha256();
const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..", "dist", "index.js");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [server],
  env: { ...process.env },
});
const client = new Client({ name: "sse-hidden-console-smoke", version: "1.0.0" });
const parse = (result, step) => {
  const text = result?.content?.filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n") ?? "";
  assert.notEqual(result?.isError, true, `${step}: ${text}`);
  return JSON.parse(text);
};
let started = false;

try {
  await client.connect(transport);
  const initial = parse(await client.callTool({ name: "sse_desktop_status", arguments: {} }), "initial-status");
  assert.equal(initial.aktiv, false, "Test braucht einen freien versteckten Desktop.");

  const desktopName = `SSEHiddenSmoke${process.pid}${Date.now()}`;
  const start = parse(
    await client.callTool(
      { name: "sse_desktop_start", arguments: { file: fixture, mode: "einur", name: desktopName, timeoutSec: 20 } },
      undefined,
      { timeout: 45_000, maxTotalTimeout: 45_000 },
    ),
    "start",
  );
  started = true;
  assert.equal(start.desktop, desktopName);
  assert(Number.isInteger(start.pid) && start.pid > 0);
  assert(start.product?.supported === true && start.product?.fileMajor === 31);

  const health = parse(await client.callTool({ name: "sse_health", arguments: {} }), "health");
  assert.equal(health.running, true);
  assert.equal(health.canaryOk, true);

  const stop = parse(
    await client.callTool({ name: "sse_desktop_stop", arguments: { discardChanges: true } }),
    "stop",
  );
  started = false;
  assert.equal(stop.hartBeendet, false, JSON.stringify(stop));
  const final = parse(await client.callTool({ name: "sse_desktop_status", arguments: {} }), "final-status");
  assert.equal(final.aktiv, false);
  assert.equal(final.markeVeraltet, false);
  assert.equal(sha256(), before, "Arbeitskopie wurde veraendert.");
  process.stdout.write(`Hidden-Console-Smoke: PID ${start.pid}, Canary ${health.canaryMs} ms, sauber beendet\n`);
} finally {
  if (started) {
    try {
      await client.callTool({ name: "sse_desktop_stop", arguments: { discardChanges: true } });
    } catch {
      // Die Testkopie und der Marker werden vom aeusseren Guard geprueft.
    }
  }
  await client.close();
  assert.equal(sha256(), before, "Arbeitskopie wurde im Cleanup veraendert.");
}
