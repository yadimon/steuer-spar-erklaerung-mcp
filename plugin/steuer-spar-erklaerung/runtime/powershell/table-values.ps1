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
  if ($Actual -eq $Requested) { return $true }
  if (-not $Requested -and $Actual -in @('', '0', '0,00', '0.00')) { return $true }
  # Qt zeigt ein eingegebenes Datum teilweise ohne Jahr an. Tag und Monat sind
  # dann die belastbare Ruecklesung; das Steuerjahr ist durch Produkt/Falldatei
  # bereits fest auf 2025 gebunden.
  if ($Requested -match '^\d{1,2}\.\d{1,2}\.\d{4}$' -and $Actual -match '^\d{1,2}\.\d{1,2}(?:\.\d{2,4})?$') {
    $requestedDate = $Requested.Split('.')
    $actualDate = $Actual.Split('.')
    return [int]$requestedDate[0] -eq [int]$actualDate[0] -and
      [int]$requestedDate[1] -eq [int]$actualDate[1]
  }
  $actualNumber = ConvertTo-SSETableNumber $Actual
  $requestedNumber = ConvertTo-SSETableNumber $Requested
  if ($null -ne $actualNumber -and $null -ne $requestedNumber) {
    return $actualNumber -eq $requestedNumber
  }
  $false
}
