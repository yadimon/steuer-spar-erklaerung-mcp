# Der BelegManager bleibt ohne freie Selektoren: zwei reversible Navigationen
# sowie getrennte, gebundene Lese-, Befuell-, Import- und Loeschoperationen.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$catalogPath = Join-Path $root 'profiles\2025\page-objects.json'
$worker = Get-Content -LiteralPath $workerPath -Raw -Encoding UTF8
$catalog = Get-Content -LiteralPath $catalogPath -Raw -Encoding UTF8 | ConvertFrom-Json

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }
foreach ($functionName in @(
  'Get-SSEReceiptManagerPolicy',
  'Get-SSEReceiptManagerState',
  'Get-SSEReceiptManagerListProjection',
  'Get-SSEReceiptManagerWindowSet',
  'ConvertTo-SSEReceiptManagerInputValue',
  'ConvertFrom-SSEReceiptManagerDisplayValue',
  'Get-SSEReceiptManagerDetailIdentityTitle',
  'Test-SSEReceiptManagerPdfHeader'
)) {
  $definitions = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $functionName
  }, $true))
  Assert-True ($definitions.Count -eq 1) "$functionName ist nicht eindeutig vorhanden."
  if ($functionName -in @('Get-SSEReceiptManagerState','Get-SSEReceiptManagerListProjection','ConvertTo-SSEReceiptManagerInputValue','ConvertFrom-SSEReceiptManagerDisplayValue','Get-SSEReceiptManagerDetailIdentityTitle','Test-SSEReceiptManagerPdfHeader')) {
    Invoke-Expression $definitions[0].Extent.Text
  }
}

# Die bisherige Eingangsklassifikation bleibt als Differentialreferenz
# eingefroren; der komplette nachfolgende Projektor stammt aus derselben
# Funktionsdefinition und kann dadurch nicht zwischen Alt und Neu driften.
$listProjectionDefinition = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Get-SSEReceiptManagerListProjection'
}, $true))[0].Extent.Text
$indexedClassificationStart = $listProjectionDefinition.IndexOf('  # Dieser Index gilt nur fuer den aktuellen')
$classificationEnd = $listProjectionDefinition.IndexOf('  $filterText =', $indexedClassificationStart)
Assert-True ($indexedClassificationStart -ge 0 -and $classificationEnd -gt $indexedClassificationStart) `
  'Die Beleglisten-Eingangsklassifikation ist nicht eindeutig abgrenzbar.'
$legacyListClassification = @'
  $tables = @($State.nodes | Where-Object {
    $_.type -eq 'Table' -and [string]$_.aid -and
    ([string]$_.aid).EndsWith($tableSuffix, [StringComparison]::Ordinal) -and
    [bool]$_.on -and $_.w -gt 0 -and $_.h -gt 0
  })
  if ($tables.Count -ne 1) {
    Fail "$($tables.Count) sichtbare BelegManager-Tabellen '$tableSuffix' gefunden." 'profile-contract'
  }
  $table = $tables[0]
  $countLabels = New-Object System.Collections.ArrayList
  for ($countSuffixIndex = 0; $countSuffixIndex -lt $countSuffixes.Count; $countSuffixIndex++) {
    $suffix = [string]$countSuffixes[$countSuffixIndex]
    $matches = @($State.nodes | Where-Object {
      [string]$_.aid -and ([string]$_.aid).EndsWith($suffix, [StringComparison]::Ordinal)
    })
    if ($matches.Count -gt 1 -or ($countSuffixIndex -eq 0 -and $matches.Count -ne 1)) {
      Fail "$($matches.Count) BelegManager-Zaehlerteile '$suffix' gefunden." 'profile-contract'
    }
    if ($matches.Count -eq 1) { $null = $countLabels.Add($matches[0]) }
  }
  $countText = ((@($countLabels | ForEach-Object { [string]$_.name }) -join ' ') -replace '\s+', ' ').Trim()
  $countMatch = [regex]::Match(
    $countText,
    'MEINE BELEGE\s*\((?:(?<current>\d+)\s+von\s+)?(?<total>\d+)\)',
    [Text.RegularExpressions.RegexOptions]::CultureInvariant
  )
  if (-not $countMatch.Success) {
    Fail "BelegManager-Zaehler hat ein unbekanntes Format: '$countText'." 'profile-contract'
  }
  $count = [int]$countMatch.Groups['total'].Value
  $tableAid = [string]$table.aid
  $headerNames = @($State.nodes | Where-Object {
    $_.type -in @('Header','HeaderItem') -and [string]$_.name -and
    [string]$_.aid -ceq $tableAid -and $_.w -gt 0 -and $_.h -gt 0
  } | Sort-Object x | ForEach-Object { [string]$_.name })
  $dataCells = @($State.nodes | Where-Object {
    $_.type -eq 'DataItem' -and [string]$_.aid -ceq $tableAid -and
    $_.w -gt 0 -and $_.h -gt 0 -and $_.y -ge $table.y
  })
  $rows = New-Object System.Collections.ArrayList
  $visibleGroups = @($dataCells | Group-Object y | Sort-Object { [int]$_.Name })
  $projectedCellGroups = New-Object 'System.Collections.Generic.List[object]'
  $gridProjectionError = $null
  $searchNodes = @($State.nodes | Where-Object {
    $_.type -eq 'Edit' -and [string]$_.aid -and
    ([string]$_.aid).EndsWith($searchSuffix, [StringComparison]::Ordinal)
  })
'@
$legacyListDefinition = $listProjectionDefinition.Substring(0, $indexedClassificationStart) +
  $legacyListClassification + "`r`n" + $listProjectionDefinition.Substring($classificationEnd)
$legacyListDefinition = $legacyListDefinition.Replace(
  'function Get-SSEReceiptManagerListProjection(',
  'function Get-LegacySSEReceiptManagerListProjection('
)
Invoke-Expression $legacyListDefinition

$policy = $catalog.windows.receiptManager
$foregroundCatalogStart = $worker.IndexOf('$foregroundRequiredReceiptOps = @(')
$foregroundGateStart = $worker.IndexOf('$profilePolicyOperation -in $foregroundRequiredReceiptOps')
$buildGateStart = $worker.IndexOf('Assert-SSEVerifiedBuildForOperation $profilePolicyOperation $a', $foregroundGateStart)
$dispatcherStart = $worker.IndexOf('function Invoke-SSEWorkerOperation(', $foregroundGateStart)
Assert-True ($foregroundCatalogStart -ge 0) 'Der Worker besitzt keinen zentralen BelegManager-Interaktionskatalog.'
Assert-True ($foregroundGateStart -gt $foregroundCatalogStart) 'Der BelegManager-Interaktionsguard fehlt.'
Assert-True ($buildGateStart -gt $foregroundGateStart) 'Der BelegManager-Interaktionsguard muss vor der Buildaufloesung stoppen.'
Assert-True ($dispatcherStart -gt $buildGateStart) 'Der BelegManager-Interaktionsguard muss vor dem Operationsdispatcher stoppen.'
$foregroundGateEnd = $buildGateStart
Assert-True ($foregroundGateEnd -gt $foregroundGateStart) 'Der BelegManager-Interaktionsguard ist nicht eindeutig abgrenzbar.'
$foregroundGate = $worker.Substring($foregroundGateStart, $foregroundGateEnd - $foregroundGateStart)
foreach ($required in @(
  "'blocked'",
  "reason='foreground-required-operation-disabled'",
  'retryable=$false',
  "interactionRequirement='foreground-required'",
  'mutationStarted=$false',
  "resultingState='unchanged'",
  'cleanupRequired=$false',
  'physicalInputUsed=$false',
  'foregroundLeaseUsed=$false'
)) {
  Assert-True ($foregroundGate.Contains($required)) "Der globale BelegManager-Interaktionsguard enthaelt '$required' nicht."
}
Assert-True ($foregroundGate.Contains('nicht automatisch wiederholen')) 'Der Block muss automatische Wiederholung ausdruecklich ausschliessen.'

$menuClickStart = $worker.IndexOf("  'menu_click' {")
$menuClickEnd = $worker.IndexOf("  'menu_close' {", $menuClickStart)
Assert-True ($menuClickStart -ge 0 -and $menuClickEnd -gt $menuClickStart) `
  'menu_click-Operationsblock ist nicht eindeutig abgrenzbar.'
$menuClickBlock = $worker.Substring($menuClickStart, $menuClickEnd - $menuClickStart)
foreach ($required in @(
  '$receiptPolicy = Get-SSEReceiptManagerPolicy',
  '[string]$match.node.name -ceq [string]$receiptPolicy.title',
  '[int]$_.pid -eq $targetPid',
  '[string]$_.cls -match [string]$receiptPolicy.classPattern',
  '$toolMatches.Count -eq 1',
  'Start-Sleep -Milliseconds 100',
  'else {',
  'Start-Sleep -Milliseconds $waitMs'
)) {
  Assert-True ($menuClickBlock.Contains($required)) "menu_click fehlt der BelegManager-Wartevertrag '$required'."
}

