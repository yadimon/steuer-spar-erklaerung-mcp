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
$targetProofDefinitions = @($ast.FindAll({ param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-SSEGotoTargetProof'
}, $true))
if ($targetProofDefinitions.Count -ne 1) { throw 'Zielbeweis ist nicht eindeutig vorhanden.' }

function Assert-DelayedNavigationStops([string[]]$Headings, [int]$ExpectedClicks) {
  . ([scriptblock]::Create($targetProofDefinitions[0].Extent.Text))
  $script:gotoHeadings = New-Object 'System.Collections.Generic.Queue[string]'
  foreach ($heading in $Headings) { $script:gotoHeadings.Enqueue($heading) }
  $script:gotoClicks = 0
  $script:gotoResult = $null
  $ziel = 'Zielseite'; $pageId = ''; $hwnd = [IntPtr]7; $knownTarget = $null
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
function Get-SSEMainContentTree { param($window,$maxNodes,[switch]$WithValues) $script:bodyWalks++; if ($window -ne [IntPtr]4242 -or $maxNodes -ne 4000 -or -not $WithValues) { throw 'Ungebundener Inhaltsread ohne Werte.' }; $script:bodyTree }
function Get-CurrentHeading { param($window,$tree) $script:bodyHeading }
function Select-SSESummaryFromNodes { param($nodes,$bounds,$label,$occurrence)
  if ($label -cne 'Summe' -or $occurrence -ne 1 -or $bounds.minX -ne 37 -or $bounds.maxX -ne 2501) { throw 'Exakte Summenbindung oder gemessene Inhaltsgrenzen drifteten.' }; $script:bodySum
}
function Reset-BodyFixture {
  $script:bodyHeading='Zielseite'
  $script:bodyTree=[pscustomobject]@{contentBounds=[pscustomobject]@{minX=37;maxX=2501};stats=[pscustomobject]@{err=0;valErr=0;cyc=0;truncated=$false;depthLimited=$false};nodes=@([pscustomobject]@{type='Table';on=$true;w=400;h=200;aid='Root.Target.Tab'})}
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
foreach ($incompleteFlag in @('err','valErr','cyc','truncated','depthLimited')) {
  Reset-BodyFixture; $script:bodyTree.stats.$incompleteFlag=1
  if (Test-SSEGotoTableReadiness ([IntPtr]4242) 'Zielseite') { throw "Unvollstaendiger Inhaltsread ($incompleteFlag) wurde bestaetigt." }
}
Reset-BodyFixture; $script:bodyTree=$null
if (Test-SSEGotoTableReadiness ([IntPtr]4242) 'Zielseite') { throw 'Fehlende Inhaltsbindung wurde bestaetigt.' }

# Exercise the actual summary selector with pane widths that a whole-window
# percentage would omit, and preserve duplicate aliases/exact occurrences.
. (Join-Path $root 'powershell\table-region.ps1')
Reset-BodyFixture
$script:bodyTree.nodes += @(
  [pscustomobject]@{type='Text';name='Summe';x=40;y=300},
  [pscustomobject]@{type='Edit';name='';val='17,25';x=100;y=300},
  [pscustomobject]@{type='Edit';name='';val='17,25';x=110;y=300},
  [pscustomobject]@{type='Text';name='Summe der Vorsteuer';x=40;y=350},
  [pscustomobject]@{type='Edit';name='';val='0,00';x=100;y=350},
  [pscustomobject]@{type='Text';name='Summe';x=2400;y=450},
  [pscustomobject]@{type='Edit';name='';val='31,40';x=2480;y=450}
)
if (-not (Test-SSEGotoTableReadiness ([IntPtr]4242) 'Zielseite')) { throw 'Gebundene schmale Inhaltsregion verlor ihre lesbare Summe.' }
$script:bodyPolicy.requiredSumChecks[0].occurrence=2
if (-not (Test-SSEGotoTableReadiness ([IntPtr]4242) 'Zielseite')) { throw 'Summenalias oder aehnliches Label verschob das zweite exakte Vorkommen.' }
$script:bodyPolicy.requiredSumChecks[0].occurrence=3
if (Test-SSEGotoTableReadiness ([IntPtr]4242) 'Zielseite') { throw 'Nicht vorhandenes Summenvorkommen wurde bestaetigt.' }
$script:bodyPolicy.requiredSumChecks[0].occurrence=1
Write-Output 'goto: generische Tabellenziele bestaetigen Tabelle und exakte lesbare Summe vor Erfolg.'

# Execute the actual scope helpers against an owned provider model. Adjacent
# navigation has cyclic descendants; reading even its first child is forbidden.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
Add-Type -ReferencedAssemblies @('System.dll',
  [System.Windows.Automation.AutomationElement].Assembly.Location,
  [System.Windows.Automation.ControlType].Assembly.Location,
  [System.Windows.Rect].Assembly.Location) -TypeDefinition @'
using System;
using System.Collections;
using System.Windows;
using System.Windows.Automation;
public sealed class GotoScopeCurrent {
  public string Name = "content";
  public string AutomationId;
  public ControlType ControlType;
  public Rect BoundingRectangle;
  public bool IsEnabled;
  public bool IsOffscreen;
}
public sealed class GotoScopeElement {
  public string Aid;
  public int[] Rid;
  public int ProcessId = 7331;
  public int WindowHandle;
  public ControlType Kind = ControlType.Group;
  public Rect Rectangle = new Rect(37, 80, 2464, 600);
  public bool Enabled = true;
  public bool Offscreen;
  public bool Navigation;
  public object VisibilityOverride;
  public bool ThrowIdentity;
  public int ChangeRidAt;
  public int RidReads;
  public int CurrentReads;
  public GotoScopeElement Parent;
  public GotoScopeElement FirstChild;
  public GotoScopeElement NextSibling;
  public GotoScopeCurrent Current {
    get {
      CurrentReads++;
      return new GotoScopeCurrent { AutomationId=Aid, ControlType=Kind,
        BoundingRectangle=Rectangle, IsEnabled=Enabled, IsOffscreen=Offscreen };
    }
  }
  public int[] GetRuntimeId() {
    RidReads++;
    if (ThrowIdentity) throw new InvalidOperationException("identity unavailable");
    if (ChangeRidAt != 0 && RidReads == ChangeRidAt) Rid = new int[] { 999 };
    return (int[])Rid.Clone();
  }
  public object GetCurrentPropertyValue(AutomationProperty property) {
    if (property == AutomationElement.AutomationIdProperty) return Aid;
    if (property == AutomationElement.ProcessIdProperty) return ProcessId;
    if (property == AutomationElement.NativeWindowHandleProperty) return WindowHandle;
    if (property == AutomationElement.ControlTypeProperty) return Kind;
    if (property == AutomationElement.IsOffscreenProperty)
      return VisibilityOverride ?? (object)Offscreen;
    throw new InvalidOperationException("Unexpected property");
  }
  public bool TryGetCurrentPattern(AutomationPattern pattern, out object result) {
    result = null; return false;
  }
}
public static class GotoScopeAE {
  public static GotoScopeElement Root;
  public static int FromHandleCalls;
  public static AutomationProperty AutomationIdProperty = AutomationElement.AutomationIdProperty;
  public static AutomationProperty ProcessIdProperty = AutomationElement.ProcessIdProperty;
  public static AutomationProperty NativeWindowHandleProperty = AutomationElement.NativeWindowHandleProperty;
  public static AutomationProperty ControlTypeProperty = AutomationElement.ControlTypeProperty;
  public static AutomationProperty IsOffscreenProperty = AutomationElement.IsOffscreenProperty;
  public static GotoScopeElement FromHandle(IntPtr hwnd) {
    FromHandleCalls++;
    if (hwnd.ToInt64() != 4242) throw new InvalidOperationException("Foreign HWND");
    return Root;
  }
}
public sealed class GotoScopeWalker {
  public int ForbiddenDescents;
  public GotoScopeElement GetParent(GotoScopeElement element) { return element.Parent; }
  public GotoScopeElement GetFirstChild(GotoScopeElement element) {
    if (element.Navigation) {
      ForbiddenDescents++; throw new InvalidOperationException("Adjacent navigation was entered");
    }
    return element.FirstChild;
  }
  public GotoScopeElement GetNextSibling(GotoScopeElement element) { return element.NextSibling; }
}
public static class SW {
  public static int GetWindowThreadProcessId(IntPtr hwnd, ref int processId) {
    processId = hwnd.ToInt64() == 4242 ? 7331 : 0; return processId == 0 ? 0 : 1;
  }
}
public sealed class GotoScopeNativeSnapshot {
  public object[] Nodes;
  public int NodeCount = 2;
  public int WalkErrors, CycleHits, ValueErrors, ScrollErrors;
  public string CycleRuntimeId = "";
  public bool Truncated, DepthLimited;
}
public static class SSEUiaTree {
  public static GotoScopeNativeSnapshot Snapshot;
  public static object LastRoot;
  public static int Calls, WholeWindowCalls, MaxNodes, TimeoutMs, MaxDepth;
  public static bool WithValues, WithScroll, Fail;
  public static Action AfterRead;
  public static GotoScopeNativeSnapshot DescribeElement(object root, int nodes, int timeout,
      int depth, bool values, bool scroll) {
    Calls++; LastRoot=root; MaxNodes=nodes; TimeoutMs=timeout; MaxDepth=depth;
    WithValues=values; WithScroll=scroll;
    if (Fail) throw new InvalidOperationException("scope-snapshot-failed");
    if (AfterRead != null) AfterRead();
    return Snapshot;
  }
  public static GotoScopeNativeSnapshot Describe(IntPtr hwnd, int nodes, int timeout,
      int depth, bool values, bool scroll) {
    WholeWindowCalls++; throw new InvalidOperationException("Global snapshot forbidden");
  }
  public static object[] ToViews(object[] nodes, IDictionary cache) { return nodes; }
}
'@
foreach ($functionName in @('Test-SSEElementIdentity','Test-SSEElementVisible','Convert-ExactElementToNode',
    'ConvertTo-SSESnapshotNodes','Get-UiSnapshot','Test-SSEMainContentAncestry','Get-SSEMainContentTree')) {
  $definitions=@($ast.FindAll({param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $functionName
  },$true))
  if ($definitions.Count -ne 1) { throw "Scope helper is ambiguous: $functionName" }
  Invoke-Expression $definitions[0].Extent.Text
}
. (Join-Path $root 'powershell\window-scope.ps1')
$script:AE=[GotoScopeAE]
function Get-SSEPageObjects {
  [pscustomobject]@{windows=[pscustomobject]@{main=[pscustomobject]@{contentAutomationId=$script:scopeRelativeAid}}}
}
function Find-ExactAutomationElement { param($window,$aid,[switch]$VisibleOnly)
  $script:scopeFinds++
  if ($window -ne [IntPtr]4242 -or $aid -cne '.ClientFrameSSE' -or -not $VisibleOnly) { throw 'Content selector changed.' }
  $script:scopeCandidate
}
function Walk-TreeLegacy { $script:scopeLegacyCalls++; throw 'Global fallback forbidden.' }
function Reset-ScopeFixture {
  $script:scopeRelativeAid='.ClientFrameSSE'
  $script:scopeFinds=0; $script:scopeLegacyCalls=0
  $script:UIAElementCache=@{}
  $script:SSE_TREE_WALK_DETAIL=New-Object System.Collections.ArrayList
  $script:scopeWindow=New-Object GotoScopeElement
  $script:scopeWindow.Aid='OwnedRoot'; $script:scopeWindow.Rid=@(101)
  $script:scopeWindow.Kind=[Windows.Automation.ControlType]::Window
  $script:scopeWindow.WindowHandle=4242
  $script:scopePane=New-Object GotoScopeElement
  $script:scopePane.Aid='OwnedRoot.ClientFrameSSE'; $script:scopePane.Rid=@(102)
  $script:scopePane.Parent=$script:scopeWindow
  $script:scopeNav=New-Object GotoScopeElement
  $script:scopeNav.Aid='OwnedRoot.NavFrameSSE'; $script:scopeNav.Rid=@(103)
  $script:scopeNav.Parent=$script:scopeWindow; $script:scopeNav.Navigation=$true
  $script:scopeNav.FirstChild=$script:scopeNav
  $script:scopeWindow.FirstChild=$script:scopeNav; $script:scopeNav.NextSibling=$script:scopePane
  $script:scopeCandidate=$script:scopePane
  $script:WLK=New-Object GotoScopeWalker
  [GotoScopeAE]::Root=$script:scopeWindow; [GotoScopeAE]::FromHandleCalls=0
  [SSEUiaTree]::Calls=0; [SSEUiaTree]::WholeWindowCalls=0
  [SSEUiaTree]::Fail=$false; [SSEUiaTree]::AfterRead=$null
  $snapshot=New-Object GotoScopeNativeSnapshot
  $snapshot.Nodes=@(
    [pscustomobject]@{i=0;p=-1;rid='104';type='Table';aid='OwnedRoot.ClientFrameSSE.Target.Tab'},
    [pscustomobject]@{i=1;p=-1;rid='105';type='Edit';aid='OwnedRoot.ClientFrameSSE.Summe'})
  [SSEUiaTree]::Snapshot=$snapshot
}
Reset-ScopeFixture
$scoped=Get-SSEMainContentTree ([IntPtr]4242) 123 7 9 -WithValues -WithScroll
if (-not $scoped -or $scoped.nodes.Count -ne 2 -or $scoped.stats.source -cne 'cache' -or
    $scoped.contentBounds.minX -ne 37 -or $scoped.contentBounds.maxX -ne 2501 -or
    [SSEUiaTree]::Calls -ne 1 -or [SSEUiaTree]::WholeWindowCalls -ne 0 -or $script:scopeLegacyCalls -ne 0 -or
    -not [object]::ReferenceEquals([SSEUiaTree]::LastRoot,$script:scopePane) -or
    [SSEUiaTree]::MaxNodes -ne 123 -or [SSEUiaTree]::TimeoutMs -ne 7000 -or [SSEUiaTree]::MaxDepth -ne 9 -or
    -not [SSEUiaTree]::WithValues -or -not [SSEUiaTree]::WithScroll -or
    [GotoScopeAE]::FromHandleCalls -ne 2 -or $script:scopePane.CurrentReads -ne 2 -or
    $script:WLK.ForbiddenDescents -ne 0) { throw 'Exact scoped snapshot, fresh bounds or before/after proof failed.' }

function Assert-ScopeRejected([string]$Scenario,[scriptblock]$Arrange,[int]$ExpectedSnapshots=0) {
  Reset-ScopeFixture
  & $Arrange
  $result=Get-SSEMainContentTree ([IntPtr]4242) 123 7 9 -WithValues -WithScroll
  if ($null -ne $result -or [SSEUiaTree]::Calls -ne $ExpectedSnapshots -or
      [SSEUiaTree]::WholeWindowCalls -ne 0 -or $script:scopeLegacyCalls -ne 0 -or
      $script:WLK.ForbiddenDescents -ne 0) { throw "Unsafe content scope accepted: $Scenario" }
}
Assert-ScopeRejected 'missing catalog path' {$script:scopeRelativeAid=''}
Assert-ScopeRejected 'missing pane' {$script:scopeCandidate=$null}
Assert-ScopeRejected 'wrong pane aid' {$script:scopePane.Aid='OwnedRoot.Other'}
Assert-ScopeRejected 'stale pane identity' {$script:scopePane.ChangeRidAt=2}
Assert-ScopeRejected 'unreadable pane identity' {$script:scopePane.ThrowIdentity=$true}
Assert-ScopeRejected 'offscreen pane' {$script:scopePane.Offscreen=$true}
Assert-ScopeRejected 'unknown visibility' {$script:scopePane.VisibilityOverride='false'}
Assert-ScopeRejected 'disabled pane' {$script:scopePane.Enabled=$false}
Assert-ScopeRejected 'empty rectangle' {$script:scopePane.Rectangle=New-Object Windows.Rect(37,80,0,600)}
Assert-ScopeRejected 'foreign pane pid' {$script:scopePane.ProcessId=7332}
Assert-ScopeRejected 'foreign root hwnd' {$script:scopeWindow.WindowHandle=4243}
Assert-ScopeRejected 'foreign root pid' {$script:scopeWindow.ProcessId=7332}
Assert-ScopeRejected 'foreign window ancestor' {
  $foreign=New-Object GotoScopeElement; $foreign.Aid='OwnedRoot.Foreign'; $foreign.Rid=@(106)
  $foreign.Kind=[Windows.Automation.ControlType]::Window; $foreign.Parent=$script:scopeWindow
  $foreign.FirstChild=$script:scopePane; $script:scopePane.Parent=$foreign
}
Assert-ScopeRejected 'duplicate sibling aid' {
  $duplicate=New-Object GotoScopeElement; $duplicate.Aid=$script:scopePane.Aid; $duplicate.Rid=@(106)
  $duplicate.Parent=$script:scopeWindow; $script:scopePane.NextSibling=$duplicate
}
Assert-ScopeRejected 'sibling runtime cycle' {$script:scopePane.NextSibling=$script:scopeNav}
Assert-ScopeRejected 'ancestor runtime cycle' {$script:scopePane.Parent=$script:scopePane; $script:scopePane.FirstChild=$script:scopePane}
Assert-ScopeRejected 'ancestry depth bound' {
  $child=$script:scopePane
  for ($level=0; $level -lt 16; $level++) {
    $parent=New-Object GotoScopeElement; $parent.Aid="OwnedRoot.Ancestor$level"; $parent.Rid=@(200+$level)
    $parent.FirstChild=$child; $child.Parent=$parent; $child=$parent
  }
  $child.Parent=$script:scopeWindow; $script:scopeWindow.FirstChild=$child
}
Assert-ScopeRejected 'replaced pane rid after snapshot' {[SSEUiaTree]::AfterRead=[Action]{$script:scopePane.Rid=@(999)}} 1
Assert-ScopeRejected 'changed pane aid after snapshot' {[SSEUiaTree]::AfterRead=[Action]{$script:scopePane.Aid='OwnedRoot.Other'}} 1
Assert-ScopeRejected 'changed geometry after snapshot' {[SSEUiaTree]::AfterRead=[Action]{$script:scopePane.Rectangle=New-Object Windows.Rect(38,80,2464,600)}} 1
Assert-ScopeRejected 'changed owning hwnd after snapshot' {[SSEUiaTree]::AfterRead=[Action]{$script:scopeWindow.WindowHandle=4243}} 1
Assert-ScopeRejected 'changed owning pid after snapshot' {[SSEUiaTree]::AfterRead=[Action]{$script:scopePane.ProcessId=7332}} 1
Assert-ScopeRejected 'scoped snapshot failure' {[SSEUiaTree]::Fail=$true} 1
Reset-ScopeFixture; [SSEUiaTree]::Fail=$true
$scopeError=$false
try { $null=Get-UiSnapshot ([IntPtr]4242) 123 7 9 -WithValues -RootElement $script:scopePane }
catch { $scopeError=$_.Exception.Message.Contains('scope-snapshot-failed') }
if (-not $scopeError -or [SSEUiaTree]::WholeWindowCalls -ne 0 -or $script:scopeLegacyCalls -ne 0) {
  throw 'Scoped native failure was replaced by a global fallback.'
}
Write-Output 'goto: exact content scope proves owned identity before/after; adjacent cycles stay outside, scoped failures stay closed.'

# Ueberschrift, Felder und Tabelle werden nicht zwingend gleichzeitig fertig.
# Fuehre die echten Zielhelfer sowie den initialen Erfolgsblock und die echte
# Blaetterschleife aus. Nur Provider, InvokePattern und Uhr sind inert; weder
# UIAutomation noch Win32 erhalten einen Fenster- oder Eingabeaufruf.
$targetFunctions = @{}
foreach ($name in @('Test-KnownPageHeading','Test-KnownPageFields','IstZielseite','Get-SSEGotoTargetProof',
    'WarteAufZielseite','WarteAufSeitenwechsel','DrueckeKnopf')) {
  $definitions = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }.GetNewClosure(), $true))
  if ($definitions.Count -ne 1) { throw "Zielhelfer ist nicht eindeutig: $name" }
  $targetFunctions[$name] = $definitions[0].Extent.Text
}
function Get-InitialTargetBranch($Tree) {
  $initialRead = @($Tree.FindAll({ param($node)
    $node -is [Management.Automation.Language.AssignmentStatementAst] -and
    $node.Extent.Text -ceq '$start = AktuelleUeberschrift $hwnd'
  }, $true))
  $initialProof = @($Tree.FindAll({ param($node)
    $node -is [Management.Automation.Language.AssignmentStatementAst] -and
    $node.Extent.Text -ceq '$zielBeweis = Get-SSEGotoTargetProof $hwnd $start'
  }, $true))
  $initialSuccess = @($Tree.FindAll({ param($node)
    $node -is [Management.Automation.Language.IfStatementAst] -and
    $node.Clauses[0].Item1.Extent.Text -ceq '$zielBeweis.bereit -eq $true' -and
    $node.Extent.Text.Contains("weg=@('schon dort')")
  }, $true))
  if ($initialRead.Count -ne 1 -or $initialProof.Count -ne 1 -or $initialSuccess.Count -ne 1) {
    throw 'Initiale Zielpruefung ist nicht eindeutig vorhanden.'
  }
  $parent = $initialRead[0].Parent
  if ($parent -isnot [Management.Automation.Language.StatementBlockAst] -or
      -not [object]::ReferenceEquals($parent,$initialProof[0].Parent) -or
      -not [object]::ReferenceEquals($parent,$initialSuccess[0].Parent)) {
    throw 'Initialer Read, Beweis und Erfolg muessen im selben Block stehen.'
  }
  $statements = @($parent.Statements)
  $readIndex = [array]::IndexOf($statements,$initialRead[0])
  $proofIndex = [array]::IndexOf($statements,$initialProof[0])
  $successIndex = [array]::IndexOf($statements,$initialSuccess[0])
  $search = @($statements | Where-Object {
    $_ -is [Management.Automation.Language.IfStatementAst] -and
    $_.Clauses[0].Item1.Extent.Text -ceq "(Arg `$a 'viaSuche') -ne `$false"
  })
  if ($readIndex -lt 0 -or $proofIndex -ne $readIndex+1 -or $successIndex -ne $proofIndex+1 -or
      $search.Count -ne 1 -or [array]::IndexOf($statements,$search[0]) -le $successIndex) {
    throw 'Initialer Read, Beweis und Erfolg muessen direkt aufeinander und vor der Suche stehen.'
  }
  [scriptblock]::Create((@($initialRead[0].Extent.Text,
    $initialProof[0].Extent.Text, $initialSuccess[0].Extent.Text) -join "`n"))
}
$initialTargetBranch = Get-InitialTargetBranch $ast

