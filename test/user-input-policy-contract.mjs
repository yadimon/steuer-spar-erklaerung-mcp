import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SSE_API_OPERATIONS } from "../dist/api-contract.js";
import { SSE_CAPABILITIES } from "../dist/capabilities.js";
import { apiErrorResult } from "../dist/mcp-response.js";
import { createProfileOperationCapability } from "../dist/profile-operation-policy.js";
import {
  SSE_INPUT_EPOCH_REPORT_ONLY_WORKER_OPERATIONS,
  SSE_INPUT_FREE_COMPOSED_OPERATIONS,
  SSE_INPUT_GUARDED_COMPOSED_OPERATIONS,
  SSE_INPUT_GUARDED_WORKER_OPERATIONS,
  SSE_USER_INPUT,
  SSE_USER_INPUT_POLICIES,
  userInputDescriptionTag,
  userInputPolicy,
} from "../dist/user-input-policy.js";

// Welche Operationen eine Eingabepause des Menschen brauchen, ist keine
// Einschaetzung: Es sind genau die Worker-Klauseln, die den Vordergrund holen
// oder die systemweite Eingabe-Epoche lesen koennen. Die Huelle wird hier am
// Syntaxbaum des Workers und seiner Hilfsskripte berechnet.
const closureProgram = `
$ErrorActionPreference = 'Stop'
$directory = '${fileURLToPath(new URL("../powershell/", import.meta.url)).replaceAll("'", "''")}'
$functions = @{}
foreach ($file in Get-ChildItem -LiteralPath $directory -Filter '*.ps1') {
  $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$null, [ref]$errors)
  if ($errors.Count) { throw "$($file.Name): $($errors[0].Message)" }
  foreach ($definition in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
    if (-not $functions.ContainsKey($definition.Name)) { $functions[$definition.Name] = $definition }
  }
}
function Get-CalledNames($node) {
  @($node.FindAll({ param($n) $n -is [Management.Automation.Language.CommandAst] }, $true) |
    ForEach-Object { $_.GetCommandName() } | Where-Object { $_ } | Select-Object -Unique)
}
$reaching = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($entry in @('Show-SSEWindow','Enter-SSEForegroundLease','Enter-SSEPopupForeground','Set-SSEForegroundWindowCore','Get-SSELastInputTick')) {
  if (-not $functions.ContainsKey($entry)) { throw "Missing entry point: $entry" }
  [void]$reaching.Add($entry)
}
$calls = @{}
foreach ($name in $functions.Keys) { $calls[$name] = @(Get-CalledNames $functions[$name].Body | Where-Object { $functions.ContainsKey($_) }) }
do {
  $added = 0
  foreach ($name in $functions.Keys) {
    if (-not $reaching.Contains($name) -and @($calls[$name] | Where-Object { $reaching.Contains($_) }).Count) { [void]$reaching.Add($name); $added++ }
  }
} while ($added)
$dispatcher = @($functions['Invoke-SSEWorkerOperation'].Body.FindAll({ param($n) $n -is [Management.Automation.Language.SwitchStatementAst] }, $false))[0]
$all = [string[]]@($dispatcher.Clauses | ForEach-Object { $_.Item1.Extent.Text.Trim("'") })
$guarded = [string[]]@($dispatcher.Clauses | Where-Object { @(Get-CalledNames $_.Item2 | Where-Object { $reaching.Contains($_) }).Count } |
  ForEach-Object { $_.Item1.Extent.Text.Trim("'") })
[Array]::Sort($all, [StringComparer]::Ordinal)
[Array]::Sort($guarded, [StringComparer]::Ordinal)
[Console]::Write(($all -join ',') + '|' + ($guarded -join ','))
`;
const closure = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
  Buffer.from(closureProgram, "utf16le").toString("base64")], {
  encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024,
});
assert.equal(closure.error, undefined, "Die Aufrufhuelle der Eingabewaechter konnte nicht berechnet werden.");
assert.equal(closure.status, 0, closure.stderr);
const [workerOperations, guardedWorkerOperations] = closure.stdout.trim().split("|").map((list) => list.split(","));
const ordinal = (names) => [...names].sort();

assert.deepEqual(
  ordinal([...SSE_INPUT_GUARDED_WORKER_OPERATIONS, ...SSE_INPUT_EPOCH_REPORT_ONLY_WORKER_OPERATIONS]),
  guardedWorkerOperations,
  "Die erklaerte Liste der eingabeempfindlichen Worker-Operationen weicht von der Aufrufhuelle des Workers ab.",
);
assert.deepEqual([...SSE_INPUT_GUARDED_WORKER_OPERATIONS], ordinal(SSE_INPUT_GUARDED_WORKER_OPERATIONS),
  "Die Liste bleibt sortiert, damit ein Vergleich mit der Aufrufhuelle lesbar bleibt.");
for (const operation of SSE_INPUT_EPOCH_REPORT_ONLY_WORKER_OPERATIONS) {
  assert.equal(SSE_INPUT_GUARDED_WORKER_OPERATIONS.includes(operation), false,
    `${operation} kann nicht zugleich nur berichten und waechten.`);
}

