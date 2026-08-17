import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiExecutor } from "../dist/api-executor.js";
import { executeLocalVerify } from "../dist/verify-executor.js";
import { directWorker } from "./direct-worker-helpers.mjs";
import { traceOperations } from "./operation-trace.mjs";

const temporary = mkdtempSync(join(tmpdir(), "sse-verify-local-parity-"));
const cases = join(temporary, "cases");
const workspace = join(temporary, "workspace");
const results = join(temporary, "results");
for (const directory of [cases, workspace, results]) mkdirSync(directory, { recursive: true });

const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const writeJson = (name, value) => {
  const path = join(results, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return { path, sourceRef: `results:${name}`, expectedSourceHash: hash(path) };
};
const withoutTransportMetadata = ({ ms: _ms, resourceRefs: _resourceRefs, ...result }) => result;

let workerCalls = 0;
const execute = traceOperations("local-file", createApiExecutor(
  {
    host: "127.0.0.1",
    port: 43127,
    token: "verify-local-parity-token-24-characters",
    configPath: join(temporary, "config.json"),
    profileId: "2025",
    caseDir: cases,
    workspaceDir: workspace,
    resultDir: results,
  },
  async (operation, args) => {
    workerCalls += 1;
    return directWorker(operation, args);
  },
));

try {
  const complete = writeJson("complete.json", {
    vollstaendig: true,
    stopKind: "end-of-branch",
    stopReason: "synthetischer vollstaendiger Stand",
    seiten: [
      {
        ueberschrift: "Betriebsausgaben",
        felder: [
          { label: "EDV-Kosten", wert: "5.440,39" },
          { label: "Kosten", wert: "10,00" },
          { label: "Kosten", wert: "20,00" },
          { label: "Bezeichnung", wert: "ABC" },
          { label: "Strasse", wert: "Straße" },
          { label: "Rundung", wert: "10,125" },
          { label: "Tausender", wert: "1.234" },
          { label: "Mehrdeutige Zahl", wert: "1.2.3" },
          { label: "Euro", wert: "€ 5.440,39" },
          { label: "Prozent", wert: "12,5 %" },
          { label: "NEL", wert: "\u008512,5\u0085" },
        ],
      },
      { ueberschrift: "Sonstige Betriebsausgaben", felder: [{ label: "EDV-Kosten", wert: "50.00" }] },
    ],
  });
  const expectations = [
    { seite: "Betriebsausgaben", label: "EDV-Kosten", wert: "5440.39" },
    { seite: "Ausgaben", label: "EDV-Kosten", wert: "50,00" },
    { seite: "Betriebsausgaben", label: "Kosten", wert: "10,00" },
    { seite: "Betriebsausgaben", label: "Kosten", labelOccurrence: 2, wert: "19,99" },
    { seite: "Betriebsausgaben", label: "Bezeichnung", wert: "abc" },
    { seite: "Betriebsausgaben", label: "Strasse", wert: "Strasse" },
    { seite: "Betriebsausgaben", label: "Rundung", wert: "10,00" },
    { seite: "Betriebsausgaben", label: "Tausender", wert: "1234" },
    { seite: "Betriebsausgaben", label: "Mehrdeutige Zahl", wert: "123" },
    { seite: "Betriebsausgaben", label: "Euro", wert: "5440.39" },
    { seite: "Betriebsausgaben", label: "Prozent", wert: "12.5" },
    { seite: "Betriebsausgaben", label: "NEL", wert: "12.5" },
    { seite: "Fehlt", label: "Feld", wert: "0" },
  ];

  const parityCases = [
    {
      name: "vollstaendiger Vergleich",
      source: complete,
      args: { erwartungen: expectations },
    },
    {
      name: "abweichender Hash",
      source: complete,
      args: { expectedSourceHash: "0".repeat(64), erwartungen: expectations.slice(0, 1) },
    },
  ];

  const incomplete = writeJson("incomplete.json", {
    vollstaendig: false,
    stopKind: "dialog-open",
    stopReason: "synthetischer Pruefhinweis",
    seiten: [{ ueberschrift: "Betriebsausgaben", felder: [{ label: "EDV-Kosten", wert: "10,00" }] }],
  });
  parityCases.push(
    {
      name: "unvollstaendige Quelle gesperrt",
      source: incomplete,
      args: { erwartungen: [{ seite: "Betriebsausgaben", label: "EDV-Kosten", wert: "10,00" }] },
    },
    {
      name: "begrenzter Teilstandsvergleich",
      source: incomplete,
      args: {
        allowIncompleteSource: true,
        erwartungen: [{ seite: "Betriebsausgaben", label: "EDV-Kosten", wert: "10,00" }],
      },
    },
  );

  for (const parityCase of parityCases) {
    const expectedSourceHash = parityCase.args.expectedSourceHash ?? parityCase.source.expectedSourceHash;
    const expected = directWorker("verify", {
      from: parityCase.source.path,
      expectedSourceHash,
      ...parityCase.args,
    });
    const callsBefore = workerCalls;
    const actual = await execute("verify", {
      sourceRef: parityCase.source.sourceRef,
      expectedSourceHash,
      ...parityCase.args,
    }, 30_000);
    assert.equal(workerCalls, callsBefore, `${parityCase.name}: lokaler verify-Pfad darf keinen Worker starten.`);
    assert.deepEqual(actual.resourceRefs, { sourceRef: parityCase.source.sourceRef },
      `${parityCase.name}: lokale Verifikation verliert die maschinenneutrale Quellidentitaet.`);
    assert.deepEqual(
      withoutTransportMetadata(actual),
      withoutTransportMetadata(expected),
      `${parityCase.name}: lokaler verify-Vertrag driftet vom echten Worker.`,
    );
  }

  const riskyUnicode = writeJson("risky-unicode.json", {
    vollstaendig: true,
    seiten: [{ ueberschrift: "STRAẞE", felder: [{ label: "Wert", wert: "1" }] }],
  });
  const riskyArgs = {
    erwartungen: [{ seite: "straße", label: "Wert", wert: "1" }],
    expectedSourceHash: riskyUnicode.expectedSourceHash,
  };
  const riskyExpected = directWorker("verify", { from: riskyUnicode.path, ...riskyArgs });
  const callsBeforeRisky = workerCalls;
  const riskyActual = await execute("verify", { sourceRef: riskyUnicode.sourceRef, ...riskyArgs }, 30_000);
  assert.equal(workerCalls, callsBeforeRisky + 1,
    "Nicht portabel faltbares Unicode muss den kompatiblen Worker erreichen.");
  assert.deepEqual(withoutTransportMetadata(riskyActual), withoutTransportMetadata(riskyExpected),
    "Unicode-Fallback driftet vom echten OrdinalIgnoreCase-Vertrag.");

  const ignoredUnicode = writeJson("ignored-unicode.json", {
    vollstaendig: true,
    seiten: [{ ueberschrift: "Seite", felder: [{ label: "Wert", wert: "a\u00ADb" }] }],
  });
  const ignoredArgs = {
    erwartungen: [{ seite: "Seite", label: "Wert", wert: "ab" }],
    expectedSourceHash: ignoredUnicode.expectedSourceHash,
  };
  const ignoredExpected = directWorker("verify", { from: ignoredUnicode.path, ...ignoredArgs });
  const callsBeforeIgnored = workerCalls;
  const ignoredActual = await execute("verify", { sourceRef: ignoredUnicode.sourceRef, ...ignoredArgs }, 30_000);
  assert.equal(workerCalls, callsBeforeIgnored + 1,
    "Invariant-kulturell ignorierbares Unicode muss den kompatiblen Worker erreichen.");
  assert.deepEqual(withoutTransportMetadata(ignoredActual), withoutTransportMetadata(ignoredExpected),
    "Unicode-Wertfallback driftet vom echten invariant-kulturellen Vergleich.");

  const invalidUtf8Path = join(results, "invalid-utf8.json");
  writeFileSync(invalidUtf8Path, Buffer.from([0x7b, 0x80, 0x7d]));
  const callsBeforeInvalid = workerCalls;
  const invalidUtf8 = await execute("verify", {
    sourceRef: "results:invalid-utf8.json",
    expectedSourceHash: hash(invalidUtf8Path),
    erwartungen: [{ seite: "Seite", label: "Feld", wert: "1" }],
  }, 30_000);
  assert.equal(invalidUtf8.ok, false);
  assert.equal(invalidUtf8.kind, "invalid-source");
  assert.equal(workerCalls, callsBeforeInvalid, "Ungueltiges UTF-8 darf keinen Worker-Fallback starten.");

  const bomPath = join(results, "bom.json");
  const bomDocument = Buffer.from(JSON.stringify({
    vollstaendig: true,
    seiten: [{ ueberschrift: "Seite", felder: [{ label: "Feld", wert: "1" }] }],
  }), "utf8");
  writeFileSync(bomPath, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), bomDocument]));
  const bomArgs = {
    erwartungen: [{ seite: "Seite", label: "Feld", wert: "1" }],
    expectedSourceHash: hash(bomPath),
  };
  const bomExpected = directWorker("verify", { from: bomPath, ...bomArgs });
  const callsBeforeBom = workerCalls;
  const bomActual = await execute("verify", { sourceRef: "results:bom.json", ...bomArgs }, 30_000);
  assert.equal(bomExpected.kind, "invalid-source");
  assert.equal(bomActual.kind, "invalid-source");
  assert.equal(workerCalls, callsBeforeBom, "UTF-8-BOM muss lokal fail-closed bleiben.");

  const oversizedPath = join(results, "oversized.json");
  writeFileSync(oversizedPath, "{}", "utf8");
  truncateSync(oversizedPath, 16 * 1024 * 1024 + 1);
  const callsBeforeOversized = workerCalls;
  const oversized = await execute("verify", {
    sourceRef: "results:oversized.json",
    expectedSourceHash: "0".repeat(64),
    erwartungen: [{ seite: "Seite", label: "Feld", wert: "1" }],
  }, 30_000);
  assert.equal(oversized.kind, "invalid-source");
  assert.equal(workerCalls, callsBeforeOversized,
    "Groessenlimit muss vor unbegrenztem Hashen lokal fail-closed greifen.");

  const callsBeforeMissing = workerCalls;
  const missing = await execute("verify", {
    sourceRef: "results:missing.json",
    expectedSourceHash: "0".repeat(64),
    erwartungen: [{ seite: "Seite", label: "Feld", wert: "1" }],
  }, 30_000);
  assert.equal(missing.kind, "bad-args");
  assert.equal(workerCalls, callsBeforeMissing, "Fehlende Verify-Quelle darf keinen Worker starten.");

  mkdirSync(join(results, "directory.json"));
  const callsBeforeDirectory = workerCalls;
  const directory = await execute("verify", {
    sourceRef: "results:directory.json",
    expectedSourceHash: "0".repeat(64),
    erwartungen: [{ seite: "Seite", label: "Feld", wert: "1" }],
  }, 30_000);
  assert.equal(directory.kind, "bad-args");
  assert.equal(workerCalls, callsBeforeDirectory, "Verify-Quellordner darf keinen Worker starten.");

  const changing = writeJson("changing.json", {
    vollstaendig: true,
    seiten: [{ ueberschrift: "Seite", felder: [{ label: "Feld", wert: "vorher" }] }],
  });
  const changedDocument = {
    vollstaendig: true,
    seiten: [{ ueberschrift: "Seite", felder: [{ label: "Feld", wert: "nachher" }] }],
  };
  const changed = await executeLocalVerify({
    args: {
      from: changing.path,
      expectedSourceHash: changing.expectedSourceHash,
      erwartungen: [{ seite: "Seite", label: "Feld", wert: "vorher" }],
    },
    resourceRefs: { sourceRef: changing.sourceRef },
    timeoutMs: 30_000,
    redactPaths: (value) => value,
    afterSourceRead: () => writeFileSync(changing.path, JSON.stringify(changedDocument), "utf8"),
  });
  assert.equal(changed.kind, "result");
  assert.equal(changed.result.kind, "verification-source-changed");
  assert.equal(changed.result.sourceHashBefore, changing.expectedSourceHash);
  assert.equal(changed.result.sourceHashAfter, hash(changing.path));

  const aborted = new AbortController();
  aborted.abort();
  const callsBeforeAbort = workerCalls;
  const abortedResult = await execute("verify", {
    sourceRef: complete.sourceRef,
    expectedSourceHash: complete.expectedSourceHash,
    erwartungen: expectations.slice(0, 1),
  }, 30_000, aborted.signal);
  assert.equal(abortedResult.ok, false);
  assert.equal(abortedResult.kind, "aborted");
  assert.equal(workerCalls, callsBeforeAbort, "Vorab-Abbruch darf keinen Worker starten.");

  const callsBeforeTimeout = workerCalls;
  const timedOut = await execute("verify", {
    sourceRef: complete.sourceRef,
    expectedSourceHash: complete.expectedSourceHash,
    erwartungen: expectations.slice(0, 1),
  }, 0);
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.kind, "timeout");
  assert.equal(workerCalls, callsBeforeTimeout, "Aufgebrauchtes Zeitbudget darf keinen Worker starten.");

  process.stdout.write("Verify: lokaler API-Pfad bleibt zum echten Worker feldgleich und startet keinen Subprozess.\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