# Counterexamples mutate actual source, not a separately reconstructed block.
# Additional work, reordered reads or a nested proof must not disappear when
# the test extracts the initial branch.
$readSite = '$start = AktuelleUeberschrift $hwnd'
$proofSite = '$zielBeweis = Get-SSEGotoTargetProof $hwnd $start'
foreach ($mutatedSource in @(
  $workerSource.Replace($proofSite,('$null = Walk-Tree $hwnd 1' + "`n" + $proofSite)),
  $workerSource.Replace($readSite,'__INITIAL_READ__').Replace($proofSite,$readSite).Replace('__INITIAL_READ__',$proofSite),
  $workerSource.Replace($proofSite,('if ($true) { ' + $proofSite + ' }'))
)) {
  $mutationErrors=$null
  $mutatedAst=[Management.Automation.Language.Parser]::ParseInput($mutatedSource,[ref]$null,[ref]$mutationErrors)
  if ($mutationErrors.Count) { throw 'Der initiale Gegenfall muss gueltigen PowerShell-Code behalten.' }
  $rejected=$false
  try { $null=Get-InitialTargetBranch $mutatedAst } catch { $rejected=$true }
  if (-not $rejected) { throw 'Die Extraktion versteckte eingeschobene, vertauschte oder verschobene initiale Arbeit.' }
}

