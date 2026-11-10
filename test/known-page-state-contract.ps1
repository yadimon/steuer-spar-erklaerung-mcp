# sse_page_state muss beschreiben, wie ein Feld zu beschreiben ist - und der
# Epoch-Hash darf davon nichts mitbekommen.
#
# Die Operation meldet den Zustand katalogisierter Felder. Ohne Werkzeugnamen und
# Automation-Endstueck muss der Aufrufer zusaetzlich sse_page_objects lesen und
# paart dann Zustand aus dem einen mit Metadaten aus dem anderen Aufruf - genau
# die Verwechslung, die eine Feldtransaktion unbrauchbar macht.
#
# Der Epoch-Hash bindet dagegen ausschliesslich den Zustand. Kaemen die
# Katalogangaben hinein, wuerde jede Umbenennung einer Beschriftung die Epoche
# aendern und laufende Plaene ohne Sachgrund verwerfen.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$workerSource = Get-Content -LiteralPath $workerPath -Raw
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$null, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

$definition = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-KnownPageState'
}, $true))
if ($definition.Count -ne 1) { throw 'Funktion Get-KnownPageState ist nicht eindeutig vorhanden.' }
$quelltext = $definition[0].Extent.Text

# Die Feldprojektion nennt Werkzeug und Kennung.
foreach ($schluessel in @('controlType=', 'valueKind=', 'writeTool=', 'automationIdSuffix=')) {
  if ($quelltext -notmatch [regex]::Escape($schluessel)) {
    throw "Die Feldprojektion von sse_page_state liefert '$schluessel' nicht."
  }
}
if ($quelltext -notmatch [regex]::Escape("PSObject.Properties['writeTool']")) {
  throw 'writeTool muss optional gelesen werden; nicht jedes Feld traegt eines.'
}

# Der Epoch-Hash bindet ausschliesslich Zustand.
$epochZeile = [regex]::Match($quelltext, '\[pscustomobject\]@\{ id=\$_\.fieldId;[^}]*\}')
if (-not $epochZeile.Success) { throw 'Der Epoch-Rumpf von sse_page_state ist nicht auffindbar.' }
foreach ($statisch in @('controlType', 'valueKind', 'writeTool', 'automationIdSuffix', 'label')) {
  if ($epochZeile.Value -match [regex]::Escape($statisch)) {
    throw "Der Epoch-Hash enthaelt die statische Katalogangabe '$statisch'; er darf nur Zustand binden."
  }
}
foreach ($zustand in @('value', 'enabled', 'readOnly')) {
  if ($epochZeile.Value -notmatch [regex]::Escape($zustand)) {
    throw "Der Epoch-Hash bindet '$zustand' nicht mehr."
  }
}

# Execute only the actual pure binding and heading helpers. The worker entry point and its
# UI Automation implementation are never loaded or dispatched by this test.
foreach ($helperName in @('Get-KnownPageHeading', 'Test-KnownPageHeading', 'Test-KnownPageFields')) {
  $helpers = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $helperName
  }, $true))
  if ($helpers.Count -ne 1) { throw "Heading helper is not unique: $helperName" }
  Invoke-Expression $helpers[0].Extent.Text
}

