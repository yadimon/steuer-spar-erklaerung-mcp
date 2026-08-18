/**
 * Vertrag fuer die checker_open-Komposition (src/checker-executor.ts).
 *
 * Der eingebettete Executor wird hier durch ein Skript ersetzt: jeder Schritt
 * liefert eine vorprogrammierte Antwort und wird protokolliert. So laesst sich
 * der Erholungspfad bei unvollstaendigem Prueferbaum deterministisch und ohne
 * laufende Anwendung pruefen - genau die Situation, die auf Engine 30
 * gelegentlich als Flake auftrat.
 */
import assert from "node:assert/strict";
import { executeCheckerOpen } from "../dist/checker-executor.js";

// Ein Executor aus einer Schrittliste: pro Operationsaufruf wird die naechste
// Antwort fuer diese Operation entnommen. Fehlt eine, ist das ein Testfehler.
function scriptedExecutor(script) {
  const queues = new Map();
  for (const [operation, antwort] of script) {
    if (!queues.has(operation)) queues.set(operation, []);
    queues.get(operation).push(antwort);
  }
  const calls = [];
  const execute = async (operation, args) => {
    calls.push(operation);
    const queue = queues.get(operation);
    assert(queue && queue.length, `Unerwarteter Aufruf im Test: ${operation}`);
    return queue.shift();
  };
  return { execute, calls };
}

const meldung = "ELSTER-Pflicht für Selbstständige";
const alsFrage = (texte) => ({ ok: true, aktiv: true, fragenWarnungen: texte.map((text) => ({ text })) });

// --- Fall 1: Unvollstaendiger Baum, Meldung erst nach checker_reset sichtbar.
{
  const unvollstaendig = { ok: true, aktiv: true, konsistent: false, fragenWarnungen: [{ text: "Andere Meldung" }] };
  const vollstaendig = { ...alsFrage(["Andere Meldung", meldung]), konsistent: true, aufgeklappt: [] };
  const nachKlick = { ...alsFrage(["Andere Meldung", meldung]), konsistent: true, aufgeklappt: [meldung] };
  const { execute, calls } = scriptedExecutor([
    ["checker_results", unvollstaendig],
    ["checker_reset", { ok: true }],
    ["checker_results", vollstaendig],
    ["click_point", { ok: true }],
    ["checker_results", nachKlick],
    ["checker_detail", { ok: true, meldung, text: "Volltext der Meldung." }],
  ]);
  const result = await executeCheckerOpen({ name: meldung }, 300_000, undefined, execute);
  assert.equal(result.ok, true, "Meldung haette nach checker_reset gefunden werden muessen.");
  assert.equal(result.text, "Volltext der Meldung.");
  assert(calls.includes("checker_reset"), "checker_reset muss beim unvollstaendigen Baum ausgeloest werden.");
}

// --- Fall 2: Auch nach checker_reset fehlt die Meldung -> ehrlicher Fehler.
{
  const unvollstaendig = { ok: true, aktiv: true, konsistent: false, fragenWarnungen: [{ text: "Andere Meldung" }] };
  const { execute, calls } = scriptedExecutor([
    ["checker_results", unvollstaendig],
    ["checker_reset", { ok: true }],
    ["checker_results", { ok: true, aktiv: true, konsistent: false, fragenWarnungen: [{ text: "Andere Meldung" }] }],
  ]);
  const result = await executeCheckerOpen({ name: meldung }, 300_000, undefined, execute);
  assert.equal(result.ok, false, "Fehlende Meldung darf nicht als Erfolg gemeldet werden.");
  assert.equal(result.kind, "checker-incomplete");
  assert.equal(calls.filter((c) => c === "checker_reset").length, 1, "Genau ein Reset-Versuch, kein Endlosschleifen.");
}

// --- Fall 3: Vollstaendiger Baum, Meldung direkt sichtbar -> kein Reset noetig.
{
  const vollstaendig = { ...alsFrage([meldung]), konsistent: true, aufgeklappt: [meldung] };
  const { execute, calls } = scriptedExecutor([
    ["checker_results", vollstaendig],
    ["checker_results", vollstaendig],
    ["checker_detail", { ok: true, meldung, text: "Direkt gelesen." }],
  ]);
  const result = await executeCheckerOpen({ name: meldung }, 300_000, undefined, execute);
  assert.equal(result.ok, true);
  assert.equal(result.text, "Direkt gelesen.");
  assert(!calls.includes("checker_reset"), "Bei vollstaendigem Baum darf kein Reset erfolgen.");
}

process.stdout.write("checker_open: Erholungspfad bei unvollstaendigem Baum bestanden\n");
