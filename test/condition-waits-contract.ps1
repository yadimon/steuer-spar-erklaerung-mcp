# Bedingte Wartezeiten fuer CheckBox, ComboBox, Sichern, Tabellenzellen und Menue-Popups.
#
# Vier feste Fristen wurden durch Warten auf genau die Bedingung ersetzt, fuer
# die sie standen. Jede alte Frist bleibt Obergrenze. Der Vertrag fuehrt die
# echten Hilfsfunktionen mit vorgegebenen Beobachtungen aus und haelt fest:
#
#   1. Ein Fruehausstieg braucht das volle Signal. Fuer die CheckBox ist das
#      Zielzustand UND ein beobachteter Wechsel von 'gesichert' zu
#      'geaendert'; war der Fall vorher schon geaendert oder ist das unbekannt,
#      laeuft die volle Frist.
#   2. Werte werden zeichengenau verglichen; ein Lesefehler ist kein Signal.
#   3. 'Sichern' gilt erst als erledigt, wenn es ueber die Bestaetigungsfrist
#      ohne Unterbrechung deaktiviert bleibt.
#   4. Die Aufrufstellen behalten die alten Fristen als Obergrenze.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$workerSource = Get-Content -LiteralPath $workerPath -Raw
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$null, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

. (Join-Path $root 'powershell\table-values.ps1')
foreach ($name in @('Wait-SSEToggleSettled', 'Wait-SSEComboValue', 'Wait-SSEComboExpansionState', 'Wait-SSESaveButtonDisabled', 'Wait-SSETableCellValue', 'Wait-SSEMenuPopup')) {
  $definitions = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  Assert-True ($definitions.Count -eq 1) "$name ist nicht eindeutig vorhanden."
  Invoke-Expression $definitions[0].Extent.Text
}

# Ein Element, dessen Current-Lesungen der Reihe nach die vorgegebenen
# Beobachtungen liefern; die letzte bleibt stehen. Jede Lesung wird mit ihrem
# Zeitpunkt gezaehlt.
$clock = [Diagnostics.Stopwatch]::StartNew()
function New-ObservedElement([string]$Property, [object[]]$Sequence) {
  $element = [pscustomobject]@{
    property=$Property; sequence=$Sequence; reads=(New-Object System.Collections.ArrayList)
  }
  $element | Add-Member -MemberType ScriptProperty -Name Current -Value {
    $value = $this.sequence[[Math]::Min($this.reads.Count, $this.sequence.Count - 1)]
    $null = $this.reads.Add($script:clock.ElapsedMilliseconds)
    [pscustomobject]@{ $this.property = $value }
  }
  $element
}
function New-FailingElement {
  $element = [pscustomobject]@{ reads=(New-Object System.Collections.ArrayList) }
  $element | Add-Member -MemberType ScriptProperty -Name Current -Value {
    $null = $this.reads.Add($script:clock.ElapsedMilliseconds)
    throw 'Element nicht mehr verfuegbar.'
  }
  $element
}

$script:liveReads = New-Object System.Collections.ArrayList
$script:liveElement = $null
function Get-LiveElement {
  param([IntPtr]$hwnd, [string]$Rid, [string]$Aid = '')
  $null = $script:liveReads.Add([pscustomobject]@{ window=[int64]$hwnd; rid=$Rid; aid=$Aid })
  $script:liveElement
}
function Measure-Wait([scriptblock]$Wait) {
  $script:liveReads.Clear()
  $started = $script:clock.ElapsedMilliseconds
  $result = & $Wait
  [pscustomobject]@{ result=$result; elapsedMs=($script:clock.ElapsedMilliseconds - $started); liveReads=@($script:liveReads) }
}

# --- 1. CheckBox --------------------------------------------------------------
$saveTree = [pscustomobject]@{ nodes = @(
  [pscustomobject]@{ type='Button'; name='Sichern'; aid='SSE_Application.AAV4GLEngineWindow31.MainToolBar.tb_sichern'; rid='9.1' }
) }
$noSaveTree = [pscustomobject]@{ nodes = @() }
$hwnd = [IntPtr]4242

