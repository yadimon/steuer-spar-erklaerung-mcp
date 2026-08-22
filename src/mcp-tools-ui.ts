/**
 * Generische, gebundene UI-Lese-, Navigations-, Tabellen- und Menuewerkzeuge.
 */
import { asArray } from "./api-client.js";
import { apiErrorResult, apiSuccessResult, type Content } from "./mcp-response.js";
import { apiResultOutputSchema, type McpRegistry } from "./mcp-registry.js";
import { SSE_MCP_TOOL_SCHEMAS } from "./operation-catalog.js";

export function registerUiTools(registry: McpRegistry): void {
  const {
    callApiOperation,
    caughtErrorResult,
    registerApiTool,
    registerShapedApiTool,
    registerStrictTool,
    run,
  } = registry;

  registerApiTool(
    "sse_tree_top",
    {
      title: "Navigationsbaum nach oben rollen",
      description:
        "Rollt den virtualisierten Qt-Navigationsbaum per sicher positioniertem Mausrad an den Anfang. " +
        "Noetig, weil der Baum kein UIA-ScrollPattern anbietet und weiter oben liegende Knoten sonst nicht " +
        "adressierbar sind. Aktiviert keinen Knoten und aendert keine Steuerdaten. Holt das Fenster kurz nach vorn.",
    },
  );

  registerApiTool(
    "sse_tree_scroll",
    {
      title: "Navigationsbaum kontrolliert rollen",
      description:
        "Rollt den virtualisierten Qt-Navigationsbaum nach oben oder unten, ohne einen Knoten zu aktivieren. " +
        "Noetig fuer weiter unten liegende Bereiche, die nach sse_tree_top noch nicht im UIA-Baum existieren. " +
        "Der Mausradpunkt wird gegen SSE-PID und exaktes Hauptfenster-Root verifiziert; danach mit sse_click_point den exakt gelesenen " +
        "TreeItem anklicken. Holt das Fenster kurz nach vorn.",
    },
  );

  registerStrictTool(
    "sse_goto",
    {
      title: "Seite ansteuern",
      description:
        "Navigiert zu einer Eingabeseite ueber deren Ueberschrift. Versucht zuerst die globale Suche " +
        "und blaettert danach mit den fokusfreien UIA-Schaltflaechen 'Weiter'/'Zurueck'. " +
        "Qt-Suchtreffer lassen sich auf einem versteckten Windows-Desktop zwar lesen, aber je nach " +
        "Programmseite nicht aktivieren; dann faellt das Werkzeug auf den Blaetterpfad zurueck. Bei " +
        "einem blockierenden Pruefhinweis stoppt es nach dem ersten Klick, statt Warnfenster zu stapeln, und " +
        "meldet den vollstaendigen Weg statt einen Scheinerfolg. Fuer einen rein linearen Lauf kann " +
        "useSearch=false gesetzt werden. Ein Navigationsbaum-Klick braucht den sichtbaren Desktop. " +
        "'Gewinnermittlung beginnen' bleibt eine bekannte Sackgasse ohne Vor-/Zurueck-Schalter.",
      inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_goto.shape,
      outputSchema: apiResultOutputSchema("goto"),
    },
    async (a) =>
      run(
        "goto",
        { ...a, ziel: a.name, viaSuche: a.useSearch },
        (r) => ({ erreicht: r.erreicht, ueberschrift: r.ueberschrift, schritte: r.schritte, weg: asArray(r.weg), hinweis: r.hinweis }),
        300_000,
      ),
  );

  registerShapedApiTool(
    "sse_table_read",
    {
      title: "Tabelle vollstaendig lesen",
      description:
        "Liest eine Eingabetabelle VOLLSTAENDIG - im Gegensatz zu sse_read_table, das nur die sichtbaren " +
        "Zeilen liefert. Qt virtualisiert Tabellen: nur was auf dem Schirm ist, steht im Elementbaum, " +
        "es gibt keinen scrollbaren Container und Bild-ab wirkt nicht. Dieses Werkzeug klickt in die " +
        "Tabelle, springt zuerst an den Tabellenanfang und wandert mit der Pfeiltaste durch die Zeilen, bis nichts Neues mehr kommt. " +
        "Auf Seiten mit mehreren Eingabetabellen binden sumLabel und sumOccurrence den Lauf an genau die " +
        "zugehoerige Summenregion; ohne diese Bindung wird nichts fokussiert und vollstaendig=false gemeldet. " +
        "Nicht-modale Werte-Info-Tabellen werden aus dem Eingabeformular ausgeschlossen. " +
        "ACHTUNG: holt das Fenster dafuer kurz nach vorn. " +
        "Das Feld 'vollstaendig' sagt, ob das gelungen ist. Immer gegen die Summenzeile der Seite pruefen.",
    },
    (r) => ({
      kopf: asArray(r.kopf),
      anzahl: r.anzahl,
      vollstaendig: r.vollstaendig,
      schritte: r.schritte,
      steps: r.steps,
      stopKind: r.stopKind,
      limitReached: r.limitReached,
      tabelleAnzahl: r.tabelleAnzahl,
      bindung: r.bindung,
      ungespeichertVorher: r.ungespeichertVorher,
      ungespeichertNachher: r.ungespeichertNachher,
      ungespeichertEingefuehrt: r.ungespeichertEingefuehrt,
      hinweis: r.hinweis,
      zeilen: asArray(r.zeilen),
      // Ohne die gelesene Kontrollsumme koennte ein Aufrufer die
      // Pflichtangabe expectedBefore der Tabellenmutationen nur raten.
      summe: r.summe,
    }),
    { timeoutMs: 300_000 },
  );

  registerApiTool(
    "sse_table_add",
    {
      title: "Tabellenzeile anlegen",
      description:
        "Legt eine neue Tabellenzeile als gepruefte Transaktion an. Exakte Seite sowie Seitensumme vor und " +
        "nach der Aktion sind Pflicht. Die freie Zielzeile wird geometrisch an genau diese Summenzeile und " +
        "die davorliegende Summengrenze gebunden; auf Seiten mit mehreren Tabellen kann daher nicht die " +
        "Leerzeile eines anderen Abschnitts gewaehlt werden. Profilierte ComboBoxen binden Seite, Summenregion und Spalte. " +
        "Auch als UIA-DataItem wird nur per InvokePattern und exakt popupgebundenem SelectionItem gewaehlt. " +
        "comboExpectedBefore ist Pflicht; interner, visueller und Pruefer-Readback laufen vor den Textzellen. " +
        "Sichtbarer ValuePattern-Text allein ist nie ein Commit-Beweis. Textzellen werden rueckgelesen; Nachsumme und " +
        "seitenweite neue Pruefermeldungen bilden gemeinsam den Kontrollvertrag. Bei einer normalen Nachbedingungsabweichung " +
        "werden alle eigenen Zellwerte rueckwaerts wiederhergestellt und die Ausgangssumme bestaetigt. " +
        "Bei fremder Eingabe oder veraenderter Fensterlage gibt es keinen blinden Rollback, sondern einen " +
        "strukturierten Interference-Stopp. " +
        "Ist die Leerzeile virtualisiert, wird sie vom Tabellenende aus rein navigierend gesucht. " +
        "'werte' ist eine Liste in SPALTENREIHENFOLGE (meist: Nr., Datum, Bezeichnung, ..., Betrag); " +
        "leere Eintraege werden uebersprungen. " +
        "AENDERT STEUERDATEN: vorher sse_backup_cases. Betraege deutsch mit Komma ('2.340,00').",
    },
    { timeoutMs: 300_000 },
  );

  registerApiTool(
    "sse_table_update",
    {
      title: "Sichtbare Tabellenzeile sicher aktualisieren",
      description:
        "Aktualisiert eine eindeutig ueber einen vorhandenen Zelltext gefundene, sichtbare Tabellenzeile " +
        "ueber Qt-ValuePattern sowie fuer boolesche Tabellenzellen ueber TogglePattern und funktioniert " +
        "deshalb auch auf dem versteckten Desktop. " +
        "'werte' folgt der sichtbaren Spaltenreihenfolge; null laesst eine Spalte unveraendert, ein leerer " +
        "String leert sie und 'true'/'false' setzt eine echte Toggle-Zelle. Exakte Seite sowie Seitensumme " +
        "vorher und nachher sind Pflicht; im jeweiligen Produktprofil an Seite, Summenregion und Spalte gebundene " +
        "Tabellen-ComboBoxen werden auch bei UIA-ControlType DataItem per InvokePattern und exakt popupgebundenem " +
        "SelectionItemPattern gesetzt. comboExpectedBefore bindet den internen Vorwert; sichtbarer Text allein beweist " +
        "keinen Qt-Enum. Interner, visueller und Pruefer-Readback muessen vor den uebrigen Zellen bestehen. " +
        "Neue seitenweite Pruefermeldungen gelten ebenfalls als " +
        "Nachbedingungsfehler und muessen beim Rollback verschwinden. Die Zielzeile " +
        "wird auf die zu dieser Summe gehoerende Tabellenregion begrenzt. Bei einer normalen Abweichung " +
        "setzt das Werkzeug alle eigenen Zellwerte transaktional zurueck. Fremde Eingabe, ein fremder " +
        "Zellwert oder eine veraenderte Fenster-/Seitenlage stoppt ohne blinden Rollback. " +
        "AENDERT STEUERDATEN: vorher sse_backup_cases, danach sse_page/sse_check_page und hashgebunden speichern.",
    },
    { timeoutMs: 300_000 },
  );

  registerApiTool(
    "sse_table_delete",
    {
      title: "Tabellenzeile loeschen",
      description:
        "Loescht genau eine Tabellenzeile. Aus Sicherheitsgruenden sind eine eindeutige Zielzelle sowie " +
        "die exakte Seite und erwartete Seitensumme vor und nach der Loeschung Pflicht. Zielsuche und " +
        "Navigation bleiben geometrisch auf die angegebene Summenregion begrenzt. Vor dem Loeschen wird eine alte " +
        "Mehrfachauswahl exklusiv auf die Zielzeile reduziert und geprueft. Virtualisierte, aktuell nicht " +
        "sichtbare Zeilen werden vom Tabellenanfang aus rein navigierend gesucht. Weicht die Nachsumme ab, " +
        "wird nur ohne fremde Eingabe/Fensterwechsel Strg+Z ausgefuehrt und die Wiederherstellung kontrolliert; " +
        "nach Interferenz bleibt der Zustand zur bewussten Neusynchronisierung unangetastet. Ein verdeckter " +
        "Zielpunkt bricht vor der Mutation ab und meldet den Blockierer als lockscreen-shell, foreign-app oder " +
        "other-sse-window. " +
        "AENDERT STEUERDATEN: vorher sse_backup_cases. Holt das Fenster kurz nach vorn.",
    },
    { timeoutMs: 300_000 },
  );

  registerShapedApiTool(
    "sse_menu",
    {
      title: "Menue oeffnen und lesen",
      description:
        "Ohne name: listet die Menuezeile (Datei, Bearbeiten, Ansicht, Extras, Musterbriefe, Service, ?). " +
        "Mit name: oeffnet das Menue und liefert seine Eintraege samt Aktivierungszustand und " +
        "Sperrkennzeichen. Ueber die Menuezeile erreicht man Optionen, Datenuebernahme, Steuerrechner " +
        "und Druckfunktionen - sonst waeren sie unerreichbar. " +
        "Menues mit Uebermittlungsbezug sind gesperrt. Sicher schliessen mit sse_menu_close.",
    },
    (r) => ({ menue: r.menue, menues: asArray(r.menues), eintraege: asArray(r.eintraege), hinweis: r.hinweis }),
  );

  registerApiTool(
    "sse_menu_click",
    {
      title: "Menueeintrag ausloesen",
      description:
        "Loest einen zuvor mit sse_menu ermittelten Menueeintrag aus. Eintraege, die zu einer " +
        "Uebermittlung fuehren koennten, sind gesperrt. Lokale Loesch-, Import-, Uebernahme- oder " +
        "Zuruecksetzbefehle verlangen nach dem Readback zusaetzlich acknowledgeDestructive=true; " +
        "Vorher-/Nachher-Dirty-State wird immer gemeldet.",
    },
  );

  registerApiTool(
    "sse_menu_close",
    {
      title: "Menue sicher schliessen",
      description:
        "Schliesst ein offenes Menue ueber dessen ExpandCollapsePattern und prueft, dass keine Popup-/Schattenfenster " +
        "mehr vorhanden sind. Verwendet weder Escape noch andere Tastendruecke und funktioniert daher auch als " +
        "sicherer Abschluss eines reinen Menue-Lesevorgangs.",
    },
  );

  registerShapedApiTool(
    "sse_ui_state",
    {
      title: "Lagebeurteilung",
      description:
        "Schneller, konsistenter Read-only-Snapshot fuer die laufende SSE-Instanz. Ein Aufruf liefert " +
        "PID/HWND, Seite, Dirty-State, fingerprintgebundene Dialoge, Seitenpruefer, globalen Pruefer, " +
        "Warnfenster und - wenn Werte-Info bereits offen ist - die Ergebnis-/Was-waere-wenn-Werte. " +
        "Unbekannte oder nicht lesbare SSE-Fenster setzen blockiert=true und erscheinen unter " +
        "unsichereFenster; sie werden niemals als harmlose Helfer behandelt. " +
        "stateFingerprint bindet die Beobachtung an genau diesen Zustand; beim Folgeaufruf kann er als " +
        "previousFingerprint uebergeben werden, dann zeigt changedSince eine zwischenzeitliche Aenderung. " +
        "IMMER aufrufen, wenn 'Weiter' wirkungslos bleibt oder eine Seite sich seltsam verhaelt. " +
        "Hintergrund: Das Programm SPERRT das Blaettern, solange ein Pflichtfeld leer ist - der Klick " +
        "gelingt, die Seite bleibt stehen, und jeder weitere Versuch oeffnet ein Warnfenster. Ohne dieses " +
        "Werkzeug sieht ein Agent nur, dass nichts passiert, und klickt endlos weiter.",
    },
    (r) => ({
      running: r.running,
      instance: r.instance,
      stateFingerprint: r.stateFingerprint,
      changedSince: r.changedSince,
      heading: r.heading,
      blockiert: r.blockiert,
      rat: r.rat,
      prueferMeldungen: asArray(r.prueferMeldungen),
      baumFehler: asArray(r.baumFehler),
      leerePflichtfelder: asArray(r.leerePflichtfelder),
      steuerpruefer: r.steuerpruefer,
      ungespeichert: r.ungespeichert,
      ergebnis: r.ergebnis,
      dialoge: asArray(r.dialoge),
      unsichereFenster: asArray(r.unsichereFenster),
      warnfensterAnzahl: r.warnfensterAnzahl,
      nichtmodaleFenster: asArray(r.nichtmodaleFenster),
      snapshot: r.snapshot,
      workerMs: r.ms,
    }),
    { timeoutMs: 180_000 },
  );

  registerApiTool(
    "sse_dismiss",
    {
      title: "Warnfenster schliessen",
      description:
        "Schliesst nur bekannte kompakte, nicht-modale Fenster: Steuer-Spar-Tipps, Werte-Info und " +
        "Schatten-Popups. Echte Dialoge, automatische Pruefhinweise, unbekannte oder nicht lesbare " +
        "Fenster werden BEWUSST NICHT angetastet und strukturiert unter stehenGelassen gemeldet. " +
        "Pruefhinweise zuerst mit sse_warning_popup_read lesen und fingerprintgebunden beantworten.",
    },
    { timeoutMs: 120_000 },
  );

  registerStrictTool(
    "sse_screenshot",
    {
      title: "Bildschirmfoto",
      description:
        "Fotografiert das Fenster (PrintWindow). Funktioniert auch, wenn das Fenster NICHT im Vordergrund " +
        "ist, und ist das zuverlaessigste Werkzeug ueberhaupt. Bei jedem Zweifel ueber den Programmzustand " +
        "zuerst hierher greifen.",
      inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_screenshot.shape,
      outputSchema: apiResultOutputSchema("screenshot"),
    },
    async (a) => {
      try {
        const r = await callApiOperation("screenshot", a);
        if (r.ok === false) return apiErrorResult("screenshot", r);
        const shot = r.shot;
        if (
          !shot ||
          typeof shot !== "object" ||
          Array.isArray(shot) ||
          typeof (shot as Record<string, unknown>).path !== "string" ||
          typeof (shot as Record<string, unknown>).w !== "number" ||
          !Number.isFinite((shot as Record<string, unknown>).w) ||
          typeof (shot as Record<string, unknown>).h !== "number" ||
          !Number.isFinite((shot as Record<string, unknown>).h)
        ) {
          return apiErrorResult("screenshot", {
            ok: false,
            kind: "protocol",
            error: "SSE-API lieferte ungueltige Kontrollbild-Metadaten.",
          });
        }
        const typedShot = shot as { path: string; w: number; h: number; };
        const extra: Content[] = [];
        const imageBase64 = String(r.imageBase64 ?? "");
        const validPngBase64 = imageBase64.startsWith("iVBORw0KGgo");
        if (a.includeImage && validPngBase64) {
          extra.push({
            type: "image",
            data: imageBase64,
            mimeType: "image/png",
          });
        }
        return apiSuccessResult({
          ref: typedShot.path,
          width: typedShot.w,
          height: typedShot.h,
          imageAttached: extra.length === 1,
          ...(typeof r.imageReadError === "string" ? { imageReadError: r.imageReadError } : {}),
          ...(a.includeImage && imageBase64 && !validPngBase64
            ? { imageReadError: "API-Bildinhalt hatte keine gueltige PNG-Signatur und wurde verworfen." }
            : {}),
        }, r, extra);
      } catch (e) {
        return caughtErrorResult("screenshot", e);
      }
    },
  );

  registerShapedApiTool(
    "sse_read_page",
    {
      title: "Seite lesen",
      description:
        "Liest die aktuell angezeigte Eingabeseite als Zeilen 'Beschriftung = Wert'. Betraege stehen NICHT " +
        "im Namen eines Feldes, sondern im ValuePattern - dieses Werkzeug holt beides und fuehrt es zusammen. " +
        "Die Spaltengrenzen des Arbeitsbereichs werden aus der Fensterbreite berechnet, funktioniert also " +
        "bei jeder Fenstergroesse. Das Hauptwerkzeug zum Auslesen von Steuerdaten.",
    },
    (r) => ({
      heading: r.heading,
      lines: asArray<{ y: number; cells: string[]; }>(r.lines).map((l) => l.cells.join("  ::  ")),
      stats: r.stats,
    }),
  );

  registerShapedApiTool(
    "sse_read_table",
    {
      title: "Tabelle lesen",
      description:
        "Liest die Eingabetabelle der aktuellen Seite (z. B. Einnahmenliste) als Kopfzeile und Datenzeilen. " +
        "ACHTUNG: nur die sichtbaren Zeilen. Sind mehr Zeilen vorhanden als angezeigt, vorher sse_scroll " +
        "benutzen und erneut lesen.",
    },
    (r) => ({
      headers: asArray(r.headers),
      rowCount: r.rowCount,
      rows: asArray(r.rows),
      ausgeschlosseneFenster: asArray(r.ausgeschlosseneFenster),
    }),
  );

  registerShapedApiTool(
    "sse_snapshot",
    {
      title: "Elementbaum",
      description:
        "Vollstaendiger Elementbaum des Fensters (schneller UIA-Bulk-Cache mit explizitem TreeWalker-Fallback). Fuer Fehlersuche und um " +
        "unbekannte Bedienelemente zu finden. Umfangreich - fuer normales Auslesen ist sse_read_page besser.",
    },
    (r) => ({ count: r.count, stats: r.stats, nodes: asArray(r.nodes) }),
  );

  registerApiTool(
    "sse_snapshot_compare",
    {
      title: "Bulk-Snapshot gegen sicheren Altpfad vergleichen",
      description:
        "Read-only A/B-Diagnose: liest denselben SSE-Zustand einmal mit dem zyklusgeschuetzten TreeWalker " +
        "und einmal mit dem schnellen UIA-Bulk-Cache. Vergleicht Struktur und Feldwerte, gibt aber keine " +
        "privaten Namen oder Werte aus. Dient zur sicheren Freigabe neuer Seiten/Qt-Zustaende.",
    },
    { timeoutMs: 120_000 },
  );

  registerShapedApiTool(
    "sse_accessibility_probe",
    {
      title: "Qt-Accessibility eines Elements untersuchen",
      description:
        "Rein lesende Tiefenpruefung fuer ein exakt adressiertes UI-Element. Untersucht UIA-Muster, " +
        "RawView-Nachfahren und ueberlappende MSAA-Knoten. Damit laesst sich belegen, ob ein Qt-Inhalt " +
        "strukturiert lesbar ist oder OCR als Rueckfall noetig bleibt. Bei Mehrdeutigkeit rid aus " +
        "sse_snapshot verwenden.",
    },
    (r) => ({
      hwnd: r.hwnd,
      node: r.node,
      uia: r.uia,
      rawDescendants: asArray(r.rawDescendants),
      rawTruncated: r.rawTruncated,
      msaaOverlaps: asArray(r.msaaOverlaps),
      textCandidates: asArray(r.textCandidates),
      fazit: r.fazit,
    }),
  );

  registerShapedApiTool(
    "sse_find",
    {
      title: "Element suchen",
      description:
        "Sucht Bedienelemente nach Beschriftung. Liefert Typ, Lage und Zustand. " +
        "WICHTIG: Ein leeres Ergebnis ist bei diesem Programm kein Beweis fuer Abwesenheit - bei " +
        "ueberlastetem UIA liefert es faelschlich nichts. Im Zweifel sse_health.",
    },
    (r) => ({ count: r.count, hits: asArray(r.hits), incomplete: r.incomplete }),
  );

  registerApiTool(
    "sse_get_value",
    {
      title: "Feldwert lesen",
      description:
        "Liest den Inhalt genau eines Eingabefeldes samt Schreibschutz-Kennzeichen. " +
        "Mehrdeutige Selektoren werden abgewiesen; fuer unbeschriftete Felder aid oder rid verwenden.",
    },
  );
}
