# Ein katalogisiertes Werkzeugfenster darf geschlossen werden - und sonst nichts.
#
# Der BelegManager laesst sich ueber das Extras-Menue oeffnen, Qt fuehrt ihn
# aber als Dialog ohne einen einzigen Schalter. Vor der Katalogisierung strandete
# damit jeder Aufrufer, der ihn oeffnete: sse_dialog_answer hatte nichts zu
# druecken, sse_window_close lehnte die Fensterart ab, und sse_close verweigerte
# dauerhaft mit 'dialog-open'. Die Freigabe haengt allein am exakten Titel aus
# dem Profilkatalog, nicht an einer Groesse.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$catalogPath = Join-Path $root 'profiles\2025\page-objects.json'

$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

foreach ($name in @('Resolve-SSEClosableNonmodalWindowPolicy', 'Test-SSESafeAuxiliaryDescriptor')) {
  $definition = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true))
  if ($definition.Count -ne 1) { throw "Funktion $name ist nicht eindeutig vorhanden." }
  Invoke-Expression $definition[0].Extent.Text
}

# Der echte Profilkatalog, damit dieser Test auch den Eintrag selbst prueft.
$script:Katalog = Get-Content -LiteralPath $catalogPath -Raw -Encoding UTF8 | ConvertFrom-Json
function Get-SSEPageObjects { $script:Katalog }

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function Fenster([string]$Title, [int]$W, [int]$H, [string]$Kind = 'qt-dialog') {
  [pscustomobject]@{ title = $Title; w = $W; h = $H; kind = $Kind; cls = 'Qt692QWindow' }
}

# Gemessen auf einem grossen Bildschirm; eine Groessenschranke waere hier falsch.
$belegManager = Fenster 'BelegManager' 2304 1359
$policy = Resolve-SSEClosableNonmodalWindowPolicy $belegManager
Assert-True ($null -ne $policy) 'Der BelegManager steht nicht als schliessbares Fenster im Profilkatalog 2025.'
Assert-True ($policy.role -eq 'nonmodal-tool-window') "Der BelegManager traegt die Rolle '$($policy.role)'."
Assert-True (Test-SSESafeAuxiliaryDescriptor $belegManager) 'Der katalogisierte BelegManager gilt nicht als schliessbares Nebenfenster.'
Assert-True (Test-SSESafeAuxiliaryDescriptor (Fenster 'BelegManager' 963 581)) 'Derselbe Manager in klein wurde abgelehnt.'

# Der Titel bindet exakt und mit Gross-/Kleinschreibung.
foreach ($fremd in @('belegmanager', 'BelegManager ', 'BelegManager 2025', 'Beleg-Manager')) {
  Assert-True ($null -eq (Resolve-SSEClosableNonmodalWindowPolicy (Fenster $fremd 963 581))) "Der Titel '$fremd' wurde als katalogisiertes Fenster akzeptiert."
  Assert-True (-not (Test-SSESafeAuxiliaryDescriptor (Fenster $fremd 963 581))) "Der Titel '$fremd' galt als schliessbares Nebenfenster."
}

# Ein unbekannter Qt-Dialog bleibt gesperrt, egal wie klein er ist.
Assert-True (-not (Test-SSESafeAuxiliaryDescriptor (Fenster 'Daten an das Finanzamt senden' 600 400))) 'Ein unbekannter Dialog wurde als schliessbares Nebenfenster gewertet.'
Assert-True ($null -eq (Resolve-SSEClosableNonmodalWindowPolicy (Fenster 'Daten an das Finanzamt senden' 600 400))) 'Ein unbekannter Dialog fand eine Schliesspolitik.'

