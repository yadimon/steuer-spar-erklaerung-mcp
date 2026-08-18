/** Klaert: laesst sich ein Navigationsbaum-Eintrag direkt anspringen? */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
const t = (r) => r?.content?.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "";
const j = (r) => { try { return JSON.parse(t(r)); } catch { return null; } };

const client = new Client({ name: "probe-nav", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env } }));

const call = (name, args = {}) => client.callTool({ name, arguments: args });
const heading = async () => (j(await call("sse_read_page")) ?? {}).heading;

console.log("Start-Ueberschrift:", await heading());

const ZIEL = "Betriebsausgaben";
for (const pattern of ["select", "invoke", "expand"]) {
  const res = await call("sse_click", { name: ZIEL, type: "TreeItem", pattern });
  const txt = t(res);
  const now = await heading();
  console.log(`  pattern=${pattern.padEnd(7)} -> ${res.isError ? "FEHLER: " + txt.slice(0, 90) : "ok"} | Ueberschrift jetzt: ${now}`);
  if (now === ZIEL) { console.log("  ==> Navigation hat funktioniert!"); break; }
}

// Gegenprobe: Suchfeld
console.log("\nSuchfeld-Versuch:");
const felder = j(await call("sse_snapshot", { types: ["Edit"] }));
const kandidaten = (felder?.nodes ?? []).filter((n) => n.y < 200);
console.log("  Edit-Felder oben:", JSON.stringify(kandidaten.map((n) => ({ aid: n.aid?.slice(-40), x: n.x, y: n.y }))));

await client.close();
