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

# Execute only the two actual heading helpers. The worker entry point and its
# UI Automation implementation are never loaded or dispatched by this test.
foreach ($helperName in @('Get-KnownPageHeading', 'Test-KnownPageHeading')) {
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
Write-Output 'sse_page_state: Schreibkennungen in der Projektion, Epoch-Hash nur auf Zustand - bestanden'
