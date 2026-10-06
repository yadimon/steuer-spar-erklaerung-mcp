# Einzelelemente werden nie per Suche ueber einen ganzen Teilbaum geholt.
#
# FindFirst/FindAll mit TreeScope.Descendants oder Subtree (ebenso
# GetUpdatedCache ueber einen Teilbaum) laufen vollstaendig im GUI-Thread von
# SSE. Qt legt dabei fuer jede besuchte Tabellenzelle - auch auf verdeckten
# Seiten - ein Zugriffsobjekt an. Fehlt das Ziel, etwa waehrend eines
# Seitenaufbaus, wird der ganze Baum in einer einzigen Anfrage durchsucht, die
# SSE bis zum Ende abarbeitet, auch wenn der Client laengst aufgegeben hat.
# Solange sie laeuft, reagiert SSE nicht.
#
# Dieser Vertrag haelt fest:
#   1. Kein Worker-Skript ruft FindFirst, FindAll oder GetUpdatedCache auf, und
#      der native Baumlauf fragt nur Einzelknoten ab (TreeScope.Element).
#   2. Find-ExactAutomationElement steigt entlang der AutomationId ab: Eine
#      Tabelle neben dem Weg wird nie betreten, ein fehlendes Ziel kostet nur
#      die Kinder der Knoten auf dem Weg.
#   3. Die Reihenfolge bleibt die der bisherigen Suche (erstes Element in
#      Vorordnung, auch bei doppelten Containern); ein Name trennt
#      gleichnamige Geschwister.
#   4. Merker und letzter Baumlauf werden nur mit bestaetigter Identitaet
#      benutzt; ein veraltetes Element wird verworfen und neu aufgeloest.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

# 1 Statisch: keine Teilbaumsuche in irgendeinem Worker-Skript.
$forbidden = @('FindFirst', 'FindAll', 'GetUpdatedCache')
foreach ($script in @(Get-ChildItem -LiteralPath (Join-Path $root 'powershell') -Filter '*.ps1')) {
  $errors = $null
  $scriptAst = [Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$null, [ref]$errors)
  Assert-True ($errors.Count -eq 0) "Parserfehler in $($script.Name)."
  $calls = @($scriptAst.FindAll({
    param($node)
    $node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and
      $node.Member -is [Management.Automation.Language.StringConstantExpressionAst] -and
      $forbidden -contains $node.Member.Value
  }, $true))
  Assert-True ($calls.Count -eq 0) ("$($script.Name) sucht per Teilbaum: " +
    (($calls | ForEach-Object { "Zeile $($_.Extent.StartLineNumber)" }) -join ', '))
}
$nativeSource = Get-Content -LiteralPath (Join-Path $root 'powershell\sse-native.cs') -Raw
$nativeCode = [regex]::Replace($nativeSource, '(?s)/\*.*?\*/|//[^\r\n]*', '')
$nativeScopes = @([regex]::Matches($nativeCode, 'TreeScope\.(\w+)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
# Einzige Bereichsangabe ist TreeScope.Element; damit holt auch GetUpdatedCache
# nur den einen Knoten. FindAll kommt dort nur als List<T>.FindAll vor.
Assert-True (($nativeScopes -join ',') -eq 'Element') "Der native Baumlauf nutzt TreeScope $($nativeScopes -join ', ')."
Assert-True (-not ($nativeCode -match '\.FindFirst\(')) 'Der native Baumlauf sucht per FindFirst.'

# 2-4 Verhalten an einem kuenstlichen UIA-Baum mit Aufrufzaehler.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
public sealed class FakeUiaElement {
  public string Aid; public string Name; public int[] Rid; public bool Dead; public object Offscreen = false;
  public FakeUiaElement Parent;
  public List<FakeUiaElement> Children = new List<FakeUiaElement>();
  public int[] GetRuntimeId() { FakeUia.Calls++; if (Dead) throw new InvalidOperationException("stale"); return Rid; }
  public object GetCurrentPropertyValue(object property) {
    FakeUia.Calls++;
    if (Dead) throw new InvalidOperationException("stale");
    if ((string)property == "aid") return Aid;
    if ((string)property == "name") return Name;
    if ((string)property == "offscreen") return Offscreen;
    throw new ArgumentException("property");
  }
}
public sealed class FakeUiaWalker {
  public FakeUiaElement GetFirstChild(FakeUiaElement element) {
    FakeUia.Calls++; FakeUia.Expanded.Add(element.Aid + "#" + element.Rid[0]);
    return element.Children.Count > 0 ? element.Children[0] : null;
  }
  public FakeUiaElement GetNextSibling(FakeUiaElement element) {
    FakeUia.Calls++;
    var siblings = element.Parent.Children;
    int index = siblings.IndexOf(element);
    return index + 1 < siblings.Count ? siblings[index + 1] : null;
  }
}
public static class FakeUia {
  public static int Calls;
  public static HashSet<string> Expanded = new HashSet<string>();
  public static FakeUiaElement Root;
  public static object AutomationIdProperty = "aid";
  public static object NameProperty = "name";
  public static object IsOffscreenProperty = "offscreen";
  static int next = 1;
  public static FakeUiaElement FromHandle(IntPtr handle) { return Root; }
  public static FakeUiaElement Add(FakeUiaElement parent, string aid, string name) {
    var element = new FakeUiaElement { Aid = aid, Name = name, Rid = new int[] { next++ }, Parent = parent };
    if (parent != null) parent.Children.Add(element);
    return element;
  }
  public static void Reset() { Calls = 0; Expanded.Clear(); }
}
'@

$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$null, [ref]$errors)
Assert-True ($errors.Count -eq 0) "Worker-Parserfehler: $($errors[0].Message)"
foreach ($name in @('Test-SSEElementVisible', 'Test-SSEElementIdentity', 'Set-SSEAidElement', 'Get-SSEAidElement',
                    'Find-SSEAutomationIdBelow', 'Find-ExactAutomationElement')) {
  $definition = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true))
  Assert-True ($definition.Count -eq 1) "$name ist nicht eindeutig vorhanden."
  Invoke-Expression $definition[0].Extent.Text
}

