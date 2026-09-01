# Die Prozess-Kommandozeilenabfrage darf nur entfallen, wenn ein vollstaendiger
# exakter Fenstertitel die interne Entscheidung bereits beweist. Schwache oder
# oeffentlich zurueckgegebene Evidenz muss unveraendert vollstaendig bleiben.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

foreach ($name in @('Get-CasePathFromCommandLineText', 'Get-CasePathFromCommandLine', 'Test-CaseBinding')) {
  $definition = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true))
  if ($definition.Count -ne 1) { throw "Funktion $name ist nicht eindeutig vorhanden." }
  Invoke-Expression $definition[0].Extent.Text
}

$script:TitlePathStub = $null
$script:CommandLineStub = ''
$script:NativeThrows = $false
$script:NativeCalls = 0
$script:CimThrows = $false
$script:CimCalls = 0

function Get-CasePathFromTitle([string]$Title) { $script:TitlePathStub }
function Test-SSEProfileCaseFileName([string]$Path, [bool]$AllowFullPath) { [bool]$Path }
function Get-SSENativeProcessCommandLine([int]$ProcessId) {
  $script:NativeCalls++
  if ($script:NativeThrows) { throw 'deterministischer Native-Fehler' }
  $script:CommandLineStub
}
function Get-CimInstance([string]$ClassName, [string]$Filter) {
  $script:CimCalls++
  if ($script:CimThrows) { throw 'deterministischer CIM-Fehler' }
  [pscustomobject]@{ ProcessId = 4711; CommandLine = $script:CommandLineStub }
}

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Invoke-Binding(
  [string]$TitlePath,
  [string]$Title,
  [string]$CommandCasePath,
  [bool]$DecisionOnly,
  [bool]$LookupThrows = $false
) {
  $script:TitlePathStub = $TitlePath
  $script:CommandLineStub = $(if ($CommandCasePath) {
    '"C:\Program Files\SSE\SSE.exe" "' + $CommandCasePath + '"'
  } else { '' })
  $script:NativeThrows = $LookupThrows
  $script:NativeCalls = 0
  $script:CimThrows = $LookupThrows
  $script:CimCalls = 0
  $window = [pscustomobject]@{ pid = 4711; title = $Title }
  $result = $(if ($DecisionOnly) {
    Test-CaseBinding $window $script:ExpectedPath -DecisionOnly
  } else {
    Test-CaseBinding $window $script:ExpectedPath
  })
  [pscustomobject]@{
    result = $result
    nativeCalls = $script:NativeCalls
    cimCalls = $script:CimCalls
  }
}

function Assert-SameDecision($Default, $Decision, [string]$Label) {
  foreach ($property in @('ok', 'mode', 'expectedPath', 'titlePath', 'title')) {
    if ($Default.result.$property -ne $Decision.result.$property) {
      throw "$Label aenderte die Bindungsentscheidung im Feld '$property'."
    }
  }
}

function Assert-FullParity($Default, $Decision, [string]$Label) {
  Assert-SameDecision $Default $Decision $Label
  $defaultJson = $Default.result | ConvertTo-Json -Compress
  $decisionJson = $Decision.result | ConvertTo-Json -Compress
  Assert-True ($defaultJson -ceq $decisionJson) "$Label veraenderte das vollstaendige Bindungsobjekt."
}

$script:ExpectedPath = 'C:\Cases\Alpha.ESt2025'
$foreignPath = 'C:\Cases\Beta.ESt2025'
$exactTitle = "SteuerSparErklaerung - $($script:ExpectedPath)"
$truncatedTitlePath = 'C:\...\Alpha.ESt2025'
$truncatedTitle = "SteuerSparErklaerung - $truncatedTitlePath"
$foreignTitle = "SteuerSparErklaerung - $foreignPath"

foreach ($commandPath in @($script:ExpectedPath, $foreignPath)) {
  $default = Invoke-Binding $script:ExpectedPath $exactTitle $commandPath $false
  $decision = Invoke-Binding $script:ExpectedPath $exactTitle $commandPath $true
  Assert-True ($default.nativeCalls -eq 1 -and $default.cimCalls -eq 0) 'Der vollstaendige Standardbeleg muss die Kommandozeile weiterhin abfragen.'
  Assert-True ($default.result.commandPath -ceq $commandPath) 'Der vollstaendige Standardbeleg verlor seinen Kommandozeilenpfad.'
  Assert-True ($decision.nativeCalls -eq 0 -and $decision.cimCalls -eq 0) 'Exakter Decision-only-Titel fragte die Kommandozeile unnoetig ab.'
  Assert-SameDecision $default $decision 'Exakter Titel'
  Assert-True ($decision.result.mode -ceq 'exact-title') 'Exakter Titel verlor seinen Vorrang.'
  Assert-True ($null -eq $decision.result.commandPath) 'Decision-only darf keinen erfundenen Kommandozeilenpfad liefern.'
}

