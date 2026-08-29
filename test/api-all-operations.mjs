import assert from "node:assert/strict";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSE_API_OPERATIONS } from "../dist/api-contract.js";
import { createSseApiServer } from "../dist/api-server.js";
import { SSE_MCP_TOOL_OPERATIONS } from "../dist/operation-catalog.js";
import { enumChoices, sampleJsonSchema } from "./json-schema-samples.mjs";

const calls = [];
const server = createSseApiServer({
  execute: async (operation, args) => {
    calls.push({ operation, args });
    return { ok: true, operation, args };
  },
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;

const here = dirname(fileURLToPath(import.meta.url));
const discoveryTransport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, "..", "dist", "index.js")],
  env: {
    ...process.env,
    SSE_API_URL: baseUrl,
  },
});
const discoveryClient = new Client({ name: "sse-api-all-operations", version: "1.0.0" });
await discoveryClient.connect(discoveryTransport);
const tools = (await discoveryClient.listTools()).tools;
await discoveryClient.close();

const schemasByOperation = new Map();
for (const tool of tools) {
  const operation = SSE_MCP_TOOL_OPERATIONS[tool.name];
  if (operation && !schemasByOperation.has(operation)) schemasByOperation.set(operation, tool.inputSchema);
}

const headers = { "content-type": "application/json" };

try {
  const listedResponse = await fetch(`${baseUrl}/v1/operations`, { headers });
  assert.equal(listedResponse.status, 200);
  const listed = await listedResponse.json();
  assert.deepEqual(listed.operations, SSE_API_OPERATIONS);

  const baselineOperations = [];
  let optionVariants = 0;
  for (const operation of SSE_API_OPERATIONS) {
    const schema = schemasByOperation.get(operation);
    const args = operation === "checker_detail"
      ? { name: "Synthetischer Pruefhinweis" }
      : operation === "receipt_manager_classify"
        ? {
          rowRid: "1.2.3",
          rowFingerprint: "A".repeat(64),
          expectedListFingerprint: "B".repeat(64),
          expectedDetailFingerprint: "C".repeat(64),
          values: { categories: [] },
          acknowledgeClassification: true,
        }
        : operation === "receipt_manager_bulk_upsert"
          ? {
            items: [{
              resourceRef: "documents:synthetic.pdf",
              expectedHash: "D".repeat(64),
              identity: { exactTitle: "Synthetischer Beleg", documentNumber: "SYN-1" },
              values: { title: "Synthetischer Beleg" },
            }],
            acknowledgeBulkUpsert: true,
          }
          : operation === "receipt_manager_link"
            ? {
              items: [{ expectedReceiptTitle: "Synthetischer Beleg", linked: true }],
              expectedTargetPage: "Synthetische Steuerseite",
              expectedLinkTarget: "Synthetisches Ziel",
              acknowledgeLinkChange: true,
            }
          : sampleJsonSchema(schema, operation);
    assert(args && typeof args === "object" && !Array.isArray(args), `Kein Argumentsample fuer '${operation}'.`);

    const response = await fetch(`${baseUrl}/v1/operations/${operation}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ args }),
    });
    assert.equal(response.status, 200, `${operation}: ${await response.text()}`);
    baselineOperations.push(operation);

    for (const [property, propertySchema] of Object.entries(schema?.properties ?? {})) {
      for (const choice of enumChoices(propertySchema)) {
        const variantArgs = { ...args, [property]: choice };
        if (operation === "click" && property === "pattern" && choice === "select") {
          variantArgs.aid = ".Synthetic.Radio";
        }
        const variant = await fetch(`${baseUrl}/v1/operations/${operation}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ args: variantArgs }),
        });
        assert.equal(
          variant.status,
          200,
          `${operation}.${property} transportiert die beworbene Option '${choice}' nicht: ${await variant.text()}`,
        );
        assert.equal(calls.at(-1).operation, operation);
        assert.equal(calls.at(-1).args[property], choice);
        optionVariants += 1;
      }
    }

    const beforeInvalid = calls.length;
    const invalid = await fetch(`${baseUrl}/v1/operations/${operation}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ args: { ...args, nichtImVertrag: true } }),
    });
    assert.equal(invalid.status, 400, `${operation} akzeptiert ein unbekanntes API-Argument.`);
    assert.equal((await invalid.json()).error.code, "bad-args");
    assert.equal(calls.length, beforeInvalid, `${operation} erreichte trotz bad-args den Executor.`);
  }

  assert.deepEqual(baselineOperations, SSE_API_OPERATIONS);
  assert(optionVariants >= 100, `Zu wenige beworbene API-Optionsvarianten geprueft: ${optionVariants}`);
  process.stdout.write(
    `API-Router-Matrix: ${SSE_API_OPERATIONS.length} Operationen, ${optionVariants} beworbene Optionen und strikte bad-args geprueft\n`,
  );
} finally {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
