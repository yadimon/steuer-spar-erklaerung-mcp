/**
 * Realer, vollstaendig verwerfbarer Lebenszyklus einer Tabellenzeile:
 * anlegen, fehlschlagen lassen, aktualisieren, loeschen.
 *
 * Voraussetzung:
 *   SSE_TABLE_FIXTURE=<Wegwerfkopie im Fallbereich der Test-API>
 *
 * Die drei frueheren Einzelskripte (table-add/-update/-delete) schrieben Seite,
 * Summenlabel und die erwarteten Betraege fest ("1,50" -> "1,51"). Diese Werte
 * gehoerten zur privaten Arbeitskopie ihres Autors; auf einer frischen Kopie
 * des Herstellermusterfalls sind sie falsch, und die Skripte konnten dort nie
 * laufen. Hier kommt die Zieltabelle deshalb aus dem Produktprofil und jeder
 * erwartete Betrag aus der Anwendung selbst.
 *
 * Ein einziger Programmstart deckt alle drei Mutationen ab. Am Ende muss die
 * Kontrollsumme wieder exakt auf dem Ausgangswert stehen - erst das beweist,
 * dass sich die drei Operationen gegenseitig sauber aufheben.
 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureCaseRef } from "./fixture-case-ref.mjs";
import { gotoPageFocusless } from "./focusless-navigation.mjs";
import { profiledTablePage } from "./profiled-table-page.mjs";

const fixture = process.env.SSE_TABLE_FIXTURE;
assert(fixture, "SSE_TABLE_FIXTURE mit einer Wegwerfkopie ist Pflicht.");
const caseRef = fixtureCaseRef(fixture);

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const fullText = (result) => result?.content?.filter((part) => part.type === "text")
  .map((part) => part.text).join("\n") ?? "";
const ssePids = () => execFileSync(
  "powershell.exe",
  ["-NoLogo", "-NoProfile", "-Command", "@(Get-Process -Name SSE -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id | Sort-Object) -join ','"],
  { encoding: "utf8", windowsHide: true },
).trim();

/** SSE formatiert Betraege deutsch. Beide Richtungen bleiben exakt und ohne Gleitkomma. */
const parseCents = (text) => {
  assert.match(String(text), /^-?\d{1,3}(?:\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/u,
    `Kein eindeutiger deutscher Waehrungswert: ${JSON.stringify(text)}`);
  const [euro, cent] = String(text).replace(/\./gu, "").split(",");
  const sign = euro.startsWith("-") ? -1 : 1;
  return sign * (Math.abs(Number(euro)) * 100 + Number(cent));
};
const formatCents = (cents) => {
  const euro = String(Math.floor(Math.abs(cents) / 100)).replace(/\B(?=(?:\d{3})+(?!\d))/gu, ".");
  return `${cents < 0 ? "-" : ""}${euro},${String(Math.abs(cents) % 100).padStart(2, "0")}`;
};

const { heading, amountColumn, sumLabel, sumOccurrence } = profiledTablePage();

const here = dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: "sse-table-lifecycle", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, "..", "dist", "index.js")],
  env: { ...process.env },
});
const callRaw = (name, args, timeout = 180_000) => client.callTool(
  { name, arguments: args }, undefined, { timeout, maxTotalTimeout: timeout },
);
const call = async (name, args, timeout = 180_000) => {
  const result = await callRaw(name, args, timeout);
  assert.notEqual(result?.isError, true, `${name}: ${fullText(result)}`);
  return JSON.parse(fullText(result));
};
const callExpectingError = async (name, args, timeout = 180_000) => {
  const result = await callRaw(name, args, timeout);
  assert.equal(result?.isError, true, `${name}: erwarteter Fehler blieb aus: ${fullText(result)}`);
  return JSON.parse(fullText(result));
};

const hashBefore = sha256(fixture);
const pidsBefore = ssePids();
assert.equal(pidsBefore, "", "Der Tabellentest startet nur ohne vorhandene SSE-Instanz.");
let started = null;

/** Beweist, dass die getroffene Zeile wirklich in der gebundenen Summenregion lag. */
const assertRegionBound = (binding, step) => {
  assert(Number.isFinite(binding?.rowY) && Number.isFinite(binding?.sumY),
    `${step}: Tabellenbindung ohne Zeilen-/Summenposition: ${JSON.stringify(binding)}`);
  assert(binding.previousSummaryY < binding.rowY && binding.rowY < binding.sumY,
    `${step}: Zielzeile lag nicht zwischen vorheriger Summe und Kontrollsumme: ${JSON.stringify(binding)}`);
};

