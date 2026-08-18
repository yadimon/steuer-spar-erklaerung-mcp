import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../powershell/sse-worker.ps1", import.meta.url), "utf8");
const start = worker.indexOf("  'file_dialog_select' {");
const end = worker.indexOf("\n  'save_as' {", start);
assert(start >= 0 && end > start, "file_dialog_select-Block fehlt.");
const block = worker.slice(start, end);
const folderStart = block.indexOf("    if ($isFolderDialog) {");
const genericStart = block.indexOf("    $tree = Walk-Tree", folderStart);
assert(folderStart >= 0 && genericStart > folderStart, "Ordnerdialog-Zweig fehlt.");
const folder = block.slice(folderStart, genericStart);

assert.match(folder, /\[SW\]::IsWindowUnicode\(\$fieldHandle\)/,
  "Die Pufferkodierung muss am gebundenen Edit-Control bestimmt werden.");
assert.match(folder, /SendMessageTimeoutW\(\$fieldHandle, 0x000D/,
  "Der Unicode-Readback muss WM_GETTEXTW mit Timeout verwenden.");
assert.match(folder, /SendMessageTimeoutA\(\$fieldHandle, 0x000D/,
  "Der ANSI-Readback muss WM_GETTEXTA mit Timeout verwenden.");
assert.match(folder, /SendMessageTimeoutW\(\$fieldHandle, 0x000C/,
  "Das Unicode-Leeren muss WM_SETTEXTW mit Timeout verwenden.");
assert.match(folder, /SendMessageTimeoutA\(\$fieldHandle, 0x000C/,
  "Das ANSI-Leeren muss WM_SETTEXTA mit Timeout verwenden.");
assert.match(folder, /FreeHGlobal\(\$buffer\)/,
  "Der Readback-Puffer muss auch bei Fehlern freigegeben werden.");
assert.match(folder, /FreeHGlobal\(\$emptyBuffer\)/,
  "Der Leer-Puffer muss auch bei Fehlern freigegeben werden.");
assert.match(folder, /GetGUIThreadInfo\(\$targetThreadId, \[ref\]\$guiInfo\)/,
  "Der Fokus muss direkt aus der gebundenen GUI-Thread-Queue gelesen werden.");
assert.match(folder, /\$guiInfo\.hwndFocus -ne \$fieldHandle/,
  "Vor der Eingabe muss der Fokus exakt auf das gebundene Feld zeigen.");
assert.match(folder, /\[SW\]::SendUnicodeText\(\$path\)/,
  "Die Pfadeingabe muss unabhaengig vom aktiven Tastaturlayout erfolgen.");
assert.match(folder, /\$fieldReadback -cne \$path/,
  "Der Feld-Readback muss exakt und case-sensitiv mit dem gebundenen Pfad verglichen werden.");
assert(folder.indexOf("$fieldReadback -cne $path") < folder.indexOf("Click-VerifiedPoint $dialogHwnd $folderButton"),
  "Der exakte Pfad-Readback muss vor der gebundenen Ordnerauswahl erfolgen.");
assert.doesNotMatch(folder, /SendWait\('\^a'\)|SendWait\("\^a"\)/,
  "Der Ordnerdialog darf Ctrl+A nicht mehr als fehleranfaelligen Loeschpfad verwenden.");
assert.doesNotMatch(folder, /SendWait\(\(ConvertTo-SendKeysLiteral \$path\)\)/,
  "Die Pfadeingabe darf nicht vom aktiven Tastaturlayout abhaengen.");
assert.doesNotMatch(folder, /GetWindowTextW\(\$fieldHandle|SetWindowTextW\(\$fieldHandle/,
  "Der fremde Edit-Control-Inhalt darf nicht mit den prozesslokalen WindowText-APIs behandelt werden.");
process.stdout.write("Ordnerdialog: prozessuebergreifendes Leeren/Lesen, Fokusbindung und Unicode-Eingabe bestanden.\n");
