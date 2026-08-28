const EXPORT_TITLE = /^Export für das Finanzamt \(\*\.csv\).*$/u;
const FORBIDDEN_CONTEXT = /(?:ELSTER|Versand|Übermitt|Send|Aktivier|Lizenz|Wiederherstell|Speicher|Überschreib)/iu;
const CLOSE_BUTTONS = new Set(["Schließen", "Schliessen"]);

const textVector = (dialog) => (dialog?.texts ?? []).map((entry) => String(entry));
const buttonVector = (dialog) => (dialog?.buttons ?? []).map((entry) => ({
  name: String(entry?.name ?? ""),
  enabled: entry?.enabled !== false,
}));

/**
 * The completed CSV export may leave its original Qt export window open.
 * It is safe to close only when title, complete text vector and complete
 * button vector still exactly match the descriptor returned by export_csv.
 * Any success/error/save/overwrite child notice is intentionally unclassified
 * until its exact contract is captured as evidence.
 */
export function classifyPassiveExportDialog(dialog, expectedExportDialog) {
  if (!dialog || !expectedExportDialog || dialog.hwnd !== expectedExportDialog.hwnd) return null;
  if (dialog.title !== expectedExportDialog.title || !EXPORT_TITLE.test(String(dialog.title ?? ""))) return null;
  const actualTexts = textVector(dialog);
  const expectedTexts = textVector(expectedExportDialog);
  const actualButtons = buttonVector(dialog);
  const expectedButtons = buttonVector(expectedExportDialog);
  if (JSON.stringify(actualTexts) !== JSON.stringify(expectedTexts) ||
      JSON.stringify(actualButtons) !== JSON.stringify(expectedButtons)) return null;
  if (FORBIDDEN_CONTEXT.test([dialog.title, ...actualTexts].join(" "))) return null;
  const closes = actualButtons.filter((entry) => entry.enabled && CLOSE_BUTTONS.has(entry.name));
  return closes.length === 1 ? closes[0].name : null;
}

export function exportDialogEvidence(dialog) {
  return {
    title: String(dialog?.title ?? ""),
    texts: textVector(dialog),
    buttons: buttonVector(dialog),
  };
}