function Test-TargetProofBoundary([bool]$Known, [string]$Boundary, [int]$MissingReads=0,
    [string]$Behavior='ready', [int]$MaximumReads=0, [string]$Binding='field',
    [string]$TargetHeading='Zielseite', $HeadingDefinition=$null) {
  $script:targetFixture = [pscustomobject]@{
    heading=$(if ($Boundary -ceq 'paging') {'Startseite'} elseif ($Boundary -ceq 'foreign') {'Andere Seite'} else {$TargetHeading})
    reads=0; fields=0; tables=0; invokes=0; waits=0; sleeps=0; requestedBudget=0
    clock=[pscustomobject]@{ElapsedMilliseconds=[long]0}; emitted=$null; failure=$null; proof=$null
    caught=$null; readError=[InvalidOperationException]::new('synthetic-provider-read-failure')
    fieldIds=(New-Object Collections.ArrayList)
  }
  foreach ($name in @('Test-KnownPageHeading','Test-KnownPageFields','IstZielseite','Get-SSEGotoTargetProof',
      'WarteAufSeitenwechsel','DrueckeKnopf')) {
    . ([scriptblock]::Create($targetFunctions[$name]))
  }
  # Replace only the clock acquisition, preserving the real wait's branches,
  # polling interval, two consecutive confirmations and exact 1800 ms budget.
  # This deterministic clock seam is not a wall-clock performance assertion.
  $clockSite = '$sw = [Diagnostics.Stopwatch]::StartNew()'
  $waitSource = $targetFunctions['WarteAufZielseite']
  if ([regex]::Matches($waitSource,[regex]::Escape($clockSite)).Count -ne 1) { throw 'Die Zielpruefung muss genau eine Uhr besitzen.' }
  $waitSource = $waitSource.Replace($clockSite,'$sw = $script:targetFixture.clock').Replace(
    'function WarteAufZielseite','function Invoke-ProductiveTargetProofWait')
  . ([scriptblock]::Create($waitSource))
  function WarteAufZielseite([IntPtr]$h, [int]$timeoutMs) {
    $script:targetFixture.waits++; $script:targetFixture.requestedBudget=$timeoutMs
    $script:targetFixture.clock.ElapsedMilliseconds=0
    Invoke-ProductiveTargetProofWait $h $timeoutMs
  }
  function Assert-InertTarget([IntPtr]$Window) {
    if ($Window -ne [IntPtr]7) { throw 'Read ausserhalb des inerten Zielfensters.' }
  }
  function AktuelleUeberschrift([IntPtr]$Window) {
    Assert-InertTarget $Window
    $script:targetFixture.heading
  }
  function Get-InertTargetReadiness {
    $script:targetFixture.reads++
    if ($MaximumReads -gt 0 -and $script:targetFixture.reads -gt $MaximumReads) {
      throw 'Zusaetzlicher unbudgetierter Read nach dem Zielbeweis.'
    }
    if ($Behavior -ceq 'read-error' -and $script:targetFixture.reads -eq 2) {
      throw $script:targetFixture.readError
    }
    if ($Behavior -ceq 'drift' -and $script:targetFixture.reads -eq 2) {
      $script:targetFixture.heading='Andere Seite'
    }
    $Behavior -notin @('missing','drift') -and $script:targetFixture.reads -gt $MissingReads
  }
  function Resolve-KnownFieldNode([IntPtr]$Window, $KnownField) {
    Assert-InertTarget $Window
    $fieldId=[string]$KnownField.field.automationIdRelative
    if ($fieldId -cne 'synthetic.required' -and
        -not ($Binding -in @('second-field','table') -and $fieldId -ceq 'synthetic.first')) { throw 'Fremde Feldbindung.' }
    $script:targetFixture.fields++
    $null=$script:targetFixture.fieldIds.Add($fieldId)
    if ($Binding -ceq 'table' -or $fieldId -ceq 'synthetic.first' -or (Get-InertTargetReadiness)) {
      [pscustomobject]@{rid=$fieldId;type='Edit'}
    }
  }
  function Test-SSEGotoTableReadiness([IntPtr]$Window, [string]$Heading) {
    Assert-InertTarget $Window
    if ($Heading -cne $TargetHeading) { throw 'Fremde Ueberschrift erhielt eine Tabellenpruefung.' }
    $script:targetFixture.tables++
    if ($Known -and $Binding -cne 'table') { return $true }
    Get-InertTargetReadiness
  }
  function Start-Sleep([int]$Milliseconds) {
    $script:targetFixture.sleeps++
    $script:targetFixture.clock.ElapsedMilliseconds += $Milliseconds
  }
  function AktiverBlaetterknopf([IntPtr]$Window, [string]$Name) {
    Assert-InertTarget $Window
    if ($Name -cne 'Weiter') { throw 'Nicht erwarteter Blaetterknopf.' }
    $pattern=[pscustomobject]@{}
    $pattern | Add-Member ScriptMethod Invoke {
      $script:targetFixture.invokes++
      if ($script:targetFixture.invokes -gt 1) { throw 'Die erreichte Zielseite wurde erneut verlassen.' }
      $script:targetFixture.heading=$(if ($Behavior -ceq 'wrong-heading') {'Nachbarseite'} else {$TargetHeading})
    }
    $button=[pscustomobject]@{pattern=$pattern}
    $button | Add-Member ScriptMethod GetCurrentPattern { param($Identifier)
      if ($Identifier.ProgrammaticName -cne 'InvokePatternIdentifiers.Pattern') { throw 'Nicht erwartetes InvokePattern.' }
      $this.pattern
    }
    $button
  }
  function Get-Windows { throw 'Globale Fensterabfrage im inerten Zielmodell.' }
  function Emit($Result) { $script:targetFixture.emitted=$Result; throw 'target-proof-emitted' }
  function Fail($Message,$Kind,$Details) {
    $script:targetFixture.failure=[pscustomobject]@{kind=$Kind;message=$Message;details=$Details}
    throw 'target-proof-refused'
  }
  $fields=[ordered]@{}
  if ($Binding -in @('second-field','table')) { $fields['first']=[pscustomobject]@{automationIdRelative='synthetic.first'} }
  $fields['required']=[pscustomobject]@{automationIdRelative='synthetic.required'}
  $page=[ordered]@{heading=$TargetHeading;fields=[pscustomobject]$fields}
  if ($HeadingDefinition) {
    # Project only real heading rules; required bindings remain synthetic.
    foreach ($name in @('heading','headingPrefix','headingNumberedLabel')) {
      $property=$HeadingDefinition.PSObject.Properties[$name]
      if ($property) { $page[$name]=$property.Value }
    }
  }
  $knownTarget=$(if ($Known) {
    [pscustomobject]@{pageId='synthetic.target';page=[pscustomobject]$page}
  } else {$null})
  $ziel=$(if ($HeadingDefinition -and $page['headingNumberedLabel']) {$page['headingNumberedLabel']}
    elseif ($HeadingDefinition -and $page['headingPrefix']) {$page['headingPrefix']} else {$TargetHeading})
  $pageId=$(if ($Known) {'synthetic.target'} else {''}); $hwnd=[IntPtr]7; $gotoPid=3131
  $FOLGE=@('Startseite',$ziel,'Nachbarseite')
  $route=Get-SSEGotoRoute -Order $FOLGE -Start 'Startseite' -Target $ziel -MaxSteps 3
  $richtung=$route.direction; $position=$route.startIndex; $verbraucht=0; $stillstand=0
  $gesehenWege=@{}; $eintragsKontext=''
  $weg=New-Object Collections.ArrayList; $besucht=New-Object Collections.ArrayList
  try {
    if ($Boundary -ceq 'initial') { & $initialTargetBranch }
    elseif ($Boundary -ceq 'foreign') { $script:targetFixture.proof=Get-SSEGotoTargetProof $hwnd $script:targetFixture.heading }
    else { & $navigationLoop }
  } catch {
    if ($_.Exception.Message -notin @('target-proof-emitted','target-proof-refused')) {
      if (-not [object]::ReferenceEquals($_.Exception,$script:targetFixture.readError)) { throw }
      $script:targetFixture.caught=$_.Exception
    }
  }
  $script:targetFixture
}

