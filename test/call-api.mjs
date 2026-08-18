/**
 * Kleiner Diagnose-Client fuer genau einen direkten API-Aufruf.
 *
 * Beispiel:
 *   node test/with-api.mjs node test/call-api.mjs ustva_read '{"hwnd":1234}'
 */
import { callApiOperation } from "../dist/api-client.js";

const [, , operation, rawArgs = "{}"] = process.argv;
if (!operation) {
  process.stderr.write("Aufruf: node test/call-api.mjs <operation> '<json-args>'\n");
  process.exit(2);
}

let args;
try {
  args = JSON.parse(rawArgs);
} catch (error) {
  process.stderr.write(`Ungueltiges JSON: ${error.message}\n`);
  process.exit(2);
}
if (!args || typeof args !== "object" || Array.isArray(args)) {
  process.stderr.write("Argumente muessen ein JSON-Objekt sein.\n");
  process.exit(2);
}

const result = await callApiOperation(operation, args, 300_000);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok === false ? 1 : 0;
