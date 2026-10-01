# Direkter Optionsklick in `combo_select`.
#
# Engine 31 quittiert SelectionItem.Select auf einer Option der aufgeklappten
# Liste, uebernimmt die Auswahl aber nicht. Auf dem sichtbaren Desktop wird die
# exakt gefundene Option deshalb direkt angeklickt. Dieser Vertrag haelt fest:
#
#   1. Punkt und Identitaet kommen aus der unmittelbar vor dem Klick frisch
#      gelesenen Option.
#   2. Hat sich die Option seit dem Baumlauf veraendert oder ist sie nicht mehr
#      lesbar, wird nichts geklickt: Liste zuklappen und 'stale' melden.
#   3. Der Klick traegt keine FromPoint-Bindung: Nach dem Anheben des
#      Hauptfensters liefert FromPoint am Optionspunkt gemessen den
#      Seiteninhalt unter dem Popup, obwohl der Klick die Option waehlt. Eine
#      Bindung wuerde jeden Direktklick verweigern.
#   4. Andere Engines und der versteckte Desktop behalten SelectionItem.Select.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$null, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$comboClauses = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.SwitchStatementAst] -and
  @($node.Clauses | Where-Object { $_.Item1.Extent.Text -ceq "'combo_select'" }).Count -eq 1
}, $true))
Assert-True ($comboClauses.Count -eq 1) 'Der combo_select-Zweig ist nicht eindeutig vorhanden.'
$comboBody = @($comboClauses[0].Clauses | Where-Object { $_.Item1.Extent.Text -ceq "'combo_select'" })[0].Item2
$optionChoices = @($comboBody.FindAll({
  param($node)
  $node -is [Management.Automation.Language.IfStatementAst] -and $node.Clauses.Count -eq 2 -and
  $node.Clauses[0].Item1.Extent.Text -ceq '$matches.Count -eq 0' -and
  $node.Clauses[1].Item1.Extent.Text -ceq '$matches.Count -eq 1'
}, $true))
Assert-True ($optionChoices.Count -eq 1) 'Die Auswahl einer eindeutig gefundenen Option ist nicht eindeutig vorhanden.'
$block = [scriptblock]::Create((@($optionChoices[0].Clauses[1].Item2.Statements | ForEach-Object { $_.Extent.Text }) -join "`n"))

$optionAid = 'SSE_Application.AAV4GLEngineWindow31.centralWidget.Zeitraum.QComboBoxPrivateContainer.QComboBoxListView'
function OptionNode {
  [pscustomobject]@{ type='ListItem'; name='2. Vierteljahr'; aid=$optionAid; x=600; y=340; w=180; h=24; on=$true; rid='42.7' }
}
# Frisch gelesener Zustand der Option unmittelbar vor dem Klick; ohne
# Abweichung identisch mit dem Baumlauf.
function FreshOption([hashtable]$Changes = @{}) {
  $node = OptionNode
  foreach ($key in @($Changes.Keys)) { $node.$key = $Changes[$key] }
  $node
}