$menuStart = $worker.IndexOf("  'menu' {")
$menuEnd = $worker.IndexOf("  'menu_click' {", $menuStart)
Assert-True ($menuStart -ge 0 -and $menuEnd -gt $menuStart) `
  'menu-Operationsblock ist nicht eindeutig abgrenzbar.'
$menuBlock = $worker.Substring($menuStart, $menuEnd - $menuStart)
$namedMenuIndex = $menuBlock.IndexOf("`$wunsch = [string](Arg `$a 'name')")
$listOnlyIndex = $menuBlock.IndexOf('if (-not $wunsch) {')
$listWalkIndex = $menuBlock.IndexOf('$t = Walk-Tree $hwnd 1200')
$openNamedIndex = $menuBlock.IndexOf('$m = Open-SSEMenuByName $hwnd $wunsch')
Assert-True ($namedMenuIndex -ge 0 -and $listOnlyIndex -gt $namedMenuIndex -and $listWalkIndex -gt $listOnlyIndex) `
  'Die Menuezeilen-Ermittlung ist nicht auf den namenlosen Listenmodus begrenzt.'
Assert-True ($openNamedIndex -gt $listWalkIndex) `
  'Der benannte Menuepfad ist nicht eindeutig hinter dem optionalen Listenmodus gebunden.'
Assert-True (([regex]::Matches($menuBlock, [regex]::Escape('$t = Walk-Tree $hwnd 1200'))).Count -eq 1) `
  'Der menu-Block enthaelt mehr als einen Menuezeilen-Walk.'

$menuOpenStart = $worker.IndexOf('function Open-SSEMenuByName(')
$menuOpenEnd = $worker.IndexOf('function Get-SSEOpenMenuEntryMatches(', $menuOpenStart)
Assert-True ($menuOpenStart -ge 0 -and $menuOpenEnd -gt $menuOpenStart) `
  'Open-SSEMenuByName ist nicht eindeutig abgrenzbar.'
$menuOpenBlock = $worker.Substring($menuOpenStart, $menuOpenEnd - $menuOpenStart)
foreach ($required in @(
  '$openDeadline = [DateTime]::UtcNow.AddMilliseconds(700)',
  'ExpandCollapseState]::Expanded',
  "`$_.cls -match 'PopupDropShadow|SysShadow'",
  'if (($expanded -and $popupReady) -or [DateTime]::UtcNow -ge $openDeadline) { break }',
  'Start-Sleep -Milliseconds 50'
)) {
  Assert-True ($menuOpenBlock.Contains($required)) "Open-SSEMenuByName fehlt der Popup-Bereitschaftsvertrag '$required'."
}
Assert-True (-not $menuOpenBlock.Contains('Start-Sleep -Milliseconds 700')) `
  'Open-SSEMenuByName wartet weiterhin fest statt bis zum beobachteten Popup-Zustand.'

$menuCloseStart = $worker.IndexOf("  'menu_close' {")
$menuCloseEnd = $worker.IndexOf("  'receipt_manager_bulk_upsert' {", $menuCloseStart)
Assert-True ($menuCloseStart -ge 0 -and $menuCloseEnd -gt $menuCloseStart) `
  'menu_close-Operationsblock ist nicht eindeutig abgrenzbar.'
$menuCloseBlock = $worker.Substring($menuCloseStart, $menuCloseEnd - $menuCloseStart)
foreach ($required in @(
  '$closeDeadline = [DateTime]::UtcNow.AddMilliseconds(500)',
  "`$_.cls -match 'PopupDropShadow|SysShadow'",
  'if (-not $after.Count -or [DateTime]::UtcNow -ge $closeDeadline) { break }',
  'Start-Sleep -Milliseconds 50',
  '$verified = [bool]($after.Count -eq 0)'
)) {
  Assert-True ($menuCloseBlock.Contains($required)) "menu_close fehlt der Popup-Postcondition-Vertrag '$required'."
}
Assert-True (-not $menuCloseBlock.Contains('Start-Sleep -Milliseconds 500')) `
  'menu_close wartet weiterhin fest statt bis zur beobachteten Popup-Postcondition.'

Assert-True ($policy.role -ceq 'nonmodal-tool-window') 'BelegManager hat nicht die erwartete Werkzeugfensterrolle.'
Assert-True ('Qt692QWindow' -match [string]$policy.classPattern) 'Die gemessene Qt-Klasse passt nicht zur Profilbindung.'
Assert-True ('Qt692QWindowIcon' -notmatch [string]$policy.classPattern) 'Das Hauptfenster passt faelschlich zur BelegManager-Klasse.'
Assert-True (@($policy.actions.PSObject.Properties).Count -eq 2) 'Der Profilkatalog enthaelt mehr oder weniger als zwei BelegManager-Aktionen.'
Assert-True (@($policy.actions.PSObject.Properties.Name | Sort-Object) -join ',' -ceq 'goHome,showAllReceipts') 'Die BelegManager-Aktionsliste ist nicht exakt allowlisted.'
Assert-True ($policy.actions.showAllReceipts.fromState -ceq 'start' -and $policy.actions.showAllReceipts.toState -ceq 'list') 'showAllReceipts hat keine reversible Start-zu-Liste-Bindung.'
Assert-True ($policy.actions.goHome.fromState -ceq 'list' -and $policy.actions.goHome.toState -ceq 'start') 'goHome hat keine reversible Liste-zu-Start-Bindung.'
Assert-True ($policy.actions.showAllReceipts.automationIdSuffix -ceq '.btn_alleBelegeAnzeigen') 'showAllReceipts zielt nicht auf den gemessenen Schalter.'
Assert-True ($policy.actions.goHome.automationIdSuffix -ceq '.pushButton_home') 'goHome zielt nicht auf den gemessenen Startseiten-Schalter.'
Assert-True ($policy.controls.newReceipt.automationIdSuffix -ceq '.btn_new' -and $policy.controls.newReceipt.expectedName -ceq 'Neuer Beleg') 'Neuer-Beleg-Bindung fehlt.'
Assert-True ($policy.controls.attachFile.automationIdSuffix -ceq '.panel_asset.DetailPagePreview.panel_asset') 'Dateiflaechen-Bindung fehlt.'
$deleteName = 'L' + [char]0x00F6 + 'schen'
$deleteTitle = $deleteName + ' best' + [char]0x00E4 + 'tigen'
$openTitle = [char]0x00D6 + 'ffnen'
$detailCloseName = 'Detailansicht  schlie' + [char]0x00DF + 'en'
Assert-True ($policy.controls.deleteReceipt.automationIdSuffix -ceq '.btn_delete' -and $policy.controls.deleteReceipt.expectedName -ceq $deleteName) 'Loeschschalter-Bindung fehlt.'
Assert-True ($policy.controls.detailClose.automationIdSuffix -ceq '.pushButton_detailsClose' -and $policy.controls.detailClose.expectedName -ceq $detailCloseName) 'Detailansicht-Schliessen-Bindung fehlt.'
Assert-True ($policy.deleteConfirmation.title -ceq $deleteTitle) 'Loeschdialogtitel ist nicht exakt profiliert.'
Assert-True ([string]$policy.deleteConfirmation.fingerprint -match '^[A-Fa-f0-9]{64}$') 'Loeschdialogfingerprint fehlt.'
Assert-True ($policy.importDialog.title -ceq $openTitle -and $policy.importDialog.class -ceq '#32770') 'Belegimport-Dialog ist nicht exakt profiliert.'
Assert-True ([string]$policy.importDialog.fingerprint -match '^[A-Fa-f0-9]{64}$') 'Belegimport-Dialogfingerprint fehlt.'
$editableFields = @($policy.controls.editableFields.PSObject.Properties.Name | Sort-Object)
Assert-True (($editableFields -join ',') -ceq 'amount,date,documentNumber,net,note,title,vatRate') 'Editierbare Belegfelder sind nicht exakt allowlisted.'
Assert-True ($policy.controls.editableFields.date.automationIdSuffix -ceq '.dateEdit_datum.AAVDateLineEdit') 'Datumfeld ist nicht exakt profiliert.'
Assert-True ($policy.controls.editableFields.amount.valueKind -ceq 'currency') 'Betragsfeld hat nicht den erwarteten Werttyp.'
Assert-True ($policy.controls.editableFields.net.controlType -ceq 'CheckBox') 'Nettofeld ist nicht als Checkbox gebunden.'
Assert-True ((ConvertTo-SSEReceiptManagerInputValue 'vatRate' '19' 'vat-rate') -ceq '19 %') 'USt-ComboBox erhaelt nicht den vollstaendigen Qt-Anzeigetext.'
Assert-True ((ConvertFrom-SSEReceiptManagerDisplayValue '15.01.2025' 'date') -ceq '2025-01-15') 'Belegdatum wird am API-Rand nicht kanonisch als ISO-Datum gelesen.'
Assert-True ((ConvertFrom-SSEReceiptManagerDisplayValue '19 %' 'vat-rate') -ceq '19') 'USt-Satz wird am API-Rand nicht kanonisch ohne Anzeigezeichen gelesen.'
Assert-True ((ConvertFrom-SSEReceiptManagerDisplayValue '' 'vat-rate') -ceq '0') 'Leerer Qt-USt-Satz wird am API-Rand nicht kanonisch als Nullsatz gelesen.'
Assert-True ([int]$policy.list.primaryTextColumn -eq 2) 'Primaertext-Spalte ist nicht auf den live gemessenen Grid-Index 2 profiliert.'
Assert-True ([int]$policy.list.documentNumberColumn -eq 8) 'Belegnummer-Spalte ist nicht auf den live gemessenen Grid-Index 8 profiliert.'
Assert-True ([string]$policy.list.searchAutomationIdSuffix -ceq '.widget_mainWindowInfoBar.frame_container.lineEdit_suche') 'Beleglisten-Suche ist nicht profiliert.'
Assert-True ((@($policy.importDialog.supportedExtensions) -join ',') -ceq '.pdf') 'Belegimport muss auf das live belegte PDF-Format begrenzt bleiben.'
$pdfProbe = [IO.Path]::GetTempFileName()
try {
  [IO.File]::WriteAllBytes($pdfProbe, [Text.Encoding]::ASCII.GetBytes("%PDF-1.4`n%%EOF`n"))
  Assert-True (Test-SSEReceiptManagerPdfHeader $pdfProbe) 'Ein PDF-Header wurde nicht erkannt.'
  [IO.File]::WriteAllBytes($pdfProbe, [Text.Encoding]::ASCII.GetBytes("plain text`n"))
  Assert-True (-not (Test-SSEReceiptManagerPdfHeader $pdfProbe)) 'Eine Nicht-PDF-Datei wurde als PDF akzeptiert.'
} finally {
  Remove-Item -LiteralPath $pdfProbe -Force -ErrorAction SilentlyContinue
}
Assert-True ([bool]$policy.controls.linkManagement.directToggleSupported -eq $false) 'Wirkungsloses TogglePattern darf fuer SSE 31.0.1 nicht aktiviert sein.'

function Get-SSETextSha256([string]$Text) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
    ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '')
  } finally { $sha.Dispose() }
}
function Fail([string]$Message, [string]$Kind) { throw "$Kind::$Message" }
function Walk-Tree([IntPtr]$Window, [int]$MaxNodes, [switch]$WithValues) {
  $script:ReceiptWalkWithValues = $WithValues.IsPresent
  [pscustomobject]@{
    nodes=$script:ReceiptNodes
    stats=[pscustomobject][ordered]@{ n=$script:ReceiptNodes.Count; fixture='receipt-state' }
  }
}
function ReceiptNode(
  [string]$Suffix,
  [bool]$Enabled = $true,
  [int]$X = 10,
  [int]$Y = 10,
  [int]$Width = 20,
  [int]$Height = 20,
  [string]$Name = '',
  [string]$Type = 'Button',
  $Checked = $null,
  $Selected = $null
) {
  [pscustomobject]@{
    aid="SSE_Application.BMMainWindow$Suffix"; name=$Name; type=$Type; on=$Enabled
    checked=$Checked; selected=$Selected; x=$X; y=$Y; w=$Width; h=$Height
  }
}

