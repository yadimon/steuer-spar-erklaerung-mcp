# Der Prewarm-Block steht hinter ALLEN auftragsunabhaengigen Zeilen - und vor
# der ersten, die den Auftrag braucht.
#
# Warum das zaehlt: Ein vorgewaermter Arbeiter fuehrt alles aus, was VOR seiner
# Bereitschaftsmeldung steht, waehrend niemand auf ihn wartet. Alles danach
# zahlt der Aufrufer. Der Block stand lange rund 5000 Zeilen zu frueh; die
# Ausfuehrung dieser Zeilen lag damit im Aufrufpfad jeder Operation (gemessen
# 74 ms). Wandert er wieder nach oben, kehrt dieser Aufschlag zurueck.
#
# Nach unten ist er ebenso begrenzt: Ab der ersten Anweisung, die $Op oder $a
# liest, waere er falsch - ein Reservearbeiter kennt seinen Auftrag erst nach
# der Bereitschaftsmeldung. Genau diese Grenze prueft der Test, und zwar nicht
# an Zeilennummern, sondern am Syntaxbaum.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$null, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

$oberste = @($ast.EndBlock.Statements)

# Der Block ist die Anweisung auf oberster Ebene, die die Bereitschaftszeile schreibt.
$prewarmBloecke = @($oberste | Where-Object {
  $_ -is [Management.Automation.Language.IfStatementAst] -and $_.Extent.Text -match "prewarm='ready'"
})
if ($prewarmBloecke.Count -ne 1) {
  throw "Genau ein Prewarm-Block mit Bereitschaftsmeldung erwartet, gefunden: $($prewarmBloecke.Count)."
}
$block = $prewarmBloecke[0]
$blockStart = $block.Extent.StartLineNumber
$blockEnde = $block.Extent.EndLineNumber

# Die einzige Dispatcherdefinition ist eine direkte Anweisung desselben
# Skript-Scopes. Weder ein zweiter Kaltpfad noch dynamisches Auswerten des
# Dispatcherquelltexts darf nach der Bereitschaft wieder Arbeit erzeugen.
$dispatcherDefinitionen = @($ast.FindAll({
  param($n)
  $n -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $n.Name -ceq 'Invoke-SSEWorkerOperation'
}, $true))
if ($dispatcherDefinitionen.Count -ne 1 -or
    $dispatcherDefinitionen[0] -notin $oberste -or
    $dispatcherDefinitionen[0].Extent.EndLineNumber -ge $blockStart) {
  throw 'Genau eine direkte Dispatcherdefinition vor dem Prewarm-Block erwartet.'
}

$sentinelReturn = @($dispatcherDefinitionen[0].Body.EndBlock.Statements)[0]
if ($sentinelReturn -isnot [Management.Automation.Language.IfStatementAst] -or
    $sentinelReturn.Extent.Text -cne
      'if ($Operation -ceq $script:SSE_DISPATCHER_WARMUP) { return }') {
  throw 'Der Warmlauf muss vor jeder echten Operationsanweisung ohne Wirkung zurueckkehren.'
}

$warmlaufAufrufe = @($block.FindAll({
  param($n)
  $n -is [Management.Automation.Language.CommandAst] -and
    $n.GetCommandName() -ceq 'Invoke-SSEWorkerOperation'
}, $true))
if ($warmlaufAufrufe.Count -ne 1 -or
    $warmlaufAufrufe[0].Extent.Text -cne
      'Invoke-SSEWorkerOperation $script:SSE_DISPATCHER_WARMUP $null') {
  throw 'Prewarm muss den Dispatcher genau einmal mit dem internen Sentinel aufwaermen.'
}
$bereitschaft = @($block.FindAll({
  param($n)
  $n -is [Management.Automation.Language.InvokeMemberExpressionAst] -and
    $n.Member.Value -ceq 'WriteLine' -and $n.Extent.Text -match "prewarm='ready'"
}, $true))
if ($bereitschaft.Count -ne 1 -or
    $warmlaufAufrufe[0].Extent.EndLineNumber -ge $bereitschaft[0].Extent.StartLineNumber) {
  throw 'Der Dispatcher-Warmlauf muss vor genau einer Bereitschaftsmeldung enden.'
}
$dynamischeAuswertung = @($block.FindAll({
  param($n)
  if ($n -is [Management.Automation.Language.CommandAst]) {
    return $n.GetCommandName() -in @('Invoke-Expression','iex') -or
      $n.InvocationOperator -eq [Management.Automation.Language.TokenKind]::Dot
  }
  return $n -is [Management.Automation.Language.InvokeMemberExpressionAst] -and
    $n.Member.Value -ceq 'Create' -and
    $n.Expression -is [Management.Automation.Language.TypeExpressionAst] -and
    $n.Expression.TypeName.FullName -in @(
      'ScriptBlock','Management.Automation.ScriptBlock','System.Management.Automation.ScriptBlock'
    )
}, $true))
if ($dynamischeAuswertung.Count) {
  throw 'Prewarm darf Dispatcherquelltext nicht dynamisch erzeugen oder auswerten.'
}

