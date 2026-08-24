/**
 * Sicher gebundene BelegManager-Lese-, Import- und Loeschwerkzeuge.
 */
import { type McpRegistry } from "./mcp-registry.js";

export function registerReceiptTools(registry: McpRegistry): void {
  const { registerShapedApiTool } = registry;

  registerShapedApiTool(
    "sse_receipt_manager_action",
    {
      title: "BelegManager sicher navigieren",
      description:
        "Fuehrt genau eine katalogisierte, reversible Navigation im bereits geoeffneten BelegManager aus: " +
        "showAllReceipts wechselt von der Startseite zur Belegliste, goHome von der Liste zur Startseite. " +
        "Es gibt keinen freien Selektor. Die API bindet Prozess, Hauptfenster, exakten Titel und Qt-Klasse, " +
        "prueft den profilierten Ausgangszustand sowie Dialogfreiheit, verifiziert den Klickpunkt unmittelbar " +
        "vor der physischen Eingabe und verlangt danach den profilierten Zielzustand bei unveraendertem " +
        "Fenstersatz und Dirty-State. Import und Loeschen besitzen separate, staerker gebundene Werkzeuge. " +
        "Verknuepfen und Uebernehmen bleiben gesperrt. " +
        "Der BelegManager muss vorher ueber sse_menu und sse_menu_click geoeffnet worden sein.",
    },
    (r) => ({
      actionId: r.actionId,
      pid: r.pid,
      hwnd: r.hwnd,
      stateBefore: r.stateBefore,
      stateAfter: r.stateAfter,
      stateFingerprintBefore: r.stateFingerprintBefore,
      stateFingerprintAfter: r.stateFingerprintAfter,
      controlAutomationId: r.controlAutomationId,
      controlName: r.controlName,
      windowSetUnchanged: r.windowSetUnchanged,
      dirtyStateUnchanged: r.dirtyStateUnchanged,
      physicalInputUsed: r.physicalInputUsed,
      foregroundLeaseUsed: r.foregroundLeaseUsed,
      verified: r.verified,
    }),
    { timeoutMs: 120_000 },
  );

  registerShapedApiTool(
    "sse_receipt_manager_list",
    {
      title: "Belege strukturiert lesen",
      description:
        "Liest die bereits geoeffnete BelegManager-Listenansicht ohne Klick und ohne Fokuswechsel. " +
        "Das Ergebnis enthaelt den angezeigten Gesamtzaehler, sichtbare Spalten und Zeilen, Entwurfsmarkierungen, " +
        "frische Zeilenbindungen sowie einen Listenfingerprint fuer nachfolgende exakt gebundene Aktionen. " +
        "Wenn Qt nicht alle Belege im UIA-Baum exponiert, wird rowsComplete=false gemeldet; es wird keine " +
        "Vollstaendigkeit behauptet. Vorher bei Bedarf showAllReceipts ausfuehren.",
    },
    (r) => ({
      pid: r.pid,
      hwnd: r.hwnd,
      state: r.state,
      stateFingerprint: r.stateFingerprint,
      count: r.count,
      countSource: r.countSource,
      headers: r.headers,
      rows: r.rows,
      draftCount: r.draftCount,
      listFingerprint: r.listFingerprint,
      rowsComplete: r.rowsComplete,
      ungespeichert: r.ungespeichert,
      physicalInputUsed: r.physicalInputUsed,
      hinweis: r.hinweis,
    }),
    { timeoutMs: 120_000 },
  );

  registerShapedApiTool(
    "sse_receipt_manager_read",
    {
      title: "Belegdetails sicher lesen",
      description:
        "Waehlt genau die unmittelbar zuvor gelesene Belegzeile anhand Runtime-ID, Zeilenfingerprint und " +
        "Gesamtlistenfingerprint aus und liest ihre sichtbare Detailansicht strukturiert. Es gibt keinen freien " +
        "Selektor und keine Feldmutation. Die Operation verifiziert, dass Liste, Fenster, Dialogfreiheit und " +
        "Dirty-State unveraendert bleiben; bei veralteter Bindung wird nichts geklickt.",
    },
    (r) => ({
      pid: r.pid,
      hwnd: r.hwnd,
      row: r.row,
      fields: r.fields,
      listFingerprint: r.listFingerprint,
      listFingerprintBefore: r.listFingerprintBefore,
      detailFingerprint: r.detailFingerprint,
      semanticListUnchanged: r.semanticListUnchanged,
      dirtyStateUnchanged: r.dirtyStateUnchanged,
      physicalInputUsed: r.physicalInputUsed,
      foregroundLeaseUsed: r.foregroundLeaseUsed,
      verified: r.verified,
    }),
    { timeoutMs: 120_000 },
  );

  registerShapedApiTool(
    "sse_receipt_manager_import",
    {
      title: "Belegdatei sicher importieren",
      description:
        "Legt in der bereits geoeffneten, vollstaendig gelesenen Belegliste genau einen neuen Beleg an und " +
        "importiert eine documents:-Datei mit gebundenem SHA-256. Der Aufruf verlangt den frischen Listenfingerprint, " +
        "den exakten Vorzaehler und acknowledgeImport=true; vorhandene Entwuerfe blockieren den Import. Die API " +
        "bindet den neu hinzugekommenen Datensatz, den nativen Oeffnen-Dialog und eine visuelle Aenderung des " +
        "Vorschaufelds. Die Quelldatei wird weder verschoben noch veraendert. Wenn ein Nachweis nach dem Anlegen " +
        "unklar bleibt, meldet cleanupRequired=true den neuen Entwurf; der Aufruf wird niemals blind wiederholt.",
    },
    (r) => ({
      pid: r.pid,
      hwnd: r.hwnd,
      resourceRefs: r.resourceRefs,
      sha256: r.sha256,
      countBefore: r.countBefore,
      countAfter: r.countAfter,
      listFingerprintBefore: r.listFingerprintBefore,
      listFingerprintAfter: r.listFingerprintAfter,
      importedRow: r.importedRow,
      previewFingerprintBefore: r.previewFingerprintBefore,
      previewFingerprintAfter: r.previewFingerprintAfter,
      previewChanged: r.previewChanged,
      sourceHashStable: r.sourceHashStable,
      existingRowsUnchanged: r.existingRowsUnchanged,
      dialogClosed: r.dialogClosed,
      windowSetUnchanged: r.windowSetUnchanged,
      cleanupRequired: r.cleanupRequired,
      dirtyStateUnchanged: r.dirtyStateUnchanged,
      physicalInputUsed: r.physicalInputUsed,
      foregroundLeaseUsed: r.foregroundLeaseUsed,
      verified: r.verified,
    }),
    { timeoutMs: 120_000 },
  );

  registerShapedApiTool(
    "sse_receipt_manager_delete",
    {
      title: "Beleg sicher loeschen",
      description:
        "Loescht genau eine unmittelbar zuvor gelesene Belegzeile. Runtime-ID, Zeilenfingerprint, " +
        "Gesamtlistenfingerprint, Vorzaehler und acknowledgeDelete=true sind Pflicht. Die Operation waehlt die " +
        "gebundene Zeile, akzeptiert ausschliesslich den profilierten Loeschdialog und verifiziert danach Zaehler, " +
        "Restzeilen, Dialogfreiheit, Fenster und Dirty-State. Bei einer veralteten Bindung wird nichts geloescht.",
    },
    (r) => ({
      pid: r.pid,
      hwnd: r.hwnd,
      deletedRow: r.deletedRow,
      countBefore: r.countBefore,
      countAfter: r.countAfter,
      listFingerprintBefore: r.listFingerprintBefore,
      listFingerprintAfter: r.listFingerprintAfter,
      confirmationFingerprint: r.confirmationFingerprint,
      confirmationMethod: r.confirmationMethod,
      dialogClosed: r.dialogClosed,
      remainingRowsUnchanged: r.remainingRowsUnchanged,
      dirtyStateUnchanged: r.dirtyStateUnchanged,
      physicalInputUsed: r.physicalInputUsed,
      foregroundLeaseUsed: r.foregroundLeaseUsed,
      verified: r.verified,
    }),
    { timeoutMs: 120_000 },
  );
}
