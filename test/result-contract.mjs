import assert from "node:assert/strict";
import { SSE_API_OPERATIONS } from "../dist/api-contract.js";
import {
  parseApiOperationResult,
  SSE_API_RESULT_OUTPUT_SCHEMAS,
  SSE_API_RESULT_SCHEMAS,
  SSE_API_RESULT_SCHEMA_VERSION,
} from "../dist/result-contract.js";

assert.equal(SSE_API_RESULT_SCHEMA_VERSION, 1);
assert.deepEqual(Object.keys(SSE_API_RESULT_OUTPUT_SCHEMAS), [...SSE_API_OPERATIONS]);
assert.deepEqual(Object.keys(SSE_API_RESULT_SCHEMAS), [...SSE_API_OPERATIONS]);

for (const operation of SSE_API_OPERATIONS) {
  const success = parseApiOperationResult(operation, { ok: true, futureField: { retained: operation } });
  assert.equal(success.ok, true);
  assert.equal(success.futureField.retained, operation, `${operation}: passthrough-Feld ging verloren.`);
  const failure = parseApiOperationResult(operation, { ok: false, kind: "synthetic", error: "synthetisch" });
  assert.equal(failure.kind, "synthetic");
  assert.match(SSE_API_RESULT_OUTPUT_SCHEMAS[operation].description ?? "", new RegExp(`Result_${operation}`));
}

for (const value of [null, [], {}, { ok: "true" }, { ok: true, ms: Number.POSITIVE_INFINITY }]) {
  assert.throws(() => parseApiOperationResult("health", value), /invalid|Expected|Required|finite/i);
}
for (const value of [{ ok: false }, { ok: false, kind: "x" }, { ok: false, error: "x" }]) {
  assert.throws(() => parseApiOperationResult("health", value), /kind|error/);
}
assert.equal(parseApiOperationResult("close", {
  ok: true, error: null, kind: null, stillRunning: false,
}).error, null);
assert.throws(
  () => parseApiOperationResult("health", { ok: true, running: "ja" }),
  /boolean/i,
  "Bekanntes Health-Feld mit falschem Typ wurde akzeptiert.",
);
assert.throws(
  () => parseApiOperationResult("snapshot_compare", { ok: true, equivalent: "ja" }),
  /boolean/i,
  "Snapshot-Paritaetsflag mit falschem Typ wurde akzeptiert.",
);
assert.throws(
  () => parseApiOperationResult("screenshot", { ok: true, shot: { path: "results:test.png", w: "100", h: 50 } }),
  /number/i,
  "Screenshot-Metadaten mit falschem Typ wurden akzeptiert.",
);
assert.equal(parseApiOperationResult("dialog_answer", {
  ok: true, closed: true, answered: true,
}).answered, true);
assert.equal(parseApiOperationResult("dialog_answer", {
  ok: true, closed: true, answered: "OK",
}).answered, "OK");

const realWorkerShapes = {
  known_page_state: {
    pageId: "est-2025-vorsorge",
    expectedHeading: "Vorsorgeaufwendungen",
    onExpectedPage: true,
    heading: "Vorsorgeaufwendungen",
    dirty: false,
    fields: [],
    // Der Worker bildet hier einen SHA-256-Fingerprint des gelesenen
    // Seitenzustands, keinen Zaehler. Die frueher hier stehende Zahl war der
    // Grund, warum niemandem auffiel, dass jeder echte Aufruf mit
    // invalid-operation-result endete.
    epoch: "A".repeat(64),
    privateValuesPersisted: false,
  },
  read_page: { heading: "Vorsorgeaufwendungen", bounds: {}, lines: [], stats: {} },
  read_full: { ueberschrift: "Vorsorgeaufwendungen", gerollt: true, stufen: 5, anzahl: 12, zeilen: [] },
  read_table: {
    headers: [], rows: [], rowCount: 0, ausgeschlosseneFenster: [], stats: {}, incomplete: false,
  },
  collect: {
    vollstaendig: false,
    stopKind: "limit-reached",
    stopReason: "Seitenlimit erreicht",
    anzahl: 3,
    ueberschriften: [],
    seiten: [],
    currentHeadingAfter: "Vorsorgeaufwendungen",
    advancedAfterLastCaptured: false,
  },
  checker_results: {
    aktiv: true,
    konsistent: true,
    gesamt: 0,
    fragenWarnungen: [],
    tippsZusatzinfos: [],
    sonstige: [],
    aufgeklappt: [],
  },
  click: {
    clicked: "Weiter",
    pattern: "invoke",
    method: "uia-invoke+verified-point-fallback",
    kandidaten: 1,
    ueberschriftVorher: "Einnahmen",
    ueberschriftNachher: "Ausgaben",
    navigiert: true,
    verified: true,
  },
  // Der Worker meldet die gesicherten Dateien als Liste und die Anzahl separat;
  // eine Anzahl unter 'files' hatte jeden echten Aufruf mit 502 beendet.
  backup_cases: {
    dest: "backups:lauf-1",
    anzahl: 2,
    files: [{ name: "eins.Gew2025", sha256: "B".repeat(64) }],
    manifest: "backups:lauf-1/pruefsummen.csv",
  },
  archive_cases: {
    archived: 1,
    dest: "backups:archiv-1",
    files: [{ name: "alt.Gew2025", sha256: "C".repeat(64) }],
    remaining: [{ name: "aktuell.Gew2025", sha256: "D".repeat(64) }],
    manifest: "backups:archiv-1/pruefsummen.csv",
    recoverable: true,
  },
  make_working_copy: {
    copied: true,
    source: "cases:muster.Gew2025",
    target: "cases:arbeit.Gew2025",
    sourceHash: "E".repeat(64),
    targetHash: "E".repeat(64),
    verified: true,
  },
  goto: {
    erreicht: true,
    ueberschrift: "Prüfen und Abgeben",
    // 'weg' ist eine Liste, auch wenn der Sprung nur aus einem Schritt besteht.
    // Ein blosser Text hier liess jeden goto auf die offene Seite scheitern.
    weg: ["schon dort"],
  },
  desktop_status: { aktiv: true, desktop: "SSEHidden", sseLaeuft: true, markeVeraltet: false },
  desktop_stop: { hartBeendet: false, desktopMarkeEntfernt: true },
  workspace_status: {
    profileId: "2025",
    configurationFingerprint: "F".repeat(64),
    workspaceReady: true,
    resultAreaReady: true,
    caseDirectoryConfigured: true,
    caseDirectoryReady: true,
    documentAreaReady: true,
    backupAreaReady: true,
    sseExecutableConfigured: true,
  },
};
for (const [operation, shape] of Object.entries(realWorkerShapes)) {
  assert.deepEqual(parseApiOperationResult(operation, { ok: true, ...shape }), { ok: true, ...shape });
  for (const field of Object.keys(shape)) {
    const malformed = { ok: true, ...shape, [field]: Symbol(field) };
    assert.throws(
      () => parseApiOperationResult(operation, malformed),
      undefined,
      `${operation}.${field} ist nicht als reales Worker-Feld typisiert.`,
    );
  }
}

process.stdout.write(`Ergebnisvertraege: ${SSE_API_OPERATIONS.length} versionierte Schemas, Fehlerunion und Malformed-Gates bestanden\n`);
