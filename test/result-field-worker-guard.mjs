/**
 * Jedes typisierte Feld eines Ergebnisvertrags muss im echten Worker oder im
 * explizit benannten lokalen API-Executor vorkommen.
 *
 * Hintergrund: `Result_backup_cases` versprach eine Liste `files`, waehrend der
 * Worker dort eine Anzahl lieferte. Weil kein Test die Operation je wirklich
 * ausfuehrte, endete jeder echte Aufruf still mit HTTP 502. Ein erfundenes
 * Vertragsfeld ist ausserdem eine falsche Zusage an jeden Agenten, der
 * Discovery, OpenAPI oder das MCP-outputSchema liest.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { SSE_API_OPERATIONS } from "../dist/api-contract.js";
import { SSE_API_RESULT_OUTPUT_SCHEMAS } from "../dist/result-contract.js";
import { SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS } from "../dist/receipt-interaction-policy.js";

const here = dirname(fileURLToPath(import.meta.url));
const workerPath = join(here, "..", "powershell", "sse-worker.ps1");
const lines = readFileSync(workerPath, "utf8").split("\n");
const workerSource = lines.join("\n");
const gridProjectionSource = readFileSync(join(here, "..", "powershell", "table-grid-read.ps1"), "utf8");
const windowCloseSource = readFileSync(join(here, "..", "powershell", "window-close.ps1"), "utf8");
const knowledgeSource = readFileSync(join(here, "..", "powershell", "tax-knowledge.ps1"), "utf8");
const uiaDeleteSource = readFileSync(join(here, "..", "powershell", "table-uia-delete.ps1"), "utf8");
const receiptPolicySource = readFileSync(join(here, "..", "src", "receipt-interaction-policy.ts"), "utf8");
const localExecutors = new Map([
  ["backup_cases", readFileSync(join(here, "..", "src", "backup-executor.ts"), "utf8")],
  ["archive_cases", readFileSync(join(here, "..", "src", "archive-executor.ts"), "utf8")],
  ["fill_fields", readFileSync(join(here, "..", "src", "bulk-plan-executor.ts"), "utf8")],
  ["launch", readFileSync(join(here, "..", "src", "launch-executor.ts"), "utf8")],
]);

/** Transportfelder, die jeder Vertrag traegt und die der Worker generisch setzt. */
const APPENDED_TRANSPORT_FIELDS = ["ms", "focusTelemetry", "treeWalks", "treeWalkMs", "treeWalkDetail"];
const TRANSPORT_FIELDS = new Set(["ok", "kind", "error", ...APPENDED_TRANSPORT_FIELDS]);
function appendedTransportFields(body) {
  return new Set([...body.matchAll(
    /^\s*\$obj\s*\|\s*Add-Member\s+-NotePropertyName\s+([A-Za-z][A-Za-z0-9_]*)\s+-NotePropertyValue\b/gmu,
  )].map((match) => match[1]));
}
assert.deepEqual([...appendedTransportFields(
  "# $obj | Add-Member -NotePropertyName comment -NotePropertyValue 1\n" +
  "$nested | Add-Member -NotePropertyName nested -NotePropertyValue 1\n" +
  "$obj | Add-Member -NotePropertyName actual -NotePropertyValue @(1)",
)], ["actual"], "Nur an den echten Ergebnisumschlag angehaengte Felder duerfen als Transportbeleg gelten.");
const emitStart = workerSource.indexOf("\nfunction Emit(");
assert(emitStart >= 0, "Gemeinsamer Worker-Emit-Pfad fehlt.");
const emitEnd = workerSource.indexOf("\nfunction ", emitStart + 10);
const emitBody = workerSource.slice(emitStart, emitEnd >= 0 ? emitEnd : workerSource.length);
const appendedFields = appendedTransportFields(emitBody);
for (const field of APPENDED_TRANSPORT_FIELDS) {
  assert(appendedFields.has(field), `Gemeinsamer Worker-Emit-Pfad setzt '${field}' nicht.`);
}
assert(/^\s*\$obj\s*\|\s*Add-Member\s+-NotePropertyName\s+treeWalkDetail\s+-NotePropertyValue\s+@\(\$script:SSE_TREE_WALK_DETAIL\)/mu
  .test(emitBody), "Auch ein einzelner Baumlauf muss als Detail-Array emittiert werden.");
const RECEIPT_FOREGROUND_BLOCK_FIELDS = new Set([
  "reason", "retryable", "interactionRequirement", "mutationStarted", "resultingState",
  "cleanupRequired", "physicalInputUsed", "foregroundLeaseUsed",
]);
for (const field of RECEIPT_FOREGROUND_BLOCK_FIELDS) {
  assert(new RegExp(`\\b${field}\\s*=`, "u").test(workerSource),
    `Gemeinsamer Worker-Vordergrundblock setzt '${field}' nicht.`);
  assert(new RegExp(`\\b${field}\\s*:`, "u").test(receiptPolicySource),
    `Gemeinsamer API-Vordergrundblock setzt '${field}' nicht.`);
}

/**
 * Operationen, die die API selbst beantwortet. Sie erreichen den PowerShell-
 * Worker nie; ihre Felder werden von den TypeScript-Executoren erzeugt.
 */
const API_INTERNAL_OPERATIONS = [
  "capabilities",
  "case_create",
  "checker_open",
  "fill_fields",
  "scenario_run",
  "ustva_change_value",
  "ustva_open_section",
  "ustva_read",
  "ustva_select_period",
  "ustva_set_flag",
  "workspace_file_list",
  "workspace_file_read_text",
  "workspace_file_write_text",
  "workspace_status",
];

/** API-lokale Zusatzfelder dual implementierter Operationen. */
const API_LOCAL_RESULT_FIELDS = new Map([
  ["backup_cases", new Set(["copiedBeforeFailure", "rolledBack", "retainedTargets", "backupStillExists"])],
  ["archive_cases", new Set(["recoveryFiles", "retainedTargets"])],
]);

/** Felder eines lokalen Helpers, der in echte Executor-Ergebnisse gespreadet wird. */
const SHARED_API_RESULT_FIELDS = new Map([
  ["launch", {
    executor: "executeLaunchOperation",
    helper: "preservedLaunchState",
    fields: new Set(["processPreserved", "processStillRunning", "outcomeUnknown", "reconciliationRequired", "retryable"]),
  }],
]);

function emittedApiHelperFields(source, executorName, helperName) {
  const tree = ts.createSourceFile("executor.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const namedFunction = (name) => tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const helper = namedFunction(helperName);
  const executor = namedFunction(executorName);
  assert(helper?.body && executor?.body, `Lokaler Executor oder Ergebnishelper '${helperName}' fehlt.`);
  const returns = helper.body.statements.filter(ts.isReturnStatement);
  assert(returns.length === 1 && returns[0].expression && ts.isObjectLiteralExpression(returns[0].expression),
    `Ergebnishelper '${helperName}' muss ein direktes Ergebnisobjekt zurueckgeben.`);
  const fields = new Set();
  for (const property of returns[0].expression.properties) {
    if (!(ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))) continue;
    if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) fields.add(property.name.text);
  }
  let spreadIntoResult = false;
  const visit = (node) => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
      spreadIntoResult ||= node.expression.properties.some((property) => ts.isSpreadAssignment(property) &&
        ts.isCallExpression(property.expression) && ts.isIdentifier(property.expression.expression) &&
        property.expression.expression.text === helperName);
    }
    ts.forEachChild(node, visit);
  };
  visit(executor.body);
  assert(spreadIntoResult, `Ergebnishelper '${helperName}' wird nicht in ein Ergebnis von '${executorName}' gespreadet.`);
  return fields;
}

