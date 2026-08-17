/**
 * Opt-in Live-Regression gegen die mit SSE ausgelieferten Musterfaelle des
 * per SSE_PROFILE_ID gewaehlten Jahres.
 * Jeder Fall wird in den isolierten Test-API-Fallbereich kopiert, von MCP
 * nochmals bytegleich dupliziert, nur gelesen und ohne Speichern geschlossen.
 *
 * Im Modus `full` entscheidet die Faehigkeitsmatrix des Profils aus
 * `sse_capabilities`, welche fallunveraendernden Operationen der Lauf
 * versucht. Was die Matrix erlaubt, wird ausgefuehrt; fuer alles andere muss
 * sie ausdruecklich einen Sperrgrund nennen. `core-read` ist dagegen ein
 * bewusst kleinerer Evidenzmodus fuer die geoeffnete Musterfallseite und weist
 * seine nicht enthaltenen UI-Zweigwechsel im Ergebnis aus. Ein stiller SKIP
 * ist in beiden Modi ausgeschlossen.
 *
 * Voraussetzung ist eine unbenutzte Windows-Sitzung: Navigation laeuft ueber
 * echte Mausklicks, und Windows verweigert den Vordergrundwechsel, solange
 * nebenher gearbeitet wird.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { callApiOperation } from "../dist/api-client.js";
import { loadProductProfile } from "../dist/product-profiles.js";

const profileId = process.env.SSE_PROFILE_ID ?? "2025";
const profile = loadProductProfile(profileId);
const expectationsPath = join(profile.profileDir, "tests", "expectations.json");
if (!existsSync(expectationsPath)) {
  throw new Error(`Musterfall-Erwartungen fuer SSE-Profil '${profileId}' fehlen: ${expectationsPath}`);
}
const expectations = JSON.parse(readFileSync(expectationsPath, "utf8"));
const snapshotCompareExpectation = expectations.snapshotCompare ?? {};
const snapshotCompareRepetitions = snapshotCompareExpectation.repetitions ?? 3;
assert(Number.isInteger(snapshotCompareRepetitions) && snapshotCompareRepetitions >= 1 && snapshotCompareRepetitions <= 10,
  `snapshotCompare.repetitions fuer Profil '${profileId}' muss zwischen 1 und 10 liegen.`);

const steuertippsRoot = "C:\\Program Files\\Steuertipps\\SteuerSparErklaerung";
const defaultMusterDir = join(steuertippsRoot, profile.executable.installationFolderName, expectations.musterDirRelative);
const musterDir = process.env.SSE_MUSTER_DIR ?? defaultMusterDir;
const testCaseDir = process.env.SSE_TEST_CASE_DIR;
if (!testCaseDir) throw new Error("SSE_TEST_CASE_DIR aus dem isolierten Test-API-Wrapper fehlt.");

const allDefinitions = expectations.cases;
const liveMode = process.env.SSE_LIVE_MUSTER_MODE ?? "full";
assert(["full", "core-read"].includes(liveMode),
  `Unbekannter SSE_LIVE_MUSTER_MODE '${liveMode}'; erlaubt sind full und core-read.`);
const requestedIds = new Set((process.env.SSE_LIVE_MUSTER_CASES ?? "")
  .split(",").map((id) => id.trim()).filter(Boolean));
const knownIds = new Set(allDefinitions.map(({ id }) => id));
for (const id of requestedIds) assert(knownIds.has(id), `Unbekannter Live-Musterfall: ${id}`);
const definitions = requestedIds.size
  ? allDefinitions.filter(({ id }) => requestedIds.has(id))
  : allDefinitions;

for (const definition of definitions) {
  const path = join(musterDir, definition.file);
  assert(existsSync(path), `Offizieller SSE-Musterfall fehlt: ${path}`);
}

const server = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env } });
const client = new Client({ name: "sse-live-muster-cases", version: "1.0.0" });
const fullText = (result) => result?.content?.filter((part) => part.type === "text")
  .map((part) => part.text).join("\n") ?? "";
const parsedText = (result, name) => {
  const text = fullText(result);
  try { return JSON.parse(text); }
  catch { throw new Error(`${name}: Antwort war kein JSON: ${text}`); }
};
const callRaw = (name, args = {}, timeout = 180_000) => client.callTool(
  { name, arguments: args }, undefined, { timeout, maxTotalTimeout: timeout },
);
const call = async (name, args = {}, timeout = 180_000) => {
  const result = await callRaw(name, args, timeout);
  if (result?.isError) throw new Error(`${name}: ${fullText(result)}`);
  return parsedText(result, name);
};
/**
 * Erlaubt genau die aufgezaehlten fachlichen Fehlerarten als gueltiges
 * Ergebnis. Alles andere bleibt ein Testfehler; ein pauschales Durchwinken
 * gibt es nicht.
 */
const callTolerant = async (name, args, allowedKinds, timeout = 180_000) => {
  const result = await callRaw(name, args, timeout);
  // Die kompakte MCP-Textprojektion darf alte Clients nicht brechen, kann aber
  // Diagnosefelder wie die Klickbindung auslassen. Der Live-Gate bewertet
  // deshalb das kanonische, bereits pfadredigierte Ergebnis, falls es vorliegt.
  const parsed = result?.structuredContent && typeof result.structuredContent === "object" &&
    !Array.isArray(result.structuredContent)
    ? result.structuredContent
    : parsedText(result, name);
  if (!result?.isError) return parsed;
  assert(allowedKinds.includes(parsed.kind),
    `${name}: unerwartete Fehlerart '${parsed.kind}' (erlaubt: ${allowedKinds.join(", ")}): ${parsed.error}`);
  return parsed;
};
const callCanonical = async (name, args = {}, timeout = 180_000) => {
  const result = await callRaw(name, args, timeout);
  if (result?.isError) throw new Error(`${name}: ${fullText(result)}`);
  assert(result?.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent),
    `${name}: kanonisches MCP-structuredContent fehlt.`);
  return result.structuredContent;
};
const withoutWorkerTiming = (result) => {
  const { ms: _ignored, ...stable } = result;
  return stable;
};
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let semanticChecks = 0;

function assertSemanticEqual(actual, expected, message) {
  assert.equal(actual, expected, message);
  semanticChecks += 1;
}

