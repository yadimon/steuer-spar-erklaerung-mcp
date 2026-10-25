# Interne MSAA-Proben bleiben am Ziel-HWND gebunden: eine globale Punktabfrage
# koennte Werte eines ueberdeckenden Fensters lesen. Der ausdrueckliche
# Diagnosepfad behaelt seine volle globale Punktprojektion; die alte native
# Basic-Signatur bleibt kompatibel und ohne teure Extended-Getter.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$nativePath = Join-Path $root 'powershell\sse-native.cs'
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Get-FunctionText($Ast, [string]$Name) {
  $definitions = @($Ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $Name
  }, $true))
  Assert-True ($definitions.Count -eq 1) "Worker-Funktion $Name ist nicht eindeutig vorhanden."
  $definitions[0].Extent.Text
}

function Get-CallCount([string]$Text, [string]$Method) {
  [regex]::Matches(
    $Text,
    ('\[SSEAccessible\]::' + [regex]::Escape($Method) + '\s*\('),
    [Text.RegularExpressions.RegexOptions]::CultureInvariant
  ).Count
}

$tokens = $null
$parseErrors = $null
$workerAst = [Management.Automation.Language.Parser]::ParseFile(
  $workerPath,
  [ref]$tokens,
  [ref]$parseErrors
)
Assert-True ($parseErrors.Count -eq 0) "Worker-Parserfehler: $($parseErrors[0].Message)"

$clickText = Get-FunctionText $workerAst 'Click-VerifiedPoint'
$dialogText = Get-FunctionText $workerAst 'Get-DialogDescriptor'
$diagnosticText = Get-FunctionText $workerAst 'Get-AccessibilityProbeData'
$workerText = [IO.File]::ReadAllText($workerPath)

Assert-True ((Get-CallCount $clickText 'DescribeDocumentHit') -eq 1 -and
  (Get-CallCount $clickText 'DescribePointBasic') -eq 0 -and
  (Get-CallCount $clickText 'DescribePoint') -eq 0) `
  'Die verifizierte Klickprobe nutzt nicht exakt einmal den gebundenen MSAA-Hit-Pfad.'
Assert-True ($clickText.Contains('[SSEAccessible]::DescribeDocumentHit([int64]$Window, $px, $py)')) `
  'Die Klickprobe verliert das gebundene Ziel-HWND.'
Assert-True ((Get-CallCount $dialogText 'DescribeDocumentHit') -eq 2 -and
  (Get-CallCount $dialogText 'DescribePointBasic') -eq 0 -and
  (Get-CallCount $dialogText 'DescribePoint') -eq 0) `
  'CSV-Fastprobe und kompakter Dialograster nutzen nicht exakt den gebundenen MSAA-Hit-Pfad.'
Assert-True ([regex]::Matches($dialogText, '\[SSEAccessible\]::DescribeDocumentHit\(\[int64\]\$Window\.hwnd,').Count -eq 2) `
  'Eine Dialogprobe verliert ihr gebundenes Ziel-HWND.'
Assert-True ((Get-CallCount $diagnosticText 'DescribePoint') -eq 1 -and
  (Get-CallCount $diagnosticText 'DescribePointBasic') -eq 0) `
  'Der Accessibility-Diagnosepfad behaelt nicht exakt eine volle Punktabfrage.'
Assert-True ((Get-CallCount $workerText 'DescribePointBasic') -eq 0 -and
  (Get-CallCount $workerText 'DescribeDocumentHit') -eq 3 -and
  (Get-CallCount $workerText 'DescribePoint') -eq 1) `
  'Ausserhalb des geprueften Katalogs existieren weitere oder fehlende MSAA-Punktabfragen.'

