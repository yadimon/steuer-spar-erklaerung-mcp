param(
  [Parameter(Mandatory = $true)][string]$ZipPath,
  [Parameter(Mandatory = $true)][string]$ExpectedRootName,
  [Parameter(Mandatory = $true)][string]$ExpectedProduct,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion
)

$ErrorActionPreference = 'Stop'
$MaxEntries = 20000
$MaxManifestBytes = 16MB
$MaxEntryBytes = 256MB
$MaxTotalBytes = 1GB
$ReservedWindowsNames = '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)'

function Assert-PortablePath([string]$Path, [string]$Label) {
  if ([string]::IsNullOrWhiteSpace($Path) -or
      $Path.Contains('\') -or
      $Path.StartsWith('/') -or
      $Path.Contains(':') -or
      $Path -match '[\x00-\x1f]') {
    throw "$Label enthaelt einen unsicheren Archivpfad: '$Path'."
  }
  $trimmed = $Path.TrimEnd('/')
  if (-not $trimmed) { throw "$Label enthaelt einen leeren Archivpfad." }
  foreach ($segment in $trimmed.Split('/')) {
    if (-not $segment -or $segment -eq '.' -or $segment -eq '..' -or
        $segment.EndsWith('.') -or $segment.EndsWith(' ') -or
        $segment -match $ReservedWindowsNames) {
      throw "$Label enthaelt ein unter Windows unsicheres Segment: '$Path'."
    }
  }
}

function Get-StreamSha256([IO.Stream]$Stream) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($algorithm.ComputeHash($Stream))).Replace('-', '').ToLowerInvariant()
  }
  finally {
    $algorithm.Dispose()
  }
}

$zipFullPath = [IO.Path]::GetFullPath($ZipPath)
if (-not (Test-Path -LiteralPath $zipFullPath -PathType Leaf)) {
  throw "Portables ZIP fehlt: $zipFullPath"
}
Assert-PortablePath $ExpectedRootName 'Erwarteter Wurzelname'
if ($ExpectedRootName.Contains('/')) {
  throw "Erwarteter Wurzelname darf kein Unterverzeichnis sein: '$ExpectedRootName'."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zipFullPath)