function assertExpectedResultRows(definition, result) {
  const { id, expectedRows } = definition;
  assert.equal(result.vollstaendig, true, `${id}: Ergebnisliste ist nicht vollstaendig.`);
  assert.deepEqual(result.unvollstaendigeZeilen, [], `${id}: unvollstaendige Ergebniszeilen.`);
  assert.deepEqual(result.vergleichsInvariantFehler, [], `${id}: Vergleichsinvariante verletzt.`);
  const rows = new Map((result.zeilen ?? []).map((row) => [row.beobachteterWert, row.aktuell]));
  for (const [label, expected] of expectedRows) {
    assertSemanticEqual(rows.get(label), expected, `${id}: ${label}`);
  }
}

function assertExpectedUstva(ustva, erwartet) {
  assert.equal(ustva.ok, true, "UStVA: Snapshot ist nicht erfolgreich.");
  assert.equal(ustva.page, erwartet.page, "UStVA: falsche Seite.");
  assertSemanticEqual(`${ustva.period.frequency}:${ustva.period.key}`, erwartet.period, "UStVA: Zeitraum");
  assertSemanticEqual(ustva.amounts.taxable19.base.cents, erwartet.taxable19BaseCents, "UStVA: 19%-Bemessungsgrundlage");
  assertSemanticEqual(ustva.amounts.taxable19.tax.cents, erwartet.taxable19TaxCents, "UStVA: 19%-Steuer");
  assertSemanticEqual(ustva.amounts.inputTax.cents, erwartet.inputTaxCents, "UStVA: Vorsteuer");
  assertSemanticEqual(
    `${ustva.amounts.settlement.kind}:${ustva.amounts.settlement.cents}`,
    erwartet.settlement,
    "UStVA: Zahllast",
  );
  assert.equal(ustva.transmission.blockedByApi, true, "UStVA: API-Versandsperre fehlt.");
  assert.equal(ustva.effects.savePerformed, false, "UStVA: Leseweg hat gespeichert.");
  assert.equal(ustva.effects.submissionPerformed, false, "UStVA: Leseweg hat uebermittelt.");
}

function assertSnapshotComparison(definition, compared) {
  assert.equal(compared.canaryAfter?.ok, true, `${definition.id}: SSE wurde waehrend snapshot_compare traege.`);
  assert.equal(compared.privateValuesReturned, false,
    `${definition.id}: snapshot_compare darf keine privaten Werte zurueckgeben.`);
  assert.equal(typeof compared.runtimeIdChurnCount, "number",
    `${definition.id}: snapshot_compare weist RuntimeId-Churn nicht separat aus.`);

  const missingOnlyAllowed = snapshotCompareExpectation.allowMissingOnly === true;
  if (!missingOnlyAllowed) {
    assert.equal(compared.equivalent, true,
      `${definition.id}: sicherer TreeWalker und Bulk-Snapshot sind nicht aequivalent: ${JSON.stringify(compared.samples)}`);
  }
  for (const field of ["extraCount", "metadataMismatchCount", "valueMismatchCount"]) {
    assert.equal(compared[field], 0,
      `${definition.id}: snapshot_compare meldete ${field}=${compared[field]}: ${JSON.stringify(compared.samples)}`);
  }
  if (compared.equivalent) {
    assert.equal(compared.missingCount, 0, `${definition.id}: aequivalenter Snapshot meldet fehlende Knoten.`);
    return;
  }
  assert(missingOnlyAllowed,
    `${definition.id}: Snapshot-Abweichung ist fuer dieses Profil nicht freigegeben: ${JSON.stringify(compared.samples)}`);
  assert(compared.missingCount > 0,
    `${definition.id}: nicht aequivalenter Snapshot braucht mindestens einen explizit gemeldeten fehlenden Knoten.`);
}

function assertNoDoubledHelpLines(id, abschnitte) {
  const namen = Object.keys(abschnitte);
  assert(namen.length >= 1, `${id}: sse_help lieferte keinen Abschnitt.`);
  for (const name of namen) {
    const zeilen = abschnitte[name]?.zeilen ?? [];
    for (let i = 1; i < zeilen.length; i++) {
      assert.notEqual(zeilen[i], zeilen[i - 1],
        `${id}: sse_help-Abschnitt '${name}' hat eine doppelte Folgezeile: '${zeilen[i]}'.`);
    }
  }
}

