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
# Den ausdruecklichen Zustand kann ein Prozess erst ab Windows 11 22H2
# zuruecklesen. Aeltere Systeme nehmen die Bitte an und verweigern die Abfrage;
# dort belegt die Gegenprobe genau diese Verweigerung und die Antworten des
# Helfers, statt einen gelesenen Zustand zu behaupten.
$zustandLesbar = [bool]([Environment]::OSVersion.Version.Build -ge 22621)
$erwarteterZustand = @{
  $true = [pscustomobject]@{ vorher = 'lesbar:0/0'; nachher = 'lesbar:1/0' }
  $false = [pscustomobject]@{ vorher = 'nicht-lesbar'; nachher = 'nicht-lesbar' }
}[$zustandLesbar]
$hostProbe = $hostAusgabe | ConvertFrom-Json
if ($hostProbe.before -cne $erwarteterZustand.vorher) {
  throw "Der frische Host-Stellvertreter meldet vor der Bitte '$($hostProbe.before)' statt '$($erwarteterZustand.vorher)'; die Gegenprobe waere wertlos."
}
if ($hostProbe.worker.foreign -ne $false) { throw 'Der Helfer folgte der Bitte fuer einen Prozess, der nicht sein Elternprozess ist.' }
if ($hostProbe.worker.invalid -ne $false) { throw 'Der Helfer folgte der Bitte ohne gueltige Prozess-Id.' }
if ($hostProbe.worker.genuine -ne $true) { throw 'Der Helfer folgte der Bitte seines tatsaechlichen Elternprozesses nicht.' }
if ($hostProbe.after -cne $erwarteterZustand.nachher) {
  throw "Der Hostprozess meldet nach der Bitte '$($hostProbe.after)' statt '$($erwarteterZustand.nachher)'."
}

# 6. Der Reservearbeiter durchlaeuft den Auftragsrahmen einmal trocken, damit
#    dessen erste, teure Ausfuehrung nicht in den Auftrag faellt. Was er dabei
#    aufruft, ist abschliessend aufgezaehlt: Jede Erweiterung muss hier bewusst
#    eingetragen werden, und nichts davon darf UIA oder MSAA abfragen, den
#    Sitzungsmutex nehmen, schreiben, Eingaben senden, Fenster bewegen oder warten.
$rahmenDefinitionen = @($oberste | Where-Object {
  $_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -ceq 'Invoke-SSEJobFrameWarmup'
})
$rahmenAufrufe = @($ast.FindAll({
  param($n)
  $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -ceq 'Invoke-SSEJobFrameWarmup'
}, $true))
$ersteSammlung = @($block.FindAll({
  param($n)
  $n -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $n.Extent.Text -ceq '[GC]::Collect()'
}, $true) | Sort-Object { $_.Extent.StartLineNumber })[0]
if ($rahmenDefinitionen.Count -ne 1 -or $rahmenDefinitionen[0].Extent.EndLineNumber -ge $blockStart -or
    $rahmenAufrufe.Count -ne 1 -or $rahmenAufrufe[0].Extent.Text -cne 'Invoke-SSEJobFrameWarmup' -or
    $rahmenAufrufe[0].Extent.StartLineNumber -le $warmlaufAufrufe[0].Extent.EndLineNumber -or
    $rahmenAufrufe[0].Extent.EndLineNumber -ge $ersteSammlung.Extent.StartLineNumber -or
    $ersteSammlung.Extent.EndLineNumber -ge $bereitschaft[0].Extent.StartLineNumber) {
  throw 'Der Trockenlauf des Auftragsrahmens gehoert genau einmal in den Prewarm-Block: nach dem Dispatcher-Warmlauf, vor Sammlung und Bereitschaft.'
}
$rahmen = $rahmenDefinitionen[0]
$erlaubteBefehle = [string[]]@(
  'Add-Member', 'Assert-SSEWorkerArgumentBudget', 'ConvertFrom-Json', 'ConvertTo-Json', 'ConvertTo-SSEWindowDescriptors',
  'Exit-SSEForegroundLease', 'Get-Command', 'Get-Process', 'Get-SSEBoundedArrayArg', 'Get-SSEBoundedIntegerArg',
  'Get-SSEForegroundLeaseTelemetry', 'Get-SSEInputEpochEvidence', 'Get-SSELastInputTick', 'Get-SSEProcessIdentities',
  'Get-SSEProcessIdentity', 'Join-Path', 'Read-SSEJsonFileStrict', 'Resolve-SSEWorkerArgsFile',
  'Test-SSELastInputUnchanged', 'Test-SSEPrivateTableTransport')