$profile = Get-Content -LiteralPath (Join-Path $root 'profiles\2025\profile.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($profile.status -cne 'supported') { throw 'The heading contract requires the actual supported 2025 profile.' }
$catalog = Get-Content -LiteralPath (Join-Path $root 'profiles\2025\page-objects.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$page = $catalog.pages.'gew.innergem_erwerb_13b_einfuhr'
if (-not $page -or -not $page.heading) { throw 'The actual innergem page definition is missing.' }
$script:headingWindow = [IntPtr]4242
$script:expectedHeadingAid = '.centralWidget.SearchSplitter.TopLevelHSplitter.RedThreadContent.ClientFrameSSE.ClientHeader.QLabel'
$script:headingFinds = New-Object System.Collections.ArrayList
$script:headingConversions = 0
$script:headingElement = $null

# These are the only replaced external UI boundaries. The finder binds the
# exact synthetic window and selector; conversion exposes an inert node only.
function Find-ExactAutomationElement {
  param([IntPtr]$Window, [string]$AutomationId, [switch]$VisibleOnly)
  $null = $script:headingFinds.Add([pscustomobject]@{
    hwnd=$Window; aid=$AutomationId; visibleOnly=[bool]$VisibleOnly
  })
  if ($Window -ne $script:headingWindow) { throw 'Heading lookup lost its exact window binding.' }
  if (-not $VisibleOnly) { throw 'Heading lookup must request VisibleOnly.' }
  if ($AutomationId -cne $script:expectedHeadingAid) { return $null }
  $script:headingElement
}
function Convert-ExactElementToNode {
  param($Element)
  $script:headingConversions++
  if ($null -eq $Element) { return $null }
  if (-not [object]::ReferenceEquals($Element, $script:headingElement)) {
    throw 'Heading conversion received an element outside the exact fixture boundary.'
  }
  $Element.node
}
function Invoke-HeadingFixture {
  param($Page, [string]$Title, [bool]$Visible=$true, [bool]$Missing=$false)
  $script:headingFinds.Clear(); $script:headingConversions = 0
  $script:headingElement = [pscustomobject]@{node=[pscustomobject]@{name=$Title; on=$Visible}}
  if ($Missing) { $script:headingElement = $null }
  $heading = Get-KnownPageHeading $script:headingWindow ([pscustomobject]@{page=$Page})
  $matches = Test-KnownPageHeading $heading $Page
  if ($script:headingFinds.Count -ne 1 -or $script:headingConversions -ne 1) {
    throw 'Heading proof must use exactly one exact lookup and one element conversion.'
  }
  [pscustomobject]@{heading=$heading; matches=$matches; lookup=$script:headingFinds[0]}
}

$positive = Invoke-HeadingFixture $page $page.heading
if ($positive.lookup.hwnd -ne $script:headingWindow -or -not $positive.lookup.visibleOnly -or
    $positive.lookup.aid -cne $script:expectedHeadingAid) {
  throw 'The supported innergem page must bind the exact main ClientHeader.QLabel heading selector with VisibleOnly.'
}
if ($positive.heading -cne $page.heading -or $positive.matches -ne $true) {
  throw 'The actual innergem heading getter and target predicate must prove the visible catalog heading.'
}

$removedSelector = $page | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$removedSelector.PSObject.Properties.Remove('headingAutomationIdRelative')
$changedSelector = $page | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$changedSelector | Add-Member -NotePropertyName headingAutomationIdRelative -NotePropertyValue '.Synthetic.WrongHeader.QLabel' -Force
foreach ($invalidPage in @($removedSelector, $changedSelector)) {
  $invalid = Invoke-HeadingFixture $invalidPage $page.heading
  if ($null -ne $invalid.heading -or $invalid.matches -ne $false) {
    throw 'A removed or changed heading selector must not prove the innergem target.'
  }
}
$wrongTitle = Invoke-HeadingFixture $page 'Synthetic unrelated heading'
if ($wrongTitle.heading -cne 'Synthetic unrelated heading' -or $wrongTitle.matches -ne $false) {
  throw 'An exact heading element with the wrong title must not prove the innergem target.'
}
$hidden = Invoke-HeadingFixture $page $page.heading -Visible $false
if ($null -ne $hidden.heading -or $hidden.matches -ne $false) {
  throw 'A heading that becomes hidden after the exact lookup must not prove the target.'
}
$missing = Invoke-HeadingFixture $page $page.heading -Missing $true
if ($null -ne $missing.heading -or $missing.matches -ne $false) {
  throw 'A missing heading node must not prove the innergem target.'
}

Write-Output 'Actual supported innergem heading helpers: exact visible window-bound selector, title and negative cases passed.'

# Execute the actual page-state expression and contiguous write guards. Only
# field lookup and failure/cleanup boundaries are inert; no worker dispatch,
# UI Automation, process query or input operation is loaded.
$statePredicates = @($ast.FindAll({ param($node)
  $node -is [Management.Automation.Language.HashtableAst] -and
  @($node.KeyValuePairs | Where-Object { $_.Item1.Value -ceq 'onExpectedPage' }).Count -eq 1
}, $true))
if ($statePredicates.Count -ne 1) { throw 'Page-state predicate is not unique.' }
$stateExpression = @($statePredicates[0].KeyValuePairs | Where-Object { $_.Item1.Value -ceq 'onExpectedPage' })[0].Item2
$stateProof = [scriptblock]::Create($stateExpression.Extent.Text)
$beforeAssignments = @($ast.FindAll({ param($node)
  $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$knownPageMatches'
}, $true))
$liveGuards = @($ast.FindAll({ param($node)
  $node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Clauses[0].Item1.Extent.Text.StartsWith('$fastKnown -and ') -and
  $node.Clauses[0].Item1.Extent.Text.Contains('$knownStateLive')
}, $true))
if ($beforeAssignments.Count -ne 1 -or $liveGuards.Count -ne 1) { throw 'Write guards are not unique.' }
$writeBlocks = @{}
foreach ($entry in @(@{name='before';node=$beforeAssignments[0];target='$node'}, @{name='live';node=$liveGuards[0];target='$liveNode'})) {
  $siblings = @($entry.node.Parent.Statements)
  $index = [array]::IndexOf($siblings,$entry.node)
  if ($index -lt 0 -or $index+3 -ge $siblings.Count -or
      $siblings[$index+2] -isnot [Management.Automation.Language.AssignmentStatementAst] -or
      $siblings[$index+2].Left.Extent.Text -cne $entry.target -or
      $siblings[$index+3] -isnot [Management.Automation.Language.IfStatementAst] -or
      $siblings[$index+3].Clauses[0].Item1.Extent.Text -cne ('-not ' + $entry.target)) {
    throw 'The actual contiguous page/target guards changed shape.'
  }
  $writeBlocks[$entry.name] = [scriptblock]::Create((@($siblings[$index..($index+3)] | ForEach-Object { $_.Extent.Text }) -join "`n"))
}
function Invoke-BindingGuardFixture($Page, $Fields, [bool]$Expected, [bool]$TargetPresent=$true, [string]$TargetId='bezeichnung') {
  $known=[pscustomobject]@{page=$Page;field=$Page.fields.PSObject.Properties[$TargetId].Value}
  $heading=[string]$Page.heading; $expectedPage=$heading; $hwnd=[IntPtr]7; $fastKnown=$true
  $state=[pscustomobject]@{heading=$heading;fields=$Fields;epoch='synthetic'}
  $knownStateBefore=$state; $knownStateLive=$state; $tracking=$null
  function Resolve-KnownFieldNode([IntPtr]$Window,$KnownField) {
    if ($Window -ne [IntPtr]7 -or -not [object]::ReferenceEquals($KnownField,$known)) { throw 'Foreign target lookup.' }
    if ($TargetPresent) { [pscustomobject]@{rid='synthetic-target';type='Edit'} }
  }
  function Resolve-TrackedFieldNode { throw 'Known-field guard used a broad fallback.' }
  function Close-TrackedResultWindow { $null }
  function Fail($Message,$Kind) { $error=[InvalidOperationException]::new($Message); $error.Data['kind']=$Kind; throw $error }
  if ([bool](& $stateProof) -ne $Expected) { throw 'Page-state binding predicate returned the wrong result.' }
  foreach ($stage in @('before','live')) {
    $failure=$null
    try { & $writeBlocks[$stage] } catch { $failure=$_.Exception }
    $expectedFailure=$(if (-not $Expected) { if ($stage -ceq 'before') {'precondition-failed'} else {'interference'} }
      elseif (-not $TargetPresent) { if ($stage -ceq 'before') {'not-found'} else {'stale'} } else {$null})
    if ($expectedFailure) {
      if (-not $failure -or $failure.Data['kind'] -cne $expectedFailure) { throw "Wrong $stage page/target refusal: $failure" }
    } elseif ($failure) { throw $failure }
  }
}
$assetPage=$catalog.pages.'gew.anlagevermoegen_wirtschaftsgut'
$mandatory=@('bezeichnung','belegnummer','kaufdatum','abschreibung_aktuelles_jahr')
if (($assetPage.bindingFieldIds -join ',') -cne ($mandatory -join ',')) { throw 'The actual asset page binding must name its four stable fields.' }
$assetFields=@($assetPage.fields.PSObject.Properties | ForEach-Object {
  [pscustomobject]@{fieldId=$_.Name;present=[bool]($mandatory -ccontains $_.Name)}
})
Invoke-BindingGuardFixture $assetPage $assetFields $true
# An optional target still needs its own successful exact lookup.
Invoke-BindingGuardFixture $assetPage $assetFields $true $false 'kaufpreis'
foreach ($missingId in $mandatory) {
  $missingFields=@($assetFields | ForEach-Object { [pscustomobject]@{fieldId=$_.fieldId;present=[bool]($_.present -and $_.fieldId -cne $missingId)} })
  Invoke-BindingGuardFixture $assetPage $missingFields $false
}
$foreign=@($mandatory | ForEach-Object { [pscustomobject]@{fieldId=('foreign.'+$_);present=$true} })
Invoke-BindingGuardFixture $assetPage $foreign $false
Invoke-BindingGuardFixture $assetPage (@($assetFields)+@([pscustomobject]@{fieldId='bezeichnung';present=$true})) $false
$wrongType=@($assetFields | ForEach-Object { [pscustomobject]@{fieldId=$_.fieldId;present=$(if ($_.fieldId -ceq 'bezeichnung') {'true'} else {$_.present})} })
Invoke-BindingGuardFixture $assetPage $wrongType $false
foreach ($invalidIds in @(
  @{ids=@()}, @{ids=$null}, @{ids='bezeichnung'}, @{ids=@('bezeichnung','bezeichnung')},
  @{ids=@('foreign')}, @{ids=@('Bezeichnung')}, @{ids=@(' ')}, @{ids=@(7)}
)) {
  $invalidPage=$assetPage | ConvertTo-Json -Depth 30 | ConvertFrom-Json
  $invalidPage.bindingFieldIds=$invalidIds.ids
  Invoke-BindingGuardFixture $invalidPage $assetFields $false
}
$defaultPage=$assetPage | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$defaultPage.PSObject.Properties.Remove('bindingFieldIds')
$allFields=@($assetFields | ForEach-Object { [pscustomobject]@{fieldId=$_.fieldId;present=$true} })
Invoke-BindingGuardFixture $defaultPage $allFields $true
Invoke-BindingGuardFixture $defaultPage $assetFields $false
foreach ($emptyPage in @([pscustomobject]@{fields=[pscustomobject]@{}},[pscustomobject]@{heading='Table only'})) {
  if (-not (Test-KnownPageFields $emptyPage @())) { throw 'A default page without fields lost its existing empty binding.' }
  $emptyPage | Add-Member NoteProperty bindingFieldIds @('bezeichnung')
  if (Test-KnownPageFields $emptyPage @()) { throw 'An explicit binding without catalog fields was accepted.' }
}
Write-Output 'Page binding: actual state/write guards share exact mandatory IDs; optional variants, malformed bindings and missing targets checked without UI.'

# The supported follow-year entry module needs its own document-bound asset
# page. A Gew page with an identical heading is not its replacement.
$entryAssetPage=$catalog.pages.'gew_erfass.anlagevermoegen_wirtschaftsgut'
if (-not $entryAssetPage -or $entryAssetPage.documentType -cne 'GewErfass2026' -or
    $assetPage.documentType -cne 'Gew2025' -or $entryAssetPage.headingNumberedTitle -ne $true -or
    $entryAssetPage.PSObject.Properties['headingPrefix']) {
  throw 'Asset pages must retain separate exact document bindings and a bounded numbered entry heading.'
}
if (($entryAssetPage.fields | ConvertTo-Json -Depth 30 -Compress) -cne
    ($assetPage.fields | ConvertTo-Json -Depth 30 -Compress)) {
  throw 'Entry asset field definitions drifted from the explicitly shared UI controls.'
}
Invoke-BindingGuardFixture $entryAssetPage $assetFields $true
Invoke-BindingGuardFixture $entryAssetPage $foreign $false
foreach ($title in @('1. Wirtschaftsgut','2. Wirtschaftsgut','12. Wirtschaftsgut: Muster','1. Musterstuhl','2. Mustertisch')) {
  $entryHeading=Invoke-HeadingFixture $entryAssetPage $title
  if (-not $entryHeading.matches) { throw 'A numbered asset entry was not recognized.' }
}
foreach ($title in @('0. Wirtschaftsgut','Wirtschaftsgut','01. Musterstuhl','2. ','2.Musterstuhl')) {
  if ((Invoke-HeadingFixture $entryAssetPage $title).matches) { throw 'A foreign numbered heading was accepted.' }
}

$typeAssignments=@($ast.FindAll({param($node)
  $node -is [Management.Automation.Language.AssignmentStatementAst] -and
  $node.Left.Extent.Text -ceq '$erwarteterTyp'
},$true))
if ($typeAssignments.Count -ne 1) { throw 'Document-type guard assignment is not unique.' }
$typeStatements=@($typeAssignments[0].Parent.Statements)
$typeIndex=[array]::IndexOf($typeStatements,$typeAssignments[0])
if ($typeStatements[$typeIndex+1] -isnot [Management.Automation.Language.IfStatementAst]) {
  throw 'The actual document-type guard is no longer contiguous.'
}
$typeGuard=[scriptblock]::Create((@($typeStatements[$typeIndex..($typeIndex+1)]|ForEach-Object {$_.Extent.Text})-join "`n"))
function Invoke-DocumentTypeFixture($Page,[string]$CaseSuffix,[bool]$Blocked) {
  $known=[pscustomobject]@{page=$Page}; $pageId='synthetic.asset'
  $fensterRecord=[pscustomobject]@{title=('synthetic.'+$CaseSuffix)}
  function Get-CasePathFromTitle([string]$Title) { $Title }
  function Fail($Message,$Kind) { $failure=[InvalidOperationException]::new($Message); $failure.Data['kind']=$Kind; throw $failure }
  $failure=$null
  try { & $typeGuard } catch { $failure=$_.Exception }
  if ([bool]$failure -ne $Blocked) { throw 'Document-type guard returned the wrong refusal.' }
  if ($Blocked -and $failure.Data['kind'] -cne 'mode-mismatch') { throw 'Wrong document-type failure.' }
}
Invoke-DocumentTypeFixture $entryAssetPage 'GewErfass2026' $false
Invoke-DocumentTypeFixture $entryAssetPage 'Gew2025' $true
Invoke-DocumentTypeFixture $entryAssetPage 'ESt2026' $true
Invoke-DocumentTypeFixture $entryAssetPage 'GewErfass2025' $true
Invoke-DocumentTypeFixture $assetPage 'Gew2025' $false
Invoke-DocumentTypeFixture $assetPage 'GewErfass2026' $true
Write-Output 'Follow-year assets: exact module separation, real document guard, numbered headings and field bindings checked without UI.'
Write-Output 'sse_page_state: Schreibkennungen in der Projektion, Epoch-Hash nur auf Zustand - bestanden'
