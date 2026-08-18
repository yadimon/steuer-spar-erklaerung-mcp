/** Navigiert gekapselt zur Zielseite und liest die Tabelle vollständig. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
const ZIEL = process.argv[2] ?? "Einnahmen: Freiberufler";
const text = (result) => result?.content?.filter((part) => part.type === "text").map((part) => part.text).join("\n") ?? "";
const client = new Client({ name: "tabelle-voll", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env } }));
const goto = await client.callTool({ name: "sse_goto", arguments: { name: ZIEL, maxSteps: 60 } });
if (goto.isError) {
  console.error(text(goto));
  await client.close();
  process.exit(1);
}
const table = await client.callTool({ name: "sse_table_read", arguments: { maxRows: 400 } });
console.log(text(table));
await client.close();
process.exitCode = table.isError ? 1 : 0;
