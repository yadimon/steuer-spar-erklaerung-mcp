# In-Process-Parser fuer den Klartextkopf von SteuerSparErklaerung-Falldateien.
# Windows PowerShell 5.1 kompatibel; keine externe Laufzeit und kein Prozessstart.

$script:AkadMaxHeaderBytes = 512 * 1024
$script:AkadTypeNames = @{ 4 = 'text'; 5 = 'datum'; 6 = 'zahl'; 12 = 'blob' }
$script:AkadLatin1 = [Text.Encoding]::GetEncoding(28591)
$script:AkadUtf8Strict = New-Object System.Text.UTF8Encoding($false, $true)

function Get-AkadBytes {
  param([byte[]]$Data, [int]$Offset, [int]$Count)
  if ($Count -lt 0 -or $Offset -lt 0 -or ($Offset + $Count) -gt $Data.Length) {
    throw 'AKAD-Bytebereich liegt ausserhalb des gelesenen Kopfes.'
  }
  $result = New-Object byte[] $Count
  if ($Count -gt 0) { [Buffer]::BlockCopy($Data, $Offset, $result, 0, $Count) }
  return ,$result
}

function Get-AkadTrimmedBytes {
  param([byte[]]$Data)
  $length = $Data.Length
  while ($length -gt 0 -and $Data[$length - 1] -eq 0) { $length-- }
  Get-AkadBytes -Data $Data -Offset 0 -Count $length
}

function Test-AkadPlausibleRecord {
  param([byte[]]$Data, [int]$Offset)
  if ($Offset -lt 0 -or ($Offset + 9) -gt $Data.Length) { return $false }
  $nameLength = [BitConverter]::ToUInt32($Data, $Offset)
  if ($nameLength -lt 2 -or $nameLength -gt 200 -or ($Offset + 4 + $nameLength + 5) -gt $Data.Length) {
    return $false
  }
  $nameStart = $Offset + 4
  if ($Data[$nameStart + [int]$nameLength - 1] -ne 0) { return $false }
  for ($index = $nameStart; $index -lt ($nameStart + [int]$nameLength - 1); $index++) {
    if ($Data[$index] -lt 33 -or $Data[$index] -ge 127) { return $false }
  }
  return $true
}

function ConvertFrom-AkadTextBytes {
  param([byte[]]$Data)
  $trimmed = [byte[]](Get-AkadTrimmedBytes -Data $Data)
  try {
    return $script:AkadUtf8Strict.GetString($trimmed)
  } catch [Text.DecoderFallbackException] {
    return $script:AkadLatin1.GetString($trimmed)
  }
}