foreach ($known in @($true,$false)) {
  foreach ($boundary in @('initial','preloop','paging')) {
    $expectedInvokes=$(if ($boundary -ceq 'paging') {1} else {0})
    $ready=Test-TargetProofBoundary $known $boundary 0 'ready' 1
    if ($ready.emitted.erreicht -ne $true -or $ready.reads -ne 1 -or $ready.waits -ne 0 -or
        $ready.invokes -ne $expectedInvokes -or ($expectedInvokes -eq 0 -and $ready.sleeps -ne 0)) {
      throw "Sofort fertiges Ziel bekam eine Wartezeit oder erneute Navigation: $known/$boundary"
    }
    $delayed=Test-TargetProofBoundary $known $boundary 2 'ready' 4
    if ($delayed.emitted.erreicht -ne $true -or $delayed.emitted.ueberschrift -cne 'Zielseite' -or
        $delayed.invokes -ne $expectedInvokes -or $delayed.reads -ne 4 -or $delayed.waits -ne 1 -or
        $delayed.requestedBudget -ne 1800) {
      throw "Verzoegerte Feld-/Tabellenbindung verliess das Ziel oder verlor ihren Beweis: $known/$boundary"
    }
    foreach ($behavior in @('missing','drift')) {
      $blocked=Test-TargetProofBoundary $known $boundary 2 $behavior
      if ($null -ne $blocked.emitted -or $blocked.failure.kind -cne 'navigation-blocked' -or
          $blocked.failure.details.weg.Count -lt 2 -or $blocked.invokes -ne $expectedInvokes -or
          $blocked.waits -ne 1 -or $blocked.requestedBudget -ne 1800 -or $blocked.clock.ElapsedMilliseconds -ne 1800) {
        throw "Unfertiges oder verlorenes Ziel erlaubte Navigation: $known/$boundary/$behavior"
      }
      if ($behavior -ceq 'drift') {
        if ($blocked.failure.details.ueberschrift -cne 'Andere Seite' -or
            $blocked.failure.message -notmatch 'hat sich.*geaendert' -or
            $blocked.failure.message -match 'Zielueberschrift ist sichtbar') {
          throw 'Ein verlorenes Ziel wurde als weiterhin sichtbare Zielueberschrift beschrieben.'
        }
      } elseif ($blocked.failure.message -notmatch 'Felder oder Tabellen.*nicht vollstaendig gebunden') {
        throw 'Eine unvollstaendige Bindung verlor ihre konkrete Diagnose.'
      }
    }
    $readError=Test-TargetProofBoundary $known $boundary 2 'read-error'
    if (-not [object]::ReferenceEquals($readError.caught,$readError.readError) -or
        $null -ne $readError.emitted -or $readError.invokes -ne $expectedInvokes -or
        $readError.waits -ne 1 -or $readError.requestedBudget -ne 1800) {
      throw "Urspruenglicher Providerfehler wurde ersetzt oder loeste weitere Navigation aus: $known/$boundary"
    }
  }
  $foreign=Test-TargetProofBoundary $known 'foreign'
  if ($foreign.proof.bereit -ne $false -or $foreign.reads -ne 0 -or $foreign.tables -ne 0 -or
      $foreign.fields -ne 0 -or $foreign.waits -ne 0 -or $foreign.sleeps -ne 0) {
    throw 'Eine fremde Ueberschrift startete eine teure Zielpruefung.'
  }
  $wrong=Test-TargetProofBoundary $known 'paging' 0 'wrong-heading'
  if ($null -ne $wrong.emitted -or $wrong.failure.kind -cne 'not-found' -or
      $wrong.invokes -ne 1 -or $wrong.waits -ne 0 -or $wrong.reads -ne 0) {
    throw 'Die Zielbereitschaft umging die bestehende Richtung-/Landungspruefung.'
  }
}