# Welche Anweisungen auf oberster Ebene lesen den Auftrag?
$auftragsVariablen = @('Op', 'a', 'ArgsFile', 'B64')
$auftragsAnweisungen = @($oberste | Where-Object {
  $_ -isnot [Management.Automation.Language.FunctionDefinitionAst] -and
  $_.Extent.StartLineNumber -ne $blockStart -and
  @($_.FindAll({
      param($n) $n -is [Management.Automation.Language.VariableExpressionAst]
    }, $true) | Where-Object { $auftragsVariablen -contains $_.VariablePath.UserPath }).Count -gt 0
})

# 1. Vor dem Block darf KEINE Anweisung auf oberster Ebene den Auftrag lesen -
#    ausser den beiden Kaltstart-Zeilen, die genau dafuer da sind.
$davor = @($auftragsAnweisungen | Where-Object { $_.Extent.EndLineNumber -lt $blockStart })
$erlaubtDavor = @($davor | Where-Object { $_.Extent.Text -match 'if \(-not \$Prewarm\) \{ Initialize-SSEWorker' })
$unerlaubt = @($davor | Where-Object { $_ -notin $erlaubtDavor })
if ($unerlaubt.Count) {
  $orte = ($unerlaubt | ForEach-Object { "Zeile $($_.Extent.StartLineNumber)" }) -join ', '
  throw "Vor dem Prewarm-Block liest eine Anweisung bereits den Auftrag ($orte). Der Block muesste davor stehen."
}

# 2. Nach dem Block MUSS es auftragsabhaengige Anweisungen geben - sonst steht
#    er zu weit unten und der Kaltpfad haette seine Reihenfolge verloren.
$danach = @($auftragsAnweisungen | Where-Object { $_.Extent.StartLineNumber -gt $blockEnde })
if (-not $danach.Count) {
  throw 'Nach dem Prewarm-Block folgt keine auftragsabhaengige Anweisung mehr; die Platzierung ist unplausibel.'
}

# 3. Der Block darf nicht wieder nach vorn wandern: Zwischen ihm und der ersten
#    auftragsabhaengigen Anweisung darf keine Anweisung auf oberster Ebene mehr
#    liegen, die auftragsunabhaengig ist - sonst zahlt sie wieder der Aufrufer.
$ersteAuftragszeile = ($danach | Sort-Object { $_.Extent.StartLineNumber })[0].Extent.StartLineNumber
$dazwischen = @($oberste | Where-Object {
  $_.Extent.StartLineNumber -gt $blockEnde -and
  $_.Extent.EndLineNumber -lt $ersteAuftragszeile
})
if ($dazwischen.Count) {
  $orte = ($dazwischen | ForEach-Object { "Zeile $($_.Extent.StartLineNumber)" }) -join ', '
  throw "Zwischen Prewarm-Block und erster auftragsabhaengiger Anweisung liegen noch $($dazwischen.Count) Anweisung(en) ($orte). Sie gehoeren vor den Block."
}

Write-Output "Prewarm-Block: hinter allen auftragsunabhaengigen Zeilen (bis $($blockStart - 1)), vor der ersten auftragsabhaengigen (Zeile $ersteAuftragszeile) - bestanden"