const apiHelperFixture = "function state(value) { return { explicit: true, value, nested: { absent: true } }; }\n";
assert.deepEqual([...emittedApiHelperFields(apiHelperFixture +
  "function execute() { return { ...state(1) }; }", "execute", "state")].sort(),
["explicit", "nested", "value"], "Nur Top-Level-Properties und shorthand eines gespreadeten Ergebnishelpers zaehlen.");
assert.throws(() => emittedApiHelperFields(apiHelperFixture +
  "function execute() { state(1); return { nested: { ...state(1) } }; }", "execute", "state"),
/wird nicht in ein Ergebnis/u, "Ein blosser Aufruf oder verschachtelter Spread ist kein Ergebnisproducer.");
assert.throws(() => emittedApiHelperFields(apiHelperFixture +
  "function execute() { function unused() { return { ...state(1) }; } return {}; }", "execute", "state"),
/wird nicht in ein Ergebnis/u, "Der Return einer ungenutzten inneren Funktion ist kein Executor-Ergebnis.");

for (const [operation, producer] of SHARED_API_RESULT_FIELDS) {
  assert(SSE_API_OPERATIONS.includes(operation) && !API_INTERNAL_OPERATIONS.includes(operation),
    `Unbekannte dual implementierte Operation '${operation}'.`);
  const fields = emittedApiHelperFields(localExecutors.get(operation) ?? "", producer.executor, producer.helper);
  for (const field of producer.fields) {
    assert(fields.has(field), `Lokaler Ergebnishelper '${producer.helper}' setzt '${field}' nicht mehr.`);
  }
}

/** Ergebnisfelder aus gemeinsam genutzten Worker-Hilfsfunktionen. */
const SHARED_WORKER_RESULT_FIELDS = new Map([
  ["Set-SSEDialogFieldText", new Set(["expected", "actual"])],
]);