$default = Invoke-Binding $truncatedTitlePath $truncatedTitle $script:ExpectedPath $false
$decision = Invoke-Binding $truncatedTitlePath $truncatedTitle $script:ExpectedPath $true
Assert-True ($default.nativeCalls -eq 1 -and $decision.nativeCalls -eq 1 -and $default.cimCalls -eq 0 -and $decision.cimCalls -eq 0) 'Gekuerzter Titel muss die Kommandozeile in beiden Wegen abfragen.'
Assert-FullParity $default $decision 'Gekuerzter Titel mit passender Kommandozeile'
Assert-True ($decision.result.mode -ceq 'exact-command-line') 'Kommandozeilenbeweis verlor seinen Vorrang vor title-leaf.'

$default = Invoke-Binding $truncatedTitlePath $truncatedTitle $foreignPath $false
$decision = Invoke-Binding $truncatedTitlePath $truncatedTitle $foreignPath $true
Assert-True ($default.nativeCalls -eq 1 -and $decision.nativeCalls -eq 1 -and $default.cimCalls -eq 0 -and $decision.cimCalls -eq 0) 'title-leaf darf die Kommandozeile nicht ueberspringen.'
Assert-FullParity $default $decision 'Title-leaf mit fremder Kommandozeile'
Assert-True ($decision.result.mode -ceq 'title-leaf') 'Title-leaf-Fallback wurde veraendert.'

$default = Invoke-Binding $foreignPath $foreignTitle $script:ExpectedPath $false
$decision = Invoke-Binding $foreignPath $foreignTitle $script:ExpectedPath $true
Assert-FullParity $default $decision 'Fremder Titel mit passender Kommandozeile'
Assert-True ($decision.nativeCalls -eq 1 -and $decision.cimCalls -eq 0 -and $decision.result.mode -ceq 'exact-command-line') 'Command-line-Fallback wurde nicht erhalten.'

$default = Invoke-Binding $foreignPath $foreignTitle $foreignPath $false
$decision = Invoke-Binding $foreignPath $foreignTitle $foreignPath $true
Assert-FullParity $default $decision 'Fremde Titel- und Kommandozeilenevidenz'
Assert-True ($decision.nativeCalls -eq 1 -and $decision.cimCalls -eq 0 -and -not $decision.result.ok -and $decision.result.mode -ceq 'none') 'Fallfremde Evidenz wurde nicht fail-closed abgewiesen.'

$default = Invoke-Binding $foreignPath $foreignTitle '' $false $true
$decision = Invoke-Binding $foreignPath $foreignTitle '' $true $true
Assert-FullParity $default $decision 'Command-line-Abfragefehler'
Assert-True ($decision.nativeCalls -eq 1 -and $decision.cimCalls -eq 1 -and -not $decision.result.ok -and $null -eq $decision.result.commandPath) 'Native- und CIM-Fehler blieben nicht fail-closed.'

# Die drei internen Entscheidungswege duerfen optimieren. save, save_as und
# beide Recovery-Grenzen brauchen dagegen vollstaendige Command-Line-Evidenz.
$calls = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.CommandAst] -and
    $node.GetCommandName() -ceq 'Test-CaseBinding'
}, $true) | ForEach-Object { $_.Extent.Text.Trim() })
Assert-True ($calls.Count -eq 8) "Erwartet waren acht Test-CaseBinding-Aufrufe, gefunden wurden $($calls.Count)."

$expectedDecisionCalls = @(
  'Test-CaseBinding $window $expectedCasePath -DecisionOnly',
  'Test-CaseBinding $main $expectedCasePath -DecisionOnly',
  'Test-CaseBinding $mainAfter[0] $expectedCasePath -DecisionOnly'
)
$expectedEvidenceCalls = @(
  'Test-CaseBinding $targetWindows[0] $expectedCasePath',
  'Test-CaseBinding $recoveryMainAfter[0] $expectedCasePath',
  'Test-CaseBinding $main $expectedPath',
  'Test-CaseBinding $main $sourcePath',
  'Test-CaseBinding $mainAfter $targetPath'
)
foreach ($call in @($expectedDecisionCalls + $expectedEvidenceCalls)) {
  Assert-True ($calls -ccontains $call) "Test-CaseBinding-Aufruf fehlt oder hat die falsche Policy: $call"
}
Assert-True (@($calls | Where-Object { $_ -match '(?i)-DecisionOnly' }).Count -eq 3) 'DecisionOnly muss exakt auf drei interne Bindungsentscheidungen begrenzt bleiben.'

Write-Output 'Steuerfallbindung: exakter Decision-only-Titel ohne Kommandozeilenabfrage; Native-/CIM-Fallbacks sowie Save-/Recovery-Evidenz unveraendert.'
