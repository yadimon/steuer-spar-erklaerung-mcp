/**
 * Programm-, Fall- und Lebenszykluswerkzeuge.
 */
import { asArray } from "./api-client.js";
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
        "Nach dem Start kann eine Rueckfrage nach einer Wiederherstellungsdatei erscheinen - mit " +
        "sse_dialog_list lesen und ausschliesslich mit dem gelieferten Fingerprint ueber " +
        "sse_dialog_answer beantworten; niemals dafuer den generischen Klick verwenden.",
    },
    (r) => ({
      pid: r.pid, args: r.args, waitedSec: r.waitedSec, windows: asArray(r.windows),
      instance: r.instance, ready: r.ready, blockedByDialog: r.blockedByDialog,
      dialogs: asArray(r.dialogs), product: r.product, case: r.case,
    }),
    { timeoutMs: 120_000 },
  );

  registerApiTool(
    "sse_save",
    {
      title: "Steuerfall sicher speichern",
      description:
        "Speichert nur den bereits geoeffneten, referenzierten Steuerfall. caseRef und expectedHashBefore " +
        "sind Pflicht und muessen mit Fenstertitel und Datei uebereinstimmen. Sind mehrere Steuerfaelle offen, " +
        "muss das exakte Hauptfenster per hwnd gebunden werden. Danach werden Hashwechsel, " +
        "deaktivierte Sichern-Schaltflaeche und Dialogfreiheit geprueft. Nicht fuer Wiederherstellungsfaelle " +
        "ohne Dateibindung verwenden.",
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
        "UI-Aktion abgelehnt und ein Ueberschreibdialog wird nie automatisch bestaetigt.",
    },
    { timeoutMs: 120_000 },
  );

  registerApiTool(
    "sse_close",
    {
      title: "Programm beenden",
      description:
        "Beendet das Programm. Versucht zuerst ein normales Schliessen; haengt das Fenster oder ist " +
        "force=true gesetzt, darf genau die gebundene PID nur mit discardChanges=true hart beendet werden. " +
        "Speichern gehoert in den hashgebundenen Schritt sse_save; sse_close save=true wird verweigert. " +
        "Ohne discardChanges=true wird kein neu auftauchender Speicherdialog mit Nein/Verwerfen beantwortet. " +
        "Offene Dialoge muessen vorher separat gelesen und beantwortet werden.",
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
        "VOR jeder Schreiboperation aufrufen.",
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
        "Der Zielbereich entscheidet den Zweck: 'cases:' erzeugt eine ARBEITSKOPIE zum Oeffnen, " +
        "'backups:' erzeugt eine SICHERUNG. Vor jeder Schreibaktion an einem Steuerfall zuerst eine " +
        "Sicherung nach 'backups:' anlegen - danach ist jeder Schreibfehler zurueckholbar. " +
        "Das Ziel darf nicht existieren; Quell-SHA256 und gleiche Dateiendung sind Pflicht. Danach werden " +
        "Quell- und Zielhash sowie Kopfdaten erneut geprueft. Bei einer Abweichung wird nur das neu erzeugte Ziel entfernt.",
    },
    { timeoutMs: 120_000 },
  );
}