# Der Quellvertrag schuetzt nicht nur die Projektion: Basic darf die Extended-
# Getter auch dann nicht aufrufen, wenn deren Ergebnis anschliessend verworfen
# wuerde. Die Reihenfolge des Full-Pfads bleibt dabei identisch zum Altvertrag.
$nativeText = [IO.File]::ReadAllText($nativePath)
$coreMatch = [regex]::Match(
  $nativeText,
  '(?s)static\s+SSEAccNode\s+DescribePointCore\s*\(.*?\)\s*\{(.*?)\n\s*public\s+static\s+SSEAccNode\s+DescribePoint\s*\('
)
Assert-True $coreMatch.Success 'Gemeinsamer privater DescribePoint-Core fehlt.'
$coreText = $coreMatch.Groups[1].Value
Assert-True ([regex]::IsMatch(
  $coreText,
  'if\s*\(hr != 0 \|\| accessible == null\) return null;'
)) 'Full und Basic teilen nicht mehr denselben HRESULT-/null-Rueckgabevertrag.'
Assert-True ($coreText.Contains('object id = childId ?? 0;')) `
  'Full und Basic teilen nicht mehr dieselbe MSAA-childId-Aufloesung.'
Assert-True ($coreText.Contains(
  'string name = "", value = "", description = "", help = "", shortcut = "", action = "";'
)) 'Ausgelassene Extended-Felder des Basic-Pfads bleiben nicht als nicht-null Leerstrings erhalten.'
$extendedGuard = [regex]::Match(
  $coreText,
  '(?s)if\s*\(includeExtended\)\s*\{(.*?)\n\s*\}'
)
Assert-True $extendedGuard.Success 'Extended-MSAA-Getter sind nicht explizit vom Full-Modus begrenzt.'
$extendedText = $extendedGuard.Groups[1].Value
$extendedGetterOrder = @('accDescription', 'accHelp', 'accKeyboardShortcut', 'accDefaultAction')
$previousIndex = -1
foreach ($getter in $extendedGetterOrder) {
  Assert-True ([regex]::Matches($coreText, ('\b' + $getter + '\s*\(')).Count -eq 1) `
    "Extended-Getter $getter kommt im gemeinsamen Core nicht exakt einmal vor."
  $currentIndex = $extendedText.IndexOf($getter, [StringComparison]::Ordinal)
  Assert-True ($currentIndex -gt $previousIndex) "Full-Getter $getter verlor seine bisherige Reihenfolge."
  $previousIndex = $currentIndex
}
Assert-True ([regex]::IsMatch(
  $coreText,
  '(?s)Name = name, Value = value, Description = description, Help = help,\s*' +
  'KeyboardShortcut = shortcut, DefaultAction = action, Role = role, State = state,\s*' +
  'X = left, Y = top, W = width, H = height, Path = new int\[0\]'
)) 'Gemeinsame SSEAccNode-Projektion verlor Felder, Leerstringform oder den nicht-null leeren Pfad.'
Assert-True ([regex]::IsMatch(
  $nativeText,
  '(?s)public\s+static\s+SSEAccNode\s+DescribePoint\s*\(int x, int y\)\s*\{\s*return\s+DescribePointCore\(x, y, true\);\s*\}'
)) 'DescribePoint delegiert nicht unveraendert in den Full-Core.'
Assert-True ([regex]::IsMatch(
  $nativeText,
  '(?s)public\s+static\s+SSEAccNode\s+DescribePointBasic\s*\(int x, int y\)\s*\{\s*return\s+DescribePointCore\(x, y, false\);\s*\}'
)) 'DescribePointBasic delegiert nicht eindeutig in den begrenzten Core.'

. (Join-Path $root 'powershell\load-native.ps1')
$load = Import-SSENativeInterop
Assert-True ($load.mode -in @('precompiled-dll', 'source-fallback', 'already-loaded')) `
  "Nativer Interop-Loader meldete einen unbekannten Modus '$($load.mode)'."

$publicStatic = [Reflection.BindingFlags]::Public -bor [Reflection.BindingFlags]::Static
$fullMethods = @([SSEAccessible].GetMethods($publicStatic) | Where-Object Name -CEQ 'DescribePoint')
$basicMethods = @([SSEAccessible].GetMethods($publicStatic) | Where-Object Name -CEQ 'DescribePointBasic')
Assert-True ($fullMethods.Count -eq 1 -and $basicMethods.Count -eq 1) `
  'Full und Basic muessen eindeutige, nicht ueberladene Methodennamen besitzen.'
