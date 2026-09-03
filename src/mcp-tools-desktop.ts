/**
 * Werkzeuge fuer den isolierten Desktop sowie Sammeln und Verifizieren.
 */
import { asArray } from "./api-client.js";
import type { McpRegistry } from "./mcp-registry.js";

export function registerDesktopTools(registry: McpRegistry): void {
  const { registerApiTool, registerShapedApiTool } = registry;

  registerShapedApiTool(
    "sse_desktop_start",
    {
      title: "Programm unsichtbar starten",
      description:
        "Startet die SteuerSparErklaerung auf einem EIGENEN, unsichtbaren Windows-Desktop. " +
        "Ausschliesslich das aktive, von der API freigegebene Produktprofil und dazu passende Falldateien werden akzeptiert. " +
        "Das Fenster kann dort auf dem sichtbaren Desktop nicht erscheinen - der Nutzer wird nicht " +
        "mehr unterbrochen, auch nicht beim Blaettern. (Ohne das holt sich das Programm bei JEDEM " +
        "Seitenwechsel selbst den Vordergrund; das ist Verhalten der Anwendung und laesst sich sonst " +
        "nicht abstellen.) " +
        "Danach arbeiten ALLE Werkzeuge automatisch gegen diese Instanz - nichts weiter zu beachten. " +
        "Bei eindeutig geladenem Fall liefert instance zusätzlich das feste PID/HWND für Folgeaktionen; " +
        "ready=false/blockedByDialog=true verlangt zuerst Dialog-Readback. " +
        "ACHTUNG: Der Nutzer kann dann nicht mehr hineinsehen. Bei Unklarheiten sse_screenshot und " +
        "sse_ui_state benutzen und nachfragen, statt blind weiterzuklicken. " +
        "Zum Testen eine KOPIE der Falldatei verwenden, nicht das Original.",
    },
    (r) => ({
      desktop: r.desktop, pid: r.pid, fenster: asArray(r.fenster), instance: r.instance,
      ready: r.ready, blockedByDialog: r.blockedByDialog, dialogWindows: asArray(r.dialogWindows),
      product: r.product, case: r.case, note: r.note,
    }),
    { timeoutMs: 180_000 },
  );

  registerApiTool(
    "sse_desktop_stop",
    {
      title: "Unsichtbare Instanz beenden",
      description:
        "Beendet die Instanz auf dem versteckten Desktop und raeumt ihn auf. " +
        "Speichern gehoert vorher in den hashgebundenen Schritt sse_save; save=true ist hier gesperrt. " +
        "Ohne discardChanges=true wird kein Speicherdialog mit Nein/Verwerfen beantwortet. Der Stop verlangt Markername, " +
        "eigene SSE-PID und deren Fenster auf genau diesem Desktop. Bei unsicherem Dirty-/Dialogzustand " +
        "bleiben Prozess und Marker zur bewussten Klaerung erhalten. Hat die markierte PID kein breites " +
        "Hauptfenster mehr (nur Dialog oder Startbild, etwa nach einem nie gespeicherten Fall), beendet " +
        "discardChanges=true genau diese PID hart und raeumt den Marker ab; ohne discardChanges bleibt sie " +
        "mit confirmation-required erhalten. Das Ergebnis meldet hauptfensterVorher.",
    },
    { timeoutMs: 120_000 },
  );

  registerShapedApiTool(
    "sse_desktop_status",
    {
      title: "Laeuft die Instanz versteckt?",
      description: "Prueft die markierte eigene PID und meldet auch eine veraltete oder unvollstaendige Desktop-Marke.",
    },
    (r) => ({
      aktiv: r.aktiv,
      desktop: r.desktop,
      pid: r.pid,
      sseLaeuft: r.sseLaeuft,
      desktopErreichbar: r.desktopErreichbar,
      markeVeraltet: r.markeVeraltet,
      fenster: asArray(r.fenster),
      note: r.note,
    }),
  );

  registerShapedApiTool(
    "sse_page",
    {
      title: "Seite vollstaendig erfassen",
      description:
        "DAS HAUPTWERKZEUG. Eine Abfrage liefert alles ueber die aktuell offene Seite: Ueberschrift, " +
        "alle beschreibbaren Felder mit Beschriftung, Wert, Typ und Schreibschutz, die Tabelle mit " +
        "Kopfzeile und sichtbaren Zeilen samt der ersten freien Zeile zum Eintragen, alle ausloesbaren " +
        "Aktionen (mit Angabe, ob sse_click oder sse_click_point noetig ist und ob sie gesperrt sind), " +
        "sowie den Sperrzustand mit Pruefermeldungen. " +
        "Damit braucht man im Regelfall weder Bildschirmfoto noch sse_snapshot. " +
        "Jedes Feld nennt seine 'rid' - fachliche Aenderungen laufen damit ueber die gebundenen Feld- oder Tabellenwerkzeuge.",
    },
    (r) => ({
      ueberschrift: r.ueberschrift,
      ueberschriftQuelle: r.ueberschriftQuelle,
      blockiert: r.blockiert,
      prueferMeldungen: asArray(r.prueferMeldungen),
      leerePflichtfelder: asArray(r.leerePflichtfelder),
      felder: asArray(r.felder),
      tabelle: r.tabelle,
      aktionen: asArray(r.aktionen),
      offeneFenster: r.offeneFenster,
    }),
  );

  registerApiTool(
    "sse_positions",
    {
      title: "Positionen auflisten",
      description:
        "Listet die auf der aktuellen Uebersichtsseite sichtbaren Einnahmen-/Ausgabenpositionen. " +
        "Anlegen und Loeschen sind fail-closed gesperrt, solange dafuer kein eigener Seiten-, Feld-, " +
        "Summen- und Dialogvertrag mit Readback/Rollback existiert. Struktur vorerst manuell anlegen; " +
        "Werte danach nur ueber die gebundenen Feld- und Tabellenwerkzeuge schreiben.",
    },
  );

  registerApiTool(
    "sse_export_csv",
    {
      title: "CSV-Export ausloesen",
      description:
        "Loest 'Datei > Export fuer das Finanzamt (CSV-Dateien)' aus. Zweiter, vom Bildschirm " +
        "UNABHAENGIGER Pruefweg: die exportierten Zahlen lassen sich ohne UI-Automation gegen eine " +
        "eigene Aufstellung halten - eine echte Gegenprobe zu sse_collect, die dieselbe Quelle liest. " +
        "Das Werkzeug wartet auf den Exportdialog und gibt dessen HWND, erlaubte Schalter und Fingerprint " +
        "direkt zurueck. Diesen bewusst per sse_dialog_answer beantworten; ein danach geoeffneter " +
        "Ordnerdialog wird als eigener fingerprintgebundener Folgedialog behandelt. " +
        "Ein neuer resultRef-Unterordner wird von der API sicher angelegt und kann danach im Ordnerdialog verwendet werden. " +
        "Dies ist KEIN Versand ans Finanzamt, sondern eine lokale Datei.",
    },
    { timeoutMs: 120_000 },
  );

  registerShapedApiTool(
    "sse_collect",
    {
      title: "Erklaerung segmentweise erfassen",
      description:
        "Kontrollierter, auf hoechstens 5 Seiten begrenzter Diagnose-Snapshot ab der aktuellen Seite. Erfasst pro Seite die sichtbaren beschrifteten " +
        "Felder, berechneten Summen und Tabellenzeilen und blaettert per UIA weiter. Vor jedem weiteren Schritt " +
        "werden Dialoge, Seitenscheinerfolg, Zyklus und - im sichtbaren Modus - fremde Benutzereingabe geprueft. " +
        "Bei einer Blockade kommt collection-incomplete mit fortsetzbarem Teilstand statt eines falschen " +
        "Gesamterfolgs; einen hinter einem Pruefhinweis wartenden Klick niemals wiederholen. Fuer weitere Seiten " +
        "mit einem neuen hashgebundenen Segment fortsetzen. Speicherzuwachs und UIA-Kanarienzustand werden auf jeder Seite geprueft. " +
        "Fuer den Live-Dialog direkte Page-Object-/Tree-Spruenge verwenden. Lange Seiten und " +
        "virtualisierte Tabellen brauchen weiterhin sse_read_full/sse_table_read als gezielte Vollstaendigkeitsprobe. " +
        "Mit resultRef wird ein neues privates JSON-Artefakt im konfigurierten Ergebnisbereich geschrieben. " +
        "Bestehende Ziele werden nie ersetzt; fuer jedes weitere Segment eine neue resultRef verwenden.",
    },
    (r) => ({
      vollstaendig: r.vollstaendig,
      stopKind: r.stopKind,
      stopReason: r.stopReason,
      anzahl: r.anzahl,
      datei: r.datei,
      dateiHash: r.dateiHash,
      ueberschriften: asArray(r.ueberschriften),
      seiten: r.seiten,
      currentHeadingAfter: r.currentHeadingAfter,
      advancedAfterLastCaptured: r.advancedAfterLastCaptured,
    }),
    { timeoutMs: 90_000 },
  );

  registerShapedApiTool(
    "sse_verify",
    {
      title: "Sollwerte abgleichen",
      description:
        "Vergleicht erwartete Werte gegen einen exakt SHA256-gebundenen sse_collect-JSON-Stand und meldet " +
        "jede Abweichung mit Soll, Ist und Differenz. Zahlen werden centgenau verglichen. Exakte Seiten-/" +
        "Feldnamen haben Vorrang; ein Teilstring darf niemals still den ersten von mehreren Treffern waehlen. " +
        "Mehrdeutigkeiten werden mit Kandidaten gemeldet und koennen bewusst 1-basiert ueber seiteOccurrence/" +
        "labelOccurrence aufgeloest werden. Unvollstaendige oder alte Quellen ohne Vollstaendigkeitsnachweis " +
        "sind standardmaessig gesperrt. allowIncompleteSource prueft nur den ausdruecklich begrenzten Teilstand " +
        "und liefert keine Gesamtaussage zur Erklaerung.",
    },
    (r) => ({
      vergleichOk: r.vergleichOk,
      sourceHash: r.sourceHash,
      sourceVollstaendig: r.sourceVollstaendig,
      sourceStopKind: r.sourceStopKind,
      zusammenfassung: r.zusammenfassung,
      geprueft: r.geprueft,
      abweichungen: r.abweichungen,
      ergebnis: asArray(r.ergebnis),
    }),
    { timeoutMs: 120_000 },
  );
}
