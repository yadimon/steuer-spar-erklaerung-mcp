function Normalize-SSEScalar($Value) {
  if ($null -eq $Value) { return '' }
  (("$Value" -replace '\s', '') -replace ',', '.').Trim()
}

function ConvertTo-SSETableNumber([string]$Value) {
  if ($null -eq $Value) { return $null }
  $text = $Value.Trim() -replace '\s', ''
  if (-not $text) { return $null }

  if ($text -match '^-?\d+$') {
    $normalized = $text
  } elseif ($text -match '^-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d+$') {
    $normalized = $text.Replace('.', '').Replace(',', '.')
  } elseif ($text -match '^-?\d+\.\d+$') {
    $parts = $text.TrimStart('-').Split('.')
    $normalized = $(if ($parts[1].Length -eq 3) { $text.Replace('.', '') } else { $text })
  } elseif ($text -match '^-?\d{1,3}(?:\.\d{3}){2,}$') {
    $normalized = $text.Replace('.', '')
  } else {
    return $null
  }

  $parsed = [decimal]0
  $styles = [Globalization.NumberStyles]::AllowLeadingSign -bor [Globalization.NumberStyles]::AllowDecimalPoint
  if ([decimal]::TryParse($normalized, $styles, [Globalization.CultureInfo]::InvariantCulture, [ref]$parsed)) {
    return $parsed
  }
  $null
}

function Test-SSEScalarEqual($Actual, $Expected) {
  $a = Normalize-SSEScalar $Actual
  $e = Normalize-SSEScalar $Expected
  if ($a -eq $e) { return $true }
  $actualNumber = ConvertTo-SSETableNumber "$Actual"
  $expectedNumber = ConvertTo-SSETableNumber "$Expected"
  $null -ne $actualNumber -and $null -ne $expectedNumber -and $actualNumber -eq $expectedNumber
}

function Test-SSETableCellEquivalent([string]$Actual, [string]$Requested) {
  # Ein volles Datum ist kein Dezimalwert. Beide sichtbaren Jahre und der
  # Kalendertag muessen stimmen; auch identische ungueltige Daten sind kein
  # belastbarer Readback. Eine gekuerzte Anzeige uebernimmt nur das explizit
  # angeforderte Jahr, niemals pauschal das Produktjahr.
  $requestedIsFullDate = $Requested -match '^\d{1,2}\.\d{1,2}\.\d{4}$'
  $actualIsFullDate = $Actual -match '^\d{1,2}\.\d{1,2}\.\d{4}$'
  if ($requestedIsFullDate -or $actualIsFullDate) {
    if (-not $requestedIsFullDate) { return $false }
    $requestedDate = [DateTime]::MinValue
    $formats = [string[]]@('d.M.yyyy', 'dd.M.yyyy', 'd.MM.yyyy', 'dd.MM.yyyy')
    if (-not [DateTime]::TryParseExact($Requested, $formats,
        [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None,
        [ref]$requestedDate)) { return $false }
    $actualText = $Actual
    if ($Actual -match '^\d{1,2}\.\d{1,2}$') {
      $actualText = $Actual + '.' + $requestedDate.Year.ToString('0000')
    } elseif ($Actual -match '^(\d{1,2}\.\d{1,2})\.(\d{2})$') {
      if ([int]$Matches[2] -ne ($requestedDate.Year % 100)) { return $false }
      $actualText = $Matches[1] + '.' + $requestedDate.Year.ToString('0000')
    }
    $actualDate = [DateTime]::MinValue
    if (-not [DateTime]::TryParseExact($actualText, $formats,
        [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None,
        [ref]$actualDate)) { return $false }
    return $actualDate -eq $requestedDate
  }
  if ($Actual -eq $Requested) { return $true }
  if (-not $Requested -and $Actual -in @('', '0', '0,00', '0.00')) { return $true }
  $actualNumber = ConvertTo-SSETableNumber $Actual
  $requestedNumber = ConvertTo-SSETableNumber $Requested
  if ($null -ne $actualNumber -and $null -ne $requestedNumber) {
    return $actualNumber -eq $requestedNumber
  }
  $false
}