# Vorher gesichert, Zielzustand und 'geaendert' stehen sofort: eine Runde.
$toggle = New-ObservedElement 'ToggleState' @('On')
$script:liveElement = New-ObservedElement 'IsEnabled' @($true)
$settled = Measure-Wait { Wait-SSEToggleSettled $toggle $saveTree $hwnd $true $false 2000 }
Assert-True ($settled.result -eq $true -and $toggle.reads.Count -eq 1 -and $script:liveElement.reads.Count -eq 1) `
  'Die CheckBox wartete trotz vollstaendigem Signal weiter.'
Assert-True ($settled.liveReads.Count -eq 1 -and $settled.liveReads[0].rid -ceq '9.1' -and $settled.liveReads[0].window -eq 4242) `
  "Die Sichern-Schaltflaeche wurde nicht aus dem gelaufenen Baum gebunden: $($settled.liveReads | ConvertTo-Json -Compress)"

# Das Signal entsteht erst nach einigen Runden: genau dann zurueck.
$toggle = New-ObservedElement 'ToggleState' @('Off', 'On')
$script:liveElement = New-ObservedElement 'IsEnabled' @($false, $false, $true)
$late = Measure-Wait { Wait-SSEToggleSettled $toggle $saveTree $hwnd $true $false 2000 }
Assert-True ($late.result -eq $true -and $script:liveElement.reads.Count -eq 3) `
  "Die CheckBox kehrte nicht genau mit dem ersten vollstaendigen Signal zurueck ($($script:liveElement.reads.Count) Lesungen)."

# Abgewaehlt heisst Zielzustand 'Off'.
$toggle = New-ObservedElement 'ToggleState' @('Off')
$script:liveElement = New-ObservedElement 'IsEnabled' @($true)
$off = Measure-Wait { Wait-SSEToggleSettled $toggle $saveTree $hwnd $false $false 2000 }
Assert-True ($off.result -eq $true -and $toggle.reads.Count -eq 1) 'Eine abgewaehlte CheckBox erkannte ihren Zielzustand nicht.'

# Ohne volles Signal laeuft die volle Frist und das Ergebnis ist $false. Ein
# fehlgeschlagener Abruf liefert in PowerShell $null und ist kein Signal.
$fullTimeout = @(
  [pscustomobject]@{ name='vorher schon geaendert'; tree=$saveTree; wanted=$true; dirtyBefore=$true; boundSave=$false
                     toggle=(New-ObservedElement 'ToggleState' @('On')); save=(New-ObservedElement 'IsEnabled' @($true)) }
  [pscustomobject]@{ name='keine Sichern-Schaltflaeche'; tree=$noSaveTree; wanted=$true; dirtyBefore=$false; boundSave=$false
                     toggle=(New-ObservedElement 'ToggleState' @('On')); save=(New-ObservedElement 'IsEnabled' @($true)) }
  [pscustomobject]@{ name='Fall bleibt gesichert'; tree=$saveTree; wanted=$true; dirtyBefore=$false; boundSave=$true
                     toggle=(New-ObservedElement 'ToggleState' @('On')); save=(New-ObservedElement 'IsEnabled' @($false)) }
  [pscustomobject]@{ name='Zielzustand bleibt aus'; tree=$saveTree; wanted=$true; dirtyBefore=$false; boundSave=$true
                     toggle=(New-ObservedElement 'ToggleState' @('Off')); save=(New-ObservedElement 'IsEnabled' @($true)) }
  [pscustomobject]@{ name='Zustand nur unbestimmt'; tree=$saveTree; wanted=$true; dirtyBefore=$false; boundSave=$true
                     toggle=(New-ObservedElement 'ToggleState' @('Indeterminate')); save=(New-ObservedElement 'IsEnabled' @($true)) }
  [pscustomobject]@{ name='Sichern nicht lesbar'; tree=$saveTree; wanted=$true; dirtyBefore=$false; boundSave=$true
                     toggle=(New-ObservedElement 'ToggleState' @('On')); save=(New-FailingElement) }
  [pscustomobject]@{ name='CheckBox nicht lesbar'; tree=$saveTree; wanted=$true; dirtyBefore=$false; boundSave=$true
                     toggle=(New-FailingElement); save=(New-ObservedElement 'IsEnabled' @($true)) }
)
foreach ($case in $fullTimeout) {
  $toggle = $case.toggle
  $script:liveElement = $case.save
  $waited = Measure-Wait { Wait-SSEToggleSettled $toggle $case.tree $hwnd $case.wanted $case.dirtyBefore 250 }
  Assert-True ($waited.result -eq $false -and $waited.elapsedMs -ge 250) `
    "CheckBox, Fall '$($case.name)': kein voller Ablauf der Frist ($($waited.elapsedMs) ms, Ergebnis $($waited.result))."
  Assert-True (($waited.liveReads.Count -eq 1) -eq $case.boundSave) `
    "CheckBox, Fall '$($case.name)': die Sichern-Schaltflaeche wurde falsch gebunden ($($waited.liveReads.Count) Lesungen)."
}

# Die Aufrufstelle wertet einen unbekannten Vorzustand wie 'schon geaendert'.
Assert-True ($workerSource.Contains('$null = Wait-SSEToggleSettled $togglePattern $tree $hwnd $wanted ($dirtyBefore -ne $false) 500')) `
  'Der Toggle wartet nicht mehr mit der alten Frist oder wertet einen unbekannten Vorzustand als gesichert.'