# A known page must resolve every field before its table. In particular, the
# first field being ready cannot stand in for a second field or for the body.
foreach ($binding in @('second-field','table')) {
  foreach ($boundary in @('initial','preloop','paging')) {
    $expectedInvokes=$(if ($boundary -ceq 'paging') {1} else {0})
    foreach ($behavior in @('ready','missing')) {
      $bound=Test-TargetProofBoundary $true $boundary 2 $behavior 0 $binding
      if ($bound.invokes -ne $expectedInvokes -or $bound.waits -ne 1 -or $bound.requestedBudget -ne 1800 -or
          $bound.fields -ne 2*$bound.reads -or $bound.fieldIds.Count -ne $bound.fields) {
        throw "Eine bekannte Zielpruefung uebersprang ein Feld oder ihre Wartezeit: $boundary/$binding/$behavior"
      }
      for ($index=0; $index -lt $bound.fieldIds.Count; $index++) {
        $expectedField=$(if ($index % 2 -eq 0) {'synthetic.first'} else {'synthetic.required'})
        if ($bound.fieldIds[$index] -cne $expectedField) { throw 'Nicht alle bekannten Felder wurden in jeder Zielpruefung gelesen.' }
      }
      $expectedTables=$(if ($binding -ceq 'table') {$bound.reads} elseif ($behavior -ceq 'ready') {2} else {0})
      if ($bound.tables -ne $expectedTables) { throw 'Die bekannte Zielpruefung uebersprang die Tabelle oder las sie vor den Feldern.' }
      if ($behavior -ceq 'ready') {
        if ($bound.emitted.erreicht -ne $true -or $bound.reads -ne 4) { throw 'Ein spaeteres Feld oder eine spaetere Tabelle wurde nicht stabil bestaetigt.' }
      } elseif ($null -ne $bound.emitted -or $bound.failure.kind -cne 'navigation-blocked' -or
          $bound.clock.ElapsedMilliseconds -ne 1800) {
        throw 'Ein dauerhaft fehlendes Folgefeld oder eine fehlende Tabelle erlaubte weitere Navigation.'
      }
    }
  }
}

