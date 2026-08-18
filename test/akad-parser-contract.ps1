$ErrorActionPreference = 'Stop'

function Assert-Equal($Actual, $Expected, [string]$Label) {
  if ($Actual -ne $Expected) { throw "$Label`: erwartet '$Expected', erhalten '$Actual'" }
}

function Assert-True([bool]$Condition, [string]$Label) {
  if (-not $Condition) { throw $Label }
}

function Write-AkadName([IO.BinaryWriter]$Writer, [string]$Name, [byte]$Type) {
  $nameBytes = [Text.Encoding]::ASCII.GetBytes($Name + [char]0)
  $Writer.Write([uint32]$nameBytes.Length)
  $Writer.Write([byte[]]$nameBytes)
  $Writer.Write($Type)
}

function Write-AkadPrefixedRecord([IO.BinaryWriter]$Writer, [string]$Name, [byte]$Type, [byte[]]$Value) {
  Write-AkadName -Writer $Writer -Name $Name -Type $Type
  $Writer.Write([uint32]$Value.Length)
  $Writer.Write([byte[]]$Value)
}

function Write-AkadDateRecord([IO.BinaryWriter]$Writer, [string]$Name, [byte]$Day, [byte]$Month, [uint16]$Year) {
  Write-AkadName -Writer $Writer -Name $Name -Type 5
  $Writer.Write($Day)
  $Writer.Write($Month)
  $Writer.Write($Year)
}

function Write-AkadNumberRecord([IO.BinaryWriter]$Writer, [string]$Name, [byte]$Value) {
  Write-AkadName -Writer $Writer -Name $Name -Type 6
  $Writer.Write($Value)
}

function Get-Utf8NullTerminated([string]$Value) {
  return [byte[]]([Text.Encoding]::UTF8.GetBytes($Value) + [byte]0)
}