$app = [FakeUia]::Add($null, 'App.Win', 'SSE')
[FakeUia]::Root = $app
$toolbar = [FakeUia]::Add($app, 'App.Win.MainToolBar', '')
$save = [FakeUia]::Add($toolbar, 'App.Win.MainToolBar.tb_sichern', 'Sichern')
$central = [FakeUia]::Add($app, 'App.Win.central', '')
# Eine grosse Tabelle VOR dem Ziel; Qt wiederholt die Tabellen-Id an den Zellen.
$table = [FakeUia]::Add($central, 'App.Win.central.table', '')
foreach ($cell in 1..3000) { $null = [FakeUia]::Add($table, 'App.Win.central.table', "Zelle $cell") }
$frame = [FakeUia]::Add($central, 'App.Win.central.frame', '')
$header = [FakeUia]::Add($frame, 'App.Win.central.frame.Header', '')
$heading = [FakeUia]::Add($header, 'App.Win.central.frame.Header.QLabel', 'Bürobedarf')
$footer = [FakeUia]::Add($frame, 'App.Win.central.frame.Footer', '')
$back = [FakeUia]::Add($footer, 'App.Win.central.frame.Footer.HoverButton', 'Zurück')
$forward = [FakeUia]::Add($footer, 'App.Win.central.frame.Footer.HoverButton', 'Weiter')
# Doppelter Container: Das Ziel liegt nur im zweiten.
$frameTwin = [FakeUia]::Add($central, 'App.Win.central.frame', '')
$late = [FakeUia]::Add($frameTwin, 'App.Win.central.frame.Late', 'spaet')

$script:AE = [FakeUia]
$script:WLK = New-Object FakeUiaWalker
$script:UIAElementCache = @{}
$script:SSE_AID_ELEMENTS = @{}
$script:SSE_LAST_SNAPSHOT = $null
$tableKey = 'App.Win.central.table#' + $table.Rid[0]