# Eingefrorene Referenz der bisherigen Mehrfachscan-Implementierung. Die
# gerichteten und randomisierten Differentialfaelle darunter muessen nicht nur
# den Zustand, sondern auch Fehler, Node-/Stats-Shape und exakte Fingerprint-
# Bytes beibehalten.
function Get-LegacySSEReceiptManagerState([IntPtr]$Window, $Policy, [switch]$WithValues) {
  $tree = Walk-Tree $Window 800 -WithValues:$WithValues
  $nodes = @($tree.nodes | Where-Object { $_.w -gt 0 -and $_.h -gt 0 })
  $matchedStates = New-Object System.Collections.ArrayList
  foreach ($stateProperty in @($Policy.states.PSObject.Properties)) {
    $required = @($stateProperty.Value.requiredAutomationIdSuffixes | ForEach-Object { [string]$_ })
    if (-not $required.Count) { Fail "BelegManager-Zustand '$($stateProperty.Name)' hat keine Pflichtsteuerelemente." 'profile-contract' }
    $complete = $true
    foreach ($suffix in $required) {
      $matches = @($nodes | Where-Object {
        [string]$_.aid -and ([string]$_.aid).EndsWith($suffix, [StringComparison]::Ordinal)
      })
      if ($matches.Count -ne 1 -or -not [bool]$matches[0].on) { $complete = $false; break }
    }
    if ($complete) { $null = $matchedStates.Add([string]$stateProperty.Name) }
  }
  if ($matchedStates.Count -ne 1) {
    Fail "BelegManager-Zustand ist nicht eindeutig profiliert ($($matchedStates.Count) Treffer)." 'state-unknown'
  }

  $relevantSuffixes = @(
    @($Policy.states.PSObject.Properties | ForEach-Object { @($_.Value.requiredAutomationIdSuffixes) }) +
    @($Policy.actions.PSObject.Properties | ForEach-Object { [string]$_.Value.automationIdSuffix })
  ) | ForEach-Object { [string]$_ } | Where-Object { $_ } | Select-Object -Unique
  $stableNodes = @($nodes | Where-Object {
    $aid = [string]$_.aid
    @($relevantSuffixes | Where-Object { $aid.EndsWith($_, [StringComparison]::Ordinal) }).Count -gt 0
  } | Sort-Object aid | ForEach-Object {
    [pscustomobject][ordered]@{
      aid=[string]$_.aid; name=[string]$_.name; type=[string]$_.type
      enabled=[bool]$_.on; checked=$_.checked; selected=$_.selected
      x=[int]$_.x; y=[int]$_.y; w=[int]$_.w; h=[int]$_.h
    }
  })
  $state = [string]$matchedStates[0]
  $fingerprintBody = [pscustomobject][ordered]@{
    hwnd=[int64]$Window; state=$state; nodes=$stableNodes
  }
  [pscustomobject]@{
    window=[int64]$Window
    state=$state
    fingerprint=Get-SSETextSha256 ($fingerprintBody | ConvertTo-Json -Depth 8 -Compress)
    nodes=$nodes
    stats=$tree.stats
  }
}

function Invoke-ReceiptStateOutcome(
  [string]$CommandName,
  [object[]]$Nodes,
  $StatePolicy,
  [bool]$WithValues = $false
) {
  $script:ReceiptNodes = @($Nodes)
  $script:ReceiptWalkWithValues = $false
  try {
    $result = & $CommandName ([IntPtr]5252) $StatePolicy -WithValues:$WithValues
    [pscustomobject][ordered]@{
      ok=$true
      withValues=[bool]$script:ReceiptWalkWithValues
      json=($result | ConvertTo-Json -Depth 12 -Compress)
      result=$result
    }
  } catch {
    [pscustomobject][ordered]@{
      ok=$false
      withValues=[bool]$script:ReceiptWalkWithValues
      error=[string]$_.Exception.Message
      result=$null
    }
  }
}

function Assert-ReceiptStateParity([object[]]$Nodes, $StatePolicy, [string]$CaseName, [bool]$WithValues = $false) {
  $legacy = Invoke-ReceiptStateOutcome 'Get-LegacySSEReceiptManagerState' $Nodes $StatePolicy $WithValues
  $indexed = Invoke-ReceiptStateOutcome 'Get-SSEReceiptManagerState' $Nodes $StatePolicy $WithValues
  Assert-True ($legacy.ok -eq $indexed.ok) "$CaseName hat ein abweichendes Erfolgs-/Fehlerergebnis."
  Assert-True ($legacy.withValues -eq $indexed.withValues) "$CaseName reicht WithValues abweichend an Walk-Tree weiter."
  if ($legacy.ok) {
    Assert-True ($legacy.json -ceq $indexed.json) "$CaseName veraendert Zustand, Shape oder Fingerprint."
  } else {
    Assert-True ($legacy.error -ceq $indexed.error) "$CaseName veraendert den fail-closed Fehler: '$($legacy.error)' / '$($indexed.error)'."
  }
  $indexed
}

$script:ReceiptNodes = @($policy.states.start.requiredAutomationIdSuffixes | ForEach-Object { ReceiptNode ([string]$_) })
$startState = Get-SSEReceiptManagerState ([IntPtr]5252) $policy
Assert-True ($startState.state -ceq 'start') "Startzustand wurde als '$($startState.state)' erkannt."
$script:ReceiptNodes = @($policy.states.list.requiredAutomationIdSuffixes | ForEach-Object { ReceiptNode ([string]$_) })
$listState = Get-SSEReceiptManagerState ([IntPtr]5252) $policy
Assert-True ($listState.state -ceq 'list') "Listenzustand wurde als '$($listState.state)' erkannt."
Assert-True ([int64]$listState.window -eq 5252) 'BelegManager-Zustand behaelt das exakt gelesene Fenster nicht fuer die Grid-Projektion.'

$startNodes = @($policy.states.start.requiredAutomationIdSuffixes | ForEach-Object { ReceiptNode ([string]$_) })
$listNodes = @($policy.states.list.requiredAutomationIdSuffixes | ForEach-Object { ReceiptNode ([string]$_) })
$duplicateNodes = @($startNodes) + @(ReceiptNode ([string]$policy.states.start.requiredAutomationIdSuffixes[0]))
$enabledDisabledDuplicateNodes = @($startNodes) + @(
  ReceiptNode ([string]$policy.states.start.requiredAutomationIdSuffixes[0]) $false
)
$disabledNodes = @($startNodes | ForEach-Object {
  if ([string]$_.aid -ceq [string]$startNodes[0].aid) {
    ReceiptNode ([string]$policy.states.start.requiredAutomationIdSuffixes[0]) $false
  } else { $_ }
})
$ambiguousNodes = @($startNodes) + @($listNodes)
$caseDistinctNodes = @($startNodes) + @(
  ReceiptNode ([string]$policy.states.start.requiredAutomationIdSuffixes[0]).ToUpperInvariant()
)
$hiddenAndNoiseNodes = @($startNodes) + @(
  ReceiptNode ([string]$policy.states.start.requiredAutomationIdSuffixes[0]) $true 10 10 0 20 'hidden duplicate'
  ReceiptNode '.UNRELATED' $true 40 40 20 20 'visible noise' 'Text'
)

$null = Assert-ReceiptStateParity $startNodes $policy 'start'
$null = Assert-ReceiptStateParity $listNodes $policy 'list-with-values' $true
$null = Assert-ReceiptStateParity $duplicateNodes $policy 'duplicate-required-control'
$null = Assert-ReceiptStateParity $enabledDisabledDuplicateNodes $policy 'enabled-disabled-duplicate-control'
$null = Assert-ReceiptStateParity $disabledNodes $policy 'disabled-required-control'
$null = Assert-ReceiptStateParity $ambiguousNodes $policy 'ambiguous-state'
$null = Assert-ReceiptStateParity $caseDistinctNodes $policy 'ordinal-case-distinct-control'
$hiddenOutcome = Assert-ReceiptStateParity $hiddenAndNoiseNodes $policy 'hidden-duplicate-and-visible-noise'
Assert-True ($hiddenOutcome.ok -and $hiddenOutcome.result.nodes.Count -eq 4) `
  'Nur sichtbare Knoten duerfen im Rueckgabezustand verbleiben; sichtbares Rauschen bleibt fuer Folgeprojektionen erhalten.'

# State- und Action-Suffix koennen denselben oder ueberlappende Knoten treffen.
# Der Fingerprint projiziert jeden sichtbaren Knoten dennoch exakt einmal.
$overlapPolicy = $policy | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$overlapPolicy.actions | Add-Member -NotePropertyName overlappingHome -NotePropertyValue ([pscustomobject]@{
  automationIdSuffix='home'; expectedName=''; fromState='list'; toState='start'
})
$overlapNodes = @($listNodes | ForEach-Object {
  if ([string]$_.aid -like '*.pushButton_home') {
    ReceiptNode '.pushButton_home' $true 31 32 33 34 'Home' 'Button' 'On' $true
  } else { $_ }
})
$overlapOutcome = Assert-ReceiptStateParity $overlapNodes $overlapPolicy 'overlapping-suffix-dedupe'
$expectedStableNodes = @($overlapNodes | Sort-Object aid | ForEach-Object {
  [pscustomobject][ordered]@{
    aid=[string]$_.aid; name=[string]$_.name; type=[string]$_.type
    enabled=[bool]$_.on; checked=$_.checked; selected=$_.selected
    x=[int]$_.x; y=[int]$_.y; w=[int]$_.w; h=[int]$_.h
  }
})
$expectedFingerprintBody = [pscustomobject][ordered]@{ hwnd=[int64]5252; state='list'; nodes=$expectedStableNodes }
$expectedFingerprint = Get-SSETextSha256 ($expectedFingerprintBody | ConvertTo-Json -Depth 8 -Compress)
Assert-True ([string]$overlapOutcome.result.fingerprint -ceq $expectedFingerprint) `
  'Ueberlappende State-/Action-Suffixe duplizieren einen Knoten im exakten Fingerprint.'

