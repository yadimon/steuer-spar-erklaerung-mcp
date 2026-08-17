<#
================================================================================
 sse-worker.ps1 - Arbeitsprozess fuer den SteuerSparErklaerung-MCP-Server
================================================================================
 Wird vom MCP-Server je Aufruf FRISCH gestartet. Das ist Absicht:
 die UIA-Schnittstelle der SteuerSparErklaerung (Qt 6) vergiftet nach einem
 harten Fehler die gesamte Verbindung des Prozesses - danach liefert jede
 weitere Abfrage still "0 Treffer". Ein frischer Prozess je Aufruf ist die
 einzige zuverlaessige Gegenmassnahme.

 Aufruf:  powershell.exe -NoProfile -File sse-worker.ps1 -Op <name> -ArgsFile <temp-json>
 Ausgabe: genau EINE Zeile JSON auf stdout.
================================================================================
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Op,
  [string]$B64 = '',
  [string]$ArgsFile = '',
  # Wird der Arbeiter auf einem eigenen Desktop gestartet, kommt seine
  # Standardausgabe nicht zurueck. Dann schreibt er das Ergebnis hierhin.
  [string]$OutFile = ''
)

$ErrorActionPreference = 'Stop'
$script:T0 = [Diagnostics.Stopwatch]::StartNew()
$script:SSE_PROFILE_ID = $(if ($env:SSE_PROFILE_ID) { [string]$env:SSE_PROFILE_ID } else { '2025' })
$script:SSE_PROFILE_DIR = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\profiles\$($script:SSE_PROFILE_ID)"))
$script:SSE_PROFILE = $null
$script:SSE_TAX_YEAR = 0
$script:SSE_ENGINE_MAJOR = 0
$script:SSE_DEFAULT_EXE = $null
$script:SSE_CASE_FILE_REGEX = $null
$script:SSE_INSTANCE_LABEL = $null
$script:SSE_EXE_IDENTITY_CACHE = @{}
$script:INIT_TIMINGS = [ordered]@{}

# Ohne das hier landen Umlaute als '?' beim Aufrufer: bei umgeleiteter Ausgabe
# benutzt die Konsole sonst die OEM-Codepage statt UTF-8.
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

$transportCommonPath = Join-Path $PSScriptRoot 'worker-transport-common.ps1'
if (-not (Test-Path -LiteralPath $transportCommonPath -PathType Leaf)) {
  [Console]::Out.Write((@{ ok=$false; kind='worker-init'; error='Gemeinsame Worker-Transportgrenze fehlt.' } | ConvertTo-Json -Compress))
  exit 1
}
. $transportCommonPath

if ($B64 -and $ArgsFile) {
  [Console]::Out.Write((@{ ok=$false; kind='bad-args'; error='B64 und ArgsFile duerfen nicht gemeinsam gesetzt sein.' } | ConvertTo-Json -Compress))
  exit 1
}
if ($ArgsFile) {
  try { $ArgsFile = Resolve-SSEWorkerArgsFile $ArgsFile }
  catch {
    [Console]::Out.Write((@{ ok=$false; kind='bad-args'; error=$_.Exception.Message } | ConvertTo-Json -Compress))
    exit 1
  }
}

if ($OutFile) {
  try { $OutFile = Resolve-SSEWorkerOutputFile $OutFile }
  catch {
    [Console]::Out.Write((@{ ok=$false; kind='bad-args'; error=$_.Exception.Message } | ConvertTo-Json -Compress))
    exit 1
  }
}

# ---------------------------------------------------------------- Hilfsmittel
function Read-Args {
  # WICHTIG: PSCustomObject, KEINE Hashtable. Bei einer Hashtable treffen
  # $a.contains / $a.keys / $a.count / $a.values die eingebauten Mitglieder
  # statt der Aufrufparameter - $a.contains ist dann IMMER wahr. Das hat
  # exakte Namenssuche in Teilstringsuche verwandelt.
  if ($ArgsFile) {
    $decoded = Read-SSEJsonFileStrict $ArgsFile 8MB
  } elseif ($B64) {
    $strictUtf8 = New-Object Text.UTF8Encoding($false, $true)
    $json = $strictUtf8.GetString([Convert]::FromBase64String($B64))
    if (-not $json.Trim()) { return [pscustomobject]@{} }
    $trimmedJson = $json.Trim()
    if (-not $trimmedJson.StartsWith('{') -or -not $trimmedJson.EndsWith('}')) {
      throw 'Worker-Argumente muessen ein JSON-Objekt sein.'
    }
    $decoded = $json | ConvertFrom-Json
  } else {
    return [pscustomobject]@{}
  }
  if ($null -eq $decoded -or $decoded -isnot [pscustomobject]) {
    throw 'Worker-Argumente muessen ein JSON-Objekt sein.'
  }
  $decoded
}
# Sicherer Zugriff: fehlende Eigenschaft -> $null (statt Fehler)
function Arg($obj, [string]$name, $default = $null) {
  if ($null -eq $obj) { return $default }
  $p = $obj.PSObject.Properties[$name]
  if ($null -eq $p -or $null -eq $p.Value) { return $default }
  $p.Value
}
function Test-SSEDesktopName([string]$Name) {
  [bool]($Name -and $Name -match '^[A-Za-z0-9_-]{1,64}$')
}
function Get-SSEPageObjects {
  $catalogPath = Join-Path $script:SSE_PROFILE_DIR ([string]$script:SSE_PROFILE.pageObjects)
  if (-not (Test-Path -LiteralPath $catalogPath -PathType Leaf)) {
    Fail "Page-Object-Katalog fehlt: $catalogPath" 'not-found'
  }
  try { Read-SSEJsonFileStrict $catalogPath }
  catch { Fail "Page-Object-Katalog ist ungueltig: $($_.Exception.Message)" 'invalid-catalog' }
}
function Resolve-SSEFocuslessCommitPolicy([string]$Heading, $Node, [string]$ValueKind, [object[]]$SumChecks, $Tree) {
  $catalog = Get-SSEPageObjects
  foreach ($entry in @($catalog.focuslessCommits.PSObject.Properties)) {
    $policy = $entry.Value
    if ([string]$policy.heading -cne $Heading -or
        [string]$policy.controlType -cne [string]$Node.type -or
        [string]$policy.valueKind -cne $ValueKind -or
        -not [string]$Node.aid -or
        -not [string]$policy.automationIdSuffix -or
        -not [string]$Node.aid.EndsWith([string]$policy.automationIdSuffix, [StringComparison]::Ordinal)) {
      continue
    }
    if ([string]$policy.columnHeader) {
      if (-not $Tree) { continue }
      $headers = @($Tree.nodes | Where-Object { $_.type -eq 'Header' -and $_.name -and $_.w -gt 0 } |
        Sort-Object x)
      $nearestHeader = @($headers | Sort-Object { [Math]::Abs([int]$Node.x - [int]$_.x) } | Select-Object -First 1)[0]
      if (-not $nearestHeader -or [string]$nearestHeader.name -cne [string]$policy.columnHeader) { continue }
    }
    $requiredOk = $true
    foreach ($required in @($policy.requiredSumChecks)) {
      $requiredLabel = [string]$required.label
      $requiredOccurrence = [int](Arg $required 'occurrence' 1)
      $matches = @($SumChecks | Where-Object {
        [string](Arg $_ 'label') -ceq $requiredLabel -and
        [int](Arg $_ 'occurrence' 1) -eq $requiredOccurrence -and
        $null -ne (Arg $_ 'before') -and $null -ne (Arg $_ 'after')
      })
      if ($matches.Count -ne 1) { $requiredOk = $false; break }
    }
    if ($requiredOk) {
      return [pscustomobject]@{ id=[string]$entry.Name; definition=$policy }
    }
  }
  $null
}
function Resolve-SSEClosableNonmodalWindowPolicy($Window) {
  if (-not $Window) { return $null }
  $catalog = Get-SSEPageObjects
  foreach ($entry in @($catalog.windows.PSObject.Properties)) {
    $definition = $entry.Value
    $role = [string]$definition.role
    if ($role -notin @('nonmodal-help-window','nonmodal-result-window') -or
        [string]$definition.closePolicy -ne 'allow-exact-nonmodal-close' -or
        -not [string]$definition.title -or [string]$Window.title -cne [string]$definition.title) {
      continue
    }
    return [pscustomobject]@{
      id=[string]$entry.Name; role=$role; title=[string]$definition.title
      closePolicy=[string]$definition.closePolicy
    }
  }
  $null
}
function Resolve-SSEPageObject([string]$PageId, [string]$FieldId = '') {
  $catalog = Get-SSEPageObjects
  $pageProperty = $catalog.pages.PSObject.Properties[$PageId]
  if (-not $pageProperty) { Fail "Unbekannte Page-Object-ID '$PageId'." 'unknown-page-object' }
  $page = $pageProperty.Value
  $field = $null
  if ($FieldId) {
    $fieldProperty = $page.fields.PSObject.Properties[$FieldId]
    if (-not $fieldProperty) { Fail "Unbekannte Feld-ID '$FieldId' auf '$PageId'." 'unknown-page-object' }
    $field = $fieldProperty.Value
  }
  [pscustomobject]@{ catalog=$catalog; page=$page; field=$field; pageId=$PageId; fieldId=$FieldId }
}
function Emit($obj) {
  # Physische Eingabe darf das zuvor aktive Benutzerfenster, den Mauszeiger
  # oder ein dauerhaftes TOPMOST-Bit niemals als Seiteneffekt zuruecklassen.
  # Emit ist der gemeinsame Ausgang fuer Erfolg, Fail und den globalen trap;
  # damit wird auch ein unerwarteter Fehler zwischen Raise und Cleanup sicher
  # aufgeraeumt. Initialisierungsfehler vor Definition der Lease bleiben davon
  # unberuehrt und koennen weiterhin als JSON gemeldet werden.
  if (Get-Command Exit-SSEForegroundLease -CommandType Function -ErrorAction SilentlyContinue) {
    try { Exit-SSEForegroundLease -Force -Reason 'emit' } catch { }
    try {
      $focusTelemetry = Get-SSEForegroundLeaseTelemetry
      if ($focusTelemetry -and [int]$focusTelemetry.acquisitions -gt 0) {
        $obj | Add-Member -NotePropertyName focusTelemetry -NotePropertyValue $focusTelemetry -Force
      }
    } catch { }
  }
  $obj | Add-Member -NotePropertyName ms -NotePropertyValue $script:T0.ElapsedMilliseconds -Force
  # Depth hoch, damit verschachtelte Baeume nicht abgeschnitten werden
  $json = $obj | ConvertTo-Json -Depth 24 -Compress
  if ($OutFile) {
    $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($json)
    $stream = [IO.File]::Open($OutFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
      $stream.Write($bytes, 0, $bytes.Length)
      $stream.Flush($true)
    } finally {
      $stream.Dispose()
    }
  }
  else          { [Console]::Out.Write($json) }
  exit 0
}
function Fail($msg, $kind = 'error', $details = $null) {
  $payload = [ordered]@{ ok = $false; kind = $kind; error = "$msg" }
  if ($null -ne $details) {
    foreach ($property in @($details.PSObject.Properties)) {
      if ($property.Name -notin @('ok','kind','error','ms')) {
        $payload[$property.Name] = $property.Value
      }
    }
  }
  Emit ([pscustomobject]$payload)
}
function Get-SSEBoundedIntegerArg(
  $obj,
  [string]$name,
  [long]$default,
  [long]$minimum,
  [long]$maximum
) {
  $raw = Arg $obj $name $default
  if ($raw -is [string] -or $raw -is [bool] -or $raw -isnot [ValueType]) {
    Fail "$name muss eine ganze Zahl zwischen $minimum und $maximum sein." 'bad-args'
  }
  try { $number = [double]$raw }
  catch { Fail "$name muss eine ganze Zahl zwischen $minimum und $maximum sein." 'bad-args' }
  if ([double]::IsNaN($number) -or [double]::IsInfinity($number) -or
      $number -ne [Math]::Truncate($number) -or $number -lt $minimum -or $number -gt $maximum) {
    Fail "$name muss eine ganze Zahl zwischen $minimum und $maximum sein." 'bad-args'
  }
  [long]$number
}
function Get-SSEBoundedArrayArg(
  $obj,
  [string]$name,
  [int]$minimum,
  [int]$maximum
) {
  $property = $obj.PSObject.Properties[$name]
  if ($null -eq $property -or $null -eq $property.Value) {
    if ($minimum -gt 0) { Fail "$name muss eine Liste mit $minimum bis $maximum Eintraegen sein." 'bad-args' }
    return @()
  }
  if ($property.Value -isnot [Array]) {
    Fail "$name muss eine Liste mit $minimum bis $maximum Eintraegen sein." 'bad-args'
  }
  $items = @($property.Value)
  if ($items.Count -lt $minimum -or $items.Count -gt $maximum) {
    Fail "$name muss eine Liste mit $minimum bis $maximum Eintraegen sein." 'bad-args'
  }
  @($items)
}
function Assert-SSEWorkerArgumentBudget($Value, [int]$Depth, [ref]$Nodes) {
  $Nodes.Value = [int]$Nodes.Value + 1
  if ($Nodes.Value -gt 50000) {
    Fail 'Worker-Argumente duerfen hoechstens 50000 Werte enthalten.' 'bad-args'
  }
  if ($Depth -gt 32) {
    Fail 'Worker-Argumente duerfen hoechstens 32 Ebenen tief sein.' 'bad-args'
  }
  if ($null -eq $Value) { return }
  if ($Value -is [string]) {
    if ([Text.Encoding]::UTF8.GetByteCount([string]$Value) -gt 65536) {
      Fail 'Worker-Zeichenketten duerfen hoechstens 65536 UTF-8-Bytes enthalten.' 'bad-args'
    }
    return
  }
  if ($Value -is [Array]) {
    $entries = @($Value)
    if ($entries.Count -gt 2000) {
      Fail 'Worker-Listen duerfen hoechstens 2000 Eintraege enthalten.' 'bad-args'
    }
    foreach ($entry in $entries) { Assert-SSEWorkerArgumentBudget $entry ($Depth + 1) $Nodes }
    return
  }
  if ($Value -is [pscustomobject]) {
    $properties = @($Value.PSObject.Properties)
    if ($properties.Count -gt 2000) {
      Fail 'Worker-Objekte duerfen hoechstens 2000 Felder enthalten.' 'bad-args'
    }
    foreach ($property in $properties) { Assert-SSEWorkerArgumentBudget $property.Value ($Depth + 1) $Nodes }
  }
}
function Read-SSEJsonFileStrict([string]$Path, [long]$MaxBytes = 16MB) {
  $text = Read-SSEBoundedUtf8File $Path $MaxBytes
  $text | ConvertFrom-Json
}
try { $a = Read-Args }
catch { Fail 'Worker-Argumente sind kein gueltiges Base64-/UTF-8-/JSON-Objekt.' 'bad-args' }
$argumentNodes = 0
Assert-SSEWorkerArgumentBudget $a 0 ([ref]$argumentNodes)

# Auch direkte Worker-Aufrufer duerfen Windows-Identitaeten nicht ueber
# negative, gebrochene oder jenseits von JSON sicher darstellbare Zahlen
# einschleusen. Diese gemeinsame Grenze greift vor Profil-, DLL- und UI-Start.
if ($null -ne (Arg $a 'hwnd')) {
  $a.hwnd = Get-SSEBoundedIntegerArg $a 'hwnd' 0 1 9007199254740991
}
if ($null -ne (Arg $a 'expectedMainHwnd')) {
  $a.expectedMainHwnd = Get-SSEBoundedIntegerArg $a 'expectedMainHwnd' 0 1 9007199254740991
}
if ($null -ne (Arg $a 'pid')) {
  $a.pid = Get-SSEBoundedIntegerArg $a 'pid' 0 1 2147483647
}
foreach ($occurrenceName in @('occurrence','sumOccurrence','seiteOccurrence','labelOccurrence')) {
  if ($null -ne (Arg $a $occurrenceName)) {
    $a.$occurrenceName = Get-SSEBoundedIntegerArg $a $occurrenceName 1 1 1000
  }
}
foreach ($collectionLimit in @(
  [pscustomobject]@{ name='types'; minimum=0; maximum=50 },
  [pscustomobject]@{ name='werte'; minimum=1; maximum=100 },
  [pscustomobject]@{ name='plan'; minimum=1; maximum=500 },
  [pscustomobject]@{ name='erwartungen'; minimum=1; maximum=500 },
  [pscustomobject]@{ name='sumChecks'; minimum=0; maximum=100 },
  [pscustomobject]@{ name='resultLabels'; minimum=0; maximum=500 },
  [pscustomobject]@{ name='cases'; minimum=1; maximum=2000 },
  [pscustomobject]@{ name='expectedRemaining'; minimum=1; maximum=2000 }
)) {
  if ($null -ne $a.PSObject.Properties[$collectionLimit.name]) {
    $a.($collectionLimit.name) = @(Get-SSEBoundedArrayArg $a $collectionLimit.name $collectionLimit.minimum $collectionLimit.maximum)
  }
}

function Test-SSEExactProperties($Value, [string[]]$Expected) {
  if ($null -eq $Value) { return $false }
  $actualNames = @($Value.PSObject.Properties | ForEach-Object { [string]$_.Name } | Sort-Object)
  $expectedNames = @($Expected | Sort-Object)
  [bool](-not @(Compare-Object -ReferenceObject $expectedNames -DifferenceObject $actualNames).Count)
}

function Get-SSECaseFileMatch([string]$PathOrName) {
  if (-not $PathOrName -or -not $script:SSE_CASE_FILE_REGEX) { return $null }
  $script:SSE_CASE_FILE_REGEX.Match([IO.Path]::GetFileName($PathOrName))
}

function Test-SSEProfileCaseFileName([string]$PathOrName, [bool]$IncludeBackups = $true, [string[]]$AllowedTypes = @()) {
  $caseMatch = Get-SSECaseFileMatch $PathOrName
  if (-not $caseMatch -or -not $caseMatch.Success) { return $false }
  if (-not (Test-SSECaseYearAllowed ([string]$caseMatch.Groups['type'].Value) ([int]$caseMatch.Groups['year'].Value))) { return $false }
  if (-not $IncludeBackups -and $caseMatch.Groups['backup'].Success) { return $false }
  if ($AllowedTypes.Count -and [string]$caseMatch.Groups['type'].Value -notin $AllowedTypes) { return $false }
  $true
}

function Get-SSEAllowedCaseYearsForMode([string]$Mode) {
  $years = @($script:SSE_TAX_YEAR)
  $property = $script:SSE_PROFILE.additionalCaseYears.PSObject.Properties[$Mode]
  if ($property) { $years += @($property.Value | ForEach-Object { [int]$_ }) }
  @($years | Sort-Object -Unique)
}

function Test-SSECaseYearAllowed([string]$DocumentType, [int]$Year) {
  foreach ($mode in @($script:SSE_PROFILE.startModes.PSObject.Properties)) {
    if ([string]$mode.Value -ieq $DocumentType -and $Year -in @(Get-SSEAllowedCaseYearsForMode ([string]$mode.Name))) {
      return $true
    }
  }
  $false
}

function Initialize-SSEProductProfile {
  if ($script:SSE_PROFILE_ID -notmatch '^\d{4}$') { Fail 'SSE-Profil-ID muss vierstellig sein.' 'invalid-profile' }
  $manifestPath = Join-Path $script:SSE_PROFILE_DIR 'profile.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    Fail "SSE-Profil fehlt: $manifestPath" 'invalid-profile'
  }
  try { $profileManifest = Read-SSEJsonFileStrict $manifestPath }
  catch { Fail "SSE-Profil ist kein gueltiges JSON: $($_.Exception.Message)" 'invalid-profile' }
  $manifestProperties = @(
    'schemaVersion','id','status','product','taxYear','engineFileMajor',
    'executable','startModes','additionalCaseYears','pageObjects','policy'
  )
  $executableProperties = @('name','installationFolderName','defaultRelativePath')
  $manifestShapeOk = Test-SSEExactProperties $profileManifest $manifestProperties
  $executableShapeOk = Test-SSEExactProperties $profileManifest.executable $executableProperties
  $startModeProperties = @($profileManifest.startModes.PSObject.Properties)
  $startModesOk = [bool]($startModeProperties.Count -and -not @($startModeProperties | Where-Object {
    -not [string]$_.Name -or -not [string]$_.Value
  }).Count)
  $additionalCaseYearsOk = $profileManifest.additionalCaseYears -is [pscustomobject]
  if ($additionalCaseYearsOk) {
    foreach ($additional in @($profileManifest.additionalCaseYears.PSObject.Properties)) {
      $years = @($additional.Value)
      $modeKnown = $null -ne $profileManifest.startModes.PSObject.Properties[[string]$additional.Name]
      $validYears = @($years | Where-Object {
        $_ -isnot [ValueType] -or [int]$_ -ne ([int]$profileManifest.taxYear + 1)
      }).Count -eq 0
      if (-not $modeKnown -or -not $years.Count -or -not $validYears -or
          @($years | Sort-Object -Unique).Count -ne $years.Count) {
        $additionalCaseYearsOk = $false
        break
      }
    }
  }
  if (-not $manifestShapeOk -or -not $executableShapeOk -or
      [int]$profileManifest.schemaVersion -ne 1 -or [string]$profileManifest.id -ne $script:SSE_PROFILE_ID -or
      [string]$profileManifest.status -ne 'supported' -or [int]$profileManifest.taxYear -ne [int]$script:SSE_PROFILE_ID -or
      [int]$profileManifest.engineFileMajor -le 0 -or -not [string]$profileManifest.product -or
      -not [string]$profileManifest.executable.name -or -not [string]$profileManifest.executable.installationFolderName -or
      -not $startModesOk -or -not $additionalCaseYearsOk -or
      -not [string]$profileManifest.pageObjects -or -not [string]$profileManifest.policy) {
    Fail "SSE-Profil '$($script:SSE_PROFILE_ID)' ist unvollstaendig oder nicht produktiv freigegeben." 'invalid-profile'
  }
  $pageObjectsName = [string]$profileManifest.pageObjects
  if ($pageObjectsName -notmatch '^[^\\/:]+\.json$') {
    Fail "Page-Objects des SSE-Profils muessen ein einfacher JSON-Dateiname sein: '$pageObjectsName'." 'invalid-profile'
  }
  $relativeExe = ([string]$profileManifest.executable.defaultRelativePath).Replace('/', '\')
  $relativeExeSegments = @($relativeExe -split '\\')
  if ([IO.Path]::IsPathRooted($relativeExe) -or $relativeExe -match '(^|\\)\.\.?($|\\)' -or
      $relativeExe -match ':' -or $relativeExeSegments.Count -lt 2 -or
      $relativeExeSegments[$relativeExeSegments.Count - 1] -ine [string]$profileManifest.executable.name -or
      $relativeExeSegments[$relativeExeSegments.Count - 2] -ine [string]$profileManifest.executable.installationFolderName) {
    Fail "defaultRelativePath des SSE-Profils ist nicht sicher oder widerspricht EXE/Installationsordner: '$relativeExe'." 'invalid-profile'
  }
  $pageObjectsPath = Join-Path $script:SSE_PROFILE_DIR $pageObjectsName
  if (-not (Test-Path -LiteralPath $pageObjectsPath -PathType Leaf)) {
    Fail "Page-Objects des SSE-Profils fehlen: $pageObjectsPath" 'invalid-profile'
  }
  try { $pageObjects = Read-SSEJsonFileStrict $pageObjectsPath }
  catch { Fail "Page-Objects des SSE-Profils sind ungueltig: $($_.Exception.Message)" 'invalid-profile' }
  if ([int]$pageObjects.schemaVersion -ne 1 -or
      [string]$pageObjects.product -ne [string]$profileManifest.product -or
      [int]$pageObjects.taxYear -ne [int]$profileManifest.taxYear -or
      [int]$pageObjects.engineFileMajor -ne [int]$profileManifest.engineFileMajor -or
      [string]$pageObjects.compatibility.executableName -ine [string]$profileManifest.executable.name -or
      [string]$pageObjects.compatibility.installationFolderName -ine [string]$profileManifest.executable.installationFolderName) {
    Fail 'SSE-Profil und Page-Objects widersprechen sich bei Schema, Produkt oder Kompatibilitaet.' 'invalid-profile'
  }
  $caseTypes = @($startModeProperties | ForEach-Object { [string]$_.Value } | Sort-Object -Unique)
  $caseTypesPattern = @($caseTypes | ForEach-Object { [regex]::Escape($_) }) -join '|'
  $casePattern = "\.(?<type>$caseTypesPattern)(?<year>\d{4})(?<backup>_Backup)?$"
  $regexOptions = [Text.RegularExpressions.RegexOptions]::IgnoreCase -bor [Text.RegularExpressions.RegexOptions]::CultureInvariant
  $script:SSE_CASE_FILE_REGEX = New-Object Text.RegularExpressions.Regex -ArgumentList $casePattern, $regexOptions
  $script:SSE_PROFILE = $profileManifest
  $script:SSE_TAX_YEAR = [int]$profileManifest.taxYear
  $script:SSE_ENGINE_MAJOR = [int]$profileManifest.engineFileMajor
  $script:SSE_INSTANCE_LABEL = "SSE-$($script:SSE_TAX_YEAR)"
  $programFiles = $(if ($env:ProgramFiles) { [string]$env:ProgramFiles } else { 'C:\Program Files' })
  $script:SSE_DEFAULT_EXE = $(
    if ($env:SSE_EXECUTABLE) { [IO.Path]::GetFullPath([string]$env:SSE_EXECUTABLE) }
    else { [IO.Path]::GetFullPath((Join-Path $programFiles $relativeExe)) }
  )
}

Initialize-SSEProductProfile

# Der Prozessname "SSE" ist ueber alle Jahresversionen gleich. Ohne eine
# Produktgrenze koennte der MCP deshalb versehentlich eine parallel geoeffnete
# alte Steuererklaerung bedienen. Verifiziert werden Ordnerjahr, Dateiname und
# Engine-Hauptversion; abweichende oder nicht lesbare Prozesse bleiben sichtbar
# in sse_product_info, werden aber von allen Steuerungsfunktionen ignoriert.
function Get-SSEExecutableIdentity([string]$Path) {
  if (-not $Path) {
    return [pscustomobject]@{ path=$null; exists=$false; supported=$false; reason='Prozesspfad ist nicht lesbar.' }
  }
  try { $fullPath = [IO.Path]::GetFullPath($Path) }
  catch { return [pscustomobject]@{ path=$Path; exists=$false; supported=$false; reason="Ungueltiger Programmpfad: $($_.Exception.Message)" } }
  $cacheKey = $fullPath.ToLowerInvariant()
  if ($script:SSE_EXE_IDENTITY_CACHE.ContainsKey($cacheKey)) { return $script:SSE_EXE_IDENTITY_CACHE[$cacheKey] }

  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    $missing = [pscustomobject]@{ path=$fullPath; exists=$false; supported=$false; reason='Programmdatei existiert nicht.' }
    $script:SSE_EXE_IDENTITY_CACHE[$cacheKey] = $missing
    return $missing
  }
  try {
    $item = Get-Item -LiteralPath $fullPath
    $versionText = [string]$item.VersionInfo.FileVersion
    $major = [int]$item.VersionInfo.FileMajorPart
    $majorSource = 'FileMajorPart'
    if ($major -eq 0) {
      $majorMatch = [regex]::Match($versionText, '^\s*(?<major>\d+)')
      $major = $(if ($majorMatch.Success) { [int]$majorMatch.Groups['major'].Value } else { $null })
      $majorSource = 'FileVersion-fallback'
    }
    $folder = Split-Path $fullPath -Parent
    $folderName = Split-Path $folder -Leaf
    $expectedExecutableName = [string]$script:SSE_PROFILE.executable.name
    $expectedFolderName = [string]$script:SSE_PROFILE.executable.installationFolderName
    $fileNameOk = $item.Name -ieq $expectedExecutableName
    $folderOk = $folderName -ieq $expectedFolderName
    $majorOk = $major -eq $script:SSE_ENGINE_MAJOR
    $supported = [bool]($fileNameOk -and $folderOk -and $majorOk)
    $reason = $(
      if (-not $fileNameOk) { "Dateiname '$($item.Name)' ist nicht $expectedExecutableName." }
      elseif (-not $folderOk) { "Installationsordner '$folderName' ist nicht $expectedFolderName." }
      elseif (-not $majorOk) { "Engine-Hauptversion '$major' ist nicht $($script:SSE_ENGINE_MAJOR)." }
      else { "$($script:SSE_PROFILE.product) verifiziert." }
    )
    $identity = [pscustomobject]@{
      path=$fullPath; exists=$true; supported=$supported; reason=$reason
      taxYear=$script:SSE_TAX_YEAR; expectedFileMajor=$script:SSE_ENGINE_MAJOR
      fileMajor=$major; fileMajorSource=$majorSource; fileVersion=$versionText; productName=[string]$item.VersionInfo.ProductName
      companyName=[string]$item.VersionInfo.CompanyName; folder=$folderName
    }
  } catch {
    $identity = [pscustomobject]@{ path=$fullPath; exists=$true; supported=$false; reason="Dateiidentitaet nicht lesbar: $($_.Exception.Message)" }
  }
  $script:SSE_EXE_IDENTITY_CACHE[$cacheKey] = $identity
  $identity
}
function Assert-SSEExecutable([string]$Path) {
  $identity = Get-SSEExecutableIdentity $Path
  if (-not $identity.supported) {
    Fail "Nur das freigegebene Produktprofil '$($script:SSE_PROFILE.product)' wird unterstuetzt. $($identity.reason) Pfad: $($identity.path)" 'unsupported-version'
  }
  $identity
}
function Get-SSEProcessIdentity($Process) {
  $path = $null
  try { $path = [string]$Process.Path } catch { }
  $exe = Get-SSEExecutableIdentity $path
  [pscustomobject]@{
    pid=[int]$Process.Id; processName=[string]$Process.ProcessName; path=$exe.path
    supported=[bool]$exe.supported; reason=[string]$exe.reason
    fileMajor=$exe.fileMajor; fileMajorSource=$exe.fileMajorSource; fileVersion=$exe.fileVersion
    folder=$exe.folder; productName=$exe.productName
    taxYear=$(if ($exe.supported) { $script:SSE_TAX_YEAR } else { $null })
  }
}
function Get-SSEProcessIdentities {
  @(@(Get-Process -Name 'SSE' -ErrorAction SilentlyContinue) | ForEach-Object { Get-SSEProcessIdentity $_ })
}
function Get-SSEProcesses {
  @(@(Get-Process -Name 'SSE' -ErrorAction SilentlyContinue) | Where-Object { (Get-SSEProcessIdentity $_).supported })
}
function Test-SSEProcess($Process) {
  if (-not $Process -or $Process.ProcessName -ne 'SSE') { return $false }
  [bool](Get-SSEProcessIdentity $Process).supported
}
function Get-SSEStartModeType([string]$Mode) {
  $modeProperty = $script:SSE_PROFILE.startModes.PSObject.Properties[$Mode]
  $expectedType = $(if ($modeProperty) { [string]$modeProperty.Value } else { '' })
  if (-not $expectedType) { Fail "Unbekannter SSE-Startmodus '$Mode'." 'bad-args' }
  $expectedType
}
function Get-SSECaseIdentity([string]$Path, [string]$Mode) {
  if (-not $Path) { return $null }
  try { $fullPath = [IO.Path]::GetFullPath(($Path -replace '/', '\')) }
  catch { Fail "Ungueltiger Falldateipfad: $($_.Exception.Message)" 'bad-args' }
  $match = Get-SSECaseFileMatch $fullPath
  if (-not $match.Success) {
    Fail "Falldatei hat keine vom Profil '$($script:SSE_PROFILE_ID)' unterstuetzte Endung." 'unsupported-case'
  }
  $documentType = $match.Groups['type'].Value
  $year = [int]$match.Groups['year'].Value
  $expectedType = Get-SSEStartModeType $Mode
  if ($documentType -ine $expectedType) {
    Fail "Startmodus '$Mode' erwartet den Falltyp .$expectedType, die Falldatei ist .$documentType$year." 'mode-mismatch'
  }
  $allowedYears = @(Get-SSEAllowedCaseYearsForMode $Mode)
  if ($year -notin $allowedYears) {
    Fail "Falldatei gehoert zum Jahr $year; Startmodus '$Mode' erlaubt im Profil '$($script:SSE_PROFILE_ID)' nur: $($allowedYears -join ', ')." 'unsupported-year'
  }
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { Fail "Falldatei nicht gefunden: $fullPath" 'not-found' }
  [pscustomobject]@{ path=$fullPath; documentType=$documentType; taxYear=$year; mode=$Mode; supported=$true }
}

# Auch Fehler waehrend der Initialisierung muessen im versteckten Desktop als
# JSON ankommen. Ohne diese Falle verschwand z. B. ein Add-Type-/Desktopfehler
# nur als Exit 1; der MCP konnte weder Ursache noch sichere Folgemaßnahme nennen.
trap {
  Emit ([pscustomobject]@{
    ok = $false
    kind = 'worker-init'
    error = $_.Exception.Message
    position = $_.InvocationInfo.PositionMessage
  })
}

$initProbe = [Diagnostics.Stopwatch]::StartNew()
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms

$tableRegionHelpers = Join-Path $PSScriptRoot 'table-region.ps1'
if (-not (Test-Path -LiteralPath $tableRegionHelpers -PathType Leaf)) {
  Fail "Tabellenregion-Helfer fehlt: $tableRegionHelpers" 'not-found'
}
. $tableRegionHelpers

$tableValueHelpers = Join-Path $PSScriptRoot 'table-values.ps1'
if (-not (Test-Path -LiteralPath $tableValueHelpers -PathType Leaf)) {
  Fail "Tabellenwert-Helfer fehlt: $tableValueHelpers" 'not-found'
}
. $tableValueHelpers
$tableComboHelpers = Join-Path $PSScriptRoot 'table-combobox.ps1'
if (-not (Test-Path -LiteralPath $tableComboHelpers -PathType Leaf)) {
  Fail "Tabellen-ComboBox-Helfer fehlt: $tableComboHelpers" 'not-found'
}
. $tableComboHelpers
$windowScopeHelpers = Join-Path $PSScriptRoot 'window-scope.ps1'
if (-not (Test-Path -LiteralPath $windowScopeHelpers -PathType Leaf)) {
  Fail "Fensterbindungs-Helfer fehlt: $windowScopeHelpers" 'not-found'
}
. $windowScopeHelpers
$initProbe.Stop(); $script:INIT_TIMINGS.assembliesMs = $initProbe.ElapsedMilliseconds

# ---------------------------------------------------------- Versteckter Desktop
# Ein Fenster auf einem eigenen Desktop-Objekt kann auf dem sichtbaren
# Desktop NICHT erscheinen - das ist eine harte Grenze des Fenstermanagers,
# keine Hoeflichkeitsregel wie beim Fokus. Damit laesst sich das Programm
# fernsteuern, ohne den Nutzer bei der Arbeit zu unterbrechen.
#
# Bedingung: der ARBEITER muss auf denselben Desktop wechseln, sonst sieht
# er die Fenster nicht. Das geschieht hier, ganz am Anfang.
if (-not ('DSK' -as [type])) {
$nativeLoaderPath = Join-Path $PSScriptRoot 'load-native.ps1'
if (-not (Test-Path -LiteralPath $nativeLoaderPath -PathType Leaf)) {
  Fail "Nativer Interop-Loader fehlt: $nativeLoaderPath" 'worker-init'
}
. $nativeLoaderPath
try { $nativeLoad = Import-SSENativeInterop -ForceSource:($env:SSE_MCP_FORCE_NATIVE_SOURCE -eq '1') }
catch { Fail "Nativer Interop-Start scheiterte: $($_.Exception.Message)" 'worker-init' }
$script:INIT_TIMINGS.nativeInteropMode = $nativeLoad.mode
$script:INIT_TIMINGS.nativeInteropMs = $nativeLoad.ms
$script:INIT_TIMINGS.nativeSourceHash = $nativeLoad.sourceHash
$script:INIT_TIMINGS.nativeExpectedSourceHash = $nativeLoad.expectedSourceHash
$script:INIT_TIMINGS.nativeHashMatch = $nativeLoad.hashMatch
$script:INIT_TIMINGS.nativeDllHash = $nativeLoad.dllHash
$script:INIT_TIMINGS.nativeExpectedDllHash = $nativeLoad.expectedDllHash
$script:INIT_TIMINGS.nativeDllHashMatch = $nativeLoad.dllHashMatch
if ($nativeLoad.dllError) { $script:INIT_TIMINGS.nativeDllError = $nativeLoad.dllError }
}
$script:DESKTOP_MARKE = Join-Path $env:TEMP 'sse-mcp-desktop.txt'
$script:DESKTOP_NAME  = $null
$script:DESKTOP_PID   = 0
if (Test-Path -LiteralPath $script:DESKTOP_MARKE) {
  try {
    $markerFile = Get-Item -LiteralPath $script:DESKTOP_MARKE -Force -ErrorAction Stop
    if ($markerFile.PSIsContainer -or $markerFile.Length -gt 4KB) { throw 'Desktop-Marker ist ungueltig.' }
    $markerUtf8 = New-Object Text.UTF8Encoding($false, $true)
    $markerRaw = ([IO.File]::ReadAllText($markerFile.FullName, $markerUtf8)).Trim()
  } catch { $markerRaw = '' }
  $n = $markerRaw
  if ($markerRaw.StartsWith('{')) {
    try {
      $marker = $markerRaw | ConvertFrom-Json
      $n = [string]$marker.name
      $script:DESKTOP_PID = [int]$marker.pid
    } catch { $n = '' }
  }
  if ($n -and (Test-SSEDesktopName $n)) {
    # Die Marke allein ist massgeblich. SetThreadDesktop kann NICHT als
    # Nachweis dienen: es scheitert mit Fehler 170, sobald der Thread ein
    # Fenster besitzt - und PowerShell hat beim Start eines. Wird der
    # Arbeiter ueber run-on-desktop.ps1 gestartet, ist er ohnehin schon
    # dort geboren; der Aufruf unten ist nur der Fall fuer Direktstarts.
    $script:DESKTOP_NAME = $n
    if ($Op -ne 'desktop_start') {
      $h = [DSK]::OpenDesktop($n, 0, $false, 0x10000000)   # GENERIC_ALL
      if ($h -ne [IntPtr]::Zero) { [DSK]::SetThreadDesktop($h) | Out-Null }
    }
  } else {
    $script:DESKTOP_NAME = $null
    $script:DESKTOP_PID = 0
  }
}

# Qt 6 exposes some application-modal message boxes through MSAA (oleacc), but
# not through UI Automation: AutomationElement.FromHandle then has no children.
# The strongly typed Accessibility assembly cannot be referenced reliably from
# modern pwsh/.NET, so this small late-bound bridge keeps the dependency at the
# Windows COM boundary and returns plain managed records.

$AE  = [System.Windows.Automation.AutomationElement]
$TS  = [System.Windows.Automation.TreeScope]
$WLK = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$RAW = [System.Windows.Automation.TreeWalker]::RawViewWalker

# ------------------------------------------------------------- Sicherheitsnetz
# Alles, was Daten ans Finanzamt schicken koennte. Wird NIE ausgeloest.
# Es gibt absichtlich keinen internen Schalter und keinen direkten Worker-
# Parameter, der diese Grenze lockern kann.
$script:VERSAND = @(
  'ELSTER','Anmeldungen versenden','Jahreserklärungen abschließen',
  'Belege nachreichen','Kommunikation mit dem Finanzamt per ELSTER',
  'Senden','Senden & Drucken','Versenden','Übermitteln','Steuerdaten versenden',
  'Abschicken','Elektronische Steuererklärung (ELSTER)'
)

# Vergleichsform: Auslassungspunkte (auch das Einzelzeichen …), Satzzeichen,
# Zugriffstasten-Kaufmannsund und Umlaute vereinheitlichen. Ohne das rutschen
# realistische Varianten durch - "Jahreserklärungen abschließen…" traf weder
# die Liste noch den Ausdruck.
function ConvertTo-Vergleichsform([string]$s) {
  if (-not $s) { return '' }
  $t = $s -replace '…', '' -replace '\.\.\.', ''
  $t = $t -replace '&', ''                       # Zugriffstasten-Markierung
  $t = $t.ToLowerInvariant()
  $t = $t -replace 'ä','a' -replace 'ö','o' -replace 'ü','u' -replace 'ß','ss'
  $t = $t -replace '[^\p{L}\p{N}]', ''           # alles Nicht-Alphanumerische raus
  $t
}

function Test-Versand([string]$name) {
  if (-not $name) { return $false }
  $n = ConvertTo-Vergleichsform $name
  if (-not $n) { return $false }
  foreach ($v in $script:VERSAND) {
    if ($n -eq (ConvertTo-Vergleichsform $v)) { return $true }
  }
  # Wortstaemme, die auf einen Uebermittlungsweg hindeuten. Bewusst breit:
  # ein falscher Alarm kostet einen Klick, ein Durchrutscher eine Steuererklaerung.
  foreach ($stamm in @('elster','versend','versand','ubermittl','ubermittel','abschick',
                       'nachreich','abschliess','datenubertrag','transfer')) {
    if ($n.Contains($stamm)) { return $true }
  }
  if ($n -match '^senden') { return $true }
  return $false
}

function Test-SSEKnownPassiveTransmissionNotice($Dialog, [string]$ButtonName, [string]$Probe) {
  # Der offizielle VaSt-Ergebnisdialog verwendet "uebermittelt" rein passiv:
  # Er warnt, dass bestimmte Krankenkassenwerte NICHT immer per VaSt kommen.
  # Das ist weder eine Aktion noch ein Versandweg. Die Ausnahme bleibt auf
  # exakten Dialog, reines Schliessen und den exakten offiziellen Satz begrenzt;
  # alle anderen ELSTER-/Versandtexte bleiben durch Test-Versand gesperrt.
  if (-not $Dialog -or $ButtonName -notin @('Schließen','Schliessen')) { return $false }
  if (([string]$Dialog.title).Trim() -ne 'Hinweise zur Datenübernahme der vorausgefüllten Steuererklärung') { return $false }
  $known = 'Beiträge für Wahlleistungen bei der Krankenkasse werden nicht immer per VaSt übermittelt.'
  [bool]((ConvertTo-Vergleichsform $Probe) -eq (ConvertTo-Vergleichsform $known))
}

# ------------------------------------------------------------------- Fenster
function Get-AllowedWindowProcesses([string]$ProcName) {
  if ($ProcName -ieq 'SSE') { return @(Get-SSEProcesses) }
  if ($ProcName -ieq 'SteuertippsCenter') {
    return @(Get-Process -Name 'SteuertippsCenter' -ErrorAction SilentlyContinue)
  }
  Fail "Prozessname '$ProcName' ist nicht freigegeben. Erlaubt sind SSE und SteuertippsCenter." 'blocked'
}
function Get-Windows([string]$ProcName = 'SSE') {
  $procs = @(Get-AllowedWindowProcesses $ProcName)
  if (-not $procs) { return @() }
  $ids = @($procs | ForEach-Object { $_.Id })
  $list = New-Object System.Collections.ArrayList
  $cb = [SW+EP]{
    param($h, $l)
    $ppid = 0
    [SW]::GetWindowThreadProcessId($h, [ref]$ppid) | Out-Null
    if ($ids -contains [int]$ppid -and [SW]::IsWindowVisible($h)) {
      $t = New-Object Text.StringBuilder 512; [SW]::GetWindowTextW($h, $t, 512) | Out-Null
      $c = New-Object Text.StringBuilder 256; [SW]::GetClassNameW($h, $c, 256) | Out-Null
      $r = New-Object SW+RC; [SW]::GetWindowRect($h, [ref]$r) | Out-Null
      $null = $list.Add([pscustomobject]@{
        hwnd = [int64]$h; pid = [int]$ppid
        x = $r.L; y = $r.T; w = $r.R - $r.L; h = $r.B - $r.T
        cls = $c.ToString(); title = $t.ToString(); titleFingerprint = Get-SSETextSha256 ($t.ToString())
        hung = [SW]::IsHungAppWindow($h)
        # Minimierte Fenster meldet Windows bei -32000,-32000 mit Winzgroesse.
        # Ohne diese Kennzeichnung rechnet alles Weitere mit Unsinn:
        # Spaltengrenzen werden negativ, jede Zuordnung ist falsch.
        minimiert = [bool]([SW]::IsIconic($h))
      })
    }
    return $true
  }
  [SW]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
  @($list | Sort-Object { $_.w * $_.h } -Descending)
}

# EnumWindows sieht nur den Desktop des aufrufenden Threads. Der Worker fuer
# desktop_start wurde jedoch bereits auf dem sichtbaren Desktop geboren und
# darf danach nicht mehr verlaesslich per SetThreadDesktop wechseln (Fehler
# 170, sobald PowerShell ein Fenster besitzt). EnumDesktopWindows prueft den
# neu angelegten Desktop direkt und vermeidet dadurch einen falschen
# 90-Sekunden-Timeout bei einem tatsaechlich erfolgreichen SSE-Start.
function Get-WindowsOnDesktop(
  [IntPtr]$Desktop,
  [string]$ProcName = 'SSE',
  [int]$ExactProcessId = 0
) {
  # Directly after CreateProcess the returned PID is already bound to the
  # previously verified executable and the private desktop. Re-discovering it
  # through Get-Process/MainModule can transiently omit that exact process even
  # after its Qt window exists. The exact-PID path is both stricter and faster;
  # general status/ownership calls keep the normal product-filtered discovery.
  if ($ExactProcessId -gt 0) {
    $ids = @($ExactProcessId)
  } else {
    $procs = @(Get-AllowedWindowProcesses $ProcName)
    if (-not $procs) { return @() }
    $ids = @($procs | ForEach-Object { $_.Id })
  }
  $list = New-Object System.Collections.ArrayList
  foreach ($h in @([DSK]::ListDesktopWindows($Desktop))) {
    $ppid = 0
    [SW]::GetWindowThreadProcessId($h, [ref]$ppid) | Out-Null
    if ($ids -contains [int]$ppid -and [SW]::IsWindowVisible($h)) {
      $t = New-Object Text.StringBuilder 512; [SW]::GetWindowTextW($h, $t, 512) | Out-Null
      $c = New-Object Text.StringBuilder 256; [SW]::GetClassNameW($h, $c, 256) | Out-Null
      $r = New-Object SW+RC; [SW]::GetWindowRect($h, [ref]$r) | Out-Null
      $null = $list.Add([pscustomobject]@{
        hwnd = [int64]$h; pid = [int]$ppid
        x = $r.L; y = $r.T; w = $r.R - $r.L; h = $r.B - $r.T
        cls = $c.ToString(); title = $t.ToString(); titleFingerprint = Get-SSETextSha256 ($t.ToString())
        hung = [SW]::IsHungAppWindow($h)
        minimiert = [bool]([SW]::IsIconic($h))
      })
    }
  }
  @($list | Sort-Object { $_.w * $_.h } -Descending)
}

function Get-ExactProcessWindowsOnDesktop([IntPtr]$Desktop, [int]$ExactProcessId) {
  if ($ExactProcessId -le 0) { return @() }
  $list = New-Object System.Collections.ArrayList
  foreach ($h in @([DSK]::ListDesktopWindows($Desktop))) {
    $windowProcessId = 0
    [SW]::GetWindowThreadProcessId($h, [ref]$windowProcessId) | Out-Null
    if ([int]$windowProcessId -eq $ExactProcessId -and [SW]::IsWindowVisible($h)) {
      $t = New-Object Text.StringBuilder 512; [SW]::GetWindowTextW($h, $t, 512) | Out-Null
      $c = New-Object Text.StringBuilder 256; [SW]::GetClassNameW($h, $c, 256) | Out-Null
      $r = New-Object SW+RC; [SW]::GetWindowRect($h, [ref]$r) | Out-Null
      $null = $list.Add([pscustomobject]@{
        hwnd = [int64]$h; pid = [int]$windowProcessId
        x = $r.L; y = $r.T; w = $r.R - $r.L; h = $r.B - $r.T
        cls = $c.ToString(); title = $t.ToString(); titleFingerprint = Get-SSETextSha256 ($t.ToString())
        hung = [SW]::IsHungAppWindow($h); minimiert = [bool]([SW]::IsIconic($h))
      })
    }
  }
  @($list | Sort-Object { $_.w * $_.h } -Descending)
}

function Get-CasePathFromTitle([string]$Title) {
  if (-not $Title) { return $null }
  $pathMatch = [regex]::Match($Title, '(?<path>[A-Za-z]:\\.*)$')
  if ($pathMatch.Success) {
    $candidate = $pathMatch.Groups['path'].Value
    if (Test-SSEProfileCaseFileName $candidate $true) { return $candidate }
  }
  $null
}

function Get-CasePathFromCommandLine([int]$ProcessId) {
  try { $cmd = [string](Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId").CommandLine }
  catch { return $null }
  if (-not $cmd) { return $null }
  $matches = [regex]::Matches($cmd, '"(?<path>[A-Za-z]:\\[^\"]+)"')
  $casePaths = @($matches | ForEach-Object { $_.Groups['path'].Value } | Where-Object {
    Test-SSEProfileCaseFileName $_ $true
  })
  if ($casePaths.Count) { return $casePaths[$casePaths.Count - 1] }
  $null
}

function Test-CaseBinding($Window, [string]$ExpectedPath) {
  $expectedFull = [IO.Path]::GetFullPath($ExpectedPath)
  $titlePath = Get-CasePathFromTitle ([string]$Window.title)
  $commandPath = Get-CasePathFromCommandLine ([int]$Window.pid)
  $exactTitle = $titlePath -and -not $titlePath.Contains('...') -and
    [IO.Path]::GetFullPath($titlePath).Equals($expectedFull, [StringComparison]::OrdinalIgnoreCase)
  $exactCommand = $commandPath -and
    [IO.Path]::GetFullPath($commandPath).Equals($expectedFull, [StringComparison]::OrdinalIgnoreCase)
  $leaf = [IO.Path]::GetFileName($expectedFull)
  $titleLeaf = ([string]$Window.title).Replace('/', '\').EndsWith("\$leaf", [StringComparison]::OrdinalIgnoreCase)
  [pscustomobject]@{
    ok = [bool]($exactTitle -or $exactCommand -or $titleLeaf)
    mode = $(if ($exactTitle) { 'exact-title' } elseif ($exactCommand) { 'exact-command-line' } elseif ($titleLeaf) { 'title-leaf' } else { 'none' })
    expectedPath = $expectedFull; titlePath = $titlePath; commandPath = $commandPath; title = $Window.title
  }
}

function Get-Sha256([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $stream = [IO.File]::OpenRead($Path)
    try { ([BitConverter]::ToString($algorithm.ComputeHash($stream)) -replace '-', '').ToUpperInvariant() }
    finally { $stream.Dispose() }
  } finally {
    $algorithm.Dispose()
  }
}

function Get-NormalizedDirectoryPath([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  $root = [IO.Path]::GetPathRoot($full)
  if ($full.Equals($root, [StringComparison]::OrdinalIgnoreCase)) { return $root }
  $full.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Complete-FailedDesktopStart([IntPtr]$ProcessHandle, [string]$DesktopName, [int]$ProcessId) {
  $errors = New-Object System.Collections.ArrayList
  $WAIT_OBJECT_0 = 0
  $exited = $ProcessHandle -eq [IntPtr]::Zero -or [DSK]::WaitForSingleObject($ProcessHandle, 0) -eq $WAIT_OBJECT_0
  if (-not $exited) {
    if (-not [DSK]::TerminateProcess($ProcessHandle, 1)) {
      $null = $errors.Add("TerminateProcess Fehler $([Runtime.InteropServices.Marshal]::GetLastWin32Error())")
    }
    $exited = [DSK]::WaitForSingleObject($ProcessHandle, 5000) -eq $WAIT_OBJECT_0
  }

  $markerWritten = $false; $markerRemoved = $false
  if ($exited) {
    try { Remove-Item -LiteralPath $script:DESKTOP_MARKE -Force -ErrorAction Stop }
    catch { if (Test-Path -LiteralPath $script:DESKTOP_MARKE) { $null = $errors.Add($_.Exception.Message) } }
    $markerRemoved = -not (Test-Path -LiteralPath $script:DESKTOP_MARKE)
  } else {
    try {
      @{ name = $DesktopName; pid = $ProcessId } | ConvertTo-Json -Compress |
        Set-Content -LiteralPath $script:DESKTOP_MARKE -Encoding UTF8 -ErrorAction Stop
      $recovery = Read-SSEJsonFileStrict $script:DESKTOP_MARKE 4KB
      $markerWritten = [string]$recovery.name -eq $DesktopName -and [int]$recovery.pid -eq $ProcessId
      if (-not $markerWritten) { $null = $errors.Add('Recovery-Marker liess sich nicht identisch zuruecklesen.') }
    } catch { $null = $errors.Add($_.Exception.Message) }
  }
  [pscustomobject]@{
    processExited = $exited; processStillRunning = -not $exited
    markerWritten = $markerWritten; markerRemoved = $markerRemoved
    cleanupErrors = @($errors)
  }
}

function ConvertTo-SendKeysLiteral([string]$Text) {
  $out = New-Object Text.StringBuilder
  foreach ($ch in $Text.ToCharArray()) {
    switch ([string]$ch) {
      '+' { $null = $out.Append('{+}') }
      '^' { $null = $out.Append('{^}') }
      '%' { $null = $out.Append('{%}') }
      '~' { $null = $out.Append('{~}') }
      '(' { $null = $out.Append('{(}') }
      ')' { $null = $out.Append('{)}') }
      '{' { $null = $out.Append('{{}') }
      '}' { $null = $out.Append('{}}') }
      default { $null = $out.Append($ch) }
    }
  }
  $out.ToString()
}

function ConvertTo-MenuLabel([string]$Text) {
  if (-not $Text) { return '' }
  $withoutShortcut = $Text -replace '\s+(?:(?:Strg|Ctrl|Alt|Umschalt|Shift)\+)+(?:F?\d+|[A-Z])$', ''
  ConvertTo-Vergleichsform $withoutShortcut
}

function Get-SSEWindowClassName([IntPtr]$Window) {
  if ($Window -eq [IntPtr]::Zero) { return '' }
  $className = New-Object Text.StringBuilder 256
  [SW]::GetClassNameW($Window, $className, $className.Capacity) | Out-Null
  $className.ToString()
}

function Get-SSEPointObstruction([IntPtr]$BoundWindow, [int]$X, [int]$Y) {
  $point = New-Object SW+PT
  $point.X = $X; $point.Y = $Y
  $hitWindow = [SW]::WindowFromPoint($point)
  $hitRoot = [SW]::GetAncestor($hitWindow, 2) # GA_ROOT
  $boundPid = 0; [SW]::GetWindowThreadProcessId($BoundWindow, [ref]$boundPid) | Out-Null
  $hitPid = 0; [SW]::GetWindowThreadProcessId($hitWindow, [ref]$hitPid) | Out-Null
  $processName = ''
  if ($hitPid -gt 0) {
    try { $processName = [string](Get-Process -Id $hitPid -ErrorAction Stop).ProcessName } catch { }
  }
  $className = Get-SSEWindowClassName $hitRoot
  $isBoundTarget = [bool]($hitPid -eq $boundPid -and [int64]$hitRoot -eq [int64]$BoundWindow)
  $blockerKind = if ($isBoundTarget) {
    'none'
  } elseif ($hitPid -eq $boundPid) {
    'other-sse-window'
  } elseif ($processName -eq 'LockApp' -or $className -match 'LockScreenBackstopFrame') {
    'lockscreen-shell'
  } else {
    'foreign-app'
  }
  $rootRect = New-Object SW+RC
  $hasRootRect = [bool]($hitRoot -ne [IntPtr]::Zero -and [SW]::GetWindowRect($hitRoot, [ref]$rootRect))
  [pscustomobject]@{
    blockerKind=$blockerKind; isBoundTarget=$isBoundTarget
    point=[pscustomobject]@{ x=$X; y=$Y }
    boundWindow=[int64]$BoundWindow; boundPid=[int]$boundPid
    hitWindow=[int64]$hitWindow; hitRoot=[int64]$hitRoot; hitPid=[int]$hitPid
    processName=$processName; className=$className
    rootRect=$(if ($hasRootRect) {
      [pscustomobject]@{ x=$rootRect.L; y=$rootRect.T; w=($rootRect.R-$rootRect.L); h=($rootRect.B-$rootRect.T) }
    } else { $null })
    foregroundHwnd=[int64][SW]::GetForegroundWindow()
  }
}

function Click-VerifiedPoint(
  [IntPtr]$Window,
  $Node,
  $ExpectedInputTick = $null,
  [switch]$RequireForeground
) {
  if (-not $Node -or $Node.w -le 0 -or $Node.h -le 0) { Fail 'Klickziel hat keine sichtbare Flaeche.' 'offscreen' }
  $px = [int]($Node.x + $Node.w / 2); $py = [int]($Node.y + $Node.h / 2)
  $null = Show-SSEWindow $Window
  # Bei einer bereits gehaltenen Lease ist SSE schon oben und im Vordergrund.
  # Ein weiterer 250-ms-Settle pro Zell-/Pfeil-/Popup-Klick waere nur Flackern
  # und macht mehrstufige Tabellenaktionen unnoetig langsam.
  if ($script:SSE_FOREGROUND_LEASE.lastAcquireRaised) { Start-Sleep -Milliseconds 250 }
  $obstruction = Get-SSEPointObstruction $Window $px $py
  if (-not $obstruction.isBoundTarget) {
    Hide-SSETopmost $Window
    Fail ("An Position $px,$py liegt nicht das gebundene SSE-Hauptfenster " +
          "($($obstruction.blockerKind): $($obstruction.processName)/$($obstruction.className), " +
          "hit=$($obstruction.hitWindow), root=$($obstruction.hitRoot), bound=$($obstruction.boundWindow), " +
          "pid=$($obstruction.hitPid)/$($obstruction.boundPid)). NICHT geklickt.") 'obstructed' `
      ([pscustomobject]@{ obstruction=$obstruction })
  }
  if ($Node.source -eq 'msaa-point') {
    $fresh = [SSEAccessible]::DescribePoint($px, $py)
    if (-not $fresh -or [int]$fresh.Role -ne 43 -or [string]$fresh.Name -ne [string]$Node.name) {
      Hide-SSETopmost $Window
      Fail "MSAA-Schaltflaeche '$($Node.name)' ist unmittelbar vor dem Klick nicht mehr identisch. NICHT geklickt." 'stale'
    }
    if ($px -lt $fresh.X -or $py -lt $fresh.Y -or $px -ge ($fresh.X + $fresh.W) -or $py -ge ($fresh.Y + $fresh.H)) {
      Hide-SSETopmost $Window
      Fail "MSAA-Mittelpunkt liegt unmittelbar vor dem Klick nicht mehr im aktuellen Zielrechteck. NICHT geklickt." 'stale'
    }
  }
  if ($null -ne $ExpectedInputTick -and -not (Test-SSELastInputUnchanged $ExpectedInputTick)) {
    Hide-SSETopmost $Window
    Fail 'Fremde Benutzereingabe unmittelbar vor dem verifizierten Klick erkannt. NICHT geklickt.' 'interference'
  }
  if ($RequireForeground -and [SW]::GetForegroundWindow() -ne $Window) {
    Hide-SSETopmost $Window
    Fail 'Gebundenes SSE-Fenster ist unmittelbar vor dem verifizierten Klick nicht im Vordergrund. NICHT geklickt.' 'interference'
  }
  [SW]::SetCursorPos($px, $py) | Out-Null
  Start-Sleep -Milliseconds 100
  [SW]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
  [SW]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
  Set-SSEForegroundLeaseInputCheckpoint (Get-SSELastInputTick) ([pscustomobject]@{ x=$px; y=$py })
  Start-Sleep -Milliseconds 180
  if ([SW]::IsWindow($Window)) { Hide-SSETopmost $Window }
  [pscustomobject]@{ x = $px; y = $py }
}

$akadParserPath = Join-Path $PSScriptRoot 'akad-parser.ps1'
if (Test-Path -LiteralPath $akadParserPath -PathType Leaf) {
  . $akadParserPath
} else {
  function Invoke-AkadParser { throw "Parser fehlt: $akadParserPath" }
}

function Get-CaseSummary([string]$Path) {
  $script:CASE_SUMMARY_ERROR = $null
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  try {
    $parsed = @(Invoke-AkadParser -Paths @($Path))[0]
    $keys = @('FileType','VJahr','Steuernummer','FileSavedBy','ElsterTransferTime','MitElsterVersendetText')
    $header = [ordered]@{}
    foreach ($key in $keys) {
      $entry = $parsed.meta.$key
      $header[$key] = $(if ($entry) { $entry.value } else { $null })
    }
    $transmitted = $(
      if ($parsed.PSObject.Properties['error'] -and $parsed.error) { 'unknown' }
      elseif (-not $parsed.PSObject.Properties['transmitted']) { 'unknown' }
      elseif ($parsed.transmitted -is [bool]) { [bool]$parsed.transmitted }
      elseif ([string]$parsed.transmitted -eq 'unknown') { 'unknown' }
      else { 'unknown' }
    )
    [pscustomobject]@{
      header = [pscustomobject]$header
      transmitted = $transmitted
      transmittedReason = $(if ($parsed.transmittedReason) { $parsed.transmittedReason } else { 'Uebermittlungsstatus nicht sicher lesbar' })
    }
  } catch { $script:CASE_SUMMARY_ERROR = $_.Exception.Message; $null }
}

$script:DIALOG_BUTTONS = @(
  'OK','Ja','Nein','Abbrechen','Schließen','Schliessen','Übernehmen','Uebernehmen',
  'Speichern','Nicht speichern','Verwerfen','Wiederholen','Ignorieren',
  'Als gelesen markieren','Jetzt ignorieren','Wiederherstellen','Datei neu zuordnen',
  'Klicken Sie hier, um Ihre Daten zu exportieren'
)

function ConvertTo-SSEDialogButtonName([string]$Name) {
  foreach ($allowed in $script:DIALOG_BUTTONS) {
    if ($Name -ieq $allowed) { return $allowed }
  }
  $Name
}

function Get-DialogDescriptor($Window, [IntPtr]$MainHwnd) {
  $kind = 'other'
  # Mehrere Fälle können gleichzeitig offen sein. Jeder breite SSE-Fall ist
  # ein Hauptfenster; nur das flächenmäßig größte als main zu markieren ließ
  # das zweite fälschlich durch den MSAA-Dialogpfad laufen. Qts Provider kann
  # bei einer rekursiven MSAA-Abfrage eines kompletten Hauptfensters den
  # Worker-Prozess nativ beenden.
  if (
    [int64]$Window.hwnd -eq [int64]$MainHwnd -or
    (($Window.w -ge 900 -or $Window.minimiert) -and $Window.title -match 'SteuerSparErklärung')
  ) { $kind = 'main' }
  elseif ($Window.cls -match 'Shadow|PopupDropShadow') { $kind = 'shadow' }
  elseif ($Window.cls -eq '#32770') { $kind = 'native-dialog' }
  elseif ($Window.title -eq 'Steuer-Spar-Tipps') { $kind = 'tips' }
  elseif (Resolve-SSEClosableNonmodalWindowPolicy $Window) { $kind = 'known-nonmodal' }

  $tree = $null; $buttons = @(); $texts = @(); $observedButtonNames = @(); $unsupportedButtons = @()
  $uiaReadOk = $false; $uiaError = $null; $msaaReadOk = $false; $msaaError = $null
  $skipUia = $false
  # Der offizielle CSV-Exportdialog exponiert in Qt keinen brauchbaren
  # UIA-Baum; Walk-Tree wartet dort bis zum COM-Timeout. Zwei relative
  # MSAA-Punktproben sind layoutunabhaengig genug und werden nur akzeptiert,
  # wenn Rolle, exakter offizieller Name und aktuelles Rechteck stimmen.
  if ($kind -eq 'other' -and $Window.title -like 'Export für das Finanzamt (*.csv)*' -and
      $Window.cls -match '^Qt' -and $Window.w -gt 400 -and $Window.w -le 850 -and
      $Window.h -gt 250 -and $Window.h -le 650) {
    try {
      $fastItems = New-Object System.Collections.ArrayList
      foreach ($relative in @(
        [pscustomobject]@{ x = 0.30; y = 0.53 },
        [pscustomobject]@{ x = 0.90; y = 0.91 }
      )) {
        $px = [int]($Window.x + $Window.w * $relative.x)
        $py = [int]($Window.y + $Window.h * $relative.y)
        $item = [SSEAccessible]::DescribePoint($px, $py)
        if ($item -and $item.Role -eq 43 -and $item.Name -in $script:DIALOG_BUTTONS -and
            $item.W -gt 0 -and $item.H -gt 0 -and
            $px -ge $item.X -and $py -ge $item.Y -and $px -lt ($item.X + $item.W) -and $py -lt ($item.Y + $item.H)) {
          $null = $fastItems.Add($item)
        }
      }
      $fastNames = @($fastItems | ForEach-Object { ConvertTo-SSEDialogButtonName $_.Name } | Select-Object -Unique)
      $observedButtonNames = @($fastNames)
      if ($fastNames.Count -eq 2 -and
          'Klicken Sie hier, um Ihre Daten zu exportieren' -in $fastNames -and 'Schließen' -in $fastNames) {
        $buttons = @($fastItems | Group-Object Name | ForEach-Object { $_.Group[0] } | ForEach-Object {
          [pscustomobject]@{
            name = ConvertTo-SSEDialogButtonName $_.Name
            enabled = -not [bool]($_.State -band 1); rid = $null
            type = 'MSAA-PushButton'; source = 'msaa-point'; path = $null
            x = $_.X; y = $_.Y; w = $_.W; h = $_.H
          }
        })
        $msaaReadOk = $true; $skipUia = $true; $kind = 'qt-dialog'
      }
    } catch { $msaaError = $_.Exception.Message }
  }
  if ($kind -notin @('main','tips','known-nonmodal','shadow')) {
    if (-not $skipUia) {
      try {
        $tree = Walk-Tree ([IntPtr][int64]$Window.hwnd) 1200 12
        $uiaReadOk = $true
        $observedButtonNames = @($tree.nodes | Where-Object {
          $_.name -and $_.type -in @('Button','Pane')
        } | ForEach-Object { ($_.name -replace '\s+', ' ').Trim() } | Where-Object { $_ } | Select-Object -Unique)
        $buttons = @($tree.nodes | Where-Object {
          $_.name -and $_.type -in @('Button','Pane') -and $_.name -in $script:DIALOG_BUTTONS
        } | ForEach-Object { [pscustomobject]@{
          name = ConvertTo-SSEDialogButtonName $_.name
          enabled = [bool]$_.on; rid = $_.rid; type = $_.type; source = 'uia'; path = $null
        } })
        $texts = @($tree.nodes | Where-Object { $_.type -in @('Text','TreeItem') -and $_.name } |
          ForEach-Object { ($_.name -replace '\s+', ' ').Trim() } | Where-Object { $_ } | Select-Object -Unique)
      } catch { $uiaError = $_.Exception.Message }
    }
    # Qt application-modal message boxes can intentionally expose an empty UIA
    # tree. Eine rekursive MSAA-Baumabfrage darf hier NICHT verwendet werden:
    # Qts Provider beendet dabei gelegentlich den gesamten Worker nativ. Statt
    # dessen werden nur Punkte im kompakten, bereits als SSE-Fenster
    # verifizierten Rechteck abgefragt. Das aktiviert nichts.
    # MSAA nur für kompakte Dialogkandidaten. Niemals auf ein unbekanntes
    # großes Qt-Fenster loslassen: dessen Provider ist nachweislich nicht
    # absturzfest. Der Wiederherstellungsdialog liegt deutlich unter dieser
    # Grenze (in der Praxis etwa 518 x 260).
    if (-not $buttons.Count -and $Window.w -le 850 -and $Window.h -le 650) {
      try {
        $acc = New-Object System.Collections.ArrayList
        $seen = New-Object 'System.Collections.Generic.HashSet[string]'
        $stepX = [Math]::Max(18, [int]($Window.w / 24))
        $stepY = [Math]::Max(18, [int]($Window.h / 18))
        for ($px = $Window.x + 8; $px -lt ($Window.x + $Window.w - 7); $px += $stepX) {
          for ($py = $Window.y + 8; $py -lt ($Window.y + $Window.h - 7); $py += $stepY) {
            $item = [SSEAccessible]::DescribePoint([int]$px, [int]$py)
            if (-not $item) { continue }
            $key = "$($item.Role)|$($item.X)|$($item.Y)|$($item.W)|$($item.H)|$($item.Name)|$($item.Value)"
            if ($seen.Add($key)) { $null = $acc.Add($item) }
          }
        }
        $buttons = @($acc | Where-Object {
          $_.Role -eq 43 -and $_.Name -in $script:DIALOG_BUTTONS -and $_.W -gt 0 -and $_.H -gt 0
        } | ForEach-Object { [pscustomobject]@{
          name = ConvertTo-SSEDialogButtonName $_.Name
          enabled = -not [bool]($_.State -band 1); rid = $null
          type = 'MSAA-PushButton'; source = 'msaa-point'; path = $null
          x = $_.X; y = $_.Y; w = $_.W; h = $_.H
        } })
        $observedButtonNames = @(@($observedButtonNames) + @($acc | Where-Object {
          $_.Role -eq 43 -and $_.Name
        } | ForEach-Object { ($_.Name -replace '\s+', ' ').Trim() }) | Select-Object -Unique)
        $texts = @($acc | Where-Object { $_.Role -eq 41 -and $_.Name } |
          ForEach-Object { ($_.Name -replace '\s+', ' ').Trim() } | Where-Object { $_ } | Select-Object -Unique)
        $msaaReadOk = $true
      } catch { $msaaError = $_.Exception.Message }
    }
    $unsupportedButtons = @($observedButtonNames | Where-Object { $_ -notin $script:DIALOG_BUTTONS } | Select-Object -Unique)
    if ($kind -eq 'other' -and ($buttons.Count -or $unsupportedButtons.Count)) { $kind = 'qt-dialog' }
  }
  $fingerprint = $null
  if ($kind -in @('native-dialog','qt-dialog')) {
    $body = @(
      ([string]$Window.title -replace '\s+', ' ').Trim()
      ((@($buttons | ForEach-Object { $_.name }) | Sort-Object) -join '|')
      ((@($unsupportedButtons) | Sort-Object) -join '|')
      ((@($texts) | Sort-Object) -join '|')
    ) -join "`0"
    $bytes = [Text.Encoding]::UTF8.GetBytes($body)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $fingerprint = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '') }
    finally { $sha.Dispose() }
  }
  [pscustomobject]@{
    hwnd = [int64]$Window.hwnd; pid = [int]$Window.pid; cls = $Window.cls; title = $Window.title
    titleFingerprint = $Window.titleFingerprint; kind = $kind
    x = $Window.x; y = $Window.y; w = $Window.w; h = $Window.h; minimiert = [bool]$Window.minimiert
    buttons = $buttons; unsupportedButtons = $unsupportedButtons; texts = $texts; fingerprint = $fingerprint; tree = $tree
    uiaReadOk = $uiaReadOk; uiaError = $uiaError; msaaReadOk = $msaaReadOk; msaaError = $msaaError
  }
}

function Get-DialogInventory([int]$TargetPid = 0) {
  $windows = @(Get-Windows 'SSE')
  if ($TargetPid) { $windows = @($windows | Where-Object { [int]$_.pid -eq $TargetPid }) }
  if (-not $windows.Count) { return @() }
  # Der gemeinsame Hauptfensterresolver erkennt auch minimierte Fallfenster,
  # deren Ersatzgeometrie bei -32000 sonst wie ein kompakter Qt-Dialog wirkt.
  # Der 518x260-Startdialog "Steuerprogramm" bleibt dagegen bewusst draussen.
  $main = @(Get-SSEMainWindowCandidates $windows | Select-Object -First 1)
  $mainHwnd = $(if ($main.Count) { [IntPtr][int64]$main[0].hwnd } else { [IntPtr]::Zero })
  @($windows | ForEach-Object { Get-DialogDescriptor $_ $mainHwnd })
}

function Get-SSEDeepestLastActivePopup([IntPtr]$Hwnd) {
  if ($Hwnd -eq [IntPtr]::Zero -or -not [SW]::IsWindow($Hwnd)) { return [IntPtr]::Zero }
  $current = $Hwnd
  $seen = @{}
  for ($i = 0; $i -lt 8; $i++) {
    $key = [int64]$current
    if ($seen.ContainsKey($key)) { break }
    $seen[$key] = $true
    $next = [SW]::GetLastActivePopup($current)
    if ($next -eq [IntPtr]::Zero -or $next -eq $current -or -not [SW]::IsWindow($next)) { break }
    $current = $next
  }
  $current
}

function Get-SSEMainWindowCandidates($Windows) {
  $wins = @($Windows | Where-Object { $null -ne $_ })
  # Geladene Faelle tragen immer den Produktnamen im Titel. SSE laesst beim
  # Start aber kurz parallel ein breites generisches Fenster "Steuerprogramm"
  # stehen. Sobald ein konkreter Fall existiert, ist dieses kein zweiter Fall.
  # Mehrere konkret betitelte Fallfenster bleiben dagegen strikt mehrdeutig.
  $loadedCases = @($wins | Where-Object { $_.title -match 'SteuerSparErklärung' })
  if ($loadedCases.Count) {
    return @($loadedCases | Sort-Object { $_.w * $_.h } -Descending)
  }
  # Vor dem geladenen Fall darf nur das breite Start-Hauptfenster als Kandidat
  # gelten; der gleichnamige Recovery-Dialog bleibt mit rund 518 px draussen.
  @($wins | Where-Object {
    $_.title -eq 'Steuerprogramm' -and ($_.w -ge 900 -or $_.minimiert)
  } | Sort-Object { $_.w * $_.h } -Descending)
}

# Strenge Hauptfensterbindung fuer fallbezogene Leseoperationen. Ein breites
# Qt-Hilfsfenster ist kein Hauptfenster; mehrere Faelle duerfen ohne explizites
# HWND niemals vermischt werden. Ein minimiertes, eindeutig gebundenes Fenster
# wird wie im etablierten Resolve-Window-Pfad wiederhergestellt.
function Resolve-SSEMainWindowDescriptor($a, $Windows = $null, [switch]$RestoreMinimized) {
  # In PowerShell hat @($null) überraschend Count=1. Ohne das explizite
  # Herausfiltern würde ein Aufruf ohne vorab gelesene Fensterliste den
  # Get-Windows-Fallback überspringen und fälschlich "kein Hauptfenster"
  # melden. Mehrinstanz- und Schreibpfade rufen den Resolver meist genau so auf.
  $wins = @($Windows | Where-Object { $null -ne $_ })
  if (-not $wins.Count) { $wins = @(Get-Windows 'SSE') }
  $candidates = @(Get-SSEMainWindowCandidates $wins)
  if (-not $candidates.Count) { Fail "Kein $($script:SSE_INSTANCE_LABEL)-Hauptfenster gefunden." 'no-window' }

  $requestedHwnd = Arg $a 'hwnd'
  if ($requestedHwnd) {
    $matches = @($candidates | Where-Object { [int64]$_.hwnd -eq [int64]$requestedHwnd })
    if ($matches.Count -ne 1) {
      Fail "Das angegebene hwnd ist kein aktuelles $($script:SSE_INSTANCE_LABEL)-Hauptfenster." 'stale-window'
    }
    $main = $matches[0]
  } else {
    if ($candidates.Count -ne 1) {
      $identities = @($candidates | ForEach-Object { "PID $($_.pid)/HWND $($_.hwnd)" }) -join ', '
      Fail "Mehrere $($script:SSE_INSTANCE_LABEL)-Hauptfenster sind sichtbar ($identities); hwnd ist zur eindeutigen Fallbindung Pflicht." 'ambiguous'
    }
    $main = $candidates[0]
  }

  if ($main.minimiert -and $RestoreMinimized) {
    [SW]::ShowWindow([IntPtr][int64]$main.hwnd, 9) | Out-Null # SW_RESTORE
    Start-Sleep -Milliseconds 700
    $fresh = @(Get-Windows 'SSE' | Where-Object {
      [int64]$_.hwnd -eq [int64]$main.hwnd -and [int]$_.pid -eq [int]$main.pid
    })
    if ($fresh.Count -ne 1 -or $fresh[0].minimiert) {
      Fail 'Das gebundene SSE-Hauptfenster ist minimiert und liess sich nicht wiederherstellen.' 'minimized'
    }
    $main = $fresh[0]
  }
  $main
}

# Vollstaendiger, kanonisch sortierter Zustand aller Peer-Fenster einer
# expliziten Restore-Transaktion. Das Ziel selbst bleibt draussen, weil genau
# dessen Minimiert-/Geometriezustand sich aendern soll; jede Aenderung an einem
# anderen sichtbaren SSE-Fenster wird dagegen im SHA256-Readback sichtbar.
function Get-SSEPeerWindowSet($Windows, [int]$ProcessId, [IntPtr]$TargetHwnd) {
  $peers = @($Windows | Where-Object {
    [int]$_.pid -eq $ProcessId -and [int64]$_.hwnd -ne [int64]$TargetHwnd
  } | Sort-Object hwnd | ForEach-Object {
    [pscustomobject][ordered]@{
      hwnd=[int64]$_.hwnd; pid=[int]$_.pid; cls=[string]$_.cls
      titleFingerprint=([string]$_.titleFingerprint).ToUpperInvariant()
      minimiert=[bool]$_.minimiert; hung=[bool]$_.hung
      x=[int]$_.x; y=[int]$_.y; w=[int]$_.w; h=[int]$_.h
    }
  })
  [pscustomobject]@{
    fingerprint=Get-SSETextSha256 ($peers | ConvertTo-Json -Depth 4 -Compress)
    windows=$peers
  }
}

function Test-SSESystemOverlayDescriptor($Descriptor) {
  [bool]($Descriptor -and $Descriptor.cls -match '^UAC[ _]' -and
    $Descriptor.w -le 80 -and $Descriptor.h -le 80)
}

function Test-SSESafeAuxiliaryDescriptor($Descriptor) {
  if (-not $Descriptor) { return $false }
  if ($Descriptor.kind -eq 'tips' -and $Descriptor.w -le 850 -and $Descriptor.h -le 650) { return $true }
  if ($Descriptor.title -like 'Die Prüfung hat ergeben*' -and $Descriptor.w -le 850 -and $Descriptor.h -le 650) { return $true }
  if ($Descriptor.title -like 'Werte-Info:*' -and $Descriptor.w -le 900 -and $Descriptor.h -le 700) { return $true }
  $false
}

function Test-SSEDismissibleAuxiliaryDescriptor($Descriptor) {
  if (-not $Descriptor) { return $false }
  if ($Descriptor.kind -eq 'shadow') { return $true }
  if ($Descriptor.kind -eq 'tips' -and $Descriptor.w -le 850 -and $Descriptor.h -le 650) { return $true }
  if ($Descriptor.title -like 'Werte-Info:*' -and $Descriptor.w -le 900 -and $Descriptor.h -le 700) { return $true }
  # Automatische Pruefhinweise sind absichtlich NICHT enthalten: deren
  # Antwort aendert Gelesen-/Ignoriert-Status und muss fingerprintgebunden sein.
  $false
}

function Invoke-DialogButtonInfo($Dialog, $ButtonInfo) {
  if (-not $Dialog -or -not $ButtonInfo) { throw 'Dialog oder Schaltflaeche fehlt.' }
  if (-not $ButtonInfo.enabled) { throw "Dialogschaltflaeche '$($ButtonInfo.name)' ist deaktiviert." }
  if ($ButtonInfo.source -eq 'msaa-point') {
    $null = Click-VerifiedPoint ([IntPtr][int64]$Dialog.hwnd) $ButtonInfo
    return 'msaa-verified-point'
  }
  $node = @($Dialog.tree.nodes | Where-Object { $_.rid -eq $ButtonInfo.rid })[0]
  if (-not $node) { throw 'Dialogschaltflaeche ist nicht mehr greifbar.' }
  $element = Get-LiveElement ([IntPtr][int64]$Dialog.hwnd) $node.rid
  $invoke = $null
  if ($element -and $element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
    $invoke.Invoke()
    return 'invoke'
  }
  $null = Click-VerifiedPoint ([IntPtr][int64]$Dialog.hwnd) $node
  'verified-point'
}

# Zielfenster bestimmen.
#
# Vorgabe ist das GROESSTE Fenster (das Hauptfenster). Frueher wurde das
# kleinste bevorzugt, in der Annahme, ein kleines Fenster sei ein modaler
# Dialog. Das ist falsch: die SteuerSparErklaerung zeigt ein nicht-modales
# Vorschlagsfenster "Steuer-Spar-Tipps" (~480x330), sobald eine Tabellenzelle
# den Fokus bekommt. Wer darauf zielt, liest eine leere Seite.
#
# Wenn beim Start noch kein Hauptfenster existiert (Groesse 0x0), ist der
# Rueckfragedialog ohnehin das groesste - der Fall loest sich von selbst.
# Fuer echte Dialoge: dialog=true setzen.
function Resolve-Window($a) {
  $h = Arg $a 'hwnd'
  # PowerShell rollt eine Sammlung mit genau einem Element beim Rueckgabepipe
  # zum Einzelobjekt aus. Dessen fehlendes .Count wurde hier als 0 interpretiert
  # und fuehrte ausgerechnet beim normalen Ein-Fenster-Fall zu no-window.
  $wins = @(Get-Windows 'SSE')
  if ($h) {
    $exact = @($wins | Where-Object { [int64]$_.hwnd -eq [int64]$h })
    if ($exact.Count -ne 1) { Fail 'Das angegebene hwnd gehoert nicht mehr zum erwarteten Prozess.' 'stale-window' }
    return [IntPtr][int64]$exact[0].hwnd
  }
  $wantedPid = Arg $a 'pid'
  if ($wantedPid) { $wins = @($wins | Where-Object { [int]$_.pid -eq [int]$wantedPid }) }
  if (-not $wins.Count) {
    $ignored = @(Get-SSEProcessIdentities | Where-Object { -not $_.supported })
    $ignoredNote = $(if ($ignored.Count) {
      ' Laufende, aber nicht steuerbare SSE-Prozesse: ' + (($ignored | ForEach-Object { "PID $($_.pid): $($_.reason)" }) -join '; ')
    } else { '' })
    Fail "Kein sichtbares Fenster des verifizierten Produktprofils '$($script:SSE_PROFILE.product)' gefunden.$ignoredNote" 'no-window'
  }
  # Minimiertes Hauptfenster: wiederherstellen, sonst sind alle Koordinaten
  # unbrauchbar (-32000). Das ist ungefaehrlich und veraendert keine Daten.
  $gross = @($wins | Where-Object { -not $_.minimiert })
  if (-not $gross.Count) {
    [SW]::ShowWindow([IntPtr][int64]$wins[0].hwnd, 9) | Out-Null   # SW_RESTORE
    Start-Sleep -Milliseconds 700
    $wins = @(Get-Windows 'SSE')
    if ($wantedPid) { $wins = @($wins | Where-Object { [int]$_.pid -eq [int]$wantedPid }) }
    if (@($wins | Where-Object { -not $_.minimiert }).Count -eq 0) {
      Fail 'Das Fenster ist minimiert und liess sich nicht wiederherstellen. Bitte von Hand oeffnen.' 'minimized'
    }
  }
  $wins = @($wins | Where-Object { -not $_.minimiert })
  if ((Arg $a 'dialog') -eq $true) {
    $klein = @($wins | Sort-Object { $_.w * $_.h })[0]
    return [IntPtr][int64]$klein.hwnd
  }
  # Auch Legacy-Lese-/Scrollpfade duerfen bei mehreren Steuerfaellen nicht
  # still das groesste Fenster waehlen. Seite und Werte koennen bei einer
  # bytegleichen Arbeitskopie identisch sein; nur das Hauptfenster trennt die
  # Faelle. Explizite Dialog- und HWND-Aufrufe bleiben oben erhalten.
  $mainCandidates = @(Get-SSEMainWindowCandidates $wins)
  if ($mainCandidates.Count -gt 1) {
    $identities = @($mainCandidates | ForEach-Object { "PID $($_.pid)/HWND $($_.hwnd)" }) -join ', '
    Fail "Mehrere $($script:SSE_INSTANCE_LABEL)-Hauptfenster sind sichtbar ($identities); hwnd ist auch fuer konsistente Lese-/UI-Aktionen Pflicht." 'ambiguous'
  }
  if ($mainCandidates.Count -eq 1) { return [IntPtr][int64]$mainCandidates[0].hwnd }
  return [IntPtr][int64]$wins[0].hwnd      # Get-Windows sortiert nach Flaeche
}

# Das Steuertipps-Center ist ein eigener, eng freigegebener Prozess. Steuer-
# werkzeuge duerfen nie versehentlich darauf zielen; nur der dedizierte
# read-only Falllistenpfad verwendet diesen Resolver.
function Resolve-SteuertippsCenterWindow($a) {
  $wins = @(Get-Windows 'SteuertippsCenter')
  $h = Arg $a 'hwnd'
  if ($h) {
    $wins = @($wins | Where-Object { [int64]$_.hwnd -eq [int64]$h })
    if ($wins.Count -ne 1) { Fail 'Das angegebene hwnd gehoert nicht mehr zum Steuertipps-Center.' 'stale-window' }
  } elseif ($wins.Count -ne 1) {
    Fail "Steuertipps-Center ist nicht eindeutig ($($wins.Count) Fenster). hwnd ist Pflicht." 'ambiguous-window'
  }
  if ($wins[0].minimiert) {
    [SW]::ShowWindow([IntPtr][int64]$wins[0].hwnd, 9) | Out-Null
    Start-Sleep -Milliseconds 500
    $wins = @(Get-Windows 'SteuertippsCenter' | Where-Object {
      [int64]$_.hwnd -eq [int64]$(if ($h) { $h } else { $wins[0].hwnd })
    })
    if ($wins.Count -ne 1 -or $wins[0].minimiert) {
      Fail 'Das Steuertipps-Center ist minimiert und liess sich nicht wiederherstellen.' 'minimized'
    }
  }
  [IntPtr][int64]$wins[0].hwnd
}

function Resolve-BoundWriteWindow($a) {
  $windows = @(Get-Windows 'SSE' | Where-Object { $_.w -ge 900 -or $_.minimiert })
  if (-not $windows.Count) { Fail 'Kein SSE-Hauptfenster fuer eine Schreibaktion gefunden.' 'no-window' }
  $wantedHwnd = Arg $a 'hwnd'
  $wantedPid = Arg $a 'pid'
  $expectedCasePath = [string](Arg $a 'expectedCasePath')
  $expectedCaseHash = [string](Arg $a 'expectedCaseHash')
  if ($wantedHwnd) { $windows = @($windows | Where-Object { [int64]$_.hwnd -eq [int64]$wantedHwnd }) }
  if ($wantedPid) { $windows = @($windows | Where-Object { [int]$_.pid -eq [int]$wantedPid }) }
  $binding = $null
  if ($expectedCasePath) {
    $bound = New-Object System.Collections.ArrayList
    foreach ($window in $windows) {
      $candidate = Test-CaseBinding $window $expectedCasePath
      if ($candidate.ok) { $null = $bound.Add([pscustomobject]@{ window=$window; binding=$candidate }) }
    }
    if ($bound.Count -eq 1) { $windows = @($bound[0].window); $binding = $bound[0].binding }
    elseif ($bound.Count -eq 0) { Fail 'Kein SSE-Hauptfenster ist an den erwarteten Steuerfall gebunden.' 'case-mismatch' }
    else { Fail 'Mehrere SSE-Hauptfenster passen zum erwarteten Steuerfall.' 'ambiguous-instance' }
    if ($expectedCaseHash) {
      $actualHash = Get-Sha256 $expectedCasePath
      if (-not $actualHash -or $actualHash -ne $expectedCaseHash) {
        Fail 'Steuerfall-Hash stimmt vor der Schreibaktion nicht mehr.' 'case-mismatch'
      }
    }
  } elseif ($expectedCaseHash) {
    Fail 'expectedCaseHash ist nur zusammen mit expectedCasePath erlaubt.' 'bad-args'
  }
  if (-not $windows.Count) { Fail 'Das gebundene SSE-Hauptfenster existiert nicht mehr.' 'stale-window' }
  if ($windows.Count -ne 1) {
    Fail 'Mehrere SSE-Instanzen sind offen. Fuer Schreibaktionen pid, hwnd oder expectedCasePath angeben.' 'ambiguous-instance'
  }
  [pscustomobject]@{
    window=$windows[0]
    bindingMode=$(if ($binding) { $binding.mode } elseif ($wantedPid -or $wantedHwnd) { 'explicit-window' } else { 'single-instance' })
  }
}

# Nicht-modale Helfer, die man wegklicken darf, ohne dass Daten leiden.
$script:HELFERFENSTER = @('Steuer-Spar-Tipps')

# Eine sichtbare physische Eingabe erhaelt genau eine verschachtelbare Lease.
# Der erste Aufrufer merkt sich Benutzerfenster und Mausposition. Weitere
# Klicks auf dasselbe bereits aktive HWND ueberspringen das erneute Raise.
# Der gemeinsame Emit-Pfad erzwingt die Freigabe auch nach Fail/Exception.
$script:SSE_FOREGROUND_LEASE = [ordered]@{
  depth=0; rootHwnd=[int64]0; targetPid=0
  previousForeground=[int64]0; previousCursor=$null
  raisedWindows=(New-Object System.Collections.ArrayList)
  acquisitions=0; raises=0; topmostCycles=0; releases=0
  lastAcquireRaised=$false; lastOwnedInputTick=$null; ownedCursorPoint=$null
  foregroundHeldMs=0; foregroundRestored=$false; cursorRestored=$false
  releasedByEmit=$false; restoreSkippedReason=$null; cleanupError=$null
  watch=$null
}

function Test-SSEWindowIsLockScreen([IntPtr]$Hwnd) {
  if ($Hwnd -eq [IntPtr]::Zero -or -not [SW]::IsWindow($Hwnd)) { return $false }
  $root = [SW]::GetAncestor($Hwnd, 2) # GA_ROOT
  if ($root -eq [IntPtr]::Zero) { $root = $Hwnd }
  $windowPid = 0; [SW]::GetWindowThreadProcessId($root, [ref]$windowPid) | Out-Null
  $processName = ''
  if ($windowPid -gt 0) {
    try { $processName = [string](Get-Process -Id $windowPid -ErrorAction Stop).ProcessName } catch { }
  }
  $className = Get-SSEWindowClassName $root
  [bool]($processName -eq 'LockApp' -or $className -match 'LockScreenBackstopFrame')
}

# Fenster wirklich nach vorn holen. Topmost wird nur fuer SSE-Ziele gesetzt;
# beim best-effort Restore des Benutzerfensters bleibt es bewusst aus.
#
# SetForegroundWindow allein scheitert aus einem Hintergrundprozess: Windows
# laesst nur den aktuellen Vordergrundprozess den Fokus vergeben. Der
# uebliche Ausweg ist, sich kurz an dessen Eingabewarteschlange zu haengen -
# dann gilt man als berechtigt. Danach wieder loesen.
function Wait-SSEExactForeground([IntPtr]$Hwnd, [int]$TimeoutMs) {
  $wait = [Diagnostics.Stopwatch]::StartNew()
  do {
    if ([SW]::GetForegroundWindow() -eq $Hwnd) { return $true }
    $remaining = $TimeoutMs - [int]$wait.ElapsedMilliseconds
    if ($remaining -le 0) { break }
    Start-Sleep -Milliseconds ([Math]::Min(15, $remaining))
  } while ($wait.ElapsedMilliseconds -lt $TimeoutMs)
  [bool]([SW]::GetForegroundWindow() -eq $Hwnd)
}

function Set-SSEForegroundWindowCore([IntPtr]$hwnd, [switch]$Topmost) {
  $HWND_TOPMOST = [IntPtr](-1)
  # Diese Funktion soll das bereits verifizierte Ziel-HWND bewusst aktivieren.
  # SWP_NOACTIVATE waere hier widerspruechlich und liess ein davorliegendes
  # Topmost-Fenster trotz erfolgreichem SetWindowPos aktiv.
  $SWP = 0x0001 -bor 0x0002 # NOSIZE | NOMOVE
  if ([SW]::IsIconic($hwnd)) { [SW]::ShowWindow($hwnd, 9) | Out-Null; Start-Sleep -Milliseconds 500 }
  if ($Topmost) { [SW]::SetWindowPos($hwnd, $HWND_TOPMOST, 0, 0, 0, 0, $SWP) | Out-Null }
  [SW]::BringWindowToTop($hwnd) | Out-Null
  $null = [SW]::SetForegroundWindow($hwnd)
  # SetForegroundWindow kann Erfolg melden, obwohl Windows oder der Benutzer
  # den Vordergrund im selben Moment wieder aendert. Nur das tatsaechliche
  # exakte HWND gilt als Erfolg; andernfalls trotzdem den AttachThreadInput-
  # Fallback versuchen statt den irrefuehrenden API-Rueckgabewert zu glauben.
  if (Wait-SSEExactForeground $hwnd 150) { return $true }

  $vorne = [SW]::GetForegroundWindow()
  $fremd = 0; [SW]::GetWindowThreadProcessId($vorne, [ref]$fremd) | Out-Null
  $tidFremd = [SW]::GetWindowThreadProcessId($vorne, [ref]$fremd)
  $zielPid = 0
  $tidZiel = [SW]::GetWindowThreadProcessId($hwnd, [ref]$zielPid)
  $tidSelbst = [SW]::GetCurrentThreadId()
  $attachedForeground = $false; $attachedTarget = $false; $attachedQueues = $false
  try {
    if ($tidFremd -ne 0 -and $tidFremd -ne $tidSelbst) {
      $attachedForeground = [SW]::AttachThreadInput($tidSelbst, $tidFremd, $true)
    }
    if ($tidZiel -ne 0 -and $tidZiel -ne $tidSelbst) {
      $attachedTarget = [SW]::AttachThreadInput($tidSelbst, $tidZiel, $true)
    }
    if ($tidFremd -ne 0 -and $tidZiel -ne 0 -and $tidFremd -ne $tidZiel) {
      $attachedQueues = [SW]::AttachThreadInput($tidFremd, $tidZiel, $true)
    }
    [SW]::BringWindowToTop($hwnd) | Out-Null
    $null = [SW]::SetForegroundWindow($hwnd)
  } finally {
    if ($attachedQueues) { [SW]::AttachThreadInput($tidFremd, $tidZiel, $false) | Out-Null }
    if ($attachedTarget) { [SW]::AttachThreadInput($tidSelbst, $tidZiel, $false) | Out-Null }
    if ($attachedForeground) { [SW]::AttachThreadInput($tidSelbst, $tidFremd, $false) | Out-Null }
  }
  if (Wait-SSEExactForeground $hwnd 200) { return $true }

  return $false
}

function Enter-SSEForegroundLease([IntPtr]$Hwnd) {
  $lease = $script:SSE_FOREGROUND_LEASE
  $lease.lastAcquireRaised = $false
  if ($Hwnd -eq [IntPtr]::Zero -or -not [SW]::IsWindow($Hwnd)) { return $false }

  # watch bleibt auch bei depth=0 bis Emit gesetzt. Ein zwischenzeitliches
  # Hide nimmt nur TOPMOST zurueck; es darf den Benutzerfokus nicht vor einer
  # direkt folgenden Tabellen-/Dialogtaste wiederherstellen.
  if ($null -eq $lease.watch) {
    $lease.rootHwnd = [int64]$Hwnd
    $targetPid = 0; [SW]::GetWindowThreadProcessId($Hwnd, [ref]$targetPid) | Out-Null
    $lease.targetPid = [int]$targetPid
    $lease.previousForeground = [int64][SW]::GetForegroundWindow()
    $cursor = New-Object SW+PT
    $lease.previousCursor = $(if ([SW]::GetCursorPos([ref]$cursor)) {
      [pscustomobject]@{ x=[int]$cursor.X; y=[int]$cursor.Y }
    } else { $null })
    $lease.raisedWindows.Clear()
    $lease.acquisitions = 0; $lease.raises = 0; $lease.topmostCycles = 0; $lease.releases = 0
    $lease.lastOwnedInputTick = Get-SSELastInputTick
    $lease.ownedCursorPoint = $null
    $lease.foregroundHeldMs = 0; $lease.foregroundRestored = $false; $lease.cursorRestored = $false
    $lease.releasedByEmit = $false; $lease.restoreSkippedReason = $null; $lease.cleanupError = $null
    $lease.watch = [Diagnostics.Stopwatch]::StartNew()
  }

  $lease.depth = [int]$lease.depth + 1
  $lease.acquisitions = [int]$lease.acquisitions + 1
  if ([int]$lease.acquisitions -gt 1 -and [SW]::GetForegroundWindow() -eq $Hwnd) {
    return $true
  }

  if ([int64]$Hwnd -notin @($lease.raisedWindows)) { $null = $lease.raisedWindows.Add([int64]$Hwnd) }
  $lease.lastAcquireRaised = $true
  $lease.raises = [int]$lease.raises + 1
  $lease.topmostCycles = [int]$lease.topmostCycles + 1
  Set-SSEForegroundWindowCore $Hwnd -Topmost
}

function Show-SSEWindow([IntPtr]$hwnd) {
  Enter-SSEForegroundLease $hwnd
}

function Set-SSEForegroundLeaseInputCheckpoint($InputTick, $CursorPoint = $null) {
  $lease = $script:SSE_FOREGROUND_LEASE
  # watch bleibt absichtlich bis Emit aktiv, auch wenn ein zwischenzeitliches
  # Hide die Verschachtelung auf 0 gebracht hat. Tabellen und Dateidialoge
  # senden ihre Taste direkt nach einem verifizierten Klick; diese eigene
  # Eingabe muss weiterhin von echter Benutzerinterferenz unterscheidbar sein.
  if ($null -eq $lease.watch -or $null -eq $InputTick) { return }
  $lease.lastOwnedInputTick = [uint64]$InputTick
  if ($CursorPoint) {
    $lease.ownedCursorPoint = [pscustomobject]@{ x=[int]$CursorPoint.x; y=[int]$CursorPoint.y }
  }
}

function Exit-SSEForegroundLease {
  param([IntPtr]$Hwnd = [IntPtr]::Zero, [switch]$Force, [string]$Reason = 'explicit')
  $lease = $script:SSE_FOREGROUND_LEASE
  $HWND_NOTOPMOST = [IntPtr](-2)
  $SWP = 0x0001 -bor 0x0002 -bor 0x0010 # NOSIZE | NOMOVE | NOACTIVATE

  if ($null -eq $lease.watch) {
    if ($Hwnd -ne [IntPtr]::Zero -and [SW]::IsWindow($Hwnd)) {
      [SW]::SetWindowPos($Hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP) | Out-Null
    }
    return
  }
  if (-not $Force) {
    if ([int]$lease.depth -gt 0) { $lease.depth = [int]$lease.depth - 1 }
    if ([int]$lease.depth -gt 0) { return }
    # Fokus und Cursor bleiben bis zum gemeinsamen Emit-Ausgang gebunden.
    # TOPMOST wird dagegen sofort entfernt, damit Readback/OCR den Desktop
    # nicht laenger als fuer den physischen Abschnitt ueberdeckt.
    foreach ($raisedRaw in @($lease.raisedWindows)) {
      try {
        $raised = [IntPtr][int64]$raisedRaw
        if ([SW]::IsWindow($raised)) {
          [SW]::SetWindowPos($raised, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP) | Out-Null
        }
      } catch { $lease.cleanupError = $_.Exception.Message }
    }
    return
  } else {
    $lease.releasedByEmit = ($Reason -eq 'emit')
    $lease.depth = 0
  }

  $lease.releases = [int]$lease.releases + 1
  if ($lease.watch) {
    $lease.watch.Stop()
    $lease.foregroundHeldMs = [int64]$lease.watch.ElapsedMilliseconds
  }
  foreach ($raisedRaw in @($lease.raisedWindows)) {
    try {
      $raised = [IntPtr][int64]$raisedRaw
      if ([SW]::IsWindow($raised)) {
        [SW]::SetWindowPos($raised, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP) | Out-Null
      }
    } catch { $lease.cleanupError = $_.Exception.Message }
  }

  $inputUnchanged = [bool]($null -ne $lease.lastOwnedInputTick -and
    (Test-SSELastInputUnchanged $lease.lastOwnedInputTick))
  if ($inputUnchanged -and $lease.previousCursor -and $lease.ownedCursorPoint) {
    try {
      $currentCursor = New-Object SW+PT
      if ([SW]::GetCursorPos([ref]$currentCursor) -and
          [Math]::Abs([int]$currentCursor.X - [int]$lease.ownedCursorPoint.x) -le 2 -and
          [Math]::Abs([int]$currentCursor.Y - [int]$lease.ownedCursorPoint.y) -le 2) {
        $lease.cursorRestored = [bool][SW]::SetCursorPos(
          [int]$lease.previousCursor.x, [int]$lease.previousCursor.y)
      }
    } catch { $lease.cleanupError = $_.Exception.Message }
  }

  $previous = [IntPtr][int64]$lease.previousForeground
  $current = [SW]::GetForegroundWindow()
  $currentPid = 0
  if ($current -ne [IntPtr]::Zero) { [SW]::GetWindowThreadProcessId($current, [ref]$currentPid) | Out-Null }
  $previousPid = 0
  if ($previous -ne [IntPtr]::Zero) { [SW]::GetWindowThreadProcessId($previous, [ref]$previousPid) | Out-Null }
  if (-not $inputUnchanged) {
    $lease.restoreSkippedReason = 'input-changed'
  } elseif ($previous -eq [IntPtr]::Zero -or -not [SW]::IsWindow($previous)) {
    $lease.restoreSkippedReason = 'previous-window-stale'
  } elseif ($previousPid -eq [int]$lease.targetPid) {
    $lease.restoreSkippedReason = 'previous-window-is-sse'
  } elseif (Test-SSEWindowIsLockScreen $previous) {
    $lease.restoreSkippedReason = 'previous-window-is-lockscreen'
  } elseif ($current -eq $previous) {
    $lease.foregroundRestored = $true
    $lease.restoreSkippedReason = 'already-restored'
  } elseif ($currentPid -ne [int]$lease.targetPid) {
    $lease.restoreSkippedReason = 'foreground-changed'
  } else {
    try {
      $lease.foregroundRestored = [bool](Set-SSEForegroundWindowCore $previous)
      if (-not $lease.foregroundRestored) { $lease.restoreSkippedReason = 'windows-denied-restore' }
    } catch {
      $lease.cleanupError = $_.Exception.Message
      $lease.restoreSkippedReason = 'restore-error'
    }
  }
  $lease.watch = $null
}

function Get-SSEForegroundLeaseTelemetry {
  $lease = $script:SSE_FOREGROUND_LEASE
  [pscustomobject]@{
    acquisitions=[int]$lease.acquisitions; raises=[int]$lease.raises
    topmostCycles=[int]$lease.topmostCycles; releases=[int]$lease.releases
    foregroundHeldMs=[int64]$lease.foregroundHeldMs
    foregroundRestored=[bool]$lease.foregroundRestored; cursorRestored=[bool]$lease.cursorRestored
    releasedByEmit=[bool]$lease.releasedByEmit; restoreSkippedReason=$lease.restoreSkippedReason
    cleanupError=$lease.cleanupError
  }
}

# Nicht jeder gefaehrliche Befehl ist ein Versandweg. Datenuebernahme,
# Import, Zuruecksetzen oder Loeschen koennen grosse Teile eines Falls
# veraendern, obwohl sie lokal bleiben. Solche generischen Invoke-/Menuewege
# brauchen eine ausdrueckliche Bestaetigung; spezialisierte, vertraglich
# gebundene Tabellen-/Dialogwerkzeuge werden hiervon nicht beruehrt.
function Test-SSEDestructiveAction([string]$name) {
  if (-not $name) { return $false }
  $n = ConvertTo-Vergleichsform $name
  if (-not $n) { return $false }
  foreach ($stamm in @(
    'losch','entfernen','zurucksetz','verwerf','datenubernahm','datenubernehm',
    'datenimport','importier','uberschreib','ersetzen'
  )) {
    if ($n.Contains($stamm)) { return $true }
  }
  return $false
}

function Assert-SSEDestructiveAcknowledgement($a, [string[]]$Names) {
  foreach ($name in @($Names)) {
    if ($name -and (Test-SSEDestructiveAction $name) -and (Arg $a 'acknowledgeDestructive') -ne $true) {
      Fail ("GESPERRT: '$name' kann lokale Steuerdaten loeschen, ersetzen, importieren oder zuruecksetzen. " +
            'Nur nach bewusstem Readback mit acknowledgeDestructive=true einmalig ausloesen.') 'blocked'
    }
  }
}
function Hide-SSETopmost([IntPtr]$hwnd) {
  Exit-SSEForegroundLease -Hwnd $hwnd
}

# Ein abgeschlossener physischer Abschnitt gibt Benutzerfokus und Cursor
# sofort zurueck. Emit bleibt der gemeinsame Safety-Net-Ausgang, falls eine
# Exception vor diesem expliziten Abschluss abbricht.
function Complete-SSEPhysicalSection([IntPtr]$hwnd) {
  Exit-SSEForegroundLease -Hwnd $hwnd -Force -Reason 'physical-section'
}

# ---------------------------------------------------------------- Kanarienvogel
# Billigste moegliche Abfrage. Dauert sie zu lange, ist das Programm
# ueberlastet und JEDES weitere Ergebnis waere unzuverlaessig.
function Test-Canary([IntPtr]$hwnd, [int]$LimitMs = 1500) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $root = $AE::FromHandle($hwnd)
    $null = $root.Current.Name
  } catch {
    return [pscustomobject]@{ ok = $false; ms = $sw.ElapsedMilliseconds; msg = $_.Exception.Message.Split("`n")[0] }
  }
  [pscustomobject]@{ ok = ($sw.ElapsedMilliseconds -le $LimitMs); ms = $sw.ElapsedMilliseconds; msg = '' }
}

# ------------------------------------------------------- Baum mit TreeWalker
# NIE FindAll benutzen. Zyklussperre ist zwingend: GetNextSibling auf dem
# ausgewaehlten Navigationsknoten liefert unbegrenzt denselben Knoten.
function Walk-TreeLegacy {
  param([IntPtr]$hwnd, [int]$MaxNodes = 4000, [int]$TimeoutSec = 45, [int]$MaxDepth = 16,
        [switch]$WithValues, [switch]$WithScroll)
  # WithValues: Zahlen- und Textfelder tragen ihren Inhalt NICHT im Namen,
  # sondern im ValuePattern. Ohne diesen Schalter liest man nur Beschriftungen
  # und keine Betraege. Abgefragt wird nur bei Feldtypen (Edit/ComboBox) -
  # ein pauschales GetSupportedPatterns ueber alle Knoten legt das Programm lahm.
  $valueTypes = @('Edit', 'ComboBox', 'Spinner')
  $toggleTypes = @('CheckBox')
  $selectionTypes = @('RadioButton', 'TreeItem')
  # WithScroll: ScrollPattern gleich im Durchlauf mitnehmen. Nachtraeglich je
  # Knoten das lebende Element zu suchen waere quadratisch (gemessen: 34 s).
  $scrollTypes = @('Pane', 'Custom', 'Group', 'Table', 'List', 'Tree', 'Document')
  $root = $AE::FromHandle($hwnd)
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $out = New-Object System.Collections.ArrayList
  $seen = New-Object 'System.Collections.Generic.HashSet[string]'
  $st = [pscustomobject]@{
    n = 0; err = 0; cyc = 0; cycleRid = ''; cycleName = ''
    truncated = $false; valErr = 0; scrollErr = 0
  }

  $walk = {
    param($el, $d, $parentIdx)
    if ($st.n -ge $MaxNodes -or $sw.Elapsed.TotalSeconds -gt $TimeoutSec) { $st.truncated = $true; return }
    try { $c = $WLK.GetFirstChild($el) } catch { $st.err++; return }
    while ($c) {
      try { $rid = ($c.GetRuntimeId() -join '.') } catch { $rid = $null }
      if ($rid -and -not $seen.Add($rid)) {
        $st.cyc++
        if (-not $st.cycleRid) {
          $st.cycleRid = $rid
          try { $st.cycleName = ($c.Current.Name -replace "`r|`n|`t", ' ').Trim() } catch { }
        }
        return
      }
      $myIdx = $st.n
      $st.n++
      try {
        $ci = $c.Current
        $rc = $ci.BoundingRectangle
        $inf = [double]::IsInfinity($rc.X)
        $ctype = $ci.ControlType.ProgrammaticName.Replace('ControlType.', '')
        $val = $null; $ro = $null; $checked = $null; $selected = $null; $scroll = $null
        if ($WithValues -and $valueTypes -contains $ctype) {
          $vp = $null
          try {
            if ($c.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
              $val = $vp.Current.Value
              $ro  = [bool]$vp.Current.IsReadOnly
            }
          } catch {
            # NICHT verschlucken: ein fehlgeschlagener Wertabruf sieht sonst
            # aus wie ein leeres Feld. Bei Betraegen ist das ein Datenfehler.
            $st.valErr++
          }
        }
        if ($WithValues -and $toggleTypes -contains $ctype) {
          $tp = $null
          try {
            if ($c.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$tp)) {
              $checked = switch ([string]$tp.Current.ToggleState) {
                'On' { $true }
                'Off' { $false }
                default { 'unbestimmt' }
              }
            }
          } catch { $st.valErr++ }
        }
        if ($WithValues -and $selectionTypes -contains $ctype) {
          $sip = $null
          try {
            if ($c.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sip)) {
              $selected = [bool]$sip.Current.IsSelected
            }
          } catch { $st.valErr++ }
        }
        if ($WithScroll -and $scrollTypes -contains $ctype) {
          $sp = $null
          try {
            if ($c.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$sp)) {
              $sc = $sp.Current
              $scroll = [pscustomobject]@{
                vScrollable = [bool]$sc.VerticallyScrollable; vPercent = $sc.VerticalScrollPercent
                vView = $sc.VerticalViewSize
                hScrollable = [bool]$sc.HorizontallyScrollable; hPercent = $sc.HorizontalScrollPercent
              }
            }
          } catch { $st.scrollErr++ }
        }
        $null = $out.Add([pscustomobject]@{
          i    = $myIdx
          p    = $parentIdx
          d    = $d
          type = $ctype
          name = ($ci.Name -replace "`r|`n|`t", ' ').Trim()
          aid  = $ci.AutomationId
          x    = $(if ($inf) { -1 } else { [int]$rc.X })
          y    = $(if ($inf) { -1 } else { [int]$rc.Y })
          w    = $(if ($inf) { 0 } else { [int]$rc.Width })
          h    = $(if ($inf) { 0 } else { [int]$rc.Height })
          on     = [bool]$ci.IsEnabled
          val    = $val
          ro      = $ro
          checked = $checked
          selected = $selected
          scroll  = $scroll
          rid    = $rid
        })
      } catch { $st.err++ }
      if ($d -lt $MaxDepth) { & $walk $c ($d + 1) $myIdx }
      if ($st.n -ge $MaxNodes -or $sw.Elapsed.TotalSeconds -gt $TimeoutSec) { $st.truncated = $true; return }
      try { $c = $WLK.GetNextSibling($c) } catch { $st.err++; return }
    }
  }
  & $walk $root 0 -1
  [pscustomobject]@{ nodes = @($out); stats = $st }
}

# Eigenschaften werden pro TreeWalker-Schritt gecacht. Ein frueherer
# GetUpdatedCache(TreeScope.Subtree)-Aufruf war auf normalen Seiten sehr
# schnell, konnte bei einem zyklischen Qt-Providerbaum jedoch nicht von
# unserer eigenen RuntimeId-Sperre unterbrochen werden: SSE wuchs dann bis in
# den Multi-GB-Bereich und hing. Mit Element-Scope bleibt jeder Provideraufruf
# klein; die RuntimeId-Sperre greift zwischen zwei Schritten. Die Rueckgabe
# bleibt formgleich zu Walk-TreeLegacy.
$script:UIAElementCache = @{}
function Get-UiSnapshot {
  param([IntPtr]$hwnd, [int]$MaxNodes = 4000, [int]$TimeoutSec = 45, [int]$MaxDepth = 16,
        [switch]$WithValues, [switch]$WithScroll)
  $snapshotWatch = [Diagnostics.Stopwatch]::StartNew()
  try {
    $root = $AE::FromHandle($hwnd)
    $request = New-Object System.Windows.Automation.CacheRequest
    foreach ($property in @(
      $AE::NameProperty,
      $AE::AutomationIdProperty,
      $AE::ControlTypeProperty,
      $AE::BoundingRectangleProperty,
      $AE::IsEnabledProperty,
      $AE::RuntimeIdProperty
    )) { $request.Add($property) }
    $request.TreeScope = [System.Windows.Automation.TreeScope]::Element
    $request.TreeFilter = [System.Windows.Automation.Automation]::ControlViewCondition
    $request.AutomationElementMode = [System.Windows.Automation.AutomationElementMode]::Full
    $cachedRoot = $root.GetUpdatedCache($request)
    if (-not $cachedRoot) { throw 'GetUpdatedCache lieferte keinen Wurzelknoten.' }

    $out = New-Object System.Collections.ArrayList
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    $st = [pscustomobject]@{
      n=0; err=0; cyc=0; cycleRid=''; cycleName=''
      truncated=$false; valErr=0; scrollErr=0
      source='cache'; fallbackReason=''; snapshotMs=0
    }
    $valueTypes = @('Edit', 'ComboBox', 'Spinner')
    $toggleTypes = @('CheckBox')
    $selectionTypes = @('RadioButton', 'TreeItem')
    $scrollTypes = @('Pane', 'Custom', 'Group', 'Table', 'List', 'Tree', 'Document')

    $walkCached = {
      param($element, [int]$depth, [int]$parentIndex)
      if ($st.n -ge $MaxNodes -or $snapshotWatch.Elapsed.TotalSeconds -gt $TimeoutSec) {
        $st.truncated = $true; return
      }
      try { $child = $WLK.GetFirstChild($element, $request) } catch { $st.err++; return }
      while ($child) {
        if ($st.n -ge $MaxNodes -or $snapshotWatch.Elapsed.TotalSeconds -gt $TimeoutSec) {
          $st.truncated = $true; return
        }
        $rid = $null
        try {
          $ridParts = $child.GetCachedPropertyValue($AE::RuntimeIdProperty)
          if ($ridParts) { $rid = (@($ridParts) -join '.') }
          if (-not $rid) { $rid = ($child.GetRuntimeId() -join '.') }
        } catch { $st.err++ }
        if ($rid -and -not $seen.Add($rid)) {
          $st.cyc++
          if (-not $st.cycleRid) { $st.cycleRid = $rid }
          return
        }
        $myIndex = $st.n
        $st.n++
        try {
          $cached = $child.Cached
          $name = [string]$cached.Name
          $aid = [string]$cached.AutomationId
          $controlType = $cached.ControlType
          $rectangle = $cached.BoundingRectangle
          $enabled = $cached.IsEnabled
          $ctype = $controlType.ProgrammaticName.Replace('ControlType.','')
          $infinite = [double]::IsInfinity($rectangle.X)
          $value = $null; $readOnly = $null; $checked = $null; $selected = $null; $scroll = $null
          if ($WithValues -and $valueTypes -contains $ctype) {
            $pattern = $null
            try {
              if ($child.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
                $value = $pattern.Current.Value
                $readOnly = [bool]$pattern.Current.IsReadOnly
              }
            } catch { $st.valErr++ }
          }
          if ($WithValues -and $toggleTypes -contains $ctype) {
            $pattern = $null
            try {
              if ($child.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
                $checked = switch ([string]$pattern.Current.ToggleState) {
                  'On' { $true }; 'Off' { $false }; default { 'unbestimmt' }
                }
              }
            } catch { $st.valErr++ }
          }
          if ($WithValues -and $selectionTypes -contains $ctype) {
            $pattern = $null
            try {
              if ($child.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
                $selected = [bool]$pattern.Current.IsSelected
              }
            } catch { $st.valErr++ }
          }
          if ($WithScroll -and $scrollTypes -contains $ctype) {
            $pattern = $null
            try {
              if ($child.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$pattern)) {
                $current = $pattern.Current
                $scroll = [pscustomobject]@{
                  vScrollable=[bool]$current.VerticallyScrollable; vPercent=$current.VerticalScrollPercent
                  vView=$current.VerticalViewSize; hScrollable=[bool]$current.HorizontallyScrollable
                  hPercent=$current.HorizontalScrollPercent
                }
              }
            } catch { $st.scrollErr++ }
          }
          $null = $out.Add([pscustomobject]@{
            i=$myIndex; p=$parentIndex; d=$depth; type=$ctype
            name=($name -replace "`r|`n|`t", ' ').Trim(); aid=$aid
            x=$(if ($infinite) { -1 } else { [int]$rectangle.X })
            y=$(if ($infinite) { -1 } else { [int]$rectangle.Y })
            w=$(if ($infinite) { 0 } else { [int]$rectangle.Width })
            h=$(if ($infinite) { 0 } else { [int]$rectangle.Height })
            on=[bool]$enabled; val=$value; ro=$readOnly; checked=$checked
            selected=$selected; scroll=$scroll; rid=$rid
          })
          if ($rid) { $script:UIAElementCache[$rid] = $child }
        } catch { $st.err++ }
        if ($depth -lt $MaxDepth) { & $walkCached $child ($depth + 1) $myIndex }
        if ($st.n -ge $MaxNodes -or $snapshotWatch.Elapsed.TotalSeconds -gt $TimeoutSec) {
          $st.truncated = $true; return
        }
        try { $child = $WLK.GetNextSibling($child, $request) } catch { $st.err++; return }
      }
    }
    & $walkCached $cachedRoot 0 -1
    $st.snapshotMs = $snapshotWatch.ElapsedMilliseconds
    if (-not $out.Count) { throw 'Bulk-Snapshot war unerwartet leer.' }
    return [pscustomobject]@{ nodes=@($out); stats=$st }
  } catch {
    $reason = $_.Exception.Message
    $legacy = Walk-TreeLegacy $hwnd $MaxNodes $TimeoutSec $MaxDepth -WithValues:$WithValues -WithScroll:$WithScroll
    $legacy.stats | Add-Member -NotePropertyName source -NotePropertyValue 'treewalker' -Force
    $legacy.stats | Add-Member -NotePropertyName fallbackReason -NotePropertyValue $reason -Force
    $legacy.stats | Add-Member -NotePropertyName snapshotMs -NotePropertyValue $snapshotWatch.ElapsedMilliseconds -Force
    return $legacy
  }
}

function Walk-Tree {
  param([IntPtr]$hwnd, [int]$MaxNodes = 4000, [int]$TimeoutSec = 45, [int]$MaxDepth = 16,
        [switch]$WithValues, [switch]$WithScroll)
  Get-UiSnapshot $hwnd $MaxNodes $TimeoutSec $MaxDepth -WithValues:$WithValues -WithScroll:$WithScroll
}

# Baumlauf, der NUR den eigenen Inhalt des gebundenen Fensters liefert.
#
# UIA haengt ein besessenes Fenster als Kind an seinen Besitzer. Ein Lauf ab
# dem Hauptfenster enthaelt deshalb auch nicht-modale Fenster wie die
# Werte-Info; deren Header-/DataItem-Knoten liegen mitten im Inhaltsbereich
# und sind allein ueber X/Y nicht von der Seite zu trennen. Seitenlesende
# Operationen muessen diesen Lauf verwenden, damit sie nicht die Tabelle eines
# fremden Fensters als Seiteninhalt melden.
function Walk-BoundTree {
  param([IntPtr]$hwnd, [int]$MaxNodes = 4000, [int]$TimeoutSec = 45, [int]$MaxDepth = 16,
        [switch]$WithValues, [switch]$WithScroll)
  $roh = Get-UiSnapshot $hwnd $MaxNodes $TimeoutSec $MaxDepth -WithValues:$WithValues -WithScroll:$WithScroll
  $scope = Split-SSEWindowScope $roh.nodes
  [pscustomobject]@{
    nodes = @($scope.own)
    stats = $roh.stats
    fremdeFenster = @($scope.foreign)
    alleKnoten = @($roh.nodes)
  }
}

# Stabile AutomationId der Seitenueberschrift aus dem Profilkatalog.
# Einmal je Arbeitsprozess gelesen; der Katalog liegt sonst bei jeder
# Seitenabfrage erneut auf der Platte.
$script:SSE_HEADING_AID_SUFFIX = $null
function Get-SSEHeadingAidSuffix {
  if ($null -eq $script:SSE_HEADING_AID_SUFFIX) {
    $catalog = Get-SSEPageObjects
    $suffix = [string]$catalog.windows.main.headingAutomationIdSuffix
    if (-not $suffix) {
      Fail 'Page-Object-Katalog nennt keine headingAutomationIdSuffix fuer das Hauptfenster.' 'invalid-catalog'
    }
    $script:SSE_HEADING_AID_SUFFIX = $suffix
  }
  $script:SSE_HEADING_AID_SUFFIX
}

# Seitenueberschrift bestimmen. Bevorzugt der stabile Kopfknoten; nur wenn die
# Seite gar keinen besitzt, wird das alte Y-Band als AUSGEWIESENER Rueckfall
# verwendet. Der frueher unmarkierte Rueckfall hat auf einer Uebersichtsseite
# den Absatz "der SteuerSparErklaerung fuer das Steuerjahr 2025." als
# Seitentitel gemeldet.
function Get-SSEHeading {
  param($Tree, $Bounds, [IntPtr]$hwnd)
  $kopf = Get-SSEPageHeadingNode $Tree.nodes (Get-SSEHeadingAidSuffix)
  if ($kopf) {
    return [pscustomobject]@{ text = [string]$kopf.name; quelle = 'clientHeader' }
  }
  $r = New-Object SW+RC; [SW]::GetWindowRect($hwnd, [ref]$r) | Out-Null
  $geraten = ($Tree.nodes | Where-Object {
    $_.type -eq 'Text' -and $_.x -ge $Bounds.minX -and $_.x -le $Bounds.maxX -and
    $_.y -ge ($r.T + 190) -and $_.y -le ($r.T + 290)
  } | Sort-Object y | Select-Object -First 1).name
  [pscustomobject]@{ text = [string]$geraten; quelle = 'geometrie-rueckfall' }
}

# Grenzen des Arbeitsbereichs bestimmen. NICHT fest verdrahten: das Fenster
# ist mal 1768, mal 2578 px breit. Links endet der Navigationsbaum (Tree),
# rechts beginnt die Hilfespalte (Knopf "Eingabehilfe").
function Get-ContentBounds {
  param($tree, [IntPtr]$hwnd)
  $r = New-Object SW+RC; [SW]::GetWindowRect($hwnd, [ref]$r) | Out-Null
  $winX = $r.L; $winW = $r.R - $r.L
  $minX = [int]($winX + $winW * 0.28)      # Rueckfall: Anteil der Fensterbreite
  $maxX = [int]($winX + $winW * 0.79)
  $navTree = @($tree.nodes | Where-Object { $_.type -eq 'Tree' -and $_.w -gt 100 } | Sort-Object x)[0]
  if ($navTree) { $minX = $navTree.x + $navTree.w + 5 }
  $help = @($tree.nodes | Where-Object { $_.name -in @('Eingabehilfe','Steuertipps') -and $_.x -gt $minX } | Sort-Object x)[0]
  if ($help) { $maxX = $help.x - 10 }
  [pscustomobject]@{ minX = $minX; maxX = $maxX; winX = $winX; winW = $winW }
}

# Element per Namen finden - ohne FindAll, ueber den gelaufenen Baum.
function Find-Node {
  param($tree, [string]$Name, [string]$Type = '', [switch]$Contains)
  foreach ($n in $tree.nodes) {
    if ($Type -and $n.type -ne $Type) { continue }
    if ($Contains) { if ($n.name -like "*$Name*") { return $n } }
    else { if ($n.name -eq $Name) { return $n } }
  }
  $null
}

# Knoten einheitlich aufloesen. Werden mehrere Selektoren geliefert, muessen
# sie ALLE passen. Ein frueherer Vorrang von aid vor name/type konnte z. B.
# aid="1" im Dateidialog auf eine gleichnamige ListItem-ID statt auf die
# zusaetzlich verlangte Schaltflaeche aufloesen.
# AutomationIds sind Pfade wie ".MainToolBar.QWidget.SearchSSE.QLineEdit" und
# ueberleben Sprachwechsel und Umbenennungen - Namen tun das nicht.
function Resolve-Node {
  param($tree, $a)
  @(Resolve-Nodes $tree $a)[0]
}
# ALLE passenden Knoten, nach Brauchbarkeit sortiert. Wichtig, weil dieselbe
# Beschriftung mehrfach vorkommt: "Jetzt beginnen" existiert als Hyperlink
# (ohne InvokePattern) UND als Button (mit). Wer nur den ersten Treffer nimmt,
# scheitert mit "Nicht unterstuetztes Muster".
function Resolve-Nodes {
  param($tree, $a)
  $rid = [string](Arg $a 'rid')
  $aid = [string](Arg $a 'aid')
  $name = [string](Arg $a 'name')
  $type = [string](Arg $a 'type')
  $sub  = [bool](Arg $a 'contains' $false)
  $hits = @($tree.nodes)
  if ($rid) { $hits = @($hits | Where-Object { $_.rid -eq $rid }) }
  if ($aid) {
    $aidHits = @($hits | Where-Object { $_.aid -eq $aid })
    if (-not $aidHits.Count) { $aidHits = @($hits | Where-Object { $_.aid -like "*$aid" }) }
    $hits = $aidHits
  }
  if ($name) {
    $hits = @($hits | Where-Object { $(if ($sub) { $_.name -like "*$name*" } else { $_.name -eq $name }) })
  }
  if ($type) { $hits = @($hits | Where-Object { $_.type -eq $type }) }
  # Bedienbare Typen zuerst, danach sichtbare vor unsichtbaren.
  $rang = @{ Button = 0; CheckBox = 1; RadioButton = 1; MenuItem = 1; TreeItem = 2; ListItem = 2; Hyperlink = 3; DataItem = 4; Text = 5 }
  @($hits | Sort-Object @{ e = { if ($rang.ContainsKey($_.type)) { $rang[$_.type] } else { 6 } } }, @{ e = { if ($_.on) { 0 } else { 1 } } })
}

# Ergebnisbaum des GLOBALEN Steuerpruefers. Dieser Baum ersetzt nach dem
# Prueflauf links den normalen Navigationsbaum. Seine Eintraege sind Hinweise
# und Fragen, keine Sperren fuer das Blaettern. Die aufgeklappte Detailkarte
# erscheint in Qt als zweiter TreeItem mit demselben Namen und groesserem
# Einzug; sie darf deshalb nicht als zusaetzliche Meldung gezaehlt werden.
function Get-CheckerResults {
  param($tree, [IntPtr]$hwnd = [IntPtr]::Zero)
  $raw = @($tree.nodes | Where-Object {
    $_.type -eq 'TreeItem' -and $_.name -and $_.aid -like '*PrueferWidgetSSE.SteuerPruefer*'
  } | Sort-Object y, x)
  if (-not $raw.Count) {
    return [pscustomobject]@{
      aktiv = $false; fragenWarnungenAngekuendigt = 0; tippsAngekuendigt = 0
      fragenWarnungenGruppeGesehen = $false; tippsGruppeGesehen = $false
      fragenWarnungen = @(); tippsZusatzinfos = @(); sonstige = @(); gesamt = 0
      aufgeklappt = @()
    }
  }

  $left = ($raw | Measure-Object x -Minimum).Minimum
  $top = @($raw | Where-Object { $_.x -le ($left + 6) })
  $details = @($raw | Where-Object { $_.x -gt ($left + 6) -and $_.h -ge 70 })
  $warn = New-Object System.Collections.ArrayList
  $tips = New-Object System.Collections.ArrayList
  $other = New-Object System.Collections.ArrayList
  $gruppe = 'sonstige'
  $warnDeclared = 0
  $tipsDeclared = 0
  $warnSeen = $false
  $tipsSeen = $false

  foreach ($node in $top) {
    if ($node.name -match '^(\d+)\s+Fragen oder Warnungen$') {
      $warnDeclared = [int]$Matches[1]; $warnSeen = $true; $gruppe = 'fragenWarnungen'; continue
    }
    if ($node.name -match '^(\d+)\s+Tipps oder Zusatzinformationen$') {
      $tipsDeclared = [int]$Matches[1]; $tipsSeen = $true; $gruppe = 'tippsZusatzinfos'; continue
    }
    $item = [pscustomobject]@{
      text = $node.name; rid = $node.rid; y = $node.y; aktiviert = [bool]$node.on
      aufgeklappt = [bool](@($details | Where-Object { $_.name -eq $node.name }).Count)
    }
    if ($gruppe -eq 'fragenWarnungen') { $null = $warn.Add($item) }
    elseif ($gruppe -eq 'tippsZusatzinfos') { $null = $tips.Add($item) }
    else { $null = $other.Add($item) }
  }

  [pscustomobject]@{
    aktiv = $true
    fragenWarnungenAngekuendigt = $warnDeclared
    tippsAngekuendigt = $tipsDeclared
    fragenWarnungenGruppeGesehen = $warnSeen
    tippsGruppeGesehen = $tipsSeen
    fragenWarnungen = @($warn)
    tippsZusatzinfos = @($tips)
    sonstige = @($other)
    gesamt = $warn.Count + $tips.Count + $other.Count
    aufgeklappt = @($details | ForEach-Object { $_.name } | Select-Object -Unique)
  }
}

function Test-CheckerResultComplete($result) {
  [bool](
    $result.aktiv -and
    $result.fragenWarnungenGruppeGesehen -and
    $result.tippsGruppeGesehen -and
    $result.fragenWarnungenAngekuendigt -eq @($result.fragenWarnungen).Count -and
    $result.tippsAngekuendigt -eq @($result.tippsZusatzinfos).Count
  )
}

# Qt liefert beim aktuell ausgewaehlten Pruefer-Eintrag dessen eigenen
# GetNextSibling-Knoten erneut. Walk-Tree muss dort aus Sicherheitsgruenden
# abbrechen und sieht deshalb zunaechst nur den oberen Teil der Ergebnisliste.
# Durch reine Pfeilnavigation (kein Aktivieren, kein Speichern) wandert die
# Auswahl kontrolliert nach unten, bis beide angekuendigten Gruppen vollstaendig
# gelesen wurden. So bleiben UIA-Zyklen fail-closed, ohne Meldungen zu verlieren.
# Experimenteller interaktiver Leser. Er bleibt als Ausgangspunkt fuer den
# Backlog erhalten, wird aber bewusst NICHT von MCP-Werkzeugen aufgerufen: Das
# notwendige Fokus-Navigieren ist in Qt sichtbar und kann dieselbe Karte
# wiederholt aufklappen.
function Read-CheckerCompleteInteractiveLegacy {
  param([IntPtr]$hwnd, [int]$MaxSteps = 30)
  $steps = 0
  $focusUsed = $false
  $stalled = 0
  $lastSignature = ''
  $navigationToggles = New-Object System.Collections.ArrayList
  $cycles = New-Object System.Collections.ArrayList
  $tree = $null
  $result = $null

  for ($attempt = 0; $attempt -le $MaxSteps; $attempt++) {
    $tree = Walk-Tree $hwnd 5000 60 20 -WithValues
    $result = Get-CheckerResults $tree $hwnd
    if (-not $result.aktiv -or (Test-CheckerResultComplete $result)) { break }
    $null = $cycles.Add([pscustomobject]@{
      name = $tree.stats.cycleName; rid = $tree.stats.cycleRid
      warnungen = @($result.fragenWarnungen).Count; tipps = @($result.tippsZusatzinfos).Count
    })

    $selected = @($tree.nodes | Where-Object {
      $_.type -eq 'TreeItem' -and $_.name -and
      $_.aid -like '*PrueferWidgetSSE.SteuerPruefer*' -and
      ($_.selected -eq $true -or ($tree.stats.cycleRid -and $_.rid -eq $tree.stats.cycleRid))
    } | Sort-Object y, x | Select-Object -First 1)
    # Bei den beiden Gruppenkoepfen wird dieselbe logische Qt-Zeile teils mit
    # einer zweiten RuntimeId gespiegelt. Der Zyklusname bleibt dabei stabil.
    if (-not $selected.Count -and $tree.stats.cycleName) {
      $selected = @($tree.nodes | Where-Object {
        $_.type -eq 'TreeItem' -and $_.name -eq $tree.stats.cycleName -and
        $_.aid -like '*PrueferWidgetSSE.SteuerPruefer*'
      } | Sort-Object y, x | Select-Object -First 1)
    }

    # Bei virtualisierten letzten Zeilen liefert Qt gelegentlich keinen
    # Zyklusknoten, obwohl der angekuendigte Zaehler noch nicht erreicht ist.
    # Dann ist die letzte aeussere sichtbare Meldungszeile der sichere Anker,
    # um per echtem Klick + DOWN die naechste Zeile zu materialisieren.
    if (-not $selected.Count) {
      $outerCandidates = @($tree.nodes | Where-Object {
        $_.type -eq 'TreeItem' -and $_.name -and
        $_.aid -like '*PrueferWidgetSSE.SteuerPruefer*' -and
        $_.name -notmatch '^\d+\s+(Fragen oder Warnungen|Tipps oder Zusatzinformationen)$'
      })
      if ($outerCandidates.Count) {
        $outerLeft = ($outerCandidates | Measure-Object x -Minimum).Minimum
        $selected = @($outerCandidates | Where-Object { $_.x -le ($outerLeft + 6) } |
          Sort-Object y -Descending | Select-Object -First 1)
      }
      if (-not $selected.Count) { break }
    }

    $signature = @(
      $result.fragenWarnungenGruppeGesehen,
      @($result.fragenWarnungen).Count,
      $result.tippsGruppeGesehen,
      @($result.tippsZusatzinfos).Count,
      $selected[0].rid
    ) -join '|'
    if ($signature -eq $lastSignature) { $stalled++ } else { $stalled = 0; $lastSignature = $signature }
    if ($stalled -ge 3) { break }

    # SetFocus/SelectionItemPattern melden bei diesem Qt-Baum Erfolg, geben der
    # Pfeiltaste aber nachweislich keinen Tastaturfokus. Erst ein
    # PID-verifizierter Zeilenklick setzt echten Tastaturfokus. Die Anwendung
    # klappt dabei zugleich die Karte auf; das wird unten am separaten
    # Aufklapp-Pfeil rueckgaengig gemacht.
    $row = $selected[0]
    $groupMarker = ''
    if ($row.name -match '^\d+\s+Tipps oder Zusatzinformationen$') { $groupMarker = 'tipps' }
    elseif ($row.name -match '^\d+\s+Fragen oder Warnungen$') { $groupMarker = 'warnungen' }
    # Der Qt-Gruppenkopf ist ein 85 px hoher Container. Sein zyklischer
    # Spiegelknoten blockiert vor dem ersten Kind. Fuer echten Fokus wird dann
    # die unmittelbar darunter liegende erste Meldungszeile adressiert.
    $focusTarget = $(if ($groupMarker) {
      [pscustomobject]@{ x = $row.x; y = [int]($row.y + $row.h); w = [Math]::Min(100, $row.w); h = 48 }
    } else {
      [pscustomobject]@{ x = $row.x; y = $row.y; w = [Math]::Min(100, $row.w); h = $row.h }
    })
    $null = $navigationToggles.Add([pscustomobject]@{
      name = $(if ($groupMarker) { '' } else { $row.name })
      gruppe = $groupMarker
      warAufgeklappt = [bool](@($result.aufgeklappt) -contains $row.name)
    })
    $null = Click-VerifiedPoint $hwnd $focusTarget
    $null = Show-SSEWindow $hwnd
    $focusUsed = $true
    [System.Windows.Forms.SendKeys]::SendWait('{DOWN}')
    Set-SSEForegroundLeaseInputCheckpoint (Get-SSELastInputTick)
    Start-Sleep -Milliseconds 750

    # Liegt der Fokusanker am unteren Fensterrand, kann die zugleich geoeffnete
    # lange Karte die naechste Meldung komplett aus Qts virtualisiertem Baum
    # schieben. Ein begrenztes Mausrad direkt ueber derselben, bereits
    # PID-verifizierten Prueferzeile materialisiert den unteren Rest.
    $checkerRect = New-Object SW+RC; [SW]::GetWindowRect($hwnd, [ref]$checkerRect) | Out-Null
    if (($row.y + $row.h) -ge ($checkerRect.B - 170)) {
      $wheelX = [int]($row.x + [Math]::Min(80, [Math]::Max(20, $row.w / 3)))
      $wheelY = [int][Math]::Min($checkerRect.B - 100, [Math]::Max($checkerRect.T + 180, $row.y + 20))
      [SW]::SetCursorPos($wheelX, $wheelY) | Out-Null
      $wheelDown = [uint32]([int64]0x100000000 - 120)
      for ($wheelStep = 0; $wheelStep -lt 6; $wheelStep++) {
        [SW]::mouse_event(0x0800, 0, 0, $wheelDown, [IntPtr]::Zero)
      }
      Set-SSEForegroundLeaseInputCheckpoint (Get-SSELastInputTick) ([pscustomobject]@{ x=$wheelX; y=$wheelY })
      Start-Sleep -Milliseconds 700
    }
    Hide-SSETopmost $hwnd
    $steps++
  }

  # Der notwendige Fokus-Klick klappt in dieser Qt-Ansicht zugleich die Karte
  # auf. Ein sofortiges Zuklappen setzt den fehlerhaften Zyklusknoten wieder
  # zurueck und macht die Liste erneut unvollstaendig. Deshalb bleibt nur diese
  # rein technische Karte sichtbar; sie aendert keine Steuerdaten und wird
  # explizit gemeldet. Ein spaeteres checker_open kann sie direkt nutzen.
  $technicalCards = New-Object System.Collections.ArrayList
  foreach ($toggle in $navigationToggles) {
    $technicalName = [string]$toggle.name
    if (-not $technicalName -and $toggle.gruppe -eq 'tipps' -and @($result.tippsZusatzinfos).Count) {
      $technicalName = [string]$result.tippsZusatzinfos[0].text
    } elseif (-not $technicalName -and $toggle.gruppe -eq 'warnungen' -and @($result.fragenWarnungen).Count) {
      $technicalName = [string]$result.fragenWarnungen[0].text
    }
    if ($technicalName -and -not (@($technicalCards) -contains $technicalName)) { $null = $technicalCards.Add($technicalName) }
  }

  [pscustomobject]@{
    tree = $tree
    result = $result
    vollstaendig = [bool](Test-CheckerResultComplete $result)
    navigationSchritte = $steps
    fokusVerwendet = $focusUsed
    technischeFokusKarten = @($technicalCards)
    zyklen = @($cycles)
  }
}

# Sicherer Standardleser: genau ein UIA-Snapshot, keinerlei Klicks, Tasten oder
# Scrollbewegungen. Bei geschlossenen Detailkarten passt die Ergebnisliste in
# der Regel vollstaendig in den Baum. Andernfalls wird konsistent=false
# gemeldet, statt durch sichtbare Seriennavigation Vollstaendigkeit zu
# erzwingen. Komfortfunktionen (breiter ziehen, scrollend zusammenfuehren,
# abhaken) bleiben ein expliziter Backlog-Punkt.
function Read-CheckerComplete {
  param([IntPtr]$hwnd, [int]$MaxSteps = 0)
  $tree = Walk-Tree $hwnd 5000 60 20 -WithValues -WithScroll

  $result = Get-CheckerResults $tree $hwnd
  [pscustomobject]@{
    tree = $tree
    result = $result
    vollstaendig = [bool](Test-CheckerResultComplete $result)
    navigationSchritte = 0
    fokusVerwendet = $false
    technischeFokusKarten = @()
    zyklen = @()
  }
}

# Deutsche Geld-/Prozentdarstellung fuer die interne Spalteninvariante lesen.
# Nicht parsebare Texte werden bewusst uebersprungen; sie duerfen nie als Null
# in eine scheinbar erfolgreiche Differenzpruefung eingehen.
function Convert-SSEComparableNumber($Value) {
  if ($null -eq $Value) { return $null }
  $text = ("$Value" -replace '\s+', '').Trim()
  $text = $text -replace '\.', '' -replace ',', '.'
  $text = $text -replace '[^0-9+\-.]', ''
  if (-not $text -or $text -in @('+','-','.')) { return $null }
  [decimal]$parsed = 0
  if ([decimal]::TryParse($text, [Globalization.NumberStyles]::Float,
      [Globalization.CultureInfo]::InvariantCulture, [ref]$parsed)) { return $parsed }
  $null
}

# Werte-Info ist eine echte Qt-Tabelle. Sobald das nicht-modale Fenster offen
# ist, haengt Qt seine Accessibility-Knoten auch in den Prozessbaum des
# Hauptfensters. Dadurch koennen Lage, Pruefer und Ergebnis mit EINEM UIA-
# Snapshot gelesen werden. Das spart gegenueber drei getrennten MCP-Aufrufen
# mehrere Workerstarts und vermeidet gemischte Vorher-/Nachher-Zustaende.
function Read-ResultDetailsFromTree {
  param($Tree)
  $allData = @($Tree.nodes | Where-Object {
    $_.type -eq 'DataItem' -and $_.aid -like '*WerteInfo*obj_Wertetabelle'
  })
  # Negative Bildschirmkoordinaten sind auf Mehrmonitor-Systemen legitim.
  # Nicht positionierte/virtualisierte Zellen erkennt der Snapshot stattdessen
  # an einem leeren Rechteck (0x0, meist x/y=-1).
  $unpositioned = @($allData | Where-Object { $_.w -le 0 -or $_.h -le 0 })
  $data = @($allData | Where-Object { $_.w -gt 0 -and $_.h -gt 0 } | Sort-Object y, x)
  $headers = @($Tree.nodes | Where-Object {
    $_.type -eq 'Header' -and $_.aid -like '*WerteInfo*obj_Wertetabelle' -and $_.w -gt 0 -and $_.h -gt 0
  } | Sort-Object x | ForEach-Object { $_.name })
  $tableScroll = @($Tree.nodes | Where-Object {
    $_.aid -like '*WerteInfo*obj_Wertetabelle' -and $null -ne $_.scroll
  } | Select-Object -First 1)
  $scrollIncomplete = [bool]($tableScroll.Count -and $tableScroll[0].scroll.vScrollable -and
    [double]$tableScroll[0].scroll.vView -lt 99.999)
  $windowOpen = @($Tree.nodes | Where-Object { $_.aid -like '*SSE_Application.WerteInfo*' }).Count -gt 0
  if (-not $data.Count) {
    return [pscustomobject]@{
      verfuegbar = $false; fensterOffen = [bool]$windowOpen; anzahl = 0
      vollstaendig = $false; zeilen = @(); unvollstaendigeZeilen = @()
      nichtPositionierteZellenAnzahl = $unpositioned.Count
      uiaKopfzeilen = $headers; kopfVollstaendig = [bool]($headers.Count -eq 4)
      vergleichsInvariantGeprueft = 0; vergleichsInvariantFehler = @()
      vertikalUnvollstaendig = $scrollIncomplete
      fingerprint = $null
      hinweis = $(if ($windowOpen) {
        'Werte-Info ist offen, aber die Qt-Tabelle war in diesem Snapshot nicht lesbar.'
      } else {
        'Werte-Info ist nicht offen. Einmal sse_result_details aufrufen; danach liest sse_ui_state die Werte ohne weiteren Fensterwechsel mit.'
      })
    }
  }

  $rows = New-Object System.Collections.ArrayList
  $malformed = New-Object System.Collections.ArrayList
  $invariantErrors = New-Object System.Collections.ArrayList
  $invariantChecked = 0
  foreach ($group in @($data | Group-Object y | Sort-Object { [int]$_.Name })) {
    $cells = @($group.Group | Sort-Object x)
    if ($cells.Count -ne 4) {
      $null = $malformed.Add([pscustomobject]@{ y=[int]$group.Name; cells=@($cells | ForEach-Object { $_.name }) })
      continue
    }
    $row = [pscustomobject]@{
      beobachteterWert = [string]$cells[0].name
      aktuell = [string]$cells[1].name
      festgehalten = [string]$cells[2].name
      differenz = [string]$cells[3].name
    }
    $null = $rows.Add($row)
    $actual = Convert-SSEComparableNumber $row.aktuell
    $held = Convert-SSEComparableNumber $row.festgehalten
    $difference = Convert-SSEComparableNumber $row.differenz
    if ($null -ne $actual -and $null -ne $held -and $null -ne $difference) {
      $invariantChecked++
      if ([Math]::Abs([double](($actual - $held) - $difference)) -gt 0.011) {
        $null = $invariantErrors.Add([pscustomobject]@{
          beobachteterWert=$row.beobachteterWert; aktuell=$row.aktuell
          festgehalten=$row.festgehalten; differenz=$row.differenz
        })
      }
    }
  }
  $complete = [bool]($rows.Count -gt 0 -and -not $malformed.Count -and
    -not $unpositioned.Count -and $headers.Count -eq 4 -and -not $scrollIncomplete -and
    -not $invariantErrors.Count -and -not $Tree.stats.truncated -and -not $Tree.stats.cyc)
  $fingerprintBody = @($rows | ForEach-Object {
    [pscustomobject]@{
      beobachteterWert=$_.beobachteterWert; aktuell=$_.aktuell
      festgehalten=$_.festgehalten; differenz=$_.differenz
    }
  }) | ConvertTo-Json -Depth 6 -Compress
  [pscustomobject]@{
    verfuegbar = [bool]($rows.Count -gt 0); fensterOffen = [bool]$windowOpen
    anzahl = $rows.Count; vollstaendig = $complete; zeilen = @($rows)
    unvollstaendigeZeilen = @($malformed)
    nichtPositionierteZellenAnzahl = $unpositioned.Count
    uiaKopfzeilen = $headers; kopfVollstaendig = [bool]($headers.Count -eq 4)
    vergleichsInvariantGeprueft = $invariantChecked
    vergleichsInvariantFehler = @($invariantErrors)
    vertikalUnvollstaendig = $scrollIncomplete
    fingerprint = $(if ($rows.Count) { Get-SSETextSha256 $fingerprintBody } else { $null })
    hinweis = 'Aktuell ist der gegenwaertige Wert; festgehalten ist der Vergleichsstand; Differenz ist die Wirkung gegen diesen Stand.'
  }
}

function Get-DirtyState {
  param($tree)
  $save = @($tree.nodes | Where-Object {
    $_.type -eq 'Button' -and $_.aid -like '*MainToolBar.tb_sichern'
  } | Select-Object -First 1)
  if (-not $save.Count) { return $null }
  [bool]$save[0].on
}

# Lebendes AutomationElement zu einem Baumknoten holen (ueber RuntimeId-Pfad
# geht nicht direkt; wir laufen den Baum erneut und vergleichen die RuntimeId).
function Get-LiveElement {
  param([IntPtr]$hwnd, [string]$Rid, [string]$Aid = '')
  $root = $AE::FromHandle($hwnd)
  # RuntimeId ist innerhalb des unmittelbar zuvor gelesenen UIA-Snapshots der
  # eindeutige Selektor. Qt wiederholt AutomationIds bei Tabellenzellen; Aid
  # zuerst lieferte dort den grossen Tabellencontainer statt der Zielzelle.
  if ($Rid -and $script:UIAElementCache.ContainsKey($Rid)) {
    return $script:UIAElementCache[$Rid]
  }
  # Katalogisierte Einzelfelder werden direkt per stabiler, vollstaendiger Aid
  # aufgeloest und liegen nicht zwingend im Snapshot-Cache.
  if ($Aid) {
    try {
      $aidCondition = New-Object System.Windows.Automation.PropertyCondition($AE::AutomationIdProperty, $Aid)
      $exact = $root.FindFirst($TS::Descendants, $aidCondition)
      if ($exact) { return $exact }
    } catch { }
  }
  $seen = New-Object 'System.Collections.Generic.HashSet[string]'
  $found = $null
  $stack = New-Object System.Collections.Stack
  $stack.Push($root)
  while ($stack.Count -gt 0 -and -not $found) {
    $node = $stack.Pop()
    try { $c = $WLK.GetFirstChild($node) } catch { continue }
    while ($c) {
      try { $r = ($c.GetRuntimeId() -join '.') } catch { $r = $null }
      if ($r -and -not $seen.Add($r)) { break }
      if ($r -eq $Rid) { $found = $c; break }
      $stack.Push($c)
      try { $c = $WLK.GetNextSibling($c) } catch { break }
    }
  }
  $found
}

# Liefert fuer genau ein UIA-Element alle strukturiert erreichbaren Texte und
# einen begrenzten RawView-Unterbaum. Das ist die Diagnose dafuer, ob ein
# Qt-Bereich wirklich OCR braucht: ControlView kann leer sein, obwohl
# TextPattern, LegacyIAccessiblePattern, RawView oder MSAA Inhalt bereitstellen.
function Get-UiaElementDescriptor {
  param($Element, [int]$Depth = 0, [bool]$WithPatterns = $true)
  $patterns = New-Object System.Collections.ArrayList
  if ($WithPatterns) {
    try {
      foreach ($pattern in @($Element.GetSupportedPatterns())) {
        $name = [string]$pattern.ProgrammaticName
        if ($name) { $null = $patterns.Add($name) }
      }
    } catch { }
  }

  $texts = New-Object System.Collections.ArrayList
  function Add-UiaText([string]$Source, $Value) {
    $s = [string]$Value
    if (-not [string]::IsNullOrWhiteSpace($s)) {
      $s = $s.Trim()
      if (-not @($texts | Where-Object { $_.text -eq $s }).Count) {
        $null = $texts.Add([pscustomobject]@{ source = $Source; text = $s })
      }
    }
  }

  $current = $null
  try { $current = $Element.Current } catch { }
  if ($current) {
    Add-UiaText 'Current.Name' $current.Name
    Add-UiaText 'Current.HelpText' $current.HelpText
    Add-UiaText 'Current.ItemStatus' $current.ItemStatus
  }

  if ($WithPatterns) {
    $valuePattern = $null
    try {
      if ($Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
        Add-UiaText 'ValuePattern.Value' $valuePattern.Current.Value
      }
    } catch { }
    $textPattern = $null
    try {
      if ($Element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
        Add-UiaText 'TextPattern.DocumentRange' $textPattern.DocumentRange.GetText(-1)
      }
    } catch { }
    $legacyPattern = $null
    try {
      if ($Element.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacyPattern)) {
        Add-UiaText 'Legacy.Name' $legacyPattern.Current.Name
        Add-UiaText 'Legacy.Value' $legacyPattern.Current.Value
        Add-UiaText 'Legacy.Description' $legacyPattern.Current.Description
        Add-UiaText 'Legacy.Help' $legacyPattern.Current.Help
      }
    } catch { }
  }

  $rect = $null
  try {
    $r = $current.BoundingRectangle
    $rect = [pscustomobject]@{ x=[int]$r.X; y=[int]$r.Y; w=[int]$r.Width; h=[int]$r.Height }
  } catch { }
  [pscustomobject]@{
    depth = $Depth
    rid = $(try { $Element.GetRuntimeId() -join '.' } catch { '' })
    type = $(try { $current.ControlType.ProgrammaticName -replace '^ControlType\.', '' } catch { '' })
    name = $(try { [string]$current.Name } catch { '' })
    aid = $(try { [string]$current.AutomationId } catch { '' })
    localizedType = $(try { [string]$current.LocalizedControlType } catch { '' })
    offscreen = $(try { [bool]$current.IsOffscreen } catch { $null })
    rect = $rect
    patterns = @($patterns)
    texts = @($texts)
  }
}

function Get-AccessibilityProbeData {
  param(
    [IntPtr]$hwnd, $Node, [int]$MaxDepth = 6, [int]$MaxNodes = 120,
    [bool]$IncludePatterns = $true, [bool]$IncludeRaw = $true, [bool]$IncludeMsaa = $true
  )
  $element = Get-LiveElement $hwnd $Node.rid
  if (-not $element) { Fail "UIA-Element ist veraltet: $($Node.rid)" 'stale' }

  $rootDescriptor = Get-UiaElementDescriptor $element 0 $IncludePatterns
  $descendants = New-Object System.Collections.ArrayList
  $seen = New-Object 'System.Collections.Generic.HashSet[string]'
  $stack = New-Object System.Collections.Stack
  if ($IncludeRaw) { $stack.Push([pscustomobject]@{ element = $element; depth = 0 }) }
  while ($IncludeRaw -and $stack.Count -gt 0 -and $descendants.Count -lt $MaxNodes) {
    $entry = $stack.Pop()
    if ($entry.depth -ge $MaxDepth) { continue }
    try { $child = $RAW.GetFirstChild($entry.element) } catch { continue }
    while ($child -and $descendants.Count -lt $MaxNodes) {
      $rid = $(try { $child.GetRuntimeId() -join '.' } catch { '' })
      if ($rid -and -not $seen.Add($rid)) { break }
      $descriptor = Get-UiaElementDescriptor $child ($entry.depth + 1) $IncludePatterns
      $null = $descendants.Add($descriptor)
      if (($entry.depth + 1) -lt $MaxDepth) {
        $stack.Push([pscustomobject]@{ element = $child; depth = $entry.depth + 1 })
      }
      try { $child = $RAW.GetNextSibling($child) } catch { break }
    }
  }

  $msaa = New-Object System.Collections.ArrayList
  if ($IncludeMsaa) { try {
    # Kein rekursiver MSAA-Baum: Qts Provider kann dabei im nativen Code
    # abbrechen. Stattdessen werden begrenzt Punkte innerhalb des bereits per
    # UIA/PID verifizierten Zielrechtecks abgefragt.
    $sampleX = @($Node.x + 8, [int]($Node.x + $Node.w / 2), $Node.x + $Node.w - 8)
    $sampleY = @(
      $Node.y + 8,
      [int]($Node.y + $Node.h / 4),
      [int]($Node.y + $Node.h / 2),
      [int]($Node.y + 3 * $Node.h / 4),
      $Node.y + $Node.h - 8
    )
    $msaaKeys = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($sx in $sampleX) { foreach ($sy in $sampleY) {
      $acc = [SSEAccessible]::DescribePoint([int]$sx, [int]$sy)
      if (-not $acc) { continue }
      $key = "$($acc.Role)|$($acc.X)|$($acc.Y)|$($acc.W)|$($acc.H)|$($acc.Name)|$($acc.Value)|$($acc.Description)"
      if (-not $msaaKeys.Add($key)) { continue }
      $null = $msaa.Add([pscustomobject]@{
        name=[string]$acc.Name; value=[string]$acc.Value
        description=[string]$acc.Description; help=[string]$acc.Help
        keyboardShortcut=[string]$acc.KeyboardShortcut
        defaultAction=[string]$acc.DefaultAction; role=$acc.Role; state=$acc.State
        x=$acc.X; y=$acc.Y; w=$acc.W; h=$acc.H; path=@()
      })
    } }
  } catch { } }

  $candidates = New-Object System.Collections.ArrayList
  function Add-Candidate([string]$Source, $Value) {
    $s = [string]$Value
    if (-not [string]::IsNullOrWhiteSpace($s)) {
      $s = $s.Trim()
      if (-not @($candidates | Where-Object { $_.text -eq $s }).Count) {
        $null = $candidates.Add([pscustomobject]@{ source=$Source; text=$s })
      }
    }
  }
  foreach ($item in @($rootDescriptor.texts)) { Add-Candidate "UIA.$($item.source)" $item.text }
  foreach ($desc in @($descendants)) {
    foreach ($item in @($desc.texts)) { Add-Candidate "RawView.$($item.source)" $item.text }
  }
  foreach ($acc in @($msaa)) {
    Add-Candidate 'MSAA.Name' $acc.name
    Add-Candidate 'MSAA.Value' $acc.value
    Add-Candidate 'MSAA.Description' $acc.description
    Add-Candidate 'MSAA.Help' $acc.help
  }

  [pscustomobject]@{
    node = $Node
    uia = $rootDescriptor
    rawDescendants = @($descendants)
    rawTruncated = [bool]($descendants.Count -ge $MaxNodes)
    msaaOverlaps = @($msaa)
    textCandidates = @($candidates)
  }
}

function Take-Shot {
  param([IntPtr]$hwnd, [string]$Path)
  $fullPath = [IO.Path]::GetFullPath($Path)
  $parent = [IO.Path]::GetDirectoryName($fullPath)
  if (-not (Test-Path -LiteralPath $parent -PathType Container)) { Fail "Screenshot-Zielordner fehlt: $parent" 'not-found' }
  if (Test-Path -LiteralPath $fullPath) { Fail "Screenshot-Ziel existiert bereits: $fullPath" 'exists' }
  $temporaryPath = Join-Path $parent ('.' + [IO.Path]::GetFileName($fullPath) + '.shot-' + [guid]::NewGuid().ToString('N') + '.png')
  $r = New-Object SW+RC
  [SW]::GetWindowRect($hwnd, [ref]$r) | Out-Null
  $w = $r.R - $r.L; $h = $r.B - $r.T
  if ($w -le 0 -or $h -le 0) { Fail "Fenster hat Groesse ${w}x${h} - vermutlich noch nicht bereit." 'no-window' }
  $bmp = $null; $g = $null; $hdc = [IntPtr]::Zero
  try {
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $g.GetHdc()
    # PW_RENDERFULLCONTENT = 2 -> funktioniert auch im Hintergrund
    $okShot = [SW]::PrintWindow($hwnd, $hdc, 2)
    $g.ReleaseHdc($hdc); $hdc = [IntPtr]::Zero
    $bmp.Save($temporaryPath, [System.Drawing.Imaging.ImageFormat]::Png)
    # File.Move besitzt auf .NET Framework bewusst keinen Overwrite-Pfad.
    # Taucht das Ziel nach dem Preflight auf, bleibt die fremde Datei erhalten.
    [IO.File]::Move($temporaryPath, $fullPath)
    [pscustomobject]@{ path = $fullPath; w = $w; h = $h; ok = [bool]$okShot }
  } catch {
    if (Test-Path -LiteralPath $fullPath) {
      Fail "Screenshot-Ziel erschien waehrend der Aufnahme und wurde nicht ueberschrieben: $fullPath" 'exists'
    }
    Fail "Screenshot konnte nicht sicher geschrieben werden: $($_.Exception.Message)" 'write-failed'
  } finally {
    if ($hdc -ne [IntPtr]::Zero -and $g) { $g.ReleaseHdc($hdc) }
    if ($g) { $g.Dispose() }
    if ($bmp) { $bmp.Dispose() }
    if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue }
  }
}

function Remove-SSETemporaryFile([string]$Path) {
  if (-not $Path) { return [pscustomobject]@{ removed = $true; error = $null } }
  $cleanupError = $null
  try {
    if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force -ErrorAction Stop }
  } catch { $cleanupError = $_.Exception.Message }
  $removed = -not (Test-Path -LiteralPath $Path)
  if (-not $removed -and -not $cleanupError) { $cleanupError = "Temporaerdatei blieb bestehen: $Path" }
  [pscustomobject]@{ removed = $removed; error = $cleanupError }
}

function Copy-SSEFileNew([string]$Source, [string]$Destination) {
  # CreateNew macht die No-Overwrite-Bedingung atomar. Die Quelle bleibt fuer
  # die kurze Kopie gegen paralleles Schreiben gesperrt; eine von uns erzeugte
  # Teildatei wird nach einem I/O-Fehler gezielt entfernt.
  $sourceStream = $null
  $destinationStream = $null
  $destinationCreated = $false
  $copyError = $null
  try {
    $sourceStream = [IO.File]::Open($Source, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $destinationStream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $destinationCreated = $true
    $sourceStream.CopyTo($destinationStream)
    $destinationStream.Flush($true)
  } catch {
    $copyError = $_
  } finally {
    if ($destinationStream) { $destinationStream.Dispose() }
    if ($sourceStream) { $sourceStream.Dispose() }
  }
  if ($copyError) {
    if ($destinationCreated -and (Test-Path -LiteralPath $Destination -PathType Leaf)) {
      Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
    }
    throw $copyError
  }
}

function Invoke-WindowsOcr([string]$Path) {
  $legacyPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $ocrScript = Join-Path $PSScriptRoot 'ocr-image.ps1'
  if (-not (Test-Path -LiteralPath $legacyPowerShell) -or -not (Test-Path -LiteralPath $ocrScript)) {
    return [pscustomobject]@{ ok = $false; error = 'Windows-OCR-Helfer nicht verfuegbar.' }
  }
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $legacyPowerShell
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $quoteProcessArgument = {
    param([string]$Value)
    if ($Value -notmatch '[\s"]') { return $Value }
    return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
  }
  $psi.Arguments = (@('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',$ocrScript,'-Path',$Path) |
    ForEach-Object { & $quoteProcessArgument ([string]$_) }) -join ' '
  $ocrProcess = [Diagnostics.Process]::Start($psi)
  $ocrOutTask = $ocrProcess.StandardOutput.ReadToEndAsync()
  $ocrErrTask = $ocrProcess.StandardError.ReadToEndAsync()
  $ocrProcess.WaitForExit()
  $ocrRaw = $ocrOutTask.GetAwaiter().GetResult().Trim()
  $ocrErr = $ocrErrTask.GetAwaiter().GetResult().Trim()
  $ocrExitCode = $ocrProcess.ExitCode
  $ocrProcess.Dispose()
  if ($ocrExitCode -ne 0 -and -not $ocrRaw) {
    return [pscustomobject]@{ ok = $false; error = $(if ($ocrErr) { $ocrErr } else { "OCR-Prozess Exit $ocrExitCode" }) }
  }
  try { $ocrRaw | ConvertFrom-Json }
  catch { [pscustomobject]@{ ok = $false; error = "OCR-Antwort war kein JSON: $ocrRaw" } }
}

# ---------------------------------------------------- atomare Aenderungs-Diffs
# Diese Helfer werden von den nachverfolgten Mutationen in EINEM frischen
# UIA-Arbeitsprozess verwendet. So bleiben native Qt/UIA-Fehler isoliert, aber
# Vorher-/Nachher-Lesung, Commit, Summen und Steuerwirkung brauchen nicht mehr
# je einen eigenen MCP-Roundtrip.

function Get-SSETextSha256([string]$Text) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
    ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '')
  } finally { $sha.Dispose() }
}

function Resolve-SSEVaStDialog($a, [bool]$RequireFingerprint = $false) {
  $windows = @(Get-Windows 'SSE')
  $requestedHwnd = Arg $a 'hwnd'
  $candidates = @($windows | Where-Object {
    $_.title -eq 'Daten der vorausgefüllten Steuererklärung' -and
    (-not $requestedHwnd -or [int64]$_.hwnd -eq [int64]$requestedHwnd)
  })
  if ($candidates.Count -ne 1) {
    Fail "VaSt-Zuordnungsdialog ist nicht eindeutig vorhanden ($($candidates.Count) Treffer)." 'not-found'
  }
  $window = $candidates[0]
  $main = @((Get-SSEMainWindowCandidates $windows) | Where-Object { [int]$_.pid -eq [int]$window.pid } | Select-Object -First 1)
  if (-not $main.Count) { Fail 'Zugehoeriges SSE-Hauptfenster fehlt.' 'ownership' }
  $mainHwnd = [IntPtr][int64]$main[0].hwnd
  $topPopup = Get-SSEDeepestLastActivePopup $mainHwnd
  if ($topPopup -ne $mainHwnd -and [int64]$topPopup -ne [int64]$window.hwnd) {
    Fail "VaSt-Dialog ist nicht der oberste aktive Dialog; zuerst HWND $([int64]$topPopup) bearbeiten." 'non-topmost-dialog'
  }
  $dialog = Get-DialogDescriptor $window $mainHwnd
  if ($dialog.kind -ne 'qt-dialog') { Fail "Fensterart '$($dialog.kind)' ist kein lesbarer VaSt-Dialog." 'blocked' }
  $expected = ([string](Arg $a 'fingerprint')).ToUpperInvariant()
  if ($RequireFingerprint -and -not $expected) { Fail 'fingerprint ist fuer diese VaSt-Aktion Pflicht.' 'bad-args' }
  if ($expected -and $dialog.fingerprint -ne $expected) {
    Emit ([pscustomobject]@{
      ok=$false; kind='fingerprint-mismatch'; error='VaSt-Dialog hat sich seit dem Lesen geaendert; nichts bedient.'
      expectedFingerprint=$expected; actualFingerprint=$dialog.fingerprint; hwnd=$dialog.hwnd; title=$dialog.title
    })
  }
  [pscustomobject]@{ dialog=$dialog; mainHwnd=$mainHwnd; main=$main[0] }
}

function Get-SSEVaStRows($Tree) {
  $cells = @($Tree.nodes | Where-Object {
    $_.type -eq 'TreeItem' -and $_.aid -eq 'SSE_Application.AssignVaStDlg.QWidget.QTreeWidget' -and
    $_.w -gt 0 -and $_.h -gt 0 -and $_.on
  } | Sort-Object y, x)
  $groups = @($cells | Group-Object y | Sort-Object { [int]$_.Name })
  $rows = New-Object System.Collections.ArrayList
  foreach ($group in $groups) {
    $ordered = @($group.Group | Sort-Object x)
    if ($ordered.Count -lt 3 -or -not $ordered[0].name) { continue }
    $null = $rows.Add([pscustomobject]@{
      y=[int]$ordered[0].y; certificate=[string]$ordered[0].name
      certificateCell=$ordered[0]; dataCell=$ordered[1]; targetCell=$ordered[2]
    })
  }
  @($rows)
}

function Invoke-SSEVaStOcr($Dialog) {
  $token = [Guid]::NewGuid().ToString('N')
  $shotPath = Join-Path $env:TEMP "sse-vast-$token.png"
  $scaledPath = Join-Path $env:TEMP "sse-vast-$token-scaled.png"
  $img = $null; $scaled = $null; $graphics = $null; $ocr = $null; $processingError = $null
  try {
    $null = Take-Shot ([IntPtr][int64]$Dialog.hwnd) $shotPath
    $img = [Drawing.Image]::FromFile($shotPath)
    $scale = 2
    $scaled = New-Object Drawing.Bitmap ($img.Width * $scale), ($img.Height * $scale)
    $graphics = [Drawing.Graphics]::FromImage($scaled)
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($img, 0, 0, $scaled.Width, $scaled.Height)
    $scaled.Save($scaledPath, [Drawing.Imaging.ImageFormat]::Png)
    $ocr = Invoke-WindowsOcr $scaledPath
  } catch { $processingError = $_.Exception.Message }
  finally {
    if ($graphics) { $graphics.Dispose() }
    if ($scaled) { $scaled.Dispose() }
    if ($img) { $img.Dispose() }
    $shotCleanup = Remove-SSETemporaryFile $shotPath
    $scaledCleanup = Remove-SSETemporaryFile $scaledPath
  }
  if (-not $shotCleanup.removed -or -not $scaledCleanup.removed) {
    Fail "VaSt-OCR-Bilder konnten nicht vollstaendig geloescht werden." 'temp-cleanup'
  }
  if ($processingError) { Fail "VaSt-Dialog konnte nicht gelesen werden: $processingError" 'dialog-unreadable' }
  if (-not $ocr -or -not $ocr.ok) {
    $message = $(if ($ocr -and $ocr.error) { $ocr.error } else { 'OCR lieferte kein Ergebnis.' })
    Fail "VaSt-Dialog blieb an den von Qt nicht exponierten Zelltexten unlesbar: $message" 'dialog-unreadable'
  }
  [pscustomobject]@{ scale=2; language=$ocr.language; lines=@($ocr.lines); text=[string]$ocr.text; lineCount=[int]$ocr.lineCount }
}

function Invoke-SSEVaStVisibleScreenOcr($Dialog) {
  $targetPid = 0
  [SW]::GetWindowThreadProcessId([IntPtr][int64]$Dialog.hwnd, [ref]$targetPid) | Out-Null
  foreach ($relative in @(
    [pscustomobject]@{ x=.20; y=.25 }, [pscustomobject]@{ x=.50; y=.50 },
    [pscustomobject]@{ x=.80; y=.25 }, [pscustomobject]@{ x=.20; y=.80 },
    [pscustomobject]@{ x=.80; y=.80 }
  )) {
    $point = New-Object SW+PT
    $point.X = [int]($Dialog.x + $Dialog.w * $relative.x)
    $point.Y = [int]($Dialog.y + $Dialog.h * $relative.y)
    $hit = [SW]::WindowFromPoint($point)
    $hitPid = 0; [SW]::GetWindowThreadProcessId($hit, [ref]$hitPid) | Out-Null
    if ($hitPid -ne $targetPid) { Fail 'VaSt-Dialog ist fuer den sichtbaren Dropdown-Screenshot teilweise verdeckt.' 'obstructed' }
  }
  $token = [Guid]::NewGuid().ToString('N')
  $path = Join-Path $env:TEMP "sse-vast-visible-$token.png"
  $scaledPath = Join-Path $env:TEMP "sse-vast-visible-$token-scaled.png"
  $bmp = $null; $graphics = $null; $scaled = $null; $scaledGraphics = $null; $ocr = $null; $processingError = $null
  try {
    $bmp = New-Object Drawing.Bitmap ([int]$Dialog.w), ([int]$Dialog.h)
    $graphics = [Drawing.Graphics]::FromImage($bmp)
    $graphics.CopyFromScreen([int]$Dialog.x, [int]$Dialog.y, 0, 0, $bmp.Size)
    $scale = 2
    $scaled = New-Object Drawing.Bitmap ($bmp.Width * $scale), ($bmp.Height * $scale)
    $scaledGraphics = [Drawing.Graphics]::FromImage($scaled)
    $scaledGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $scaledGraphics.DrawImage($bmp, 0, 0, $scaled.Width, $scaled.Height)
    $scaled.Save($scaledPath, [Drawing.Imaging.ImageFormat]::Png)
    $ocr = Invoke-WindowsOcr $scaledPath
  } catch { $processingError = $_.Exception.Message }
  finally {
    if ($scaledGraphics) { $scaledGraphics.Dispose() }
    if ($scaled) { $scaled.Dispose() }
    if ($graphics) { $graphics.Dispose() }
    if ($bmp) { $bmp.Dispose() }
    $cleanup = Remove-SSETemporaryFile $path
    $scaledCleanup = Remove-SSETemporaryFile $scaledPath
  }
  if (-not $cleanup.removed -or -not $scaledCleanup.removed) { Fail 'Sichtbare VaSt-OCR-Bilder konnten nicht geloescht werden.' 'temp-cleanup' }
  if ($processingError) { Fail "Sichtbarer VaSt-Dropdown konnte nicht fotografiert werden: $processingError" 'dialog-unreadable' }
  if (-not $ocr -or -not $ocr.ok) { Fail 'Sichtbarer VaSt-Dropdown blieb per OCR unlesbar.' 'dialog-unreadable' }
  [pscustomobject]@{ scale=2; language=$ocr.language; lines=@($ocr.lines); text=[string]$ocr.text; lineCount=[int]$ocr.lineCount }
}

function Get-SSEVaStOcrTextForCell($Ocr, $Dialog, $Cell) {
  $scale = [double]$Ocr.scale
  $left = ([double]$Cell.x - [double]$Dialog.x) * $scale
  $top = ([double]$Cell.y - [double]$Dialog.y) * $scale
  $right = $left + ([double]$Cell.w * $scale)
  $bottom = $top + ([double]$Cell.h * $scale)
  $matches = @($Ocr.lines | Where-Object {
    $null -ne $_.x -and $null -ne $_.y -and $_.text -and
    ([double]$_.x + ([double]$_.w / 2)) -ge $left -and
    ([double]$_.x + ([double]$_.w / 2)) -le $right -and
    ([double]$_.y + ([double]$_.h / 2)) -ge $top -and
    ([double]$_.y + ([double]$_.h / 2)) -le $bottom
  } | Sort-Object y, x)
  ((@($matches | ForEach-Object { $_.text }) -join ' ') -replace '\s+', ' ').Trim()
}

function Get-SSEVaStOcrRows($Ocr, $Dialog) {
  $scale = [double]$Ocr.scale
  $lines = @($Ocr.lines | Where-Object { $_.text -and $null -ne $_.x -and $null -ne $_.y })
  $rightHeader = @($lines | Where-Object { $_.text -eq 'Eingabefenster / Daten' } | Sort-Object y | Select-Object -First 1)
  if (-not $rightHeader.Count) { Fail 'VaSt-Tabellenkopf ist per OCR nicht eindeutig lesbar.' 'dialog-unreadable' }
  $header = $rightHeader[0]
  $headerCenterY = [double]$header.y + ([double]$header.h / 2)
  $rightStart = [double]$header.x - (18 * $scale)
  $rowTargets = @($lines | Where-Object {
    ([double]$_.y + ([double]$_.h / 2)) -gt ($headerCenterY + 10 * $scale) -and
    ([double]$_.x) -ge $rightStart -and
    ([double]$_.x) -le ([double]$header.x + 90 * $scale) -and
    ([double]$_.y + ([double]$_.h / 2)) -lt (($Dialog.h - 70) * $scale)
  } | Sort-Object y, x)
  $rows = New-Object System.Collections.ArrayList
  foreach ($target in $rowTargets) {
    $targetCenter = [double]$target.y + ([double]$target.h / 2)
    $left = @($lines | Where-Object {
      ([double]$_.x) -lt ($rightStart - 20 * $scale) -and
      [Math]::Abs(([double]$_.y + ([double]$_.h / 2)) - $targetCenter) -le (7 * $scale) -and
      ([double]$_.y + ([double]$_.h / 2)) -gt ($headerCenterY + 10 * $scale)
    } | Sort-Object x | Select-Object -First 1)
    if (-not $left.Count) { continue }
    $leftLine = $left[0]
    $null = $rows.Add([pscustomobject]@{
      certificate=(($leftLine.text -replace '\s+', ' ').Trim())
      localTarget=(($target.text -replace '\s+', ' ').Trim())
      y=[int]([double]$Dialog.y + ($targetCenter / $scale))
      arrowX=[int]([double]$Dialog.x + [Math]::Max(18, ([double]$leftLine.x / $scale) - 18))
      sourceLine=$leftLine; targetLine=$target
    })
  }
  $ordered = @($rows | Sort-Object y)
  for ($i = 0; $i -lt $ordered.Count; $i++) {
    $top = ([double]$ordered[$i].sourceLine.y + [double]$ordered[$i].sourceLine.h) + (2 * $scale)
    $bottom = $(if ($i + 1 -lt $ordered.Count) {
      ([double]$ordered[$i + 1].sourceLine.y) - (2 * $scale)
    } else { ($Dialog.h - 80) * $scale })
    $detailLines = @($lines | Where-Object {
      ([double]$_.y + ([double]$_.h / 2)) -gt $top -and
      ([double]$_.y + ([double]$_.h / 2)) -lt $bottom -and
      ([double]$_.x) -lt $rightStart
    } | Sort-Object y, x | ForEach-Object { ($_.text -replace '\s+', ' ').Trim() })
    $ordered[$i] | Add-Member -NotePropertyName expanded -NotePropertyValue ([bool]$detailLines.Count) -Force
    $ordered[$i] | Add-Member -NotePropertyName detailLines -NotePropertyValue @($detailLines) -Force
  }
  @($ordered)
}

function Read-SSEVaStState($Dialog) {
  $ocr = Invoke-SSEVaStOcr $Dialog
  $ocrRows = @(Get-SSEVaStOcrRows $ocr $Dialog)
  if (-not $ocrRows.Count) { Fail 'VaSt-Zuordnungszeilen konnten auch per OCR nicht gelesen werden.' 'dialog-unreadable' }
  $occurrences = @{}
  $rows = New-Object System.Collections.ArrayList
  foreach ($row in $ocrRows) {
    if (-not $occurrences.ContainsKey($row.certificate)) { $occurrences[$row.certificate] = 0 }
    $occurrences[$row.certificate]++
    $null = $rows.Add([pscustomobject]@{
      certificate=$row.certificate; occurrence=[int]$occurrences[$row.certificate]
      localTarget=$row.localTarget; unresolved=[bool](-not $row.localTarget -or $row.localTarget -match '^Bitte\s+Ausw')
      expanded=[bool]$row.expanded; detailLines=@($row.detailLines)
      y=[int]$row.y; arrowX=[int]$row.arrowX
    })
  }
  $mappingBody = @($rows | ForEach-Object {
    "$($_.certificate)`0$($_.occurrence)`0$($_.localTarget)`0$($_.unresolved)"
  }) -join "`n"
  [pscustomobject]@{
    ocr=$ocr; rows=@($rows)
    mappingFingerprint=(Get-SSETextSha256 ($Dialog.title + "`0" + $mappingBody))
  }
}

function Get-SSELastInputTick {
  try {
    $info = New-Object SW+LASTINPUTINFO
    $info.cbSize = [uint32][Runtime.InteropServices.Marshal]::SizeOf($info)
    if (-not [SW]::GetLastInputInfo([ref]$info)) { return $null }
    [uint64]$info.dwTime
  } catch { $null }
}

function Test-SSELastInputUnchanged($ExpectedTick) {
  if ($null -eq $ExpectedTick) { return $false }
  $current = Get-SSELastInputTick
  [bool]($null -ne $current -and [uint64]$current -eq [uint64]$ExpectedTick)
}

function Test-SSEForegroundIsLockScreen {
  $foreground = [SW]::GetForegroundWindow()
  if ($foreground -eq [IntPtr]::Zero) { return $false }
  $foregroundRoot = [SW]::GetAncestor($foreground, 2) # GA_ROOT
  if ($foregroundRoot -eq [IntPtr]::Zero) { $foregroundRoot = $foreground }
  $foregroundPid = 0
  [SW]::GetWindowThreadProcessId($foregroundRoot, [ref]$foregroundPid) | Out-Null
  $processName = ''
  if ($foregroundPid -gt 0) {
    try { $processName = [string](Get-Process -Id $foregroundPid -ErrorAction Stop).ProcessName } catch { }
  }
  $className = Get-SSEWindowClassName $foregroundRoot
  [bool]($processName -eq 'LockApp' -or $className -match 'LockScreenBackstopFrame')
}

# Reine Messung. Der Phasenlog veraendert keine Vor-/Nachbedingung und wird
# nur additiv in die Antwort aufgenommen, damit eine Optimierung an gemessenen
# statt geratenen Kosten ansetzen kann.
function New-SSEPhaseLog {
  [pscustomobject]@{
    items = New-Object System.Collections.ArrayList
    watch = [Diagnostics.Stopwatch]::StartNew()
    total = [Diagnostics.Stopwatch]::StartNew()
  }
}
function Complete-SSEPhase($Log, [string]$Name) {
  if (-not $Log) { return }
  $null = $Log.items.Add([pscustomobject]@{ phase=$Name; ms=[int64]$Log.watch.ElapsedMilliseconds })
  $Log.watch.Restart()
}
function Get-SSEPhaseReport($Log) {
  if (-not $Log) { return $null }
  [pscustomobject]@{
    gesamtMs = [int64]$Log.total.ElapsedMilliseconds
    phasen = @($Log.items)
  }
}

function New-SSECommitResult([string]$Method, $InputBefore = $null, $InputAfter = $null, $Details = $null) {
  $guardStop = [bool](
    $Method -like 'interference-*' -or $Method -like 'epoch-*' -or
    $Method -in @('focus-mismatch','stale-window')
  )
  [pscustomobject]@{
    method=$Method
    inputBefore=$InputBefore
    inputAfter=$InputAfter
    interference=$guardStop
    inputInterference=[bool]($Method -like 'interference-*')
    details=$Details
  }
}

# Nur Fenster, die eine Feldtransaktion logisch blockieren koennen. Erwartete
# nicht-modale Tipps/Werte-Info, Qt-Schatten und winzige UAC-Overlays bleiben
# draussen. So erkennt ein neuer Dialog oder ein ausgetauschtes Hauptfenster
# eine Fremdinteraktion, ohne den normalen Qt-Fokus-Commit falsch zu stoppen.
function Get-SSEInteractionWindowSet([int]$ProcessId, [IntPtr]$MainHwnd) {
  $items = New-Object System.Collections.ArrayList
  foreach ($window in @(Get-Windows 'SSE' | Where-Object { [int]$_.pid -eq $ProcessId })) {
    $role = $null
    if ([int64]$window.hwnd -eq [int64]$MainHwnd) { $role = 'main' }
    elseif ($window.title -eq 'Steuer-Spar-Tipps' -or $window.title -like 'Werte-Info:*') { continue }
    elseif ($window.cls -match 'Shadow|PopupDropShadow') { continue }
    elseif ($window.cls -match '^UAC[ _]' -and $window.w -le 80 -and $window.h -le 80) { continue }
    else { $role = 'blocking-or-unknown' }
    $null = $items.Add([pscustomobject]@{
      role=$role; hwnd=[int64]$window.hwnd; cls=[string]$window.cls
      title=$(if ($role -eq 'main') { $null } else { [string]$window.title })
      x=[int]$window.x; y=[int]$window.y; w=[int]$window.w; h=[int]$window.h
    })
  }
  $stable = @($items | Sort-Object role, hwnd)
  [pscustomobject]@{
    fingerprint=Get-SSETextSha256 ($stable | ConvertTo-Json -Depth 4 -Compress)
    windows=$stable
  }
}

function Find-ExactAutomationElement([IntPtr]$Hwnd, [string]$RelativeAutomationId) {
  if (-not $RelativeAutomationId) { return $null }
  $root = $script:AE::FromHandle($Hwnd)
  $rootAid = [string]$root.Current.AutomationId
  $fullAid = $(if ($RelativeAutomationId.StartsWith($rootAid)) { $RelativeAutomationId } else { "$rootAid$RelativeAutomationId" })
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    $script:AE::AutomationIdProperty, $fullAid
  )
  try { $root.FindFirst($script:TS::Descendants, $condition) } catch { $null }
}

function Convert-ExactElementToNode($Element) {
  if (-not $Element) { return $null }
  try {
    $current = $Element.Current
    $rectangle = $current.BoundingRectangle
    $vp = $null; $value = $null; $readOnly = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
      $value = $vp.Current.Value
      $readOnly = [bool]$vp.Current.IsReadOnly
    }
    [pscustomobject]@{
      i=-1; p=-1; d=-1
      type=$current.ControlType.ProgrammaticName.Replace('ControlType.','')
      name=("$($current.Name)" -replace "`r|`n|`t", ' ').Trim()
      aid=[string]$current.AutomationId
      x=$(if ([double]::IsInfinity($rectangle.X)) { -1 } else { [int]$rectangle.X })
      y=$(if ([double]::IsInfinity($rectangle.Y)) { -1 } else { [int]$rectangle.Y })
      w=$(if ([double]::IsInfinity($rectangle.Width)) { 0 } else { [int]$rectangle.Width })
      h=$(if ([double]::IsInfinity($rectangle.Height)) { 0 } else { [int]$rectangle.Height })
      on=[bool]($current.IsEnabled -and -not $current.IsOffscreen)
      val=$value; ro=$readOnly
      rid=($Element.GetRuntimeId() -join '.')
      exact=$true
    }
  } catch { $null }
}

function Resolve-KnownFieldNode([IntPtr]$Hwnd, $Known) {
  Convert-ExactElementToNode (Find-ExactAutomationElement $Hwnd ([string]$Known.field.automationIdRelative))
}

function Get-KnownPageHeading([IntPtr]$Hwnd, $Known) {
  $node = Convert-ExactElementToNode (
    Find-ExactAutomationElement $Hwnd ([string]$Known.page.headingAutomationIdRelative)
  )
  if (-not $node -or -not $node.on) { return $null }
  [string]$node.name
}

function Test-KnownPageHeading([string]$Heading, $Page) {
  if (-not $Heading -or -not $Page) { return $false }
  if ($Heading -eq [string]$Page.heading) { return $true }
  $prefixProperty = $Page.PSObject.Properties['headingPrefix']
  if ($prefixProperty -and [string]$prefixProperty.Value) {
    return $Heading.StartsWith([string]$prefixProperty.Value, [StringComparison]::Ordinal)
  }
  $false
}

function Get-DirtyStateFast([IntPtr]$Hwnd) {
  $button = Find-ExactAutomationElement $Hwnd '.MainToolBar.tb_sichern'
  if (-not $button) { return $null }
  try { [bool]$button.Current.IsEnabled } catch { $null }
}

function Get-KnownPageState([IntPtr]$Hwnd, $Known) {
  $fields = New-Object System.Collections.ArrayList
  foreach ($property in @($Known.page.fields.PSObject.Properties)) {
    $fieldKnown = [pscustomobject]@{ page=$Known.page; field=$property.Value }
    $node = Resolve-KnownFieldNode $Hwnd $fieldKnown
    $null = $fields.Add([pscustomobject]@{
      fieldId=$property.Name
      label=[string]$property.Value.label
      present=[bool]($null -ne $node)
      value=$(if ($node) { [string]$node.val } else { $null })
      enabled=$(if ($node) { [bool]$node.on } else { $false })
      readOnly=$(if ($node) { $node.ro } else { $null })
      x=$(if ($node) { $node.x } else { -1 }); y=$(if ($node) { $node.y } else { -1 })
      w=$(if ($node) { $node.w } else { 0 }); h=$(if ($node) { $node.h } else { 0 })
    })
  }
  $heading = Get-KnownPageHeading $Hwnd $Known
  $dirty = Get-DirtyStateFast $Hwnd
  $epochBody = [pscustomobject]@{
    hwnd=[int64]$Hwnd; heading=$heading; dirty=$dirty
    fields=@($fields | ForEach-Object {
      [pscustomobject]@{ id=$_.fieldId; value=$_.value; enabled=$_.enabled; readOnly=$_.readOnly; x=$_.x; y=$_.y; w=$_.w; h=$_.h }
    })
  }
  [pscustomobject]@{
    pageId=$Known.pageId; heading=$heading; dirty=$dirty; fields=@($fields)
    epoch=Get-SSETextSha256 ($epochBody | ConvertTo-Json -Depth 8 -Compress)
  }
}

function Get-CurrentHeading([IntPtr]$Hwnd, $Tree = $null) {
  if ($null -eq $Tree) { $Tree = Walk-Tree $Hwnd 1200 25 12 -WithValues }
  $bounds = Get-ContentBounds $Tree $Hwnd
  $rect = New-Object SW+RC
  [SW]::GetWindowRect($Hwnd, [ref]$rect) | Out-Null
  ($Tree.nodes | Where-Object {
    $_.type -eq 'Text' -and $_.name -and
    $_.x -ge $bounds.minX -and $_.x -le $bounds.maxX -and
    $_.y -ge ($rect.T + 190) -and $_.y -le ($rect.T + 290)
  } | Sort-Object y | Select-Object -First 1).name
}

function Read-LabeledValueFromTree($Tree, [IntPtr]$Hwnd, [string]$Label, [int]$Occurrence = 1) {
  $bounds = Get-ContentBounds $Tree $Hwnd
  Select-SSESummaryFromNodes $Tree.nodes $bounds $Label $Occurrence
}

function Get-SSETableRegion($Tree, [IntPtr]$Hwnd, $TargetSumRead) {
  $bounds = Get-ContentBounds $Tree $Hwnd
  Get-SSETableRegionFromNodes $Tree.nodes $bounds $TargetSumRead
}

function Resolve-SSETableProfile([string]$Page, [string]$SumLabel, [int]$SumOccurrence, $Region) {
  $catalog = Get-SSEPageObjects
  $matches = New-Object System.Collections.ArrayList
  foreach ($pageProperty in @($catalog.pages.PSObject.Properties)) {
    $pageObject = $pageProperty.Value
    if ([string]$pageObject.heading -ne $Page -or -not $pageObject.tables) { continue }
    foreach ($tableProperty in @($pageObject.tables.PSObject.Properties)) {
      $tableObject = $tableProperty.Value
      if ([string]$tableObject.sumLabel -ne $SumLabel -or [int]$tableObject.sumOccurrence -ne $SumOccurrence) { continue }
      $columns = @($tableObject.columns)
      if (-not $columns.Count -or @($columns | Where-Object {
        [int]$_.index -lt 0 -or -not [string]$_.header -or
        [string]$_.controlType -ne 'ComboBox' -or [string]$_.valueKind -ne 'enum' -or
        [string]$_.writePolicy -notin @('unsupported-fail-closed','typed-selection-required') -or -not [string]$_.reason -or
        ($_.PSObject.Properties['emptyRowDefault'] -and (
          -not [string]$_.emptyRowDefault -or [string]$_.writePolicy -ne 'typed-selection-required'
        )) -or
        ([string]$_.writePolicy -eq 'typed-selection-required' -and (
          [string]$_.openPattern -notin @('Invoke','InvokeThenVerifiedPointVisibleDesktop') -or [string]$_.optionControlType -ne 'ListItem' -or
          [string]$_.optionSelectPattern -ne 'SelectionItem' -or
          'SelectionItem.IsSelected' -notin @($_.readback) -or 'ValuePattern.Value' -notin @($_.readback) -or
          'checker-diff' -notin @($_.readback)
        ))
      }).Count) {
        Fail "Tabellenprofil '$($pageProperty.Name)/$($tableProperty.Name)' ist unvollstaendig oder nicht fail-closed." 'invalid-catalog'
      }
      $duplicateColumns = @($columns | Group-Object { [int]$_.index } | Where-Object { $_.Count -ne 1 })
      if ($duplicateColumns.Count) {
        Fail "Tabellenprofil '$($pageProperty.Name)/$($tableProperty.Name)' definiert Spalten mehrfach." 'invalid-catalog'
      }
      $null = $matches.Add([pscustomobject]@{
        pageId=[string]$pageProperty.Name; tableId=[string]$tableProperty.Name
        table=$tableObject; columns=$columns
      })
    }
  }
  if (-not $matches.Count) {
    return [pscustomobject]@{ known=$false; bindingOk=$true; columns=@() }
  }
  if ($matches.Count -ne 1) {
    Fail "Mehrere Tabellenprofile passen zu Seite '$Page', Summe '$SumLabel', Vorkommen $SumOccurrence." 'invalid-catalog'
  }

  $match = $matches[0]
  $section = [string]$match.table.automationIdSection
  $scopePrefix = [string]$Region.scopePrefix
  $aidBound = $false
  $aidFallback = $false
  if ($section) {
    if ($scopePrefix) {
      $expectedScopeSuffix = "/.$section./.$section."
      if (-not $scopePrefix.EndsWith($expectedScopeSuffix, [StringComparison]::Ordinal)) {
        return [pscustomobject]@{
          known=$true; bindingOk=$false; pageId=$match.pageId; tableId=$match.tableId
          columns=$match.columns; automationIdSection=$section; observedScopePrefix=$scopePrefix
          reason="Die sichtbare Tabellenregion gehoert nicht zum profilierten Automation-ID-Abschnitt '$section'."
        }
      }
      $aidBound = $true
    } else {
      # Manche Qt-/UIA-Snapshots liefern fuer die Summenregion keine Automation-ID.
      # Dann bleibt die deklarierte Mindestbindung Seite + Summenlabel + Vorkommen
      # + Spaltenindex erhalten und semantische Selektoren bleiben fail-closed.
      $aidFallback = $true
    }
  }
  [pscustomobject]@{
    known=$true; bindingOk=$true; pageId=$match.pageId; tableId=$match.tableId
    profileSumLabel=[string]$match.table.sumLabel; profileSumOccurrence=[int]$match.table.sumOccurrence
    columns=$match.columns; automationIdSection=$section; observedScopePrefix=$scopePrefix
    aidBound=$aidBound; aidFallback=$aidFallback
    bindingStrength=$(if ($aidBound) {
      'page+sumLabel+sumOccurrence+automationIdSection+column'
    } else {
      'page+sumLabel+sumOccurrence+column'
    })
  }
}

function Get-SSETableProfileColumn($TableProfile, [int]$ColumnIndex) {
  if (-not $TableProfile -or -not $TableProfile.known) { return $null }
  @($TableProfile.columns | Where-Object { [int]$_.index -eq $ColumnIndex } | Select-Object -First 1)[0]
}

function Get-SSETableComboCellValue($Element, $Cell) {
  $value = $null
  try {
    $pattern = $null
    if ($Element -and $Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
      $value = [string]$pattern.Current.Value
    }
    if ($null -eq $value -or $value -eq '') { $value = [string]$Element.Current.Name }
  } catch { }
  if (($null -eq $value -or $value -eq '') -and $Cell) { $value = [string]$Cell.name }
  [string]$value
}

function Get-SSETableComboPopupSources([int]$ProcessId, [IntPtr]$MainHwnd, [int64[]]$WindowIdsBefore) {
  $sources = New-Object System.Collections.ArrayList
  try {
    $mainTree = Walk-Tree $MainHwnd 2400 25 18 -WithValues
    $null = $sources.Add([pscustomobject]@{
      hwnd=[int64]$MainHwnd; isMain=$true; isNewPopup=$false; window=$null; tree=$mainTree
    })
  } catch { }
  foreach ($window in @(Get-Windows 'SSE' | Where-Object {
    [int]$_.pid -eq $ProcessId -and [int64]$_.hwnd -ne [int64]$MainHwnd -and
    [int64]$_.hwnd -notin @($WindowIdsBefore)
  })) {
    try {
      $tree = Walk-Tree ([IntPtr][int64]$window.hwnd) 1200 15 14 -WithValues
      $null = $sources.Add([pscustomobject]@{
        hwnd=[int64]$window.hwnd; isMain=$false; isNewPopup=$true; window=$window; tree=$tree
      })
    } catch { }
  }
  @($sources)
}

function Read-SSETableComboCellState(
  [IntPtr]$Hwnd, [string]$ExpectedPage, [string]$SumLabel, [int]$SumOccurrence,
  [int]$RowY, [int]$ColumnIndex, $TableProfile
) {
  try {
    $tree = Walk-Tree $Hwnd 4000 45 18 -WithValues
    $heading = Get-CurrentHeading $Hwnd $tree
    if ($heading -ne $ExpectedPage) {
      return [pscustomobject]@{ ok=$false; interference=$true; error="Seite ist '$heading' statt '$ExpectedPage'."; tree=$tree }
    }
    $sumRead = Read-LabeledValueFromTree $tree $Hwnd $SumLabel $SumOccurrence
    if (-not $sumRead.selected) {
      return [pscustomobject]@{ ok=$false; interference=$true; error='Gebundene Summenregion ist nicht mehr sichtbar.'; tree=$tree }
    }
    $region = Get-SSETableRegion $tree $Hwnd $sumRead
    if (-not $region.ok) {
      return [pscustomobject]@{ ok=$false; interference=$true; error="Tabellenregion ist nicht mehr gebunden: $($region.error)"; tree=$tree }
    }
    $section = [string]$TableProfile.automationIdSection
    if ($section -and $region.scopePrefix) {
      $expectedScopeSuffix = "/.$section./.$section."
      if (-not ([string]$region.scopePrefix).EndsWith($expectedScopeSuffix, [StringComparison]::Ordinal)) {
        return [pscustomobject]@{ ok=$false; interference=$true; error='Automation-ID-Tabellenbindung hat sich geaendert.'; tree=$tree }
      }
    }
    $rowCells = @($region.cells | Where-Object { [Math]::Abs([int]$_.y - $RowY) -le 4 } | Sort-Object x)
    if ($ColumnIndex -lt 0 -or $ColumnIndex -ge $rowCells.Count) {
      return [pscustomobject]@{ ok=$false; interference=$true; error='Gebundene Tabellenzeile oder Spalte ist nicht mehr sichtbar.'; tree=$tree }
    }
    $cell = $rowCells[$ColumnIndex]
    $element = Get-LiveElement $Hwnd $cell.rid $cell.aid
    if (-not $element) {
      return [pscustomobject]@{ ok=$false; interference=$true; error='Gebundene ComboBox-Zelle ist nicht mehr greifbar.'; tree=$tree }
    }
    [pscustomobject]@{
      ok=$true; interference=$false; tree=$tree; heading=$heading; sumRead=$sumRead; region=$region
      cell=$cell; nextCell=$(if (($ColumnIndex + 1) -lt $rowCells.Count) { $rowCells[$ColumnIndex + 1] } else { $null })
      element=$element; value=(Get-SSETableComboCellValue $element $cell)
      rowCellCount=$rowCells.Count
      ridMatchCount=@($tree.nodes | Where-Object { [string]$_.rid -ceq [string]$cell.rid }).Count
      checkerMessages=@(Get-SSEPageCheckerMessages $tree $Hwnd)
    }
  } catch {
    [pscustomobject]@{ ok=$false; interference=$true; error=$_.Exception.Message; tree=$null }
  }
}

function Invoke-SSETableComboSelection {
  param(
    [Parameter(Mandatory)][IntPtr]$Hwnd,
    [Parameter(Mandatory)][int]$ProcessId,
    [Parameter(Mandatory)][string]$ExpectedPage,
    [Parameter(Mandatory)][string]$SumLabel,
    [Parameter(Mandatory)][int]$SumOccurrence,
    [Parameter(Mandatory)][int]$RowY,
    [Parameter(Mandatory)][int]$ColumnIndex,
    [Parameter(Mandatory)]$TableProfile,
    [Parameter(Mandatory)]$ColumnProfile,
    [Parameter(Mandatory)][AllowEmptyString()][string]$ExpectedCurrent,
    [Parameter(Mandatory)][string]$Wanted,
    [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$CheckerMessagesBefore,
    $InputBaseline = $null,
    [bool]$GuardUserInput = $true,
    [switch]$Rollback
  )

  $stateBefore = Read-SSETableComboCellState $Hwnd $ExpectedPage $SumLabel $SumOccurrence $RowY $ColumnIndex $TableProfile
  if (-not $stateBefore.ok) {
    return [pscustomobject]@{ ok=$false; interference=[bool]$stateBefore.interference; mutationStarted=$false; error=$stateBefore.error }
  }
  if (-not [string]::Equals([string]$stateBefore.value, $ExpectedCurrent, [StringComparison]::Ordinal)) {
    return [pscustomobject]@{
      ok=$false; interference=$true; mutationStarted=$false
      error="ComboBox-Vorwert ist '$($stateBefore.value)' statt '$ExpectedCurrent'."
      before=$stateBefore.value
    }
  }
  if ([string]$ColumnProfile.writePolicy -ne 'typed-selection-required' -or
      [string]$ColumnProfile.openPattern -notin @('Invoke','InvokeThenVerifiedPointVisibleDesktop') -or
      [string]$ColumnProfile.optionSelectPattern -ne 'SelectionItem' -or
      [int]$ColumnProfile.index -ne $ColumnIndex -or
      [string]$TableProfile.profileSumLabel -cne $SumLabel -or
      [int]$TableProfile.profileSumOccurrence -ne $SumOccurrence) {
    return [pscustomobject]@{ ok=$false; interference=$false; mutationStarted=$false; error='Produktprofil erlaubt keine typisierte Auswahl fuer diese Spalte.' }
  }
  if ([string]::Equals($Wanted, $ExpectedCurrent, [StringComparison]::Ordinal)) {
    $noopBinding = Test-SSETableComboOpenFallbackBinding `
      $stateBefore $stateBefore $TableProfile $ExpectedCurrent $ColumnIndex $SumOccurrence
    if (-not $noopBinding.ok) {
      return [pscustomobject]@{
        ok=$false; kind='profile-binding-mismatch'; interference=$true; mutationStarted=$false
        error='ComboBox-No-op ist nicht mehr vollstaendig an Profil, Seite, Summe, Zeile und Spalte gebunden.'
        before=$ExpectedCurrent; requested=$Wanted; after=[string]$stateBefore.value
        openEvidence=[pscustomobject]@{ noop=$true; binding=$noopBinding }
        inputBaselineAfter=$InputBaseline
      }
    }
    return [pscustomobject]@{
      ok=$true; kind='ok'; interference=$false; mutationStarted=$false
      before=$ExpectedCurrent; requested=$Wanted; after=[string]$stateBefore.value
      method='noop-already-target'; internalSelected=$null; editorClosed=$true
      popupBinding=[pscustomobject]@{ kind='not-opened'; reason='Exakter Live-Wert entspricht bereits dem angeforderten und erwarteten Wert.' }
      openEvidence=[pscustomobject]@{ noop=$true; binding=$noopBinding.evidence; invokeAttempted=$false; clickAttempted=$false }
      inputBaselineAfter=$InputBaseline
      checkerMessagesAfter=$stateBefore.checkerMessages; newCheckerMessages=@()
    }
  }
  $guardUserInput = [bool]$GuardUserInput
  if ($guardUserInput -and ($null -eq $InputBaseline -or -not (Test-SSELastInputUnchanged $InputBaseline))) {
    return [pscustomobject]@{ ok=$false; interference=$true; mutationStarted=$false; error='Benutzereingabe vor dem Oeffnen der Tabellen-ComboBox erkannt.' }
  }
  $interactionBefore = Get-SSEInteractionWindowSet $ProcessId $Hwnd
  $windowIdsBefore = @((Get-Windows 'SSE' | Where-Object { [int]$_.pid -eq $ProcessId }) | ForEach-Object { [int64]$_.hwnd })
  $openMethod = 'invoke'
  $openEvidence = [ordered]@{ invokeAttempted=$true; invokeSucceeded=$false; verifiedPointAttempted=$false }
  $invoke = $null
  if (-not $stateBefore.element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
    return [pscustomobject]@{ ok=$false; interference=$false; mutationStarted=$false; error='Profilierte DataItem-Zelle bietet kein InvokePattern.' }
  }
  try { $invoke.Invoke(); $openEvidence['invokeSucceeded']=$true }
  catch { $openEvidence['invokeError']=$_.Exception.Message }
  if ($openEvidence['invokeSucceeded']) { Start-Sleep -Milliseconds 350 }
  if ($guardUserInput -and -not (Test-SSELastInputUnchanged $InputBaseline)) {
    return [pscustomobject]@{ ok=$false; interference=$true; mutationStarted=$false; error='Benutzereingabe beim Oeffnen der Tabellen-ComboBox erkannt.' }
  }
  if ((Get-CurrentHeading $Hwnd) -ne $ExpectedPage) {
    return [pscustomobject]@{ ok=$false; interference=$true; mutationStarted=$false; error='Seite wechselte beim Oeffnen der Tabellen-ComboBox.' }
  }

  $sources = @(Get-SSETableComboPopupSources $ProcessId $Hwnd $windowIdsBefore)
  $popup = Resolve-SSETableComboPopup $sources $stateBefore.cell $Wanted $ExpectedCurrent $TableProfile
  $openEvidence['invokePopupKind'] = [string]$popup.kind
  $openEvidence['invokePopupCandidateCount'] = @($popup.candidates).Count
  if (-not $popup.ok -and [string]$ColumnProfile.openPattern -eq 'InvokeThenVerifiedPointVisibleDesktop') {
    if ($script:DESKTOP_NAME) {
      return [pscustomobject]@{
        ok=$false; interference=$false; mutationStarted=$false; error='Verifizierter Tabellen-ComboBox-Klick ist nur auf dem sichtbaren Desktop erlaubt.'
        popupBinding=$popup; openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
      }
    }
    if (-not $guardUserInput -or $null -eq $InputBaseline) {
      return [pscustomobject]@{
        ok=$false; interference=$false; mutationStarted=$false; error='Verifizierter Tabellen-ComboBox-Klick erfordert eine lesbare Benutzereingabe-Epoche.'
        popupBinding=$popup; openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
      }
    }
    $openEvidence['verifiedPointAttempted']=$true
    $currentInteraction = Get-SSEInteractionWindowSet $ProcessId $Hwnd
    if ($currentInteraction.fingerprint -ne $interactionBefore.fingerprint) {
      return [pscustomobject]@{
        ok=$false; interference=$true; mutationStarted=$false; error='SSE-Fensterlage wechselte vor dem verifizierten Tabellen-ComboBox-Klick.'
        popupBinding=$popup; openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
      }
    }
    $boundPid = 0
    [SW]::GetWindowThreadProcessId($Hwnd, [ref]$boundPid) | Out-Null
    if ($boundPid -ne $ProcessId) {
      return [pscustomobject]@{
        ok=$false; interference=$true; mutationStarted=$false; error='Gebundenes Hauptfenster gehoert nicht mehr zur erwarteten SSE-Prozess-ID.'
        popupBinding=$popup; openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
      }
    }
    $null = Show-SSEWindow $Hwnd
    Start-Sleep -Milliseconds 100
    if ([SW]::GetForegroundWindow() -ne $Hwnd -or
        ($guardUserInput -and -not (Test-SSELastInputUnchanged $InputBaseline))) {
      Hide-SSETopmost $Hwnd
      return [pscustomobject]@{
        ok=$false; interference=$true; mutationStarted=$false; error='Vordergrund- oder Benutzereingabe-Interferenz vor dem verifizierten Tabellen-ComboBox-Klick.'
        popupBinding=$popup; openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
      }
    }
    $clickState = Read-SSETableComboCellState $Hwnd $ExpectedPage $SumLabel $SumOccurrence $RowY $ColumnIndex $TableProfile
    $clickBinding = Test-SSETableComboOpenFallbackBinding $stateBefore $clickState $TableProfile $ExpectedCurrent $ColumnIndex $SumOccurrence
    if (-not $clickBinding.ok) {
      $initialElementAfterInvoke = Get-LiveElement $Hwnd $stateBefore.cell.rid $stateBefore.cell.aid
      $freshElementAfterInvoke = $(if ($clickState.ok) {
        Get-LiveElement $Hwnd $clickState.cell.rid $clickState.cell.aid
      } else { $null })
      $openEvidence['clickBinding'] = $clickBinding
      $openEvidence['postInvokeIdentity'] = [pscustomobject]@{
        initialRidResolvable=[bool]$initialElementAfterInvoke
        freshRidResolvable=[bool]$freshElementAfterInvoke
        initialRid=[string]$stateBefore.cell.rid; freshRid=[string]$clickState.cell.rid
        initialAid=[string]$stateBefore.cell.aid; freshAid=[string]$clickState.cell.aid
        expectedPid=$ProcessId; observedPid=$boundPid; foregroundHwnd=[int64][SW]::GetForegroundWindow()
        hwnd=[int64]$Hwnd; windowFingerprintUnchanged=[bool]($currentInteraction.fingerprint -eq $interactionBefore.fingerprint)
        inputEpochUnchanged=[bool](-not $guardUserInput -or (Test-SSELastInputUnchanged $InputBaseline))
        pageUnchanged=[bool]($clickState.ok -and [string]$clickState.heading -ceq $ExpectedPage)
      }
      Hide-SSETopmost $Hwnd
      return [pscustomobject]@{
        ok=$false; interference=$true; mutationStarted=$false; error='Vollstaendige Tabellen-ComboBox-Bindung wechselte unmittelbar vor dem verifizierten Klick.'
        popupBinding=$popup; clickBinding=$clickBinding; openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
      }
    }
    $clickNode = [pscustomobject]@{
      x=[int]$clickState.cell.x; y=[int]$clickState.cell.y; w=[int]$clickState.cell.w; h=[int]$clickState.cell.h
      name=[string]$clickState.cell.name; rid=[string]$clickState.cell.rid; aid=[string]$clickState.cell.aid
      source='profile-bound-table-combobox'
    }
    $clickX = [int]($clickNode.x + $clickNode.w / 2); $clickY = [int]($clickNode.y + $clickNode.h / 2)
    $obstruction = Get-SSEPointObstruction $Hwnd $clickX $clickY
    if (-not $obstruction.isBoundTarget -or [int]$obstruction.boundPid -ne $ProcessId) {
      Hide-SSETopmost $Hwnd
      return [pscustomobject]@{
        ok=$false; interference=$true; mutationStarted=$false; error='Zellmittelpunkt ist nicht mehr an Root und PID des SSE-Hauptfensters gebunden.'
        popupBinding=$popup; clickBinding=$clickBinding; obstruction=$obstruction
        openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
      }
    }
    $clickResult = Click-VerifiedPoint -Window $Hwnd -Node $clickNode `
      -ExpectedInputTick $(if ($guardUserInput) { $InputBaseline } else { $null }) -RequireForeground
    if ($guardUserInput) {
      $InputBaseline = Get-SSELastInputTick
      if ($null -eq $InputBaseline) {
        return [pscustomobject]@{ ok=$false; interference=$true; mutationStarted=$false; error='Windows-Eingabe-Epoche ist nach dem verifizierten Klick nicht lesbar.' }
      }
    }
    Start-Sleep -Milliseconds 350
    if (($guardUserInput -and -not (Test-SSELastInputUnchanged $InputBaseline)) -or
        [SW]::GetForegroundWindow() -ne $Hwnd -or (Get-CurrentHeading $Hwnd) -ne $ExpectedPage) {
      return [pscustomobject]@{
        ok=$false; interference=$true; mutationStarted=$false; error='Eingabe-, Vordergrund- oder Seiteninterferenz nach dem verifizierten Tabellen-ComboBox-Klick.'
        popupBinding=$popup; clickBinding=$clickBinding; openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
      }
    }
    $openMethod = 'invoke+verified-cell-point'
    $openEvidence['verifiedPoint']=[pscustomobject]@{
      x=$clickResult.x; y=$clickResult.y; hwnd=[int64]$Hwnd; pid=$ProcessId
      binding=$clickBinding.evidence; obstruction=$obstruction
    }
    $sources = @(Get-SSETableComboPopupSources $ProcessId $Hwnd $windowIdsBefore)
    $popup = Resolve-SSETableComboPopup $sources $clickState.cell $Wanted $ExpectedCurrent $TableProfile
    $openEvidence['verifiedPointPopupKind']=[string]$popup.kind
    $openEvidence['verifiedPointPopupCandidateCount']=@($popup.candidates).Count
    if (-not $popup.ok -and @($popup.candidates).Count -eq 0) {
      $arrowInteraction = Get-SSEInteractionWindowSet $ProcessId $Hwnd
      if ($arrowInteraction.fingerprint -ne $interactionBefore.fingerprint -or
          ($guardUserInput -and -not (Test-SSELastInputUnchanged $InputBaseline)) -or
          [SW]::GetForegroundWindow() -ne $Hwnd -or (Get-CurrentHeading $Hwnd) -ne $ExpectedPage) {
        return [pscustomobject]@{
          ok=$false; interference=$true; mutationStarted=$false
          error='Eingabe-, Fenster-, Vordergrund- oder Seiteninterferenz vor dem gebundenen Drop-Arrow-Klick.'
          popupBinding=$popup; openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
        }
      }
      $arrowState = Read-SSETableComboCellState $Hwnd $ExpectedPage $SumLabel $SumOccurrence $RowY $ColumnIndex $TableProfile
      $arrowBinding = Test-SSETableComboOpenFallbackBinding $clickState $arrowState $TableProfile $ExpectedCurrent $ColumnIndex $SumOccurrence
      if (-not $arrowBinding.ok) {
        $openEvidence['dropArrowBinding']=$arrowBinding
        return [pscustomobject]@{
          ok=$false; interference=$true; mutationStarted=$false
          error='Tabellen-ComboBox-Zelle wechselte zwischen Aktivierung und Drop-Arrow-Klick.'
          popupBinding=$popup; openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
        }
      }
      $arrowPoint = Get-SSETableComboDropArrowPoint $arrowState.cell $arrowState.nextCell
      if (-not $arrowPoint.ok) {
        $openEvidence['dropArrowPoint']=$arrowPoint
        return [pscustomobject]@{
          ok=$false; interference=$false; mutationStarted=$false
          error='Profilierter Drop-Arrow-Hotspot liegt nicht eindeutig innerhalb der gebundenen Tabellenzelle.'
          popupBinding=$popup; openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
        }
      }
      $arrowObstruction = Get-SSEPointObstruction $Hwnd $arrowPoint.x $arrowPoint.y
      if (-not $arrowObstruction.isBoundTarget -or [int]$arrowObstruction.boundPid -ne $ProcessId) {
        $openEvidence['dropArrowObstruction']=$arrowObstruction
        return [pscustomobject]@{
          ok=$false; interference=$true; mutationStarted=$false
          error='Drop-Arrow-Hotspot ist nicht mehr an Root und PID des SSE-Hauptfensters gebunden.'
          popupBinding=$popup; openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
        }
      }
      $arrowNode = [pscustomobject]@{
        x=$arrowPoint.node.x; y=$arrowPoint.node.y; w=$arrowPoint.node.w; h=$arrowPoint.node.h
        name=[string]$arrowState.cell.name; rid=[string]$arrowState.cell.rid; aid=[string]$arrowState.cell.aid
        source=[string]$arrowPoint.node.source
      }
      $arrowClick = Click-VerifiedPoint -Window $Hwnd -Node $arrowNode `
        -ExpectedInputTick $InputBaseline -RequireForeground
      $InputBaseline = Get-SSELastInputTick
      if ($null -eq $InputBaseline) {
        return [pscustomobject]@{ ok=$false; interference=$true; mutationStarted=$false; error='Windows-Eingabe-Epoche ist nach dem Drop-Arrow-Klick nicht lesbar.' }
      }
      Start-Sleep -Milliseconds 350
      if (-not (Test-SSELastInputUnchanged $InputBaseline) -or (Get-CurrentHeading $Hwnd) -ne $ExpectedPage) {
        return [pscustomobject]@{
          ok=$false; interference=$true; mutationStarted=$false
          error='Eingabe- oder Seiteninterferenz nach dem gebundenen Drop-Arrow-Klick.'
          popupBinding=$popup; openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
        }
      }
      $openMethod = 'invoke+verified-cell-point+verified-drop-arrow-point'
      $openEvidence['dropArrowPoint']=[pscustomobject]@{
        x=$arrowClick.x; y=$arrowClick.y; inset=$arrowPoint.inset
        cellRight=$arrowPoint.cellRight; nextColumnX=$arrowPoint.nextColumnX
        hwnd=[int64]$Hwnd; pid=$ProcessId; binding=$arrowBinding.evidence; obstruction=$arrowObstruction
      }
      $sources = @(Get-SSETableComboPopupSources $ProcessId $Hwnd $windowIdsBefore)
      $popup = Resolve-SSETableComboPopup $sources $arrowState.cell $Wanted $ExpectedCurrent $TableProfile
      $openEvidence['dropArrowPopupKind']=[string]$popup.kind
      $openEvidence['dropArrowPopupCandidateCount']=@($popup.candidates).Count
    }
  }
  if (-not $popup.ok) {
    $unchangedState = Read-SSETableComboCellState $Hwnd $ExpectedPage $SumLabel $SumOccurrence $RowY $ColumnIndex $TableProfile
    $unchangedReference = $(if ($arrowState) { $arrowState } elseif ($clickState) { $clickState } else { $stateBefore })
    $unchangedBinding = Test-SSETableComboOpenFallbackBinding $unchangedReference $unchangedState $TableProfile $ExpectedCurrent $ColumnIndex $SumOccurrence
    $unchanged = [bool]($unchangedBinding.ok -and
      [string]::Equals([string]$unchangedState.value, $ExpectedCurrent, [StringComparison]::Ordinal))
    $openEvidence['noSelectionReadback']=[pscustomobject]@{
      valueUnchanged=[bool]([string]::Equals([string]$unchangedState.value, $ExpectedCurrent, [StringComparison]::Ordinal))
      bindingUnchanged=[bool]$unchangedBinding.ok; binding=$unchangedBinding
    }
    return [pscustomobject]@{
      ok=$false; interference=[bool](-not $unchanged); mutationStarted=$false
      error=$popup.error; popupBinding=$popup; editorClosed=$false; valueUnchanged=$unchanged
      method=$openMethod; openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
      rollback=[pscustomobject]@{ versucht=$false; erfolgreich=$unchanged; grund='Keine Option ausgewaehlt; Zellwert erneut gelesen.' }
    }
  }

  $targetElement = Get-LiveElement ([IntPtr][int64]$popup.sourceHwnd) $popup.target.rid $popup.target.aid
  $rollbackElement = Get-LiveElement ([IntPtr][int64]$popup.sourceHwnd) $popup.rollback.rid $popup.rollback.aid
  $selection = $null; $rollbackSelection = $null
  if (-not $targetElement -or -not $targetElement.Current.IsEnabled -or
      -not $targetElement.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection) -or
      -not $rollbackElement -or
      -not $rollbackElement.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$rollbackSelection)) {
    try { $invoke.Invoke(); Start-Sleep -Milliseconds 250 } catch { }
    return [pscustomobject]@{
      ok=$false; interference=$false; mutationStarted=$false
      error='Ziel- oder Ausgangsoption bietet kein rollbackfaehiges SelectionItemPattern.'; popupBinding=$popup.binding
      method=$openMethod; openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
    }
  }
  if ($guardUserInput -and -not (Test-SSELastInputUnchanged $InputBaseline)) {
    return [pscustomobject]@{
      ok=$false; interference=$true; mutationStarted=$false; error='Benutzereingabe unmittelbar vor der Optionsauswahl erkannt.'
      method=$openMethod; openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
    }
  }

  $mutationStarted = $true
  $internalSelected = $false
  $selectionError = $null
  try {
    $selection.Select()
    $internalSelected = [bool]$selection.Current.IsSelected
  } catch { $selectionError = $_.Exception.Message }
  Start-Sleep -Milliseconds 450
  $stateAfter = Read-SSETableComboCellState $Hwnd $ExpectedPage $SumLabel $SumOccurrence $RowY $ColumnIndex $TableProfile
  $interactionAfter = Get-SSEInteractionWindowSet $ProcessId $Hwnd
  $postSources = @(Get-SSETableComboPopupSources $ProcessId $Hwnd $windowIdsBefore)
  $postPopup = Resolve-SSETableComboPopup $postSources $stateBefore.cell $Wanted $ExpectedCurrent $TableProfile
  $boundListPresent = Test-SSETableComboBoundListPresent $postSources $popup
  $popupClosed = [bool](-not $boundListPresent)
  $afterValue = $(if ($stateAfter.ok) { [string]$stateAfter.value } else { $null })
  $physicalListItemCommit = $false
  $selectionCommitMethod = 'selection-item'
  if ($stateAfter.ok -and
      [string]::Equals($afterValue, $ExpectedCurrent, [StringComparison]::Ordinal) -and
      $postPopup.ok -and $boundListPresent -and
      (Test-SSETableComboPopupBindingEquivalent $popup $postPopup) -and
      (-not $guardUserInput -or (Test-SSELastInputUnchanged $InputBaseline))) {
    $selectionEvidence = [ordered]@{
      semanticSelected=$internalSelected; semanticError=$selectionError
      fallbackAttempted=$false; sourceHwnd=[int64]$postPopup.sourceHwnd
      listRid=[string]$postPopup.list.rid; targetRid=[string]$postPopup.target.rid
    }
    if ($script:DESKTOP_NAME) {
      $selectionEvidence['fallbackError']='Verifizierter Popup-ListItem-Klick ist auf dem versteckten Desktop gesperrt.'
    } elseif (-not $guardUserInput -or $null -eq $InputBaseline) {
      $selectionEvidence['fallbackError']='Verifizierter Popup-ListItem-Klick erfordert eine lesbare Benutzereingabe-Epoche.'
    } elseif ([int64]$postPopup.sourceHwnd -eq [int64]$Hwnd) {
      $selectionEvidence['fallbackError']='Physischer Commit ist nur fuer ein separat gebundenes Popup-HWND erlaubt.'
    } else {
      $selectionEvidence['fallbackAttempted']=$true
      $popupWindows = @(Get-Windows 'SSE' | Where-Object {
        [int]$_.pid -eq $ProcessId -and [int64]$_.hwnd -eq [int64]$postPopup.sourceHwnd
      })
      $popupPid = 0
      [SW]::GetWindowThreadProcessId(([IntPtr][int64]$postPopup.sourceHwnd), [ref]$popupPid) | Out-Null
      $targetNode = $postPopup.target
      if ($popupWindows.Count -ne 1 -or $popupPid -ne $ProcessId -or
          -not $targetNode.rid -or [int]$targetNode.w -le 0 -or [int]$targetNode.h -le 0) {
        $selectionEvidence['fallbackError']='Popup-HWND, PID oder sichtbares Ziel-ListItem ist nicht mehr eindeutig gebunden.'
      } else {
        $targetX=[int]($targetNode.x + $targetNode.w / 2)
        $targetY=[int]($targetNode.y + $targetNode.h / 2)
        $targetObstruction=Get-SSEPointObstruction ([IntPtr][int64]$postPopup.sourceHwnd) $targetX $targetY
        if (-not $targetObstruction.isBoundTarget -or [int]$targetObstruction.boundPid -ne $ProcessId -or
            -not (Test-SSELastInputUnchanged $InputBaseline)) {
          $selectionEvidence['fallbackError']='Popup-ListItem-Mittelpunkt ist nicht mehr an Popup-Root, PID und Eingabe-Epoche gebunden.'
          $selectionEvidence['obstruction']=$targetObstruction
        } else {
          $popupClick=Click-VerifiedPoint -Window ([IntPtr][int64]$postPopup.sourceHwnd) -Node $targetNode `
            -ExpectedInputTick $InputBaseline -RequireForeground
          $InputBaseline=Get-SSELastInputTick
          $selectionEvidence['verifiedPoint']=[pscustomobject]@{
            x=$popupClick.x; y=$popupClick.y; hwnd=[int64]$postPopup.sourceHwnd; pid=$ProcessId
            listRid=[string]$postPopup.list.rid; targetRid=[string]$postPopup.target.rid
            targetAid=[string]$postPopup.target.aid; obstruction=$targetObstruction
          }
          if ($null -eq $InputBaseline) {
            $selectionEvidence['fallbackError']='Windows-Eingabe-Epoche ist nach dem Popup-ListItem-Klick nicht lesbar.'
          } else {
            Start-Sleep -Milliseconds 450
            $stateAfter=Read-SSETableComboCellState $Hwnd $ExpectedPage $SumLabel $SumOccurrence $RowY $ColumnIndex $TableProfile
            $interactionAfter=Get-SSEInteractionWindowSet $ProcessId $Hwnd
            $postSources=@(Get-SSETableComboPopupSources $ProcessId $Hwnd $windowIdsBefore)
            $postPopup=Resolve-SSETableComboPopup $postSources $stateBefore.cell $Wanted $ExpectedCurrent $TableProfile
            $boundListPresent=Test-SSETableComboBoundListPresent $postSources $popup
            $popupClosed=[bool](-not $boundListPresent)
            $afterValue=$(if ($stateAfter.ok) { [string]$stateAfter.value } else { $null })
            $physicalListItemCommit=$true
            $selectionCommitMethod='selection-item+verified-list-item-point'
            $selectionEvidence['boundListGone']=$popupClosed
            $selectionEvidence['cellValueAfter']=$afterValue
            $selectionEvidence['inputEpochAfter']=$InputBaseline
          }
        }
      }
    }
    $openEvidence['selectionCommit']=[pscustomobject]$selectionEvidence
  }
  $inputChanged = [bool]($guardUserInput -and -not (Test-SSELastInputUnchanged $InputBaseline))
  $windowChanged = [bool]($interactionAfter.fingerprint -ne $interactionBefore.fingerprint)
  $interference = [bool]($inputChanged -or $windowChanged -or -not $popupClosed -or
    (-not $stateAfter.ok -and $stateAfter.interference))
  $newCheckerMessages = $(if ($stateAfter.ok) {
    @(Compare-SSEPageCheckerMessages $CheckerMessagesBefore $stateAfter.checkerMessages)
  } else { @() })
  $visualOk = [bool]($stateAfter.ok -and [string]::Equals($afterValue, $Wanted, [StringComparison]::Ordinal))
  $semanticOk = [bool]($physicalListItemCommit -or ($internalSelected -and -not $selectionError))
  $checkerOk = [bool]($Rollback -or -not $newCheckerMessages.Count)
  if (-not $interference -and $semanticOk -and $visualOk -and $checkerOk) {
    return [pscustomobject]@{
      ok=$true; interference=$false; mutationStarted=$mutationStarted
      before=$ExpectedCurrent; requested=$Wanted; after=$afterValue
      method="$openMethod+$selectionCommitMethod"; internalSelected=$internalSelected
      popupBinding=$popup.binding; options=$popup.options
      popupClosed=$popupClosed
      openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
      checkerMessagesAfter=$stateAfter.checkerMessages; newCheckerMessages=$newCheckerMessages
    }
  }
  if ($interference) {
    return [pscustomobject]@{
      ok=$false; interference=$true; mutationStarted=$mutationStarted
      error='Fenster-, Seiten-, Zell- oder Benutzereingabe-Interferenz waehrend der typisierten Auswahl.'
      before=$ExpectedCurrent; requested=$Wanted; after=$afterValue
      internalSelected=$internalSelected; popupBinding=$popup.binding; popupClosed=$popupClosed
      method=$openMethod; openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
      rollback=[pscustomobject]@{ versucht=$false; grund='Kein blinder Rollback nach Interferenz.' }
    }
  }
  if (-not [string]::Equals($afterValue, $ExpectedCurrent, [StringComparison]::Ordinal) -and
      -not [string]::Equals($afterValue, $Wanted, [StringComparison]::Ordinal)) {
    return [pscustomobject]@{
      ok=$false; interference=$true; mutationStarted=$mutationStarted
      error="Unerwarteter dritter ComboBox-Wert '$afterValue'; kein blinder Rollback."
      before=$ExpectedCurrent; requested=$Wanted; after=$afterValue
      internalSelected=$internalSelected; popupBinding=$popup.binding
      method=$openMethod; openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
      rollback=[pscustomobject]@{ versucht=$false; grund='Fremder oder transformierter Wert.' }
    }
  }

  $rollbackAttempted = $false; $rollbackOk = $false; $rollbackValue = $afterValue; $rollbackError = $null
  $rollbackMethod = $null; $rollbackOpenEvidence = $null
  if ([string]::Equals($afterValue, $ExpectedCurrent, [StringComparison]::Ordinal)) {
    $rollbackOk = $true
  } elseif ([string]::Equals($afterValue, $Wanted, [StringComparison]::Ordinal)) {
    if ($Rollback) {
      $rollbackError = 'Rollback-Auswahl verletzte ihre eigene Nachbedingung; kein rekursiver Blind-Rollback.'
    } else {
      $rollbackAttempted = $true
      $rollbackResult = Invoke-SSETableComboSelection `
        -Hwnd $Hwnd -ProcessId $ProcessId -ExpectedPage $ExpectedPage `
        -SumLabel $SumLabel -SumOccurrence $SumOccurrence -RowY $RowY -ColumnIndex $ColumnIndex `
        -TableProfile $TableProfile -ColumnProfile $ColumnProfile `
        -ExpectedCurrent $Wanted -Wanted $ExpectedCurrent -CheckerMessagesBefore $CheckerMessagesBefore `
        -InputBaseline $InputBaseline -GuardUserInput:$guardUserInput -Rollback
      if ($guardUserInput -and $null -ne $rollbackResult.inputBaselineAfter) {
        $InputBaseline = $rollbackResult.inputBaselineAfter
      }
      $rollbackOk = [bool]$rollbackResult.ok
      $rollbackValue = [string]$rollbackResult.after
      $rollbackMethod = [string]$rollbackResult.method
      $rollbackOpenEvidence = $rollbackResult.openEvidence
      if (-not $rollbackOk) { $rollbackError = [string]$rollbackResult.error }
    }
  } else {
    $rollbackError = "Unerwarteter dritter Wert '$afterValue'; nicht blind ueberschrieben."
  }
  [pscustomobject]@{
    ok=$false; interference=$false; mutationStarted=$mutationStarted
    error=$(if ($selectionError) { $selectionError } elseif (-not $semanticOk) { 'SelectionItem.IsSelected bestaetigte die interne Auswahl nicht.' } elseif (-not $visualOk) { "Visueller Readback ist '$afterValue' statt '$Wanted'." } else { "Neue Pruefermeldung: $($newCheckerMessages -join ' | ')" })
    before=$ExpectedCurrent; requested=$Wanted; after=$afterValue
    internalSelected=$internalSelected; popupBinding=$popup.binding
    method=$openMethod; openEvidence=[pscustomobject]$openEvidence; inputBaselineAfter=$InputBaseline
    checkerMessagesAfter=$(if ($stateAfter.ok) { $stateAfter.checkerMessages } else { @() })
    newCheckerMessages=$newCheckerMessages
    rollback=[pscustomobject]@{
      versucht=$rollbackAttempted; erfolgreich=$rollbackOk; ist=$rollbackValue; erwartet=$ExpectedCurrent
      grund=$rollbackError; methode=$rollbackMethod; openEvidence=$rollbackOpenEvidence
    }
  }
}

function Get-SSEPageCheckerMessages($Tree, [IntPtr]$Hwnd) {
  $bounds = Get-ContentBounds $Tree $Hwnd
  @($Tree.nodes | Where-Object {
    $_.type -eq 'TreeItem' -and $_.name -and $_.x -gt $bounds.maxX -and $_.name.Length -lt 180
  } | ForEach-Object { [string]$_.name } | Where-Object {
    $_ -notin @('Eingabehilfe','Steuertipps','Prüfer','Mehr Details','Zurzeit keine Hinweise zu diesem Dialog.')
  } | Select-Object -Unique)
}

function Compare-SSEPageCheckerMessages([object[]]$Before, [object[]]$After) {
  @($After | Where-Object { [string]$_ -notin @($Before | ForEach-Object { [string]$_ }) })
}

function Resolve-TrackedFieldNode($Tree, $CallArgs, [IntPtr]$Hwnd) {
  $direct = Resolve-Node $Tree $CallArgs
  if ($direct -and $direct.type -in @('Edit','DataItem')) { return $direct }
  # sse_page zeigt menschenlesbare Feldbeschriftungen, Qt gibt den eigentlichen
  # Edit-Knoten aber oft namenlos aus. Ein atomarer Schreibaufruf soll genau
  # diese Beschriftung akzeptieren und die naechste beschreibbare Zelle rechts
  # in derselben Bildschirmzeile eindeutig zuordnen.
  if ((Arg $CallArgs 'aid') -or (Arg $CallArgs 'rid')) { return $direct }
  $name = [string](Arg $CallArgs 'name')
  if (-not $name) { return $direct }
  $contains = [bool](Arg $CallArgs 'contains' $false)
  $bounds = Get-ContentBounds $Tree $Hwnd
  $labels = @($Tree.nodes | Where-Object {
    $_.type -eq 'Text' -and $_.name -and $_.x -ge $bounds.minX -and $_.x -le $bounds.maxX
  })
  if ($contains) { $labels = @($labels | Where-Object { $_.name -like "*$name*" }) }
  else           { $labels = @($labels | Where-Object { $_.name -eq $name }) }
  $labels = @($labels | Sort-Object y, x)
  $mapped = New-Object System.Collections.ArrayList
  foreach ($label in $labels) {
    # Qt gruppiert Caption und Wert in der Regel unter demselben Elternknoten;
    # das ist stabiler als reine Pixelgeometrie und funktioniert auch bei
    # langen Labels, die bis unmittelbar an das Eingabefeld reichen.
    $siblings = @($Tree.nodes | Where-Object {
      $_.p -eq $label.p -and $_.type -in @('Edit','DataItem')
    } | Sort-Object x)
    $field = $(if ($siblings.Count -eq 1) { $siblings[0] } else {
      @($Tree.nodes | Where-Object {
        $_.type -in @('Edit','DataItem') -and $_.x -ge ($label.x + [Math]::Max(1, $label.w - 8)) -and
        [Math]::Abs($_.y - $label.y) -le 14 -and $_.x -le ($bounds.maxX + 200)
      } | Sort-Object { $_.x - $label.x } | Select-Object -First 1)[0]
    })
    if ($field) { $null = $mapped.Add($field) }
  }
  $unique = @($mapped | Group-Object rid | ForEach-Object { $_.Group[0] })
  if ($unique.Count -eq 1) { return $unique[0] }
  $direct
}

function Open-TrackedResultWindow([IntPtr]$MainHwnd) {
  $wins = @(Get-Windows 'SSE')
  $main = @($wins | Where-Object { [int64]$_.hwnd -eq [int64]$MainHwnd })
  if ($main.Count -ne 1) {
    return [pscustomobject]@{ ok=$false; error='SSE-Hauptfenster fuer Ergebnis-Tracking nicht mehr eindeutig.' }
  }
  $valueWindows = @($wins | Where-Object {
    $_.pid -eq $main[0].pid -and $_.title -eq 'Werte-Info: Werte vergleichen - Was wäre wenn'
  })
  $opened = $false
  if (-not $valueWindows.Count) {
    $tree = Walk-Tree $MainHwnd 2500 35 15 -WithValues
    $buttons = @($tree.nodes | Where-Object {
      $_.type -eq 'Button' -and $_.aid -like '*TaxResultsWidgetSSE*hoverBtnMehrDetails'
    })
    if ($buttons.Count -ne 1) {
      return [pscustomobject]@{ ok=$false; error="Mehr-Details-Knopf nicht eindeutig ($($buttons.Count) Treffer)." }
    }
    $element = Get-LiveElement $MainHwnd $buttons[0].rid
    $invoked = $false
    try {
      $invoke = $null
      if ($element -and $element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
        $invoke.Invoke(); $invoked = $true
      }
    } catch { }
    if (-not $invoked) {
      try { $null = Click-VerifiedPoint $MainHwnd $buttons[0]; $invoked = $true } catch { }
    }
    if (-not $invoked) { return [pscustomobject]@{ ok=$false; error='Mehr Details konnte nicht geoeffnet werden.' } }
    Start-Sleep -Milliseconds 700
    $opened = $true
    $wins = @(Get-Windows 'SSE')
    $valueWindows = @($wins | Where-Object {
      $_.pid -eq $main[0].pid -and $_.title -eq 'Werte-Info: Werte vergleichen - Was wäre wenn'
    })
  }
  if ($valueWindows.Count -ne 1) {
    return [pscustomobject]@{ ok=$false; opened=$opened; error="Werte-Info nicht eindeutig ($($valueWindows.Count) Fenster)." }
  }
  [pscustomobject]@{ ok=$true; opened=$opened; window=$valueWindows[0] }
}

function Read-TrackedResultWindow($Window) {
  $hwnd = [IntPtr][int64]$Window.hwnd
  if (-not [SW]::IsWindow($hwnd)) {
    return [pscustomobject]@{ ok=$false; error='Werte-Info wurde geschlossen.'; rows=@() }
  }
  $tree = Walk-Tree $hwnd 4000 60 18 -WithValues -WithScroll
  $result = Read-ResultDetailsFromTree $tree
  $rows = @($result.zeilen | ForEach-Object {
    [pscustomobject]@{
      name=$_.beobachteterWert; aktuell=$_.aktuell
      festgehalten=$_.festgehalten; differenz=$_.differenz
    }
  })
  [pscustomobject]@{
    ok=[bool]$result.vollstaendig; complete=[bool]$result.vollstaendig; rows=$rows
    malformed=@($result.unvollstaendigeZeilen)
    unpositioned=[int]$result.nichtPositionierteZellenAnzahl
    invariantErrors=@($result.vergleichsInvariantFehler)
    headers=@($result.uiaKopfzeilen)
  }
}

function Compare-TrackedResultRows($Before, $After, [string[]]$Labels = @()) {
  $beforeMap = @{}; $afterMap = @{}
  foreach ($row in @($Before.rows)) { if ($row.name) { $beforeMap[$row.name] = $row.aktuell } }
  foreach ($row in @($After.rows))  { if ($row.name) { $afterMap[$row.name] = $row.aktuell } }
  $names = @($beforeMap.Keys + $afterMap.Keys | Select-Object -Unique | Sort-Object)
  $changes = New-Object System.Collections.ArrayList
  foreach ($name in $names) {
    if ($Labels.Count -and $name -notin $Labels) { continue }
    $vorher = $beforeMap[$name]; $nachher = $afterMap[$name]
    if (-not (Test-SSEScalarEqual $vorher $nachher)) {
      $null = $changes.Add([pscustomobject]@{ name=$name; vorher=$vorher; nachher=$nachher })
    }
  }
  @($changes)
}

function Close-TrackedResultWindow($Tracking) {
  if (-not $Tracking -or -not $Tracking.ok -or -not $Tracking.opened -or -not $Tracking.window) { return $true }
  $hwnd = [IntPtr][int64]$Tracking.window.hwnd
  if (-not [SW]::IsWindow($hwnd)) { return $true }
  $res = [IntPtr]::Zero
  $null = [SW]::SendMessageTimeout($hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero, 0x0002, 3000, [ref]$res)
  Start-Sleep -Milliseconds 250
  -not [SW]::IsWindow($hwnd)
}

function Commit-TrackedValue([IntPtr]$Hwnd, $Node, [string]$Value, [string]$ExpectedCurrent) {
  if ($script:DESKTOP_NAME) { return New-SSECommitResult 'none-hidden-desktop' }
  try {
    # Qt uebernimmt ValuePattern optisch, aber nicht in sein Rechenmodell:
    # Feld 12,00, Summen weiter 0,00 - sogar nach UIA-Fokuswechsel und TAB.
    # Deshalb den Wert wie ein Benutzer in das exakt PID-verifizierte Feld
    # schreiben. UIA bleibt fuer Zielwahl und Readback massgeblich.
    # SetForegroundWindow ist unter Windows nur ein Wunsch und kann trotz
    # TOPMOST/AttachThreadInput abgelehnt werden. Das ist noch kein Grund fuer
    # einen Scheinerfolg oder einen blinden Abbruch: Der unmittelbar folgende
    # physische Klick darf nur auf einem PID-verifizierten SSE-Punkt landen und
    # muss danach exaktes Vordergrund-HWND plus Feldfokus beweisen. Vor diesem
    # Beweis wird kein einziges Eingabezeichen gesendet.
    $foregroundPrepared = Show-SSEWindow $Hwnd
    if (-not [SW]::IsWindow($Hwnd)) {
      Complete-SSEPhysicalSection $Hwnd
      return New-SSECommitResult 'stale-window'
    }
    $inputBefore = Get-SSELastInputTick
    if ($null -eq $inputBefore) {
      Complete-SSEPhysicalSection $Hwnd
      return New-SSECommitResult 'interference-input-guard-unavailable'
    }

    # Unmittelbar vor dem ersten Eingabebyte die ganze Mutationsepoche noch
    # einmal pruefen: derselbe lebende UIA-Knoten, derselbe Vorwert, dieselbe
    # Position und exakt dieses Hauptfenster im Vordergrund. Ein Scrollen oder
    # Seitenwechsel des Benutzers fuehrt so zum Abbruch vor der Aenderung.
    $target = Get-LiveElement $Hwnd $Node.rid $Node.aid
    $vp = $null
    if (-not $target -or -not $target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp) -or
        $vp.Current.IsReadOnly -or -not (Test-SSEScalarEqual $vp.Current.Value $ExpectedCurrent)) {
      Complete-SSEPhysicalSection $Hwnd; return New-SSECommitResult 'epoch-value-changed' $inputBefore (Get-SSELastInputTick)
    }
    $rectangle = $target.Current.BoundingRectangle
    if ([double]::IsInfinity($rectangle.X) -or $rectangle.Width -le 0 -or $rectangle.Height -le 0) {
      Complete-SSEPhysicalSection $Hwnd; return New-SSECommitResult 'epoch-offscreen' $inputBefore (Get-SSELastInputTick)
    }
    if ([Math]::Abs([int]$rectangle.X - [int]$Node.x) -gt 3 -or [Math]::Abs([int]$rectangle.Y - [int]$Node.y) -gt 3) {
      $positionDetails = [pscustomobject]@{
        expected=[pscustomobject]@{ x=[int]$Node.x; y=[int]$Node.y; w=[int]$Node.w; h=[int]$Node.h }
        actual=[pscustomobject]@{
          x=[int]$rectangle.X; y=[int]$rectangle.Y
          w=[int]$rectangle.Width; h=[int]$rectangle.Height
        }
      }
      Complete-SSEPhysicalSection $Hwnd
      return New-SSECommitResult 'epoch-position-changed' $inputBefore (Get-SSELastInputTick) $positionDetails
    }
    $px = [int]($rectangle.X + $rectangle.Width / 2)
    $py = [int]($rectangle.Y + $rectangle.Height / 2)
    $point = New-Object SW+PT; $point.X = $px; $point.Y = $py
    $expectedPid = 0; [SW]::GetWindowThreadProcessId($Hwnd, [ref]$expectedPid) | Out-Null
    $hitWindow = [SW]::WindowFromPoint($point)
    $hitRoot = [SW]::GetAncestor($hitWindow, 2) # GA_ROOT
    $hitPid = 0; [SW]::GetWindowThreadProcessId($hitWindow, [ref]$hitPid) | Out-Null
    if ($hitPid -ne $expectedPid -or [int64]$hitRoot -ne [int64]$Hwnd) {
      $obstructionDetails = [pscustomobject]@{
        point=[pscustomobject]@{ x=$px; y=$py }
        expectedPid=[int]$expectedPid; hitPid=[int]$hitPid
        expectedRoot=[int64]$Hwnd; hitRoot=[int64]$hitRoot; hitWindow=[int64]$hitWindow
        foregroundHwnd=[int64][SW]::GetForegroundWindow()
        foregroundPrepared=[bool]$foregroundPrepared
      }
      Complete-SSEPhysicalSection $Hwnd
      return New-SSECommitResult 'epoch-obstructed' $inputBefore (Get-SSELastInputTick) $obstructionDetails
    }
    if (-not (Test-SSELastInputUnchanged $inputBefore)) {
      $changedAt = Get-SSELastInputTick
      Complete-SSEPhysicalSection $Hwnd
      return New-SSECommitResult 'interference-before-click' $inputBefore $changedAt
    }

    [SW]::SetCursorPos($px, $py) | Out-Null
    [SW]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
    [SW]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 20
    $afterClickInput = Get-SSELastInputTick
    Set-SSEForegroundLeaseInputCheckpoint $afterClickInput ([pscustomobject]@{ x=$px; y=$py })
    Start-Sleep -Milliseconds 60
    if (-not (Test-SSELastInputUnchanged $afterClickInput) -or [SW]::GetForegroundWindow() -ne $Hwnd) {
      $changedAt = Get-SSELastInputTick
      Complete-SSEPhysicalSection $Hwnd
      return New-SSECommitResult 'interference-before-input' $inputBefore $changedAt
    }
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    $focusBound = $false
    $focusChain = New-Object System.Collections.ArrayList
    $focusProbe = $focused
    for ($focusLevel = 0; $focusLevel -lt 8 -and $focusProbe; $focusLevel++) {
      $probeRid = $(try { $focusProbe.GetRuntimeId() -join '.' } catch { '' })
      $probeAid = $(try { [string]$focusProbe.Current.AutomationId } catch { '' })
      $probeType = $(try { $focusProbe.Current.ControlType.ProgrammaticName.Replace('ControlType.','') } catch { '' })
      $null = $focusChain.Add([pscustomobject]@{ level=$focusLevel; rid=$probeRid; aid=$probeAid; type=$probeType })
      if (($Node.rid -and $probeRid -eq $Node.rid) -or ($Node.aid -and $probeAid -eq $Node.aid)) {
        $focusBound = $true
        break
      }
      try { $focusProbe = $WLK.GetParent($focusProbe) } catch { $focusProbe = $null }
    }
    if (-not $focusBound) {
      $focusDetails = [pscustomobject]@{
        expectedRid=[string]$Node.rid; expectedAid=[string]$Node.aid
        foregroundHwnd=[int64][SW]::GetForegroundWindow()
        chain=@($focusChain)
      }
      Complete-SSEPhysicalSection $Hwnd
      return New-SSECommitResult 'focus-mismatch' $inputBefore (Get-SSELastInputTick) $focusDetails
    }
    [System.Windows.Forms.SendKeys]::SendWait('^a')
    $afterSelectInput = Get-SSELastInputTick
    Set-SSEForegroundLeaseInputCheckpoint $afterSelectInput ([pscustomobject]@{ x=$px; y=$py })
    Start-Sleep -Milliseconds 40
    if (-not (Test-SSELastInputUnchanged $afterSelectInput) -or [SW]::GetForegroundWindow() -ne $Hwnd) {
      $changedAt = Get-SSELastInputTick
      Complete-SSEPhysicalSection $Hwnd
      return New-SSECommitResult 'interference-before-value' $inputBefore $changedAt
    }
    if ($Value) {
      [System.Windows.Forms.SendKeys]::SendWait((ConvertTo-SendKeysLiteral $Value))
      $afterValueInput = Get-SSELastInputTick
      Set-SSEForegroundLeaseInputCheckpoint $afterValueInput ([pscustomobject]@{ x=$px; y=$py })
      Start-Sleep -Milliseconds 60
      if (-not (Test-SSELastInputUnchanged $afterValueInput) -or [SW]::GetForegroundWindow() -ne $Hwnd) {
        $changedAt = Get-SSELastInputTick
        Complete-SSEPhysicalSection $Hwnd
        return New-SSECommitResult 'interference-after-value' $inputBefore $changedAt
      }
    }
    [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
    $afterCommitInput = Get-SSELastInputTick
    Set-SSEForegroundLeaseInputCheckpoint $afterCommitInput ([pscustomobject]@{ x=$px; y=$py })
    $settleWatch = [Diagnostics.Stopwatch]::StartNew()
    $settleAttempts = 0
    $settledValue = $null
    $settledEarly = $false
    while ($settleWatch.ElapsedMilliseconds -lt 700) {
      Start-Sleep -Milliseconds 50
      $settleAttempts++
      if (-not (Test-SSELastInputUnchanged $afterCommitInput) -or [SW]::GetForegroundWindow() -ne $Hwnd) {
        $changedAt = Get-SSELastInputTick
        Complete-SSEPhysicalSection $Hwnd
        return New-SSECommitResult 'interference-after-commit' $inputBefore $changedAt ([pscustomobject]@{
          settleMs=[int64]$settleWatch.ElapsedMilliseconds; settleAttempts=$settleAttempts
        })
      }
      try { $settledValue = [string]$vp.Current.Value } catch { $settledValue = $null }
      if ($null -ne $settledValue -and (Test-SSEScalarEqual $settledValue $Value)) {
        $settledEarly = $true
        break
      }
    }
    $settleDetails = [pscustomobject]@{
      settleMs=[int64]$settleWatch.ElapsedMilliseconds; settleAttempts=$settleAttempts
      settledEarly=$settledEarly; observedValue=$settledValue
    }
    Complete-SSEPhysicalSection $Hwnd
    return New-SSECommitResult 'verified-keyboard-replace' $inputBefore $afterCommitInput $settleDetails
  } catch { Complete-SSEPhysicalSection $Hwnd; return New-SSECommitResult 'failed' }
}

function Commit-TrackedValueFocusless([IntPtr]$Hwnd, $Node, [string]$Value, [string]$ExpectedCurrent) {
  # The exact UIA field is bound on the private desktop. Qt receives only a
  # queued Tab commit after ValuePattern replacement; the visible desktop and
  # physical input channel are never touched.
  if (-not $script:DESKTOP_NAME) {
    return New-SSECommitResult 'none-focusless-desktop-required'
  }
  if (-not [SW]::IsWindow($Hwnd)) { return New-SSECommitResult 'stale-window' }
  $strategy = 'value-pattern-tab'

  try {
    $expectedPid = 0
    [SW]::GetWindowThreadProcessId($Hwnd, [ref]$expectedPid) | Out-Null
    if ($expectedPid -le 0) { return New-SSECommitResult 'stale-window' }

    $target = Get-LiveElement $Hwnd $Node.rid $Node.aid
    $vp = $null
    if (-not $target -or
        -not $target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp) -or
        $vp.Current.IsReadOnly) {
      return New-SSECommitResult 'epoch-value-changed'
    }
    $currentComparable = [string]$vp.Current.Value
    if ([string]$Node.type -eq 'DataItem' -and -not $currentComparable) {
      $currentComparable = [string]$target.Current.Name
    }
    if (-not (Test-SSEScalarEqual $currentComparable $ExpectedCurrent)) {
      return New-SSECommitResult 'epoch-value-changed'
    }
    if ([int]$target.Current.ProcessId -ne $expectedPid) {
      return New-SSECommitResult 'focusless-process-mismatch'
    }

    # A just-closed nonmodal result window does not return Qt's active focus
    # to the main window. Activate the top-level UIA element inside the same
    # private desktop before binding the exact child field.
    $mainElement = [System.Windows.Automation.AutomationElement]::FromHandle($Hwnd)
    if (-not $mainElement -or [int]$mainElement.Current.ProcessId -ne $expectedPid) {
      return New-SSECommitResult 'focusless-main-window-mismatch'
    }
    $mainElement.SetFocus()
    Start-Sleep -Milliseconds 30

    $selectedByPattern = $false
    if ([string]$Node.type -eq 'DataItem') {
      $selectionItem = $null
      if ($target.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selectionItem)) {
        $selectionItem.Select()
        $selectedByPattern = $true
        Start-Sleep -Milliseconds 30
      }
    }
    $target.SetFocus()
    $focusWatch = [Diagnostics.Stopwatch]::StartNew()
    $focusBound = $false
    $tableParent = $null
    while ($focusWatch.ElapsedMilliseconds -lt 500) {
      $focusBound = $(try { [bool]$target.Current.HasKeyboardFocus } catch { $false })
      if ($focusBound) { break }
      Start-Sleep -Milliseconds 20
    }
    $focusMode = $(if ($focusBound) { 'exact-element' } else { '' })
    if (-not $focusBound -and $selectedByPattern -and $selectionItem) {
      $selectedExactly = $(try { [bool]$selectionItem.Current.IsSelected } catch { $false })
      $tableParent = $(try { $WLK.GetParent($target) } catch { $null })
      $tableFocused = [bool]($tableParent -and
        $(try { $tableParent.Current.ControlType -eq [System.Windows.Automation.ControlType]::Table } catch { $false }) -and
        $(try { [bool]$tableParent.Current.HasKeyboardFocus } catch { $false }))
      if ($selectedExactly -and $tableFocused) {
        $focusBound = $true
        $focusMode = 'selected-item-focused-table'
      }
    }
    if (-not $focusBound) {
      $focusHierarchy = New-Object System.Collections.ArrayList
      $focusProbe = $target
      for ($focusLevel = 0; $focusLevel -lt 8 -and $focusProbe; $focusLevel++) {
        $null = $focusHierarchy.Add([pscustomobject]@{
          level=$focusLevel
          rid=$(try { $focusProbe.GetRuntimeId() -join '.' } catch { '' })
          aid=$(try { [string]$focusProbe.Current.AutomationId } catch { '' })
          type=$(try { $focusProbe.Current.ControlType.ProgrammaticName.Replace('ControlType.','') } catch { '' })
          hasKeyboardFocus=$(try { [bool]$focusProbe.Current.HasKeyboardFocus } catch { $false })
          keyboardFocusable=$(try { [bool]$focusProbe.Current.IsKeyboardFocusable } catch { $false })
        })
        try { $focusProbe = $WLK.GetParent($focusProbe) } catch { $focusProbe = $null }
      }
      return New-SSECommitResult 'focus-mismatch' $null $null ([pscustomobject]@{
        desktop=[string]$script:DESKTOP_NAME; expectedPid=[int]$expectedPid
        expectedRid=[string]$Node.rid; expectedAid=[string]$Node.aid
        focusMs=[int64]$focusWatch.ElapsedMilliseconds; selectedByPattern=$selectedByPattern
        hierarchy=@($focusHierarchy)
      })
    }

    $writeWatch = [Diagnostics.Stopwatch]::StartNew()
    # Qt recalculates the whole page inside SetValue, so this single call is
    # measured separately from the bounded readback loops that follow it.
    $setValueWatch = [Diagnostics.Stopwatch]::StartNew()
    $vp.SetValue($Value)
    $setValueWatch.Stop()

    $typedValue = $null
    $typeWatch = [Diagnostics.Stopwatch]::StartNew()
    while ($typeWatch.ElapsedMilliseconds -lt 1200) {
      Start-Sleep -Milliseconds 20
      if ([string]$Node.type -eq 'DataItem') {
        $typedTarget = Get-LiveElement $Hwnd $Node.rid $Node.aid
        $typedValue = $(if ($typedTarget) { [string]$typedTarget.Current.Name } else { $null })
      } else {
        $typedValue = [string]$vp.Current.Value
      }
      if (Test-SSEScalarEqual $typedValue $Value) { break }
    }
    if (-not (Test-SSEScalarEqual $typedValue $Value)) {
      return New-SSECommitResult 'focusless-write-readback-mismatch' $null $null ([pscustomobject]@{
        desktop=[string]$script:DESKTOP_NAME; strategy=$strategy
        requested=$Value; observedValue=$typedValue
        typeMs=[int64]$typeWatch.ElapsedMilliseconds
      })
    }

    # lParam carries repeat=1 and the standard scan code 0x0f. The key-up
    # bits match a released transition. Posting, rather than SendInput, keeps
    # the messages inside the hidden desktop's SSE queue.
    $VK_TAB = [int]0x09
    $tabDown = [SW]::PostMessage($Hwnd, [uint32]0x0100, [IntPtr]$VK_TAB, [IntPtr][int64]0x000F0001)
    Start-Sleep -Milliseconds 10
    $tabUp = [SW]::PostMessage($Hwnd, [uint32]0x0101, [IntPtr]$VK_TAB, [IntPtr][int64]0xC00F0001)
    if (-not $tabDown -or -not $tabUp) {
      return New-SSECommitResult 'posted-tab-queue-failed' $null $null ([pscustomobject]@{
        desktop=[string]$script:DESKTOP_NAME; tabDown=[bool]$tabDown; tabUp=[bool]$tabUp
      })
    }

    $settledValue = $null
    $settleWatch = [Diagnostics.Stopwatch]::StartNew()
    $settleAttempts = 0
    $settledEarly = $false
    while ($settleWatch.ElapsedMilliseconds -lt 1200) {
      Start-Sleep -Milliseconds 40
      $settleAttempts++
      if ([string]$Node.type -eq 'DataItem') {
        $settledTarget = Get-LiveElement $Hwnd $Node.rid $Node.aid
        $settledValue = $(if ($settledTarget) { [string]$settledTarget.Current.Name } else { $null })
      } else {
        $settledValue = [string]$vp.Current.Value
      }
      if (Test-SSEScalarEqual $settledValue $Value) { $settledEarly = $true; break }
    }
    if (-not $settledEarly) {
      return New-SSECommitResult 'posted-tab-settle-mismatch' $null $null ([pscustomobject]@{
        desktop=[string]$script:DESKTOP_NAME; requested=$Value; observedValue=$settledValue
        settleMs=[int64]$settleWatch.ElapsedMilliseconds; settleAttempts=$settleAttempts
      })
    }
    New-SSECommitResult 'verified-focusless-value-pattern-tab' $null $null ([pscustomobject]@{
      desktop=[string]$script:DESKTOP_NAME; targetPid=[int]$expectedPid
      strategy=$strategy; focusVerified=$focusBound; focusMode=$focusMode
      focusMs=[int64]$focusWatch.ElapsedMilliseconds
      selectedByPattern=$selectedByPattern
      writeMs=[int64]$writeWatch.ElapsedMilliseconds
      setValueMs=[int64]$setValueWatch.ElapsedMilliseconds
      typeMs=[int64]$typeWatch.ElapsedMilliseconds
      settleMs=[int64]$settleWatch.ElapsedMilliseconds; settleAttempts=$settleAttempts
      settledEarly=$settledEarly; observedValue=$settledValue
      foregroundLeaseUsed=$false; physicalInputUsed=$false
    })
  } catch {
    New-SSECommitResult 'focusless-commit-failed' $null $null ([pscustomobject]@{
      desktop=[string]$script:DESKTOP_NAME; strategy=$strategy; error=$_.Exception.Message
    })
  }
}

function Get-SSETrackedDateParts([string]$Value) {
  $trimmed = ([string]$Value).Trim()
  if ($trimmed -notmatch '^(\d{1,2})\.(\d{1,2})(?:\.(\d{2}|\d{4}))?\.?$') { return $null }
  $day = [int]$Matches[1]; $month = [int]$Matches[2]
  if ($day -lt 1 -or $day -gt 31 -or $month -lt 1 -or $month -gt 12) { return $null }
  $year = $null
  if ($Matches[3]) {
    $year = [int]$Matches[3]
    if ([string]$Matches[3] -match '^\d{2}$') { $year += 2000 }
  }
  [pscustomobject]@{ day=$day; month=$month; year=$year }
}

function Test-SSETrackedValueEquivalent($Actual, $Expected, [string]$ValueKind = '') {
  if (Test-SSEScalarEqual $Actual $Expected) { return $true }
  if ($ValueKind -ne 'date') { return $false }
  $actualDate = Get-SSETrackedDateParts ([string]$Actual)
  $expectedDate = Get-SSETrackedDateParts ([string]$Expected)
  if (-not $actualDate -or -not $expectedDate) { return $false }
  if ($actualDate.day -ne $expectedDate.day -or $actualDate.month -ne $expectedDate.month) { return $false }
  # SSE blendet auf einigen Seiten das im Fallkontext eindeutige Jahr aus
  # ('15.07' statt '15.07.2026'). Sind beide Jahre sichtbar, muessen sie
  # trotzdem exakt uebereinstimmen.
  [bool]($null -eq $actualDate.year -or $null -eq $expectedDate.year -or $actualDate.year -eq $expectedDate.year)
}

# ================================================================== Operationen

switch ($Op) {

  'focusless_write_probe' {
    # Private test-only operation. It is deliberately absent from the API/MCP
    # catalog and touches only the tax-neutral global search QLineEdit.
    if (-not $script:DESKTOP_NAME -or $env:SSE_MCP_EXPERIMENT_FOCUSLESS -ne '1') {
      Fail 'Focusless-Probe ist nur explizit auf dem privaten Desktop freigegeben.' 'blocked'
    }
    $hwnd = Resolve-Window $a
    $expectedPid = 0
    [SW]::GetWindowThreadProcessId($hwnd, [ref]$expectedPid) | Out-Null
    $expectedBefore = [string](Arg $a 'expectedBefore' '')
    $value = [string](Arg $a 'value' 'SSEWM42')
    if ($expectedBefore -ne '') {
      Fail 'Der neutrale Suchfeld-Probe startet nur von einem leeren Feld.' 'bad-args'
    }
    if (-not $value -or $value.Length -gt 64) {
      Fail 'Probe-Wert muss 1 bis 64 UTF-16-Zeichen enthalten.' 'bad-args'
    }
    foreach ($character in $value.ToCharArray()) {
      $code = [int]$character
      if ($code -lt 0x20 -or $code -in @(0x00E5,0x00FF) -or
          ($code -ge 0xD800 -and $code -le 0xDFFF)) {
        Fail 'Probe-Wert enthaelt ein fuer Qt-WM_CHAR nicht sicher unterstuetztes Zeichen.' 'bad-args'
      }
    }
    $dialogs = @(Get-DialogInventory | Where-Object { $_.kind -in @('native-dialog','qt-dialog') })
    if ($dialogs.Count) { Fail 'Ein modaler Dialog blockiert den neutralen Suchfeld-Probe.' 'precondition-failed' }
    $target = Find-ExactAutomationElement $hwnd '.MainToolBar.QWidget.SearchSSE.QLineEdit'
    $vp = $null
    if (-not $target -or [int]$target.Current.ProcessId -ne $expectedPid -or
        -not $target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp) -or
        $vp.Current.IsReadOnly -or [string]$vp.Current.Value -ne $expectedBefore) {
      Fail 'Globales Suchfeld ist nicht exakt leer und beschreibbar gebunden.' 'precondition-failed'
    }
    $focusBefore = $(try { [bool]$target.Current.HasKeyboardFocus } catch { $false })
    try { $target.SetFocus() } catch {
      Emit ([pscustomobject]@{
        ok=$false; kind='probe-no-focus'; error=$_.Exception.Message
        focusBefore=$focusBefore; focusAfter=$false; mutated=$false
      })
    }
    Start-Sleep -Milliseconds 30
    $focusAfter = $(try { [bool]$target.Current.HasKeyboardFocus } catch { $false })
    if (-not $focusAfter) {
      Emit ([pscustomobject]@{
        ok=$false; kind='probe-no-focus'
        error='Qt-UIA bestaetigte keinen internen Fokus auf dem Suchfeld; keine Nachricht gesendet.'
        focusBefore=$focusBefore; focusAfter=$focusAfter; mutated=$false
      })
    }

    $postWatch = [Diagnostics.Stopwatch]::StartNew()
    $posted = 0
    $postFailure = $null
    foreach ($character in $value.ToCharArray()) {
      $livePid = 0
      [SW]::GetWindowThreadProcessId($hwnd, [ref]$livePid) | Out-Null
      if (-not [SW]::IsWindow($hwnd) -or [SW]::IsHungAppWindow($hwnd) -or $livePid -ne $expectedPid) {
        $postFailure = [pscustomobject]@{ kind='stale-or-hung'; index=$posted }
        break
      }
      if (-not [SW]::PostMessage($hwnd, [uint32]0x0102, [IntPtr][int]$character, [IntPtr]1)) {
        $postFailure = [pscustomobject]@{
          kind='post-message-failed'; index=$posted
          win32Error=[Runtime.InteropServices.Marshal]::GetLastWin32Error()
        }
        break
      }
      $posted++
    }
    $observed = [string]$vp.Current.Value
    $readbackWatch = [Diagnostics.Stopwatch]::StartNew()
    while (-not $postFailure -and $readbackWatch.ElapsedMilliseconds -lt 1200 -and
           -not (Test-SSEScalarEqual $observed $value)) {
      Start-Sleep -Milliseconds 20
      $observed = [string]$vp.Current.Value
    }

    # Search is tax-neutral and restored through UIA even when the posted
    # channel fails. This cleanup never serves as evidence for the channel.
    $vp.SetValue($expectedBefore)
    $restored = [string]$vp.Current.Value
    $verified = [bool](-not $postFailure -and (Test-SSEScalarEqual $observed $value) -and $restored -eq $expectedBefore)
    Emit ([pscustomobject]@{
      ok=$verified; kind=$(if ($verified) { 'focusless-probe' } else { 'focusless-probe-failed' })
      verified=$verified; method='wm-char-search-probe'; desktop=[string]$script:DESKTOP_NAME
      hwnd=[int64]$hwnd; pid=[int]$expectedPid
      focusBefore=$focusBefore; focusAfter=$focusAfter
      requested=$value; observed=$observed; restored=$restored
      postedCharacters=$posted; postFailure=$postFailure
      postMs=[int64]$postWatch.ElapsedMilliseconds; readbackMs=[int64]$readbackWatch.ElapsedMilliseconds
      foregroundLeaseUsed=$false; physicalInputUsed=$false; privateValuesPersisted=$false
    })
  }

  'page_objects' {
    $catalog = Get-SSEPageObjects
    $pageId = [string](Arg $a 'pageId')
    if (-not $pageId) { Emit ([pscustomobject]@{ ok=$true; catalog=$catalog }) }
    $resolved = Resolve-SSEPageObject $pageId
    Emit ([pscustomobject]@{ ok=$true; pageId=$pageId; page=$resolved.page })
  }

  'known_page_state' {
    $pageId = [string](Arg $a 'pageId')
    if (-not $pageId) { Fail 'pageId fehlt.' 'bad-args' }
    $known = Resolve-SSEPageObject $pageId
    $hwnd = Resolve-Window $a
    $canary = Test-Canary $hwnd
    if (-not $canary.ok) { Fail "Kanarienvogel traege ($($canary.ms) ms) - neu starten." 'degraded' }
    $dialogs = @(Get-DialogInventory | Where-Object { $_.kind -in @('native-dialog','qt-dialog') })
    $state = Get-KnownPageState $hwnd $known
    Emit ([pscustomobject]@{
      ok=$true; pageId=$pageId; expectedHeading=[string]$known.page.heading
      onExpectedPage=[bool]((Test-KnownPageHeading $state.heading $known.page) -and
        @($state.fields | Where-Object { -not $_.present }).Count -eq 0)
      heading=$state.heading; dirty=$state.dirty; fields=$state.fields; epoch=$state.epoch
      hwnd=[int64]$hwnd
      pid=$(
        $record = @(Get-Windows 'SSE' | Where-Object { [int64]$_.hwnd -eq [int64]$hwnd })[0]
        if ($record) { [int]$record.pid } else { 0 }
      )
      foreground=([SW]::GetForegroundWindow() -eq $hwnd)
      dialogs=@($dialogs | ForEach-Object { [pscustomobject]@{ hwnd=$_.hwnd; title=$_.title; fingerprint=$_.fingerprint } })
      privateValuesPersisted=$false
    })
  }

  'product_info' {
    $defaultIdentity = Get-SSEExecutableIdentity $script:SSE_DEFAULT_EXE
    $running = @(Get-SSEProcessIdentities)
    $catalog = Get-SSEPageObjects
    $catalogCompatible = [bool]([int]$catalog.schemaVersion -eq 1 -and
      [string]$catalog.product -eq [string]$script:SSE_PROFILE.product -and
      [int]$catalog.taxYear -eq $script:SSE_TAX_YEAR -and
      [int]$catalog.engineFileMajor -eq $script:SSE_ENGINE_MAJOR -and
      [string]$catalog.compatibility.executableName -ieq [string]$script:SSE_PROFILE.executable.name -and
      [string]$catalog.compatibility.installationFolderName -ieq [string]$script:SSE_PROFILE.executable.installationFolderName)
    Emit ([pscustomobject]@{
      ok=$true
      profileId=$script:SSE_PROFILE_ID
      profileStatus=[string]$script:SSE_PROFILE.status
      product=[string]$script:SSE_PROFILE.product
      taxYear=$script:SSE_TAX_YEAR
      supportedCaseYears=[pscustomobject]@{
        einurvor=@(Get-SSEAllowedCaseYearsForMode 'einurvor')
      }
      engineFileMajor=$script:SSE_ENGINE_MAJOR
      defaultExecutable=$defaultIdentity
      catalogCompatibility=[pscustomobject]@{
        compatible=$catalogCompatible; taxYear=[int]$catalog.taxYear; engineFileMajor=[int]$catalog.engineFileMajor
        executableName=[string]$catalog.compatibility.executableName
        installationFolderName=[string]$catalog.compatibility.installationFolderName
      }
      workerInitializationMs=[pscustomobject]$script:INIT_TIMINGS
      interactionGuards=[pscustomobject]@{
        lastInputInfoAvailable=[bool]($null -ne (Get-SSELastInputTick))
        windowSetFingerprint=$true
        noBlindRollbackAfterInterference=$true
      }
      supportedRunning=@($running | Where-Object { $_.supported })
      ignoredRunning=@($running | Where-Object { -not $_.supported })
      policy=[string]$script:SSE_PROFILE.policy
    })
  }

  'health' {
    $processIdentities = @(Get-SSEProcessIdentities)
    $procs = @(Get-SSEProcesses)
    if (-not $procs) {
      Emit ([pscustomobject]@{
        ok = $true; running = $false; windows = @()
        profileId=$script:SSE_PROFILE_ID; product=[string]$script:SSE_PROFILE.product; taxYear=$script:SSE_TAX_YEAR
        ignoredRunning=@($processIdentities | Where-Object { -not $_.supported })
        note = $(if ($processIdentities.Count) { "Keine unterstuetzte Instanz von '$($script:SSE_PROFILE.product)'. Andere Produktprofile werden nicht gesteuert." }
                 else { "$($script:SSE_PROFILE.product) laeuft nicht." })
      })
    }
    $wins = @(Get-Windows 'SSE')
    $canary = $null
    if ($wins.Count) { $canary = Test-Canary ([IntPtr][int64]$wins[0].hwnd) }
    $dialogInventory = @(Get-DialogInventory | Where-Object { $_.kind -in @('native-dialog','qt-dialog') })
    $p = $procs[0]
    Emit ([pscustomobject]@{
      ok = $true; running = $true
      profileId=$script:SSE_PROFILE_ID; product=[string]$script:SSE_PROFILE.product; taxYear=$script:SSE_TAX_YEAR
      pid = $p.Id; cpuSec = [math]::Round($p.CPU, 1); title = $p.MainWindowTitle
      ignoredRunning=@($processIdentities | Where-Object { -not $_.supported })
      windows = $wins
      canaryOk = $(if ($canary) { $canary.ok } else { $false })
      canaryMs = $(if ($canary) { $canary.ms } else { -1 })
      dialogs = @($dialogInventory | ForEach-Object { [pscustomobject]@{ hwnd=$_.hwnd; title=$_.title; kind=$_.kind; buttons=$_.buttons; fingerprint=$_.fingerprint } })
      advice = $(
        if (-not $wins.Count) { 'Kein Fenster - startet noch oder Dialog fehlt.' }
        elseif ($wins[0].hung) { 'Fenster haengt. Neu starten (sse_restart).' }
        elseif ($dialogInventory.Count) { 'Ein modaler Dialog ist offen. Mit sse_dialog_list lesen und gezielt beantworten; NICHT neu starten.' }
        elseif ($canary -and -not $canary.ok) { 'Traege UIA-Antwort. Programm ueberlastet - neu starten.' }
        else { 'gesund' }
      )
    })
  }

  'windows' {
    $listedWindows = @(Get-Windows ($(if ($a.process) { $a.process } else { 'SSE' })))
    Emit ([pscustomobject]@{ ok = $true; windows = @($listedWindows) })
  }

  'center_cases' {
    $hwnd = Resolve-SteuertippsCenterWindow $a
    $canary = Test-Canary $hwnd
    if (-not $canary.ok) {
      Fail "Steuertipps-Center antwortet zu langsam ($($canary.ms) ms); Fallliste waere unzuverlaessig." 'degraded'
    }
    $tree = Walk-Tree $hwnd 3000 45 20 -WithValues -WithScroll
    $nodes = @($tree.nodes)
    $pathNode = @($nodes | Where-Object {
      $_.type -eq 'Text' -and $_.aid -like '*.m_currentDataPathLabel'
    })
    $listNode = @($nodes | Where-Object {
      $_.type -eq 'List' -and $_.aid -like '*.m_taxFilesView'
    })
    if ($pathNode.Count -ne 1 -or $listNode.Count -ne 1) {
      Fail 'Steuertipps-Center zeigt nicht die erwartete Verzeichnis-Fallliste.' 'unexpected-page'
    }
    $directoryToggle = @($nodes | Where-Object {
      $_.type -eq 'CheckBox' -and $_.aid -like '*.m_buttonStorageDirectory'
    })
    $recentToggle = @($nodes | Where-Object {
      $_.type -eq 'CheckBox' -and $_.aid -like '*.m_buttonStorageRecent'
    })
    $search = @($nodes | Where-Object {
      $_.type -eq 'Edit' -and $_.aid -like '*.m_searchTaxFilesLineEdit'
    })
    $sort = @($nodes | Where-Object {
      $_.type -eq 'ComboBox' -and $_.aid -like '*.m_sortTaxFilesComboBox'
    })
    $viewRadios = @($nodes | Where-Object {
      $_.type -eq 'RadioButton' -and $_.aid -like '*.m_switchViewGroupBox.*'
    })
    $caseNodes = @($nodes | Where-Object {
      $_.type -eq 'ListItem' -and $_.aid -like '*.m_taxFilesView' -and $_.name
    } | Sort-Object y, x)
    $dir = [string]$pathNode[0].name
    if (-not [IO.Directory]::Exists($dir)) {
      Fail "Das im Center angezeigte Verzeichnis existiert nicht mehr: '$dir'." 'stale-directory'
    }

    # Das Center blendet Backups, Protokolle und Folgejahr-GewErfass aus. Der
    # Kontrollbestand bildet deshalb nur dieselben primaeren ESt-/Gew-Faelle.
    $centerTypes = @('ESt','Gew')
    $diskFiles = @($centerTypes | ForEach-Object {
      $centerGlob = '*.' + [string]$_ + [string]$script:SSE_TAX_YEAR
      [IO.Directory]::GetFiles($dir, $centerGlob, [IO.SearchOption]::TopDirectoryOnly)
    } | Where-Object { Test-SSEProfileCaseFileName $_ $false $centerTypes } | Sort-Object)
    $diskCases = @($diskFiles | ForEach-Object {
      $caseMatch = Get-SSECaseFileMatch $_
      [pscustomobject]@{
        name = [IO.Path]::GetFileNameWithoutExtension($_)
        datei = [IO.Path]::GetFileName($_)
        typ = $(if ([string]$caseMatch.Groups['type'].Value -ieq 'ESt') { 'Einkommensteuer' } else { 'Gewinn/Umsatz/Gewerbesteuer' })
        pfad = $_
      }
    })
    $diskByName = @{}
    foreach ($entry in $diskCases) {
      $key = $entry.name.ToLowerInvariant()
      if (-not $diskByName.ContainsKey($key)) { $diskByName[$key] = New-Object System.Collections.ArrayList }
      $null = $diskByName[$key].Add($entry)
    }
    $cases = @($caseNodes | ForEach-Object {
      $caseKey = $_.name.ToLowerInvariant()
      $matchedEntries = @()
      if ($diskByName.ContainsKey($caseKey)) { $matchedEntries = @($diskByName[$caseKey]) }
      [pscustomobject]@{
        name = $_.name
        datei = $(if ($matchedEntries.Count -eq 1) { $matchedEntries[0].datei } else { $null })
        typ = $(if ($matchedEntries.Count -eq 1) { $matchedEntries[0].typ } else { $null })
        ausgewaehlt = $_.selected
        dateiEindeutig = [bool]($matchedEntries.Count -eq 1)
      }
    })
    $uiNames = @($cases | ForEach-Object { $_.name.ToLowerInvariant() } | Sort-Object -Unique)
    $diskNames = @($diskCases | ForEach-Object { $_.name.ToLowerInvariant() } | Sort-Object -Unique)
    $onlyUi = @($uiNames | Where-Object { $_ -notin $diskNames })
    $onlyDisk = @($diskNames | Where-Object { $_ -notin $uiNames })
    $directoryActive = [bool]($directoryToggle.Count -eq 1 -and $directoryToggle[0].checked -eq $true)
    Emit ([pscustomobject]@{
      ok = $true; hwnd = [int64]$hwnd; canaryMs = $canary.ms
      modus = $(if ($directoryActive) { 'Verzeichnis' } elseif ($recentToggle.Count -eq 1 -and $recentToggle[0].checked -eq $true) { 'Zuletzt verwendet' } else { 'unbekannt' })
      verzeichnis = $dir
      suche = $(if ($search.Count -eq 1) { [string]$search[0].val } else { $null })
      sortierung = $(if ($sort.Count -eq 1) { [string]$sort[0].val } else { $null })
      ansicht = $(if (@($viewRadios | Where-Object { $_.selected -eq $true }).Count -eq 1) {
        $viewAid = @($viewRadios | Where-Object { $_.selected -eq $true })[0].aid
        if ($viewAid -like '*.m_activateTaxFilesIconListButton') { 'Symbole' }
        elseif ($viewAid -like '*.m_activateTaxFilesListViewButton') { 'Liste' }
        else { 'unbekannt' }
      } else { 'unbekannt' })
      faelle = $cases
      dateisystemFaelle = $diskCases
      nurImCenter = $onlyUi
      nurImDateisystem = $onlyDisk
      konsistent = [bool]($directoryActive -and -not $onlyUi.Count -and -not $onlyDisk.Count -and @($cases | Where-Object { -not $_.dateiEindeutig }).Count -eq 0)
      snapshot = $tree.stats
      hinweis = 'Read-only: Es wurde kein Fall geoeffnet, verschoben oder geloescht.'
    })
  }

  'center_refresh' {
    $hwnd = Resolve-SteuertippsCenterWindow $a
    $expectedDir = Get-NormalizedDirectoryPath ([string](Arg $a 'expectedDirectory'))
    $before = Walk-Tree $hwnd 3000 45 20 -WithValues
    $beforePath = @($before.nodes | Where-Object { $_.type -eq 'Text' -and $_.aid -like '*.m_currentDataPathLabel' })
    $beforeDirectory = @($before.nodes | Where-Object { $_.type -eq 'CheckBox' -and $_.aid -like '*.m_buttonStorageDirectory' })
    $beforeRecent = @($before.nodes | Where-Object { $_.type -eq 'CheckBox' -and $_.aid -like '*.m_buttonStorageRecent' })
    if ($beforePath.Count -ne 1 -or $beforeDirectory.Count -ne 1 -or $beforeRecent.Count -ne 1) {
      Fail 'Center-Verzeichnisumschalter sind nicht eindeutig erreichbar.' 'unexpected-page'
    }
    $actualDir = Get-NormalizedDirectoryPath ([string]$beforePath[0].name)
    if (-not $actualDir.Equals($expectedDir, [StringComparison]::OrdinalIgnoreCase)) {
      Fail "Center zeigt '$actualDir' statt des erwarteten Verzeichnisses '$expectedDir'." 'precondition-failed'
    }
    if ($beforeDirectory[0].checked -ne $true) {
      Fail "Center ist nicht im erwarteten Modus 'Verzeichnis'." 'precondition-failed'
    }
    $searchBefore = @($before.nodes | Where-Object { $_.type -eq 'Edit' -and $_.aid -like '*.m_searchTaxFilesLineEdit' })
    $sortBefore = @($before.nodes | Where-Object { $_.type -eq 'ComboBox' -and $_.aid -like '*.m_sortTaxFilesComboBox' })
    $namesBefore = @($before.nodes | Where-Object { $_.type -eq 'ListItem' -and $_.aid -like '*.m_taxFilesView' -and $_.name } |
      Sort-Object y, x | ForEach-Object { $_.name })

    $recentElement = Get-LiveElement $hwnd $beforeRecent[0].rid
    $recentToggle = $null
    if (-not $recentElement -or -not $recentElement.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern, [ref]$recentToggle)) {
      Fail "Center-Schalter 'Zuletzt verwendet' bietet kein TogglePattern." 'unsupported'
    }
    $recentToggle.Toggle()
    Start-Sleep -Milliseconds 350
    $mid = Walk-Tree $hwnd 3000 45 20 -WithValues
    $midRecent = @($mid.nodes | Where-Object { $_.type -eq 'CheckBox' -and $_.aid -like '*.m_buttonStorageRecent' })
    $midDirectory = @($mid.nodes | Where-Object { $_.type -eq 'CheckBox' -and $_.aid -like '*.m_buttonStorageDirectory' })
    if ($midRecent.Count -ne 1 -or $midDirectory.Count -ne 1 -or $midRecent[0].checked -ne $true) {
      Fail "Center hat 'Zuletzt verwendet' nicht eindeutig aktiviert; Verzeichnis nicht blind erneut geschaltet." 'postcondition-failed'
    }
    $directoryElement = Get-LiveElement $hwnd $midDirectory[0].rid
    $directoryToggle = $null
    if (-not $directoryElement -or -not $directoryElement.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern, [ref]$directoryToggle)) {
      Fail "Center-Schalter 'Verzeichnis' bietet kein TogglePattern." 'unsupported'
    }
    $directoryToggle.Toggle()
    Start-Sleep -Milliseconds 700
    $after = Walk-Tree $hwnd 3000 45 20 -WithValues
    $afterPath = @($after.nodes | Where-Object { $_.type -eq 'Text' -and $_.aid -like '*.m_currentDataPathLabel' })
    $afterDirectory = @($after.nodes | Where-Object { $_.type -eq 'CheckBox' -and $_.aid -like '*.m_buttonStorageDirectory' })
    $searchAfter = @($after.nodes | Where-Object { $_.type -eq 'Edit' -and $_.aid -like '*.m_searchTaxFilesLineEdit' })
    $sortAfter = @($after.nodes | Where-Object { $_.type -eq 'ComboBox' -and $_.aid -like '*.m_sortTaxFilesComboBox' })
    $namesAfter = @($after.nodes | Where-Object { $_.type -eq 'ListItem' -and $_.aid -like '*.m_taxFilesView' -and $_.name } |
      Sort-Object y, x | ForEach-Object { $_.name })
    if ($afterPath.Count -ne 1 -or $afterDirectory.Count -ne 1 -or $afterDirectory[0].checked -ne $true) {
      Fail "Center ist nach der Aktualisierung nicht wieder sicher im Modus 'Verzeichnis'." 'postcondition-failed'
    }
    $finalDir = Get-NormalizedDirectoryPath ([string]$afterPath[0].name)
    if (-not $finalDir.Equals($expectedDir, [StringComparison]::OrdinalIgnoreCase)) {
      Fail "Center-Verzeichnis hat sich unerwartet zu '$finalDir' geaendert." 'postcondition-failed'
    }
    $searchSame = [bool]($searchBefore.Count -eq $searchAfter.Count -and
      $(if ($searchBefore.Count -eq 1) { [string]$searchBefore[0].val -eq [string]$searchAfter[0].val } else { $true }))
    $sortSame = [bool]($sortBefore.Count -eq $sortAfter.Count -and
      $(if ($sortBefore.Count -eq 1) { [string]$sortBefore[0].val -eq [string]$sortAfter[0].val } else { $true }))
    if (-not $searchSame -or -not $sortSame) {
      Fail 'Center-Suche oder Sortierung hat sich bei der Aktualisierung unerwartet geaendert.' 'postcondition-failed'
    }
    Emit ([pscustomobject]@{
      ok=$true; hwnd=[int64]$hwnd; verzeichnis=$finalDir
      vorher=$namesBefore; nachher=$namesAfter
      entfernt=@($namesBefore | Where-Object { $_ -notin $namesAfter })
      hinzugekommen=@($namesAfter | Where-Object { $_ -notin $namesBefore })
      sucheUnveraendert=$searchSame; sortierungUnveraendert=$sortSame
      hinweis="Nur die Center-Ansicht wurde aktualisiert; kein Steuerfall wurde geoeffnet oder veraendert."
    })
  }

  'window_restore' {
    # Nur ein exakt zuvor gelesenes, verifiziertes SSE-Hauptfenster aus seinem
    # minimierten Zustand holen. Keine Tastatur, keine Maus, keine Koordinaten
    # und keine Steuerdatenoperation sind Teil dieses engen Win32-Vertrags.
    $pidRaw = Arg $a 'pid'
    $hwndRaw = Arg $a 'hwnd'
    $titleFingerprint = ([string](Arg $a 'titleFingerprint')).ToUpperInvariant()
    if ($null -eq $pidRaw -or $null -eq $hwndRaw -or $titleFingerprint -notmatch '^[A-F0-9]{64}$') {
      Fail 'pid, hwnd und der 64-stellige titleFingerprint aus sse_windows sind Pflicht.' 'bad-args'
    }
    $targetPid = [int](Get-SSEBoundedIntegerArg $a 'pid' 0 1 2147483647)
    $targetHwnd = [int64](Get-SSEBoundedIntegerArg $a 'hwnd' 0 1 9007199254740991)
    $beforeWindows = @(Get-Windows 'SSE' | Where-Object { [int]$_.pid -eq $targetPid })
    $beforeTarget = @($beforeWindows | Where-Object { [int64]$_.hwnd -eq $targetHwnd })
    if ($beforeTarget.Count -ne 1) {
      Fail 'Das exakt an PID und HWND gebundene SSE-Fenster existiert nicht mehr.' 'stale-window'
    }
    $mainCandidates = @((Get-SSEMainWindowCandidates $beforeWindows) | Where-Object {
      [int]$_.pid -eq $targetPid -and [int64]$_.hwnd -eq $targetHwnd
    })
    if ($mainCandidates.Count -ne 1) {
      Fail 'Das exakt adressierte Fenster ist kein bestaetigtes SSE-Hauptfenster.' 'blocked'
    }
    $targetBefore = $beforeTarget[0]
    $actualTitleFingerprint = ([string]$targetBefore.titleFingerprint).ToUpperInvariant()
    if ($actualTitleFingerprint -ne $titleFingerprint) {
      Fail "Fenstertitel-Fingerprint hat sich geaendert: '$actualTitleFingerprint' statt '$titleFingerprint'." 'precondition-failed'
    }
    $peerSetBefore = Get-SSEPeerWindowSet $beforeWindows $targetPid ([IntPtr]$targetHwnd)

    if (-not $targetBefore.minimiert) {
      Emit ([pscustomobject]@{
        ok=$true; pid=$targetPid; hwnd=$targetHwnd; titleFingerprint=$actualTitleFingerprint
        restored=$false; alreadyRestored=$true; minimizedBefore=$false; minimizedAfter=$false
        method='none-already-restored'; peerWindowsUnchanged=$true
        peerWindowCount=$peerSetBefore.windows.Count
        peerFingerprintBefore=$peerSetBefore.fingerprint; peerFingerprintAfter=$peerSetBefore.fingerprint
        verified=$true
      })
    }

    [SW]::ShowWindow([IntPtr]$targetHwnd, 9) | Out-Null # SW_RESTORE
    Start-Sleep -Milliseconds ([Math]::Min(10000, [Math]::Max(300, [int](Arg $a 'waitMs' 800))))

    $afterWindows = @(Get-Windows 'SSE' | Where-Object { [int]$_.pid -eq $targetPid })
    $afterTargetMatches = @($afterWindows | Where-Object { [int64]$_.hwnd -eq $targetHwnd })
    $afterTarget = $(if ($afterTargetMatches.Count -eq 1) { $afterTargetMatches[0] } else { $null })
    $afterMainCandidates = @((Get-SSEMainWindowCandidates $afterWindows) | Where-Object {
      [int]$_.pid -eq $targetPid -and [int64]$_.hwnd -eq $targetHwnd
    })
    $peerSetAfter = Get-SSEPeerWindowSet $afterWindows $targetPid ([IntPtr]$targetHwnd)
    $peerWindowsUnchanged = [bool](
      $peerSetAfter.windows.Count -eq $peerSetBefore.windows.Count -and
      $peerSetAfter.fingerprint -eq $peerSetBefore.fingerprint
    )
    $targetUnchanged = [bool](
      $afterTarget -and $afterTargetMatches.Count -eq 1 -and $afterMainCandidates.Count -eq 1 -and
      [int]$afterTarget.pid -eq $targetPid -and [int64]$afterTarget.hwnd -eq $targetHwnd -and
      ([string]$afterTarget.cls -ceq [string]$targetBefore.cls) -and
      ([string]$afterTarget.titleFingerprint).ToUpperInvariant() -eq $actualTitleFingerprint
    )
    $restored = [bool]($targetUnchanged -and -not [bool]$afterTarget.minimiert)
    if (-not $restored -or -not $peerWindowsUnchanged) {
      Emit ([pscustomobject]@{
        ok=$false; kind='postcondition-failed'; error='Hauptfenster-Restore oder unveraenderter Peer-Fenstersatz ist nicht vollstaendig bewiesen; keine Wiederholung.'
        pid=$targetPid; hwnd=$targetHwnd; titleFingerprint=$actualTitleFingerprint
        restored=$restored; minimizedBefore=$true
        minimizedAfter=$(if ($afterTarget) { [bool]$afterTarget.minimiert } else { $null })
        targetUnchanged=$targetUnchanged; peerWindowsUnchanged=$peerWindowsUnchanged
        peerWindowCountBefore=$peerSetBefore.windows.Count; peerWindowCountAfter=$peerSetAfter.windows.Count
        peerFingerprintBefore=$peerSetBefore.fingerprint; peerFingerprintAfter=$peerSetAfter.fingerprint
      })
    }
    Emit ([pscustomobject]@{
      ok=$true; pid=$targetPid; hwnd=$targetHwnd; titleFingerprint=$actualTitleFingerprint
      restored=$true; alreadyRestored=$false; minimizedBefore=$true; minimizedAfter=$false
      method='ShowWindow(SW_RESTORE)'; targetUnchanged=$true; peerWindowsUnchanged=$true
      peerWindowCount=$peerSetAfter.windows.Count
      peerFingerprintBefore=$peerSetBefore.fingerprint; peerFingerprintAfter=$peerSetAfter.fingerprint
      verified=$true
    })
  }

  'window_close' {
    # Nur ein im aktiven Page-Object-Katalog explizit freigegebenes,
    # nicht-modales Nebenfenster schliessen. Hauptfenster, modale Dialoge und
    # unbekannte Fenster haben absichtlich eigene, strengere Werkzeuge.
    $hwndRaw = Arg $a 'hwnd'
    $pidRaw = Arg $a 'pid'
    $expectedTitle = [string](Arg $a 'expectedTitle')
    $titleFingerprint = ([string](Arg $a 'titleFingerprint')).ToUpperInvariant()
    if (-not $hwndRaw -or $null -eq $pidRaw -or ([bool]$expectedTitle -eq [bool]$titleFingerprint)) {
      Fail 'pid, hwnd und genau eines von titleFingerprint oder expectedTitle sind Pflicht.' 'bad-args'
    }
    $targetPid = [int](Get-SSEBoundedIntegerArg $a 'pid' 0 1 2147483647)
    $beforeWindows = @(Get-Windows 'SSE' | Where-Object { [int]$_.pid -eq $targetPid })
    $beforeHwnds = @($beforeWindows | ForEach-Object { [int64]$_.hwnd })
    $descInventory = @(Get-DialogInventory $targetPid)
    $desc = @($descInventory | Where-Object {
      [int]$_.pid -eq $targetPid -and [int64]$_.hwnd -eq [int64]$hwndRaw
    })
    if ($desc.Count -ne 1) { Fail 'Das exakt adressierte Fenster existiert nicht mehr.' 'stale' }
    $win = $desc[0]
    $actualTitleFingerprint = ([string]$win.titleFingerprint).ToUpperInvariant()
    if ($titleFingerprint -and $actualTitleFingerprint -ne $titleFingerprint) {
      Fail "Fenstertitel-Fingerprint hat sich geaendert: '$actualTitleFingerprint' statt '$titleFingerprint'." 'precondition-failed'
    }
    if ($expectedTitle -and $win.title -cne $expectedTitle) {
      Fail "Fenstertitel hat sich geaendert: '$($win.title)' statt '$expectedTitle'." 'precondition-failed'
    }
    $windowPolicy = Resolve-SSEClosableNonmodalWindowPolicy $win
    $blockingBefore = @($descInventory | Where-Object { $_.kind -in @('native-dialog','qt-dialog') })
    if (-not $windowPolicy -or $win.kind -notin @('tips','known-nonmodal') -or $win.cls -notmatch '^Qt' -or
        -not (Test-SSESafeAuxiliaryDescriptor $win) -or $blockingBefore.Count -or
        (Test-Versand ([string]$win.title))) {
      Fail "Fensterart '$($win.kind)' ist nicht als bekanntes, dialogfreies Page-Object-Nebenfenster freigegeben. Hauptfenster mit sse_close, Dialoge mit sse_dialog_answer behandeln." 'blocked'
    }
    $beforePeers = @($beforeWindows | Where-Object { [int64]$_.hwnd -ne [int64]$hwndRaw } | ForEach-Object {
      [pscustomobject]@{
        hwnd=[int64]$_.hwnd; pid=[int]$_.pid; cls=[string]$_.cls
        titleFingerprint=([string]$_.titleFingerprint).ToUpperInvariant()
      }
    })
    $res = [IntPtr]::Zero
    $sent = [SW]::SendMessageTimeout([IntPtr][int64]$hwndRaw, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero, 0x0002, 5000, [ref]$res)
    if (-not $sent) { Fail 'WM_CLOSE konnte nicht sicher zugestellt werden.' 'timeout' }
    Start-Sleep -Milliseconds ([Math]::Min(10000, [Math]::Max(300, [int](Arg $a 'waitMs' 800))))
    $closed = -not [SW]::IsWindow([IntPtr][int64]$hwndRaw)
    $afterWindows = @(Get-Windows 'SSE' | Where-Object { [int]$_.pid -eq $targetPid })
    $newWindows = @($afterWindows | Where-Object { [int64]$_.hwnd -notin $beforeHwnds } | ForEach-Object {
      [pscustomobject]@{ hwnd=[int64]$_.hwnd; titleFingerprint=([string]$_.titleFingerprint).ToUpperInvariant() }
    })
    $missingOrChangedPeers = @($beforePeers | Where-Object {
      $beforePeer = $_
      $same = @($afterWindows | Where-Object { [int64]$_.hwnd -eq [int64]$beforePeer.hwnd })
      $same.Count -ne 1 -or [int]$same[0].pid -ne [int]$beforePeer.pid -or
        [string]$same[0].cls -cne [string]$beforePeer.cls -or
        ([string]$same[0].titleFingerprint).ToUpperInvariant() -ne [string]$beforePeer.titleFingerprint
    })
    $newDialogs = @(Get-DialogInventory $targetPid | Where-Object { $_.kind -in @('native-dialog','qt-dialog') })
    $onlyTargetRemoved = [bool]($closed -and $afterWindows.Count -eq ($beforeWindows.Count - 1) -and
      -not $newWindows.Count -and -not $missingOrChangedPeers.Count -and -not $newDialogs.Count)
    if (-not $onlyTargetRemoved) {
      Emit ([pscustomobject]@{
        ok = $false; kind = 'postcondition-failed'; hwnd = [int64]$hwndRaw
        pid=$targetPid; titleFingerprint = $actualTitleFingerprint; closed = $closed
        newWindows=$newWindows; missingOrChangedPeers=@($missingOrChangedPeers | ForEach-Object { $_.hwnd }); newDialogs = $newDialogs
        error = 'Nebenfenster wurde nicht als einzige Fensteraenderung dialogfrei geschlossen; keine Wiederholung.'
      })
    }
    Emit ([pscustomobject]@{
      ok = $true; pid=$targetPid; hwnd = [int64]$hwndRaw; titleFingerprint = $actualTitleFingerprint
      windowId=[string]$windowPolicy.id; windowRole=[string]$windowPolicy.role
      closed = $true; onlyTargetRemoved=$true; verified = $true
    })
  }

  'result_details' {
    # Das Werte-Info-Fenster ist eine echte Qt-Tabelle und vollstaendig per UIA
    # lesbar. Falls es noch nicht offen ist, wird ausschliesslich der bekannte
    # Mehr-Details-Knopf der Ergebnisanzeige aktiviert; Steuerdaten werden dabei
    # weder geaendert noch gespeichert.
    $openIfNeeded = [bool](Arg $a 'openIfNeeded' $true)
    $opened = $false
    $wins = @(Get-Windows 'SSE')
    $main = Resolve-SSEMainWindowDescriptor $a $wins -RestoreMinimized
    $targetPid = [int]$main.pid
    $mainHwnd = [IntPtr][int64]$main.hwnd
    $wins = @(Get-Windows 'SSE')
    $valueWindows = @($wins | Where-Object {
      $_.title -eq 'Werte-Info: Werte vergleichen - Was wäre wenn' -and
      [int]$_.pid -eq $targetPid
    })
    if (-not $valueWindows.Count -and $openIfNeeded) {
      $tree = Walk-Tree $mainHwnd 5000 60 20 -WithValues
      $buttons = @($tree.nodes | Where-Object {
        $_.type -eq 'Button' -and $_.aid -like '*TaxResultsWidgetSSE*hoverBtnMehrDetails'
      })
      if ($buttons.Count -ne 1) {
        Fail "Mehr-Details-Knopf der Ergebnisanzeige nicht eindeutig gefunden ($($buttons.Count) Treffer)." 'not-found'
      }
      $element = Get-LiveElement $mainHwnd $buttons[0].rid
      $invoked = $false
      try {
        $invoke = $null
        if ($element -and $element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
          $invoke.Invoke(); $invoked = $true
        }
      } catch { }
      if (-not $invoked) { $null = Click-VerifiedPoint $mainHwnd $buttons[0] }
      Start-Sleep -Milliseconds 900
      $opened = $true
      $wins = @(Get-Windows 'SSE')
      $valueWindows = @($wins | Where-Object {
        $_.title -eq 'Werte-Info: Werte vergleichen - Was wäre wenn' -and
        [int]$_.pid -eq $targetPid
      })
    }
    if (-not $valueWindows.Count) {
      Fail 'Werte-Info ist nicht offen. openIfNeeded=true verwenden oder rechts unten Mehr Details aufklappen.' 'precondition-failed'
    }
    if ($valueWindows.Count -ne 1) {
      Fail "Werte-Info ist nicht eindeutig ($($valueWindows.Count) Fenster)." 'ambiguous'
    }

    $window = $valueWindows[0]
    $hwnd = [IntPtr][int64]$window.hwnd
    $tree = Walk-Tree $hwnd 4000 80 20 -WithValues -WithScroll
    $result = Read-ResultDetailsFromTree $tree
    Emit ([pscustomobject]@{
      ok = $true
      geoeffnet = $opened
      fenster = [pscustomobject]@{ hwnd=[int64]$window.hwnd; title=$window.title; w=$window.w; h=$window.h }
      spalten = [pscustomobject]@{
        beobachteterWert='Beobachteter Wert'; aktuell='Aktuell'
        festgehalten='Festgehaltener Vergleichswert'; differenz='Differenz'
        uiaKopfzeilen=$result.uiaKopfzeilen
      }
      zeilen = @($result.zeilen)
      anzahl = $result.anzahl
      vollstaendig = $result.vollstaendig
      fingerprint = $result.fingerprint
      unvollstaendigeZeilen = @($result.unvollstaendigeZeilen)
      nichtPositionierteZellenAnzahl = $result.nichtPositionierteZellenAnzahl
      kopfVollstaendig = $result.kopfVollstaendig
      vergleichsInvariantGeprueft = $result.vergleichsInvariantGeprueft
      vergleichsInvariantFehler = @($result.vergleichsInvariantFehler)
      vertikalUnvollstaendig = $result.vertikalUnvollstaendig
      hinweis = 'Festgehalten ist der Vergleichsstand der Was-waere-wenn-Ansicht; Differenz zeigt Aktuell minus Vergleichsstand.'
    })
  }

  'case_hash' {
    $pathRaw = [string](Arg $a 'path')
    if (-not $pathRaw) { Fail 'path fehlt' 'bad-args' }
    $path = [IO.Path]::GetFullPath($pathRaw)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail "Falldatei fehlt: $path" 'not-found' }
    if (-not (Test-SSEProfileCaseFileName $path $true)) {
      Fail "Falldatei gehoert nicht zum freigegebenen Profil '$($script:SSE_PROFILE_ID)'." 'unsupported-case'
    }
    $item = Get-Item -LiteralPath $path
    $summary = Get-CaseSummary $path
    Emit ([pscustomobject]@{
      ok = $true; path = $path; exists = $true; size = $item.Length
      mtimeUtc = $item.LastWriteTimeUtc.ToString('o'); sha256 = Get-Sha256 $path
      header = $(if ($summary) { $summary.header } else { $null })
      transmitted = $(if ($summary) { $summary.transmitted } else { $null })
      transmittedReason = $(if ($summary) { $summary.transmittedReason } else { "Kopfparser nicht verfuegbar: $script:CASE_SUMMARY_ERROR" })
    })
  }

  'dialog_list' {
    $requestedPid = [int](Arg $a 'pid' 0)
    $inventory = @(Get-DialogInventory $requestedPid | ForEach-Object {
      [pscustomobject]@{
        hwnd = $_.hwnd; pid = $_.pid; cls = $_.cls; title = $_.title; kind = $_.kind
        x = $_.x; y = $_.y; w = $_.w; h = $_.h; minimiert = $_.minimiert
        buttons = $_.buttons; texts = $_.texts; fingerprint = $_.fingerprint
        uiaReadOk = $_.uiaReadOk; uiaError = $_.uiaError; msaaReadOk = $_.msaaReadOk; msaaError = $_.msaaError
      }
    })
    Emit ([pscustomobject]@{
      ok = $true; count = $inventory.Count
      dialogs = @($inventory | Where-Object { $_.kind -in @('native-dialog','qt-dialog') })
      windows = $inventory
    })
  }

  'dialog_answer' {
    $hwndRaw = Arg $a 'hwnd'
    $fingerprint = ([string](Arg $a 'fingerprint')).ToUpperInvariant()
    $buttonName = [string](Arg $a 'button')
    $requestedButtonName = $buttonName
    if (-not $hwndRaw -or -not $fingerprint -or -not $buttonName) {
      Fail 'hwnd, fingerprint und button sind Pflicht.' 'bad-args'
    }
    if ($buttonName -notin $script:DIALOG_BUTTONS) { Fail "Dialogantwort '$buttonName' ist nicht freigegeben." 'blocked' }
    # Nur das gebundene Zielfenster tief beschreiben. Ein kompletter
    # Get-DialogInventory-Lauf liest jedes Qt-Nebenfenster per UIA/MSAA und
    # kostete bei geoeffneter Werte-Info in der Praxis bis zu 90 Sekunden.
    $windowsBefore = @(Get-Windows 'SSE')
    $targetWindows = @($windowsBefore | Where-Object { [int64]$_.hwnd -eq [int64]$hwndRaw })
    if ($targetWindows.Count -ne 1) { Fail 'Dialog-Handle existiert nicht mehr oder ist nicht eindeutig.' 'stale' }
    $mainBeforeWindow = @((Get-SSEMainWindowCandidates $windowsBefore) | Where-Object {
      [int]$_.pid -eq [int]$targetWindows[0].pid
    } | Select-Object -First 1)
    $mainBeforeHwnd = $(if ($mainBeforeWindow.Count) { [IntPtr][int64]$mainBeforeWindow[0].hwnd } else { [IntPtr]::Zero })
    $dialog = Get-DialogDescriptor $targetWindows[0] $mainBeforeHwnd
    if ($dialog.kind -notin @('native-dialog','qt-dialog')) { Fail "Fensterart '$($dialog.kind)' ist kein beantwortbarer Dialog." 'blocked' }
    if ($dialog.fingerprint -ne $fingerprint) {
      Emit ([pscustomobject]@{
        ok = $false; kind = 'fingerprint-mismatch'; error = 'Dialog hat sich seit dem Lesen geaendert; NICHT geklickt.'
        expectedFingerprint = $fingerprint; actualFingerprint = $dialog.fingerprint
        title = $dialog.title; buttons = $dialog.buttons; texts = $dialog.texts
      })
    }
    # Nie einen verdeckten Eltern-Dialog beantworten. Besonders der CSV-Export
    # behaelt sein Qt-Fenster offen, waehrend ein nativer Ordnerdialog obenauf
    # liegt. Ein Klick auf das Elternfenster kann SSE zum Absturz bringen.
    if ($mainBeforeHwnd -ne [IntPtr]::Zero) {
      $topPopup = Get-SSEDeepestLastActivePopup $mainBeforeHwnd
      if ($topPopup -ne $mainBeforeHwnd -and [int64]$topPopup -ne [int64]$dialog.hwnd) {
        Fail "Dialog ist nicht der oberste aktive Dialog. Zuerst HWND $([int64]$topPopup) lesen und beantworten." 'non-topmost-dialog'
      }
      if ($topPopup -eq $mainBeforeHwnd -and [SW]::GetForegroundWindow() -ne [IntPtr][int64]$dialog.hwnd) {
        $otherPotentialDialogs = @($windowsBefore | Where-Object {
          [int]$_.pid -eq [int]$dialog.pid -and [int64]$_.hwnd -ne [int64]$mainBeforeHwnd -and
          [int64]$_.hwnd -ne [int64]$dialog.hwnd -and $_.title -notlike 'Werte-Info:*' -and
          $_.title -notlike 'Steuer-Spar-Tipp*'
        })
        if ($otherPotentialDialogs.Count) {
          Fail 'Oberster Dialog ist ohne sichere Owner-Kette mehrdeutig; Zustand neu mit sse_dialog_list lesen.' 'non-topmost-dialog'
        }
      }
    }
    # Kompatibilitaet fuer bereits laufende MCP-Clients, deren Schema die neue
    # explizite Antwort noch nicht kennt. Nur dieser exakt betitelte lokale
    # Wiederherstellungsdialog darf das bereits freigegebene 'Übernehmen' als
    # Alias verwenden; alle anderen Dialoge behalten die alte Bedeutung.
    if ($dialog.title -eq 'Sicherungsdatei öffnen' -and $buttonName -eq 'Übernehmen') {
      $buttonName = 'Wiederherstellen'
    }
    if ($dialog.title -like 'Export für das Finanzamt (*.csv)*' -and $buttonName -eq 'Übernehmen') {
      $buttonName = 'Klicken Sie hier, um Ihre Daten zu exportieren'
    }
    if ($dialog.title -eq 'Aktualisierung fehlgeschlagen!' -and $buttonName -eq 'Übernehmen') {
      $buttonName = 'Datei neu zuordnen'
    }
    foreach ($probe in @($dialog.title) + @($dialog.texts) + @($dialog.buttons | ForEach-Object { $_.name })) {
      if ($probe -and (Test-Versand $probe) -and
          -not (Test-SSEKnownPassiveTransmissionNotice $dialog $buttonName $probe)) {
        Fail "GESPERRT: Dialoginhalt '$probe' hat Uebermittlungsbezug." 'blocked'
      }
    }
    $expectedBodyFingerprint = ([string](Arg $a 'bodyFingerprint')).ToUpperInvariant()
    $isWarningDialog = $dialog.title -like 'Die Prüfung hat ergeben*'
    if ($isWarningDialog -and -not $expectedBodyFingerprint) {
      Fail 'Automatischer Pruefhinweis braucht zusaetzlich den bodyFingerprint aus sse_warning_popup_read.' 'bad-args'
    }
    if (-not $isWarningDialog -and $expectedBodyFingerprint) {
      Fail 'bodyFingerprint ist nur fuer automatische Pruefhinweise zulaessig.' 'bad-args'
    }
    if ($isWarningDialog) {
      $bodyToken = [Guid]::NewGuid().ToString('N')
      $bodyImagePath = Join-Path $env:TEMP "sse-warning-$bodyToken.png"
      $bodyOcr = $null; $bodyCleanup = $null
      try {
        $null = Take-Shot ([IntPtr][int64]$dialog.hwnd) $bodyImagePath
        $bodyOcr = Invoke-WindowsOcr $bodyImagePath
      } finally { $bodyCleanup = Remove-SSETemporaryFile $bodyImagePath }
      if (-not $bodyCleanup.removed) {
        Fail "Warnungsbild konnte vor der Dialogantwort nicht geloescht werden: $($bodyCleanup.error)" 'temp-cleanup'
      }
      if (-not $bodyOcr -or -not $bodyOcr.ok -or -not [string]$bodyOcr.text) {
        $bodyOcrMessage = $(if ($bodyOcr -and $bodyOcr.error) { $bodyOcr.error } else { 'OCR lieferte keinen Fliesstext.' })
        Fail "Warnungsinhalt konnte unmittelbar vor der Antwort nicht erneut gelesen werden: $bodyOcrMessage" 'dialog-unreadable'
      }
      $actualBodyFingerprint = Get-SSETextSha256 ([string]$bodyOcr.text)
      if ($actualBodyFingerprint -ne $expectedBodyFingerprint) {
        Emit ([pscustomobject]@{
          ok = $false; kind = 'body-fingerprint-mismatch'
          error = 'OCR-Fliesstext hat sich seit dem Lesen geaendert; NICHT geklickt.'
          expectedBodyFingerprint = $expectedBodyFingerprint; actualBodyFingerprint = $actualBodyFingerprint
          title = $dialog.title; hwnd = [int64]$dialog.hwnd
        })
      }
    }
    $buttonInfo = @($dialog.buttons | Where-Object { $_.name -eq $buttonName -and $_.enabled })
    if ($buttonInfo.Count -ne 1) { Fail "$($buttonInfo.Count) aktive Schaltflaechen '$buttonName' im Dialog gefunden." 'ambiguous' }
    $dirtyBefore = $(if ($mainBeforeWindow.Count) { Get-DirtyStateFast $mainBeforeHwnd } else { $null })
    $beforeHandles = @{}; foreach ($w in $windowsBefore) { $beforeHandles[[int64]$w.hwnd] = $true }
    try { $method = Invoke-DialogButtonInfo $dialog $buttonInfo[0] }
    catch { Fail "Dialogschaltflaeche konnte nicht sicher ausgeloest werden: $($_.Exception.Message)" 'stale' }
    Start-Sleep -Milliseconds ([int](Arg $a 'waitMs' 900))
    $closed = -not [SW]::IsWindow([IntPtr][int64]$dialog.hwnd)
    $windowsAfter = @(Get-Windows 'SSE')
    $newWindows = @($windowsAfter | Where-Object { -not $beforeHandles.ContainsKey([int64]$_.hwnd) })
    $mainAfterWindow = @($windowsAfter | Where-Object {
      [int64]$_.hwnd -eq [int64]$mainBeforeHwnd -and [int]$_.pid -eq [int]$dialog.pid
    } | Select-Object -First 1)
    $newDialogs = @($newWindows | ForEach-Object {
      $described = Get-DialogDescriptor $_ $mainBeforeHwnd
      if ($described.kind -in @('native-dialog','qt-dialog')) {
        [pscustomobject]@{
          hwnd = $described.hwnd; pid = $described.pid; cls = $described.cls; title = $described.title; kind = $described.kind
          buttons = $described.buttons; texts = $described.texts; fingerprint = $described.fingerprint
          uiaReadOk = $described.uiaReadOk; uiaError = $described.uiaError; msaaReadOk = $described.msaaReadOk; msaaError = $described.msaaError
        }
      }
    })
    $dirtyAfter = $(if ($mainAfterWindow.Count) { Get-DirtyStateFast $mainBeforeHwnd } else { $null })
    $dirtyIntroduced = $(if ($null -ne $dirtyBefore -and $null -ne $dirtyAfter) { -not [bool]$dirtyBefore -and [bool]$dirtyAfter } else { $null })
    $allowsChildDialog = ($dialog.title -like 'Export für das Finanzamt (*.csv)*' -and
      $buttonName -eq 'Klicken Sie hier, um Ihre Daten zu exportieren')
    if (-not $closed -and -not ($allowsChildDialog -and $newDialogs.Count -eq 1)) {
      $currentWindow = @($windowsAfter | Where-Object { [int64]$_.hwnd -eq [int64]$dialog.hwnd } | Select-Object -First 1)
      $current = $(if ($currentWindow.Count) { Get-DialogDescriptor $currentWindow[0] $mainBeforeHwnd } else { $null })
      Emit ([pscustomobject]@{
        ok = $false; kind = 'postcondition-failed'; error = 'Dialog blieb nach der Antwort offen; keine Wiederholung.'
        button = $buttonName; method = $method; dialog = $current; newDialogs = $newDialogs
      })
    }
    if ($allowsChildDialog -and -not $closed) {
      $topAfter = Get-SSEDeepestLastActivePopup $mainBeforeHwnd
      if ($newDialogs.Count -ne 1 -or [int64]$topAfter -ne [int64]$newDialogs[0].hwnd) {
        Emit ([pscustomobject]@{
          ok = $false; kind = 'postcondition-failed'
          error = 'Export-Dialog blieb offen, aber der erwartete einzelne oberste Ordnerdialog ist nicht eindeutig; keine Wiederholung.'
          button = $buttonName; method = $method; newDialogs = $newDialogs; topPopupHwnd = [int64]$topAfter
        })
      }
    }
    $lightWindows = @($windowsAfter | ForEach-Object {
      [pscustomobject]@{
        hwnd = $_.hwnd; pid = $_.pid; cls = $_.cls; title = $_.title
        x = $_.x; y = $_.y; w = $_.w; h = $_.h; minimiert = $_.minimiert; haengt = $_.haengt
      }
    })
    Emit ([pscustomobject]@{
      ok = $true; answered = $buttonName; requestedAnswer = $requestedButtonName; method = $method; hwnd = [int64]$dialog.hwnd
      closed = [bool]$closed; advancedToChildDialog = [bool](-not $closed -and $allowsChildDialog); verified = $true
      ungespeichertVorher = $dirtyBefore; ungespeichertNachher = $dirtyAfter; ungespeichertEingefuehrt = $dirtyIntroduced
      newDialogs = $newDialogs
      windows = $lightWindows
    })
  }

  'warning_popup_read' {
    # Das Qt-Fenster "Die Pruefung hat ergeben ..." exponiert Ueberschrift,
    # Meldungstitel und Aktionen per UIA, nicht aber den erklaerenden
    # Fliesstext. Daher genau dieses verifizierte Fenster lokal fotografieren
    # und den fehlenden Text per Windows-OCR ergaenzen.
    $expectedPid = 0
    $requestedDialogHwnd = [int64]0
    $requestedHwnd = Arg $a 'hwnd'
    if ($requestedHwnd) {
      [SW]::GetWindowThreadProcessId([IntPtr][int64]$requestedHwnd, [ref]$expectedPid) | Out-Null
      if (-not $expectedPid) { Fail 'Das angegebene SSE-Fenster existiert nicht mehr.' 'stale' }
      $requestedWindow = @(Get-Windows 'SSE' | Where-Object { [int64]$_.hwnd -eq [int64]$requestedHwnd })
      if ($requestedWindow.Count -eq 1 -and $requestedWindow[0].title -like 'Die Prüfung hat ergeben*') {
        $requestedDialogHwnd = [int64]$requestedHwnd
      }
    }
    $dialogs = @(Get-DialogInventory | Where-Object {
      $_.title -like 'Die Prüfung hat ergeben*' -and
      (-not $expectedPid -or [int]$_.pid -eq [int]$expectedPid) -and
      (-not $requestedDialogHwnd -or [int64]$_.hwnd -eq $requestedDialogHwnd)
    })
    if (-not $dialogs.Count) {
      Emit ([pscustomobject]@{
        ok = $true; active = $false; warnings = @(); actions = @(); text = ''; bildBase64 = $null
        hinweis = 'Kein offenes Fenster "Die Pruefung hat ergeben ..." gefunden.'
      })
    }
    if ($dialogs.Count -ne 1) { Fail "Warnfenster ist nicht eindeutig ($($dialogs.Count) Treffer)." 'ambiguous' }
    $dialog = $dialogs[0]
    if (-not $dialog.uiaReadOk -or -not $dialog.tree) {
      Fail "Warnfenster ist aktiv, aber sein UIA-Baum war nicht lesbar: $($dialog.uiaError)" 'dialog-unreadable'
    }
    $warnings = @($dialog.tree.nodes | Where-Object { $_.type -eq 'TreeItem' -and $_.name } |
      ForEach-Object { ($_.name -replace '\s+', ' ').Trim() } | Where-Object { $_ } | Select-Object -Unique)
    $actions = @($dialog.buttons | Where-Object { $_.enabled } | ForEach-Object { $_.name } | Select-Object -Unique)
    if (-not $warnings.Count -or -not $actions.Count) {
      Fail ("Warnfenster ist aktiv, aber Titel/Aktionen sind unvollstaendig " +
            "(Warnungen=$($warnings.Count), Aktionen=$($actions.Count), UIA-Fehler='$($dialog.uiaError)', MSAA-Fehler='$($dialog.msaaError)').") 'dialog-unreadable'
    }
    $useOcr = [bool](Arg $a 'ocr' $true)
    $includeImage = [bool](Arg $a 'includeImage' $false)
    $ocr = $null; $imageBase64 = $null; $bodyFingerprint = $null
    if ($useOcr) {
      $token = [Guid]::NewGuid().ToString('N')
      $imagePath = Join-Path $env:TEMP "sse-warning-$token.png"
      $warningCleanup = $null
      try {
        $null = Take-Shot ([IntPtr][int64]$dialog.hwnd) $imagePath
        $ocr = Invoke-WindowsOcr $imagePath
        if ($ocr.ok -and [string]$ocr.text) {
          $bodyFingerprint = Get-SSETextSha256 ([string]$ocr.text)
          if ($includeImage) { $imageBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($imagePath)) }
        }
      } finally {
        $warningCleanup = Remove-SSETemporaryFile $imagePath
      }
      if (-not $warningCleanup.removed) {
        Fail "Warnungsbild konnte nach OCR nicht geloescht werden: $($warningCleanup.error)" 'temp-cleanup'
      }
      if (-not $ocr -or -not $ocr.ok -or -not [string]$ocr.text) {
        $ocrMessage = $(if ($ocr -and $ocr.error) { $ocr.error } else { 'OCR lieferte keinen Fliesstext.' })
        Fail "Warnfenster ist aktiv, aber der nicht exponierte Fliesstext blieb unlesbar: $ocrMessage" 'dialog-unreadable'
      }
    }
    Emit ([pscustomobject]@{
      ok = $true; active = $true; hwnd = [int64]$dialog.hwnd; pid = [int]$dialog.pid
      title = $dialog.title; fingerprint = $dialog.fingerprint
      warnings = $warnings; actions = $actions
      leseweg = $(if ($useOcr) { 'uia-title-actions-plus-ocr-body' } else { 'uia-title-actions' })
      ocrVerwendet = $useOcr; ocrOk = $(if ($useOcr) { [bool]$ocr.ok } else { $null })
      sprache = $(if ($useOcr) { $ocr.language } else { $null })
      zeilen = $(if ($useOcr) { $ocr.lineCount } else { 0 })
      text = $(if ($useOcr) { [string]$ocr.text } else { '' })
      bodyFingerprint = $bodyFingerprint; ocrFehler = $(if ($useOcr) { $ocr.error } else { $null })
      bildBase64 = $imageBase64
      uiaReadOk = $dialog.uiaReadOk; uiaError = $dialog.uiaError; msaaReadOk = $dialog.msaaReadOk; msaaError = $dialog.msaaError
      hinweis = $(if ($useOcr) { 'Fliesstext ist in Qt weder per UIA, RawView noch MSAA strukturiert verfuegbar; OCR ist hier der verifizierte Rueckfall.' }
                  else { 'Nur strukturierte Warnungstitel und Aktionen gelesen; OCR wurde auf Wunsch uebersprungen.' })
    })
  }

  'screenshot' {
    $hwnd = Resolve-Window $a
    $path = $(if ($a.path) { $a.path } else { Join-Path $env:TEMP "sse-$(Get-Date -Format 'HHmmss').png" })
    $r = Take-Shot $hwnd $path
    Emit ([pscustomobject]@{ ok = $true; hwnd = [int64]$hwnd; shot = $r })
  }

  'snapshot' {
    $maxNodes = Get-SSEBoundedIntegerArg $a 'maxNodes' 4000 1 5000
    $hwnd = Resolve-Window $a
    $can = Test-Canary $hwnd
    if (-not $can.ok) { Fail "Kanarienvogel traege ($($can.ms) ms) - Programm ueberlastet, Ergebnisse waeren unzuverlaessig. Neu starten." 'degraded' }
    $t = Walk-Tree $hwnd $maxNodes -WithValues
    $nodes = $t.nodes
    if ($a.minX -ne $null) { $nodes = @($nodes | Where-Object { $_.x -ge [int]$a.minX }) }
    if ($a.maxX -ne $null) { $nodes = @($nodes | Where-Object { $_.x -le [int]$a.maxX }) }
    if ($a.types)          { $nodes = @($nodes | Where-Object { $a.types -contains $_.type }) }
    if ($a.namedOnly)      { $nodes = @($nodes | Where-Object { $_.name }) }
    Emit ([pscustomobject]@{ ok = $true; hwnd = [int64]$hwnd; canaryMs = $can.ms; stats = $t.stats; count = $nodes.Count; nodes = $nodes })
  }

  'snapshot_compare' {
    # Read-only A/B-Diagnose fuer den Bulk-Cache. Private Namen/Werte werden
    # verglichen, aber niemals ausgegeben; Beispiele enthalten nur oeffentliche
    # AutomationIds und ControlTypes.
    $hwnd = Resolve-Window $a
    $canary = Test-Canary $hwnd
    if (-not $canary.ok) { Fail "Kanarienvogel traege ($($canary.ms) ms)." 'degraded' }
    $legacyWatch = [Diagnostics.Stopwatch]::StartNew()
    $legacy = Walk-TreeLegacy $hwnd 5000 60 20 -WithValues
    $legacyMs = $legacyWatch.ElapsedMilliseconds
    $repetitions = [Math]::Max(1, [Math]::Min(10, [int](Arg $a 'repetitions' 3)))
    $bulkRuns = New-Object System.Collections.ArrayList
    $bulk = $null
    for ($runIndex = 0; $runIndex -lt $repetitions; $runIndex++) {
      $bulkWatch = [Diagnostics.Stopwatch]::StartNew()
      $bulk = Get-UiSnapshot $hwnd 5000 60 20 -WithValues
      $null = $bulkRuns.Add($bulkWatch.ElapsedMilliseconds)
    }
    $bulkMs = [int]$bulkRuns[-1]
    $canaryAfter = Test-Canary $hwnd
    $legacyByRid = @{}; foreach ($node in @($legacy.nodes)) { if ($node.rid) { $legacyByRid[$node.rid] = $node } }
    $bulkByRid = @{}; foreach ($node in @($bulk.nodes)) { if ($node.rid) { $bulkByRid[$node.rid] = $node } }
    $missing = New-Object System.Collections.ArrayList
    $extra = New-Object System.Collections.ArrayList
    $metadataMismatch = New-Object System.Collections.ArrayList
    $valueMismatch = New-Object System.Collections.ArrayList
    foreach ($rid in $legacyByRid.Keys) {
      if (-not $bulkByRid.ContainsKey($rid)) {
        $n = $legacyByRid[$rid]; $null = $missing.Add([pscustomobject]@{ type=$n.type; aid=$n.aid }); continue
      }
      $old = $legacyByRid[$rid]; $new = $bulkByRid[$rid]
      $oldMeta = @($old.type,$old.name,$old.aid,$old.x,$old.y,$old.w,$old.h,[bool]$old.on) -join '|'
      $newMeta = @($new.type,$new.name,$new.aid,$new.x,$new.y,$new.w,$new.h,[bool]$new.on) -join '|'
      if ($oldMeta -ne $newMeta) { $null = $metadataMismatch.Add([pscustomobject]@{ type=$old.type; aid=$old.aid }) }
      if ($old.type -in @('Edit','ComboBox','Spinner') -and
          ((-not (Test-SSEScalarEqual $old.val $new.val)) -or $old.ro -ne $new.ro)) {
        $null = $valueMismatch.Add([pscustomobject]@{ type=$old.type; aid=$old.aid })
      }
    }
    foreach ($rid in $bulkByRid.Keys) {
      if (-not $legacyByRid.ContainsKey($rid)) { $n = $bulkByRid[$rid]; $null = $extra.Add([pscustomobject]@{ type=$n.type; aid=$n.aid }) }
    }
    $equivalent = (-not $missing.Count -and -not $extra.Count -and -not $metadataMismatch.Count -and -not $valueMismatch.Count)
    Emit ([pscustomobject]@{
      ok=$true; equivalent=[bool]$equivalent; hwnd=[int64]$hwnd
      legacy=[pscustomobject]@{ count=@($legacy.nodes).Count; ms=$legacyMs; stats=$legacy.stats }
      bulk=[pscustomobject]@{ count=@($bulk.nodes).Count; ms=$bulkMs; runs=@($bulkRuns); stats=$bulk.stats }
      canaryAfter=$canaryAfter
      missingCount=$missing.Count; extraCount=$extra.Count
      metadataMismatchCount=$metadataMismatch.Count; valueMismatchCount=$valueMismatch.Count
      samples=[pscustomobject]@{
        missing=@($missing | Select-Object -First 5); extra=@($extra | Select-Object -First 5)
        metadata=@($metadataMismatch | Select-Object -First 5); values=@($valueMismatch | Select-Object -First 5)
      }
      privateValuesReturned=$false
    })
  }

  'read_page' {
    $requestedMinX = $(if ($null -ne (Arg $a 'minX')) { Get-SSEBoundedIntegerArg $a 'minX' 0 -1000000 1000000 } else { $null })
    $requestedMaxX = $(if ($null -ne (Arg $a 'maxX')) { Get-SSEBoundedIntegerArg $a 'maxX' 0 -1000000 1000000 } else { $null })
    if ($null -ne $requestedMinX -and $null -ne $requestedMaxX -and $requestedMinX -gt $requestedMaxX) {
      Fail 'maxX muss groesser oder gleich minX sein.' 'bad-args'
    }
    $hwnd = Resolve-Window $a
    $can = Test-Canary $hwnd
    if (-not $can.ok) { Fail "Kanarienvogel traege ($($can.ms) ms) - neu starten." 'degraded' }
    $t = Walk-Tree $hwnd -WithValues
    $b = Get-ContentBounds $t $hwnd
    $minX = $(if ($null -ne $requestedMinX) { $requestedMinX } else { $b.minX })
    $maxX = $(if ($null -ne $requestedMaxX) { $requestedMaxX } else { $b.maxX })
    $keep = @('Text','DataItem','Edit','CheckBox','Header','RadioButton','Button','Hyperlink','ComboBox')
    # Ein Knoten zaehlt, wenn er eine Beschriftung ODER einen Feldwert hat.
    $rows = @($t.nodes | Where-Object {
      ($_.name -or ($null -ne $_.val -and "$($_.val)".Trim())) -and
      $_.x -ge $minX -and $_.x -le $maxX -and $keep -contains $_.type
    } | Sort-Object y, x)
    # Beschriftung und Wert eines Feldes zu einem Text zusammenfassen
    $cellText = {
      param($n)
      $hasVal = ($null -ne $n.val -and "$($n.val)".Trim())
      if ($n.name -and $hasVal) { "$($n.name) = $($n.val)" }
      elseif ($hasVal)          { "$($n.val)" }
      else                      { $n.name }
    }
    # Zeilenbildung gegen den ANKER der Zeile, nicht gegen den Vorgaenger.
    # Sonst verketten sich Elemente transitiv: bei Y = 100, 111, 122 liegen
    # zwischen erstem und letztem 22 px, jeder Einzelschritt aber nur 11 -
    # und ein Betrag landet bei der falschen Beschriftung.
    # Zusaetzlich zaehlt echte vertikale Ueberlappung der Rechtecke.
    $tol = 12
    $lines = New-Object System.Collections.ArrayList
    $cur = @(); $anker = $null
    $gleicheZeile = {
      param($n, $ank)
      if ($null -eq $ank) { return $true }
      if ([Math]::Abs($n.y - $ank.y) -le $tol) { return $true }
      # Ueberlappen sich die Rechtecke zu mehr als der Haelfte der kleineren Hoehe?
      $o = [Math]::Min($n.y + $n.h, $ank.y + $ank.h) - [Math]::Max($n.y, $ank.y)
      $minH = [Math]::Max(1, [Math]::Min($n.h, $ank.h))
      return ($o -gt $minH / 2)
    }
    foreach ($r in $rows) {
      if ($cur.Count -and -not (& $gleicheZeile $r $anker)) {
        $null = $lines.Add([pscustomobject]@{ y = $anker.y; cells = @($cur | ForEach-Object { & $cellText $_ }) })
        $cur = @(); $anker = $null
      }
      if (-not $cur.Count) { $anker = $r }
      $cur += $r
    }
    if ($cur.Count) { $null = $lines.Add([pscustomobject]@{ y = $anker.y; cells = @($cur | ForEach-Object { & $cellText $_ }) }) }
    # Ueberschrift: erster Text im Arbeitsbereich unterhalb der Dialog-Symbolleiste
    $r0 = New-Object SW+RC; [SW]::GetWindowRect($hwnd, [ref]$r0) | Out-Null
    $headTop = $r0.T + 190; $headBot = $r0.T + 290
    $head = ($t.nodes | Where-Object { $_.type -eq 'Text' -and $_.x -ge $minX -and $_.x -le $maxX -and
                                       $_.y -ge $headTop -and $_.y -le $headBot } |
             Sort-Object y | Select-Object -First 1).name
    Emit ([pscustomobject]@{ ok = $true; heading = $head; bounds = $b; lines = @($lines); stats = $t.stats })
  }

  'read_table' {
    $hwnd = Resolve-Window $a
    $t = Walk-BoundTree $hwnd
    # Kopfzellen bestimmen die Spalten. Doppelte Kopfnamen (Qt liefert sie
    # gelegentlich zweifach) werden ueber die X-Position zusammengefasst.
    $rohHeads = @($t.nodes | Where-Object { $_.type -eq 'Header' -and $_.name -and $_.w -gt 0 } | Sort-Object x)
    $heads = @()
    foreach ($h in $rohHeads) {
      if (-not $heads.Count -or [Math]::Abs($h.x - $heads[-1].x) -gt 8) { $heads += $h }
    }
    $cells = @($t.nodes | Where-Object { $_.type -eq 'DataItem' -and $_.w -gt 0 } | Sort-Object y, x)

    # Zellen den Spalten ueber die X-Position zuordnen, NICHT ueber die
    # Reihenfolge. Qt liefert fuer leere Textzellen teils gar kein DataItem -
    # bei reiner Reihenfolge rutschen dann alle Folgespalten eine nach links
    # und ein Betrag steht unter 'Bezeichnung'.
    function SpalteVon($x) {
      if (-not $heads.Count) { return -1 }
      $best = 0; $dist = [int]::MaxValue
      for ($i = 0; $i -lt $heads.Count; $i++) {
        $d = [Math]::Abs($x - $heads[$i].x)
        if ($d -lt $dist) { $dist = $d; $best = $i }
      }
      $best
    }

    $rows = New-Object System.Collections.ArrayList
    $cur = $null; $anker = -9999
    $abschluss = {
      if ($null -ne $cur) { $null = $rows.Add(@($cur)) }
    }
    foreach ($c in $cells) {
      if ($null -eq $cur -or [Math]::Abs($c.y - $anker) -gt 10) {
        & $abschluss
        $anker = $c.y
        $cur = @($null) * [Math]::Max(1, $heads.Count)
      }
      $idx = SpalteVon $c.x
      if ($idx -ge 0 -and $idx -lt $cur.Count) { $cur[$idx] = $c.name } else { $cur += $c.name }
    }
    & $abschluss

    Emit ([pscustomobject]@{
      ok = $true
      headers = @($heads | ForEach-Object { $_.name })
      rows = @($rows); rowCount = $rows.Count
      # Fremde Fenster ausweisen. Frueher lieferte read_table bei geoeffneter
      # Werte-Info deren Tabelle als Seiteninhalt - ohne jeden Hinweis.
      ausgeschlosseneFenster = @($t.fremdeFenster)
      # Baumstatistik mitliefern: bei abgeschnittenem Baum sind Zeilen
      # verloren gegangen und das Ergebnis waere still unvollstaendig.
      stats = $t.stats
      incomplete = [bool]$t.stats.truncated
      note = $(if ($t.stats.truncated) {
        'Baumlauf wurde abgeschnitten - es fehlen moeglicherweise Zeilen.' } else {
        'Nur die SICHTBAREN Zeilen. Qt virtualisiert Tabellen: mehr Zeilen erscheinen erst, wenn der Cursor sie in den Blick holt (Pfeiltaste).' })
    })
  }

  'find' {
    $hwnd = Resolve-Window $a
    $t = Walk-Tree $hwnd
    $q     = [string](Arg $a 'name')
    $sub   = [bool](Arg $a 'contains' $false)
    $wantT = [string](Arg $a 'type')
    $wantA = [string](Arg $a 'aid')
    if (-not $q -and -not $wantA -and -not $wantT) { Fail 'sse_find braucht name, aid oder type.' 'bad-args' }
    if ($sub -and -not $q) { Fail 'sse_find contains=true ist nur zusammen mit name erlaubt.' 'bad-args' }
    $hits = @($t.nodes | Where-Object {
      $nameHit = -not $q -or $(if ($sub) { $_.name -like "*$q*" } else { $_.name -eq $q })
      $aidHit = -not $wantA -or $_.aid -eq $wantA -or $_.aid -like "*$wantA"
      $nameHit -and $aidHit -and (-not $wantT -or $_.type -eq $wantT)
    })
    # Baumstatistik mitliefern. Ein abgeschnittener Baum liefert sonst
    # 'count: 0' - das sieht aus wie "gibt es nicht", ist aber "nicht gesucht".
    Emit ([pscustomobject]@{
      ok = $true; count = $hits.Count; hits = $hits; stats = $t.stats
      incomplete = [bool]$t.stats.truncated
      note = $(if ($t.stats.truncated) {
        'ACHTUNG: Der Baumlauf wurde abgeschnitten. "Nicht gefunden" ist hier KEIN Beweis fuer Abwesenheit.' })
    })
  }

  'click' {
    $name = [string](Arg $a 'name')
    $aid  = [string](Arg $a 'aid')
    $pattern = [string](Arg $a 'pattern' 'invoke')
    if (-not $name -and -not $aid -and -not (Arg $a 'rid')) { Fail 'Eines von name, aid oder rid wird gebraucht.' 'bad-args' }
    if ($pattern -eq 'toggle') {
      Fail 'Direktes TogglePattern ist gesperrt. Checkboxen ausschliesslich mit sse_toggle und Seiten-/Vor-/Nachzustandsvertrag setzen.' 'blocked'
    }
    $waitMs = Get-SSEBoundedIntegerArg $a 'waitMs' 1200 100 10000
    # Sperre greift auf dem Namen UND der AutomationId - sonst waere sie
    # ueber die aid-Adressierung trivial zu umgehen.
    foreach ($probe in @($name, $aid)) {
      if ($probe -and (Test-Versand $probe)) {
        Fail "GESPERRT: '$probe' koennte Daten ans Finanzamt uebermitteln. Dieser Server loest das nicht aus." 'blocked'
      }
    }
    Assert-SSEDestructiveAcknowledgement $a @($name, $aid)
    $hwnd = [IntPtr][int64](Resolve-SSEMainWindowDescriptor $a -RestoreMinimized).hwnd
    $can = Test-Canary $hwnd
    if (-not $can.ok) { Fail "Kanarienvogel traege ($($can.ms) ms) - neu starten." 'degraded' }
    $t = Walk-Tree $hwnd -WithValues:($pattern -eq 'select')
    $isNavigation = $name -in @('Weiter', 'Zurück')
    $headingBefore = Get-CurrentHeading $hwnd $t
    $dirtyBefore = Get-DirtyStateFast $hwnd
    $expectedPageBefore = [string](Arg $a 'expectedPageBefore' (Arg $a 'headingBefore'))
    $expectedPageAfter = [string](Arg $a 'expectedPageAfter')
    $hasPagePostcondition = [bool]$expectedPageAfter
    if ($expectedPageBefore -and $headingBefore -ne $expectedPageBefore) {
      Fail ("Vorbedingung verletzt: aktuelle Seite ist '$headingBefore', erwartet wurde " +
            "'$expectedPageBefore'. NICHT ausgeloest.") 'precondition-failed'
    }
    $targetPid = 0
    [SW]::GetWindowThreadProcessId($hwnd, [ref]$targetPid) | Out-Null
    $dialogsBefore = @()
    if ($isNavigation -or $hasPagePostcondition) {
      $dialogsBefore = @(Get-DialogInventory | Where-Object {
        [int]$_.pid -eq $targetPid -and $_.kind -in @('native-dialog','qt-dialog')
      })
      if ($dialogsBefore.Count) {
        Emit ([pscustomobject]@{
          ok=$false; kind='navigation-blocked'
          error='Vor der Navigation ist bereits ein modaler Dialog offen; es wurde nichts ausgeloest.'
          clicked=$null; pattern=[string](Arg $a 'pattern' 'invoke'); kandidaten=0
          ueberschriftVorher=$headingBefore; ueberschriftNachher=$headingBefore
          navigiert=$false; verified=$false
          dialoge=@($dialogsBefore | ForEach-Object {
            [pscustomobject]@{ hwnd=$_.hwnd; title=$_.title; fingerprint=$_.fingerprint; buttons=$_.buttons }
          })
          naechsterSchritt='Dialog mit sse_dialog_list bzw. sse_warning_popup_read lesen und fingerprintgebunden beantworten.'
        })
      }
    }
    $cands = @(Resolve-Nodes $t $a)
    if (-not $cands.Count) { Fail "Element '$(if($name){$name}else{$aid})' nicht gefunden. Achtung: bei traegem Programm kann das eine Falschmeldung sein - vorher sse_health pruefen." 'not-found' }
    if ((Arg $a 'contains') -eq $true -and $cands.Count -ne 1) {
      Fail "Teilstringsuche ist nicht eindeutig ($($cands.Count) Treffer); nichts ausgeloest." 'ambiguous'
    }
    $radioGroupPrefix = ''; $radioBefore = @(); $radioPreviouslySelected = $null; $radioSelectionMethod = $null
    $radioGuardUserInput = $false; $radioInputBaseline = $null; $radioInteractionBefore = $null
    if ($pattern -eq 'select') {
      if (-not $aid) {
        Fail 'Radio-Auswahl braucht die exakte AutomationId; ein Name wie Ja/Nein ist nicht eindeutig genug.' 'bad-args'
      }
      if ($cands.Count -ne 1 -or $cands[0].type -ne 'RadioButton') {
        Fail ('SelectionItemPattern ist nur fuer genau einen per AutomationId gebundenen RadioButton zulaessig. ' +
              'Dropdowns mit sse_combo_select aendern; TreeItems physisch navigieren.') 'blocked'
      }
      $radioAid = [string]$cands[0].aid
      $lastDot = $radioAid.LastIndexOf('.')
      if ($lastDot -le 0) { Fail 'RadioButton besitzt keine bindbare Gruppen-AutomationId.' 'unreadable' }
      $radioGroupPrefix = $radioAid.Substring(0, $lastDot)
      $radioBefore = @($t.nodes | Where-Object {
        $_.type -eq 'RadioButton' -and $_.aid -like "$radioGroupPrefix.*"
      })
      if ($radioBefore.Count -lt 2 -or @($radioBefore | Where-Object { $_.selected -eq $true }).Count -ne 1 -or
          @($radioBefore | Where-Object { $_.selected -isnot [bool] }).Count) {
        Fail 'Radio-Gruppe hat vor der Aenderung keinen eindeutig lesbaren Exklusivzustand; nichts geaendert.' 'precondition-failed'
      }
      $radioPreviouslySelected = @($radioBefore | Where-Object { $_.selected -eq $true })[0]
      $radioDialogsBefore = @(Get-DialogInventory | Where-Object {
        [int]$_.pid -eq $targetPid -and $_.kind -in @('native-dialog','qt-dialog')
      })
      if ($radioDialogsBefore.Count) {
        Fail 'Ein modaler Dialog ist offen; RadioButton nicht geaendert.' 'precondition-failed'
      }
      $radioGuardUserInput = [bool](-not $script:DESKTOP_NAME)
      $radioInputBaseline = $(if ($radioGuardUserInput) { Get-SSELastInputTick } else { $null })
      if ($radioGuardUserInput -and $null -eq $radioInputBaseline) {
        Fail 'Windows-Eingabe-Epoche ist nicht lesbar; RadioButton nicht geaendert.' 'precondition-failed'
      }
      $radioInteractionBefore = Get-SSEInteractionWindowSet $targetPid $hwnd
      if ($radioGuardUserInput -and -not (Test-SSELastInputUnchanged $radioInputBaseline)) {
        Fail 'Fremde Benutzereingabe unmittelbar vor der Radio-Auswahl erkannt. NICHT geaendert.' 'interference'
      }
    }
    $letzterFehler = ''
    $erfolg = $null
    foreach ($node in $cands) {
      # Auch der getroffene Knoten wird geprueft (Adressierung per rid/aid).
      foreach ($probe in @($node.name, $node.aid)) {
        if ($probe -and (Test-Versand $probe)) {
          Fail "GESPERRT: Das getroffene Element ('$probe') koennte uebermitteln." 'blocked'
        }
      }
      Assert-SSEDestructiveAcknowledgement $a @($node.name, $node.aid)
      $el = Get-LiveElement $hwnd $node.rid
      if (-not $el) { $letzterFehler = 'Knoten nicht mehr greifbar'; continue }
      try {
        switch ($pattern) {
          'invoke'   { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
          'select'   {
            # Qt kann SelectionItemPattern.Select sichtbar bestaetigen, ohne
            # die fachliche Aenderungslogik des Formulars auszufuehren. Ein
            # RadioButton wird deshalb auf dem sichtbaren Desktop immer ueber
            # seinen PID-/Root-verifizierten Mittelpunkt aktiviert und danach
            # als komplette Exklusivgruppe rueckgelesen.
            if ($script:DESKTOP_NAME) {
              Fail ("Radio-Auswahl braucht einen verifizierten physischen Klick; auf dem versteckten " +
                    "Desktop '$($script:DESKTOP_NAME)' bleibt sie fail-closed.") 'hidden-desktop'
            }
            $null = Click-VerifiedPoint $hwnd $node
            $radioSelectionMethod = 'verified-point'
            $radioInputBaseline = Get-SSELastInputTick
            Start-Sleep -Milliseconds 80
            if ($null -eq $radioInputBaseline -or -not (Test-SSELastInputUnchanged $radioInputBaseline)) {
              Emit ([pscustomobject]@{
                ok=$false; kind='interference'
                error='Fremde Benutzereingabe unmittelbar nach dem verifizierten Radio-Klick erkannt.'
                pageBefore=$headingBefore; radio=[pscustomobject]@{ aid=$node.aid; name=$node.name }
                rollback=[pscustomobject]@{ versucht=$false; grund='Kein blinder Rollback nach Benutzereingriff.' }
              })
            }
          }
          'expand'   { $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand() }
          'collapse' { $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Collapse() }
          default    { Fail "Unbekanntes Pattern '$pattern'" 'bad-args' }
        }
        $erfolg = $node
        break
      } catch {
        $letzterFehler = $_.Exception.Message.Split("`n")[0]
        continue   # naechster Kandidat: gleiche Beschriftung, anderer Typ
      }
    }
    if (-not $erfolg) {
      Fail "Pattern '$pattern' bei '$name' fehlgeschlagen ($($cands.Count) Kandidaten geprueft): $letzterFehler" 'pattern-failed'
    }
    Start-Sleep -Milliseconds $waitMs

    # Manche Qt-Schaltflaechen melden ein erfolgreiches InvokePattern, fuehren
    # ihre Navigation aber nur bei einem echten Mausklick aus. Nur wenn der
    # Aufrufer eine exakte Zielseite gebunden hat, die Ausgangsseite weiterhin
    # unveraendert ist, kein Dialog erschien und das Ziel frisch noch genau
    # einmal als Button existiert, darf sichtbar PID-/Root-verifiziert geklickt
    # werden. Dadurch gibt es weder einen blinden Doppelklick noch Scheinerfolg.
    $activationMethod = $(if ($radioSelectionMethod) { $radioSelectionMethod } else { 'uia-invoke' })
    if ($hasPagePostcondition -and -not $isNavigation -and $pattern -eq 'invoke') {
      $probeTree = Walk-Tree $hwnd 900
      $probeHeading = Get-CurrentHeading $hwnd $probeTree
      if ($probeHeading -ne $expectedPageAfter) {
        $probeDialogs = @(Get-DialogInventory | Where-Object {
          [int]$_.pid -eq $targetPid -and $_.kind -in @('native-dialog','qt-dialog')
        })
        if (-not $probeDialogs.Count -and $probeHeading -eq $headingBefore) {
          if ($script:DESKTOP_NAME) {
            Fail ("Qt-Button blieb nach InvokePattern auf '$headingBefore'. Der verifizierte " +
                  "Mausklick-Fallback ist auf dem versteckten Desktop gesperrt.") 'hidden-desktop'
          }
          $freshCandidates = @(Resolve-Nodes $probeTree $a | Where-Object { $_.type -in @('Button','Text','Hyperlink') })
          if ($freshCandidates.Count -ne 1) {
            Fail ("Qt-Aktion blieb nach InvokePattern wirkungslos und ist fuer den sicheren " +
                  "Mausklick-Fallback nicht mehr eindeutig ($($freshCandidates.Count) Treffer).") 'postcondition-failed'
          }
          $fallbackLive = Get-LiveElement $hwnd $freshCandidates[0].rid $freshCandidates[0].aid
          $fallbackInvoke = $null
          if (-not $fallbackLive -or
              -not $fallbackLive.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$fallbackInvoke)) {
            Fail 'Qt-Aktion exponiert vor dem Mausklick-Fallback kein InvokePattern mehr.' 'postcondition-failed'
          }
          $null = Click-VerifiedPoint $hwnd $freshCandidates[0]
          $activationMethod = 'uia-invoke+verified-point-fallback'
          Start-Sleep -Milliseconds $waitMs
        }
      }
    }

    $radioVerified = $null
    if ($pattern -eq 'select') {
      $radioTreeAfter = Walk-Tree $hwnd -WithValues
      $radioHeadingAfter = Get-CurrentHeading $hwnd $radioTreeAfter
      $radioAfter = @($radioTreeAfter.nodes | Where-Object {
        $_.type -eq 'RadioButton' -and $_.aid -like "$radioGroupPrefix.*"
      })
      $radioTargetAfter = @($radioAfter | Where-Object { $_.aid -eq $erfolg.aid })
      $radioInteractionAfter = Get-SSEInteractionWindowSet $targetPid $hwnd
      $radioInputChanged = [bool]($radioGuardUserInput -and -not (Test-SSELastInputUnchanged $radioInputBaseline))
      $radioWindowChanged = [bool]($radioInteractionAfter.fingerprint -ne $radioInteractionBefore.fingerprint)
      $radioPageChanged = [bool]($radioHeadingAfter -ne $headingBefore)
      $radioBindingChanged = [bool]($radioTargetAfter.Count -ne 1)
      if ($radioInputChanged -or $radioWindowChanged -or $radioPageChanged -or $radioBindingChanged) {
        Emit ([pscustomobject]@{
          ok=$false; kind='interference'
          error='Benutzereingabe, Fensterlage, Seite oder RadioButton-Bindung veraenderte sich waehrend der Auswahl.'
          pageBefore=$headingBefore; pageAfter=$radioHeadingAfter
          radio=[pscustomobject]@{ aid=$erfolg.aid; name=$erfolg.name }
          inputGuard=[pscustomobject]@{ aktiv=$radioGuardUserInput; baseline=$radioInputBaseline; beobachtet=$(Get-SSELastInputTick); eingriffErkannt=$radioInputChanged }
          windowGuard=[pscustomobject]@{ vorher=$radioInteractionBefore.fingerprint; nachher=$radioInteractionAfter.fingerprint; geaendert=$radioWindowChanged }
          rollback=[pscustomobject]@{ versucht=$false; grund='Kein blinder Rollback nach Eingabe-, Fenster-, Seiten- oder Binding-Interferenz.' }
        })
      }
      $radioVerified = [bool](
        $radioTargetAfter.Count -eq 1 -and $radioTargetAfter[0].selected -eq $true -and
        @($radioAfter | Where-Object { $_.selected -eq $true }).Count -eq 1 -and
        @($radioAfter | Where-Object { $_.selected -isnot [bool] }).Count -eq 0
      )
      if (-not $radioVerified) {
        # Nur dann zuruecksetzen, wenn exakt der selbst gesetzte Zielzustand
        # noch sichtbar ist. Fremde oder unlesbare Zwischenzustaende werden
        # nicht blind ueberschrieben.
        $radioSelectedAfter = @($radioAfter | Where-Object { $_.selected -eq $true })
        $rollbackOk = [bool](
          $radioSelectedAfter.Count -eq 1 -and
          $radioSelectedAfter[0].aid -eq $radioPreviouslySelected.aid
        )
        $rollbackAttempted = $false
        $rollbackReason = $(if ($rollbackOk) { 'Ausgangsoption blieb ausgewählt.' } else { $null })
        if (-not $rollbackOk -and $radioSelectedAfter.Count -eq 1 -and $radioSelectedAfter[0].aid -eq $erfolg.aid) {
          $rollbackAttempted = $true
          try {
            $rollbackWindows = Get-SSEInteractionWindowSet $targetPid $hwnd
            if ($rollbackWindows.fingerprint -ne $radioInteractionBefore.fingerprint -or
                ($radioGuardUserInput -and -not (Test-SSELastInputUnchanged $radioInputBaseline))) {
              throw 'Eingabe- oder Fensterinterferenz vor Radio-Rollback erkannt.'
            }
            $targetLive = Get-LiveElement $hwnd $radioTargetAfter[0].rid $radioTargetAfter[0].aid
            $targetPattern = $null
            if (-not $targetLive -or
                -not $targetLive.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$targetPattern) -or
                -not [bool]$targetPattern.Current.IsSelected) {
              throw 'RadioButton zeigt vor Rollback nicht mehr exakt den selbst gesetzten Zustand.'
            }
            $rollbackOld = @($radioAfter | Where-Object { $_.aid -eq $radioPreviouslySelected.aid })
            if ($rollbackOld.Count -ne 1) { throw 'Ausgangsoption ist vor Rollback nicht mehr eindeutig gebunden.' }
            $null = Click-VerifiedPoint $hwnd $rollbackOld[0]
            $radioInputBaseline = Get-SSELastInputTick
            Start-Sleep -Milliseconds 300
            $rollbackTree = Walk-Tree $hwnd -WithValues
            $rollbackGroup = @($rollbackTree.nodes | Where-Object {
              $_.type -eq 'RadioButton' -and $_.aid -like "$radioGroupPrefix.*"
            })
            $rollbackWindowsAfter = Get-SSEInteractionWindowSet $targetPid $hwnd
            $rollbackOk = @($rollbackGroup | Where-Object { $_.selected -eq $true }).Count -eq 1 -and
              @($rollbackGroup | Where-Object { $_.aid -eq $radioPreviouslySelected.aid -and $_.selected -eq $true }).Count -eq 1 -and
              (Get-CurrentHeading $hwnd $rollbackTree) -eq $headingBefore -and
              $rollbackWindowsAfter.fingerprint -eq $radioInteractionBefore.fingerprint -and
              (-not $radioGuardUserInput -or (Test-SSELastInputUnchanged $radioInputBaseline))
          } catch { $rollbackOk = $false; $rollbackReason = $_.Exception.Message }
        } elseif (-not $rollbackOk) {
          $rollbackReason = 'Unerwarteter oder nicht exklusiver Radio-Zustand; nicht blind ueberschrieben.'
        }
        Fail "Radio-Nachbedingung verletzt; Ruecksetzung versucht=$rollbackAttempted, erfolgreich=$rollbackOk, Grund='$rollbackReason'." 'postcondition-failed'
      }
    }

    # Bei Blaetterschaltflaechen pruefen, ob die Seite WIRKLICH gewechselt hat.
    # Das Programm sperrt das Blaettern, wenn ein Pflichtfeld leer ist: der
    # Klick gelingt, die Seite bleibt, und es oeffnet sich ein Warnfenster.
    # Ohne diese Pruefung klickt ein Agent endlos weiter.
    $navigiert = $null; $nachher = $null; $dialogsAfter = @()
    if ($isNavigation -or $hasPagePostcondition) {
      $t2 = Walk-Tree $hwnd 900
      $nachher = Get-CurrentHeading $hwnd $t2
      $navigiert = [bool]($nachher -and $nachher -ne $headingBefore)
      $dialogsAfter = @(Get-DialogInventory | Where-Object {
        [int]$_.pid -eq $targetPid -and $_.kind -in @('native-dialog','qt-dialog')
      })
      $zielErreicht = [bool]($navigiert -and (-not $expectedPageAfter -or $nachher -eq $expectedPageAfter))
      if (-not $zielErreicht) {
        $kind = $(if ($navigiert) { 'postcondition-failed' } else { 'navigation-blocked' })
        $navigationError = $(
          if ($navigiert) {
            "Navigation wechselte zu '$nachher', erwartet war '$expectedPageAfter'."
          } elseif ($dialogsAfter.Count) {
            "'$name' hat einen Dialog geoeffnet; der Seitenwechsel ist noch nicht bestaetigt. Keine automatische Wiederholung."
          } else {
            "'$name' wechselte die Seite '$headingBefore' nicht. Keine automatische Wiederholung."
          }
        )
        Emit ([pscustomobject]@{
          ok=$false; kind=$kind; error=$navigationError
          clicked=$name; pattern=$pattern; kandidaten=$cands.Count
          ueberschriftVorher=$headingBefore; ueberschriftNachher=$nachher
          erwarteteUeberschrift=$expectedPageAfter
          navigiert=$navigiert; verified=$false
          dialoge=@($dialogsAfter | ForEach-Object {
            [pscustomobject]@{ hwnd=$_.hwnd; title=$_.title; fingerprint=$_.fingerprint; buttons=$_.buttons }
          })
          ungespeichertVorher=$dirtyBefore; ungespeichertNachher=$(Get-DirtyStateFast $hwnd)
          naechsterSchritt=$(if ($dialogsAfter.Count) {
            'Dialog lesen und fingerprintgebunden beantworten, danach sse_ui_state neu lesen. Den Navigationsklick nicht wiederholen.'
          } else {
            'sse_ui_state lesen; Pflichtfelder, Seitenpruefer und aktuellen Zustand klaeren.'
          })
        })
      }
    }
    Emit ([pscustomobject]@{
      ok = $true; clicked = $(if($erfolg.name){$erfolg.name}else{$name}); pattern = $pattern; kandidaten = $cands.Count; method=$activationMethod
      ueberschriftVorher=$headingBefore; ueberschriftNachher=$nachher
      navigiert=$navigiert; verified=$(if ($isNavigation) { $true } elseif ($pattern -eq 'select') { $radioVerified } else { $null })
      ungespeichertVorher=$dirtyBefore; ungespeichertNachher=$(Get-DirtyStateFast $hwnd)
      dialoge=@($dialogsAfter); node = $erfolg
    })
  }

  'toggle' {
    $boundWrite = Resolve-BoundWriteWindow $a
    $hwnd = [IntPtr][int64]$boundWrite.window.hwnd
    $expectedPage = [string](Arg $a 'expectedPage')
    if (-not $expectedPage) { Fail 'expectedPage ist Pflicht.' 'bad-args' }
    foreach ($required in @('expectedBefore','value','expectedAfter')) {
      if (-not $a.PSObject.Properties[$required]) { Fail "$required ist Pflicht." 'bad-args' }
    }
    if (-not (Arg $a 'name') -and -not (Arg $a 'aid') -and -not (Arg $a 'rid')) {
      Fail 'sse_toggle braucht name, aid oder rid.' 'bad-args'
    }
    $expectedBefore = [bool](Arg $a 'expectedBefore')
    $wanted = [bool](Arg $a 'value')
    $expectedAfter = [bool](Arg $a 'expectedAfter')
    $targetPid = 0
    [SW]::GetWindowThreadProcessId($hwnd, [ref]$targetPid) | Out-Null
    $dialogsBefore = @(Get-DialogInventory | Where-Object {
      [int]$_.pid -eq $targetPid -and $_.kind -in @('native-dialog','qt-dialog')
    })
    if ($dialogsBefore.Count) { Fail 'Ein modaler Dialog ist offen; Checkbox nicht geaendert.' 'precondition-failed' }

    $selector = [pscustomobject]@{
      name=[string](Arg $a 'name'); aid=[string](Arg $a 'aid'); rid=[string](Arg $a 'rid')
      contains=[bool](Arg $a 'contains' $false); type='CheckBox'
    }
    $tree = Walk-Tree $hwnd -WithValues
    $headingBefore = Get-CurrentHeading $hwnd $tree
    if ($headingBefore -ne $expectedPage) {
      Fail "Vorbedingung verletzt: aktuelle Seite ist '$headingBefore', erwartet '$expectedPage'. NICHT geaendert." 'precondition-failed'
    }
    $nodes = @(Resolve-Nodes $tree $selector)
    if (-not $nodes.Count) { Fail 'CheckBox nicht gefunden.' 'not-found' }
    if ($nodes.Count -ne 1) { Fail "CheckBox ist nicht eindeutig ($($nodes.Count) Treffer)." 'ambiguous' }
    $node = $nodes[0]
    if ($node.type -ne 'CheckBox') { Fail "Ziel ist '$($node.type)', keine CheckBox." 'bad-target' }
    if ($node.checked -isnot [bool]) { Fail "CheckBox-Zustand ist '$($node.checked)' statt boolesch." 'unreadable' }
    $before = [bool]$node.checked
    if ($before -ne $expectedBefore) {
      Fail "Vorbedingung verletzt: CheckBox zeigt '$before', erwartet '$expectedBefore'. NICHT geaendert." 'precondition-failed'
    }

    $guardUserInput = [bool](-not $script:DESKTOP_NAME)
    $inputBaseline = $(if ($guardUserInput) { Get-SSELastInputTick } else { $null })
    if ($guardUserInput -and $null -eq $inputBaseline) {
      Fail 'Windows-Eingabe-Epoche ist nicht lesbar; Checkbox nicht geaendert.' 'precondition-failed'
    }
    $interactionBefore = Get-SSEInteractionWindowSet $targetPid $hwnd
    $dirtyBefore = Get-DirtyState $tree

    $element = Get-LiveElement $hwnd $node.rid $node.aid
    $togglePattern = $null
    if (-not $element -or
        -not $element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$togglePattern)) {
      Fail 'CheckBox bietet kein TogglePattern.' 'no-toggle-pattern'
    }
    $liveBefore = switch ([string]$togglePattern.Current.ToggleState) {
      'On' { $true }; 'Off' { $false }; default { $null }
    }
    if ($null -eq $liveBefore -or [bool]$liveBefore -ne $expectedBefore) {
      Fail 'CheckBox-Bindung oder Vorwert aenderte sich unmittelbar vor dem Toggle. NICHT geaendert.' 'precondition-failed'
    }
    if ($guardUserInput -and -not (Test-SSELastInputUnchanged $inputBaseline)) {
      Fail 'Fremde Benutzereingabe unmittelbar vor dem Toggle erkannt. NICHT geaendert.' 'interference'
    }

    $method = 'noop-already-target'
    if ($before -ne $wanted) {
      $togglePattern.Toggle()
      $method = 'toggle-pattern'
      Start-Sleep -Milliseconds 500
    }

    $afterTree = Walk-Tree $hwnd -WithValues
    $headingAfter = Get-CurrentHeading $hwnd $afterTree
    $afterNodes = @(Resolve-Nodes $afterTree $selector)
    $after = $null
    if ($afterNodes.Count -eq 1 -and $afterNodes[0].checked -is [bool]) { $after = [bool]$afterNodes[0].checked }
    $interactionAfter = Get-SSEInteractionWindowSet $targetPid $hwnd
    $inputChanged = [bool]($guardUserInput -and -not (Test-SSELastInputUnchanged $inputBaseline))
    $windowChanged = [bool]($interactionAfter.fingerprint -ne $interactionBefore.fingerprint)
    $pageChanged = [bool]($headingAfter -ne $expectedPage)
    $bindingChanged = [bool]($afterNodes.Count -ne 1 -or $afterNodes[0].aid -ne $node.aid)
    if ($inputChanged -or $windowChanged -or $pageChanged -or $bindingChanged) {
      Emit ([pscustomobject]@{
        ok=$false; kind='interference'
        error='Benutzereingabe, Fensterlage, Seite oder CheckBox-Bindung veraenderte sich waehrend des Toggles.'
        pageBefore=$expectedPage; pageAfter=$headingAfter
        before=$before; wanted=$wanted; after=$after; expectedAfter=$expectedAfter; method=$method
        checkbox=[pscustomobject]@{ rid=$node.rid; aid=$node.aid; name=$node.name }
        inputGuard=[pscustomobject]@{ aktiv=$guardUserInput; baseline=$inputBaseline; beobachtet=$(Get-SSELastInputTick); eingriffErkannt=$inputChanged }
        windowGuard=[pscustomobject]@{ vorher=$interactionBefore.fingerprint; nachher=$interactionAfter.fingerprint; geaendert=$windowChanged }
        rollback=[pscustomobject]@{ versucht=$false; grund='Kein blinder Rollback nach Eingabe-, Fenster-, Seiten- oder Binding-Interferenz.' }
      })
    }
    if ($null -ne $after -and [bool]$after -eq $expectedAfter) {
      Emit ([pscustomobject]@{
        ok=$true; verified=$true; page=$headingAfter
        before=$before; wanted=$wanted; after=[bool]$after; expectedAfter=$expectedAfter; method=$method
        checkbox=[pscustomobject]@{ rid=$afterNodes[0].rid; aid=$afterNodes[0].aid; name=$afterNodes[0].name }
        ungespeichertVorher=$dirtyBefore; ungespeichertNachher=$(Get-DirtyState $afterTree)
        inputGuard=[pscustomobject]@{ aktiv=$guardUserInput; baseline=$inputBaseline; beobachtet=$(Get-SSELastInputTick); eingriffErkannt=$false }
        windowGuard=[pscustomobject]@{ vorher=$interactionBefore.fingerprint; nachher=$interactionAfter.fingerprint; geaendert=$false }
      })
    }

    $rollbackAttempted = $false
    $rollbackValue = $after
    $rollbackOk = [bool]($null -ne $after -and [bool]$after -eq $before)
    $rollbackReason = $(if ($rollbackOk) { 'Ausgangszustand blieb unveraendert.' } else { $null })
    if (-not $rollbackOk -and $null -ne $after -and [bool]$after -eq $wanted) {
      $rollbackAttempted = $true
      try {
        $rollbackElement = Get-LiveElement $hwnd $afterNodes[0].rid $afterNodes[0].aid
        $rollbackPattern = $null
        if (-not $rollbackElement -or
            -not $rollbackElement.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$rollbackPattern)) {
          throw 'CheckBox ist vor Rollback nicht mehr gebunden.'
        }
        $rollbackLive = switch ([string]$rollbackPattern.Current.ToggleState) {
          'On' { $true }; 'Off' { $false }; default { $null }
        }
        if ($null -eq $rollbackLive -or [bool]$rollbackLive -ne $wanted) {
          throw 'CheckBox zeigt vor Rollback nicht mehr exakt den selbst gesetzten Zustand.'
        }
        if ($guardUserInput -and -not (Test-SSELastInputUnchanged $inputBaseline)) {
          throw 'Benutzereingabe vor Rollback erkannt.'
        }
        $rollbackPattern.Toggle()
        Start-Sleep -Milliseconds 500
        $rollbackTree = Walk-Tree $hwnd -WithValues
        $rollbackHeading = Get-CurrentHeading $hwnd $rollbackTree
        $rollbackNodes = @(Resolve-Nodes $rollbackTree $selector)
        if ($rollbackNodes.Count -eq 1 -and $rollbackNodes[0].checked -is [bool]) {
          $rollbackValue = [bool]$rollbackNodes[0].checked
        }
        $rollbackWindows = Get-SSEInteractionWindowSet $targetPid $hwnd
        $rollbackOk = [bool](
          $null -ne $rollbackValue -and [bool]$rollbackValue -eq $before -and
          $rollbackHeading -eq $expectedPage -and
          $rollbackWindows.fingerprint -eq $interactionBefore.fingerprint -and
          (-not $guardUserInput -or (Test-SSELastInputUnchanged $inputBaseline))
        )
      } catch { $rollbackReason = $_.Exception.Message }
    } elseif (-not $rollbackOk) {
      $rollbackReason = "Unerwarteter oder unlesbarer dritter Zustand '$after'; nicht blind ueberschrieben."
    }
    Emit ([pscustomobject]@{
      ok=$false; kind='postcondition-failed'
      error="CheckBox zeigt '$after', erwartet '$expectedAfter'."
      page=$headingAfter; before=$before; wanted=$wanted; after=$after; expectedAfter=$expectedAfter; method=$method
      checkbox=[pscustomobject]@{ rid=$node.rid; aid=$node.aid; name=$node.name }
      rollback=[pscustomobject]@{ versucht=$rollbackAttempted; erfolgreich=$rollbackOk; ist=$rollbackValue; erwartet=$before; grund=$rollbackReason }
    })
  }

  'set_value' {
    # Dieser historische Low-Level-Name bleibt ausschliesslich fuer das
    # globale, steuerneutrale Suchfeld erhalten. Direkte ValuePattern-Writes
    # in fachliche Felder umgehen Qt-Commit, Ergebnis-Diff und Page-Objects;
    # sie sind deshalb hier bewusst fail-closed gesperrt.
    $allowedAid = '.MainToolBar.QWidget.SearchSSE.QLineEdit'
    $aid = [string](Arg $a 'aid')
    if ($aid -ne $allowedAid) {
      Fail ('sse_set_value ist nur fuer das globale steuerneutrale Suchfeld zugelassen. ' +
            'Steuerfelder ueber sse_change_known_field, sse_change_field, sse_table_add, ' +
            'sse_table_update oder sse_combo_select aendern.') 'blocked'
    }
    foreach ($required in @('value','expectedBefore','expectedAfter')) {
      if (-not $a.PSObject.Properties[$required]) { Fail "$required ist Pflicht." 'bad-args' }
    }
    $val = [string](Arg $a 'value')
    $expectedBefore = [string](Arg $a 'expectedBefore')
    $expectedAfter = [string](Arg $a 'expectedAfter')
    $hwnd = [IntPtr][int64](Resolve-SSEMainWindowDescriptor $a -RestoreMinimized).hwnd
    $can = Test-Canary $hwnd
    if (-not $can.ok) { Fail "Kanarienvogel traege ($($can.ms) ms) - neu starten." 'degraded' }
    $targetPid = 0
    [SW]::GetWindowThreadProcessId($hwnd, [ref]$targetPid) | Out-Null
    $dialogsBefore = @(Get-DialogInventory | Where-Object {
      [int]$_.pid -eq $targetPid -and $_.kind -in @('native-dialog','qt-dialog')
    })
    if ($dialogsBefore.Count) { Fail 'Ein modaler Dialog ist offen; Suchtext nicht geaendert.' 'precondition-failed' }

    $t = Walk-Tree $hwnd -WithValues
    $headingBefore = Get-CurrentHeading $hwnd $t
    $candidates = @(Resolve-Nodes $t ([pscustomobject]@{ aid=$allowedAid; type='Edit' }))
    if (-not $candidates.Count) { Fail 'Globales SSE-Suchfeld nicht gefunden.' 'not-found' }
    if ($candidates.Count -ne 1 -or -not ([string]$candidates[0].aid).EndsWith($allowedAid)) {
      Fail "Globales SSE-Suchfeld ist nicht eindeutig ($($candidates.Count) Treffer)." 'ambiguous'
    }
    $node = $candidates[0]
    $el = Get-LiveElement $hwnd $node.rid $node.aid
    if (-not $el) { Fail 'Globales SSE-Suchfeld ist nicht mehr greifbar.' 'stale' }
    $vp = $null
    if (-not $el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
      Fail 'Globales SSE-Suchfeld unterstuetzt ValuePattern nicht.' 'no-value-pattern'
    }
    if ($vp.Current.IsReadOnly) { Fail 'Globales SSE-Suchfeld ist schreibgeschuetzt.' 'readonly' }
    $before = [string]$vp.Current.Value
    if ($before -ne $expectedBefore) {
      Fail "Vorbedingung verletzt: Suchfeld zeigt '$before', erwartet '$expectedBefore'. NICHT geaendert." 'precondition-failed'
    }

    $guardUserInput = [bool](-not $script:DESKTOP_NAME)
    $inputBaseline = $(if ($guardUserInput) { Get-SSELastInputTick } else { $null })
    if ($guardUserInput -and $null -eq $inputBaseline) {
      Fail 'Windows-Eingabe-Epoche ist nicht lesbar; Suchtext nicht geaendert.' 'precondition-failed'
    }
    $interactionBefore = Get-SSEInteractionWindowSet $targetPid $hwnd
    $live = Get-LiveElement $hwnd $node.rid $node.aid
    $liveVp = $null
    if (-not $live -or -not ([string]$live.Current.AutomationId).EndsWith($allowedAid) -or
        -not $live.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$liveVp) -or
        $liveVp.Current.IsReadOnly -or [string]$liveVp.Current.Value -ne $expectedBefore) {
      Fail 'Suchfeldbindung oder Vorwert aenderte sich unmittelbar vor dem Schreiben. NICHT geaendert.' 'precondition-failed'
    }
    if ($guardUserInput -and -not (Test-SSELastInputUnchanged $inputBaseline)) {
      Fail 'Fremde Benutzereingabe unmittelbar vor dem Schreiben erkannt. NICHT geaendert.' 'interference'
    }

    try { $liveVp.SetValue($val) }
    catch { Fail "Suchtext konnte nicht gesetzt werden: $($_.Exception.Message)" 'write-failed' }
    Start-Sleep -Milliseconds 350

    $interactionAfter = Get-SSEInteractionWindowSet $targetPid $hwnd
    $inputChanged = [bool]($guardUserInput -and -not (Test-SSELastInputUnchanged $inputBaseline))
    $windowChanged = [bool]($interactionAfter.fingerprint -ne $interactionBefore.fingerprint)
    $afterTree = Walk-Tree $hwnd -WithValues
    $headingAfter = Get-CurrentHeading $hwnd $afterTree
    $pageChanged = [bool]($headingAfter -ne $headingBefore)
    $freshMatches = @(Resolve-Nodes $afterTree ([pscustomobject]@{ aid=$allowedAid; type='Edit' }))
    $fresh = $(if ($freshMatches.Count -eq 1) { Get-LiveElement $hwnd $freshMatches[0].rid $freshMatches[0].aid } else { $null })
    $after = $null; $freshVp = $null
    if ($fresh -and ([string]$fresh.Current.AutomationId).EndsWith($allowedAid) -and
        $fresh.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$freshVp)) {
      $after = [string]$freshVp.Current.Value
    }

    if ($inputChanged -or $windowChanged -or $pageChanged -or $freshMatches.Count -ne 1) {
      Emit ([pscustomobject]@{
        ok=$false; kind='interference'
        error='Benutzereingabe, Fensterlage, Seite oder Suchfeldbindung veraenderte sich waehrend der Mutation.'
        before=$before; requested=$val; after=$after; expectedAfter=$expectedAfter; verified=$false
        pageBefore=$headingBefore; pageAfter=$headingAfter
        binding=[pscustomobject]@{ aid=$node.aid; allowedSuffix=$allowedAid; rid=$node.rid }
        inputGuard=[pscustomobject]@{ aktiv=$guardUserInput; baseline=$inputBaseline; beobachtet=$(Get-SSELastInputTick); eingriffErkannt=$inputChanged }
        windowGuard=[pscustomobject]@{ vorher=$interactionBefore.fingerprint; nachher=$interactionAfter.fingerprint; geaendert=$windowChanged }
        rollback=[pscustomobject]@{ versucht=$false; grund='Kein blinder Rollback nach Eingabe-, Fenster-, Seiten- oder Binding-Interferenz.' }
      })
    }

    if ($after -eq $expectedAfter) {
      Emit ([pscustomobject]@{
        ok=$true; verified=$true; before=$before; requested=$val; after=$after; expectedAfter=$expectedAfter
        page=$headingAfter; binding=[pscustomobject]@{ aid=$freshMatches[0].aid; allowedSuffix=$allowedAid; rid=$freshMatches[0].rid }
        inputGuard=[pscustomobject]@{ aktiv=$guardUserInput; baseline=$inputBaseline; beobachtet=$(Get-SSELastInputTick); eingriffErkannt=$false }
        windowGuard=[pscustomobject]@{ vorher=$interactionBefore.fingerprint; nachher=$interactionAfter.fingerprint; geaendert=$false }
      })
    }

    # Nur ein exakt eigener, noch sichtbarer Rohwert darf zurueckgesetzt
    # werden. Ein unbekannter dritter Wert wird niemals ueberschrieben.
    $rollbackAttempted = $false; $rollbackOk = [bool]($after -eq $before); $rollbackAfter = $after
    $rollbackReason = $(if ($rollbackOk) { 'Anwendung uebernahm den Wert nicht; Ausgangswert blieb bestehen.' } else { $null })
    if (-not $rollbackOk -and $after -eq $val -and $freshVp) {
      $rollbackAttempted = $true
      try {
        $freshVp.SetValue($before)
        Start-Sleep -Milliseconds 300
        $rollbackFresh = Get-LiveElement $hwnd $freshMatches[0].rid $freshMatches[0].aid
        $rollbackVp = $null
        if ($rollbackFresh -and $rollbackFresh.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$rollbackVp)) {
          $rollbackAfter = [string]$rollbackVp.Current.Value
        }
        $rollbackOk = [bool]($rollbackAfter -eq $before)
      } catch { $rollbackReason = $_.Exception.Message }
    } elseif (-not $rollbackOk) {
      $rollbackReason = "Unerwarteter fremder/transformierter Wert '$after'; nicht blind ueberschrieben."
    }
    Emit ([pscustomobject]@{
      ok=$false; kind='postcondition-failed'
      error="Suchfeld zeigt '$after', erwartet '$expectedAfter'."
      before=$before; requested=$val; after=$after; expectedAfter=$expectedAfter; verified=$false
      page=$headingAfter; binding=[pscustomobject]@{ aid=$node.aid; allowedSuffix=$allowedAid; rid=$node.rid }
      rollback=[pscustomobject]@{ versucht=$rollbackAttempted; erfolgreich=$rollbackOk; ist=$rollbackAfter; erwartet=$before; grund=$rollbackReason }
    })
  }

  'tracked_set_value' {
    # Eine komplette Feldtransaktion in EINEM isolierten UIA-Prozess:
    # Seite und Vorwert pruefen, Ergebnisstand lesen, Wert schreiben und
    # committen, Ziel/Summen/Ergebnis erneut lesen und bei jeder verletzten
    # Nachbedingung auf den alten Wert zurueckrollen.
    $pageId = [string](Arg $a 'pageId')
    $fieldId = [string](Arg $a 'fieldId')
    $known = $null
    $selectorArgs = $a
    if ($pageId -or $fieldId) {
      if (-not $pageId -or -not $fieldId) { Fail 'pageId und fieldId muessen gemeinsam angegeben werden.' 'bad-args' }
      $known = Resolve-SSEPageObject $pageId $fieldId
      $selectorArgs = [pscustomobject]@{
        aid = [string]$known.field.automationIdSuffix
        type = [string]$known.field.controlType
      }
    }
    $name = $(if ($known) { [string]$known.field.label } else { [string](Arg $a 'name') })
    $valueKind = $(if ($known) { [string]$known.field.valueKind } else { [string](Arg $a 'valueKind') })
    if ($valueKind -and $valueKind -notin @('text','currency','date')) {
      Fail "valueKind '$valueKind' ist fuer tracked_set_value nicht unterstuetzt." 'bad-args'
    }
    if (-not $name -and -not (Arg $a 'aid') -and -not (Arg $a 'rid')) {
      Fail 'Eines von name, aid oder rid wird gebraucht.' 'bad-args'
    }
    $expectedPage = $(if ($known) { [string]$known.page.heading } else { [string](Arg $a 'expectedPage') })
    $expectedBefore = [string](Arg $a 'expectedBefore')
    $requested = [string](Arg $a 'value')
    $expectedAfter = [string](Arg $a 'expectedAfter')
    if (-not $expectedPage -or $null -eq (Arg $a 'expectedBefore') -or
        $null -eq (Arg $a 'value') -or $null -eq (Arg $a 'expectedAfter')) {
      Fail 'expectedPage, expectedBefore, value und expectedAfter sind Pflicht.' 'bad-args'
    }
    $sumChecks = @((Arg $a 'sumChecks') | Where-Object { $null -ne $_ })
    $trackResults = [bool](Arg $a 'trackResults' $(if ($script:DESKTOP_NAME) { $false } else { $true }))
    $fastKnown = [bool]($known -and $sumChecks.Count -eq 0)
    $phaseLog = New-SSEPhaseLog

    $boundWrite = Resolve-BoundWriteWindow $a
    $hwnd = [IntPtr][int64]$boundWrite.window.hwnd
    $can = Test-Canary $hwnd
    if (-not $can.ok) { Fail "Kanarienvogel traege ($($can.ms) ms) - neu starten." 'degraded' }
    $dialogs = @(Get-DialogInventory | Where-Object { $_.kind -in @('native-dialog','qt-dialog') })
    if ($dialogs.Count) { Fail 'Ein modaler Dialog ist offen; Feldtransaktion nicht gestartet.' 'precondition-failed' }
    Complete-SSEPhase $phaseLog 'bind'
    $knownStateBefore = $(if ($known) { Get-KnownPageState $hwnd $known } else { $null })
    $expectedEpoch = [string](Arg $a 'expectedEpoch')
    if ($expectedEpoch -and $knownStateBefore.epoch -ne $expectedEpoch) {
      Fail "Page-Object-Epoche hat sich geaendert ($($knownStateBefore.epoch) statt $expectedEpoch). NICHT geaendert." 'precondition-failed'
    }

    Complete-SSEPhase $phaseLog 'stateBefore'
    $beforeTree = $(if ($fastKnown) { $null } else { Walk-Tree $hwnd 5000 60 20 -WithValues })
    Complete-SSEPhase $phaseLog 'beforeTree'
    $heading = $(if ($fastKnown) { $knownStateBefore.heading } else { Get-CurrentHeading $hwnd $beforeTree })
    $knownPageMatches = [bool](
      $known -and (Test-KnownPageHeading $heading $known.page) -and
      @($knownStateBefore.fields | Where-Object { -not $_.present }).Count -eq 0
    )
    if ($(if ($known) { -not $knownPageMatches } else { $heading -ne $expectedPage })) {
      Fail "Falsche Seite: '$heading', erwartet '$expectedPage'. NICHT geaendert." 'precondition-failed'
    }
    $node = $(if ($fastKnown) { Resolve-KnownFieldNode $hwnd $known } else { Resolve-TrackedFieldNode $beforeTree $selectorArgs $hwnd })
    if (-not $node) { Fail 'Zielfeld nicht eindeutig gefunden.' 'not-found' }
    if ($node.type -notin @('Edit','DataItem')) {
      Fail "Ziel ist '$($node.type)', erwartet wird ein beschreibbares Feld." 'bad-target'
    }
    $focuslessPolicy = $null
    if ($script:DESKTOP_NAME) {
      $focuslessPolicy = Resolve-SSEFocuslessCommitPolicy $heading $node $valueKind $sumChecks $beforeTree
      if (-not $focuslessPolicy) {
        Fail ("Focusless-Feldtransaktion ist fuer Seite '$heading', Typ '$($node.type)' und diesen Summenvertrag nicht profiliert. " +
              'Nur live getestete Profilfelder duerfen ohne sichtbaren Fokus geschrieben werden.') 'hidden-desktop'
      }
      if ($trackResults) {
        Fail ('Focusless-Profil prueft den fachlichen Seitenwert ueber den verpflichtenden Summenvertrag. ' +
              'trackResults=true wuerde das interne Werte-Info-Fenster aktiv halten und ist deshalb vor der Mutation gesperrt.') 'hidden-desktop'
      }
    }
    $element = Get-LiveElement $hwnd $node.rid $node.aid
    $vp = $null
    if (-not $element -or -not $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
      Fail 'Zielfeld bietet kein ValuePattern.' 'no-value-pattern'
    }
    if ($vp.Current.IsReadOnly) { Fail 'Zielfeld ist schreibgeschuetzt.' 'readonly' }
    $beforeRaw = [string]$vp.Current.Value
    $beforeDisplay = $beforeRaw
    if (-not $beforeDisplay) { $beforeDisplay = [string]$node.name }
    $before = $beforeDisplay
    $beforeMatches = [bool](
      (Test-SSETrackedValueEquivalent $beforeRaw $expectedBefore $valueKind) -or
      (Test-SSETrackedValueEquivalent $beforeDisplay $expectedBefore $valueKind)
    )
    if (-not $beforeMatches) {
      Fail "Vorwert ist '$before', erwartet '$expectedBefore'. NICHT geaendert." 'precondition-failed'
    }

    $sumBefore = New-Object System.Collections.ArrayList
    foreach ($check in $sumChecks) {
      $label = [string](Arg $check 'label')
      $occurrence = [int](Arg $check 'occurrence' 1)
      $wantBefore = [string](Arg $check 'before')
      $wantAfter = [string](Arg $check 'after')
      if (-not $label -or $null -eq (Arg $check 'before') -or $null -eq (Arg $check 'after')) {
        Fail 'Jeder Summencheck braucht label, before und after.' 'bad-args'
      }
      $read = Read-LabeledValueFromTree $beforeTree $hwnd $label $occurrence
      if (-not (Test-SSEScalarEqual $read.value $wantBefore)) {
        Fail "Summen-Vorbedingung '$label' ist '$($read.value)', erwartet '$wantBefore'. NICHT geaendert." 'precondition-failed'
      }
      $null = $sumBefore.Add([pscustomobject]@{
        label=$label; occurrence=$occurrence; vorher=$read.value
        erwartetVorher=$wantBefore; erwartetNachher=$wantAfter
      })
    }

    $tracking = $null; $resultBefore = $null
    if ($trackResults) {
      $tracking = Open-TrackedResultWindow $hwnd
      if (-not $tracking.ok) { Fail "Ergebnis-Tracking nicht verfuegbar: $($tracking.error)" 'precondition-failed' }
      $resultBefore = Read-TrackedResultWindow $tracking.window
      if (-not $resultBefore.ok) {
        $null = Close-TrackedResultWindow $tracking
        Fail 'Ergebnisstand vor der Aenderung war nicht vollstaendig lesbar.' 'precondition-failed'
      }
    }

    # Nach dem Oeffnen von Werte-Info das Hauptfenster und Zielfeld frisch
    # aufloesen; keine RuntimeId aus einem alten Baum blind weiterverwenden.
    Complete-SSEPhase $phaseLog 'preconditions'
    $liveTree = $(if ($fastKnown) { $null } else { Walk-Tree $hwnd 5000 60 20 -WithValues })
    Complete-SSEPhase $phaseLog 'liveTree'
    $knownStateLive = $(if ($known) { Get-KnownPageState $hwnd $known } else { $null })
    if ($fastKnown -and (-not (Test-KnownPageHeading $knownStateLive.heading $known.page) -or
        @($knownStateLive.fields | Where-Object { -not $_.present }).Count -ne 0)) {
      $null = Close-TrackedResultWindow $tracking
      Fail 'Seite wurde vor dem Schreiben geaendert; NICHT geschrieben.' 'interference'
    }
    if ($known -and $knownStateLive.epoch -ne $knownStateBefore.epoch) {
      $null = Close-TrackedResultWindow $tracking
      Fail 'Page-Object-Epoche wurde waehrend der Aktion veraendert; NICHT geschrieben.' 'interference'
    }
    $liveNode = $(if ($fastKnown) { Resolve-KnownFieldNode $hwnd $known } else { Resolve-TrackedFieldNode $liveTree $selectorArgs $hwnd })
    if (-not $liveNode) {
      $null = Close-TrackedResultWindow $tracking
      Fail 'Zielfeld ist vor dem Schreiben verschwunden.' 'stale'
    }
    $liveElement = Get-LiveElement $hwnd $liveNode.rid $liveNode.aid
    $liveVp = $null
    if (-not $liveElement -or -not $liveElement.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$liveVp) -or $liveVp.Current.IsReadOnly) {
      $null = Close-TrackedResultWindow $tracking
      Fail 'Zielfeld ist unmittelbar vor dem Schreiben nicht mehr beschreibbar.' 'stale'
    }
    $interactionWindowsBefore = Get-SSEInteractionWindowSet ([int]$boundWrite.window.pid) $hwnd
    $commitExpectedCurrent = $(if ($liveNode.type -eq 'DataItem' -and -not $beforeRaw) { $beforeDisplay } else { $beforeRaw })
    Complete-SSEPhase $phaseLog 'resolveLiveNode'
    $commitResult = $(if ($script:DESKTOP_NAME) {
      Commit-TrackedValueFocusless $hwnd $liveNode $requested $commitExpectedCurrent
    } else {
      Commit-TrackedValue $hwnd $liveNode $requested $beforeRaw
    })
    Complete-SSEPhase $phaseLog 'commit'
    $commitMethod = [string]$commitResult.method
    $interactionWindowsAfter = Get-SSEInteractionWindowSet ([int]$boundWrite.window.pid) $hwnd
    $windowSetChanged = [bool]($interactionWindowsBefore.fingerprint -ne $interactionWindowsAfter.fingerprint)
    $interference = [bool]($commitResult.interference -or $windowSetChanged)
    if ($interference) {
      # Nach fremder Eingabe oder einem neuen/ersetzten Fenster weder den
      # Nutzerwert noch einen moeglichen Qt-Dialog durch Rollback ueberfahren.
      # Nur den Zielwert bestmoeglich lesen und den gesamten Zustand zur
      # bewussten Neusynchronisierung stehen lassen.
      $observedAfterInterference = $null
      try {
        $probeNode = $(if ($known) { Resolve-KnownFieldNode $hwnd $known } else { $liveNode })
        $probeElement = $(if ($probeNode) { Get-LiveElement $hwnd $probeNode.rid $probeNode.aid } else { $null })
        $probeVp = $null
        if ($probeElement -and $probeElement.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$probeVp)) {
          $observedAfterInterference = $probeVp.Current.Value
        }
        if (($null -eq $observedAfterInterference -or $observedAfterInterference -eq '') -and $probeNode) {
          $observedAfterInterference = $probeNode.name
        }
      } catch { }
      $mutationState = $(
        if ($null -eq $observedAfterInterference) { 'unknown' }
        elseif (Test-SSETrackedValueEquivalent $observedAfterInterference $before $valueKind) { 'unchanged' }
        elseif (Test-SSETrackedValueEquivalent $observedAfterInterference $expectedAfter $valueKind) { 'requested-value-visible' }
        else { 'different-value-visible' }
      )
      Emit ([pscustomobject]@{
        ok=$false; kind='interference'
        error='Interaktions-Guard hat fremde Eingabe, ein verschobenes/ausgetauschtes Element oder eine blockierende Fensterlage erkannt. Zustand wurde nur gelesen; kein automatischer Rollback und kein Speichern. Mit sse_ui_state neu synchronisieren.'
        seite=$heading; pageId=$pageId; fieldId=$fieldId; valueKind=$valueKind
        pid=[int]$boundWrite.window.pid; bindung=$boundWrite.bindingMode
        feld=[pscustomobject]@{
          vorher=$before; angefordert=$requested; erwartet=$expectedAfter
          nachher=$observedAfterInterference; zustand=$mutationState
        }
        commit=$commitMethod
        commitDetails=$commitResult.details
        inputGuard=[pscustomobject]@{
          vorher=$commitResult.inputBefore; nachher=$commitResult.inputAfter
          eingriffErkannt=[bool]$commitResult.inputInterference
        }
        fensterGuard=[pscustomobject]@{
          vorher=$interactionWindowsBefore.fingerprint; nachher=$interactionWindowsAfter.fingerprint
          geaendert=$windowSetChanged; fenster=@($interactionWindowsAfter.windows)
        }
        rollback=[pscustomobject]@{ versucht=$false; methode='not-attempted-after-interference'; ok=$null }
        ergebnisFensterGeschlossen=$false
        zeitmessung=$(Complete-SSEPhase $phaseLog 'interference'; Get-SSEPhaseReport $phaseLog)
      })
    }

    Complete-SSEPhase $phaseLog 'windowGuard'
    $afterTree = $(if ($fastKnown) { $null } else { Walk-Tree $hwnd 5000 60 20 -WithValues })
    Complete-SSEPhase $phaseLog 'afterTree'
    $afterNode = $(if ($fastKnown) { Resolve-KnownFieldNode $hwnd $known } else { Resolve-TrackedFieldNode $afterTree $selectorArgs $hwnd })
    $knownStateAfter = $(if ($known) { Get-KnownPageState $hwnd $known } else { $null })
    $after = $null; $afterRaw = $null; $afterDisplay = $null
    if ($afterNode) {
      $afterElement = Get-LiveElement $hwnd $afterNode.rid $afterNode.aid
      $afterVp = $null
      if ($afterElement -and $afterElement.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$afterVp)) {
        $afterRaw = [string]$afterVp.Current.Value
      }
      $afterDisplay = [string]$afterNode.name
      $after = $(if ($afterRaw) { $afterRaw } elseif ($afterDisplay) { $afterDisplay } else { '' })
    }
    $sumAfter = New-Object System.Collections.ArrayList
    $sumOk = $true
    foreach ($check in @($sumBefore)) {
      $read = Read-LabeledValueFromTree $afterTree $hwnd $check.label $check.occurrence
      $good = Test-SSEScalarEqual $read.value $check.erwartetNachher
      if (-not $good) { $sumOk = $false }
      $null = $sumAfter.Add([pscustomobject]@{
        label=$check.label; occurrence=$check.occurrence
        vorher=$check.vorher; nachher=$read.value; erwartetNachher=$check.erwartetNachher; ok=[bool]$good
      })
    }

    $resultAfter = $null; $resultDiff = @(); $resultOk = $true
    if ($trackResults) {
      Start-Sleep -Milliseconds 500
      $resultAfter = Read-TrackedResultWindow $tracking.window
      $resultOk = [bool]$resultAfter.ok
      if ($resultOk) {
        $labels = @((Arg $a 'resultLabels') | ForEach-Object { [string]$_ })
        $resultDiff = @(Compare-TrackedResultRows $resultBefore $resultAfter $labels)
      }
    }

    $fieldOk = [bool](
      (Test-SSETrackedValueEquivalent $afterRaw $expectedAfter $valueKind) -or
      (Test-SSETrackedValueEquivalent $afterDisplay $expectedAfter $valueKind)
    )
    $commitOk = ($commitMethod -in @('verified-keyboard-replace','verified-focusless-value-pattern-tab'))
    $allOk = [bool]($fieldOk -and $sumOk -and $resultOk -and $commitOk)
    if (-not $allOk) {
      $rollbackMethod = 'not-attempted'
      $rollbackAttempted = $false
      $rollbackReason = $null
      $restoredRaw = $afterRaw
      $restoredDisplay = $afterDisplay
      $rollbackOk = [bool](
        (Test-SSEScalarEqual $afterRaw $beforeRaw) -and
        (Test-SSETrackedValueEquivalent $afterDisplay $beforeDisplay $valueKind)
      )
      if ($rollbackOk) {
        # Fokus-/Epochabbruch geschah vor der Wertmutation. Ein erneutes
        # Schreiben waere kein Rollback, sondern ein unnoetiges neues Risiko.
        $rollbackMethod = 'not-needed-value-unchanged'
        $rollbackReason = 'Roher Wert und Anzeige blieben im Ausgangszustand.'
      } else {
        $rollbackTree = $(if ($fastKnown) { $null } else { Walk-Tree $hwnd 5000 60 20 -WithValues })
        $rollbackNode = $(if ($fastKnown) { Resolve-KnownFieldNode $hwnd $known } else { Resolve-TrackedFieldNode $rollbackTree $selectorArgs $hwnd })
        $rollbackElement = $(if ($rollbackNode) { Get-LiveElement $hwnd $rollbackNode.rid $rollbackNode.aid } else { $null })
        $rollbackVp = $null
        $rollbackCurrentRaw = $null; $rollbackCurrentDisplay = $null
        if ($rollbackElement -and
            $rollbackElement.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$rollbackVp) -and
            -not $rollbackVp.Current.IsReadOnly) {
          $rollbackCurrentRaw = [string]$rollbackVp.Current.Value
          $rollbackCurrentDisplay = [string]$rollbackNode.name
        }
        $rollbackWindowsBefore = Get-SSEInteractionWindowSet ([int]$boundWrite.window.pid) $hwnd
        $rollbackInputBefore = Get-SSELastInputTick
        $rollbackHeading = $(if ($known) { (Get-KnownPageState $hwnd $known).heading } else { Get-CurrentHeading $hwnd $rollbackTree })
        $rollbackOwnValue = [bool](
          (Test-SSETrackedValueEquivalent $rollbackCurrentRaw $requested $valueKind) -or
          (Test-SSETrackedValueEquivalent $rollbackCurrentRaw $expectedAfter $valueKind) -or
          (Test-SSETrackedValueEquivalent $rollbackCurrentDisplay $requested $valueKind) -or
          (Test-SSETrackedValueEquivalent $rollbackCurrentDisplay $expectedAfter $valueKind)
        )
        $rollbackPreflightOk = [bool](
          $rollbackNode -and $rollbackVp -and $rollbackOwnValue -and
          (Test-KnownPageHeading $rollbackHeading $(if ($known) { $known.page } else { [pscustomobject]@{ heading=$expectedPage } })) -and
          $rollbackWindowsBefore.fingerprint -eq $interactionWindowsAfter.fingerprint -and
          ($null -eq $commitResult.inputAfter -or
            ($null -ne $rollbackInputBefore -and [uint64]$rollbackInputBefore -eq [uint64]$commitResult.inputAfter))
        )
        if (-not $rollbackPreflightOk) {
          $resultWindowClosed = $false
          Emit ([pscustomobject]@{
            ok=$false; kind='interference'
            error='Zielfeld, Seite, Fensterlage, Eingabe-Epoche oder eigener formatierter Wert ist vor dem Rollback nicht mehr eindeutig gebunden. Kein automatischer Rollback.'
            seite=$heading; pageId=$pageId; fieldId=$fieldId; valueKind=$valueKind
            feld=[pscustomobject]@{
              vorher=$before; vorherRaw=$beforeRaw; angefordert=$requested; erwartet=$expectedAfter
              nachher=$after; nachherRaw=$afterRaw; aktuelleAnzeige=$rollbackCurrentDisplay
              aktuellerRawwert=$rollbackCurrentRaw; ok=[bool]$fieldOk
            }
            commit=$commitMethod; commitDetails=$commitResult.details
            rollback=[pscustomobject]@{
              versucht=$false; methode='not-attempted-after-interference'; ok=$null
              grund='Kein blinder Rollback nach Eingabe-, Fenster-, Seiten-, Binding- oder Fremdwertinterferenz.'
            }
            ergebnisFensterGeschlossen=$resultWindowClosed
          })
        }
        $rollbackAttempted = $true
        try {
          # Fuer die Epochbindung den frisch gelesenen ROHEN aktuellen Wert
          # verwenden. Die Anzeige kann bei Datum bewusst '15.07' sein,
          # waehrend ValuePattern einen anderen kanonischen Wert exponiert.
          $rollbackTargetValue = $(if ($rollbackNode.type -eq 'DataItem' -and -not $beforeRaw) { $beforeDisplay } else { $beforeRaw })
          $rollbackExpectedCurrent = $(if ($rollbackNode.type -eq 'DataItem' -and -not $rollbackCurrentRaw) { $rollbackCurrentDisplay } else { $rollbackCurrentRaw })
          $rollbackResult = $(if ($script:DESKTOP_NAME) {
            Commit-TrackedValueFocusless $hwnd $rollbackNode $rollbackTargetValue $rollbackExpectedCurrent
          } else {
            Commit-TrackedValue $hwnd $rollbackNode $beforeRaw $rollbackCurrentRaw
          })
          $rollbackMethod = [string]$rollbackResult.method
          $rollbackReason = $(if ($rollbackMethod -in @('verified-keyboard-replace','verified-focusless-value-pattern-tab')) { $null } else { "Rollback-Commit meldete '$rollbackMethod'." })
        } catch {
          $rollbackMethod = 'failed'
          $rollbackReason = $_.Exception.Message
        }

        $verifyTree = $(if ($fastKnown) { $null } else { Walk-Tree $hwnd 5000 60 20 -WithValues })
        $verifyNode = $(if ($fastKnown) { Resolve-KnownFieldNode $hwnd $known } else { Resolve-TrackedFieldNode $verifyTree $selectorArgs $hwnd })
        $verifyElement = $(if ($verifyNode) { Get-LiveElement $hwnd $verifyNode.rid $verifyNode.aid } else { $null })
        $verifyVp = $null
        if ($verifyElement -and $verifyElement.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$verifyVp)) {
          $restoredRaw = [string]$verifyVp.Current.Value
          $restoredDisplay = [string]$verifyNode.name
        }
        $rollbackOk = [bool](
          $rollbackMethod -in @('verified-keyboard-replace','verified-focusless-value-pattern-tab') -and
          (Test-SSEScalarEqual $restoredRaw $beforeRaw) -and
          (Test-SSETrackedValueEquivalent $restoredDisplay $beforeDisplay $valueKind)
        )
        if (-not $rollbackOk -and -not $rollbackReason) {
          $rollbackReason = 'Roher Ausgangswert und Anzeige wurden nach dem Rollback nicht exakt bestaetigt.'
        }
      }
      $resultWindowClosed = Close-TrackedResultWindow $tracking
      Emit ([pscustomobject]@{
        ok=$false; kind='postcondition-failed'
        error=$(if ($rollbackOk) {
          'Nachbedingung verletzt; roher alter Feldwert und Anzeige wurden wiederhergestellt.'
        } else {
          'Nachbedingung verletzt; Rollback zum rohen Ausgangswert ist NICHT bewiesen. Zustand neu lesen und nicht speichern.'
        })
        seite=$heading; pageId=$pageId; fieldId=$fieldId; valueKind=$valueKind
        pid=[int]$boundWrite.window.pid; bindung=$boundWrite.bindingMode
        epochVorher=$(if ($knownStateBefore) { $knownStateBefore.epoch } else { $null })
        epochNachher=$(if ($knownStateAfter) { $knownStateAfter.epoch } else { $null })
        feld=[pscustomobject]@{
          vorher=$before; vorherRaw=$beforeRaw; vorherAnzeige=$beforeDisplay
          angefordert=$requested; erwartet=$expectedAfter
          nachher=$after; nachherRaw=$afterRaw; nachherAnzeige=$afterDisplay
          ok=[bool]$fieldOk; formatAware=[bool]($valueKind -eq 'date')
        }
        summen=@($sumAfter)
        ergebnisDiff=@($resultDiff); ergebnisVollstaendig=[bool]$resultOk
        commit=$commitMethod
        commitDetails=$commitResult.details
        inputGuard=[pscustomobject]@{
          vorher=$commitResult.inputBefore; nachher=$commitResult.inputAfter
          eingriffErkannt=[bool]$commitResult.inputInterference
        }
        fensterGuard=[pscustomobject]@{
          vorher=$interactionWindowsBefore.fingerprint; nachher=$interactionWindowsAfter.fingerprint
          geaendert=$windowSetChanged
        }
        rollback=[pscustomobject]@{
          versucht=$rollbackAttempted; methode=$rollbackMethod
          wert=$restoredDisplay; rawWert=$restoredRaw
          erwartet=$beforeDisplay; erwartetRaw=$beforeRaw
          ok=[bool]$rollbackOk; grund=$rollbackReason
        }
        ergebnisFensterGeschlossen=[bool]$resultWindowClosed
        zeitmessung=$(Complete-SSEPhase $phaseLog 'rollback'; Get-SSEPhaseReport $phaseLog)
      })
    }

    $resultWindowClosed = Close-TrackedResultWindow $tracking
    Emit ([pscustomobject]@{
      ok=$true; verified=$true; seite=$heading; pageId=$pageId; fieldId=$fieldId; valueKind=$valueKind
      pid=[int]$boundWrite.window.pid; bindung=$boundWrite.bindingMode
      focuslessPolicy=$(if ($focuslessPolicy) { [string]$focuslessPolicy.id } else { $null })
      epochVorher=$(if ($knownStateBefore) { $knownStateBefore.epoch } else { $null })
      epochNachher=$(if ($knownStateAfter) { $knownStateAfter.epoch } else { $null })
      feld=[pscustomobject]@{
        vorher=$before; vorherRaw=$beforeRaw; vorherAnzeige=$beforeDisplay
        angefordert=$requested; nachher=$after; nachherRaw=$afterRaw; nachherAnzeige=$afterDisplay
        erwartet=$expectedAfter; ok=$true; formatAware=[bool]($valueKind -eq 'date')
      }
      summen=@($sumAfter)
      ergebnisDiff=@($resultDiff)
      ergebnisVerfolgt=[bool]$trackResults
      ergebnisVollstaendig=[bool]$resultOk
      ergebnisZeilenVorher=$(if ($resultBefore) { @($resultBefore.rows).Count } else { 0 })
      ergebnisZeilenNachher=$(if ($resultAfter) { @($resultAfter.rows).Count } else { 0 })
      commit=$commitMethod
      commitDetails=$commitResult.details
      inputGuard=[pscustomobject]@{
        vorher=$commitResult.inputBefore; nachher=$commitResult.inputAfter
        eingriffErkannt=[bool]$commitResult.inputInterference
      }
      fensterGuard=[pscustomobject]@{
        vorher=$interactionWindowsBefore.fingerprint; nachher=$interactionWindowsAfter.fingerprint
        geaendert=$windowSetChanged
      }
      ungespeichert=$(if ($fastKnown) { Get-DirtyStateFast $hwnd } else { Get-DirtyState $afterTree })
      ergebnisFensterGeschlossen=[bool]$resultWindowClosed
      zeitmessung=$(Complete-SSEPhase $phaseLog 'readback'; Get-SSEPhaseReport $phaseLog)
    })
  }

  'combo_options' {
    $hwnd = [IntPtr][int64](Resolve-SSEMainWindowDescriptor $a -RestoreMinimized).hwnd
    if (-not (Arg $a 'name') -and -not (Arg $a 'aid') -and -not (Arg $a 'rid')) {
      Fail 'sse_combo_options braucht name, aid oder rid.' 'bad-args'
    }
    $tree = Walk-Tree $hwnd
    $selector = [pscustomobject]@{
      name=[string](Arg $a 'name'); aid=[string](Arg $a 'aid'); rid=[string](Arg $a 'rid')
      contains=[bool](Arg $a 'contains' $false); type='ComboBox'
    }
    $combos = @(Resolve-Nodes $tree $selector)
    if (-not $combos.Count) { Fail 'ComboBox nicht gefunden.' 'not-found' }
    if ($combos.Count -ne 1) { Fail "ComboBox ist nicht eindeutig ($($combos.Count) Treffer)." 'ambiguous' }
    $combo = $combos[0]
    if (-not $combo.aid) {
      Fail 'ComboBox hat keine AutomationId; Optionen koennen nicht sicher dieser Liste zugeordnet werden.' 'unmapped'
    }
    $element = Get-LiveElement $hwnd $combo.rid $combo.aid
    if (-not $element) { Fail 'ComboBox ist nicht mehr greifbar.' 'stale' }
    $vp = $null; $current = $combo.val
    if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
      $current = $vp.Current.Value
    }
    $ec = $null
    if (-not $element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$ec)) {
      Fail 'ComboBox bietet kein ExpandCollapsePattern.' 'no-expand-pattern'
    }
    if ($ec.Current.ExpandCollapseState -ne [System.Windows.Automation.ExpandCollapseState]::Expanded) { $ec.Expand() }
    Start-Sleep -Milliseconds 450
    $expanded = Walk-Tree $hwnd 1800 18
    $prefix = "$($combo.aid)"
    $options = @($expanded.nodes | Where-Object {
      $_.type -eq 'ListItem' -and $_.name -and $_.aid -and $_.aid.StartsWith($prefix)
    } | ForEach-Object { [pscustomobject]@{
      name = $_.name; enabled = [bool]$_.on; rid = $_.rid; aid = $_.aid
    } })
    try {
      $freshCombo = Get-LiveElement $hwnd $combo.rid $combo.aid
      $freshPattern = $null
      if ($freshCombo -and $freshCombo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$freshPattern) -and
          $freshPattern.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Expanded) {
        $freshPattern.Collapse()
      }
    } catch { }
    Start-Sleep -Milliseconds 200
    if (-not $options.Count) { Fail 'ComboBox wurde geoeffnet, aber keine zugeordneten Optionen waren lesbar.' 'not-found' }
    Emit ([pscustomobject]@{
      ok = $true; current = $current; combo = [pscustomobject]@{ rid = $combo.rid; aid = $combo.aid }
      options = $options; collapsedAfterRead = $true
    })
  }

  'combo_select' {
    $boundWrite = Resolve-BoundWriteWindow $a
    $hwnd = [IntPtr][int64]$boundWrite.window.hwnd
    $expectedPage = [string](Arg $a 'expectedPage')
    $wanted = [string](Arg $a 'value')
    $expectedCurrent = [string](Arg $a 'expectedCurrent')
    $expectedAfter = [string](Arg $a 'expectedAfter')
    if (-not $expectedPage -or -not $wanted) { Fail 'expectedPage und value sind Pflicht.' 'bad-args' }
    foreach ($required in @('expectedCurrent','expectedAfter')) {
      if (-not $a.PSObject.Properties[$required]) { Fail "$required ist Pflicht." 'bad-args' }
    }
    if (-not (Arg $a 'name') -and -not (Arg $a 'aid') -and -not (Arg $a 'rid')) {
      Fail 'sse_combo_select braucht name, aid oder rid.' 'bad-args'
    }
    $targetPid = 0
    [SW]::GetWindowThreadProcessId($hwnd, [ref]$targetPid) | Out-Null
    $dialogsBefore = @(Get-DialogInventory | Where-Object {
      [int]$_.pid -eq $targetPid -and $_.kind -in @('native-dialog','qt-dialog')
    })
    if ($dialogsBefore.Count) { Fail 'Ein modaler Dialog ist offen; Auswahl nicht begonnen.' 'precondition-failed' }

    $tree = Walk-Tree $hwnd -WithValues
    $headingBefore = Get-CurrentHeading $hwnd $tree
    if ($headingBefore -ne $expectedPage) {
      Fail "Vorbedingung verletzt: aktuelle Seite ist '$headingBefore', erwartet '$expectedPage'. NICHT geaendert." 'precondition-failed'
    }
    $selector = [pscustomobject]@{
      name=[string](Arg $a 'name'); aid=[string](Arg $a 'aid'); rid=[string](Arg $a 'rid')
      contains=[bool](Arg $a 'contains' $false); type='ComboBox'
    }
    $combos = @(Resolve-Nodes $tree $selector)
    if (-not $combos.Count) { Fail 'ComboBox nicht gefunden.' 'not-found' }
    if ($combos.Count -ne 1) { Fail "ComboBox ist nicht eindeutig ($($combos.Count) Treffer)." 'ambiguous' }
    $combo = $combos[0]
    if (-not $combo.aid) {
      Fail 'ComboBox hat keine AutomationId; Optionen koennen nicht sicher dieser Liste zugeordnet werden.' 'unmapped'
    }
    $element = Get-LiveElement $hwnd $combo.rid $combo.aid
    if (-not $element) { Fail 'ComboBox ist nicht mehr greifbar.' 'stale' }
    $vp = $null; $before = $combo.val
    if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
      $before = $vp.Current.Value
    }
    if ("$before" -ne $expectedCurrent) {
      Fail "Vorbedingung verletzt: ComboBox zeigt '$before', erwartet '$expectedCurrent'. NICHT geaendert." 'precondition-failed'
    }
    $guardUserInput = [bool](-not $script:DESKTOP_NAME)
    $inputBaseline = $(if ($guardUserInput) { Get-SSELastInputTick } else { $null })
    if ($guardUserInput -and $null -eq $inputBaseline) {
      Fail 'Windows-Eingabe-Epoche ist nicht lesbar; Auswahl nicht begonnen.' 'precondition-failed'
    }
    $interactionBefore = Get-SSEInteractionWindowSet $targetPid $hwnd

    # Unmittelbar vor dem Oeffnen noch einmal denselben UIA-Knoten, dieselbe
    # AutomationId und denselben Vorwert pruefen.
    $element = Get-LiveElement $hwnd $combo.rid $combo.aid
    $vp = $null
    if (-not $element -or [string]$element.Current.AutomationId -ne [string]$combo.aid -or
        -not $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp) -or
        [string]$vp.Current.Value -ne $expectedCurrent) {
      Fail 'ComboBox-Bindung oder Vorwert aenderte sich unmittelbar vor der Auswahl. NICHT geaendert.' 'precondition-failed'
    }
    if ($guardUserInput -and -not (Test-SSELastInputUnchanged $inputBaseline)) {
      Fail 'Fremde Benutzereingabe unmittelbar vor der Auswahl erkannt. NICHT geaendert.' 'interference'
    }
    $ec = $null
    if (-not $element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$ec)) {
      Fail 'ComboBox bietet kein ExpandCollapsePattern.' 'no-expand-pattern'
    }
    if ($ec.Current.ExpandCollapseState -ne [System.Windows.Automation.ExpandCollapseState]::Expanded) { $ec.Expand() }
    Start-Sleep -Milliseconds 450
    if ($guardUserInput -and -not (Test-SSELastInputUnchanged $inputBaseline)) {
      try { $ec.Collapse() } catch { }
      Fail 'Fremde Benutzereingabe beim Oeffnen der ComboBox erkannt. NICHT ausgewaehlt.' 'interference'
    }
    if ((Get-CurrentHeading $hwnd) -ne $expectedPage) {
      try { $ec.Collapse() } catch { }
      Fail 'Seite wechselte beim Oeffnen der ComboBox. NICHT ausgewaehlt.' 'interference'
    }
    $expanded = Walk-Tree $hwnd 1800 18
    $prefix = "$($combo.aid)"
    $matches = @($expanded.nodes | Where-Object {
      $_.type -eq 'ListItem' -and $_.name -eq $wanted -and $_.aid -and $_.aid.StartsWith($prefix)
    })
    $method = 'select'
    if ($matches.Count -eq 0) {
      # Qts lange ComboBoxen virtualisieren ihre Optionen. Der Elementbaum
      # enthaelt dann nur den sichtbaren Ausschnitt. Das ValuePattern der
      # Liste bzw. des Edit-Kindes aendert nur den Text und erzeugt in SSE eine
      # „Fehlerhafte Eingabe“; es ist deshalb kein Auswahlweg. Auf dem
      # sichtbaren Desktop wird die exakt gebundene Liste stattdessen wie von
      # einem Benutzer seitenweise materialisiert und erst der echte, exakt
      # benannte ListItem-Knoten PID-/Root-verifiziert angeklickt.
      $lists = @($expanded.nodes | Where-Object {
        $_.type -eq 'List' -and $_.aid -and $_.aid.StartsWith($prefix)
      })
      if ($lists.Count -ne 1) {
        try { $ec.Collapse() } catch { }
        Fail "Option '$wanted' ist virtualisiert und die zugehoerige Liste ist nicht eindeutig ($($lists.Count)). NICHT geaendert." 'ambiguous'
      }
      if ($script:DESKTOP_NAME) {
        try { $ec.Collapse() } catch { }
        Fail ("Option '$wanted' ist virtualisiert; die noetige PID-verifizierte Seitennavigation ist auf dem " +
              "versteckten Desktop '$($script:DESKTOP_NAME)' nicht moeglich.") 'hidden-desktop'
      }
      if ($guardUserInput -and -not (Test-SSELastInputUnchanged $inputBaseline)) {
        try { $ec.Collapse() } catch { }
        Fail 'Fremde Benutzereingabe unmittelbar vor der virtualisierten Auswahl erkannt. NICHT geaendert.' 'interference'
      }
      try { $ec.Collapse() } catch { }
      $null = Show-SSEWindow $hwnd
      $focusCombo = Get-LiveElement $hwnd $combo.rid $combo.aid
      if (-not $focusCombo) { Fail 'ComboBox wurde vor der virtualisierten Auswahl ungreifbar.' 'stale' }
      $null = Click-VerifiedPoint $hwnd $combo
      $inputBaseline = Get-SSELastInputTick
      Start-Sleep -Milliseconds 80
      if ($null -eq $inputBaseline -or -not (Test-SSELastInputUnchanged $inputBaseline) -or
          [SW]::GetForegroundWindow() -ne $hwnd -or (Get-CurrentHeading $hwnd) -ne $expectedPage) {
        Hide-SSETopmost $hwnd
        Fail 'Eingabe-, Vordergrund- oder Seiteninterferenz beim Fokussieren der virtualisierten ComboBox.' 'interference'
      }
      $focusCombo = Get-LiveElement $hwnd $combo.rid $combo.aid
      $focusEc = $null
      if (-not $focusCombo -or
          -not $focusCombo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$focusEc)) {
        Hide-SSETopmost $hwnd
        Fail 'Virtualisierte ComboBox ist nach dem Fokussieren nicht mehr erweiterbar.' 'stale'
      }
      if ($focusEc.Current.ExpandCollapseState -ne [System.Windows.Automation.ExpandCollapseState]::Expanded) {
        $focusEc.Expand()
      }
      Start-Sleep -Milliseconds 120
      # Qt gibt den Tastaturfokus bei editierbaren ComboBoxen an das Edit-Kind;
      # HOME bewegt dort nur den Textcursor und nicht die virtualisierte Liste.
      # Deshalb ab der aktuell gebundenen Auswahl alphabetisch in Richtung des
      # Zielwerts rollen. Das vermeidet den bisherigen Scheinerfolg, bei dem
      # von "Deutschland" nur D..Z materialisiert wurde und "Bulgarien" nie
      # erscheinen konnte.
      $virtualScrollUp = [StringComparer]::OrdinalIgnoreCase.Compare($wanted, $expectedCurrent) -lt 0
      $inputBaseline = Get-SSELastInputTick
      $seenVirtualPages = New-Object 'System.Collections.Generic.HashSet[string]'
      $seenVirtualNames = New-Object 'System.Collections.Generic.HashSet[string]'
      $virtualMatch = $null
      $lastVirtualNames = @()
      for ($virtualPage = 0; $virtualPage -lt 40; $virtualPage++) {
        Start-Sleep -Milliseconds 90
        if (-not (Test-SSELastInputUnchanged $inputBaseline) -or [SW]::GetForegroundWindow() -ne $hwnd -or
            (Get-CurrentHeading $hwnd) -ne $expectedPage) {
          Hide-SSETopmost $hwnd
          Fail 'Fremde Eingabe, Vordergrund- oder Seitenwechsel waehrend der virtualisierten Auswahl erkannt.' 'interference'
        }
        $virtualTree = Walk-Tree $hwnd 1800 18
        $virtualMatches = @($virtualTree.nodes | Where-Object {
          $_.type -eq 'ListItem' -and $_.name -eq $wanted -and $_.aid -and $_.aid.StartsWith($prefix)
        })
        if ($virtualMatches.Count -gt 1) {
          Hide-SSETopmost $hwnd
          Fail "Virtualisierte Option '$wanted' ist mehrdeutig ($($virtualMatches.Count)). NICHT geaendert." 'ambiguous'
        }
        if ($virtualMatches.Count -eq 1) { $virtualMatch = $virtualMatches[0]; break }
        $lastVirtualNames = @($virtualTree.nodes | Where-Object {
          $_.type -eq 'ListItem' -and $_.name -and $_.aid -and $_.aid.StartsWith($prefix)
        } | Sort-Object y | ForEach-Object { $_.name })
        foreach ($virtualName in $lastVirtualNames) { $null = $seenVirtualNames.Add([string]$virtualName) }
        if ($lastVirtualNames.Count) {
          $firstVisible = [string]$lastVirtualNames[0]
          $lastVisible = [string]$lastVirtualNames[$lastVirtualNames.Count - 1]
          if ([StringComparer]::OrdinalIgnoreCase.Compare($wanted, $firstVisible) -lt 0) {
            $virtualScrollUp = $true
          } elseif ([StringComparer]::OrdinalIgnoreCase.Compare($wanted, $lastVisible) -gt 0) {
            $virtualScrollUp = $false
          }
        }
        $virtualSignature = $lastVirtualNames -join '|'
        if (-not $virtualSignature -or -not $seenVirtualPages.Add($virtualSignature)) { break }
        $virtualList = @($virtualTree.nodes | Where-Object {
          $_.type -eq 'List' -and $_.aid -and $_.aid.StartsWith($prefix) -and $_.w -gt 0 -and $_.h -gt 0
        })
        if ($virtualList.Count -ne 1) { break }
        $wheelX = [int]($virtualList[0].x + [Math]::Min(100, [Math]::Max(20, $virtualList[0].w / 4)))
        $wheelY = [int]($virtualList[0].y + [Math]::Min($virtualList[0].h - 10, [Math]::Max(10, $virtualList[0].h / 2)))
        $wheelPoint = New-Object SW+PT; $wheelPoint.X = $wheelX; $wheelPoint.Y = $wheelY
        $wheelWindow = [SW]::WindowFromPoint($wheelPoint)
        $wheelRoot = [SW]::GetAncestor($wheelWindow, 2)
        $wheelPid = 0; [SW]::GetWindowThreadProcessId($wheelWindow, [ref]$wheelPid) | Out-Null
        $wheelRootRect = New-Object SW+RC
        $wheelRootRectOk = [bool]([SW]::GetWindowRect($wheelRoot, [ref]$wheelRootRect))
        $popupMatchesList = [bool]($wheelRootRectOk -and
          [Math]::Abs($wheelRootRect.L - [int]$virtualList[0].x) -le 25 -and
          [Math]::Abs($wheelRootRect.T - [int]$virtualList[0].y) -le 25 -and
          [Math]::Abs(($wheelRootRect.R - $wheelRootRect.L) - [int]$virtualList[0].w) -le 35 -and
          [Math]::Abs(($wheelRootRect.B - $wheelRootRect.T) - [int]$virtualList[0].h) -le 35)
        if ($wheelPid -ne $targetPid -or
            ([int64]$wheelRoot -ne [int64]$hwnd -and -not $popupMatchesList)) {
          Hide-SSETopmost $hwnd
          Fail 'Virtualisierte Liste ist am berechneten Mausradpunkt nicht mehr PID-/Root-verifiziert.' 'obstructed'
        }
        [SW]::SetCursorPos($wheelX, $wheelY) | Out-Null
        $wheelDelta = $(if ($virtualScrollUp) { [uint32]120 } else { [uint32]([int64]0x100000000 - 120) })
        # Genau ein Standard-Wheel-Schritt pro Readback: je nach Windows-/Qt-
        # Einstellung kann ein Schritt bereits deutlich mehr als drei Zeilen
        # bewegen. Mehrere gebuendelte Schritte uebersprangen sonst kurze
        # alphabetische Bereiche (z. B. Bulgarien zwischen D und A).
        for ($wheelStep = 0; $wheelStep -lt 1; $wheelStep++) {
          [SW]::mouse_event(0x0800, 0, 0, $wheelDelta, [IntPtr]::Zero)
        }
        $inputBaseline = Get-SSELastInputTick
        Set-SSEForegroundLeaseInputCheckpoint $inputBaseline ([pscustomobject]@{ x=$wheelX; y=$wheelY })
      }
      if (-not $virtualMatch) {
        try { $focusEc.Collapse() } catch { }
        Hide-SSETopmost $hwnd
        $wantedStem = $(if ($wanted.Length -ge 4) { $wanted.Substring(0, 4) } else { $wanted })
        $nearVirtualNames = @($seenVirtualNames | Where-Object { $_.StartsWith($wantedStem, [StringComparison]::OrdinalIgnoreCase) } | Sort-Object)
        Fail ("Option '$wanted' wurde in der virtualisierten Liste nicht materialisiert. Aehnliche Optionen: " +
              ($nearVirtualNames -join ', ') + '. Letzter Ausschnitt: ' + ($lastVirtualNames -join ', ')) 'not-found'
      }
      $null = Click-VerifiedPoint $hwnd $virtualMatch
      $inputBaseline = Get-SSELastInputTick
      Start-Sleep -Milliseconds 80
      if ($null -eq $inputBaseline -or -not (Test-SSELastInputUnchanged $inputBaseline)) {
        Hide-SSETopmost $hwnd
        Emit ([pscustomobject]@{
          ok=$false; kind='interference'
          error='Fremde Benutzereingabe unmittelbar nach dem virtualisierten Optionsklick erkannt.'
          page=$expectedPage; before=$before; selected=$wanted; after=$null; expectedAfter=$expectedAfter
          combo=[pscustomobject]@{ rid=$combo.rid; aid=$combo.aid }
          rollback=[pscustomobject]@{ versucht=$false; grund='Kein blinder Rollback nach Benutzereingriff.' }
        })
      }
      Hide-SSETopmost $hwnd
      $method = 'virtualized-paged-click'
    } elseif ($matches.Count -eq 1) {
      if (Test-Versand $matches[0].name) { try { $ec.Collapse() } catch { }; Fail "GESPERRT: Option '$wanted' hat Uebermittlungsbezug." 'blocked' }
      $option = Get-LiveElement $hwnd $matches[0].rid
      $selection = $null
      if ($option -and $option.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection)) {
        $selection.Select()
      } else {
        if ($script:DESKTOP_NAME) {
          Fail ("Option bietet kein SelectionItemPattern; ein verifizierter Mausklick ist auf dem versteckten " +
                "Desktop '$($script:DESKTOP_NAME)' nicht moeglich.") 'hidden-desktop'
        }
        $method = 'verified-point'
        $null = Click-VerifiedPoint $hwnd $matches[0]
        $inputBaseline = Get-SSELastInputTick
        Start-Sleep -Milliseconds 80
        if ($null -eq $inputBaseline -or -not (Test-SSELastInputUnchanged $inputBaseline)) {
          Emit ([pscustomobject]@{
            ok=$false; kind='interference'
            error='Fremde Benutzereingabe unmittelbar nach dem verifizierten Optionsklick erkannt.'
            page=$expectedPage; before=$before; selected=$wanted; after=$null; expectedAfter=$expectedAfter
            combo=[pscustomobject]@{ rid=$combo.rid; aid=$combo.aid }
            rollback=[pscustomobject]@{ versucht=$false; grund='Kein blinder Rollback nach Benutzereingriff.' }
          })
        }
      }
    } else {
      try { $ec.Collapse() } catch { }
      Fail "$($matches.Count) exakt passende Optionen '$wanted' gefunden; NICHT geaendert." 'ambiguous'
    }
    Start-Sleep -Milliseconds 550
    $fresh = Get-LiveElement $hwnd $combo.rid $combo.aid
    $freshValue = $null
    if ($fresh) {
      $freshVp = $null
      if ($fresh.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$freshVp)) { $freshValue = $freshVp.Current.Value }
      if ($null -eq $freshValue) { try { $freshValue = $fresh.Current.Name } catch { } }
      try {
        $freshEc = $null
        if ($fresh.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$freshEc) -and
            $freshEc.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Expanded) { $freshEc.Collapse() }
      } catch { }
    }
    if ("$freshValue" -ne $wanted -and $method -eq 'select' -and "$freshValue" -eq "$before") {
      # Qt kann SelectionItem.Select als erfolgreich quittieren, ohne die
      # Auswahl zu uebernehmen. Nur wenn der Wert nachweislich unveraendert
      # blieb, dieselbe exakt gefundene Option einmal physisch anklicken.
      if ($script:DESKTOP_NAME) {
        Fail ("SelectionItem.Select wurde von Qt nicht uebernommen; der noetige verifizierte Mausklick ist " +
              "auf dem versteckten Desktop '$($script:DESKTOP_NAME)' nicht moeglich.") 'hidden-desktop'
      }
      $retryCombo = Get-LiveElement $hwnd $combo.rid $combo.aid
      $retryEc = $null
      if ($retryCombo -and $retryCombo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$retryEc)) {
        if ($retryEc.Current.ExpandCollapseState -ne [System.Windows.Automation.ExpandCollapseState]::Expanded) { $retryEc.Expand() }
        Start-Sleep -Milliseconds 350
        $retryTree = Walk-Tree $hwnd 1800 18
        $retryMatches = @($retryTree.nodes | Where-Object {
          $_.type -eq 'ListItem' -and $_.name -eq $wanted -and $_.aid -and $_.aid.StartsWith($prefix)
        })
        if ($retryMatches.Count -eq 1) {
          $null = Click-VerifiedPoint $hwnd $retryMatches[0]
          $inputBaseline = Get-SSELastInputTick
          Start-Sleep -Milliseconds 80
          if ($null -eq $inputBaseline -or -not (Test-SSELastInputUnchanged $inputBaseline)) {
            Emit ([pscustomobject]@{
              ok=$false; kind='interference'
              error='Fremde Benutzereingabe unmittelbar nach dem verifizierten Wiederholungsklick erkannt.'
              page=$expectedPage; before=$before; selected=$wanted; after=$freshValue; expectedAfter=$expectedAfter
              combo=[pscustomobject]@{ rid=$combo.rid; aid=$combo.aid }
              rollback=[pscustomobject]@{ versucht=$false; grund='Kein blinder Rollback nach Benutzereingriff.' }
            })
          }
          $method = 'select-then-verified-point'
          Start-Sleep -Milliseconds 550
          $afterRetry = Get-LiveElement $hwnd $combo.rid $combo.aid
          if ($afterRetry) {
            $retryVp = $null
            if ($afterRetry.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$retryVp)) {
              $freshValue = $retryVp.Current.Value
            }
          }
        }
      }
    }
    Start-Sleep -Milliseconds 250
    $afterTree = Walk-Tree $hwnd -WithValues
    $headingAfter = Get-CurrentHeading $hwnd $afterTree
    $interactionAfter = Get-SSEInteractionWindowSet $targetPid $hwnd
    $inputChanged = [bool]($guardUserInput -and -not (Test-SSELastInputUnchanged $inputBaseline))
    $windowChanged = [bool]($interactionAfter.fingerprint -ne $interactionBefore.fingerprint)
    $pageChanged = [bool]($headingAfter -ne $expectedPage)
    $afterCombos = @(Resolve-Nodes $afterTree $selector)
    $bindingChanged = [bool]($afterCombos.Count -ne 1 -or $afterCombos[0].aid -ne $combo.aid)
    if ($inputChanged -or $windowChanged -or $pageChanged -or $bindingChanged) {
      Emit ([pscustomobject]@{
        ok=$false; kind='interference'
        error='Benutzereingabe, Fensterlage, Seite oder ComboBox-Bindung veraenderte sich waehrend der Auswahl.'
        pageBefore=$expectedPage; pageAfter=$headingAfter
        before=$before; selected=$wanted; after=$freshValue; expectedAfter=$expectedAfter; method=$method
        combo=[pscustomobject]@{ rid=$combo.rid; aid=$combo.aid }
        inputGuard=[pscustomobject]@{ aktiv=$guardUserInput; baseline=$inputBaseline; beobachtet=$(Get-SSELastInputTick); eingriffErkannt=$inputChanged }
        windowGuard=[pscustomobject]@{ vorher=$interactionBefore.fingerprint; nachher=$interactionAfter.fingerprint; geaendert=$windowChanged }
        rollback=[pscustomobject]@{ versucht=$false; grund='Kein blinder Rollback nach Eingabe-, Fenster-, Seiten- oder Binding-Interferenz.' }
      })
    }
    if ("$freshValue" -eq $expectedAfter) {
      Emit ([pscustomobject]@{
        ok=$true; before=$before; selected=$wanted; after=$freshValue; expectedAfter=$expectedAfter
        page=$headingAfter; method=$method; verified=$true
        combo=[pscustomobject]@{ rid=$afterCombos[0].rid; aid=$afterCombos[0].aid }
        inputGuard=[pscustomobject]@{ aktiv=$guardUserInput; baseline=$inputBaseline; beobachtet=$(Get-SSELastInputTick); eingriffErkannt=$false }
        windowGuard=[pscustomobject]@{ vorher=$interactionBefore.fingerprint; nachher=$interactionAfter.fingerprint; geaendert=$false }
      })
    }

    # Eine normale verletzte Nachbedingung darf nur dann zurueckgerollt
    # werden, wenn die ComboBox nachweislich noch den von uns gewaehlten Wert
    # zeigt. Unbekannte dritte Werte werden niemals ueberschrieben.
    $rollbackAttempted = $false
    $rollbackValue = $freshValue
    $rollbackOk = [bool]("$freshValue" -eq "$before")
    $rollbackReason = $(if ($rollbackOk) { 'Ausgangswert blieb unveraendert.' } else { $null })
    if (-not $rollbackOk -and "$freshValue" -eq "$wanted") {
      $rollbackAttempted = $true
      try {
        $rollbackCombo = Get-LiveElement $hwnd $afterCombos[0].rid $afterCombos[0].aid
        $rollbackEc = $null
        if (-not $rollbackCombo -or
            -not $rollbackCombo.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$rollbackEc)) {
          throw 'ComboBox ist vor Rollback nicht mehr erweiterbar.'
        }
        if ($rollbackEc.Current.ExpandCollapseState -ne [System.Windows.Automation.ExpandCollapseState]::Expanded) { $rollbackEc.Expand() }
        Start-Sleep -Milliseconds 350
        if ($guardUserInput -and -not (Test-SSELastInputUnchanged $inputBaseline)) {
          throw 'Benutzereingabe vor Rollback erkannt.'
        }
        $rollbackTree = Walk-Tree $hwnd 1800 18
        $rollbackMatches = @($rollbackTree.nodes | Where-Object {
          $_.type -eq 'ListItem' -and $_.name -eq "$before" -and $_.aid -and $_.aid.StartsWith($prefix)
        })
        if ($rollbackMatches.Count -ne 1) { throw "$($rollbackMatches.Count) exakte Ausgangsoptionen '$before' gefunden." }
        $rollbackOption = Get-LiveElement $hwnd $rollbackMatches[0].rid $rollbackMatches[0].aid
        $rollbackSelection = $null
        if (-not $rollbackOption -or
            -not $rollbackOption.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$rollbackSelection)) {
          throw 'Ausgangsoption bietet kein rollbackfaehiges SelectionItemPattern; kein physischer Blindklick.'
        }
        $rollbackSelection.Select()
        Start-Sleep -Milliseconds 550
        $rollbackComboFresh = Get-LiveElement $hwnd $afterCombos[0].rid $afterCombos[0].aid
        $rollbackVp = $null
        if ($rollbackComboFresh -and
            $rollbackComboFresh.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$rollbackVp)) {
          $rollbackValue = [string]$rollbackVp.Current.Value
        }
        try {
          $rollbackCollapse = $null
          if ($rollbackComboFresh -and
              $rollbackComboFresh.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$rollbackCollapse) -and
              $rollbackCollapse.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Expanded) {
            $rollbackCollapse.Collapse()
          }
        } catch { }
        Start-Sleep -Milliseconds 250
        $rollbackFinalTree = Walk-Tree $hwnd -WithValues
        $rollbackFinalHeading = Get-CurrentHeading $hwnd $rollbackFinalTree
        $rollbackFinalWindows = Get-SSEInteractionWindowSet $targetPid $hwnd
        $rollbackOk = [bool](
          "$rollbackValue" -eq "$before" -and $rollbackFinalHeading -eq $expectedPage -and
          $rollbackFinalWindows.fingerprint -eq $interactionBefore.fingerprint -and
          (-not $guardUserInput -or (Test-SSELastInputUnchanged $inputBaseline))
        )
      } catch { $rollbackReason = $_.Exception.Message }
    } elseif (-not $rollbackOk) {
      $rollbackReason = "Unerwarteter fremder/transformierter Wert '$freshValue'; nicht blind ueberschrieben."
    }
    Emit ([pscustomobject]@{
      ok=$false; kind='postcondition-failed'
      error="ComboBox zeigt '$freshValue', erwartet '$expectedAfter'."
      page=$headingAfter; before=$before; selected=$wanted; after=$freshValue; expectedAfter=$expectedAfter; method=$method
      combo=[pscustomobject]@{ rid=$combo.rid; aid=$combo.aid }
      rollback=[pscustomobject]@{ versucht=$rollbackAttempted; erfolgreich=$rollbackOk; ist=$rollbackValue; erwartet=$before; grund=$rollbackReason }
    })
  }

  'get_value' {
    $hwnd = Resolve-Window $a
    $name = [string](Arg $a 'name')
    $aid = [string](Arg $a 'aid')
    $rid = [string](Arg $a 'rid')
    if (-not $name -and -not $aid -and -not $rid) {
      Fail 'sse_get_value braucht name, aid oder rid.' 'bad-args'
    }
    $t = Walk-Tree $hwnd -WithValues
    $nodes = @(Resolve-Nodes $t $a)
    if (-not $nodes.Count) { Fail "Feld '$(if ($name) { $name } elseif ($aid) { $aid } else { $rid })' nicht gefunden." 'not-found' }
    if ($nodes.Count -ne 1) { Fail "Feldselektor ist nicht eindeutig ($($nodes.Count) Treffer)." 'ambiguous' }
    $node = $nodes[0]
    $el = Get-LiveElement $hwnd $node.rid $node.aid
    $vp = $null; $v = $null; $ro = $null
    if ($el -and $el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
      $v = $vp.Current.Value; $ro = $vp.Current.IsReadOnly
    }
    Emit ([pscustomobject]@{ ok = $true; node = $node; value = $v; readOnly = $ro })
  }

  'scroll' {
    $hwnd = Resolve-Window $a
    $t = Walk-Tree $hwnd
    $node = $null
    if ($a.name) { $node = Find-Node $t ([string]$a.name) '' -Contains:([bool](Arg $a 'contains' $false)) }
    $mode = $(if ($a.mode) { [string]$a.mode } else { 'intoview' })
    if ($mode -eq 'intoview') {
      if (-not $node) { Fail 'name eines Elements noetig, das sichtbar werden soll.' 'bad-args' }
      $el = Get-LiveElement $hwnd $node.rid
      $sip = $null
      if (-not $el.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$sip)) {
        Fail "Element '$($a.name)' bietet kein ScrollItemPattern." 'no-scroll-pattern'
      }
      $sip.ScrollIntoView()
      Start-Sleep -Milliseconds 400
      Emit ([pscustomobject]@{ ok = $true; mode = $mode; scrolledTo = $node.name })
    }
    # Container scrollen: Scrollinfo wurde im Baumlauf mitgenommen (siehe
    # -WithScroll), nicht nachtraeglich je Knoten nachgeschlagen.
    $ts = Walk-Tree $hwnd -WithScroll
    $cands = @($ts.nodes | Where-Object { $null -ne $_.scroll } | ForEach-Object {
      [pscustomobject]@{
        node = [pscustomobject]@{ type = $_.type; name = $_.name; aid = $_.aid; x = $_.x; y = $_.y; w = $_.w; h = $_.h; rid = $_.rid }
        vScrollable = $_.scroll.vScrollable; vPercent = $_.scroll.vPercent
        vView = $_.scroll.vView; hScrollable = $_.scroll.hScrollable
      }
    })
    if ($mode -eq 'list') { Emit ([pscustomobject]@{ ok = $true; count = $cands.Count; scrollables = $cands }) }
    $target = @($cands | Where-Object { $_.vScrollable })[0]
    if (-not $target) { Fail 'Kein scrollbarer Container gefunden.' 'no-scroll-pattern' }
    $el = Get-LiveElement $hwnd $target.node.rid
    $sp = $el.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
    $noScroll = [System.Windows.Automation.ScrollPatternIdentifiers]::NoScroll
    $vp2 = $(if ($a.vPercent -ne $null) { [double]$a.vPercent } else { $noScroll })
    $hp2 = $(if ($a.hPercent -ne $null) { [double]$a.hPercent } else { $noScroll })
    $sp.SetScrollPercent($hp2, $vp2)
    Start-Sleep -Milliseconds 400
    Emit ([pscustomobject]@{ ok = $true; mode = 'percent'; target = $target.node.name; vPercent = $sp.Current.VerticalScrollPercent })
  }

  'click_point' {
    # Echter Mausklick auf die Mitte eines Elements.
    #
    # WARUM ES DAS GEBEN MUSS: Qts Baumansicht verdrahtet weder InvokePattern
    # noch SelectionItemPattern mit der Aktivierung. Beide melden Erfolg, aber
    # die Seite wechselt nicht. Oeffentlich bleibt dieser physische Weg
    # ausschliesslich fuer TreeItems des Navigationsbaums bzw. den eng
    # verifizierten read-only Prueferpfad zulaessig. Suche, Checkboxen,
    # Dropdowns, Tabellen und Dialoge besitzen gebundene Spezialwerkzeuge.
    #
    # Das ist KEIN blindes Koordinatenklicken:
    #   1. Koordinaten stammen aus dem Element selbst (BoundingRectangle),
    #      nicht aus einem Bildschirmfoto.
    #   2. Das Fenster wird vorher nach vorn geholt.
    #   3. Vor dem Klick wird geprueft, dass an der Stelle wirklich ein
    #      Fenster DIESES Prozesses liegt (WindowFromPoint).
    # Ohne Schritt 3 landet der Klick auf einem fremden Fenster - genau das
    # ist bei der Entwicklung einmal passiert.
    $nm  = [string](Arg $a 'name')
    $aid = [string](Arg $a 'aid')
    $rid = [string](Arg $a 'rid')
    $checkerReadOnly = [bool](Arg $a 'checkerReadOnly' $false)
    # Ohne Bezeichner wuerde Resolve-Nodes nach LEEREM Namen suchen, die
    # Sortierung Buttons bevorzugen und der erste sichtbare unbeschriftete
    # Knopf physisch geklickt - ohne jede Versandpruefung, weil ein leerer
    # Name keine Pruefung ausloest. Genau ein nichtleerer Bezeichner ist Pflicht.
    if (-not ($nm.Trim()) -and -not ($aid.Trim()) -and -not ($rid.Trim())) {
      Fail ('Ein echter Mausklick braucht einen Bezeichner: name, aid oder rid. ' +
            'Ohne ihn wuerde ein beliebiges unbeschriftetes Element angeklickt.') 'bad-args'
    }
    foreach ($probe in @($nm, $aid)) {
      if ($probe -and (Test-Versand $probe) -and -not $checkerReadOnly) {
        Fail "GESPERRT: '$probe' koennte Daten ans Finanzamt uebermitteln." 'blocked'
      }
    }
    $waitMs = Get-SSEBoundedIntegerArg $a 'waitMs' 1400 100 10000
    Assert-SSEDestructiveAcknowledgement $a @($nm, $aid)
    $hwnd = [IntPtr][int64](Resolve-SSEMainWindowDescriptor $a -RestoreMinimized).hwnd
    $can = Test-Canary $hwnd
    if (-not $can.ok) { Fail "Kanarienvogel traege ($($can.ms) ms) - neu starten." 'degraded' }
    $t = Walk-Tree $hwnd
    $cands = @(Resolve-Nodes $t $a)
    if (-not $cands.Count) { Fail "Element '$(if($nm){$nm}else{$aid})' nicht gefunden." 'not-found' }
    $physicalTargets = @($cands | Where-Object {
      $safeDetailLink = $_.type -eq 'Hyperlink' -and $_.name -match '(?i)(erfassen|bearbeiten)$'
      ($_.type -eq 'TreeItem' -or $safeDetailLink) -and
        $_.w -gt 0 -and $_.h -gt 0 -and $_.x -ge 0
    })
    if (-not $physicalTargets.Count) {
      Fail ('Physische MCP-Klicks sind nur fuer TreeItems des Navigations-/Prueferbaums und eng benannte ' +
            'Erfassen-/Bearbeiten-Hyperlinks zugelassen. ' +
            'Checkboxen mit sse_toggle, Dropdowns mit sse_combo_select, Dialoge fingerprintgebunden und ' +
            'Tabellen ausschliesslich mit Tabellenvertrag bedienen.') 'blocked'
    }
    if ((Arg $a 'contains') -eq $true -and $physicalTargets.Count -ne 1) {
      Fail "Physische Teilstringsuche ist nicht eindeutig ($($physicalTargets.Count) Treffer); nicht geklickt." 'ambiguous'
    }
    $node = $physicalTargets[0]
    # Enger interner Ausweg fuer sse_checker_open: Eine bereits als exakte
    # globale Pruefermeldung verifizierte TreeItem-Zeile darf auch dann zum
    # Lesen aufgeklappt werden, wenn ihr Text das Wort "ELSTER" enthaelt.
    # Andere Elemente, Knöpfe und Abgabewege bleiben unveraendert gesperrt.
    $verifiedCheckerRead = [bool](
      $checkerReadOnly -and $nm -and $node.name -eq $nm -and $node.type -eq 'TreeItem' -and
      $node.aid -like '*PrueferWidgetSSE.SteuerPruefer*'
    )
    if ($checkerReadOnly -and -not $verifiedCheckerRead) {
      Fail 'checkerReadOnly ist nur fuer eine exakte globale Pruefer-TreeItem-Meldung zulaessig.' 'blocked'
    }
    foreach ($probe in @($node.name, $node.aid)) {
      if ($probe -and (Test-Versand $probe) -and -not $verifiedCheckerRead) {
        Fail "GESPERRT: Das getroffene Element ('$probe') koennte uebermitteln." 'blocked'
      }
    }
    Assert-SSEDestructiveAcknowledgement $a @($node.name, $node.aid)

    # Bei Qt-TreeItems umfasst das BoundingRectangle die komplette Zeile bis
    # zum rechten Rand des Navigationsbereichs. Deren Mitte liegt oft weit
    # rechts neben dem sichtbaren Text und loest keine Auswahl aus. Innerhalb
    # des labelnahen linken Bereichs klicken; fuer alle anderen Typen bleibt
    # die geometrische Mitte richtig.
    $px = $(if ($node.type -eq 'TreeItem') {
      [int]($node.x + [Math]::Min(50, [Math]::Max(8, $node.w / 3)))
    } else { [int]($node.x + $node.w / 2) })
    $py = [int]($node.y + $node.h / 2)

    # Ueberschrift VOR dem Klick merken - nur so laesst sich hinterher sagen,
    # ob der Klick ueberhaupt etwas bewirkt hat.
    $tv = $t
    $bv = Get-ContentBounds $tv $hwnd
    $rv = New-Object SW+RC; [SW]::GetWindowRect($hwnd, [ref]$rv) | Out-Null
    $kopfVorher = ($tv.nodes | Where-Object { $_.type -eq 'Text' -and $_.x -ge $bv.minX -and $_.x -le $bv.maxX -and
                                              $_.y -ge ($rv.T + 190) -and $_.y -le ($rv.T + 290) } |
                   Sort-Object y | Select-Object -First 1).name
    $fingerprintVorher = Get-SSETextSha256 ((@($tv.nodes | ForEach-Object {
      "$($_.type)|$($_.name)|$($_.aid)|$($_.val)|$($_.selected)"
    })) -join "`n")
    $dirtyBefore = Get-DirtyStateFast $hwnd

    # Versuch, ohne Vordergrund zu klicken: Mausnachrichten direkt an das
    # Fenster posten.
    #
    # GEMESSEN: Qt 6 ignoriert das. Getestet wurden PostMessage und
    # SendMessage, jeweils an das Hauptfenster und an das Kindfenster mit
    # dessen eigenen Client-Koordinaten - der Vordergrund blieb unberuehrt,
    # aber es passierte auch nichts. Qt wertet nur echte Eingaben aus.
    #
    # Deshalb ist dieser Weg NICHT die Vorgabe. Nur mit background=true,
    # falls eine kuenftige Programmversion es doch verarbeitet.
    if ((Arg $a 'background') -eq $true) {
      $pt = New-Object SW+PT; $pt.X = $px; $pt.Y = $py
      [SW]::ScreenToClient($hwnd, [ref]$pt) | Out-Null
      $lp = [IntPtr](($pt.Y -shl 16) -bor ($pt.X -band 0xFFFF))
      $WM_MOUSEMOVE = 0x0200; $WM_LBUTTONDOWN = 0x0201; $WM_LBUTTONUP = 0x0202
      $WM_LBUTTONDBLCLK = 0x0203; $MK_LBUTTON = [IntPtr]1
      [SW]::PostMessage($hwnd, $WM_MOUSEMOVE, [IntPtr]::Zero, $lp) | Out-Null
      Start-Sleep -Milliseconds 60
      [SW]::PostMessage($hwnd, $WM_LBUTTONDOWN, $MK_LBUTTON, $lp) | Out-Null
      Start-Sleep -Milliseconds 40
      [SW]::PostMessage($hwnd, $WM_LBUTTONUP, [IntPtr]::Zero, $lp) | Out-Null
      if ((Arg $a 'double') -eq $true) {
        Start-Sleep -Milliseconds 60
        [SW]::PostMessage($hwnd, $WM_LBUTTONDBLCLK, $MK_LBUTTON, $lp) | Out-Null
        Start-Sleep -Milliseconds 40
        [SW]::PostMessage($hwnd, $WM_LBUTTONUP, [IntPtr]::Zero, $lp) | Out-Null
      }
      Start-Sleep -Milliseconds $waitMs
      Emit ([pscustomobject]@{
        ok = $true; clicked = $node.name; at = "$px,$py"; clientAt = "$($pt.X),$($pt.Y)"
        double = ((Arg $a 'double') -eq $true); method = 'PostMessage'
        ungespeichertVorher=$dirtyBefore; ungespeichertNachher=$(Get-DirtyStateFast $hwnd)
        node = $node
        note = 'Ohne Vordergrund geklickt. Wirkt der Klick nicht, mit foreground=true wiederholen.'
      })
    }

    # SetForegroundWindow scheitert aus einem Hintergrundprozess (Windows
    # laesst nur den aktuellen Vordergrundprozess den Fokus vergeben).
    # SetWindowPos mit HWND_TOPMOST hebt das Fenster trotzdem nach oben -
    # das genuegt, damit der Klick es trifft. Danach wieder zuruecknehmen.
    $HWND_TOPMOST = [IntPtr](-1); $HWND_NOTOPMOST = [IntPtr](-2)
    $SWP = 0x0001 -bor 0x0002 -bor 0x0010   # NOSIZE | NOMOVE | NOACTIVATE
    $null = Show-SSEWindow $hwnd
    Start-Sleep -Milliseconds 450

    # Sicherheitspruefung: liegt an der Stelle wirklich ein Fenster DIESES
    # Prozesses? Ohne das landet der Klick auf einem fremden Fenster.
    $zielPid = 0; [SW]::GetWindowThreadProcessId($hwnd, [ref]$zielPid) | Out-Null
    $pt = New-Object SW+PT; $pt.X = $px; $pt.Y = $py
    $unter = [SW]::WindowFromPoint($pt)
    $trefferRoot = [SW]::GetAncestor($unter, 2) # GA_ROOT
    $trefferPid = 0; [SW]::GetWindowThreadProcessId($unter, [ref]$trefferPid) | Out-Null
    if ($trefferPid -ne $zielPid -or [int64]$trefferRoot -ne [int64]$hwnd) {
      [SW]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP) | Out-Null
      Fail ("Abgebrochen: an Position $px,$py liegt nicht das gebundene Hauptfenster " +
            "(PID $trefferPid/$zielPid, Root $([int64]$trefferRoot)/$([int64]$hwnd)). " +
            "Es wurde NICHT geklickt. Bitte die SteuerSparErklaerung sichtbar in den Vordergrund holen.") 'obstructed'
    }

    $alt = New-Object SW+PT; [SW]::GetCursorPos([ref]$alt) | Out-Null
    [SW]::SetCursorPos($px, $py) | Out-Null
    Start-Sleep -Milliseconds 120
    [SW]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)   # LEFTDOWN
    [SW]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)   # LEFTUP
    if ((Arg $a 'double') -eq $true) {
      Start-Sleep -Milliseconds 90
      [SW]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
      [SW]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
    }
    Start-Sleep -Milliseconds $waitMs
    [SW]::SetCursorPos($alt.X, $alt.Y) | Out-Null        # Zeiger zurueck
    Set-SSEForegroundLeaseInputCheckpoint (Get-SSELastInputTick) ([pscustomobject]@{ x=$alt.X; y=$alt.Y })
    $windowClosed = -not [SW]::IsWindow($hwnd)
    if (-not $windowClosed) { [SW]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP) | Out-Null }

    # Bei Dialogschaltflaechen ist das Verschwinden des exakt adressierten
    # Dialogfensters die staerkste Nachbedingung. Der fruehere Code versuchte
    # danach trotzdem FromHandle und meldete einen Fehler, obwohl der Klick
    # erfolgreich gespeichert bzw. den Dialog geschlossen hatte.
    if ($windowClosed) {
      Emit ([pscustomobject]@{
        ok = $true; clicked = $node.name; at = "$px,$py"; double = ((Arg $a 'double') -eq $true)
        node = $node; windowClosed = $true; verified = $true
        note = 'Das exakt adressierte Fenster wurde durch den Klick geschlossen.'
      })
    }

    # GEGENPROBE. Auf einem versteckten Desktop gibt es keinen physischen
    # Zeiger: der Klick wird zwar abgesetzt, Qt reagiert aber nicht. Ohne
    # diese Pruefung meldet das Werkzeug faelschlich Erfolg.
    $t2 = Walk-Tree $hwnd 900
    $b2 = Get-ContentBounds $t2 $hwnd
    $r2 = New-Object SW+RC; [SW]::GetWindowRect($hwnd, [ref]$r2) | Out-Null
    $kopfNachher = ($t2.nodes | Where-Object { $_.type -eq 'Text' -and $_.x -ge $b2.minX -and $_.x -le $b2.maxX -and
                                               $_.y -ge ($r2.T + 190) -and $_.y -le ($r2.T + 290) } |
                    Sort-Object y | Select-Object -First 1).name
    $fingerprintNachher = Get-SSETextSha256 ((@($t2.nodes | ForEach-Object {
      "$($_.type)|$($_.name)|$($_.aid)|$($_.val)|$($_.selected)"
    })) -join "`n")
    $gewirkt = ($kopfNachher -ne $kopfVorher) -or ($fingerprintNachher -ne $fingerprintVorher)

    if ($script:DESKTOP_NAME -and -not $gewirkt) {
      Fail ("Der Klick auf '$($node.name)' blieb wirkungslos - auf dem versteckten Desktop " +
            "'$($script:DESKTOP_NAME)' gibt es keinen physischen Mauszeiger, Qt verarbeitet " +
            "solche Klicks nicht. Nur Schaltflaechen ueber sse_click (InvokePattern) wirken dort. " +
            "Fuer Navigationsbaum oder Trefferlisten vorher sse_desktop_stop und sichtbar arbeiten.") 'hidden-desktop'
    }

    Emit ([pscustomobject]@{
      ok = $true; clicked = $node.name; at = "$px,$py"; double = ((Arg $a 'double') -eq $true)
      node = $node
      ueberschriftVorher = $kopfVorher; ueberschriftNachher = $kopfNachher; seiteGewechselt = $gewirkt
      uiFingerprintVorher=$fingerprintVorher; uiFingerprintNachher=$fingerprintNachher
      ungespeichertVorher=$dirtyBefore; ungespeichertNachher=$(Get-DirtyStateFast $hwnd)
      note = 'Fenster wurde dafuer kurz nach oben geholt und danach zurueckgesetzt.'
    })
  }

  'keys' {
    Fail ('Roh-Tastatureingabe ist aus der MCP-Oberflaeche entfernt und auch bei direktem Worker-Aufruf gesperrt. ' +
          'Suche ueber sse_goto, Tabellen ueber sse_table_read/add/update/delete, Checkboxen ueber sse_toggle ' +
          'und Felder ueber sse_change_known_field/sse_change_field steuern.') 'blocked'
  }

  'launch' {
    $exe  = [string]$a.exe
    if (-not $exe) { $exe = $script:SSE_DEFAULT_EXE }
    $mode = $(if ($a.mode) { [string]$a.mode } else { 'einur' })
    $file = [string]$a.file
    $null = Get-SSEStartModeType $mode
    $productIdentity = Assert-SSEExecutable $exe
    $caseIdentity = $(if ($file) { Get-SSECaseIdentity $file $mode } else { $null })
    # Steuerfallpfade enthalten oft Leerzeichen. Deshalb immer LiteralPath.
    # Ohne Anfuehrungszeichen zerlegt Start-Process ihn in zwei Argumente -
    # das Programm startet dann mit einem LEEREN Steuerfall, ohne Fehler.
    # Das ist genau so passiert und blieb lange unbemerkt.
    $argl = @("-m$mode")
    if ($caseIdentity) { $argl += ('"' + $caseIdentity.path + '"') }
    # Der Node-Worker selbst laeuft absichtlich mit windowsHide=true, damit kein
    # schwarzes PowerShell-Fenster aufblitzt. Ohne die explizite Fensterform
    # erbt die gestartete GUI diesen versteckten Zustand und bleibt unsichtbar.
    $started = Start-Process -FilePath $productIdentity.path -ArgumentList $argl -WindowStyle Normal -PassThru
    Emit ([pscustomobject]@{
      # Fenster und Dialoge werden absichtlich erst durch frische Worker im
      # API-Executor verifiziert. Der Startprozess selbst kann seine von Qt
      # erzeugten Top-Level-Fenster in bestimmten Windows-Sitzungen nicht
      # inventarisieren, waehrend der naechste Worker sie eindeutig sieht.
      ok = $true; launched = $true; pid=[int]$started.Id; args = $argl; waitedSec = 0
      windows=@(); instance=$null; ready=$false; blockedByDialog=$false; dialogs=@()
      product=$productIdentity; case=$caseIdentity
    })
  }

  'save' {
    # Bestehenden Steuerfall nur speichern, wenn der Aufrufer den aktuell
    # geoeffneten Pfad und dessen Vorher-Hash kennt. Dadurch kann ein Agent
    # weder einen falschen Fall noch eine namenlose Wiederherstellung
    # versehentlich ueberschreiben.
    $expectedPathRaw = [string](Arg $a 'expectedPath')
    $expectedHash = ([string](Arg $a 'expectedHashBefore')).ToUpperInvariant()
    if (-not $expectedPathRaw -or -not $expectedHash) {
      Fail 'expectedPath und expectedHashBefore sind fuer sicheres Speichern Pflicht.' 'bad-args'
    }
    $expectedPath = [IO.Path]::GetFullPath($expectedPathRaw)
    if (-not (Test-Path -LiteralPath $expectedPath -PathType Leaf)) {
      Fail "Erwartete Falldatei fehlt: $expectedPath" 'not-found'
    }
    $hwnd = [IntPtr][int64](Resolve-SSEMainWindowDescriptor $a -RestoreMinimized).hwnd
    $wins = @(Get-Windows 'SSE')
    $main = @($wins | Where-Object { [int64]$_.hwnd -eq [int64]$hwnd })[0]
    $binding = Test-CaseBinding $main $expectedPath
    if (-not $binding.ok) {
      Fail "Pfadvertrag verletzt: Fenster gehoert nicht nachweisbar zu '$expectedPath'. NICHT gespeichert." 'precondition-failed'
    }
    $before = Get-Sha256 $expectedPath
    if ($before -ne $expectedHash) {
      Fail "Hashvertrag verletzt: '$before', erwartet '$expectedHash'. NICHT gespeichert." 'precondition-failed'
    }
    $itemBefore = Get-Item -LiteralPath $expectedPath
    $summaryBefore = Get-CaseSummary $expectedPath
    if (-not $summaryBefore) { Fail 'Falldateikopf konnte vor dem Speichern nicht gelesen werden.' 'parse-failed' }

    $tree = Walk-Tree $hwnd 1200
    # Die Suchansicht ersetzt in Qt die normale Hauptsymbolleiste. Dann ist
    # der Fall korrekt gebunden und geaendert, aber "Sichern" existiert im
    # UIA-Baum voruebergehend nicht. Die Suche ist nur eine nicht-modale
    # Ansicht; gezieltes Schliessen veraendert keine Steuerdaten. Danach muss
    # die Schaltflaeche im selben, bereits pfadgebundenen Fenster auftauchen.
    $searchClosedBeforeSave = $false
    $closeSearchNode = @($tree.nodes | Where-Object {
      $_.type -eq 'Button' -and (ConvertTo-Vergleichsform $_.name) -eq 'sucheschliessen' -and $_.on
    })[0]
    if ($closeSearchNode) {
      $closeSearchElement = Get-LiveElement $hwnd $closeSearchNode.rid
      if (-not $closeSearchElement) { Fail "Schaltflaeche 'Suche schliessen' nicht mehr greifbar." 'stale' }
      try { $closeSearchElement.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
      catch { Fail "Suchansicht liess sich vor dem Speichern nicht schliessen: $($_.Exception.Message.Split("`n")[0])" 'pattern-failed' }
      Start-Sleep -Milliseconds 700
      $tree = Walk-Tree $hwnd 1200
      $searchClosedBeforeSave = $true
    }
    $saveNode = @($tree.nodes | Where-Object { $_.type -eq 'Button' -and $_.name -eq 'Sichern' })[0]
    if (-not $saveNode) { Fail "Schaltflaeche 'Sichern' nicht gefunden." 'not-found' }
    if (-not $saveNode.on) {
      Emit ([pscustomobject]@{
        ok = $true; saved = $false; noChanges = $true; path = $expectedPath
        hashBefore = $before; hashAfter = $before; binding = $binding; verified = $true
        searchClosedBeforeSave = $searchClosedBeforeSave
        note = 'Sichern ist deaktiviert; es gibt keine ungespeicherten Aenderungen.'
      })
    }
    $saveElement = Get-LiveElement $hwnd $saveNode.rid
    if (-not $saveElement) { Fail "Schaltflaeche 'Sichern' nicht mehr greifbar." 'stale' }
    try { $saveElement.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
    catch { Fail "Sichern liess sich nicht ausloesen: $($_.Exception.Message.Split("`n")[0])" 'pattern-failed' }

    $waitMs = [Math]::Min(30000, [Math]::Max(800, [int](Arg $a 'waitMs' 2200)))
    Start-Sleep -Milliseconds $waitMs
    $after = Get-Sha256 $expectedPath
    $itemAfter = Get-Item -LiteralPath $expectedPath
    $summaryAfter = Get-CaseSummary $expectedPath
    $treeAfter = Walk-Tree $hwnd 1200
    $saveAfter = @($treeAfter.nodes | Where-Object { $_.type -eq 'Button' -and $_.name -eq 'Sichern' })[0]
    $dialogWindows = @(Get-DialogInventory | Where-Object { $_.kind -in @('native-dialog','qt-dialog') })
    # FileSavedBy darf sich beim ersten Speichern nach einem Programmupdate
    # legitim aendern (z. B. 31.26 -> 31.30). Identitaet, Steuerjahr,
    # Steuernummer und insbesondere der Uebermittlungsstatus muessen dagegen
    # unveraendert bleiben.
    $identityBefore = [ordered]@{
      FileType = $summaryBefore.header.FileType
      VJahr = $summaryBefore.header.VJahr
      Steuernummer = $summaryBefore.header.Steuernummer
      ElsterTransferTime = $summaryBefore.header.ElsterTransferTime
      MitElsterVersendetText = $summaryBefore.header.MitElsterVersendetText
    }
    $identityAfter = $(if ($summaryAfter) { [ordered]@{
      FileType = $summaryAfter.header.FileType
      VJahr = $summaryAfter.header.VJahr
      Steuernummer = $summaryAfter.header.Steuernummer
      ElsterTransferTime = $summaryAfter.header.ElsterTransferTime
      MitElsterVersendetText = $summaryAfter.header.MitElsterVersendetText
    } } else { $null })
    $headerStable = ($null -ne $identityAfter -and
                     ($identityBefore | ConvertTo-Json -Compress) -eq ($identityAfter | ConvertTo-Json -Compress) -and
                     $summaryBefore.transmitted -eq $summaryAfter.transmitted)
    $mtimeAdvanced = ($itemAfter.LastWriteTimeUtc -gt $itemBefore.LastWriteTimeUtc)
    $verified = ($after -and $after -ne $before -and $mtimeAdvanced -and $headerStable -and
                 $saveAfter -and -not $saveAfter.on -and -not $dialogWindows.Count)
    if (-not $verified) {
      Emit ([pscustomobject]@{
        ok = $false; kind = 'postcondition-failed'
        error = 'Speichern wurde ausgeloest, aber Hashwechsel, deaktivierte Sichern-Schaltflaeche und Dialogfreiheit sind nicht gemeinsam bestaetigt.'
        path = $expectedPath; hashBefore = $before; hashAfter = $after
        mtimeBeforeUtc = $itemBefore.LastWriteTimeUtc.ToString('o'); mtimeAfterUtc = $itemAfter.LastWriteTimeUtc.ToString('o')
        headerStable = $headerStable; headerBefore = $summaryBefore.header; headerAfter = $(if ($summaryAfter) { $summaryAfter.header } else { $null })
        identityBefore = $identityBefore; identityAfter = $identityAfter
        saveEnabledAfter = $(if ($saveAfter) { [bool]$saveAfter.on } else { $null })
        searchClosedBeforeSave = $searchClosedBeforeSave
        openWindows = $dialogWindows; verified = $false
        warning = 'Fall geoeffnet lassen und Zustand pruefen; nicht erneut blind speichern.'
      })
    }
    Emit ([pscustomobject]@{
      ok = $true; saved = $true; noChanges = $false; path = $expectedPath
      hashBefore = $before; hashAfter = $after; binding = $binding; saveEnabledAfter = $false; verified = $true
      searchClosedBeforeSave = $searchClosedBeforeSave
      mtimeBeforeUtc = $itemBefore.LastWriteTimeUtc.ToString('o'); mtimeAfterUtc = $itemAfter.LastWriteTimeUtc.ToString('o')
      header = $summaryAfter.header; transmitted = $summaryAfter.transmitted
      fileSavedByChanged = ($summaryBefore.header.FileSavedBy -ne $summaryAfter.header.FileSavedBy)
    })
  }

  'file_dialog_select' {
    # Eng begrenzte Bedienung eines bereits offenen nativen Windows-
    # Oeffnen-Dialogs. Anders als generische Tastendruecke bindet dieser Weg
    # Dialogtitel, existierende Quelldatei, optionalen Hash, Dateiname-Feld
    # und Oeffnen-Schaltflaeche an explizite Vor- und Nachbedingungen.
    if ($script:DESKTOP_NAME) { Fail 'Dateiauswahl braucht den sichtbaren Desktop.' 'hidden-desktop' }
    $expectedTitle = [string](Arg $a 'expectedDialogTitle')
    $pathRaw = [string](Arg $a 'expectedPath')
    $expectedHash = ([string](Arg $a 'expectedHash')).ToUpperInvariant()
    if (-not $expectedTitle -or -not $pathRaw) {
      Fail 'expectedDialogTitle und expectedPath sind Pflicht.' 'bad-args'
    }
    if (Test-Versand $expectedTitle) { Fail 'Dialogtitel hat Uebermittlungsbezug.' 'blocked' }
    $path = [IO.Path]::GetFullPath($pathRaw)
    $isSaveDialog = [bool]($expectedTitle -match '(?i)(speichern|save)')
    $isFolderDialog = [bool]($expectedTitle -match '(?i)(verzeichnis|ordner|folder)')
    if ($isFolderDialog) {
      if ($expectedHash) { Fail 'expectedHash ist bei einer Ordnerauswahl nicht zulaessig.' 'bad-args' }
      if (-not (Test-Path -LiteralPath $path -PathType Container)) { Fail "Ausgabeordner fehlt: $path" 'not-found' }
      if ($expectedTitle -eq 'Ausgabe-Verzeichnis wählen' -and @(Get-ChildItem -LiteralPath $path -Force).Count) {
        Fail "Das Exportverzeichnis ist nicht leer: $path" 'precondition-failed'
      }
      $actualHash = $null
    } elseif ($isSaveDialog) {
      if ($expectedHash) { Fail 'expectedHash ist bei einem neuen Speicherziel nicht zulaessig.' 'bad-args' }
      if (Test-Path -LiteralPath $path) { Fail "Speicherziel existiert bereits: $path" 'exists' }
      $parent = Split-Path $path -Parent
      if (-not (Test-Path -LiteralPath $parent -PathType Container)) { Fail "Zielordner fehlt: $parent" 'not-found' }
      $actualHash = $null
    } else {
      if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail "Auswahldatei fehlt: $path" 'not-found' }
      $actualHash = Get-Sha256 $path
      if ($expectedHash -and $actualHash -ne $expectedHash) {
        Fail 'Datei-Hash stimmt nicht. Dialog wurde NICHT bedient.' 'precondition-failed'
      }
    }

    $dialogs = @(Get-Windows 'SSE' | Where-Object {
      $_.cls -eq '#32770' -and $_.title -eq $expectedTitle
    })
    if ($dialogs.Count -ne 1) {
      Fail "$($dialogs.Count) exakt passende Dateidialoge '$expectedTitle' gefunden." 'dialog-not-found'
    }
    $dialog = $dialogs[0]
    $dialogHwnd = [IntPtr][int64]$dialog.hwnd
    if ($isFolderDialog) {
      # Der moderne Windows-Ordnerdialog enthaelt einen grossen, teilweise
      # zyklischen Namespace-Baum. Ein kompletter TreeWalker-Lauf kann dort
      # zig Sekunden dauern und den unteren Eingabebereich nie erreichen.
      # Die stabilen nativen Control-IDs 1152/1001 (Ordnerfeld) und 1
      # (Bestaetigung) werden deshalb direkt ueber GetDlgItem gebunden. Das
      # umgeht den problematischen Namespace-Baum vollstaendig.
      $fieldHandle = [SW]::GetDlgItem($dialogHwnd, 1152)
      if ($fieldHandle -eq [IntPtr]::Zero) { $fieldHandle = [SW]::GetDlgItem($dialogHwnd, 1001) }
      $buttonHandle = [SW]::GetDlgItem($dialogHwnd, 1)
      $observedFolderControls = New-Object System.Collections.ArrayList
      if ($fieldHandle -eq [IntPtr]::Zero) {
        $fieldHandles = New-Object System.Collections.ArrayList
        $fieldEnum = [SW+EP]{
          param($childHwnd, $lparam)
          $controlId = [SW]::GetDlgCtrlID($childHwnd)
          $candidateRect = New-Object SW+RC
          if ([SW]::GetWindowRect($childHwnd, [ref]$candidateRect)) {
            if ($candidateRect.T -gt ($dialog.y + [int]($dialog.h * 0.65))) {
              $null = $observedFolderControls.Add("$controlId@$($candidateRect.L),$($candidateRect.T),$($candidateRect.R-$candidateRect.L)x$($candidateRect.B-$candidateRect.T)")
            }
            if ($controlId -in @(1001,1152) -and
                $candidateRect.T -gt ($dialog.y + [int]($dialog.h * 0.70)) -and
                ($candidateRect.R - $candidateRect.L) -gt 100) {
              $null = $fieldHandles.Add($childHwnd)
            }
          }
          return $true
        }
        [SW]::EnumChildWindows($dialogHwnd, $fieldEnum, [IntPtr]::Zero) | Out-Null
        if ($fieldHandles.Count -eq 1) { $fieldHandle = [IntPtr]$fieldHandles[0] }
      }
      if ($fieldHandle -eq [IntPtr]::Zero -or $buttonHandle -eq [IntPtr]::Zero) {
        Fail "Nativer Ordnerdialog hat die erwarteten Control-IDs nicht exponiert (1152/1001=$([int64]$fieldHandle), 1=$([int64]$buttonHandle)); untere Controls: $(@($observedFolderControls | Select-Object -Unique) -join '; ')." 'dialog-unmapped'
      }
      $fieldRect = New-Object SW+RC
      $buttonRect = New-Object SW+RC
      if (-not [SW]::GetWindowRect($fieldHandle, [ref]$fieldRect) -or
          -not [SW]::GetWindowRect($buttonHandle, [ref]$buttonRect)) {
        Fail 'Geometrie des nativen Ordnerdialogs ist nicht lesbar.' 'dialog-unmapped'
      }
      $buttonText = New-Object Text.StringBuilder 128
      [SW]::GetWindowTextW($buttonHandle, $buttonText, 128) | Out-Null
      if ($buttonText.ToString() -notin @('Ordner auswählen','Select Folder')) {
        Fail "Control-ID 1 ist nicht die erwartete Ordnerauswahl-Schaltflaeche ('$($buttonText.ToString())')." 'dialog-unmapped'
      }
      $field = [pscustomobject]@{
        x=$fieldRect.L; y=$fieldRect.T; w=($fieldRect.R-$fieldRect.L); h=($fieldRect.B-$fieldRect.T)
        name='Ordner'; aid='1001'
      }
      $folderButton = [pscustomobject]@{
        x=$buttonRect.L; y=$buttonRect.T; w=($buttonRect.R-$buttonRect.L); h=($buttonRect.B-$buttonRect.T)
        name=$buttonText.ToString(); aid='1'
      }
      $null = Click-VerifiedPoint $dialogHwnd $field
      [System.Windows.Forms.SendKeys]::SendWait('^a')
      [System.Windows.Forms.SendKeys]::SendWait((ConvertTo-SendKeysLiteral $path))
      Set-SSEForegroundLeaseInputCheckpoint (Get-SSELastInputTick)
      Start-Sleep -Milliseconds 400

      $null = Click-VerifiedPoint $dialogHwnd $folderButton
      Start-Sleep -Milliseconds ([int](Arg $a 'waitMs' 1800))
      if ([SW]::IsWindow($dialogHwnd)) {
        Fail 'Ordnerdialog ist nach der Auswahl noch vorhanden; keine Wiederholung.' 'postcondition-failed'
      }
      Emit ([pscustomobject]@{
        ok=$true; selected=$path; sha256=$null; dialogTitle=$expectedTitle; mode='select-folder'
        dialogClosed=$true; verified=$true
      })
    }
    $tree = Walk-Tree $dialogHwnd 1500 -WithValues
    $labels = @($tree.nodes | Where-Object {
      $_.type -in @('Pane','Text') -and $_.aid -in @('1090','SaveDialogLabel') -and $_.name -in @('Dateiname:','File name:','Ordner:','Folder:')
    })
    if ($labels.Count -ne 1) {
      Emit ([pscustomobject]@{ ok=$false; kind='dialog-unmapped'; error="$($labels.Count) Dateiname-Beschriftungen gefunden."; dialog=$dialog; nodes=$tree.nodes })
    }
    $label = $labels[0]
    $fields = @($tree.nodes | Where-Object {
      $_.type -eq 'Pane' -and $_.aid -in @('1148','1001') -and $_.w -gt 100 -and
      $_.x -gt $label.x -and [Math]::Abs($_.y - $label.y) -lt 15
    } | Sort-Object d -Descending)
    if (-not $fields.Count) {
      Emit ([pscustomobject]@{ ok=$false; kind='dialog-unmapped'; error='Kein Dateiname-Eingabefeld gefunden.'; dialog=$dialog; nodes=$tree.nodes })
    }
    $field = $fields[0]
    $null = Click-VerifiedPoint $dialogHwnd $field
    [System.Windows.Forms.SendKeys]::SendWait('^a')
    [System.Windows.Forms.SendKeys]::SendWait((ConvertTo-SendKeysLiteral $path))
    Set-SSEForegroundLeaseInputCheckpoint (Get-SSELastInputTick)
    Start-Sleep -Milliseconds 400

    $treeAfterInput = Walk-Tree $dialogHwnd 1500 -WithValues
    $fieldAfter = @($treeAfterInput.nodes | Where-Object {
      $_.rid -eq $field.rid -or ($_.type -eq 'Pane' -and $_.aid -eq $field.aid -and $_.x -eq $field.x -and $_.y -eq $field.y)
    })[0]
    $shown = $(if ($fieldAfter.val) { [string]$fieldAfter.val } else { [string]$fieldAfter.name })
    $leaf = [IO.Path]::GetFileName($path)
    if ($shown -and $shown -ne $path -and $shown -ne $leaf) {
      Emit ([pscustomobject]@{ ok=$false; kind='postcondition-failed'; error='Dateiname-Feld zeigt nicht die erwartete Datei.'; expected=$path; actual=$shown })
    }
    $allowedActionNames = $(
      if ($isFolderDialog) { @('Ordner auswählen','Select Folder') }
      elseif ($isSaveDialog) { @('Speichern','Save') }
      else { @('Oeffnen','Öffnen','Open') }
    )
    $openButtons = @($treeAfterInput.nodes | Where-Object {
      $_.type -eq 'Pane' -and $_.aid -eq '1' -and $_.name -in $allowedActionNames -and $_.on
    })
    if ($openButtons.Count -ne 1) {
      Emit ([pscustomobject]@{ ok=$false; kind='dialog-unmapped'; error="$($openButtons.Count) aktive Dateidialog-Aktionsschaltflaechen gefunden."; dialog=$dialog; nodes=$treeAfterInput.nodes })
    }
    $null = Click-VerifiedPoint $dialogHwnd $openButtons[0]
    Start-Sleep -Milliseconds ([int](Arg $a 'waitMs' 1800))
    if ([SW]::IsWindow($dialogHwnd)) {
      Emit ([pscustomobject]@{
        ok=$false; kind='postcondition-failed'; error='Dateidialog ist nach der Aktion noch vorhanden.'
        dialog=$dialog; expectedPath=$path; fieldReadback=$shown
      })
    }
    if ($isSaveDialog) {
      if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Fail 'Speicherdialog wurde geschlossen, aber die erwartete Zieldatei fehlt.' 'postcondition-failed'
      }
      $actualHash = Get-Sha256 $path
    }
    Emit ([pscustomobject]@{
      ok=$true; selected=$path; sha256=$actualHash; dialogTitle=$expectedTitle
      mode=$(if ($isFolderDialog) { 'select-folder' } elseif ($isSaveDialog) { 'save-new' } else { 'open-existing' })
      dialogClosed=$true; verified=$true
    })
  }

  'save_as' {
    # Strg+Alt+S ist der in SSE angezeigte Befehl "Speichern unter...".
    # Anders als die generische Tastenfunktion darf nur diese eng begrenzte
    # Operation die Alt-Kombination senden. Zielpfad und Quellpfad werden
    # davor und danach verifiziert.
    if ($script:DESKTOP_NAME) { Fail 'Speichern unter braucht den sichtbaren Desktop.' 'hidden-desktop' }
    $sourcePathRaw = [string](Arg $a 'expectedSourcePath')
    $sourceHash = ([string](Arg $a 'expectedSourceHash')).ToUpperInvariant()
    $targetPathRaw = [string](Arg $a 'targetPath')
    if (-not $sourcePathRaw -or -not $sourceHash -or -not $targetPathRaw) {
      Fail 'expectedSourcePath, expectedSourceHash und targetPath sind Pflicht.' 'bad-args'
    }
    $sourcePath = [IO.Path]::GetFullPath($sourcePathRaw)
    $targetPath = [IO.Path]::GetFullPath($targetPathRaw)
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { Fail "Quelldatei fehlt: $sourcePath" 'not-found' }
    if ((Get-Sha256 $sourcePath) -ne $sourceHash) { Fail 'Quell-Hash stimmt nicht. NICHT gespeichert.' 'precondition-failed' }
    if (Test-Path -LiteralPath $targetPath) { Fail "Zieldatei existiert bereits: $targetPath" 'exists' }
    $targetDir = Split-Path -Parent $targetPath
    if (-not (Test-Path -LiteralPath $targetDir -PathType Container)) { Fail "Zielordner fehlt: $targetDir" 'not-found' }

    $hwnd = [IntPtr][int64](Resolve-SSEMainWindowDescriptor $a -RestoreMinimized).hwnd
    $main = @(Get-Windows 'SSE' | Where-Object { [int64]$_.hwnd -eq [int64]$hwnd })[0]
    $sourceBinding = Test-CaseBinding $main $sourcePath
    if (-not $sourceBinding.ok) {
      Fail "Fensterpfad stimmt nicht mit '$sourcePath' ueberein." 'precondition-failed'
    }
    $foreground = Show-SSEWindow $hwnd
    if (-not $foreground) {
      Hide-SSETopmost $hwnd
      Fail 'Hauptfenster liess sich nicht sicher in den Vordergrund holen; Strg+Alt+S wurde NICHT gesendet.' 'no-foreground'
    }
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait('^%s')
    Set-SSEForegroundLeaseInputCheckpoint (Get-SSELastInputTick)
    Start-Sleep -Milliseconds 1200
    Hide-SSETopmost $hwnd

    $dialogs = @(Get-Windows 'SSE' | Where-Object {
      [int64]$_.hwnd -ne [int64]$hwnd -and $_.title -ne 'Steuer-Spar-Tipps'
    } | Sort-Object { $_.w * $_.h } -Descending)
    $dialog = @($dialogs | Where-Object { $_.title -match 'Speichern|Save' })[0]
    if (-not $dialog) { $dialog = $dialogs[0] }
    if (-not $dialog) { Fail "Nach Strg+Alt+S wurde kein Speichern-unter-Dialog gefunden." 'dialog-not-found' }
    $dialogHwnd = [IntPtr][int64]$dialog.hwnd
    $dialogTree = Walk-Tree $dialogHwnd 1500 -WithValues
    $fileHosts = @($dialogTree.nodes | Where-Object { $_.aid -eq 'FileNameControlHost' -and $_.name -eq 'Dateiname:' })
    if ($fileHosts.Count -ne 1) {
      Emit ([pscustomobject]@{ ok = $false; kind = 'dialog-unmapped'; error = "$($fileHosts.Count) Dateiname-Hosts gefunden."; dialog = $dialog; nodes = $dialogTree.nodes })
    }
    $fileHost = $fileHosts[0]
    $fileFields = @($dialogTree.nodes | Where-Object {
      $_.type -eq 'Pane' -and $_.aid -eq '1001' -and $_.x -ge $fileHost.x -and $_.x -lt ($fileHost.x + $fileHost.w) -and
      $_.y -ge $fileHost.y -and $_.y -lt ($fileHost.y + $fileHost.h)
    })
    if ($fileFields.Count -ne 1) {
      Emit ([pscustomobject]@{ ok = $false; kind = 'dialog-unmapped'; error = "$($fileFields.Count) Dateiname-Felder im Host gefunden."; dialog = $dialog; nodes = $dialogTree.nodes })
    }
    $fileField = $fileFields[0]
    $null = Click-VerifiedPoint $dialogHwnd $fileField
    [System.Windows.Forms.SendKeys]::SendWait('^a')
    [System.Windows.Forms.SendKeys]::SendWait((ConvertTo-SendKeysLiteral $targetPath))
    Set-SSEForegroundLeaseInputCheckpoint (Get-SSELastInputTick)
    Start-Sleep -Milliseconds 350
    $dialogTree2 = Walk-Tree $dialogHwnd 1500 -WithValues
    $fileReadback = @($dialogTree2.nodes | Where-Object {
      $_.type -eq 'Pane' -and $_.aid -eq '1001' -and $_.x -ge $fileHost.x -and $_.x -lt ($fileHost.x + $fileHost.w) -and
      $_.y -ge $fileHost.y -and $_.y -lt ($fileHost.y + $fileHost.h)
    })
    if ($fileReadback.Count -ne 1 -or $fileReadback[0].name -ne $targetPath) {
      Emit ([pscustomobject]@{
        ok = $false; kind = 'postcondition-failed'; error = 'Zielpfad kam nicht exakt im Dateiname-Feld an.'
        expected = $targetPath; actual = $(if ($fileReadback.Count) { $fileReadback[0].name } else { $null })
      })
    }
    $saveButtons = @($dialogTree2.nodes | Where-Object { $_.type -eq 'Pane' -and $_.name -in @('Speichern','Save') -and $_.aid -eq '1' -and $_.on })
    if ($saveButtons.Count -ne 1) {
      Emit ([pscustomobject]@{ ok = $false; kind = 'dialog-unmapped'; error = "$($saveButtons.Count) aktive Speichern-Schaltflaechen gefunden."; dialog = $dialog; nodes = $dialogTree2.nodes })
    }
    $null = Click-VerifiedPoint $dialogHwnd $saveButtons[0]
    Start-Sleep -Milliseconds ([int](Arg $a 'waitMs' 2500))

    # Ein unerwarteter Dialog (einschliesslich eines durch ein Rennen neu
    # entstandenen Ueberschreibdialogs) wird niemals automatisch bestaetigt.
    $remaining = @(Get-Windows 'SSE' | Where-Object {
      [int64]$_.hwnd -ne [int64]$hwnd -and $_.title -ne 'Steuer-Spar-Tipps'
    })
    if ($remaining.Count) {
      Emit ([pscustomobject]@{
        ok = $false; kind = 'confirmation-required'; error = 'Nach Speichern unter ist noch ein Dialog offen; keine automatische Bestaetigung.'
        dialogs = $remaining; targetPath = $targetPath
      })
    }
    $targetHash = Get-Sha256 $targetPath
    $sourceHashAfter = Get-Sha256 $sourcePath
    $sourceSummary = Get-CaseSummary $sourcePath
    $targetSummary = Get-CaseSummary $targetPath
    $mainAfter = @(Get-Windows 'SSE' | Sort-Object { $_.w * $_.h } -Descending)[0]
    $targetBinding = Test-CaseBinding $mainAfter $targetPath
    $attachedPath = $targetBinding.titlePath
    $headerMatches = ($sourceSummary -and $targetSummary -and
      (($sourceSummary.header | ConvertTo-Json -Compress) -eq ($targetSummary.header | ConvertTo-Json -Compress)) -and
      $sourceSummary.transmitted -eq $targetSummary.transmitted)
    $verified = ($targetHash -and $sourceHashAfter -eq $sourceHash -and $targetBinding.ok -and $headerMatches)
    if (-not $verified) {
      Emit ([pscustomobject]@{
        ok = $false; kind = 'postcondition-failed'; error = 'Zieldatei oder neuer Fensterpfad konnte nicht verifiziert werden.'
        sourcePath = $sourcePath; sourceHashBefore = $sourceHash; sourceHashAfter = $sourceHashAfter
        targetPath = $targetPath; targetHash = $targetHash; attachedPath = $attachedPath; binding = $targetBinding
        headerMatches = $headerMatches
      })
    }
    Emit ([pscustomobject]@{
      ok = $true; savedAs = $true; sourcePath = $sourcePath; sourceHash = $sourceHash
      targetPath = $targetPath; targetHash = $targetHash; attachedPath = $attachedPath
      sourceBinding = $sourceBinding; targetBinding = $targetBinding; header = $targetSummary.header
      transmitted = $targetSummary.transmitted; verified = $true
    })
  }

  'close' {
    # Beendet das Programm und beantwortet dabei die Speichern-Rueckfrage.
    # save=false ist die Vorgabe: bei Untersuchungen soll nichts ungewollt
    # in die Steuerdatei geschrieben werden.
    $force  = ((Arg $a 'force') -eq $true)
    $save   = ((Arg $a 'save') -eq $true)
    $discard = ((Arg $a 'discardChanges') -eq $true)
    if ($save -and $discard) { Fail 'save und discardChanges duerfen nicht gleichzeitig true sein.' 'bad-args' }
    if ($force -and $save) { Fail 'force=true ist mit save=true unvereinbar; ein harter Abbruch kann Speichern nicht garantieren.' 'bad-args' }
    if ($save) { Fail 'sse_close speichert nicht mehr ueber einen ungebundenen Schliessdialog. Zuerst sse_save mit expectedPath/expectedHashBefore verwenden, danach sauber schliessen.' 'confirmation-required' }
    if ($force -and -not $discard) {
      Fail 'force=true verlangt discardChanges=true.' 'confirmation-required'
    }
    $requestedHwnd = Arg $a 'hwnd'
    $requestedPid = [int](Arg $a 'pid' 0)
    $allProcs = @(Get-SSEProcesses)
    if (-not $allProcs) {
      if ($requestedPid -or $requestedHwnd) {
        Fail "Die angegebene PID bzw. das hwnd gehoert zu keiner verifizierten Instanz von '$($script:SSE_PROFILE.product)'; nichts geschlossen." 'ownership'
      }
      Emit ([pscustomobject]@{ ok = $true; note = "$($script:SSE_PROFILE.product) lief nicht; nichts geschlossen." })
    }

    $allWins = @(Get-Windows 'SSE')
    if ($requestedHwnd) {
      $hwndPid = 0
      [SW]::GetWindowThreadProcessId([IntPtr][int64]$requestedHwnd, [ref]$hwndPid) | Out-Null
      $requestedWindow = @($allWins | Where-Object { [int64]$_.hwnd -eq [int64]$requestedHwnd -and [int]$_.pid -eq $hwndPid })
      if (-not $hwndPid -or $requestedWindow.Count -ne 1) {
        Fail 'Das angegebene hwnd ist kein aktuelles SSE-Fenster.' 'stale-window'
      }
      if ($requestedWindow[0].w -lt 900 -or $requestedWindow[0].h -lt 600 -or $requestedWindow[0].title -notmatch 'SteuerSparErklärung') {
        Fail 'Das angegebene hwnd ist kein verifiziertes SSE-Hauptfenster; nichts geschlossen.' 'ownership'
      }
      if ($requestedPid -and $requestedPid -ne $hwndPid) { Fail 'hwnd und pid gehoeren nicht zur selben SSE-Instanz.' 'ownership' }
      $targetPid = [int]$hwndPid
    } elseif ($requestedPid) {
      $targetPid = $requestedPid
    } else {
      $candidatePids = @($allWins | ForEach-Object { [int]$_.pid } | Select-Object -Unique)
      if ($candidatePids.Count -ne 1) {
        Fail "Ohne hwnd/pid ist sse_close nur bei genau einer sichtbaren SSE-Instanz zulaessig; gefunden: $($candidatePids.Count)." 'ambiguous'
      }
      $targetPid = [int]$candidatePids[0]
    }
    $targetProcess = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
    if (-not (Test-SSEProcess $targetProcess)) { Fail "PID $targetPid ist keine verifizierte Instanz von '$($script:SSE_PROFILE.product)'." 'ownership' }
    $wins = @($allWins | Where-Object { [int]$_.pid -eq $targetPid })
    if ($requestedPid -and $force -and $discard -and -not $wins.Count) {
      # Interner Fail-Closed-Cleanup fuer einen gestarteten Prozess, der noch
      # kein Fenster erzeugt hat. Nur die explizite, erneut als SSE-2025
      # verifizierte PID darf beendet werden.
      Stop-Process -InputObject $targetProcess -Force -ErrorAction SilentlyContinue
      try { $targetProcess.WaitForExit(5000) | Out-Null } catch { }
      $stillRunning = [bool](Get-Process -Id $targetPid -ErrorAction SilentlyContinue)
      Emit ([pscustomobject]@{
        ok=(-not $stillRunning); killed=(-not $stillRunning); stillRunning=$stillRunning
        discardChanges=$true; pid=$targetPid
        error=$(if ($stillRunning) { 'Fensterlos gestartete SSE-PID konnte nicht sicher beendet werden.' } else { $null })
        note='Exakt gebundene fensterlose Start-PID wurde ohne Speichern beendet.'
      })
    }
    if ($requestedHwnd) {
      $mainWindow = @($wins | Where-Object { [int64]$_.hwnd -eq [int64]$requestedHwnd })
    } else {
      $mainWindow = @($wins | Where-Object { $_.w -ge 900 -and $_.h -ge 600 -and $_.title -match 'SteuerSparErklärung' })
      if ($mainWindow.Count -ne 1) {
        Fail "PID $targetPid besitzt $($mainWindow.Count) breite SSE-Hauptfenster; exaktes hwnd ist Pflicht." 'ambiguous'
      }
    }
    $hung = [bool]($wins | Where-Object { $_.hung } | Select-Object -First 1)
    if ($hung -and -not $discard) {
      Fail 'SSE reagiert nicht. Ein harter Abbruch ist nur mit discardChanges=true erlaubt; save=true wird bei einem Haenger nicht vorgetaeuscht.' 'confirmation-required'
    }
    $antwort = $null

    if (-not $force -and -not $hung -and $wins.Count) {
      if (-not $mainWindow.Count) { Fail 'Eindeutiges SSE-Hauptfenster fehlt; nichts geschlossen.' 'ownership' }
      $openDialogs = @(Get-DialogInventory | Where-Object { [int]$_.pid -eq $targetPid -and $_.kind -in @('native-dialog','qt-dialog') })
      if ($openDialogs.Count) {
        Emit ([pscustomobject]@{
          ok = $false; kind = 'dialog-open'; error = 'Vor dem Schliessen ist bereits ein Dialog offen; zuerst mit sse_dialog_list/sse_dialog_answer bearbeiten.'
          dialogs = @($openDialogs | ForEach-Object { [pscustomobject]@{ hwnd=$_.hwnd; title=$_.title; kind=$_.kind; buttons=$_.buttons; texts=$_.texts; fingerprint=$_.fingerprint } })
        })
      }
      try {
        $mainHwnd = [IntPtr][int64]$mainWindow[0].hwnd
        $treeBeforeClose = Walk-Tree $mainHwnd 1200
        $saveButton = @($treeBeforeClose.nodes | Where-Object { $_.type -eq 'Button' -and $_.name -eq 'Sichern' })[0]
        $hasUnsavedChanges = [bool]($saveButton -and $saveButton.on)
      } catch { $hasUnsavedChanges = $null }
      if ($hasUnsavedChanges -eq $true -and -not $save -and -not $discard) {
        Emit ([pscustomobject]@{
          ok = $false; kind = 'confirmation-required'
          error = 'Ungespeicherte Aenderungen erkannt. Zuerst sse_save mit expectedPath/expectedHashBefore hashgebunden ausfuehren oder explizit discardChanges=true verwenden; NICHT geschlossen.'
          unsavedChanges = $true
        })
      }
      if ($null -eq $hasUnsavedChanges -and -not $save -and -not $discard) {
        Emit ([pscustomobject]@{
          ok = $false; kind = 'state-unknown'
          error = 'Der Aenderungszustand konnte nicht sicher gelesen werden. Zuerst sse_save mit expectedPath/expectedHashBefore hashgebunden ausfuehren oder explizit discardChanges=true verwenden; NICHT geschlossen.'
        })
      }
    }

    if (-not $force -and -not $hung -and $wins.Count) {
      $res = [IntPtr]::Zero
      [SW]::SendMessageTimeout([IntPtr][int64]$mainWindow[0].hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero, 0x0002, 8000, [ref]$res) | Out-Null
      Start-Sleep -Milliseconds 1500

      # Rueckfrage "Aenderungen speichern?" beantworten - bis zu drei Runden,
      # denn es koennen mehrere Dialoge nacheinander kommen.
      for ($runde = 1; $runde -le 3; $runde++) {
        $offen = @(Get-Windows 'SSE' | Where-Object { [int]$_.pid -eq $targetPid })
        if (-not $offen.Count) { break }
        $wunsch = $(if ($discard) { @('Nein','Nicht speichern','Verwerfen') } else { @() })
        if (-not $wunsch.Count) { break }
        $btn = $null
        $h = [IntPtr]::Zero
        # Neben dem echten Speicherdialog haelt SSE dauerhaft ein kleines
        # Vorschlagsfenster offen. Das erste kleine Fenster ist daher nicht
        # zwingend der Dialog. Alle Kandidaten pruefen und nur ein Fenster
        # mit einer passenden Antwortschaltflaeche bedienen.
        foreach ($candidate in ($offen | Where-Object { $_.w -lt 900 -and $_.w -gt 100 } | Sort-Object { $_.w * $_.h })) {
          $candidateHwnd = [IntPtr][int64]$candidate.hwnd
          $td = $null
          try { $td = Walk-Tree $candidateHwnd 400 10 } catch { continue }
          foreach ($w in $wunsch) {
            $btn = @($td.nodes | Where-Object { $_.name -eq $w -and $_.type -in @('Button','Pane') })[0]
            if ($btn) { $h = $candidateHwnd; break }
          }
          if ($btn) { break }
        }
        if (-not $btn) { break }
        $el = Get-LiveElement $h $btn.rid
        if ($el) {
          try { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); $antwort = $btn.name } catch { }
        }
        Start-Sleep -Milliseconds 1800
      }
      Start-Sleep -Seconds 2
    }

    $still = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
    $killed = $false
    if ($still -and ($force -or $hung) -and $discard) {
      Stop-Process -InputObject $targetProcess -Force -ErrorAction SilentlyContinue
      try { $targetProcess.WaitForExit(5000) | Out-Null } catch { }
      $killed = $true
    }
    $laeuftNoch = [bool](Get-Process -Id $targetPid -ErrorAction SilentlyContinue)
    Emit ([pscustomobject]@{
      ok = (-not $laeuftNoch); wasHung = $hung; killed = $killed; stillRunning = $laeuftNoch
      error = $(if ($laeuftNoch) { 'Programm laeuft nach dem Schliessversuch noch; Dialogzustand mit sse_ui_state pruefen.' } else { $null })
      speichernAntwort = $antwort; sollteSpeichern = $save
      discardChanges = $discard; pid = $targetPid
      note = $(if ($laeuftNoch) { 'Laeuft noch - vermutlich steht ein Dialog offen. sse_ui_state ansehen.' }
               elseif ($antwort) { "Rueckfrage mit '$antwort' beantwortet." }
               else { 'Ohne Rueckfrage beendet (keine ungespeicherten Aenderungen).' })
    })
  }

  'list_cases' {
    $dir = $(if ($a.dir) { [string]$a.dir } else { [string]$env:SSE_CASE_DIR })
    if (-not $dir) { Fail 'dir ist Pflicht (alternativ Umgebungsvariable SSE_CASE_DIR setzen).' 'bad-args' }
    if (-not (Test-Path -LiteralPath $dir)) { Fail "Ordner nicht gefunden: $dir" 'not-found' }
    $incBackup = ($a.includeBackups -eq $true)
    $files = @(Get-ChildItem -LiteralPath $dir -File | Where-Object {
      Test-SSEProfileCaseFileName $_.Name $incBackup
    })
    if (-not $files.Count) { Emit ([pscustomobject]@{ ok = $true; dir = $dir; count = 0; cases = @() }) }

    # Der lokale In-Process-Parser kennt die typabhaengige Wertkodierung
    # (Typ 5 = 4 Byte Datum, Typ 6 = 1 Byte) und braucht keine Laufzeit.
    $parsed = @{}
    $parserFehler = $null
    try {
      foreach ($p in @(Invoke-AkadParser -Paths @($files | ForEach-Object { $_.FullName }))) { $parsed[$p.file] = $p }
    } catch { $parserFehler = $_.Exception.Message.Split("`n")[0] }
    $out = New-Object System.Collections.ArrayList
    foreach ($f in $files) {
      $p = $parsed[$f.FullName]
      $ett = $(if ($p) { [string]$p.elsterTransferTime } else { '' })
      $null = $out.Add([pscustomobject]@{
        name = $f.Name; path = $f.FullName; kb = [math]::Round($f.Length / 1KB, 1)
        modified = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
        module = (($f.Name -replace '.*\.', '') -replace '_Backup$', '')
        fileType = $(if ($p -and $p.meta.FileType) { $p.meta.FileType.value } else { '' })
        year = $(if ($p -and $p.meta.VJahr) { $p.meta.VJahr.value } else { '' })
        steuernummer = $(if ($p -and $p.meta.Steuernummer) { $p.meta.Steuernummer.value } else { '' })
        savedBy = $(if ($p -and $p.meta.FileSavedBy) { $p.meta.FileSavedBy.value } else { '' })
        elsterTransferTime = $ett
        # DREISTUFIG: true / false / 'unknown'. Ohne gelesenen Kopf gibt es
        # KEINE Aussage - 'false' waere hier eine gefaehrliche Behauptung.
        transmitted = $(
          if (-not $p)                     { 'unknown' }
          elseif ($p.PSObject.Properties['error'] -and $p.error) { 'unknown' }
          else                             { $p.transmitted }
        )
        transmittedReason = $(
          if (-not $p)                     { 'Datei wurde nicht geparst - keine Aussage moeglich' }
          elseif ($p.PSObject.Properties['error'] -and $p.error) { "Parserfehler: $($p.error)" }
          else                             { $p.transmittedReason }
        )
        encryptedBytes = $(if ($p -and $p.meta.svCrypted) { $p.meta.svCrypted.encryptedBytes } else { 0 })
        # meta ist umfangreich (u.a. die komplette Uebernahmehistorie) und
        # wird nur auf Wunsch mitgeliefert - spart Kontext beim Aufrufer.
        meta = $(if ($a.verbose -eq $true -and $p) { $p.meta } else { $null })
      })
    }
    Emit ([pscustomobject]@{
      ok = $true; dir = $dir; count = $out.Count; cases = @($out)
      parserError = $parserFehler
    })
  }

  'make_working_copy' {
    $sourceRaw = [string](Arg $a 'source')
    $targetRaw = [string](Arg $a 'target')
    $expectedHash = ([string](Arg $a 'expectedSourceHash')).ToUpperInvariant()
    if (-not $sourceRaw -or -not $targetRaw -or -not $expectedHash) {
      Fail 'source, target und expectedSourceHash sind Pflicht.' 'bad-args'
    }
    $source = [IO.Path]::GetFullPath($sourceRaw)
    $target = [IO.Path]::GetFullPath($targetRaw)
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { Fail "Quelldatei fehlt: $source" 'not-found' }
    if (Test-Path -LiteralPath $target) { Fail "Ziel existiert bereits: $target" 'exists' }
    if (-not (Test-SSEProfileCaseFileName $source $true) -or -not (Test-SSEProfileCaseFileName $target $true)) {
      Fail "Quelle und Ziel muessen Falldateien des Profils '$($script:SSE_PROFILE_ID)' sein." 'unsupported-case'
    }
    if ([IO.Path]::GetExtension($source) -ne [IO.Path]::GetExtension($target)) {
      Fail 'Quelle und Ziel muessen dieselbe Steuerfall-Endung haben.' 'bad-args'
    }
    $targetDir = Split-Path -Parent $target
    if (-not (Test-Path -LiteralPath $targetDir -PathType Container)) { Fail "Zielordner fehlt: $targetDir" 'not-found' }
    $sourceBefore = Get-Sha256 $source
    if ($sourceBefore -ne $expectedHash) { Fail 'Quell-Hash stimmt nicht; NICHT kopiert.' 'precondition-failed' }
    Copy-SSEFileNew $source $target
    # Nur fuer den Dateisystem-Regressionslauf: simuliert einen fremden
    # Austausch zwischen Kopie und Readback. Das darf keinen blinden Delete
    # des nun unbekannten Ziels ausloesen.
    if ($env:SSE_MCP_TEST_FAULT -eq 'working-copy-after-copy') {
      [IO.File]::WriteAllText($target, 'simulierte fremde Datei', (New-Object Text.UTF8Encoding($false)))
    }
    $sourceAfter = Get-Sha256 $source
    $targetHash = Get-Sha256 $target
    $verified = ($sourceAfter -eq $sourceBefore -and $targetHash -eq $sourceBefore)
    if (-not $verified) {
      $targetStillOwned = [bool]($targetHash -and $targetHash -eq $sourceBefore)
      if ($targetStillOwned -and (Test-Path -LiteralPath $target -PathType Leaf)) {
        Remove-Item -LiteralPath $target -Force
      }
      $rolledBack = -not (Test-Path -LiteralPath $target)
      Emit ([pscustomobject]@{
        ok = $false; kind = 'postcondition-failed'
        error = $(if ($rolledBack) { 'Arbeitskopie wich von der Quelle ab; eigenes Ziel wurde entfernt.' } else { 'Arbeitskopie wurde nach dem Erstellen veraendert; unbekanntes Ziel blieb zur manuellen Klaerung erhalten.' })
        source = $source; target = $target; sourceBefore = $sourceBefore; sourceAfter = $sourceAfter; targetHash = $targetHash
        targetStillOwned = $targetStillOwned; rolledBack = $rolledBack
      })
    }
    $summary = Get-CaseSummary $target
    Emit ([pscustomobject]@{
      ok = $true; copied = $true; source = $source; target = $target
      sourceHash = $sourceBefore; targetHash = $targetHash; verified = $true
      header = $(if ($summary) { $summary.header } else { $null })
      transmitted = $(if ($summary) { $summary.transmitted } else { $null })
    })
  }

  'archive_cases' {
    $dirRaw = [string](Arg $a 'dir')
    $destRaw = [string](Arg $a 'dest')
    $archiveRaw = Arg $a 'cases'
    $remainingRaw = Arg $a 'expectedRemaining'
    if (-not $dirRaw -or -not $destRaw -or $null -eq $archiveRaw -or $null -eq $remainingRaw) {
      Fail 'dir, dest, cases und expectedRemaining sind Pflicht.' 'bad-args'
    }
    $archiveEntries = @($archiveRaw)
    $remainingEntries = @($remainingRaw)
    if (-not $archiveEntries.Count -or -not $remainingEntries.Count) {
      Fail 'cases und expectedRemaining duerfen nicht leer sein.' 'bad-args'
    }
    $dir = Get-NormalizedDirectoryPath $dirRaw
    $dest = Get-NormalizedDirectoryPath $destRaw
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { Fail "Fallordner fehlt: $dir" 'not-found' }
    if ($dest.Equals($dir, [StringComparison]::OrdinalIgnoreCase) -or
        $dest.StartsWith($dir + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      Fail 'Archivziel muss ausserhalb des aktiven Fallordners liegen.' 'bad-args'
    }
    if (Test-Path -LiteralPath $dest) { Fail "Archivziel existiert bereits: $dest" 'precondition-failed' }
    if (@(Get-Process -Name 'SSE' -ErrorAction SilentlyContinue).Count) {
      Fail 'SteuerSparErklaerung laeuft. Vor der Fallarchivierung alle SSE-Fenster kontrolliert schliessen.' 'precondition-failed'
    }

    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $expected = New-Object System.Collections.ArrayList
    foreach ($entry in @($archiveEntries) + @($remainingEntries)) {
      $name = [string]$entry.name
      $hash = ([string]$entry.expectedSha256).ToUpperInvariant()
      if (-not $name -or [IO.Path]::GetFileName($name) -ne $name -or -not (Test-SSEProfileCaseFileName $name $true)) {
        Fail "Ungueltiger Fallname '$name'. Nur ein einfacher Falldateiname ist erlaubt." 'bad-args'
      }
      if ($hash -notmatch '^[0-9A-F]{64}$') { Fail "Ungueltiger SHA256 fuer '$name'." 'bad-args' }
      if (-not $seen.Add($name)) { Fail "Fall '$name' ist mehrfach in der Bestandsvorgabe enthalten." 'bad-args' }
      $null = $expected.Add([pscustomobject]@{ name=$name; expectedSha256=$hash })
    }

    $actualFiles = @(Get-ChildItem -LiteralPath $dir -File | Where-Object { Test-SSEProfileCaseFileName $_.Name $true })
    $actualMap = @{}
    foreach ($file in $actualFiles) { $actualMap[$file.Name] = $file }
    $actualNames = @($actualFiles | ForEach-Object { $_.Name.ToLowerInvariant() } | Sort-Object)
    $expectedNames = @($expected | ForEach-Object { $_.name.ToLowerInvariant() } | Sort-Object)
    $nameDiff = @(Compare-Object -ReferenceObject $expectedNames -DifferenceObject $actualNames)
    if ($nameDiff.Count) {
      Emit ([pscustomobject]@{
        ok=$false; kind='inventory-mismatch'; error='Aktiver Fallbestand stimmt nicht exakt mit cases + expectedRemaining ueberein; NICHTS verschoben.'
        expected=$expectedNames; actual=$actualNames; differences=$nameDiff
      })
    }

    foreach ($entry in $expected) {
      $path = $actualMap[$entry.name].FullName
      $actualHash = Get-Sha256 $path
      if ($actualHash -ne $entry.expectedSha256) {
        Fail "Hash fuer '$($entry.name)' stimmt nicht; NICHTS verschoben." 'precondition-failed'
      }
    }
    foreach ($entry in $archiveEntries) {
      $path = $actualMap[[string]$entry.name].FullName
      $summary = Get-CaseSummary $path
      if (-not $summary) {
        Fail "Kopf von '$($entry.name)' ist nicht sicher lesbar; NICHT archiviert. $script:CASE_SUMMARY_ERROR" 'precondition-failed'
      }
      if ($summary.transmitted -isnot [bool] -or $summary.transmitted -ne $false) {
        Fail "GESPERRT: '$($entry.name)' ist uebermittelt oder der Status ist nicht sicher false." 'blocked'
      }
    }

    $created = $false
    $moved = New-Object System.Collections.ArrayList
    $manifestPath = Join-Path $dest 'pruefsummen.csv'
    try {
      # New-Item meldet ein zwischen Preflight und Erstellung auftauchendes
      # Ziel als Fehler; CreateDirectory wuerde ein fremdes Verzeichnis
      # dagegen still als Erfolg behandeln.
      New-Item -ItemType Directory -Path ([WildcardPattern]::Escape($dest)) -ErrorAction Stop | Out-Null
      $created = $true
      foreach ($entry in $archiveEntries) {
        $source = $actualMap[[string]$entry.name].FullName
        $actualName = $actualMap[[string]$entry.name].Name
        $target = Join-Path $dest $actualName
        Move-Item -LiteralPath $source -Destination $target -ErrorAction Stop
        $null = $moved.Add([pscustomobject]@{ name=$actualName; source=$source; target=$target; sha256=([string]$entry.expectedSha256).ToUpperInvariant() })
        if ((Get-Sha256 $target) -ne ([string]$entry.expectedSha256).ToUpperInvariant()) {
          throw "Archivhash stimmt fuer '$($entry.name)' nicht."
        }
        # Nur fuer den isolierten Dateisystem-Regressionslauf. Der Schalter ist
        # nicht Teil des MCP-Schemas; ein versehentlich gesetzter Wert erzwingt
        # lediglich den sicheren Rollback statt eine zusaetzliche Mutation.
        if ($env:SSE_MCP_TEST_FAULT -eq 'archive-after-first-move' -and $moved.Count -eq 1) {
          throw 'Absichtlicher Testfehler nach der ersten Archivbewegung.'
        }
      }
      foreach ($entry in $remainingEntries) {
        if ((Get-Sha256 (Join-Path $dir ([string]$entry.name))) -ne ([string]$entry.expectedSha256).ToUpperInvariant()) {
          throw "Resthash stimmt fuer '$($entry.name)' nicht."
        }
      }
      $remainingActual = @(Get-ChildItem -LiteralPath $dir -File | Where-Object { Test-SSEProfileCaseFileName $_.Name $true } |
        ForEach-Object { $_.Name.ToLowerInvariant() } | Sort-Object)
      $remainingExpected = @($remainingEntries | ForEach-Object { ([string]$_.name).ToLowerInvariant() } | Sort-Object)
      if (@(Compare-Object -ReferenceObject $remainingExpected -DifferenceObject $remainingActual).Count) {
        throw 'Restbestand stimmt nach der Archivierung nicht mit expectedRemaining ueberein.'
      }
      @($moved | ForEach-Object { [pscustomobject]@{ file=$_.name; sha256=$_.sha256 } }) |
        Export-Csv -LiteralPath $manifestPath -NoTypeInformation -Encoding UTF8
    } catch {
      $problem = $_.Exception.Message
      $rollbackEntries = @($moved)
      [array]::Reverse($rollbackEntries)
      $rollbackFiles = New-Object System.Collections.ArrayList
      foreach ($entry in $rollbackEntries) {
        $restoreError = $null
        try {
          if ((Test-Path -LiteralPath $entry.target -PathType Leaf) -and -not (Test-Path -LiteralPath $entry.source)) {
            Move-Item -LiteralPath $entry.target -Destination $entry.source -ErrorAction Stop
          }
        } catch { $restoreError = $_.Exception.Message }
        $sourceHash = Get-Sha256 $entry.source
        $targetExists = Test-Path -LiteralPath $entry.target -PathType Leaf
        $restored = [bool]($sourceHash -eq $entry.sha256 -and -not $targetExists)
        $null = $rollbackFiles.Add([pscustomobject]@{
          name=$entry.name; restored=$restored; sourceHash=$sourceHash
          targetExists=$targetExists; error=$restoreError
        })
      }
      $allRestored = [bool]($rollbackFiles.Count -eq $moved.Count -and -not @($rollbackFiles | Where-Object { -not $_.restored }).Count)
      if ($allRestored -and $created -and (Test-Path -LiteralPath $dest -PathType Container)) {
        if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
          Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
        }
        # Niemals rekursiv loeschen: taucht im neuen Archivordner ein fremdes
        # Objekt auf, bleibt der Ordner als sichtbarer Konflikt erhalten.
        if (-not @(Get-ChildItem -LiteralPath $dest -Force).Count) {
          Remove-Item -LiteralPath $dest -Force -ErrorAction SilentlyContinue
        }
      }
      Emit ([pscustomobject]@{
        ok=$false; kind='postcondition-failed'; error=$problem
        movedBeforeFailure=$moved.Count
        rolledBack=$allRestored; rollbackFiles=@($rollbackFiles)
        archiveStillExists=[bool](Test-Path -LiteralPath $dest -PathType Container)
      })
    }
    Emit ([pscustomobject]@{
      ok=$true; archived=$moved.Count; dest=$dest
      files=@($moved | ForEach-Object { [pscustomobject]@{ name=$_.name; sha256=$_.sha256 } })
      remaining=@($remainingEntries | ForEach-Object { [pscustomobject]@{ name=[string]$_.name; sha256=([string]$_.expectedSha256).ToUpperInvariant() } })
      manifest=(Join-Path $dest 'pruefsummen.csv'); verified=$true; recoverable=$true
    })
  }

  'backup_cases' {
    $dirRaw = $(if ($a.dir) { [string]$a.dir } else { [string]$env:SSE_CASE_DIR })
    if (-not $dirRaw) { Fail 'dir ist Pflicht (alternativ Umgebungsvariable SSE_CASE_DIR setzen).' 'bad-args' }
    $dir = Get-NormalizedDirectoryPath $dirRaw
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { Fail "Fallordner fehlt: $dir" 'not-found' }
    $stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
    $destRaw = $(if ($a.dest) { [string]$a.dest } else { (Join-Path (Split-Path $dir -Parent) "_backup_$stamp") })
    $dest = Get-NormalizedDirectoryPath $destRaw
    if ($dest.Equals($dir, [StringComparison]::OrdinalIgnoreCase) -or
        $dest.StartsWith($dir + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      Fail 'Sicherungsziel darf nicht im Fallordner liegen; sonst kopiert sich die Sicherung rekursiv selbst.' 'bad-args'
    }
    if (Test-Path -LiteralPath $dest) { Fail "Sicherungsziel existiert bereits: $dest" 'precondition-failed' }

    $files = @(Get-ChildItem -LiteralPath $dir -File | Where-Object {
      Test-SSEProfileCaseFileName $_.Name $true
    })
    if (-not $files.Count) { Fail "Keine Falldateien in $dir gefunden." 'not-found' }
    $created = $false
    $copied = New-Object System.Collections.ArrayList
    $manifestPath = Join-Path $dest 'pruefsummen.csv'
    try {
      New-Item -ItemType Directory -Path ([WildcardPattern]::Escape($dest)) -ErrorAction Stop | Out-Null
      $created = $true
      foreach ($file in $files) {
        $target = Join-Path $dest $file.Name
        $sourceHashBefore = Get-Sha256 $file.FullName
        Copy-SSEFileNew $file.FullName $target
        $sourceHashAfter = Get-Sha256 $file.FullName
        $targetHash = Get-Sha256 $target
        if (-not $sourceHashBefore -or $sourceHashAfter -ne $sourceHashBefore -or $targetHash -ne $sourceHashBefore) {
          throw "Sicherungskopie fuer '$($file.Name)' ist nicht bytegleich."
        }
        $null = $copied.Add([pscustomobject]@{ path=$target; sha256=$targetHash })
      }
      $hashes = @($copied | ForEach-Object {
        [pscustomobject]@{ file = [IO.Path]::GetFileName($_.path); sha256 = $_.sha256 }
      })
      $hashes | Export-Csv -LiteralPath $manifestPath -NoTypeInformation -Encoding UTF8
    } catch {
      $problem = $_
      foreach ($entry in @($copied)) {
        if ((Get-Sha256 $entry.path) -eq $entry.sha256) {
          Remove-Item -LiteralPath $entry.path -Force -ErrorAction SilentlyContinue
        }
      }
      if ($created -and (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
      }
      if ($created -and (Test-Path -LiteralPath $dest -PathType Container) -and
          -not @(Get-ChildItem -LiteralPath $dest -Force).Count) {
        Remove-Item -LiteralPath $dest -Force -ErrorAction SilentlyContinue
      }
      throw $problem
    }
    Emit ([pscustomobject]@{ ok = $true; dest = $dest; files = $hashes.Count; hashes = $hashes })
  }

  'checker_results' {
    $hwnd = Resolve-Window $a
    $read = Read-CheckerComplete $hwnd
    $t = $read.tree
    $result = $read.result
    Emit ([pscustomobject]@{
      ok = $true
      aktiv = $result.aktiv
      fragenWarnungenAngekuendigt = $result.fragenWarnungenAngekuendigt
      tippsAngekuendigt = $result.tippsAngekuendigt
      fragenWarnungenGruppeGesehen = $result.fragenWarnungenGruppeGesehen
      tippsGruppeGesehen = $result.tippsGruppeGesehen
      fragenWarnungen = $result.fragenWarnungen
      tippsZusatzinfos = $result.tippsZusatzinfos
      sonstige = $result.sonstige
      gesamt = $result.gesamt
      aufgeklappt = $result.aufgeklappt
      konsistent = [bool]$read.vollstaendig
      navigationSchritte = $read.navigationSchritte
      fokusVerwendet = $read.fokusVerwendet
      technischeFokusKarten = $read.technischeFokusKarten
      zyklen = $read.zyklen
      ungespeichert = Get-DirtyState $t
      hinweis = $(if ($result.aktiv) {
        'Fragen/Warnungen und Tipps sind getrennt. Ein Eintrag ist nicht automatisch ein Steuerfehler; mit sse_checker_open den Wortlaut oeffnen.'
      } else {
        "Der globale Steuerpruefer ist nicht offen. Zu 'Pruefen und Abgeben' und dann 'Steuererklaerung pruefen' navigieren; dort sse_checker_run aufrufen."
      })
    })
  }

  'checker_run' {
    # Startet ausschliesslich den globalen Pruefer auf der dafuer vorgesehenen
    # Seite. 'Steuererklaerung abschliessen' und alle Abgabewege bleiben tabu.
    $hwnd = Resolve-Window $a
    $before = Walk-Tree $hwnd 5000 60 20 -WithValues
    $dirtyBefore = Get-DirtyState $before
    $existing = Get-CheckerResults $before $hwnd
    if ($existing.aktiv) {
      $complete = Read-CheckerComplete $hwnd
      $existing = $complete.result
      Emit ([pscustomobject]@{
        ok = $true; gestartet = $false; bereitsAktiv = $true
        fragenWarnungenAngekuendigt = $existing.fragenWarnungenAngekuendigt
        tippsAngekuendigt = $existing.tippsAngekuendigt
        fragenWarnungen = $existing.fragenWarnungen
        tippsZusatzinfos = $existing.tippsZusatzinfos
        sonstige = $existing.sonstige
        gesamt = $existing.gesamt
        konsistent = [bool]$complete.vollstaendig
        navigationSchritte = $complete.navigationSchritte
        fokusVerwendet = $complete.fokusVerwendet
        technischeFokusKarten = $complete.technischeFokusKarten
        ungespeichertVorher = $dirtyBefore
        ungespeichertNachher = $dirtyBefore
        ungespeichertEingefuehrt = $false
        hinweis = 'Der globale Steuerpruefer war bereits aktiv und wurde nicht erneut umgeschaltet.'
      })
    }
    $button = @($before.nodes | Where-Object {
      $_.type -eq 'Button' -and $_.name -eq 'Steuerprüfer starten' -and
      $_.aid -like '*.Abgabe.Pruefen.GrosserButton' -and $_.on
    } | Select-Object -First 1)
    if (-not $button.Count) {
      Fail ("Der aktive Seitenknopf 'Steuerprüfer starten' wurde nicht gefunden. " +
            "Per MCP zuerst den Navigationsknoten 'Prüfen und Abgeben', dann 'Steuererklärung prüfen' oeffnen.") 'precondition-failed'
    }
    $el = Get-LiveElement $hwnd $button[0].rid
    if (-not $el) { Fail 'Der Startknopf ist nicht mehr greifbar; Seite neu lesen und nicht blind wiederholen.' 'stale' }
    try { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
    catch { Fail "Steuerpruefer konnte nicht gestartet werden: $($_.Exception.Message.Split("`n")[0])" 'pattern-failed' }

    $after = $null
    $result = $null
    $deadline = [DateTime]::UtcNow.AddSeconds(25)
    do {
      Start-Sleep -Milliseconds 700
      $after = Walk-Tree $hwnd 5000 60 20 -WithValues
      $result = Get-CheckerResults $after $hwnd
    } until ($result.aktiv -or [DateTime]::UtcNow -ge $deadline)
    if (-not $result.aktiv) { Fail 'Steuerpruefer lieferte innerhalb von 25 Sekunden keinen Ergebnisbaum.' 'timeout' }

    $complete = Read-CheckerComplete $hwnd
    $after = $complete.tree
    $result = $complete.result
    $dirtyAfter = Get-DirtyState $after
    Emit ([pscustomobject]@{
      ok = $true; gestartet = $true
      fragenWarnungenAngekuendigt = $result.fragenWarnungenAngekuendigt
      tippsAngekuendigt = $result.tippsAngekuendigt
      fragenWarnungen = $result.fragenWarnungen
      tippsZusatzinfos = $result.tippsZusatzinfos
      sonstige = $result.sonstige
      gesamt = $result.gesamt
      konsistent = [bool]$complete.vollstaendig
      navigationSchritte = $complete.navigationSchritte
      fokusVerwendet = $complete.fokusVerwendet
      technischeFokusKarten = $complete.technischeFokusKarten
      ungespeichertVorher = $dirtyBefore
      ungespeichertNachher = $dirtyAfter
      ungespeichertEingefuehrt = [bool]((-not $dirtyBefore) -and $dirtyAfter)
      hinweis = 'Dies ist nur die Softwarepruefung. Kein Abschluss und keine Uebermittlung wurden ausgeloest.'
    })
  }

  'checker_reset' {
    # Alle aufgeklappten Detailkarten von unten nach oben schliessen. Diese
    # Reihenfolge ist entscheidend: Beim Schliessen einer unteren Karte
    # bleiben die Koordinaten aller oberen Karten stabil. Danach setzt
    # reine Pfeilnavigation die Auswahl bis ans Baumende, damit Qts zyklischer
    # GetNextSibling nicht vor den folgenden Meldungen abbricht.
    $hwnd = Resolve-Window $a
    $closed = New-Object System.Collections.ArrayList
    $knownTechnical = New-Object 'System.Collections.Generic.HashSet[string]'
    $complete = Read-CheckerComplete $hwnd
    if (-not $complete.result.aktiv) { Fail 'Der globale Steuerpruefer ist nicht offen.' 'precondition-failed' }

    # Eine geoeffnete Karte kann weitere, tiefer liegende Karten vor UIA
    # verbergen. Deshalb iterativ vollstaendig lesen, alle NICHT in diesem Lauf
    # technisch erzeugten Karten schliessen und erneut lesen. So verschwindet
    # auch eine zuvor verdeckte zweite Karte; eine fuer den Qt-Zyklus neu
    # benoetigte Fokuskarte bleibt dagegen bewusst stehen.
    for ($resetPass = 0; $resetPass -lt 8; $resetPass++) {
      foreach ($technicalName in @($complete.technischeFokusKarten)) {
        if ($technicalName) { $null = $knownTechnical.Add([string]$technicalName) }
      }
      $t = $complete.tree
      $result = $complete.result
      $toClose = @($result.aufgeklappt | Where-Object { -not $knownTechnical.Contains([string]$_) })
      if (-not $toClose.Count) { break }

      $raw = @($t.nodes | Where-Object {
        $_.type -eq 'TreeItem' -and $_.name -and $_.aid -like '*PrueferWidgetSSE.SteuerPruefer*'
      })
      $left = ($raw | Measure-Object x -Minimum).Minimum
      $details = @($raw | Where-Object {
        $_.x -gt ($left + 6) -and $_.h -ge 70 -and $_.name -in $toClose
      } | Sort-Object y -Descending)
      if (-not $details.Count) { break }
      foreach ($detail in $details) {
        $outer = @($raw | Where-Object {
          $_.x -le ($left + 6) -and $_.name -eq $detail.name -and $_.y -lt $detail.y
        } | Sort-Object y -Descending | Select-Object -First 1)
        if (-not $outer.Count) { continue }
        $target = [pscustomobject]@{ x = $outer[0].x; y = $outer[0].y; w = [Math]::Min(100, $outer[0].w); h = $outer[0].h }
        $null = Click-VerifiedPoint $hwnd $target
        if (-not (@($closed) -contains $detail.name)) { $null = $closed.Add($detail.name) }
        Start-Sleep -Milliseconds 250
      }
      $complete = Read-CheckerComplete $hwnd
    }

    $after = $complete.tree
    $afterResult = $complete.result
    foreach ($technicalName in @($complete.technischeFokusKarten)) {
      if ($technicalName) { $null = $knownTechnical.Add([string]$technicalName) }
    }
    $technicalCards = @($afterResult.aufgeklappt | Where-Object { $knownTechnical.Contains([string]$_) })
    $unresolvedCards = @($afterResult.aufgeklappt | Where-Object { -not $knownTechnical.Contains([string]$_) })
    $consistent = [bool]($complete.vollstaendig -and -not $unresolvedCards.Count)
    Emit ([pscustomobject]@{
      ok = $true; geschlossen = @($closed); anzahlGeschlossen = $closed.Count
      konsistent = $consistent
      fragenWarnungenAngekuendigt = $afterResult.fragenWarnungenAngekuendigt
      tippsAngekuendigt = $afterResult.tippsAngekuendigt
      fragenWarnungen = $afterResult.fragenWarnungen
      tippsZusatzinfos = $afterResult.tippsZusatzinfos
      sonstige = $afterResult.sonstige
      aufgeklappt = $afterResult.aufgeklappt
      navigationSchritte = $complete.navigationSchritte
      fokusVerwendet = $complete.fokusVerwendet
      technischeFokusKarten = $technicalCards
      nichtGeschlossen = $unresolvedCards
      ohneOffeneKarten = [bool](@($afterResult.aufgeklappt).Count -eq 0)
      ungespeichert = Get-DirtyState $after
      hinweis = $(if ($consistent -and -not @($afterResult.aufgeklappt).Count) { 'Prueferbaum ist wieder vollstaendig und ohne offene Detailkarten.' }
                  elseif ($consistent) { 'Vorherige Detailkarten wurden geschlossen. Qt braucht fuer die vollstaendige Liste die gemeldete technische Fokuskarte; sie aendert keine Steuerdaten.' }
                  else { 'Prueferbaum blieb inkonsistent; nicht blind weiterklicken, Ansicht neu starten.' })
    })
  }

  'checker_close' {
    # Schliesst ausschliesslich die Ergebnisleiste des globalen Pruefers. Der
    # Seiteninhalt und die Steuerdaten muessen dabei invariant bleiben.
    $main = Resolve-SSEMainWindowDescriptor $a -RestoreMinimized
    $hwnd = [IntPtr][int64]$main.hwnd
    $before = Walk-Tree $hwnd 5000 45 20 -WithValues
    $beforeResult = Get-CheckerResults $before $hwnd
    if (-not $beforeResult.aktiv) {
      Emit ([pscustomobject]@{
        ok=$true; closed=$false; alreadyClosed=$true
        heading=Get-CurrentHeading $hwnd $before; ungespeichert=Get-DirtyStateFast $hwnd
        note='Die Ergebnisleiste des globalen Steuerpruefers war bereits geschlossen.'
      })
    }
    $buttons = @($before.nodes | Where-Object {
      $_.type -eq 'Button' -and $_.on -and
      $_.aid -like '*.PrueferWidgetSSE.FrameTitle.QPushButton'
    })
    if ($buttons.Count -ne 1) {
      Fail "$($buttons.Count) eindeutige Schliessen-Schaltflaechen der Prueferleiste gefunden; nichts ausgeloest." 'ambiguous'
    }
    $button = $buttons[0]
    $headingBefore = Get-CurrentHeading $hwnd $before
    $dirtyBefore = Get-DirtyStateFast $hwnd
    $live = Get-LiveElement $hwnd $button.rid $button.aid
    $invoke = $null
    if (-not $live -or -not $live.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
      Fail 'Schliessen-Schaltflaeche der Prueferleiste ist nicht mehr eindeutig greifbar.' 'stale'
    }
    try { $invoke.Invoke() }
    catch { Fail "Prueferleiste konnte nicht geschlossen werden: $($_.Exception.Message.Split("`n")[0])" 'pattern-failed' }
    Start-Sleep -Milliseconds ([Math]::Min(3000,[Math]::Max(300,[int](Arg $a 'waitMs' 900))))
    $after = Walk-Tree $hwnd 5000 45 20 -WithValues
    $afterResult = Get-CheckerResults $after $hwnd
    $headingAfter = Get-CurrentHeading $hwnd $after
    $dirtyAfter = Get-DirtyStateFast $hwnd
    $buttonAfter = @($after.nodes | Where-Object {
      $_.type -eq 'Button' -and $_.aid -like '*.PrueferWidgetSSE.FrameTitle.QPushButton'
    })
    $verified = [bool](-not $afterResult.aktiv -and -not $buttonAfter.Count -and
      $headingAfter -eq $headingBefore -and $dirtyAfter -eq $dirtyBefore)
    if (-not $verified) {
      Emit ([pscustomobject]@{
        ok=$false; kind='postcondition-failed'; error='Prueferleiste erreichte nicht den erwarteten geschlossenen, steuerneutralen Zustand; kein zweiter Klick.'
        closed=[bool](-not $afterResult.aktiv); headingBefore=$headingBefore; headingAfter=$headingAfter
        dirtyBefore=$dirtyBefore; dirtyAfter=$dirtyAfter; closeButtonRemaining=$buttonAfter.Count
      })
    }
    Emit ([pscustomobject]@{
      ok=$true; closed=$true; alreadyClosed=$false; verified=$true
      headingBefore=$headingBefore; headingAfter=$headingAfter
      dirtyBefore=$dirtyBefore; dirtyAfter=$dirtyAfter
      note='Nur die Ergebnisleiste des globalen Steuerpruefers wurde geschlossen; Seite und Dirty-State blieben invariant.'
    })
  }

  'checker_detail' {
    # Liest die aufgeklappte Detailkarte. Zuerst werden die strukturierten
    # Accessibility-Wege geprueft; nur wenn Qt dort keinen Fliesstext anbietet,
    # wird exakt die Kartenflaeche per lokaler Windows-OCR gelesen.
    $hwnd = Resolve-Window $a
    $wanted = [string](Arg $a 'name')
    if (-not $wanted) { Fail 'name ist Pflicht (exakter Meldungstext aus sse_checker_results).' 'bad-args' }
    $t = Walk-Tree $hwnd 5000 60 20 -WithValues
    $result = Get-CheckerResults $t $hwnd
    if (-not $result.aktiv) { Fail 'Der globale Steuerpruefer ist nicht offen.' 'precondition-failed' }
    $raw = @($t.nodes | Where-Object {
      $_.type -eq 'TreeItem' -and $_.name -and $_.aid -like '*PrueferWidgetSSE.SteuerPruefer*'
    })
    $left = ($raw | Measure-Object x -Minimum).Minimum
    $detail = @($raw | Where-Object {
      $_.x -gt ($left + 6) -and $_.h -ge 70 -and $_.name -eq $wanted
    } | Sort-Object y | Select-Object -First 1)
    if (-not $detail.Count) {
      Fail "Die Detailkarte '$wanted' ist nicht aufgeklappt. Mit sse_checker_open oeffnen." 'precondition-failed'
    }

    $structuredProbe = Get-AccessibilityProbeData $hwnd $detail[0] 6 120 $true $true $true
    $patternTexts = @($structuredProbe.textCandidates | Where-Object {
      $_.text -ne $wanted -and $_.text.Length -ge 40 -and
      $_.source -match '(TextPattern|Legacy\.(Value|Description|Help))'
    } | Sort-Object { $_.text.Length } -Descending)
    $rawTextParts = @($structuredProbe.rawDescendants | Where-Object {
      $_.type -in @('Text','Document','Edit')
    } | ForEach-Object { $_.texts } | Where-Object {
      $_.text -ne $wanted -and $_.text.Length -ge 3
    })
    $structuredText = ''
    $structuredSources = @()
    if ($patternTexts.Count) {
      $structuredText = [string]$patternTexts[0].text
      $structuredSources = @($patternTexts[0].source)
    } elseif ($rawTextParts.Count) {
      $structuredText = (@($rawTextParts | ForEach-Object { $_.text } | Select-Object -Unique) -join "`n").Trim()
      $structuredSources = @($rawTextParts | ForEach-Object { $_.source } | Select-Object -Unique)
      if ($structuredText.Length -lt 80) { $structuredText = ''; $structuredSources = @() }
    }
    if ($structuredText) {
      Emit ([pscustomobject]@{
        ok = $true; meldung = $detail[0].name; bildBase64 = $null
        leseweg = 'accessibility'; strukturiertOk = $true; ocrVerwendet = $false; ocrOk = $null
        strukturQuellen = $structuredSources
        zeilen = @($structuredText -split "`r?`n").Count; text = $structuredText
        inAnsichtGerollt = $false; ungespeichert = Get-DirtyState $t
      })
    }

    # Lange Karten (besonders der ELSTER-Hinweis) reichen unter den sichtbaren
    # Fensterrand. Vor der OCR gezielt die DETAIL-Zeile, nicht nur den aeusseren
    # Meldungstitel, in den Viewport holen und danach ihre neuen Koordinaten
    # erneut lesen. Sonst geraten feste Bedienelemente in den Crop und der
    # eigentliche Hinweistext wird abgeschnitten.
    $detailScrolled = $false
    for ($scrollRound = 0; $scrollRound -lt 3; $scrollRound++) {
      $viewRect = New-Object SW+RC; [SW]::GetWindowRect($hwnd, [ref]$viewRect) | Out-Null
      $tooHigh = $detail[0].y -lt ($viewRect.T + 100)
      $tooLow = ($detail[0].y + $detail[0].h) -gt ($viewRect.B - 20)
      if (-not $tooHigh -and -not $tooLow) { break }

      $roundScrolled = $false
      $detailElement = Get-LiveElement $hwnd $detail[0].rid
      $scrollItem = $null
      try {
        if ($detailElement -and $detailElement.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$scrollItem)) {
          $scrollItem.ScrollIntoView()
          $roundScrolled = $true
        }
      } catch { }

      # Qt bietet hier in der Praxis weder ScrollItemPattern noch ein
      # ScrollPattern am Container. Der sichere Fallback ist ein Mausrad direkt
      # ueber der bekannten Kartenflaeche, nach PID-Pruefung und mit begrenzter
      # Schrittzahl. Das rollt nur die Prueferliste und aktiviert nichts.
      if (-not $roundScrolled) {
        $px = [int]($detail[0].x + [Math]::Min(100, [Math]::Max(20, $detail[0].w / 2)))
        $py = [int][Math]::Min($viewRect.B - 120, [Math]::Max($viewRect.T + 180, $detail[0].y + 30))
        $null = Show-SSEWindow $hwnd
        Start-Sleep -Milliseconds 250
        $pt = New-Object SW+PT; $pt.X = $px; $pt.Y = $py
        $targetPid = 0; [SW]::GetWindowThreadProcessId($hwnd, [ref]$targetPid) | Out-Null
        $hitWindow = [SW]::WindowFromPoint($pt)
        $hitRoot = [SW]::GetAncestor($hitWindow, 2) # GA_ROOT
        $hitPid = 0; [SW]::GetWindowThreadProcessId($hitWindow, [ref]$hitPid) | Out-Null
        if ($hitPid -ne $targetPid -or [int64]$hitRoot -ne [int64]$hwnd) {
          Hide-SSETopmost $hwnd
          Fail 'Prueferkarte ist durch ein fremdes oder anderes SSE-Fenster verdeckt; fuer OCR nicht gerollt.' 'obstructed'
        }
        $oldCursor = New-Object SW+PT; [SW]::GetCursorPos([ref]$oldCursor) | Out-Null
        [SW]::SetCursorPos($px, $py) | Out-Null
        Start-Sleep -Milliseconds 100
        $distance = $(if ($tooLow) { ($detail[0].y + $detail[0].h) - ($viewRect.B - 20) } else { ($viewRect.T + 100) - $detail[0].y })
        $wheelSteps = [Math]::Min(16, [Math]::Max(2, [int][Math]::Ceiling($distance / 90.0) + 1))
        $delta = $(if ($tooLow) { [uint32]([int64]0x100000000 - 120) } else { [uint32]120 })
        for ($wheelIndex = 0; $wheelIndex -lt $wheelSteps; $wheelIndex++) {
          [SW]::mouse_event(0x0800, 0, 0, $delta, [IntPtr]::Zero)
        }
        Start-Sleep -Milliseconds 600
        [SW]::SetCursorPos($oldCursor.X, $oldCursor.Y) | Out-Null
        Set-SSEForegroundLeaseInputCheckpoint (Get-SSELastInputTick) ([pscustomobject]@{ x=$oldCursor.X; y=$oldCursor.Y })
        Hide-SSETopmost $hwnd
        $roundScrolled = $true
      } else { Start-Sleep -Milliseconds 800 }

      if ($roundScrolled) { $detailScrolled = $true }
      $t = Walk-Tree $hwnd 5000 60 20 -WithValues
      $raw = @($t.nodes | Where-Object {
        $_.type -eq 'TreeItem' -and $_.name -and $_.aid -like '*PrueferWidgetSSE.SteuerPruefer*'
      })
      $left = ($raw | Measure-Object x -Minimum).Minimum
      $detail = @($raw | Where-Object {
        $_.x -gt ($left + 6) -and $_.h -ge 70 -and $_.name -eq $wanted
      } | Sort-Object y | Select-Object -First 1)
      if (-not $detail.Count) { Fail "Detailkarte '$wanted' ging beim Scrollen aus dem UIA-Baum verloren." 'stale' }
    }

    $token = [Guid]::NewGuid().ToString('N')
    $fullPath = Join-Path $env:TEMP "sse-checker-full-$token.png"
    $cropPath = Join-Path $env:TEMP "sse-checker-detail-$token.png"
    $shot = $null; $wr = New-Object SW+RC
    $img = $null; $scaled = $null; $g = $null
    $ocr = $null; $imageBase64 = $null; $processingError = $null
    $fullCleanup = $null; $cropCleanup = $null
    try {
      $shot = Take-Shot $hwnd $fullPath
      [SW]::GetWindowRect($hwnd, [ref]$wr) | Out-Null
      $img = [System.Drawing.Image]::FromFile($fullPath)
      $sx = [Math]::Max(0, [int]($detail[0].x - $wr.L))
      $sy = [Math]::Max(0, [int]($detail[0].y - $wr.T))
      $sw = [Math]::Min([int]$detail[0].w, $img.Width - $sx)
      $sh = [Math]::Min([int]$detail[0].h, $img.Height - $sy)
      if ($sw -le 0 -or $sh -le 0) { throw 'Detailkarte liegt ausserhalb des Bildschirmfotos.' }
      $scaled = New-Object System.Drawing.Bitmap($($sw * 3), $($sh * 3))
      $g = [System.Drawing.Graphics]::FromImage($scaled)
      $g.Clear([System.Drawing.Color]::White)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $src = New-Object System.Drawing.Rectangle($sx, $sy, $sw, $sh)
      $dst = New-Object System.Drawing.Rectangle(0, 0, $scaled.Width, $scaled.Height)
      $g.DrawImage($img, $dst, $src, [System.Drawing.GraphicsUnit]::Pixel)
      $scaled.Save($cropPath, [System.Drawing.Imaging.ImageFormat]::Png)
      if ($g) { $g.Dispose() }
      $g = $null
      if ($scaled) { $scaled.Dispose() }
      $scaled = $null
      if ($img) { $img.Dispose() }
      $img = $null
      $ocr = Invoke-WindowsOcr $cropPath
      if (Test-Path -LiteralPath $cropPath -PathType Leaf) {
        $imageBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($cropPath))
      }
    } catch {
      $processingError = $_.Exception.Message
    } finally {
      if ($g) { $g.Dispose() }
      if ($scaled) { $scaled.Dispose() }
      if ($img) { $img.Dispose() }
      $fullCleanup = Remove-SSETemporaryFile $fullPath
      $cropCleanup = Remove-SSETemporaryFile $cropPath
    }
    if (-not $fullCleanup.removed -or -not $cropCleanup.removed) {
      Fail ("Prueferbilder konnten nicht vollstaendig geloescht werden: " +
            "Vollbild='$($fullCleanup.error)', Detailbild='$($cropCleanup.error)'.") 'temp-cleanup'
    }
    if ($processingError) {
      Fail "Prueferdetail konnte nicht fotografiert, zugeschnitten oder gelesen werden: $processingError" 'checker-unreadable'
    }
    if (-not $ocr -or -not $ocr.ok -or -not [string]$ocr.text) {
      $ocrMessage = $(if ($ocr -and $ocr.error) { $ocr.error } else { 'OCR lieferte keinen Fliesstext.' })
      Fail "Prueferdetail ist strukturell unsichtbar und der OCR-Rueckfall blieb unlesbar: $ocrMessage" 'checker-unreadable'
    }
    Emit ([pscustomobject]@{
      ok = $true
      meldung = $detail[0].name
      bildBase64 = $imageBase64
      leseweg = 'ocr'
      strukturiertOk = $false
      ocrVerwendet = $true
      ocrOk = [bool]$ocr.ok
      sprache = $ocr.language
      zeilen = $ocr.lineCount
      text = $ocr.text
      ocrFehler = $ocr.error
      inAnsichtGerollt = $detailScrolled
      ungespeichert = Get-DirtyState $t
    })
  }

  'accessibility_probe' {
    $hwnd = Resolve-Window $a
    $tree = Walk-Tree $hwnd 5000 60 20 -WithValues
    $hits = @(Resolve-Nodes $tree $a)
    if (-not $hits.Count) { Fail 'Kein passendes UIA-Element gefunden.' 'not-found' }
    if ($hits.Count -ne 1) {
      Fail "UIA-Element ist nicht eindeutig ($($hits.Count) Treffer). rid aus sse_snapshot verwenden." 'ambiguous'
    }
    $probeDepth = [Math]::Min(10, [Math]::Max(1, [int](Arg $a 'maxDepth' 6)))
    $probeNodes = [Math]::Min(500, [Math]::Max(1, [int](Arg $a 'maxNodes' 120)))
    $includePatterns = [bool](Arg $a 'includePatterns' $true)
    $includeRaw = [bool](Arg $a 'includeRaw' $true)
    $includeMsaa = [bool](Arg $a 'includeMsaa' $false)
    $probe = Get-AccessibilityProbeData $hwnd $hits[0] $probeDepth $probeNodes $includePatterns $includeRaw $includeMsaa
    Emit ([pscustomobject]@{
      ok = $true
      hwnd = [int64]$hwnd
      node = $probe.node
      uia = $probe.uia
      rawDescendants = $probe.rawDescendants
      rawTruncated = $probe.rawTruncated
      msaaOverlaps = $probe.msaaOverlaps
      textCandidates = $probe.textCandidates
      fazit = $(if (@($probe.textCandidates | Where-Object { $_.text -and $_.text -ne $hits[0].name }).Count) {
        'Zusaetzlicher strukturierter Text gefunden; OCR ist fuer dieses Element moeglicherweise entbehrlich.'
      } else {
        'Kein zusaetzlicher strukturierter Text gefunden; OCR bleibt fuer dieses Element erforderlich.'
      })
    })
  }

  'vast_dialog_read' {
    $resolved = Resolve-SSEVaStDialog $a
    $dialog = $resolved.dialog
    $state = Read-SSEVaStState $dialog
    $duplicateTargets = @($state.rows | Where-Object { -not $_.unresolved -and $_.localTarget } |
      Group-Object localTarget | Where-Object { $_.Count -gt 1 } | ForEach-Object {
        [pscustomobject]@{ localTarget=$_.Name; count=$_.Count; certificates=@($_.Group | ForEach-Object { $_.certificate }) }
      })
    $riskyDuplicateTargets = @($state.rows | Where-Object { -not $_.unresolved -and $_.localTarget } |
      Group-Object { "$($_.certificate)`0$($_.localTarget)" } | Where-Object { $_.Count -gt 1 } | ForEach-Object {
        [pscustomobject]@{ certificate=$_.Group[0].certificate; localTarget=$_.Group[0].localTarget; count=$_.Count }
      })
    Emit ([pscustomobject]@{
      ok=$true; hwnd=[int64]$dialog.hwnd; pid=[int]$dialog.pid; title=$dialog.title
      dialogFingerprint=$dialog.fingerprint; mappingFingerprint=$state.mappingFingerprint
      certificateCount=$state.rows.Count; rows=@($state.rows | ForEach-Object {
        [pscustomobject]@{
          certificate=$_.certificate; occurrence=$_.occurrence; localTarget=$_.localTarget
          unresolved=$_.unresolved; expanded=$_.expanded; detailLines=@($_.detailLines)
        }
      })
      unresolvedCount=@($state.rows | Where-Object { $_.unresolved }).Count
      duplicateTargets=$duplicateTargets
      riskyDuplicateTargets=$riskyDuplicateTargets
      safeToApply=[bool](@($state.rows | Where-Object { $_.unresolved }).Count -eq 0 -and -not $riskyDuplicateTargets.Count)
      ocr=[pscustomobject]@{ used=$true; language=$state.ocr.language; lineCount=$state.ocr.lineCount; reason='Qt exponiert die gemalten Texte der Daten- und Zuordnungsspalte nicht verlaesslich per UIA.' }
      note='Read-only. Es wurde keine Zeile aufgeklappt, keine Zuordnung geaendert und nichts in den Steuerfall uebernommen.'
    })
  }

  'vast_row_set_expanded' {
    $resolved = Resolve-SSEVaStDialog $a
    $dialog = $resolved.dialog
    $certificate = [string](Arg $a 'certificate')
    $occurrence = [Math]::Max(1, [int](Arg $a 'occurrence' 1))
    if (-not $certificate) { Fail 'certificate ist Pflicht.' 'bad-args' }
    foreach ($required in @('mappingFingerprint','expectedBefore','expanded')) {
      if (-not $a.PSObject.Properties[$required]) { Fail "$required ist Pflicht." 'bad-args' }
    }
    $expectedMapping = ([string](Arg $a 'mappingFingerprint')).ToUpperInvariant()
    $expectedBefore = [bool](Arg $a 'expectedBefore')
    $wanted = [bool](Arg $a 'expanded')
    $state = Read-SSEVaStState $dialog
    if ($state.mappingFingerprint -ne $expectedMapping) {
      Emit ([pscustomobject]@{
        ok=$false; kind='fingerprint-mismatch'; error='Sichtbare VaSt-Zuordnungen haben sich seit dem Lesen geaendert; nichts geklickt.'
        expectedMappingFingerprint=$expectedMapping; actualMappingFingerprint=$state.mappingFingerprint
      })
    }
    $matches = @($state.rows | Where-Object { $_.certificate -eq $certificate })
    if ($occurrence -gt $matches.Count) { Fail "VaSt-Zeile '$certificate' occurrence $occurrence ist nicht vorhanden." 'not-found' }
    $row = $matches[$occurrence - 1]
    $before = [bool]$row.expanded
    if ($before -ne $expectedBefore) {
      Fail "Vorbedingung verletzt: Zeile expanded=$before, erwartet wurde $expectedBefore. Nichts geklickt." 'precondition-failed'
    }
    $clicked = $false
    if ($before -ne $wanted) {
      $arrow = [pscustomobject]@{
        x=[int]$row.arrowX - 8; y=[int]$row.y - 12
        w=16; h=24; source='vast-tree-arrow'; name=$certificate
      }
      $oldCursor = New-Object SW+PT; [SW]::GetCursorPos([ref]$oldCursor) | Out-Null
      try { $null = Click-VerifiedPoint ([IntPtr][int64]$dialog.hwnd) $arrow; $clicked = $true }
      finally { [SW]::SetCursorPos($oldCursor.X, $oldCursor.Y) | Out-Null }
    }
    $afterDialog = (Resolve-SSEVaStDialog ([pscustomobject]@{ hwnd=[int64]$dialog.hwnd })).dialog
    $afterState = Read-SSEVaStState $afterDialog
    $afterMatches = @($afterState.rows | Where-Object { $_.certificate -eq $certificate })
    if ($occurrence -gt $afterMatches.Count) { Fail 'VaSt-Zeile verschwand nach dem Ansichtsklick.' 'postcondition-failed' }
    $after = [bool]$afterMatches[$occurrence - 1].expanded
    $selectedTargetUnchanged = [bool]($afterMatches[$occurrence - 1].localTarget -eq $row.localTarget)
    if ($after -ne $wanted -or -not $selectedTargetUnchanged) {
      Emit ([pscustomobject]@{
        ok=$false; kind='postcondition-failed'; error='VaSt-Zeile erreichte den angeforderten Aufklappzustand nicht; kein weiterer Klick.'
        hwnd=[int64]$dialog.hwnd; certificate=$certificate; occurrence=$occurrence
        before=$before; requested=$wanted; after=$after; clicked=$clicked
        selectedTargetBefore=$row.localTarget; selectedTargetAfter=$afterMatches[$occurrence - 1].localTarget
        beforeViewFingerprint=$expectedMapping; afterViewFingerprint=$afterState.mappingFingerprint
      })
    }
    Emit ([pscustomobject]@{
      ok=$true; hwnd=[int64]$dialog.hwnd; certificate=$certificate; occurrence=$occurrence
      before=$before; after=$after; clicked=$clicked
      beforeViewFingerprint=$expectedMapping; afterViewFingerprint=$afterState.mappingFingerprint
      note='Nur Ansichtszustand der exakt gebundenen VaSt-Zeile geaendert; keine Zuordnung und keine Steuerdaten.'
    })
  }

  'vast_mapping_options' {
    $resolved = Resolve-SSEVaStDialog $a
    $dialog = $resolved.dialog
    $certificate = [string](Arg $a 'certificate')
    $occurrence = [Math]::Max(1, [int](Arg $a 'occurrence' 1))
    $expectedMapping = ([string](Arg $a 'mappingFingerprint')).ToUpperInvariant()
    $expectedCurrent = [string](Arg $a 'expectedCurrent')
    if (-not $certificate -or -not $expectedMapping -or -not $a.PSObject.Properties['expectedCurrent']) {
      Fail 'certificate, mappingFingerprint und expectedCurrent sind Pflicht.' 'bad-args'
    }
    $initial = Read-SSEVaStState $dialog
    if ($initial.mappingFingerprint -ne $expectedMapping) {
      Emit ([pscustomobject]@{
        ok=$false; kind='fingerprint-mismatch'; error='Sichtbare VaSt-Zuordnungen haben sich seit dem Lesen geaendert; Dropdown blieb geschlossen.'
        expectedMappingFingerprint=$expectedMapping; actualMappingFingerprint=$initial.mappingFingerprint
      })
    }
    $matches = @($initial.rows | Where-Object { $_.certificate -eq $certificate })
    if ($occurrence -gt $matches.Count) { Fail "VaSt-Zeile '$certificate' occurrence $occurrence ist nicht vorhanden." 'not-found' }
    $row = $matches[$occurrence - 1]
    if ($row.localTarget -ne $expectedCurrent) {
      Fail "Vorbedingung verletzt: Zuordnung ist '$($row.localTarget)', erwartet '$expectedCurrent'. Dropdown blieb geschlossen." 'precondition-failed'
    }
    $baselineLines = @($initial.ocr.lines | Where-Object { $_.text } | ForEach-Object {
      [pscustomobject]@{ text=(($_.text -replace '\s+', ' ').Trim()); x=[double]$_.x; y=[double]$_.y }
    })
    $dropdown = [pscustomobject]@{
      x=[int]($dialog.x + $dialog.w - 42); y=[int]$row.y - 12
      w=24; h=24; source='vast-mapping-arrow'; name=$certificate
    }
    $opened = $false; $popupConfirmed = $false; $closed = $false; $processingError = $null; $newOcrLines = @(); $uiaOptions = @()
    try {
      $oldCursor = New-Object SW+PT; [SW]::GetCursorPos([ref]$oldCursor) | Out-Null
      try { $null = Click-VerifiedPoint ([IntPtr][int64]$dialog.hwnd) $dropdown; $opened=$true }
      finally { [SW]::SetCursorPos($oldCursor.X, $oldCursor.Y) | Out-Null }
      $openTree = Walk-Tree ([IntPtr][int64]$dialog.hwnd) 6000 45 20 -WithValues
      $uiaOptions = @($openTree.nodes | Where-Object {
        $_.name -and $_.type -in @('ListItem','ComboBox')
      } | Sort-Object y, x | ForEach-Object {
        [pscustomobject]@{ text=$_.name; value=$_.val; type=$_.type; rid=$_.rid; x=$_.x; y=$_.y }
      })
      $openOcr = Invoke-SSEVaStVisibleScreenOcr $dialog
      $remaining = New-Object System.Collections.ArrayList
      foreach ($line in @($baselineLines)) { $null = $remaining.Add($line) }
      foreach ($line in @($openOcr.lines | Where-Object { $_.text } | Sort-Object y, x)) {
        $normalized = (($line.text -replace '\s+', ' ').Trim())
        $index = -1
        for ($candidateIndex=0; $candidateIndex -lt $remaining.Count; $candidateIndex++) {
          $candidate = $remaining[$candidateIndex]
          if ($candidate.text -eq $normalized -and [Math]::Abs([double]$candidate.x-[double]$line.x) -le 24 -and
              [Math]::Abs([double]$candidate.y-[double]$line.y) -le 24) { $index=$candidateIndex; break }
        }
        if ($index -ge 0) { $remaining.RemoveAt($index) }
        else { $newOcrLines += [pscustomobject]@{ text=$normalized; x=$line.x; y=$line.y } }
      }
      $popupConfirmed = [bool]($newOcrLines.Count -gt 0 -or $uiaOptions.Count -gt 0)
    } catch { $processingError = $_.Exception.Message }
    finally {
      if ($opened -and $popupConfirmed) {
        try {
          # Ein zweiter Pfeilklick waehlt bei Qts Popup-Liste je nach
          # Geometrie den ersten Eintrag. Escape ist die offizielle,
          # nicht-auswaehlende Schliessaktion und wird nur in diesem exakt
          # fingerprintgebundenen Dropdown-Kontext gesendet.
          if (-not (Show-SSEWindow ([IntPtr][int64]$dialog.hwnd))) { throw 'VaSt-Dialog konnte fuer Escape nicht aktiviert werden.' }
          [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
          Set-SSEForegroundLeaseInputCheckpoint (Get-SSELastInputTick)
          Start-Sleep -Milliseconds 220
          $closed=$true
        } catch { if (-not $processingError) { $processingError = "Dropdown konnte nicht geschlossen werden: $($_.Exception.Message)" } }
      }
      Hide-SSETopmost ([IntPtr][int64]$dialog.hwnd)
    }
    $afterDialog = (Resolve-SSEVaStDialog ([pscustomobject]@{ hwnd=[int64]$dialog.hwnd })).dialog
    $after = Read-SSEVaStState $afterDialog
    $restored = [bool]($closed -and $after.mappingFingerprint -eq $expectedMapping)
    if (-not $restored) {
      Emit ([pscustomobject]@{
        ok=$false; kind='postcondition-failed'; error='VaSt-Zuordnungsdropdown wurde nach dem Lesen nicht sicher in den Ausgangszustand zurueckgesetzt.'
        expectedMappingFingerprint=$expectedMapping; actualMappingFingerprint=$after.mappingFingerprint
        opened=$opened; popupConfirmed=$popupConfirmed; closed=$closed; processingError=$processingError
        uiaOptions=@($uiaOptions); newOcrLines=@($newOcrLines)
      })
    }
    if ($processingError) { Fail "VaSt-Zuordnungsoptionen konnten nicht gelesen werden: $processingError" 'dialog-unreadable' }
    Emit ([pscustomobject]@{
      ok=$true; hwnd=[int64]$dialog.hwnd; mappingFingerprint=$expectedMapping
      certificate=$certificate; occurrence=$occurrence; current=$row.localTarget
      uiaOptions=@($uiaOptions); newOcrLines=@($newOcrLines)
      restored=$restored; note='Dropdown wurde nur zum Lesen geoeffnet und mit unveraenderter Zuordnung wieder geschlossen.'
    })
  }

  'vast_mapping_select' {
    $resolved = Resolve-SSEVaStDialog $a
    $dialog = $resolved.dialog
    $certificate = [string](Arg $a 'certificate')
    $occurrence = [Math]::Max(1, [int](Arg $a 'occurrence' 1))
    $expectedMapping = ([string](Arg $a 'mappingFingerprint')).ToUpperInvariant()
    $expectedCurrent = [string](Arg $a 'expectedCurrent')
    $wanted = [string](Arg $a 'value')
    $visibleWanted = [string](Arg $a 'optionText' $wanted)
    $expectedAfter = [string](Arg $a 'expectedAfter')
    foreach ($required in @('certificate','mappingFingerprint','expectedCurrent','value','expectedAfter')) {
      if (-not $a.PSObject.Properties[$required]) { Fail "$required ist Pflicht." 'bad-args' }
    }
    if (-not $certificate -or -not $expectedMapping -or -not $wanted -or -not $visibleWanted -or -not $expectedAfter) {
      Fail 'certificate, mappingFingerprint, value, optionText/visible value oder expectedAfter fehlen.' 'bad-args'
    }
    $initial = Read-SSEVaStState $dialog
    if ($initial.mappingFingerprint -ne $expectedMapping) {
      Emit ([pscustomobject]@{
        ok=$false; kind='fingerprint-mismatch'; error='Sichtbare VaSt-Zuordnungen haben sich seit dem Lesen geaendert; nichts ausgewaehlt.'
        expectedMappingFingerprint=$expectedMapping; actualMappingFingerprint=$initial.mappingFingerprint
      })
    }
    $matches = @($initial.rows | Where-Object { $_.certificate -eq $certificate })
    if ($occurrence -gt $matches.Count) { Fail "VaSt-Zeile '$certificate' occurrence $occurrence ist nicht vorhanden." 'not-found' }
    $row = $matches[$occurrence - 1]
    if ($row.localTarget -ne $expectedCurrent) {
      Fail "Vorbedingung verletzt: Zuordnung ist '$($row.localTarget)', erwartet '$expectedCurrent'. Nichts ausgewaehlt." 'precondition-failed'
    }
    if ($expectedCurrent -eq $wanted) {
      Emit ([pscustomobject]@{
        ok=$true; changed=$false; hwnd=[int64]$dialog.hwnd; certificate=$certificate; occurrence=$occurrence
        before=$expectedCurrent; after=$expectedCurrent; mappingFingerprintBefore=$expectedMapping; mappingFingerprintAfter=$expectedMapping
      })
    }
    $baselineLines = @($initial.ocr.lines | Where-Object { $_.text } | ForEach-Object {
      [pscustomobject]@{ text=(($_.text -replace '\s+', ' ').Trim()); x=[double]$_.x; y=[double]$_.y }
    })
    $dropdown = [pscustomobject]@{
      x=[int]($dialog.x + $dialog.w - 42); y=[int]$row.y - 12
      w=24; h=24; source='vast-mapping-arrow'; name=$certificate
    }
    $opened = $false; $popupConfirmed = $false; $selected = $false; $processingError = $null; $optionCandidates = @()
    try {
      $oldCursor = New-Object SW+PT; [SW]::GetCursorPos([ref]$oldCursor) | Out-Null
      try { $null = Click-VerifiedPoint ([IntPtr][int64]$dialog.hwnd) $dropdown; $opened=$true }
      finally { [SW]::SetCursorPos($oldCursor.X, $oldCursor.Y) | Out-Null }
      $openOcr = Invoke-SSEVaStVisibleScreenOcr $dialog
      $remaining = New-Object System.Collections.ArrayList
      foreach ($line in @($baselineLines)) { $null = $remaining.Add($line) }
      $newLines = New-Object System.Collections.ArrayList
      foreach ($line in @($openOcr.lines | Where-Object { $_.text } | Sort-Object y, x)) {
        $normalized = (($line.text -replace '\s+', ' ').Trim())
        $index = -1
        for ($candidateIndex=0; $candidateIndex -lt $remaining.Count; $candidateIndex++) {
          $candidate = $remaining[$candidateIndex]
          if ($candidate.text -eq $normalized -and [Math]::Abs([double]$candidate.x-[double]$line.x) -le 24 -and
              [Math]::Abs([double]$candidate.y-[double]$line.y) -le 24) { $index=$candidateIndex; break }
        }
        if ($index -ge 0) { $remaining.RemoveAt($index) }
        else {
          $null = $newLines.Add([pscustomobject]@{
            text=$normalized; x=[double]$line.x; y=[double]$line.y; w=[double]$line.w; h=[double]$line.h
          })
        }
      }
      $popupConfirmed = [bool]($newLines.Count -gt 0)
      $optionCandidates = @($newLines | Where-Object { $_.text -eq $visibleWanted })
      if ($optionCandidates.Count -ne 1) {
        throw "Sichtbare Option '$visibleWanted' ist in der geoeffneten Liste nicht eindeutig ($($optionCandidates.Count) Treffer)."
      }
      $option = $optionCandidates[0]
      $px = [int]($dialog.x + (($option.x + $option.w / 2) / [double]$openOcr.scale))
      $py = [int]($dialog.y + (($option.y + $option.h / 2) / [double]$openOcr.scale))
      if ($px -lt $dialog.x -or $px -ge ($dialog.x + $dialog.w) -or $py -lt $dialog.y -or $py -ge ($dialog.y + $dialog.h)) {
        throw 'OCR-Option liegt ausserhalb des gebundenen VaSt-Dialogs.'
      }
      $point = New-Object SW+PT; $point.X=$px; $point.Y=$py
      $hit = [SW]::WindowFromPoint($point); $hitPid=0; [SW]::GetWindowThreadProcessId($hit,[ref]$hitPid)|Out-Null
      if ($hitPid -ne [int]$dialog.pid) { throw 'Am OCR-Optionspunkt liegt kein Fenster derselben SSE-Instanz.' }
      $inputBaseline = Get-SSELastInputTick
      Start-Sleep -Milliseconds 60
      if ($null -ne $inputBaseline -and -not (Test-SSELastInputUnchanged $inputBaseline)) {
        throw 'Fremde Eingabe unmittelbar vor der VaSt-Auswahl erkannt.'
      }
      $optionElement = $null
      try { $optionElement = $AE::FromPoint((New-Object Windows.Point($px,$py))) } catch { }
      if ($optionElement -and [string]$optionElement.Current.Name -and [string]$optionElement.Current.Name -ne $wanted) {
        throw "UIA-Punktbindung zeigt '$($optionElement.Current.Name)' statt '$wanted'."
      }
      # Qts SelectionItemPattern ist hier wie beim Tree-Expand ein No-op. Der
      # pixelgenaue Klick bleibt dennoch streng an OCR-Text, Dialogrechteck,
      # SSE-PID und unveraenderte Eingabe-Epoche gebunden.
      $oldCursor = New-Object SW+PT; [SW]::GetCursorPos([ref]$oldCursor) | Out-Null
      try {
        [SW]::SetCursorPos($px,$py)|Out-Null; Start-Sleep -Milliseconds 80
        [SW]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero); [SW]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
        $selected=$true; Start-Sleep -Milliseconds 300
      } finally {
        [SW]::SetCursorPos($oldCursor.X,$oldCursor.Y)|Out-Null
        Set-SSEForegroundLeaseInputCheckpoint (Get-SSELastInputTick) ([pscustomobject]@{ x=$oldCursor.X; y=$oldCursor.Y })
      }
    } catch { $processingError=$_.Exception.Message }
    finally {
      if ($opened -and $popupConfirmed -and -not $selected) {
        try {
          if (Show-SSEWindow ([IntPtr][int64]$dialog.hwnd)) {
            [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
            Set-SSEForegroundLeaseInputCheckpoint (Get-SSELastInputTick)
            Start-Sleep -Milliseconds 220
          }
        } catch { }
      }
      Hide-SSETopmost ([IntPtr][int64]$dialog.hwnd)
    }
    if ($processingError) { Fail "VaSt-Zuordnung wurde nicht geaendert: $processingError" 'precondition-failed' }
    $afterDialog = (Resolve-SSEVaStDialog ([pscustomobject]@{ hwnd=[int64]$dialog.hwnd })).dialog
    $after = Read-SSEVaStState $afterDialog
    $afterMatches = @($after.rows | Where-Object { $_.certificate -eq $certificate })
    $afterValue = $(if ($occurrence -le $afterMatches.Count) { [string]$afterMatches[$occurrence - 1].localTarget } else { $null })
    $changes = New-Object System.Collections.ArrayList
    foreach ($beforeRow in @($initial.rows)) {
      $same = @($after.rows | Where-Object {
        $_.certificate -eq $beforeRow.certificate -and $_.occurrence -eq $beforeRow.occurrence
      })
      $afterTarget = $(if ($same.Count -eq 1) { [string]$same[0].localTarget } else { $null })
      if ($afterTarget -ne [string]$beforeRow.localTarget) {
        $null = $changes.Add([pscustomobject]@{
          certificate=$beforeRow.certificate; occurrence=$beforeRow.occurrence
          before=$beforeRow.localTarget; after=$afterTarget
        })
      }
    }
    $onlyExpectedChanged = [bool]($changes.Count -eq 1 -and $changes[0].certificate -eq $certificate -and
      $changes[0].occurrence -eq $occurrence -and $changes[0].before -eq $expectedCurrent -and $changes[0].after -eq $expectedAfter)
    if ($afterValue -ne $expectedAfter -or -not $onlyExpectedChanged) {
      Emit ([pscustomobject]@{
        ok=$false; kind='postcondition-failed'; error='VaSt-Auswahl hatte nicht genau den erwarteten Ein-Zeilen-Diff; kein blinder Folgeversuch.'
        certificate=$certificate; occurrence=$occurrence; expectedAfter=$expectedAfter; actualAfter=$afterValue
        changes=@($changes); mappingFingerprintBefore=$expectedMapping; mappingFingerprintAfter=$after.mappingFingerprint
      })
    }
    Emit ([pscustomobject]@{
      ok=$true; changed=$true; hwnd=[int64]$dialog.hwnd; certificate=$certificate; occurrence=$occurrence
      before=$expectedCurrent; after=$afterValue; changes=@($changes)
      mappingFingerprintBefore=$expectedMapping; mappingFingerprintAfter=$after.mappingFingerprint
      note='Nur die VaSt-Zuordnung dieser Zeile wurde geaendert; noch keine Daten in den Steuerfall uebernommen.'
    })
  }

  'vast_apply' {
    # Die VaSt-Uebernahme ist ein lokaler Merge mit moeglichen Ueberschreibungen.
    # Sie ist deshalb bewusst strenger als ein generischer Dialogklick: exakter
    # Steuerfall/Hash, Hauptfenster, vollstaendiger sichtbarer Zuordnungsplan,
    # Mapping-Fingerprint und eine einmalige Bestaetigung sind Pflicht.
    if ((Arg $a 'acknowledgeApply') -ne $true) {
      Fail ('GESPERRT: VaSt kann lokale Steuerfalldaten ersetzen. Erst den vollstaendigen Zuordnungsplan lesen ' +
            'und acknowledgeApply=true fuer genau diesen fingerprintgebundenen Merge setzen.') 'confirmation-required'
    }
    foreach ($required in @('mappingFingerprint','expectedMainHwnd','expectedCasePath','expectedCaseHash','plan')) {
      if (-not $a.PSObject.Properties[$required]) { Fail "$required ist fuer die VaSt-Uebernahme Pflicht." 'bad-args' }
    }
    $expectedMapping = ([string](Arg $a 'mappingFingerprint')).ToUpperInvariant()
    $expectedMainHwnd = [int64](Arg $a 'expectedMainHwnd')
    $expectedCasePath = [IO.Path]::GetFullPath([string](Arg $a 'expectedCasePath'))
    $expectedCaseHash = ([string](Arg $a 'expectedCaseHash')).ToUpperInvariant()
    $plan = @((Arg $a 'plan') | Where-Object { $null -ne $_ })
    if ($expectedMapping -notmatch '^[0-9A-F]{64}$' -or $expectedCaseHash -notmatch '^[0-9A-F]{64}$') {
      Fail 'mappingFingerprint und expectedCaseHash muessen 64-stellige SHA256-Werte sein.' 'bad-args'
    }
    if (-not $expectedMainHwnd -or -not $expectedCasePath -or -not $plan.Count) {
      Fail 'expectedMainHwnd, expectedCasePath und der vollstaendige plan duerfen nicht leer sein.' 'bad-args'
    }

    $resolved = Resolve-SSEVaStDialog $a
    $dialog = $resolved.dialog
    $main = $resolved.main
    if ([int64]$main.hwnd -ne $expectedMainHwnd) {
      Fail "VaSt-Dialog gehoert zu Hauptfenster $([int64]$main.hwnd), erwartet war $expectedMainHwnd; nichts uebernommen." 'case-mismatch'
    }
    $binding = Test-CaseBinding $main $expectedCasePath
    if (-not $binding.ok) {
      Fail "VaSt-Hauptfenster ist nicht an den erwarteten Steuerfall gebunden; nichts uebernommen." 'case-mismatch'
    }
    $diskHashBefore = Get-Sha256 $expectedCasePath
    if (-not $diskHashBefore -or $diskHashBefore -ne $expectedCaseHash) {
      Fail 'Steuerfall-Hash stimmt unmittelbar vor der VaSt-Uebernahme nicht mehr.' 'case-mismatch'
    }

    $state = Read-SSEVaStState $dialog
    if ($state.mappingFingerprint -ne $expectedMapping) {
      Emit ([pscustomobject]@{
        ok=$false; kind='fingerprint-mismatch'; error='VaSt-Zuordnungen haben sich seit der Freigabe geaendert; nichts uebernommen.'
        expectedMappingFingerprint=$expectedMapping; actualMappingFingerprint=$state.mappingFingerprint
      })
    }
    $unresolved = @($state.rows | Where-Object { $_.unresolved })
    $riskyDuplicates = @($state.rows | Where-Object { -not $_.unresolved -and $_.localTarget } |
      Group-Object { "$($_.certificate)`0$($_.localTarget)" } | Where-Object { $_.Count -gt 1 })
    if ($unresolved.Count -or $riskyDuplicates.Count) {
      Emit ([pscustomobject]@{
        ok=$false; kind='unsafe-plan'; error='VaSt-Plan enthaelt ungeloeste oder riskant doppelte Zuordnungen; nichts uebernommen.'
        unresolved=@($unresolved | ForEach-Object { [pscustomobject]@{ certificate=$_.certificate; occurrence=$_.occurrence } })
        riskyDuplicateTargets=@($riskyDuplicates | ForEach-Object {
          [pscustomobject]@{ certificate=$_.Group[0].certificate; localTarget=$_.Group[0].localTarget; count=$_.Count }
        })
      })
    }
    if ($plan.Count -ne $state.rows.Count) {
      Fail "VaSt-Plan hat $($plan.Count) statt $($state.rows.Count) Zeilen; nichts uebernommen." 'plan-mismatch'
    }
    $planMismatches = New-Object System.Collections.ArrayList
    for ($index=0; $index -lt $state.rows.Count; $index++) {
      $actual = $state.rows[$index]
      $expected = $plan[$index]
      $expectedOccurrence = [int]$expected.occurrence
      if ([string]$expected.certificate -ne [string]$actual.certificate -or
          $expectedOccurrence -ne [int]$actual.occurrence -or
          [string]$expected.localTarget -ne [string]$actual.localTarget) {
        $null = $planMismatches.Add([pscustomobject]@{
          index=$index
          expected=[pscustomobject]@{ certificate=[string]$expected.certificate; occurrence=$expectedOccurrence; localTarget=[string]$expected.localTarget }
          actual=[pscustomobject]@{ certificate=$actual.certificate; occurrence=$actual.occurrence; localTarget=$actual.localTarget }
        })
      }
    }
    if ($planMismatches.Count) {
      Emit ([pscustomobject]@{
        ok=$false; kind='plan-mismatch'; error='Der freigegebene VaSt-Plan entspricht nicht mehr exakt der sichtbaren Reihenfolge; nichts uebernommen.'
        mismatches=@($planMismatches); mappingFingerprint=$state.mappingFingerprint
      })
    }

    $tree = Walk-Tree ([IntPtr][int64]$dialog.hwnd) 1200 15 16
    $applyButtons = @($tree.nodes | Where-Object {
      $_.type -eq 'Button' -and $_.on -and
      $_.aid -eq 'SSE_Application.AssignVaStDlg.QWidget.m_pbtnOK' -and
      $_.name -eq 'Zugeordnete Daten in den Steuerfall übernehmen'
    })
    if ($applyButtons.Count -ne 1) {
      Fail "$($applyButtons.Count) exakt gebundene aktive VaSt-Uebernahmeschaltflaechen gefunden; nichts uebernommen." 'ambiguous'
    }
    $button = $applyButtons[0]
    $live = Get-LiveElement ([IntPtr][int64]$dialog.hwnd) $button.rid
    if (-not $live) { Fail 'VaSt-Uebernahmeschaltflaeche ist nicht mehr greifbar; Zustand neu lesen.' 'stale' }
    try {
      if ([string]$live.Current.AutomationId -ne 'SSE_Application.AssignVaStDlg.QWidget.m_pbtnOK' -or
          [string]$live.Current.Name -ne 'Zugeordnete Daten in den Steuerfall übernehmen' -or
          -not [bool]$live.Current.IsEnabled) {
        Fail 'VaSt-Uebernahmeschaltflaeche hat ihre Identitaet oder Aktivierbarkeit verloren.' 'stale'
      }
    } catch { Fail "VaSt-Uebernahmeschaltflaeche konnte nicht erneut gebunden werden: $($_.Exception.Message)" 'stale' }

    $windowsBefore = @(Get-Windows 'SSE')
    $beforeHandles = @{}; foreach ($window in $windowsBefore) { $beforeHandles[[int64]$window.hwnd]=$true }
    $dirtyBefore = Get-DirtyStateFast ([IntPtr]$expectedMainHwnd)
    $inputBaseline = Get-SSELastInputTick
    Start-Sleep -Milliseconds 60
    if ($null -eq $inputBaseline -or -not (Test-SSELastInputUnchanged $inputBaseline)) {
      Fail 'Fremde Benutzereingabe unmittelbar vor der VaSt-Uebernahme erkannt; Zustand neu lesen.' 'interference'
    }
    $invoke = $null
    if (-not $live.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
      Fail 'VaSt-Uebernahmeschaltflaeche exponiert kein InvokePattern; physischer Fallback ist fuer diesen Merge gesperrt.' 'pattern-failed'
    }
    try { $invoke.Invoke() }
    catch { Fail "VaSt-Uebernahme konnte nicht ausgeloest werden: $($_.Exception.Message.Split("`n")[0])" 'pattern-failed' }

    $waitMs = [Math]::Min(15000, [Math]::Max(500, [int](Arg $a 'waitMs' 5000)))
    $deadline = [DateTime]::UtcNow.AddMilliseconds($waitMs)
    do {
      Start-Sleep -Milliseconds 250
      $dialogClosed = -not [SW]::IsWindow([IntPtr][int64]$dialog.hwnd)
    } until ($dialogClosed -or [DateTime]::UtcNow -ge $deadline)
    $windowsAfter = @(Get-Windows 'SSE')
    $mainAfter = @($windowsAfter | Where-Object {
      [int64]$_.hwnd -eq $expectedMainHwnd -and [int]$_.pid -eq [int]$dialog.pid
    } | Select-Object -First 1)
    $newDialogs = @($windowsAfter | Where-Object { -not $beforeHandles.ContainsKey([int64]$_.hwnd) } | ForEach-Object {
      $described = Get-DialogDescriptor $_ ([IntPtr]$expectedMainHwnd)
      if ($described.kind -in @('native-dialog','qt-dialog')) {
        [pscustomobject]@{
          hwnd=$described.hwnd; pid=$described.pid; title=$described.title; kind=$described.kind
          buttons=$described.buttons; texts=$described.texts; fingerprint=$described.fingerprint
        }
      }
    })
    $dirtyAfter = $(if ($mainAfter.Count) { Get-DirtyStateFast ([IntPtr]$expectedMainHwnd) } else { $null })
    $diskHashAfter = Get-Sha256 $expectedCasePath
    if (-not $dialogClosed) {
      Emit ([pscustomobject]@{
        ok=$false; kind='postcondition-failed'; error='VaSt-Dialog blieb nach Invoke offen; nicht erneut geklickt.'
        applied=$false; dialogHwnd=[int64]$dialog.hwnd; mappingFingerprint=$expectedMapping
        newDialogs=$newDialogs; dirtyBefore=$dirtyBefore; dirtyAfter=$dirtyAfter
      })
    }
    if (-not $mainAfter.Count) {
      Emit ([pscustomobject]@{
        ok=$false; kind='postcondition-failed'; error='VaSt-Dialog schloss, aber das gebundene Hauptfenster fehlt; keine Folgeaktion.'
        applied=$true; newDialogs=$newDialogs; diskHashBefore=$diskHashBefore; diskHashAfter=$diskHashAfter
      })
    }
    $bindingAfter = Test-CaseBinding $mainAfter[0] $expectedCasePath
    if (-not $bindingAfter.ok -or $diskHashAfter -ne $diskHashBefore) {
      Emit ([pscustomobject]@{
        ok=$false; kind='postcondition-failed'
        error='VaSt wurde ausgeloest, aber Fallbindung oder ungespeicherter Disk-Hash blieb nicht invariant; keine Folgeaktion und nicht speichern.'
        applied=$true; caseBoundAfter=[bool]$bindingAfter.ok
        diskHashBefore=$diskHashBefore; diskHashAfter=$diskHashAfter; newDialogs=$newDialogs
      })
    }
    Emit ([pscustomobject]@{
      ok=$true; applied=$true; saved=$false; dialogClosed=$true
      dialogHwnd=[int64]$dialog.hwnd; mainHwnd=$expectedMainHwnd; pid=[int]$dialog.pid
      caseBindingBefore=$binding.mode; caseBindingAfter=$bindingAfter.mode
      diskHashBefore=$diskHashBefore; diskHashAfter=$diskHashAfter; diskHashUnchanged=$true
      mappingFingerprint=$expectedMapping
      appliedPlan=@($state.rows | ForEach-Object {
        [pscustomobject]@{ certificate=$_.certificate; occurrence=$_.occurrence; localTarget=$_.localTarget }
      })
      dirtyBefore=$dirtyBefore; dirtyAfter=$dirtyAfter
      followUpRequired=[bool]$newDialogs.Count; newDialogs=$newDialogs
      note='Der exakt freigegebene VaSt-Zuordnungsplan wurde in den offenen Steuerfall uebernommen. Es wurde nicht gespeichert und kein Folgedialog automatisch beantwortet.'
    })
  }

  'vast_row_details' {
    $resolved = Resolve-SSEVaStDialog $a
    $dialog = $resolved.dialog
    $certificate = [string](Arg $a 'certificate')
    $occurrence = [Math]::Max(1, [int](Arg $a 'occurrence' 1))
    if (-not $certificate) { Fail 'certificate ist Pflicht.' 'bad-args' }
    $expectedMapping = ([string](Arg $a 'mappingFingerprint')).ToUpperInvariant()
    if (-not $expectedMapping) { Fail 'mappingFingerprint ist Pflicht.' 'bad-args' }
    $initial = Read-SSEVaStState $dialog
    if ($initial.mappingFingerprint -ne $expectedMapping) {
      Emit ([pscustomobject]@{
        ok=$false; kind='fingerprint-mismatch'; error='Sichtbare VaSt-Zuordnungen haben sich seit dem Lesen geaendert; nichts aufgeklappt.'
        expectedMappingFingerprint=$expectedMapping; actualMappingFingerprint=$initial.mappingFingerprint
      })
    }
    $matches = @($initial.rows | Where-Object { $_.certificate -eq $certificate })
    if ($occurrence -gt $matches.Count) {
      Fail "VaSt-Zeile '$certificate' occurrence $occurrence ist nicht vorhanden." 'not-found'
    }
    $row = $matches[$occurrence - 1]
    $initialExpanded = [bool]$row.expanded
    $expandedByTool = $false; $processingError = $null; $detailLines = @(); $structuredLines = @(); $comparisons = @(); $expandedState = $initial
    try {
      if (-not $initialExpanded) {
        $arrow = [pscustomobject]@{
          x=[int]$row.arrowX - 8; y=[int]$row.y - 12
          w=16; h=24; source='vast-tree-arrow'; name=$certificate
        }
        $oldCursor = New-Object SW+PT; [SW]::GetCursorPos([ref]$oldCursor) | Out-Null
        try { $null = Click-VerifiedPoint ([IntPtr][int64]$dialog.hwnd) $arrow }
        finally { [SW]::SetCursorPos($oldCursor.X, $oldCursor.Y) | Out-Null }
        $expandedByTool = $true
      }
      $expandedDialog = (Resolve-SSEVaStDialog ([pscustomobject]@{ hwnd=[int64]$dialog.hwnd })).dialog
      $expandedState = Read-SSEVaStState $expandedDialog
      $expandedMatches = @($expandedState.rows | Where-Object { $_.certificate -eq $certificate })
      if ($occurrence -gt $expandedMatches.Count) { throw 'Ausgeklappte VaSt-Zeile konnte nicht erneut gebunden werden.' }
      $expandedRow = $expandedMatches[$occurrence - 1]
      if ($expandedRow.localTarget -ne $row.localTarget) { throw 'Zielzuordnung der aufgeklappten VaSt-Zeile aenderte sich.' }
      if (-not $expandedRow.expanded) { throw 'Gebundener VaSt-Baumpfeil wurde geklickt, aber es erschienen keine Zeilendetails.' }
      $detailLines = @($expandedRow.detailLines)
      $nextRow = @($expandedState.rows | Where-Object { $_.y -gt $expandedRow.y } | Sort-Object y | Select-Object -First 1)
      $detailBottom = $(if ($nextRow.Count) { [int]$nextRow[0].y - 8 } else { [int]($dialog.y + $dialog.h - 80) })
      $expandedTree = Walk-Tree ([IntPtr][int64]$dialog.hwnd) 5000 40 20 -WithValues
      $structuredLines = @($expandedTree.nodes | Where-Object {
        $_.name -and $_.type -in @('TreeItem','Text','Edit','ComboBox') -and
        $_.y -gt ($expandedRow.y + 8) -and $_.y -lt $detailBottom
      } | Sort-Object y, x | ForEach-Object {
        [pscustomobject]@{ text=$_.name; value=$_.val; type=$_.type; y=$_.y }
      })
      $comparisonGroups = @($expandedTree.nodes | Where-Object {
        $_.type -eq 'TreeItem' -and $_.y -gt ($expandedRow.y + 8) -and $_.y -lt $detailBottom
      } | Group-Object y | Sort-Object { [int]$_.Name })
      $comparisons = @($comparisonGroups | ForEach-Object {
        $cells = @($_.Group | Sort-Object x)
        if ($cells.Count -ge 3 -and $cells[0].name) {
          [pscustomobject]@{
            field=[string]$cells[0].name; faValue=[string]$cells[1].name; localValue=[string]$cells[2].name
            differs=[bool]([string]$cells[1].name -ne [string]$cells[2].name)
          }
        }
      } | Where-Object { $null -ne $_ })
    } catch { $processingError = $_.Exception.Message }
    finally {
      if ($expandedByTool) {
        try {
          $expandedMatches = @($expandedState.rows | Where-Object { $_.certificate -eq $certificate })
          $collapseRow = $expandedMatches[$occurrence - 1]
          $arrow = [pscustomobject]@{
            x=[int]$collapseRow.arrowX - 8; y=[int]$collapseRow.y - 12
            w=16; h=24; source='vast-tree-arrow'; name=$certificate
          }
          $oldCursor = New-Object SW+PT; [SW]::GetCursorPos([ref]$oldCursor) | Out-Null
          try { $null = Click-VerifiedPoint ([IntPtr][int64]$dialog.hwnd) $arrow }
          finally { [SW]::SetCursorPos($oldCursor.X, $oldCursor.Y) | Out-Null }
        } catch { if (-not $processingError) { $processingError = "Ruecksetzen scheiterte: $($_.Exception.Message)" } }
      }
      Hide-SSETopmost ([IntPtr][int64]$dialog.hwnd)
    }
    $afterDialog = (Resolve-SSEVaStDialog ([pscustomobject]@{ hwnd=[int64]$dialog.hwnd })).dialog
    $after = Read-SSEVaStState $afterDialog
    $afterMatches = @($after.rows | Where-Object { $_.certificate -eq $certificate })
    $afterExpanded = $(if ($occurrence -le $afterMatches.Count) { [bool]$afterMatches[$occurrence - 1].expanded } else { $null })
    $restored = [bool]($after.mappingFingerprint -eq $expectedMapping -and $afterExpanded -eq $initialExpanded)
    if (-not $restored) {
      Emit ([pscustomobject]@{
        ok=$false; kind='postcondition-failed'; error='VaSt-Zeile konnte nach dem rein lesenden Aufklappen nicht sicher in den Ausgangszustand zurueckgesetzt werden.'
        hwnd=[int64]$dialog.hwnd; expectedMappingFingerprint=$expectedMapping; actualMappingFingerprint=$after.mappingFingerprint
        expectedExpanded=$initialExpanded; actualExpanded=$afterExpanded; processingError=$processingError
      })
    }
    if ($processingError) { Fail "VaSt-Zeilendetails konnten nicht gelesen werden: $processingError" 'dialog-unreadable' }
    Emit ([pscustomobject]@{
      ok=$true; hwnd=[int64]$dialog.hwnd; mappingFingerprint=$expectedMapping
      certificate=$certificate; occurrence=$occurrence; initialExpanded=$initialExpanded
      comparisons=@($comparisons); structuredLines=@($structuredLines); detailLines=@($detailLines)
      ocr=[pscustomobject]@{ used=$true; language=$expandedState.ocr.language; lineCount=$expandedState.ocr.lineCount; fallbackOnly=[bool]$structuredLines.Count }
      interactionMethod='pid-root-bound-tree-arrow'; expandedByTool=[bool]$expandedByTool
      restored=$restored; note='Zeile wurde nur temporaer aufgeklappt und mit unveraenderter OCR-Zuordnungsbindung wieder geschlossen.'
    })
  }

  'page' {
    # EINE Abfrage, die alles ueber die aktuelle Seite sagt: Ueberschrift,
    # beschreibbare Felder, Tabellen, ausloesbare Aktionen und Sperrzustand.
    # Damit braucht ein Agent im Regelfall weder Screenshot noch snapshot.
    $hwnd = Resolve-Window $a
    $can = Test-Canary $hwnd
    if (-not $can.ok) { Fail "Kanarienvogel traege ($($can.ms) ms) - Programm ueberlastet, neu starten." 'degraded' }
    $t = Walk-BoundTree $hwnd -WithValues
    $b = Get-ContentBounds $t $hwnd
    $r0 = New-Object SW+RC; [SW]::GetWindowRect($hwnd, [ref]$r0) | Out-Null
    $imInhalt = { param($n) $n.x -ge $b.minX -and $n.x -le $b.maxX }

    $kopfzeile = Get-SSEHeading $t $b $hwnd
    $heading = $kopfzeile.text

    # --- Felder: alles Beschreibbare mit seiner Beschriftung ---------------
    # Die Beschriftung eines Feldes ist der naechste Text LINKS davon in
    # derselben Bildschirmzeile.
    $texte = @($t.nodes | Where-Object { $_.type -eq 'Text' -and $_.name -and (& $imInhalt $_) })
    $felder = New-Object System.Collections.ArrayList
    foreach ($f in ($t.nodes | Where-Object { $_.type -in @('Edit','ComboBox','CheckBox','RadioButton') -and (& $imInhalt $_) } | Sort-Object y, x)) {
      $label = ($texte | Where-Object { [Math]::Abs($_.y - $f.y) -le 14 -and $_.x -lt $f.x } |
                Sort-Object { $f.x - $_.x } | Select-Object -First 1).name
      $null = $felder.Add([pscustomobject]@{
        label = $(if ($label) { $label } else { $f.name })
        typ = $f.type
        wert = $(if ($f.type -eq 'CheckBox') { $f.checked } elseif ($f.type -eq 'RadioButton') { $f.selected } else { $f.val })
        schreibgeschuetzt = $f.ro
        aid = ($f.aid -split '\.')[-1]; rid = $f.rid; y = $f.y
      })
    }

    # --- Tabellen: Kopf, sichtbare Zeilen, erste freie Zeile ---------------
    $heads = @($t.nodes | Where-Object { $_.type -eq 'Header' -and $_.name -and $_.w -gt 0 } | Sort-Object x)
    $zellen = @($t.nodes | Where-Object { $_.type -eq 'DataItem' -and $_.w -gt 0 } | Sort-Object y, x)
    $zeilen = New-Object System.Collections.ArrayList
    $curY = -9999; $cur = $null
    foreach ($c in $zellen) {
      if ($null -eq $cur -or [Math]::Abs($c.y - $curY) -gt 10) {
        if ($null -ne $cur) { $null = $zeilen.Add($cur) }
        $curY = $c.y; $cur = [pscustomobject]@{ y = $c.y; zellen = New-Object System.Collections.ArrayList }
      }
      $null = $cur.zellen.Add([pscustomobject]@{ x = $c.x; text = $c.name; rid = $c.rid })
    }
    if ($null -ne $cur) { $null = $zeilen.Add($cur) }
    $frei = @($zeilen | Where-Object { @($_.zellen | Where-Object { $_.text -and $_.text -ne '0,00' -and $_.text -ne '0' }).Count -eq 0 } | Sort-Object y)

    # --- Aktionen: was laesst sich hier ausloesen? -------------------------
    $aktionen = New-Object System.Collections.ArrayList
    # Qt exponiert Unterseiten-Aktionen haeufig doppelt: als sichtbaren
    # Hyperlink und als gleich beschrifteten Button. Der Hyperlink reagiert
    # zuverlaessig auf den PID-/Root-verifizierten Punktklick, waehrend
    # InvokePattern beim Button trotz Erfolg wirkungslos bleiben kann.
    # Innerhalb derselben Zeile deshalb den Hyperlink zuerst anbieten.
    $actionNodes = @($t.nodes |
      Where-Object { $_.type -in @('Button','Hyperlink') -and $_.name } |
      Sort-Object y, @{ Expression = { if ($_.type -eq 'Hyperlink') { 0 } else { 1 } } }, x)
    foreach ($k in $actionNodes) {
      $gesperrt = Test-Versand $k.name
      $bereich = if ($k.y -lt ($r0.T + 160)) { 'werkzeugleiste' }
                 elseif (& $imInhalt $k) { 'seite' } else { 'hilfespalte' }
      $vorhanden = @($aktionen | Where-Object { $_.name -eq $k.name -and $_.bereich -eq $bereich })
      if ($vorhanden.Count) { continue }
      $null = $aktionen.Add([pscustomobject]@{
        name = $k.name; typ = $k.type; bereich = $bereich
        aktiviert = [bool]$k.on
        gesperrt = [bool]$gesperrt
        # UIA-Invoke wirkt bei Schaltflaechen; Verweise und Baumeintraege
        # brauchen einen echten Klick.
        werkzeug = $(if ($gesperrt) { '(gesperrt)' } elseif ($k.type -eq 'Button') { 'sse_click' } else { 'sse_click_point' })
      })
    }

    # --- Sperrzustand ------------------------------------------------------
    $wins = @(Get-Windows 'SSE')
    $targetPid = 0
    [SW]::GetWindowThreadProcessId($hwnd, [ref]$targetPid) | Out-Null
    $dialoge = @(Get-DialogInventory | Where-Object {
      [int]$_.pid -eq $targetPid -and $_.kind -in @('native-dialog','qt-dialog')
    })
    $pruefer = @($t.nodes | Where-Object {
      $_.type -eq 'TreeItem' -and $_.name -and $_.x -gt $b.maxX -and $_.name.Length -lt 90
    } | ForEach-Object { $_.name } | Where-Object { $_ -notin @('Eingabehilfe','Steuertipps','Prüfer','Mehr Details','Zurzeit keine Hinweise zu diesem Dialog.') } | Select-Object -Unique)
    $pflichtLeer = @($felder | Where-Object { $_.typ -eq 'ComboBox' -and -not "$($_.wert)".Trim() })

    Emit ([pscustomobject]@{
      ok = $true
      ueberschrift = $heading
      ueberschriftQuelle = $kopfzeile.quelle
      ausgeschlosseneFenster = @($t.fremdeFenster)
      felder = @($felder)
      tabelle = $(if ($heads.Count -or $zeilen.Count) { [pscustomobject]@{
        kopf = @($heads | ForEach-Object { $_.name })
        zeilen = @($zeilen | ForEach-Object { @($_.zellen | ForEach-Object { $_.text }) })
        sichtbareZeilen = $zeilen.Count
        ersteFreieZeile = $(if ($frei.Count) { @($frei[0].zellen | ForEach-Object { [pscustomobject]@{ x = $_.x; rid = $_.rid } }) } else { $null })
        hinweis = 'Nur die SICHTBAREN Zeilen. Bei mehr Zeilen sse_table_read benutzen.'
      } } else { $null })
      aktionen = @($aktionen)
      blockiert = [bool]($pruefer.Count -or $dialoge.Count -or ($wins.Count -gt 2))
      prueferMeldungen = $pruefer
      leerePflichtfelder = @($pflichtLeer | ForEach-Object { $_.label })
      dialoge = @($dialoge | ForEach-Object {
        [pscustomobject]@{
          hwnd=$_.hwnd; title=$_.title; fingerprint=$_.fingerprint
          buttons=$_.buttons; unsupportedButtons=$_.unsupportedButtons
        }
      })
      offeneFenster = $wins.Count
      stats = $t.stats
    })
  }

  'positions' {
    $was = [string](Arg $a 'aktion' 'list')
    if ($was -in @('add','delete')) {
      Fail ('Positionen anlegen oder loeschen ist ohne eigenen Seiten-, Feld-, Summen- und Dialogvertrag ' +
            'mit Readback/Rollback gesperrt. Struktur vorerst manuell anlegen; Werte danach ueber ' +
            'sse_change_known_field, sse_change_field oder sse_table_* setzen.') 'blocked'
    }
    if ($was -ne 'list') { Fail "Unbekannte aktion '$was' (erlaubt: list)" 'bad-args' }
    $hwnd = [IntPtr][int64](Resolve-SSEMainWindowDescriptor $a -RestoreMinimized).hwnd
    $t = Walk-Tree $hwnd -WithValues
    # Auf der Uebersichtsseite steht je Position eine Zeile mit Summe und dem
    # Verweis "»X« bearbeiten". Diese Abfrage ist rein lesend.
    $namen = @($t.nodes | Where-Object { $_.name -match '^»(.+)« bearbeiten$' } |
               ForEach-Object { ($_.name -replace '^»', '') -replace '« bearbeiten$', '' } | Select-Object -Unique)
    Emit ([pscustomobject]@{ ok = $true; positionen = $namen; anzahl = $namen.Count
      hinweis = $(if (-not $namen.Count) { "Keine Positionen sichtbar - erst auf die Uebersichtsseite ('Erlöse Lieferungen/Leistungen' bzw. 'Betriebsausgaben: Eigene Positionen') navigieren." }) })
  }

  'export_csv' {
    # Datei > Export fuer das Finanzamt (CSV-Dateien).
    # Zweiter, vom Bildschirm unabhaengiger Pruefweg: die exportierten Zahlen
    # lassen sich ohne UI-Automation gegen die eigene Aufstellung halten.
    $vorher = @()
    $ordner = [string](Arg $a 'dir')
    if ($ordner -and (Test-Path -LiteralPath $ordner)) {
      $vorher = @(Get-ChildItem -LiteralPath $ordner -Filter *.csv -File | ForEach-Object { $_.FullName })
    }
    $hwnd = [IntPtr][int64](Resolve-SSEMainWindowDescriptor $a -RestoreMinimized).hwnd
    $windowsBefore = @(Get-Windows 'SSE')
    $preexistingExport = @($windowsBefore | Where-Object { $_.title -like 'Export für das Finanzamt (*.csv)*' })
    if ($preexistingExport.Count) { Fail 'Der CSV-Exportdialog ist bereits offen; zuerst diesen Zustand bewusst bearbeiten.' 'dialog-open' }
    $topPopupBefore = Get-SSEDeepestLastActivePopup $hwnd
    if ($topPopupBefore -ne $hwnd) { Fail 'Vor dem CSV-Export ist bereits ein modaler Dialog offen; zuerst diesen lesen.' 'dialog-open' }
    $t = Walk-Tree $hwnd 1200
    $datei = @($t.nodes | Where-Object { $_.type -eq 'MenuItem' -and $_.name -eq 'Datei' })[0]
    if (-not $datei) { Fail "Menue 'Datei' nicht gefunden." 'not-found' }
    $el = Get-LiveElement $hwnd $datei.rid
    try { $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand() }
    catch { try { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch { Fail 'Datei-Menue liess sich nicht oeffnen.' 'pattern-failed' } }
    Start-Sleep -Milliseconds 800
    $eintrag = $null
    foreach ($w in (Get-Windows 'SSE')) {
      try {
        $tw = Walk-Tree ([IntPtr][int64]$w.hwnd) 600 10
        $n = @($tw.nodes | Where-Object { $_.type -eq 'MenuItem' -and $_.name -like 'Export für das Finanzamt*' })[0]
        if ($n) { $eintrag = [pscustomobject]@{ hwnd = [IntPtr][int64]$w.hwnd; node = $n }; break }
      } catch { }
    }
    if (-not $eintrag) { Fail "Menueeintrag 'Export für das Finanzamt (CSV-Dateien)' nicht gefunden." 'not-found' }
    $ee = Get-LiveElement $eintrag.hwnd $eintrag.node.rid
    $invokeError = $null
    try { $null = Click-VerifiedPoint $eintrag.hwnd $eintrag.node }
    catch { $invokeError = $_.Exception.Message }
    $deadline = [DateTime]::UtcNow.AddMilliseconds(3000)
    $wins = @(); $exportWindows = @()
    do {
      Start-Sleep -Milliseconds 120
      $wins = @(Get-Windows 'SSE')
      $exportWindows = @($wins | Where-Object { $_.title -like 'Export für das Finanzamt (*.csv)*' })
      if ($exportWindows.Count) { break }
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($exportWindows.Count -ne 1) {
      $detail = $(if ($invokeError) { " InvokePattern: $invokeError" } else { '' })
      Fail "Exporteintrag fuehrte nicht zu genau einem CSV-Exportdialog.$detail" 'postcondition-failed'
    }
    $exportDialog = Get-DialogDescriptor $exportWindows[0] $hwnd
    if ($exportDialog.kind -notin @('native-dialog','qt-dialog') -or -not $exportDialog.fingerprint) {
      Fail 'CSV-Exportfenster wurde geoeffnet, ist aber nicht sicher als fingerprintgebundener Dialog lesbar.' 'dialog-unreadable'
    }
    Emit ([pscustomobject]@{
      ok = $true; ausgeloest = 'Export für das Finanzamt (CSV-Dateien)'
      invokeReportedError = $invokeError
      dialog = [pscustomobject]@{
        hwnd = $exportDialog.hwnd; pid = $exportDialog.pid; cls = $exportDialog.cls; title = $exportDialog.title; kind = $exportDialog.kind
        buttons = $exportDialog.buttons; texts = $exportDialog.texts; fingerprint = $exportDialog.fingerprint
      }
      offeneDialoge = 1
      dateienVorher = $vorher.Count
      hinweis = 'Der Exportdialog ist direkt fingerprintgebunden zurueckgegeben. Dessen Export-Schalter bewusst mit sse_dialog_answer beantworten; den danach gemeldeten Ordnerdialog separat behandeln.'
    })
  }

  'collect' {
    # Erfasst einen sicheren Teilpfad: blaettert von einem Zweig aus durch eine
    # begrenzte Zahl Seiten und schreibt Ueberschrift, Felder und Tabellen als
    # JSON. Grosse Monolithlaeufe ueberlasten Qt/SSE kumulativ; der Aufrufer
    # setzt daher mit einem neuen, hashgebundenen Segment fort.
    # Grundlage jeder Verifikation - ohne das gibt es nichts zu vergleichen.
    $max = [int](Arg $a 'maxPages' 3)
    if ($max -lt 1 -or $max -gt 5) {
      Fail 'sse_collect maxPages muss zwischen 1 und 5 liegen. Fuer den Live-Dialog direkte Page-Object-/Tree-Spruenge verwenden.' 'bad-args'
    }
    $ziel = [string](Arg $a 'path')
    $zielParent = $null
    if ($a.PSObject.Properties['expectedOutputHashBefore']) {
      Fail 'expectedOutputHashBefore ist gesperrt; fuer jedes Diagnose-Segment eine neue resultRef verwenden.' 'blocked'
    }
    if ($ziel) {
      try { $ziel = [IO.Path]::GetFullPath($ziel) }
      catch { Fail "Ungueltiger Ausgabepfad: $($_.Exception.Message)" 'bad-args' }
      if ([IO.Path]::GetExtension($ziel) -ine '.json') { Fail 'sse_collect path muss auf .json enden.' 'bad-args' }
      $zielParent = Split-Path $ziel -Parent
      if (-not (Test-Path -LiteralPath $zielParent -PathType Container)) { Fail "Zielordner existiert nicht: $zielParent" 'not-found' }
      if (Test-Path -LiteralPath $ziel) {
        Fail 'Zieldatei existiert bereits; fuer jedes Diagnose-Segment eine neue resultRef verwenden.' 'exists'
      }
    }
    # Datei-Preconditions muessen vor jeder potentiellen UI-Aktion scheitern.
    $hwnd = [IntPtr][int64](Resolve-SSEMainWindowDescriptor $a -RestoreMinimized).hwnd
    $seiten = New-Object System.Collections.ArrayList
    # Dieselbe Ueberschrift kommt in SSE absichtlich mehrfach vor, etwa die
    # §-13b-Unterseite hinter Material, Fremdleistungen und weiteren
    # Betriebsausgaben. Ein Titel allein ist deshalb keine Seitenidentitaet.
    # Fuer die Zyklussicherung ist der gerichtete Navigationsweg ausreichend:
    # Erst wenn dieselbe Seite erneut vom selben Vorgaenger erreicht wird,
    # haben wir einen echten Zyklus im linearen Weiter-Pfad.
    $gesehenWege = @{}
    $eingetretenVon = '(Start)'
    $vollstaendig = $false
    $stopKind = 'limit-reached'
    $stopReason = "Seitenlimit $max erreicht; der Batch ist nicht als vollstaendig bewiesen."
    # Explizit festhalten, wo SSE NACH dem letzten erfassten Snapshot steht.
    # Das alte fortsetzenAb bezeichnet weiterhin die zuletzt geschriebene
    # Seite und ist deshalb allein kein sicherer Wiederaufnahmepunkt.
    $currentHeadingAfter = $null
    $advancedAfterLastCaptured = $false
    $stopDialoge = @()
    $guardUserInput = [bool](-not $script:DESKTOP_NAME)
    $inputBaseline = $(if ($guardUserInput) { Get-SSELastInputTick } else { $null })
    $inputObserved = $inputBaseline
    $targetPid = 0
    [SW]::GetWindowThreadProcessId($hwnd, [ref]$targetPid) | Out-Null
    $privateStartBytes = 0L
    $privateLastBytes = 0L
    $privateAbsoluteLimitBytes = 1536L * 1024L * 1024L
    $privateDeltaLimitBytes = 512L * 1024L * 1024L
    try {
      $collectProcess = Get-Process -Id $targetPid -ErrorAction Stop
      $privateStartBytes = [int64]$collectProcess.PrivateMemorySize64
      $privateLastBytes = $privateStartBytes
    } catch {
      Fail "SSE-Prozess $targetPid konnte vor der Segmentaufnahme nicht gelesen werden." 'not-found'
    }

    for ($i = 1; $i -le $max; $i++) {
      try {
        $collectProcess = Get-Process -Id $targetPid -ErrorAction Stop
        $collectProcess.Refresh()
        $privateLastBytes = [int64]$collectProcess.PrivateMemorySize64
      } catch {
        $stopKind = 'process-lost'
        $stopReason = "SSE-Prozess $targetPid ist waehrend der Segmentaufnahme verschwunden."
        break
      }
      if ($privateLastBytes -gt $privateAbsoluteLimitBytes -or ($privateLastBytes - $privateStartBytes) -gt $privateDeltaLimitBytes) {
        $stopKind = 'degraded-memory'
        $stopReason = "SSE-Speichergrenze vor Seite $i erreicht; Segment vor weiterer UIA-Arbeit gestoppt."
        break
      }
      $canaryBeforePage = Test-Canary $hwnd
      if (-not $canaryBeforePage.ok) {
        $stopKind = 'degraded'
        $stopReason = "UIA-Kanarienabfrage vor Seite $i ist ungesund; Segment gestoppt."
        break
      }
      if ($guardUserInput) {
        $inputObserved = Get-SSELastInputTick
        if ($null -ne $inputBaseline -and $null -ne $inputObserved -and $inputObserved -ne $inputBaseline) {
          $stopKind = 'interference'
          $stopReason = 'Fremde Benutzereingabe waehrend der Gesamterfassung erkannt; vor dem naechsten UI-Schritt gestoppt.'
          break
        }
      }
      $dialogsAtStart = @(Get-DialogInventory | Where-Object {
        [int]$_.pid -eq $targetPid -and $_.kind -in @('native-dialog','qt-dialog')
      })
      if ($dialogsAtStart.Count) {
        $stopKind = 'dialog-open'
        $stopReason = 'Vor dem naechsten Erfassungsschritt ist ein modaler Dialog offen; nichts weiter ausgeloest.'
        $stopDialoge = $dialogsAtStart
        break
      }
      $t = Walk-BoundTree $hwnd -WithValues
      $b = Get-ContentBounds $t $hwnd
      $r0 = New-Object SW+RC; [SW]::GetWindowRect($hwnd, [ref]$r0) | Out-Null
      $inh = { param($n) $n.x -ge $b.minX -and $n.x -le $b.maxX }
      $kopfzeile = Get-SSEHeading $t $b $hwnd
      $head = $kopfzeile.text
      if (-not $head) { $head = "(ohne Ueberschrift $i)" }
      $currentHeadingAfter = $head
      $advancedAfterLastCaptured = $false
      $seitenWeg = "$eingetretenVon`u{001F}$head"
      if ($gesehenWege.ContainsKey($seitenWeg)) {
        $stopKind = 'cycle'
        $stopReason = "Seite '$head' wurde erneut ueber denselben Weg von '$eingetretenVon' erreicht; vor einer doppelten Erfassung gestoppt."
        break
      }

      # Felder mit Beschriftung
      $texte = @($t.nodes | Where-Object { $_.type -eq 'Text' -and $_.name -and (& $inh $_) })
      $felder = New-Object System.Collections.ArrayList
      foreach ($f in ($t.nodes | Where-Object { $_.type -in @('Edit','ComboBox') -and (& $inh $_) } | Sort-Object y, x)) {
        $lab = ($texte | Where-Object { [Math]::Abs($_.y - $f.y) -le 14 -and $_.x -lt $f.x } |
                Sort-Object { $f.x - $_.x } | Select-Object -First 1).name
        if (-not $lab) { continue }
        $null = $felder.Add([pscustomobject]@{ label = $lab; wert = $f.val; ro = $f.ro })
      }
      # Beschriftung/Wert-Paare aus reinen Textzeilen (berechnete Summen)
      foreach ($z in ($texte | Sort-Object y, x)) {
        $rechts = @($texte | Where-Object { [Math]::Abs($_.y - $z.y) -le 12 -and $_.x -gt $z.x })
        if ($rechts.Count -eq 1 -and $rechts[0].name -match '^-?[\d.]+,\d{2}$') {
          $null = $felder.Add([pscustomobject]@{ label = $z.name; wert = $rechts[0].name; ro = $true })
        }
      }
      # Tabelle
      $heads = @($t.nodes | Where-Object { $_.type -eq 'Header' -and $_.name -and $_.w -gt 0 } | Sort-Object x)
      $hd = @(); foreach ($x in $heads) { if (-not $hd.Count -or [Math]::Abs($x.x - $hd[-1].x) -gt 8) { $hd += $x } }
      $zellen = @($t.nodes | Where-Object { $_.type -eq 'DataItem' -and $_.w -gt 0 } | Sort-Object y, x)
      $zeilen = @(); $cur = $null; $cy = -9999
      foreach ($c in $zellen) {
        if ($null -eq $cur -or [Math]::Abs($c.y - $cy) -gt 10) {
          if ($null -ne $cur) { $zeilen += , $cur }
          $cy = $c.y; $cur = @($null) * [Math]::Max(1, $hd.Count)
        }
        $best = 0; $d = [int]::MaxValue
        for ($k = 0; $k -lt $hd.Count; $k++) { $dd = [Math]::Abs($c.x - $hd[$k].x); if ($dd -lt $d) { $d = $dd; $best = $k } }
        if ($best -lt $cur.Count) { $cur[$best] = $c.name } else { $cur += $c.name }
      }
      if ($null -ne $cur) { $zeilen += , $cur }
      $echte = @($zeilen | Where-Object { @($_ | Where-Object { $_ -and "$_".Trim() -and "$_" -ne '0,00' }).Count -gt 0 })

      $null = $seiten.Add([pscustomobject]@{
        nr = $i; ueberschrift = $head
        ueberschriftQuelle = $kopfzeile.quelle
        ausgeschlosseneFenster = @($t.fremdeFenster)
        felder = @($felder)
        tabelle = $(if ($echte.Count) { [pscustomobject]@{ kopf = @($hd | ForEach-Object { $_.name }); zeilen = $echte } } else { $null })
      })

      $gesehenWege[$seitenWeg] = $true

      $navigationTree = Walk-Tree $hwnd 1200
      $wtr = @($navigationTree.nodes | Where-Object {
        $_.name -eq 'Weiter' -and $_.type -eq 'Button'
      })[0]
      if (-not $wtr -or -not $wtr.on) {
        if ($t.stats.truncated) {
          $stopKind = 'snapshot-truncated'
          $stopReason = "Auf '$head' war der UIA-Snapshot abgeschnitten; das Ende des Blaetterpfads ist nicht bewiesen."
        } else {
          $vollstaendig = $true
          $stopKind = 'end-of-branch'
          $stopReason = "Auf '$head' ist kein aktivierter Weiter-Schalter vorhanden; der ab der Startseite erreichbare Blaetterpfad ist beendet."
        }
        break
      }
      $el = Get-LiveElement $hwnd $wtr.rid
      if (-not $el) {
        $stopKind = 'stale-navigation'
        $stopReason = "Der Weiter-Schalter auf '$head' war vor dem Invoke nicht mehr greifbar."
        break
      }
      try { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
      catch {
        $stopKind = 'navigation-pattern-failed'
        $stopReason = "Weiter auf '$head' konnte nicht per InvokePattern ausgeloest werden: $($_.Exception.Message.Split("`n")[0])"
        break
      }
      # Ab dem erfolgreichen Invoke ist die aktuelle Seite bis zum Heading-
      # Readback unbekannt. Bei Prozess-/Dialog-/Canary-Stopp darf deshalb
      # nicht faelschlich die alte Seite als aktuelle Lage ausgegeben werden.
      $currentHeadingAfter = $null
      $advancedAfterLastCaptured = $false
      Start-Sleep -Milliseconds 950
      try {
        $collectProcess = Get-Process -Id $targetPid -ErrorAction Stop
        $collectProcess.Refresh()
        $privateLastBytes = [int64]$collectProcess.PrivateMemorySize64
      } catch {
        $stopKind = 'process-lost'
        $stopReason = "SSE-Prozess $targetPid ist nach Weiter auf '$head' verschwunden."
        break
      }
      if ($privateLastBytes -gt $privateAbsoluteLimitBytes -or ($privateLastBytes - $privateStartBytes) -gt $privateDeltaLimitBytes) {
        $stopKind = 'degraded-memory'
        $stopReason = "SSE-Speichergrenze nach Weiter auf '$head' erreicht; vor dem naechsten UIA-Snapshot gestoppt."
        break
      }
      $canaryAfterPage = Test-Canary $hwnd
      if (-not $canaryAfterPage.ok) {
        $stopKind = 'degraded'
        $stopReason = "UIA-Kanarienabfrage nach Weiter auf '$head' ist ungesund; Segment gestoppt."
        break
      }
      if ($guardUserInput) {
        $inputObserved = Get-SSELastInputTick
        if ($null -ne $inputBaseline -and $null -ne $inputObserved -and $inputObserved -ne $inputBaseline) {
          $stopKind = 'interference'
          $stopReason = "Fremde Benutzereingabe nach Weiter auf '$head' erkannt; der Folgezustand muss neu gelesen werden."
          break
        }
      }
      $dialogsAfter = @(Get-DialogInventory | Where-Object {
        [int]$_.pid -eq $targetPid -and $_.kind -in @('native-dialog','qt-dialog')
      })
      if ($dialogsAfter.Count) {
        $stopKind = 'dialog-open'
        $stopReason = "Weiter auf '$head' hat einen Dialog geoeffnet; der wartende Navigationsklick wird nicht wiederholt."
        $stopDialoge = $dialogsAfter
        break
      }
      $afterHeading = Get-CurrentHeading $hwnd
      if (-not $afterHeading) {
        $stopKind = 'no-progress'
        $stopReason = "Weiter auf '$head' ergab keinen bestaetigten Seitenwechsel. Keine automatische Wiederholung."
        break
      }
      if ($afterHeading -eq $head) {
        $currentHeadingAfter = $head
        $stopKind = 'no-progress'
        $stopReason = "Weiter auf '$head' ergab keinen bestaetigten Seitenwechsel. Keine automatische Wiederholung."
        break
      }
      $currentHeadingAfter = $afterHeading
      $advancedAfterLastCaptured = $true
      $naechsterWeg = "$head`u{001F}$afterHeading"
      if ($gesehenWege.ContainsKey($naechsterWeg)) {
        $stopKind = 'cycle'
        $stopReason = "Weiter auf '$head' fuehrte erneut ueber denselben Weg zur Seite '$afterHeading'; vor einer doppelten Erfassung gestoppt."
        break
      }
      $eingetretenVon = $head
    }

    $dateiHash = $null
    $document = [pscustomobject]@{
      erstellt=(Get-Date).ToString('s'); vollstaendig=$vollstaendig
      stopKind=$stopKind; stopReason=$stopReason
      currentHeadingAfter=$currentHeadingAfter
      advancedAfterLastCaptured=$advancedAfterLastCaptured
      anzahl=$seiten.Count; seiten=@($seiten)
    }
    if ($ziel) {
      $tmpOutput = Join-Path $zielParent ("." + [IO.Path]::GetFileName($ziel) + "." + [Guid]::NewGuid().ToString('N') + '.tmp')
      try {
        $json = $document | ConvertTo-Json -Depth 12
        $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($json)
        $outputStream = $null
        try {
          $outputStream = [IO.File]::Open($tmpOutput, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
          $outputStream.Write($bytes, 0, $bytes.Length)
          $outputStream.Flush($true)
        } finally {
          if ($outputStream) { $outputStream.Dispose() }
        }
        # File.Move besitzt hier absichtlich keinen Overwrite-Pfad. Erscheint
        # das Ziel waehrend des UI-Laufs, bleibt die fremde Datei erhalten.
        [IO.File]::Move($tmpOutput, $ziel)
        $dateiHash = Get-Sha256 $ziel
      } catch {
        if (Test-Path -LiteralPath $ziel) {
          Fail 'Zieldatei erschien waehrend der Erfassung und wurde nicht ueberschrieben.' 'exists'
        }
        Fail "Diagnoseartefakt konnte nicht sicher geschrieben werden: $($_.Exception.Message)" 'write-failed'
      } finally {
        if (Test-Path -LiteralPath $tmpOutput) { Remove-Item -LiteralPath $tmpOutput -Force -ErrorAction SilentlyContinue }
      }
    }
    $result = [pscustomobject]@{
      ok=$vollstaendig
      kind=$(if ($vollstaendig) { $null } else { 'collection-incomplete' })
      error=$(if ($vollstaendig) { $null } else { $stopReason })
      vollstaendig=$vollstaendig; stopKind=$stopKind; stopReason=$stopReason
      anzahl=$seiten.Count; datei=$ziel; dateiHash=$dateiHash
      ueberschriften=@($seiten | ForEach-Object { $_.ueberschrift })
      seiten=$(if ($ziel) { $null } else { @($seiten) })
      fortsetzenAb=$(if ($seiten.Count) { $seiten[-1].ueberschrift } else { $null })
      currentHeadingAfter=$currentHeadingAfter
      advancedAfterLastCaptured=$advancedAfterLastCaptured
      dialoge=@($stopDialoge | ForEach-Object {
        [pscustomobject]@{ hwnd=$_.hwnd; title=$_.title; fingerprint=$_.fingerprint; buttons=$_.buttons }
      })
      inputGuard=[pscustomobject]@{
        aktiv=$guardUserInput; baseline=$inputBaseline; beobachtet=$inputObserved
        eingriffErkannt=[bool]($stopKind -eq 'interference')
      }
      resourceGuard=[pscustomobject]@{
        privateStartBytes=$privateStartBytes; privateLastBytes=$privateLastBytes
        privateAbsoluteLimitBytes=$privateAbsoluteLimitBytes; privateDeltaLimitBytes=$privateDeltaLimitBytes
      }
      hinweis=$(if ($stopKind -eq 'dialog-open') {
        'Dialog lesen und fingerprintgebunden beantworten, danach sse_ui_state neu lesen. Den wartenden Navigationsklick nicht wiederholen.'
      } elseif (-not $vollstaendig) {
        'Teilstand ist nicht vollstaendig. sse_ui_state lesen und gezielt an der gemeldeten Lage fortsetzen.'
      } else {
        'Der ab der Startseite erreichbare Blaetterpfad wurde ohne Dialog, Zyklus oder Scheinerfolg beendet.'
      })
    }
    Emit $result
  }

  'verify' {
    # Vergleicht Sollwerte gegen einen exakt hashgebundenen collect-Stand.
    # Exakte Bezeichner haben Vorrang. Ein mehrdeutiger Teilstring darf nie
    # still den ersten Treffer auswaehlen; die Kandidaten werden stattdessen
    # sichtbar und koennen bewusst per 1-basierter Occurrence gebunden werden.
    $erw = @(Arg $a 'erwartungen')
    if (-not $erw.Count) { Fail 'erwartungen fehlt (Liste aus seite/label/wert)' 'bad-args' }
    $quelleRaw = [string](Arg $a 'from')
    $expectedSourceHash = ([string](Arg $a 'expectedSourceHash')).ToUpperInvariant()
    if (-not $quelleRaw) { Fail 'from fehlt. Erst sse_collect mit path aufrufen.' 'bad-args' }
    if ($expectedSourceHash -notmatch '^[A-F0-9]{64}$') {
      Fail 'expectedSourceHash ist als 64-stelliger SHA256 aus sse_collect Pflicht.' 'bad-args'
    }
    try { $quelle = [IO.Path]::GetFullPath($quelleRaw) }
    catch { Fail "Ungueltiger Quellpfad: $($_.Exception.Message)" 'bad-args' }
    if ([IO.Path]::GetExtension($quelle) -ine '.json' -or -not (Test-Path -LiteralPath $quelle -PathType Leaf)) {
      Fail 'from muss eine existierende .json-Datei sein.' 'bad-args'
    }
    $sourceHashBefore = Get-Sha256 $quelle
    if ($sourceHashBefore -ine $expectedSourceHash) {
      Fail "Quellstand hat SHA256 $sourceHashBefore statt $expectedSourceHash; nicht geprueft." 'precondition-failed'
    }
    try { $sourceDocument = Read-SSEJsonFileStrict $quelle 16MB }
    catch {
      Fail "Collect-JSON ist nicht lesbar: $($_.Exception.Message)" 'invalid-source'
    }
    $sourceHashAfter = Get-Sha256 $quelle
    if ($sourceHashAfter -ine $sourceHashBefore) {
      Emit ([pscustomobject]@{
        ok=$false; kind='verification-source-changed'
        error='Collect-JSON wurde waehrend des Lesens geaendert; kein Vergleich ausgefuehrt.'
        sourceHashBefore=$sourceHashBefore; sourceHashAfter=$sourceHashAfter
      })
    }
    $daten = @($sourceDocument.seiten)
    if (-not $daten.Count) { Fail 'Collect-JSON enthaelt keine Seiten.' 'invalid-source' }
    $sourceCompleteProperty = $sourceDocument.PSObject.Properties['vollstaendig']
    $sourceVollstaendig = $(if ($sourceCompleteProperty) { [bool]$sourceCompleteProperty.Value } else { $null })
    $allowIncomplete = [bool](Arg $a 'allowIncompleteSource' $false)
    if ($sourceVollstaendig -ne $true -and -not $allowIncomplete) {
      Emit ([pscustomobject]@{
        ok=$false; kind='verification-source-incomplete'
        error='Collect-JSON ist unvollstaendig oder stammt aus einem alten Format ohne Vollstaendigkeitsnachweis. Nur mit allowIncompleteSource=true ist ein klar begrenzter Teilstandsabgleich erlaubt.'
        sourceHash=$sourceHashAfter; sourceVollstaendig=$sourceVollstaendig
        sourceStopKind=$(Arg $sourceDocument 'stopKind'); sourceStopReason=$(Arg $sourceDocument 'stopReason')
        seiten=$daten.Count
      })
    }

    $zahl = {
      param($s)
      if ($null -eq $s) { return $null }
      $x = "$s".Trim()
      $x = $x -replace '^(?:€|EUR)\s*', ''
      $x = $x -replace '\s*(?:€|EUR|%)$', ''
      ConvertTo-SSETableNumber $x
    }

    function Resolve-VerificationMatch($Items, [string]$Property, [string]$Needle, $Occurrence) {
      $all = @($Items)
      $exact = @($all | Where-Object {
        $value = [string]$_.PSObject.Properties[$Property].Value
        [String]::Equals($value, $Needle, [StringComparison]::OrdinalIgnoreCase)
      })
      if ($exact.Count) {
        $matches = @($exact)
        $mode = 'exact'
      } else {
        $matches = @($all | Where-Object {
          $value = [string]$_.PSObject.Properties[$Property].Value
          $value.IndexOf($Needle, [StringComparison]::OrdinalIgnoreCase) -ge 0
        })
        $mode = 'substring'
      }
      $names = @($matches | ForEach-Object { [string]$_.PSObject.Properties[$Property].Value })
      if (-not $matches.Count) {
        return [pscustomobject]@{ ok=$false; kind='missing'; mode=$mode; count=0; item=$null; candidates=@() }
      }
      $occ = $(if ($null -ne $Occurrence) { [int]$Occurrence } else { 0 })
      if ($occ) {
        if ($occ -lt 1 -or $occ -gt $matches.Count) {
          return [pscustomobject]@{ ok=$false; kind='occurrence-out-of-range'; mode=$mode; count=$matches.Count; item=$null; candidates=$names }
        }
        return [pscustomobject]@{ ok=$true; kind='matched'; mode="$mode-occurrence"; count=$matches.Count; item=$matches[$occ - 1]; candidates=$names }
      }
      if ($matches.Count -ne 1) {
        return [pscustomobject]@{ ok=$false; kind='ambiguous'; mode=$mode; count=$matches.Count; item=$null; candidates=$names }
      }
      [pscustomobject]@{ ok=$true; kind='matched'; mode=$mode; count=1; item=$matches[0]; candidates=$names }
    }

    $ergebnis = New-Object System.Collections.ArrayList
    foreach ($e in $erw) {
      $sName = [string]$e.seite; $lName = [string]$e.label; $soll = [string]$e.wert
      if (-not $sName.Trim() -or -not $lName.Trim()) {
        $null = $ergebnis.Add([pscustomobject]@{ seite=$sName; label=$lName; soll=$soll; ist=$null; status='Ungueltige Erwartung' })
        continue
      }
      $pageMatch = Resolve-VerificationMatch $daten 'ueberschrift' $sName (Arg $e 'seiteOccurrence')
      if (-not $pageMatch.ok) {
        $status = $(switch ($pageMatch.kind) {
          'missing' { 'Seite fehlt' }
          'ambiguous' { 'Seite mehrdeutig' }
          default { 'Seiten-Occurrence ungueltig' }
        })
        $null = $ergebnis.Add([pscustomobject]@{
          seite=$sName; label=$lName; soll=$soll; ist=$null; status=$status
          matchMode=$pageMatch.mode; treffer=$pageMatch.count; kandidaten=$pageMatch.candidates
        })
        continue
      }
      $seite = $pageMatch.item
      $fieldMatch = Resolve-VerificationMatch @($seite.felder) 'label' $lName (Arg $e 'labelOccurrence')
      if (-not $fieldMatch.ok) {
        $status = $(switch ($fieldMatch.kind) {
          'missing' { 'Feld fehlt' }
          'ambiguous' { 'Feld mehrdeutig' }
          default { 'Feld-Occurrence ungueltig' }
        })
        $null = $ergebnis.Add([pscustomobject]@{
          seite=$seite.ueberschrift; label=$lName; soll=$soll; ist=$null; status=$status
          pageMatchMode=$pageMatch.mode; matchMode=$fieldMatch.mode
          treffer=$fieldMatch.count; kandidaten=$fieldMatch.candidates
        })
        continue
      }
      $feld = $fieldMatch.item
      $a1 = & $zahl $feld.wert; $a2 = & $zahl $soll
      $gleich = $(if ($null -ne $a1 -and $null -ne $a2) { $a1 -eq $a2 } else { "$($feld.wert)".Trim() -eq $soll.Trim() })
      $null = $ergebnis.Add([pscustomobject]@{
        seite = $seite.ueberschrift; label = $feld.label; soll = $soll; ist = $feld.wert
        differenz = $(if ($null -ne $a1 -and $null -ne $a2) { [Math]::Round($a1 - $a2, 2) } else { $null })
        pageMatchMode=$pageMatch.mode; matchMode=$fieldMatch.mode
        status = $(if ($gleich) { 'stimmt' } else { 'ABWEICHUNG' })
      })
    }
    $abw = @($ergebnis | Where-Object { $_.status -ne 'stimmt' })
    Emit ([pscustomobject]@{
      ok=$true; vergleichOk=($abw.Count -eq 0)
      sourceHash=$sourceHashAfter; sourceVollstaendig=$sourceVollstaendig
      sourceStopKind=$(Arg $sourceDocument 'stopKind'); sourceStopReason=$(Arg $sourceDocument 'stopReason')
      geprueft=$ergebnis.Count; abweichungen=$abw.Count; ergebnis=@($ergebnis)
      zusammenfassung=$(
        if ($abw.Count) {
          "$($abw.Count) von $($ergebnis.Count) Erwartungen weichen ab oder sind nicht eindeutig zugeordnet."
        } elseif ($sourceVollstaendig -eq $true) {
          "Alle $($ergebnis.Count) Erwartungen stimmen im vollstaendigen Collect-Stand."
        } else {
          "Alle $($ergebnis.Count) Erwartungen stimmen im bewusst unvollstaendigen Teilstand; keine Gesamtaussage zur Erklaerung."
        }
      )
    })
  }

  'goto_tree' {
    # AELTERE Fassung: springt den Zweig ueber den Navigationsbaum an.
    # Das braucht einen ECHTEN Mausklick und holt damit das Fenster nach
    # vorn - stoerend, wenn der Nutzer daneben arbeitet. Bleibt als
    # Rueckfall erhalten; die Vorgabe ist das fokusfreie 'goto'.
    #
    # Warum das nicht trivial ist:
    #  - Der Navigationsbaum laesst sich nicht vollstaendig aufzaehlen (der
    #    ausgewaehlte Knoten wiederholt sich, alles darunter ist unsichtbar).
    #  - Uebersichtsseiten haben gar kein "Weiter", sie fuehren ueber Verweise.
    #  - "Gewinnermittlung beginnen" ist eine Sackgasse ohne beide Schalter.
    # Deshalb: erst den passenden Zweig ueber den Baum anspringen (echter
    # Klick, UIA-Invoke navigiert dort nicht), dann von dort blaettern.
    $ziel = [string](Arg $a 'name')
    if (-not $ziel) { Fail 'name fehlt (Ueberschrift der gewuenschten Seite)' 'bad-args' }
    $hwnd = [IntPtr][int64](Resolve-SSEMainWindowDescriptor $a -RestoreMinimized).hwnd
    if ($script:DESKTOP_NAME) {
      Fail ("Der Navigationsbaum braucht einen echten Mausklick und ist auf dem versteckten Desktop " +
            "'$($script:DESKTOP_NAME)' nicht bedienbar. sse_goto mit useSearch=false fuer den linearen " +
            "Blaetterpfad verwenden oder sichtbar arbeiten.") 'hidden-desktop'
    }

    # Zweig, unter dem eine Seite liegt. Aus der Kartierung der 78 Seiten.
    # Bewusst eine LISTE von Paaren statt [ordered]@{}: OrderedDictionary
    # erlaubt auch Ganzzahl-Indizes, dadurch wird $ANKER[$k] mehrdeutig und
    # liefert null.
    # Zweig, unter dem eine Seite liegt. Aus der Kartierung der 78 Seiten.
    # Bewusst als switch -Wildcard statt als Datenliteral: eine verschachtelte
    # Liste von Hashtables kam in diesem Skript wiederholt als $null an, ohne
    # dass sich die Ursache eingrenzen liess. Ein switch ist unbestechlich.
    function Get-Zweig([string]$seite) {
      switch -Wildcard ($seite) {
        'Umsatzsteuerzahlungen*'          { return 'Einnahmen/Ausgaben' }
        '*Betriebseinnahmen*'             { return 'Einnahmen/Ausgaben' }
        'Erlöse*'                         { return 'Einnahmen/Ausgaben' }
        'Einnahmen:*'                     { return 'Einnahmen/Ausgaben' }
        'Kapitalerträge*'                 { return 'Einnahmen/Ausgaben' }
        'Private Nutzungen*'              { return 'Einnahmen/Ausgaben' }
        'Betriebsausgaben*'               { return 'Einnahmen/Ausgaben' }
        'Material-*'                      { return 'Einnahmen/Ausgaben' }
        'Fremdleistungen*'                { return 'Einnahmen/Ausgaben' }
        'Personalkosten*'                 { return 'Einnahmen/Ausgaben' }
        'Abschreibung*'                   { return 'Einnahmen/Ausgaben' }
        'Investitionsabzugs*'             { return 'Einnahmen/Ausgaben' }
        'Raum- und Grundstücks*'          { return 'Einnahmen/Ausgaben' }
        'Arbeitszimmer*'                  { return 'Einnahmen/Ausgaben' }
        '*Arbeitszimmer*'                 { return 'Einnahmen/Ausgaben' }
        'Schuldzinsen*'                   { return 'Einnahmen/Ausgaben' }
        'Beiträge, Gebühren*'             { return 'Einnahmen/Ausgaben' }
        'Versicherungen*'                 { return 'Einnahmen/Ausgaben' }
        'Reisekosten*'                    { return 'Einnahmen/Ausgaben' }
        '*. Reise*'                       { return 'Einnahmen/Ausgaben' }
        'Geschenke*'                      { return 'Einnahmen/Ausgaben' }
        'Bewirtungskosten*'               { return 'Einnahmen/Ausgaben' }
        'Wege zum Betrieb*'               { return 'Einnahmen/Ausgaben' }
        'Portokosten*'                    { return 'Einnahmen/Ausgaben' }
        'Telefon*'                        { return 'Einnahmen/Ausgaben' }
        'Bürobedarf*'                     { return 'Einnahmen/Ausgaben' }
        'Fachliteratur*'                  { return 'Einnahmen/Ausgaben' }
        'Fortbildungskosten*'             { return 'Einnahmen/Ausgaben' }
        'Rechts- und Beratung*'           { return 'Einnahmen/Ausgaben' }
        'Miete/*'                         { return 'Einnahmen/Ausgaben' }
        'Werbung*'                        { return 'Einnahmen/Ausgaben' }
        'Sonstige Betriebsausgaben*'      { return 'Einnahmen/Ausgaben' }
        'Werkzeuge*'                      { return 'Einnahmen/Ausgaben' }
        'EDV-Kosten*'                     { return 'Einnahmen/Ausgaben' }
        'Vorsteuer (Übersicht)*'          { return 'Einnahmen/Ausgaben' }
        'Sonstige Vorsteuer*'             { return 'Einnahmen/Ausgaben' }
        'Journal und BWA*'                { return 'Einnahmen/Ausgaben' }
        'Zusatzangaben*'                  { return 'Einnahmen/Ausgaben' }
        'Entnahmen*'                      { return 'Einnahmen/Ausgaben' }
        'Unberechtigt*'                   { return 'Einnahmen/Ausgaben' }
        'Umsatzsteuererklärung*'          { return "Umsatzsteuererklärung $($script:SSE_TAX_YEAR)" }
        'Lieferungen/*'                   { return "Umsatzsteuererklärung $($script:SSE_TAX_YEAR)" }
        'Unentgeltliche*'                 { return "Umsatzsteuererklärung $($script:SSE_TAX_YEAR)" }
        'Umsätze zu anderen*'             { return "Umsatzsteuererklärung $($script:SSE_TAX_YEAR)" }
        'Warenbezug*'                     { return "Umsatzsteuererklärung $($script:SSE_TAX_YEAR)" }
        'Steuerschuldner nach*'           { return "Umsatzsteuererklärung $($script:SSE_TAX_YEAR)" }
        'Abziehbare Vorsteuer*'           { return "Umsatzsteuererklärung $($script:SSE_TAX_YEAR)" }
        'Vorsteuer aus anderen*'          { return "Umsatzsteuererklärung $($script:SSE_TAX_YEAR)" }
        'Vorsteuerberichtigung*'          { return "Umsatzsteuererklärung $($script:SSE_TAX_YEAR)" }
        'Steuerfreie Umsätze*'            { return "Umsatzsteuererklärung $($script:SSE_TAX_YEAR)" }
        'Meldepflichtige*'                { return "Umsatzsteuererklärung $($script:SSE_TAX_YEAR)" }
        'Umsatzsteuer-Voranmeldung*'      { return "Umsatzsteuer-Voranmeldungen $($script:SSE_TAX_YEAR)" }
        'Weitere Erlöse*'                 { return "Umsatzsteuer-Voranmeldungen $($script:SSE_TAX_YEAR)" }
        'Weitere Umsätze*'                { return "Umsatzsteuer-Voranmeldungen $($script:SSE_TAX_YEAR)" }
        'Steuerschuldnerschaft*'          { return "Umsatzsteuer-Voranmeldungen $($script:SSE_TAX_YEAR)" }
        'Allgemeine Angaben*'             { return 'Allgemeine Angaben zum Unternehmen' }
        'Fahrzeug*'                       { return 'Fahrzeuge' }
        'ELSTER-Anmeldeinformation*'      { return 'Voreinstellungen und ELSTER-Anmeldeinformation' }
        'Beginn der Datenbearbeitung*'    { return 'Voreinstellungen und ELSTER-Anmeldeinformation' }
        'Detailerfassung*'                { return 'Voreinstellungen und ELSTER-Anmeldeinformation' }
        'Meine Steuerdokumente*'          { return 'Meine Steuerdokumente' }
        default                           { return $seite }
      }
    }

    function Ueberschrift([IntPtr]$h) {
      $t = Walk-BoundTree $h 1200
      $b = Get-ContentBounds $t $h
      (Get-SSEHeading $t $b $h).text
    }
    function Passt($ist, $soll) {
      if (-not $ist) { return $false }
      ($ist -eq $soll) -or ($ist -like "*$soll*") -or ($soll -like "*$ist*")
    }

    $weg = New-Object System.Collections.ArrayList
    $jetzt = Ueberschrift $hwnd
    $null = $weg.Add("Start: $jetzt")

    # --- Weg 1: Suchfunktion. Bevorzugt, weil FOKUSFREI und eindeutig. ------
    # Das Suchfeld nimmt seinen Wert ueber ValuePattern an, ohne dass das
    # Fenster nach vorn muss. Nur die Eingabetaste braucht Fokus - deshalb
    # wird stattdessen der Lupenknopf ueber UIA ausgeloest, wenn es ihn gibt.
    # Baumklicks bleiben der Rueckfallweg: sie raten Koordinaten, und die
    # verschieben sich, sobald sich Zweige auf- oder zuklappen.
    if ((Arg $a 'viaSuche') -ne $false) {
      $ts = Walk-Tree $hwnd 1500
      $feld = @($ts.nodes | Where-Object { $_.type -eq 'Edit' -and $_.aid -match 'SearchSSE' })[0]
      if ($feld) {
        $el = Get-LiveElement $hwnd $feld.rid
        $vp = $null
        if ($el -and $el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
          $vp.SetValue($ziel)
          Start-Sleep -Milliseconds 500
          # Lupe auslösen - der Knopf liegt rechts neben dem Feld
          $lupe = @($ts.nodes | Where-Object { $_.type -eq 'Button' -and -not $_.name -and
                                               $_.y -ge ($feld.y - 12) -and $_.y -le ($feld.y + 12) -and
                                               $_.x -gt $feld.x })[0]
          $ausgeloest = $false
          if ($lupe) {
            $le = Get-LiveElement $hwnd $lupe.rid
            if ($le) {
              try { $le.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); $ausgeloest = $true } catch { }
            }
          }
          Start-Sleep -Milliseconds 1800
          $null = $weg.Add("Suche nach '$ziel' gesetzt$(if($ausgeloest){' und ausgeloest'}else{' (Lupe nicht ausloesbar)'})")

          # Trefferliste: Eintraege stehen als DataItem oberhalb des Arbeitsbereichs
          $tt = Walk-Tree $hwnd
          $bb = Get-ContentBounds $tt $hwnd
          $rr = New-Object SW+RC; [SW]::GetWindowRect($hwnd, [ref]$rr) | Out-Null
          $treffer = @($tt.nodes | Where-Object {
            $_.type -eq 'DataItem' -and $_.name -and $_.y -lt ($rr.T + 420) -and $_.x -lt $bb.maxX
          } | Sort-Object y)
          $genau = @($treffer | Where-Object { $_.name -eq $ziel })[0]
          if (-not $genau) { $genau = @($treffer | Where-Object { $_.name -like "*$ziel*" })[0] }
          if ($genau) {
            $null = $weg.Add("Treffer gefunden: '$($genau.name)'")
            # Aktivieren: erst SelectionItem/Invoke ohne Fokus versuchen
            $ge = Get-LiveElement $hwnd $genau.rid
            $ok2 = $false
            foreach ($pat in @('Invoke','SelectionItem')) {
              if ($ok2 -or -not $ge) { continue }
              try {
                if ($pat -eq 'Invoke') { $ge.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
                else { $ge.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select() }
                Start-Sleep -Milliseconds 1400
                if (Passt (Ueberschrift $hwnd) $ziel) { $ok2 = $true }
              } catch { }
            }
            if ($ok2) {
              $null = $weg.Add('ueber die Suche angesprungen (ohne Fokus)')
              # Trefferliste schliessen, sie ueberlagert sonst den Arbeitsbereich
              $zu = Find-Node (Walk-Tree $hwnd 1200) 'Suche schließen'
              if ($zu) { $ze = Get-LiveElement $hwnd $zu.rid; if ($ze) { try { $ze.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch { } } }
              Emit ([pscustomobject]@{ ok = $true; erreicht = $true; ueberschrift = (Ueberschrift $hwnd); weg = @($weg); schritte = 1; methode = 'suche' })
            }
            $null = $weg.Add('Treffer liess sich ohne Fokus nicht aktivieren - Rueckfall auf Baumklick')
          } else {
            $null = $weg.Add('kein passender Treffer in der Liste')
          }
          # Suche wieder schliessen, bevor der Rueckfallweg beginnt
          $zu2 = Find-Node (Walk-Tree $hwnd 1200) 'Suche schließen'
          if ($zu2) { $z2 = Get-LiveElement $hwnd $zu2.rid; if ($z2) { try { $z2.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Milliseconds 600 } catch { } } }
          $jetzt = Ueberschrift $hwnd
        }
      }
    }
    if (Passt $jetzt $ziel) {
      Emit ([pscustomobject]@{ ok = $true; erreicht = $true; ueberschrift = $jetzt; weg = @($weg); schritte = 0 })
    }

    # 1. Passenden Zweig bestimmen und anspringen
    $anker = Get-Zweig $ziel
    $null = $weg.Add("Zweig laut Seitenkarte: $anker")

    $ankerNode = $null
    $t0 = Walk-Tree $hwnd
    foreach ($n in ($t0.nodes | Where-Object { $_.type -eq 'TreeItem' -and $_.name -and $_.w -gt 0 })) {
      if (Passt $n.name $anker) { $ankerNode = $n; break }
    }
    if ($ankerNode) {
      # Qt-TreeItems melden die ganze Zeilenbreite als Rechteck; deren Mitte
      # liegt häufig weit rechts vom Label und bewirkt nichts. Ein enger,
      # labelnaher Knoten wird unmittelbar vor dem Klick mit PID UND GA_ROOT
      # gegen genau dieses Hauptfenster verifiziert.
      $labelNode = [pscustomobject]@{
        x=$ankerNode.x; y=$ankerNode.y; w=[Math]::Min(100, [Math]::Max(20, $ankerNode.w)); h=$ankerNode.h
        name=$ankerNode.name; source='uia-treeitem'
      }
      $null = Click-VerifiedPoint $hwnd $labelNode
      Start-Sleep -Milliseconds 1500
      $null = $weg.Add("Zweig angesprungen: $($ankerNode.name)")
      $jetzt = Ueberschrift $hwnd
      $null = $weg.Add("nach Zweigklick: $jetzt")
      if (Passt $jetzt $ziel) {
        Emit ([pscustomobject]@{ ok = $true; erreicht = $true; ueberschrift = $jetzt; weg = @($weg); schritte = 1 })
      }
    } else {
      $null = $weg.Add("Zweig '$anker' nicht im Baum sichtbar")
    }

    # 2. Von hier aus blaettern
    $max = [int](Arg $a 'maxSteps' 40)
    $vorher = $jetzt
    for ($i = 1; $i -le $max; $i++) {
      $wtr = Find-Node (Walk-Tree $hwnd 1200) 'Weiter'
      if (-not $wtr) { $null = $weg.Add("kein 'Weiter' auf '$jetzt' - Sackgasse"); break }
      $el = Get-LiveElement $hwnd $wtr.rid
      if (-not $el) { break }
      try { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch { break }
      Start-Sleep -Milliseconds 1000
      $jetzt = Ueberschrift $hwnd
      $null = $weg.Add("$i. $jetzt")
      if (Passt $jetzt $ziel) {
        Emit ([pscustomobject]@{ ok = $true; erreicht = $true; ueberschrift = $jetzt; weg = @($weg); schritte = $i })
      }
      if ($jetzt -eq $vorher) {
        # Seite wechselt nicht -> gesperrt oder Sackgasse
        $wins = @(Get-Windows 'SSE')
        $null = $weg.Add("Seite wechselt nicht (offene Fenster: $($wins.Count))")
        break
      }
      $vorher = $jetzt
    }

    Emit ([pscustomobject]@{
      ok = $false; kind = 'not-reached'; erreicht = $false
      error = "Seite '$ziel' nicht erreicht. Aktuell: '$jetzt'."
      ueberschrift = $jetzt; weg = @($weg)
      hinweis = 'Mit sse_ui_state pruefen, ob eine Sperre vorliegt, oder den Zweig mit sse_click_point selbst anspringen.'
    })
  }

  'help' {
    # Die rechte Spalte lesen: Eingabehilfe, Steuertipps, Prueferhinweise.
    # Dort steht, WIE ein Feld gemeint ist - fuer korrektes Ausfuellen oft
    # wichtiger als der Feldname. Braucht weder Tastatur noch Maus, laeuft
    # also auch auf dem versteckten Desktop.
    $hwnd = Resolve-Window $a
    $t = Walk-Tree $hwnd -WithValues
    $b = Get-ContentBounds $t $hwnd
    $rechts = @($t.nodes | Where-Object { $_.x -gt $b.maxX -and $_.name } | Sort-Object y, x)

    # Die Spalte gliedert sich in Abschnitte, erkennbar an ihren Ueberschriften.
    $abschnitte = [ordered]@{}
    $aktuell = 'Allgemein'
    foreach ($n in $rechts) {
      if ($n.name -in @('Eingabehilfe', 'Steuertipps', 'Prüfer', 'Steuer-Spar-Tipps')) {
        $aktuell = $n.name
        if (-not $abschnitte.Contains($aktuell)) { $abschnitte[$aktuell] = New-Object System.Collections.ArrayList }
        continue
      }
      if ($n.name -in @('Mehr Details', 'Details')) { continue }
      if (-not $abschnitte.Contains($aktuell)) { $abschnitte[$aktuell] = New-Object System.Collections.ArrayList }
      $null = $abschnitte[$aktuell].Add([pscustomobject]@{ typ = $n.type; text = $n.name })
    }
    $ausgabe = [ordered]@{}
    foreach ($k in $abschnitte.Keys) {
      $texte = @($abschnitte[$k] | Where-Object { $_.typ -in @('Text','Hyperlink','TreeItem','Button') } | ForEach-Object { $_.text })
      $verweise = @($abschnitte[$k] | Where-Object { $_.typ -eq 'Hyperlink' } | ForEach-Object { $_.text })
      $ausgabe[$k] = [pscustomobject]@{ text = ($texte -join ' '); zeilen = $texte; verweise = $verweise }
    }
    $ueberschrift = ($t.nodes | Where-Object { $_.type -eq 'Text' -and $_.x -ge $b.minX -and $_.x -le $b.maxX } |
                     Sort-Object y | Select-Object -First 1).name
    Emit ([pscustomobject]@{ ok = $true; seite = $ueberschrift; abschnitte = $ausgabe
      hinweis = 'Die Hilfe wechselt mit dem angewaehlten Feld. Fuer feldbezogene Hilfe erst das Feld anwaehlen.' })
  }

  'scroll_page' {
    # Den INHALTSBEREICH rollen (nicht Tabellen - dafuer table_read).
    # Lange Seiten wie 'Umsatzsteuererklaerung 2025' passen nicht auf den
    # Schirm; ohne Rollen fehlen Felder im Auslesen.
    $hwnd = Resolve-Window $a
    $t = Walk-Tree $hwnd -WithScroll
    $b = Get-ContentBounds $t $hwnd
    $kandidaten = @($t.nodes | Where-Object {
      $null -ne $_.scroll -and $_.scroll.vScrollable -and $_.x -ge ($b.minX - 60) -and $_.x -le $b.maxX
    } | Sort-Object { -($_.w * $_.h) })
    if (-not $kandidaten.Count) {
      Emit ([pscustomobject]@{ ok = $true; scrollbar = $false
        hinweis = 'Kein rollbarer Inhaltsbereich - die Seite passt vollstaendig auf den Schirm.' })
    }
    $ziel = $kandidaten[0]
    $modus = [string](Arg $a 'mode' 'percent')
    $el = Get-LiveElement $hwnd $ziel.rid
    if (-not $el) { Fail 'Rollbereich nicht mehr greifbar.' 'stale' }
    $sp = $el.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
    $vorher = $sp.Current.VerticalScrollPercent
    if ($modus -eq 'info') {
      Emit ([pscustomobject]@{ ok = $true; scrollbar = $true; position = $vorher
        sichtbarerAnteil = $sp.Current.VerticalViewSize; bereich = $ziel.name })
    }
    $noScroll = [System.Windows.Automation.ScrollPatternIdentifiers]::NoScroll
    if ($modus -eq 'amount') {
      $rtg = [string](Arg $a 'direction' 'down')
      $betrag = if ($rtg -eq 'up') { [System.Windows.Automation.ScrollAmount]::LargeDecrement }
                else { [System.Windows.Automation.ScrollAmount]::LargeIncrement }
      $sp.ScrollVertical($betrag)
    } else {
      $vp = [double](Arg $a 'vPercent' 100)
      $sp.SetScrollPercent($noScroll, $vp)
    }
    Start-Sleep -Milliseconds 450
    $nachher = $el.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern).Current.VerticalScrollPercent
    Emit ([pscustomobject]@{ ok = $true; scrollbar = $true; vorher = $vorher; nachher = $nachher
      bewegt = ($nachher -ne $vorher); bereich = $ziel.name
      hinweis = 'Danach sse_page erneut aufrufen - erst dann stehen die neu sichtbaren Felder im Baum.' })
  }

  'read_full' {
    # Seite VOLLSTAENDIG lesen: rollen, jeweils lesen, Zeilen vereinigen.
    # Qt haelt nur den sichtbaren Ausschnitt im Elementbaum; eine lange Seite
    # einmal zu lesen liefert also stillschweigend zu wenig.
    $hwnd = Resolve-Window $a
    $gesehen = New-Object 'System.Collections.Generic.HashSet[string]'
    $alle = New-Object System.Collections.ArrayList
    $ueberschrift = $null

    $lies = {
      $t = Walk-Tree $hwnd -WithValues
      $b = Get-ContentBounds $t $hwnd
      $r0 = New-Object SW+RC; [SW]::GetWindowRect($hwnd, [ref]$r0) | Out-Null
      if (-not $script:kopf) {
        $script:kopf = ($t.nodes | Where-Object { $_.type -eq 'Text' -and $_.x -ge $b.minX -and $_.x -le $b.maxX -and
                                                  $_.y -ge ($r0.T + 190) -and $_.y -le ($r0.T + 290) } |
                        Sort-Object y | Select-Object -First 1).name
      }
      $keep = @('Text','DataItem','Edit','CheckBox','Header','RadioButton','Button','Hyperlink','ComboBox')
      $reihen = @($t.nodes | Where-Object {
        ($_.name -or ($null -ne $_.val -and "$($_.val)".Trim())) -and
        $_.x -ge $b.minX -and $_.x -le $b.maxX -and $keep -contains $_.type
      } | Sort-Object y, x)

      # ZEILEN bilden, BEVOR zusammengefuehrt wird. Frueher wurden einzelne
      # Texte vereinigt - nach dem Rollen verschieben sich die Y-Werte, die
      # Zeilenzuordnung ging verloren, und ein Betrag stand drei Zeilen von
      # seiner Beschriftung entfernt. Fuer einen Abgleich unbrauchbar.
      $zellText = {
        param($n)
        $hatWert = ($null -ne $n.val -and "$($n.val)".Trim())
        if ($n.name -and $hatWert) { "$($n.name) = $($n.val)" }
        elseif ($hatWert)          { "$($n.val)" }
        else                       { $n.name }
      }
      $zeilen = New-Object System.Collections.ArrayList
      $cur = @(); $anker = $null
      foreach ($r in $reihen) {
        $gleich = $false
        if ($null -ne $anker) {
          if ([Math]::Abs($r.y - $anker.y) -le 12) { $gleich = $true }
          else {
            $ov = [Math]::Min($r.y + $r.h, $anker.y + $anker.h) - [Math]::Max($r.y, $anker.y)
            $mh = [Math]::Max(1, [Math]::Min($r.h, $anker.h))
            if ($ov -gt $mh / 2) { $gleich = $true }
          }
        }
        if ($cur.Count -and -not $gleich) {
          $null = $zeilen.Add([pscustomobject]@{ y = $anker.y; text = (($cur | ForEach-Object { & $zellText $_ }) -join '  ::  ') })
          $cur = @(); $anker = $null
        }
        if (-not $cur.Count) { $anker = $r }
        $cur += $r
      }
      if ($cur.Count) { $null = $zeilen.Add([pscustomobject]@{ y = $anker.y; text = (($cur | ForEach-Object { & $zellText $_ }) -join '  ::  ') }) }

      # Erst jetzt vereinigen - je ZEILE, nicht je Zelle.
      $neu = 0
      foreach ($z in $zeilen) {
        if (-not $z.text.Trim()) { continue }
        if ($gesehen.Add($z.text)) { $null = $alle.Add($z); $neu++ }
      }
      $neu
    }

    $script:kopf = $null
    $null = & $lies
    # Rollbereich suchen und in Stufen durchgehen
    $t0 = Walk-Tree $hwnd -WithScroll
    $b0 = Get-ContentBounds $t0 $hwnd
    $roll = @($t0.nodes | Where-Object { $null -ne $_.scroll -and $_.scroll.vScrollable -and
                                         $_.x -ge ($b0.minX - 60) -and $_.x -le $b0.maxX } |
              Sort-Object { -($_.w * $_.h) })[0]
    $stufen = 0
    if ($roll) {
      foreach ($p in 20, 40, 60, 80, 100) {
        $el = Get-LiveElement $hwnd $roll.rid
        if (-not $el) { break }
        try {
          $sp = $el.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
          $sp.SetScrollPercent([System.Windows.Automation.ScrollPatternIdentifiers]::NoScroll, [double]$p)
        } catch { break }
        Start-Sleep -Milliseconds 420
        $stufen++
        $null = & $lies
      }
      # wieder nach oben, damit die Seite fuer den naechsten Zugriff normal steht
      try {
        $el = Get-LiveElement $hwnd $roll.rid
        if ($el) { $el.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern).SetScrollPercent(
          [System.Windows.Automation.ScrollPatternIdentifiers]::NoScroll, 0.0) }
      } catch { }
    }
    Emit ([pscustomobject]@{
      ok = $true; ueberschrift = $script:kopf; gerollt = [bool]$roll; stufen = $stufen
      anzahl = $alle.Count
      zeilen = @($alle | Sort-Object y | ForEach-Object { $_.text })
      hinweis = $(if ($roll) { "Seite wurde in $stufen Stufen gerollt und zusammengefuegt." }
                  else { 'Seite passt auf den Schirm, kein Rollen noetig.' })
    })
  }

  'subpages' {
    # 'Erfassen'-Verweise fuehren zu Unterseiten mit den Detailangaben.
    # Sie sind ECHTE Schaltflaechen, also per InvokePattern erreichbar -
    # damit auch auf dem versteckten Desktop.
    $hwnd = Resolve-Window $a
    $t = Walk-Tree $hwnd -WithValues
    $b = Get-ContentBounds $t $hwnd
    $pageNodes = @($t.nodes | Where-Object {
      $_.aid -like '*.RedThreadContent.*' -and $_.x -ge $b.minX -and $_.x -le $b.maxX
    })
    $texte = @($pageNodes | Where-Object { $_.type -eq 'Text' -and $_.name })
    $werte = @($pageNodes | Where-Object { $_.type -eq 'Edit' })
    # Manche offizielle SSE-Uebersichtszeilen besitzen rechts nur einen
    # unbeschrifteten Button. Caption, schreibgeschuetzter Summenwert und Button
    # sind dann direkte Kinder derselben UIA-Gruppe. Diese Struktur ist stabiler
    # als ein privater oder fachlicher Seitenname und entspricht einem Page
    # Object fuer den Qt-Komponententyp.
    $knoepfe = @($pageNodes | Where-Object {
      ($_.type -eq 'Button' -and ($_.name -or $_.aid -like '*.Button')) -or
      ($_.type -eq 'Hyperlink' -and $_.name)
    } | Where-Object { $_.name -notin @('Zurück','Weiter') } |
      Sort-Object y, @{ Expression = { if ($_.type -eq 'Hyperlink') { 0 } else { 1 } } }, x)
    $liste = New-Object System.Collections.ArrayList
    $gesehenUnterseiten = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($k in $knoepfe) {
      if (Test-Versand $k.name) { continue }
      # Zuerst die direkte Geschwister-Caption nehmen; nur fuer alte Seiten
      # ohne Parent-Information geometrisch auf dieselbe Zeile zurueckfallen.
      $captionNode = @($texte | Where-Object { $_.p -eq $k.p } | Sort-Object x | Select-Object -First 1)
      if (-not $captionNode.Count) {
        $captionNode = @($texte | Where-Object { [Math]::Abs($_.y - $k.y) -le 14 -and $_.x -lt $k.x } |
          Sort-Object { $k.x - $_.x } | Select-Object -First 1)
      }
      $wozu = $(if ($captionNode.Count) { $captionNode[0].name } else { $null })
      $valueNode = @($werte | Where-Object { $_.p -eq $k.p } | Sort-Object x | Select-Object -First 1)
      $displayName = $(if ($k.name) { $k.name } else { 'Öffnen' })
      # Ein sichtbarer Qt-Unterseitenlink und sein Invoke-Button koennen exakt
      # dieselbe Aktion repraesentieren. Nicht zwei scheinbar gleichwertige
      # Wege melden: nach der Sortierung bleibt der verifizierbare Hyperlink.
      $dedupeKey = "$displayName|$wozu|$($k.y)"
      if (-not $gesehenUnterseiten.Add($dedupeKey)) { continue }
      $null = $liste.Add([pscustomobject]@{
        schalter = $displayName; fuehrt_zu = $wozu
        wert = $(if ($valueNode.Count) { $valueNode[0].val } else { $null })
        typ = $k.type; aktiviert = [bool]$k.on; aid = $k.aid; rid = $k.rid; y = $k.y
        werkzeug = $(if ($k.type -eq 'Button') { 'sse_click (rid)' } else { 'sse_click_point (nicht versteckt)' })
      })
    }
    Emit ([pscustomobject]@{ ok = $true; anzahl = $liste.Count; unterseiten = @($liste)
      hinweis = "Hyperlinks sind bei doppelt exponierten Qt-Unterseiten der bevorzugte, PID-/Root-verifizierte Weg per sse_click_point. Reine oder unbeschriftete Buttons per rid mit sse_click oeffnen. Zurueck ueber sse_click name='Zurück' oder den Verlaufspfeil (aid HistoryToolbarBtnSSE)." })
  }

  'check' {
    # Prueferlage der AKTUELLEN SEITE. Bewusst nicht 'verify' - so heisst
    # bereits der Abgleich gegen die Excel-Mappe, und PowerShell nimmt beim
    # switch den ersten Treffer.
    # Meldungen, leere Pflichtfelder,
    # Fehlermarkierungen im Navigationsbaum. Ergaenzt um den Ergebniswert.
    $hwnd = Resolve-Window $a
    $read = Read-CheckerComplete $hwnd
    $t = $read.tree
    $b = Get-ContentBounds $t $hwnd
    $r0 = New-Object SW+RC; [SW]::GetWindowRect($hwnd, [ref]$r0) | Out-Null
    $kopf = ($t.nodes | Where-Object { $_.type -eq 'Text' -and $_.x -ge $b.minX -and $_.x -le $b.maxX -and
                                       $_.y -ge ($r0.T + 190) -and $_.y -le ($r0.T + 290) } |
             Sort-Object y | Select-Object -First 1).name
    $pruefer = @($t.nodes | Where-Object { $_.type -eq 'TreeItem' -and $_.name -and $_.x -gt $b.maxX -and $_.name.Length -lt 120 } |
                ForEach-Object { $_.name } |
                Where-Object { $_ -notin @('Eingabehilfe','Steuertipps','Prüfer','Mehr Details','Zurzeit keine Hinweise zu diesem Dialog.') } | Select-Object -Unique)
    $checker = $read.result
    $checker | Add-Member -NotePropertyName konsistent -NotePropertyValue ([bool]$read.vollstaendig) -Force
    $baum = @($t.nodes | Where-Object {
                $_.type -eq 'TreeItem' -and $_.name -and $_.x -lt $b.minX -and $_.name -match '!\s*$' -and
                $_.aid -notlike '*PrueferWidgetSSE*'
              } |
              ForEach-Object { $_.name } | Select-Object -Unique)
    $pflicht = @($t.nodes | Where-Object { $_.type -eq 'ComboBox' -and $_.x -ge $b.minX -and $_.x -le $b.maxX -and
                                           (-not $_.val -or -not "$($_.val)".Trim()) })
    # Ergebnisanzeige unten rechts (Gewinn bzw. Erstattung)
    $ergebnis = @($t.nodes | Where-Object { $_.name -match '^-?[\d.]+,\d{2}\s*€?$' -and $_.y -gt ($r0.T + $r0.B - $r0.T - 200) } |
                  Sort-Object x | Select-Object -Last 1).name
    $beanstandungsfrei = ($pruefer.Count -eq 0 -and $baum.Count -eq 0 -and $pflicht.Count -eq 0)
    Emit ([pscustomobject]@{
      ok = $true
      beanstandungsfrei = $beanstandungsfrei
      seite = $kopf
      prueferMeldungen = $pruefer
      baumFehler = $baum
      leerePflichtfelder = @($pflicht | ForEach-Object { ($_.aid -split '\.')[-1] })
      ergebnisAnzeige = $ergebnis
      steuerpruefer = $checker
      urteil = $(if ($pruefer.Count -or $baum.Count -or $pflicht.Count) { 'Es liegen Beanstandungen vor.' } else { 'Keine Beanstandung auf dieser Seite.' })
    })
  }

  'desktop_start' {
    # SSE auf einem eigenen, unsichtbaren Desktop starten.
    $name = [string](Arg $a 'name' 'SSEAuto')
    $exe  = [string](Arg $a 'exe' $script:SSE_DEFAULT_EXE)
    $datei = [string](Arg $a 'file')
    $modus = [string](Arg $a 'mode' 'einur')
    $timeoutSec = [Math]::Max(3, [Math]::Min(90, [int](Arg $a 'timeoutSec' 30)))
    if (-not (Test-SSEDesktopName $name)) {
      Fail "Ungueltiger Desktopname '$name'. Erlaubt sind 1-64 ASCII-Buchstaben, Ziffern, _ und -." 'bad-args'
    }
    $null = Get-SSEStartModeType $modus
    $productIdentity = Assert-SSEExecutable $exe
    $caseIdentity = $(if ($datei) { Get-SSECaseIdentity $datei $modus } else { $null })

    # Einen laufenden oder unklar gebundenen Desktop niemals durch einen
    # zweiten Start uebernehmen. Ein nachweislich toter JSON-Marker darf nur
    # entfernt werden, wenn auf seinem Desktop kein SSE-Fenster mehr lebt.
    if (Test-Path -LiteralPath $script:DESKTOP_MARKE) {
      if (-not $script:DESKTOP_NAME -or -not $script:DESKTOP_PID) {
        Fail 'Desktop-Marker ist ungueltig oder stammt aus einem alten Nur-Name-Format; vor einem Neustart manuell pruefen.' 'stale-marker'
      }
      $markerProcess = Get-Process -Id $script:DESKTOP_PID -ErrorAction SilentlyContinue
      if ($markerProcess) {
        if (Test-SSEProcess $markerProcess) {
          Fail "Versteckte $($script:SSE_INSTANCE_LABEL)-Instanz $($script:DESKTOP_PID) ist bereits aktiv; zweiter Start verweigert." 'desktop-active'
        }
        Fail "Desktop-Marker verweist auf PID $($script:DESKTOP_PID), aber nicht auf eine verifizierte Instanz von '$($script:SSE_PROFILE.product)'; vor einem Neustart manuell pruefen." 'stale-marker'
      }
      $markerDesktop = [DSK]::OpenDesktop($script:DESKTOP_NAME, 0, $false, 0x10000000)
      if ($markerDesktop -ne [IntPtr]::Zero) {
        try { $markerWindows = @(Get-WindowsOnDesktop $markerDesktop 'SSE') }
        finally { [DSK]::CloseDesktop($markerDesktop) | Out-Null }
        if ($markerWindows.Count) {
          Fail "Desktop '$($script:DESKTOP_NAME)' enthaelt SSE-Fenster, die nicht mehr sicher an den Marker gebunden sind." 'desktop-occupied'
        }
      }
      Remove-Item -LiteralPath $script:DESKTOP_MARKE -Force
      $script:DESKTOP_NAME = $null
      $script:DESKTOP_PID = 0
    }

    $GENERIC_ALL = 0x10000000
    $preexistingDesktop = [DSK]::OpenDesktop($name, 0, $false, $GENERIC_ALL)
    if ($preexistingDesktop -ne [IntPtr]::Zero) {
      try { $preexistingWindows = @(Get-WindowsOnDesktop $preexistingDesktop 'SSE') }
      finally { [DSK]::CloseDesktop($preexistingDesktop) | Out-Null }
      Fail $(if ($preexistingWindows.Count) {
          "Desktop '$name' ist bereits durch eine SSE-Instanz belegt; Start verweigert."
        } else {
          "Desktop '$name' existiert bereits und wird nicht uebernommen; Start verweigert."
        }) 'desktop-occupied'
    }
    $d = [DSK]::CreateDesktop($name, [IntPtr]::Zero, [IntPtr]::Zero, 0, $GENERIC_ALL, [IntPtr]::Zero)
    if ($d -eq [IntPtr]::Zero) {
      Fail "Desktop '$name' liess sich nicht anlegen (Fehler $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))" 'desktop'
    }

    $si = New-Object DSK+SI
    $si.cb = [Runtime.InteropServices.Marshal]::SizeOf([type][DSK+SI])
    $si.desktop = "WinSta0\$name"
    # CreateProcess darf die Kommandozeile veraendern - ein .NET-String
    # scheitert daran mit Fehler 123. Deshalb StringBuilder.
    $cmd = New-Object Text.StringBuilder 2048
    $null = $cmd.Append('"' + $productIdentity.path + '"')
    $null = $cmd.Append(" -m$modus")
    if ($caseIdentity) { $null = $cmd.Append(' "' + $caseIdentity.path + '"') }
    $pi = New-Object DSK+PI
    $ok = [DSK]::CreateProcess($productIdentity.path, $cmd, [IntPtr]::Zero, [IntPtr]::Zero, $false, 0,
            [IntPtr]::Zero, (Split-Path $productIdentity.path -Parent), [ref]$si, [ref]$pi)
    if (-not $ok) {
      $launchError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      [DSK]::CloseDesktop($d) | Out-Null
      Fail "Start auf dem Desktop scheiterte (Fehler $launchError)" 'launch'
    }

    try {
      $gewartet = 0; $fenster = @(); $mainCandidates = @(); $startupDialogWindows = @()
      while ($gewartet -lt $timeoutSec) {
        Start-Sleep -Milliseconds 500; $gewartet += 0.5
        $fenster = @(Get-ExactProcessWindowsOnDesktop $d ([int]$pi.pid))
        # Windows PowerShell 5.1 unwraps a singleton emitted through $(if ...)
        # to a scalar PSCustomObject; its missing Count then looks exactly like
        # zero windows. Assign each branch as an explicit array instead.
        if ($caseIdentity) {
          $mainCandidates = @($fenster | Where-Object { $_.title -match 'SteuerSparErklärung' } |
            Sort-Object { $_.w * $_.h } -Descending)
        } else {
          $mainCandidates = @(Get-SSEMainWindowCandidates $fenster)
        }
        # Ein kompakter Startdialog kann den geladenen Fall blockieren. Er ist
        # kein Hauptfenster, muss aber nach gesetztem Eigentumsmarker gezielt
        # mit sse_dialog_list/sse_dialog_answer erreichbar bleiben.
        $startupDialogWindows = @($fenster | Where-Object {
          ($_.title -eq 'Steuerprogramm' -and $_.w -lt 900) -or
          ($_.title -and $_.title -notmatch 'SteuerSparErklärung|Steuer-Spar-Tipps' -and $_.title -ne 'Steuerprogramm')
        })
        if ($mainCandidates.Count -or $startupDialogWindows.Count) { break }
      }
      if (-not $mainCandidates.Count -and -not $startupDialogWindows.Count) {
        $timeoutHandles = @([DSK]::ListDesktopWindows($d))
        $timeoutExactWindows = @(Get-ExactProcessWindowsOnDesktop $d ([int]$pi.pid))
        $timeoutDetails = [pscustomobject]@{
          createProcessPid=[int]$pi.pid
          desktopHandleCount=$timeoutHandles.Count
          lastLoopWindows=@($fenster)
          lastMainCandidates=@($mainCandidates)
          lastStartupDialogs=@($startupDialogWindows)
          exactWindowsBeforeCleanup=@($timeoutExactWindows)
        }
        $cleanup = Complete-FailedDesktopStart $pi.hProcess $name ([int]$pi.pid)
        if ($cleanup.processStillRunning -or -not $cleanup.markerRemoved) {
          Emit ([pscustomobject]@{
            ok = $false; kind = 'startup-timeout-cleanup'
            error = "Neue SSE-PID $($pi.pid) erzeugte kein verifiziertes Fenster und konnte nicht vollstaendig aufgeraeumt werden."
            desktop = $name; pid = [int]$pi.pid; markerBeibehalten = $cleanup.markerWritten
            processStillRunning = $cleanup.processStillRunning; cleanupErrors = $cleanup.cleanupErrors
          })
        }
        Fail ("Neu gestartete SSE-PID $($pi.pid) erzeugte innerhalb von $gewartet Sekunden kein eigenes verifiziertes Fenster. " +
              "Der Prozessabbruch und Markerabbau wurden verifiziert; andere SSE-Fenster wurden nicht uebernommen.") 'startup-timeout' $timeoutDetails
      }
      $ownedPid = [int]$pi.pid
      @{ name = $name; pid = $ownedPid } | ConvertTo-Json -Compress |
        Set-Content -LiteralPath $script:DESKTOP_MARKE -Encoding UTF8
    } catch {
      $startupError = $_.Exception.Message
      $cleanup = Complete-FailedDesktopStart $pi.hProcess $name ([int]$pi.pid)
      if ($cleanup.processStillRunning -or -not $cleanup.markerRemoved) {
        Emit ([pscustomobject]@{
          ok = $false; kind = 'launch-cleanup'
          error = "Versteckter Start scheiterte und die neue PID $($pi.pid) konnte nicht vollstaendig aufgeraeumt werden: $startupError"
          desktop = $name; pid = [int]$pi.pid; markerBeibehalten = $cleanup.markerWritten
          processStillRunning = $cleanup.processStillRunning; cleanupErrors = $cleanup.cleanupErrors
        })
      }
      Fail "Versteckter Start konnte nicht eigentumssicher abgeschlossen werden; Prozessabbruch und Markerabbau fuer PID $($pi.pid) wurden verifiziert: $startupError" 'launch'
    } finally {
      if ($pi.hThread -ne [IntPtr]::Zero) { [DSK]::CloseHandle($pi.hThread) | Out-Null }
      if ($pi.hProcess -ne [IntPtr]::Zero) { [DSK]::CloseHandle($pi.hProcess) | Out-Null }
      [DSK]::CloseDesktop($d) | Out-Null
    }
    $instance = $(if ($mainCandidates.Count -eq 1) {
      [pscustomobject]@{
        pid=[int]$mainCandidates[0].pid; hwnd=[int64]$mainCandidates[0].hwnd
        title=[string]$mainCandidates[0].title; bindingMode='desktop-launch-window'
      }
    } else { $null })
    Emit ([pscustomobject]@{
      ok = $true; desktop = $name; pid = $ownedPid; startPid = $pi.pid; wartesekunden = $gewartet
      kommandozeile = $cmd.ToString(); fenster = $fenster; product=$productIdentity; case=$caseIdentity
      instance=$instance; ready=[bool]($null -ne $instance); blockedByDialog=[bool]($startupDialogWindows.Count)
      dialogWindows=$startupDialogWindows
      note = "SSE laeuft auf dem unsichtbaren Desktop '$name'. Fuer den Nutzer nicht sichtbar; alle Werkzeuge greifen normal darauf zu. Beenden mit sse_desktop_stop."
    })
  }

  'desktop_stop' {
    # SSE auf dem versteckten Desktop beenden und den Desktop schliessen.
    $save = ((Arg $a 'save') -eq $true)
    $discard = ((Arg $a 'discardChanges') -eq $true)
    if ($save -and $discard) { Fail 'save und discardChanges duerfen nicht gleichzeitig true sein.' 'bad-args' }
    if ($save) { Fail 'sse_desktop_stop speichert nicht ueber einen ungebundenen Schliessdialog. Zuerst sse_save mit expectedPath/expectedHashBefore hashgebunden ausfuehren, danach stoppen.' 'confirmation-required' }
    $beendet = $false
    $antwort = $null
    $antwortMethode = $null
    $dialogFehler = $null
    $gracefulWaitMs = 0
    $auxiliaryClosed = New-Object System.Collections.ArrayList
    $ownedPid = [int]$script:DESKTOP_PID
    if (-not $script:DESKTOP_NAME -or -not $ownedPid) {
      Fail 'Gueltige Desktop-Marke mit Name und PID fehlt; sichtbare SSE-Instanzen werden niemals ersatzweise uebernommen.' 'ownership'
    }
    $ownedProcess = Get-Process -Id $ownedPid -ErrorAction SilentlyContinue
    if (-not (Test-SSEProcess $ownedProcess)) {
      Fail "Markierte PID $ownedPid ist keine verifizierte Instanz von '$($script:SSE_PROFILE.product)'; nichts beendet und Marker beibehalten." 'ownership'
    }
    $desktopHandle = [DSK]::OpenDesktop($script:DESKTOP_NAME, 0, $false, 0x10000000)
    if ($desktopHandle -eq [IntPtr]::Zero) {
      Fail "Markierter Desktop '$($script:DESKTOP_NAME)' ist nicht mehr erreichbar; nichts beendet." 'ownership'
    }
    try { $desktopWins = @(Get-WindowsOnDesktop $desktopHandle 'SSE' | Where-Object { [int]$_.pid -eq $ownedPid }) }
    finally { [DSK]::CloseDesktop($desktopHandle) | Out-Null }
    if (-not $desktopWins.Count) {
      Fail "PID $ownedPid besitzt auf dem markierten Desktop '$($script:DESKTOP_NAME)' kein SSE-Fenster; nichts beendet." 'ownership'
    }
    $wins = @(Get-Windows 'SSE' | Where-Object { [int]$_.pid -eq $ownedPid })
    if (-not $wins.Count) {
      Fail "Gebundene SSE-Fenster sind im aktuellen Desktopkontext nicht sichtbar; nichts beendet." 'ownership'
    }
    if ($wins.Count) {
      $mainCandidates = @($wins | Where-Object { $_.w -ge 900 -and $_.h -ge 600 -and $_.title -match 'SteuerSparErklärung' })
      if ($mainCandidates.Count -ne 1) { Fail "Gebundene PID besitzt $($mainCandidates.Count) breite SSE-Hauptfenster; nichts beendet." 'ambiguous' }
      $main = $mainCandidates[0]
      $dirtyBeforeStop = Get-DirtyStateFast ([IntPtr][int64]$main.hwnd)
      if ($dirtyBeforeStop -eq $true -and -not $discard) {
        Emit ([pscustomobject]@{
          ok=$false; kind='confirmation-required'; error='Ungespeicherte Aenderungen erkannt. Zuerst sse_save mit expectedPath/expectedHashBefore hashgebunden ausfuehren oder explizit discardChanges=true verwenden; nichts geschlossen.'
          ungespeichert=$true; markerBeibehalten=$true; pid=$ownedPid
        })
      }
      if ($null -eq $dirtyBeforeStop -and -not $discard) {
        Emit ([pscustomobject]@{
          ok=$false; kind='state-unknown'; error='Aenderungszustand ist nicht sicher lesbar. Zuerst sse_save mit expectedPath/expectedHashBefore hashgebunden ausfuehren oder explizit discardChanges=true verwenden; nichts geschlossen.'
          ungespeichert=$null; markerBeibehalten=$true; pid=$ownedPid
        })
      }
      $describedBeforeClose = @($wins | ForEach-Object { Get-DialogDescriptor $_ ([IntPtr][int64]$main.hwnd) })
      $blockingDialogs = @($describedBeforeClose | Where-Object {
        $_.hwnd -ne [int64]$main.hwnd -and $_.kind -ne 'shadow' -and
        -not (Test-SSESafeAuxiliaryDescriptor $_) -and -not (Test-SSESystemOverlayDescriptor $_)
      })
      if ($blockingDialogs.Count) {
        Emit ([pscustomobject]@{
          ok = $false; kind = 'dialog-open'
          error = 'Vor dem Stop ist ein nicht automatisch schliessbarer Dialog offen; zuerst lesen und fingerprintgebunden beantworten.'
          dialogs = @($blockingDialogs | ForEach-Object {
            [pscustomobject]@{ hwnd=$_.hwnd; pid=$_.pid; title=$_.title; kind=$_.kind; buttons=$_.buttons; texts=$_.texts; fingerprint=$_.fingerprint }
          })
          markerBeibehalten = $true; pid = $ownedPid
        })
      }
      $safeAuxiliary = @($describedBeforeClose | Where-Object {
        $_.hwnd -ne [int64]$main.hwnd -and (Test-SSESafeAuxiliaryDescriptor $_)
      })
      foreach ($aux in $safeAuxiliary) {
        foreach ($probe in @($aux.title) + @($aux.texts) + @($aux.buttons | ForEach-Object { $_.name })) {
          if ($probe -and (Test-Versand $probe)) {
            Emit ([pscustomobject]@{
              ok = $false; kind = 'blocked'; error = "Hilfsfenster enthaelt Uebermittlungsbezug: '$probe'; nichts geschlossen."
              markerBeibehalten = $true; pid = $ownedPid
            })
          }
        }
        $auxResult = [IntPtr]::Zero
        [SW]::SendMessageTimeout([IntPtr][int64]$aux.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero, 0x0002, 3000, [ref]$auxResult) | Out-Null
        Start-Sleep -Milliseconds 350
        $closedBeforeMain = -not [SW]::IsWindow([IntPtr][int64]$aux.hwnd)
        $null = $auxiliaryClosed.Add([pscustomobject]@{
          hwnd = [int64]$aux.hwnd; title = $aux.title
          closedBeforeMain = $closedBeforeMain; closed = $closedBeforeMain
        })
      }
      $res = [IntPtr]::Zero
      [SW]::SendMessageTimeout([IntPtr][int64]$main.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero, 0x0002, 8000, [ref]$res) | Out-Null
      Start-Sleep -Milliseconds 1500
      for ($runde = 1; $runde -le 3; $runde++) {
        $offen = @(Get-Windows 'SSE' | Where-Object { [int]$_.pid -eq $ownedPid })
        if (-not $offen.Count) { break }
        $descriptors = @($offen | ForEach-Object { Get-DialogDescriptor $_ ([IntPtr][int64]$main.hwnd) } |
          Where-Object { $_.kind -in @('native-dialog','qt-dialog') })
        if (-not $descriptors.Count) { break }
        $answered = $false
        $wunsch = $(if ($discard) { @('Nein','Nicht speichern','Verwerfen') } else { @() })
        if (-not $wunsch.Count) { break }
        foreach ($dialog in $descriptors) {
          $hasBlockedContent = $false
          foreach ($probe in @($dialog.title) + @($dialog.texts) + @($dialog.buttons | ForEach-Object { $_.name })) {
            if ($probe -and (Test-Versand $probe)) { $hasBlockedContent = $true; break }
          }
          if ($hasBlockedContent) { continue }
          foreach ($w in $wunsch) {
            $treffer = @($dialog.buttons | Where-Object { $_.name -eq $w -and $_.enabled })
            if ($treffer.Count -gt 1) {
              $dialogFehler = "Mehrere aktive Schaltflaechen '$w' im Schliessdialog."
              break
            }
            if ($treffer.Count -eq 1) {
              try {
                $antwortMethode = Invoke-DialogButtonInfo $dialog $treffer[0]
                $antwort = $treffer[0].name
                $answered = $true
              } catch { $dialogFehler = $_.Exception.Message }
              break
            }
          }
          if ($answered -or $dialogFehler) { break }
        }
        if (-not $answered) { break }
        Start-Sleep -Milliseconds 1500
      }
    }
    while (-not $ownedProcess.HasExited -and $gracefulWaitMs -lt 12000) {
      Start-Sleep -Milliseconds 250
      $gracefulWaitMs += 250
    }
    if (-not $ownedProcess.HasExited -and ($dialogFehler -or -not $discard)) {
      Emit ([pscustomobject]@{
        ok = $false; kind = 'confirmation-required'
        error = $(if ($dialogFehler) { "Schliessdialog konnte nicht sicher beantwortet werden: $dialogFehler" }
                 else { 'SSE blieb offen oder zeigte unerwartet einen Speicherdialog; ohne discardChanges=true keine Antwort und kein Force-Kill.' })
        hartBeendet = $false; pid = $ownedPid; speichernAntwort = $antwort
        antwortMethode = $antwortMethode; markerBeibehalten = $true; gracefulWaitMs = $gracefulWaitMs
      })
    }
    if (-not $ownedProcess.HasExited -and $discard) {
      if (-not (Test-SSEProcess $ownedProcess)) {
        Emit ([pscustomobject]@{ ok=$false; kind='ownership'; error="Gebundenes Prozessobjekt ist nicht mehr die verifizierte Instanz von '$($script:SSE_PROFILE.product)'; kein Force-Kill."; markerBeibehalten=$true; pid=$ownedPid })
      }
      Stop-Process -InputObject $ownedProcess -Force -ErrorAction SilentlyContinue
      try { $ownedProcess.WaitForExit(5000) | Out-Null } catch { }
      $beendet = $true
    }
    if (-not $ownedProcess.HasExited) {
      Emit ([pscustomobject]@{ ok=$false; kind='still-running'; error='Gebundene SSE-Instanz laeuft nach dem Stopversuch weiter; Marker beibehalten.'; markerBeibehalten=$true; pid=$ownedPid })
    }
    # Ein nicht-modales Qt-Hilfsfenster kann WM_CLOSE erst zusammen mit dem
    # Hauptprozess abarbeiten. Den Zwischenstand nicht als endgueltigen
    # Fehlschlag konservieren, sondern nach dem nachweislichen Prozessende
    # jedes exakt gemerkte HWND noch einmal gegenpruefen.
    foreach ($auxStatus in $auxiliaryClosed) {
      if (-not $auxStatus.closed) {
        $auxStatus.closed = -not [SW]::IsWindow([IntPtr][int64]$auxStatus.hwnd)
      }
    }
    $markerError = $null
    try {
      if (Test-Path -LiteralPath $script:DESKTOP_MARKE) { Remove-Item -LiteralPath $script:DESKTOP_MARKE -Force }
    } catch { $markerError = $_.Exception.Message }
    $markerRemoved = -not (Test-Path -LiteralPath $script:DESKTOP_MARKE)
    if (-not $markerRemoved) {
      Emit ([pscustomobject]@{ ok=$false; kind='marker-cleanup'; error="SSE ist beendet, Desktop-Marker blieb bestehen: $markerError"; hartBeendet=$beendet; pid=$ownedPid; desktopMarkeEntfernt=$false })
    }
    Emit ([pscustomobject]@{ ok = $true; hartBeendet = $beendet; desktopMarkeEntfernt = $markerRemoved
      pid = $ownedPid; speichernAntwort = $antwort; antwortMethode = $antwortMethode
      dialogFehler = $dialogFehler; gracefulWaitMs = $gracefulWaitMs; discardChanges = $discard
      hilfsfenster = @($auxiliaryClosed)
      note = 'Der versteckte Desktop wird vom System aufgeraeumt, sobald kein Prozess mehr darauf laeuft.' })
  }

  'desktop_status' {
    $statusProcess = $(if ($script:DESKTOP_PID) { Get-Process -Id $script:DESKTOP_PID -ErrorAction SilentlyContinue } else { $null })
    $statusProcessIdentity = $(if ($statusProcess) { Get-SSEProcessIdentity $statusProcess } else { $null })
    $ownedRunning = [bool]($statusProcessIdentity -and $statusProcessIdentity.supported)
    $statusWindows = @(); $desktopReachable = $false
    if ($script:DESKTOP_NAME) {
      $statusDesktop = [DSK]::OpenDesktop($script:DESKTOP_NAME, 0, $false, 0x10000000)
      if ($statusDesktop -ne [IntPtr]::Zero) {
        $desktopReachable = $true
        try {
          $statusWindows = @(Get-WindowsOnDesktop $statusDesktop 'SSE' |
            Where-Object { [int]$_.pid -eq [int]$script:DESKTOP_PID })
        } finally { [DSK]::CloseDesktop($statusDesktop) | Out-Null }
      }
    }
    $markerPresent = Test-Path -LiteralPath $script:DESKTOP_MARKE
    Emit ([pscustomobject]@{
      ok = $true
      aktiv = [bool]($markerPresent -and $script:DESKTOP_NAME -and $script:DESKTOP_PID -and $ownedRunning -and $statusWindows.Count)
      desktop = $script:DESKTOP_NAME
      pid = $script:DESKTOP_PID
      sseLaeuft = $ownedRunning
      processIdentity = $statusProcessIdentity
      desktopErreichbar = $desktopReachable
      markeVeraltet = [bool]($markerPresent -and -not ($script:DESKTOP_NAME -and $script:DESKTOP_PID -and $ownedRunning -and $desktopReachable -and $statusWindows.Count))
      fenster = $statusWindows
      note = $(if ($script:DESKTOP_NAME) { "Status hat den markierten Desktop '$($script:DESKTOP_NAME)' explizit geoeffnet und nur PID $($script:DESKTOP_PID) geprueft." }
               else { 'Keine gueltige Desktopmarke geladen.' })
    })
  }

  'tree_top' {
    # Den virtualisierten Qt-Navigationsbaum an den Anfang rollen. UIA bietet
    # fuer diesen Baum kein ScrollPattern; deshalb wird ein Mausradereignis
    # exakt ueber einem aktuell sichtbaren TreeItem gesendet. Es wird nichts
    # aktiviert und keine Steuerangabe geaendert.
    $steps = Get-SSEBoundedIntegerArg $a 'steps' 40 1 80
    if ($script:DESKTOP_NAME) {
      Fail "Der Navigationsbaum kann auf dem versteckten Desktop nicht per Mausrad bewegt werden." 'hidden-desktop'
    }
    $hwnd = [IntPtr][int64](Resolve-SSEMainWindowDescriptor $a -RestoreMinimized).hwnd
    $t = Walk-Tree $hwnd 1800
    $items = @($t.nodes | Where-Object { $_.type -eq 'TreeItem' -and $_.on -and $_.w -gt 0 } | Sort-Object y)
    if (-not $items.Count) { Fail 'Kein sichtbarer Navigationsknoten gefunden.' 'not-found' }
    $anchor = $items[0]
    $px = [int]($anchor.x + [Math]::Min(80, $anchor.w / 2))
    $py = [int]($anchor.y + $anchor.h / 2)
    $null = Show-SSEWindow $hwnd
    Start-Sleep -Milliseconds 250
    $pt = New-Object SW+PT; $pt.X = $px; $pt.Y = $py
    $zp = 0; [SW]::GetWindowThreadProcessId($hwnd, [ref]$zp) | Out-Null
    $hitWindow = [SW]::WindowFromPoint($pt)
    $hitRoot = [SW]::GetAncestor($hitWindow, 2) # GA_ROOT
    $tp = 0; [SW]::GetWindowThreadProcessId($hitWindow, [ref]$tp) | Out-Null
    if ($tp -ne $zp -or [int64]$hitRoot -ne [int64]$hwnd) {
      Hide-SSETopmost $hwnd
      Fail "An Position $px,$py liegt nicht das gebundene Hauptfenster - Baum nicht gerollt." 'obstructed'
    }
    [SW]::SetCursorPos($px, $py) | Out-Null
    Start-Sleep -Milliseconds 100
    $MOUSEEVENTF_WHEEL = 0x0800
    for ($i = 0; $i -lt $steps; $i++) {
      [SW]::mouse_event($MOUSEEVENTF_WHEEL, 0, 0, 120, [IntPtr]::Zero)
    }
    Set-SSEForegroundLeaseInputCheckpoint (Get-SSELastInputTick) ([pscustomobject]@{ x=$px; y=$py })
    Start-Sleep -Milliseconds 700
    Hide-SSETopmost $hwnd
    $t2 = Walk-Tree $hwnd 1800
    $after = @($t2.nodes | Where-Object { $_.type -eq 'TreeItem' -and $_.on -and $_.w -gt 0 } | Sort-Object y)
    Emit ([pscustomobject]@{
      ok = $true; gerollt = 'oben'; schritte = $steps
      ersterKnoten = $(if ($after.Count) { $after[0].name } else { $null })
      sichtbareKnoten = @($after | Select-Object -First 15 | ForEach-Object { $_.name })
    })
  }

  'tree_scroll' {
    # Den virtualisierten Qt-Navigationsbaum kontrolliert nach oben oder unten
    # rollen. Der Baum bietet kein UIA-ScrollPattern; deshalb wird wie bei
    # tree_top ein echtes Mausradereignis ueber einem verifizierten TreeItem
    # verwendet. Es wird kein Knoten aktiviert.
    if ($script:DESKTOP_NAME) {
      Fail "Der Navigationsbaum kann auf dem versteckten Desktop nicht per Mausrad bewegt werden." 'hidden-desktop'
    }
    $richtung = [string](Arg $a 'direction' 'down')
    if ($richtung -notin @('up','down')) {
      Fail "direction muss 'up' oder 'down' sein." 'bad-args'
    }
    $steps = Get-SSEBoundedIntegerArg $a 'steps' 8 1 80
    $hwnd = [IntPtr][int64](Resolve-SSEMainWindowDescriptor $a -RestoreMinimized).hwnd
    $can = Test-Canary $hwnd
    if (-not $can.ok) { Fail "Kanarienvogel traege ($($can.ms) ms) - nicht rollen." 'degraded' }
    $t = Walk-Tree $hwnd 1800
    $items = @($t.nodes | Where-Object { $_.type -eq 'TreeItem' -and $_.on -and $_.w -gt 0 } | Sort-Object y)
    if (-not $items.Count) { Fail 'Kein sichtbarer Navigationsknoten gefunden.' 'not-found' }
    # Ein mittlerer sichtbarer Knoten ist auch dann ein stabiler Anker, wenn
    # der oberste oder unterste Eintrag nur teilweise sichtbar ist.
    $anchor = $items[[Math]::Floor($items.Count / 2)]
    $px = [int]($anchor.x + [Math]::Min(80, $anchor.w / 2))
    $py = [int]($anchor.y + $anchor.h / 2)
    $null = Show-SSEWindow $hwnd
    Start-Sleep -Milliseconds 250
    $pt = New-Object SW+PT; $pt.X = $px; $pt.Y = $py
    $zp = 0; [SW]::GetWindowThreadProcessId($hwnd, [ref]$zp) | Out-Null
    $hitWindow = [SW]::WindowFromPoint($pt)
    $hitRoot = [SW]::GetAncestor($hitWindow, 2) # GA_ROOT
    $tp = 0; [SW]::GetWindowThreadProcessId($hitWindow, [ref]$tp) | Out-Null
    if ($tp -ne $zp -or [int64]$hitRoot -ne [int64]$hwnd) {
      Hide-SSETopmost $hwnd
      Fail "An Position $px,$py liegt nicht das gebundene Hauptfenster - Baum nicht gerollt." 'obstructed'
    }
    $alt = New-Object SW+PT; [SW]::GetCursorPos([ref]$alt) | Out-Null
    [SW]::SetCursorPos($px, $py) | Out-Null
    Start-Sleep -Milliseconds 100
    $MOUSEEVENTF_WHEEL = 0x0800
    # mouse_event deklariert dwData als UInt32. Ein negativer WHEEL_DELTA
    # muss deshalb als Zweierkomplement uebergeben werden.
    $delta = $(if ($richtung -eq 'up') { [uint32]120 } else { [uint32]([int64]0x100000000 - 120) })
    for ($i = 0; $i -lt $steps; $i++) {
      [SW]::mouse_event($MOUSEEVENTF_WHEEL, 0, 0, $delta, [IntPtr]::Zero)
    }
    Start-Sleep -Milliseconds 700
    [SW]::SetCursorPos($alt.X, $alt.Y) | Out-Null
    Set-SSEForegroundLeaseInputCheckpoint (Get-SSELastInputTick) ([pscustomobject]@{ x=$alt.X; y=$alt.Y })
    Hide-SSETopmost $hwnd
    $t2 = Walk-Tree $hwnd 1800
    $after = @($t2.nodes | Where-Object { $_.type -eq 'TreeItem' -and $_.on -and $_.w -gt 0 } | Sort-Object y)
    Emit ([pscustomobject]@{
      ok = $true; gerollt = $richtung; schritte = $steps
      ersterKnoten = $(if ($after.Count) { $after[0].name } else { $null })
      letzterKnoten = $(if ($after.Count) { $after[-1].name } else { $null })
      sichtbareKnoten = @($after | Select-Object -First 30 | ForEach-Object { $_.name })
    })
  }

  'goto' {
    # Seite ueber ihre Ueberschrift ansteuern - AUSSCHLIESSLICH fokusfrei.
    #
    # Warum nicht ueber den Navigationsbaum: Qt verdrahtet dort weder
    # InvokePattern noch SelectionItemPattern mit der Aktivierung; nur ein
    # echter Mausklick wirkt, und der holt das Fenster nach vorn. Gemessen
    # und verworfen wurden ausserdem: PostMessage/SendMessage (Qt ignoriert
    # synthetische Mausnachrichten), SetFocus (stiehlt den Fokus UND
    # navigiert nicht) und die MSAA-Schnittstelle (Qt legt unterhalb der
    # Fensterwurzel nichts offen).
    #
    # Was fokusfrei WIRKT, ist Invoke auf echte Schaltflaechen:
    #   'Weiter' / 'Zurück'          - Blaetterpfad
    #   HistoryToolbarBtnSSE         - Verlauf zurueck/vor, entkommt Sackgassen
    # Darauf setzt dieses Werkzeug auf.
    $ziel = [string](Arg $a 'ziel')
    if (-not $ziel) { Fail 'ziel fehlt (Ueberschrift der gewuenschten Seite)' 'bad-args' }
    $requestedMaxSteps = $(if ($null -ne (Arg $a 'maxSteps')) {
      Get-SSEBoundedIntegerArg $a 'maxSteps' 40 1 200
    } else { $null })
    # Schrittzahl GESAMT, nicht je Richtung. Vorher waren es maxSteps pro
    # Richtung - bei 40 also 80 Seitenwechsel, die das Programm sichtbar
    # durch das ganze Formular blaettern liessen. Das ist fuer den Nutzer
    # unzumutbar, wenn er daneben arbeitet.
    $hwnd = [IntPtr][int64](Resolve-SSEMainWindowDescriptor $a -RestoreMinimized).hwnd
    $gotoPid = 0
    [SW]::GetWindowThreadProcessId($hwnd, [ref]$gotoPid) | Out-Null
    $verbraucht = 0

    # Bekannte Reihenfolge des Blaetterpfads (aus der Kartierung der 78 Seiten).
    # Damit laesst sich RICHTUNG und ENTFERNUNG berechnen, statt blind in beide
    # Richtungen zu laufen. Vorher scheiterte 'Umsatzsteuererklaerung 2025' von
    # 'Reisekosten' aus, weil 25 Schritte nicht reichten - es sind 26.
    $FOLGE = @(
      'Umsatzsteuerzahlungen/-Erstattungen','Übersicht Betriebseinnahmen','Erlöse Lieferungen/Leistungen',
      'Einnahmen: Freiberufler','Erlöse aus Anlagenverkäufen','Kapitalerträge und sonstige Einnahmen',
      'Private Nutzungen: Sonstiges','Unberechtigt ausgewiesene Umsatzsteuer','Betriebsausgaben',
      'Material-/Wareneinkauf','Innergem. Erwerb, § 13b UStG und Einfuhr','Fremdleistungen','Personalkosten',
      'Abschreibung','Wirtschaftsgüter des Anlagevermögen','Investitionsabzugsbeträge (IAB)',
      'Raum- und Grundstückskosten/Homeoffice','Arbeitszimmer/andere Arbeitsräume/Homeoffice',
      '1. Arbeitszimmer/Arbeitsraum/Homeoffice','Schuldzinsen','Beiträge, Gebühren und Abgaben',
      'Versicherungen (ohne Gebäude oder Kfz)','Reisekosten','1. Reise','Öffentliche Verkehrsmittel',
      '1. Reise: Verpflegung / Übernachtung','1. Reise: Übernachtung','Sonstige Kosten','Privatanteil Reisekosten',
      'Geschenke bis 50,- €','Bewirtungskosten','Wege zum Betrieb (Entfernungspauschale)','Portokosten',
      'Telefon/Mobilfunk/Internet','Bürobedarf','Fachliteratur','Fortbildungskosten','Rechts- und Beratungkosten',
      'Miete/Leasing beweglicher Wirtschaftsgüter','Werbung und Reklame','Sonstige Betriebsausgaben',
      'Werkzeuge und Kleingeräte','EDV-Kosten','Vorsteuer (Übersicht)','Sonstige Vorsteuerbeträge',
      'Betriebsausgaben: Eigene Positionen','Journal und BWA','Zusatzangaben zur Anlage EÜR','Entnahmen/Einlagen',
      "Umsatzsteuererklärung $($script:SSE_TAX_YEAR)",'Lieferungen/Leistungen zu 19%','Unentgeltliche Wertabgaben zu 19%',
      'Lieferungen/Leistungen zu 7%','Unentgeltliche Wertabgaben zu 7%','Umsätze zu anderen Steuersätzen',
      'Warenbezug von Unternehmen aus dem EU-Ausland','Steuerschuldner nach § 13b UStG','Abziehbare Vorsteuer',
      'Vorsteuer aus anderen Rechnungen',"Vorsteuerberichtigungen $($script:SSE_TAX_YEAR)",'Steuerfreie Umsätze',
      'Meldepflichtige oder nicht steuerbare Umsätze',"Umsatzsteuer-Voranmeldungen $($script:SSE_TAX_YEAR)",'Weitere Erlöse zu 19%',
      'Weitere Umsätze','Steuerschuldnerschaft nach § 13b UStG'
    )
    $iZiel = [array]::IndexOf($FOLGE, $ziel)

    function AktuelleUeberschrift {
      param([IntPtr]$h)
      # 400 Knoten genuegen: die Ueberschrift steht weit oben im Baum.
      $t = Walk-Tree $h 400
      $bb = Get-ContentBounds $t $h
      $rr = New-Object SW+RC; [SW]::GetWindowRect($h, [ref]$rr) | Out-Null
      ($t.nodes | Where-Object { $_.type -eq 'Text' -and $_.x -ge $bb.minX -and $_.x -le $bb.maxX -and
                                 $_.y -ge ($rr.T + 190) -and $_.y -le ($rr.T + 290) } |
       Sort-Object y | Select-Object -First 1).name
    }
    function WarteAufUeberschrift {
      param(
        [IntPtr]$h,
        [string]$vorher,
        [string]$erwartet,
        [int]$timeoutMs = 3000
      )
      # Qt bestaetigt den Doppelklick deutlich vor dem eigentlichen
      # Seitenaufbau. Ein einzelner Readback nach fester Wartezeit lieferte
      # deshalb leer, obwohl die Zielseite kurz danach sichtbar war. Polling
      # beendet sofort bei der Zielseite oder einer echten anderen Seite.
      $sw = [System.Diagnostics.Stopwatch]::StartNew()
      $letzte = $null
      do {
        $letzte = AktuelleUeberschrift $h
        if ($letzte -eq $erwartet -or ($letzte -and $letzte -ne $vorher)) {
          return $letzte
        }
        Start-Sleep -Milliseconds 200
      } while ($sw.ElapsedMilliseconds -lt $timeoutMs)
      return (AktuelleUeberschrift $h)
    }
    function DrueckeKnopf {
      param([IntPtr]$h, [string]$name, [string]$aid)
      # FindFirst statt Baumlauf: ~20 ms gegen ~2 s. Bei 25 Schritten macht
      # das den Unterschied zwischen 8 s und ueber einer Minute - vorher lief
      # goto deshalb in den Timeout.
      if ($name) {
        $root = $script:AE::FromHandle($h)
        # Name UND Typ: eine Suche nur ueber den Namen trifft auch das
        # Textelement 'Weiter' statt der Schaltflaeche - Invoke schlaegt dann
        # fehl und die Seite bleibt stehen.
        $cName = New-Object System.Windows.Automation.PropertyCondition($script:AE::NameProperty, $name)
        $cTyp  = New-Object System.Windows.Automation.PropertyCondition($script:AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
        $c = New-Object System.Windows.Automation.AndCondition($cName, $cTyp)
        $el = $null
        try { $el = $root.FindFirst($script:TS::Descendants, $c) } catch { return $false }
        if (-not $el) { return $false }
        # AKTIV pruefen: 'Zurueck' ist an Zweiggrenzen deaktiviert. Ohne das
        # klickt der Aufrufer dort endlos ins Leere, statt die Richtung zu wechseln.
        try { if (-not $el.Current.IsEnabled) { return $false } } catch { return $false }
        try { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Milliseconds 900; return $true }
        catch { return $false }
      }
      $t = Walk-Tree $h 1200
      $k = @($t.nodes | Where-Object { $_.aid -like "*$aid" -and $_.type -eq 'Button' -and $_.on })[0]
      if (-not $k) { return $false }
      $el = Get-LiveElement $h $k.rid
      if (-not $el) { return $false }
      try { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Milliseconds 900; return $true }
      catch { return $false }
    }

    $start = AktuelleUeberschrift $hwnd
    if ($start -eq $ziel) { Emit ([pscustomobject]@{ ok = $true; erreicht = $true; ueberschrift = $start; schritte = 0; weg = 'schon dort' }) }
    $weg = New-Object System.Collections.ArrayList
    $null = $weg.Add($start)

    # Vor dem linearen Blaettern die globale Suche versuchen. Das ist auf dem
    # versteckten Desktop besonders wichtig: Suchtreffer und Navigationsbaum
    # sind Qt-Items, deren Invoke-/SelectionItem-Pattern zwar Erfolg melden,
    # aber die Seite oft nicht aktivieren. Ohne belastbaren Seitenwechsel wird
    # der Treffer nie als Erfolg gewertet; dann bleibt nur der kontrollierte
    # lineare Pfad. Rohe gepostete Enter-Nachrichten sind gemessen ebenfalls
    # wirkungslos und gehoeren nicht in den Produktionspfad.
    if ((Arg $a 'viaSuche') -ne $false) {
      $ts = Walk-Tree $hwnd 1500
      $suchfeld = @($ts.nodes | Where-Object { $_.type -eq 'Edit' -and $_.aid -match 'SearchSSE' })[0]
      if ($suchfeld) {
        $se = Get-LiveElement $hwnd $suchfeld.rid
        $svp = $null
        if ($se -and $se.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$svp)) {
          $svp.SetValue($ziel)
          Start-Sleep -Milliseconds 350
          $lupe = @($ts.nodes | Where-Object { $_.type -eq 'Button' -and -not $_.name -and
                                               $_.y -ge ($suchfeld.y - 12) -and $_.y -le ($suchfeld.y + 12) -and
                                               $_.x -gt $suchfeld.x })[0]
          if ($lupe) {
            $le = Get-LiveElement $hwnd $lupe.rid
            if ($le) { try { $le.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch { } }
          }
          Start-Sleep -Milliseconds 1200
          $tt = Walk-Tree $hwnd
          $bb = Get-ContentBounds $tt $hwnd
          $rr = New-Object SW+RC; [SW]::GetWindowRect($hwnd, [ref]$rr) | Out-Null
          $treffer = @($tt.nodes | Where-Object {
            $_.type -in @('DataItem','ListItem','TreeItem') -and $_.name -and
            $_.y -lt ($rr.T + 520) -and $_.x -lt $bb.maxX
          } | Sort-Object y)
          $genau = @($treffer | Where-Object { $_.name -eq $ziel })[0]
          if (-not $genau) { $genau = @($treffer | Where-Object { $_.name -like "*$ziel*" })[0] }
          if (-not $genau) {
            $genau = @($treffer | Where-Object {
              $_.x -lt ($rr.L + 250) -and $_.y -lt ($rr.T + 400) -and
              $ziel -like "*$($_.name)*"
            } | Sort-Object { $_.name.Length } -Descending)[0]
          }
          # Qt benennt den auswählbaren DataItem-Knoten oft nur mit der
          # Oberkategorie (z. B. "Arbeitnehmer"); der eigentliche Seitentitel
          # steht in einem Text-Nachfahren. Den exakten Texttreffer deshalb
          # bis zum nächsten aktivierbaren Vorfahren hochverfolgen.
          if (-not $genau) {
            $zielText = @($tt.nodes | Where-Object {
              $_.type -in @('Text','Hyperlink') -and $_.name -and
              (($_.name -eq $ziel) -or ($_.name -like "*$ziel*")) -and
              $_.y -lt ($rr.T + 700)
            } | Sort-Object y)[0]
            $cur = $zielText
            for ($up = 0; $cur -and $up -lt 8; $up++) {
              if ($cur.type -in @('DataItem','ListItem','TreeItem')) { $genau = $cur; break }
              $parentIndex = $cur.p
              if ($null -eq $parentIndex -or [int]$parentIndex -lt 0) { break }
              $cur = @($tt.nodes | Where-Object { $_.i -eq $parentIndex })[0]
            }
          }
          # Kein beliebiges Ergebnis als Anker verwenden. Ein Suchbegriff kann
          # in Hilfetexten vieler fachfremder Seiten vorkommen (z. B.
          # "Steuernummer" in einem Fristverlaengerungsantrag). Ohne exakten,
          # enthaltenen oder ueber einen exakten Text-Nachfahren gebundenen
          # Treffer wird die Suchseite nur geschlossen und der kontrollierte
          # lineare Pfad verwendet; auf dem sichtbaren Desktop niemals einen
          # unscharfen Treffer doppelklicken.
          $suchWeg = New-Object System.Collections.ArrayList
          $null = $suchWeg.Add("Suche nach '$ziel'")
          $null = $suchWeg.Add("sichtbare Treffer: $((@($treffer | Select-Object -First 12 | ForEach-Object { $_.name })) -join ' | ')")
          $null = $suchWeg.Add("Trefferdetails: $((@($treffer | Select-Object -First 12 | ForEach-Object { "$($_.name)@x$($_.x),y$($_.y),d$($_.d),rid$($_.rid)" })) -join ' | ')")
          $null = $suchWeg.Add("sichtbare Texte: $((@($tt.nodes | Where-Object { $_.type -eq 'Text' -and $_.name -and $_.y -lt ($rr.T + 700) } | Select-Object -First 20 | ForEach-Object { $_.name })) -join ' | ')")
          if ($genau) {
            $null = $suchWeg.Add("Treffer: '$($genau.name)'")
            $ge = Get-LiveElement $hwnd $genau.rid
            if ($ge) {
              try { $null = $suchWeg.Add("Muster: $((@($ge.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName })) -join ', ')") } catch { }
            }
            $parentProbe = $genau
            for ($pu = 0; $parentProbe -and $pu -lt 4; $pu++) {
              $pi = $parentProbe.p
              if ($null -eq $pi -or [int]$pi -lt 0) { break }
              $parentProbe = @($tt.nodes | Where-Object { $_.i -eq $pi })[0]
              if ($parentProbe) {
                $null = $suchWeg.Add("Vorfahre $pu`: $($parentProbe.type) '$($parentProbe.name)' rid=$($parentProbe.rid)")
              }
            }
            $aktiviert = $false
            $suchSeiteGeoeffnet = $false
            if ($script:DESKTOP_NAME) {
              # Auf dem versteckten Desktop ist ein echter Mausklick technisch
              # nicht moeglich. Nur dort die Qt-Patterns versuchen. Auf dem
              # sichtbaren Desktop waren diese gemessen wirkungslos und
              # kosteten vor jedem sicheren Doppelklick mehrere Sekunden.
              foreach ($pat in @('SelectionItem','Invoke','Invoke','LegacyDefault','Expand')) {
                if ($suchSeiteGeoeffnet -or -not $ge) { continue }
                try {
                  if ($pat -eq 'Invoke') { $ge.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
                  elseif ($pat -eq 'SelectionItem') { $ge.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select() }
                  elseif ($pat -eq 'LegacyDefault') { $ge.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern).DoDefaultAction() }
                  else { $ge.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand() }
                  Start-Sleep -Milliseconds 900
                  $nachSuche = AktuelleUeberschrift $hwnd
                  $aktiviert = ($nachSuche -eq $ziel)
                  $suchSeiteGeoeffnet = $aktiviert -or ($nachSuche -and $nachSuche -ne $start)
                  $null = $suchWeg.Add("Aktivierungsmuster $pat -> '$nachSuche'")
                } catch { }
              }
            }
            if (-not $suchSeiteGeoeffnet -and -not $script:DESKTOP_NAME) {
              # Sichtbarer Desktop: Qt meldet bei Suchtreffern regelmaessig
              # erfolgreichen Invoke/Select ohne Seitenwechsel. Direkt hier
              # den bereits PID-verifizierten Treffer doppelklicken, statt den
              # Aufrufer zu vier weiteren MCP-Roundtrips (find/rid/click/page)
              # zu zwingen. Der Erfolg gilt weiterhin nur bei geaenderter bzw.
              # exakt passender Ueberschrift.
              try {
                $null = Click-VerifiedPoint $hwnd $genau
                Start-Sleep -Milliseconds 120
                $null = Click-VerifiedPoint $hwnd $genau
                # Solange die Suchseite offen ist, ist die Formularueberschrift
                # nicht im UIA-Baum. Kurz nur den Klick abarbeiten lassen; die
                # belastbare Gegenprobe folgt direkt nach 'Suche schliessen'.
                Start-Sleep -Milliseconds 300
                $nachSuche = AktuelleUeberschrift $hwnd
                $aktiviert = ($nachSuche -eq $ziel)
                $suchSeiteGeoeffnet = $aktiviert -or ($nachSuche -and $nachSuche -ne $start)
                $null = $suchWeg.Add("PID-gepruefter Doppelklick -> '$nachSuche'")
              } catch {
                $null = $suchWeg.Add("PID-gepruefter Doppelklick fehlgeschlagen: $($_.Exception.Message)")
              }
            }
            if (-not $suchSeiteGeoeffnet -and $script:DESKTOP_NAME) {
              $null = $suchWeg.Add(
                'Qt-Suchtreffer auf verstecktem Desktop nicht aktivierbar; linearer Blaetterpfad wird verwendet.'
              )
            }
            if ($suchSeiteGeoeffnet) {
              $zu = Find-Node (Walk-Tree $hwnd 1200) 'Suche schließen'
              if ($zu) { $ze = Get-LiveElement $hwnd $zu.rid; if ($ze) { try { $ze.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch { } } }
              $nachSuche = AktuelleUeberschrift $hwnd
              $null = $suchWeg.Add("Suchseite geöffnet: '$nachSuche'")
              if ($aktiviert) {
                Emit ([pscustomobject]@{ ok = $true; erreicht = $true; ueberschrift = $nachSuche; schritte = 1
                  richtung = 'Suche'; weg = @($suchWeg); fokusfrei = $true })
              }
              # Der Suchbegriff kann im Hilfetext einer anders benannten Seite
              # liegen (Kontoführungsgebühren -> Sonstige Werbungskosten/Fahrten).
              # Von dieser verifizierten Ankerseite aus normal weiterblaettern.
              $start = $nachSuche
            }
          }
          $zu2 = Find-Node (Walk-Tree $hwnd 1200) 'Suche schließen'
          if ($zu2) { $z2 = Get-LiveElement $hwnd $zu2.rid; if ($z2) { try { $z2.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Milliseconds 500 } catch { } } }
          $nachSuchschluss = WarteAufUeberschrift $hwnd $start $ziel 1800
          if ($nachSuchschluss) {
            $null = $suchWeg.Add("Nach Suchschluss -> '$nachSuchschluss'")
            if ($nachSuchschluss -eq $ziel) {
              foreach ($s in $suchWeg) { $null = $weg.Add($s) }
              Emit ([pscustomobject]@{ ok = $true; erreicht = $true; ueberschrift = $nachSuchschluss; schritte = 1
                richtung = 'Suche/Doppelklick'; weg = @($weg); fokusfrei = $false })
            }
            if ($nachSuchschluss -ne $start) { $start = $nachSuchschluss }
          }
          foreach ($s in $suchWeg) { $null = $weg.Add($s) }
        }
      }
    }

    $besucht = New-Object System.Collections.ArrayList
    $null = $besucht.Add($start)

    # Richtung und Entfernung aus der bekannten Reihenfolge ableiten.
    # Nur wenn beide Seiten dort stehen; sonst wie bisher beide Richtungen.
    $iStart = [array]::IndexOf($FOLGE, $start)
    $reihenfolge = @('Weiter', 'Zurück')
    $vorgabe = 20
    $richtungVorgegeben = [string](Arg $a 'direction')
    if ($richtungVorgegeben) {
      if ($richtungVorgegeben -notin @('Weiter','Zurück')) { Fail "direction muss 'Weiter' oder 'Zurück' sein." 'bad-args' }
      $reihenfolge = @($richtungVorgegeben)
    }
    if (-not $richtungVorgegeben -and $iStart -ge 0 -and $iZiel -ge 0) {
      $abstand = $iZiel - $iStart
      $reihenfolge = if ($abstand -ge 0) { @('Weiter', 'Zurück') } else { @('Zurück', 'Weiter') }
      # Reserve fuer Zwischenseiten, die nicht in der Liste stehen
      # Rueckwaerts kann gesperrt sein; dann muss vorwaerts einmal ganz
      # herum gelaufen werden. Deshalb Platz fuer den vollen Zyklus lassen.
      $vorgabe = [Math]::Max(90, [Math]::Abs($abstand) * 2 + 20)
    } elseif (-not $richtungVorgegeben -and ($iZiel -ge 0 -or $iStart -ge 0)) {
      $vorgabe = 90      # eine Seite unbekannt: grosszuegig, kostet versteckt nichts
    }
    $maxS = $(if ($null -ne $requestedMaxSteps) { $requestedMaxSteps } else { $vorgabe })

    foreach ($richtung in $reihenfolge) {
      $stillstand = 0
      for ($i = 1; $i -le $maxS; $i++) {
        if ($verbraucht -ge $maxS) { break }
        $verbraucht++
        $vorher = AktuelleUeberschrift $hwnd
        $ok = DrueckeKnopf $hwnd $richtung ''
        if (-not $ok) {
          # Schalter fehlt oder ist deaktiviert. Sonderfall: Sackgassenseiten
          # wie 'Gewinnermittlung beginnen' haben WEDER Weiter NOCH Zurueck -
          # der Blaetterpfad endet dort, er laeuft nicht im Kreis. Einziger
          # fokusfreier Ausweg ist der Verlaufspfeil (eine Schaltflaeche, also
          # per Invoke erreichbar).
          $andere = if ($richtung -eq 'Weiter') { 'Zurück' } else { 'Weiter' }
          $tK = Walk-Tree $hwnd 1200
          $andereDa = @($tK.nodes | Where-Object { $_.name -eq $andere -and $_.type -eq 'Button' -and $_.on }).Count -gt 0
          if (-not $andereDa) {
            if (DrueckeKnopf $hwnd '' 'HistoryToolbarBtnSSE') {
              $null = $weg.Add('Sackgasse - Verlauf zurück')
              continue
            }
          }
          $null = $weg.Add("$richtung nicht verfuegbar")
          break
        }
        $jetzt = AktuelleUeberschrift $hwnd
        $null = $weg.Add("$richtung -> $jetzt")

        # Ein automatischer Pruefhinweis blockiert den Seitenwechsel. Ohne
        # diese Gegenprobe wuerde die Schleife denselben Weiter-Knopf bis zu
        # fuenfmal erneut ausloesen und fuenf identische Warnfenster stapeln.
        # Beim ersten wirkungslosen Klick sofort stoppen; Inhalt und Antwort
        # bleiben bewusst sse_warning_popup_read/sse_dialog_answer vorbehalten.
        if ($jetzt -eq $vorher) {
          $warnfenster = @(Get-Windows 'SSE' | Where-Object {
            [int]$_.pid -eq [int]$gotoPid -and $_.title -like 'Die Prüfung hat ergeben*'
          })
          if ($warnfenster.Count) {
            Fail ("Blaettern auf '$jetzt' wurde von einem Pruefhinweis blockiert; keine Wiederholung. " +
                  'Warnfenster zuerst lesen und fingerprintgebunden beantworten.') 'warning-dialog' `
              ([pscustomobject]@{
                ueberschrift=$jetzt
                warnfenster=@($warnfenster | ForEach-Object { [pscustomobject]@{
                  hwnd=[int64]$_.hwnd; pid=[int]$_.pid; title=[string]$_.title
                } })
                naechsterSchritt='sse_warning_popup_read mit dem gemeldeten Dialog-HWND'
              })
          }
        }

        # SACKGASSE. 'Gewinnermittlung beginnen' steht am Ende des
        # Blaetterpfads und hat weder Weiter noch Zurueck. Der Pfad laeuft
        # NICHT im Kreis, und der Verlaufspfeil fuehrt von dort auch nicht
        # heraus (gemessen: 90 Schritte ohne Erfolg). Sofort melden, statt
        # den Rest des Schrittkontingents zu verbrennen.
        if ($jetzt -eq 'Gewinnermittlung beginnen' -and $ziel -ne $jetzt) {
          Fail ("Der Blaetterpfad endet auf der Startseite 'Gewinnermittlung beginnen'; von dort fuehrt " +
                "kein fokusfreier Weg zurueck ins Formular. '$ziel' liegt in der anderen Richtung. " +
                "Abhilfe: entweder von einer Seite im Formular aus erneut starten, oder " +
                "sse_desktop_stop und im sichtbaren Modus per sse_click_point den Navigationsbaum benutzen, " +
                "oder das Programm mit sse_launch neu oeffnen - es startet dann wieder im Formular.") 'dead-end'
        }

        if ($jetzt -eq $ziel) {
          Emit ([pscustomobject]@{ ok = $true; erreicht = $true; ueberschrift = $jetzt; schritte = $weg.Count
            richtung = $richtung; weg = @($weg); fokusfrei = $true })
        }
        if ($jetzt -eq $vorher) { $stillstand++ } else { $stillstand = 0 }
        if ($stillstand -ge 5) {
          # Blaettern wirkungslos. Die Fensterzahl taugt NICHT als Indiz:
          # das Programm haelt dauerhaft eine Vorschlagsliste (479x333) und
          # zwei 50x50-Helfer offen - vier Fenster sind der Normalfall.
          # Deshalb hier nur den Befund melden und auf die Pruefung verweisen.
          Fail ("Blaettern bleibt auf '$jetzt' wirkungslos (5 Versuche ohne Seitenwechsel). " +
                "Moegliche Gruende: Seite ohne Blaetterschalter, oder ein leeres Pflichtfeld sperrt sie. " +
                "sse_check_page zeigt, ob etwas beanstandet wird.") 'no-progress'
        }
        $null = $besucht.Add($jetzt)
      }
    }
    # Letzte Gegenprobe: Ein Qt-Seitenwechsel kann erst nach dem letzten
    # Navigationsversuch fertig werden. Dann ist das Ziel erreicht und darf
    # nicht als not-found gemeldet werden.
    $spaet = WarteAufUeberschrift $hwnd '' $ziel 1200
    if ($spaet -eq $ziel) {
      $null = $weg.Add("spaete Gegenprobe -> $spaet")
      Emit ([pscustomobject]@{ ok = $true; ueberschrift = $spaet; schritte = $weg.Count
        richtung = 'spaete Gegenprobe'; weg = @($weg); fokusfrei = $false })
    }
    Fail ("Seite '$ziel' in $($weg.Count) Schritten nicht erreicht. Zuletzt: '$spaet'. " +
          "Besuchte Ueberschriften: $((@($besucht | Select-Object -Unique)) -join ' | '). " +
          "Versuche: $((@($weg)) -join ' | ')") 'not-found'
  }

  'table_read' {
    # Tabelle VOLLSTAENDIG lesen. Qt virtualisiert: nur sichtbare Zeilen
    # stehen im UIA-Baum, es gibt keinen ScrollPattern-Container und PgDn
    # wirkt nicht. Der Cursor zieht die Ansicht mit - also wandert er mit
    # der Pfeiltaste durch die Zeilen, und die Ergebnisse werden vereinigt.
    $maxSchritte = Get-SSEBoundedIntegerArg $a 'maxRows' 200 1 1000
    $sumLabel = [string](Arg $a 'sumLabel')
    $sumOccurrence = Get-SSEBoundedIntegerArg $a 'sumOccurrence' 1 1 1000
    $hwnd = [IntPtr][int64](Resolve-SSEMainWindowDescriptor $a -RestoreMinimized).hwnd
    $dirtyBefore = Get-DirtyState (Walk-Tree $hwnd 600 20 8)
    $gesehen = New-Object 'System.Collections.Generic.HashSet[string]'
    $alle = New-Object System.Collections.ArrayList
    $identityState = [pscustomobject]@{ fehlend = $false }
    $kopf = @()

    function LiesZeilen($hwnd) {
      $t = Walk-Tree $hwnd
      $bounds = Get-ContentBounds $t $hwnd
      # Nur Tabellen des eigentlichen Eingabeformulars. Ein geoeffnetes
      # Werte-Info-Fenster gehoert zum selben Prozess und wurde frueher
      # faelschlich in Kopf und Zeilen der Eingabetabelle gemischt.
      $hRaw = @($t.nodes | Where-Object {
        $_.type -eq 'Header' -and $_.name -and $_.w -gt 0 -and
        $_.aid -like '*.RedThreadContent.*' -and
        $_.x -ge $bounds.minX -and $_.x -le ($bounds.maxX + 200)
      })
      $z = @($t.nodes | Where-Object {
        $_.type -eq 'DataItem' -and $_.w -gt 0 -and
        $_.aid -like '*.RedThreadContent.*' -and
        $_.x -ge $bounds.minX -and $_.x -le ($bounds.maxX + 200)
      } | Sort-Object y, x)
      $tableCount = @($hRaw | Group-Object p).Count
      $binding = $null
      $readError = $null
      if ($sumLabel) {
        $sumRead = Read-LabeledValueFromTree $t $hwnd $sumLabel $sumOccurrence
        if (-not $sumRead.selected) {
          $readError = "Kontrollsumme '$sumLabel' (Vorkommen $sumOccurrence) wurde nicht eindeutig gefunden."
          $hRaw = @(); $z = @(); $tableCount = 0
        } else {
          $region = Get-SSETableRegion $t $hwnd $sumRead
          if (-not $region.ok) {
            $readError = $region.error
            $hRaw = @(); $z = @(); $tableCount = 0
          } else {
            $lowerY = $(if ($null -ne $region.previousSummaryY) { [int]$region.previousSummaryY } else { [int]::MinValue })
            $hRaw = @($hRaw | Where-Object { $_.y -gt $lowerY -and $_.y -lt $region.targetSumY })
            $z = @($region.cells)
            $tableCount = 1
            $binding = [pscustomobject]@{
              sumLabel=$sumLabel; sumOccurrence=$sumOccurrence
              sumY=$region.targetSumY; previousSummaryY=$region.previousSummaryY
            }
          }
        }
      }
      $h = @($hRaw | Sort-Object x)
      $hd = @(); foreach ($x in $h) { if (-not $hd.Count -or [Math]::Abs($x.x - $hd[-1].x) -gt 8) { $hd += $x } }
      $rows = @(); $rowsWithIdentity = @(); $cur = $null; $curRids = $null; $cy = -9999
      foreach ($c in $z) {
        if ($null -eq $cur -or [Math]::Abs($c.y - $cy) -gt 10) {
          if ($null -ne $cur) {
            $identityParts = @()
            for ($columnIndex = 0; $columnIndex -lt $curRids.Count; $columnIndex++) {
              $ridValue = [string]($curRids[$columnIndex])
              if ($ridValue) { $identityParts += "${columnIndex}=$ridValue" }
            }
            $identity = $(if ($identityParts.Count) { $identityParts -join '|' } else { $null })
            $rows += , $cur
            $rowsWithIdentity += [pscustomobject]@{ werte = @($cur); identitaet = $identity }
          }
          $cy = $c.y
          $cur = @($null) * [Math]::Max(1, $hd.Count)
          $curRids = @($null) * [Math]::Max(1, $hd.Count)
        }
        $best = 0; $d = [int]::MaxValue
        for ($i = 0; $i -lt $hd.Count; $i++) { $dd = [Math]::Abs($c.x - $hd[$i].x); if ($dd -lt $d) { $d = $dd; $best = $i } }
        if ($best -lt $cur.Count) {
          $cur[$best] = $c.name
          $curRids[$best] = $c.rid
        } else {
          $cur += $c.name
          $curRids += $c.rid
        }
      }
      if ($null -ne $cur) {
        $identityParts = @()
        for ($columnIndex = 0; $columnIndex -lt $curRids.Count; $columnIndex++) {
          $ridValue = [string]($curRids[$columnIndex])
          if ($ridValue) { $identityParts += "${columnIndex}=$ridValue" }
        }
        $identity = $(if ($identityParts.Count) { $identityParts -join '|' } else { $null })
        $rows += , $cur
        $rowsWithIdentity += [pscustomobject]@{ werte = @($cur); identitaet = $identity }
      }
      [pscustomobject]@{
        kopf = @($hd | ForEach-Object { $_.name }); zeilen = $rows
        zeilenMitIdentitaet = @($rowsWithIdentity)
        ersteZelle = $(if ($z.Count) { $z[0] } else { $null })
        tabelleAnzahl = $tableCount; bindung = $binding; error = $readError
      }
    }

    # RuntimeIds stammen aus UIA und identifizieren die sichtbaren Zellobjekte.
    # Zeileninhalt ist absichtlich KEINE Identitaet: zwei legitime, inhaltlich
    # gleiche Buchungszeilen muessen beide im Ergebnis erhalten bleiben.
    $addSnapshotRows = {
      param($snapshot)
      foreach ($entry in @($snapshot.zeilenMitIdentitaet)) {
        $identity = [string]$entry.identitaet
        if (-not $identity) {
          $identityState.fehlend = $true
          continue
        }
        if ($gesehen.Add($identity)) {
          $null = $alle.Add([object[]]@($entry.werte))
        }
      }
    }

    $cursorSelectionPattern = $null
    $getCursorSignature = {
      if (-not $cursorSelectionPattern) { return $null }
      try {
        $selected = @($cursorSelectionPattern.Current.GetSelection())
        $runtimeIds = @($selected | ForEach-Object {
          try { $_.GetRuntimeId() -join '.' } catch { $null }
        } | Where-Object { $_ } | Sort-Object)
        if (-not $runtimeIds.Count) { return $null }
        return ($runtimeIds -join '|')
      } catch {
        return $null
      }
    }

    $erst = LiesZeilen $hwnd
    if ($erst.error) { Fail $erst.error 'precondition-failed' }
    $kopf = $erst.kopf
    & $addSnapshotRows $erst

    # In die erste Zelle klicken, damit die Pfeiltaste greift.
    $geklickt = $false
    $cursorUnavailable = $false
    $cursorSignature = $null
    if ($erst.ersteZelle -and (Arg $a 'noKeys') -ne $true -and $erst.tabelleAnzahl -eq 1) {
      $HWND_TOPMOST = [IntPtr](-1); $HWND_NOTOPMOST = [IntPtr](-2)
      $SWP = 0x0001 -bor 0x0002 -bor 0x0010
      try {
        $z0 = $erst.ersteZelle
        $px = [int]($z0.x + $z0.w / 2); $py = [int]($z0.y + $z0.h / 2)
        $null = Show-SSEWindow $hwnd
        Start-Sleep -Milliseconds 350
        $pt = New-Object SW+PT; $pt.X = $px; $pt.Y = $py
        $unter = [SW]::WindowFromPoint($pt)
        $unterRoot = [SW]::GetAncestor($unter, 2) # GA_ROOT
        $zp = 0; [SW]::GetWindowThreadProcessId($hwnd, [ref]$zp) | Out-Null
        $tp = 0; [SW]::GetWindowThreadProcessId($unter, [ref]$tp) | Out-Null
        if ($tp -eq $zp -and [int64]$unterRoot -eq [int64]$hwnd) {
          [SW]::SetCursorPos($px, $py) | Out-Null; Start-Sleep -Milliseconds 100
          [SW]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero); [SW]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
          $geklickt = $true
          # Nicht von der zufaelligen aktuellen Scrollposition aus lesen:
          # Ctrl+Home setzt Cursor und virtuelle Ansicht auf die erste Zeile.
          [System.Windows.Forms.SendKeys]::SendWait('^{HOME}')
          Set-SSEForegroundLeaseInputCheckpoint (Get-SSELastInputTick) ([pscustomobject]@{ x=$px; y=$py })
          Start-Sleep -Milliseconds 350
          # Die zuerst sichtbaren Zeilen koennen aus der Tabellenmitte stammen.
          # Fuer eine stabile Reihenfolge jetzt bewusst am Anfang neu sammeln.
          $gesehen.Clear()
          $alle.Clear()
          $identityState.fehlend = $false
          $topSnapshot = LiesZeilen $hwnd
          if ($topSnapshot.error) {
            $cursorUnavailable = $true
          } else {
            $kopf = $topSnapshot.kopf
            & $addSnapshotRows $topSnapshot

            # Der Tabellencontainer meldet die aktuell markierte Qt-Zeile als
            # Auswahl (typischerweise eine ausgewaehlte Zelle je Spalte). Die
            # RuntimeId-Signatur veraendert sich auch bei identischem Inhalt und
            # bleibt erst am echten Tabellenende nach DOWN unveraendert.
            $freshFirst = Get-LiveElement $hwnd $topSnapshot.ersteZelle.rid
            $ancestor = $freshFirst
            for ($level = 0; $level -lt 8 -and $ancestor; $level++) {
              $selectionPatternProbe = $null
              if ($ancestor.TryGetCurrentPattern(
                  [System.Windows.Automation.SelectionPattern]::Pattern, [ref]$selectionPatternProbe)) {
                $cursorSelectionPattern = $selectionPatternProbe
                break
              }
              try { $ancestor = $WLK.GetParent($ancestor) } catch { $ancestor = $null }
            }
            $cursorSignature = & $getCursorSignature
            if (-not $cursorSignature) { $cursorUnavailable = $true }
          }
        }
      } catch {
        $cursorUnavailable = $true
      } finally {
        [SW]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP) | Out-Null
      }
    }

    $schritte = 0
    $stableCursorMoves = 0
    $endProven = $false
    if ($geklickt -and -not $cursorUnavailable) {
      for ($i = 1; $i -le $maxSchritte; $i++) {
        try {
          [System.Windows.Forms.SendKeys]::SendWait('{DOWN}')
          Set-SSEForegroundLeaseInputCheckpoint (Get-SSELastInputTick) ([pscustomobject]@{ x=$px; y=$py })
        } catch {
          $cursorUnavailable = $true
          break
        }
        $schritte++
        Start-Sleep -Milliseconds 160
        $nextCursorSignature = & $getCursorSignature
        if (-not $nextCursorSignature) {
          $cursorUnavailable = $true
          break
        }
        if ($nextCursorSignature -eq $cursorSignature) {
          $stableCursorMoves++
        } else {
          $stableCursorMoves = 0
        }
        $cursorSignature = $nextCursorSignature

        if ($i % 3 -eq 0 -or $stableCursorMoves -gt 0 -or $i -eq $maxSchritte) {
          $snapshot = LiesZeilen $hwnd
          if ($snapshot.error) {
            $cursorUnavailable = $true
            break
          }
          & $addSnapshotRows $snapshot
        }
        # Zwei bestaetigte DOWN-Versuche mit unveraenderter UIA-Auswahl sind
        # der Endbeweis. Identische Zelltexte spielen dabei keine Rolle.
        if ($stableCursorMoves -ge 2) {
          $endProven = $true
          break
        }
      }
    }

    # Auch bei einem abgebrochenen Cursorbeweis den letzten lesbaren Viewport
    # mitnehmen. Seine RuntimeIds verhindern doppelte Ueberlappungszeilen.
    if ($geklickt) {
      $finalSnapshot = LiesZeilen $hwnd
      if (-not $finalSnapshot.error) { & $addSnapshotRows $finalSnapshot }
    }

    $limitReached = [bool]($geklickt -and $schritte -ge $maxSchritte)
    $vollstaendig = [bool](
      $geklickt -and $erst.tabelleAnzahl -eq 1 -and $endProven -and
      -not $limitReached -and -not $cursorUnavailable -and -not $identityState.fehlend
    )
    $stopKind = $(
      if ($limitReached) { 'max-rows' }
      elseif ($identityState.fehlend) { 'row-identity-unavailable' }
      elseif ($cursorUnavailable) { 'cursor-unavailable' }
      elseif ($endProven) { 'end-of-table' }
      elseif ($erst.tabelleAnzahl -gt 1 -and -not $sumLabel) { 'ambiguous-table' }
      elseif (-not $erst.ersteZelle -or $erst.tabelleAnzahl -eq 0) { 'no-table' }
      else { 'visible-only' }
    )

    # Nur Zeilen mit Inhalt melden
    $echte = @($alle | Where-Object { @($_ | Where-Object { $_ -and "$_".Trim() -and "$_" -ne '0,00' -and "$_" -ne '0' }).Count -gt 0 })
    $dirtyAfter = Get-DirtyState (Walk-Tree $hwnd 600 20 8)
    Emit ([pscustomobject]@{
      ok = $true; kopf = $kopf; zeilen = $echte; anzahl = $echte.Count
      vollstaendig = $vollstaendig
      schritte = $schritte
      steps = $schritte
      stopKind = $stopKind
      limitReached = $limitReached
      tabelleAnzahl = $erst.tabelleAnzahl
      bindung = $erst.bindung
      ungespeichertVorher = $dirtyBefore
      ungespeichertNachher = $dirtyAfter
      ungespeichertEingefuehrt = [bool]((-not $dirtyBefore) -and $dirtyAfter)
      hinweis = $(if ($vollstaendig) { 'Das Tabellenende wurde ueber die UIA-Auswahl bewiesen - Summe der Seite trotzdem zur Gegenprobe vergleichen.' }
                  elseif ($limitReached) {
                    "Nach $schritte DOWN-Schritten ist maxRows erreicht; Ergebnis ist bewusst als unvollstaendig markiert."
                  } elseif ($cursorUnavailable -or $identityState.fehlend) {
                    'Cursor- oder Zeilenidentitaet war nicht sicher beweisbar; nur die gelesenen Zeilen werden als Teilstand gemeldet.'
                  }
                  elseif ($erst.tabelleAnzahl -gt 1 -and -not $sumLabel) {
                    "$($erst.tabelleAnzahl) Eingabetabellen gefunden. Fuer einen Vollstaendigkeitsbeweis sumLabel und sumOccurrence angeben; nichts fokussiert."
                  } else { 'NUR sichtbare Zeilen: die Tabelle liess sich nicht eindeutig anklicken. Ergebnis kann unvollstaendig sein.' })
    })
  }

  'table_add' {
    # Eine Zeile transaktional in die erste freie Tabellenzeile schreiben.
    # Seite, Vor-/Nachsumme und jede beschriebene Zelle werden gebunden. Nur
    # eigene, eindeutig fehlgeschlagene Aenderungen werden zurueckgesetzt;
    # bei fremder Eingabe/Fensterwechsel kein blinder Rollback.
    $hwnd = [IntPtr][int64](Resolve-SSEMainWindowDescriptor $a -RestoreMinimized).hwnd
    $werte = @(Arg $a 'werte')
    $expectedPage = [string](Arg $a 'expectedPage')
    $sumLabel = [string](Arg $a 'sumLabel')
    $sumOccurrence = [int](Arg $a 'sumOccurrence' 1)
    $expectedBefore = [string](Arg $a 'expectedBefore')
    $expectedAfter = [string](Arg $a 'expectedAfter')
    if (-not $werte.Count) { Fail 'werte fehlt (Liste in Spaltenreihenfolge)' 'bad-args' }
    if (-not $expectedPage -or -not $sumLabel -or -not $expectedBefore -or -not $expectedAfter) {
      Fail 'expectedPage, sumLabel, expectedBefore und expectedAfter sind Pflicht.' 'bad-args'
    }
    if (-not @($werte | Where-Object { [string]$_ }).Count) {
      Fail 'werte enthaelt keinen zu schreibenden Zellwert.' 'bad-args'
    }
    $targetPid = 0
    [SW]::GetWindowThreadProcessId($hwnd, [ref]$targetPid) | Out-Null
    $dialogsBefore = @(Get-DialogInventory | Where-Object {
      [int]$_.pid -eq $targetPid -and $_.kind -in @('native-dialog','qt-dialog')
    })
    if ($dialogsBefore.Count) { Fail 'Ein modaler Dialog ist offen; Tabellenzeile nicht begonnen.' 'precondition-failed' }
    $beforeTree = Walk-Tree $hwnd -WithValues
    $headingBefore = Get-CurrentHeading $hwnd $beforeTree
    if ($headingBefore -ne $expectedPage) {
      Fail "Vorbedingung verletzt: aktuelle Seite ist '$headingBefore', erwartet '$expectedPage'. NICHT geaendert." 'precondition-failed'
    }
    $sumBeforeRead = Read-LabeledValueFromTree $beforeTree $hwnd $sumLabel $sumOccurrence
    if (-not $sumBeforeRead.selected) {
      Fail "Kontrollsumme '$sumLabel' (Vorkommen $sumOccurrence) wurde nicht eindeutig gefunden. NICHT geaendert." 'precondition-failed'
    }
    if (-not (Test-SSEScalarEqual $sumBeforeRead.value $expectedBefore)) {
      Fail "Vorbedingung verletzt: '$sumLabel' ist '$($sumBeforeRead.value)', erwartet '$expectedBefore'. NICHT geaendert." 'precondition-failed'
    }
    $dirtyBefore = Get-DirtyState $beforeTree
    $checkerBefore = @(Get-SSEPageCheckerMessages $beforeTree $hwnd)

    function Find-FreeTableRow([IntPtr]$window, $tree = $null, $targetSumRead = $null) {
      if ($null -eq $tree) { $tree = Walk-Tree $window -WithValues }
      if ($null -eq $targetSumRead) {
        $targetSumRead = Read-LabeledValueFromTree $tree $window $sumLabel $sumOccurrence
      }
      if (-not $targetSumRead.selected) {
        return [pscustomobject]@{
          tree=$tree; cells=@(); byY=@{}; free=@(); firstCell=$null
          targetSum=$targetSumRead; targetSumY=$null; previousSummaryY=$null
          selectionMethod=$null; scopePrefix=$null; tableProfile=$null; profileMismatch=$false
          error="Kontrollsumme '$sumLabel' ist fuer die Tabellenbindung nicht sichtbar."
        }
      }

      $region = Get-SSETableRegion $tree $window $targetSumRead
      if (-not $region.ok) {
        return [pscustomobject]@{
          tree=$tree; cells=@(); byY=@{}; free=@(); firstCell=$null
          targetSum=$targetSumRead; targetSumY=$region.targetSumY
          previousSummaryY=$region.previousSummaryY
          selectionMethod=$region.selectionMethod; scopePrefix=$region.scopePrefix; tableProfile=$null; profileMismatch=$false
          error=$region.error
        }
      }
      $resolvedTableProfile = Resolve-SSETableProfile $headingBefore $sumLabel $sumOccurrence $region
      if ($resolvedTableProfile.known -and -not $resolvedTableProfile.bindingOk) {
        return [pscustomobject]@{
          tree=$tree; cells=@(); byY=@{}; free=@(); firstCell=$null
          targetSum=$targetSumRead; targetSumY=$region.targetSumY; previousSummaryY=$region.previousSummaryY
          selectionMethod=$region.selectionMethod; scopePrefix=$region.scopePrefix
          tableProfile=$resolvedTableProfile; profileMismatch=$true
          error="$($resolvedTableProfile.reason) Tabellenprofil '$($resolvedTableProfile.pageId)/$($resolvedTableProfile.tableId)' nicht gebunden."
        }
      }
      $cells = @($region.cells)
      $byY = @{}
      foreach ($cell in $cells) {
        if (-not $byY.ContainsKey($cell.y)) { $byY[$cell.y] = @() }
        $byY[$cell.y] += $cell
      }
      # Die Leerzeile direkt vor der gebundenen Summe ist die von Qt fuer diese
      # Tabelle bereitgestellte Anlegezeile. Absteigend sortieren, damit nicht
      # eine weiter oben liegende Reservezeile gewaehlt wird.
      $free = @($byY.Keys | Sort-Object -Descending | Where-Object {
        # Steuersatz-Auswahltabellen zeigen in der technisch leeren
        # Anlegezeile bereits den Defaultsatz 19 (oder 7) in einer schmalen
        # Selector-Zelle. Das ist noch kein Datensatz. Betrag/Netto sind dort
        # 0,00 und Datum/Bezeichnung leer. Den Default deshalb nur in einer
        # schmalen Zelle neutral behandeln; ein echter Betrag 19,00 in einer
        # breiten Betragszelle bleibt Inhalt und wird nie ueberschrieben. Ein
        # fachlicher Kategorie-Default wird nur an exakt der gebundenen
        # Profilspalte neutralisiert.
        Test-SSETableRowFreeWithProfileDefaults $byY[$_] $resolvedTableProfile
      })
      $anchorY = @($byY.Keys | Sort-Object -Descending | Select-Object -First 1)
      [pscustomobject]@{
        tree = $tree; cells = $cells; byY = $byY; free = $free
        firstCell = $(if ($anchorY.Count) { @($byY[$anchorY[0]] | Sort-Object x)[0] } else { $null })
        targetSum=$targetSumRead; targetSumY=$region.targetSumY
        previousSummaryY=$region.previousSummaryY
        selectionMethod=$region.selectionMethod; scopePrefix=$region.scopePrefix
        tableProfile=$resolvedTableProfile; profileMismatch=$false
        error=$null
      }
    }

    function Get-TableStructureEvidence($read) {
      if (-not $read -or $read.error) {
        return [pscustomobject]@{
          ok=$false; rowCount=$null; freeRowCount=$null; populatedRowCount=$null
          fingerprint=$null; endRowFingerprint=$null; error=$(if ($read) { $read.error } else { 'Tabellenlesung fehlt.' })
        }
      }
      $rowSignatures = New-Object System.Collections.ArrayList
      $rowYs = @($read.byY.Keys | Sort-Object)
      foreach ($rowY in $rowYs) {
        $cellParts = @($read.byY[$rowY] | Sort-Object x | ForEach-Object {
          $aid = [string]$_.aid
          $aidSuffix = $(if ($aid) { ($aid -split '\.')[-1] } else { '' })
          "$($_.type)`u{001F}$aidSuffix`u{001F}$($_.w)`u{001F}$([string]$_.name)"
        })
        $null = $rowSignatures.Add($cellParts -join "`u{001E}")
      }
      $freeCount = @($read.free).Count
      [pscustomobject]@{
        ok=$true
        rowCount=$rowYs.Count
        freeRowCount=$freeCount
        populatedRowCount=$rowYs.Count - $freeCount
        fingerprint=Get-SSETextSha256 (@($rowSignatures) -join "`u{001D}")
        endRowFingerprint=$(if ($rowSignatures.Count) { Get-SSETextSha256 ([string]$rowSignatures[-1]) } else { $null })
        error=$null
      }
    }

    $freeRead = Find-FreeTableRow $hwnd $beforeTree $sumBeforeRead
    if ($freeRead.error) {
      Fail "$($freeRead.error) NICHT geaendert." $(if ($freeRead.profileMismatch) { 'table-profile-mismatch' } else { 'precondition-failed' })
    }
    $navigationSteps = 0
    $searchDeadlineMs = 60000
    $testDeadlineMs = 0
    if ([int]::TryParse([string]$env:SSE_MCP_TEST_SEARCH_DEADLINE_MS, [ref]$testDeadlineMs) -and $testDeadlineMs -gt 0) {
      $searchDeadlineMs = $testDeadlineMs
    }
    $searchWatch = [Diagnostics.Stopwatch]::StartNew()
    # GetLastInputInfo zaehlt auch Aktivitaet auf dem Windows-Lockscreen. Wenn
    # LockApp nachweislich das Vordergrundfenster ist, kann der Benutzer SSE
    # nicht parallel bedienen; reine UIA-ValuePattern-Schreibungen duerfen
    # deshalb nicht an diesem systembedingten Tickwechsel scheitern. Wird der
    # Lockscreen waehrend der Transaktion verlassen, stoppen wir als
    # Interferenz. Physische Klick-/Tastaturpfade bleiben unveraendert gesperrt.
    $lockScreenIsolation = [bool](-not $script:DESKTOP_NAME -and (Test-SSEForegroundIsLockScreen))
    $guardUserInput = [bool](-not $script:DESKTOP_NAME -and -not $lockScreenIsolation)
    $inputBaseline = $(if ($guardUserInput) { Get-SSELastInputTick } else { $null })
    if (-not $freeRead.free.Count -and $freeRead.firstCell) {
      if ($script:DESKTOP_NAME) {
        Fail ("Keine sichtbare freie Tabellenzeile gefunden. Auf dem versteckten Desktop kann Qt nicht " +
              "per Tastatur zum Tabellenende bewegt werden. Eine sichtbare freie Zeile kann sse_table_add " +
              "vollstaendig per ValuePattern beschreiben; andernfalls sichtbar arbeiten.") 'hidden-desktop'
      }
      $null = Click-VerifiedPoint $hwnd $freeRead.firstCell
      Start-Sleep -Milliseconds 180
      if ([SW]::GetForegroundWindow() -ne $hwnd) {
        Fail 'Tabellenfokus ist vor der Navigation verloren gegangen; nichts geschrieben.' 'interference'
      }
      if ($guardUserInput) { $inputBaseline = Get-SSELastInputTick }
      [System.Windows.Forms.SendKeys]::SendWait('^{END}')
      if ($guardUserInput) { $inputBaseline = Get-SSELastInputTick }
      Set-SSEForegroundLeaseInputCheckpoint (Get-SSELastInputTick)
      Start-Sleep -Milliseconds 350
      for ($navigationSteps = 0; $navigationSteps -le 40; $navigationSteps++) {
        if ($searchWatch.ElapsedMilliseconds -ge $searchDeadlineMs) {
          Fail 'Tabellenend-Navigation ueberschritt die interne Frist; nichts geschrieben.' 'timeout'
        }
        if ($guardUserInput) {
          $nowInput = Get-SSELastInputTick
          if ($null -ne $inputBaseline -and $null -ne $nowInput -and $nowInput -ne $inputBaseline) {
            Fail 'Fremde Eingabe waehrend der Tabellenend-Navigation erkannt; nichts geschrieben.' 'interference'
          }
        }
        $freeRead = Find-FreeTableRow $hwnd
        if ($freeRead.error) {
          Fail "$($freeRead.error) NICHT geschrieben." $(if ($freeRead.profileMismatch) { 'table-profile-mismatch' } else { 'precondition-failed' })
        }
        if ($freeRead.free.Count) { break }
        if ([SW]::GetForegroundWindow() -ne $hwnd) {
          Fail 'Tabellenfokus ging waehrend der Navigation verloren; nichts geschrieben.' 'interference'
        }
        [System.Windows.Forms.SendKeys]::SendWait('{DOWN}')
        if ($guardUserInput) { $inputBaseline = Get-SSELastInputTick }
        Set-SSEForegroundLeaseInputCheckpoint (Get-SSELastInputTick)
        Start-Sleep -Milliseconds 100
      }
    }
    $nachY = $freeRead.byY
    $freie = @($freeRead.free)
    if (-not $freie.Count) { Fail 'Keine freie Tabellenzeile gefunden.' 'not-found' }
    $zeile = @($nachY[$freie[0]] | Sort-Object x)
    if ($werte.Count -gt $zeile.Count) {
      Fail "werte enthaelt $($werte.Count) Spalten, die freie sichtbare Zeile aber nur $($zeile.Count)." 'bad-args'
    }
    $tableProfile = $freeRead.tableProfile
    $structureBefore = Get-TableStructureEvidence $freeRead
    if (-not $structureBefore.ok) {
      Fail "Tabellenstruktur vor der Anlage ist nicht beweisbar: $($structureBefore.error) NICHT geaendert." 'precondition-failed'
    }
    # Fuer den Rollback den ROHEN ValuePattern-Wert jeder beschreibbaren Zelle
    # der Anlegezeile sichern. Der sichtbare Name kann bei einer technisch
    # leeren Qt-Zelle bereits '0,00' sein, obwohl ValuePattern.Value leer ist.
    # '0,00' zurueckzuschreiben erzeugt sonst einen echten leeren Datensatz.
    $rowSnapshotBefore = New-Object System.Collections.ArrayList
    for ($snapshotColumn = 0; $snapshotColumn -lt $zeile.Count; $snapshotColumn++) {
      $snapshotCell = $zeile[$snapshotColumn]
      $snapshotColumnProfile = Get-SSETableProfileColumn $tableProfile $snapshotColumn
      if (($snapshotColumnProfile -and [string]$snapshotColumnProfile.controlType -eq 'ComboBox') -or
          [string]$snapshotCell.type -eq 'ComboBox') {
        continue
      }
      $snapshotElement = Get-LiveElement $hwnd $snapshotCell.rid
      $snapshotPattern = $null
      if ($snapshotElement -and
          $snapshotElement.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$snapshotPattern) -and
          -not $snapshotPattern.Current.IsReadOnly) {
        $null = $rowSnapshotBefore.Add([pscustomobject]@{
          spalte=$snapshotColumn; cell=$snapshotCell
          beforeRaw=[string]$snapshotPattern.Current.Value
          beforeDisplay=[string]$snapshotElement.Current.Name
        })
      }
    }
    $prepared = New-Object System.Collections.ArrayList
    $unsupportedComboCells = New-Object System.Collections.ArrayList
    for ($i = 0; $i -lt $werte.Count; $i++) {
      $requested = [string]$werte[$i]
      if (-not $requested) { continue }
      $cell = $zeile[$i]
      $el = Get-LiveElement $hwnd $cell.rid
      if (-not $el) { Fail "Zelle in Spalte $i ist vor dem Schreiben nicht greifbar." 'stale' }
      $columnProfile = Get-SSETableProfileColumn $tableProfile $i
      if ($columnProfile -and [string]$columnProfile.controlType -eq 'ComboBox') {
        $beforeValue = Get-SSETableComboCellValue $el $cell
        if ([string]$columnProfile.writePolicy -eq 'typed-selection-required') {
          $expectedCombo = Get-SSETableComboExpectedBefore $a $i
          if (-not $expectedCombo.present) {
            Fail "comboExpectedBefore.$i ist fuer die profilierte ComboBox-Spalte '$([string]$columnProfile.header)' Pflicht. NICHT geaendert." 'bad-args'
          }
          if (-not [string]::Equals($beforeValue, [string]$expectedCombo.value, [StringComparison]::Ordinal)) {
            Fail "ComboBox-Vorwert in Spalte $i ist '$beforeValue', erwartet '$($expectedCombo.value)'. NICHT geaendert." 'precondition-failed'
          }
          $invokeProbe = $null
          if (-not $el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokeProbe)) {
            Fail "Profilierte ComboBox-Spalte $i bietet kein InvokePattern. NICHT geaendert." 'unsupported-table-combobox'
          }
          $null = $prepared.Add([pscustomobject]@{
            spalte=$i; requested=$requested; before=$beforeValue; mode='combo'
            cell=$cell; rowY=[int]$freie[0]; tableProfile=$tableProfile; columnProfile=$columnProfile
          })
        } else {
          $null = $unsupportedComboCells.Add([pscustomobject]@{
            spalte=$i; header=[string]$columnProfile.header; controlType='ComboBox'
            observedControlType=[string]$cell.type; requested=$requested; current=$beforeValue
            rid=$cell.rid; aid=$cell.aid; reason=[string]$columnProfile.reason
          })
        }
        continue
      }
      $vp = $null
      if (-not $el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
        Fail "Zelle in Spalte $i bietet kein ValuePattern; nichts geschrieben." 'no-value-pattern'
      }
      if ($vp.Current.IsReadOnly) { Fail "Zelle in Spalte $i ist schreibgeschuetzt; nichts geschrieben." 'readonly' }
      $beforeRawValue = [string]$vp.Current.Value
      $beforeValue = $beforeRawValue
      if (-not $beforeValue) { try { $beforeValue = [string]$el.Current.Name } catch { } }
      $null = $prepared.Add([pscustomobject]@{
        spalte=$i; requested=$requested; before=$beforeValue; beforeRaw=$beforeRawValue
        cell=$cell; element=$el; pattern=$vp; mode='value'
      })
    }
    if ($unsupportedComboCells.Count) {
      Emit ([pscustomobject]@{
        ok=$false; kind='unsupported-table-combobox'
        error='Tabellen-ComboBox erkannt. Ohne zeilen- und optionsgebundene semantische Auswahl wird vor der ersten Datenmutation abgebrochen.'
        page=$headingBefore; expectedPage=$expectedPage; mutationStarted=$false
        unsupportedCells=@($unsupportedComboCells)
        supportedCellTypes=@('Edit','Spinner','DataItem')
        requiredCapability='typed-table-combobox-selection'
        checkerMessagesBefore=$checkerBefore
        tableBinding=[pscustomobject]@{
          sumLabel=$sumLabel; sumOccurrence=$sumOccurrence; sumY=$freeRead.targetSumY
          previousSummaryY=$freeRead.previousSummaryY; rowY=$freie[0]
          pageObjectId=$tableProfile.pageId; tableObjectId=$tableProfile.tableId
          selectionMethod=$freeRead.selectionMethod; scopePrefix=$freeRead.scopePrefix
          bindingStrength=$tableProfile.bindingStrength; aidFallback=[bool]$tableProfile.aidFallback
        }
        rollback=[pscustomobject]@{ versucht=$false; grund='Fail-closed vor der ersten Datenmutation; kein Rollback erforderlich.' }
      })
    }
    if (-not $prepared.Count) { Fail 'Keine beschreibbare Zielzelle vorbereitet.' 'bad-args' }

    $interactionBefore = Get-SSEInteractionWindowSet $targetPid $hwnd
    $results = New-Object System.Collections.ArrayList
    $changed = New-Object System.Collections.ArrayList
    $failure = $null
    $failureKind = $null
    $interference = $false
    foreach ($entry in @($prepared | Sort-Object @{ Expression = { if ($_.mode -eq 'combo') { 0 } else { 1 } } }, spalte)) {
      if ($lockScreenIsolation -and -not (Test-SSEForegroundIsLockScreen)) {
        $failure = 'Windows-Lockscreen wurde waehrend der Zellschreibung verlassen.'
        $interference = $true
        break
      }
      if ($guardUserInput) {
        $nowInput = Get-SSELastInputTick
        if ($null -ne $inputBaseline -and $null -ne $nowInput -and $nowInput -ne $inputBaseline) {
          $failure = 'Fremde Benutzereingabe unmittelbar vor einer Zellschreibung erkannt.'
          $interference = $true
          break
        }
      }
      if ($entry.mode -eq 'combo') {
        $comboResult = Invoke-SSETableComboSelection `
          -Hwnd $hwnd -ProcessId $targetPid -ExpectedPage $expectedPage `
          -SumLabel $sumLabel -SumOccurrence $sumOccurrence -RowY $entry.rowY -ColumnIndex $entry.spalte `
          -TableProfile $entry.tableProfile -ColumnProfile $entry.columnProfile `
          -ExpectedCurrent $entry.before -Wanted $entry.requested -CheckerMessagesBefore $checkerBefore `
          -InputBaseline $inputBaseline -GuardUserInput:$guardUserInput
        if ($guardUserInput -and $null -ne $comboResult.inputBaselineAfter) {
          $inputBaseline = $comboResult.inputBaselineAfter
        }
        $comboDiagnostic = Get-SSETableComboDiagnosticProjection $comboResult
        $null = $results.Add([pscustomobject]@{
          spalte=$entry.spalte; ok=[bool]$comboResult.ok; vorher=$entry.before
          gewuenscht=$entry.requested; ist=$comboResult.after; methode=$comboResult.method
          error=$comboDiagnostic.error; kind=$comboDiagnostic.kind
          mutationStarted=$comboDiagnostic.mutationStarted; interference=$comboDiagnostic.interference
          editorClosed=$comboDiagnostic.editorClosed; internalSelected=$comboResult.internalSelected
          popupBinding=$comboDiagnostic.popupBinding; openEvidence=$comboDiagnostic.openEvidence
          diagnosticBounds=$comboDiagnostic.diagnosticBounds
          newCheckerMessages=$comboResult.newCheckerMessages
        })
        if ($comboResult.ok) {
          $entry | Add-Member -NotePropertyName mutationMethod -NotePropertyValue $comboResult.method -Force
          if ($comboResult.mutationStarted) { $null = $changed.Add($entry) }
          continue
        }
        $failure = [string]$comboResult.error
        $failureKind = [string]$comboDiagnostic.kind
        $interference = [bool]$comboResult.interference
        if ($comboResult.mutationStarted -and
            -not ($comboResult.rollback -and $comboResult.rollback.erfolgreich) -and
            [string]::Equals([string]$comboResult.after, [string]$entry.requested, [StringComparison]::Ordinal)) {
          $null = $changed.Add($entry)
        }
        break
      }
      try {
        $null = $changed.Add($entry)
        $entry.pattern.SetValue($entry.requested)
        Start-Sleep -Milliseconds 350
        if ($lockScreenIsolation -and -not (Test-SSEForegroundIsLockScreen)) {
          $failure = 'Windows-Lockscreen wurde nach einer Zellschreibung verlassen.'
          $interference = $true
          break
        }
        if ($guardUserInput) {
          $nowInput = Get-SSELastInputTick
          if ($null -ne $inputBaseline -and $null -ne $nowInput -and $nowInput -ne $inputBaseline) {
            $failure = 'Fremde Benutzereingabe nach einer Zellschreibung erkannt.'
            $interference = $true
            break
          }
        }
        $fresh = Get-LiveElement $hwnd $entry.cell.rid
        $actual = $null
        if ($fresh) {
          $freshVp = $null
          if ($fresh.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$freshVp)) {
            $actual = [string]$freshVp.Current.Value
          }
          if (-not $actual) { try { $actual = [string]$fresh.Current.Name } catch { } }
        }
        $good = Test-SSETableCellEquivalent $actual $entry.requested
        $null = $results.Add([pscustomobject]@{
          spalte=$entry.spalte; ok=[bool]$good; vorher=$entry.before
          gewuenscht=$entry.requested; ist=$actual
        })
        if (-not $good) {
          $failure = "Zelle in Spalte $($entry.spalte) zeigt '$actual' statt '$($entry.requested)'."
          break
        }
      } catch {
        $failure = "Zelle in Spalte $($entry.spalte) konnte nicht sicher geschrieben/gelesen werden: $($_.Exception.Message)"
        break
      }
    }

    Start-Sleep -Milliseconds 500
    $interactionAfter = Get-SSEInteractionWindowSet $targetPid $hwnd
    if ($lockScreenIsolation -and -not (Test-SSEForegroundIsLockScreen)) {
      if (-not $failure) { $failure = 'Windows-Lockscreen wurde waehrend der Tabellenaktion verlassen.' }
      $interference = $true
    }
    if ($interactionAfter.fingerprint -ne $interactionBefore.fingerprint) {
      if (-not $failure) { $failure = 'Die logische SSE-Fensterlage hat sich waehrend der Tabellenaktion geaendert.' }
      $interference = $true
    }
    $afterTree = $null; $sumAfterRead = $null; $headingAfter = $null
    $checkerAfter = @(); $newCheckerMessages = @()
    if (-not $interference) {
      $afterTree = Walk-Tree $hwnd -WithValues
      $headingAfter = Get-CurrentHeading $hwnd $afterTree
      if ($headingAfter -ne $expectedPage) {
        if (-not $failure) { $failure = "Seite wechselte waehrend der Tabellenaktion zu '$headingAfter'." }
        $interference = $true
      } else {
        $sumAfterRead = Read-LabeledValueFromTree $afterTree $hwnd $sumLabel $sumOccurrence
    if (-not $failure -and -not (Test-SSEScalarEqual $sumAfterRead.value $expectedAfter)) {
          $failure = "Nachsumme '$sumLabel' ist '$($sumAfterRead.value)', erwartet '$expectedAfter'."
        }
      }
    }
    if ($afterTree) {
      $checkerAfter = @(Get-SSEPageCheckerMessages $afterTree $hwnd)
      $newCheckerMessages = @(Compare-SSEPageCheckerMessages $checkerBefore $checkerAfter)
      if ($newCheckerMessages.Count -and -not $failure) {
        $failure = "Neue Pruefermeldung nach Tabellenmutation: $($newCheckerMessages -join ' | ')"
      }
    }

    if ($failure) {
      if ($interference) {
        Emit ([pscustomobject]@{
          ok=$false; kind='interference'; error=$failure
          page=$headingAfter; expectedPage=$expectedPage
          sumBefore=$sumBeforeRead.value; sumAfter=$(if ($sumAfterRead) { $sumAfterRead.value } else { $null })
          checkerMessagesBefore=$checkerBefore; checkerMessagesAfter=$checkerAfter
          newCheckerMessages=$newCheckerMessages
          zellen=@($results); geaenderteSpalten=@($changed | ForEach-Object { $_.spalte })
          tableBinding=[pscustomobject]@{
            sumOccurrence=$sumOccurrence; sumY=$freeRead.targetSumY
            previousSummaryY=$freeRead.previousSummaryY; rowY=$freie[0]
          }
          rollback=[pscustomobject]@{ versucht=$false; grund='Kein blinder Rollback nach fremder Eingabe/Fenster- oder Seitenwechsel.' }
          inputGuard=[pscustomobject]@{
            aktiv=$guardUserInput; lockScreenIsolation=$lockScreenIsolation
            baseline=$inputBaseline; beobachtet=$(Get-SSELastInputTick); eingriffErkannt=$true
          }
        })
      }
      # Vor jeder Ruecksetzung erneut beweisen, dass ausschliesslich unsere
      # geschriebenen Werte in exakt derselben Zeile stehen. Bei fremder
      # Eingabe, Fenster-/Seitenwechsel oder einem dritten Zellwert gibt es
      # weiterhin keinen Rollback.
      $rollbackPreflightError = $null
      $rollbackInputBefore = Get-SSELastInputTick
      $rollbackWindowsBefore = Get-SSEInteractionWindowSet $targetPid $hwnd
      if ($lockScreenIsolation -and -not (Test-SSEForegroundIsLockScreen)) {
        $rollbackPreflightError = 'Windows-Lockscreen wurde vor dem Rollback verlassen.'
      } elseif ($guardUserInput -and $null -ne $inputBaseline -and $null -ne $rollbackInputBefore -and
                $rollbackInputBefore -ne $inputBaseline) {
        $rollbackPreflightError = 'Fremde Benutzereingabe vor dem Rollback erkannt.'
      } elseif ($rollbackWindowsBefore.fingerprint -ne $interactionBefore.fingerprint -or
                $headingAfter -ne $expectedPage) {
        $rollbackPreflightError = 'Fenster- oder Seitenbindung veraenderte sich vor dem Rollback.'
      }
      if (-not $rollbackPreflightError) {
        foreach ($entry in $changed) {
          $live = Get-LiveElement $hwnd $entry.cell.rid
          $livePattern = $null
          if (-not $live -or
              -not $live.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$livePattern) -or
              $livePattern.Current.IsReadOnly) {
            $rollbackPreflightError = "Spalte $($entry.spalte) ist vor dem Rollback nicht mehr gebunden."
            break
          }
          $liveRaw = [string]$livePattern.Current.Value
          $liveDisplay = $liveRaw
          if (-not $liveDisplay) { try { $liveDisplay = [string]$live.Current.Name } catch { } }
          $ownRequested = Test-SSETableCellEquivalent $liveDisplay $entry.requested
          $stillBefore = $liveRaw -eq [string]$entry.beforeRaw -and
            (Test-SSETableCellEquivalent $liveDisplay $entry.before)
          if (-not $ownRequested -and -not $stillBefore) {
            $rollbackPreflightError = "Spalte $($entry.spalte) zeigt vor dem Rollback den fremden/unerwarteten Wert '$liveDisplay'."
            break
          }
        }
      }
      if ($rollbackPreflightError) {
        Emit ([pscustomobject]@{
          ok=$false; kind='interference'; error=$rollbackPreflightError
          originalError=$failure; page=$headingAfter; expectedPage=$expectedPage
          sumBefore=$sumBeforeRead.value; sumAfter=$(if ($sumAfterRead) { $sumAfterRead.value } else { $null })
          checkerMessagesBefore=$checkerBefore; checkerMessagesAfter=$checkerAfter
          newCheckerMessages=$newCheckerMessages
          zellen=@($results); geaenderteSpalten=@($changed | ForEach-Object { $_.spalte })
          tableBinding=[pscustomobject]@{
            sumOccurrence=$sumOccurrence; sumY=$freeRead.targetSumY
            previousSummaryY=$freeRead.previousSummaryY; rowY=$freie[0]
          }
          rollback=[pscustomobject]@{
            versucht=$false; grund='Kein blinder Rollback nach fremder Eingabe/Fenster-/Seiten- oder Zellwertinterferenz.'
            strukturVorher=$structureBefore
          }
        })
      }

      # Nicht den sichtbaren Fallbacknamen ('0,00'), sondern den exakten rohen
      # ValuePattern-Ausgangswert ALLER beschreibbaren Zellen rueckschreiben.
      # Damit verschwindet der von Qt angelegte Datensatz wieder, statt neben
      # der neuen Anlegezeile als zweite leere Zeile stehenzubleiben.
      $rollbackActions = @{}
      foreach ($snapshot in @($rowSnapshotBefore | Sort-Object spalte -Descending)) {
        $attempted = $false; $setError = $null
        try {
          if ($lockScreenIsolation -and -not (Test-SSEForegroundIsLockScreen)) {
            throw 'Windows-Lockscreen wurde waehrend des Rollbacks verlassen.'
          }
          if ($guardUserInput -and -not (Test-SSELastInputUnchanged $inputBaseline)) {
            throw 'Fremde Benutzereingabe waehrend des Rollbacks erkannt.'
          }
          $comboEntry = @($changed | Where-Object {
            $_.mode -eq 'combo' -and [int]$_.spalte -eq [int]$snapshot.spalte
          } | Select-Object -First 1)
          if ($comboEntry.Count) {
            $attempted = $true
            $comboRollback = Invoke-SSETableComboSelection `
              -Hwnd $hwnd -ProcessId $targetPid -ExpectedPage $expectedPage `
              -SumLabel $sumLabel -SumOccurrence $sumOccurrence -RowY $comboEntry[0].rowY -ColumnIndex $comboEntry[0].spalte `
              -TableProfile $comboEntry[0].tableProfile -ColumnProfile $comboEntry[0].columnProfile `
              -ExpectedCurrent $comboEntry[0].requested -Wanted $comboEntry[0].before -CheckerMessagesBefore $checkerBefore `
              -InputBaseline $inputBaseline -GuardUserInput:$guardUserInput -Rollback
            if ($guardUserInput -and $null -ne $comboRollback.inputBaselineAfter) {
              $inputBaseline = $comboRollback.inputBaselineAfter
            }
            if (-not $comboRollback.ok) { throw "Semantischer ComboBox-Rollback fehlgeschlagen: $($comboRollback.error)" }
            $rollbackActions[[int]$snapshot.spalte] = [pscustomobject]@{ attempted=$attempted; error=$null }
            continue
          }
          $live = Get-LiveElement $hwnd $snapshot.cell.rid
          $livePattern = $null
          if (-not $live -or
              -not $live.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$livePattern) -or
              $livePattern.Current.IsReadOnly) {
            throw "Spalte $($snapshot.spalte) ist fuer den strukturellen Rollback nicht mehr gebunden."
          }
          $currentRaw = [string]$livePattern.Current.Value
          if ($currentRaw -ne [string]$snapshot.beforeRaw) {
            $attempted = $true
            $livePattern.SetValue([string]$snapshot.beforeRaw)
            Start-Sleep -Milliseconds 250
          }
        } catch { $setError = $_.Exception.Message }
        $rollbackActions[[int]$snapshot.spalte] = [pscustomobject]@{
          attempted=$attempted; error=$setError
        }
        if ($setError -match 'Benutzereingabe|Lockscreen') { break }
      }
      Start-Sleep -Milliseconds 500
      $rollbackTree = Walk-Tree $hwnd -WithValues
      $rollbackHeading = Get-CurrentHeading $hwnd $rollbackTree
      $rollbackSum = Read-LabeledValueFromTree $rollbackTree $hwnd $sumLabel $sumOccurrence
      $rollbackRead = Find-FreeTableRow $hwnd $rollbackTree $rollbackSum
      $rollbackStructure = Get-TableStructureEvidence $rollbackRead
      $rollbackCheckerMessages = @(Get-SSEPageCheckerMessages $rollbackTree $hwnd)
      $rollbackNewCheckerMessages = @(Compare-SSEPageCheckerMessages $checkerBefore $rollbackCheckerMessages)
      $rollbackWindowsAfter = Get-SSEInteractionWindowSet $targetPid $hwnd
      $rollbackInputAfter = Get-SSELastInputTick
      $rollbackStructureOk = [bool](
        $rollbackStructure.ok -and
        $rollbackStructure.rowCount -eq $structureBefore.rowCount -and
        $rollbackStructure.freeRowCount -eq $structureBefore.freeRowCount -and
        $rollbackStructure.populatedRowCount -eq $structureBefore.populatedRowCount -and
        $rollbackStructure.fingerprint -eq $structureBefore.fingerprint -and
        $rollbackStructure.endRowFingerprint -eq $structureBefore.endRowFingerprint
      )

      # Zellbeweis auf der wiederhergestellten Anlegezeile. Selbst wenn Qt die
      # UIA-Elemente beim strukturellen Entfernen neu erzeugt, werden die rohen
      # Werte spaltenweise aus dem frischen Endzustand gelesen.
      $rollbackCells = New-Object System.Collections.ArrayList
      $rollbackFinalRow = @()
      if ($rollbackRead.ok -ne $false -and @($rollbackRead.free).Count) {
        $rollbackFreeY = @($rollbackRead.free | Sort-Object -Descending)[0]
        $rollbackFinalRow = @($rollbackRead.byY[$rollbackFreeY] | Sort-Object x)
      }
      foreach ($snapshot in $rowSnapshotBefore) {
        $actualRaw = $null; $actualDisplay = $null; $readError = $null
        try {
          if ($snapshot.spalte -ge $rollbackFinalRow.Count) { throw 'Zelle fehlt in der wiederhergestellten Anlegezeile.' }
          $finalCell = $rollbackFinalRow[$snapshot.spalte]
          $finalElement = Get-LiveElement $hwnd $finalCell.rid
          $finalPattern = $null
          if (-not $finalElement -or
              -not $finalElement.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$finalPattern)) {
            throw 'ValuePattern der wiederhergestellten Zelle fehlt.'
          }
          $actualRaw = [string]$finalPattern.Current.Value
          $actualDisplay = [string]$finalElement.Current.Name
        } catch { $readError = $_.Exception.Message }
        $action = $rollbackActions[[int]$snapshot.spalte]
        $restored = [bool](
          -not $readError -and $actualRaw -eq [string]$snapshot.beforeRaw -and
          $actualDisplay -eq [string]$snapshot.beforeDisplay -and
          (-not $action -or -not $action.error)
        )
        $null = $rollbackCells.Add([pscustomobject]@{
          spalte=$snapshot.spalte; erwartetRaw=$snapshot.beforeRaw; istRaw=$actualRaw
          erwartetAnzeige=$snapshot.beforeDisplay; istAnzeige=$actualDisplay
          attempted=$(if ($action) { $action.attempted } else { $false })
          restored=$restored; error=$(if ($action -and $action.error) { $action.error } else { $readError })
        })
      }
      $rollbackInteractionOk = [bool](
        $rollbackHeading -eq $expectedPage -and
        $rollbackWindowsAfter.fingerprint -eq $interactionBefore.fingerprint -and
        (-not $lockScreenIsolation -or (Test-SSEForegroundIsLockScreen)) -and
        (-not $guardUserInput -or $null -eq $inputBaseline -or $null -eq $rollbackInputAfter -or
          $rollbackInputAfter -eq $inputBaseline)
      )
      $rollbackOk = [bool](
        (Test-SSEScalarEqual $rollbackSum.value $expectedBefore) -and
        $rollbackNewCheckerMessages.Count -eq 0 -and
        $rollbackStructureOk -and $rollbackInteractionOk -and
        @($rollbackCells | Where-Object { -not $_.restored }).Count -eq 0
      )
      Emit ([pscustomobject]@{
        ok=$false; kind=$(if ($failureKind) { $failureKind } else { 'postcondition-failed' }); error=$failure
        page=$headingAfter; expectedPage=$expectedPage
        sumBefore=$sumBeforeRead.value; sumAfter=$(if ($sumAfterRead) { $sumAfterRead.value } else { $null })
        checkerMessagesBefore=$checkerBefore; checkerMessagesAfter=$checkerAfter
        newCheckerMessages=$newCheckerMessages
        zellen=@($results)
        tableBinding=[pscustomobject]@{
          sumOccurrence=$sumOccurrence; sumY=$freeRead.targetSumY
          previousSummaryY=$freeRead.previousSummaryY; rowY=$freie[0]
        }
        rollback=[pscustomobject]@{
          versucht=$true; methode='raw-value-row-restore'; erfolgreich=$rollbackOk
          ausgangszustandBewiesen=$rollbackOk; strukturEntfernt=$rollbackStructureOk
          summe=$rollbackSum.value
          erwarteteSumme=$expectedBefore; zellen=@($rollbackCells)
          checkerMessages=$rollbackCheckerMessages; newCheckerMessages=$rollbackNewCheckerMessages
          strukturVorher=$structureBefore; strukturNachher=$rollbackStructure
          interactionOk=$rollbackInteractionOk
        }
      })
    }

    Emit ([pscustomobject]@{
      ok=$true; verified=$true; page=$headingAfter
      zeileY=$freie[0]; navigationSteps=$navigationSteps; zellen=@($results)
      sumLabel=$sumLabel; sumBefore=$sumBeforeRead.value; sumAfter=$sumAfterRead.value
      checkerMessagesBefore=$checkerBefore; checkerMessagesAfter=$checkerAfter
      newCheckerMessages=$newCheckerMessages
      tableBinding=[pscustomobject]@{
        sumOccurrence=$sumOccurrence; sumY=$freeRead.targetSumY
        previousSummaryY=$freeRead.previousSummaryY; rowY=$freie[0]
      }
      ungespeichertVorher=$dirtyBefore; ungespeichertNachher=$(Get-DirtyState $afterTree)
      inputGuard=[pscustomobject]@{
        aktiv=$guardUserInput; lockScreenIsolation=$lockScreenIsolation
        baseline=$inputBaseline; beobachtet=$(Get-SSELastInputTick); eingriffErkannt=$false
      }
    })
  }

  'table_update' {
    # Sichtbare Tabellenzeile rein ueber ValuePattern aktualisieren. Seite,
    # Summenregion, Zielzeile und alle Zellen werden vorab gebunden. Eigene
    # normale Nachbedingungsfehler werden transaktional zurueckgesetzt; nach
    # fremder Eingabe/Fenster-/Seitenwechsel kein blinder Rollback.
    $hwnd = [IntPtr][int64](Resolve-SSEMainWindowDescriptor $a -RestoreMinimized).hwnd
    $expectedPage = [string](Arg $a 'expectedPage')
    $text = [string](Arg $a 'text')
    $werte = @(Arg $a 'werte')
    $sumLabel = [string](Arg $a 'sumLabel')
    $expectedBefore = [string](Arg $a 'expectedBefore')
    $expectedAfter = [string](Arg $a 'expectedAfter')
    $sumOccurrence = [int](Arg $a 'sumOccurrence' 1)
    if (-not $expectedPage -or -not $text -or -not $werte.Count) { Fail 'expectedPage, text und werte sind Pflicht.' 'bad-args' }
    if (-not $sumLabel -or -not $expectedBefore -or -not $expectedAfter) {
      Fail 'sumLabel, expectedBefore und expectedAfter sind fuer eine sichere Aktualisierung Pflicht.' 'bad-args'
    }
    if (-not @($werte | Where-Object { $null -ne $_ }).Count) {
      Fail 'werte enthaelt keine zu aktualisierende Spalte.' 'bad-args'
    }
    $targetPid = 0
    [SW]::GetWindowThreadProcessId($hwnd, [ref]$targetPid) | Out-Null
    $dialogsBefore = @(Get-DialogInventory | Where-Object {
      [int]$_.pid -eq $targetPid -and $_.kind -in @('native-dialog','qt-dialog')
    })
    if ($dialogsBefore.Count) { Fail 'Ein modaler Dialog ist offen; Aktualisierung nicht begonnen.' 'precondition-failed' }

    $beforeTree = Walk-Tree $hwnd -WithValues
    $headingBefore = Get-CurrentHeading $hwnd $beforeTree
    if ($headingBefore -ne $expectedPage) {
      Fail "Vorbedingung verletzt: aktuelle Seite ist '$headingBefore', erwartet '$expectedPage'. NICHT geaendert." 'precondition-failed'
    }
    $beforeRead = Read-LabeledValueFromTree $beforeTree $hwnd $sumLabel $sumOccurrence
    if (-not $beforeRead.selected -or -not (Test-SSEScalarEqual $beforeRead.value $expectedBefore)) {
      Fail "Vorbedingung verletzt: '$sumLabel' ist '$($beforeRead.value)', erwartet '$expectedBefore'. NICHT geaendert." 'precondition-failed'
    }
    $checkerBefore = @(Get-SSEPageCheckerMessages $beforeTree $hwnd)
    $region = Get-SSETableRegion $beforeTree $hwnd $beforeRead
    if (-not $region.ok) {
      Fail "Tabellenregion fuer '$sumLabel' nicht eindeutig: $($region.error) NICHT geaendert." 'precondition-failed'
    }
    $matches = @($region.cells | Where-Object { $_.name -eq $text -and $_.aid -notmatch 'WerteInfo' })
    if (-not $matches.Count) { Fail "Keine sichtbare Tabellenzelle mit '$text' gefunden." 'not-found' }
    if ($matches.Count -ne 1) { Fail "$($matches.Count) Zellen mit '$text' gefunden; Zielzeile ist nicht eindeutig." 'ambiguous' }
    $target = $matches[0]
    $cells = @($region.cells | Where-Object {
      [Math]::Abs($_.y - $target.y) -le 4 -and $_.aid -notmatch 'WerteInfo'
    } | Sort-Object x)
    if ($werte.Count -gt $cells.Count) {
      Fail "werte enthaelt $($werte.Count) Spalten, die sichtbare Zeile aber nur $($cells.Count)." 'bad-args'
    }
    $tableProfile = Resolve-SSETableProfile $headingBefore $sumLabel $sumOccurrence $region
    if ($tableProfile.known -and -not $tableProfile.bindingOk) {
      Fail "$($tableProfile.reason) Tabellenprofil '$($tableProfile.pageId)/$($tableProfile.tableId)' nicht gebunden. NICHT geaendert." 'table-profile-mismatch'
    }

    # Alle Zielzellen muessen vor der ersten Mutation gleichzeitig schreibbar
    # und mit ihrem aktuellen Wert gebunden sein.
    $prepared = New-Object System.Collections.ArrayList
    $unsupportedComboCells = New-Object System.Collections.ArrayList
    for ($i = 0; $i -lt $werte.Count; $i++) {
      if ($null -eq $werte[$i]) { continue }
      $requested = [string]$werte[$i]
      $cell = $cells[$i]
      $el = Get-LiveElement $hwnd $cell.rid
      if (-not $el) { Fail "Spalte $i der Zielzeile ist nicht mehr gebunden; nichts geaendert." 'stale' }
      $columnProfile = Get-SSETableProfileColumn $tableProfile $i
      if ($columnProfile -and [string]$columnProfile.controlType -eq 'ComboBox') {
        $beforeValue = Get-SSETableComboCellValue $el $cell
        if ([string]$columnProfile.writePolicy -eq 'typed-selection-required') {
          $expectedCombo = Get-SSETableComboExpectedBefore $a $i
          if (-not $expectedCombo.present) {
            Fail "comboExpectedBefore.$i ist fuer die profilierte ComboBox-Spalte '$([string]$columnProfile.header)' Pflicht. NICHT geaendert." 'bad-args'
          }
          if (-not [string]::Equals($beforeValue, [string]$expectedCombo.value, [StringComparison]::Ordinal)) {
            Fail "ComboBox-Vorwert in Spalte $i ist '$beforeValue', erwartet '$($expectedCombo.value)'. NICHT geaendert." 'precondition-failed'
          }
          $invokeProbe = $null
          if (-not $el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokeProbe)) {
            Fail "Profilierte ComboBox-Spalte $i bietet kein InvokePattern. NICHT geaendert." 'unsupported-table-combobox'
          }
          $null = $prepared.Add([pscustomobject]@{
            spalte=$i; requested=$requested; before=$beforeValue; mode='combo'
            cell=$cell; rowY=[int]$target.y; tableProfile=$tableProfile; columnProfile=$columnProfile
          })
        } else {
          $null = $unsupportedComboCells.Add([pscustomobject]@{
            spalte=$i; header=[string]$columnProfile.header; controlType='ComboBox'
            observedControlType=[string]$cell.type; requested=$requested; current=$beforeValue
            rid=$cell.rid; aid=$cell.aid; reason=[string]$columnProfile.reason
          })
        }
        continue
      }
      $toggleRequested = $null
      if ($requested -match '^(?i:true|false)$') { $toggleRequested = $requested.ToLowerInvariant() -eq 'true' }
      $tp = $null
      if ($null -ne $toggleRequested -and $el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$tp)) {
        $toggleBeforeRaw = [string]$tp.Current.ToggleState
        if ($toggleBeforeRaw -notin @('On','Off')) {
          Fail "Spalte $i hat keinen eindeutigen Toggle-Ausgangszustand; nichts geaendert." 'precondition-failed'
        }
        $old = $(if ($toggleBeforeRaw -eq 'On') { 'true' } else { 'false' })
        $mode = 'toggle'
      } else {
        $vp = $null
        if (-not $el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp) -or $vp.Current.IsReadOnly) {
          Fail "Spalte $i ist weder als boolesche Toggle-Zelle noch per ValuePattern beschreibbar; nichts geaendert." 'no-value-pattern'
        }
        $old = $vp.Current.Value; if ($null -eq $old -or $old -eq '') { $old = $cell.name }
        $mode = 'value'
      }
      $null = $prepared.Add([pscustomobject]@{
        spalte=$i; requested=$(if ($mode -eq 'toggle') { $requested.ToLowerInvariant() } else { $requested })
        before=[string]$old; cell=$cell; mode=$mode
      })
    }
    if ($unsupportedComboCells.Count) {
      Emit ([pscustomobject]@{
        ok=$false; kind='unsupported-table-combobox'
        error='Tabellen-ComboBox erkannt. Ohne zeilen- und optionsgebundene semantische Auswahl wird vor der ersten Datenmutation abgebrochen.'
        page=$headingBefore; expectedPage=$expectedPage; ziel=$text; mutationStarted=$false
        unsupportedCells=@($unsupportedComboCells)
        supportedCellTypes=@('Edit','Spinner','DataItem','Toggle')
        requiredCapability='typed-table-combobox-selection'
        checkerMessagesBefore=$checkerBefore
        tableBinding=[pscustomobject]@{
          sumLabel=$sumLabel; sumOccurrence=$sumOccurrence; sumY=$region.targetSumY
          previousSummaryY=$region.previousSummaryY; rowY=$target.y; targetRid=$target.rid
          pageObjectId=$tableProfile.pageId; tableObjectId=$tableProfile.tableId
          selectionMethod=$region.selectionMethod; scopePrefix=$region.scopePrefix
          bindingStrength=$tableProfile.bindingStrength; aidFallback=[bool]$tableProfile.aidFallback
        }
        rollback=[pscustomobject]@{ versucht=$false; grund='Fail-closed vor der ersten Datenmutation; kein Rollback erforderlich.' }
      })
    }

    $dirtyBefore = Get-DirtyState $beforeTree
    $lockScreenIsolation = [bool](-not $script:DESKTOP_NAME -and (Test-SSEForegroundIsLockScreen))
    $guardUserInput = [bool](-not $script:DESKTOP_NAME -and -not $lockScreenIsolation)
    $inputBaseline = $(if ($guardUserInput) { Get-SSELastInputTick } else { $null })
    $interactionBefore = Get-SSEInteractionWindowSet $targetPid $hwnd
    $changed = New-Object System.Collections.ArrayList
    $results = New-Object System.Collections.ArrayList
    $failure = $null; $failureKind = $null; $interference = $false

    foreach ($entry in @($prepared | Sort-Object @{ Expression = { if ($_.mode -eq 'combo') { 0 } else { 1 } } }, spalte)) {
      if ($lockScreenIsolation -and -not (Test-SSEForegroundIsLockScreen)) {
        $failure = 'Windows-Lockscreen wurde waehrend der Zellaktualisierung verlassen.'
        $interference = $true; break
      }
      if ($guardUserInput -and -not (Test-SSELastInputUnchanged $inputBaseline)) {
        $failure = 'Fremde Benutzereingabe unmittelbar vor einer Zellaktualisierung erkannt.'
        $interference = $true; break
      }
      if ($entry.mode -eq 'combo') {
        $comboResult = Invoke-SSETableComboSelection `
          -Hwnd $hwnd -ProcessId $targetPid -ExpectedPage $expectedPage `
          -SumLabel $sumLabel -SumOccurrence $sumOccurrence -RowY $entry.rowY -ColumnIndex $entry.spalte `
          -TableProfile $entry.tableProfile -ColumnProfile $entry.columnProfile `
          -ExpectedCurrent $entry.before -Wanted $entry.requested -CheckerMessagesBefore $checkerBefore `
          -InputBaseline $inputBaseline -GuardUserInput:$guardUserInput
        if ($guardUserInput -and $null -ne $comboResult.inputBaselineAfter) {
          $inputBaseline = $comboResult.inputBaselineAfter
        }
        $comboDiagnostic = Get-SSETableComboDiagnosticProjection $comboResult
        $null = $results.Add([pscustomobject]@{
          spalte=$entry.spalte; vorher=$entry.before; gewuenscht=$entry.requested; ist=$comboResult.after
          methode=$comboResult.method; ok=[bool]$comboResult.ok; internalSelected=$comboResult.internalSelected
          error=$comboDiagnostic.error; kind=$comboDiagnostic.kind
          mutationStarted=$comboDiagnostic.mutationStarted; interference=$comboDiagnostic.interference
          editorClosed=$comboDiagnostic.editorClosed
          popupBinding=$comboDiagnostic.popupBinding; openEvidence=$comboDiagnostic.openEvidence
          diagnosticBounds=$comboDiagnostic.diagnosticBounds
          newCheckerMessages=$comboResult.newCheckerMessages
        })
        if ($comboResult.ok) {
          $entry | Add-Member -NotePropertyName mutationMethod -NotePropertyValue $comboResult.method -Force
          if ($comboResult.mutationStarted) { $null = $changed.Add($entry) }
          continue
        }
        $failure = [string]$comboResult.error
        $failureKind = [string]$comboDiagnostic.kind
        $interference = [bool]$comboResult.interference
        if ($comboResult.mutationStarted -and
            -not ($comboResult.rollback -and $comboResult.rollback.erfolgreich) -and
            [string]::Equals([string]$comboResult.after, [string]$entry.requested, [StringComparison]::Ordinal)) {
          $null = $changed.Add($entry)
        }
        break
      }
      $live = Get-LiveElement $hwnd $entry.cell.rid
      $livePattern = $null; $liveBefore = $null
      if (-not $live) {
        $failure = "Spalte $($entry.spalte) ist unmittelbar vor dem Schreiben nicht mehr gebunden."
        $interference = $true; break
      }
      if ($entry.mode -eq 'toggle') {
        if (-not $live.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$livePattern) -or
            [string]$livePattern.Current.ToggleState -notin @('On','Off')) {
          $failure = "Toggle-Spalte $($entry.spalte) ist unmittelbar vor dem Schreiben nicht mehr eindeutig gebunden."
          $interference = $true; break
        }
        $liveBefore = $(if ([string]$livePattern.Current.ToggleState -eq 'On') { 'true' } else { 'false' })
      } else {
        if (-not $live.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$livePattern) -or $livePattern.Current.IsReadOnly) {
          $failure = "Wert-Spalte $($entry.spalte) ist unmittelbar vor dem Schreiben nicht mehr gebunden."
          $interference = $true; break
        }
        $liveBefore = [string]$livePattern.Current.Value
        if (-not $liveBefore) { try { $liveBefore = [string]$live.Current.Name } catch { } }
      }
      if (-not (Test-SSETableCellEquivalent $liveBefore $entry.before)) {
        $failure = "Spalte $($entry.spalte) wurde zwischen Vorpruefung und Schreiben veraendert."
        $interference = $true; break
      }
      try {
        $entry | Add-Member -NotePropertyName pattern -NotePropertyValue $livePattern
        $null = $changed.Add($entry)
        if ($entry.mode -eq 'toggle') {
          $mutationMethod = 'noop-already-target'
          if (-not (Test-SSETableCellEquivalent $liveBefore $entry.requested)) {
            $livePattern.Toggle(); $mutationMethod = 'toggle-pattern'
            Start-Sleep -Milliseconds 300
            $probeState = $(if ([string]$livePattern.Current.ToggleState -eq 'On') { 'true' } else { 'false' })
            if (-not (Test-SSETableCellEquivalent $probeState $entry.requested) -and
                (Test-SSETableCellEquivalent $probeState $liveBefore)) {
              if ($script:DESKTOP_NAME) {
                throw 'TogglePattern blieb wirkungslos; verifizierter Zellklick ist auf dem versteckten Desktop nicht verfuegbar.'
              }
              if ($guardUserInput -and -not (Test-SSELastInputUnchanged $inputBaseline)) {
                $failure = 'Fremde Benutzereingabe vor dem verifizierten Toggle-Zellklick erkannt.'
                $interference = $true; break
              }
              $rect = $live.Current.BoundingRectangle
              $clickNode = [pscustomobject]@{
                x=[int]$rect.X; y=[int]$rect.Y; w=[int]$rect.Width; h=[int]$rect.Height
                name=$entry.cell.name; rid=$entry.cell.rid; aid=$entry.cell.aid; source='uia'
              }
              $null = Click-VerifiedPoint $hwnd $clickNode
              if ($guardUserInput) { $inputBaseline = Get-SSELastInputTick }
              $mutationMethod = 'verified-cell-click'
            }
          }
          $entry | Add-Member -NotePropertyName mutationMethod -NotePropertyValue $mutationMethod
        } else {
          $livePattern.SetValue($entry.requested)
          $entry | Add-Member -NotePropertyName mutationMethod -NotePropertyValue 'value-pattern'
        }
        Start-Sleep -Milliseconds 350
        if ($lockScreenIsolation -and -not (Test-SSEForegroundIsLockScreen)) {
          $failure = 'Windows-Lockscreen wurde nach einer Zellaktualisierung verlassen.'
          $interference = $true; break
        }
        if ($guardUserInput -and -not (Test-SSELastInputUnchanged $inputBaseline)) {
          $failure = 'Fremde Benutzereingabe nach einer Zellaktualisierung erkannt.'
          $interference = $true; break
        }
        $fresh = Get-LiveElement $hwnd $entry.cell.rid
        $actual = $null; $freshPattern = $null
        if ($entry.mode -eq 'toggle') {
          if ($fresh -and $fresh.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$freshPattern) -and
              [string]$freshPattern.Current.ToggleState -in @('On','Off')) {
            $actual = $(if ([string]$freshPattern.Current.ToggleState -eq 'On') { 'true' } else { 'false' })
          }
        } else {
          if ($fresh -and $fresh.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$freshPattern)) {
            $actual = [string]$freshPattern.Current.Value
          }
          if (-not $actual -and $fresh) { try { $actual = [string]$fresh.Current.Name } catch { } }
        }
        $good = Test-SSETableCellEquivalent $actual $entry.requested
        $null = $results.Add([pscustomobject]@{
          spalte=$entry.spalte; vorher=$entry.before; gewuenscht=$entry.requested; ist=$actual
          methode=$entry.mutationMethod; ok=[bool]$good
        })
        if (-not $good) { $failure = "Spalte $($entry.spalte) zeigt '$actual' statt '$($entry.requested)'."; break }
      } catch {
        $failure = "Spalte $($entry.spalte) konnte nicht sicher geschrieben/gelesen werden: $($_.Exception.Message)"
        break
      }
    }

    Start-Sleep -Milliseconds 500
    $interactionAfter = Get-SSEInteractionWindowSet $targetPid $hwnd
    if ($lockScreenIsolation -and -not (Test-SSEForegroundIsLockScreen)) {
      if (-not $failure) { $failure = 'Windows-Lockscreen wurde waehrend der Tabellenaktualisierung verlassen.' }
      $interference = $true
    }
    if ($interactionAfter.fingerprint -ne $interactionBefore.fingerprint) {
      if (-not $failure) { $failure = 'Die logische SSE-Fensterlage hat sich waehrend der Tabellenaktualisierung geaendert.' }
      $interference = $true
    }
    if ($guardUserInput -and -not (Test-SSELastInputUnchanged $inputBaseline)) {
      if (-not $failure) { $failure = 'Fremde Benutzereingabe waehrend der Tabellenaktualisierung erkannt.' }
      $interference = $true
    }

    $afterTree = $null; $afterRead = $null; $headingAfter = $null
    $checkerAfter = @(); $newCheckerMessages = @()
    if (-not $interference) {
      $afterTree = Walk-Tree $hwnd -WithValues
      $headingAfter = Get-CurrentHeading $hwnd $afterTree
      if ($headingAfter -ne $expectedPage) {
        if (-not $failure) { $failure = "Seite wechselte waehrend der Tabellenaktualisierung zu '$headingAfter'." }
        $interference = $true
      } else {
        $afterRead = Read-LabeledValueFromTree $afterTree $hwnd $sumLabel $sumOccurrence
        if (-not $failure -and (-not $afterRead.selected -or -not (Test-SSEScalarEqual $afterRead.value $expectedAfter))) {
          $failure = "Nachsumme '$sumLabel' ist '$($afterRead.value)', erwartet '$expectedAfter'."
        }
      }
    }
    if ($afterTree) {
      $checkerAfter = @(Get-SSEPageCheckerMessages $afterTree $hwnd)
      $newCheckerMessages = @(Compare-SSEPageCheckerMessages $checkerBefore $checkerAfter)
      if ($newCheckerMessages.Count -and -not $failure) {
        $failure = "Neue Pruefermeldung nach Tabellenmutation: $($newCheckerMessages -join ' | ')"
      }
    }

    $binding = [pscustomobject]@{
      sumOccurrence=$sumOccurrence; sumY=$region.targetSumY
      previousSummaryY=$region.previousSummaryY; rowY=$target.y; targetRid=$target.rid
    }
    if ($failure) {
      if ($interference) {
        Emit ([pscustomobject]@{
          ok=$false; kind='interference'; error=$failure
          page=$headingAfter; expectedPage=$expectedPage; ziel=$text
          summeVorher=$beforeRead.value; summeNachher=$(if ($afterRead) { $afterRead.value } else { $null })
          checkerMessagesBefore=$checkerBefore; checkerMessagesAfter=$checkerAfter
          newCheckerMessages=$newCheckerMessages
          zellen=@($results); geaenderteSpalten=@($changed | ForEach-Object { $_.spalte })
          tableBinding=$binding
          inputGuard=[pscustomobject]@{
            aktiv=$guardUserInput; lockScreenIsolation=$lockScreenIsolation
            baseline=$inputBaseline; beobachtet=$(Get-SSELastInputTick); eingriffErkannt=$true
          }
          windowGuard=[pscustomobject]@{ vorher=$interactionBefore.fingerprint; nachher=$interactionAfter.fingerprint; geaendert=[bool]($interactionBefore.fingerprint -ne $interactionAfter.fingerprint) }
          rollback=[pscustomobject]@{ versucht=$false; grund='Kein blinder Rollback nach fremder Eingabe/Fenster- oder Seitenwechsel.' }
        })
      }

      # Vor irgendeinem Rollback alle geaenderten Zellen gemeinsam erneut
      # pruefen. Ein fremder Wert stoppt den gesamten Rollback, bevor auch nur
      # eine Zelle zurueckgeschrieben wird.
      $rollbackPrepared = New-Object System.Collections.ArrayList
      $rollbackInterference = $false; $rollbackReason = $null
      foreach ($entry in $changed) {
        $live = $null; $rollbackPattern = $null; $current = $null
        if ($entry.mode -eq 'combo') {
          $comboState = Read-SSETableComboCellState $hwnd $expectedPage $sumLabel $sumOccurrence $entry.rowY $entry.spalte $entry.tableProfile
          if (-not $comboState.ok) {
            $rollbackInterference=$true; $rollbackReason="ComboBox-Spalte $($entry.spalte) ist vor Rollback nicht mehr gebunden: $($comboState.error)"; break
          }
          $current = [string]$comboState.value
        } else {
          $live = Get-LiveElement $hwnd $entry.cell.rid
          if (-not $live) {
            $rollbackInterference=$true; $rollbackReason="Spalte $($entry.spalte) ist vor Rollback nicht mehr gebunden."; break
          }
        }
        if ($entry.mode -eq 'toggle') {
          if (-not $live.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$rollbackPattern) -or
              [string]$rollbackPattern.Current.ToggleState -notin @('On','Off')) {
            $rollbackInterference=$true; $rollbackReason="Toggle-Spalte $($entry.spalte) ist vor Rollback nicht eindeutig gebunden."; break
          }
          $current = $(if ([string]$rollbackPattern.Current.ToggleState -eq 'On') { 'true' } else { 'false' })
        } elseif ($entry.mode -eq 'value') {
          if (-not $live.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$rollbackPattern) -or $rollbackPattern.Current.IsReadOnly) {
            $rollbackInterference=$true; $rollbackReason="Wert-Spalte $($entry.spalte) ist vor Rollback nicht gebunden."; break
          }
          $current = [string]$rollbackPattern.Current.Value
          if (-not $current) { try { $current=[string]$live.Current.Name } catch { } }
        }
        $needsRollback = Test-SSETableCellEquivalent $current $entry.requested
        $alreadyBefore = Test-SSETableCellEquivalent $current $entry.before
        if (-not $needsRollback -and -not $alreadyBefore) {
          $rollbackInterference=$true; $rollbackReason="Spalte $($entry.spalte) zeigt vor Rollback einen fremden Wert '$current'."; break
        }
        $null=$rollbackPrepared.Add([pscustomobject]@{ entry=$entry; pattern=$rollbackPattern; current=$current; needsRollback=[bool]$needsRollback })
      }
      $rollbackWindows = Get-SSEInteractionWindowSet $targetPid $hwnd
      if ($rollbackWindows.fingerprint -ne $interactionBefore.fingerprint -or
          ($guardUserInput -and -not (Test-SSELastInputUnchanged $inputBaseline))) {
        $rollbackInterference=$true; $rollbackReason='Fensterlage oder Benutzereingabe veraenderte sich vor Rollback.'
      }
      if ($rollbackInterference) {
        Emit ([pscustomobject]@{
          ok=$false; kind='interference'; error=$rollbackReason
          page=$headingAfter; expectedPage=$expectedPage; ziel=$text
          summeVorher=$beforeRead.value; summeNachher=$(if ($afterRead) { $afterRead.value } else { $null })
          checkerMessagesBefore=$checkerBefore; checkerMessagesAfter=$checkerAfter
          newCheckerMessages=$newCheckerMessages
          zellen=@($results); geaenderteSpalten=@($changed | ForEach-Object { $_.spalte }); tableBinding=$binding
          rollback=[pscustomobject]@{ versucht=$false; grund='Kein blinder Rollback nach fremdem Zellwert/Eingabe/Fensterwechsel.' }
        })
      }

      $rollbackCells = New-Object System.Collections.ArrayList
      foreach ($item in @($rollbackPrepared | Sort-Object { $_.entry.spalte } -Descending)) {
        $restored=$true; $actualRollback=$item.current; $rollbackError=$null
        if ($item.needsRollback) {
          try {
            if ($item.entry.mode -eq 'combo') {
              $comboRollback = Invoke-SSETableComboSelection `
                -Hwnd $hwnd -ProcessId $targetPid -ExpectedPage $expectedPage `
                -SumLabel $sumLabel -SumOccurrence $sumOccurrence -RowY $item.entry.rowY -ColumnIndex $item.entry.spalte `
                -TableProfile $item.entry.tableProfile -ColumnProfile $item.entry.columnProfile `
                -ExpectedCurrent $item.entry.requested -Wanted $item.entry.before -CheckerMessagesBefore $checkerBefore `
                -InputBaseline $inputBaseline -GuardUserInput:$guardUserInput -Rollback
              if ($guardUserInput -and $null -ne $comboRollback.inputBaselineAfter) {
                $inputBaseline = $comboRollback.inputBaselineAfter
              }
              if (-not $comboRollback.ok) { throw $comboRollback.error }
              $actualRollback=[string]$comboRollback.after
            } elseif ($item.entry.mode -eq 'toggle') {
              if ($item.entry.mutationMethod -eq 'verified-cell-click') {
                $rollbackLive = Get-LiveElement $hwnd $item.entry.cell.rid
                if (-not $rollbackLive) { throw 'Toggle-Zelle ist fuer den verifizierten Rollback-Klick verschwunden.' }
                $rollbackRect = $rollbackLive.Current.BoundingRectangle
                $rollbackNode = [pscustomobject]@{
                  x=[int]$rollbackRect.X; y=[int]$rollbackRect.Y; w=[int]$rollbackRect.Width; h=[int]$rollbackRect.Height
                  name=$item.entry.cell.name; rid=$item.entry.cell.rid; aid=$item.entry.cell.aid; source='uia'
                }
                $null = Click-VerifiedPoint $hwnd $rollbackNode
                if ($guardUserInput) { $inputBaseline = Get-SSELastInputTick }
              } else {
                $item.pattern.Toggle()
              }
              Start-Sleep -Milliseconds 250
              $actualRollback=$(if ([string]$item.pattern.Current.ToggleState -eq 'On') { 'true' } else { 'false' })
            } else {
              $item.pattern.SetValue($item.entry.before); Start-Sleep -Milliseconds 250
              $actualRollback=[string]$item.pattern.Current.Value
              if (-not $actualRollback) {
                $live=Get-LiveElement $hwnd $item.entry.cell.rid
                if ($live) { try { $actualRollback=[string]$live.Current.Name } catch { } }
              }
            }
            $restored=Test-SSETableCellEquivalent $actualRollback $item.entry.before
          } catch { $restored=$false; $rollbackError=$_.Exception.Message }
        }
        $null=$rollbackCells.Add([pscustomobject]@{
          spalte=$item.entry.spalte; erwartet=$item.entry.before; ist=$actualRollback
          restored=[bool]$restored; error=$rollbackError
        })
      }
      Start-Sleep -Milliseconds 500
      $rollbackTree=Walk-Tree $hwnd -WithValues
      $rollbackHeading=Get-CurrentHeading $hwnd $rollbackTree
      $rollbackSum=Read-LabeledValueFromTree $rollbackTree $hwnd $sumLabel $sumOccurrence
      $rollbackCheckerMessages = @(Get-SSEPageCheckerMessages $rollbackTree $hwnd)
      $rollbackNewCheckerMessages = @(Compare-SSEPageCheckerMessages $checkerBefore $rollbackCheckerMessages)
      $rollbackWindowsAfter=Get-SSEInteractionWindowSet $targetPid $hwnd
      $rollbackOk=[bool](
        $rollbackHeading -eq $expectedPage -and
        $rollbackWindowsAfter.fingerprint -eq $interactionBefore.fingerprint -and
        (-not $guardUserInput -or (Test-SSELastInputUnchanged $inputBaseline)) -and
        (Test-SSEScalarEqual $rollbackSum.value $expectedBefore) -and
        $rollbackNewCheckerMessages.Count -eq 0 -and
        @($rollbackCells | Where-Object { -not $_.restored }).Count -eq 0
      )
      Emit ([pscustomobject]@{
        ok=$false; kind=$(if ($failureKind) { $failureKind } else { 'postcondition-failed' }); error=$failure
        page=$rollbackHeading; expectedPage=$expectedPage; ziel=$text
        summeVorher=$beforeRead.value; summeNachher=$(if ($afterRead) { $afterRead.value } else { $null })
        checkerMessagesBefore=$checkerBefore; checkerMessagesAfter=$checkerAfter
        newCheckerMessages=$newCheckerMessages
        zellen=@($results); tableBinding=$binding
        rollback=[pscustomobject]@{
          versucht=$true; erfolgreich=$rollbackOk; summe=$rollbackSum.value
          erwarteteSumme=$expectedBefore; zellen=@($rollbackCells)
          checkerMessages=$rollbackCheckerMessages; newCheckerMessages=$rollbackNewCheckerMessages
        }
      })
    }

    Emit ([pscustomobject]@{
      ok=$true; verified=$true; ziel=$text; page=$headingAfter
      summeVorher=$beforeRead.value; summeNachher=$afterRead.value
      checkerMessagesBefore=$checkerBefore; checkerMessagesAfter=$checkerAfter
      newCheckerMessages=$newCheckerMessages
      zellen=@($results); tableBinding=$binding
      ungespeichertVorher=$dirtyBefore; ungespeichertNachher=$(Get-DirtyState $afterTree)
      inputGuard=[pscustomobject]@{
        aktiv=$guardUserInput; lockScreenIsolation=$lockScreenIsolation
        baseline=$inputBaseline; beobachtet=$(Get-SSELastInputTick); eingriffErkannt=$false
      }
      versteckterDesktop=[bool]$script:DESKTOP_NAME
    })
  }

  'table_delete' {
    # Zeile loeschen, in der eine Zelle den angegebenen Text traegt.
    #
    # SICHERHEIT: Ctrl+Shift+Delete loescht in Qt nicht nur die aktive Zeile,
    # sondern alle noch markierten Zeilen. Deshalb ist eine Loeschung nur mit
    # einer exakten Vor-/Nachbedingung erlaubt. Bei jeder Abweichung wird
    # sofort Ctrl+Z gesendet und die Wiederherstellung ebenfalls geprueft.
    $hwnd = [IntPtr][int64](Resolve-SSEMainWindowDescriptor $a -RestoreMinimized).hwnd
    $expectedPage = [string](Arg $a 'expectedPage')
    $text = [string](Arg $a 'text')
    if (-not $expectedPage -or -not $text) { Fail 'expectedPage und text sind Pflicht.' 'bad-args' }
    $sumLabel = [string](Arg $a 'sumLabel')
    $expectedBefore = [string](Arg $a 'expectedBefore')
    $expectedAfter = [string](Arg $a 'expectedAfter')
    $sumOccurrence = [int](Arg $a 'sumOccurrence' 0)
    if (-not $sumLabel -or -not $expectedBefore -or -not $expectedAfter) {
      Fail 'sumLabel, expectedBefore und expectedAfter sind fuer eine sichere Loeschung Pflicht.' 'bad-args'
    }
    if ($script:DESKTOP_NAME) {
      Fail ("Tabellenzeilen loeschen braucht in Qt Strg+Umschalt+Entf und ist auf dem versteckten Desktop " +
            "nicht moeglich. Bestehende Zellen koennen dort mit sse_table_update " +
            "sicher ausgesteuert werden; echtes Loeschen nur sichtbar.") 'hidden-desktop'
    }

    $targetPid = 0
    [SW]::GetWindowThreadProcessId($hwnd, [ref]$targetPid) | Out-Null
    $dialogsBefore = @(Get-DialogInventory | Where-Object {
      [int]$_.pid -eq $targetPid -and $_.kind -in @('native-dialog','qt-dialog')
    })
    if ($dialogsBefore.Count) { Fail 'Ein modaler Dialog ist offen; Loeschung nicht begonnen.' 'precondition-failed' }

    function Read-LabeledValue([IntPtr]$window, [string]$label, [string]$expectedHint = '', [int]$occurrence = 0) {
      $tree = Walk-Tree $window -WithValues
      $bounds = Get-ContentBounds $tree $window
      $texts = @($tree.nodes | Where-Object {
        $_.type -eq 'Text' -and $_.name -and $_.x -ge $bounds.minX -and $_.x -le $bounds.maxX
      })
      $candidates = New-Object System.Collections.ArrayList

      foreach ($field in ($tree.nodes | Where-Object {
        $_.type -in @('Edit','ComboBox','Spinner') -and $_.x -ge $bounds.minX -and $_.x -le $bounds.maxX
      } | Sort-Object y, x)) {
        $lab = ($texts | Where-Object { [Math]::Abs($_.y - $field.y) -le 14 -and $_.x -lt $field.x } |
                Sort-Object { $field.x - $_.x } | Select-Object -First 1).name
        if ($lab -and ($lab -eq $label -or $lab.StartsWith($label))) {
          $null = $candidates.Add([pscustomobject]@{
            value = $(if ($null -ne $field.val) { "$($field.val)" } else { "$($field.name)" })
            y = $field.y; source = 'field'
          })
        }
      }

      foreach ($labNode in ($texts | Where-Object { $_.name -eq $label -or $_.name.StartsWith($label) })) {
        $right = @($texts | Where-Object {
          [Math]::Abs($_.y - $labNode.y) -le 12 -and $_.x -gt $labNode.x -and $_.name -match '^-?[\d.]+,\d{2}$'
        } | Sort-Object x)
        if ($right.Count -eq 1) {
          $null = $candidates.Add([pscustomobject]@{ value = "$($right[0].name)"; y = $labNode.y; source = 'text' })
        }
      }

      # Dasselbe UI-Feld kann als ValuePattern und als Text erscheinen. Erst
      # nach Y+Wert deduplizieren; gleichnamige Summen in verschiedenen
      # Abschnitten bleiben absichtlich getrennt.
      $unique = @($candidates | Group-Object { "$($_.y)|$($_.value)" } | ForEach-Object { $_.Group[0] })
      $unique = @($unique | Sort-Object y)
      if ($occurrence -gt 0) {
        if ($occurrence -gt $unique.Count) {
          return [pscustomobject]@{ value = $null; selected = $null; tree = $tree; candidates = $unique; matchedExpected = $false; occurrence = $occurrence }
        }
        $chosen = $unique[$occurrence - 1]
        $matchesHint = (-not $expectedHint) -or (Test-SSEScalarEqual $chosen.value $expectedHint)
        return [pscustomobject]@{
          value = $(if ($matchesHint) { $chosen.value } else { $null })
          selected = $chosen; tree = $tree; candidates = $unique; matchedExpected = [bool]$matchesHint; occurrence = $occurrence
        }
      }
      if ($expectedHint) {
        $matching = @($unique | Where-Object { Test-SSEScalarEqual $_.value $expectedHint })
        if ($matching.Count -eq 1) {
          return [pscustomobject]@{ value = $matching[0].value; selected = $matching[0]; tree = $tree; candidates = $unique; matchedExpected = $true }
        }
        return [pscustomobject]@{ value = $null; selected = $null; tree = $tree; candidates = $unique; matchedExpected = $false }
      }
      if ($unique.Count -eq 1) {
        return [pscustomobject]@{ value = $unique[0].value; selected = $unique[0]; tree = $tree; candidates = $unique; matchedExpected = $null }
      }
      [pscustomobject]@{ value = $null; selected = $null; tree = $tree; candidates = $unique; matchedExpected = $null }
    }

    $beforeRead = Read-LabeledValue $hwnd $sumLabel $expectedBefore $sumOccurrence
    $before = $beforeRead.value
    $headingBefore = Get-CurrentHeading $hwnd $beforeRead.tree
    if ($headingBefore -ne $expectedPage) {
      Fail "Vorbedingung verletzt: aktuelle Seite ist '$headingBefore', erwartet '$expectedPage'. NICHT geloescht." 'precondition-failed'
    }
    if (-not (Test-SSEScalarEqual $before $expectedBefore)) {
      Fail "Vorbedingung verletzt: '$sumLabel' ist '$before', erwartet '$expectedBefore'. NICHT geloescht." 'precondition-failed'
    }

    $t = $beforeRead.tree
    $targetRegion = Get-SSETableRegion $t $hwnd $beforeRead
    if (-not $targetRegion.ok) {
      Fail "Tabellenregion fuer '$sumLabel' nicht eindeutig: $($targetRegion.error) NICHT geloescht." 'precondition-failed'
    }
    $matches = @($targetRegion.cells | Where-Object { $_.name -eq $text })
    $searchSteps = 0
    $searchDeadlineMs = 60000
    $testDeadlineMs = 0
    if ([int]::TryParse([string]$env:SSE_MCP_TEST_SEARCH_DEADLINE_MS, [ref]$testDeadlineMs) -and $testDeadlineMs -gt 0) {
      $searchDeadlineMs = $testDeadlineMs
    }
    $searchWatch = [Diagnostics.Stopwatch]::StartNew()
    $inputBaseline = Get-SSELastInputTick
    if (-not $matches.Count) {
      # Qt virtualisiert Tabellenzeilen. Eine fachlich vorhandene Zeile kann
      # deshalb im aktuellen UIA-Baum fehlen. Fokus auf eine sichtbare Zelle,
      # sicher an den Tabellenanfang springen und ab dort nur navigieren.
      $firstCell = @($targetRegion.cells | Sort-Object @{ Expression = 'y'; Descending = $true }, x | Select-Object -First 1)[0]
      if ($firstCell) {
        $null = Click-VerifiedPoint $hwnd $firstCell
        $inputBaseline = Get-SSELastInputTick
        Start-Sleep -Milliseconds 180
        if ([SW]::GetForegroundWindow() -ne $hwnd) {
          Fail 'Tabellenfokus ist vor der Zielsuche verloren gegangen; nichts geloescht.' 'interference'
        }
        [System.Windows.Forms.SendKeys]::SendWait('^{HOME}')
        $inputBaseline = Get-SSELastInputTick
        Set-SSEForegroundLeaseInputCheckpoint $inputBaseline
        Start-Sleep -Milliseconds 350
        for ($searchSteps = 0; $searchSteps -le 250; $searchSteps++) {
          if ($searchWatch.ElapsedMilliseconds -ge $searchDeadlineMs) {
            Fail 'Tabellen-Zielsuche ueberschritt die interne Frist; nichts geloescht.' 'timeout'
          }
          $nowInput = Get-SSELastInputTick
          if ($null -ne $inputBaseline -and $null -ne $nowInput -and $nowInput -ne $inputBaseline) {
            Fail 'Fremde Eingabe waehrend der Zielsuche erkannt; nichts geloescht.' 'interference'
          }
          if ([SW]::GetForegroundWindow() -ne $hwnd) {
            Fail 'Tabellenfokus ging waehrend der Zielsuche verloren; nichts geloescht.' 'interference'
          }
          $currentRead = Read-LabeledValue $hwnd $sumLabel $expectedBefore $sumOccurrence
          if (-not (Test-SSEScalarEqual $currentRead.value $expectedBefore)) {
            Fail "Kontrollsumme/Seite veraenderten sich waehrend der Zielsuche. NICHT geloescht." 'interference'
          }
          $t = $currentRead.tree
          if ((Get-CurrentHeading $hwnd $t) -ne $expectedPage) {
            Fail 'Seite wechselte waehrend der Zielsuche. NICHT geloescht.' 'interference'
          }
          $targetRegion = Get-SSETableRegion $t $hwnd $currentRead
          if (-not $targetRegion.ok) {
            Fail "Tabellenregion verschwand waehrend der Zielsuche. NICHT geloescht." 'interference'
          }
          $matches = @($targetRegion.cells | Where-Object { $_.name -eq $text })
          if ($matches.Count) { break }
          [System.Windows.Forms.SendKeys]::SendWait('{DOWN}')
          $inputBaseline = Get-SSELastInputTick
          Set-SSEForegroundLeaseInputCheckpoint $inputBaseline
          Start-Sleep -Milliseconds 80
        }
      }
    }
    if (-not $matches.Count) { Fail "Keine Zelle mit '$text' gefunden (auch nicht nach $searchSteps Navigationsschritten)." 'not-found' }
    if ($matches.Count -ne 1) { Fail "$($matches.Count) Zellen mit '$text' gefunden; Loeschziel ist nicht eindeutig." 'ambiguous' }
    $zelle = $matches[0]

    # anklicken (macht sie zur aktiven Zeile) und Strg+Umschalt+Entf
    $HWND_TOPMOST = [IntPtr](-1); $HWND_NOTOPMOST = [IntPtr](-2)
    $SWP = 0x0001 -bor 0x0002 -bor 0x0010
    $null = Show-SSEWindow $hwnd
    Start-Sleep -Milliseconds 400

    # Restore/Topmost kann das Fenster verschieben. Keine vor dem Aktivieren
    # gelesene UIA-Koordinate weiterverwenden: Seite, Summe, Region, RuntimeId
    # und BoundingRectangle jetzt frisch an das Hauptfenster binden.
    $pointRead = Read-LabeledValue $hwnd $sumLabel $expectedBefore $sumOccurrence
    $pointHeading = Get-CurrentHeading $hwnd $pointRead.tree
    $pointRegion = Get-SSETableRegion $pointRead.tree $hwnd $pointRead
    $pointMatches = $(if ($pointRegion.ok) {
      @($pointRegion.cells | Where-Object { $_.name -eq $text })
    } else { @() })
    if ($pointHeading -ne $expectedPage -or -not (Test-SSEScalarEqual $pointRead.value $expectedBefore) -or
        $pointMatches.Count -ne 1) {
      [SW]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP) | Out-Null
      Fail 'Seite, Summe oder eindeutige Zielzelle veraenderten sich beim Aktivieren; nichts geloescht.' 'interference'
    }
    $zelle = $pointMatches[0]
    $targetRegion = $pointRegion
    $targetElement = Get-LiveElement $hwnd $zelle.rid
    if (-not $targetElement -or [string]$targetElement.Current.Name -ne $text) {
      [SW]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP) | Out-Null
      Fail 'Zielzelle ist unmittelbar vor dem Aktivierungsklick nicht mehr identisch; nichts geloescht.' 'stale'
    }
    $cellRect = $targetElement.Current.BoundingRectangle
    if ([double]::IsInfinity($cellRect.X) -or [double]::IsInfinity($cellRect.Y) -or
        $cellRect.Width -le 0 -or $cellRect.Height -le 0) {
      [SW]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP) | Out-Null
      Fail 'Zielzelle besitzt unmittelbar vor dem Klick kein sichtbares Rechteck; nichts geloescht.' 'offscreen'
    }
    $px = [int]($cellRect.X + $cellRect.Width / 2); $py = [int]($cellRect.Y + $cellRect.Height / 2)
    $mainRect = New-Object SW+RC
    if (-not [SW]::GetWindowRect($hwnd, [ref]$mainRect) -or
        $px -lt $mainRect.L -or $px -ge $mainRect.R -or $py -lt $mainRect.T -or $py -ge $mainRect.B) {
      [SW]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP) | Out-Null
      Fail "Frischer Zellmittelpunkt $px,$py liegt nicht im Hauptfensterrechteck; nichts geloescht." 'stale'
    }
    $obstruction = Get-SSEPointObstruction $hwnd $px $py
    if (-not $obstruction.isBoundTarget) {
      [SW]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP) | Out-Null
      Fail ("An Position $px,$py liegt nicht das gebundene SSE-Hauptfenster " +
            "($($obstruction.blockerKind): $($obstruction.processName)/$($obstruction.className), " +
            "hit=$($obstruction.hitWindow), root=$($obstruction.hitRoot), bound=$($obstruction.boundWindow), " +
            "pid=$($obstruction.hitPid)/$($obstruction.boundPid)) - NICHT geloescht.") 'obstructed' `
        ([pscustomobject]@{ obstruction=$obstruction })
    }

    # Falls SendKeys bei einem frueheren Aufruf einen Modifikator nicht sauber
    # freigegeben hat, wuerde selbst ein normaler Klick die Auswahl erweitern.
    # Alle drei Modifikatoren explizit in den UP-Zustand bringen.
    $KEYEVENTF_KEYUP = 0x0002
    [SW]::keybd_event(0x10, 0, $KEYEVENTF_KEYUP, [IntPtr]::Zero) # Shift
    [SW]::keybd_event(0x11, 0, $KEYEVENTF_KEYUP, [IntPtr]::Zero) # Ctrl
    [SW]::keybd_event(0x12, 0, $KEYEVENTF_KEYUP, [IntPtr]::Zero) # Alt

    # SelectionItem.Select ist exklusiv und loest eine alte Mehrfachauswahl.
    # Ohne dieses Pattern wird nicht geloescht; ein blosses Klicken hat sich
    # bei dieser Qt-Tabelle als unzureichend erwiesen.
    $selectionItem = $null
    if (-not $targetElement -or -not $targetElement.TryGetCurrentPattern(
        [System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selectionItem)) {
      [SW]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP) | Out-Null
      Fail "Die Zielzelle unterstuetzt keine exklusiv pruefbare Auswahl - NICHT geloescht." 'selection-unverified'
    }
    $selectionItem.Select()
    try { $targetElement.SetFocus() } catch { }
    Start-Sleep -Milliseconds 180
    [SW]::SetCursorPos($px, $py) | Out-Null; Start-Sleep -Milliseconds 120
    [SW]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero); [SW]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
    $inputBaseline = Get-SSELastInputTick
    Set-SSEForegroundLeaseInputCheckpoint $inputBaseline ([pscustomobject]@{ x=$px; y=$py })
    Start-Sleep -Milliseconds 300
    if ([SW]::GetForegroundWindow() -ne $hwnd) {
      [SW]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP) | Out-Null
      Fail 'Der PID-/Root-gepruefte Zielklick hat SSE nicht eindeutig aktiviert; nichts geloescht.' 'interference'
    }

    # Die Auswahl am Tabellencontainer muss genau ein Element enthalten.
    # Das ist der entscheidende Schutz gegen den zuvor beobachteten
    # Mehrzeilenverlust.
    $freshTarget = Get-LiveElement $hwnd $zelle.rid
    $selectionCount = $null
    $selectionNames = @()
    $selectionYs = @()
    $ancestor = $freshTarget
    for ($level = 0; $level -lt 8 -and $ancestor; $level++) {
      $selectionPattern = $null
      if ($ancestor.TryGetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern, [ref]$selectionPattern)) {
        $selected = @($selectionPattern.Current.GetSelection())
        $selectionCount = $selected.Count
        $selectionNames = @($selected | ForEach-Object {
          try { ("$($_.Current.Name)" -replace "`r|`n|`t", ' ').Trim() } catch { '' }
        })
        $selectionYs = @($selected | ForEach-Object {
          try {
            $rectangle = $_.Current.BoundingRectangle
            if ([double]::IsInfinity($rectangle.Y)) { -1 } else { [int]$rectangle.Y }
          } catch { -1 }
        })
        break
      }
      try { $ancestor = $WLK.GetParent($ancestor) } catch { $ancestor = $null }
    }
    # Qt meldet bei einer markierten Tabellenzeile je eine Auswahl pro Zelle
    # (hier typischerweise 5), nicht eine Auswahl pro Zeile. Sicher ist die
    # Lage nur, wenn ALLE ausgewählten Zellen dieselbe sichtbare Y-Zeile wie
    # das Ziel haben und der Zieltext selbst darunter ist.
    $sameRow = ($null -ne $selectionCount -and $selectionCount -gt 0 -and
                @($selectionYs | Where-Object { $_ -lt 0 -or [Math]::Abs($_ - $zelle.y) -gt 10 }).Count -eq 0)
    $targetSelected = @($selectionNames | Where-Object { $_ -eq $text.Trim() }).Count -gt 0
    if (-not $sameRow -or -not $targetSelected) {
      [SW]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP) | Out-Null
      Fail "Auswahl nicht auf genau eine sichtbare Zielzeile begrenzt (Elemente: $selectionCount, Y: $($selectionYs -join ','), Namen: $($selectionNames -join ' | '), Ziel: '$text'). NICHT geloescht." 'selection-unverified'
    }

    # Letzte gebundene Epoche unmittelbar vor der irreversiblen Tastenkombination:
    # Seite, Summe, Ziel-RuntimeId, Fensterlage und Benutzereingabe muessen seit
    # der exklusiven Auswahl unveraendert sein.
    $interactionBeforeDelete = Get-SSEInteractionWindowSet $targetPid $hwnd
    $preDeleteInput = Get-SSELastInputTick
    $preDeleteRead = Read-LabeledValue $hwnd $sumLabel $expectedBefore $sumOccurrence
    $preDeleteHeading = Get-CurrentHeading $hwnd $preDeleteRead.tree
    $preDeleteRegion = Get-SSETableRegion $preDeleteRead.tree $hwnd $preDeleteRead
    $preDeleteMatches = $(if ($preDeleteRegion.ok) {
      @($preDeleteRegion.cells | Where-Object { $_.name -eq $text })
    } else { @() })
    $preDeleteWindows = Get-SSEInteractionWindowSet $targetPid $hwnd
    $preDeleteInputAfter = Get-SSELastInputTick
    $preDeleteOk = [bool](
      $preDeleteHeading -eq $expectedPage -and
      (Test-SSEScalarEqual $preDeleteRead.value $expectedBefore) -and
      $preDeleteMatches.Count -eq 1 -and $preDeleteMatches[0].rid -eq $zelle.rid -and
      [SW]::GetForegroundWindow() -eq $hwnd -and
      $interactionBeforeDelete.fingerprint -eq $preDeleteWindows.fingerprint -and
      ($null -eq $preDeleteInput -or $null -eq $preDeleteInputAfter -or $preDeleteInput -eq $preDeleteInputAfter)
    )
    if (-not $preDeleteOk) {
      [SW]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP) | Out-Null
      Fail 'Seite, Summe, Zielzeile, Fensterlage oder Eingabe veraenderten sich nach der Auswahl; NICHT geloescht.' 'interference'
    }

    [System.Windows.Forms.SendKeys]::SendWait('^+{DEL}')
    $deleteInputBaseline = Get-SSELastInputTick
    Set-SSEForegroundLeaseInputCheckpoint $deleteInputBaseline ([pscustomobject]@{ x=$px; y=$py })
    Start-Sleep -Milliseconds 900
    [SW]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP) | Out-Null

    $interactionAfterDelete = Get-SSEInteractionWindowSet $targetPid $hwnd
    $deleteInputAfter = Get-SSELastInputTick
    $postDeleteInterference = [bool](
      [SW]::GetForegroundWindow() -ne $hwnd -or
      $interactionAfterDelete.fingerprint -ne $interactionBeforeDelete.fingerprint -or
      ($null -ne $deleteInputBaseline -and $null -ne $deleteInputAfter -and $deleteInputBaseline -ne $deleteInputAfter)
    )
    if ($postDeleteInterference) {
      Emit ([pscustomobject]@{
        ok=$false; kind='interference'
        error='Nach dem Loeschbefehl wurde fremde Eingabe oder eine veraenderte Fensterlage erkannt. Zustand nur melden; kein blindes Strg+Z und kein Speichern.'
        expectedPage=$expectedPage; sumLabel=$sumLabel; expectedBefore=$expectedBefore; expectedAfter=$expectedAfter
        target=$text; mutationState='unknown-after-interference'
        tableBinding=[pscustomobject]@{
          sumOccurrence=$sumOccurrence; sumY=$targetRegion.targetSumY
          previousSummaryY=$targetRegion.previousSummaryY; rowY=$zelle.y
        }
        inputGuard=[pscustomobject]@{ baseline=$deleteInputBaseline; observed=$deleteInputAfter; interference=$true }
        windowGuard=[pscustomobject]@{
          before=$interactionBeforeDelete.fingerprint; after=$interactionAfterDelete.fingerprint; interference=$true
        }
        rollback=[pscustomobject]@{ attempted=$false; reason='no-blind-undo-after-interference' }
      })
    }

    # Gegenprobe: Ziel muss innerhalb derselben Summenregion weg sein UND die
    # Seitensumme muss exakt dem Vertrag entsprechen. Eine Interferenz waehrend
    # des Readbacks verbietet auch hier ein blindes Undo.
    $regionLowerY = $(if ($null -ne $targetRegion.previousSummaryY) { [int]$targetRegion.previousSummaryY } else { [int]::MinValue })
    $regionUpperY = [int]$targetRegion.targetSumY
    $postCheckInputBefore = Get-SSELastInputTick
    $afterRead = Read-LabeledValue $hwnd $sumLabel $expectedAfter $sumOccurrence
    $after = $afterRead.value
    $headingAfter = Get-CurrentHeading $hwnd $afterRead.tree
    $nochDa = @($afterRead.tree.nodes | Where-Object {
      $_.type -eq 'DataItem' -and $_.name -eq $text -and
      $_.y -gt $regionLowerY -and $_.y -lt $regionUpperY
    }).Count -gt 0
    $postCheckWindows = Get-SSEInteractionWindowSet $targetPid $hwnd
    $postCheckInputAfter = Get-SSELastInputTick
    $postCheckInterference = [bool](
      $headingAfter -ne $expectedPage -or
      $postCheckWindows.fingerprint -ne $interactionBeforeDelete.fingerprint -or
      ($null -ne $postCheckInputBefore -and $null -ne $postCheckInputAfter -and $postCheckInputBefore -ne $postCheckInputAfter)
    )
    if ($postCheckInterference) {
      Emit ([pscustomobject]@{
        ok=$false; kind='interference'
        error='Seite, Fensterlage oder Benutzereingabe veraenderten sich beim Nachlesen. Zustand nur melden; kein blindes Strg+Z und kein Speichern.'
        expectedPage=$expectedPage; page=$headingAfter; target=$text
        sumLabel=$sumLabel; before=$before; after=$after; expectedAfter=$expectedAfter; nochVorhanden=$nochDa
        tableBinding=[pscustomobject]@{
          sumOccurrence=$sumOccurrence; sumY=$regionUpperY
          previousSummaryY=$targetRegion.previousSummaryY; rowY=$zelle.y
        }
        inputGuard=[pscustomobject]@{ baseline=$postCheckInputBefore; observed=$postCheckInputAfter; interference=$true }
        windowGuard=[pscustomobject]@{
          before=$interactionBeforeDelete.fingerprint; after=$postCheckWindows.fingerprint; interference=$true
        }
        rollback=[pscustomobject]@{ attempted=$false; reason='no-blind-undo-after-interference' }
      })
    }

    $postOk = (-not $nochDa) -and (Test-SSEScalarEqual $after $expectedAfter)
    if (-not $postOk) {
      $rollbackGuardInput = Get-SSELastInputTick
      $rollbackGuardWindows = Get-SSEInteractionWindowSet $targetPid $hwnd
      $null = Show-SSEWindow $hwnd
      Start-Sleep -Milliseconds 180
      $rollbackReadyInput = Get-SSELastInputTick
      $rollbackReadyWindows = Get-SSEInteractionWindowSet $targetPid $hwnd
      $rollbackSafe = [bool](
        [SW]::GetForegroundWindow() -eq $hwnd -and
        $rollbackGuardWindows.fingerprint -eq $rollbackReadyWindows.fingerprint -and
        ($null -eq $rollbackGuardInput -or $null -eq $rollbackReadyInput -or $rollbackGuardInput -eq $rollbackReadyInput)
      )
      if (-not $rollbackSafe) {
        [SW]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP) | Out-Null
        Emit ([pscustomobject]@{
          ok=$false; kind='interference'
          error='Nachbedingung war falsch, aber vor Strg+Z wurde Interferenz erkannt. Kein blindes Undo; Fall nicht speichern und neu synchronisieren.'
          expectedPage=$expectedPage; page=$headingAfter; target=$text
          sumLabel=$sumLabel; before=$before; after=$after; expectedAfter=$expectedAfter; nochVorhanden=$nochDa
          tableBinding=[pscustomobject]@{
            sumOccurrence=$sumOccurrence; sumY=$regionUpperY
            previousSummaryY=$targetRegion.previousSummaryY; rowY=$zelle.y
          }
          rollback=[pscustomobject]@{ attempted=$false; reason='no-blind-undo-after-interference' }
        })
      }

      [System.Windows.Forms.SendKeys]::SendWait('^z')
      $rollbackInputBaseline = Get-SSELastInputTick
      Set-SSEForegroundLeaseInputCheckpoint $rollbackInputBaseline ([pscustomobject]@{ x=$px; y=$py })
      Start-Sleep -Milliseconds 1100
      [SW]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP) | Out-Null
      $rollbackRead = Read-LabeledValue $hwnd $sumLabel $expectedBefore $sumOccurrence
      $rollbackTree = $rollbackRead.tree
      $rollbackHeading = Get-CurrentHeading $hwnd $rollbackTree
      $targetRestored = @($rollbackTree.nodes | Where-Object {
        $_.type -eq 'DataItem' -and $_.name -eq $text -and
        $_.y -gt $regionLowerY -and $_.y -lt $regionUpperY
      }).Count -gt 0
      $rollbackWindows = Get-SSEInteractionWindowSet $targetPid $hwnd
      $rollbackInputAfter = Get-SSELastInputTick
      $rollbackInterference = [bool](
        $rollbackHeading -ne $expectedPage -or
        $rollbackWindows.fingerprint -ne $interactionBeforeDelete.fingerprint -or
        ($null -ne $rollbackInputBaseline -and $null -ne $rollbackInputAfter -and $rollbackInputBaseline -ne $rollbackInputAfter)
      )
      $rolledBack = [bool](-not $rollbackInterference -and $targetRestored -and
        (Test-SSEScalarEqual $rollbackRead.value $expectedBefore))
      Emit ([pscustomobject]@{
        ok = $false; kind = 'postcondition-failed'; geloescht = $text
        error = $(if ($rolledBack) {
          'Nachbedingung verletzt; Aenderung automatisch rueckgaengig gemacht.'
        } elseif ($rollbackInterference) {
          'Nachbedingung verletzt; Strg+Z wurde versucht, aber die Wiederherstellung konnte wegen Interferenz nicht verifiziert werden.'
        } else {
          'Nachbedingung verletzt; Rueckgaengigmachen NICHT verifiziert.'
        })
        expectedPage=$expectedPage; page=$rollbackHeading
        sumLabel = $sumLabel; sumOccurrence = $sumOccurrence; before = $before; expectedBefore = $expectedBefore
        after = $after; expectedAfter = $expectedAfter; nochVorhanden = $nochDa
        selectionCount = $selectionCount; selectionNames = $selectionNames
        selectionYs = $selectionYs
        tableBinding=[pscustomobject]@{
          sumOccurrence=$sumOccurrence; sumY=$regionUpperY
          previousSummaryY=$targetRegion.previousSummaryY; rowY=$zelle.y
        }
        rollbackAttempted = $true; rolledBack = [bool]$rolledBack; rollbackValue = $rollbackRead.value
        rollbackInterference=[bool]$rollbackInterference
        warning = $(if ($rolledBack) {
          'Nachbedingung verletzt; die Aenderung wurde automatisch und verifiziert rueckgaengig gemacht.'
        } else {
          'KRITISCH: Nachbedingung verletzt und Rueckgaengigmachen nicht verifiziert. Fall ohne Speichern schliessen.'
        })
      })
    }
    Emit ([pscustomobject]@{
      ok = $true; geloescht = $text; nochVorhanden = $false
      expectedPage=$expectedPage; page=$headingAfter
      sumLabel = $sumLabel; sumOccurrence = $sumOccurrence; before = $before; after = $after
      expectedBefore = $expectedBefore; expectedAfter = $expectedAfter
      selectionCount = $selectionCount; selectionNames = $selectionNames
      selectionYs = $selectionYs
      tableBinding=[pscustomobject]@{
        sumOccurrence=$sumOccurrence; sumY=$regionUpperY
        previousSummaryY=$targetRegion.previousSummaryY; rowY=$zelle.y
      }
      searchSteps = $searchSteps
      verified = $true
    })
  }

  'menu' {
    # Menuezeile bedienen. Ohne das sind Optionen, Datenuebernahme,
    # Steuerrechner und Druckfunktionen unerreichbar.
    $mainWindow = Resolve-SSEMainWindowDescriptor $a -RestoreMinimized
    $hwnd = [IntPtr][int64]$mainWindow.hwnd
    $targetPid = [int]$mainWindow.pid
    $t = Walk-Tree $hwnd 1200
    $menues = @($t.nodes | Where-Object {
      $_.type -eq 'MenuItem' -and $_.name -and $_.p -ge 0 -and
      $t.nodes[[int]$_.p].type -eq 'MenuBar'
    } | Sort-Object x)
    $wunsch = [string](Arg $a 'name')
    if (-not $wunsch) {
      Emit ([pscustomobject]@{ ok = $true; menues = @($menues | ForEach-Object { $_.name })
        hinweis = "Mit name='Datei' oeffnen und die Eintraege lesen." })
    }
    $m = @($menues | Where-Object { $_.name -eq $wunsch })[0]
    if (-not $m) { Fail "Menue '$wunsch' nicht gefunden. Vorhanden: $(($menues | ForEach-Object { $_.name }) -join ', ')" 'not-found' }
    if (Test-Versand $wunsch) { Fail "GESPERRT: Menue '$wunsch'." 'blocked' }

    $el = Get-LiveElement $hwnd $m.rid
    if (-not $el) { Fail "Menue '$wunsch' nicht mehr greifbar." 'stale' }
    try { $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand() }
    catch {
      try { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
      catch { Fail "Menue '$wunsch' liess sich nicht oeffnen: $($_.Exception.Message.Split("`n")[0])" 'pattern-failed' }
    }
    Start-Sleep -Milliseconds 700

    # Die aufgeklappten Eintraege liegen in einem eigenen Popupfenster.
    $eintraege = New-Object System.Collections.ArrayList
    foreach ($w in @(Get-Windows 'SSE' | Where-Object { [int]$_.pid -eq $targetPid })) {
      if ([int64]$w.hwnd -eq [int64]$hwnd) { continue }
      try {
        $tw = Walk-Tree ([IntPtr][int64]$w.hwnd) 400 10
        foreach ($n in ($tw.nodes | Where-Object { $_.type -eq 'MenuItem' -and $_.name })) {
          $null = $eintraege.Add([pscustomobject]@{
            name = $n.name; aktiv = $n.on; gesperrt = [bool](Test-Versand $n.name)
            destruktiv = [bool](Test-SSEDestructiveAction $n.name); hwnd = $w.hwnd; rid = $n.rid })
        }
      } catch { }
    }
    # Fallback: manche Qt-Menues haengen im Hauptfenster
    if (-not $eintraege.Count) {
      $t2 = Walk-Tree $hwnd 1500
      foreach ($n in ($t2.nodes | Where-Object { $_.type -eq 'MenuItem' -and $_.name -and $_.y -gt ($m.y + 20) })) {
        $null = $eintraege.Add([pscustomobject]@{
          name = $n.name; aktiv = $n.on; gesperrt = [bool](Test-Versand $n.name)
          destruktiv = [bool](Test-SSEDestructiveAction $n.name); hwnd = [int64]$hwnd; rid = $n.rid })
      }
    }
    Emit ([pscustomobject]@{ ok = $true; menue = $wunsch; anzahl = $eintraege.Count; eintraege = @($eintraege)
      hinweis = 'Mit sse_menu_click name="<Eintrag>" ausloesen. Zum sicheren Schliessen sse_menu_close verwenden.' })
  }

  'menu_click' {
    $eintrag = [string](Arg $a 'name')
    if (-not $eintrag) { Fail 'name fehlt' 'bad-args' }
    $waitMs = Get-SSEBoundedIntegerArg $a 'waitMs' 1500 100 10000
    if (Test-Versand $eintrag) { Fail "GESPERRT: '$eintrag' fuehrt zu einer Uebermittlung." 'blocked' }
    Assert-SSEDestructiveAcknowledgement $a @($eintrag)
    $mainWindow = Resolve-SSEMainWindowDescriptor $a -RestoreMinimized
    $targetPid = [int]$mainWindow.pid
    $mainHwnd = [IntPtr][int64]$mainWindow.hwnd
    $gefunden = New-Object System.Collections.ArrayList
    $gesehen = @{}
    $wantedLabel = ConvertTo-MenuLabel $eintrag
    # Qt stellt dasselbe Popup teilweise sowohl ueber sein echtes Popupfenster als auch
    # ueber ein SysShadow-Fenster bereit. RuntimeId + normalisierte Beschriftung sind
    # dann identisch; nur das echte Popup darf als eigenstaendiger Treffer zaehlen.
    $menuWindows = @(Get-Windows 'SSE' | Where-Object { [int]$_.pid -eq $targetPid } | Sort-Object @{ Expression = {
      if ($_.cls -match 'PopupDropShadow') { 0 } elseif ($_.cls -eq 'SysShadow') { 2 } else { 1 }
    } })
    foreach ($w in $menuWindows) {
      try {
        $tw = Walk-Tree ([IntPtr][int64]$w.hwnd) 600 10
        foreach ($n in @($tw.nodes | Where-Object {
          $_.type -eq 'MenuItem' -and $_.name -and
          ($_.name -eq $eintrag -or (ConvertTo-MenuLabel $_.name) -eq $wantedLabel)
        })) {
          $key = "$(ConvertTo-MenuLabel $n.name)|$($n.rid)"
          if ($gesehen.ContainsKey($key)) { continue }
          $gesehen[$key] = $true
          $null = $gefunden.Add([pscustomobject]@{ hwnd = [IntPtr][int64]$w.hwnd; node = $n })
        }
      } catch { }
    }
    if (-not $gefunden.Count) { Fail "Menueeintrag '$eintrag' nicht gefunden. Vorher sse_menu aufrufen." 'not-found' }
    if ($gefunden.Count -ne 1) { Fail "$($gefunden.Count) Menueeintraege passen zu '$eintrag'; nichts ausgeloest." 'ambiguous' }
    $match = $gefunden[0]
    if (Test-Versand $match.node.name) { Fail "GESPERRT: '$($match.node.name)' fuehrt zu einer Uebermittlung." 'blocked' }
    Assert-SSEDestructiveAcknowledgement $a @($match.node.name)
    $el = Get-LiveElement $match.hwnd $match.node.rid
    if (-not $el) { Fail "Eintrag nicht mehr greifbar." 'stale' }
    # InvokePattern blocks bei Qt bis zu seinem COM-Timeout, wenn der Eintrag
    # einen modalen Dialog oeffnet. Der verifizierte physische Klick kehrt
    # sofort zurueck und ist hier zugleich strenger an das sichtbare Popup
    # und die SSE-Prozess-ID gebunden.
    $dirtyBefore = Get-DirtyStateFast $mainHwnd
    $null = Click-VerifiedPoint $match.hwnd $match.node
    Start-Sleep -Milliseconds $waitMs
    Emit ([pscustomobject]@{
      ok = $true; ausgeloest = $match.node.name; angefordert = $eintrag
      method = 'verified-point'; fenster = (@(Get-Windows 'SSE')).Count
      ungespeichertVorher=$dirtyBefore; ungespeichertNachher=$(Get-DirtyStateFast $mainHwnd)
    })
  }

  'menu_close' {
    $mainWindow = Resolve-SSEMainWindowDescriptor $a -RestoreMinimized
    $hwnd = [IntPtr][int64]$mainWindow.hwnd
    $targetPid = [int]$mainWindow.pid
    $name = [string](Arg $a 'name')
    $before = @(Get-Windows 'SSE' | Where-Object {
      [int]$_.pid -eq $targetPid -and $_.cls -match 'PopupDropShadow|SysShadow'
    })
    $tree = Walk-Tree $hwnd 1400
    $menuNodes = @($tree.nodes | Where-Object {
      $_.type -eq 'MenuItem' -and $_.name -and $_.p -ge 0 -and $tree.nodes[[int]$_.p].type -eq 'MenuBar' -and
      (-not $name -or (ConvertTo-MenuLabel $_.name) -eq (ConvertTo-MenuLabel $name))
    })
    $collapsed = @()
    foreach ($node in $menuNodes) {
      $element = Get-LiveElement $hwnd $node.rid
      $pattern = $null
      if ($element -and $element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) {
        if ($pattern.Current.ExpandCollapseState -ne [System.Windows.Automation.ExpandCollapseState]::Collapsed) {
          $pattern.Collapse(); $collapsed += $node.name
        }
      }
    }
    Start-Sleep -Milliseconds 500
    $after = @(Get-Windows 'SSE' | Where-Object {
      [int]$_.pid -eq $targetPid -and $_.cls -match 'PopupDropShadow|SysShadow'
    })
    Emit ([pscustomobject]@{
      ok = ($after.Count -eq 0); collapsed = $collapsed
      popupCountBefore = $before.Count; popupCountAfter = $after.Count
      verified = ($after.Count -eq 0)
      warning = $(if ($after.Count) { 'Menue-Popup ist noch sichtbar; keine Tasten gesendet.' } else { $null })
    })
  }

  'ui_state' {
    # Ein konsistenter, rein lesender Zustands-Snapshot fuer den Agenten. Ein
    # Aufruf liefert Seite, Dirty-State, Dialoge, Pruefer und - falls die
    # Werte-Info schon offen ist - auch alle Ergebniswerte. Der Fingerprint
    # bindet nachfolgende Entscheidungen an genau diesen beobachteten Zustand.
    $wins = @(Get-Windows 'SSE')
    if (-not $wins.Count) {
      Emit ([pscustomobject]@{
        ok=$true; running=$false; instance=$null; stateFingerprint=$null
        changedSince=$null; note='Kein Fenster.'
      })
    }

    # Nicht einfach das groesste Fenster nehmen: beim Start kann nur die
    # Wiederherstellungsfrage sichtbar sein. Werte-Info, Tipps und UAC-
    # Overlays sind dagegen niemals Hauptfenster.
    $mainCandidates = @(Get-SSEMainWindowCandidates $wins)
    if (-not $mainCandidates.Count) {
      if (Arg $a 'hwnd') { Fail "Das angegebene hwnd ist kein aktuelles $($script:SSE_INSTANCE_LABEL)-Hauptfenster." 'stale-window' }
      $inventory = @(Get-DialogInventory)
      $inventoryPids = @($inventory | ForEach-Object { [int]$_.pid } | Select-Object -Unique)
      if ($inventoryPids.Count -gt 1) {
        Fail "Mehrere $($script:SSE_INSTANCE_LABEL)-Instanzen ohne eindeutiges Hauptfenster sind sichtbar (PIDs: $($inventoryPids -join ', ')); Zustand nicht vermischt." 'ambiguous'
      }
      $dialogsOnly = @($inventory | Where-Object { $_.kind -in @('native-dialog','qt-dialog') } | ForEach-Object {
        [pscustomobject]@{
          hwnd=$_.hwnd; pid=$_.pid; cls=$_.cls; title=$_.title; kind=$_.kind
          buttons=$_.buttons; texte=$_.texts; fingerprint=$_.fingerprint
          uiaReadOk=$_.uiaReadOk; uiaError=$_.uiaError; msaaReadOk=$_.msaaReadOk; msaaError=$_.msaaError
        }
      })
      $knownNonmodal = @($inventory | Where-Object {
        $_.kind -notin @('native-dialog','qt-dialog') -and (
          $_.kind -in @('tips','shadow') -or (Test-SSESystemOverlayDescriptor $_) -or
          (Test-SSESafeAuxiliaryDescriptor $_)
        )
      } | ForEach-Object {
        [pscustomobject]@{ hwnd=$_.hwnd; pid=$_.pid; cls=$_.cls; title=$_.title; kind=$_.kind }
      })
      $uncertainOnly = @($inventory | Where-Object {
        $_.kind -notin @('native-dialog','qt-dialog','tips','shadow') -and
        -not (Test-SSESystemOverlayDescriptor $_) -and -not (Test-SSESafeAuxiliaryDescriptor $_)
      } | ForEach-Object {
        [pscustomobject]@{
          hwnd=$_.hwnd; pid=$_.pid; cls=$_.cls; title=$_.title; kind=$_.kind
          uiaReadOk=$_.uiaReadOk; uiaError=$_.uiaError; msaaReadOk=$_.msaaReadOk; msaaError=$_.msaaError
        }
      })
      $core = [ordered]@{
        running=$true; instance=$null
        dialogs=@($dialogsOnly | ForEach-Object { [ordered]@{ hwnd=$_.hwnd; fingerprint=$_.fingerprint; title=$_.title } })
        uncertain=@($uncertainOnly | ForEach-Object { [ordered]@{ hwnd=$_.hwnd; cls=$_.cls; title=$_.title; kind=$_.kind } })
      }
      $stateFingerprint = Get-SSETextSha256 ($core | ConvertTo-Json -Depth 8 -Compress)
      $previous = [string](Arg $a 'previousFingerprint')
      Emit ([pscustomobject]@{
        ok=$true; running=$true; instance=$null; heading=$null
        stateFingerprint=$stateFingerprint
        changedSince=$(if ($previous) { $previous -ine $stateFingerprint } else { $null })
        blockiert=[bool]($dialogsOnly.Count -gt 0 -or $uncertainOnly.Count -gt 0); dialoge=$dialogsOnly
        unsichereFenster=$uncertainOnly
        prueferMeldungen=@(); baumFehler=@(); leerePflichtfelder=@()
        steuerpruefer=$null; ungespeichert=$null; ergebnis=$null
        fensterAnzahl=$inventory.Count; warnfensterAnzahl=0; nichtmodaleFenster=$knownNonmodal
        rat=$(if ($dialogsOnly.Count) {
          'Kein Hauptfenster; zuerst den fingerprintgebunden gemeldeten Dialog mit sse_dialog_answer bewusst beantworten.'
        } elseif ($uncertainOnly.Count) {
          'Kein Hauptfenster und mindestens ein unbekanntes oder unlesbares Fenster; nichts bedienen, per Screenshot/manuell klaeren.'
        } else { 'Kein Hauptfenster sichtbar; Programm startet noch oder der Zustand ist nicht lesbar.' })
      })
    }

    $mainWindow = Resolve-SSEMainWindowDescriptor $a $wins -RestoreMinimized
    $wins = @(Get-Windows 'SSE')
    # Hilfsfenster anderer gleichzeitig sichtbarer SSE-2025-Instanzen duerfen
    # weder den Dialogzustand noch den Fingerprint dieses Falls beeinflussen.
    $wins = @($wins | Where-Object { [int]$_.pid -eq [int]$mainWindow.pid })
    $haupt = [IntPtr][int64]$mainWindow.hwnd
    $fenster = New-Object System.Collections.ArrayList
    foreach ($w in $wins) {
      if ([int64]$w.hwnd -eq [int64]$haupt) {
        $null = $fenster.Add([pscustomobject]@{
          hwnd=$w.hwnd; pid=$w.pid; cls=$w.cls; title=$w.title; art='hauptfenster'
          x=$w.x; y=$w.y; w=$w.w; h=$w.h; buttons=@(); texte=@(); fingerprint=$null
          uiaReadOk=$true; uiaError=$null; msaaReadOk=$null; msaaError=$null
        })
        continue
      }
      if ($w.title -eq 'Werte-Info: Werte vergleichen - Was wäre wenn' -and $w.w -le 900 -and $w.h -le 700) { $art = 'werte-info' }
      elseif ($w.title -eq 'Steuer-Spar-Tipps' -and $w.w -le 850 -and $w.h -le 650) { $art = 'steuer-tipps' }
      elseif ($w.cls -match '^UAC[ _]' -and $w.w -le 80 -and $w.h -le 80) { $art = 'system-overlay' }
      else { $art = $null }
      if ($art) {
        $null = $fenster.Add([pscustomobject]@{
          hwnd=$w.hwnd; pid=$w.pid; cls=$w.cls; title=$w.title; art=$art
          x=$w.x; y=$w.y; w=$w.w; h=$w.h; buttons=@(); texte=@(); fingerprint=$null
          uiaReadOk=$null; uiaError=$null; msaaReadOk=$null; msaaError=$null
        })
        continue
      }
      try {
        $desc = Get-DialogDescriptor $w $haupt
        $joined = "$($desc.title) $($desc.texts -join ' ')"
        $art = $(
          if ($desc.kind -in @('native-dialog','qt-dialog')) {
            if ($joined -match 'Prüfung hat ergeben|Warnung|Hinweis') { 'warnung' } else { 'dialog' }
          } elseif ($desc.kind -eq 'shadow') { 'shadow' }
          elseif ($desc.kind -eq 'tips') { 'steuer-tipps' }
          else { 'unbekannt' }
        )
        $null = $fenster.Add([pscustomobject]@{
          hwnd=$desc.hwnd; pid=$desc.pid; cls=$desc.cls; title=$desc.title; art=$art
          x=$desc.x; y=$desc.y; w=$desc.w; h=$desc.h
          buttons=$desc.buttons; texte=@($desc.texts | Select-Object -First 8); fingerprint=$desc.fingerprint
          uiaReadOk=$desc.uiaReadOk; uiaError=$desc.uiaError; msaaReadOk=$desc.msaaReadOk; msaaError=$desc.msaaError
        })
      } catch {
        $null = $fenster.Add([pscustomobject]@{
          hwnd=$w.hwnd; pid=$w.pid; cls=$w.cls; title=$w.title; art='nicht-lesbar'
          x=$w.x; y=$w.y; w=$w.w; h=$w.h; buttons=@(); texte=@(); fingerprint=$null
          uiaReadOk=$false; uiaError=$_.Exception.Message; msaaReadOk=$null; msaaError=$null
        })
      }
    }

    # Genau ein grosser UIA-Snapshot fuer alle fachlichen Lesungen.
    $read = Read-CheckerComplete $haupt
    $t = $read.tree
    $b = Get-ContentBounds $t $haupt
    $checker = $read.result
    $checker | Add-Member -NotePropertyName konsistent -NotePropertyValue ([bool]$read.vollstaendig) -Force
    $pruefer = @($t.nodes | Where-Object {
      $_.type -eq 'TreeItem' -and $_.name -and $_.x -gt $b.maxX -and $_.name.Length -lt 90
    } | ForEach-Object { $_.name } | Where-Object {
      $_ -notin @('Eingabehilfe','Steuertipps','Prüfer','Mehr Details','Steuer-Spar-Tipps','Zurzeit keine Hinweise zu diesem Dialog.')
    } | Select-Object -Unique)
    $baumfehler = @($t.nodes | Where-Object {
      $_.type -eq 'TreeItem' -and $_.name -and $_.x -lt $b.minX -and $_.name -match '!\s*$' -and
      $_.aid -notlike '*PrueferWidgetSSE*'
    } | ForEach-Object { $_.name } | Select-Object -Unique)
    $heading = Get-CurrentHeading $haupt $t
    $leerePflicht = @($t.nodes | Where-Object {
      $_.type -eq 'ComboBox' -and $_.x -ge $b.minX -and $_.x -le $b.maxX -and
      (-not $_.val -or -not "$($_.val)".Trim())
    } | ForEach-Object { [pscustomobject]@{ y=$_.y; aid=($_.aid -split '\.')[-1]; rid=$_.rid } })
    $dirty = Get-DirtyState $t
    $ergebnis = Read-ResultDetailsFromTree $t
    $dialoge = @($fenster | Where-Object { $_.art -in @('dialog','warnung') })
    $warnungen = @($fenster | Where-Object { $_.art -eq 'warnung' })
    $unsicher = @($fenster | Where-Object { $_.art -in @('unbekannt','nicht-lesbar') })
    $nichtmodal = @($fenster | Where-Object { $_.art -in @('werte-info','steuer-tipps') })
    $blockiert = ($dialoge.Count -gt 0) -or ($unsicher.Count -gt 0) -or
      ($pruefer.Count -gt 0) -or ($baumfehler.Count -gt 0)

    $stateCore = [ordered]@{
      instance=[ordered]@{ pid=[int]$mainWindow.pid; hwnd=[int64]$mainWindow.hwnd }
      heading=$heading; dirty=$dirty; blockiert=[bool]$blockiert
      dialogs=@($dialoge | ForEach-Object { [ordered]@{ hwnd=$_.hwnd; title=$_.title; fingerprint=$_.fingerprint } })
      uncertain=@($unsicher | ForEach-Object { [ordered]@{
        hwnd=$_.hwnd; cls=$_.cls; title=$_.title; art=$_.art
        uiaReadOk=$_.uiaReadOk; uiaError=$_.uiaError; msaaReadOk=$_.msaaReadOk; msaaError=$_.msaaError
      } })
      windowKinds=@($fenster | Where-Object { $_.art -notin @('system-overlay','shadow') } |
        ForEach-Object { $_.art } | Sort-Object)
      pruefer=@($pruefer); baumfehler=@($baumfehler)
      # Bildschirmkoordinaten sind nur Diagnoseausgabe. Der logische
      # Fingerprint bindet Anzahl und Reihenfolge, nicht Fensterposition/DPI.
      leerePflicht=@($leerePflicht | Sort-Object y, aid | ForEach-Object { [string]$_.aid })
      checker=[ordered]@{
        aktiv=[bool]$checker.aktiv; fragen=[int]$checker.fragenWarnungenAngekuendigt
        tipps=[int]$checker.tippsAngekuendigt; konsistent=[bool]$checker.konsistent
      }
      ergebnisFingerprint=$ergebnis.fingerprint
    }
    $stateFingerprint = Get-SSETextSha256 ($stateCore | ConvertTo-Json -Depth 12 -Compress)
    $previous = [string](Arg $a 'previousFingerprint')

    Emit ([pscustomobject]@{
      ok=$true; running=$true
      instance=[pscustomobject]@{ pid=[int]$mainWindow.pid; hwnd=[int64]$mainWindow.hwnd; title=$mainWindow.title }
      stateFingerprint=$stateFingerprint
      changedSince=$(if ($previous) { $previous -ine $stateFingerprint } else { $null })
      heading=$heading; blockiert=[bool]$blockiert; dialoge=$dialoge
      unsichereFenster=$unsicher
      prueferMeldungen=$pruefer; baumFehler=$baumfehler; leerePflichtfelder=$leerePflicht
      steuerpruefer=$checker; ungespeichert=$dirty; ergebnis=$ergebnis
      fensterAnzahl=$fenster.Count; warnfensterAnzahl=$warnungen.Count
      nichtmodaleFenster=$nichtmodal
      snapshot=[pscustomobject]@{
        source=$t.stats.source; nodes=$t.stats.n; truncated=[bool]$t.stats.truncated
        cycles=[int]$t.stats.cyc; snapshotMs=$t.stats.snapshotMs
      }
      rat=$(
        if ($dialoge.Count) { 'Ein fingerprintgebundener Dialog ist offen. Erst lesen und bewusst beantworten; vorher keine Eingabe.' }
        elseif ($unsicher.Count) { 'Mindestens ein unbekanntes oder nicht lesbares SSE-Fenster ist offen. Zustand gilt als blockiert; per Screenshot/manuell klaeren.' }
        elseif ($pruefer.Count -or $baumfehler.Count) { "Der Seitenpruefer verlangt Angaben: $(($pruefer + $baumfehler) -join '; '). Erst klaeren, dann navigieren." }
        elseif ($checker.aktiv -and $checker.konsistent) { "Globaler Steuerpruefer aktiv: $($checker.fragenWarnungenAngekuendigt) Fragen/Warnungen und $($checker.tippsAngekuendigt) Tipps." }
        elseif ($checker.aktiv) { 'Globaler Steuerpruefer aktiv, aber Qt liefert keinen vollstaendigen konsistenten Baum; gezielt oder per Screenshot kontrollieren.' }
        elseif (-not $ergebnis.verfuegbar) { 'frei; fuer Ergebniswerte einmal sse_result_details oeffnen, danach kommen sie in jedem sse_ui_state mit.' }
        else { 'frei' }
      )
    })
  }

  'dismiss' {
    # Nur bekannte kompakte, nicht-modale Fenster schliessen. Unbekannte oder
    # nicht lesbare Fenster bleiben fail-closed stehen; automatische
    # Pruefhinweise brauchen sse_warning_popup_read + sse_dialog_answer.
    $wins = @(Get-Windows 'SSE')
    if (-not $wins.Count) { Emit ([pscustomobject]@{ ok=$true; geschlossen=0; note='SSE laeuft nicht.' }) }
    $main = Resolve-SSEMainWindowDescriptor $a $wins -RestoreMinimized
    $wins = @(Get-Windows 'SSE' | Where-Object { [int]$_.pid -eq [int]$main.pid })
    $zu = 0; $stehenGelassen = New-Object System.Collections.ArrayList
    $systemOverlays = 0
    foreach ($w in $wins) {
      if ([int64]$w.hwnd -eq [int64]$main.hwnd) { continue }
      $desc = $null
      try { $desc = Get-DialogDescriptor $w ([IntPtr][int64]$main.hwnd) }
      catch {
        $null = $stehenGelassen.Add([pscustomobject]@{
          hwnd=$w.hwnd; cls=$w.cls; title=$w.title; kind='nicht-lesbar'; reason=$_.Exception.Message
        })
        continue
      }
      if (Test-SSESystemOverlayDescriptor $desc) { $systemOverlays++; continue }
      if (-not (Test-SSEDismissibleAuxiliaryDescriptor $desc)) {
        $null = $stehenGelassen.Add([pscustomobject]@{
          hwnd=$desc.hwnd; cls=$desc.cls; title=$desc.title; kind=$desc.kind
          fingerprint=$desc.fingerprint; buttons=$desc.buttons; texts=$desc.texts
        })
        continue
      }
      $res = [IntPtr]::Zero
      [SW]::SendMessageTimeout([IntPtr][int64]$desc.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero, 0x0002, 2000, [ref]$res) | Out-Null
      Start-Sleep -Milliseconds 250
      if (-not [SW]::IsWindow([IntPtr][int64]$desc.hwnd)) { $zu++ }
      else {
        $null = $stehenGelassen.Add([pscustomobject]@{
          hwnd=$desc.hwnd; cls=$desc.cls; title=$desc.title; kind=$desc.kind; reason='WM_CLOSE wurde nicht bestaetigt.'
        })
      }
    }
    Start-Sleep -Milliseconds 500
    Emit ([pscustomobject]@{
      ok=$true; geschlossen=$zu; systemOverlaysIgnoriert=$systemOverlays
      stehenGelassen=@($stehenGelassen)
      verbleibend=@(Get-Windows 'SSE' | Where-Object { [int]$_.pid -eq [int]$main.pid }).Count
      note = $(if ($stehenGelassen.Count) { 'Nicht eindeutig harmlose Fenster wurden bewusst nicht geschlossen - bitte ansehen.' })
    })
  }

  default { Fail "Unbekannte Operation '$Op'" 'bad-args' }
}
