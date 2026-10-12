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

function Test-SSETableReadSnapshotBinding {
  param([Parameter(Mandatory)]$Before, [Parameter(Mandatory)]$After, [switch]$BeforeNavigation)
  $initial=$Before.navigationBinding; $fresh=$After.navigationBinding
  if (-not $initial -or -not $fresh -or -not $initial.complete -or -not $fresh.complete -or
      -not $initial.heading -or -not $initial.tableIdentity -or
      $initial.heading -cne $fresh.heading -or $initial.tableIdentity -cne $fresh.tableIdentity -or
      $initial.tableRootAid -cne $fresh.tableRootAid -or
      $initial.tableRootRid -cne $fresh.tableRootRid -or
      $initial.scopePrefix -cne $fresh.scopePrefix -or $initial.selectionMethod -cne $fresh.selectionMethod -or
      $initial.summaryIdentity -cne $fresh.summaryIdentity -or
      -not (Test-SSEScalarEqual $initial.summaryValue $fresh.summaryValue) -or
      $Before.tabelleAnzahl -ne 1 -or $After.tabelleAnzahl -ne 1 -or
      $Before.error -or $After.error) { return $false }
  if ($BeforeNavigation -and $initial.contentSignature -cne $fresh.contentSignature) { return $false }
  $true
}

function Resolve-SSEVehicleCostAddedRow {
  param([Parameter(Mandatory)]$Region, [Parameter(Mandatory)][object[]]$Values)
  if (-not $Region.ok -or $Region.profileMappingId -cne 'vehicle_costs_without_input_tax' -or
      $Values.Count -ne 6 -or -not [string]$Values[1] -or -not [string]$Values[2] -or
      -not (Test-SSEScalarEqual $Values[4] '0')) {
    return [pscustomobject]@{ ok=$false; matchCount=0; row=@(); reason='zero-tax-cost-row-contract-unbound' }
  }
  $matches = New-Object System.Collections.ArrayList
  foreach ($group in @($Region.cells | Group-Object y)) {
    $cells = @($group.Group | Sort-Object x)
    if ($cells.Count -ne 6) { continue }
    $allEqual = $true
    foreach ($column in @(1,2,3,4,5)) {
      $expected = $(if ($column -eq 5) { [string]$Values[3] } else { [string]$Values[$column] })
      $actual = $(if ([string]$cells[$column].val) { [string]$cells[$column].val } else { [string]$cells[$column].name })
      if (-not (Test-SSETableCellEquivalent $actual $expected)) { $allEqual=$false; break }
    }
    if ($allEqual) { $null = $matches.Add([pscustomobject]@{ row=$cells; rowY=[int]$group.Name }) }
  }
  [pscustomobject]@{
    ok=[bool]($matches.Count -eq 1); matchCount=$matches.Count
    row=$(if ($matches.Count -eq 1) { @($matches[0].row) } else { @() })
    rowY=$(if ($matches.Count -eq 1) { $matches[0].rowY } else { $null })
    reason=$(if ($matches.Count -eq 1) { 'exact-date-description-amount-rate-net-row' } else { 'row-absent-or-ambiguous' })
  }
}
