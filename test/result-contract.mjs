import assert from "node:assert/strict";
import { SSE_API_OPERATIONS } from "../dist/api-contract.js";
import { SSE_DESTRUCTIVE_OPERATIONS } from "../dist/operation-traits.js";
import {
  parseApiOperationResult,
  SSE_API_RESULT_OUTPUT_SCHEMAS,
  SSE_API_RESULT_SCHEMAS,
  SSE_API_RESULT_SCHEMA_VERSION,
} from "../dist/result-contract.js";

assert.equal(SSE_API_RESULT_SCHEMA_VERSION, 1);
assert.deepEqual(Object.keys(SSE_API_RESULT_OUTPUT_SCHEMAS), [...SSE_API_OPERATIONS]);
assert.deepEqual(Object.keys(SSE_API_RESULT_SCHEMAS), [...SSE_API_OPERATIONS]);

const TRANSPORT_RESULT_FIELDS = new Set(["ok", "kind", "error", "ms"]);
const operationsWithoutSpecificResultContract = SSE_API_OPERATIONS.filter((operation) =>
  Object.keys(SSE_API_RESULT_OUTPUT_SCHEMAS[operation].shape)
    .every((field) => TRANSPORT_RESULT_FIELDS.has(field))
);
assert.deepEqual(
  operationsWithoutSpecificResultContract,
  [],
  "Jede API-Operation braucht mindestens ein operationsspezifisches Ergebnisfeld.",
);
const destructiveOperationsWithoutResultContract = SSE_DESTRUCTIVE_OPERATIONS.filter((operation) =>
  Object.keys(SSE_API_RESULT_OUTPUT_SCHEMAS[operation].shape)
    .every((field) => TRANSPORT_RESULT_FIELDS.has(field))
);
assert.deepEqual(
  destructiveOperationsWithoutResultContract,
  [],
  "Destruktive Operationen duerfen nicht nur einen generischen Ergebnisumschlag veroeffentlichen.",
);
assert.deepEqual(
  Object.keys(SSE_API_RESULT_OUTPUT_SCHEMAS.case_hash.shape).filter((key) =>
    ["path", "exists", "size", "mtimeUtc", "sha256", "header", "transmitted", "transmittedReason"].includes(key)),
  ["path", "exists", "size", "mtimeUtc", "sha256", "header", "transmitted", "transmittedReason"],
  "case_hash muss seine stabilen Datei- und AKAD-Felder im API-/MCP-Schema veroeffentlichen.",
);
assert.deepEqual(
  Object.keys(SSE_API_RESULT_OUTPUT_SCHEMAS.list_cases.shape).filter((key) =>
    ["dir", "cases", "count", "parserError"].includes(key)),
  ["dir", "cases", "count", "parserError"],
  "list_cases muss Verzeichnis, Liste, Anzahl und Parserstatus im API-/MCP-Schema veroeffentlichen.",
);
assert.deepEqual(
  Object.keys(SSE_API_RESULT_OUTPUT_SCHEMAS.verify.shape).filter((key) =>
    ["vergleichOk", "sourceHash", "sourceHashBefore", "sourceHashAfter", "sourceVollstaendig",
      "sourceStopKind", "sourceStopReason",
      "geprueft", "abweichungen", "ergebnis", "zusammenfassung"].includes(key)),
  ["vergleichOk", "sourceHash", "sourceHashBefore", "sourceHashAfter", "sourceVollstaendig",
    "sourceStopKind", "sourceStopReason",
    "geprueft", "abweichungen", "ergebnis", "zusammenfassung"],
  "verify muss seinen stabilen Vollstaendigkeits-, Vergleichs- und Ergebnisvertrag veroeffentlichen.",
);
assert.deepEqual(
  Object.keys(SSE_API_RESULT_OUTPUT_SCHEMAS.backup_cases.shape).filter((key) =>
    ["dest", "anzahl", "files", "hashes", "manifest", "verified", "copiedBeforeFailure",
      "rolledBack", "retainedTargets", "backupStillExists"].includes(key)),
  ["dest", "anzahl", "files", "hashes", "manifest", "verified", "copiedBeforeFailure",
    "rolledBack", "retainedTargets", "backupStillExists"],
  "backup_cases muss Erfolgs- und Recovery-Felder im API-/MCP-Schema veroeffentlichen.",
);

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
assert.equal(parseApiOperationResult("close", {
  ok: false,
  kind: "postcondition-failed",
  error: "synthetischer Schliessfehler",
  stillRunning: true,
  killed: false,
}).stillRunning, true, "close muss einen vollstaendigen fail-closed Ergebnisumschlag akzeptieren.");
assert.equal(parseApiOperationResult("menu_close", {
  ok: false,
  kind: "postcondition-failed",
  error: "synthetischer Menuefehler",
  collapsed: ["Datei"],
  popupCountBefore: 1,
  popupCountAfter: 1,
  verified: false,
  warning: "Menue-Popup ist noch sichtbar.",
}).verified, false, "menu_close muss einen vollstaendigen fail-closed Ergebnisumschlag akzeptieren.");
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
assert.throws(
  () => parseApiOperationResult("case_hash", { ok: true, transmitted: "vielleicht" }),
  /unknown|boolean/i,
  "case_hash darf neben boolesch nur den ausdruecklichen Uebermittlungsstatus 'unknown' veroeffentlichen.",
);
assert.throws(
  () => parseApiOperationResult("backup_cases", {
    ok: false,
    kind: "postcondition-failed",
    error: "synthetisch",
    retainedTargets: [42],
  }),
  /string/i,
  "backup_cases.retainedTargets muss eine Liste redigierter Ressourcenpfade sein.",
);
assert.throws(
  () => parseApiOperationResult("tracked_set_value", { ok: true, epochNachher: 1 }),
  /string/i,
  "tracked_set_value.epochNachher ist ein Inhaltsfingerprint und kein Mock-Zaehler.",
);
assert.throws(
  () => parseApiOperationResult("file_dialog_select", { ok: true, selected: true }),
  /string/i,
  "file_dialog_select.selected muss wie im Worker den gebundenen Zieltext tragen.",
);
assert.throws(
  () => parseApiOperationResult("click_point", { ok: true, clicked: true }),
  /string/i,
  "click_point.clicked muss den gelesenen Knotennamen statt eines bloßen Flags tragen.",
);
assert.throws(
  () => parseApiOperationResult("click_point", { ok: true, at: { x: 10, y: 20 } }),
  /string/i,
  "click_point.at muss wie im Worker die kompakte gelesene Koordinate tragen.",
);
assert.throws(
  () => parseApiOperationResult("vast_apply", { ok: true, applied: 1 }),
  /boolean/i,
  "vast_apply.applied bestaetigt den Merge boolesch; die Planzeilen stehen getrennt in appliedPlan.",
);
assert.equal(parseApiOperationResult("scroll", { ok: true, vPercent: -1 }).vPercent, -1,
  "UIA meldet NoScroll als negativen Sentinelwert; der Ergebnisvertrag darf ihn nicht in einen 502 verwandeln.");
