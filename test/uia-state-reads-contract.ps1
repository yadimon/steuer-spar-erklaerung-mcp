# UIA-Zustandslesungen bleiben bei einem Lesefehler unbekannt.
#
# Ein fehlgeschlagener Eigenschaftsabruf wirft in PowerShell keine Ausnahme,
# sondern liefert $null - unter Windows PowerShell 5.1 wie unter 7, auch mit
# StrictMode. Ein [bool]- oder [string]-Cast und ein -eq-Vergleich machen
# daraus einen scheinbar festen Zustand ('gesichert', 'aus', 'beschreibbar').
# Dieser Vertrag fuehrt die echten Lesehilfen mit werfenden Fake-Elementen aus
# und haelt fest:
#   1. Read-SSEToggleState liest einmal und liefert On/Off/Indeterminate oder
#      $null.
#   2. Get-DirtyStateFast liefert bei unlesbarem 'Sichern' $null, nie $false.
#   3. Convert-ExactElementToNode meldet unlesbares IsReadOnly und einen
#      unlesbaren Kontrollkaestchenwert als $null.
#   4. Entscheidende Toggle-Lesungen laufen nur noch ueber Read-SSEToggleState.
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

foreach ($name in @('Read-SSEToggleState', 'Get-DirtyStateFast', 'Convert-ExactElementToNode')) {
  $definitions = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  Assert-True ($definitions.Count -eq 1) "$name ist nicht eindeutig vorhanden."
  Invoke-Expression $definitions[0].Extent.Text
}

# Fake-Pattern/-Element: Current liefert die Werte oder wirft wie ein
# verschwundenes UIA-Element.
function New-Current([hashtable]$Values) {
  $object = [pscustomobject]@{ values=$Values }
  $object | Add-Member -MemberType ScriptProperty -Name Current -Value { [pscustomobject]$this.values }
  $object
}
function New-ThrowingCurrent {
  $object = [pscustomobject]@{}
  $object | Add-Member -MemberType ScriptProperty -Name Current -Value { throw 'Element nicht mehr verfuegbar.' }
  $object
}

# --- 1. Read-SSEToggleState -----------------------------------------------------
foreach ($case in @(
  [pscustomobject]@{ name='On'; pattern=(New-Current @{ ToggleState=[Windows.Automation.ToggleState]::On }); expected='On' }
  [pscustomobject]@{ name='Off'; pattern=(New-Current @{ ToggleState=[Windows.Automation.ToggleState]::Off }); expected='Off' }
  [pscustomobject]@{ name='Indeterminate'; pattern=(New-Current @{ ToggleState=[Windows.Automation.ToggleState]::Indeterminate }); expected='Indeterminate' }
)) {
  Assert-True ((Read-SSEToggleState $case.pattern) -ceq $case.expected) "Toggle-Zustand '$($case.name)' wurde nicht gelesen."
}
foreach ($case in @(
  [pscustomobject]@{ name='Lesefehler'; pattern=(New-ThrowingCurrent) }
  [pscustomobject]@{ name='fremder Text'; pattern=(New-Current @{ ToggleState='on' }) }
  [pscustomobject]@{ name='kein Wert'; pattern=(New-Current @{ }) }
)) {
  Assert-True ($null -eq (Read-SSEToggleState $case.pattern)) "Toggle-Zustand '$($case.name)' wurde nicht als unbekannt gemeldet."
}

# --- 2. Get-DirtyStateFast ------------------------------------------------------
$script:saveButton = $null
function Find-ExactAutomationElement { param([IntPtr]$Hwnd, [string]$AidSuffix) $script:saveButton }
foreach ($case in @(
  [pscustomobject]@{ name='geaendert'; button=(New-Current @{ IsEnabled=$true }); expected=$true }
  [pscustomobject]@{ name='gesichert'; button=(New-Current @{ IsEnabled=$false }); expected=$false }
)) {
  $script:saveButton = $case.button
  $dirty = Get-DirtyStateFast ([IntPtr]4242)
  Assert-True ($dirty -is [bool] -and $dirty -eq $case.expected) "Dirty-State '$($case.name)' wurde nicht gelesen."
}
foreach ($case in @(
  [pscustomobject]@{ name='Lesefehler'; button=(New-ThrowingCurrent) }
  [pscustomobject]@{ name='kein Schalter'; button=$null }
)) {
  $script:saveButton = $case.button
  Assert-True ($null -eq (Get-DirtyStateFast ([IntPtr]4242))) "Dirty-State '$($case.name)' wurde nicht als unbekannt gemeldet."
}