# Use the actual catalog for its repeated heading, not an invented binding.
# The current repeated page has no required fields or focusless table policy;
# the real readiness predicate therefore keeps its existing immediate proof.
$targetCatalog=Get-Content -LiteralPath (Join-Path $root 'profiles\2025\page-objects.json') -Raw -Encoding UTF8 | ConvertFrom-Json

# The asset catalog also describes fields absent on older acquisitions.
# Execute the actual target predicate with exact synthetic provider results:
# only the explicitly configured binding fields identify this variant.
function Test-AssetGotoBinding($Page, [string[]]$PresentIds, [bool]$Expected, [bool]$TableReady=$true, [string[]]$ExpectedReads=$null) {
  foreach ($name in @('Test-KnownPageHeading','Test-KnownPageFields','IstZielseite')) {
    . ([scriptblock]::Create($targetFunctions[$name]))
  }
  $reads=New-Object Collections.ArrayList; $tableProof=[pscustomobject]@{calls=0}
  $knownTarget=[pscustomobject]@{page=$Page}; $ziel=[string]$Page.heading
  function Resolve-KnownFieldNode([IntPtr]$Window,$KnownField) {
    if ($Window -ne [IntPtr]7) { throw 'Asset binding lost its exact window.' }
    $ids=@($Page.fields.PSObject.Properties | Where-Object {
      [string]$_.Value.automationIdRelative -ceq [string]$KnownField.field.automationIdRelative
    })
    if ($ids.Count -ne 1) { throw 'Asset binding lost its exact catalog selector.' }
    $null=$reads.Add($ids[0].Name)
    if ($PresentIds -ccontains $ids[0].Name) { [pscustomobject]@{rid=$ids[0].Name;type='Edit'} }
  }
  function Test-SSEGotoTableReadiness([IntPtr]$Window,[string]$Heading) {
    if ($Window -ne [IntPtr]7 -or $Heading -cne $ziel) { throw 'Asset table proof lost its binding.' }
    $tableProof.calls++
    $TableReady
  }
  $result=IstZielseite ([IntPtr]7) $ziel
  if ($result -ne $Expected -or $tableProof.calls -ne [int]($Expected -or -not $TableReady)) { throw 'Asset variant bypassed field or table readiness.' }
  if ($null -ne $ExpectedReads -and ($reads -join ',') -cne ($ExpectedReads -join ',')) { throw 'Asset binding resolved optional fields or skipped required fields.' }
}
$assetBindingPage=$targetCatalog.pages.'gew.anlagevermoegen_wirtschaftsgut'
$assetBindingIds=@('bezeichnung','belegnummer','kaufdatum','abschreibung_aktuelles_jahr')
if (($assetBindingPage.bindingFieldIds -join ',') -cne ($assetBindingIds -join ',')) { throw 'The actual asset binding metadata changed.' }
Test-AssetGotoBinding $assetBindingPage $assetBindingIds $true $true $assetBindingIds
Test-AssetGotoBinding $assetBindingPage $assetBindingIds $false $false $assetBindingIds
foreach ($missingId in $assetBindingIds) {
  Test-AssetGotoBinding $assetBindingPage @($assetBindingIds | Where-Object {$_ -cne $missingId}) $false
}
Test-AssetGotoBinding $assetBindingPage @('foreign1','foreign2','foreign3','foreign4') $false
$defaultAssetBinding=$assetBindingPage | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$defaultAssetBinding.PSObject.Properties.Remove('bindingFieldIds')
$allAssetIds=@($defaultAssetBinding.fields.PSObject.Properties | ForEach-Object {$_.Name})
Test-AssetGotoBinding $defaultAssetBinding $allAssetIds $true $true $allAssetIds
Test-AssetGotoBinding $defaultAssetBinding $assetBindingIds $false

