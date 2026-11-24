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

# 4. Der Verzicht auf die Energiedrosselung gehoert JEDEM Arbeiter und vor die
#    Bereitschaft. Windows drosselt Prozesse ohne Vordergrundfenster unter
#    Energiesparplaenen wenige Sekunden nach ihrem Start; ein Reservearbeiter
#    wartet meist laenger. Stuende der Aufruf hinter der Bereitschaft oder nur im
#    Kaltpfad, liefe genau der vorbereitete Arbeiter gedrosselt.
$drosselVerzicht = @($oberste | Where-Object {
  $_ -is [Management.Automation.Language.TryStatementAst] -and $_.Extent.Text -match 'DisableOwnPowerThrottling'
})
$verzichtsAufrufe = @($ast.FindAll({
  param($n)
  $n -is [Management.Automation.Language.InvokeMemberExpressionAst] -and
    $n.Member.Value -ceq 'DisableOwnPowerThrottling'
}, $true))
if ($drosselVerzicht.Count -ne 1 -or $verzichtsAufrufe.Count -ne 1 -or
    $drosselVerzicht[0].Extent.Text -cne 'try { $null = [SW]::DisableOwnPowerThrottling() } catch { }' -or
    $drosselVerzicht[0].Extent.EndLineNumber -ge $blockStart) {
  throw 'Genau ein bedingungsloser, fehlertoleranter Verzicht auf die Energiedrosselung vor dem Prewarm-Block erwartet.'
}
$nativerLader = @($oberste | Where-Object {
  $_ -isnot [Management.Automation.Language.FunctionDefinitionAst] -and $_.Extent.Text -match 'Import-SSENativeInterop'
})
if ($nativerLader.Count -ne 1 -or $nativerLader[0].Extent.EndLineNumber -ge $drosselVerzicht[0].Extent.StartLineNumber) {
  throw 'Der Verzicht auf die Energiedrosselung braucht den zuvor geladenen nativen Helfer.'
}
# Der Helfer muss ausdruecklich "nicht gedrosselt" setzen. Ein gesetztes
# Zustandsbit wuerde den Arbeiter im Gegenteil dauerhaft drosseln.
$nativerQuelltext = [IO.File]::ReadAllText((Join-Path $root 'powershell\sse-native.cs'))
$helferStart = $nativerQuelltext.IndexOf('public static bool DisableOwnPowerThrottling()')
if ($helferStart -lt 0) { throw 'Nativer Verzicht auf die Energiedrosselung fehlt.' }
$helfer = $nativerQuelltext.Substring($helferStart, $nativerQuelltext.IndexOf("`n  }`n", $helferStart) - $helferStart)
foreach ($pflicht in @('state.Version = 1;', 'state.ControlMask = 1;', 'state.StateMask = 0;',
    'SetProcessInformation(OwnProcessHandle(), 4, ref state')) {
  if (-not $helfer.Contains($pflicht)) { throw "Nativer Verzicht auf die Energiedrosselung ohne '$pflicht'." }
}
# Gegenprobe am echten Helfer: Windows nimmt den Verzicht fuer den eigenen Prozess an.
. (Join-Path $root 'powershell\load-native.ps1')
$null = Import-SSENativeInterop
if ([SW]::DisableOwnPowerThrottling() -ne $true) {
  throw 'Windows hat den Verzicht auf die Energiedrosselung des eigenen Prozesses nicht angenommen.'
}

