const PASSIVE_PROFIT_NOTICE =
  /^Der Gewinn des Betriebs \u00BB[^\u00BB\u00AB\r\n]+\u00AB wurde aktualisiert\.$/u;

/**
 * Returns the only startup-dialog answer that live tests may issue
 * automatically. Recovery and import dialogs intentionally remain unanswered:
 * dismissing them can mutate state outside the disposable test copy.
 */
export function classifyPassiveStartupDialog(dialog) {
  const buttons = dialog?.buttons ?? [];
  const text = (dialog?.texts ?? []).join(" ");
  if (dialog?.title === "Gewinn aktualisiert!" &&
      PASSIVE_PROFIT_NOTICE.test(text) &&
      buttons.length === 1 && buttons[0]?.name === "OK") {
    return "OK";
  }
  return null;
}