$rahmenBefehle = [string[]]@($rahmen.Body.FindAll({
  param($n) $n -is [Management.Automation.Language.CommandAst]
}, $true) | ForEach-Object { [string]$_.GetCommandName() } | Select-Object -Unique)
[Array]::Sort($erlaubteBefehle, [StringComparer]::Ordinal)
[Array]::Sort($rahmenBefehle, [StringComparer]::Ordinal)
if (($rahmenBefehle -join ',') -cne ($erlaubteBefehle -join ',')) {
  throw "Der Trockenlauf ruft andere Befehle auf als freigegeben: $($rahmenBefehle -join ', ')"
}
$erlaubteTypaufrufe = [string[]]@('[IO.Path]::GetTempPath()', '[SSEWindowEnumerator]::Describe([int[]]@($PID))')
$rahmenTypaufrufe = [string[]]@($rahmen.Body.FindAll({
  param($n) $n -is [Management.Automation.Language.InvokeMemberExpressionAst]
}, $true) | ForEach-Object { [string]$_.Extent.Text })
[Array]::Sort($erlaubteTypaufrufe, [StringComparer]::Ordinal)
[Array]::Sort($rahmenTypaufrufe, [StringComparer]::Ordinal)
if (($rahmenTypaufrufe -join "`n") -cne ($erlaubteTypaufrufe -join "`n")) {
  throw "Der Trockenlauf ruft andere Methoden auf als freigegeben: $($rahmenTypaufrufe -join ', ')"
}
# Die freigegebenen Arbeiterfunktionen duerfen auch ueber ihre eigenen Aufrufe
# nichts Verbotenes erreichen. Fail und Emit beenden den Prozess und werden mit
# den gueltigen Werten des Trockenlaufs nicht erreicht; der Abschluss der
# Vordergrund-Lease wird unten gesondert an seiner ersten Pruefung festgemacht.
$alleFunktionen = @{}
foreach ($datei in @(Get-ChildItem -LiteralPath (Join-Path $root 'powershell') -Filter '*.ps1')) {
  $dateiFehler = $null
  $dateiAst = [Management.Automation.Language.Parser]::ParseFile($datei.FullName, [ref]$null, [ref]$dateiFehler)
  if ($dateiFehler.Count) { throw "Parserfehler in $($datei.Name): $($dateiFehler[0].Message)" }
  foreach ($definition in @($dateiAst.FindAll({
    param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]
  }, $true))) {
    if (-not $alleFunktionen.ContainsKey($definition.Name)) { $alleFunktionen[$definition.Name] = $definition }
  }
}
$ausgenommen = [string[]]@('Emit', 'Exit-SSEForegroundLease', 'Fail')
$erreichbar = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$offen = New-Object 'System.Collections.Generic.Queue[string]'
foreach ($name in $erlaubteBefehle) { $offen.Enqueue($name) }
while ($offen.Count) {
  $name = $offen.Dequeue()
  if ($ausgenommen -contains $name -or -not $alleFunktionen.ContainsKey($name) -or -not $erreichbar.Add($name)) { continue }
  foreach ($aufruf in @($alleFunktionen[$name].Body.FindAll({
    param($n) $n -is [Management.Automation.Language.CommandAst]
  }, $true))) {
    $ziel = [string]$aufruf.GetCommandName()
    if ($ziel) { $offen.Enqueue($ziel) }
  }
}
$verboten = '\$(script:)?AE\b|\$(script:)?WLK\b|\[SSEUiaTree\]|\[SSEUiaFreshRaw\]|\[SSEAccessible\]|Windows\.Automation|' +
  'AutomationElement|Get-UiSnapshot|SSEWorkerControllerLease|mouse_event|keybd_event|SendUnicodeText|SendKeys|SendInput|' +
  'SetCursorPos|SetForegroundWindow|ActivateThroughInputSink|SendMessage|PostMessage|ShowWindow|SetWindowPos|BringWindowToTop|' +
  'Set-Content|Add-Content|Out-File|WriteAll|New-Item|Remove-Item|Start-Process|Start-Sleep|' +
  'FileMode\]::(Create|CreateNew|Append|Truncate|OpenOrCreate)|FileAccess\]::(Write|ReadWrite)|' +
  '\$(script:SSE_FOREGROUND_LEASE|lease)\.\w+\s*=[^=]'