# --- 2. ComboBox --------------------------------------------------------------
$expanded = [System.Windows.Automation.ExpandCollapseState]::Expanded
$collapsed = [System.Windows.Automation.ExpandCollapseState]::Collapsed
$partial = [System.Windows.Automation.ExpandCollapseState]::PartiallyExpanded
foreach ($case in @(
  [pscustomobject]@{ name='schon offen'; wanted=$true; sequence=@($expanded); reads=1 }
  [pscustomobject]@{ name='vollstaendig offen nach Zwischenzustand'; wanted=$true; sequence=@($collapsed,$partial,$expanded); reads=3 }
  [pscustomobject]@{ name='schon geschlossen'; wanted=$false; sequence=@($collapsed); reads=1 }
  [pscustomobject]@{ name='spaeter geschlossen'; wanted=$false; sequence=@($expanded,$collapsed); reads=2 }
)) {
  $pattern = New-ObservedElement 'ExpandCollapseState' $case.sequence
  $stateWait = Measure-Wait { Wait-SSEComboExpansionState $pattern $case.wanted 2000 }
  Assert-True ($stateWait.result -eq $true -and $pattern.reads.Count -eq $case.reads) `
    "ComboBox '$($case.name)': Rueckkehr ohne den exakten bestaetigten Zustand."
}
foreach ($case in @(
  [pscustomobject]@{ name='nur teilweise offen'; wanted=$true; pattern=(New-ObservedElement 'ExpandCollapseState' @($partial)) }
  [pscustomobject]@{ name='weiter geschlossen'; wanted=$true; pattern=(New-ObservedElement 'ExpandCollapseState' @($collapsed)) }
  [pscustomobject]@{ name='weiter offen'; wanted=$false; pattern=(New-ObservedElement 'ExpandCollapseState' @($expanded)) }
  [pscustomobject]@{ name='Zustand unbekannt'; wanted=$false; pattern=(New-ObservedElement 'ExpandCollapseState' @($null)) }
  [pscustomobject]@{ name='Element nicht mehr verfuegbar'; wanted=$false; pattern=(New-FailingElement) }
)) {
  $stateWait = Measure-Wait { Wait-SSEComboExpansionState $case.pattern $case.wanted 100 }
  Assert-True ($stateWait.result -eq $false -and $stateWait.elapsedMs -ge 100) `
    "ComboBox '$($case.name)': unbekannter oder falscher Zustand galt als bestaetigt."
}
Assert-True ([regex]::Matches($workerSource, [regex]::Escape('$null = Wait-SSEComboExpansionState $ec $true 450')).Count -eq 2) `
  'Optionslesen und Auswahl muessen beide mit der bisherigen Oeffnungsfrist beobachten.'
Assert-True ($workerSource.Contains('if (-not $freshPattern -or -not (Wait-SSEComboExpansionState $freshPattern $false 200))')) `
  'Optionslesen muss das Schliessen ueber den frisch gebundenen Zustand bestaetigen.'