const blockStart = new Map();
for (const [index, line] of lines.entries()) {
  const match = /^ {2}'([a-z_]+)' \{/.exec(line);
  if (match) blockStart.set(match[1], index);
}
const ordered = [...blockStart.entries()].sort((left, right) => left[1] - right[1]);
const blockBody = (operation) => {
  const start = blockStart.get(operation);
  const next = ordered.find(([, index]) => index > start)?.[1] ?? lines.length;
  return lines.slice(start, next).join("\n");
};

/**
 * Liest nur Properties der an Emit uebergebenen aeusseren PSCustomObjects.
 * Eine Regex ueber den ganzen Block akzeptiert sonst ein Vertragsfeld schon
 * dann, wenn es nur in `binding`, `rollback` oder einem anderen Unterobjekt
 * vorkommt.
 */
function emittedResultFields(body) {
  const fields = new Set();
  for (const result of emittedResultObjects(body)) {
    for (const field of result.fields) fields.add(field);
  }
  return fields;
}

/** Liest Quelltext und Top-Level-Felder aller direkt emittierten Resultate. */
function emittedResultObjects(body) {
  const results = [];
  const marker = "Emit ([pscustomobject]@{";
  for (let markerAt = body.indexOf(marker); markerAt >= 0; markerAt = body.indexOf(marker, markerAt + marker.length)) {
    const openingBrace = markerAt + marker.length - 1;
    results.push(readOuterPowerShellObject(body, openingBrace));
  }
  for (const emittedVariable of body.matchAll(/\bEmit \$([A-Za-z_][A-Za-z0-9_]*)\s*$/gmu)) {
    const assignment = new RegExp(`\\$${emittedVariable[1]}\\s*=\\s*\\[pscustomobject\\]@\\{`, "u").exec(body);
    if (!assignment) {
      results.push(...emittedWorkerHelperObjects(body, emittedVariable[1], workerSource));
      continue;
    }
    const openingBrace = assignment.index + assignment[0].length - 1;
    const result = readOuterPowerShellObject(body, openingBrace);
    const emittedSource = body.slice(assignment.index,
      emittedVariable.index + `Emit $${emittedVariable[1]}`.length);
    for (const addition of parsedEmittedVariableAdditions(emittedSource)) {
      result.fields.add(addition.field);
      result.source += `\n${addition.field}=${addition.value}`;
    }
    results.push(result);
  }
  for (const emittedCall of body.matchAll(/^\s*Emit\s+\((Invoke-SSEWindowCloseTransaction)\s+\$a\)\s*$/gmu)) {
    assertLoadedWorkerHelper("windowCloseHelpers", "window-close.ps1");
    results.push(...parsedPowerShellHelperObjects(windowCloseSource, emittedCall[1], "returns"));
  }
  for (const emittedCall of body.matchAll(/^\s*Emit\s+\((Invoke-SSETaxKnowledgeSearch)\s+\$a\)\s*$/gmu)) {
    assertLoadedWorkerHelper("knowledgeHelpers", "tax-knowledge.ps1");
    const wrapper = inspectedHelpers[inspectedHelperEntries.findIndex(entry =>
      entry.source === knowledgeSource && entry.name === emittedCall[1] && entry.mode === "delegate")];
    assert.equal(wrapper.error, null, wrapper.error ?? "");
    assert.equal(wrapper.delegate, "Invoke-SSEKnowledgeSearchPhysical");
    results.push(...parsedPowerShellHelperObjects(knowledgeSource, wrapper.delegate, "final"));
  }
  return results;
}

function assertLoadedWorkerHelper(variable, file) {
  assert(new RegExp(`^\\s*\\$${variable}\\s*=\\s*Join-Path\\s+\\$PSScriptRoot\\s+'${file.replaceAll(".", "\\.")}'\\s*$`, "mu").test(workerSource),
    `Der Worker bindet die produktive Helper-Datei '${file}' nicht eindeutig.`);
  assert(new RegExp(`^\\s*\\.\\s+\\$${variable}\\s*$`, "mu").test(workerSource),
    `Der Worker laedt die produktive Helper-Datei '${file}' nicht.`);
}

/** Follow the actual assignment, object producer and same-variable additions. */
function emittedWorkerHelperObjects(body, variable, source) {
  if (variable === "uiaDeleteResult") {
    assertLoadedWorkerHelper("tableUiaDeleteHelpers", "table-uia-delete.ps1");
    const calls = [...body.matchAll(/^\s*\$uiaDeleteResult\s*=\s*Invoke-SSEUiaTableDelete\s+\$hwnd\s+\$targetPid\s+\$a\s+\$uiaDeleteProcess\s*$/gimu)];
    assert.equal(calls.length, 1, "Das UIA-Loeschergebnis braucht genau seinen gebundenen Helper-Aufruf.");
    assert.equal([...body.matchAll(/^\s*\$(?:[A-Za-z]+:)?uiaDeleteResult\s*=/gimu)].length, 1,
      "Das belegte UIA-Loeschergebnis darf nicht ueberschrieben werden.");
    assert(calls[0].index < body.search(/\bEmit\s+\$uiaDeleteResult\b/iu), "Der UIA-Helper muss vor Emit aufgerufen werden.");
    return parsedPowerShellHelperObjects(uiaDeleteSource, "Invoke-SSEUiaTableDelete", "mutable-results");
  }
  if (variable === "projected") {
    assertLoadedWorkerHelper("tableGridHelpers", "table-grid-read.ps1");
    const assignments = [...body.matchAll(/^\s*\$projected\s*=/gmu)];
    const calls = [...body.matchAll(/^\s*\$projected\s*=\s*ConvertTo-SSEGridTableProjection\b/gmu)];
    assert.equal(assignments.length, 1, "Die emittierte Grid-Projektion darf nicht ueberschrieben werden.");
    assert.equal(calls.length, 1, "Die emittierte Grid-Projektion braucht genau ihren produktiven Helper-Aufruf.");
    const emitAt = body.indexOf("Emit $projected");
    assert(calls[0].index < emitAt, "Die Grid-Projektion muss vor Emit erzeugt werden.");
    const results = parsedPowerShellHelperObjects(gridProjectionSource, "ConvertTo-SSEGridTableProjection", "final");
    const additions = [...body.matchAll(/^\s*\$projected\s*\|\s*Add-Member\s+NoteProperty\s+([A-Za-z][A-Za-z0-9_]*)\s+([^\r\n]+)/gmu)];
    for (const addition of additions) {
      assert(addition.index > calls[0].index && addition.index < emitAt,
        "Nur vor Emit an genau die erzeugte Grid-Projektion angehaengte Felder zaehlen.");
      for (const result of results) {
        assert(!result.fields.has(addition[1]), `Grid-Ergebnisfeld '${addition[1]}' darf nicht doppelt gesetzt werden.`);
        result.fields.add(addition[1]);
        result.source += `\n${addition[1]}=${addition[2]}`;
      }
    }
    return results;
  }
  assert.equal(variable, "stepResult", `Emit-Variable '$${variable}' hat kein lokales PSCustomObject.`);
  const calls = [...body.matchAll(/^\s*\$stepResult\s*=\s*Invoke-SSETableNativeCursorStep\b/gmu)];
  assert.equal(calls.length, 1, "Der emittierte Cursorschritt muss genau einen produktiven Helper-Aufruf besitzen.");
  assert.equal([...body.matchAll(/^\s*\$stepResult\s*=/gmu)].length, 1, "Der belegte Cursorschritt darf nicht ueberschrieben werden.");
  assert(calls[0].index < body.indexOf("Emit $stepResult"), "Der belegte Helper-Aufruf muss dem Emit vorausgehen.");
  const definitions = [...source.matchAll(/^function Invoke-SSETableNativeCursorStep\s*\{/gmu)];
  assert.equal(definitions.length, 1, "Der produktive Cursorschritt-Ergebnishelper muss eindeutig sein.");
  const definition = definitions[0];
  const helper = readOuterPowerShellObject(source, definition.index + definition[0].length - 1).source;
  assert(!/^\s*return\b/mu.test(helper), "Indirekte Return-Producer im Cursorschritt brauchen einen eigenen Ergebnisnachweis.");
  const results = [];
  for (const match of helper.matchAll(/^[ \t]*\[pscustomobject\]@\{/gmu)) {
    const opening = match.index + match[0].length - 1;
    assert.equal(powerShellBraceDepth(helper, opening), 2,
      "Nur direkte aeussere Try/Catch-Ergebnisse des Cursorschritts gelten als Ergebnisproducer.");
    results.push(readOuterPowerShellObject(helper, opening));
  }
  assert.equal(results.length, 2, "Der Cursorschritt muss einen direkten Erfolg und einen direkten Fehler produzieren.");
  assert.match(results[0].source, /^\{\s*ok=\$true\b/u);
  assert.match(results[1].source, /^\{\s*ok=\$false\b/u);
  for (const field of ["kind", "error"]) assert(results[1].fields.has(field), `Cursorschritt-Fehlerumschlag ohne '${field}'.`);
  return results;
}

/** Parse source only: never dot-source or execute production helper functions. */
function inspectPowerShellHelperObjects(entries) {
  const program = String.raw`
param($entries)
$ErrorActionPreference='Stop'
$results=@(foreach($entry in $entries) {
  try {
    $errors=$null
    $tree=[Management.Automation.Language.Parser]::ParseInput([string]$entry.source,[ref]$null,[ref]$errors)
    if($errors.Count){throw 'Helper source has parse errors.'}
    if($entry.mode -ceq 'emitted-additions') {
      $emits=@($tree.FindAll({param($node)
        $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -ieq 'Emit' -and
        $node.CommandElements.Count -eq 2 -and $node.CommandElements[1] -is [Management.Automation.Language.VariableExpressionAst]
      },$true))
      $proofs=@(foreach($emit in $emits) {
        $variable=$emit.CommandElements[1].VariablePath.UserPath
        if($variable.Contains(':')){continue}
        $owner=$emit.Parent
        while($owner -and $owner -isnot [Management.Automation.Language.ScriptBlockAst]){$owner=$owner.Parent}
        $assignments=@($owner.FindAll({param($node)
          $node -is [Management.Automation.Language.AssignmentStatementAst] -and
          $node.Left -is [Management.Automation.Language.VariableExpressionAst] -and
          ($node.Left.VariablePath.UserPath -split ':')[-1] -ieq $variable
        },$true)|Where-Object{
          $scope=$_.Parent;while($scope -and $scope -isnot [Management.Automation.Language.ScriptBlockAst]){$scope=$scope.Parent}
          $scope -eq $owner -and $_.Extent.StartOffset -lt $emit.Extent.StartOffset
        })
        $initializers=@($assignments|Where-Object{
          $ancestor=$emit.Parent;$dominates=$false
          while($ancestor -and $ancestor -ne $owner){if($ancestor -eq $_.Parent){$dominates=$true;break};$ancestor=$ancestor.Parent}
          $dominates -and $_.Operator -eq 'Equals' -and
          $_.Right -is [Management.Automation.Language.CommandExpressionAst] -and
          $_.Right.Expression -is [Management.Automation.Language.ConvertExpressionAst] -and
          $_.Right.Expression.Type.TypeName.FullName -ieq 'pscustomobject' -and
          $_.Right.Expression.Child -is [Management.Automation.Language.HashtableAst]
        })
        if($initializers.Count -ne 1){continue}
        $initializer=$initializers[0]
        if(@($assignments|Where-Object{$_.Extent.StartOffset -ge $initializer.Extent.StartOffset}).Count -ne 1){continue}
        $priorEmits=@($emits|Where-Object{
          $prior=$_;$ancestor=$emit.Parent;$dominates=$false
          while($ancestor -and $ancestor -ne $owner){if($ancestor -eq $prior.Parent.Parent){$dominates=$true;break};$ancestor=$ancestor.Parent}
          $dominates -and $prior.Extent.StartOffset -gt $initializer.Extent.EndOffset -and
          $prior.Extent.StartOffset -lt $emit.Extent.StartOffset
        })
        if($priorEmits.Count){continue}
        $additions=@(foreach($pipeline in @($owner.FindAll({param($node)
          $node -is [Management.Automation.Language.PipelineAst] -and $node.PipelineElements.Count -eq 2
        },$true))) {
          if($pipeline.Extent.StartOffset -le $initializer.Extent.EndOffset -or $pipeline.Extent.EndOffset -ge $emit.Extent.StartOffset){continue}
          $scope=$pipeline.Parent;$nested=$false
          while($scope -and $scope -isnot [Management.Automation.Language.ScriptBlockAst]){
            if($scope -is [Management.Automation.Language.HashtableAst] -or $scope -is [Management.Automation.Language.AssignmentStatementAst]){$nested=$true}
            $scope=$scope.Parent
          }
          if($scope -ne $owner -or $nested){continue}
          $receiver=$pipeline.PipelineElements[0];$command=$pipeline.PipelineElements[1]
          if($receiver -isnot [Management.Automation.Language.CommandExpressionAst] -or
             $receiver.Expression -isnot [Management.Automation.Language.VariableExpressionAst] -or
             $receiver.Expression.VariablePath.UserPath -ine $variable -or
             $command -isnot [Management.Automation.Language.CommandAst] -or $command.GetCommandName() -ine 'Add-Member'){continue}
          $elements=$command.CommandElements
          $names=@(for($i=1;$i -lt $elements.Count;$i++){if($elements[$i] -is [Management.Automation.Language.CommandParameterAst] -and $elements[$i].ParameterName -ieq 'NotePropertyName'){$i}})
          $values=@(for($i=1;$i -lt $elements.Count;$i++){if($elements[$i] -is [Management.Automation.Language.CommandParameterAst] -and $elements[$i].ParameterName -ieq 'NotePropertyValue'){$i}})
          if($names.Count -ne 1 -or $values.Count -ne 1 -or $elements[$names[0]].Argument -or $elements[$values[0]].Argument){continue}
          $name=$elements[$names[0]+1];$value=$elements[$values[0]+1]
          if($name -isnot [Management.Automation.Language.StringConstantExpressionAst] -or $name.Value -cnotmatch '^[A-Za-z][A-Za-z0-9_]*$' -or
             $null -eq $value -or $value -is [Management.Automation.Language.CommandParameterAst]){continue}
          [pscustomobject]@{field=[string]$name.Value;value=$value.Extent.Text}
        })
        if($additions.Count){[pscustomobject]@{source=([string]$entry.source).Substring($initializer.Extent.StartOffset,$emit.Extent.EndOffset-$initializer.Extent.StartOffset);additions=@($additions)}}
      })
      [pscustomobject]@{objects=@();additions=@($proofs);error=$null}
      continue
    }
    $definitions=@($tree.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $entry.name},$true))
    if($definitions.Count -ne 1){throw 'Result helper definition must be unique.'}
    $definition=$definitions[0]
    $returns=@($definition.Body.FindAll({param($node) $node -is [Management.Automation.Language.ReturnStatementAst]},$true))
    if($entry.mode -ceq 'delegate') {
      $last=$definition.Body.EndBlock.Statements[-1]
      if($returns.Count -ne 0 -or $last -isnot [Management.Automation.Language.TryStatementAst] -or
         $last.CatchClauses.Count -ne 0 -or $null -eq $last.Finally -or $last.Body.Statements.Count -ne 1) {
        throw 'Result wrapper must end in one direct try/finally delegation without indirect returns.'
      }
      $pipeline=$last.Body.Statements[0]
      if($pipeline -isnot [Management.Automation.Language.PipelineAst] -or $pipeline.PipelineElements.Count -ne 1) {
        throw 'Result delegation must be a single pipeline.'
      }
      $call=$pipeline.PipelineElements[0]
      if($call -isnot [Management.Automation.Language.CommandAst] -or $call.GetCommandName() -cne $entry.target -or
         $call.CommandElements.Count -ne 2 -or $call.CommandElements[1] -isnot [Management.Automation.Language.VariableExpressionAst] -or
         $call.CommandElements[1].VariablePath.UserPath -cne 'Arguments') {
        throw 'Result wrapper must forward the original arguments to the actual result producer.'
      }
      [pscustomobject]@{objects=@();delegate=$entry.target;error=$null}
      continue
    }
    $objects=@(foreach($cast in @($definition.Body.FindAll({param($node)
      $node -is [Management.Automation.Language.ConvertExpressionAst] -and $node.Type.TypeName.FullName -ieq 'pscustomobject'
    },$true))) {
      $expression=$cast
      while($true) {
        $parent=$expression.Parent
        if(($parent -is [Management.Automation.Language.CommandExpressionAst] -and $parent.Expression -eq $expression) -or
           ($parent -is [Management.Automation.Language.PipelineAst] -and $parent.PipelineElements.Count -eq 1 -and $parent.PipelineElements[0] -eq $expression) -or
           ($parent -is [Management.Automation.Language.ParenExpressionAst] -and $parent.Pipeline -eq $expression)) {
          $expression=$parent;continue
        }
        break
      }
      $owner=$expression
      while($owner -and $owner -isnot [Management.Automation.Language.ScriptBlockAst]){$owner=$owner.Parent}
      if($owner -ne $definition.Body){continue}
      $isReturn=$expression.Parent -is [Management.Automation.Language.ReturnStatementAst]
      $isFinal=$expression.Parent -eq $definition.Body.EndBlock -and $definition.Body.EndBlock.Statements[-1] -eq $expression
      $block=$expression.Parent
      $isFinalCatch=$block -is [Management.Automation.Language.StatementBlockAst] -and
        $block.Statements[-1] -eq $expression -and $block.Parent -is [Management.Automation.Language.CatchClauseAst] -and
        $block.Parent.Parent -is [Management.Automation.Language.TryStatementAst] -and
        $block.Parent.Parent.Parent -eq $definition.Body.EndBlock
      if($entry.mode -ceq 'mutable-results' -and -not ($isReturn -or $isFinalCatch)){continue}
      if(($entry.mode -ceq 'returns' -and -not $isReturn) -or ($entry.mode -ceq 'final' -and -not $isFinal)){continue}
      $table=$cast.Child
      $additions=@()
      if($table -is [Management.Automation.Language.VariableExpressionAst] -and $entry.mode -ceq 'mutable-results') {
        $variable=$table.VariablePath.UserPath
        $assignments=@($definition.Body.FindAll({param($node)
          $node -is [Management.Automation.Language.AssignmentStatementAst] -and
          $node.Left -is [Management.Automation.Language.VariableExpressionAst] -and ($node.Left.VariablePath.UserPath -split ':')[-1] -ieq $variable
        },$true))
        if($assignments.Count -ne 1 -or $assignments[0].Operator -ne 'Equals' -or
          $assignments[0].Extent.StartOffset -ge $cast.Extent.StartOffset -or
          $assignments[0].Right -isnot [Management.Automation.Language.CommandExpressionAst] -or
          $assignments[0].Right.Expression -isnot [Management.Automation.Language.ConvertExpressionAst] -or
          $assignments[0].Right.Expression.Type.TypeName.FullName -ine 'ordered' -or
          $assignments[0].Right.Expression.Child -isnot [Management.Automation.Language.HashtableAst]) {
          throw 'Mutable result must originate in one earlier ordered literal without rebinding.'
        }
        $initializer=$assignments[0]
        $initializerOwner=$initializer.Parent
        while($initializerOwner -and $initializerOwner -isnot [Management.Automation.Language.ScriptBlockAst]){$initializerOwner=$initializerOwner.Parent}
        if($initializerOwner -ne $definition.Body){throw 'Mutable result initializer must belong to the emitting function.'}
        $initializerAncestor=$cast;$initializerDominates=$false
        while($initializerAncestor -and $initializerAncestor -ne $definition.Body){
          if($initializerAncestor -eq $initializer.Parent){$initializerDominates=$true;break}
          $initializerAncestor=$initializerAncestor.Parent
        }
        if(-not $initializerDominates){throw 'Mutable result initializer must dominate its returned cast.'}
        $table=$initializer.Right.Expression.Child
        $uses=@($definition.Body.FindAll({param($node)
          $node -is [Management.Automation.Language.VariableExpressionAst] -and ($node.VariablePath.UserPath -split ':')[-1] -ieq $variable
        },$true))
        $additions=@(foreach($use in $uses) {
          if($use.VariablePath.UserPath.Contains(':')){throw 'Scoped mutable result references need an explicit producer proof.'}
          $useOwner=$use.Parent
          while($useOwner -and $useOwner -isnot [Management.Automation.Language.ScriptBlockAst]){$useOwner=$useOwner.Parent}
          if($useOwner -ne $definition.Body){throw 'Mutable result references must remain in the emitting function.'}
          $loopAncestor=$use.Parent
          while($loopAncestor -and $loopAncestor -ne $definition.Body){
            if($loopAncestor -is [Management.Automation.Language.LoopStatementAst]){
              throw 'Mutable result references inside loops need an explicit control-flow proof.'
            }
            $loopAncestor=$loopAncestor.Parent
          }
          if($use -eq $initializer.Left){continue}
          if($use.Parent -is [Management.Automation.Language.ConvertExpressionAst] -and
            $use.Parent.Type.TypeName.FullName -ieq 'pscustomobject'){
            $consumer=$use.Parent.Parent
            while($consumer -is [Management.Automation.Language.CommandExpressionAst] -or
              $consumer -is [Management.Automation.Language.PipelineAst] -or
              $consumer -is [Management.Automation.Language.ParenExpressionAst]){$consumer=$consumer.Parent}
            if($consumer -isnot [Management.Automation.Language.ReturnStatementAst]){throw 'A mutable result cast must return directly.'}
            continue
          }
          $member=$use.Parent
          if($member -isnot [Management.Automation.Language.MemberExpressionAst] -or
            $member -is [Management.Automation.Language.InvokeMemberExpressionAst] -or $member.Expression -ne $use -or
            $member.Member -isnot [Management.Automation.Language.StringConstantExpressionAst]) {
            throw 'Mutable result aliases, dynamic members and escaping references need an explicit producer proof.'
          }
          $assignment=$member.Parent
          if($assignment -isnot [Management.Automation.Language.AssignmentStatementAst] -or $assignment.Left -ne $member){continue}
          if($assignment.Operator -ne 'Equals'){throw 'Mutable result fields must use direct assignments.'}
          if($assignment.Extent.StartOffset -le $initializer.Extent.EndOffset){throw 'Mutable result field precedes its initializer.'}
          if($assignment.Extent.StartOffset -lt $cast.Extent.StartOffset) {
            $ancestor=$cast;$dominates=$false
            while($ancestor -and $ancestor -ne $definition.Body){
              if($ancestor -eq $assignment.Parent){$dominates=$true;break}
              $ancestor=$ancestor.Parent
            }
            [pscustomobject]@{field=[string]$member.Member.Value;value=$assignment.Right.Extent.Text;
              source=([string]$member.Member.Value+'='+$assignment.Right.Extent.Text);dominates=$dominates}
          }
        })
      }
      if($table -isnot [Management.Automation.Language.HashtableAst]){continue}
      $fields=@(foreach($pair in $table.KeyValuePairs) {
        if($pair.Item1 -isnot [Management.Automation.Language.StringConstantExpressionAst]){throw 'Dynamic result property needs an explicit producer proof.'}
        [string]$pair.Item1.Value
      })
      $effectiveOk=@($table.KeyValuePairs|Where-Object{$_.Item1.Value -ieq 'ok'}|ForEach-Object{$_.Item2.Extent.Text.Trim()})
      $dominating=@($additions|Where-Object{$_.dominates})
      foreach($addition in $additions){
        if($addition.field -ieq 'ok'){
          if($addition.dominates){$effectiveOk=@($addition.value.Trim())}else{$effectiveOk=@('computed')}
        }
      }
      $guaranteedFields=@($fields)+@($dominating|ForEach-Object{$_.field})
      if($entry.mode -ceq 'mutable-results' -and ($effectiveOk.Count -ne 1 -or $effectiveOk[0] -ine '$true')){
        if('kind' -inotin $guaranteedFields -or 'error' -inotin $guaranteedFields){
          throw 'A false or computed mutable result needs guaranteed kind and error fields before return.'
        }
      }
      [pscustomobject]@{fields=@($fields)+@($additions|ForEach-Object{$_.field});source=($table.Extent.Text+[Environment]::NewLine+($additions.source -join [Environment]::NewLine));isReturn=$isReturn}
    })
    if($entry.mode -ceq 'returns' -and ($returns.Count -eq 0 -or $returns.Count -ne $objects.Count)) {
      throw 'Every helper return must directly return an outer PSCustomObject in that function.'
    }
    if($entry.mode -ceq 'final' -and ($returns.Count -ne 0 -or $objects.Count -ne 1)) {
      throw 'Projection must emit exactly one final outer PSCustomObject and no indirect returns.'
    }
    if($entry.mode -ceq 'mutable-results' -and ($returns.Count -eq 0 -or
      $returns.Count -ne @($objects|Where-Object{$_.isReturn}).Count -or
      @($objects|Where-Object{-not $_.isReturn}).Count -ne 1)) {
      throw 'Every transaction return and its final outer catch result need an inspected producer.'
    }
    [pscustomobject]@{objects=@($objects);error=$null}
  }catch{[pscustomobject]@{objects=@();error=$_.Exception.Message}}
})
ConvertTo-Json -InputObject @($results) -Depth 8 -Compress
`;
  // Keep the fixed inspector off Windows' bounded command line. Only this
  // test program executes; every supplied production source goes to ParseInput.
  const bootstrap = String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$inspectionRequest=[Console]::In.ReadToEnd() | ConvertFrom-Json
& ([ScriptBlock]::Create([string]$inspectionRequest.program)) -entries @($inspectionRequest.entries)
`;
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(bootstrap, "utf16le").toString("base64")], {
    input: JSON.stringify({ program, entries }), encoding: "utf8", windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, "PowerShell result-source AST inspection failed.");
  assert.equal(result.status, 0, result.stderr);
  const inspected = JSON.parse(result.stdout.replace(/^\uFEFF/u, "").trim());
  assert.equal(inspected.length, entries.length);
  return inspected;
}

const projectionFixture = "function ConvertTo-SSEGridTableProjection { [pscustomobject]@{ rows=@(); binding=[pscustomobject]@{nestedOnly=1} } }";
const closeFixture = "function Invoke-SSEWindowCloseTransaction { if($bad){return [pscustomobject]@{ok=$false;kind='bad';error='bad'}} return ([pscustomobject]@{ok=$true;closed=$true}) }";
const delegateFixture = "function Invoke-Wrapper($Arguments) { try { Invoke-Producer $Arguments } finally { [void]0 } }";
const mutableFixture = "function Invoke-Mutable { try { $result=[ordered]@{ok=$false;before='1'}; if($good){$result.ok=$true; return [pscustomobject]$result}; $result.kind='bad'; $result.error='bad'; return [pscustomobject]$result } catch { [pscustomobject]@{ok=$false;kind='bad';error='bad'} } }";
const emittedAdditionFixture = "$result=[pscustomobject]@{ok=$false;kind='bad';error='bad';binding=[pscustomobject]@{nestedOnly=1}}\n";
const emittedAdditionCases = [
  { source: emittedAdditionFixture + "if($details){$result | Add-Member -NotePropertyName obstruction -NotePropertyValue $details.obstruction}\nEmit $result", fields: ["obstruction"] },
  { source: emittedAdditionFixture + "$RESULT | Add-Member -NotePropertyName 'obstruction' -NotePropertyValue ([pscustomobject]@{nestedOnly=1})\nEmit $result", fields: ["obstruction"] },
  ...[
    "$other | Add-Member -NotePropertyName unrelated -NotePropertyValue 1\nEmit $result",
    "$result.binding | Add-Member -NotePropertyName nested -NotePropertyValue 1\nEmit $result",
    "# $result | Add-Member -NotePropertyName comment -NotePropertyValue 1\nEmit $result",
    "<# $result | Add-Member -NotePropertyName blockComment -NotePropertyValue 1 #>\nEmit $result",
    "'$result | Add-Member -NotePropertyName quoted -NotePropertyValue 1'\nEmit $result",
    "$unused={$result | Add-Member -NotePropertyName unused -NotePropertyValue 1}\nEmit $result",
    "function Unused {$result | Add-Member -NotePropertyName unused -NotePropertyValue 1}\nEmit $result",
    "$result=Unknown-Producer\n$result | Add-Member -NotePropertyName rebound -NotePropertyValue 1\nEmit $result",
    "$RESULT=Unknown-Producer\n$result | Add-Member -NotePropertyName rebound -NotePropertyValue 1\nEmit $result",
    "$local:result=Unknown-Producer\n$result | Add-Member -NotePropertyName rebound -NotePropertyValue 1\nEmit $result",
    "$result | Add-Member -NotePropertyName $dynamic -NotePropertyValue 1\nEmit $result",
    "Emit $result\n$result | Add-Member -NotePropertyName late -NotePropertyValue 1",
    "Emit $result\n$result | Add-Member -NotePropertyName late -NotePropertyValue 1\nEmit $result",
  ].map(source => ({ source: emittedAdditionFixture + source, fields: [] })),
];
const inspectedHelperEntries = [
  { source: gridProjectionSource, name: "ConvertTo-SSEGridTableProjection", mode: "final" },
  { source: windowCloseSource, name: "Invoke-SSEWindowCloseTransaction", mode: "returns" },
  { source: projectionFixture, name: "ConvertTo-SSEGridTableProjection", mode: "final" },
  { source: closeFixture, name: "Invoke-SSEWindowCloseTransaction", mode: "returns" },
  { source: projectionFixture.replace(" [pscustomobject]", " return $unproved; [pscustomobject]"), name: "ConvertTo-SSEGridTableProjection", mode: "final" },
  { source: closeFixture.replace("return ([pscustomobject]@{ok=$true;closed=$true})", "return $unproved"), name: "Invoke-SSEWindowCloseTransaction", mode: "returns" },
  { source: closeFixture.replace("return ([pscustomobject]@{ok=$true;closed=$true})", "function unused { return ([pscustomobject]@{ok=$true;closed=$true}) }"), name: "Invoke-SSEWindowCloseTransaction", mode: "returns" },
  { source: closeFixture.replace("return ([pscustomobject]@{ok=$true;closed=$true})", "return ([hashtable]@{ok=$true;closed=$true})"), name: "Invoke-SSEWindowCloseTransaction", mode: "returns" },
  { source: knowledgeSource, name: "Invoke-SSEKnowledgeSearchPhysical", mode: "final" },
  { source: knowledgeSource, name: "Invoke-SSETaxKnowledgeSearch", mode: "delegate", target: "Invoke-SSEKnowledgeSearchPhysical" },
  { source: delegateFixture, name: "Invoke-Wrapper", mode: "delegate", target: "Invoke-Producer" },
  { source: delegateFixture.replace("Invoke-Producer $Arguments", "$unused=Invoke-Producer $Arguments"), name: "Invoke-Wrapper", mode: "delegate", target: "Invoke-Producer" },
  { source: delegateFixture.replace("Invoke-Producer $Arguments", "Invoke-Producer $other"), name: "Invoke-Wrapper", mode: "delegate", target: "Invoke-Producer" },
  { source: delegateFixture.replace("Invoke-Producer $Arguments", "return (Invoke-Producer $Arguments)"), name: "Invoke-Wrapper", mode: "delegate", target: "Invoke-Producer" },
  { source: uiaDeleteSource, name: "Invoke-SSEUiaTableDelete", mode: "mutable-results" },
  { source: mutableFixture, name: "Invoke-Mutable", mode: "mutable-results" },
  ...[
    mutableFixture.replace("$result.kind='bad'", "$result=Unknown-Producer; $result.kind='bad'"),
    mutableFixture.replace("$result.kind='bad'", "$Result=Unknown-Producer; $result.kind='bad'"),
    mutableFixture.replace("$result.kind='bad'", "$local:result=Unknown-Producer; $result.kind='bad'"),
    mutableFixture.replace("$result.kind='bad'", "$alias=$result; $result.kind='bad'"),
    mutableFixture.replace("$result.kind='bad'", "$alias=$RESULT; $result.kind='bad'"),
    mutableFixture.replace("$result.kind='bad'", "$result[$key]='bad'"),
    mutableFixture.replace("$result.kind='bad'", "$result.Remove('ok'); $result.kind='bad'"),
    mutableFixture.replace("$result.kind='bad'", "$Result.Remove('ok'); $result.kind='bad'"),
    mutableFixture.replace("$result.kind='bad'", "Unknown-Producer $result; $result.kind='bad'"),
    mutableFixture.replace("$result.kind='bad'", "Unknown-Producer ([pscustomobject]$result); $result.kind='bad'"),
    mutableFixture.replace("$result.kind='bad'", "function Unused { $result.kind='bad' }"),
    mutableFixture.replace("return [pscustomobject]$result", "return $unproved"),
    mutableFixture.replace("$result=[ordered]@{ok=$false;before='1'}", "function Unused { $result=[ordered]@{ok=$false;before='1'} }"),
    mutableFixture.replace("$result.kind='bad'; $result.error='bad';", ""),
    mutableFixture.replace("$result.ok=$true", "$result.ok=$computed"),
    "function Invoke-Mutable { try { $result=[ordered]@{ok=$true}; if($bad){$result.ok=$false}; return [pscustomobject]$result } catch { [pscustomobject]@{ok=$false;kind='bad';error='bad'} } }",
    "function Invoke-Mutable { try { $result=[ordered]@{ok=$true}; while($again){if($good){return [pscustomobject]$result};$result.ok=$false} } catch { [pscustomobject]@{ok=$false;kind='bad';error='bad'} } }",
    "function Invoke-Mutable { try { if($good){$result=[ordered]@{ok=$false;kind='bad';error='bad'}}; return [pscustomobject]$result } catch { [pscustomobject]@{ok=$false;kind='bad';error='bad'} } }",
  ].map(source => ({ source, name: "Invoke-Mutable", mode: "mutable-results" })),
];
const emittedAdditionEntries = [workerSource, ...emittedAdditionCases.map(entry => entry.source)]
  // ParseInput receives text, whereas ParseFile consumes the UTF-8 BOM itself.
  .map(source => ({ source: source.replace(/^\uFEFF/u, ""), mode: "emitted-additions" }));
const inspections = inspectPowerShellHelperObjects([...inspectedHelperEntries, ...emittedAdditionEntries]);
const inspectedHelpers = inspections.slice(0, inspectedHelperEntries.length);
const inspectedAdditions = inspections.slice(inspectedHelperEntries.length);
function parsedEmittedVariableAdditions(source) {
  return inspectedAdditions.flatMap((inspected, index) => {
    assert.equal(inspected.error, null, `Emitted result AST source ${index}: ${inspected.error ?? ""}`);
    return inspected.additions.filter(result => result.source === source).flatMap(result => result.additions);
  });
}
function parsedPowerShellHelperObjects(source, name, mode) {
  const index = inspectedHelperEntries.findIndex(entry => entry.source === source && entry.name === name && entry.mode === mode);
  assert(index >= 0, "Uninspected external worker result helper.");
  const inspected = inspectedHelpers[index];
  assert.equal(inspected.error, null, inspected.error ?? "");
  const objects = inspected.objects.map(result => ({ fields: new Set(result.fields), source: result.source }));
  if (mode === "returns") {
    for (const result of objects) {
      assert(result.fields.has("ok"), "An external transaction result needs an outer ok field.");
      if (/^@\{\s*ok\s*=\s*\$false\b/u.test(result.source)) {
        for (const field of ["kind", "error"]) assert(result.fields.has(field), `External helper failure envelope lacks '${field}'.`);
      }
    }
  }
  return objects;
}
assert.deepEqual([...parsedPowerShellHelperObjects(projectionFixture, "ConvertTo-SSEGridTableProjection", "final")[0].fields].sort(),
  ["binding", "rows"], "Nested projection fields are not outer result evidence.");
assert.deepEqual([...new Set(parsedPowerShellHelperObjects(closeFixture, "Invoke-SSEWindowCloseTransaction", "returns")
  .flatMap(result => [...result.fields]))].sort(), ["closed", "error", "kind", "ok"]);
for (const index of [4, 5, 6, 7]) assert(inspectedHelpers[index].error,
  "Indirect, nested or non-PSCustomObject returns must not satisfy the result producer guard.");
assert.equal(inspectedHelpers[10].delegate, "Invoke-Producer");
const mutableObjects = parsedPowerShellHelperObjects(mutableFixture, "Invoke-Mutable", "mutable-results");
assert.deepEqual([...mutableObjects[0].fields].sort(), ["before", "ok"]);
assert.deepEqual([...mutableObjects[1].fields].sort(), ["before", "error", "kind", "ok"]);
for (const inspected of inspectedHelpers.slice(16)) assert(inspected.error,
  "Rebound, escaped, dynamic, indirect or nested mutable results must not satisfy the producer guard.");
for (const index of [11, 12, 13]) assert(inspectedHelpers[index].error,
  "Assigned, rebound or indirectly returned delegation must not satisfy the result producer guard.");
const projectionCall = "$projected=ConvertTo-SSEGridTableProjection $first $second 2\n" +
  "$nested | Add-Member NoteProperty unrelated 1\n$projected | Add-Member NoteProperty ok $true\nEmit $projected";
const projectionFields = emittedWorkerHelperObjects(projectionCall, "projected", workerSource)[0].fields;
assert(projectionFields.has("ok"));
assert(!projectionFields.has("unrelated"), "Add-Member on a different object is not an emitted field producer.");
assert.throws(() => emittedWorkerHelperObjects(projectionCall.replace("Emit $projected", "$projected=Unknown-Producer\nEmit $projected"),
  "projected", workerSource), /ueberschrieben/u);
assert.throws(() => emittedWorkerHelperObjects(projectionCall.replace("ConvertTo-SSEGridTableProjection", "Unknown-Producer"),
  "projected", workerSource), /produktiven Helper-Aufruf/u);
assert.throws(() => emittedWorkerHelperObjects(projectionCall + "\n$projected | Add-Member NoteProperty late 1",
  "projected", workerSource), /vor Emit/u);
const uiaDeleteCall = "$uiaDeleteResult=Invoke-SSEUiaTableDelete $hwnd $targetPid $a $uiaDeleteProcess\nEmit $uiaDeleteResult";
assert.equal(emittedWorkerHelperObjects(uiaDeleteCall, "uiaDeleteResult", workerSource).length, 4);
assert.throws(() => emittedWorkerHelperObjects(uiaDeleteCall.replace("$a $uiaDeleteProcess", "$other $uiaDeleteProcess"),
  "uiaDeleteResult", workerSource), /gebundenen Helper-Aufruf/u);
assert.throws(() => emittedWorkerHelperObjects(uiaDeleteCall.replace("Emit $uiaDeleteResult", "$uiaDeleteResult=Unknown-Producer\nEmit $uiaDeleteResult"),
  "uiaDeleteResult", workerSource), /ueberschrieben/u);
for (const variable of ["UiaDeleteResult", "local:uiaDeleteResult"]) {
  assert.throws(() => emittedWorkerHelperObjects(uiaDeleteCall.replace("Emit $uiaDeleteResult", `$${variable}=Unknown-Producer\nEmit $uiaDeleteResult`),
    "uiaDeleteResult", workerSource), /ueberschrieben/u);
}

function powerShellBraceDepth(source, until) {
  let depth = 0, quote = "", comment = false;
  for (let index = 0; index < until; index++) {
    const char = source[index], next = source[index + 1] ?? "";
    if (comment) { if (char === "\n") comment = false; continue; }
    if (quote) {
      if ((quote === "'" && char === "'" && next === "'") || (quote === '"' && char === "`")) index++;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "#") comment = true;
    else if (char === "'" || char === '"') quote = char;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
  }
  return depth;
}

function readOuterPowerShellObject(source, openingBrace) {
  const fields = new Set();
  let depth = 0;
  let quote = "";
  let lineComment = false;
  for (let index = openingBrace; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] ?? "";
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (quote) {
      if (quote === "'" && char === "'" && next === "'") {
        index += 1;
      } else if (quote === '"' && char === "`") {
        index += 1;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "#") {
      lineComment = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return { fields, source: source.slice(openingBrace, index + 1) };
      }
      continue;
    }
    if (depth !== 1 || !/[A-Za-z]/u.test(char)) continue;
    const match = /^[A-Za-z][A-Za-z0-9_]*/u.exec(source.slice(index));
    if (!match) continue;
    const before = source[index - 1] ?? "";
    const after = source.slice(index + match[0].length);
    if (before !== "$" && /^\s*=/u.test(after)) fields.add(match[0]);
    index += match[0].length - 1;
  }
  throw new Error("Unvollstaendiges Emit-PSCustomObject im Worker-Ergebnisvertrag.");
}

assert.deepEqual(
  [...emittedResultFields("Emit ([pscustomobject]@{ ok=$true; binding=[pscustomobject]@{ rid=$rid; grund='x' } })")].sort(),
  ["binding", "ok"],
  "Verschachtelte Guard-Felder duerfen nicht als Top-Level-Vertragsbeleg gelten.",
);
assert.deepEqual(
  [...emittedResultFields("$result = [pscustomobject]@{ ok=$true; value=$value }\nEmit $result")].sort(),
  ["ok", "value"],
  "Explizit aufgebaute und anschliessend emittierte Ergebnisobjekte muessen belegt bleiben.",
);
for (const fixture of emittedAdditionCases) {
  assert.deepEqual([...emittedResultFields(fixture.source)].sort(),
    ["binding", "error", "kind", "ok", ...fixture.fields].sort(),
    "Nur echte Top-Level-Add-Member-Felder derselben emittierten Variable vor Emit zaehlen.");
}
const workerHelperFixture = "function Invoke-SSETableNativeCursorStep {\n  try {\n" +
  "    [pscustomobject]@{ok=$true;steps=1;binding=[pscustomobject]@{privateOnly=1}}\n  } catch {\n" +
  "    [pscustomobject]@{ok=$false;kind='failed';error='failed'}\n  }\n}";
const workerHelperCall = "$stepResult=Invoke-SSETableNativeCursorStep $bound\nEmit $stepResult";
assert.deepEqual([...new Set(emittedWorkerHelperObjects(workerHelperCall, "stepResult", workerHelperFixture)
  .flatMap(result => [...result.fields]))].sort(), ["binding", "error", "kind", "ok", "steps"]);
assert.throws(() => emittedWorkerHelperObjects(workerHelperCall.replace("Invoke-SSETableNativeCursorStep", "Unknown-Producer"),
  "stepResult", workerHelperFixture), /Helper-Aufruf/u);
assert.throws(() => emittedWorkerHelperObjects(workerHelperCall, "otherResult", workerHelperFixture), /kein lokales PSCustomObject/u);
assert.throws(() => emittedWorkerHelperObjects(workerHelperCall.replace("Emit $stepResult", "$stepResult=Unknown-Producer\nEmit $stepResult"),
  "stepResult", workerHelperFixture), /ueberschrieben/u);
assert.throws(() => emittedWorkerHelperObjects(workerHelperCall, "stepResult",
  workerHelperFixture.replace("    [pscustomobject]@{ok=$true", "    if ($unused) {\n    [pscustomobject]@{ok=$true")
    .replace("privateOnly=1}}", "privateOnly=1}}\n    }")), /direkte aeussere/u);

const missingInWorker = SSE_API_OPERATIONS.filter(
  (operation) => !blockStart.has(operation) && !API_INTERNAL_OPERATIONS.includes(operation),
);
assert.deepEqual(missingInWorker, [],
  `Diese Operationen fehlen im Worker und sind nicht als API-intern gefuehrt: ${missingInWorker.join(", ")}`);

const wronglyInternal = API_INTERNAL_OPERATIONS.filter((operation) => blockStart.has(operation));
assert.deepEqual(wronglyInternal, [],
  `Diese Operationen sind als API-intern gefuehrt, existieren aber im Worker: ${wronglyInternal.join(", ")}`);

const unknownInternal = API_INTERNAL_OPERATIONS.filter((operation) => !SSE_API_OPERATIONS.includes(operation));
assert.deepEqual(unknownInternal, [], `Unbekannte Operation in der API-internen Liste: ${unknownInternal.join(", ")}`);

const dynamicEnvelopeViolations = [];
for (const operation of SSE_API_OPERATIONS) {
  if (API_INTERNAL_OPERATIONS.includes(operation)) continue;
  for (const result of emittedResultObjects(blockBody(operation))) {
    const okAssignment = /(?:^|[;{\r\n])\s*ok\s*=\s*([^;\r\n}]+)/u.exec(result.source);
    if (!okAssignment || /^\$(?:true|false)\b/iu.test(okAssignment[1].trim())) continue;
    const missing = ["kind", "error"].filter((field) => !result.fields.has(field));
    if (missing.length) dynamicEnvelopeViolations.push(`${operation}: ${missing.join(", ")}`);
  }
}
assert.deepEqual(dynamicEnvelopeViolations, [],
  "Berechnetes Worker-ok kann false werden, ohne einen vollstaendigen Fehlerumschlag zu liefern:\n  " +
  dynamicEnvelopeViolations.join("\n  "));

/**
 * Listenfelder duerfen nicht aus einem `$(...)`-Unterausdruck kommen.
 *
 * Hintergrund: `collect` baute `seiten=$(if ($ziel) { $null } else { @($seiten) })`.
 * PowerShell gibt aus einem Unterausdruck genau ein Element als Objekt statt
 * als Liste zurueck, also scheiterte jedes Einseitensegment am Ergebnisvertrag.
 * `@(...)` oder eine vorher gefuellte Variable haelt die Liste eine Liste.
 */
function istListenSchema(schema) {
  let current = schema;
  for (let tiefe = 0; tiefe < 6 && current?._def; tiefe += 1) {
    const typ = current._def.type;
    if (typ === "array") return true;
    if (typ !== "optional" && typ !== "nullable" && typ !== "default") return false;
    current = current._def.innerType;
  }
  return false;
}

const unterausdruckFeld = (field) =>
  new RegExp(`(^|[^A-Za-z0-9_$])${field.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*=\\s*\\$\\(`, "u");

assert(unterausdruckFeld("seiten").test("Emit ([pscustomobject]@{ seiten=$(if ($z) { $null } else { @($s) }) })"),
  "Der Listenwaechter muss die historische collect-Form erkennen.");
assert(!unterausdruckFeld("seiten").test("Emit ([pscustomobject]@{ seiten=@($s) })"),
  "Ein echtes Array-Literal darf der Listenwaechter nicht melden.");

const unwrappedLists = [];
let checkedLists = 0;
for (const operation of SSE_API_OPERATIONS) {
  if (API_INTERNAL_OPERATIONS.includes(operation)) continue;
  const listFields = Object.entries(SSE_API_RESULT_OUTPUT_SCHEMAS[operation].shape)
    .filter(([field, schema]) => !TRANSPORT_FIELDS.has(field) && istListenSchema(schema))
    .map(([field]) => field);
  if (listFields.length === 0) continue;
  for (const result of emittedResultObjects(blockBody(operation))) {
    for (const field of listFields) {
      checkedLists += 1;
      if (unterausdruckFeld(field).test(result.source)) unwrappedLists.push(`${operation}.${field}`);
    }
  }
}
assert(checkedLists > 0, "Der Listenwaechter hat kein einziges Listenfeld gesehen.");
assert.deepEqual(unwrappedLists, [],
  "Diese Listenfelder kommen aus einem $(...)-Unterausdruck und werden bei genau einem Element zum Objekt:\n  " +
  unwrappedLists.join("\n  "));

for (const [helper, fields] of SHARED_WORKER_RESULT_FIELDS) {
  const helperStart = workerSource.indexOf(`function ${helper}(`);
  const helperEnd = workerSource.indexOf("\nfunction ", helperStart + 10);
  const helperBody = workerSource.slice(helperStart, helperEnd >= 0 ? helperEnd : workerSource.length);
  assert(helperStart >= 0, `Gemeinsame Ergebnis-Hilfsfunktion '${helper}' fehlt.`);
  for (const field of fields) {
    assert(new RegExp(`\\b${field}\\s*=`, "u").test(helperBody),
      `Gemeinsame Ergebnis-Hilfsfunktion '${helper}' setzt '${field}' nicht mehr.`);
  }
}

const phantoms = [];
let checkedFields = 0;
for (const operation of SSE_API_OPERATIONS) {
  if (API_INTERNAL_OPERATIONS.includes(operation)) continue;
  const body = blockBody(operation);
  const emittedFields = emittedResultFields(body);
  for (const field of SHARED_API_RESULT_FIELDS.get(operation)?.fields ?? []) emittedFields.add(field);
  for (const [helper, fields] of SHARED_WORKER_RESULT_FIELDS) {
    if (!body.includes(`${helper} `)) continue;
    for (const field of fields) emittedFields.add(field);
  }
  for (const field of Object.keys(SSE_API_RESULT_OUTPUT_SCHEMAS[operation].shape)) {
    if (TRANSPORT_FIELDS.has(field)) continue;
    if (
      SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS.includes(operation) &&
      RECEIPT_FOREGROUND_BLOCK_FIELDS.has(field)
    ) {
      continue;
    }
    checkedFields += 1;
    const localField = API_LOCAL_RESULT_FIELDS.get(operation)?.has(field) === true;
    const assignedLocally = new RegExp(`(^|[^A-Za-z0-9_$])${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`, "m");
    const emittedLocally = new RegExp(`(^|[^A-Za-z0-9_$])${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "m");
    const localExecutor = localExecutors.get(operation) ?? "";
    if (localField ? !(assignedLocally.test(localExecutor) || emittedLocally.test(localExecutor)) : !emittedFields.has(field)) {
      phantoms.push(`${operation}.${field}`);
    }
  }
}

assert.deepEqual(phantoms, [],
  "Diese Vertragsfelder verspricht die API, ohne dass Worker oder lokaler Executor sie setzen:\n  " +
  phantoms.join("\n  "));

process.stdout.write(
  `Ergebnisvertrag gegen Worker: ${checkedFields} typisierte Felder in ` +
  `${SSE_API_OPERATIONS.length - API_INTERNAL_OPERATIONS.length} Worker-Operationen belegt\n`,
);
