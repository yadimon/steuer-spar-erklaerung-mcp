/** Springt sicher über sse_goto statt über Suchfeld + rohe Eingabetaste. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
const ZIEL = process.argv[2] ?? "Personalkosten";
const txt = (r) => r?.content?.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "";
const client = new Client({ name: "springen", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env } }));
const result = await client.callTool({ name: "sse_goto", arguments: { name: ZIEL, maxSteps: 40 } });
console.log(result.isError ? `FEHLER: ${txt(result)}` : txt(result));
await client.close();
process.exitCode = result.isError ? 1 : 0;