// Lese-Sweep fuer Operationen, die laut Coverage-Audit bisher keine einzige
// funktionale Zusicherung hatten (help, subpages, read_table u. a.). "ok"
// wird bewusst nicht als Feld gelesen: call() wirft bereits bei isError, ein
// zurueckgegebenes Objekt beweist den Erfolg also schon durch sein Dasein.
async function assertReadOnlyOperationSweep(definition, hwnd) {
  const { id } = definition;

  const page = await call("sse_page", { hwnd });
  assert.equal(typeof page.ueberschrift, "string", `${id}: sse_page ohne ueberschrift.`);
  assert(page.ueberschrift.length > 0, `${id}: sse_page lieferte eine leere ueberschrift.`);
  // Kernregressionswaechter: die Strukturbindung muss auf BEIDEN Engines ueber
  // den gebundenen Client-Header lesen, nie ueber den Geometrie-Rueckfall.
  assert.equal(page.ueberschriftQuelle, "clientHeader",
    `${id}: sse_page las die Ueberschrift nicht ueber den gebundenen Client-Header.`);

  await call("sse_read_page", { hwnd });

  const subpages = await call("sse_subpages", { hwnd });
  assert.equal(typeof subpages.anzahl, "number", `${id}: sse_subpages ohne numerische anzahl.`);
  assert(subpages.anzahl >= 0, `${id}: sse_subpages lieferte eine negative anzahl.`);

  const found = await call("sse_find", { hwnd, name: "Steuer", contains: true });
  assert.equal(typeof found.count, "number", `${id}: sse_find ohne numerischen count.`);
  assert.equal(found.incomplete, false, `${id}: sse_find-Baumlauf war abgeschnitten.`);

  // sse_windows kennt kein hwnd - es listet alle Fenster des SSE-Prozesses.
  const windows = await call("sse_windows", {});
  assert(Array.isArray(windows.windows) && windows.windows.length >= 1,
    `${id}: sse_windows lieferte kein Fenster.`);

  const help = await call("sse_help", { hwnd });
  assert.equal(typeof help.abschnitte, "object", `${id}: sse_help ohne abschnitte-Objekt.`);
  assertNoDoubledHelpLines(id, help.abschnitte);

  const readTable = await call("sse_read_table", { hwnd });
  assert(Array.isArray(readTable.ausgeschlosseneFenster),
    `${id}: sse_read_table ohne ausgeschlosseneFenster-Liste.`);

  // sse_read_full sammelt die Seite ueber ihre Rollstufen ein.
  const readFull = await call("sse_read_full", { hwnd });
  assert.equal(typeof readFull.anzahl, "number", `${id}: sse_read_full ohne numerische anzahl.`);
  assert(readFull.anzahl >= 0, `${id}: sse_read_full lieferte eine negative anzahl.`);

  // sse_scroll_page meldet den Rollzustand; kurze Seiten haben scrollbar=false.
  const scrollPage = await call("sse_scroll_page", { hwnd });
  assert.equal(typeof scrollPage.scrollbar, "boolean", `${id}: sse_scroll_page ohne scrollbar-Flag.`);

  // sse_table_read ist der eigenstaendige Tabellenvertrag (nicht sse_read_table).
  await call("sse_table_read", { hwnd });

  // Die tieferen Accessibility-Diagnosen sind deutlich teurer als die
  // fachlichen Leser. Ein echter Lauf pro Produktprofil reicht, um ihren
  // MCP -> API -> Worker-Vertrag gegen die installierte Engine zu beweisen.
  if (definition.id === definitions[0].id) {
    const snapshot = await call("sse_snapshot", { hwnd, namedOnly: true, maxNodes: 5000 }, 180_000);
    assert.equal(typeof snapshot.count, "number", `${id}: sse_snapshot ohne numerischen count.`);
    assert.equal(snapshot.count, snapshot.nodes?.length,
      `${id}: sse_snapshot.count stimmt nicht mit nodes.length ueberein.`);
    const probeTarget = snapshot.nodes?.find((node) =>
      typeof node.rid === "string" && node.rid.length > 0 && typeof node.name === "string" && node.name.length > 0);
    assert(probeTarget, `${id}: sse_snapshot lieferte kein eindeutig per rid pruefbares Element.`);

    const probe = await call("sse_accessibility_probe", {
      hwnd,
      rid: probeTarget.rid,
      maxDepth: 2,
      maxNodes: 50,
      includePatterns: true,
      includeRaw: true,
      includeMsaa: false,
    }, 180_000);
    assert.equal(probe.node?.rid, probeTarget.rid,
      `${id}: sse_accessibility_probe band nicht das zuvor gesnapshotete Element.`);
    assert.equal(typeof probe.uia, "object", `${id}: sse_accessibility_probe ohne UIA-Befund.`);
    assert(Array.isArray(probe.rawDescendants), `${id}: sse_accessibility_probe ohne RawView-Liste.`);
    assert.equal(typeof probe.rawTruncated, "boolean",
      `${id}: sse_accessibility_probe ohne rawTruncated-Status.`);

    const compared = await call("sse_snapshot_compare", { hwnd, repetitions: snapshotCompareRepetitions }, 240_000);
    assertSnapshotComparison(definition, compared);
  }
}

/**
 * Springt ueber den Navigationsbaum in einen Hauptzweig.
 *
 * Der Weg ueber die globale Suche ist hier nicht verlaesslich: Der Doppelklick
 * auf den Suchtreffer aktiviert ihn im Vorbereitungszweig reproduzierbar nicht,
 * die Suche schliesst sich wieder auf der Ausgangsseite und `sse_goto` meldet
 * korrekt `not-found`. Der Baumeintrag desselben Namens fuehrt dagegen direkt
 * zur Zweigseite - solange die Suche geschlossen ist, ist er eindeutig.
 */
async function gotoNavigationBranch(id, hwnd, heading, attempts = 3) {
  // Ein Klick auf einen Navigationseintrag ist wiederholbar: Er waehlt einen
  // Zweig aus und schreibt nichts. Auf einer ausgelasteten Maschine baut Qt die
  // Seite gelegentlich langsamer auf, als die Nachbedingung wartet - dann ist
  // derselbe Klick erneut der richtige Schritt, kein Aufweichen der Pruefung.
  const failures = [];
  let clicked = null;
  for (let attempt = 1; attempt <= attempts && !clicked; attempt++) {
    // Erst pruefen, dass der Name im Baum eindeutig ist - dann ueber genau
    // diesen Namen klicken. Eine runtime id waere hier die falsche Bindung:
    // Engine 30 vergibt zwischen zwei Aufrufen neue IDs, der Klick liefe dann
    // in ein 'nicht gefunden'.
    const found = await callCanonical("sse_find", { name: heading, type: "TreeItem", hwnd });
    assert.equal(found.count, 1,
      `${id}: Navigationszweig '${heading}' ist nicht eindeutig: ${JSON.stringify(found.hits)}`);
    const outcome = await callTolerant("sse_click_point",
      { name: heading, type: "TreeItem", expectedPageAfter: heading, waitMs: 4_000, hwnd },
      ["postcondition-failed", "interference"], 120_000);
    if (outcome.ok === false) {
      const focus = outcome.focusTelemetry
        ? ` Focus=${JSON.stringify(outcome.focusTelemetry)}`
        : "";
      const click = outcome.clickBinding
        ? ` Klick=${JSON.stringify(outcome.clickBinding)}`
        : "";
      failures.push(`Versuch ${attempt}: ${outcome.error}${click}${focus}`);
      await wait(1_000);
      continue;
    }
    clicked = outcome;
  }
  assert(clicked,
    `${id}: Navigationszweig '${heading}' in ${attempts} Anlaeufen nicht erreicht. ` +
    "Wenn jeder Versuch dieselbe Ausgangsseite meldet, hat Qt die gebundene Eingabe nicht aktiviert. " +
    "Die einzelnen Versuche enthalten deshalb ihre Focus-Telemetrie; vor einem erneuten Volltest " +
    `eine ruhige sichtbare Sitzung und die angegebene Bindung pruefen.\n${failures.join("\n")}`);
  assertSemanticEqual(clicked.ueberschriftNachher, heading, `${id}: Navigationszweig nicht erreicht`);
  assertSemanticEqual(clicked.seiteGewechselt, true, `${id}: Zweigklick meldet keinen Seitenwechsel`);

  // Regression: Ein Sprung auf die bereits offene Seite ist ein gueltiges
  // Ergebnis und muss 'weg' als Liste liefern. Ein blosser Text dort liess
  // jeden solchen Aufruf als invalid-operation-result enden.
  const already = await callCanonical("sse_goto", { name: heading, hwnd }, 120_000);
  assertSemanticEqual(already.schritte, 0, `${id}: goto auf die offene Seite meldet Schritte`);
  assert(Array.isArray(already.weg),
    `${id}: goto liefert 'weg' nicht als Liste: ${JSON.stringify(already.weg)}`);
  return clicked;
}