foreach ($method in @($fullMethods[0], $basicMethods[0])) {
  $parameters = @($method.GetParameters())
  Assert-True ($method.ReturnType -eq [SSEAccNode] -and $parameters.Count -eq 2 -and
    $parameters[0].ParameterType -eq [int] -and $parameters[1].ParameterType -eq [int]) `
    "Native Punktmethode $($method.Name) verlor Rueckgabetyp oder int/int-Signatur."
}
# Nur die statische Lesedependenz wird ersetzt; der Descriptor-Koerper bleibt
# exakt der geparsten Produktionsfunktion entnommen. Keine Produkt-Fixture.
Add-Type @'
using System;
public class SseDialogPointFixtureNode {
 public string Name="",Value=""; public int Role=43,State=0,X,Y,W=2,H=2;
}
public static class SseDialogPointFixture {
 public static int Calls,Mode; public static long LastWindow;
 public static SseDialogPointFixtureNode DescribeDocumentHit(long hwnd,int x,int y) {
  Calls++;LastWindow=hwnd;
  if(Mode==5)return null;
  if(Mode==3)System.Threading.Thread.Sleep(2100);
  if(Mode==1 || (Mode==0 && Calls==2))throw new InvalidOperationException("Synthetic point read failure.");
  if(Mode==0 && Calls>2)return null;
  return new SseDialogPointFixtureNode {Name=Mode==2?(Calls==1?"Klicken Sie hier, um Ihre Daten zu exportieren":"Schlie\u00DFen"):"Nein",X=Mode==4?0:x-1,Y=Mode==4?0:y-1,W=Mode==4?180:2,H=Mode==4?120:2};
 }
}
'@
$script:DIALOG_BUTTONS=@('Ja','Nein','Abbrechen','Klicken Sie hier, um Ihre Daten zu exportieren',('Schlie'+[char]0x00DF+'en'))
function Resolve-SSEClosableNonmodalWindowPolicy { $null }
function Walk-Tree { [pscustomobject]@{nodes=@();stats=[pscustomobject]@{}} }
function ConvertTo-SSEDialogButtonName($Name) { $Name }
function Get-SSEDialogFingerprint { 'SYNTHETIC-FINGERPRINT' }
function Test-SSERecoveryPromptDescriptor { $false }
function Test-SSEUpdatePromptDescriptor { $false }
Invoke-Expression (Get-FunctionText $workerAst 'Test-SSESystemOverlayDescriptor')
Invoke-Expression ($dialogText.Replace('[SSEAccessible]::','[SseDialogPointFixture]::'))
& {
  $script:overlayTreeReads=0
  function Walk-Tree {
    $script:overlayTreeReads++
    [pscustomobject]@{
      nodes=@([pscustomobject]@{name='SYN';type='Pane';on=$true;rid='synthetic-language-label'})
      stats=[pscustomobject]@{truncated=$false;err=0;cyc=0;depthLimited=$false}
    }
  }
  foreach ($class in @('UAC Input Indicator','UAC_InputIndicatorOverlayWnd')) {
    [SseDialogPointFixture]::Calls=0;[SseDialogPointFixture]::Mode=5
    $overlay=[pscustomobject]@{hwnd=77;pid=7;cls=$class;title='';titleFingerprint='synthetic';x=0;y=0;w=40;h=40;minimiert=$false;hung=$false}
    $descriptor=Get-DialogDescriptor $overlay ([IntPtr]111)
    Assert-True ($descriptor.kind -ceq 'shadow' -and $script:overlayTreeReads -eq 0 -and [SseDialogPointFixture]::Calls -eq 0 -and
      $descriptor.buttons.Count -eq 0 -and $null -eq $descriptor.fingerprint) `
      'A known system overlay became a blocking dialog or triggered an unnecessary provider read.'
  }
  foreach ($case in @(
    @{cls='UnknownSyntheticWindow';w=40;h=40},
    @{cls='UAC Input Indicator';w=81;h=40},
    @{cls='UAC Input Indicator';w=40;h=81}
  )) {
    [SseDialogPointFixture]::Calls=0;[SseDialogPointFixture]::Mode=5
    $window=[pscustomobject]@{hwnd=77;pid=7;cls=$case.cls;title='';titleFingerprint='synthetic';x=0;y=0;w=$case.w;h=$case.h;minimiert=$false;hung=$false}
    $descriptor=Get-DialogDescriptor $window ([IntPtr]111)
    Assert-True ($descriptor.kind -ceq 'qt-dialog' -and $descriptor.buttons.Count -eq 0 -and $descriptor.unsupportedButtons -contains 'SYN') `
      'Unknown or oversized windows lost their conservative unsupported-action guard.'
  }
}
$window=[pscustomobject]@{hwnd=77;pid=7;cls='QtSynthetic';title='Synthetic question';titleFingerprint='synthetic';x=0;y=0;w=180;h=120;minimiert=$false;hung=$false}
[SseDialogPointFixture]::Calls=0;[SseDialogPointFixture]::Mode=0
$partial=Get-DialogDescriptor $window ([IntPtr]111)
Assert-True ($partial.kind -ceq 'qt-dialog' -and $partial.buttons.Count -eq 1) 'Ein einzelner defekter Punkt verwarf bereits erkannte Dialogschalter.'
Assert-True (-not $partial.msaaReadOk -and $partial.msaaError -and $null -eq $partial.fingerprint) 'Teilweise gelesener Dialog erhielt einen verwendbaren Antwortfingerprint.'
Assert-True ([SseDialogPointFixture]::Calls -eq 2 -and [SseDialogPointFixture]::LastWindow -eq 77) 'Fehlerhafter Raster wurde weiter abgefragt oder verlor das Ziel-HWND.'
[SseDialogPointFixture]::Calls=0;[SseDialogPointFixture]::Mode=3
$slow=Get-DialogDescriptor $window ([IntPtr]111)
Assert-True ([SseDialogPointFixture]::Calls -eq 1 -and $slow.msaaError -ceq 'System.TimeoutException' -and -not $slow.msaaReadOk -and $null -eq $slow.fingerprint) 'Langsame Punktlese startete nach dem Rasterbudget eine weitere Probe oder erfand Vollstaendigkeit.'
# Die Fixture-Namen bleiben an den tatsaechlichen Snapshot-Produzenten gebunden.
$walkText=Get-FunctionText $workerAst 'Walk-Tree'
$snapshotText=Get-FunctionText $workerAst 'Get-UiSnapshot'
Assert-True ($walkText.Contains('Get-UiSnapshot $hwnd')) 'Walk-Tree delegiert nicht mehr an den geprueften Snapshot-Produzenten.'
Assert-True ($snapshotText -match 'err=\$native.WalkErrors; cyc=\$native.CycleHits' -and
  $snapshotText -match 'truncated=\$native.Truncated; depthLimited=\[bool\]\$native.DepthLimited') 'Snapshot-Statistik verlor die tatsaechlichen Fehler-/Vollstaendigkeitsfelder.'
$buttonNodes=@([pscustomobject]@{name='Nein';type='Button';on=$true;rid='synthetic'})
$invalidTrees=@(
  [pscustomobject]@{name='missing-tree';tree=$null},
  [pscustomobject]@{name='missing-stats';tree=[pscustomobject]@{nodes=$buttonNodes}},
  [pscustomobject]@{name='truncated';tree=[pscustomobject]@{nodes=$buttonNodes;stats=[pscustomobject]@{truncated=$true;err=0;cyc=0;depthLimited=$false}}},
  [pscustomobject]@{name='error';tree=[pscustomobject]@{nodes=$buttonNodes;stats=[pscustomobject]@{truncated=$false;err=1;cyc=0;depthLimited=$false}}},
  [pscustomobject]@{name='cycle';tree=[pscustomobject]@{nodes=$buttonNodes;stats=[pscustomobject]@{truncated=$false;err=0;cyc=1;depthLimited=$false}}},
  [pscustomobject]@{name='depth';tree=[pscustomobject]@{nodes=$buttonNodes;stats=[pscustomobject]@{truncated=$false;err=0;cyc=0;depthLimited=$true}}}
)
foreach($invalidTree in $invalidTrees) {
  & {
    function Walk-Tree { $invalidTree.tree }
    [SseDialogPointFixture]::Calls=0;[SseDialogPointFixture]::Mode=1
    $incomplete=Get-DialogDescriptor $window ([IntPtr]111)
    Assert-True (-not $incomplete.uiaReadOk -and $incomplete.uiaError -and $null -eq $incomplete.fingerprint) "Unvollstaendiger UIA-Baum ($($invalidTree.name)) erhielt einen Antwortfingerprint."
    [SseDialogPointFixture]::Calls=0;[SseDialogPointFixture]::Mode=4
    $recovered=Get-DialogDescriptor $window ([IntPtr]111)
    Assert-True (-not $recovered.uiaReadOk -and $recovered.uiaError -and $recovered.msaaReadOk -and $recovered.fingerprint -ceq 'SYNTHETIC-FINGERPRINT') "Vollstaendiges MSAA-Inventar nach UIA-Fehler ($($invalidTree.name)) wurde verworfen."
  }
}
$window.title='Export f'+[char]0x00FC+'r das Finanzamt (*.csv)';$window.w=600;$window.h=400
[SseDialogPointFixture]::Calls=0;[SseDialogPointFixture]::Mode=1
$unreadable=Get-DialogDescriptor $window ([IntPtr]111)
Assert-True (-not $unreadable.msaaReadOk -and $unreadable.msaaError -and $null -eq $unreadable.fingerprint) 'Defekte CSV-Probe erfand ein bestaetigbares Inventar.'
[SseDialogPointFixture]::Calls=0;[SseDialogPointFixture]::Mode=2
$csv=Get-DialogDescriptor $window ([IntPtr]111)
Assert-True ($csv.kind -ceq 'qt-dialog' -and $csv.msaaReadOk -and $csv.buttons.Count -eq 2 -and $csv.fingerprint -ceq 'SYNTHETIC-FINGERPRINT') 'Vollstaendige CSV-Fastprobe verlor ihren gueltigen Readback.'
Assert-True ([SseDialogPointFixture]::Calls -eq 2) 'Vollstaendige CSV-Fastprobe fiel unnoetig in einen tiefen Raster zurueck.'
$inventoryText=Get-FunctionText $workerAst 'Get-DialogInventory'
Invoke-Expression $inventoryText
Invoke-Expression (Get-FunctionText $workerAst 'Invoke-DialogButtonInfo')
& {
  $clicks=New-Object Collections.ArrayList
  function Click-VerifiedPoint($Window,$Button) { $null=$clicks.Add([int64]$Window) }
  $button=[pscustomobject]@{enabled=$true;source='msaa-point';name='Nein'}
  $dialog=[pscustomobject]@{hwnd=77;fingerprint=$null;msaaError='Synthetic.Type';msaaReadOk=$false;uiaError=$null}
  $caught=$null
  try {$null=Invoke-DialogButtonInfo $dialog $button} catch {$caught=$_}
  Assert-True ($caught -and $clicks.Count -eq 0) 'Interne Antwort auf unvollstaendigen Dialog erreichte einen Klick.'
  $dialog.fingerprint='synthetic-fingerprint';$caught=$null
  try {$null=Invoke-DialogButtonInfo $dialog $button} catch {$caught=$_}
  Assert-True ($caught -and $clicks.Count -eq 0) 'Vorhandener Fingerprint ueberstimmte einen unvollstaendigen Readback.'
  $dialog.msaaError=$null;$dialog.fingerprint=$null;$caught=$null
  try {$null=Invoke-DialogButtonInfo $dialog $button} catch {$caught=$_}
  Assert-True ($caught -and $clicks.Count -eq 0) 'Interne Antwort ohne Fingerprint wurde erlaubt.'
  $dialog.fingerprint='synthetic-fingerprint'
  Assert-True ((Invoke-DialogButtonInfo $dialog $button) -ceq 'msaa-verified-point' -and $clicks.Count -eq 1 -and $clicks[0] -eq 77) 'Vollstaendige gebundene interne Antwort wurde gesperrt oder umgebunden.'
}
& {
  $reads=New-Object Collections.ArrayList
  function Get-Windows { @([pscustomobject]@{pid=8;hwnd=88;hung=$true},[pscustomobject]@{pid=7;hwnd=77;hung=$false}) }
  function Get-SSEMainWindowCandidates { @() }
  function Get-DialogDescriptor($Window,$MainHwnd) { $null=$reads.Add($Window.pid);[pscustomobject]@{pid=$Window.pid;kind='main'} }
  $bound=@(Get-DialogInventory 7 -RejectHung)
  Assert-True ($bound.Count -eq 1 -and $reads.Count -eq 1 -and $reads[0] -eq 7) 'Fremder haengender Peer wurde tief gelesen oder blockierte das gebundene Inventar.'
}
& {
  function Get-Windows { @([pscustomobject]@{pid=7;hwnd=77;hung=$true}) }
  function Get-DialogDescriptor { throw 'Bekannt haengendes Fenster darf nicht tief gelesen werden.' }
  $caught=$null
  try { $null=@(Get-DialogInventory 7 -RejectHung) } catch { $caught=$_ }
  Assert-True ($caught -and $caught.Exception -is [InvalidOperationException] -and $caught.Exception.Data['kind'] -ceq 'hung') 'Bekannt haengendes eigenes Fenster erreichte die tiefe Lese oder verlor seinen Fehlergrund.'
}
Write-Output 'OK: HWND-gebundene MSAA-Proben, unvollstaendige Dialoge, CSV-Fastprobe und native Basic-Signatur bestanden.'
