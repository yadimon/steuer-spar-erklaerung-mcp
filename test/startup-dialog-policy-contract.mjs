import assert from "node:assert/strict";
import { classifyPassiveStartupDialog } from "./startup-dialog-policy.mjs";

const dialog = (title, texts, buttons) => ({
  title,
  texts,
  buttons: buttons.map((name) => ({ name, enabled: true })),
});

const exactProfitNotice = dialog(
  "Gewinn aktualisiert!",
  ["Der Gewinn des Betriebs \u00BBMuster\u00AB wurde aktualisiert."],
  ["OK"],
);
assert.equal(classifyPassiveStartupDialog(exactProfitNotice), "OK");

for (const unsafe of [
  dialog("Steuerprogramm", ["Es wurde eine Wiederherstellungsdatei gefunden."], ["Ja", "Nein"]),
  dialog("Aktualisierung fehlgeschlagen!", ["Der importierte Steuerfall konnte nicht aktualisiert werden."], ["OK"]),
  dialog("Gewinn aktualisiert!", ["der Gewinn des Betriebs \u00BBMuster\u00AB wurde aktualisiert."], ["OK"]),
  dialog("Gewinn aktualisiert!", ["Der Gewinn des Betriebs Muster wurde aktualisiert."], ["OK"]),
  dialog("Gewinn aktualisiert!", ["Der Gewinn des Betriebs \u00BBMuster\u00AB wurde aktualisiert."], ["OK", "Details"]),
]) {
  assert.equal(classifyPassiveStartupDialog(unsafe), null, JSON.stringify(unsafe));
}

process.stdout.write("Live-Startdialogpolicy: nur die exakt bekannte passive Gewinnnotiz wird beantwortet.\n");