function Read-AkadHeader {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [int]$MaxRecords = 400
  )

  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try {
    $size = $stream.Length
    $readLength = [int][Math]::Min([int64]$script:AkadMaxHeaderBytes, $size)
    $data = New-Object byte[] $readLength
    $totalRead = 0
    while ($totalRead -lt $readLength) {
      $count = $stream.Read($data, $totalRead, $readLength - $totalRead)
      if ($count -le 0) { break }
      $totalRead += $count
    }
    if ($totalRead -ne $readLength) {
      $complete = New-Object byte[] $totalRead
      if ($totalRead -gt 0) { [Buffer]::BlockCopy($data, 0, $complete, 0, $totalRead) }
      $data = $complete
    }
  } finally {
    $stream.Dispose()
  }

  $out = [ordered]@{ file = $Path; size = $size; read = $data.Length }
  if ($data.Length -lt 64) {
    $out['error'] = "Datei zu kurz ($($data.Length) Byte)"
    return [pscustomobject]$out
  }
  if ([Text.Encoding]::ASCII.GetString($data, 0, 4) -ne 'AKAD') {
    $out['error'] = 'kein AKAD-Kopf'
    return [pscustomobject]$out
  }

  $uuidLength = [BitConverter]::ToUInt32($data, 12)
  if ($uuidLength -lt 8 -or $uuidLength -gt 256 -or (16 + $uuidLength + 8) -gt $data.Length) {
    $out['error'] = "unplausible UUID-Laenge $uuidLength"
    return [pscustomobject]$out
  }
  $uuidBytes = [byte[]](Get-AkadBytes -Data $data -Offset 16 -Count ([int]$uuidLength))
  $out['uuid'] = [Text.Encoding]::ASCII.GetString([byte[]](Get-AkadTrimmedBytes -Data $uuidBytes))
  $offset = 16 + [int]$uuidLength
  if ([Text.Encoding]::ASCII.GetString($data, $offset, 4) -ne 'FIIF') {
    $out['error'] = "FIIF fehlt bei $offset"
    return [pscustomobject]$out
  }

  $start = -1
  for ($candidate = $offset + 4; $candidate -lt ($offset + 24); $candidate++) {
    if (Test-AkadPlausibleRecord -Data $data -Offset $candidate) {
      $start = $candidate
      break
    }
  }
  if ($start -lt 0) {
    $out['error'] = 'kein Satzanfang gefunden'
    return [pscustomobject]$out
  }
  $out['headerBytes'] = $start

  $meta = [ordered]@{}
  $order = New-Object System.Collections.ArrayList
  $offset = $start
  for ($recordIndex = 0; $recordIndex -lt $MaxRecords; $recordIndex++) {
    if (($offset + 4) -gt $data.Length) { break }
    $nameLength = [BitConverter]::ToUInt32($data, $offset)
    if ($nameLength -lt 1 -or $nameLength -gt 500) { break }
    if (($offset + 4 + $nameLength) -gt $data.Length) { break }
    $nameBytes = [byte[]](Get-AkadBytes -Data $data -Offset ($offset + 4) -Count ([int]$nameLength))
    $name = $script:AkadLatin1.GetString([byte[]](Get-AkadTrimmedBytes -Data $nameBytes))
    $valueHeaderOffset = $offset + 4 + [int]$nameLength
    if (($valueHeaderOffset + 5) -gt $data.Length) { break }
    $type = [int]$data[$valueHeaderOffset]

    $variants = New-Object System.Collections.ArrayList
    if ($type -eq 6) {
      $null = $variants.Add([pscustomobject]@{
        raw = [byte[]](Get-AkadBytes -Data $data -Offset ($valueHeaderOffset + 1) -Count 1)
        length = 1; next = $valueHeaderOffset + 2
      })
    }
    if ($type -eq 5) {
      $null = $variants.Add([pscustomobject]@{
        raw = [byte[]](Get-AkadBytes -Data $data -Offset ($valueHeaderOffset + 1) -Count 4)
        length = 4; next = $valueHeaderOffset + 5
      })
    }
    $prefixedLength = [BitConverter]::ToUInt32($data, $valueHeaderOffset + 1)
    if ($prefixedLength -le ($data.Length - ($valueHeaderOffset + 5))) {
      $null = $variants.Add([pscustomobject]@{
        raw = [byte[]](Get-AkadBytes -Data $data -Offset ($valueHeaderOffset + 5) -Count ([int]$prefixedLength))
        length = [int]$prefixedLength; next = $valueHeaderOffset + 5 + [int]$prefixedLength
      })
    }
    if ($type -ne 6) {
      $null = $variants.Add([pscustomobject]@{
        raw = [byte[]](Get-AkadBytes -Data $data -Offset ($valueHeaderOffset + 1) -Count 1)
        length = 1; next = $valueHeaderOffset + 2
      })
    }
    if ($type -ne 5) {
      $null = $variants.Add([pscustomobject]@{
        raw = [byte[]](Get-AkadBytes -Data $data -Offset ($valueHeaderOffset + 1) -Count 4)
        length = 4; next = $valueHeaderOffset + 5
      })
    }

    $chosen = $null
    foreach ($variant in $variants) {
      if ($variant.next -le $data.Length -and
          ((Test-AkadPlausibleRecord -Data $data -Offset $variant.next) -or $variant.next -eq $data.Length)) {
        $chosen = $variant
        break
      }
    }
    if (-not $chosen) {
      if (-not $variants.Count) { break }
      $chosen = $variants[0]
    }
    $raw = [byte[]]$chosen.raw
    $valueLength = [int]$chosen.length
    $offset = [int]$chosen.next

    if ($name -eq 'svCrypted') {
      $meta[$name] = [pscustomobject]@{ typ = $type; encryptedBytes = $data.Length - ($valueHeaderOffset + 5) }
      $null = $order.Add($name)
      break
    }

    if ($type -eq 5 -and $valueLength -eq 4) {
      $day = [int]$raw[0]
      $month = [int]$raw[1]
      $year = [BitConverter]::ToUInt16($raw, 2)
      if ($month -ge 1 -and $month -le 12 -and $year -gt 1900 -and $year -lt 2200) {
        $value = '{0:D2}.{1:D2}.{2}' -f $day, $month, $year
      } else {
        $value = @($raw | ForEach-Object { $_.ToString('x2') }) -join ' '
      }
    } elseif ($valueLength -eq 1 -and $type -ne 4 -and $type -ne 12) {
      $value = [int]$raw[0]
    } else {
      $value = ConvertFrom-AkadTextBytes -Data $raw
    }
    $typeName = $(if ($script:AkadTypeNames.ContainsKey($type)) { $script:AkadTypeNames[$type] } else { [string]$type })
    $meta[$name] = [pscustomobject]@{ typ = $typeName; value = $value }
    $null = $order.Add($name)
  }

  $out['records'] = @($order)
  $out['meta'] = [pscustomobject]$meta
  if (-not $meta.Contains('ElsterTransferTime')) {
    $out['elsterTransferTime'] = $null
    $out['transmitted'] = 'unknown'
    $out['transmittedReason'] = 'Feld ElsterTransferTime nicht im Kopf gefunden - der Kopf wurde womöglich unvollständig gelesen. Keine Aussage möglich.'
  } else {
    $record = $meta['ElsterTransferTime']
    $transferTime = $(if ($null -eq $record.value) { '' } else { ([string]$record.value).Trim() })
    $out['elsterTransferTime'] = $transferTime
    # SSE schreibt 'kein Versand' je nach Build als leer, '0' oder '-'. Der
    # Herstellermusterfall enthaelt '-'; der frueher reine Wahrheitswert-Test
    # meldete ihn deshalb als "übermittelt am -", obwohl er nie versendet
    # wurde. Ein echter Zeitstempel enthaelt immer Ziffern.
    #
    # Die Fehlerrichtung ist bewusst gewaehlt: Ein unbekanntes, nicht
    # platzhalterartiges Format bleibt 'unknown' statt still 'nicht
    # übermittelt' zu behaupten - eine irrtuemlich zweite Abgabe waere der
    # teurere Fehler.
    if ([string]$record.typ -ne 'text') {
      $out['transmitted'] = 'unknown'
      $out['transmittedReason'] = "ElsterTransferTime hat unerwarteten Typ '$($record.typ)' - keine Aussage möglich."
    } elseif ($transferTime -in @('', '0', '-')) {
      $out['transmitted'] = $false
      $out['transmittedReason'] = $(if ($transferTime) {
        "ElsterTransferTime ist der Platzhalter '$transferTime' - kein Versand"
      } else { 'ElsterTransferTime ist leer' })
    } elseif ($transferTime -match '\d') {
      $out['transmitted'] = $true
      $out['transmittedReason'] = "übermittelt am $transferTime"
    } else {
      $out['transmitted'] = 'unknown'
      $out['transmittedReason'] = "ElsterTransferTime '$transferTime' ist weder Platzhalter noch Zeitstempel - keine Aussage möglich."
    }
  }
  return [pscustomobject]$out
}

function Invoke-AkadParser {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string[]]$Paths)
  if (-not $Paths -or -not $Paths.Count) { throw 'Dateiname fehlt' }
  foreach ($path in $Paths) {
    try {
      Read-AkadHeader -Path $path
    } catch {
      [pscustomobject][ordered]@{
        file = $path
        error = "$($_.Exception.GetType().Name): $($_.Exception.Message)"
        transmitted = 'unknown'
        transmittedReason = 'Datei nicht lesbar - keine Aussage moeglich'
      }
    }
  }
}
