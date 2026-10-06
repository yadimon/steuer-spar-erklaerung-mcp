# Die Wartezeiten in `goto` sind bedingt und nach oben begrenzt - beides muss so
# bleiben.
#
# Zwei feste Fristen wurden durch Warten auf die Bedingung ersetzt, fuer die sie
# standen: nach dem Setzen des Suchfelds auf den gemeldeten Wert, nach jedem
# Blaetterklick auf den Wechsel der Ueberschrift. Gemessen spart das rund 250 ms
# je Navigation und 250-700 ms je Blaetterschritt.
#
# Zwei Eigenschaften duerfen dabei nie verlorengehen:
#
#   1. **Die Obergrenze.** Faellt sie weg, kann ein zaeher Fall beliebig lange
#      haengen; bleibt sie, ist der Schritt nie langsamer als mit der alten
#      festen Frist.
#   2. **Die volle Frist bei ausbleibendem Wechsel.** Die Blaetterschleife liest
#      die Ueberschrift danach genau EINMAL und deutet 'unveraendert' als
#      blockierenden Pruefhinweis. Wer hier frueher abbricht, erzeugt
#      Fehlalarme statt Tempo.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$workerSource = Get-Content -LiteralPath $workerPath -Raw
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$null, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

$definition = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'WarteAufSeitenwechsel'
}, $true))
if ($definition.Count -ne 1) { throw 'Funktion WarteAufSeitenwechsel ist nicht eindeutig vorhanden.' }
$quelltext = $definition[0].Extent.Text

# 1. Die alte Frist bleibt Obergrenze.
if ($quelltext -notmatch '\[int\]\$obergrenzeMs\s*=\s*900') {
  throw 'WarteAufSeitenwechsel fuehrt nicht mehr die alte Frist von 900 ms als Obergrenze.'
}
if ($quelltext -notmatch [regex]::Escape('$sw.ElapsedMilliseconds -lt $obergrenzeMs')) {
  throw 'Die Schleife ist nicht mehr durch die Obergrenze begrenzt.'
}

# 2. Ohne bekannte Vorgaenger-Ueberschrift bleibt es beim vollen Warten.
if ($quelltext -notmatch [regex]::Escape('if (-not $vorher) { Start-Sleep -Milliseconds $obergrenzeMs; return }')) {
  throw 'Ohne bekannte Vorgaenger-Ueberschrift muss die volle Frist gewartet werden.'
}

# 3. Frueh zurueck NUR bei echtem Wechsel.
if ($quelltext -notmatch [regex]::Escape('if ($jetzt -and $jetzt -ne $vorher) { return }')) {
  throw 'Der vorzeitige Ruecksprung haengt nicht mehr am Wechsel der Ueberschrift.'
}

# 4. Der Blaetterklick reicht die vorherige Ueberschrift durch - sonst waere die
#    Bedingung nie erfuellbar und der Poll liefe stets in die Obergrenze.
if ($workerSource -notmatch [regex]::Escape('$ok = DrueckeKnopf $hwnd $richtung $vorher')) {
  throw 'Die Blaetterschleife reicht die vorherige Ueberschrift nicht mehr an DrueckeKnopf durch.'
}

# 5. Kein Rueckfall auf die feste Frist an der Klickstelle.
$feste900 = ([regex]::Matches($workerSource, [regex]::Escape('Invoke(); Start-Sleep -Milliseconds 900'))).Count
if ($feste900 -ne 0) {
  throw "An $feste900 Stelle(n) wartet der Blaetterklick wieder pauschal 900 ms statt auf den Seitenwechsel."
}

# 6. Das Suchfeld wartet auf seinen eigenen Wert, begrenzt und zeichengenau.
if ($workerSource -notmatch [regex]::Escape('$wertUhr.ElapsedMilliseconds -lt 350')) {
  throw 'Das Warten auf den Suchfeldwert ist nicht mehr auf die alten 350 ms begrenzt.'
}
if ($workerSource -notmatch [regex]::Escape('if ($gelesen -ceq $ziel) { break }')) {
  throw 'Das Warten auf den Suchfeldwert vergleicht nicht mehr zeichengenau gegen das Ziel.'
}

# Ein Seitenaufbau darf zwischen zwei Lesungen fertig werden. Fuehre die
# echte Blaetterschleife mit vorgegebenen Beobachtungen aus; jeder zusaetzliche
# Invoke nach dem beobachteten Ziel ist ein Fehler, auch ohne echte UI.
. (Join-Path $root 'powershell\goto-route.ps1')
$navigationLoops = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.WhileStatementAst] -and
  $node.Condition.Extent.Text -ceq '$verbraucht -lt $route.budget' -and
  $node.Extent.Text.Contains('$stillstand')
}, $true))
if ($navigationLoops.Count -ne 1) { throw 'Blaetterschleife nicht eindeutig vorhanden.' }
$navigationLoop = [scriptblock]::Create($navigationLoops[0].Extent.Text)

