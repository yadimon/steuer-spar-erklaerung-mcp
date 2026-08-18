import assert from "node:assert/strict";

const fullText = (result) => result?.content?.filter((part) => part.type === "text")
  .map((part) => part.text).join("\n") ?? "";
const parse = (result, step) => {
  try { return JSON.parse(fullText(result)); }
  catch { throw new Error(`${step}: Antwort war kein JSON: ${fullText(result)}`); }
};

/**
 * Steuert eine Seite an, ohne das Fenster je nach vorn zu holen.
 *
 * sse_goto ist bewusst fokusfrei: es blaettert ueber Invoke auf 'Weiter' und
 * 'Zurück'. Qt kann diesen Weg jederzeit mit dem automatischen Pruefhinweis
 * "Die Prüfung hat ergeben ..." unterbrechen. Der Hinweis wird hier erst
 * gelesen und dann streng an UIA-Fingerprint UND OCR-Fliesstext gebunden
 * weggeklickt - nie blind bestaetigt und nie mehrfach zugleich.
 *
 * Die Schleife lag frueher nur in test/hidden-wm-char-transaction.mjs. Jeder
 * andere Live-Test, der navigieren wollte, brach am ersten Pruefhinweis ab.
 */
export async function gotoPageFocusless(client, heading, { hwnd, maxSteps = 60, rounds = 4 } = {}) {
  for (let round = 0; round < rounds; round++) {
    const attempt = await client.callTool(
      { name: "sse_goto", arguments: { name: heading, useSearch: false, maxSteps, direction: "Weiter", hwnd } },
      undefined,
      { timeout: 300_000, maxTotalTimeout: 300_000 },
    );
    if (!attempt?.isError) {
      const reached = parse(attempt, "sse_goto");
      assert.equal(reached.erreicht, true, `Seite '${heading}' wurde nicht erreicht: ${JSON.stringify(reached)}`);
      assert.equal(reached.ueberschrift, heading, `Falsche Seite erreicht: ${JSON.stringify(reached)}`);
      return reached;
    }

    const failure = parse(attempt, "sse_goto");
    assert.equal(failure.kind, "warning-dialog",
      `Navigation zu '${heading}' scheiterte ohne beantwortbaren Pruefhinweis: ${JSON.stringify(failure)}`);
    const warningWindows = failure.warnfenster ?? [];
    assert.equal(warningWindows.length, 1,
      `Mehrdeutige Pruefhinweise; nichts beantwortet: ${JSON.stringify(warningWindows)}`);

    const popupResult = await client.callTool(
      { name: "sse_warning_popup_read", arguments: { hwnd: warningWindows[0].hwnd, ocr: true } },
      undefined,
      { timeout: 120_000, maxTotalTimeout: 120_000 },
    );
    assert.notEqual(popupResult?.isError, true, `Pruefhinweis nicht lesbar: ${fullText(popupResult)}`);
    const popup = parse(popupResult, "sse_warning_popup_read");
    assert.equal(popup.ocrOk, true, `Pruefhinweis war nicht vollstaendig lesbar: ${JSON.stringify(popup)}`);
    assert(popup.bodyFingerprint, "Pruefhinweis lieferte keinen bodyFingerprint.");
    assert(popup.actions?.includes("Jetzt ignorieren"),
      `Erwartete passive Aktion fehlt: ${JSON.stringify(popup.actions)}`);

    const answeredResult = await client.callTool(
      {
        name: "sse_dialog_answer",
        arguments: {
          hwnd: warningWindows[0].hwnd,
          fingerprint: popup.fingerprint,
          bodyFingerprint: popup.bodyFingerprint,
          button: "Jetzt ignorieren",
        },
      },
      undefined,
      { timeout: 120_000, maxTotalTimeout: 120_000 },
    );
    assert.notEqual(answeredResult?.isError, true, `Pruefhinweis nicht beantwortbar: ${fullText(answeredResult)}`);
    const answered = parse(answeredResult, "sse_dialog_answer");
    assert.equal(answered.closed, true, `Pruefhinweis wurde nicht geschlossen: ${JSON.stringify(answered)}`);
    assert.equal(answered.ungespeichertNachher, answered.ungespeichertVorher,
      `Das Wegklicken des Pruefhinweises veraenderte den Speicherzustand: ${JSON.stringify(answered)}`);
  }
  throw new Error(`Seite '${heading}' war in ${rounds} gebundenen Runden fokusfrei nicht erreichbar.`);
}
