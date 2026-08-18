import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadProductProfile } from "../dist/product-profiles.js";

/**
 * Liefert die im Produktprofil benannte Tabellenseite.
 *
 * Die frueheren Live-Skripte schrieben Seitenueberschrift, Summenlabel und die
 * erwarteten Betraege fest. Diese Werte stammten aus der privaten Arbeitskopie
 * ihres Autors; auf einer frischen Kopie des Herstellermusterfalls sind sie
 * falsch. Das Profil ist die einzige Stelle, die eine Tabellenseite samt
 * Kontrollsumme und Betragsspalte mit beanspruchter Live-Evidenz benennt -
 * also kommt sie von dort, und die Betraege kommen aus der Anwendung selbst.
 */
export function profiledTablePage(profileId = process.env.SSE_PROFILE_ID) {
  const profile = loadProductProfile(profileId);
  const catalog = JSON.parse(readFileSync(profile.pageObjectsPath, "utf8"));
  const entries = Object.entries(catalog.focuslessCommits ?? {});
  assert.equal(entries.length, 1,
    `Profil ${profile.id} benennt nicht genau eine profilierte Tabellenseite (${entries.length}).`);
  const [tableId, table] = entries[0];
  const sumChecks = table.requiredSumChecks ?? [];
  assert.equal(sumChecks.length, 1, `Tabelle '${tableId}' nennt nicht genau eine Kontrollsumme.`);

  const page = {
    profile,
    tableId,
    heading: String(table.heading ?? ""),
    amountColumn: String(table.columnHeader ?? ""),
    sumLabel: String(sumChecks[0].label ?? ""),
    sumOccurrence: Number(sumChecks[0].occurrence),
  };
  assert(page.heading, `Tabelle '${tableId}' nennt keine Seitenueberschrift.`);
  assert(page.amountColumn, `Tabelle '${tableId}' nennt keine Betragsspalte.`);
  assert(page.sumLabel, `Tabelle '${tableId}' nennt kein Summenlabel.`);
  assert(Number.isInteger(page.sumOccurrence) && page.sumOccurrence >= 1,
    `Tabelle '${tableId}' nennt keine gueltige Summen-Occurrence.`);
  return page;
}
