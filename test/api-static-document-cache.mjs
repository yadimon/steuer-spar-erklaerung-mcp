import assert from "node:assert/strict";
import { once } from "node:events";
import { createSseApiServer } from "../dist/api-server.js";
import { SSE_API_DISCOVERY } from "../dist/api-discovery.js";
import { SSE_OPENAPI_DOCUMENT } from "../dist/api-openapi.js";

const config = {
  host: "127.0.0.1",
  port: 1,
  configPath: "C:\\StaticApiDocumentTest\\config.json",
  caseDir: "C:\\StaticApiDocumentTest\\cases",
  workspaceDir: "C:\\StaticApiDocumentTest\\workspace",
  resultDir: "C:\\StaticApiDocumentTest\\results",
  sseExecutable: "C:\\StaticApiDocumentTest\\SSE.exe",
};
const server = createSseApiServer({
  execute: async () => { throw new Error("Discovery-GET darf keinen Executor starten."); },
});
const discoverySchema = SSE_API_DISCOVERY.argumentSchemas.health;
const openApiInfo = SSE_OPENAPI_DOCUMENT.info;
const mutationKey = "x-sse-runtime-mutation-fixture";
const expectedDiscovery = JSON.stringify(SSE_API_DISCOVERY);
const expectedOpenApi = JSON.stringify(SSE_OPENAPI_DOCUMENT);

assert.equal(Object.isFrozen(discoverySchema), false, "Fixture braucht ein absichtlich nur flach eingefrorenes Schema.");
assert.equal(Object.isFrozen(openApiInfo), false, "Fixture braucht ein absichtlich nur flach eingefrorenes OpenAPI-Objekt.");

try {
  discoverySchema[mutationKey] = "darf-nicht-im-http-dokument-erscheinen";
  openApiInfo[mutationKey] = "darf-nicht-im-http-dokument-erscheinen";

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const headers = {};

  for (const [path, expected] of [
    ["/v1/operations", expectedDiscovery],
    ["/v1/openapi.json", expectedOpenApi],
  ]) {
    const first = await fetch(`${baseUrl}${path}`, { headers });
    const second = await fetch(`${baseUrl}${path}`, { headers });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.headers.get("content-length"), String(Buffer.byteLength(expected)));
    assert.equal(await first.text(), expected, `${path}: publizierter Snapshot wurde nachtraeglich veraendert.`);
    assert.equal(await second.text(), expected, `${path}: wiederholter GET ist nicht byteidentisch.`);
  }

  process.stdout.write("API-Vertragsdokumente: einmal serialisierte, byteidentische Snapshots bestanden\n");
} finally {
  delete discoverySchema[mutationKey];
  delete openApiInfo[mutationKey];
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}
