/** Prüft den gekapselten Such-/Blaetterpfad ohne öffentliche Roh-Tastatur. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
const TEMP = join(dirname(fileURLToPath(import.meta.url)), "..", ".tmp");
mkdirSync(TEMP, { recursive: true });
const txt = (r) => r?.content?.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "";
const obj = (r) => { try { return JSON.parse(txt(r)); } catch { return null; } };

const client = new Client({ name: "probe-suche", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env } }));
const call = (name, arguments_ = {}) => client.callTool({ name, arguments: arguments_ });
const before = obj(await call("sse_read_page"));
console.log("vorher:", before?.heading);
const goto = await call("sse_goto", { name: "Betriebsausgaben", maxSteps: 40 });
console.log(goto.isError ? `goto FEHLER: ${txt(goto).slice(0, 300)}` : txt(goto).slice(0, 500));
const after = obj(await call("sse_read_page"));
console.log("nachher:", after?.heading);
const shot = obj(await call("sse_screenshot", { path: join(TEMP, "suche.png") }));
console.log("Bild:", shot?.path);
await client.close();
