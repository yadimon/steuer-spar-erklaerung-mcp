/**
 * Untersucht die Eingabefelder der Seite "Umsatzsteuerzahlungen/-Erstattungen"
 * und liest ihre UIA-Eigenschaften. Der historische direkte Schreibversuch
 * ist stillgelegt; Schreibregressionen laufen ueber sse_table_add/update.
 *
 * Aufruf: node test/schreibtest.mjs [--schreiben]
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
const SCHREIBEN = process.argv.includes("--schreiben");

const txt = (r) => r?.content?.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "";
const obj = (r) => { try { return JSON.parse(txt(r)); } catch { return null; } };

const client = new Client({ name: "schreibtest", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env } }));
const call = (n, a = {}) => client.callTool({ name: n, arguments: a });
const heading = async () => (obj(await call("sse_read_page")) ?? {}).heading;

// Zielseite ansteuern
const ZIEL = "Umsatzsteuerzahlungen/-Erstattungen";
await call("sse_click_point", { name: "Einnahmen/Ausgaben", type: "TreeItem", waitMs: 1400 });
let h = await heading();
for (let i = 0; i < 6 && h !== ZIEL; i++) {
  await call("sse_click", { name: "Weiter", waitMs: 1000 });
  h = await heading();
}
console.log(`Seite: ${h}\n`);
if (h !== ZIEL) { console.error("Zielseite nicht erreicht"); process.exit(1); }

// Alle Eingabefelder im Arbeitsbereich zeigen
const snap = obj(await call("sse_snapshot", { types: ["Edit", "DataItem", "ComboBox"] }));
const felder = (snap?.nodes ?? []).filter((n) => n.x > 400 && n.w > 0).sort((a, b) => a.y - b.y || a.x - b.x);
console.log(`Felder im Arbeitsbereich: ${felder.length}`);
for (const f of felder) {
  const kurz = (f.aid ?? "").split(".").slice(-3).join(".");
  console.log(
    `   y=${String(f.y).padStart(5)} x=${String(f.x).padStart(5)} [${f.type.padEnd(9)}] ` +
      `name="${(f.name ?? "").slice(0, 28).padEnd(28)}" wert="${String(f.val ?? "").padEnd(12)}" ro=${f.ro} …${kurz}`,
  );
}

if (!SCHREIBEN) {
  console.log("\n(nur gelesen — sichere Schreibregressionen: npm run test:table-add / test:table-update)");
  await client.close();
  process.exit(0);
}

await client.close();
process.stderr.write(
  "GESPERRT: --schreiben umgeht Seiten-/Summenvertrag. " +
  "Verwende sse_table_add oder sse_table_update.\n",
);
process.exit(2);