# 2 Abstieg: Ziel gefunden, Tabelle nie betreten, Aufwand begrenzt.
[FakeUia]::Reset()
$found = Find-ExactAutomationElement ([IntPtr]1) '.central.frame.Header.QLabel'
Assert-True ([object]::ReferenceEquals($found, $heading)) 'Der Abstieg liefert nicht die Ueberschrift.'
Assert-True (-not [FakeUia]::Expanded.Contains($tableKey)) 'Der Abstieg hat die Tabelle neben dem Weg betreten.'
Assert-True ([FakeUia]::Calls -lt 40) "Der Abstieg brauchte $([FakeUia]::Calls) Einzelabrufe."

[FakeUia]::Reset()
$missing = Find-ExactAutomationElement ([IntPtr]1) '.central.frame.Header.Fehlt'
Assert-True ($null -eq $missing) 'Ein fehlendes Ziel darf nichts liefern.'
Assert-True (-not [FakeUia]::Expanded.Contains($tableKey)) 'Ein fehlendes Ziel hat die Tabelle betreten.'
Assert-True ([FakeUia]::Calls -lt 80) "Ein fehlendes Ziel kostete $([FakeUia]::Calls) Einzelabrufe."

# 3 Reihenfolge und Namen.
$script:SSE_AID_ELEMENTS = @{}
$byName = Find-ExactAutomationElement ([IntPtr]1) '.central.frame.Footer.HoverButton' 'Weiter'
Assert-True ([object]::ReferenceEquals($byName, $forward)) 'Der Name trennt gleichnamige Geschwister nicht.'
$first = Find-ExactAutomationElement ([IntPtr]1) '.central.frame.Footer.HoverButton'
Assert-True ([object]::ReferenceEquals($first, $back)) 'Ohne Namen gilt das erste Element in Vorordnung.'
$script:SSE_AID_ELEMENTS = @{}
$twin = Find-ExactAutomationElement ([IntPtr]1) '.central.frame.Late'
Assert-True ([object]::ReferenceEquals($twin, $late)) 'Ein Ziel im zweiten gleichnamigen Container wird nicht gefunden.'
Assert-True (-not [FakeUia]::Expanded.Contains($tableKey)) 'Die Suche im zweiten Container hat die Tabelle betreten.'

# 4 Merker nur mit bestaetigter Identitaet.
$null = Find-ExactAutomationElement ([IntPtr]1) '.central.frame.Header.QLabel'
[FakeUia]::Reset()
$again = Find-ExactAutomationElement ([IntPtr]1) '.central.frame.Header.QLabel'
Assert-True ([object]::ReferenceEquals($again, $heading)) 'Der Merker liefert ein anderes Element.'
Assert-True ([FakeUia]::Calls -le 3 -and [FakeUia]::Expanded.Count -eq 0) "Der Merker kostete $([FakeUia]::Calls) Abrufe samt Baumschritten."

$heading.Dead = $true
$rebuilt = [FakeUia]::Add($header, 'App.Win.central.frame.Header.QLabel', 'Fachliteratur')
[FakeUia]::Reset()
$fresh = Find-ExactAutomationElement ([IntPtr]1) '.central.frame.Header.QLabel'
Assert-True ([object]::ReferenceEquals($fresh, $rebuilt)) 'Ein veraltetes Element wurde nicht neu aufgeloest.'
Assert-True (-not [FakeUia]::Expanded.Contains('App.Win#' + $app.Rid[0])) 'Neu aufgeloest wird ab dem tiefsten bekannten Vorfahren, nicht ab der Wurzel.'

# Letzter Baumlauf: Knoten mit bestaetigter Identitaet ohne jeden Baumschritt.
$script:SSE_AID_ELEMENTS = @{}
$script:UIAElementCache = @{ ([string]$save.Rid[0]) = $save }
$script:SSE_LAST_SNAPSHOT = [pscustomobject]@{
  window = '1'
  nodes = @([pscustomobject]@{ aid = 'App.Win.MainToolBar.tb_sichern'; name = 'Sichern'; rid = [string]$save.Rid[0] })
}
[FakeUia]::Reset()
$fromSnapshot = Find-ExactAutomationElement ([IntPtr]1) '.MainToolBar.tb_sichern'
Assert-True ([object]::ReferenceEquals($fromSnapshot, $save)) 'Der Knoten des letzten Baumlaufs wird nicht benutzt.'
Assert-True ([FakeUia]::Expanded.Count -eq 0) 'Trotz Knoten im letzten Baumlauf wurde der Baum betreten.'