$shuffledNodes = @($overlapNodes[2],$overlapNodes[0],$overlapNodes[1])
$shuffledOutcome = Assert-ReceiptStateParity $shuffledNodes $overlapPolicy 'shuffled-input'
Assert-True ([string]$shuffledOutcome.result.fingerprint -ceq [string]$overlapOutcome.result.fingerprint) `
  'Der Fingerprint haengt trotz eindeutiger AutomationIds von der Eingabereihenfolge ab.'

$casePolicy = [pscustomobject]@{
  states=[pscustomobject]@{
    exactCase=[pscustomobject]@{ requiredAutomationIdSuffixes=@('.CaseControl','.caseControl') }
  }
  actions=[pscustomobject]@{}
}
$casePolicyNodes = @(ReceiptNode '.CaseControl'; ReceiptNode '.caseControl')
$casePolicyOutcome = Assert-ReceiptStateParity $casePolicyNodes $casePolicy 'case-distinct-policy-suffixes'
Assert-True ($casePolicyOutcome.ok -and [string]$casePolicyOutcome.result.state -ceq 'exactCase') `
  'Case-verschiedene Ordinal-Suffixe werden im Index nicht getrennt gehalten.'

$requiredOverlapPolicy = [pscustomobject]@{
  states=[pscustomobject]@{
    overlap=[pscustomobject]@{ requiredAutomationIdSuffixes=@('.button_home','home') }
  }
  actions=[pscustomobject]@{}
}
$requiredOverlapOutcome = Assert-ReceiptStateParity `
  @(ReceiptNode '.button_home') $requiredOverlapPolicy 'overlapping-required-suffixes'
Assert-True ($requiredOverlapOutcome.ok -and [string]$requiredOverlapOutcome.result.state -ceq 'overlap') `
  'Ein Knoten darf nicht nach dem ersten passenden Required-Suffix aus der Klassifikation fallen.'

$multiFingerprintNodes = @($startNodes) + @(
  ReceiptNode '.left.pushButton_home' $true 51 52 53 54 'Home left'
  ReceiptNode '.right.pushButton_home' $false 61 62 63 64 'Home right'
)
$null = Assert-ReceiptStateParity $multiFingerprintNodes $policy 'multiple-action-fingerprint-nodes'

$emptyRequiredPolicy = [pscustomobject]@{
  states=[pscustomobject]@{ empty=[pscustomobject]@{ requiredAutomationIdSuffixes=[object[]]@() } }
  actions=[pscustomobject]@{}
}
$null = Assert-ReceiptStateParity $startNodes $emptyRequiredPolicy 'empty-required-array'
$emptySuffixPolicy = [pscustomobject]@{
  states=[pscustomobject]@{ emptySuffix=[pscustomobject]@{ requiredAutomationIdSuffixes=@('') } }
  actions=[pscustomobject]@{}
}
$emptySuffixOutcome = Assert-ReceiptStateParity @(ReceiptNode '.anything') $emptySuffixPolicy 'empty-required-suffix'
Assert-True ($emptySuffixOutcome.ok -and [string]$emptySuffixOutcome.result.state -ceq 'emptySuffix') `
  'Der historische leere Required-Suffix wurde unbeabsichtigt gehaertet.'

# Der Guard misst das beobachtbare Arbeitsvolumen, ohne die konkrete
# Indeximplementierung festzuschreiben: jedes aid darf fuer Klassifikation und
# die kleine stabile Fingerprint-Projektion nur linear gelesen werden.
$readCountNodes = New-Object System.Collections.ArrayList
$readCountPlainNodes = New-Object System.Collections.ArrayList
$readCountSuffixes = New-Object System.Collections.ArrayList
foreach ($suffix in @($policy.states.start.requiredAutomationIdSuffixes)) { $null = $readCountSuffixes.Add([string]$suffix) }
for ($noiseIndex = 0; $noiseIndex -lt 100; $noiseIndex++) { $null = $readCountSuffixes.Add(".linear_noise_$noiseIndex") }
foreach ($suffix in $readCountSuffixes) {
  $plainNode = ReceiptNode ([string]$suffix)
  $null = $readCountPlainNodes.Add($plainNode)
  $countedNode = [pscustomobject]@{
    aidValue=[string]$plainNode.aid; name=''; type='Button'; on=$true
    checked=$null; selected=$null; x=10; y=10; w=20; h=20
  }
  $countedNode | Add-Member -MemberType ScriptProperty -Name aid -Value {
    $script:ReceiptAidReads++
    [string]$this.aidValue
  }
  $null = $readCountNodes.Add($countedNode)
}
$legacyLinear = Invoke-ReceiptStateOutcome `
  'Get-LegacySSEReceiptManagerState' ([object[]]$readCountPlainNodes) $policy
$script:ReceiptNodes = [object[]]$readCountNodes
$script:ReceiptAidReads = 0
$indexedLinear = Get-SSEReceiptManagerState ([IntPtr]5252) $policy
$indexedAidReads = [int]$script:ReceiptAidReads
Assert-True ($legacyLinear.ok -and [string]$indexedLinear.state -ceq [string]$legacyLinear.result.state -and
  [string]$indexedLinear.fingerprint -ceq [string]$legacyLinear.result.fingerprint) `
  'Der lineare Zugriffsguard veraendert Zustand oder Fingerprint.'
Assert-True ($indexedAidReads -le (2 * $readCountNodes.Count)) `
  "Get-SSEReceiptManagerState liest aid nicht linear ($indexedAidReads Zugriffe fuer $($readCountNodes.Count) Knoten)."
Assert-True ($indexedLinear.nodes.Count -eq $readCountNodes.Count -and
  [object]::ReferenceEquals($indexedLinear.nodes[0], $readCountNodes[0])) `
  'Der lineare Zugriffsguard veraendert Node-Shape oder Traversalidentitaet.'

$random = [Random]::new(20260901)
for ($caseIndex = 0; $caseIndex -lt 32; $caseIndex++) {
  $fixtureNodes = New-Object System.Collections.ArrayList
  $base = $(if (($caseIndex % 2) -eq 0) { $startNodes } else { $listNodes })
  foreach ($node in $base) { $null = $fixtureNodes.Add($node) }
  for ($noiseIndex = 0; $noiseIndex -lt $random.Next(4,28); $noiseIndex++) {
    $noiseSuffix = ".noise_$caseIndex`_$noiseIndex"
    if (($noiseIndex % 9) -eq 0) { $noiseSuffix += ([string]$base[0].aid).ToUpperInvariant() }
    $null = $fixtureNodes.Add((ReceiptNode $noiseSuffix ([bool]($noiseIndex % 3)) `
      ($random.Next(-20,500)) ($random.Next(-20,500)) ($random.Next(0,50)) ($random.Next(0,50)) `
      "noise-$noiseIndex" $(if (($noiseIndex % 2) -eq 0) { 'Text' } else { 'Button' })))
  }
  switch ($caseIndex % 6) {
    2 { $null = $fixtureNodes.Add((ReceiptNode ([string]$(if (($caseIndex % 2) -eq 0) {
          $policy.states.start.requiredAutomationIdSuffixes[0]
        } else { $policy.states.list.requiredAutomationIdSuffixes[0]
        })))) }
    3 {
      $disabledAid = [string]$base[0].aid
      for ($nodeIndex = 0; $nodeIndex -lt $fixtureNodes.Count; $nodeIndex++) {
        if ([string]$fixtureNodes[$nodeIndex].aid -ceq $disabledAid) {
          $original = $fixtureNodes[$nodeIndex]
          $fixtureNodes[$nodeIndex] = [pscustomobject]@{
            aid=[string]$original.aid; name=[string]$original.name; type=[string]$original.type; on=$false
            checked=$original.checked; selected=$original.selected
            x=[int]$original.x; y=[int]$original.y; w=[int]$original.w; h=[int]$original.h
          }
          break
        }
      }
    }
    4 {
      $other = $(if (($caseIndex % 2) -eq 0) { $listNodes } else { $startNodes })
      foreach ($node in $other) { $null = $fixtureNodes.Add($node) }
    }
    5 { $fixtureNodes.RemoveAt(0) }
  }
  for ($left = $fixtureNodes.Count - 1; $left -gt 0; $left--) {
    $right = $random.Next(0, $left + 1)
    $swap = $fixtureNodes[$left]; $fixtureNodes[$left] = $fixtureNodes[$right]; $fixtureNodes[$right] = $swap
  }
  $null = Assert-ReceiptStateParity ([object[]]$fixtureNodes) $policy "random-$caseIndex" ([bool]($caseIndex % 3))
}