assert.equal(parseApiOperationResult("set_value", {
  ok: true,
  verified: true,
  before: "",
  requested: "muster",
  after: "muster",
  expectedAfter: "muster",
  binding: { rid: "42.7" },
  inputGuard: { aktiv: false, baseline: null, beobachtet: null, eingriffErkannt: false },
  windowGuard: { vorher: "A".repeat(64), nachher: "A".repeat(64), geaendert: false },
}).before, "", "Das globale Suchfeld darf vor der Mutation leer sein.");
assert.equal(parseApiOperationResult("set_value", {
  ok: false,
  kind: "postcondition-failed",
  error: "synthetisch",
  before: "",
  requested: "muster",
  after: null,
  expectedAfter: "muster",
  verified: false,
  binding: { rid: "42.7" },
  rollback: { versucht: true, erfolgreich: true, ist: false, erwartet: "", grund: null },
}).rollback.ist, false, "Rollback-Lesewerte bleiben wegen gemeinsamem Workerformat String/Number/Boolean-kompatibel.");
assert.throws(
  () => parseApiOperationResult("set_value", {
    ok: true,
    binding: { rid: "42.7" },
    windowGuard: { vorher: "kein-hash", nachher: "A".repeat(64), geaendert: false },
  }),
  /invalid_string|regex|Invalid/u,
  "Der Fenster-Guard muss die vom Worker erzeugten SHA-256-Fingerprints binden.",
);

const realWorkerShapes = {
  list_cases: {
    dir: "cases:.",
    cases: [{
      name: "muster.Gew2025",
      path: "cases:muster.Gew2025",
      kb: 4,
      modified: "2026-08-16 10:20:30",
      module: "Gew2025",
      fileType: "Gew",
      year: "2025",
      steuernummer: "",
      savedBy: "31.0.1.0",
      elsterTransferTime: "",
      transmitted: false,
      transmittedReason: "ElsterTransferTime ist leer",
      encryptedBytes: 1024,
      meta: null,
    }],
    count: 1,
    parserError: null,
  },
  case_hash: {
    path: "cases:muster.Gew2025",
    exists: true,
    size: 4096,
    mtimeUtc: "2026-08-16T10:20:30.1234567Z",
    sha256: "A".repeat(64),
    header: { FileType: "Gew", VJahr: "2025" },
    transmitted: false,
    transmittedReason: "ElsterTransferTime ist leer",
  },
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
  verify: {
    vergleichOk: false,
    sourceHash: "9".repeat(64),
    sourceVollstaendig: true,
    sourceStopKind: "end-of-branch",
    sourceStopReason: "synthetischer Stand",
    geprueft: 2,
    abweichungen: 1,
    ergebnis: [{ seite: "Betriebsausgaben", status: "ABWEICHUNG" }],
    zusammenfassung: "1 von 2 Erwartungen weicht ab.",
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
    header: { FileType: "Gew", VJahr: "2025" },
    transmitted: false,
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
assert.throws(
  () => parseApiOperationResult("list_cases", {
    ok: true,
    count: 1,
    cases: [{ ...realWorkerShapes.list_cases.cases[0], transmitted: "vielleicht" }],
  }),
  /unknown|boolean/i,
  "list_cases darf pro Fall neben boolesch nur den ausdruecklichen Uebermittlungsstatus 'unknown' veroeffentlichen.",
);
assert.equal(parseApiOperationResult("list_cases", {
  ok: true,
  count: 1,
  cases: [{ name: "muster.Gew2025", steuernummer: null, elsterTransferTime: null, transmitted: null }],
}).cases[0].name, "muster.Gew2025");
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