$deadlinePattern = [pscustomobject]@{watch=[Diagnostics.Stopwatch]::StartNew()}
$deadlinePattern | Add-Member -MemberType ScriptProperty -Name Current -Value {
  [pscustomobject]@{ExpandCollapseState=$(if ($this.watch.ElapsedMilliseconds -ge 90) {
    [System.Windows.Automation.ExpandCollapseState]::Collapsed
  } else { [System.Windows.Automation.ExpandCollapseState]::Expanded })}
}
Assert-True (Wait-SSEComboExpansionState $deadlinePattern $false 100) `
  'Ein im letzten Pollintervall geschlossener Dropdown braucht noch eine abschliessende Beobachtung.'

$combo = [pscustomobject]@{ rid='42.1'; aid='SSE_Application.AAV4GLEngineWindow31.centralWidget.Zeitraum' }
function New-ComboElement([object[]]$Values) {
  $element = [pscustomobject]@{ pattern=(New-ObservedElement 'Value' $Values) }
  $element | Add-Member -MemberType ScriptMethod -Name TryGetCurrentPattern -Value {
    param($Pattern, $Out)
    $Out.Value = $this.pattern
    $true
  }
  $element
}

$script:liveElement = New-ComboElement @('2. Vierteljahr')
$comboNow = Measure-Wait { Wait-SSEComboValue $hwnd $combo '2. Vierteljahr' 2000 }
Assert-True ($comboNow.result -eq $true -and $script:liveElement.pattern.reads.Count -eq 1) `
  'Die ComboBox wartete trotz gemeldetem Zielwert weiter.'
Assert-True ($comboNow.liveReads.Count -eq 1 -and $comboNow.liveReads[0].rid -ceq '42.1' -and $comboNow.liveReads[0].aid -ceq $combo.aid) `
  "Die ComboBox wurde nicht ueber RuntimeId und AutomationId gebunden: $($comboNow.liveReads | ConvertTo-Json -Compress)"

$script:liveElement = New-ComboElement @('1. Vierteljahr', '1. Vierteljahr', '2. Vierteljahr')
$comboLate = Measure-Wait { Wait-SSEComboValue $hwnd $combo '2. Vierteljahr' 2000 }
Assert-True ($comboLate.result -eq $true -and $script:liveElement.pattern.reads.Count -eq 3) `
  'Die ComboBox kehrte nicht genau mit dem ersten gemeldeten Zielwert zurueck.'