function Assert-DelayedNavigationStops([string[]]$Headings, [int]$ExpectedClicks) {
  $script:gotoHeadings = New-Object 'System.Collections.Generic.Queue[string]'
  foreach ($heading in $Headings) { $script:gotoHeadings.Enqueue($heading) }
  $script:gotoClicks = 0
  $script:gotoResult = $null
  $ziel = 'Zielseite'; $pageId = ''; $hwnd = [IntPtr]7
  $FOLGE = @()
  $route = Get-SSEGotoRoute -Order $FOLGE -Start 'Startseite' -Target $ziel -MaxSteps 3
  $richtung = $route.direction; $position = $route.startIndex
  $verbraucht = 0; $stillstand = 0; $gesehenWege = @{}
  $weg = New-Object System.Collections.ArrayList
  $besucht = New-Object System.Collections.ArrayList
  function AktuelleUeberschrift { param($h) $script:gotoHeadings.Dequeue() }
  function IstZielseite { param($h, $heading) $heading -eq $ziel }
  function DrueckeKnopf {
    param($h, $name, $wechselVon)
    $script:gotoClicks++
    if ($script:gotoClicks -gt $ExpectedClicks) { throw 'Zusaetzlicher Invoke verliess die erreichte Zielseite.' }
    $true
  }
  function Emit { param($result) $script:gotoResult = $result; throw 'goto-test-emitted' }
  try { & $navigationLoop } catch {
    if ($_.Exception.Message -ne 'goto-test-emitted') { throw }
  }
  if (-not $script:gotoResult.ok -or $script:gotoResult.ueberschrift -ne $ziel -or
      $script:gotoClicks -ne $ExpectedClicks -or $script:gotoHeadings.Count -ne 0) {
    throw 'Verzoegertes Navigationsziel wurde nicht ohne weiteren Klick bestaetigt.'
  }
}
Assert-DelayedNavigationStops @('Zielseite') 0
Assert-DelayedNavigationStops @('Startseite','Zwischenseite','Zielseite') 1

# Der Engine-30-Blattknoten hat keine AutomationId. Der schnelle Einzelzugriff
# darf dort nicht in jeder Pollrunde auf einen groesseren Baumlauf zurueckfallen.
# Fuehre die echte Routingfunktion mit zwei Engines und einem bekannten Ziel aus.
$headingDefinitions = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'AktuelleUeberschrift'
}, $true))
if ($headingDefinitions.Count -ne 1) { throw 'AktuelleUeberschrift ist nicht eindeutig vorhanden.' }
Invoke-Expression $headingDefinitions[0].Extent.Text

$script:headingRoute = New-Object System.Collections.ArrayList
$script:SSE_HEADING_NODE_AID = @{}
function Get-KnownPageHeading { param($h, $target) $null = $script:headingRoute.Add('known'); 'known' }
function Get-CurrentHeading { param($h, $tree, [switch]$CompactFallback)
  if ($null -ne $tree) {
    $null = $script:headingRoute.Add('tree-visible')
    if ($script:SSE_ENGINE_MAJOR -eq 31 -and $h -ne [IntPtr]::Zero) { $script:SSE_HEADING_NODE_AID[[string][int64]$h] = 'heading-AID' }
    return 'walked'
  }
  $null = $script:headingRoute.Add($(if ($CompactFallback) { 'cache-compact' } else { 'cache-default' }))
  'cached'
}
function Walk-Tree { param($h, $budget) $null = $script:headingRoute.Add("walk:$budget"); [pscustomobject]@{ nodes=@() } }
function Get-SSEHeading { param($tree) [pscustomobject]@{ text='walked' } }
function Get-SSEMainWindowSelectors { [pscustomobject]@{ heading='.header' } }
function Get-SSEContainerChild { param($nodes, $suffix, $childType) [pscustomobject]@{ aid='heading-AID' } }

