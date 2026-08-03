/**
 * Steuert eine Seite ueber ihre Ueberschrift an, indem mit "Weiter" bzw.
 * "Zurueck" geblaettert wird. Zuverlaessiger als Suche oder Navigationsbaum.
 *
 * Aufruf: node test/gehezu.mjs "Personalkosten" [--max 40] [--zurueck]
 * Danach steht die Seite offen; weitere Skripte koennen darauf aufsetzen.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
const argv = process.argv.slice(2);
const ZIEL = argv[0];
const MAX = Number(argv[argv.indexOf("--max") + 1]) || 45;
const KNOPF = argv.includes("--zurueck") ? "Zurück" : "Weiter";

if (!ZIEL) { console.error('Aufruf: node test/gehezu.mjs "Ueberschrift"'); process.exit(2); }

const txt = (r) => r?.content?.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "";
const obj = (r) => { try { return JSON.parse(txt(r)); } catch { return null; } };

const client = new Client({ name: "gehezu", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env } }));
const call = (n, a = {}) => client.callTool({ name: n, arguments: a });

const gesund = obj(await call("sse_health"));
if (gesund?.advice !== "gesund") {
  console.error(`Programm nicht gesund: ${gesund?.advice} (${gesund?.canaryMs} ms)`);
  process.exit(1);
}

let h = (obj(await call("sse_read_page")) ?? {}).heading;
console.log(`Start: ${h}`);
for (let i = 0; i < MAX && h !== ZIEL; i++) {
  const r = await call("sse_click", { name: KNOPF, waitMs: 950 });
  if (r.isError) { console.error(`'${KNOPF}' nicht ausloesbar auf "${h}"`); break; }
  h = (obj(await call("sse_read_page")) ?? {}).heading;
  process.stdout.write(`  ${i + 1}. ${h}\n`);
}
if (h === ZIEL) {
  console.log(`\n✓ angekommen: ${h}`);
  const seite = obj(await call("sse_read_page"));
  for (const l of seite?.lines ?? []) console.log("   " + l);
  process.exitCode = 0;
} else {
  console.error(`\n✗ nicht gefunden, stehe auf "${h}"`);
  process.exitCode = 1;
}
await client.close();
