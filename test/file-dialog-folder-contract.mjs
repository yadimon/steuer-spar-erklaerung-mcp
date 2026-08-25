import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../powershell/sse-worker.ps1", import.meta.url), "utf8");
const resolverStart = worker.indexOf("function Resolve-SSEDialogFieldHandle(");
const helperStart = worker.indexOf("function Set-SSEDialogFieldText(");
const helperEnd = worker.indexOf("\n$experimentalCheckerNavigation", helperStart + 10);
assert(resolverStart >= 0 && helperStart > resolverStart, "Nativer Dialogfeld-HWND-Resolver fehlt.");
assert(helperStart >= 0 && helperEnd > helperStart, "Gemeinsamer nativer Dialogfeld-Schreibweg fehlt.");
const resolver = worker.slice(resolverStart, helperStart);
const helper = worker.slice(helperStart, helperEnd);
assert.match(resolver, /Get-SSEWindowClassName \$childHwnd/u,
  "Der Dialogfeld-Resolver muss verschachtelte Controls an ihrer nativen Klasse unterscheiden.");
assert.match(resolver, /-notmatch '\^Edit\$'/u,
  "Nur das echte native Edit-Leaf-Control darf die Control-ID-/Geometriebindung erfuellen.");
const start = worker.indexOf("  'file_dialog_select' {");
const end = worker.indexOf("\n  'save_as' {", start);
assert(start >= 0 && end > start, "file_dialog_select-Block fehlt.");
const block = worker.slice(start, end);
const folderStart = block.indexOf("    if ($isFolderDialog) {");
const genericStart = block.indexOf("    $tree = Walk-Tree", folderStart);
assert(folderStart >= 0 && genericStart > folderStart, "Ordnerdialog-Zweig fehlt.");
const folder = block.slice(folderStart, genericStart);

assert.match(helper, /\[SW\]::IsWindowUnicode\(\$FieldHandle\)/,
  "Die Pufferkodierung muss am gebundenen Edit-Control bestimmt werden.");
assert.match(helper, /SendMessageTimeoutW\(\$FieldHandle, 0x000D/,
  "Der Unicode-Readback muss WM_GETTEXTW mit Timeout verwenden.");
assert.match(helper, /SendMessageTimeoutA\(\$FieldHandle, 0x000D/,
  "Der ANSI-Readback muss WM_GETTEXTA mit Timeout verwenden.");
assert.match(helper, /SendMessageTimeoutW\(\$FieldHandle, 0x000C/,
  "Das Unicode-Leeren muss WM_SETTEXTW mit Timeout verwenden.");
assert.match(helper, /SendMessageTimeoutA\(\$FieldHandle, 0x000C/,
  "Das ANSI-Leeren muss WM_SETTEXTA mit Timeout verwenden.");
assert.match(helper, /FreeHGlobal\(\$buffer\)/,
  "Der Readback-Puffer muss auch bei Fehlern freigegeben werden.");
assert.match(helper, /FreeHGlobal\(\$emptyBuffer\)/,
  "Der Leer-Puffer muss auch bei Fehlern freigegeben werden.");
assert.match(helper, /GetGUIThreadInfo\(\$targetThreadId, \[ref\]\$guiInfo\)/,
  "Der Fokus muss direkt aus der gebundenen GUI-Thread-Queue gelesen werden.");
assert.match(helper, /\$guiInfo\.hwndFocus -ne \$FieldHandle/,
  "Vor der Eingabe muss der Fokus exakt auf das gebundene Feld zeigen.");
assert.match(helper, /\[SW\]::SendUnicodeText\(\$Text\)/,
  "Die Pfadeingabe muss unabhaengig vom aktiven Tastaturlayout erfolgen.");
assert.match(helper, /\$fieldReadback -cne \$Text/,
  "Der Feld-Readback muss exakt und case-sensitiv mit dem gebundenen Pfad verglichen werden.");
assert.match(folder, /Set-SSEDialogFieldText \$dialogHwnd \$fieldHandle \$field \$path 'Ordnerfeld'/u,
  "Der Ordnerdialog muss den gemeinsamen gebundenen Schreibweg verwenden.");
assert(folder.indexOf("Set-SSEDialogFieldText") < folder.indexOf("Click-VerifiedPoint $dialogHwnd $folderButton"),
  "Der exakte Pfad-Readback muss vor der gebundenen Ordnerauswahl erfolgen.");
assert.doesNotMatch(folder, /SendWait\('\^a'\)|SendWait\("\^a"\)/,
  "Der Ordnerdialog darf Ctrl+A nicht mehr als fehleranfaelligen Loeschpfad verwenden.");
assert.doesNotMatch(folder, /SendWait\(\(ConvertTo-SendKeysLiteral \$path\)\)/,
  "Die Pfadeingabe darf nicht vom aktiven Tastaturlayout abhaengen.");
assert.doesNotMatch(folder, /GetWindowTextW\(\$fieldHandle|SetWindowTextW\(\$fieldHandle/,
  "Der fremde Edit-Control-Inhalt darf nicht mit den prozesslokalen WindowText-APIs behandelt werden.");

const generic = block.slice(genericStart);
assert.match(generic, /Resolve-SSEDialogFieldHandle \$dialogHwnd \$field/u,
  "Der allgemeine Dateidialog muss sein natives Edit-Control geometrisch binden.");
assert.match(generic, /Set-SSEDialogFieldText \$dialogHwnd \$fieldHandle \$field \$path 'Dateiname-Feld'/u,
  "Der allgemeine Dateidialog muss den gemeinsamen gebundenen Schreibweg verwenden.");
assert.doesNotMatch(generic, /SendWait\('\^a'\)/u,
  "Der allgemeine Dateidialog darf Ctrl+A nicht zum Leeren verwenden.");

const saveAsEnd = worker.indexOf("\n  'close' {", end + 5);
const saveAs = worker.slice(end, saveAsEnd);
assert.match(saveAs, /Resolve-SSEDialogFieldHandle \$dialogHwnd \$fileField/u,
  "save_as muss sein natives Dateiname-Control geometrisch binden.");
assert.match(saveAs, /Set-SSEDialogFieldText \$dialogHwnd \$fieldHandle \$fileField \$targetPath 'Dateiname-Feld'/u,
  "save_as muss denselben gebundenen Schreibweg wie die Dateidialog-Operation verwenden.");
assert.doesNotMatch(saveAs, /SendWait\('\^a'\)/u,
  "save_as darf Ctrl+A nicht zum Leeren verwenden.");
process.stdout.write("Ordnerdialog: prozessuebergreifendes Leeren/Lesen, Fokusbindung und Unicode-Eingabe bestanden.\n");