function Invoke-OptionChoice {
  param([int]$Engine, [string]$DesktopName = '', $Fresh = (FreshOption))
  $script:clicks = New-Object System.Collections.ArrayList
  $script:liveReads = New-Object System.Collections.ArrayList
  $script:conversions = 0
  $script:selects = 0
  $script:collapses = 0
  $script:failed = $null
  $script:emitted = $null
  $script:SSE_ENGINE_MAJOR = $Engine
  $script:DESKTOP_NAME = $DesktopName
  $hwnd = [IntPtr]4242
  $wanted = '2. Vierteljahr'
  $matches = @(OptionNode)
  $method = 'select'
  $expectedPage = 'Umsatzsteuer-Voranmeldungen'
  $before = '1. Vierteljahr'
  $expectedAfter = $wanted
  $combo = [pscustomobject]@{ rid='42.1'; aid='SSE_Application.AAV4GLEngineWindow31.centralWidget.Zeitraum' }
  $ec = [pscustomobject]@{}
  $ec | Add-Member -MemberType ScriptMethod -Name Collapse -Value { $script:collapses++ }
  $selection = [pscustomobject]@{}
  $selection | Add-Member -MemberType ScriptMethod -Name Select -Value { $script:selects++ }
  $liveOption = [pscustomobject]@{ selection=$selection }
  $liveOption | Add-Member -MemberType ScriptMethod -Name TryGetCurrentPattern -Value {
    param($Pattern, $Out)
    $Out.Value = $this.selection
    $true
  }
  function Test-Versand { param([string]$name) $false }
  function Get-LiveElement {
    param([IntPtr]$hwnd, [string]$Rid, [string]$Aid = '')
    $null = $script:liveReads.Add([pscustomobject]@{ window=[int64]$hwnd; rid=$Rid })
    $liveOption
  }
  function Convert-ExactElementToNode { param($Element) $script:conversions++; $Fresh }
  function Click-VerifiedPoint {
    param([IntPtr]$Window, $Node, $ExpectedInputTick = $null, [switch]$RequireForeground, [int]$SettleMs = 250,
          [int]$ClickCount = 1, [int]$ForegroundAttempts = 3, [string]$ExpectedRuntimeId = '')
    $null = $script:clicks.Add([pscustomobject]@{
      window=[int64]$Window; x=$Node.x; y=$Node.y; w=$Node.w; h=$Node.h; count=$ClickCount; rid=$ExpectedRuntimeId
    })
  }
  function Get-SSELastInputTick { 7 }
  function Test-SSELastInputUnchanged { param($Baseline) $true }
  function Emit { param($result) $script:emitted = $result; throw 'combo-option-emitted' }
  function Fail { param($msg, $kind = 'error', $details = $null) $script:failed = [pscustomobject]@{ kind=$kind; error=$msg }; throw 'combo-option-failed' }
  try { . $block } catch {
    Assert-True ($_.Exception.Message -in @('combo-option-emitted', 'combo-option-failed')) `
      "Die Optionsauswahl warf unerwartet: $($_.Exception.Message)"
  }
  [pscustomobject]@{
    clicks=@($script:clicks); liveReads=@($script:liveReads); conversions=$script:conversions; selects=$script:selects
    collapses=$script:collapses; failed=$script:failed; emitted=$script:emitted; method=$method
  }
}

# 1. Engine 31 auf dem sichtbaren Desktop: genau ein Klick auf die frisch
#    gelesene Option, ohne FromPoint-Bindung und ohne Select.
$direct = Invoke-OptionChoice 31
Assert-True ($direct.liveReads.Count -eq 1 -and $direct.liveReads[0].rid -ceq '42.7' -and $direct.liveReads[0].window -eq 4242 -and
             $direct.conversions -eq 1) `
  "Die Option wurde vor dem Klick nicht frisch gelesen: $($direct.liveReads | ConvertTo-Json -Compress)"
Assert-True ($direct.clicks.Count -eq 1 -and $direct.clicks[0].count -eq 1 -and $direct.clicks[0].window -eq 4242 -and
             $direct.clicks[0].x -eq 600 -and $direct.clicks[0].y -eq 340 -and $direct.clicks[0].w -eq 180 -and $direct.clicks[0].h -eq 24) `
  "Der Direktklick traf nicht genau einmal die gebundene Option: $($direct.clicks | ConvertTo-Json -Compress)"
Assert-True ($direct.clicks[0].rid -ceq '') `
  "Der Direktklick verlangt eine FromPoint-Bindung, die am offenen Popup nie gelingt: '$($direct.clicks[0].rid)'"
Assert-True ($direct.selects -eq 0 -and $direct.method -ceq 'verified-point' -and $null -eq $direct.failed -and
             $null -eq $direct.emitted -and $direct.collapses -eq 0) `
  'Der Direktklick lief nicht als einziger Auswahlweg ohne Fehler.'

# 2. Die Option ist seit dem Baumlauf verrutscht: geklickt wird ihr frisches
#    Rechteck.
$moved = Invoke-OptionChoice 31 -Fresh (FreshOption @{ y=388 })
Assert-True ($moved.clicks.Count -eq 1 -and $moved.clicks[0].y -eq 388 -and $moved.clicks[0].x -eq 600 -and
             $null -eq $moved.failed) `
  "Der Direktklick nahm nicht das frische Rechteck: $($moved.clicks | ConvertTo-Json -Compress)"

# 3. Die Option hat sich veraendert oder ist nicht mehr lesbar: kein Klick,
#    kein Select, Liste zu, 'stale'.
$changedOptions = [ordered]@{
  'umbenannt'         = (FreshOption @{ name='3. Vierteljahr' })
  'anderer Typ'       = (FreshOption @{ type='Text' })
  'andere RuntimeId'  = (FreshOption @{ rid='42.9' })
  'nicht mehr lesbar' = $null
}
foreach ($case in $changedOptions.GetEnumerator()) {
  $changed = Invoke-OptionChoice 31 -Fresh $case.Value
  Assert-True ($changed.clicks.Count -eq 0 -and $changed.selects -eq 0) `
    "Fall '$($case.Key)': eine veraenderte Option wurde trotzdem ausgewaehlt."
  Assert-True ($changed.failed.kind -ceq 'stale' -and $null -eq $changed.emitted -and $changed.collapses -eq 1) `
    "Fall '$($case.Key)': eine veraenderte Option endete nicht als 'stale' mit zugeklappter Liste: $($changed.failed | ConvertTo-Json -Compress)"
}

# 4. Andere Engines und der versteckte Desktop behalten Select und lesen die
#    Option nicht fuer einen Klick neu.
foreach ($case in @(
  [pscustomobject]@{ name='Engine 30'; engine=30; desktop='' }
  [pscustomobject]@{ name='versteckter Desktop'; engine=31; desktop='sse-hidden' }
)) {
  $selected = Invoke-OptionChoice $case.engine $case.desktop
  Assert-True ($selected.selects -eq 1 -and $selected.clicks.Count -eq 0 -and $selected.conversions -eq 0 -and
               $selected.method -ceq 'select' -and $null -eq $selected.failed) `
    "Fall '$($case.name)': Select wurde nicht als einziger Auswahlweg verwendet."
}

Write-Output 'combo_select: Direktklick nur auf die frisch gelesene, unveraenderte Option - bestanden'
