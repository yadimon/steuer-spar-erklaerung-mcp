/**
 * Fachliche Lese-, Pruef- und Steuerpruefer-Werkzeuge.
 */
import { asArray } from "./api-client.js";
import { apiErrorResult, apiSuccessResult, type Content } from "./mcp-response.js";
import { apiResultOutputSchema, type McpRegistry } from "./mcp-registry.js";
import { SSE_MCP_TOOL_SCHEMAS } from "./operation-catalog.js";

export function registerAnalysisTools(registry: McpRegistry): void {
  const {
    callApiOperation,
    caughtErrorResult,
    registerApiTool,
    registerShapedApiTool,
    registerStrictTool,
  } = registry;

  /* ----------------------------------------------------------------- Lesen */

  registerShapedApiTool(
    "sse_read_full",
    {
      title: "Seite vollstaendig lesen (mit Rollen)",
      description:
        "Liest eine LANGE Seite vollstaendig: rollt den Inhaltsbereich stufenweise durch und fuegt die " +
        "Ergebnisse zusammen. Noetig, weil Qt nur den sichtbaren Ausschnitt im Elementbaum haelt - " +
        "sse_page liefert bei langen Seiten (z. B. 'Umsatzsteuererklaerung 2025') stillschweigend zu " +
        "wenig. Rollt danach wieder nach oben. Braucht weder Tastatur noch Maus, laeuft also auch auf " +
        "dem versteckten Desktop.",
    },
    (r) => ({ ueberschrift: r.ueberschrift, gerollt: r.gerollt, stufen: r.stufen, anzahl: r.anzahl, zeilen: asArray(r.zeilen), hinweis: r.hinweis }),
    { timeoutMs: 240_000 },
  );

  registerApiTool(
    "sse_scroll_page",
    {
      title: "Inhaltsbereich rollen",
      description:
        "Rollt den Inhaltsbereich der Seite (nicht Tabellen - dafuer sse_table_read). " +
        "mode='info' meldet nur Position und sichtbaren Anteil, 'percent' setzt die Position (vPercent), " +
        "'amount' rollt seitenweise (direction up/down). Danach sse_page erneut aufrufen - erst dann " +
        "stehen die neu sichtbaren Felder im Baum. Fuer den Normalfall ist sse_read_full bequemer.",
    },
  );

  registerShapedApiTool(
    "sse_help",
    {
      title: "Hilfespalte lesen",
      description:
        "Liest die rechte Spalte: Eingabehilfe, Steuertipps und Prueferhinweise zur aktuellen Seite. " +
        "Dort steht, WIE ein Feld gemeint ist und welche Betraege hineingehoeren - fuer korrektes " +
        "Ausfuellen oft wichtiger als die Feldbeschriftung. Der Inhalt wechselt mit dem angewaehlten " +
        "Feld. Braucht weder Tastatur noch Maus. " +
        "Die Abschnitte kommen getrennt: Eingabehilfe, Steuertipps, Pruefer, Steuer-Spar-Tipps, jeweils " +
        "mit text, zeilen und verweise. Die verweise sind programminterne Links des Herstellers; sie " +
        "lassen sich ueber diese API nicht oeffnen, weil sie in einem Nebenfenster landen. Als " +
        "Rechtsquelle taugt der Inhalt ohnehin nicht - er gibt die Herstellerauffassung fuer dieses " +
        "Produktjahr wieder.",
    },
    (r) => ({ seite: r.seite, abschnitte: r.abschnitte, hinweis: r.hinweis }),
  );

  registerShapedApiTool(
    "sse_subpages",
    {
      title: "Unterseiten auflisten",
      description:
        "Listet die weiterfuehrenden Schalter der Seite ('Erfassen', 'Bearbeiten', 'Position erfassen' ...) " +
        "samt der Beschriftung links davon - also wozu jeder fuehrt. Ueber diese Verweise liegen die " +
        "Detailangaben, die auf der Uebersichtsseite nur als Summe erscheinen. Erkennt auch die offizielle " +
        "Qt-Zeilenstruktur aus Caption, read-only Wert und unbeschriftetem Button und liefert dafuer rid/aid; " +
        "es werden keine privaten Seiten- oder Gegenstandsnamen katalogisiert. Schalter vom Typ Button sind " +
        "mit sse_click erreichbar (auch versteckt), Verweise brauchen " +
        "sse_click_point und damit den sichtbaren Modus.",
    },
    (r) => ({ anzahl: r.anzahl, unterseiten: asArray(r.unterseiten), hinweis: r.hinweis }),
  );

  registerShapedApiTool(
    "sse_check_page",
    {
      title: "Seite pruefen",
      description:
        "Prueferlage der aktuellen Seite: Meldungen des Eingabepruefers, rot markierte Fehler im " +
        "Navigationsbaum, leere Pflicht-Auswahlfelder und der angezeigte Ergebniswert (Gewinn bzw. " +
        "Erstattung). ok ist nur true, wenn nichts beanstandet wird. " +
        "Nach JEDER Aenderung aufrufen - das Programm prueft fachlich mit und meldet z. B. fehlende " +
        "Begruendungen, die sonst erst beim Abgabeversuch auffallen.",
    },
    (r) => ({
      beanstandungsfrei: r.beanstandungsfrei,
      seite: r.seite,
      urteil: r.urteil,
      prueferMeldungen: asArray(r.prueferMeldungen),
      baumFehler: asArray(r.baumFehler),
      leerePflichtfelder: asArray(r.leerePflichtfelder),
      ergebnisAnzeige: r.ergebnisAnzeige,
      steuerpruefer: r.steuerpruefer,
    }),
    { timeoutMs: 180_000 },
  );

  registerShapedApiTool(
    "sse_result_details",
    {
      title: "Steuerergebnis und Auswirkungen lesen",
      description:
        "Liest die ausklappbare Ergebnisanzeige rechts unten als strukturierte Qt-Tabelle: " +
        "Nachzahlung/Erstattung, Einkuenfte, Vorsorgeaufwendungen, Steuer, Soli, Steuersatz und " +
        "weitere konfigurierte Werte. Oeffnet bei Bedarf nur das nicht-modale Werte-Info-Fenster; " +
        "Steuerdaten werden weder geaendert noch gespeichert. 'festgehalten' ist der Vergleichsstand, " +
        "'differenz' die Auswirkung gegen diesen Stand. Fuer die Wirkung einer Eingabe vor und nach " +
        "der Aenderung lesen oder in Werte-Info bewusst einen Vergleichsstand setzen. Bei mehreren " +
        "mehreren Hauptfenstern des aktiven SSE-Profils ist hwnd Pflicht; Ergebnisfenster anderer PIDs werden nie uebernommen.",
    },
    (r) => ({
      geoeffnet: r.geoeffnet,
      fenster: r.fenster,
      spalten: r.spalten,
      anzahl: r.anzahl,
      vollstaendig: r.vollstaendig,
      fingerprint: r.fingerprint,
      zeilen: asArray(r.zeilen),
      unvollstaendigeZeilen: asArray(r.unvollstaendigeZeilen),
      nichtPositionierteZellenAnzahl: r.nichtPositionierteZellenAnzahl,
      kopfVollstaendig: r.kopfVollstaendig,
      vergleichsInvariantGeprueft: r.vergleichsInvariantGeprueft,
      vergleichsInvariantFehler: asArray(r.vergleichsInvariantFehler),
      vertikalUnvollstaendig: r.vertikalUnvollstaendig,
      hinweis: r.hinweis,
    }),
  );

  registerShapedApiTool(
    "sse_checker_results",
    {
      title: "Globale Steuerpruefer-Ergebnisse lesen",
      description:
        "Liest den aktuell sicher per UIA erreichbaren Ergebnisbaum des globalen Steuerpruefers " +
        "ohne Serienklicks oder Tastaturnavigation. 'konsistent' ist nur dann wahr, wenn beide " +
        "angezeigten Gruppenzaehler vollstaendig erreicht wurden. Bei false per sse_screenshot " +
        "manuell kontrollieren; die Komfortautomatik fuer Qts zyklischen Baum ist Backlog.",
    },
    (r) => ({
      aktiv: r.aktiv,
      fragenWarnungenAngekuendigt: r.fragenWarnungenAngekuendigt,
      tippsAngekuendigt: r.tippsAngekuendigt,
      fragenWarnungenGruppeGesehen: r.fragenWarnungenGruppeGesehen,
      tippsGruppeGesehen: r.tippsGruppeGesehen,
      fragenWarnungen: asArray(r.fragenWarnungen),
      tippsZusatzinfos: asArray(r.tippsZusatzinfos),
      sonstige: asArray(r.sonstige),
      gesamt: r.gesamt,
      aufgeklappt: r.aufgeklappt,
      konsistent: r.konsistent,
      navigationSchritte: r.navigationSchritte,
      fokusVerwendet: r.fokusVerwendet,
      technischeFokusKarten: asArray(r.technischeFokusKarten),
      ungespeichert: r.ungespeichert,
      hinweis: r.hinweis,
    }),
    { timeoutMs: 180_000 },
  );

  registerShapedApiTool(
    "sse_checker_run",
    {
      title: "Globalen Steuerpruefer starten",
      description:
        "Startet auf der Seite 'Steuererklaerung pruefen' den fallweiten Software-Pruefer und " +
        "liefert die sicher erreichbaren Fragen/Warnungen und Tipps samt Konsistenzstatus. " +
        "Loest weder 'Steuererklaerung abschliessen' noch ELSTER oder eine andere Abgabe aus. " +
        "Falls die Seite noch nicht offen ist, per MCP zu 'Pruefen und Abgeben' und danach " +
        "'Steuererklaerung pruefen' navigieren.",
    },
    (r) => ({
      gestartet: r.gestartet,
      bereitsAktiv: r.bereitsAktiv,
      fragenWarnungenAngekuendigt: r.fragenWarnungenAngekuendigt,
      tippsAngekuendigt: r.tippsAngekuendigt,
      fragenWarnungen: asArray(r.fragenWarnungen),
      tippsZusatzinfos: asArray(r.tippsZusatzinfos),
      sonstige: asArray(r.sonstige),
      gesamt: r.gesamt,
      konsistent: r.konsistent,
      navigationSchritte: r.navigationSchritte,
      fokusVerwendet: r.fokusVerwendet,
      technischeFokusKarten: asArray(r.technischeFokusKarten),
      ungespeichertVorher: r.ungespeichertVorher,
      ungespeichertNachher: r.ungespeichertNachher,
      ungespeichertEingefuehrt: r.ungespeichertEingefuehrt,
      hinweis: r.hinweis,
    }),
    { timeoutMs: 240_000 },
  );

  registerShapedApiTool(
    "sse_checker_reset",
    {
      title: "Steuerpruefer-Detailkarten sicher schliessen",
      description:
        "Schliesst alle aufgeklappten Detailkarten im globalen Steuerpruefer von unten nach oben " +
        "mit gezielten Klicks. Es werden keine Steuerangaben geaendert. Ob der anschliessende " +
        "UIA-Snapshot beide Gruppen vollstaendig sieht, steht in 'konsistent'.",
    },
    (r) => ({
      geschlossen: asArray(r.geschlossen),
      anzahlGeschlossen: r.anzahlGeschlossen,
      konsistent: r.konsistent,
      fragenWarnungenAngekuendigt: r.fragenWarnungenAngekuendigt,
      tippsAngekuendigt: r.tippsAngekuendigt,
      fragenWarnungen: asArray(r.fragenWarnungen),
      tippsZusatzinfos: asArray(r.tippsZusatzinfos),
      sonstige: asArray(r.sonstige),
      aufgeklappt: asArray(r.aufgeklappt),
      technischeFokusKarten: asArray(r.technischeFokusKarten),
      ohneOffeneKarten: r.ohneOffeneKarten,
      ungespeichert: r.ungespeichert,
      hinweis: r.hinweis,
    }),
    { timeoutMs: 240_000 },
  );

  registerStrictTool(
    "sse_checker_open",
    {
      title: "Steuerpruefer-Meldung oeffnen und lesen",
      description:
        "Oeffnet genau eine Meldung aus sse_checker_results und liest ihre aufgeklappte " +
        "Detailkarte. MCP prueft zuerst UIA-Muster, RawView und eine begrenzte MSAA-Punktabfrage. " +
        "Nur wenn Qt dort keinen Fliesstext bereitstellt, wird die exakte Kartenflaeche fotografiert, " +
        "lokal mit Windows-OCR gelesen und als Text PLUS Kontrollbild zurueckgegeben. Der exakte " +
        "Meldungstext ist Pflicht.",
      inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_checker_open.shape,
      outputSchema: apiResultOutputSchema("checker_open"),
    },
    async (a) => {
      try {
        const detail = await callApiOperation("checker_open", a, 300_000);
        if (detail.ok === false) return apiErrorResult("checker_open", detail);
        const imageBase64 = String(detail.bildBase64 ?? "");
        const extra: Content[] = [];
        if (imageBase64) {
          extra.push({ type: "image", data: imageBase64, mimeType: "image/png" });
        }
        return apiSuccessResult(
          {
            meldung: detail.meldung,
            leseweg: detail.leseweg,
            strukturiertOk: detail.strukturiertOk,
            strukturQuellen: asArray(detail.strukturQuellen),
            ocrVerwendet: detail.ocrVerwendet,
            ocrOk: detail.ocrOk,
            sprache: detail.sprache,
            zeilen: detail.zeilen,
            text: detail.text,
            ocrFehler: detail.ocrFehler,
            inAnsichtGerollt: detail.inAnsichtGerollt,
            ungespeichert: detail.ungespeichert,
            kontrollbildEnthalten: detail.kontrollbildEnthalten === true,
          },
          detail,
          extra,
        );
      } catch (e) {
        return caughtErrorResult("checker_open", e);
      }
    },
  );

  registerApiTool(
    "sse_checker_close",
    {
      title: "Steuerpruefer-Ergebnisleiste schliessen",
      description:
        "Schliesst genau die linke Ergebnisleiste des globalen Steuerpruefers über ihre offizielle Automation-ID. " +
        "Prueft danach, dass die Leiste verschwunden, die aktuelle Eingabeseite unverändert und kein neuer Dirty-State " +
        "entstanden ist. Bereits geschlossen ist ein erfolgreicher No-op.",
    },
    { timeoutMs: 90_000 },
  );
}
