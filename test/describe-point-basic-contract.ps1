# Der schnelle MSAA-Punktpfad darf nur die Felder abfragen, welche die drei
# internen Sicherheitsproben wirklich auswerten. Der oeffentliche Diagnosepfad
# behaelt dagegen die vollstaendige Projektion inklusive der vier teureren
# COM-Eigenschaften.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$nativePath = Join-Path $root 'powershell\sse-native.cs'
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Get-FunctionText($Ast, [string]$Name) {
  $definitions = @($Ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $Name
  }, $true))
  Assert-True ($definitions.Count -eq 1) "Worker-Funktion $Name ist nicht eindeutig vorhanden."
  $definitions[0].Extent.Text
}

function Get-CallCount([string]$Text, [string]$Method) {
  [regex]::Matches(
    $Text,
    ('\[SSEAccessible\]::' + [regex]::Escape($Method) + '\s*\('),
    [Text.RegularExpressions.RegexOptions]::CultureInvariant
  ).Count
}

$tokens = $null
$parseErrors = $null
$workerAst = [Management.Automation.Language.Parser]::ParseFile(
  $workerPath,
  [ref]$tokens,
  [ref]$parseErrors
)
Assert-True ($parseErrors.Count -eq 0) "Worker-Parserfehler: $($parseErrors[0].Message)"

$clickText = Get-FunctionText $workerAst 'Click-VerifiedPoint'
$dialogText = Get-FunctionText $workerAst 'Get-DialogDescriptor'
$diagnosticText = Get-FunctionText $workerAst 'Get-AccessibilityProbeData'
$workerText = [IO.File]::ReadAllText($workerPath)

Assert-True ((Get-CallCount $clickText 'DescribePointBasic') -eq 1 -and
  (Get-CallCount $clickText 'DescribePoint') -eq 0) `
  'Die verifizierte Klickprobe nutzt nicht exakt einmal den Basic-Punktpfad.'
Assert-True ((Get-CallCount $dialogText 'DescribePointBasic') -eq 2 -and
  (Get-CallCount $dialogText 'DescribePoint') -eq 0) `
  'CSV-Fastprobe und kompakter Dialograster nutzen nicht exakt den Basic-Punktpfad.'
Assert-True ((Get-CallCount $diagnosticText 'DescribePoint') -eq 1 -and
  (Get-CallCount $diagnosticText 'DescribePointBasic') -eq 0) `
  'Der Accessibility-Diagnosepfad behaelt nicht exakt eine volle Punktabfrage.'
Assert-True ((Get-CallCount $workerText 'DescribePointBasic') -eq 3 -and
  (Get-CallCount $workerText 'DescribePoint') -eq 1) `
  'Ausserhalb des geprueften Katalogs existieren weitere oder fehlende MSAA-Punktabfragen.'

