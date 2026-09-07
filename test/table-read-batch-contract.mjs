import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const worker = readFileSync(join(root, "powershell", "sse-worker.ps1"), "utf8");

const marker = "\n  'table_read' {";
const start = worker.indexOf(marker);
assert(start >= 0, "table_read fehlt im Worker.");
const next = worker.indexOf("\n  '", start + marker.length);
const tableRead = worker.slice(start, next >= 0 ? next : worker.length);

// Qt haelt nur die sichtbaren Zeilen im Baum. Der Cursor zieht die Ansicht
// weiter, und ein Stapel Pfeiltasten spart je Zeile eine Wartezeit und je
// Ansicht einen vollstaendigen Baumlauf. Das ist nur dann kein Ratespiel,
// wenn der Sprung kleiner bleibt als das Sichtfenster hoch ist - dann teilen
// zwei aufeinanderfolgende Ansichten mindestens eine Zeile.
assert.match(tableRead, /\$stapelObergrenze = \[Math\]::Max\(1, \[Math\]::Min\(8, \$sichtbareZeilen - 1\)\)/,
  "Die Stapelobergrenze muss aus der Hoehe des Sichtfensters folgen, nicht aus einer festen Zahl.");
assert.match(tableRead, /\$sichtbareZeilen = \[Math\]::Max\(1, @\(\$topSnapshot\.zeilen\)\.Count\)/,
  "Das Sichtfenster muss an der zuerst gelesenen Ansicht gemessen werden.");

// Der eigentliche Beweis: Ohne gemeinsame Zeile ist nicht belegt, dass
// zwischen zwei Ansichten keine Zeile lag. Eine Luecke darf nicht still
// hingenommen werden.
const ueberlappung = tableRead.indexOf("$ueberlappung = @($identitaeten | Where-Object { $letzteIdentitaeten -contains $_ }).Count");
assert(ueberlappung >= 0, "Die Ueberlappung zweier aufeinanderfolgender Ansichten wird nicht geprueft.");
const gapBranch = tableRead.indexOf("$ueberlappung -eq 0");
assert(gapBranch > ueberlappung, "Die fehlende Ueberlappung fuehrt zu keiner Entscheidung.");
const gapBody = tableRead.slice(gapBranch, gapBranch + 2000);
assert.match(gapBody, /SendWait\("\{UP \$dieserStapel\}"\)/,
  "Ein Sprung ohne Ueberlappung muss zurueckgenommen werden.");
assert.match(gapBody, /\$stapelObergrenze = \[Math\]::Max\(1, \[int\]\[Math\]::Floor\(\$dieserStapel \/ 2\)\)/,
  "Nach einer fehlenden Ueberlappung muss die Obergrenze dauerhaft sinken.");
assert.match(gapBody, /\$stapelKorrekturen \+\+?|\$stapelKorrekturen\+\+/,
  "Eine Ruecknahme muss gezaehlt und gemeldet werden.");
assert.match(gapBody, /if \(\$stapelKorrekturen -gt 5\) \{\s*\n\s*\$cursorUnavailable = \$true/,
  "Wiederholte Ruecknahmen muessen fail-closed enden statt endlos zu laufen.");

// Ein einzelner Schritt kann legitim keine Ueberlappung haben (Sichtfenster
// von einer Zeile). Nur groessere Stapel sind beweispflichtig.
assert.match(tableRead, /\$dieserStapel -gt 1 -and \$identitaeten\.Count -and \$letzteIdentitaeten\.Count -and\s*\n\s*\$ueberlappung -eq 0/,
  "Die Luecken-Erkennung darf nur fuer echte Stapel greifen.");

// Der Endbeweis bleibt unveraendert streng: zwei bestaetigte Einzelschritte
// mit unveraenderter UIA-Auswahl.
assert.match(
  tableRead,
  /\$stapelGroesse = \$\(if \(\$stableCursorMoves -gt 0\) \{ 1 \} else \{ \$stapelObergrenze \}\)/,
  "Am Tabellenende muss der Beweis mit einzelnen Tasten gefuehrt werden - und danach darf der " +
  "Stapel wieder bis zur Obergrenze wachsen, damit ein verschluckter Stapel nicht den ganzen " +
  "Rest der Tabelle einzeln abschreiten laesst.",
);
assert.match(tableRead, /if \(\$stableCursorMoves -ge 2\) \{\s*\n\s*\$endProven = \$true/,
  "Der Endbeweis ueber zwei stabile Cursorschritte fehlt.");

// Nach jedem Stapel wird gelesen; ein Stapel ohne Lesen waere eine Luecke.
const schleife = tableRead.slice(tableRead.indexOf("while ($schritte -lt $maxSchritte)"));
assert(schleife.indexOf("$snapshot = LiesZeilen $hwnd") > 0,
  "Nach jedem Stapel muss die Ansicht gelesen werden.");
assert.doesNotMatch(schleife, /\$i % 3 -eq 0/,
  "Ein festes Leseraster passt nicht mehr zur Stapelgroesse.");

process.stdout.write(
  "OK: Der Tabellenlauf geht in Stapeln und belegt ueber die Ueberlappung, dass keine Zeile uebersprungen wurde.\n",
);