# Die Groessenschranken der bisherigen Hilfsfenster gelten unveraendert weiter.
Assert-True (Test-SSESafeAuxiliaryDescriptor (Fenster 'Werte-Info: Werte vergleichen' 640 480)) 'Die Werte-Info in ihrer Groesse wurde abgelehnt.'
Assert-True (-not (Test-SSESafeAuxiliaryDescriptor (Fenster 'Werte-Info: Werte vergleichen' 1400 900))) 'Eine uebergrosse Werte-Info wurde akzeptiert; die Schranke ist wirkungslos.'

Write-Output 'Werkzeugfenster: BelegManager katalogisiert und schliessbar, Titel bindet exakt, fremde Dialoge und Groessenschranken unveraendert.'

# Execute the real transaction against deterministic before/after inventories.
# Win32 delivery is modeled here; the production policy and postcondition run unchanged.
$dependencies = @(
  'Arg', 'Get-SSEBoundedIntegerArg', 'ConvertTo-Vergleichsform', 'Test-Versand',
  'Test-SSESystemOverlayDescriptor', 'Test-SSEWindowDecorationDescriptor'
)
foreach ($definition in $ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in $dependencies
}, $true)) {
  Invoke-Expression $definition.Extent.Text
}
$operationBodies = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.SwitchStatementAst]
}, $true) | ForEach-Object { $_.Clauses } | Where-Object { $_.Item1.Value -ceq 'window_close' })
Assert-True ($operationBodies.Count -eq 1) 'window_close transaction is not uniquely defined.'
$bodyText = $operationBodies[0].Item2.Extent.Text
$closeTransaction = [scriptblock]::Create($bodyText.Substring(1, $bodyText.Length - 2))
Add-Type -TypeDefinition @'
using System;
public static class SW {
  public static bool Closed;
  public static int Calls;
  public static IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wParam,
    IntPtr lParam, uint flags, uint timeout, ref IntPtr result) {
    Calls++;
    Closed = true;
    return new IntPtr(1);
  }
  public static bool IsWindow(IntPtr hwnd) { return !Closed; }
}
'@
function Get-Windows([string]$ProcessName) {
  if ([SW]::Closed) { return @($script:AfterWindows) }
  @($script:BeforeWindows)
}
function Get-DialogInventory([int]$ProcessId) {
  @(Get-Windows 'SSE')
}
function Emit($Result) {
  $script:TransactionResult = $Result
  throw 'window-close-result'
}
function Fail([string]$Message, [string]$Kind) {
  Emit ([pscustomobject]@{ ok=$false; kind=$Kind; error=$Message })
}
function TransactionWindow([long]$Hwnd, [string]$Title, [string]$Class, [string]$Kind = 'other', [int]$W = 640, [int]$H = 400) {
  [pscustomobject]@{ hwnd=$Hwnd; pid=7; title=$Title; cls=$Class; kind=$Kind; w=$W; h=$H; titleFingerprint=('A' * 64) }
}
function Assert-CloseTransaction([string]$Label, $Before, $After, [bool]$ExpectedOk, [string]$ExpectedKind = '', [int]$ExpectedCalls = 1) {
  $script:BeforeWindows = @($Before)
  $script:AfterWindows = @($After)
  $script:TransactionResult = $null
  [SW]::Closed = $false
  [SW]::Calls = 0
  $a = [pscustomobject]@{ pid=7; hwnd=202; titleFingerprint=('A' * 64); waitMs=300 }
  try { & $closeTransaction }
  catch { if ($_.Exception.Message -cne 'window-close-result') { throw } }
  Assert-True ($null -ne $script:TransactionResult) "$Label did not emit a result."
  Assert-True ($script:TransactionResult.ok -eq $ExpectedOk) "${Label}: unexpected result $($script:TransactionResult | ConvertTo-Json -Depth 5 -Compress)"
  Assert-True ([SW]::Calls -eq $ExpectedCalls) "${Label}: unexpected WM_CLOSE count."
  if ($ExpectedOk) {
    Assert-True ($script:TransactionResult.closed -and $script:TransactionResult.onlyTargetRemoved -and $script:TransactionResult.verified) "${Label}: incomplete success postcondition."
  } else {
    Assert-True ($script:TransactionResult.kind -ceq $ExpectedKind) "${Label}: expected $ExpectedKind."
  }
}
$main = TransactionWindow 101 'Synthetic case' 'Qt692QWindowIcon' 'main' 1100 900
$manager = TransactionWindow 202 'BelegManager' 'Qt692QWindow' 'known-nonmodal' 2304 1359
$tips = TransactionWindow 303 'Steuer-Spar-Tipps' 'Qt692QWindow' 'tips'
$tooltip = TransactionWindow 404 '' 'Qt692QWindowToolTipDropShadowSaveBits' 'shadow' 360 142
$shadow = TransactionWindow 405 '' 'SysShadow' 'shadow' 364 146
$inputIndicator = TransactionWindow 406 '' 'UAC_InputIndicatorOverlayWnd' 'other' 50 50
$tooLargeIndicator = TransactionWindow 407 '' 'UAC_InputIndicatorOverlayWnd' 'other' 81 50
$popup = TransactionWindow 408 '' 'Qt692QWindowPopupDropShadowSaveBits' 'shadow'
$unknown = TransactionWindow 409 '' 'Static' 'other'
$dialog = TransactionWindow 410 'Confirm' '#32770' 'native-dialog'
$shadowLookalike = TransactionWindow 411 '' 'CustomSysShadow' 'other'
$tooltipLookalike = TransactionWindow 412 '' 'CustomQt692QWindowToolTipSaveBits' 'other'
$baseBefore = @($main, $manager, $tips)
$baseAfter = @($main, $tips)
Assert-CloseTransaction 'Only the target closes' $baseBefore $baseAfter $true
Assert-CloseTransaction 'Tooltip and native shadow disappear with their owner' ($baseBefore + @($tooltip, $shadow)) $baseAfter $true
Assert-CloseTransaction 'Known input indicator disappears' ($baseBefore + @($inputIndicator)) $baseAfter $true
Assert-CloseTransaction 'Known input indicator appears' $baseBefore ($baseAfter + @($inputIndicator)) $true
Assert-CloseTransaction 'Large input window remains a peer' ($baseBefore + @($tooLargeIndicator)) $baseAfter $false 'postcondition-failed'
Assert-CloseTransaction 'Interactive Qt popup remains a peer' ($baseBefore + @($popup)) $baseAfter $false 'postcondition-failed'
Assert-CloseTransaction 'Unknown window disappears' ($baseBefore + @($unknown)) $baseAfter $false 'postcondition-failed'
Assert-CloseTransaction 'Unknown window appears' $baseBefore ($baseAfter + @($unknown)) $false 'postcondition-failed'
Assert-CloseTransaction 'Shadow class lookalike remains a peer' ($baseBefore + @($shadowLookalike)) $baseAfter $false 'postcondition-failed'
Assert-CloseTransaction 'Tooltip class lookalike remains a peer' ($baseBefore + @($tooltipLookalike)) $baseAfter $false 'postcondition-failed'
Assert-CloseTransaction 'Known auxiliary window disappears' $baseBefore @($main) $false 'postcondition-failed'
$changedMain = $main.PSObject.Copy()
$changedMain.titleFingerprint = 'B' * 64
Assert-CloseTransaction 'Case title changes' $baseBefore @($changedMain, $tips) $false 'postcondition-failed'
Assert-CloseTransaction 'Closing opens a modal dialog' $baseBefore ($baseAfter + @($dialog)) $false 'postcondition-failed'
Assert-CloseTransaction 'Existing modal dialog blocks delivery' ($baseBefore + @($dialog)) ($baseAfter + @($dialog)) $false 'blocked' 0
Write-Output 'Window-close transaction: owner decorations tolerated; other peers, popups and dialogs remain protected; exactly one delivery.'
