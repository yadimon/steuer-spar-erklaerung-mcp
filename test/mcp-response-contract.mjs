import assert from "node:assert/strict";
import {
  apiErrorResult,
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

const isolation = apiErrorResult("health", { ok: false, kind: "worker-isolation-lost", error: "nicht beendet" });
assert.equal(isolation.isError, true);
assert(isolation.content[0].text.includes("API-Prozess neu starten"));
assert(isolation.content[0].text.includes("nicht blind wiederholen"));

process.stdout.write("MCP-Antwortgrenze: Windows-/UNC-/Datei-URL-/POSIX-Pfade redigiert, Nutztext und Recovery erhalten\n");
