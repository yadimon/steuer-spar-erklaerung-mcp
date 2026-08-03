import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const token = "all-tools-wrapper-token-with-at-least-24-characters";
const calls = [];
const api = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const authorization = request.headers.authorization;
  if (authorization !== `Bearer ${token}`) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: "unauthorized", message: "unauthorized" } }));
    return;
  }
  const operation = /\/v1\/operations\/([a-z_]+)$/.exec(request.url ?? "")?.[1];
  assert(operation, `Unerwarteter API-Pfad: ${request.url}`);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  calls.push({ operation, args: body.args ?? {} });
  const result = {
    ok: true,
    operation,
    args: body.args ?? {},
    shot: { path: "C:\\Temp\\synthetic.png", w: 100, h: 50 },
    windows: operation === "windows"
      ? [{ hwnd: 77, title: "Werte-Info", titleFingerprint: "f".repeat(64) }]
      : [],
    dialogs: [],
    files: [],
    cases: [],
    rows: [],
    fields: [],
    items: [],
    options: [],
    results: [],
    pages: [],
    fragenWarnungen: [],
    tippsZusatzinfos: [],
    sonstige: [],
    aufgeklappt: [],
    product: { supported: true, taxYear: 2025, fileMajor: 31 },
    diagnosticText: "Dokumentation https://example.invalid/hilfe; lokaler Test C:\\Temp\\synthetic.png; danach lesbar",
    text: "Original mit C:\\NichtKonfiguriert\\beleg.txt; Ende",
    verzeichnis: operation === "center_cases" ? "Z:\\FremdeFaelle" : undefined,
    uncText: "UNC \\\\server\\freigabe\\datei.txt; Ende",
    extendedPathText: "Erweitert \\\\?\\C:\\Privat\\datei.txt; Ende",
    pathKeyObject: {
      "C:\\Privat\\erstes.txt": "eins",
      "\\\\server\\freigabe\\zweites.txt": "zwei",
    },
  };
  const envelope = { apiVersion: "v1", requestId: String(calls.length), operation, durationMs: 0, result };
  const json = JSON.stringify(envelope);
  response.writeHead(200, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(json),
  });
  response.end(json);
});

function stringSample(schema, property) {
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  if (/sha256|hash/i.test(property) || /\{64\}/.test(schema.pattern ?? "")) return "0".repeat(64);
  if (/desktop.*name/i.test(property)) return "SSEWrapperTest";
  if (/^\^results:/.test(schema.pattern ?? "")) return "results:fixture.json";
  if (/^\^workspace:/.test(schema.pattern ?? "")) return "workspace:fixture.json";
  if (/^\^backups:/.test(schema.pattern ?? "")) return "backups:fixture";
  if (/^\^cases:/.test(schema.pattern ?? "")) return "cases:fixture.Gew2025";
  if (/scenarioRef/i.test(property)) return "workspace:scenarios/fixture.json";
  if (/resultRef/i.test(property)) return "results:fixture.json";
  if (/destinationRef/i.test(property)) return "backups:fixture";
  if (/\(\?:results\|workspace\)/.test(schema.pattern ?? "")) return "results:fixture.json";
  if (/caseRef|sourceRef|targetRef/i.test(property)) return "cases:fixture.Gew2025";
  if (/resourceRef/i.test(property)) return "documents:fixture.txt";
  if (/ref/i.test(property)) {
    if (/\^cases:/.test(schema.pattern ?? "")) return "cases:fixture.Gew2025";
    return "workspace:fixture.txt";
  }
  if (/path|file|from|target|dest|dir/i.test(property)) return "fixture.Gew2025";
  return "x".repeat(Math.max(1, schema.minLength ?? 1));
}

function sample(schema, property = "value") {
  if (!schema || typeof schema !== "object") return null;
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(alternatives)) {
    const selected = alternatives.find((entry) => entry.type !== "null") ?? alternatives[0];
    return sample(selected, property);
  }
  if (Array.isArray(schema.type)) {
    return sample({ ...schema, type: schema.type.find((entry) => entry !== "null") ?? schema.type[0] }, property);
  }
  switch (schema.type) {
    case "object": {
      const result = {};
      for (const required of schema.required ?? []) {
        result[required] = sample(schema.properties?.[required] ?? schema.additionalProperties ?? {}, required);
      }
      return result;
    }
    case "array": {
      const count = Math.max(0, schema.minItems ?? 0);
      return Array.from({ length: count }, () => sample(schema.items ?? {}, property));
    }
    case "integer":
    case "number":
      if (typeof schema.minimum === "number") return schema.minimum;
      if (typeof schema.exclusiveMinimum === "number") return schema.exclusiveMinimum + 1;
      return 1;
    case "boolean":
      return true;
    case "string":
      return stringSample(schema, property);
    case "null":
      return null;
    default:
      if (schema.properties) return sample({ ...schema, type: "object" }, property);
      return null;
  }
}

api.listen(0, "127.0.0.1");
await once(api, "listening");
const address = api.address();
assert(address && typeof address === "object");
const here = dirname(fileURLToPath(import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, "..", "dist", "index.js")],
  env: {
    ...process.env,
    SSE_API_URL: `http://127.0.0.1:${address.port}`,
    SSE_API_TOKEN: token,
  },
});
const client = new Client({ name: "sse-all-tools-wrapper", version: "1.0.0" });