async function runCheckerSweep(definition, hwnd) {
  const { id } = definition;

  await gotoNavigationBranch(id, hwnd, "Prüfen und Abgeben");

  await call("sse_goto", {
    name: "Steuererklärung prüfen", useSearch: false, direction: "Weiter", maxSteps: 10, hwnd,
  }, 300_000);

  const run = await call("sse_checker_run", { hwnd }, 240_000);
  assert.equal(run.konsistent, true, `${id}: checker_run lieferte einen inkonsistenten Ergebnisbaum.`);
  assert.equal(typeof run.gesamt, "number", `${id}: checker_run ohne numerisches gesamt.`);
  assert(run.gesamt > 0, `${id}: checker_run lieferte gesamt <= 0.`);
  // Engine 30 vermerkt den Prueflauf im Dokument und setzt dabei den
  // Ungespeichert-Zustand; Engine 31 tut das nicht. Die Datei aendert sich in
  // beiden Faellen nicht - der Schlusshash dieses Tests belegt das. Erwartet
  // wird deshalb der im Profil hinterlegte Wert, nicht pauschal "false":
  // so faellt sowohl ein neues Dirty-Verhalten in 31 als auch ein
  // verschwundenes in 30 auf.
  assert.equal(run.ungespeichertEingefuehrt, definition.checkerMarksCaseModified === true,
    `${id}: checker_run verhielt sich beim Ungespeichert-Zustand anders als im Profil erwartet.`);

  const results = await call("sse_checker_results", { hwnd }, 180_000);
  assert.equal(results.gesamt, run.gesamt, `${id}: checker_results.gesamt weicht von checker_run.gesamt ab.`);

  // Die Komposition checker_open selbst: Sie liest den Prueferbaum, oeffnet
  // genau eine gebundene Meldung read-only und liefert deren Detailtext.
  const message = [...(results.fragenWarnungen ?? []), ...(results.tippsZusatzinfos ?? []), ...(results.sonstige ?? [])]
    .map((entry) => entry.text)
    .find((text) => typeof text === "string" && text.length > 0);
  assert(message, `${id}: checker_results lieferte keine oeffenbare Meldung.`);
  const detail = await callCanonical("sse_checker_open", { name: message, hwnd }, 300_000);
  assertSemanticEqual(detail.meldung, message, `${id}: checker_open oeffnete eine andere Meldung`);
  assert.equal(typeof detail.kontrollbildEnthalten, "boolean",
    `${id}: checker_open meldet nicht, ob ein Kontrollbild vorliegt.`);
  // checker_detail ist absichtlich kein eigenstaendiges MCP-Werkzeug, aber
  // sehr wohl eine veröffentlichte HTTP-Operation. Nach checker_open ist die
  // Karte exakt gebunden und aufgeklappt; der direkte API-Leseweg darf damit
  // kein eigenes UI-Verhalten auslösen und muss denselben Meldungstitel lesen.
  const directDetail = await callApiOperation("checker_detail", { name: message, hwnd }, 300_000);
  assertSemanticEqual(directDetail.meldung, message,
    `${id}: direkter checker_detail-Aufruf las eine andere Meldung`);
  assert.equal(typeof directDetail.text, "string", `${id}: checker_detail ohne Detailtext.`);
  const reset = await callCanonical("sse_checker_reset", { hwnd }, 240_000);
  assert.deepEqual(reset.aufgeklappt ?? [], [], `${id}: checker_reset liess eine Detailkarte offen.`);

  const closed = await call("sse_checker_close", { hwnd }, 90_000);
  assert.equal(closed.ok, true, `${id}: checker_close meldete keinen Erfolg.`);

  return run.gesamt;
}

async function unlinkOwned(path) {
  assert(dirname(path) === testCaseDir && basename(path).startsWith("sse-muster-live-"),
    `Cleanup verweigert fremdes Ziel: ${path}`);
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!existsSync(path)) return;
    try { unlinkSync(path); } catch (error) {
      if (!error || !["EBUSY", "EPERM"].includes(error.code)) throw error;
    }
    await wait(250);
  }
  assert(!existsSync(path), `Testkopie blieb gesperrt: ${path}`);
}

async function waitForOwnSseShutdown() {
  // Der MCP-Request kann wegen seines Zeitlimits bereits beendet sein, obwohl
  // der vom Worker gestartete, PID-gebundene Schliessvorgang noch auslaeuft.
  // Da der Live-Test nur ohne fremde SSE-Instanz startet, beweist running=false
  // hier, dass die eigene Instanz beendet ist.
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      if (!(await call("sse_health")).running) return null;
    } catch (error) {
      lastError = error;
    }
    await wait(500);
  }
  return lastError
    ? `Gesundheitspruefung nach discard-close scheiterte: ${lastError.message}`
    : "Eigene SSE-Instanz blieb nach discard-close aktiv.";
}

async function closeOwnedLiveInstance(instance, launchedPid) {
  const pid = instance?.pid ?? launchedPid;
  if (!pid) return waitForOwnSseShutdown();

  const args = instance?.hwnd
    ? { pid, hwnd: instance.hwnd, force: true, discardChanges: true }
    : { pid, force: true, discardChanges: true };
  let closeError = null;
  try {
    const closed = await callRaw("sse_close", args, 90_000);
    if (closed?.isError) closeError = `sse_close: ${fullText(closed)}`;
    else if (parsedText(closed, "sse_close").ok !== true) closeError = "sse_close meldete keinen erfolgreichen Abschluss.";
  } catch (error) {
    closeError = `sse_close: ${error.message}`;
  }

  const shutdownError = await waitForOwnSseShutdown();
  if (!shutdownError) return null;
  return closeError ? `${closeError} ${shutdownError}` : shutdownError;
}

function classifyStartupDialog(dialog) {
  const text = (dialog.texts ?? []).join(" ");
  if (dialog.title === "Gewinn aktualisiert!" && /^Der Gewinn des Betriebs ».+« wurde aktualisiert\.$/u.test(text) &&
      (dialog.buttons ?? []).length === 1 && dialog.buttons[0].name === "OK") return "OK";
  return null;
}