if (-not $targetCatalog.PSObject.Properties['focuslessCommits'] -or -not $targetCatalog.focuslessCommits -or
    @($targetCatalog.focuslessCommits.PSObject.Properties | Where-Object {$_.Value.controlType -ceq 'DataItem'}).Count -lt 1) {
  throw 'Der reale Katalog muss Tabellenrichtlinien enthalten, damit die Ausnahme fuer wiederkehrende Seiten aussagekraeftig bleibt.'
}
$repeatedPage=$targetCatalog.pages.'gew.innergem_erwerb_13b_einfuhr'
if (-not $repeatedPage -or [string]$repeatedPage.heading -notin @(Get-SSERepeatedPagingTitles)) {
  throw 'Die reale wiederkehrende Katalogseite fehlt im Blaetterpfad.'
}
function Test-RepeatedCatalogFastProof {
  foreach ($name in @('Test-KnownPageHeading','Test-KnownPageFields','IstZielseite','Get-SSEGotoTargetProof')) {
    . ([scriptblock]::Create($targetFunctions[$name]))
  }
  . ([scriptblock]::Create($bodyReadiness[0].Extent.Text))
  function Get-SSEPageObjects { $targetCatalog }
  function Resolve-KnownFieldNode { throw 'Die reale wiederkehrende Katalogseite bekam eine erfundene Feldbindung.' }
  function Get-SSEMainContentTree { throw 'Die reale wiederkehrende Katalogseite bekam eine erfundene Tabellenbindung.' }
  function WarteAufZielseite { throw 'Eine sofort fertige wiederkehrende Katalogseite bekam eine neue Wartezeit.' }
  function Fail { throw 'Die reale wiederkehrende Katalogseite wurde unberechtigt abgewiesen.' }
  $knownTarget=[pscustomobject]@{pageId='gew.innergem_erwerb_13b_einfuhr';page=$repeatedPage}
  $ziel=[string]$repeatedPage.heading
  $proof=Get-SSEGotoTargetProof ([IntPtr]7) $ziel
  if ($proof.bereit -ne $true -or $proof.ueberschrift -cne $ziel -or $proof.runden.Count -ne 0) {
    throw 'Die reale wiederkehrende Katalogseite verlor ihren sofortigen Zielbeweis.'
  }
}
Test-RepeatedCatalogFastProof