try {
  await client.connect(transport);
  const catalog = await client.listTools();
  const toolTexts = new Map();
  assert.equal(catalog.tools.length, 80, `Unerwartete MCP-Werkzeugzahl: ${catalog.tools.length}`);
  const pathBearingTools = new Set([
    "sse_case_hash", "sse_center_refresh", "sse_window_close", "sse_vast_apply", "sse_desktop_start",
    "sse_export_csv", "sse_collect", "sse_verify",
    "sse_screenshot", "sse_launch", "sse_save", "sse_file_dialog_select", "sse_save_as",
    "sse_change_field", "sse_change_known_field", "sse_list_cases", "sse_backup_cases",
    "sse_archive_cases", "sse_make_working_copy",
  ]);
  const forbiddenPathFields = new Set([
    "path", "file", "from", "dir", "dest", "source", "target", "expectedPath",
    "expectedCasePath", "expectedDirectory", "expectedTitle", "expectedSourcePath", "targetPath",
  ]);
  for (const tool of catalog.tools.filter((entry) => pathBearingTools.has(entry.name))) {
    const properties = Object.keys(tool.inputSchema?.properties ?? {});
    assert.deepEqual(
      properties.filter((property) => forbiddenPathFields.has(property)),
      [],
      `${tool.name} veroeffentlicht weiterhin lokale PC-Pfadfelder`,
    );
  }
  for (const tool of catalog.tools) {
    const args = sample(tool.inputSchema, tool.name);
    const result = await client.callTool(
      { name: tool.name, arguments: args },
      undefined,
      { timeout: 10_000, maxTotalTimeout: 10_000 },
    );
    const text = result.content?.filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n") ?? "";
    toolTexts.set(tool.name, text);
    assert.notEqual(result.isError, true, `${tool.name} scheiterte mit ${JSON.stringify(args)}: ${text}`);
    assert(!text.includes("C:\\Temp\\synthetic.png"), `${tool.name} darf keinen lokalen API-Pfad ausgeben`);
  }
  assert.equal(calls.length, 80, `Erwartet wurde genau ein API-Aufruf je MCP-Werkzeug, erhalten: ${calls.length}`);
  const readText = toolTexts.get("sse_workspace_read_text") ?? "";
  assert(readText.includes("Dokumentation https://example.invalid/hilfe"), "URL und Nutztext muessen erhalten bleiben");
  assert(readText.includes("danach lesbar"), "Text nach einem lokalen Pfad muss erhalten bleiben");
  assert(readText.includes("Lokaler PC-Pfad"), "nur der lokale Pfad muss sichtbar redigiert werden");
  assert(readText.includes('"textRedigiert": true'), "redigierter Dateiinhalt muss explizit markiert sein");
  assert(!readText.includes("NichtKonfiguriert") && !readText.includes("server\\freigabe"),
    "auch nicht konfigurierte Laufwerks-/UNC-Pfade duerfen MCP nicht erreichen");
  assert(readText.includes("lokalerPfadEntfernt") && readText.includes("eins") && readText.includes("zwei"),
    "Pfadschluessel muessen ohne Datenverlust eindeutig redigiert werden");

  const centerText = toolTexts.get("sse_center_cases") ?? "";
  assert(centerText.includes('"verzeichnisRef": null') && centerText.includes('"verzeichnisImFallbereich": false'),
    "Center ausserhalb des Fallbereichs braucht einen expliziten fail-closed Hinweis");
  assert(!centerText.includes("FremdeFaelle"));

  const windowsText = toolTexts.get("sse_windows") ?? "";
  assert(windowsText.includes("f".repeat(64)), "Titel-Fingerprint muss PC-blind erhalten bleiben");
  const beforeWindowRoundtrip = calls.length;
  const closedByFingerprint = await client.callTool(
    { name: "sse_window_close", arguments: { hwnd: 77, titleFingerprint: "f".repeat(64) } },
    undefined,
    { timeout: 10_000, maxTotalTimeout: 10_000 },
  );
  assert.notEqual(closedByFingerprint.isError, true);
  assert.equal(calls.length, beforeWindowRoundtrip + 1);
  assert.deepEqual(calls.at(-1).args, { hwnd: 77, titleFingerprint: "f".repeat(64) });

  const beforeRedactedWrite = calls.length;
  const redactedWrite = await client.callTool(
    {
      name: "sse_workspace_write_text",
      arguments: { ref: "workspace:fixture.txt", text: "[Lokaler PC-Pfad von der MCP-Ausgabe entfernt.]" },
    },
    undefined,
    { timeout: 10_000, maxTotalTimeout: 10_000 },
  );
  assert.equal(redactedWrite.isError, true, "Redaktionsplatzhalter darf nicht auf Platte geschrieben werden");
  assert.equal(calls.length, beforeRedactedWrite, "gesperrter Redaktions-Roundtrip darf die API nicht erreichen");

  const beforeInvalid = calls.length;
  const invalidLaunch = await client.callTool(
    { name: "sse_launch", arguments: { exe: "C:\\Other\\SSE.exe" } },
    undefined,
    { timeout: 10_000, maxTotalTimeout: 10_000 },
  );
  assert.equal(invalidLaunch.isError, true, "MCP muss das lokale exe-Feld am Schemrand ablehnen");
  assert.equal(calls.length, beforeInvalid, "ungueltige MCP-Argumente duerfen die API nicht erreichen");
  process.stdout.write(`MCP-Katalog-Smoke: ${catalog.tools.length} Werkzeuge, ${calls.length} erfolgreiche API-Aufrufe\n`);
} finally {
  await client.close();
  await new Promise((resolve) => api.close(resolve));
}
