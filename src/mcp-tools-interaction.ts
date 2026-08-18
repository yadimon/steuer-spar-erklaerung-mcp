/**
 * Sichere, gebundene Interaktionswerkzeuge fuer Navigation und Eingaben.
 */
import { asArray } from "./api-client.js";
import type { McpRegistry } from "./mcp-registry.js";

export function registerInteractionTools(registry: McpRegistry): void {
  const { registerApiTool, registerShapedApiTool } = registry;

  /* -------------------------------------------------------------- Bedienen */

  registerShapedApiTool(
    "sse_click",
    {
      title: "Element ausloesen",
      description:
        "Loest ein Bedienelement ueber UI Automation aus - NICHT ueber Bildschirmkoordinaten. " +
        "Das Fenster muss dafuer NICHT im Vordergrund sein. " +
        "pattern='expand' und pattern='collapse' aendern ausschliesslich den Expandierungszustand eines Baumeintrags; " +
        "sie sind keine Seitennavigation. " +
        "Mit expectedPageAfter liest das Werkzeug bei jeder navigierenden Schaltflaeche die Seitenueberschrift " +
        "vor und nach der Aktion selbst zurueck und meldet einen wirkungslosen Klick statt Scheinerfolg. " +
        "Meldet eine Qt-Aktion ein wirkungsloses InvokePattern, ist nur bei unveraenderter Ausgangsseite, " +
        "Dialogfreiheit, erneut vorhandenem InvokePattern und eindeutiger frischer Elementbindung ein " +
        "PID-/Root-verifizierter Mausklick-Fallback erlaubt. " +
        "Direkte Toggle-Pattern sind hier gesperrt: Checkboxen ausschliesslich mit sse_toggle; " +
        "Dropdowns mit sse_combo_select. pattern='select' ist nur fuer genau einen per AutomationId " +
        "gebundenen RadioButton auf dem sichtbaren Desktop zulaessig, aktiviert ihn PID-/Root-verifiziert physisch " +
        "und verifiziert den exklusiven Vor-/Nachzustand der ganzen Gruppe. " +
        "Lokale Loesch-/Import-/Uebernahme-/Zuruecksetzbefehle verlangen einen bewussten Readback und " +
        "acknowledgeDestructive=true; Teilstrings muessen genau einen Kandidaten ergeben. " +
        "GESPERRT sind alle Wege, die Daten ans Finanzamt schicken koennten (ELSTER, 'Anmeldungen versenden', " +
        "'Jahreserklaerungen abschliessen', 'Senden' ...). Diese Sperre ist Absicht und wird nicht umgangen.",
    },
    (r) => ({
      clicked: r.clicked,
      pattern: r.pattern,
      method: r.method,
      kandidaten: r.kandidaten,
      ueberschriftVorher: r.ueberschriftVorher,
      ueberschriftNachher: r.ueberschriftNachher,
      navigiert: r.navigiert,
      verified: r.verified,
      ungespeichertVorher: r.ungespeichertVorher,
      ungespeichertNachher: r.ungespeichertNachher,
      dialoge: asArray(r.dialoge),
    }),
  );

  registerApiTool(
    "sse_toggle",
    {
      title: "Checkbox transaktional setzen",
      description:
        "Setzt genau eine echte UIA-CheckBox auf einen erwarteten booleschen Zustand. AENDERT moeglicherweise " +
        "STEUERDATEN. Exakte Seite, Vorwert und Nachwert sind Pflicht; RuntimeId/AutomationId, Dialoge, Fensterlage " +
        "und fremde Benutzereingabe werden im selben Worker gebunden. Bei einer eindeutig eigenen verletzten " +
        "Nachbedingung wird der alte Zustand wiederhergestellt; nach Interferenz erfolgt kein blinder Rollback. " +
        "RadioButton-Gruppen sind absichtlich nicht abgedeckt.",
    },
  );

  registerShapedApiTool(
    "sse_click_point",
    {
      title: "Element wirklich anklicken",
      description:
        "Echter, PID- und Root-verifizierter Mausklick, fail-closed auf TreeItems des Navigationsbaums, eng benannte " +
        "Erfassen-/Bearbeiten-Hyperlinks sowie den intern fingerprintgebundenen read-only Prueferpfad begrenzt. " +
        "Bei TreeItems wird labelnah statt in die oft leere " +
        "Zeilenmitte geklickt. Checkboxen, Radios, Dropdowns, Tabellenzellen und Dialogknöpfe sind gesperrt und " +
        "muessen ueber ihre zustands-, summen- oder fingerprintgebundenen Spezialwerkzeuge laufen. " +
        "Die Koordinaten stammen aus dem Element selbst, nicht aus einem Bildschirmfoto; vor dem Klick " +
        "wird geprueft, dass dort wirklich ein Fenster des Programms liegt, sonst wird abgebrochen. " +
        "Der Klick braucht ausserdem den tatsaechlichen Vordergrund des gebundenen SSE-Fensters; verweigert Windows ihn, " +
        "bricht das Werkzeug vor jedem Mausinput ab. Fuer Schaltflaechen ist sse_click vorzuziehen.",
    },
    (r) => ({
      clicked: r.clicked,
      at: r.at,
      double: r.double,
      windowClosed: r.windowClosed,
      verified: r.verified,
      ueberschriftVorher: r.ueberschriftVorher,
      ueberschriftNachher: r.ueberschriftNachher,
      seiteGewechselt: r.seiteGewechselt,
      ungespeichertVorher: r.ungespeichertVorher,
      ungespeichertNachher: r.ungespeichertNachher,
      note: r.note,
    }),
  );

  registerApiTool(
    "sse_set_value",
    {
      title: "Globales Suchfeld transaktional setzen",
      description:
        "Kompatibler Low-Level-Name fuer genau das bekannte, steuerneutrale globale SSE-Suchfeld. " +
        "Steuerdaten-, Formular- und Tabellenfelder sind hier fail-closed gesperrt und muessen ueber " +
        "sse_change_known_field, sse_change_field, sse_table_add, sse_table_update oder sse_combo_select laufen. " +
        "Das Suchfeld wird strukturell ueber seinen beschrifteten Container gebunden; die uebergebene rid muss " +
        "frisch sein und zum aktuell gebundenen Suchfeld passen. Vorwert, erwarteter Nachwert, Fensterlage, " +
        "Dialoge und fremde Benutzereingabe werden in einem Worker geprueft; bei Interferenz erfolgt kein " +
        "blinder Rollback.",
    },
  );

  registerApiTool(
    "sse_change_field",
    {
      title: "Feld atomar aendern und Steuerwirkung verfolgen",
      description:
        "Bevorzugter schneller Schreibweg fuer ein einzelnes Feld. Fuehrt in EINEM isolierten UIA-Arbeitsprozess " +
        "Seiten-, Vorwert- und optionale Summenpruefung, Wertsetzung, Qt-Commit, Feld-Readback sowie Vorher/Nachher-" +
        "Diff der Werte-Info aus. Bei einer normal verletzten Nachbedingung wird der alte Feldwert automatisch " +
        "wiederhergestellt. Erkennt der Eingabe-/Fenster-Guard dagegen eine fremde Benutzeraktion oder einen neuen " +
        "Dialog, wird bewusst NICHT blind zurueckgerollt: der sichtbare Zustand wird gemeldet und muss neu gelesen werden. " +
        "Das Werkzeug speichert nicht; danach weiterhin hashgebunden sse_save verwenden. " +
        "ELSTER-/Abgabewege bleiben gesperrt.",
    },
    { timeoutMs: 90_000 },
  );

  registerApiTool(
    "sse_change_known_field",
    {
      title: "Bekanntes Page-Object-Feld atomar aendern",
      description:
        "Schneller, stabiler Schreibweg fuer ein im Page-Object-Katalog definiertes Feld. Der Aufrufer " +
        "nennt nur stabile pageId/fieldId statt sichtbare Texte oder RuntimeIds. MCP loest die " +
        "AutomationId auf, bringt das exakte SSE-Hauptfenster nach vorn, prueft Seite und Vorwert, " +
        "schreibt per verifizierter Benutzereingabe und liest Feld, optionale Abhaengigkeiten sowie " +
        "Steuerergebnis-Diffs zurueck. Bei normal verletzter Nachbedingung erfolgt Rollback. Fremde Eingabe oder " +
        "eine veraenderte Fensterlage stoppt dagegen ohne blinden Rollback und verlangt einen neuen Zustandsabruf; " +
        "gespeichert wird nicht.",
    },
    { timeoutMs: 90_000 },
  );

  registerShapedApiTool(
    "sse_combo_options",
    {
      title: "Dropdown-Optionen sicher lesen",
      description:
        "Oeffnet genau eine ComboBox ueber ExpandCollapsePattern, liest die aktuell materialisierten, ihr " +
        "zugeordneten Optionen und schliesst sie danach wieder ohne Auswahl. Lange Qt-Listen sind virtualisiert; " +
        "sse_combo_select kann dennoch einen exakten internen Eintrag ueber das Listen-ValuePattern waehlen. Read-only.",
    },
    (r) => ({ ...r, options: asArray(r.options) }),
  );

  registerApiTool(
    "sse_combo_select",
    {
      title: "Dropdown-Option verifiziert waehlen",
      description:
        "Waehlt eine exakt beschriftete Option aus genau einer ComboBox. AENDERT STEUERDATEN. Der erwartete " +
        "Seiten- und Vorwert sind Pflicht; nach der Auswahl werden exakter Nachwert, Fensterlage, Dialoge und " +
        "fremde Benutzereingabe geprueft und das Dropdown geschlossen. Auch nicht sichtbare Optionen langer " +
        "virtualisierter Qt-Listen werden auf dem sichtbaren Desktop seitenweise materialisiert und erst als " +
        "echter, exakt benannter ListItem-Knoten PID-verifiziert gewaehlt. " +
        "Bei einer eindeutig eigenen verletzten " +
        "Nachbedingung wird die alte Option wiederhergestellt; nach Interferenz erfolgt kein blinder Rollback.",
    },
  );

  registerApiTool(
    "sse_ustva_read",
    {
      title: "Umsatzsteuer-Voranmeldung strukturiert lesen",
      description:
        "Liest die UStVA-Uebersicht sowie die gebundenen §13b- und Vorsteuer-Detailseiten 2025/2026 " +
        "als stabile Fachstruktur: Zeitraum, Kennzeichen, Bemessungsgrundlagen, Steuerbetraege, " +
        "Vorsteuer und Zahllast/Erstattung. " +
        "Die Operation ist read-only, speichert nicht und uebermittelt niemals per ELSTER.",
    },
  );

  registerApiTool(
    "sse_ustva_select_period",
    {
      title: "UStVA-Zeitraum sicher auswaehlen",
      description:
        "Waehlt genau EIN UStVA-Dropdown ueber stabile semantische Schluessel: frequency, month oder quarter. " +
        "AENDERT STEUERDATEN nur in der gebundenen, hashverifizierten Arbeitskopie und liest den exakten " +
        "Nachwert zurueck. Frequenz und Monat/Quartal werden bewusst in getrennten Aufrufen gesetzt, damit " +
        "jeder Zwischenschritt sichtbar und pruefbar bleibt. Speichert und sendet nicht.",
    },
  );

  registerApiTool(
    "sse_ustva_set_flag",
    {
      title: "UStVA-Kennzeichen sicher setzen",
      description:
        "Setzt genau ein fachlich benanntes UStVA-Kennzeichen mit Vor-/Nachzustand, Fenster-, Fall- und " +
        "Hashbindung. Dazu gehoeren Berichtigung, Belege, Verrechnung, SEPA-Widerruf, ergaenzende Angaben " +
        "und manuelle Erfassung. AENDERT STEUERDATEN in der Arbeitskopie, speichert und sendet aber nicht.",
    },
  );

  registerApiTool(
    "sse_ustva_change_value",
    {
      title: "UStVA-Wert transaktional aendern",
      description:
        "Aendert ein katalogisiertes UStVA-Betrags- oder Korrekturfeld in einer hashverifizierten " +
        "Arbeitskopie mit exaktem Vorwert, Qt-Commit und Readback. Normal berechnete Summen bleiben " +
        "geschuetzt; manuell erfassbare Hauptbetraege verlangen zusaetzlich manualInputConfirmed=true " +
        "und eine zuvor bewusst aktivierte manuelle Erfassung. Speichert und sendet nicht.",
    },
    { timeoutMs: 90_000 },
  );

  registerApiTool(
    "sse_ustva_open_section",
    {
      title: "Eindeutigen UStVA-Unterbereich oeffnen",
      description:
        "Oeffnet einen UStVA-Unterbereich ueber dessen stabile AutomationId und verifiziert die exakte " +
        "Zielseite. Verhindert die bekannte Mehrdeutigkeit mehrerer gleich benannter 'Erfassen'-Buttons. " +
        "Unterstuetzt §13b, Vorsteuer, Kleinunternehmer-Angaben, steuerfreie und nicht steuerbare Umsaetze; " +
        "navigiert nur.",
    },
  );

  registerApiTool(
    "sse_scroll",
    {
      title: "Scrollen",
      description:
        "Rollt den Inhalt. mode='intoview' holt ein benanntes Element in den sichtbaren Bereich " +
        "(bevorzugt, braucht keinen Fokus). mode='percent' setzt die Position eines scrollbaren " +
        "Containers. mode='list' zeigt nur, was ueberhaupt scrollbar ist.",
    },
  );

  // Roh-Tastatureingabe bleibt absichtlich ausserhalb der MCP-Oberflaeche.
}