# Prefixes and numbered labels deliberately describe heading families. Use
# those actual catalog definitions with synthetic field lag: a family match
# must wait for binding and cannot become proof merely because fields lag.
$prefixPage=$targetCatalog.pages.'est.sonstige_werbungskosten_fahrten'
$numberedPage=$targetCatalog.pages.'gew.fahrzeug'
if (-not $prefixPage.headingPrefix -or -not $numberedPage.headingNumberedLabel) {
  throw 'Die realen Katalogregeln fuer Praefix und nummerierte Ueberschrift fehlen.'
}
foreach ($family in @(
  [pscustomobject]@{page=$prefixPage;heading=([string]$prefixPage.headingPrefix + ': Synthetischer Eintrag')},
  [pscustomobject]@{page=$numberedPage;heading=('2. ' + [string]$numberedPage.headingNumberedLabel + ': Synthetischer Eintrag')}
)) {
  if ($family.heading -ceq [string]$family.page.heading) { throw 'Die Familienpruefung muss einen nicht-exakten Seitentitel verwenden.' }
  foreach ($boundary in @('initial','preloop','paging')) {
    $expectedInvokes=$(if ($boundary -ceq 'paging') {1} else {0})
    foreach ($behavior in @('ready','missing')) {
      $familyProof=Test-TargetProofBoundary $true $boundary 2 $behavior 0 'field' $family.heading $family.page
      if ($familyProof.invokes -ne $expectedInvokes -or $familyProof.waits -ne 1 -or $familyProof.requestedBudget -ne 1800) {
        throw 'Ein passender Familientitel erlaubte weitere Navigation statt einer begrenzten Bindungspruefung.'
      }
      if ($behavior -ceq 'ready') {
        if ($familyProof.emitted.erreicht -ne $true -or $familyProof.emitted.ueberschrift -cne $family.heading -or
            $familyProof.reads -ne 4 -or $familyProof.fields -ne 4 -or $familyProof.tables -ne 2) {
          throw 'Ein Familientitel verlor seinen stabilen Feldbeweis oder die tatsaechliche Zielueberschrift.'
        }
      } elseif ($null -ne $familyProof.emitted -or $familyProof.failure.kind -cne 'navigation-blocked' -or
          $familyProof.failure.details.ueberschrift -cne $family.heading -or
          $familyProof.failure.message -notmatch 'Felder oder Tabellen.*nicht vollstaendig gebunden' -or
          $familyProof.clock.ElapsedMilliseconds -ne 1800) {
        throw 'Ein Familientitel ohne erforderliche Feldbindung wurde angenommen oder als fremder Titel behandelt.'
      }
    }
  }
}

# If a required binding is ever present for a repeated heading, incomplete
# identity must refuse safely; repeating navigation cannot disambiguate it.
foreach ($boundary in @('initial','preloop','paging')) {
  $repeated=Test-TargetProofBoundary $true $boundary 2 'missing' 0 'field' ([string]$repeatedPage.heading)
  $expectedInvokes=$(if ($boundary -ceq 'paging') {1} else {0})
  if ($null -ne $repeated.emitted -or $repeated.failure.kind -cne 'navigation-blocked' -or
      $repeated.invokes -ne $expectedInvokes -or $repeated.waits -ne 1 -or
      $repeated.requestedBudget -ne 1800 -or $repeated.clock.ElapsedMilliseconds -ne 1800) {
    throw 'Eine wiederkehrende Ueberschrift mit fehlender erforderlicher Bindung erlaubte weitere Navigation.'
  }
}
Write-Output 'goto: initial, vor/nach Invoke warten nur erreichte Feld-/Tabellenziele ab; Frist, Fehler und Landungsregeln bleiben erhalten.'