if ($env:SSE_RECEIPT_STATE_BENCHMARK -eq '1') {
  $benchmarkNodes = New-Object System.Collections.ArrayList
  foreach ($node in $listNodes) { $null = $benchmarkNodes.Add($node) }
  for ($nodeIndex = $benchmarkNodes.Count; $nodeIndex -lt 800; $nodeIndex++) {
    $null = $benchmarkNodes.Add((ReceiptNode ".benchmark_noise_$nodeIndex" $true `
      ($nodeIndex % 1600) ([Math]::Floor($nodeIndex / 20)) 20 20 "noise-$nodeIndex" 'Text'))
  }
  $script:ReceiptNodes = [object[]]$benchmarkNodes
  $benchmarkCommands = @('Get-LegacySSEReceiptManagerState','Get-SSEReceiptManagerState')
  $benchmarkSamples = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([StringComparer]::Ordinal)
  foreach ($commandName in $benchmarkCommands) {
    $benchmarkSamples.Add($commandName, (New-Object System.Collections.ArrayList))
    for ($warmup = 0; $warmup -lt 3; $warmup++) { $null = & $commandName ([IntPtr]5252) $policy }
  }
  for ($sampleIndex = 0; $sampleIndex -lt 31; $sampleIndex++) {
    $sampleCommands = $(if (($sampleIndex % 2) -eq 0) {
      $benchmarkCommands
    } else {
      @($benchmarkCommands[1],$benchmarkCommands[0])
    })
    foreach ($commandName in $sampleCommands) {
      $watch = [Diagnostics.Stopwatch]::StartNew()
      $null = & $commandName ([IntPtr]5252) $policy
      $watch.Stop()
      $null = ([Collections.ArrayList]$benchmarkSamples[$commandName]).Add($watch.Elapsed.TotalMilliseconds)
    }
  }
  foreach ($commandName in $benchmarkCommands) {
    $samples = [Collections.ArrayList]$benchmarkSamples[$commandName]
    $ordered = @($samples | Sort-Object)
    $p50 = $ordered[[int]([Math]::Ceiling($ordered.Count * 0.50) - 1)]
    $p95 = $ordered[[int]([Math]::Ceiling($ordered.Count * 0.95) - 1)]
    Write-Output ("RECEIPT_STATE_BENCH {0} p50={1:N3}ms p95={2:N3}ms n={3}" -f `
      $commandName,$p50,$p95,$ordered.Count)
  }
}

$tableAid = 'SSE_Application.BMMainWindow.BMMainWindow.frame.stackedWidget.page_mainTable.tableWidget_mainTabel'
$listState.nodes = @(
  [pscustomobject]@{ aid=$tableAid; name=''; type='Table'; rid='table'; on=$true; x=80; y=233; w=900; h=400 },
  [pscustomobject]@{ aid='SSE_Application.BMMainWindow.BMMainWindow.frame.stackedWidget.page_mainTable.widget_mainWindowInfoBar.frame_container.label_infoText1'; name='MEINE BELEGE (1)'; type='Text'; rid='count'; on=$true; x=60; y=130; w=200; h=30 },
  [pscustomobject]@{ aid='SSE_Application.BMMainWindow.BMMainWindow.frame.stackedWidget.page_mainTable.widget_mainWindowInfoBar.frame_container.label_infoText2'; name=''; type='Text'; rid='count2'; on=$true; x=-1; y=-1; w=0; h=0 },
  [pscustomobject]@{ aid='SSE_Application.BMMainWindow.BMMainWindow.frame.stackedWidget.page_mainTable.widget_mainWindowInfoBar.frame_container.label_infoText3'; name=''; type='Text'; rid='count3'; on=$true; x=-1; y=-1; w=0; h=0 },
  [pscustomobject]@{ aid=$tableAid; name='Bezeichnung'; type='HeaderItem'; rid='head'; on=$true; x=100; y=233; w=300; h=30 },
  [pscustomobject]@{ aid=$tableAid; name='Neuer Beleg*'; type='DataItem'; rid='row-a'; on=$true; selected=$true; x=158; y=273; w=300; h=30 },
  [pscustomobject]@{ aid=$tableAid; name='0'; type='DataItem'; rid='row-b'; on=$true; selected=$null; x=539; y=273; w=83; h=30 }
)
$projection = Get-SSEReceiptManagerListProjection $listState $policy
Assert-True ($projection.count -eq 1 -and $projection.rows.Count -eq 1 -and $projection.rowsComplete) 'BelegManager-Liste wurde nicht vollstaendig projiziert.'
Assert-True ($projection.draftCount -eq 1 -and $projection.rows[0].draft) 'Leerer Belegentwurf wurde nicht markiert.'
Assert-True ((Get-SSEReceiptManagerDetailIdentityTitle $projection.rows[0] $policy) -ceq 'Neuer Beleg') 'Profilierter Draft-Marker wurde fuer die Detailidentitaet nicht exakt entfernt.'
Assert-True ([string]$projection.rows[0].rowRid -ceq 'row-a') 'Zeilenbindung verwendet nicht die erste sichtbare Zelle.'
Assert-True ([string]$projection.rows[0].rowFingerprint -match '^[A-Fa-f0-9]{64}$') 'Zeilenfingerprint fehlt.'
Assert-True ([string]$projection.rows[0].contentFingerprint -match '^[A-Fa-f0-9]{64}$') 'Stabiler Inhaltsfingerprint fehlt.'

function New-ReceiptListFixture($ListPolicy, [int]$NodeCount = 800, [int]$RowCount = 30) {
  $fixtureNodes = New-Object System.Collections.ArrayList
  $fixtureTableAid = "SSE_Application.BMMainWindow$([string]$ListPolicy.list.tableAutomationIdSuffix)"
  $null = $fixtureNodes.Add([pscustomobject]@{
    aid=$fixtureTableAid; name=''; type='Table'; rid='table'; on=$true; val=''
    checked=$null; selected=$null; toggleState=$null; x=80; y=233; w=900; h=600
  })
  for ($suffixIndex = 0; $suffixIndex -lt @($ListPolicy.list.countLabelAutomationIdSuffixes).Count; $suffixIndex++) {
    $null = $fixtureNodes.Add([pscustomobject]@{
      aid="SSE_Application.BMMainWindow$([string]$ListPolicy.list.countLabelAutomationIdSuffixes[$suffixIndex])"
      name=$(if ($suffixIndex -eq 0) { "MEINE BELEGE ($RowCount)" } else { '' })
      type='Text'; rid="count-$suffixIndex"; on=$true; val=''
      checked=$null; selected=$null; toggleState=$null; x=60; y=(130 + $suffixIndex); w=200; h=30
    })
  }
  $null = $fixtureNodes.Add([pscustomobject]@{
    aid="SSE_Application.BMMainWindow$([string]$ListPolicy.list.searchAutomationIdSuffix)"
    name=''; type='Edit'; rid='search'; on=$true; val=''
    checked=$null; selected=$null; toggleState=$null; x=500; y=130; w=220; h=30
  })
  for ($columnIndex = 0; $columnIndex -lt 9; $columnIndex++) {
    $null = $fixtureNodes.Add([pscustomobject]@{
      aid=$fixtureTableAid; name="Header $columnIndex"; type='HeaderItem'; rid="header-$columnIndex"; on=$true; val=''
      checked=$null; selected=$null; toggleState=$null; x=(100 + 70 * $columnIndex); y=233; w=70; h=30
    })
  }
  for ($rowIndex = 0; $rowIndex -lt $RowCount; $rowIndex++) {
    for ($columnIndex = 0; $columnIndex -lt 9; $columnIndex++) {
      $cellName = $(if ($columnIndex -eq 2) { "Beleg $rowIndex" } elseif ($columnIndex -eq 8) { "R-$rowIndex" } else { '' })
      $null = $fixtureNodes.Add([pscustomobject]@{
        aid=$fixtureTableAid; name=$cellName; type='DataItem'; rid="row-$rowIndex-cell-$columnIndex"; on=$true; val=''
        checked=$null; selected=$(if ($rowIndex -eq 0 -and $columnIndex -eq 2) { $true } else { $null })
        toggleState=$null; x=(100 + 70 * $columnIndex); y=(270 + 30 * $rowIndex); w=70; h=30
      })
    }
  }
  for ($noiseIndex = $fixtureNodes.Count; $noiseIndex -lt $NodeCount; $noiseIndex++) {
    $noiseType = @('Text','Button','Edit','HeaderItem','DataItem')[$noiseIndex % 5]
    $null = $fixtureNodes.Add([pscustomobject]@{
      aid="SSE_Application.Noise.noise_$noiseIndex"; name="noise-$noiseIndex"; type=$noiseType
      rid="noise-$noiseIndex"; on=[bool]($noiseIndex % 3); val='noise'
      checked=$null; selected=$null; toggleState=$null
      x=($noiseIndex % 1200); y=(2000 + $noiseIndex); w=20; h=20
    })
  }
  [pscustomobject]@{ state='list'; window=0; nodes=[object[]]$fixtureNodes; stats=[pscustomobject]@{ n=$fixtureNodes.Count } }
}

function Invoke-ReceiptListOutcome([string]$CommandName, $FixtureState, $ListPolicy) {
  try {
    $result = & $CommandName $FixtureState $ListPolicy
    [pscustomobject]@{ ok=$true; json=($result | ConvertTo-Json -Depth 12 -Compress); result=$result; error=$null }
  } catch {
    [pscustomobject]@{ ok=$false; json=$null; result=$null; error=[string]$_.Exception.Message }
  }
}

function Assert-ReceiptListParity($FixtureState, $ListPolicy, [string]$CaseName) {
  $legacy = Invoke-ReceiptListOutcome 'Get-LegacySSEReceiptManagerListProjection' $FixtureState $ListPolicy
  $indexed = Invoke-ReceiptListOutcome 'Get-SSEReceiptManagerListProjection' $FixtureState $ListPolicy
  Assert-True ($legacy.ok -eq $indexed.ok) "$CaseName hat ein abweichendes Erfolgs-/Fehlerergebnis."
  if ($legacy.ok) {
    Assert-True ($legacy.json -ceq $indexed.json) "$CaseName veraendert Projektion oder Fingerprint."
  } else {
    Assert-True ($legacy.error -ceq $indexed.error) "$CaseName veraendert den fail-closed Fehler."
  }
  $indexed
}

$listFixture0 = New-ReceiptListFixture $policy 24 0
$listFixture1 = New-ReceiptListFixture $policy 40 1
$listFixture30 = New-ReceiptListFixture $policy 800 30
$null = Assert-ReceiptListParity $listFixture0 $policy 'zero-row-list'
$listFixture1Outcome = Assert-ReceiptListParity $listFixture1 $policy 'one-row-list'
$null = Assert-ReceiptListParity $listFixture30 $policy 'thirty-row-list'
Assert-True ($listFixture1Outcome.ok -and $listFixture1Outcome.result.rowsComplete -and
  $listFixture1Outcome.result.rows.Count -eq 1) 'Die kleine Beleglistenprojektion ist unvollstaendig.'

$countSuffixesForTest = @($policy.list.countLabelAutomationIdSuffixes | ForEach-Object { [string]$_ })
$countNodes = @($listFixture1.nodes | Where-Object {
  $aid = [string]$_.aid
  @($countSuffixesForTest | Where-Object { $aid.EndsWith($_, [StringComparison]::Ordinal) }).Count
})
$countNodes[0].name = 'MEINE'
$countNodes[1].name = 'BELEGE'
$countNodes[2].name = '(1)'
$nonCountNodes = @($listFixture1.nodes | Where-Object { $_ -notin $countNodes })
$reorderedCountState = [pscustomobject]@{
  state='list'; window=0
  nodes=@($countNodes[2],$countNodes[0],$countNodes[1]) + $nonCountNodes
  stats=$listFixture1.stats
}
$reorderedOutcome = Assert-ReceiptListParity $reorderedCountState $policy 'count-profile-order'
Assert-True ($reorderedOutcome.json -ceq $listFixture1Outcome.json) `
  'Belegzaehler werden in Traversal- statt Profilreihenfolge zusammengesetzt.'

$duplicateCountState = [pscustomobject]@{
  state='list'; window=0; stats=$listFixture1.stats
  nodes=@($listFixture1.nodes) + @([pscustomobject]@{
    aid=[string]$countNodes[0].aid; name='hidden disabled duplicate'; type='Pane'; rid='count-duplicate'
    on=$false; val=''; checked=$null; selected=$null; toggleState=$null; x=0; y=0; w=0; h=0
  })
}
$duplicateCountOutcome = Assert-ReceiptListParity $duplicateCountState $policy 'count-cardinality-without-geometry-gate'
Assert-True (-not $duplicateCountOutcome.ok) 'Ein verborgenes/deaktiviertes Zaehlerduplikat wurde nicht fail-closed erkannt.'

$caseCountPolicy = $policy | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$caseCountPolicy.list.countLabelAutomationIdSuffixes = @('.countPart','.COUNTPART','.countPart')
$caseCountState = New-ReceiptListFixture $caseCountPolicy 40 1
$caseCountState.nodes = @($caseCountState.nodes | Where-Object {
  [string]$_.aid -cne 'SSE_Application.BMMainWindow.countPart' -or [string]$_.rid -ceq 'count-0'
})
$caseCountOutcome = Assert-ReceiptListParity $caseCountState $caseCountPolicy 'overlapping-case-distinct-count-suffixes'
Assert-True ($caseCountOutcome.ok) 'Case-verschiedene oder doppelte Zaehler-Suffixe wurden vermischt.'

$classificationDecoys = @(
  [pscustomobject]@{ aid=([string]$listFixture1.nodes[0].aid); name='disabled'; type='Table'; rid='disabled-table'; on=$false; val=''; x=0; y=0; w=20; h=20 },
  [pscustomobject]@{ aid=([string]$listFixture1.nodes[0].aid); name='hidden'; type='Table'; rid='hidden-table'; on=$true; val=''; x=0; y=0; w=0; h=20 },
  [pscustomobject]@{ aid=([string]$listFixture1.nodes[0].aid).ToUpperInvariant(); name='foreign header'; type='HeaderItem'; rid='foreign-header'; on=$true; val=''; x=1; y=233; w=20; h=20 },
  [pscustomobject]@{ aid=([string]$listFixture1.nodes[0].aid).ToUpperInvariant(); name='foreign data'; type='DataItem'; rid='foreign-data'; on=$true; val=''; x=1; y=270; w=20; h=20 },
  [pscustomobject]@{ aid=([string]$listFixture1.nodes[0].aid); name='above table'; type='DataItem'; rid='above-table'; on=$true; val=''; x=1; y=232; w=20; h=20 }
)
$decoyState = [pscustomobject]@{
  state='list'; window=0; stats=$listFixture1.stats; nodes=@($listFixture1.nodes) + $classificationDecoys
}
$decoyOutcome = Assert-ReceiptListParity $decoyState $policy 'table-header-data-gates'
Assert-True ($decoyOutcome.json -ceq $listFixture1Outcome.json) `
  'Tabellen-, Header-, DataItem- oder Y-Grenzen veraendern die Projektion.'

$caseTypeState = $listFixture1 | ConvertTo-Json -Depth 12 | ConvertFrom-Json
foreach ($node in @($caseTypeState.nodes)) {
  if ([string]$node.type -in @('Table','HeaderItem','DataItem','Edit')) {
    $node.type = ([string]$node.type).ToLowerInvariant()
  }
}
$null = Assert-ReceiptListParity $caseTypeState $policy 'case-insensitive-control-types'

$random = [Random]::new(31001)
for ($shuffleIndex = 0; $shuffleIndex -lt 8; $shuffleIndex++) {
  $nodes = New-Object System.Collections.ArrayList
  foreach ($node in $listFixture1.nodes) { $null = $nodes.Add($node) }
  for ($left = $nodes.Count - 1; $left -gt 0; $left--) {
    $right = $random.Next(0, $left + 1)
    $swap = $nodes[$left]; $nodes[$left] = $nodes[$right]; $nodes[$right] = $swap
  }
  $shuffledState = [pscustomobject]@{ state='list'; window=0; nodes=[object[]]$nodes; stats=$listFixture1.stats }
  $shuffledOutcome = Assert-ReceiptListParity $shuffledState $policy "list-shuffle-$shuffleIndex"
  Assert-True ($shuffledOutcome.json -ceq $listFixture1Outcome.json) `
    "Eindeutige Listenprojektion driftet nach Shuffle $shuffleIndex."
}

# ScriptProperty-Zugriffe begrenzen das beobachtbare Node-Property-Arbeitsvolumen,
# ohne eine konkrete Collection- oder Indeximplementierung festzuschreiben.
$countedListNodes = New-Object System.Collections.ArrayList
foreach ($node in $listFixture30.nodes) {
  $counted = [pscustomobject]@{ aidValue=[string]$node.aid }
  foreach ($property in @($node.PSObject.Properties | Where-Object { $_.Name -cne 'aid' })) {
    $counted | Add-Member -NotePropertyName $property.Name -NotePropertyValue $property.Value
  }
  $counted | Add-Member -MemberType ScriptProperty -Name aid -Value {
    $script:ReceiptListAidReads++
    [string]$this.aidValue
  }
  $null = $countedListNodes.Add($counted)
}
$countedListState = [pscustomobject]@{
  state='list'; window=0; nodes=[object[]]$countedListNodes; stats=$listFixture30.stats
}
$legacyList30 = Invoke-ReceiptListOutcome 'Get-LegacySSEReceiptManagerListProjection' $listFixture30 $policy
$script:ReceiptListAidReads = 0
$indexedCounted30 = Get-SSEReceiptManagerListProjection $countedListState $policy
$indexedListAidReads = [int]$script:ReceiptListAidReads
Assert-True ($legacyList30.ok -and
  (($indexedCounted30 | ConvertTo-Json -Depth 12 -Compress) -ceq $legacyList30.json)) `
  'Der lineare Listen-Zugriffsguard veraendert Projektion oder Fingerprint.'
Assert-True ($indexedListAidReads -le (2 * $countedListNodes.Count)) `
  "Beleglisten-Klassifikation liest aid nicht linear ($indexedListAidReads Zugriffe fuer $($countedListNodes.Count) Knoten)."

if ($env:SSE_RECEIPT_LIST_BENCHMARK -eq '1') {
  $benchmarkListState = New-ReceiptListFixture $policy 800 30
  $benchmarkCommands = @(
    'Get-LegacySSEReceiptManagerListProjection',
    'Get-SSEReceiptManagerListProjection'
  )
  $benchmarkSamples = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([StringComparer]::Ordinal)
  foreach ($commandName in $benchmarkCommands) {
    $benchmarkSamples.Add($commandName, (New-Object System.Collections.ArrayList))
    for ($warmup = 0; $warmup -lt 3; $warmup++) {
      $null = & $commandName $benchmarkListState $policy
    }
  }
  for ($sampleIndex = 0; $sampleIndex -lt 31; $sampleIndex++) {
    $sampleCommands = $(if (($sampleIndex % 2) -eq 0) {
      $benchmarkCommands
    } else { @($benchmarkCommands[1],$benchmarkCommands[0]) })
    foreach ($commandName in $sampleCommands) {
      $watch = [Diagnostics.Stopwatch]::StartNew()
      $null = & $commandName $benchmarkListState $policy
      $watch.Stop()
      $null = ([Collections.ArrayList]$benchmarkSamples[$commandName]).Add($watch.Elapsed.TotalMilliseconds)
    }
  }
  foreach ($commandName in $benchmarkCommands) {
    $ordered = @(([Collections.ArrayList]$benchmarkSamples[$commandName]) | Sort-Object)
    $p50 = $ordered[[int]([Math]::Ceiling($ordered.Count * 0.50) - 1)]
    $p95 = $ordered[[int]([Math]::Ceiling($ordered.Count * 0.95) - 1)]
    Write-Output ("RECEIPT_LIST_BENCH {0} p50={1:N3}ms p95={2:N3}ms n={3}" -f `
      $commandName,$p50,$p95,$ordered.Count)
  }
}