$knownTarget = $null
$script:SSE_ENGINE_MAJOR = 30
if ((AktuelleUeberschrift ([IntPtr]7)) -ne 'walked' -or
    (@($script:headingRoute) -join ',') -ne 'walk:400,tree-visible' -or $script:SSE_HEADING_NODE_AID.Count -ne 0) {
  throw 'Engine 30 muss den kleinen Heading-Baumlauf verwenden.'
}
$script:headingRoute.Clear()
$script:SSE_ENGINE_MAJOR = 31
if ((AktuelleUeberschrift ([IntPtr]7)) -ne 'walked' -or
    (@($script:headingRoute) -join ',') -ne 'walk:400,tree-visible' -or
    [string]$script:SSE_HEADING_NODE_AID['7'] -ne 'heading-AID') {
  throw 'Engine 31 muss die Ueberschrift beim kleinen Erstread binden.'
}
$script:headingRoute.Clear()
if ((AktuelleUeberschrift ([IntPtr]7)) -ne 'cached' -or
    (@($script:headingRoute) -join ',') -ne 'cache-compact') {
  throw 'Engine 31 muss danach die gebundene Ueberschrift verwenden.'
}
$script:headingRoute.Clear()
$script:SSE_ENGINE_MAJOR = 32
if ((AktuelleUeberschrift ([IntPtr]7)) -ne 'walked' -or
    (@($script:headingRoute) -join ',') -ne 'walk:400,tree-visible') {
  throw 'Unbekannte Engines muessen beim kleinen Heading-Baumlauf bleiben.'
}
$script:headingRoute.Clear()
$knownTarget = [pscustomobject]@{ pageId='known' }
if ((AktuelleUeberschrift ([IntPtr]7)) -ne 'known' -or
    (@($script:headingRoute) -join ',') -ne 'known') {
  throw 'Ein bekanntes Seitenobjekt muss seinen eigenen Heading-Bindungspfad behalten.'
}

# Wenn Qt die gebundene Ueberschrift neu baut, muss der echte Helper den
# veralteten Merker verwerfen und fuer goto nur den kleinen Baum lesen.
$helperDefinitions = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-CurrentHeading'
}, $true))
if ($helperDefinitions.Count -ne 1) { throw 'Get-CurrentHeading ist nicht eindeutig vorhanden.' }
Invoke-Expression $helperDefinitions[0].Extent.Text
function Get-SSEVisibleHeadingNode { param($h, $tree) [pscustomobject]@{ aid='heading-AID'; name='walked' } }
function Find-ExactAutomationElement { param($h, $aid) $null = $script:headingRoute.Add('miss'); $null }
$script:SSE_HEADING_NODE_AID['7'] = 'stale-AID'
$script:headingRoute.Clear()
if ((Get-CurrentHeading ([IntPtr]7) $null -CompactFallback) -ne 'walked' -or
    (@($script:headingRoute) -join ',') -ne 'miss,walk:400' -or
    [string]$script:SSE_HEADING_NODE_AID['7'] -ne 'heading-AID') {
  throw 'Ein verlorener Engine-31-Merker muss mit kleinem Baum neu gebunden werden.'
}

Write-Output 'goto-Wartezeiten: begrenzt; verzoegert erreichte Ziele werden vor weiterem Invoke bestaetigt - bestanden'

$headingWait = @($ast.FindAll({param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'WarteAufUeberschrift'
}, $true))[0]
Invoke-Expression $headingWait.Extent.Text
$knownTarget = [pscustomobject]@{page='target'}
$script:targetReads = 0
function AktuelleUeberschrift { param($window) 'Zielseite' }
function Test-KnownPageHeading { param($heading,$page) $heading -ceq 'Zielseite' }
function IstZielseite { param($window,$heading) $script:targetReads++; $script:targetReads -ge $script:readyAt }
function Fail { param($message,$kind,$details) throw $kind }
$script:readyAt = 3
$landed = WarteAufUeberschrift ([IntPtr]4242) 'Startseite' 'Zielseite' 1000
if ($landed -cne 'Zielseite' -or $script:targetReads -ne 3) { throw 'Eine fruehe Zielueberschrift ueberholte die vollstaendige Feldbindung.' }
$script:targetReads=0; $script:readyAt=[int]::MaxValue
$incompleteTargetFailed=$false
try { $null = WarteAufUeberschrift ([IntPtr]4242) 'Startseite' 'Zielseite' 250 }
catch { $incompleteTargetFailed=$_.Exception.Message -ceq 'navigation-blocked' }
if (-not $incompleteTargetFailed) { throw 'Eine Zielueberschrift ohne gebundene Felder erlaubte eine weitere Navigation.' }

# The generic heading route must enforce the same readiness boundary. A
# displayed target with an incomplete profiled table may not trigger another
# navigation action when the bounded wait expires.
$knownTarget = $null
$script:targetReads=0; $script:readyAt=[int]::MaxValue
$genericTargetFailed=$false
try { $null = WarteAufUeberschrift ([IntPtr]4242) 'Startseite' 'Zielseite' 250 }
catch { $genericTargetFailed=$_.Exception.Message -ceq 'navigation-blocked' }
if (-not $genericTargetFailed) { throw 'Eine generische Zielueberschrift ohne fertige Tabelle erlaubte weitere Navigation.' }

