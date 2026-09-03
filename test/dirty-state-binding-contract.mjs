import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Haelt fest, wie der Dirty-State gelesen wird: nie ueber einen Baumlauf, der
// allein dafuer gestartet wird.
//
// `Get-DirtyState` und `Get-DirtyStateFast` liefern denselben Wert - beide
// lesen `IsEnabled` des Knotens `.MainToolBar.tb_sichern`. `Get-DirtyState`
// filtert ihn aus einem vorhandenen Baum heraus, `Get-DirtyStateFast` bindet
// ihn ueber seine exakte AutomationId. Solange die Operation den Baum ohnehin
// hat, ist die Filterung kostenlos. Ein eigens dafuer gestarteter Lauf kostet
// dagegen einen vollstaendigen Baum je Aufruf - gemessen 31 ms gegen 4 ms auf
// einer kleinen Seite, auf Tabellenseiten deutlich mehr. `table_read` tat das
// zweimal je Aufruf.
//
// Der Vertrag prueft deshalb genau diese eine Form: `Get-DirtyState` darf kein
// Argument bekommen, das den Baum erst erzeugt.

const here = dirname(fileURLToPath(import.meta.url));
const worker = readFileSync(join(here, "..", "powershell", "sse-worker.ps1"), "utf8");

const inlineWalk = /Get-DirtyState\s*\(\s*(?:Walk-Tree|Walk-BoundTree|Get-UiSnapshot)\b/gu;
const offenders = [];
for (const match of worker.matchAll(inlineWalk)) {
  offenders.push(worker.slice(0, match.index).split("\n").length);
}
assert.equal(
  offenders.length,
  0,
  `Get-DirtyState startet in Zeile(n) ${offenders.join(", ")} einen eigenen Baumlauf. ` +
    "Entweder den Baum verwenden, den die Operation ohnehin liest, oder Get-DirtyStateFast nehmen.",
);

// Die beiden Stellen, an denen das frueher stand, sind die einzigen im Worker,
// die den Dirty-State ohne eigenen Baum brauchen: der Ergebnisvertrag von
// table_read meldet ihn vor und nach dem Lesen.
const marker = "\n  'table_read' {";
const start = worker.indexOf(marker);
assert(start >= 0, "table_read fehlt im Worker.");
const next = worker.indexOf("\n  '", start + marker.length);
const tableRead = worker.slice(start, next >= 0 ? next : worker.length);
assert.match(
  tableRead,
  /\$dirtyBefore\s*=\s*Get-DirtyStateFast\s+\$hwnd/u,
  "table_read muss den Dirty-State vor dem Lesen ueber die gezielte Abfrage binden.",
);
assert.match(
  tableRead,
  /\$dirtyAfter\s*=\s*Get-DirtyStateFast\s+\$hwnd/u,
  "table_read muss den Dirty-State nach dem Lesen ueber die gezielte Abfrage binden.",
);

// Gleichwertigkeit der beiden Wege: sie muessen dasselbe Steuerelement lesen.
// Aendert jemand eine der beiden Seiten, faellt das hier auf, bevor die
// Ergebnisse still auseinanderlaufen.
const saveButtonSuffix = "MainToolBar.tb_sichern";
const slowDefinition = worker.slice(worker.indexOf("function Get-DirtyState {"));
assert(
  slowDefinition.slice(0, 600).includes(saveButtonSuffix),
  "Get-DirtyState bindet nicht mehr den Sichern-Schalter.",
);
const fastDefinition = worker.slice(worker.indexOf("function Get-DirtyStateFast("));
assert(
  fastDefinition.slice(0, 400).includes(saveButtonSuffix),
  "Get-DirtyStateFast bindet nicht mehr den Sichern-Schalter.",
);

process.stdout.write(
  "Dirty-State: kein eigener Baumlauf, table_read bindet ueber die exakte AutomationId.\n",
);
