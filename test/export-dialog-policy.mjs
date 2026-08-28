const EXPORT_TITLE = /^Export für das Finanzamt \(\*\.csv\).*$/u;
const EXPORT_SUCCESS_TITLE = "Export erfolgreich durchgeführt!";
const EXPORT_SUCCESS_TEXT = /^Die Dateien finden Sie im Verzeichnis: .+$/u;
const FORBIDDEN_CONTEXT = /(?:ELSTER|Versand|Übermitt|Send|Aktivier|Lizenz|Wiederherstell|Speicher(?:n|abfrage)|Überschreib)/iu;
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

export function classifyPassiveExportSuccessDialog(dialog) {
  if (!dialog || dialog.title !== EXPORT_SUCCESS_TITLE) return null;
  const texts = textVector(dialog);
  const buttons = buttonVector(dialog);
  if (texts.length !== 1 || !EXPORT_SUCCESS_TEXT.test(texts[0])) return null;
  if (FORBIDDEN_CONTEXT.test([dialog.title, ...texts].join(" "))) return null;
  return buttons.length === 1 && buttons[0].name === "OK" && buttons[0].enabled ? "OK" : null;
}

export function exportDialogEvidence(dialog) {
  return {
    title: String(dialog?.title ?? ""),
    texts: textVector(dialog),
    buttons: buttonVector(dialog),
  };
}
