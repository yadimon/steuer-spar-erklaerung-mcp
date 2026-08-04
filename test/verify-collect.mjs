/**
 * Sanitisierte Regressionen fuer den hashgebundenen Soll/Ist-Abgleich.
 * Verwendet nur synthetische JSON-Daten im Temp-Ordner und startet keine SSE.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const worker = join(root, "powershell", "sse-worker.ps1");
const tempRoot = mkdtempSync(join(tmpdir(), "sse-verify-"));
let checks = 0;

const assert = (condition, message) => {
  checks += 1;
  if (!condition) throw new Error(message);
};
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const writeDocument = (name, document) => {
  const path = join(tempRoot, name);
  writeFileSync(path, JSON.stringify(document, null, 2), "utf8");
  return { path, hash: sha256(path) };
};
const callVerify = (args) => {
  const b64 = Buffer.from(JSON.stringify(args), "utf8").toString("base64");
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", worker, "-Op", "verify", "-B64", b64],
    { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (!result.stdout.trim()) throw new Error(`Verify-Worker ohne JSON. stderr=${result.stderr}`);
  return JSON.parse(result.stdout);
};

try {
  const complete = writeDocument("complete.json", {
    vollstaendig: true,
    stopKind: "end-of-branch",
    stopReason: "synthetischer vollstaendiger Stand",
    anzahl: 2,
    seiten: [
      {
        nr: 1,
        ueberschrift: "Betriebsausgaben",
        felder: [
          { label: "EDV-Kosten", wert: "5.440,39", ro: true },
          { label: "Kosten", wert: "10,00", ro: true },
          { label: "Kosten", wert: "20,00", ro: true },
          { label: "Währung", wert: "5.440,39 EUR", ro: true },
          { label: "Mehrdeutig", wert: "1.2.3", ro: true },
        ],
      },
      {
        nr: 2,
        ueberschrift: "Sonstige Betriebsausgaben",
        felder: [{ label: "EDV-Kosten", wert: "50.00", ro: true }],
      },
    ],
  });

  const compared = callVerify({
    from: complete.path,
    expectedSourceHash: complete.hash,
    erwartungen: [
      { seite: "Betriebsausgaben", label: "EDV-Kosten", wert: "5440.39" },
      { seite: "Ausgaben", label: "EDV-Kosten", wert: "50,00" },
      { seite: "Betriebsausgaben", label: "Kosten", wert: "10,00" },
      { seite: "Betriebsausgaben", label: "Kosten", labelOccurrence: 2, wert: "20,00" },
      { seite: "Ausgaben", seiteOccurrence: 2, label: "EDV-Kosten", wert: "50,00" },
      { seite: "Betriebsausgaben", label: "EDV-Kosten", wert: "5.440,00" },
      { seite: "Betriebsausgaben", label: "Währung", wert: "5440.39" },
      { seite: "Betriebsausgaben", label: "Mehrdeutig", wert: "123" },
    ],
  });
  assert(compared.ok === true && compared.vergleichOk === false,
    `Fachliche Abweichungen duerfen nicht als Workerfehler verschwinden: ${JSON.stringify(compared)}`);
  assert(compared.sourceHash === complete.hash && compared.sourceVollstaendig === true,
    "Vergleich meldet Quellhash oder Vollstaendigkeit nicht zurueck.");
  assert(compared.ergebnis[0].status === "stimmt",
    `Deutsches Zahlenformat und Invariant-Dezimalpunkt gelten nicht als gleich: ${JSON.stringify(compared)}`);
  assert(compared.ergebnis[1].status === "Seite mehrdeutig" && compared.ergebnis[1].treffer === 2,
    "Mehrdeutiger Seitenteilstring waehlt weiterhin still den ersten Treffer.");
  assert(compared.ergebnis[2].status === "Feld mehrdeutig" && compared.ergebnis[2].treffer === 2,
    "Doppelte exakte Feldbezeichnung waehlt weiterhin still den ersten Treffer.");
  assert(compared.ergebnis[3].status === "stimmt" && compared.ergebnis[3].matchMode.endsWith("-occurrence"),
    "Bewusste Feld-Occurrence loest die gemeldete Mehrdeutigkeit nicht auf.");
  assert(compared.ergebnis[4].status === "stimmt" && compared.ergebnis[4].pageMatchMode.endsWith("-occurrence"),
    "Bewusste Seiten-Occurrence loest die gemeldete Mehrdeutigkeit nicht auf.");
  assert(compared.ergebnis[5].status === "ABWEICHUNG" && compared.ergebnis[5].differenz === 0.39,
    "Centgenaue Differenz wurde nicht korrekt berechnet.");
  assert(compared.ergebnis[6].status === "stimmt",
    "Explizites EUR-Suffix wurde nicht als sicherer Zahlenzusatz erkannt.");
  assert(compared.ergebnis[7].status === "ABWEICHUNG" && compared.ergebnis[7].differenz === null,
    "Mehrdeutige Zahlengruppierung wurde im Soll/Ist-Bericht numerisch bestaetigt.");
  assert(compared.abweichungen === 4,
    `Mehrdeutigkeiten und Wertabweichung wurden nicht vollstaendig gezaehlt: ${compared.abweichungen}`);

  const wrongHash = callVerify({
    from: complete.path,
    expectedSourceHash: "0".repeat(64),
    erwartungen: [{ seite: "Betriebsausgaben", label: "EDV-Kosten", wert: "5.440,39" }],
  });
  assert(wrongHash.ok === false && wrongHash.kind === "precondition-failed",
    "Abweichender Quellhash wurde nicht vor dem Vergleich blockiert.");

  const incomplete = writeDocument("incomplete.json", {
    vollstaendig: false,
    stopKind: "dialog-open",
    stopReason: "synthetischer Pruefhinweis",
    anzahl: 1,
    seiten: [{ nr: 1, ueberschrift: "Betriebsausgaben", felder: [{ label: "EDV-Kosten", wert: "10,00" }] }],
  });
  const refusedIncomplete = callVerify({
    from: incomplete.path,
    expectedSourceHash: incomplete.hash,
    erwartungen: [{ seite: "Betriebsausgaben", label: "EDV-Kosten", wert: "10,00" }],
  });
  assert(refusedIncomplete.ok === false && refusedIncomplete.kind === "verification-source-incomplete" &&
    refusedIncomplete.sourceStopKind === "dialog-open",
  "Unvollstaendiger Collect-Stand wurde ohne ausdrueckliche Begrenzung akzeptiert.");

  const allowedIncomplete = callVerify({
    from: incomplete.path,
    expectedSourceHash: incomplete.hash,
    allowIncompleteSource: true,
    erwartungen: [{ seite: "Betriebsausgaben", label: "EDV-Kosten", wert: "10,00" }],
  });
  assert(allowedIncomplete.ok === true && allowedIncomplete.vergleichOk === true &&
    allowedIncomplete.sourceVollstaendig === false && /keine Gesamtaussage/i.test(allowedIncomplete.zusammenfassung),
  "Bewusst begrenzter Teilstandsabgleich ist nicht eindeutig als Teilstand gekennzeichnet.");

  const legacy = writeDocument("legacy.json", {
    anzahl: 1,
    seiten: [{ nr: 1, ueberschrift: "Altformat", felder: [{ label: "Wert", wert: "1,00" }] }],
  });
  const refusedLegacy = callVerify({
    from: legacy.path,
    expectedSourceHash: legacy.hash,
    erwartungen: [{ seite: "Altformat", label: "Wert", wert: "1,00" }],
  });
  assert(refusedLegacy.ok === false && refusedLegacy.kind === "verification-source-incomplete" &&
    refusedLegacy.sourceVollstaendig === null,
  "Altes JSON ohne Vollstaendigkeitsnachweis wurde als vollstaendig behandelt.");

  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, "dist", "index.js")], env: { ...process.env } });
  const client = new Client({ name: "sse-verify-regression", version: "1.0.0" });
  try {
    if (!process.env.SSE_TEST_RESULT_DIR) throw new Error("SSE_TEST_RESULT_DIR fehlt im API-Testharness.");
    copyFileSync(complete.path, join(process.env.SSE_TEST_RESULT_DIR, "verify-complete.json"));
    await client.connect(transport);
    const mcpResult = await client.callTool({
      name: "sse_verify",
      arguments: {
        sourceRef: "results:verify-complete.json",
        expectedSourceHash: complete.hash,
        erwartungen: [{ seite: "Betriebsausgaben", label: "EDV-Kosten", wert: "5.440,00" }],
      },
    });
    const mcpText = mcpResult.content?.filter((part) => part.type === "text").map((part) => part.text).join("\n") ?? "";
    const mcpJson = JSON.parse(mcpText);
    assert(mcpResult.isError !== true && mcpJson.vergleichOk === false &&
      mcpJson.abweichungen === 1 && mcpJson.ergebnis?.[0]?.status === "ABWEICHUNG",
    "MCP-Transport verwirft fachliche Abweichungsdetails weiterhin als generischen Werkzeugfehler.");
  } finally {
    await client.close();
  }

  process.stdout.write(`OK: ${checks} hashgebundene Vollstaendigkeits-, Mehrdeutigkeits- und Zahlenpruefungen.\n`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