async function dismissBoundStartupDialogs(pid) {
  for (let round = 0; round < 4; round++) {
    const listed = await call("sse_dialog_list", { pid });
    const dialogs = (listed.dialogs ?? []).filter((dialog) =>
      dialog.kind === "native-dialog" || dialog.kind === "qt-dialog");
    if (!dialogs.length) return;
    assert.equal(dialogs.length, 1, `Mehrdeutige Startdialoge: ${JSON.stringify(dialogs)}`);
    const button = classifyStartupDialog(dialogs[0]);
    assert(button, `Unerwarteter Startdialog; nichts beantwortet: ${JSON.stringify(dialogs[0])}`);
    await call("sse_dialog_answer", {
      hwnd: dialogs[0].hwnd, fingerprint: dialogs[0].fingerprint, button,
    });
  }
  throw new Error("Startdialog-Kette ueberschritt vier strikt gebundene Antworten.");
}

/**
 * Im Vollmodus entscheidet der Verifikationskatalog des aktiven Profils,
 * welche Operationen dieser Lauf ueberhaupt versuchen darf. So bleibt ein
 * eingeschraenktes Jahresprofil eingeschraenkt, ohne dass der Test still
 * weniger prueft: Was dort nicht laeuft, muss die Matrix ausdruecklich als
 * gesperrt ausweisen. Der gesonderte Core-Read-Modus begrenzt seinen Umfang
 * stattdessen explizit und veröffentlicht diese Grenze im Ergebnis.
 */
let operationPolicy = null;
function policyFor(operation) {
  const entry = operationPolicy?.[operation];
  assert(entry, `Die Fähigkeitsmatrix kennt '${operation}' nicht.`);
  return entry;
}
function allowedOperation(operation) {
  return policyFor(operation).availability === "allowed";
}
function assertBlockedOnPurpose(operation) {
  const entry = policyFor(operation);
  assert.notEqual(entry.availability, "allowed",
    `'${operation}' ist erlaubt und muss deshalb auch live geprueft werden.`);
  assert(entry.reason.length > 0, `'${operation}' ist gesperrt, nennt aber keinen Grund.`);
  semanticChecks += 1;
}

/** Profilunabhaengige Katalog-, Datei- und Arbeitsbereichsauskuenfte. */
async function assertLocalCatalogSweep() {
  const info = await callCanonical("sse_product_info");
  assertSemanticEqual(info.profileId, profileId, "product_info: falsches Profil");
  assertSemanticEqual(info.taxYear, profile.taxYear, "product_info: falsches Steuerjahr");

  const listed = await callCanonical("sse_list_cases", {});
  assert.equal(typeof listed.count, "number", "list_cases ohne numerischen count.");

  const status = await callCanonical("sse_workspace_status");
  assert.equal(status.workspaceReady, true, "workspace_status meldet den Arbeitsbereich nicht als bereit.");
  assert.equal(status.caseDirectoryReady, true, "workspace_status meldet den Testfallordner nicht als bereit.");

  // MCP verlangt die eindeutige Form 'bereich:pfad'; der bare Pfad mit
  // separatem 'area' bleibt der lokalen HTTP-API vorbehalten.
  const files = await callCanonical("sse_workspace_files", { ref: "workspace:." });
  assert(Array.isArray(files.files), "workspace_file_list ohne Dateiliste.");

  const catalog = await callCanonical("sse_page_objects", {});
  assert.equal(catalog.catalog?.schemaVersion, 1, "page_objects lieferte keinen Profilkatalog.");
  const pages = catalog.catalog.pages ?? {};
  assert(Object.keys(pages).length >= 1, "Der Profilkatalog nennt keine bekannte Seite.");

  if (allowedOperation("workspace_file_write_text")) {
    const ref = `workspace:live-sweep-${process.pid}.txt`;
    const written = await callCanonical("sse_workspace_write_text", { ref, text: "Live-Sweep\n" });
    assert.equal(written.ref, ref, "workspace_file_write_text gab keine Ressourcenreferenz zurueck.");
    const read = await callCanonical("sse_workspace_read_text", { ref });
    assertSemanticEqual(read.text, "Live-Sweep\n", "workspace_file_read_text: Rueckgabe weicht ab");
  } else {
    assertBlockedOnPurpose("workspace_file_write_text");
  }

  return pages;
}

/**
 * Waehlt die katalogisierte Seite, die zum Dokumenttyp des Musterfalls gehoert.
 * Nur so ist `known_page_state` deterministisch pruefbar: Auf einer Seite eines
 * anderen Dokumenttyps liefert der Leser korrekt `heading: null`.
 */
function knownPageForCase(pages, definition) {
  const documentType = extname(definition.file).replace(/^\./u, "");
  const matches = Object.entries(pages)
    .filter(([, page]) => page.documentType === documentType)
    .sort(([left], [right]) => left.localeCompare(right));
  assert(matches.length >= 1,
    `Der Profilkatalog kennt keine Seite fuer den Dokumenttyp '${documentType}'.`);
  const [pageId, page] = matches[0];
  assert(typeof page.heading === "string" && page.heading.length > 0,
    `Katalogseite '${pageId}' hat keine Ueberschrift.`);
  return { pageId, heading: page.heading };
}

/**
 * Bewusst teurere, aber ausschliesslich lesende Diagnosen. Sie laufen einmal je
 * Profil am ersten Musterfall; jede weitere Wiederholung kostet nur Zeit.
 */
