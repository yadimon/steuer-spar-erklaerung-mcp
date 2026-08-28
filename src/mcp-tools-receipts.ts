/**
 * Sicher gebundene BelegManager-Lese-, Import- und Loeschwerkzeuge.
 */
import { type McpRegistry } from "./mcp-registry.js";
import { RECEIPT_FOREGROUND_BLOCK_DESCRIPTION } from "./receipt-interaction-policy.js";

export function registerReceiptTools(registry: McpRegistry): void {
  const { registerShapedApiTool } = registry;

  registerShapedApiTool(
    "sse_receipt_manager_action",
    {
      title: "BelegManager-Navigation (gesperrt)",
      description:
        RECEIPT_FOREGROUND_BLOCK_DESCRIPTION +
        "Der historische Vordergrundvertrag fuehrt genau eine katalogisierte, reversible Navigation aus: " +
        "showAllReceipts wechselt von der Startseite zur Belegliste, goHome von der Liste zur Startseite. " +
        "Es gibt keinen freien Selektor. Die API bindet Prozess, Hauptfenster, exakten Titel und Qt-Klasse, " +
        "prueft den profilierten Ausgangszustand sowie Dialogfreiheit, verifiziert den Klickpunkt unmittelbar " +
        "vor der physischen Eingabe und verlangt danach den profilierten Zielzustand bei unveraendertem " +
        "Fenstersatz und Dirty-State. Import und Loeschen besitzen separate, staerker gebundene Werkzeuge. " +
        "Verknuepfen ist nur ueber das separate zielgebundene Werkzeug freigegeben. " +
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
        "Vollstaendigkeit behauptet. Die Listenansicht muss ein Mensch vorher im BelegManager geoeffnet haben; " +
        "die gesperrte Navigation darf dafuer nicht automatisch aufgerufen werden.",
    },
    (r) => ({
      pid: r.pid,
      hwnd: r.hwnd,
      mainHwnd: r.mainHwnd,
      managerHwnd: r.managerHwnd,
      state: r.state,
      stateFingerprint: r.stateFingerprint,
      count: r.count,
      countSource: r.countSource,
      headers: r.headers,
      rows: r.rows,
      draftCount: r.draftCount,
      listFingerprint: r.listFingerprint,
      rowsComplete: r.rowsComplete,
      matchedCount: r.matchedCount,
      matches: r.matches,
      matchesComplete: r.matchesComplete,
      ungespeichert: r.ungespeichert,
      physicalInputUsed: r.physicalInputUsed,
      hinweis: r.hinweis,
    }),
    { timeoutMs: 120_000 },
  );

  registerShapedApiTool(
    "sse_receipt_manager_read",
    {
      title: "Belegdetails auswaehlen (gesperrt)",
      description:
        RECEIPT_FOREGROUND_BLOCK_DESCRIPTION +
        "Der historische Vordergrundvertrag waehlt die unmittelbar zuvor gelesene Belegzeile anhand Runtime-ID, Zeilenfingerprint und " +
        "Gesamtlistenfingerprint aus und liest ihre sichtbare Detailansicht strukturiert. Es gibt keinen freien " +
        "Selektor und keine Feldmutation. Die Operation verifiziert, dass Liste, Fenster, Dialogfreiheit und " +
        "Dirty-State unveraendert bleiben; bei veralteter Bindung wird nichts geklickt.",
    },
    (r) => ({
      pid: r.pid,
      hwnd: r.hwnd,
      mainHwnd: r.mainHwnd,
      managerHwnd: r.managerHwnd,
      row: r.row,
      fields: r.fields,
      values: r.values,
      valuesComplete: r.valuesComplete,
      listFingerprint: r.listFingerprint,
      listFingerprintBefore: r.listFingerprintBefore,
      detailFingerprint: r.detailFingerprint,
      semanticListUnchanged: r.semanticListUnchanged,
      targetRowRebound: r.targetRowRebound,
      rowAfter: r.rowAfter,
      targetSemanticRebound: r.targetSemanticRebound,
      semanticRowAfter: r.semanticRowAfter,
      dialogFreeAfter: r.dialogFreeAfter,
      semanticReadback: r.semanticReadback,
      dirtyStateUnchanged: r.dirtyStateUnchanged,
      physicalInputUsed: r.physicalInputUsed,
      foregroundLeaseUsed: r.foregroundLeaseUsed,
      verified: r.verified,
    }),
    { timeoutMs: 120_000 },
  );

  registerShapedApiTool(
    "sse_receipt_manager_update",
    {
      title: "Belegfelder befuellen (gesperrt)",
      description:
        RECEIPT_FOREGROUND_BLOCK_DESCRIPTION +
        "Der historische Vordergrundvertrag befuellt mehrere katalogisierte Felder eines zuvor gelesenen Belegs in einer gebundenen " +
        "Transaktion. Runtime-ID, Zeilen-, Listen- und Detailfingerprint sowie acknowledgeUpdate=true sind Pflicht. " +
        "Unterstuetzt werden Bezeichnung, Datum, Belegnummer, Betrag, Umsatzsteuersatz, Netto-Kennzeichen und Notiz. " +
        "Die API bindet ausschliesslich profilierte AutomationIds, prueft jeden Vor- und Nachwert, haelt Anzahl und " +
        "unberuehrte Zeilen stabil und versucht bei einer normalen Nachbedingungsverletzung den vollstaendigen " +
        "Rollback. Freie Selektoren und ungebundene Dialog-/Verknuepfungsaktionen bleiben gesperrt.",
    },
    (r) => ({
      pid: r.pid,
      hwnd: r.hwnd,
      mainHwnd: r.mainHwnd,
      managerHwnd: r.managerHwnd,
      rowBefore: r.rowBefore,
      rowAfter: r.rowAfter,
      valuesBefore: r.valuesBefore,
      valuesAfter: r.valuesAfter,
      requestedValues: r.requestedValues,
      changedFields: r.changedFields,
      draftBefore: r.draftBefore,
      draftAfter: r.draftAfter,
      listFingerprintBefore: r.listFingerprintBefore,
      listFingerprintAfter: r.listFingerprintAfter,
      detailFingerprintBefore: r.detailFingerprintBefore,
      detailFingerprintAfter: r.detailFingerprintAfter,
      countUnchanged: r.countUnchanged,
      otherRowsUnchanged: r.otherRowsUnchanged,
      windowSetUnchanged: r.windowSetUnchanged,
      dirtyStateUnchanged: r.dirtyStateUnchanged,
      rollback: r.rollback,
      physicalInputUsed: r.physicalInputUsed,
      foregroundLeaseUsed: r.foregroundLeaseUsed,
      verified: r.verified,
    }),
    { timeoutMs: 120_000 },
  );

  registerShapedApiTool(
    "sse_receipt_manager_import",
    {
      title: "Belegdatei importieren (gesperrt)",
      description:
        RECEIPT_FOREGROUND_BLOCK_DESCRIPTION +
        "Der historische Vordergrundvertrag legt in der vollstaendig gelesenen Belegliste genau einen neuen Beleg an und " +
        "importiert eine documents:-PDF-Datei mit gebundenem SHA-256. Andere Formate werden vor jeder UI-Aktion abgewiesen. Der Aufruf verlangt den frischen Listenfingerprint, " +
        "den exakten Vorzaehler und acknowledgeImport=true; vorhandene Entwuerfe blockieren den Import. Die API " +
        "bindet den neu hinzugekommenen Datensatz, den nativen Oeffnen-Dialog und eine visuelle Aenderung des " +
        "Vorschaufelds. Die Quelldatei wird weder verschoben noch veraendert. Wenn ein Nachweis nach dem Anlegen " +
        "unklar bleibt, meldet cleanupRequired=true den neuen Entwurf; der Aufruf wird niemals blind wiederholt.",
    },
    (r) => ({
      pid: r.pid,
      hwnd: r.hwnd,
      mainHwnd: r.mainHwnd,
      managerHwnd: r.managerHwnd,
      resourceRefs: r.resourceRefs,
      sha256: r.sha256,
      countBefore: r.countBefore,
      countAfter: r.countAfter,
      listFingerprintBefore: r.listFingerprintBefore,
      listFingerprintAfter: r.listFingerprintAfter,
      importedRow: r.importedRow,
      detailFingerprint: r.detailFingerprint,
      fields: r.fields,
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
    "sse_receipt_manager_classification_options",
    {
      title: "BelegManager-Klassifikation waehlen (gesperrt)",
      description:
        RECEIPT_FOREGROUND_BLOCK_DESCRIPTION +
        "Der historische Vordergrundvertrag oeffnet fuer den gebundenen Beleg den profilierten Kategorie- oder Personendialog, " +
        "liest alle Optionen ueber das Qt-Grid einschliesslich nicht sichtbarer Zeilen und schliesst den Dialog " +
        "mit Abbrechen. Zeilen-, Listen- und Detailfingerprint sind Pflicht; es wird nichts gespeichert. " +
        "Das Ergebnis liefert eine Optionsmenge und ihren Fingerprint fuer Planung und Nachweis.",
    },
    (r) => ({
      pid: r.pid,
      hwnd: r.hwnd,
      kind: r.kind,
      row: r.row,
      options: r.options,
      selected: r.selected,
      optionsFingerprint: r.optionsFingerprint,
      dialogFingerprint: r.dialogFingerprint,
      dialogClosed: r.dialogClosed,
      dirtyStateUnchanged: r.dirtyStateUnchanged,
      physicalInputUsed: r.physicalInputUsed,
      foregroundLeaseUsed: r.foregroundLeaseUsed,
      verified: r.verified,
    }),
    { timeoutMs: 120_000 },
  );

  registerShapedApiTool(
    "sse_receipt_manager_classify",
    {
      title: "Beleg klassifizieren (gesperrt)",
      description:
        RECEIPT_FOREGROUND_BLOCK_DESCRIPTION +
        "Der historische Vordergrundvertrag setzt fuer den zuvor gelesenen Beleg die vollstaendige Zielmenge vorhandener " +
        "Kategorien und/oder Personen. Die Operation bindet Zeile, Liste, Detailansicht, profilierte " +
        "Auswahldialoge und exakte Optionsnamen, schaltet nur echte TogglePattern-Zellen, speichert jeden " +
        "Dialog einmal und liest die Detailanzeige zurueck. Unbekannte oder doppelte Optionen stoppen fail-closed; " +
        "bei einer normalen Nachbedingungsverletzung wird die Ausgangsmenge wiederhergestellt.",
    },
    (r) => ({
      pid: r.pid,
      hwnd: r.hwnd,
      rowBefore: r.rowBefore,
      rowAfter: r.rowAfter,
      requestedValues: r.requestedValues,
      valuesBefore: r.valuesBefore,
      valuesAfter: r.valuesAfter,
      changedKinds: r.changedKinds,
      listFingerprintBefore: r.listFingerprintBefore,
      listFingerprintAfter: r.listFingerprintAfter,
      detailFingerprintBefore: r.detailFingerprintBefore,
      detailFingerprintAfter: r.detailFingerprintAfter,
      rollback: r.rollback,
      dirtyStateUnchanged: r.dirtyStateUnchanged,
      physicalInputUsed: r.physicalInputUsed,
      foregroundLeaseUsed: r.foregroundLeaseUsed,
      verified: r.verified,
    }),
    { timeoutMs: 180_000 },
  );

  registerShapedApiTool(
    "sse_receipt_manager_link",
    {
      title: "Beleg mit Steuerseite verknuepfen (gesperrt)",
      description:
        RECEIPT_FOREGROUND_BLOCK_DESCRIPTION +
        "Der historische Vordergrundvertrag setzt oder entfernt eine bis 20 Verknuepfungen zwischen exakt titelgebundenen Belegen und der aktuellen " +
        "Steuerseite in einem einzigen Oeffnen-/Uebernehmen-/Readback-Zyklus. Ein optionaler Inhaltsfingerprint " +
        "verstaerkt die Bindung; ein mehrdeutiger Titel stoppt immer fail-closed. Seitenueberschrift, sichtbarer " +
        "BelegManager-Zieltext und acknowledgeLinkChange=true sind Pflicht. Bereits erreichte Zielzustaende werden " +
        "nicht erneut geschaltet. Der Legacy-Einzelmodus bleibt kompatibel.",
    },
    (r) => ({
      pid: r.pid,
      hwnd: r.hwnd,
      mainHwnd: r.mainHwnd,
      managerHwnd: r.managerHwnd,
      receipt: r.receipt,
      items: r.items,
      expectedTargetPage: r.expectedTargetPage,
      expectedLinkTarget: r.expectedLinkTarget,
      linkedBefore: r.linkedBefore,
      linkedAfter: r.linkedAfter,
      noChanges: r.noChanges,
      changedCount: r.changedCount,
      footerCountBefore: r.footerCountBefore,
      footerCountAfter: r.footerCountAfter,
      applied: r.applied,
      persistenceVerified: r.persistenceVerified,
      dirtyStateUnchangedBeforeApply: r.dirtyStateUnchangedBeforeApply,
      cleanupRequired: r.cleanupRequired,
      physicalInputUsed: r.physicalInputUsed,
      foregroundLeaseUsed: r.foregroundLeaseUsed,
      verified: r.verified,
    }),
    { timeoutMs: 180_000 },
  );

  registerShapedApiTool(
    "sse_receipt_manager_bulk_upsert",
    {
      title: "Belege gesammelt importieren (gesperrt)",
      description:
        RECEIPT_FOREGROUND_BLOCK_DESCRIPTION +
        "Der historische Vordergrundvertrag verarbeitet ein bis 20 fachlich identifizierte Belege. Exakter Titel plus Belegnummer oder Datum+Betrag " +
        "entscheidet zwischen Update und Import; Mehrdeutigkeit stoppt immer und kann nicht mit force umgangen " +
        "werden. onExisting steuert update, skip oder error. Redundante Zwischen-Readbacks wurden entfernt: Import, " +
        "Update und Klassifikation liefern jeweils ihre verifizierten Bindungen. Der Batch stoppt beim ersten " +
        "unklaren Schritt und wiederholt niemals blind.",
    },
    (r) => ({
      schemaVersion: r.schemaVersion,
      planKind: r.planKind,
      pid: r.pid,
      hwnd: r.hwnd,
      mainHwnd: r.mainHwnd,
      managerHwnd: r.managerHwnd,
      requestedCount: r.requestedCount,
      completedCount: r.completedCount,
      completed: r.completed,
      failedAction: r.failedAction,
      failedIndex: r.failedIndex,
      skipped: r.skipped,
      items: r.items,
      failure: r.failure,
      rollback: r.rollback,
      cleanupRequired: r.cleanupRequired,
      finalReadback: r.finalReadback,
      finalReadbackVerified: r.finalReadbackVerified,
      resultingState: r.resultingState,
      performance: r.performance,
      resourceRefs: r.resourceRefs,
      verified: r.verified,
    }),
    { timeoutMs: 300_000 },
  );

  registerShapedApiTool(
    "sse_receipt_manager_delete",
    {
      title: "Beleg loeschen (gesperrt)",
      description:
        RECEIPT_FOREGROUND_BLOCK_DESCRIPTION +
        "Der historische Vordergrundvertrag loescht genau eine zuvor gelesene Belegzeile. Runtime-ID, Zeilenfingerprint, " +
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