# Der Quellvertrag schuetzt nicht nur die Projektion: Basic darf die Extended-
# Getter auch dann nicht aufrufen, wenn deren Ergebnis anschliessend verworfen
# wuerde. Die Reihenfolge des Full-Pfads bleibt dabei identisch zum Altvertrag.
$nativeText = [IO.File]::ReadAllText($nativePath)
$coreMatch = [regex]::Match(
  $nativeText,
  '(?s)static\s+SSEAccNode\s+DescribePointCore\s*\(.*?\)\s*\{(.*?)\n\s*public\s+static\s+SSEAccNode\s+DescribePoint\s*\('
)
Assert-True $coreMatch.Success 'Gemeinsamer privater DescribePoint-Core fehlt.'
$coreText = $coreMatch.Groups[1].Value
Assert-True ([regex]::IsMatch(
  $coreText,
  'if\s*\(hr != 0 \|\| accessible == null\) return null;'
)) 'Full und Basic teilen nicht mehr denselben HRESULT-/null-Rueckgabevertrag.'
Assert-True ($coreText.Contains('object id = childId ?? 0;')) `
  'Full und Basic teilen nicht mehr dieselbe MSAA-childId-Aufloesung.'
Assert-True ($coreText.Contains(
  'string name = "", value = "", description = "", help = "", shortcut = "", action = "";'
)) 'Ausgelassene Extended-Felder des Basic-Pfads bleiben nicht als nicht-null Leerstrings erhalten.'
$extendedGuard = [regex]::Match(
  $coreText,
  '(?s)if\s*\(includeExtended\)\s*\{(.*?)\n\s*\}'
)
Assert-True $extendedGuard.Success 'Extended-MSAA-Getter sind nicht explizit vom Full-Modus begrenzt.'
$extendedText = $extendedGuard.Groups[1].Value
$extendedGetterOrder = @('accDescription', 'accHelp', 'accKeyboardShortcut', 'accDefaultAction')
$previousIndex = -1
foreach ($getter in $extendedGetterOrder) {
  Assert-True ([regex]::Matches($coreText, ('\b' + $getter + '\s*\(')).Count -eq 1) `
    "Extended-Getter $getter kommt im gemeinsamen Core nicht exakt einmal vor."
  $currentIndex = $extendedText.IndexOf($getter, [StringComparison]::Ordinal)
  Assert-True ($currentIndex -gt $previousIndex) "Full-Getter $getter verlor seine bisherige Reihenfolge."
  $previousIndex = $currentIndex
}
Assert-True ([regex]::IsMatch(
  $coreText,
  '(?s)Name = name, Value = value, Description = description, Help = help,\s*' +
  'KeyboardShortcut = shortcut, DefaultAction = action, Role = role, State = state,\s*' +
  'X = left, Y = top, W = width, H = height, Path = new int\[0\]'
)) 'Gemeinsame SSEAccNode-Projektion verlor Felder, Leerstringform oder den nicht-null leeren Pfad.'
Assert-True ([regex]::IsMatch(
  $nativeText,
  '(?s)public\s+static\s+SSEAccNode\s+DescribePoint\s*\(int x, int y\)\s*\{\s*return\s+DescribePointCore\(x, y, true\);\s*\}'
)) 'DescribePoint delegiert nicht unveraendert in den Full-Core.'
Assert-True ([regex]::IsMatch(
  $nativeText,
  '(?s)public\s+static\s+SSEAccNode\s+DescribePointBasic\s*\(int x, int y\)\s*\{\s*return\s+DescribePointCore\(x, y, false\);\s*\}'
)) 'DescribePointBasic delegiert nicht eindeutig in den begrenzten Core.'

. (Join-Path $root 'powershell\load-native.ps1')
$load = Import-SSENativeInterop
Assert-True ($load.mode -in @('precompiled-dll', 'source-fallback', 'already-loaded')) `
  "Nativer Interop-Loader meldete einen unbekannten Modus '$($load.mode)'."

$publicStatic = [Reflection.BindingFlags]::Public -bor [Reflection.BindingFlags]::Static
$fullMethods = @([SSEAccessible].GetMethods($publicStatic) | Where-Object Name -CEQ 'DescribePoint')
$basicMethods = @([SSEAccessible].GetMethods($publicStatic) | Where-Object Name -CEQ 'DescribePointBasic')
Assert-True ($fullMethods.Count -eq 1 -and $basicMethods.Count -eq 1) `
  'Full und Basic muessen eindeutige, nicht ueberladene Methodennamen besitzen.'
foreach ($method in @($fullMethods[0], $basicMethods[0])) {
  $parameters = @($method.GetParameters())
  Assert-True ($method.ReturnType -eq [SSEAccNode] -and $parameters.Count -eq 2 -and
    $parameters[0].ParameterType -eq [int] -and $parameters[1].ParameterType -eq [int]) `
    "Native Punktmethode $($method.Name) verlor Rueckgabetyp oder int/int-Signatur."
}
Write-Output 'OK: DescribePointBasic bleibt call-site-, form- und surface-sicher.'