foreach ($name in @($erreichbar)) {
  $treffer = [regex]::Match($alleFunktionen[$name].Extent.Text, $verboten, 'IgnoreCase')
  if ($treffer.Success) { throw "Der Trockenlauf erreicht ueber '$name' etwas Verbotenes: $($treffer.Value)" }
}
foreach ($pflicht in @('Resolve-SSEWorkerArgsFile', 'Read-SSEBoundedUtf8File', 'Get-SSEExecutableIdentity', 'Resolve-SSEOwnedInputTick')) {
  if (-not $erreichbar.Contains($pflicht)) { throw "Die Erreichbarkeitspruefung des Trockenlaufs hat '$pflicht' nicht erfasst." }
}
# Vor dem Auftrag gibt es keine Vordergrund-Lease. Ihr Abschluss muss deshalb
# an seiner ersten Pruefung zurueckkehren, bevor er irgendetwas beruehrt - und
# der Trockenlauf darf ihm kein Fenster nennen.
$leaseAbschluss = $alleFunktionen['Exit-SSEForegroundLease']
$abschlussAnweisungen = @($leaseAbschluss.Body.EndBlock.Statements)
$erstePruefung = @($abschlussAnweisungen | Where-Object { $_ -is [Management.Automation.Language.IfStatementAst] })[0]
$davorAnweisungen = @($abschlussAnweisungen | Where-Object { $_.Extent.StartOffset -lt $erstePruefung.Extent.StartOffset })
if ($erstePruefung.Clauses[0].Item1.Extent.Text -cne '$null -eq $lease.watch' -or
    @($erstePruefung.Clauses[0].Item2.Statements)[-1] -isnot [Management.Automation.Language.ReturnStatementAst] -or
    @($davorAnweisungen | Where-Object { $_ -isnot [Management.Automation.Language.AssignmentStatementAst] }).Count -or
    @($davorAnweisungen | Where-Object { $_.Extent.Text -match '^\$(script:SSE_FOREGROUND_LEASE|lease)\.' }).Count) {
  throw 'Der Abschluss der Vordergrund-Lease kehrt ohne Lease nicht mehr an seiner ersten Pruefung zurueck.'
}
$leaseAnfang = @($oberste | Where-Object {
  $_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -ceq '$script:SSE_FOREGROUND_LEASE'
})
if ($leaseAnfang.Count -ne 1 -or $leaseAnfang[0].Extent.Text -notmatch '(?m)^\s*watch=\$null\s*$') {
  throw 'Die Vordergrund-Lease beginnt nicht mehr nachweislich ohne laufende Uebernahme.'
}
$abschlussImRahmen = @($rahmen.Body.FindAll({
  param($n)
  $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -ceq 'Exit-SSEForegroundLease'
}, $true))
if ($abschlussImRahmen.Count -ne 1 -or
    $abschlussImRahmen[0].Extent.Text -cne "Exit-SSEForegroundLease -Force -Reason 'job-frame-warmup'") {
  throw 'Der Trockenlauf darf den Lease-Abschluss nur ohne Fenster und genau einmal durchlaufen.'
}

Write-Output "Prewarm-Block: hinter allen auftragsunabhaengigen Zeilen (bis $($blockStart - 1)), vor der ersten auftragsabhaengigen (Zeile $ersteAuftragszeile) - bestanden"
Write-Output 'Energiedrosselung: jeder Arbeiter waehlt sie vor seiner Bereitschaft fuer den eigenen Prozess ab - bestanden'
Write-Output 'Energiedrosselung: der startende Prozess nennt sich, und der Arbeiter waehlt sie nur fuer seinen tatsaechlichen Elternprozess ab - bestanden'
Write-Output "Auftragsrahmen: einmaliger Trockenlauf vor der Bereitschaft, $($erreichbar.Count) erreichbare Funktionen ohne UIA, Mutex, Eingabe, Schreiben oder Warten - bestanden"