async function assertDeepReadOnlySweep(definition, hwnd, pages) {
  const { id } = definition;

  // Der Musterfall benennt Personenseiten mit Suffix ("... Eva"), waehrend der
  // Katalog die generische Ueberschrift fuehrt. Eine erzwungene Navigation
  // dorthin waere deshalb nicht verlaesslich. Geprueft wird der Vertrag der
  // Operation selbst: gebundene Seiten-ID, Sollueberschrift, stabiler
  // Inhaltsfingerprint und die Zusicherung, dass keine privaten Werte bleiben.
  const knownPage = knownPageForCase(pages, definition);
  const known = await callCanonical("sse_page_state", { pageId: knownPage.pageId, hwnd });
  assert.equal(known.pageId, knownPage.pageId, `${id}: known_page_state band die angefragte Seite nicht.`);
  assertSemanticEqual(known.expectedHeading, knownPage.heading, `${id}: known_page_state nennt eine andere Sollseite`);
  assert.equal(typeof known.onExpectedPage, "boolean", `${id}: known_page_state ohne Seitenurteil.`);
  assert.match(String(known.epoch), /^[A-F0-9]{64}$/u,
    `${id}: known_page_state liefert keinen Inhaltsfingerprint: ${known.epoch}`);
  assert(Array.isArray(known.fields), `${id}: known_page_state ohne Feldliste.`);
  assert.equal(known.privateValuesPersisted, false,
    `${id}: known_page_state darf keine privaten Werte ablegen.`);
  const repeated = await callCanonical("sse_page_state", { pageId: knownPage.pageId, hwnd });
  assertSemanticEqual(repeated.epoch, known.epoch,
    `${id}: der Inhaltsfingerprint wechselt ohne Zustandsaenderung`);

  // Die MCP-Textprojektion einiger Werkzeuge fuehrt kein 'ok'; ein
  // zurueckgegebenes Objekt beweist den Erfolg bereits, weil call() bei
  // isError wirft. Geprueft werden deshalb fachliche Felder.
  const positions = await callCanonical("sse_positions", { aktion: "list", hwnd });
  assert.equal(typeof positions.anzahl, "number", `${id}: positions ohne numerische anzahl.`);

  const checked = await callCanonical("sse_check_page", { hwnd });
  assert.equal(typeof checked.beanstandungsfrei, "boolean", `${id}: check ohne Gesamturteil.`);
  assert(Array.isArray(checked.leerePflichtfelder), `${id}: check ohne Pflichtfeldliste.`);

  // Die reine Inventur ist auf jeder Seite erfolgreich und beweist den
  // generischen Scroll-Workerpfad auch dann, wenn die konkrete Seite kurz ist.
  const scrollInventory = await callCanonical("sse_scroll", { mode: "list", hwnd });
  assert.equal(typeof scrollInventory.count, "number", `${id}: scroll list ohne numerischen count.`);
  assert(Array.isArray(scrollInventory.scrollables), `${id}: scroll list ohne Containerliste.`);

  // Nicht jede Musterfallseite besitzt einen scrollbaren Container. Fuer den
  // anschliessenden Prozentweg ist genau diese dokumentierte Antwort zulaessig;
  // jede andere Fehlerart bleibt rot.
  const scrolled = await callTolerant("sse_scroll", { mode: "percent", vPercent: 0, hwnd }, ["no-scroll-pattern"]);
  assert(scrolled.mode === "percent" || scrolled.kind === "no-scroll-pattern",
    `${id}: scroll lieferte weder eine Prozentbestaetigung noch die Ohne-Roller-Antwort: ${JSON.stringify(scrolled)}`);
  const treeScrolled = await callCanonical("sse_tree_scroll", { direction: "down", steps: 1, hwnd });
  assert.equal(treeScrolled.gerollt, "down", `${id}: tree_scroll bestaetigte die Richtung nicht.`);
  const treeTop = await callCanonical("sse_tree_top", { hwnd });
  assert.equal(treeTop.gerollt, "oben", `${id}: tree_top bestaetigte den Sprung an den Anfang nicht.`);

  const warning = await callCanonical("sse_warning_popup_read", { hwnd });
  assertSemanticEqual(warning.active, false, `${id}: unerwarteter Warnhinweis im reinen Leselauf`);

  // Erst hier liegen eigene Kopien im isolierten Testfallordner; vorher waere
  // eine Sicherung inhaltslos.
  if (allowedOperation("backup_cases")) {
    const backup = await callCanonical("sse_backup_cases", { destinationRef: `backups:live-sweep-${process.pid}` }, 300_000);
    assert(Array.isArray(backup.files) && backup.files.length >= 1,
      `${id}: backup_cases lieferte keine Dateiliste: ${JSON.stringify(backup).slice(0, 300)}`);
    assertSemanticEqual(backup.anzahl, backup.files.length, `${id}: backup_cases zaehlt anders als es auflistet`);
  } else {
    assertBlockedOnPurpose("backup_cases");
  }

  const found = await callCanonical("sse_find", { name: "Steuer", contains: true, hwnd });
  assert(found.count >= 1, `${id}: find lieferte kein Element fuer den Einzelwertlesetest.`);
  const target = found.hits.find((hit) => typeof hit.rid === "string" && hit.rid.length > 0);
  assert(target, `${id}: find lieferte keinen Treffer mit runtime id.`);
  const single = await callCanonical("sse_get_value", { rid: target.rid, hwnd });
  assert.equal(single.node?.rid, target.rid, `${id}: get_value band einen anderen Knoten.`);
  assert.equal(typeof single.readOnly, "boolean", `${id}: get_value ohne Schreibschutzangabe.`);

  if (allowedOperation("menu")) {
    const menus = await callCanonical("sse_menu", { hwnd });
    assert(Array.isArray(menus.menues) && menus.menues.length >= 1, `${id}: menu listete keine Menuezeile.`);
    const closed = await callCanonical("sse_menu_close", { hwnd });
    assertSemanticEqual(closed.popupCountAfter, 0, `${id}: menu_close liess ein Menuepopup offen`);
    const dismissed = await callCanonical("sse_dismiss", { hwnd });
    assert.equal(typeof dismissed.geschlossen, "number", `${id}: dismiss ohne Zahl geschlossener Hilfsfenster.`);
  } else {
    for (const operation of ["menu", "menu_close", "dismiss"]) assertBlockedOnPurpose(operation);
  }

  // Die Szenario-Engine gegen die echte Anwendung: zwei rein lesende Schritte
  // mit Erwartung und Capture, danach der hashgebundene Ergebnisreadback.
  if (allowedOperation("scenario_run")) {
    const scenarioRef = `workspace:live-${id}-${process.pid}.json`;
    const scenarioResultRef = `results:live-${id}-${process.pid}-szenario.json`;
    const heading = (await callCanonical("sse_page", { hwnd })).ueberschrift;
    await callCanonical("sse_workspace_write_text", {
      ref: scenarioRef,
      text: `${JSON.stringify({
        schemaVersion: 2,
        name: `live read scenario ${id}`,
        resultFile: `live-${id}-${process.pid}-szenario.json`,
        steps: [
          { id: "seite", operation: "page", args: { hwnd }, capture: ["ueberschrift"], expect: { ueberschrift: heading } },
          { id: "zeilen", operation: "read_page", args: { hwnd }, capture: ["heading"], expect: { heading } },
        ],
        finally: [{ id: "abschluss", operation: "page", args: { hwnd }, expect: { ueberschrift: heading } }],
      }, null, 2)}\n`,
    });
    const scenario = await callCanonical("sse_run_scenario",
      { scenarioRef, resultRef: scenarioResultRef }, 300_000);
    assertSemanticEqual(scenario.result?.mainOk, true,
      `${id}: Szenariolauf gegen die echte Anwendung schlug fehl: ${JSON.stringify(scenario.result).slice(0, 400)}`);
    assertSemanticEqual(scenario.result.cleanupOk, true, `${id}: Szenario-Abschlussschritt schlug fehl`);
    assertSemanticEqual(scenario.result.steps.length, 2, `${id}: Szenario fuehrte nicht beide Schritte aus`);
    const report = JSON.parse((await callCanonical("sse_workspace_read_text", { ref: scenarioResultRef })).text);
    assertSemanticEqual(report.status, "ok", `${id}: Szenarioreport meldet keinen Erfolg`);
    assertSemanticEqual(report.steps.find((step) => step.id === "seite")?.values?.ueberschrift, heading,
      `${id}: Szenarioreport haelt die gelesene Ueberschrift nicht fest`);
  } else {
    assertBlockedOnPurpose("scenario_run");
  }

  if (allowedOperation("screenshot")) {
    const shot = await callCanonical("sse_screenshot", { resultRef: `results:live-${id}-${process.pid}.png`, hwnd }, 180_000);
    assert(Number(shot.shot?.w) > 0 && Number(shot.shot?.h) > 0, `${id}: screenshot ohne Bildmasse.`);
  } else {
    assertBlockedOnPurpose("screenshot");
  }

  if (allowedOperation("collect")) {
    // Der Sammellauf beginnt auf der aktuellen Seite. Wo die vorherigen
    // Schritte enden, ist nicht garantiert - von einer Uebersichtsseite ohne
    // Blaetterweg sammelt er zu Recht nichts. Deshalb wird zuvor gebunden in
    // den Formularzweig gesprungen; dort gibt es immer Seiten.
    await gotoNavigationBranch(id, hwnd, "Steuererklärung");

    // Ein am Seitenlimit gestoppter Sammellauf ist ein dokumentiertes, gueltiges
    // Ergebnis - aber nur genau dieses eine. Jede andere Fehlerart bleibt rot.
    const collectRef = `results:live-${id}-${process.pid}.json`;
    const collected = await callTolerant(
      "sse_collect", { resultRef: collectRef, maxPages: 2, hwnd }, ["collection-incomplete"], 300_000,
    );
    assert.equal(typeof collected.dateiHash, "string", `${id}: collect ohne dateiHash fuer die Gegenpruefung.`);
    assert(Array.isArray(collected.ueberschriften) && collected.ueberschriften.length >= 1,
      `${id}: collect sammelte keine Seite.`);

    // Der Soll/Ist-Abgleich meldet Mehrdeutigkeit bewusst als Abweichung. Statt
    // auf ein zufaellig eindeutiges Paar zu hoffen, wird die Position explizit
    // mitgegeben - dafuer gibt es seiteOccurrence und labelOccurrence.
    const document = JSON.parse((await callCanonical("sse_workspace_read_text", { ref: collectRef })).text);
    const pagesInDocument = document.seiten ?? [];
    const expectation = pagesInDocument.flatMap((page, pageIndex) => {
      const seiteOccurrence = pagesInDocument
        .slice(0, pageIndex + 1)
        .filter((candidate) => candidate.ueberschrift === page.ueberschrift).length;
      const felder = page.felder ?? [];
      return felder.flatMap((field, fieldIndex) => {
        if (typeof field.wert !== "string" || field.wert === "") return [];
        const labelOccurrence = felder
          .slice(0, fieldIndex + 1)
          .filter((candidate) => candidate.label === field.label).length;
        return [{ seite: page.ueberschrift, seiteOccurrence, label: field.label, labelOccurrence, wert: field.wert }];
      });
    })[0];
    assert(expectation, `${id}: collect lieferte keine pruefbare Feldzeile.`);
    const verified = await callCanonical("sse_verify", {
      sourceRef: collectRef,
      expectedSourceHash: collected.dateiHash,
      allowIncompleteSource: collected.vollstaendig !== true,
      erwartungen: [expectation],
    }, 180_000);
    assertSemanticEqual(verified.ergebnis?.[0]?.status, "stimmt",
      `${id}: verify bestaetigte den eigenen Sammelstand nicht: ${JSON.stringify(verified.ergebnis?.[0])}`);
    assertSemanticEqual(verified.abweichungen, 0, `${id}: verify meldete eine Abweichung gegen den eigenen Stand`);
  } else {
    assertBlockedOnPurpose("collect");
    assertBlockedOnPurpose("verify");
  }
}

