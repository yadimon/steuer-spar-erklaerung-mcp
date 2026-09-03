/**
 * Livebeweis fuer case_create gegen die installierte SteuerSparErklaerung.
 *
 * Der Assistent eines neuen Folgejahr-Falls laesst sich nur auf dem sichtbaren
 * Desktop bedienen; der erste Klick auf 'Jetzt beginnen' braucht den
 * verifizierten Punkt-Fallback, der auf dem versteckten Desktop gesperrt ist.
 * Deshalb: kein versteckter Desktop, keine offene Instanz, frischer Fallordner.
 *
 * Reise: Fall anlegen -> Hash und Instanzbindung zurueckelesen -> Sicherung
 * nach backups: -> Stammdaten ueber Page-Objects schreiben und zuruecklesen ->
 * Themenfilterseite ueber den Schalter erreichen und ein Kontrollkaestchen
 * setzen -> ohne Speichern schliessen. Die neue Datei bleibt byteidentisch zum
 * Stand direkt nach der Anlage.
 *
 * Voraussetzung: laeuft unter test/with-api.mjs (SSE_API_URL, SSE_TEST_CASE_DIR).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const apiUrl = process.env.SSE_API_URL;
const caseDir = process.env.SSE_TEST_CASE_DIR;
assert(apiUrl, "SSE_API_URL fehlt; der Livetest laeuft nur unter test/with-api.mjs.");
assert(caseDir, "SSE_TEST_CASE_DIR fehlt; der Livetest braucht den Fallordner der Test-API.");

const CASE_NAME = "neuer-fall.GewErfass2026";
const CASE_REF = `cases:${CASE_NAME}`;
const MASTER_PAGE = "gew_erfass.allgemeine_angaben_unternehmen";
const VAT_PAGE = "gew_erfass.themenfilter_umsatzsteuer";
const MASTER_HEADING = "Allgemeine Angaben zum Unternehmen";
const VAT_HEADING = "Themenfilter/Angaben zur Umsatzsteuer";
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const schritte = [];

async function request(operation, args = {}, timeoutMs = 90_000) {
  const t0 = Date.now();
  const response = await fetch(`${apiUrl}/v1/operations/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args, timeoutMs }),
  });
  const body = await response.json();
  schritte.push(`${operation} ${Date.now() - t0} ms`);
  assert.equal(response.status, 200, `${operation}: HTTP ${response.status} ${JSON.stringify(body)}`);
  return body.result;
}
async function call(operation, args, timeoutMs) {
  const result = await request(operation, args, timeoutMs);
  assert.equal(result.ok, true, `${operation}: ${JSON.stringify(result)}`);
  return result;
}

const targetPath = join(caseDir, CASE_NAME);
let hwnd = 0;
let pid = 0;
let completed = false;
try {
  const product = await call("product_info", {});
  assert(product.supportedCaseYears?.einurvor?.includes(2026), "Das Profil muss die Gewinn-Erfassung 2026 freigeben.");
  assert.equal((await call("instances", {})).count, 0, "Der Livetest startet nur ohne offene SSE-Instanz.");
  assert.equal((await call("desktop_status", {})).aktiv, false, "Der versteckte Desktop darf nicht aktiv sein.");
  assert(!existsSync(targetPath), "Der Fallordner muss frisch sein.");

  const created = await call("case_create", { targetRef: CASE_REF, mode: "einurvor" }, 300_000);
  hwnd = Number(created.hwnd);
  pid = Number(created.pid);
  assert.equal(created.created, true);
  assert.equal(created.caseRef, CASE_REF);
  assert.match(created.sha256, /^[A-F0-9]{64}$/u);
  assert(hwnd > 0 && pid > 0, `Anlage ohne Fensterbindung: ${JSON.stringify(created)}`);
  assert.equal(created.heading, MASTER_HEADING);
  assert.equal(created.taxYear, 2026);
  assert(existsSync(targetPath), "Die neue Falldatei fehlt auf der Platte.");
  const createdHash = sha256(targetPath);
  assert.equal(createdHash, created.sha256, "Der gemeldete Hash muss zur Datei passen.");
  assert(!JSON.stringify(created).includes(caseDir), "Kein lokaler Pfad darf die API verlassen.");

  const hashed = await call("case_hash", { ref: CASE_REF });
  assert.equal(hashed.sha256, createdHash);
  const instances = await call("instances", { includeHash: true });
  assert.equal(instances.count, 1);
  assert.equal(instances.instances[0].pid, pid);
  assert.equal(instances.instances[0].hwnd, hwnd);
  assert.equal(instances.instances[0].caseName, CASE_NAME);
  // Ein ohne Datei gestarteter Prozess traegt den Pfad nicht in der Kommandozeile;
  // bei gekuerztem Titel bleibt casePath leer und der Worker liefert keinen Hash.
  assert(["instances", "local-file"].includes(created.caseHashSource), JSON.stringify(created));
  assert([null, createdHash].includes(instances.instances[0].caseSha256), JSON.stringify(instances.instances[0]));
  assert.equal(instances.instances[0].recoveredState, false);
  assert.equal((await call("ui_state", { hwnd })).heading, MASTER_HEADING);

  const backup = await call("make_working_copy", {
    sourceRef: CASE_REF, targetRef: "backups:neuer-fall-nach-anlage.GewErfass2026", expectedSourceHash: createdHash,
  });
  assert.equal(backup.verified, true);

  const binding = { hwnd, pid, expectedCaseRef: CASE_REF, expectedCaseHash: createdHash };
  const filled = await call("fill_fields", {
    pageId: MASTER_PAGE,
    // Die Einkunftsart gehoert dazu: ohne sie meldet der Programm-Pruefer beim
    // Verlassen der Seite "ELSTER: Einkunftsart fehlt!", und ein Hinweis mit
    // Uebermittlungsbezug ist fuer dialog_answer bewusst gesperrt.
    fields: [
      { fieldId: "name_unternehmer", expectedBefore: "", value: "Muster", expectedAfter: "Muster" },
      { fieldId: "vorname_unternehmer", expectedBefore: "", value: "Test", expectedAfter: "Test" },
    ],
    ...binding,
  }, 180_000);
  assert.equal(filled.resultingState, "completed-verified", JSON.stringify(filled));
  // Auswahlfelder schreibt nicht fill_fields, sondern der typisierte Combo-Weg
  // mit exakter aid aus dem Katalog.
  const selected = await call("combo_select", {
    expectedPage: MASTER_HEADING, aid: ".AngabenUnternehmen.GruppeNichtInModusKonsUSt.Einkunftsart.Combobox",
    expectedCurrent: "", value: "Gewerbebetrieb", expectedAfter: "Gewerbebetrieb", ...binding,
  }, 120_000);
  assert.equal(selected.after, "Gewerbebetrieb", JSON.stringify(selected));
  const state = await call("known_page_state",{ pageId: MASTER_PAGE, hwnd });
  const valueOf = (fieldId) => state.fields.find((field) => field.fieldId === fieldId)?.value;
  assert.equal(valueOf("name_unternehmer"), "Muster");
  assert.equal(valueOf("vorname_unternehmer"), "Test");
  assert.equal(valueOf("einkunftsart"), "Gewerbebetrieb");
  assert.equal(valueOf("firmenname"), "");

  const toVat = await call("click", {
    aid: "AngabenUnternehmen.Steuerarten.Button", hwnd, expectedPageBefore: MASTER_HEADING, expectedPageAfter: VAT_HEADING, waitMs: 9_000,
  });
  assert.equal(toVat.ueberschriftNachher, VAT_HEADING, JSON.stringify(toVat));
  const vatState = await call("known_page_state",{ pageId: VAT_PAGE, hwnd });
  process.stdout.write(`Themenfilter-Readback: ${JSON.stringify(vatState.fields.map((field) => ({
    id: field.fieldId, present: field.present, value: field.value, enabled: field.enabled, readOnly: field.readOnly,
  })))}\n`);
  const vatField = (fieldId) => vatState.fields.find((field) => field.fieldId === fieldId);
  assert.equal(vatField("lohnsteueranmeldungen")?.present, true, "Das katalogisierte Kontrollkaestchen muss auffindbar sein.");
  assert.equal(vatField("umsatz_vorjahr")?.present, true);
  // Kontrollkaestchen schreibt der typisierte Toggle-Weg; der Vorwert kommt aus
  // dem Katalog-Readback, der Nachwert ist sein Gegenteil.
  // Der Katalog-Readback liefert den Haken als Text in PowerShell-Schreibweise ("True"/"False").
  const checkboxState = (value) => String(value).toLowerCase() === "true";
  const lohnsteuerBefore = checkboxState(vatField("lohnsteueranmeldungen").value);
  const toggled = await call("toggle", {
    expectedPage: VAT_HEADING, aid: ".WeitereAngabenUnternehmen.Lohnsteuer",
    expectedBefore: lohnsteuerBefore, value: !lohnsteuerBefore, expectedAfter: !lohnsteuerBefore, ...binding,
  }, 120_000);
  assert.equal(toggled.after, !lohnsteuerBefore, JSON.stringify(toggled));
  const vatStateAfter = await call("known_page_state",{ pageId: VAT_PAGE, hwnd });
  assert.equal(checkboxState(vatStateAfter.fields.find((field) => field.fieldId === "lohnsteueranmeldungen").value), !lohnsteuerBefore);

  const closed = await call("close", { hwnd, pid, discardChanges: true }, 120_000);
  assert.equal(closed.stillRunning, false, JSON.stringify(closed));
  assert.equal(closed.killed, false, "Ein sauber gespeicherter Fall schliesst ohne harten Stop.");
  hwnd = 0;
  assert.equal(sha256(targetPath), createdHash, "Verwerfen darf die neue Datei nicht veraendern.");
  assert.equal((await call("instances", {})).count, 0);
  completed = true;
} finally {
  if (!completed) process.stdout.write(`Schritte bis zum Abbruch: ${schritte.join(" | ")}\n`);
  if (hwnd > 0) {
    await request("close", { hwnd, pid, force: true, discardChanges: true }, 120_000).catch(() => undefined);
  }
}

process.stdout.write(`Live case_create: Fall angelegt, Stammdaten ueber Page-Objects geschrieben, ohne Speichern geschlossen (${schritte.length} Aufrufe).\n`);