$save.Dead = $true
$saveRebuilt = [FakeUia]::Add($toolbar, 'App.Win.MainToolBar.tb_sichern', 'Sichern')
$script:SSE_AID_ELEMENTS = @{}
$afterRebuild = Find-ExactAutomationElement ([IntPtr]1) '.MainToolBar.tb_sichern'
Assert-True ([object]::ReferenceEquals($afterRebuild, $saveRebuilt)) 'Ein veralteter Knoten des letzten Baumlaufs wurde benutzt.'

# Der bisherige Treffer bleibt lebendig, wird aber verdeckt. Die sichtbare
# Abfrage muss sowohl den Merker als auch einen alten Snapshot verwerfen und
# den gleichnamigen neuen Knoten finden; Datenlesungen ohne Sichtbarkeits-
# anforderung behalten ihre bisherigen Regeln.
$script:SSE_LAST_SNAPSHOT = $null
$visibleBefore = Find-ExactAutomationElement ([IntPtr]1) '.central.frame.Header.QLabel' -VisibleOnly
Assert-True ([object]::ReferenceEquals($visibleBefore, $rebuilt)) 'Sichtbarer Ausgangsknoten fehlt.'
$rebuilt.Offscreen = $true
$visibleAfter = [FakeUia]::Add($header, 'App.Win.central.frame.Header.QLabel', 'Aktuelle Seite')
$script:UIAElementCache[[string]$rebuilt.Rid[0]] = $rebuilt
$script:SSE_LAST_SNAPSHOT = [pscustomobject]@{
  window='1'; nodes=@([pscustomobject]@{aid=$rebuilt.Aid;name=$rebuilt.Name;rid=[string]$rebuilt.Rid[0]})
}
$freshVisible = Find-ExactAutomationElement ([IntPtr]1) '.central.frame.Header.QLabel' -VisibleOnly
Assert-True ([object]::ReferenceEquals($freshVisible, $visibleAfter)) 'Ein lebendiger, aber verdeckter Merker oder Snapshot verdeckt die neue Ueberschrift.'
$visibleAfter.Offscreen = $null
Assert-True (-not (Test-SSEElementVisible $visibleAfter)) 'Unbekannte Sichtbarkeit galt als sichtbar.'
$visibleAfter.Offscreen = $true
Assert-True ($null -eq (Find-ExactAutomationElement ([IntPtr]1) '.central.frame.Header.QLabel' -VisibleOnly)) 'Nur verdeckte Treffer galten als sichtbares Ziel.'

Write-Output 'Begrenzte Elementsuche: keine Teilbaumsuche, Abstieg entlang der Id, Identitaet und erforderliche Sichtbarkeit vor jedem Merker - bestanden'

# Nicht gefundene Blaetterschalter: erst ein vollstaendiger Baum beweist ihre
# Abwesenheit. Ein limitierter Baum muss unbekannt melden, nicht dead-end.
$buttonDefinition = @($ast.FindAll({ param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Find-SSENamedButton'
}, $true))[0]
Invoke-Expression $buttonDefinition.Extent.Text
$script:SSE_NAMED_BUTTON_AIDS = @{}
$script:buttonTree = [pscustomobject]@{nodes=@();stats=[pscustomobject]@{truncated=$true;err=0}}
function Walk-Tree { $script:buttonTree }
function Fail { param($Message,$Kind) throw $Kind }
$unknown = $false
try { $null = Find-SSENamedButton ([IntPtr]1) 'Weiter' } catch { $unknown = $_.Exception.Message -ceq 'snapshot-truncated' }
Assert-True $unknown 'Ein abgeschnittener Baum behauptete einen fehlenden Blaetterschalter.'
$script:buttonTree.stats.truncated = $false
Assert-True ($null -eq (Find-SSENamedButton ([IntPtr]1) 'Weiter')) 'Eine bestaetigte Abwesenheit muss ohne geratenen Schalter enden.'