$projectionStart = $worker.IndexOf('function Get-SSEReceiptManagerListProjection(')
$projectionEnd = $worker.IndexOf('function Resolve-SSEReceiptManagerVisibleRowTarget(', $projectionStart)
Assert-True ($projectionStart -ge 0 -and $projectionEnd -gt $projectionStart) 'BelegManager-Listenprojektion ist nicht eindeutig abgrenzbar.'
$projectionBlock = $worker.Substring($projectionStart, $projectionEnd - $projectionStart)
foreach ($required in @(
  '[Windows.Automation.GridPattern]::Pattern',
  '$gridRowCount -eq $count',
  '$filterText.Length -gt 0',
  '$projectionExpectedCount = $gridRowCount',
  '$grid.GetItem($gridRow, $gridColumn)',
  '$projectedCellGroups.Count -ne $count'
)) {
  Assert-True ($projectionBlock.Contains($required)) "BelegManager-Listenprojektion enthaelt den Virtualisierungs-Guard '$required' nicht."
}
foreach ($forbidden in @('SetScrollPercent(', 'ScrollIntoView(', 'Click-VerifiedPoint')) {
  Assert-True (-not $projectionBlock.Contains($forbidden)) "BelegManager-Gridprojektion ist nicht rein lesend: '$forbidden'."
}

$listReadStart = $worker.IndexOf("  'receipt_manager_list' {")
$listReadEnd = $worker.IndexOf("  'receipt_manager_read' {", $listReadStart)
Assert-True ($listReadStart -ge 0 -and $listReadEnd -gt $listReadStart) 'receipt_manager_list-Operationsblock ist nicht eindeutig abgrenzbar.'
$listReadBlock = $worker.Substring($listReadStart, $listReadEnd - $listReadStart)
foreach ($required in @('Get-SSEReceiptManagerListProjection','rowsComplete','physicalInputUsed=$false')) {
  Assert-True ($listReadBlock.Contains($required)) "receipt_manager_list enthaelt den Guard '$required' nicht."
}
foreach ($forbidden in @('Click-VerifiedPoint','SendKeys','Invoke-DialogButtonInfo')) {
  Assert-True (-not $listReadBlock.Contains($forbidden)) "receipt_manager_list ist nicht rein lesend: '$forbidden'."
}