const observations = [];
const startedAt = Date.now();
await client.connect(transport);
try {
  assert.equal((await call("sse_health")).running, false,
    "Live-Muster-Test startet nur ohne vorhandene SSE-Instanz.");
  const capabilities = await call("sse_capabilities");
  operationPolicy = capabilities.operationPolicy;
  assert(operationPolicy && typeof operationPolicy === "object",
    "sse_capabilities lieferte keine Profil-Operationsmatrix.");
  const catalogPages = await assertLocalCatalogSweep();
  for (const definition of definitions) {
    const source = join(musterDir, definition.file);
    const suffix = `${process.pid}-${Date.now()}${extname(source)}`;
    const stagedSource = join(testCaseDir, `sse-muster-live-${definition.id}-source-${suffix}`);
    const target = join(testCaseDir, `sse-muster-live-${definition.id}-working-${suffix}`);
    const sourceRef = `cases:${basename(stagedSource)}`;
    const targetRef = `cases:${basename(target)}`;
    const sourceHash = sha256(source);
    let instance = null;
    let launchedPid = null;
    let primaryError = null;
    try {
      copyFileSync(source, stagedSource);
      const staged = await call("sse_case_hash", { ref: sourceRef });
      assert.equal(staged.sha256, sourceHash, `${definition.id}: staging hash`);
      const directHash = await callApiOperation("case_hash", { ref: sourceRef }, 30_000);
      const canonicalMcpHash = await callCanonical("sse_case_hash", { ref: sourceRef }, 30_000);
      assert.deepEqual(withoutWorkerTiming(canonicalMcpHash), withoutWorkerTiming(directHash),
        `${definition.id}: direkter HTTP- und kanonischer MCP-Fallhash weichen ab.`);
      semanticChecks += 1;
      await call("sse_make_working_copy", { sourceRef, targetRef, expectedSourceHash: sourceHash });
      const working = await call("sse_case_hash", { ref: targetRef });
      assert.equal(working.sha256, sourceHash, `${definition.id}: working-copy hash`);

      const launched = await call("sse_launch", { caseRef: targetRef, mode: definition.mode }, 120_000);
      launchedPid = launched.pid;
      instance = launched.instance ?? null;
      await dismissBoundStartupDialogs(launchedPid);
      const state = await call("sse_ui_state", instance?.hwnd ? { hwnd: instance.hwnd } : {});
      instance = state.instance;
      assert(Number.isInteger(instance?.pid) && Number.isInteger(instance?.hwnd),
        `${definition.id}: SSE-Instanz ist nicht eindeutig gebunden.`);
      const page = await call("sse_page", { hwnd: instance.hwnd });
      const result = await call(definition.operation, { hwnd: instance.hwnd }, 300_000);
      assertExpectedResultRows(definition, result);
      if (definition.id === definitions[0].id) {
        const parityArgs = { hwnd: instance.hwnd, openIfNeeded: false };
        const directResult = await callApiOperation("result_details", parityArgs, 300_000);
        const canonicalMcpResult = await callCanonical(definition.operation, parityArgs, 300_000);
        assert.deepEqual(withoutWorkerTiming(canonicalMcpResult), withoutWorkerTiming(directResult),
          `${definition.id}: direkter HTTP- und kanonischer MCP-Ergebnisreadback weichen ab.`);
        semanticChecks += 1;
      }
      await assertReadOnlyOperationSweep(definition, instance.hwnd);
      const observation = {
        id: definition.id,
        file: definition.file,
        page: page.ueberschrift,
        operation: definition.operation,
        result,
      };
      if (liveMode === "full" && definition.ustva) {
        const ustvaPage = definition.ustva.page;
        await gotoNavigationBranch(definition.id, instance.hwnd, ustvaPage);
        observation.ustva = await call("sse_ustva_read", { hwnd: instance.hwnd }, 300_000);
        assertExpectedUstva(observation.ustva, definition.ustva);
        // Die UStVA-Uebersicht traegt immer den Zeitraumwaehler. Sie ist damit
        // die einzige Seite, auf der ein ComboBox-Lesevertrag ohne Ratespiel
        // gebunden werden kann.
        const combos = await call("sse_find", { type: "ComboBox", hwnd: instance.hwnd });
        assert(combos.count >= 1, `${definition.id}: UStVA-Uebersicht ohne Zeitraum-ComboBox.`);
        const combo = combos.hits.find((hit) => typeof hit.aid === "string" && hit.aid.length > 0);
        assert(combo, `${definition.id}: keine ComboBox mit AutomationId auf der UStVA-Uebersicht.`);
        // Engine 30 haengt die Popup-Eintraege nicht unter die AutomationId der
        // ComboBox. Der Leser meldet das ehrlich als 'not-found', statt eine
        // moeglicherweise fremde Liste zu behaupten - genau diese beiden
        // Ausgaenge sind zulaessig, ein stiller dritter waere der Fehler.
        const options = await callTolerant(
          "sse_combo_options", { rid: combo.rid, hwnd: instance.hwnd }, ["not-found"], 180_000,
        );
        const boundOptions = Array.isArray(options.options) && options.options.length >= 1 &&
          options.collapsedAfterRead === true;
        const honestMiss = options.ok === false && options.kind === "not-found" && options.options === undefined;
        assert(boundOptions || honestMiss,
          `${definition.id}: combo_options lieferte weder eine gebundene Optionsliste noch einen sauberen Fehlschlag: ` +
          JSON.stringify(options).slice(0, 300));
        semanticChecks += 1;
      }
      if (liveMode === "full" && definition.checker) {
        observation.checkerGesamt = await runCheckerSweep(definition, instance.hwnd);
      }
      // Ganz zum Schluss: Der Tiefensweep blaettert durch Seiten und Menues und
      // wuerde die genau gebundenen UStVA- und Prueferwege davor verlassen.
      // Der Tiefensweep enthält die ESt-spezifische Sammelnavigation. Bei
      // einem gefilterten Gew-Einzelprofil darf dessen Auswahl nicht den
      // stabilen, ersten Musterfall des Profilkatalogs ersetzen.
      if (liveMode === "full" && definition.id === allDefinitions[0].id) {
        await assertDeepReadOnlySweep(definition, instance.hwnd, catalogPages);
      }
      observations.push(observation);
      if (process.env.SSE_LIVE_MUSTER_PROBE === "1") {
        process.stdout.write(`${JSON.stringify({ observation }, null, 2)}\n`);
      }
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      const cleanupErrors = [];
      const cleanupError = await closeOwnedLiveInstance(instance, launchedPid);
      if (cleanupError) cleanupErrors.push(cleanupError);
      assert.equal(sha256(source), sourceHash, `${definition.id}: offizieller Musterfall wurde veraendert.`);
      // Solange nicht bewiesen ist, dass die eigene Instanz beendet wurde,
      // bleiben ihre Wegwerfkopien als Diagnoseartefakt erhalten. Der Wrapper
      // darf sie dann nicht still entfernen und einen eventuell noch offenen
      // Prozess mit einem nicht mehr existierenden Fall zuruecklassen.
      if (!cleanupError) {
        await unlinkOwned(target);
        await unlinkOwned(stagedSource);
      }
      if (cleanupErrors.length) {
        const cleanupMessage = cleanupErrors.join(" ");
        if (primaryError instanceof Error) primaryError.message += ` Cleanup: ${cleanupMessage}`;
        else throw new Error(cleanupMessage);
      }
    }
  }
} finally {
  try { await client.close(); } catch { }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  cases: observations.map((observation) => ({
    id: observation.id,
    file: observation.file,
    resultRows: observation.result.anzahl,
    ustvaPage: observation.ustva?.page ?? null,
    checkerGesamt: observation.checkerGesamt ?? null,
  })),
  mode: liveMode,
  omittedInCoreRead: liveMode === "core-read"
    ? ["cross-section-navigation", "ustva-read", "checker", "deep-read-sweep"]
    : [],
  semanticChecks,
  durationMs: Date.now() - startedAt,
}, null, 2)}\n`);
