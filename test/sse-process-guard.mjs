import assert from "node:assert/strict";
import { hasRunningSseProcess, parseTasklistSseOutput } from "../dist/sse-process-guard.js";

assert.equal(
  parseTasklistSseOutput('"SSE.exe","1234","Console","1","42.000 K"\r\n'),
  true,
);
assert.equal(
  parseTasklistSseOutput("INFORMATION: Es werden keine Aufgaben mit den angegebenen Kriterien ausgeführt.\r\n"),
  false,
);
assert.equal(
  parseTasklistSseOutput("INFO: No tasks are running which match the specified criteria.\r\n"),
  false,
);
assert.throws(
  () => parseTasklistSseOutput('"anderer.exe","1234","Console","1","42.000 K"\r\n'),
  /unerwartete CSV-Antwort/,
);
assert.throws(() => parseTasklistSseOutput(""), /nicht sicher auswertbar/);
assert.throws(() => parseTasklistSseOutput("unstrukturiert\r\n"), /nicht sicher auswertbar/);
assert.equal(typeof await hasRunningSseProcess(), "boolean", "Echter tasklist-Produktionspfad muss auswertbar sein.");

process.stdout.write("SSE-Prozessguard: lokalisierte Leermengen, exakter CSV-Treffer und Fail-closed-Parsing bestanden.\n");
