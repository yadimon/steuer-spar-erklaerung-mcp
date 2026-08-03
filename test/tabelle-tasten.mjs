/**
 * Historischer Name, heute sicher über das gebundene sse_table_read.
 * Die notwendige Tabellenfokussierung und Pfeiltasten liegen intern im selben
 * Worker; eine öffentliche Roh-Tastatur existiert nicht mehr.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
const maxRows = Number(process.argv[2] ?? 200);
const text = (result) => result?.content?.filter((part) => part.type === "text").map((part) => part.text).join("\n") ?? "";
const client = new Client({ name: "tabelle-tasten", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env } }));
const result = await client.callTool({ name: "sse_table_read", arguments: { maxRows } });
console.log(text(result));
await client.close();
process.exitCode = result.isError ? 1 : 0;