try {
  if ($archive.Entries.Count -lt 2 -or $archive.Entries.Count -gt $MaxEntries) {
    throw "ZIP-Eintragszahl liegt ausserhalb 2..${MaxEntries}: $($archive.Entries.Count)."
  }

  $entries = New-Object 'Collections.Generic.Dictionary[string,IO.Compression.ZipArchiveEntry]' ([StringComparer]::Ordinal)
  $extractionPaths = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  [long]$totalBytes = 0
  foreach ($entry in $archive.Entries) {
    $name = [string]$entry.FullName
    Assert-PortablePath $name 'ZIP'
    $canonical = $name.TrimEnd('/')
    if (-not $canonical.StartsWith("$ExpectedRootName/", [StringComparison]::Ordinal) -and
        $canonical -cne $ExpectedRootName) {
      throw "ZIP-Eintrag liegt ausserhalb der erwarteten Wurzel '$ExpectedRootName': '$name'."
    }
    if (-not $extractionPaths.Add($canonical)) {
      throw "ZIP enthaelt einen unter Windows kollidierenden Pfad: '$name'."
    }
    if ($entries.ContainsKey($name)) {
      throw "ZIP enthaelt einen doppelten Pfad: '$name'."
    }
    $entries.Add($name, $entry)
    if (-not $name.EndsWith('/')) {
      if ($entry.Length -lt 0 -or $entry.Length -gt $MaxEntryBytes) {
        throw "ZIP-Eintrag ist groesser als $MaxEntryBytes Bytes: '$name'."
      }
      $totalBytes += [long]$entry.Length
      if ($totalBytes -gt $MaxTotalBytes) {
        throw "ZIP entpackt mehr als $MaxTotalBytes Bytes."
      }
    }
  }

  $manifestName = "$ExpectedRootName/portable-manifest.json"
  [IO.Compression.ZipArchiveEntry]$manifestEntry = $null
  if (-not $entries.TryGetValue($manifestName, [ref]$manifestEntry) -or
      $manifestEntry.Length -lt 2 -or $manifestEntry.Length -gt $MaxManifestBytes) {
    throw "ZIP enthaelt kein gueltiges, begrenztes portable-manifest.json."
  }
  $manifestStream = $manifestEntry.Open()
  $manifestMemory = New-Object IO.MemoryStream
  try {
    $manifestStream.CopyTo($manifestMemory)
    $manifestBytes = $manifestMemory.ToArray()
  }
  finally {
    $manifestMemory.Dispose()
    $manifestStream.Dispose()
  }
  if ($manifestBytes.Length -ge 3 -and
      $manifestBytes[0] -eq 0xEF -and $manifestBytes[1] -eq 0xBB -and $manifestBytes[2] -eq 0xBF) {
    throw 'portable-manifest.json darf keinen UTF-8-BOM enthalten.'
  }
  $utf8 = New-Object Text.UTF8Encoding($false, $true)
  $manifestText = $utf8.GetString($manifestBytes)
  try { $manifest = $manifestText | ConvertFrom-Json }
  catch { throw "portable-manifest.json ist kein gueltiges UTF-8/JSON: $($_.Exception.Message)" }
  if ($manifest.schemaVersion -ne 1 -or
      [string]$manifest.product -cne $ExpectedProduct -or
      [string]$manifest.productVersion -cne $ExpectedVersion) {
    throw "Portable Manifest stimmt nicht mit Produkt/Version '$ExpectedProduct/$ExpectedVersion' ueberein."
  }

  $manifestFiles = @($manifest.files)
  if ($manifestFiles.Count -lt 1 -or $manifestFiles.Count -gt $MaxEntries) {
    throw 'Portable Manifest enthaelt keine plausible Dateiliste.'
  }
  $expectedFiles = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  [void]$expectedFiles.Add($manifestName)
  foreach ($file in $manifestFiles) {
    $relativePath = [string]$file.path
    Assert-PortablePath $relativePath 'Manifest'
    if ($relativePath.EndsWith('/')) {
      throw "Manifestdatei darf kein Verzeichnis sein: '$relativePath'."
    }
    $entryName = "$ExpectedRootName/$relativePath"
    if (-not $expectedFiles.Add($entryName)) {
      throw "Manifest enthaelt einen unter Windows kollidierenden Pfad: '$relativePath'."
    }
    [IO.Compression.ZipArchiveEntry]$fileEntry = $null
    if (-not $entries.TryGetValue($entryName, [ref]$fileEntry) -or $fileEntry.FullName.EndsWith('/')) {
      throw "Manifestdatei fehlt im ZIP: '$relativePath'."
    }
    $expectedBytes = $file.bytes
    if (-not ($expectedBytes -is [int] -or $expectedBytes -is [long]) -or
        [long]$expectedBytes -lt 0 -or $fileEntry.Length -ne [long]$expectedBytes) {
      throw "Bytezahl stimmt nicht fuer Manifestdatei '$relativePath'."
    }
    $expectedSha256 = [string]$file.sha256
    if ($expectedSha256 -cnotmatch '^[a-f0-9]{64}$') {
      throw "SHA256 ist ungueltig fuer Manifestdatei '$relativePath'."
    }
    $fileStream = $fileEntry.Open()
    try { $actualSha256 = Get-StreamSha256 $fileStream }
    finally { $fileStream.Dispose() }
    if ($actualSha256 -cne $expectedSha256) {
      throw "SHA256 stimmt nicht fuer Manifestdatei '$relativePath'."
    }
  }

  foreach ($entry in $archive.Entries) {
    if (-not $entry.FullName.EndsWith('/') -and -not $expectedFiles.Contains($entry.FullName)) {
      throw "ZIP enthaelt eine nicht manifestierte Datei: '$($entry.FullName)'."
    }
  }
  $fileEntryCount = @($archive.Entries | Where-Object { -not $_.FullName.EndsWith('/') }).Count
  if ($fileEntryCount -ne $expectedFiles.Count) {
    throw "ZIP-Dateizahl $fileEntryCount stimmt nicht mit Manifestzahl $($expectedFiles.Count) ueberein."
  }

  [pscustomobject]@{
    ok = $true
    product = [string]$manifest.product
    productVersion = [string]$manifest.productVersion
    files = $manifestFiles.Count
    entries = $archive.Entries.Count
    uncompressedBytes = $totalBytes
  } | ConvertTo-Json -Compress
}
finally {
  $archive.Dispose()
}
