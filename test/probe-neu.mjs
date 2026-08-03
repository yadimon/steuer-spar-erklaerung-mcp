/** Prueft die vier neuen Werkzeuge gegen die versteckte Instanz. */
import { callWorker } from "../dist/worker.js";

const kurz = (s, n = 150) => (s && s.length > n ? s.slice(0, n) + " …" : s ?? "");

const p = await callWorker("page");
console.log(`Seite: ${p.ueberschrift}\n`);

console.log("── sse_verify ──");
const v = await callWorker("verify");
console.log(`  ok=${v.ok}  ${v.urteil}`);
console.log(`  Ergebnisanzeige: ${v.ergebnisAnzeige}`);
if (v.prueferMeldungen?.length) console.log(`  Pruefer: ${v.prueferMeldungen.join(" | ")}`);
if (v.leerePflichtfelder?.length) console.log(`  leere Pflichtfelder: ${v.leerePflichtfelder.join(", ")}`);

console.log("\n── sse_help ──");
const h = await callWorker("help");
for (const [name, inhalt] of Object.entries(h.abschnitte ?? {})) {
  console.log(`  [${name}] ${kurz(inhalt.text, 200)}`);
  if (inhalt.verweise?.length) console.log(`     Verweise: ${inhalt.verweise.slice(0, 5).join(" · ")}`);
}

console.log("\n── sse_subpages ──");
const s = await callWorker("subpages");
console.log(`  ${s.anzahl} Schalter`);
for (const u of (s.unterseiten ?? []).slice(0, 12)) {
  console.log(`     "${u.schalter}" → ${u.fuehrt_zu ?? "(ohne Beschriftung)"}   [${u.werkzeug}]`);
}

console.log("\n── sse_scroll_page (info) ──");
const si = await callWorker("scroll_page", { mode: "info" });
console.log(`  scrollbar=${si.scrollbar} position=${si.position} sichtbar=${si.sichtbarerAnteil}%`);

console.log("\n── sse_read_full ──");
const rf = await callWorker("read_full");
console.log(`  ${rf.ueberschrift}: ${rf.anzahl} Zeilen, gerollt=${rf.gerollt} (${rf.stufen} Stufen)`);
console.log(`  ${rf.hinweis}`);
for (const z of (rf.zeilen ?? []).slice(0, 14)) console.log(`     ${kurz(z, 110)}`);
