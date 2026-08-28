/**
 * Programm-, Fall- und Lebenszykluswerkzeuge.
 */
import { asArray } from "./api-client.js";
import { LAUNCH_OPERATION_TIMEOUT_MS } from "./api-contract.js";
import type { McpRegistry } from "./mcp-registry.js";

export function registerLifecycleTools(registry: McpRegistry): void {
  const { registerApiTool, registerShapedApiTool } = registry;

  /* ----------------------------------------------------- Programm/Steuerfaelle */

  registerShapedApiTool(
    "sse_launch",
    {
      title: "Programm starten",
      description:
        "Startet die SteuerSparErklaerung, optional direkt mit einer Falldatei. Der Startmodus bestimmt " +
        "das Modul. Nur das aktive, verifizierte Produktprofil und dazu passende Falldateien werden akzeptiert; " +
        "andere Jahres-/Engine-Versionen werden nicht ersatzweise gesteuert. " +
        "Wenn beim Start genau ein Hauptfenster erkennbar ist, liefert instance dessen PID/HWND zur sofortigen " +
        "expliziten Bindung aller Folgeaktionen. " +
        "einur=Gewinnermittlung/EUER, normal=Einkommensteuer, einurvor=Gewinn-Erfassung Folgejahr, " +
        "fest=Feststellung, ermaess=Lohnsteuer-Ermaessigung, vorweg=Prognose. " +
        "UStVA im Profiljahr wird im Modus einur bearbeitet; die Gewinn-Erfassung des ausdruecklich " +
        "freigegebenen Folgejahres im Modus einurvor. Nicht von SSE.exe akzeptierte Zusatzmodi werden nicht angeboten. " +
        "Vor einem Start mit caseRef immer sse_instances lesen. Ist genau ein Fall schon offen, bleibt er " +
        "der Arbeitsfall; sse_launch darf ihn nicht still durch eine Kopie oder einen anderen Fall ersetzen. " +
        "Nennt der Mensch einen anderen Fall und der offene Fall hat ungespeicherte Aenderungen, muss der Agent " +
        "vor jedem Speichern, Verwerfen, Schliessen oder Wechseln nachfragen. " +
        "Nach dem Start kann eine Rueckfrage nach einer Wiederherstellungsdatei erscheinen - mit " +
        "sse_dialog_list lesen und ausschliesslich mit dem gelieferten Fingerprint ueber " +
        "sse_dialog_answer beantworten; niemals dafuer den generischen Klick verwenden.",
    },
    (r) => ({
      pid: r.pid, args: r.args, waitedSec: r.waitedSec, windows: asArray(r.windows),
      instance: r.instance, ready: r.ready, blockedByDialog: r.blockedByDialog,
      dialogs: asArray(r.dialogs), product: r.product, case: r.case,
    }),
    { timeoutMs: LAUNCH_OPERATION_TIMEOUT_MS },
  );

  registerApiTool(
    "sse_save",
    {
      title: "Steuerfall sicher speichern",
      description:
        "Speichert nur den bereits geoeffneten, referenzierten Steuerfall. caseRef und expectedHashBefore " +
        "sind Pflicht und muessen mit Fenstertitel und Datei uebereinstimmen. Sind mehrere Steuerfaelle offen, " +
        "muss das exakte Hauptfenster per hwnd gebunden werden. Danach werden Hashwechsel, " +
        "deaktivierte Sichern-Schaltflaeche und Dialogfreiheit geprueft. Eine Bitte, Werte zu aendern, erlaubt " +
        "noch kein Speichern: sse_save nur verwenden, wenn der Mensch in diesem Auftrag ausdruecklich das " +
        "Speichern verlangt. Nicht fuer Wiederherstellungsfaelle " +
        "ohne Dateibindung verwenden. Bereits uebermittelte oder unbekannte Faelle bleiben standardmaessig " +
        "gesperrt. Nach ausdruecklicher menschlicher Freigabe kann correction ausschliesslich eine separat " +
        "als Korrektur/Berichtigung benannte Arbeitskopie speichern: Zeitraum, Grund, unveraendertes " +
        "uebermitteltes Original und dessen SHA256 sowie eine bytegleiche Vorzustands-Sicherung unter backups: " +
        "sind Pflicht. Ein generisches force gibt es nicht, das Original bleibt unveraendert und sse_save " +
        "loest niemals ELSTER aus. Bei einer UStVA-Berichtigung muss das fachliche Kennzeichen corrected " +
        "separat im richtigen Zeitraum gesetzt und zurueckgelesen werden.",
    },
    { timeoutMs: 90_000 },
  );

  registerApiTool(
    "sse_file_dialog_select",
    {
      title: "Datei oder Ordner im offenen Windows-Dialog sicher waehlen",
      description:
        "Bedient genau einen bereits offenen nativen Oeffnen-, Speichern- oder Ordnerauswahl-Dialog. Exakter Dialogtitel und " +
        "Dateipfad sind Pflicht. Beim Oeffnen muss die Datei existieren und kann per SHA256 gebunden werden. Beim " +
        "Speichern muss das Ziel neu sein; danach werden Existenz und SHA256 geprueft. Das Werkzeug setzt und liest " +
        "das Datei-/Ordnerfeld zurueck und klickt nur die zum Titel passende native Aktionsschaltflaeche. Der " +
        "Finanzamt-CSV-Export akzeptiert ausschliesslich einen vorhandenen leeren Ausgabeordner.",
    },
    { timeoutMs: 90_000 },
  );

  registerApiTool(
    "sse_save_as",
    {
      title: "Steuerfall sicher speichern unter",
      description:
        "Oeffnet den echten SSE-Dialog 'Speichern unter...' mit Strg+Alt+S, setzt den Zielpfad ueber " +
        "UI Automation und prueft anschliessend Zieldatei, SHA256 und Fenstertitel. Quelldateipfad und " +
        "Quell-Hash sind Pflicht. Das Ziel muss neu sein; vorhandene Ziele werden ausnahmslos vor jeder " +
        "UI-Aktion abgelehnt und ein Ueberschreibdialog wird nie automatisch bestaetigt. Nur nach dem " +
        "ausdruecklichen Wunsch nach einer neuen Datei/Kopie verwenden; niemals als automatische " +
        "Sicherheitsmassnahme oder Korrektur-Ausweichweg.",
    },
    { timeoutMs: 120_000 },
  );

  registerApiTool(
    "sse_close",
    {
      title: "Programm beenden",
      description:
        "Beendet das Programm nur nach einem ausdruecklichen menschlichen Auftrag zum Schliessen. Eine " +
        "Bitte, Werte zu aendern oder zu pruefen, erlaubt weder Schliessen noch Verwerfen. Vorher " +
        "sse_instances frisch lesen und den exakten Fall per hwnd/pid binden. Versucht zuerst ein normales Schliessen; haengt das Fenster oder ist " +
        "force=true gesetzt, darf genau die gebundene PID nur mit discardChanges=true hart beendet werden. " +
        "Speichern gehoert in den hashgebundenen Schritt sse_save; sse_close save=true wird verweigert. " +
        "Ohne discardChanges=true wird kein neu auftauchender Speicherdialog mit Nein/Verwerfen beantwortet. " +
        "Offene Dialoge muessen vorher separat gelesen und beantwortet werden. " +
        "force ist teuer: ein hart beendetes Programm hinterlaesst eine Wiederherstellungsdatei, und der " +
        "naechste Start fragt danach - sse_launch endet dann mit kind='startup-question' und laesst sich " +
        "ohne Antwort im Programm nicht aufloesen. Deshalb erst ohne force schliessen und dem Programm " +
        "Zeit lassen; force nur bei einem haengenden Fenster.",
    },
    { timeoutMs: 60_000 },
  );

  registerShapedApiTool(
    "sse_list_cases",
    {
      title: "Steuerfaelle auflisten",
      description:
        "Listet die Falldateien eines Ordners und liest ihren Klartext-Kopf: Modul, Jahr, Steuernummer, " +
        "und vor allem ElsterTransferTime - daran erkennt man OHNE das Programm zu oeffnen, ob eine " +
        "Erklaerung bereits ans Finanzamt uebermittelt wurde. Die eigentlichen Steuerdaten sind " +
        "verschluesselt und nur ueber die Oberflaeche lesbar.",
    },
    (r) => ({ dir: r.dir, count: r.count, cases: asArray(r.cases) }),
  );

  registerApiTool(
    "sse_backup_cases",
    {
      title: "Steuerfaelle sichern",
      description:
        "Kopiert alle Falldateien in einen Sicherungsordner und schreibt SHA256-Pruefsummen. " +
        "Nur fuer einen ausdruecklichen Ordner-/Gesamtbackup-Auftrag verwenden. Fuer die normale Arbeit am " +
        "bereits geoeffneten Einzelfall stattdessen einmal pro unveraendertem Dateistand " +
        "sse_make_working_copy nach backups: verwenden.",
    },
    { timeoutMs: 180_000 },
  );

  registerApiTool(
    "sse_archive_cases",
    {
      title: "Alte Steuerfaelle sicher archivieren",
      description:
        "Verschiebt eine exakt benannte und SHA256-gebundene Menge nicht uebermittelter Falldateien aus dem " +
        "aktiven Fallordner in einen neuen Archivordner. Der vollstaendige erwartete Restbestand ist Pflicht; " +
        "bei unbekannten, geaenderten oder uebermittelten Dateien wird nichts verschoben. Nach jeder Bewegung " +
        "werden Archiv- und Resthashes geprueft, bei Fehlern erfolgt Rollback. Das ist die sichere, " +
        "wiederherstellbare Alternative zum Loeschen alter Test- und Zwischenstaende.",
    },
    { timeoutMs: 180_000 },
  );

  registerApiTool(
    "sse_make_working_copy",
    {
      title: "Verifizierte Kopie einer Steuerfalldatei",
      description:
        "Erstellt eine neue, bytegleiche Kopie einer Steuerfalldatei ohne UI, Tastatur oder Dialog. " +
        "Der Zielbereich entscheidet den Zweck: 'backups:' erzeugt die normale private SICHERUNG; " +
        "'cases:' erzeugt eine ARBEITSKOPIE nur auf ausdruecklichen Wunsch des Menschen. Vor der ersten " +
        "Aenderung oder einer UI-Navigation mit moeglichem Dirty-State den aktuellen Dateistand nach " +
        "'backups:' sichern. Fuer denselben Fall und unveraenderten Quellhash wird die bereits in dieser " +
        "Aufgabe verifizierte Sicherung wiederverwendet, statt vor jedem Tool-Aufruf eine neue anzulegen. " +
        "Nach erfolgreichem Speichern muss der naechste Schreibabschnitt den neuen Hash erneut sichern. " +
        "Eine Sicherung wird niemals mit sse_launch geoeffnet. " +
        "Das Ziel darf nicht existieren; Quell-SHA256 und gleiche Dateiendung sind Pflicht. Danach werden " +
        "Quell- und Zielhash sowie Kopfdaten erneut geprueft. Bei einer Abweichung wird nur das neu erzeugte Ziel entfernt.",
    },
    { timeoutMs: 120_000 },
  );
}
