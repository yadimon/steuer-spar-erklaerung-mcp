# Die Seitenueberschrift darf nicht mehr je Lesung einen vollstaendigen
# Baumlauf kosten - aber sie darf auch nie geraten werden.
#
# `Get-CurrentHeading` wird an zwoelf Stellen ohne fertigen Baum aufgerufen,
# fuenf davon in Warteschleifen; dort lief bisher je Pollrunde ein kompletter
# Lauf. Die Ueberschrift haengt jedoch an einem einzelnen Knoten mit stabiler,
# vollstaendiger AutomationId. Der Suffixweg findet ihn nur ueber den Baum, weil
# der Container tief unter den Splittern liegt und `Wurzel + Endung` nichts
# trifft (gemessen: die gezielte Abfrage auf `Wurzel + Endung` liefert nichts).
# Die vollstaendige Id laesst sich danach aber gezielt abfragen.
#
# Dieser Vertrag zurrt die Sicherheitseigenschaften der Abkuerzung fest:
#   1. Mit uebergebenem Baum aendert sich nichts.
#   2. Der Merker gilt je Fenster und lebt nur im Prozess.
#   3. Er wird nur benutzt, wenn er weiterhin einen `Text`-Knoten bindet.
#   4. Passt er nicht mehr, wird er verworfen und der Baumlauf entscheidet neu.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$source = Get-Content -LiteralPath $workerPath -Raw

$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

$definition = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-CurrentHeading'
}, $true))
if ($definition.Count -ne 1) { throw 'Get-CurrentHeading ist nicht eindeutig vorhanden.' }
$body = $definition[0].Extent.Text

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

# 1 Der Weg mit fertigem Baum bleibt unveraendert und fasst den Merker nicht an.
$treePath = [regex]::Match($body, 'if \(\$null -ne \$Tree\) \{ return \(Get-SSEHeading \$Tree\)\.text \}')
Assert-True $treePath.Success `
  'Mit uebergebenem Baum muss Get-CurrentHeading unveraendert direkt antworten.'
$beforeTreeReturn = $body.Substring(0, $treePath.Index)
Assert-True (-not ($beforeTreeReturn -match 'SSE_HEADING_NODE_AID')) `
  'Der Merker darf den Weg mit uebergebenem Baum nicht beeinflussen.'

# 2 Der Merker ist fensterbezogen.
Assert-True ($source -match '\$script:SSE_HEADING_NODE_AID = @\{\}') `
  'Der Merker fehlt oder ist keine Zuordnung.'
Assert-True ($body -match '\$key = \[string\]\[int64\]\$Hwnd') `
  'Der Merker muss je Fenster gefuehrt werden, nicht global.'

# 3 Ein gemerkter Knoten wird nur nach Typpruefung verwendet.
$typeCheck = [regex]::Match($body, '\$current\.ControlType -eq \[System\.Windows\.Automation\.ControlType\]::Text')
Assert-True $typeCheck.Success `
  'Der gemerkte Knoten muss vor der Verwendung als Text bestaetigt werden.'
$returnIndex = $body.IndexOf('return ("$($current.Name)"')
Assert-True ($returnIndex -gt $typeCheck.Index) `
  'Die Typpruefung muss vor der Rueckgabe stehen.'

# 4 Passt der Merker nicht, wird er entfernt - es wird nichts geraten.
Assert-True ($body -match '\$script:SSE_HEADING_NODE_AID\.Remove\(\$key\)') `
  'Ein nicht mehr passender Merker muss verworfen werden.'
$removeIndex = $body.IndexOf('$script:SSE_HEADING_NODE_AID.Remove($key)')
$walkIndex = $body.IndexOf('Walk-Tree $Hwnd 1200 25 12 -WithValues')
Assert-True ($walkIndex -gt $removeIndex) `
  'Nach dem Verwerfen muss der Baumlauf entscheiden.'

# 5 Der Rueckfallweg bleibt exakt der bisherige Lauf, damit sich die Sicht des
#   Workers auf den Baum nicht nebenbei aendert.
Assert-True ($walkIndex -ge 0) `
  'Der Rueckfallweg muss denselben Baumlauf verwenden wie bisher (1200/25/12, mit Werten).'

# 6 Gemerkt wird die AutomationId genau des Knotens, den der bisherige Weg
#   ausgewaehlt haette - nicht irgendein Text im Fenster.
Assert-True ($body -match "Get-SSEContainerChild \`$walked\.nodes \(Get-SSEMainWindowSelectors\)\.heading 'Text'") `
  'Der zu merkende Knoten muss ueber denselben Containerweg bestimmt werden.'

Write-Output 'Ueberschrift: Merker je Fenster, nur typgeprueft verwendet, sonst Baumlauf.'