foreach ($case in @(
  [pscustomobject]@{ name='Wert bleibt stehen'; element=(New-ComboElement @('1. Vierteljahr')) }
  [pscustomobject]@{ name='nur Gross-/Kleinschreibung gleich'; element=(New-ComboElement @('2. VIERTELJAHR')) }
  [pscustomobject]@{ name='ComboBox nicht greifbar'; element=$null }
)) {
  $script:liveElement = $case.element
  $waited = Measure-Wait { Wait-SSEComboValue $hwnd $combo '2. Vierteljahr' 250 }
  Assert-True ($waited.result -eq $false -and $waited.elapsedMs -ge 250 -and $waited.liveReads.Count -ge 2) `
    "ComboBox, Fall '$($case.name)': kein voller, weiter lesender Ablauf der Frist ($($waited.elapsedMs) ms, Ergebnis $($waited.result))."
}
Assert-True (([regex]::Matches($workerSource, [regex]::Escape('$null = Wait-SSEComboValue $hwnd $combo $wanted 550'))).Count -eq 2) `
  'Die ComboBox-Auswahl wartet nicht mehr an beiden Stellen mit der alten Frist als Obergrenze.'

# --- 3. Sichern ---------------------------------------------------------------
# Sofort deaktiviert: zurueck erst nach der vollen Bestaetigungsfrist.
$save = New-ObservedElement 'IsEnabled' @($false)
$saved = Measure-Wait { Wait-SSESaveButtonDisabled $save 2000 120 }
Assert-True ($saved.result -eq $true -and $save.reads.Count -ge 2 -and
             ($save.reads[$save.reads.Count - 1] - $save.reads[0]) -ge 115) `
  "Sichern galt vor Ablauf der Bestaetigungsfrist als erledigt ($($save.reads.Count) Lesungen)."

# Kurz aktiv dazwischen: die Bestaetigungsfrist beginnt von vorn.
$save = New-ObservedElement 'IsEnabled' @($false, $true, $false)
$flapped = Measure-Wait { Wait-SSESaveButtonDisabled $save 2000 120 }
Assert-True ($flapped.result -eq $true -and $save.reads.Count -ge 4 -and
             ($save.reads[$save.reads.Count - 1] - $save.reads[2]) -ge 115) `
  'Eine erneute Aktivierung setzte die Bestaetigungsfrist fuer Sichern nicht zurueck.'

foreach ($case in @(
  [pscustomobject]@{ name='bleibt aktiv'; element=(New-ObservedElement 'IsEnabled' @($true)) }
  [pscustomobject]@{ name='Lesefehler'; element=(New-FailingElement) }
)) {
  $waited = Measure-Wait { Wait-SSESaveButtonDisabled $case.element 250 50 }
  Assert-True ($waited.result -eq $false -and $waited.elapsedMs -ge 250 -and $case.element.reads.Count -ge 2) `
    "Sichern, Fall '$($case.name)': kein voller, weiter lesender Ablauf der Frist ($($waited.elapsedMs) ms, Ergebnis $($waited.result))."
}
Assert-True ($workerSource.Contains('$null = Wait-SSESaveButtonDisabled $saveElement $waitMs 150')) `
  'Sichern wartet nicht mehr mit waitMs als Obergrenze und der Bestaetigungsfrist.'

# --- 4. Tabellenzelle ---------------------------------------------------------
# Nach SetValue zaehlt der erste gleichwertige Zellinhalt; ein Lesefehler ist
# kein Signal - auch nicht beim Leeren einer Zelle, wo $null wie '' aussaehe.
$script:liveElement = New-ComboElement @('API-Mega 42')
$cellNow = Measure-Wait { Wait-SSETableCellValue $hwnd '7.1' 'API-Mega 42' 2000 }
Assert-True ($cellNow.result -eq $true -and $script:liveElement.pattern.reads.Count -eq 1 -and $cellNow.liveReads[0].rid -ceq '7.1') `
  'Die Tabellenzelle wartete trotz gemeldetem Wert weiter oder war falsch gebunden.'
$script:liveElement = New-ComboElement @('', '', 'API-Mega 42')
$cellLate = Measure-Wait { Wait-SSETableCellValue $hwnd '7.1' 'API-Mega 42' 2000 }
Assert-True ($cellLate.result -eq $true -and $script:liveElement.pattern.reads.Count -eq 3) `
  'Die Tabellenzelle kehrte nicht genau mit dem ersten gemeldeten Wert zurueck.'
$failingCell = [pscustomobject]@{ pattern=(New-FailingElement) }
$failingCell | Add-Member -MemberType ScriptMethod -Name TryGetCurrentPattern -Value { param($Pattern, $Out) $Out.Value = $this.pattern; $true }
foreach ($case in @(
  [pscustomobject]@{ name='Wert bleibt alt'; element=(New-ComboElement @('alt')); requested='API-Mega 42' }
  [pscustomobject]@{ name='Lesefehler beim Leeren'; element=$failingCell; requested='' }
  [pscustomobject]@{ name='Zelle nicht greifbar'; element=$null; requested='API-Mega 42' }
)) {
  $script:liveElement = $case.element
  $waited = Measure-Wait { Wait-SSETableCellValue $hwnd '7.1' $case.requested 250 }
  Assert-True ($waited.result -eq $false -and $waited.elapsedMs -ge 250 -and $waited.liveReads.Count -ge 2) `
    "Tabellenzelle, Fall '$($case.name)': kein voller, weiter lesender Ablauf der Frist ($($waited.elapsedMs) ms, Ergebnis $($waited.result))."
}
Assert-True (([regex]::Matches($workerSource, [regex]::Escape('$null = Wait-SSETableCellValue $hwnd ([string]$entry.cell.rid) ([string]$entry.requested) 350'))).Count -eq 2) `
  'table_add und table_update warten nach SetValue nicht mehr mit der alten Frist als Obergrenze.'
Assert-True ($workerSource.Contains("if (`$entry.mode -eq 'toggle') { Start-Sleep -Milliseconds 350 }")) `
  'Umgeschaltete Tabellenzellen behalten ihre feste Frist nicht mehr.'

# --- 5. Menue-Popup -------------------------------------------------------------
# Offen erst bei sichtbarem Popup UND aufgeklapptem Menue, geschlossen erst ohne
# Popup; sonst laeuft die volle Frist. Die Popupliste kommt aus einer Folge von
# Beobachtungen, die letzte bleibt stehen.
$script:popupCounts = $null
$script:popupReads = 0
function Get-SSEMenuPopupWindows([int]$TargetPid) {
  $count = $script:popupCounts[[Math]::Min($script:popupReads, $script:popupCounts.Count - 1)]
  $script:popupReads++
  @(for ($window = 1; $window -le $count; $window++) { [pscustomobject]@{ hwnd=$window; pid=$TargetPid } })
}
$expandedPattern = New-ObservedElement 'ExpandCollapseState' @([System.Windows.Automation.ExpandCollapseState]::Expanded)
$script:popupCounts = @(0, 0, 1); $script:popupReads = 0
$opened = Measure-Wait { Wait-SSEMenuPopup $expandedPattern 77 $true 2000 }
Assert-True ($opened.result -eq $true -and $script:popupReads -eq 3) 'Das Menue galt nicht genau mit dem ersten sichtbaren Popup als offen.'
$script:popupCounts = @(1); $script:popupReads = 0
$collapsedPattern = New-ObservedElement 'ExpandCollapseState' @([System.Windows.Automation.ExpandCollapseState]::Collapsed)
$notOpen = Measure-Wait { Wait-SSEMenuPopup $collapsedPattern 77 $true 250 }
Assert-True ($notOpen.result -eq $false -and $notOpen.elapsedMs -ge 250) 'Ein Popup ohne aufgeklapptes Menue galt als offen.'
$script:popupCounts = @(1); $script:popupReads = 0
$noPattern = Measure-Wait { Wait-SSEMenuPopup $null 77 $true 250 }
Assert-True ($noPattern.result -eq $false -and $noPattern.elapsedMs -ge 250) 'Ohne lesbaren Menuezustand galt das Menue als offen.'
$script:popupCounts = @(1, 1, 0); $script:popupReads = 0
$closed = Measure-Wait { Wait-SSEMenuPopup $null 77 $false 2000 }
Assert-True ($closed.result -eq $true -and $script:popupReads -eq 3) 'Das Menue galt nicht genau mit dem verschwundenen Popup als geschlossen.'
$script:popupCounts = @(1); $script:popupReads = 0
$stillOpen = Measure-Wait { Wait-SSEMenuPopup $null 77 $false 250 }
Assert-True ($stillOpen.result -eq $false -and $stillOpen.elapsedMs -ge 250) 'Ein sichtbares Popup galt als geschlossen.'

Write-Output 'Bedingte Wartezeiten: volles Signal oder volle Frist, zeichengenau, Sichern bestaetigt - bestanden'

# Engine 31 liefert fuer FromPoint das Fenster unter seinem Combo-Popup.
# Die letzte Pruefung vor mouse-down muss deshalb die aktuelle Option UND
# ihren sichtbaren Listen-Vorfahren am gebundenen Punkt nachweisen.
$pointDefinition = @($ast.FindAll({ param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Test-SSEComboOptionPoint'
}, $true))[0]
Invoke-Expression $pointDefinition.Extent.Text
Add-Type -TypeDefinition 'public static class ComboPointProperties { public static string ControlTypeProperty = "type"; }'
$script:AE = [ComboPointProperties]
$script:WLK = [pscustomobject]@{}
$script:WLK | Add-Member ScriptMethod GetParent { param($element) $element.parent }
function New-PointElement($Node, $Parent = $null) {
  $element = [pscustomobject]@{ node=$Node; parent=$Parent; visible=$true; pattern=$null }
  $element | Add-Member ScriptMethod GetCurrentPropertyValue { param($property)
    if ($this.node.type -ceq 'List') { [System.Windows.Automation.ControlType]::List }
    else { [System.Windows.Automation.ControlType]::ComboBox }
  }
  $element | Add-Member ScriptMethod TryGetCurrentPattern { param($key, $result)
    $result.Value = $this.pattern; $null -ne $this.pattern
  }
  $element
}
function Get-LiveElement { param($window,$rid,$aid) $script:pointElements[$rid] }
function Test-SSEElementVisible { param($element) $element.visible -is [bool] -and $element.visible -eq $true }
function Test-SSEElementIdentity { param($element,$rid,$aid) $element.node.rid -ceq $rid -and $element.node.aid -ceq $aid }
function Convert-ExactElementToNode { param($element) $element.node }
$pointBinding = [pscustomobject]@{comboRid='1';comboAid='combo';optionRid='2';optionAid='combo.item';optionName='Option'}
foreach ($failure in @('none','combo-hidden','combo-unknown','combo-stale','collapsed','option-hidden','option-unknown','option-stale','renamed','disabled','outside-option','outside-list','missing-list','hidden-list')) {
  $list = New-PointElement ([pscustomobject]@{type='List';on=$true;x=10;y=10;w=100;h=100})
  $option = New-PointElement ([pscustomobject]@{type='ListItem';rid='2';aid='combo.item';name='Option';on=$true;x=10;y=10;w=100;h=30}) $list
  $comboPoint = New-PointElement ([pscustomobject]@{type='ComboBox';rid='1';aid='combo'})
  $comboPoint.pattern = [pscustomobject]@{Current=[pscustomobject]@{ExpandCollapseState=[System.Windows.Automation.ExpandCollapseState]::Expanded}}
  switch ($failure) {
    'combo-hidden' {$comboPoint.visible=$false}
    'combo-unknown' {$comboPoint.visible=$null}
    'combo-stale' {$comboPoint.node.rid='old'}
    'collapsed' {$comboPoint.pattern.Current.ExpandCollapseState=[System.Windows.Automation.ExpandCollapseState]::Collapsed}
    'option-hidden' {$option.visible=$false}
    'option-unknown' {$option.visible=$null}
    'option-stale' {$option.node.rid='old'}
    'renamed' {$option.node.name='Other'}
    'disabled' {$option.node.on=$false}
    'outside-option' {$option.node.x=30}
    'outside-list' {$list.node.x=30}
    'missing-list' {$option.parent=$null}
    'hidden-list' {$list.visible=$false}
  }
  $script:pointElements = @{'1'=$comboPoint;'2'=$option}
  $validPoint = Test-SSEComboOptionPoint ([IntPtr]4242) $pointBinding 20 20
  Assert-True ($validPoint -eq ($failure -ceq 'none')) "Combo-Punktpruefung akzeptiert unvollstaendigen Zustand '$failure'."
}
$clickDefinition = @($ast.FindAll({ param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Click-VerifiedPoint'
}, $true))[0].Extent.Text
$checkOffset = $clickDefinition.IndexOf('if ($BeforeClickCheck -and')
Assert-True ($checkOffset -gt $clickDefinition.IndexOf('[SW]::SetCursorPos') -and
  $checkOffset -lt $clickDefinition.IndexOf('[SW]::mouse_event(0x0002')) 'Die Popup-Bindung wird nicht unmittelbar vor dem ersten mouse-down geprueft.'
Write-Output 'Combo-Punkt: frische Identitaet, sichtbares Popup und gebundene Geometrie vor mouse-down - bestanden'
