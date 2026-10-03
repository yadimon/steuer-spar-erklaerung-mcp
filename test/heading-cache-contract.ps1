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
#   1. Mit uebergebenem Baum bestimmt die Funktion den Kandidaten weiterhin aus
#      diesem Baum und prueft seine frische Sichtbarkeit. Der Merker wird dort nie gelesen; Engine 31 darf ihn nur
#      mit der AutomationId genau des Knotens setzen, dessen Text sie liefert.
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

# 1 Der Weg mit fertigem Baum antwortet allein aus diesem Baum. Er bindet
#   denselben Containerknoten wie Get-SSEHeading, liefert dessen Text und darf
#   den Merker nur in Engine 31 mit der AutomationId genau dieses Knotens
#   SETZEN - lesen darf er ihn nie, sonst haenge die Antwort am Merker.
$treePath = [regex]::Match($body, '(?s)if \(\$null -ne \$Tree\) \{(?<inner>.*?)\r?\n  \}')
Assert-True $treePath.Success `
  'Mit uebergebenem Baum muss Get-CurrentHeading einen eigenen, direkten Antwortweg haben.'
$treeBody = $treePath.Groups['inner'].Value
Assert-True ($treeBody -match "\`$treeHeading = Get-SSEVisibleHeadingNode \`$Hwnd \`$Tree") `
  'Der Baumweg muss denselben Containerknoten wie Get-SSEHeading binden.'
Assert-True ($treeBody -match 'if \(\$treeHeading\) \{ return \[string\]\$treeHeading\.name \}') `
  'Der Baumweg muss den Text genau dieses Knotens liefern.'
Assert-True ($treeBody -match 'return \$null') `
  'Ohne Ueberschriftenknoten im Baum darf nichts geraten werden.'
Assert-True (-not ($treeBody -match 'Walk-Tree')) `
  'Der Baumweg darf keinen eigenen Lauf starten.'
$cacheUses = @([regex]::Matches($treeBody, 'SSE_HEADING_NODE_AID[^\r\n]*'))
Assert-True ($cacheUses.Count -eq 1 -and
  $cacheUses[0].Value -eq 'SSE_HEADING_NODE_AID[[string][int64]$Hwnd] = [string]$treeHeading.aid') `
  'Der Baumweg darf den Merker nur mit der AutomationId des zurueckgegebenen Knotens setzen, nie lesen.'
Assert-True ($treeBody -match '\$script:SSE_ENGINE_MAJOR -eq 31') `
  'Nur Engine 31 bindet den Blattknoten ueber eine eigene AutomationId; nur dort darf gesetzt werden.'

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
Assert-True ($body -match "Get-SSEVisibleHeadingNode \`$Hwnd \`$walked") `
  'Der zu merkende Knoten muss ueber denselben Containerweg bestimmt werden.'

Write-Output 'Ueberschrift: Merker je Fenster, nur typgeprueft verwendet, sonst Baumlauf.'

# Both tree paths must reject live, hidden labels before selecting a heading.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
. (Join-Path $root 'powershell/structure-binding.ps1')
foreach($name in @('Test-SSEElementVisible','Get-SSEVisibleHeadingNode','Get-CurrentHeading','AktuelleUeberschrift')) {
  $definitions=@($ast.FindAll({param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  },$true))
  Assert-True ($definitions.Count -eq 1) "Heading function '$name' must be uniquely defined."
  Invoke-Expression $definitions[0].Extent.Text
}
function Get-SSEMainWindowSelectors { [pscustomobject]@{heading='.clientHeader'} }
function New-HeadingElement($Node,$Offscreen) {
  $item=[pscustomobject]@{Offscreen=$Offscreen;Current=[pscustomobject]@{
    ControlType=[System.Windows.Automation.ControlType]::Text;Name=$Node.name;AutomationId=$Node.aid
  }}
  $item|Add-Member ScriptMethod GetCurrentPropertyValue {param($property) $this.Offscreen}
  $item
}
$oldNode=[pscustomobject]@{i=1;p=0;type='Text';name='Old page';aid='App.clientHeader.label';rid='1';on=$true;x=0;y=0}
$newNode=[pscustomobject]@{i=2;p=0;type='Text';name='Current page';aid='App.clientHeader.label';rid='2';on=$true;x=0;y=10}
$script:headingTree=[pscustomobject]@{nodes=@(
  [pscustomobject]@{i=0;p=-1;type='Pane';aid='App.clientHeader'}
  $oldNode;$newNode
)}
$script:headingElements=@{'1'=(New-HeadingElement $oldNode $true);'2'=(New-HeadingElement $newNode $false)}
function Get-LiveElement {param($Hwnd,$Rid) $script:headingElements[[string]$Rid]}
$script:headingWalks=0; $script:headingQueries=0
function Walk-Tree {param($Hwnd,$MaxNodes) $script:headingWalks++; $script:headingTree}
function Find-ExactAutomationElement {param($Hwnd,$Aid,[switch]$VisibleOnly)
  Assert-True $VisibleOnly 'The cached heading must require fresh visibility.'
  $script:headingQueries++; $null
}
$script:SSE_ENGINE_MAJOR=31; $script:SSE_HEADING_NODE_AID=@{}
Assert-True ((Get-CurrentHeading ([IntPtr]1) $script:headingTree) -ceq 'Current page') `
  'A hidden first tree label hid the current page.'
Assert-True ($script:headingWalks -eq 0 -and $script:headingQueries -eq 0) `
  'A supplied tree triggered another walk or used the old cached identity.'
Assert-True ((Get-CurrentHeading ([IntPtr]1) $null -CompactFallback) -ceq 'Current page') `
  'The fallback walk reused a hidden first label.'
Assert-True ($script:headingWalks -eq 1 -and $script:headingQueries -eq 1) `
  'An invalid cached heading did not use exactly one bounded fallback walk.'
$script:SSE_HEADING_NODE_AID=@{}; $knownTarget=$null
Assert-True ((AktuelleUeberschrift ([IntPtr]1)) -ceq 'Current page') `
  'The first goto heading read bypassed visibility.'
$script:headingElements['2'].Offscreen=$null
Assert-True ($null -eq (Get-CurrentHeading ([IntPtr]1) $script:headingTree)) `
  'An unknown or hidden tree label proved the current page.'
Write-Output 'Heading tree fallbacks: fresh visibility, cached rejection and no hidden-label guessing - passed'