const readTable = async (hwnd, step) => {
  // noKeys: auf dem privaten Desktop darf nichts nach vorn geholt und keine
  // Taste gesendet werden. Sichtbare Zeilen genuegen: gebunden wird ueber die
  // Kontrollsumme, nicht ueber die Zeilenzahl.
  const read = await call("sse_table_read", { sumLabel, sumOccurrence, noKeys: true, hwnd });
  assert(Array.isArray(read.kopf) && read.kopf.length > 0, `${step}: Tabellenkopf fehlt.`);
  assert(read.kopf.includes(amountColumn),
    `${step}: profilierte Betragsspalte '${amountColumn}' fehlt im Kopf ${JSON.stringify(read.kopf)}.`);
  assert(typeof read.summe === "string" && read.summe,
    `${step}: sse_table_read meldet die gebundene Kontrollsumme nicht.`);
  return read;
};

try {
  await client.connect(transport);
  // Bewusst sichtbar statt auf privatem Desktop: Qt loescht eine Tabellenzeile
  // nur ueber Strg+Umschalt+Entf, und der Worker sperrt sse_table_delete auf
  // dem versteckten Desktop ausdruecklich ab ('hidden-desktop'). Ein
  // Lebenszyklus, der nur anlegt und aktualisiert, waere unvollstaendig.
  // Das Live-Gate verlangt ohnehin eine unbenutzte Maschine.
  const start = await call("sse_launch", { caseRef, mode: "einur" });
  started = { pid: start.pid, hwnd: start.instance?.hwnd };
  const hwnd = start.instance?.hwnd;
  assert(Number.isInteger(hwnd) && hwnd > 0, `Start lieferte kein Hauptfenster: ${JSON.stringify(start)}`);
  const bound = await call("sse_ui_state", { hwnd });
  assert.equal(bound.running, true, `Gestartete Instanz ist nicht lesbar: ${JSON.stringify(bound)}`);
  assert.equal(bound.instance?.hwnd, hwnd, "Der Lage-Snapshot ist nicht an das Start-HWND gebunden.");

  await gotoPageFocusless(client, heading, { hwnd });

  const before = await readTable(hwnd, "Ausgangslage");
  const sumStart = before.summe;
  assert.equal(formatCents(parseCents(sumStart)), sumStart,
    `Die gelesene Kontrollsumme ueberlebt den Formatvergleich nicht: ${sumStart}`);
  const startCents = parseCents(sumStart);

  // Zwei Betraege, die es in der Tabelle noch nicht gibt: nur so bindet der
  // Text spaeter genau die selbst angelegte Zeile.
  const addedAmount = "0,07";
  const updatedAmount = "0,09";
  const existing = before.zeilen.flat().map((cell) => String(cell ?? ""));
  for (const marker of [addedAmount, updatedAmount]) {
    assert(!existing.includes(marker),
      `Der Markerbetrag ${marker} existiert bereits in der Tabelle; die Zeilenbindung waere mehrdeutig.`);
  }
  const sumAfterAdd = formatCents(startCents + parseCents(addedAmount));
  const sumAfterUpdate = formatCents(startCents + parseCents(updatedAmount));

  const added = await call("sse_table_add", {
    expectedPage: heading,
    werte: before.kopf.map((column) => (column === amountColumn ? addedAmount : "")),
    sumLabel,
    sumOccurrence,
    expectedBefore: sumStart,
    expectedAfter: sumAfterAdd,
    hwnd,
  }, 300_000);
  assert.equal(added.ok, true, `Anlegen war nicht erfolgreich: ${JSON.stringify(added)}`);
  assert.equal(added.verified, true, `Anlegen wurde nicht verifiziert: ${JSON.stringify(added)}`);
  assert.equal(added.sumAfter, sumAfterAdd, `Anlegen erzeugte eine andere Summe: ${JSON.stringify(added)}`);
  assertRegionBound(added.tableBinding, "Anlegen");
  const amountColumnIndex = before.kopf.indexOf(amountColumn);
  const addedTargetRid = added.zellen?.find((cell) => cell.spalte === amountColumnIndex)?.rid;
  assert.equal(typeof addedTargetRid, "string", `Anlegen lieferte keine Runtime-ID fuer die Betragszelle: ${JSON.stringify(added)}`);

  // Absichtlich falsche Nachsumme beim Anlegen: der Rollback muss die eben
  // erzeugte Zeile STRUKTURELL wieder entfernen, nicht nur ihre Zellen leeren.
  // Sonst bliebe eine verwaiste zweite Leerzeile in der Tabelle zurueck.
  const failedAdd = await callExpectingError("sse_table_add", {
    expectedPage: heading,
    werte: before.kopf.map((column) => (column === amountColumn ? "0,02" : "")),
    sumLabel,
    sumOccurrence,
    expectedBefore: sumAfterAdd,
    expectedAfter: formatCents(startCents + 99_999),
    hwnd,
  }, 300_000);
  assert.equal(failedAdd.kind, "postcondition-failed",
    `Falsche Nachsumme beim Anlegen wurde nicht abgewiesen: ${JSON.stringify(failedAdd)}`);
  assert.equal(failedAdd.sumAfter, formatCents(startCents + 9),
    `Der gemeldete Ist-Stand vor dem Rollback stimmt nicht: ${JSON.stringify(failedAdd)}`);
  assert.equal(failedAdd.rollback?.versucht, true,
    `Kein Rollback versucht: ${JSON.stringify(failedAdd.rollback)}`);
  assert.equal(failedAdd.rollback?.methode, "raw-value-row-restore",
    `Unerwartete Rollback-Methode: ${JSON.stringify(failedAdd.rollback)}`);

  // Werteseitig ist der Fehlschlag vollstaendig zurueckgenommen: die
  // Kontrollsumme steht wieder auf dem Stand vor dem misslungenen Anlegen und
  // die Zeile ist leer.
  assert.equal(failedAdd.rollback?.summe, sumAfterAdd,
    `Rollback stellte die Summe nicht wieder her: ${JSON.stringify(failedAdd.rollback)}`);
  assert.equal(failedAdd.rollback?.strukturNachher?.populatedRowCount,
    failedAdd.rollback?.strukturVorher?.populatedRowCount,
    `Nach dem Rollback ist noch eine befuellte Zeile zuviel da: ${JSON.stringify({
      vorher: failedAdd.rollback?.strukturVorher, nachher: failedAdd.rollback?.strukturNachher,
    })}`);

  // OFFENER BEFUND, bewusst als Erwartung festgehalten statt beschoenigt:
  // Qt gibt die materialisierte Zeile beim Zuruecksetzen ueber ValuePattern
  // nicht wieder frei. Sie bleibt als zusaetzliche LEERZEILE stehen
  // (rowCount +1, freeRowCount +1), waehrend Werte und Summe stimmen.
  // Strukturell entfernen liesse sie sich nur ueber Strg+Umschalt+Entf, also
  // ueber denselben physischen Loeschweg wie sse_table_delete - das gehoert
  // nicht ungefragt in einen Rollback-Pfad.
  //
  // Entscheidend ist, dass die Operation genau das MELDET statt Erfolg zu
  // behaupten. Wird die strukturelle Ruecknahme spaeter geloest, schlaegt
  // dieser Test fehl und erzwingt eine bewusste Aktualisierung.
  assert.equal(failedAdd.rollback?.strukturEntfernt, false,
    "Die strukturelle Ruecknahme gelingt jetzt - dieser dokumentierte Befund ist ueberholt.");
  assert.equal(failedAdd.rollback?.erfolgreich, false,
    "Der Rollback meldet Erfolg, obwohl die Zeile strukturell bestehen bleibt.");
  assert.equal(failedAdd.rollback?.strukturNachher?.freeRowCount,
    failedAdd.rollback?.strukturVorher?.freeRowCount + 1,
    `Unerwartete Zahl freier Zeilen nach dem Rollback: ${JSON.stringify(failedAdd.rollback?.strukturNachher)}`);

  // Absichtlich falsche Nachsumme beim Aktualisieren: hier muss jede einzelne
  // beschriebene Zelle auf ihren rohen Ausgangswert zurueckgesetzt werden.
  const rolledBack = await callExpectingError("sse_table_update", {
    expectedPage: heading,
    text: addedAmount,
    targetRid: addedTargetRid,
    werte: before.kopf.map((column) => (column === amountColumn ? updatedAmount : null)),
    sumLabel,
    sumOccurrence,
    expectedBefore: sumAfterAdd,
    expectedAfter: formatCents(startCents + 99_999),
    hwnd,
  }, 300_000);
  assert.equal(rolledBack.kind, "postcondition-failed",
    `Falsche Nachsumme wurde nicht als postcondition-failed abgewiesen: ${JSON.stringify(rolledBack)}`);
  assert.equal(rolledBack.rollback?.versucht, true, `Kein Rollback versucht: ${JSON.stringify(rolledBack.rollback)}`);
  assert.equal(rolledBack.rollback?.erfolgreich, true, `Rollback misslang: ${JSON.stringify(rolledBack.rollback)}`);
  assert.equal(rolledBack.rollback?.summe, sumAfterAdd,
    `Rollback stellte die Summe vor dem Fehlschlag nicht wieder her: ${JSON.stringify(rolledBack.rollback)}`);
  assert(Array.isArray(rolledBack.rollback?.zellen) && rolledBack.rollback.zellen.length > 0,
    `Rollback benennt keine wiederhergestellten Zellen: ${JSON.stringify(rolledBack.rollback)}`);
  assert(rolledBack.rollback.zellen.every((cell) => cell.restored === true),
    `Nicht jede Zelle wurde wiederhergestellt: ${JSON.stringify(rolledBack.rollback.zellen)}`);

  const afterRollback = await readTable(hwnd, "Nach Rollback");
  assert.equal(afterRollback.summe, sumAfterAdd,
    "Nach dem Rollback steht nicht wieder die Summe des angelegten Zustands.");

  const updated = await call("sse_table_update", {
    expectedPage: heading,
    text: addedAmount,
    targetRid: addedTargetRid,
    werte: before.kopf.map((column) => (column === amountColumn ? updatedAmount : null)),
    sumLabel,
    sumOccurrence,
    expectedBefore: sumAfterAdd,
    expectedAfter: sumAfterUpdate,
    hwnd,
  }, 300_000);
  assert.equal(updated.ok, true, `Aktualisieren war nicht erfolgreich: ${JSON.stringify(updated)}`);
  assert.equal(updated.verified, true, `Aktualisieren wurde nicht verifiziert: ${JSON.stringify(updated)}`);
  assert.equal(updated.summeNachher, sumAfterUpdate,
    `Aktualisieren erzeugte eine andere Summe: ${JSON.stringify(updated)}`);
  assertRegionBound(updated.tableBinding, "Aktualisieren");
  const updatedTargetRid = updated.tableBinding?.targetRid;
  assert.equal(typeof updatedTargetRid, "string", `Aktualisieren lieferte keine Runtime-ID fuer das Loeschziel: ${JSON.stringify(updated)}`);

  const deleted = await call("sse_table_delete", {
    expectedPage: heading,
    text: updatedAmount,
    targetRid: updatedTargetRid,
    sumLabel,
    sumOccurrence,
    expectedBefore: sumAfterUpdate,
    expectedAfter: sumStart,
    hwnd,
  }, 300_000);
  assert.equal(deleted.ok, true, `Loeschen war nicht erfolgreich: ${JSON.stringify(deleted)}`);
  assert.equal(deleted.verified, true, `Loeschen wurde nicht verifiziert: ${JSON.stringify(deleted)}`);
  assert.equal(deleted.after, sumStart, `Loeschen fuehrte nicht auf die Ausgangssumme: ${JSON.stringify(deleted)}`);
  assertRegionBound(deleted.tableBinding, "Loeschen");

  const final = await readTable(hwnd, "Endstand");
  assert.equal(final.summe, sumStart,
    "Nach Anlegen, Aktualisieren und Loeschen stimmt die Kontrollsumme nicht mehr mit dem Ausgangswert ueberein.");
  const remaining = final.zeilen.flat().map((cell) => String(cell ?? ""));
  assert(!remaining.includes(updatedAmount), "Die geloeschte Zeile ist weiterhin sichtbar.");
  assert(!remaining.includes(addedAmount), "Die angelegte Zeile ist weiterhin sichtbar.");

  process.stdout.write(
    `OK: Tabellenzeile auf '${heading}' angelegt (${sumStart} -> ${sumAfterAdd}), ` +
    `fehlgeschlagen zurueckgerollt, aktualisiert (${sumAfterUpdate}) und geloescht (${sumStart}).\n`,
  );
} finally {
  try {
    // Nur die selbst gestartete Instanz und nur verwerfend. Ist der Start
    // selbst gescheitert, gibt es nichts zu schliessen - dann darf hier kein
    // zweiter Fehler die eigentliche Ursache verdecken.
    for (const instance of started ? [started] : []) {
      await call("sse_close", { ...instance, force: true, discardChanges: true }, 120_000);
    }
  } finally {
    await client.close();
  }
}

assert.equal(sha256(fixture), hashBefore, "Die Wegwerfkopie wurde trotz Verwerfen auf der Platte veraendert.");
assert.equal(ssePids(), pidsBefore, "Der Tabellentest hat eine SSE-PID erzeugt, beendet oder hinterlassen.");