$bodyReadiness = @($ast.FindAll({param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Test-SSEGotoTableReadiness'
}, $true))
if ($bodyReadiness.Count -ne 1) { throw 'Tabellen-Fertigpruefung fehlt oder ist mehrdeutig.' }
Invoke-Expression $bodyReadiness[0].Extent.Text
$script:bodyWalks=0
$script:bodyPolicy=[pscustomobject]@{heading='Zielseite';controlType='DataItem';automationIdSuffix='.Target.Tab';requiredSumChecks=@([pscustomobject]@{label='Summe';occurrence=1})}
function Get-SSEPageObjects { [pscustomobject]@{focuslessCommits=[pscustomobject]@{synthetic=$script:bodyPolicy}} }
function Arg { param($object,$name,$default) $property=$object.PSObject.Properties[$name]; if ($property) { return $property.Value }; $default }
function Walk-BoundTree { param($window,$maxNodes,[switch]$WithValues) $script:bodyWalks++; if ($window -ne [IntPtr]4242 -or $maxNodes -ne 4000 -or -not $WithValues) { throw 'Ungebundener Inhaltsread ohne Werte.' }; $script:bodyTree }
function Get-CurrentHeading { param($window,$tree) $script:bodyHeading }
function Read-LabeledValueFromTree { param($tree,$window,$label,$occurrence)
  if ($label -cne 'Summe' -or $occurrence -ne 1) { throw 'Summenbindung driftete.' }; $script:bodySum
}
function Reset-BodyFixture {
  $script:bodyHeading='Zielseite'
  $script:bodyTree=[pscustomobject]@{stats=[pscustomobject]@{err=0;cyc=0;truncated=$false;depthLimited=$false};nodes=@([pscustomobject]@{type='Table';on=$true;w=400;h=200;aid='Root.Target.Tab'})}
  $script:bodySum=[pscustomobject]@{selected=[pscustomobject]@{label='Summe'};value='20,45'}
}
Reset-BodyFixture
if (-not (Test-SSEGotoTableReadiness ([IntPtr]4242) 'Andere Seite') -or $script:bodyWalks -ne 0) { throw 'Eine unprofilierte Seite bekam einen Tabellenread.' }
if (-not (Test-SSEGotoTableReadiness ([IntPtr]4242) 'Zielseite')) { throw 'Vollstaendige Tabelle mit lesbarer Summe wurde abgelehnt.' }
Reset-BodyFixture; $script:bodyTree.nodes=@()
if (Test-SSEGotoTableReadiness ([IntPtr]4242) 'Zielseite') { throw 'Fruehe Ueberschrift ohne Tabelle wurde bestaetigt.' }
Reset-BodyFixture; $script:bodyTree.nodes[0].aid='Root.Other.Tab'
if (Test-SSEGotoTableReadiness ([IntPtr]4242) 'Zielseite') { throw 'Fremde Tabelle wurde als Zielinhalt bestaetigt.' }
Reset-BodyFixture; $script:bodyTree.nodes[0].on=$false
if (Test-SSEGotoTableReadiness ([IntPtr]4242) 'Zielseite') { throw 'Unsichtbare Tabelle wurde bestaetigt.' }
Reset-BodyFixture; $script:bodyTree.nodes += $script:bodyTree.nodes[0]
if (Test-SSEGotoTableReadiness ([IntPtr]4242) 'Zielseite') { throw 'Mehrdeutige Tabellenbindung wurde bestaetigt.' }
Reset-BodyFixture; $script:bodySum.selected=$null
if (Test-SSEGotoTableReadiness ([IntPtr]4242) 'Zielseite') { throw 'Noch fehlende Summenzeile wurde bestaetigt.' }
Reset-BodyFixture; $script:bodySum.value=''
if (Test-SSEGotoTableReadiness ([IntPtr]4242) 'Zielseite') { throw 'Noch leerer Summenwert wurde bestaetigt.' }
Reset-BodyFixture; $script:bodySum.selected.label='Summe der Vorsteuer'
if (Test-SSEGotoTableReadiness ([IntPtr]4242) 'Zielseite') { throw 'Ein aehnliches Summenlabel ersetzte die exakte Bindung.' }
Reset-BodyFixture; $script:bodyHeading='Andere Seite'
if (Test-SSEGotoTableReadiness ([IntPtr]4242) 'Zielseite') { throw 'Ein waehrend des Inhaltsreads geaendertes Ziel wurde bestaetigt.' }
foreach ($incompleteFlag in @('err','cyc','truncated','depthLimited')) {
  Reset-BodyFixture; $script:bodyTree.stats.$incompleteFlag=1
  if (Test-SSEGotoTableReadiness ([IntPtr]4242) 'Zielseite') { throw "Unvollstaendiger Inhaltsread ($incompleteFlag) wurde bestaetigt." }
}
Write-Output 'goto: generische Tabellenziele bestaetigen Tabelle und exakte lesbare Summe vor Erfolg.'