function New-AkadFixture([string]$Path, [ValidateSet('true','false','unknown','platzhalter','unlesbar','typed-date')][string]$TransferState) {
  $stream = New-Object IO.MemoryStream
  $writer = New-Object IO.BinaryWriter($stream)
  try {
    $writer.Write([byte[]][Text.Encoding]::ASCII.GetBytes('AKAD'))
    $writer.Write((New-Object byte[] 8))
    $uuidBytes = [byte[]]([Text.Encoding]::ASCII.GetBytes('12345678-1234-1234-1234-123456789abc') + [byte]0)
    $writer.Write([uint32]$uuidBytes.Length)
    $writer.Write($uuidBytes)
    $writer.Write([byte[]][Text.Encoding]::ASCII.GetBytes('FIIF'))
    $writer.Write([byte[]](0xAA, 0xBB, 0xCC))

    Write-AkadPrefixedRecord -Writer $writer -Name 'FileType' -Type 4 -Value (Get-Utf8NullTerminated 'Gew')
    Write-AkadPrefixedRecord -Writer $writer -Name 'VJahr' -Type 4 -Value (Get-Utf8NullTerminated '2025')
    Write-AkadPrefixedRecord -Writer $writer -Name 'Steuernummer' -Type 4 -Value ([byte[]](0x53, 0x74, 0xE4, 0x00))
    Write-AkadDateRecord -Writer $writer -Name 'FileSavedDate' -Day 3 -Month 8 -Year 2026
    Write-AkadNumberRecord -Writer $writer -Name 'MitElsterVersendetText' -Value 1
    if ($TransferState -eq 'true') {
      Write-AkadPrefixedRecord -Writer $writer -Name 'ElsterTransferTime' -Type 4 -Value (Get-Utf8NullTerminated '02.08.2026 11:22:33')
    } elseif ($TransferState -eq 'false') {
      Write-AkadPrefixedRecord -Writer $writer -Name 'ElsterTransferTime' -Type 4 -Value ([byte[]](0))
    } elseif ($TransferState -eq 'platzhalter') {
      # Genau das steht im Herstellermusterfall.
      Write-AkadPrefixedRecord -Writer $writer -Name 'ElsterTransferTime' -Type 4 -Value (Get-Utf8NullTerminated '-')
    } elseif ($TransferState -eq 'unlesbar') {
      Write-AkadPrefixedRecord -Writer $writer -Name 'ElsterTransferTime' -Type 4 -Value (Get-Utf8NullTerminated 'spaeter')
    } elseif ($TransferState -eq 'typed-date') {
      Write-AkadDateRecord -Writer $writer -Name 'ElsterTransferTime' -Day 0 -Month 0 -Year 0
    }
    Write-AkadPrefixedRecord -Writer $writer -Name 'svCrypted' -Type 12 -Value ([byte[]](1,2,3,4,5,6,7,8))
    $writer.Flush()
    [IO.File]::WriteAllBytes($Path, $stream.ToArray())
  } finally {
    $writer.Dispose()
    $stream.Dispose()
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $repoRoot 'powershell\akad-parser.ps1')
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('sse-akad-contract-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temporary) | Out-Null

try {
  $truePath = Join-Path $temporary 'true.Gew2025'
  $falsePath = Join-Path $temporary 'false.Gew2025'
  $unknownPath = Join-Path $temporary 'unknown.Gew2025'
  $shortPath = Join-Path $temporary 'short.Gew2025'
  $notAkadPath = Join-Path $temporary 'other.Gew2025'
  $largePath = Join-Path $temporary 'large.Gew2025'
  $missingPath = Join-Path $temporary 'missing.Gew2025'
  $placeholderPath = Join-Path $temporary 'platzhalter.Gew2025'
  $unreadablePath = Join-Path $temporary 'unlesbar.Gew2025'
  $typedDatePath = Join-Path $temporary 'typed-date.Gew2025'
  New-AkadFixture -Path $truePath -TransferState true
  New-AkadFixture -Path $falsePath -TransferState false
  New-AkadFixture -Path $unknownPath -TransferState unknown
  New-AkadFixture -Path $placeholderPath -TransferState platzhalter
  New-AkadFixture -Path $unreadablePath -TransferState unlesbar
  New-AkadFixture -Path $typedDatePath -TransferState typed-date
  [IO.File]::WriteAllBytes($shortPath, [byte[]](1,2,3))
  [IO.File]::WriteAllBytes($notAkadPath, (New-Object byte[] 64))
  [IO.File]::WriteAllBytes($largePath, (New-Object byte[] (600 * 1024)))

  $parsedTrue = @(Invoke-AkadParser -Paths @($truePath))[0]
  Assert-Equal $parsedTrue.file $truePath 'Dateireferenz'
  Assert-Equal $parsedTrue.size ([IO.FileInfo]$truePath).Length 'Dateigroesse'
  Assert-Equal $parsedTrue.read $parsedTrue.size 'Kopfleselaenge'
  Assert-Equal $parsedTrue.uuid '12345678-1234-1234-1234-123456789abc' 'UUID'
  Assert-Equal $parsedTrue.meta.FileType.typ 'text' 'Texttyp'
  Assert-Equal $parsedTrue.meta.FileType.value 'Gew' 'Textwert'
  Assert-Equal $parsedTrue.meta.Steuernummer.value ('St' + [char]0x00E4) 'Latin1-Fallback'
  Assert-Equal $parsedTrue.meta.FileSavedDate.typ 'datum' 'Datumstyp'
  Assert-Equal $parsedTrue.meta.FileSavedDate.value '03.08.2026' 'Datumswert'
  Assert-Equal $parsedTrue.meta.MitElsterVersendetText.typ 'zahl' 'Zahltyp'
  Assert-Equal $parsedTrue.meta.MitElsterVersendetText.value 1 'Zahlwert'
  Assert-Equal $parsedTrue.meta.svCrypted.typ 12 'Crypt-Typ bleibt numerisch'
  Assert-Equal $parsedTrue.meta.svCrypted.encryptedBytes 8 'Verschluesselte Bytes'
  Assert-Equal $parsedTrue.records[0] 'FileType' 'Stabile Satzreihenfolge'
  Assert-Equal $parsedTrue.records[-1] 'svCrypted' 'Parser stoppt am verschluesselten Satz'
  Assert-True ($parsedTrue.transmitted -is [bool]) 'transmitted=true muss boolesch sein'
  Assert-Equal $parsedTrue.transmitted $true 'Sicher uebermittelt'
  Assert-Equal $parsedTrue.elsterTransferTime '02.08.2026 11:22:33' 'ELSTER-Zeit'
  Assert-Equal $parsedTrue.transmittedReason (([char]0x00FC) + 'bermittelt am 02.08.2026 11:22:33') 'Grund fuer Uebermittlung'

  $parsedFalse = @(Invoke-AkadParser -Paths @($falsePath))[0]
  Assert-True ($parsedFalse.transmitted -is [bool]) 'transmitted=false muss boolesch sein'
  Assert-Equal $parsedFalse.transmitted $false 'Sicher nicht uebermittelt'
  Assert-Equal $parsedFalse.elsterTransferTime '' 'Leere ELSTER-Zeit'

  # Der offizielle Musterfall traegt '-' fuer 'nie versendet'. Der frueher
  # reine Wahrheitswert-Test meldete ihn als "übermittelt am -" - eine
  # Falschaussage ueber genau die Tatsache, auf die es hier ankommt.
  $parsedPlaceholder = @(Invoke-AkadParser -Paths @($placeholderPath))[0]
  Assert-True ($parsedPlaceholder.transmitted -is [bool]) 'Platzhalter muss boolesch entschieden werden'
  Assert-Equal $parsedPlaceholder.transmitted $false 'Platzhalter - heisst nicht uebermittelt'
  Assert-Equal $parsedPlaceholder.elsterTransferTime '-' 'Platzhalter bleibt im Rohwert sichtbar'
  Assert-Equal $parsedPlaceholder.transmittedReason "ElsterTransferTime ist der Platzhalter '-' - kein Versand" 'Grund fuer Platzhalter'

  # Ein unbekanntes Format wird NICHT still zu 'nicht uebermittelt': eine
  # irrtuemlich zweite Abgabe waere der teurere Fehler.
  $parsedUnreadable = @(Invoke-AkadParser -Paths @($unreadablePath))[0]
  Assert-Equal $parsedUnreadable.transmitted 'unknown' 'Unbekanntes Zeitformat bleibt unbekannt'

  $parsedTypedDate = @(Invoke-AkadParser -Paths @($typedDatePath))[0]
  Assert-True ($parsedTypedDate.transmitted -is [string]) 'Unerwarteter Feldtyp darf kein boolesches Versand-true liefern'
  Assert-Equal $parsedTypedDate.transmitted 'unknown' 'Unerwarteter Feldtyp bleibt unbekannt'

  $parsedUnknown = @(Invoke-AkadParser -Paths @($unknownPath))[0]
  Assert-Equal $parsedUnknown.transmitted 'unknown' 'Fehlendes Feld bleibt unbekannt'
  Assert-Equal $parsedUnknown.elsterTransferTime $null 'Unbekannte ELSTER-Zeit'
  $expectedUnknownReason = 'Feld ElsterTransferTime nicht im Kopf gefunden - der Kopf wurde wom' + [char]0x00F6 +
    'glich unvollst' + [char]0x00E4 + 'ndig gelesen. Keine Aussage m' + [char]0x00F6 + 'glich.'
  Assert-Equal $parsedUnknown.transmittedReason $expectedUnknownReason 'Grund fuer unbekannten Status'

  $short = @(Invoke-AkadParser -Paths @($shortPath))[0]
  Assert-Equal $short.error 'Datei zu kurz (3 Byte)' 'Kurze Datei'
  Assert-True (-not $short.PSObject.Properties['transmitted']) 'Strukturfehler behaelt die bisherige Ausgabeform'
  $notAkad = @(Invoke-AkadParser -Paths @($notAkadPath))[0]
  Assert-Equal $notAkad.error 'kein AKAD-Kopf' 'Fremdes Dateiformat'
  $large = @(Invoke-AkadParser -Paths @($largePath))[0]
  Assert-Equal $large.size (600 * 1024) 'Gesamtgroesse grosser Datei'
  Assert-Equal $large.read (512 * 1024) 'Kopfleselimit'

  $multiple = @(Invoke-AkadParser -Paths @($truePath, $missingPath, $falsePath))
  Assert-Equal $multiple.Count 3 'Mehrdatei-Ausgabe'
  Assert-Equal $multiple[0].transmitted $true 'Erste Datei trotz Folgefehler'
  Assert-Equal $multiple[1].file $missingPath 'Fehlerhafte Dateireferenz'
  Assert-Equal $multiple[1].transmitted 'unknown' 'Nicht lesbare Datei bleibt unbekannt'
  Assert-True ([bool]$multiple[1].error) 'Nicht lesbare Datei braucht einen lokalen Fehler'
  Assert-Equal $multiple[2].transmitted $false 'Letzte Datei trotz Vorfehler'

  $json = ConvertTo-Json -InputObject @($multiple) -Depth 12 -Compress
  $decoded = $json | ConvertFrom-Json
  $roundTrip = @()
  foreach ($entry in $decoded) { $roundTrip += $entry }
  Assert-Equal $roundTrip.Count 3 'JSON-Ausgabe bleibt eine Liste'
  Assert-Equal $roundTrip[0].meta.FileType.value 'Gew' 'JSON-Metadatenform'
  Assert-Equal $roundTrip[1].transmitted 'unknown' 'JSON-Tri-State'

  Write-Output 'AKAD-Parser: Python-frei, drei Statuswerte, Mehrdatei-Fehler und PS5-Vertrag bestanden'
} finally {
  $resolvedTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $resolvedTarget = [IO.Path]::GetFullPath($temporary)
  if ($resolvedTarget.StartsWith($resolvedTempRoot, [StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $resolvedTarget) -like 'sse-akad-contract-*') {
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
  }
}