$receiptReadStart = $listReadEnd
$receiptReadEnd = $worker.IndexOf("  'receipt_manager_update' {", $receiptReadStart)
Assert-True ($receiptReadStart -ge 0 -and $receiptReadEnd -gt $receiptReadStart) 'receipt_manager_read-Operationsblock ist nicht eindeutig abgrenzbar.'
$receiptReadBlock = $worker.Substring($receiptReadStart, $receiptReadEnd - $receiptReadStart)
Assert-True ($receiptReadBlock.Contains('Get-SSEReceiptManagerState $toolHwnd $policy -WithValues')) 'receipt_manager_read muss sichtbare Detailwerte und ReadOnly-Zustaende mit ValuePattern lesen.'
Assert-True ($receiptReadBlock.Contains('$expectedSemanticRows')) 'receipt_manager_read muss nach dem Schliessen Runtime-ID-Drift ueber fachliche Zeilenfingerprints tolerieren.'
Assert-True ($receiptReadBlock.Contains('| Sort-Object')) 'receipt_manager_read muss eine reine Qt-Neusortierung als inhaltlich unveraendertes Multiset behandeln.'
Assert-True ($receiptReadBlock.Contains('$semanticRowAfterMatches.Count -eq 1')) 'receipt_manager_read muss die Zielzeile nach einer Qt-Neusortierung ueber die exakte fachliche Identitaet rebound binden.'
Assert-True ($receiptReadBlock.Contains('$detailIdentityMatchesTarget')) 'receipt_manager_read darf Detailwerte nur fuer exakt denselben Titel und dieselbe Belegnummer bestaetigen.'
Assert-True ($receiptReadBlock.Contains('-not [string]$rowBefore.documentNumber')) 'Eine im Grid nachweislich nicht exponierte Belegnummer darf die exakte Titel-/Zeilenbindung nicht kuenstlich stale machen.'
Assert-True ($receiptReadBlock.Contains('Resolve-SSEReceiptManagerVisibleRowTarget')) 'receipt_manager_read muss virtualisierte Offscreen-Belege vor dem Klick sicher sichtbar binden.'
Assert-True ($receiptReadBlock.Contains("method='already-open-detail'")) 'receipt_manager_read muss eine exakt gebundene bereits offene Detailansicht ohne erneuten Zeilenklick lesen.'
Assert-True ($receiptReadBlock.IndexOf('$detailState = Get-SSEReceiptManagerState $toolHwnd $policy -WithValues') -lt
  $receiptReadBlock.IndexOf('Resolve-SSEReceiptManagerVisibleRowTarget')) 'receipt_manager_read muss eine offene Detailansicht mit vollstaendigen Werten pruefen, bevor es die Tabellenzeile erneut bindet.'

$updateStart = $receiptReadEnd
$updateEnd = $worker.IndexOf("  'receipt_manager_import' {", $updateStart)
Assert-True ($updateStart -ge 0 -and $updateEnd -gt $updateStart) 'receipt_manager_update-Operationsblock ist nicht eindeutig abgrenzbar.'
$updateBlock = $worker.Substring($updateStart, $updateEnd - $updateStart)
Assert-True ($updateBlock.Contains("[string]`$transaction.name -ceq 'vatRate'")) 'USt-Feld muss eine eigene typisierte Auswahl verwenden.'
Assert-True ($updateBlock.Contains('Set-SSEReceiptManagerVatRateSelection')) 'USt-Feld muss ueber die profilierte ComboBox-Option statt freien Text gesetzt werden.'
Assert-True ($updateBlock.Contains("Resolve-SSEReceiptManagerEditableFieldNode `$vatState `$policy 'vatRate'")) 'USt-Feld muss vor der Auswahl aus einem frischen Zustandsbaum aufgeloest werden.'

$visibleRowStart = $worker.IndexOf('function Resolve-SSEReceiptManagerVisibleRowTarget(')
$visibleRowEnd = $worker.IndexOf('function Get-SSEReceiptManagerDetailProjection(', $visibleRowStart)
Assert-True ($visibleRowStart -ge 0 -and $visibleRowEnd -gt $visibleRowStart) 'Offscreen-Belegbindung ist nicht eindeutig abgrenzbar.'
$visibleRowBlock = $worker.Substring($visibleRowStart, $visibleRowEnd - $visibleRowStart)
foreach ($required in @(
  '[Windows.Automation.GridPattern]::Pattern',
  '[Windows.Automation.ScrollItemPattern]::Pattern',
  '[Windows.Automation.SelectionItemPattern]::Pattern',
  '[Windows.Automation.SelectionPattern]::Pattern',
  'Current.IsSelected',
  '$postClickSelectionObject',
  'Current.CanSelectMultiple',
  '$preparationClickBinding = Click-VerifiedPoint',
  'detailOpened=$true',
  '$projectedSelectedRows.Count -ne 1',
  '$AE::FromPoint',
  '[SW]::WindowFromPoint($point)',
  '[SW]::mouse_event(0x0800',
  'Get-SSEPointObstruction $ToolHwnd',
  '$expectedRowsJson',
  '$expectedTargetCellsJson',
  'Get-LiveElement $ToolHwnd ([string]$Row.rowRid)',
  'Get-SSEReceiptManagerStableCellNames',
  'Test-SSEPointElementWithinExactReceiptTitle',
  '([string]$rowNow[0].rowRid)',
  "`$scrollMethod = 'verified-wheel'"
)) {
  Assert-True ($visibleRowBlock.Contains($required)) "Offscreen-Belegbindung fehlt der Guard '$required'."
}

foreach ($required in @(
  "Arg `$a 'acknowledgeUpdate'",
  'rowFingerprint',
  'expectedListFingerprint',
  'expectedDetailFingerprint',
  'Resolve-SSEReceiptManagerEditableFieldNode',
  'Get-SSEReceiptManagerLiveEditableField',
  'Wait-SSEReceiptManagerLiveFieldValue',
  'Commit-TrackedValue',
  'Click-VerifiedPoint',
  'Close-SSEReceiptManagerDetailView',
  'Get-SSEReceiptManagerDetailIdentityTitle',
  '$titleIdentityMatchCount -eq 1',
  '-not $documentNumberCellIndices.Count',
  'rollbackEntries',
  'offeneBedingungen=@($openConditions)',
  'otherRowsUnchanged',
  'dirtyStateUnchanged'
)) {
  Assert-True ($updateBlock.Contains($required)) "receipt_manager_update enthaelt den Guard '$required' nicht."
}
foreach ($forbidden in @("Arg `$a 'name'", "Arg `$a 'aid'", "Arg `$a 'rid'", "Arg `$a 'x'", "Arg `$a 'y'")) {
  Assert-True (-not $updateBlock.Contains($forbidden)) "receipt_manager_update akzeptiert den freien Selektor '$forbidden'."
}
$missingGridNumberFallback = $updateBlock.IndexOf(
  'if ([bool]$finalList.rowsComplete -and $titleIdentityMatchCount -eq 1 -and')
$identityDeadlineCheck = $updateBlock.IndexOf(
  'if ([DateTime]::UtcNow -ge $identityDeadline) { break }', $missingGridNumberFallback)
$identityRepoll = $updateBlock.IndexOf(
  '$finalState = Get-SSEReceiptManagerState $toolHwnd $policy', $identityDeadlineCheck)
Assert-True ($missingGridNumberFallback -ge 0 -and
  $identityDeadlineCheck -gt $missingGridNumberFallback -and $identityRepoll -gt $identityDeadlineCheck) `
  'Eine vollstaendige, eindeutig titelgebundene Liste ohne exponierte Belegnummer muss vor Deadline und Vollbaum-Repoll rebound werden.'
$updateOnlyEnd = $worker.IndexOf("  'receipt_manager_classification_options' {", $updateStart)
$updateOnlyBlock = $worker.Substring($updateStart, $updateOnlyEnd - $updateStart)
Assert-True (
  ($updateOnlyBlock.Split(@('Get-SSEReceiptManagerState $toolHwnd $policy -WithValues'), [StringSplitOptions]::None).Count - 1) -eq 5
) 'receipt_manager_update darf Vollbaum-Readbacks nur fuer Ausgangsbindung, typisierte USt-Auswahl/Rollback, Detailbindung und Abschlusszustand verwenden.'

$start = $worker.IndexOf("  'receipt_manager_action' {")
$end = $worker.IndexOf("  'ui_state' {", $start)
Assert-True ($start -ge 0 -and $end -gt $start) 'receipt_manager_action-Operationsblock ist nicht eindeutig abgrenzbar.'
$block = $worker.Substring($start, $end - $start)
foreach ($required in @(
  'Resolve-SSEMainWindowDescriptor',
  "Resolve-SSEToolWindowHandle 'receiptManager'",
  'Get-SSEReceiptManagerState',
  'Get-DialogInventory',
  'Test-Versand',
  'Get-LiveElement $toolHwnd $freshMatches[0].rid',
  'Click-VerifiedPoint $toolHwnd $freshTarget $inputTick -RequireForeground',
  'windowSetUnchanged',
  'dirtyStateUnchanged',
  "kind='postcondition-failed'",
  'keine Wiederholung'
)) {
  Assert-True ($block.Contains($required)) "receipt_manager_action enthaelt den Guard '$required' nicht."
}
foreach ($forbidden in @("Arg `$a 'name'", "Arg `$a 'aid'", "Arg `$a 'rid'", "Arg `$a 'x'", "Arg `$a 'y'")) {
  Assert-True (-not $block.Contains($forbidden)) "receipt_manager_action akzeptiert den freien Selektor '$forbidden'."
}

$importStart = $worker.IndexOf("  'receipt_manager_import' {")
$deleteStart = $worker.IndexOf("  'receipt_manager_delete' {", $importStart)
Assert-True ($importStart -ge 0 -and $deleteStart -gt $importStart) 'Import- und Loeschoperation sind nicht eindeutig angeordnet.'
$importBlock = $worker.Substring($importStart, $deleteStart - $importStart)
foreach ($required in @(
  "Arg `$a 'acknowledgeImport'",
  'expectedListFingerprint',
  'expectedCountBefore',
  'supportedExtensions',
  'Test-SSEReceiptManagerPdfHeader',
  "'unsupported-format'",
  'draftCount',
  'Get-SSEWindowRegionPixelFingerprint',
  'Invoke-SSEReceiptManagerOpenFileDialog',
  'sourceHashStable',
  'previewChanged',
  'cleanupRequired=$true',
  'NICHT wiederholen'
)) {
  Assert-True ($importBlock.Contains($required)) "receipt_manager_import enthaelt den Guard '$required' nicht."
}
Assert-True ($importBlock.IndexOf('supportedExtensions') -lt $importBlock.IndexOf('Resolve-SSEMainWindowDescriptor')) 'Nicht unterstuetzte Belegformate muessen vor jeder UI-Bindung abgewiesen werden.'
foreach ($forbidden in @("Arg `$a 'name'", "Arg `$a 'aid'", "Arg `$a 'rid'", "Arg `$a 'x'", "Arg `$a 'y'")) {
  Assert-True (-not $importBlock.Contains($forbidden)) "receipt_manager_import akzeptiert den freien Selektor '$forbidden'."
}
Assert-True (-not $importBlock.Contains('$oldRowIds')) 'Belegimport darf neue Entwuerfe nicht ueber fluechtige UIA-Runtime-IDs erkennen.'
Assert-True ($importBlock.Contains('$createdRows = @($createdList.rows | Where-Object { [bool]$_.draft })')) 'Belegimport muss den nach der entwurfsfreien Vorbedingung eindeutigen neuen Entwurf binden.'
Assert-True ($importBlock.Contains('$afterCreatedRows = @($listAfter.rows | Where-Object { [bool]$_.draft })')) 'Belegimport muss den Entwurf nach der Dateiauswahl erneut semantisch binden.'
Assert-True ($importBlock.Contains('$oldContentFingerprints | Sort-Object | ConvertTo-Json -Compress')) 'Belegimport muss bestehende Inhalte als exaktes Multiset statt in fluechtiger visueller Reihenfolge vergleichen.'