# 5. Der Prozess, der die Arbeiter startet, laeuft ebenfalls dauerhaft ohne
#    Fenster und bliebe fuer jede weitergereichte Anfrage gedrosselt. Er kann den
#    Aufruf nicht selbst absetzen und nennt deshalb seinen Arbeitern die eigene
#    Prozess-Id. Jeder Arbeiter folgt der Bitte vor seiner Bereitschaft - aber
#    nur fuer den tatsaechlichen Elternprozess, nie fuer einen fremden.
$hostVerzicht = @($oberste | Where-Object {
  $_ -is [Management.Automation.Language.IfStatementAst] -and $_.Extent.Text -match 'DisableHostPowerThrottling'
})
$hostAufrufe = @($ast.FindAll({
  param($n)
  $n -is [Management.Automation.Language.InvokeMemberExpressionAst] -and
    $n.Member.Value -ceq 'DisableHostPowerThrottling'
}, $true))
$erwarteterHostVerzicht = @(
  'if ([int]::TryParse([string]$env:SSE_INTERNAL_HOST_PROCESS_ID, [ref]$hostProcessId)) {',
  '  try { $null = [SW]::DisableHostPowerThrottling($hostProcessId) } catch { }',
  '}'
) -join "`n"
if ($hostVerzicht.Count -ne 1 -or $hostAufrufe.Count -ne 1 -or
    ($hostVerzicht[0].Extent.Text -replace "`r", '') -cne $erwarteterHostVerzicht -or
    $hostVerzicht[0].Extent.StartLineNumber -le $drosselVerzicht[0].Extent.EndLineNumber -or
    $hostVerzicht[0].Extent.EndLineNumber -ge $blockStart) {
  throw 'Genau ein fehlertoleranter Verzicht fuer den genannten Hostprozess zwischen eigenem Verzicht und Prewarm-Block erwartet.'
}
# Der startende Prozess muss sich selbst nennen - mit genau dem Namen, den der Arbeiter liest.
$umgebungsQuelltext = [IO.File]::ReadAllText((Join-Path $root 'src\worker-table-capability.ts'))
foreach ($pflicht in @('const hostProcessKey = "SSE_INTERNAL_HOST_PROCESS_ID";', '[hostProcessKey]: String(process.pid)')) {
  if (-not $umgebungsQuelltext.Contains($pflicht)) { throw "Die Arbeiterumgebung nennt den startenden Prozess nicht ('$pflicht')." }
}
# Der Helfer darf nur dem tatsaechlichen Elternprozess folgen: die genannte Id
# muss der eigene Elternprozess sein, und der darf nicht juenger sein als der
# Arbeiter - eine wiederverwendete Id gehoerte einem spaeter erzeugten Prozess.
$hostHelferStart = $nativerQuelltext.IndexOf('public static bool DisableHostPowerThrottling(int hostProcessId)')
if ($hostHelferStart -lt 0) { throw 'Nativer Verzicht fuer den Hostprozess fehlt.' }
$hostHelfer = $nativerQuelltext.Substring($hostHelferStart, $nativerQuelltext.IndexOf("`n  }`n", $hostHelferStart) - $hostHelferStart)
foreach ($pflicht in @(
    'if (hostProcessId <= 0) return false;',
    'if (basics.InheritedFromUniqueProcessId.ToInt64() != hostProcessId) return false;',
    'hostCreated > ownCreated) return false;',
    'state.Version = 1;', 'state.ControlMask = 1;', 'state.StateMask = 0;',
    'SetProcessInformation(host, 4, ref state',
    'if (host != IntPtr.Zero) DSK.CloseHandle(host);')) {
  if (-not $hostHelfer.Contains($pflicht)) { throw "Nativer Verzicht fuer den Hostprozess ohne '$pflicht'." }
}
# Gegenprobe an echten Prozessen: Ein frischer Host-Stellvertreter hat keinen
# ausdruecklichen Zustand. Sein Arbeiter-Stellvertreter bittet zuerst fuer
# diesen Testprozess (lebend, aber nicht sein Elternprozess) und ohne gueltige
# Id - beides muss abgelehnt werden - und erst dann fuer den echten Elternprozess.
$hostStart = New-Object Diagnostics.ProcessStartInfo
$hostStart.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$hostStart.Arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
  (Join-Path $PSScriptRoot 'fixtures\power-throttling-host.ps1') + '" -Root "' + $root + '" -ForeignProcessId ' + $PID
$hostStart.UseShellExecute = $false
$hostStart.CreateNoWindow = $true
$hostStart.RedirectStandardOutput = $true
$hostStart.RedirectStandardError = $true
$hostProzess = [Diagnostics.Process]::Start($hostStart)
try {
  $hostFehler = $hostProzess.StandardError.ReadToEndAsync()
  $hostAusgabe = $hostProzess.StandardOutput.ReadToEnd()
  $hostProzess.WaitForExit()
  if ($hostProzess.ExitCode -ne 0) { throw "Host-Stellvertreter scheiterte: $($hostFehler.Result)" }
} finally {
  $hostProzess.Dispose()
}
$hostProbe = $hostAusgabe | ConvertFrom-Json
if ($hostProbe.before.control -ne 0 -or $hostProbe.before.state -ne 0) {
  throw 'Der frische Host-Stellvertreter hatte bereits einen ausdruecklichen Drosselzustand; die Gegenprobe waere wertlos.'
}
if ($hostProbe.worker.foreign -ne $false) { throw 'Der Helfer folgte der Bitte fuer einen Prozess, der nicht sein Elternprozess ist.' }
if ($hostProbe.worker.invalid -ne $false) { throw 'Der Helfer folgte der Bitte ohne gueltige Prozess-Id.' }
if ($hostProbe.worker.genuine -ne $true) { throw 'Der Helfer folgte der Bitte seines tatsaechlichen Elternprozesses nicht.' }
if ($hostProbe.after.control -ne 1 -or $hostProbe.after.state -ne 0) {
  throw "Der Hostprozess ist nach der Bitte nicht ausdruecklich ungedrosselt (control=$($hostProbe.after.control), state=$($hostProbe.after.state))."
}

Write-Output "Prewarm-Block: hinter allen auftragsunabhaengigen Zeilen (bis $($blockStart - 1)), vor der ersten auftragsabhaengigen (Zeile $ersteAuftragszeile) - bestanden"
Write-Output 'Energiedrosselung: jeder Arbeiter waehlt sie vor seiner Bereitschaft fuer den eigenen Prozess ab - bestanden'
Write-Output 'Energiedrosselung: der startende Prozess nennt sich, und der Arbeiter waehlt sie nur fuer seinen tatsaechlichen Elternprozess ab - bestanden'