// Jede API-Operation ohne eigene Worker-Klausel ist ausdruecklich eingeordnet:
// Eine neue zusammengesetzte Operation kann die Entscheidung nicht verfehlen.
const composed = SSE_API_OPERATIONS.filter((operation) => !workerOperations.includes(operation));
assert.deepEqual(
  ordinal(composed),
  ordinal([...SSE_INPUT_GUARDED_COMPOSED_OPERATIONS, ...SSE_INPUT_FREE_COMPOSED_OPERATIONS]),
  "Jede API-Operation ohne Worker-Klausel braucht genau eine Einordnung fuer Eingaben des Menschen.",
);

const handsOff = new Set([
  ...guardedWorkerOperations.filter((operation) => !SSE_INPUT_EPOCH_REPORT_ONLY_WORKER_OPERATIONS.includes(operation)),
  ...SSE_INPUT_GUARDED_COMPOSED_OPERATIONS,
]);
const expectedPolicy = new Map(SSE_API_OPERATIONS.map((operation) => [operation, "free"]));
for (const operation of SSE_API_OPERATIONS.filter((candidate) => handsOff.has(candidate))) expectedPolicy.set(operation, "hands-off");
expectedPolicy.set("table_read", "hands-off-with-cursor-run");
for (const operation of SSE_API_OPERATIONS) {
  assert.equal(userInputPolicy(operation), expectedPolicy.get(operation), `Eingaberegel fuer ${operation}`);
  assert.equal(createProfileOperationCapability("supported", "full", false, operation).userInput, expectedPolicy.get(operation),
    `Die Selbstbeschreibung nennt fuer ${operation} eine andere Eingaberegel.`);
}
assert.equal(userInputPolicy("page"), "free");
assert.equal(userInputPolicy("product_info"), "free");
assert.equal(userInputPolicy("receipt_manager_list"), "free");
assert.equal(userInputPolicy("goto"), "hands-off");
assert.equal(userInputPolicy("fill_fields"), "hands-off");
assert.equal(userInputPolicy("toggle"), "hands-off");
assert.equal(userInputPolicy("table_add"), "hands-off");
assert.equal(userInputPolicy("table_add_rows"), "hands-off",
  "Die Mehrzeilenanlage holt das Fenster nach vorn; Tasten des Menschen wuerden im Programm landen.");
assert.equal(userInputPolicy("table_read"), "hands-off-with-cursor-run");

assert.deepEqual(SSE_CAPABILITIES.userInput, SSE_USER_INPUT);
assert.deepEqual(Object.keys(SSE_USER_INPUT.policies), [...SSE_USER_INPUT_POLICIES]);
assert.equal(SSE_USER_INPUT.interferenceKind, "interference");
assert.match(SSE_USER_INPUT.rule, /retryable:true/u);

// Die Marke eines Werkzeugs folgt der strengsten Regel seiner Operationen.
assert.equal(userInputDescriptionTag(["page", "read_page"]), undefined);
assert.equal(userInputDescriptionTag(["page", "goto"]), "[Eingabepause]");
assert.equal(userInputDescriptionTag(["table_add_rows"]), "[Eingabepause]");
assert.equal(userInputDescriptionTag(["table_read"]), "[Eingabepause nur bei noKeys:false]");
assert.equal(userInputDescriptionTag(["page", "table_read"]), "[Eingabepause nur bei noKeys:false]");
assert.equal(userInputDescriptionTag(["table_read", "table_update"]), "[Eingabepause]");

// Ein Stopp durch Eingaben traegt die Anweisung an den Agenten im Ergebnis.
const hintOf = (result) => apiErrorResult("table_add_rows", result).structuredContent.hint;
assert.match(hintOf({ ok: false, kind: "interference", retryable: true, resultingState: "partially-completed-verified" }),
  /Zustand ist belegt[\s\S]*completedCount und sumAfter[\s\S]*nur den fehlenden Teil/u);
assert.match(hintOf({ ok: false, kind: "interference", retryable: false, resultingState: "unchanged" }),
  /frisch lesen; nichts blind wiederholen/u);
assert.doesNotMatch(hintOf({ ok: false, kind: "interference", retryable: false }), /erneut anfordern/u);
assert.match(hintOf({ ok: false, kind: "interference", retryable: true, outcomeUnknown: true, reconciliationRequired: true }),
  /Ausgang des API-Auftrags ist ungewiss/u, "Ein ungewisser Ausgang geht jeder Wiederholung vor.");
assert.equal(hintOf({ ok: false, kind: "precondition-failed" }), undefined);
// Weicht die Tabelle nach dem Schreiben vom Auftrag ab, fragt der Agent den Menschen, statt zu wiederholen.
assert.match(hintOf({ ok: false, kind: "postcondition-failed", mutationStarted: true, resultingState: "values-restored" }),
  /frisch lesen und mit dem Auftrag vergleichen[\s\S]*Den Menschen fragen/u);
assert.equal(apiErrorResult("table_add", { ok: false, kind: "postcondition-failed", mutationStarted: true }).structuredContent.hint,
  undefined, "Der Hinweis gehoert zur Mehrzeilenanlage, deren Beleg der gelesene Tabellenzustand ist.");

process.stdout.write("user-input-policy-contract: Eingaberegeln folgen der Aufrufhuelle des Workers; Marken, Selbstbeschreibung und Stopp-Hinweis stimmen.\n");
