/**
 * Prueft, welche Werkzeuge auf dem VERSTECKTEN Desktop funktionieren.
 * Dort duerften auch die sonst fokusstehlenden Wege harmlos sein, weil das
 * Fenster auf dem sichtbaren Desktop gar nicht erscheinen kann.
 */
import { callWorker } from "../dist/worker.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const TEMP = join(process.cwd(), ".tmp");
mkdirSync(TEMP, { recursive: true });

const zeig = (name, r, felder) => {
  const teile = felder.map((f) => `${f}=${JSON.stringify(r?.[f])}`).join("  ");
  console.log(`${name.padEnd(14)} ${r?.ok === false ? "FEHLER" : "ok    "}  ${teile}${r?.error ? "  " + r.error.slice(0, 110) : ""}`);
};

const p1 = await callWorker("page");
console.log(`Startseite: ${p1.ueberschrift}\n`);

zeig("keys {DOWN}", await callWorker("keys", { keys: "{DOWN}", waitMs: 400 }), ["foreground"]);
zeig("find", await callWorker("find", { name: "Weiter" }), ["count"]);
zeig("click_point", await callWorker("click_point", { name: "Weiter", waitMs: 1300 }), ["at", "method"]);

const p2 = await callWorker("page");
console.log(`\nSeite danach: ${p2.ueberschrift}`);
console.log(`Navigation hat gewirkt: ${p2.ueberschrift !== p1.ueberschrift}`);

const sc = await callWorker("screenshot", { path: join(TEMP, "hidden.png") });
console.log(`Screenshot: ${sc.shot?.w}x${sc.shot?.h} -> ${sc.shot?.path}`);
