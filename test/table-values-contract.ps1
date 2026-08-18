$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\powershell\table-values.ps1')

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

foreach ($case in @(
  @('1.234,56', 1234.56),
  @('1234,5', 1234.5),
  @('108.90', 108.90),
  @('1.234', 1234),
  @('1.234.567', 1234567),
  @('-12,34', -12.34)
)) {
  $actual = ConvertTo-SSETableNumber ([string]$case[0])
  Assert-True ($null -ne $actual -and $actual -eq [decimal]$case[1]) "Zahl '$($case[0])' wurde falsch normalisiert."
}

foreach ($invalid in @('1.2.3', '12.34.56', '12.34,56', '1,2,3', 'abc', '')) {
  Assert-True ($null -eq (ConvertTo-SSETableNumber $invalid)) "Mehrdeutige Zahl '$invalid' wurde akzeptiert."
}

Assert-True (Test-SSEScalarEqual '0' '0,00') 'Numerisch gleiches Nullformat wurde abgewiesen.'
Assert-True (Test-SSEScalarEqual '1.234,50' '1234.5') 'Gleicher deutscher/API-Betrag wurde abgewiesen.'
Assert-True (-not (Test-SSEScalarEqual '1' '10')) 'Prefixwerte 1 und 10 wurden faelschlich gleichgesetzt.'
Assert-True (-not (Test-SSEScalarEqual 'abc' 'abcd')) 'Textprefixe wurden faelschlich gleichgesetzt.'
Assert-True (Test-SSETableCellEquivalent '01.07' '01.07.2025') 'Qt-Datum ohne Jahr wurde nicht gebunden verglichen.'
Assert-True (-not (Test-SSETableCellEquivalent '1.2.3' '123')) 'Mehrdeutiger Tabellenwert wurde numerisch bestaetigt.'

Write-Output 'OK: Tabellenwerte sind exakt, gruppierungsgebunden und nicht prefix-tolerant.'
