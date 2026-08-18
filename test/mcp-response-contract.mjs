import assert from "node:assert/strict";
import {
  apiErrorResult,
  apiSuccessResult,
  LOCAL_PATH_REDACTION,
  redactLocalPathText,
  redactPcLocalPaths,
  textResult,
} from "../dist/mcp-response.js";

const windowsUserBackslash = ["C:", "Users", "person", "steuerfall.Gew2025"].join("\\");
const windowsUserSlash = ["C:", "Users", "person", "steuerfall.Gew2025"].join("/");
const windowsUserFileUrl = ["file:///C:", "Users", "person", "steuerfall.Gew2025"].join("/");
const windowsLocalhostFileUrl = ["file://localhost/C:", "Users", "person", "steuerfall.Gew2025"].join("/");
const encodedWindowsUserPath = ["C%3A", "Users", "person", "steuerfall.Gew2025"].join("%5C");
const encodedWindowsPrivatePath = ["D%3a", "Privat", "steuerfall.Gew2025"].join("%2f");

for (const localPath of [
  windowsUserBackslash,
  windowsUserSlash,
  "\\\\server\\freigabe\\steuerfall.Gew2025",
  "\\\\?\\C:\\Privat\\steuerfall.Gew2025",
  windowsUserFileUrl,
  "file:///C:%2FUsers%2Fperson%2Fsteuerfall.Gew2025",
  "file:///C:%5cUsers%5cperson%5csteuerfall.Gew2025",
  "file:///C%3A/Users/person/steuerfall.Gew2025",
  windowsLocalhostFileUrl,
  "file://server/freigabe/steuerfall.Gew2025",
  encodedWindowsUserPath,
  encodedWindowsPrivatePath,
  "/home/person/steuerfall.Gew2025",
  "/root/steuerfall.Gew2025",
  "/Users/person/steuerfall.Gew2025",
  "/Library/Application Support/SSE/config.json",
  "/workspace/steuerfall.Gew2025",
  "/srv/sse/steuerfall.Gew2025",
  "file:///home/person/steuerfall.Gew2025",
]) {
  const redacted = redactLocalPathText(`vorher ${localPath}; nachher`);
  assert(!redacted.includes(localPath), `Lokaler Pfad blieb sichtbar: ${localPath}`);
  assert.equal(redacted, `vorher ${LOCAL_PATH_REDACTION}; nachher`);
}

for (const publicText of [
  "https://example.invalid/home/hilfe",
  "http://127.0.0.1:43127/v1/operations/health",
  "/v1/operations/health",
  "04/08/2026",
  "1/2 Betriebsausgabe",
  "cases:arbeit.Gew2025",
]) {
  assert.equal(redactLocalPathText(publicText), publicText, `Nutztext wurde faelschlich redigiert: ${publicText}`);
}

const nested = redactPcLocalPaths({
  "C:\\Privat\\eins.txt": "eins",
  "/home/person/zwei.txt": "zwei",
  lokalerPfadEntfernt1: "reservierter Nutzschluessel",
  values: ["C:\\Privat\\drei.txt", "/root/vier.txt", "https://example.invalid/home/hilfe"],
});
const nestedText = JSON.stringify(nested);
assert(!nestedText.includes("Privat") && !nestedText.includes("/home/person") && !nestedText.includes("/root/"));
assert(nestedText.includes("eins") && nestedText.includes("zwei"), "Werte zu redigierten Pfadschluesseln muessen erhalten bleiben.");
assert(nestedText.includes("reservierter Nutzschluessel"), "Redigierte Schluessel duerfen Nutzdaten nicht ueberschreiben.");
assert(nestedText.includes("https://example.invalid/home/hilfe"));

const text = textResult({ path: "C:\\Privat\\kontrolle.png", ok: true });
assert.equal(text.isError, undefined);
assert(text.content[0].text.includes(LOCAL_PATH_REDACTION));
assert(!text.content[0].text.includes("Privat"));

const apiSuccess = apiSuccessResult(
  { ok: true, summary: "kompakt" },
  {
    ok: true,
    summary: "vollstaendig",
    syntheticAdditionalField: {
      path: "C:\\Privat\\nur-api.json",
      value: 42,
    },
    imageBase64: "A".repeat(1024),
    nested: { bildBase64: "B".repeat(1024), retained: true },
  },
);
assert.deepEqual(JSON.parse(apiSuccess.content[0].text), { ok: true, summary: "kompakt" });
assert.equal(apiSuccess.structuredContent.ok, true);
assert.equal(apiSuccess.structuredContent.syntheticAdditionalField.value, 42);
assert.equal(apiSuccess.structuredContent.syntheticAdditionalField.path, LOCAL_PATH_REDACTION);
assert.equal(apiSuccess.structuredContent.imageBase64, undefined);
assert.equal(apiSuccess.structuredContent.nested.bildBase64, undefined);
assert.equal(apiSuccess.structuredContent.nested.retained, true);
assert(!JSON.stringify(apiSuccess.structuredContent).includes("Privat"));

let rawFieldReads = 0;
const rawApiResult = { ok: true };
Object.defineProperty(rawApiResult, "path", {
  enumerable: true,
  get() {
    rawFieldReads += 1;
    return "C:\\Privat\\einmal-lesen.json";
  },
});
const rawSuccess = apiSuccessResult(rawApiResult, rawApiResult);
assert.equal(rawFieldReads, 1, "Ungeformte MCP-Ergebnisse duerfen nicht doppelt rekursiv gelesen werden.");
assert.deepEqual(JSON.parse(rawSuccess.content[0].text), rawSuccess.structuredContent);
assert.equal(rawSuccess.structuredContent.path, LOCAL_PATH_REDACTION);

const isolation = apiErrorResult("health", { ok: false, kind: "worker-isolation-lost", error: "nicht beendet" });
assert.equal(isolation.isError, true);
assert(isolation.content[0].text.includes("API-Prozess neu starten"));
assert(isolation.content[0].text.includes("nicht blind wiederholen"));
assert.equal(isolation.structuredContent.ok, false);
assert.equal(isolation.structuredContent.kind, "worker-isolation-lost");
assert(isolation.structuredContent.hint.includes("API-Prozess neu starten"));

const redactedError = apiErrorResult("health", {
  ok: false,
  kind: "synthetic",
  error: "Fehler in C:\\Privat\\fall.Gew2025",
  imageBase64: "A".repeat(1024),
});
assert.equal(redactedError.structuredContent.error, `Fehler in ${LOCAL_PATH_REDACTION}`);
assert.equal(redactedError.structuredContent.imageBase64, undefined);

process.stdout.write("MCP-Antwortgrenze: Windows-/UNC-/Datei-URL-/POSIX-Pfade redigiert, Nutztext und Recovery erhalten\n");