$classificationToggleStart = $worker.IndexOf('function Get-SSEReceiptManagerClassificationToggleElement(')
$classificationToggleEnd = $worker.IndexOf('function Close-SSEReceiptManagerClassificationDialog(', $classificationToggleStart)
Assert-True ($classificationToggleStart -ge 0 -and $classificationToggleEnd -gt $classificationToggleStart) 'Kategorien-Toggle-Bindung ist nicht eindeutig abgrenzbar.'
$classificationToggleBlock = $worker.Substring($classificationToggleStart, $classificationToggleEnd - $classificationToggleStart)
foreach ($required in @(
  'ScrollItemPattern',
  'ScrollPattern',
  '$outsideTable',
  '$cellY -ge ([double]$tableRect.Y + [double]$tableRect.Height)',
  '[SW]::WindowFromPoint($point)',
  '[SW]::mouse_event(0x0800',
  'ist verdeckt; die Auswahltabelle wurde nicht gerollt'
)) {
  Assert-True ($classificationToggleBlock.Contains($required)) "Kategorien-Toggle fehlt der Sichtbarkeits-/Scroll-Guard '$required'."
}

Assert-True (@($policy.linkValueTransferDialog.fingerprints).Count -eq 3) 'Die drei live gemessenen Belegwerte-Dialogvarianten fehlen im Profil.'
Assert-True (-not @($policy.linkValueTransferDialog.fingerprints | Where-Object {
  [string]$_ -notmatch '^[A-Fa-f0-9]{64}$'
}).Count) 'Belegwerte-Dialogvarianten enthalten keinen gueltigen Fingerprintvertrag.'
Assert-True ($worker.Contains('[string]$descriptor.fingerprint -cnotin $acceptedTransferFingerprints')) 'Link-Operation akzeptiert die profilierten Belegwerte-Dialogvarianten nicht fail-closed.'
$linkStart = $worker.IndexOf("  'receipt_manager_link' {")
$linkEnd = $worker.IndexOf("  'receipt_manager_import' {", $linkStart)
Assert-True ($linkStart -ge 0 -and $linkEnd -gt $linkStart) 'Link-Operation ist nicht eindeutig abgrenzbar.'
$linkBlock = $worker.Substring($linkStart, $linkEnd - $linkStart)
foreach ($required in @(
  '$linkItems.Count -gt 20',
  'expectedDocumentNumber',
  '$projectionsBefore.Add',
  '$setListSearch',
  '$cancelStagedMode',
  '[Windows.Automation.ValuePattern]::Pattern',
  'Commit-TrackedValue $modeBefore.hwnd $searchNodes[0]',
  'Get-SSEReceiptManagerState $modeBefore.hwnd $policy -WithValues',
  'Vollstaendige Belegliste kehrte nach dem Batch nicht exakt',
  '[Windows.Automation.InvokePattern]::Pattern',
  "method='invoke-pattern'",
  'Select-Object -Unique',
  'foreach ($itemIndex in $changes)',
  '[Windows.Automation.ScrollItemPattern]::Pattern',
  '[Windows.Automation.ScrollPattern]::Pattern',
  'SetScrollPercent(',
  'ScrollIntoView()',
  "[Windows.Forms.SendKeys]::SendWait('^{HOME}')",
  "'{PGDN}'",
  "'{PGUP}'",
  '[Windows.Automation.SelectionItemPattern]::Pattern',
  '$selectedTogglePoint',
  '$focusCandidates',
  'fuer den begrenzten Tastatur-Fokus',
  '$previousExpectedCount',
  '$actualStartText',
  "gelesen '`$actualStartText'",
  '$retryClick = Click-VerifiedPoint',
  '$projectionBefore = & $readMode $stagedMode $item',
  '$applyClick = & $closeMode',
  '$projectionsAfter.Add',
  "'ambiguous'",
  'changedCount=$changes.Count'
)) {
  Assert-True ($linkBlock.Contains($required)) "receipt_manager_link enthaelt den Batch-Guard '$required' nicht."
}
Assert-True (-not $linkBlock.Contains("Arg `$a 'force'")) 'Mehrdeutige Belegtitel duerfen nicht mit force umgangen werden.'
Assert-True (($linkBlock.Split(@('$applyClick = & $closeMode'), [StringSplitOptions]::None).Count - 1) -eq 1) 'Batch-Link darf nur einmal Uebernehmen ausloesen.'
Assert-True (($linkBlock.Split(@('$modeAfter = & $openMode'), [StringSplitOptions]::None).Count - 1) -eq 1) 'Batch-Link darf nur einen Persistenz-Readback-Zyklus oeffnen.'
$dialogImportStart = $worker.IndexOf('function Invoke-SSEReceiptManagerOpenFileDialog(')
$dialogImportEnd = $worker.IndexOf('function Resolve-SSEPageObject(', $dialogImportStart)
Assert-True ($dialogImportStart -ge 0 -and $dialogImportEnd -gt $dialogImportStart) 'Gebundener Belegimport-Dialogweg ist nicht eindeutig abgrenzbar.'
$dialogImportBlock = $worker.Substring($dialogImportStart, $dialogImportEnd - $dialogImportStart)
Assert-True ($dialogImportBlock.Contains('Resolve-SSEDialogFieldHandle $dialogHwnd $field')) 'Belegimport muss das native Dateiname-Control binden.'
Assert-True ($dialogImportBlock.Contains("Set-SSEDialogFieldText `$dialogHwnd `$fieldHandle `$field `$Path 'Dateiname-Feld'")) 'Belegimport muss den gemeinsamen Unicode- und Readback-gesicherten Dialogfeldweg verwenden.'
Assert-True ($dialogImportBlock.Contains('dialogProfileFingerprintMatched=$profileFingerprintMatched')) 'Belegimport muss generische Windows-Dialogdrift im Readback ausweisen.'
Assert-True (-not $dialogImportBlock.Contains("Fail 'Belegimport-Dialog stimmt nicht mit dem gemessenen Fingerprint ueberein")) 'Ordnerabhaengige Windows-Dialogdrift darf einen strukturell exakt gebundenen Import nicht technisch sperren.'
Assert-True ($dialogImportBlock.Contains('TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern')) 'Der native Oeffnen-Schalter muss vor dem physischen Fallback per InvokePattern bedient werden.'
Assert-True ($dialogImportBlock.Contains('[SW]::GetDlgItem($dialogHwnd, 1)')) 'Der native Oeffnen-Fallback muss exakt an Control-ID 1 gebunden sein.'
Assert-True ($dialogImportBlock.Contains('0x00F5')) 'Der geometrisch und textuell verifizierte native Oeffnen-Fallback muss BM_CLICK verwenden.'
Assert-True (-not $dialogImportBlock.Contains('Click-VerifiedPoint $dialogHwnd $openButtons[0]')) 'Der Windows-Hit-Test darf den nativen Oeffnen-Schalter nicht erneut gegen das darunterliegende Qt-Fenster verwerfen.'
Assert-True (-not $dialogImportBlock.Contains("SendKeys]::SendWait('^a')")) 'Belegimport darf Ctrl+A nicht zum Leeren des nativen Dateiname-Felds verwenden.'
Assert-True (-not $dialogImportBlock.Contains('ConvertTo-SendKeysLiteral $Path')) 'Belegimport darf den Dateipfad nicht vom aktiven Tastaturlayout abhaengig eingeben.'

$readStart = $worker.IndexOf("  'receipt_manager_read' {")
$updateStart = $worker.IndexOf("  'receipt_manager_update' {", $readStart)
Assert-True ($readStart -ge 0 -and $updateStart -gt $readStart) 'Beleglesung ist nicht eindeutig abgrenzbar.'
$readBlock = $worker.Substring($readStart, $updateStart - $readStart)
Assert-True ($readBlock.Contains('row=$semanticRowAfterMatches[0]')) 'Beleglesung muss die semantisch reboundene post-selection Zeilenbindung zurueckgeben.'
Assert-True ($readBlock.Contains('$policy.controls.detailClose')) 'Beleglesung muss die Detailansicht ueber den profilierten Schalter wieder schliessen.'
Assert-True ($readBlock.Contains('[bool]$listAfter.rowsComplete')) 'Beleglesung muss vor dem Rueckgabebinding die vollstaendige Tabellenprojektion wiederherstellen.'
Assert-True ($readBlock.Contains('($actualSemanticRows | ConvertTo-Json -Compress) -ceq')) 'Beleglesung muss nach dem Schliessen der Details das fachliche Listen-Multiset beweisen.'
Assert-True ($readBlock.Contains('$semanticRowAfterMatches.Count -eq 1')) 'Beleglesung muss nach dem Schliessen weiterhin exakt dieselbe fachliche Zielzeile binden.'
Assert-True ($readBlock.Contains('offeneBedingungen=@($openConditions)')) 'Beleglesung muss gerissene Sammelpostconditions einzeln und wertfrei diagnostizieren.'

$actionStart = $worker.IndexOf("  'receipt_manager_action' {", $deleteStart)
Assert-True ($deleteStart -ge 0 -and $actionStart -gt $deleteStart) 'Loeschoperation ist nicht eindeutig abgrenzbar.'
$deleteBlock = $worker.Substring($deleteStart, $actionStart - $deleteStart)
foreach ($required in @(
  "Arg `$a 'acknowledgeDelete'",
  'rowFingerprint',
  'expectedListFingerprint',
  'expectedCountBefore',
  'deleteConfirmation.fingerprint',
  'Invoke-DialogButtonInfo',
  'remainingRowsUnchanged',
  'Resolve-SSEReceiptManagerVisibleRowTarget',
  '$visibleTarget.detailOpened',
  'NICHT wiederholen'
)) {
  Assert-True ($deleteBlock.Contains($required)) "receipt_manager_delete enthaelt den Guard '$required' nicht."
}
foreach ($forbidden in @("Arg `$a 'name'", "Arg `$a 'aid'", "Arg `$a 'x'", "Arg `$a 'y'")) {
  Assert-True (-not $deleteBlock.Contains($forbidden)) "receipt_manager_delete akzeptiert den freien Selektor '$forbidden'."
}

Write-Output 'BelegManager: focusless Liste aktiv; neun historische Vordergrundpfade vor Dispatcher und UI blockiert.'
