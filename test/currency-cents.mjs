import assert from "node:assert/strict";

/**
 * Deutsche Betraege exakt und ohne Gleitkomma umrechnen.
 *
 * Die Kontrollsummen der Tabellenwege werden als Text verglichen. Ein einziger
 * Rundungsfehler laesst eine korrekte Mutation als Abweichung erscheinen -
 * deshalb wird in Cent gerechnet und wieder in genau die Schreibweise
 * zurueckformatiert, die die Anwendung liefert.
 */
export function parseCents(text) {
  assert.match(String(text), /^-?\d{1,3}(?:\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/u,
    `Kein eindeutiger deutscher Waehrungswert: ${JSON.stringify(text)}`);
  const [euro, cent] = String(text).replace(/\./gu, "").split(",");
  const sign = euro.startsWith("-") ? -1 : 1;
  return sign * (Math.abs(Number(euro)) * 100 + Number(cent));
}

export function formatCents(cents) {
  const euro = String(Math.floor(Math.abs(cents) / 100)).replace(/\B(?=(?:\d{3})+(?!\d))/gu, ".");
  return `${cents < 0 ? "-" : ""}${euro},${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}