# --- 3. Convert-ExactElementToNode ---------------------------------------------
function New-Element($ValuePattern, $TogglePattern) {
  $element = [pscustomobject]@{ value=$ValuePattern; toggle=$TogglePattern }
  $element | Add-Member -MemberType ScriptProperty -Name Current -Value {
    [pscustomobject]@{
      ControlType=[pscustomobject]@{ ProgrammaticName='ControlType.CheckBox' }
      Name='Feld'; AutomationId='X.Feld'; IsEnabled=$true; IsOffscreen=$false
      BoundingRectangle=[pscustomobject]@{ X=10; Y=20; Width=30; Height=40 }
    }
  }
  $element | Add-Member -MemberType ScriptMethod -Name TryGetCurrentPattern -Value {
    param($Pattern, $Out)
    $found = $(if ($Pattern -eq [System.Windows.Automation.ValuePattern]::Pattern) { $this.value } else { $this.toggle })
    $Out.Value = $found
    [bool]$found
  }
  $element | Add-Member -MemberType ScriptMethod -Name GetRuntimeId -Value { @(42, 7) }
  $element
}
$valueReadable = New-Element (New-Current @{ Value='12,00'; IsReadOnly=$true }) $null
$readable = Convert-ExactElementToNode $valueReadable
Assert-True ($readable.val -ceq '12,00' -and $readable.ro -eq $true -and $readable.rid -ceq '42.7') `
  "Ein lesbares Feld wurde falsch umgesetzt: $($readable | ConvertTo-Json -Compress)"

$readOnlyUnreadable = New-Object psobject
$readOnlyUnreadable | Add-Member -MemberType ScriptProperty -Name Current -Value {
  $values = [pscustomobject]@{ Value='12,00' }
  $values | Add-Member -MemberType ScriptProperty -Name IsReadOnly -Value { throw 'IsReadOnly nicht lesbar.' }
  $values
}
$unknownReadOnly = Convert-ExactElementToNode (New-Element $readOnlyUnreadable $null)
Assert-True ($unknownReadOnly.val -ceq '12,00' -and $null -eq $unknownReadOnly.ro) `
  "Ein unlesbares IsReadOnly galt als beschreibbar: $($unknownReadOnly | ConvertTo-Json -Compress)"

$checkboxOn = Convert-ExactElementToNode (New-Element (New-Current @{ Value=''; IsReadOnly=$false }) (New-Current @{ ToggleState=[Windows.Automation.ToggleState]::On }))
Assert-True ($checkboxOn.val -ceq 'True' -and $checkboxOn.ro -eq $false) 'Ein angekreuztes Kontrollkaestchen wurde nicht als True gelesen.'
$checkboxUnknown = Convert-ExactElementToNode (New-Element (New-Current @{ Value=''; IsReadOnly=$false }) (New-ThrowingCurrent))
Assert-True ($null -eq $checkboxUnknown.val) `
  "Ein unlesbares Kontrollkaestchen meldete einen festen Wert: '$($checkboxUnknown.val)'"

# --- 4. Entscheidende Toggle-Lesungen -------------------------------------------
Assert-True (-not $workerSource.Contains(".Current.ToggleState -eq 'On') { 'true' } else { 'false' }")) `
  'Eine Toggle-Lesung macht aus einem Lesefehler wieder ''false''.'
Assert-True (-not $workerSource.Contains('.Current.ToggleState -eq [Windows.Automation.ToggleState]::On')) `
  'Eine Toggle-Lesung vergleicht wieder direkt mit On.'
Assert-True (-not $workerSource.Contains("Current.ToggleState -ceq 'On')")) `
  'Die Link-Zelle wird wieder ohne eindeutigen Zustand umgeschaltet.'
Assert-True ($workerSource.Contains("Fail 'Direkte Link-Zelle meldet unmittelbar vor TogglePattern.Toggle keinen eindeutigen Zustand; nicht umgeschaltet.' 'stale'")) `
  'Die Link-Zelle bricht bei unbekanntem Zustand nicht ab.'

Write-Output 'UIA-Zustandslesungen: Lesefehler bleiben unbekannt - bestanden'
