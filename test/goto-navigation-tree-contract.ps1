# Direkter Navigationsbaum-Klick in `goto`.
#
# Steht das Ziel exakt im sichtbaren Navigationsbaum, ersetzt ein einzelner
# Klick auf diesen Eintrag die globale Suche. Der Weg ist nur zulaessig, weil
# die Suche auf dem sichtbaren Desktop in genau diesem Fall ohnehin physisch
# doppelklickt. Daraus folgen die Grenzen, die dieser Vertrag festhaelt:
#
#   1. Nur der sichtbare Desktop klickt; useSearch=false erreicht den Weg nie.
#   2. Nie ein Uebermittlungsweg (Test-Versand), nie ein unsichtbarer Eintrag.
#   3. Genau ein Klick auf den labelnahen Punkt, kein Doppelklick; verdeckt
#      ein eigenes SSE-Fenster den Punkt, bleibt es ohne Klick beim Suchweg.
#   4. Unmittelbar vor dem Klick wird der Eintrag frisch gelesen: Punkt aus
#      dem aktuellen Rechteck, Klick an dessen RuntimeId gebunden. Hat er sich
#      seit dem Baumlauf veraendert oder ist er weg, bleibt es ohne Klick beim
#      Suchweg.
#   5. Erfolg nur ueber IstZielseite; eine andere Seite wird neuer Startpunkt
#      der Suche, ein Pruefhinweis stoppt sofort wie beim Blaettern, und ohne
#      jeden Seitenwechsel endet goto, statt eine zweite Navigation zu starten.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
. (Join-Path $root 'powershell\structure-binding.ps1')
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$null, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$gotoClauses = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.SwitchStatementAst] -and
  @($node.Clauses | Where-Object { $_.Item1.Extent.Text -ceq "'goto'" }).Count -eq 1
}, $true))
Assert-True ($gotoClauses.Count -eq 1) 'Der goto-Zweig ist nicht eindeutig vorhanden.'
$gotoBody = @($gotoClauses[0].Clauses | Where-Object { $_.Item1.Extent.Text -ceq "'goto'" })[0].Item2

$searchBlocks = @($gotoBody.FindAll({
  param($node)
  $node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Clauses[0].Item1.Extent.Text -ceq "(Arg `$a 'viaSuche') -ne `$false"
}, $true))
Assert-True ($searchBlocks.Count -eq 1) 'Der Suchblock von goto ist nicht eindeutig vorhanden.'
$searchStatements = @($searchBlocks[0].Clauses[0].Item2.Statements)

$statementTexts = @($searchStatements | ForEach-Object { $_.Extent.Text })
$selectionIndex = [array]::FindIndex($statementTexts, [Predicate[string]]{
  param($text) $text.StartsWith('$baumZiel = ')
})
Assert-True ($statementTexts[$selectionIndex].Contains('$ts.stats.truncated -or $ts.stats.err')) `
  'Ein unvollstaendiger Baum darf keinen eindeutigen Navigationsknoten behaupten.'
$searchIndex = [array]::IndexOf($statementTexts, '$suchfeld = Get-SSESearchFieldNode $ts')
Assert-True ($statementTexts[0] -ceq '$ts = Walk-Tree $hwnd 1500') `
  'Der Suchblock beginnt nicht mehr mit dem gemeinsamen Vorlauf.'
Assert-True ($selectionIndex -eq 1 -and $searchIndex -gt $selectionIndex) `
  'Der Navigationsbaum-Weg steht nicht zwischen dem Vorlauf und der Suche.'
$block = [scriptblock]::Create(($statementTexts[$selectionIndex..($searchIndex - 1)]) -join "`n")

$navAid = 'SSE_Application.AAV4GLEngineWindow31.centralWidget.SearchSplitter.TopLevelHSplitter.NavFrameSSE.QWidget.NavWidgetSSE'
function NavNode([int]$I, [int]$P, [string]$Type, [string]$Name, [int]$Y, [int]$X = 25, [int]$W = 494, [int]$H = 43) {
  [pscustomobject]@{ i=$I; p=$P; d=1; type=$Type; name=$Name; aid=$navAid; x=$X; y=$Y; w=$W; h=$H; on=$true; rid="7.$I" }
}
$navTree = [pscustomobject]@{ stats=[pscustomobject]@{truncated=$false;err=0}; nodes = @(
  (NavNode 0 -1 'Tree'     ''                          186 -X 0 -W 529 -H 600)
  (NavNode 1  0 'TreeItem' 'Steuererklaerung'          186)
  (NavNode 2  0 'TreeItem' 'Zielseite'                 229)
  (NavNode 3  0 'TreeItem' 'Anmeldungen versenden'     272)
) }
$rewalkedTree = [pscustomobject]@{ nodes = @() }
# Frisch gelesener Zustand des Zieleintrags unmittelbar vor dem Klick; ohne
# Abweichung identisch mit dem Baumlauf.
function FreshTarget([hashtable]$Changes = @{}) {
  $node = NavNode 2 0 'TreeItem' 'Zielseite' 229
  foreach ($key in @($Changes.Keys)) { $node.$key = $Changes[$key] }
  $node
}

function Invoke-NavigationBlock {
  param([string]$Target, [string]$DesktopName, [string]$HeadingAfter, [object[]]$Windows,
        [string]$Blocker = 'none', $Fresh = (FreshTarget))
  $script:clicks = New-Object System.Collections.ArrayList
  $script:waits = New-Object System.Collections.ArrayList
  $script:probes = New-Object System.Collections.ArrayList
  $script:liveReads = New-Object System.Collections.ArrayList
  $script:walks = 0
  $script:emitted = $null
  $script:failed = $null
  $script:DESKTOP_NAME = $DesktopName
  $ziel = $Target
  $hwnd = [IntPtr]4242
  $gotoPid = 3131
  $pageId = ''
  $start = 'Startseite'
  $ts = $navTree
  $weg = New-Object System.Collections.ArrayList
  $null = $weg.Add($start)
  function Test-Versand { param([string]$name) $name -ceq 'Anmeldungen versenden' }
  function Get-SSEPointObstruction {
    param([IntPtr]$BoundWindow, [int]$X, [int]$Y)
    $null = $script:probes.Add([pscustomobject]@{ window=[int64]$BoundWindow; x=$X; y=$Y })
    [pscustomobject]@{ blockerKind=$Blocker; isBoundTarget=($Blocker -ceq 'none') }
  }
  function Get-LiveElement {
    param([IntPtr]$hwnd, [string]$Rid, [string]$Aid = '')
    $null = $script:liveReads.Add([pscustomobject]@{ window=[int64]$hwnd; rid=$Rid })
    [pscustomobject]@{ liveRid=$Rid }
  }
  function Convert-ExactElementToNode { param($Element) $Fresh }
  function Click-VerifiedPoint {
    param([IntPtr]$Window, $Node, $ExpectedInputTick = $null, [switch]$RequireForeground, [int]$SettleMs = 250,
          [int]$ClickCount = 1, [int]$ForegroundAttempts = 3, [string]$ExpectedRuntimeId = '')
    $null = $script:clicks.Add([pscustomobject]@{
      window=[int64]$Window; x=$Node.x; y=$Node.y; w=$Node.w; h=$Node.h; count=$ClickCount; rid=$ExpectedRuntimeId
    })
  }
  function WarteAufUeberschrift {
    param([IntPtr]$h, [string]$vorher, [string]$erwartet, [int]$timeoutMs = 3000)
    $null = $script:waits.Add([pscustomobject]@{ vorher=$vorher; erwartet=$erwartet; timeoutMs=$timeoutMs })
    $HeadingAfter
  }
  function IstZielseite { param([IntPtr]$h, [string]$heading) [bool]($heading -ceq $ziel) }
  function Walk-Tree { param([IntPtr]$h, [int]$MaxNodes) $script:walks++; $rewalkedTree }
  function Get-Windows { param([string]$Filter) @($Windows) }
  function Emit { param($result) $script:emitted = $result; throw 'goto-navigation-emitted' }
  function Fail { param($msg, $kind = 'error', $details = $null) $script:failed = [pscustomobject]@{ kind=$kind; error=$msg }; throw 'goto-navigation-failed' }
  try { . $block } catch {
    Assert-True ($_.Exception.Message -in @('goto-navigation-emitted', 'goto-navigation-failed')) `
      "Navigationsbaum-Weg warf unerwartet: $($_.Exception.Message)"
  }
  [pscustomobject]@{
    clicks=@($script:clicks); waits=@($script:waits); probes=@($script:probes); liveReads=@($script:liveReads)
    walks=$script:walks; emitted=$script:emitted; failed=$script:failed; start=$start; tree=$ts; weg=@($weg)
  }
}

# 1. Sichtbarer Eintrag, Klick erreicht das Ziel: ein Klick, labelnaher Punkt,
#    gebunden an den unmittelbar zuvor frisch gelesenen Eintrag.
$reached = Invoke-NavigationBlock 'Zielseite' '' 'Zielseite' @()
Assert-True ($reached.clicks.Count -eq 1 -and $reached.clicks[0].count -eq 1) 'Der Baumweg klickte nicht genau einmal einfach.'
Assert-True ($reached.clicks[0].x -eq 74 -and $reached.clicks[0].y -eq 249 -and $reached.clicks[0].w -eq 2 -and $reached.clicks[0].h -eq 2) `
  "Der Baumweg klickte nicht den labelnahen Punkt: $($reached.clicks[0] | ConvertTo-Json -Compress)"
Assert-True ($reached.clicks[0].window -eq 4242) 'Der Baumweg klickte nicht im gebundenen Fenster.'
Assert-True ($reached.liveReads.Count -eq 1 -and $reached.liveReads[0].rid -ceq '7.2' -and $reached.liveReads[0].window -eq 4242) `
  "Der Eintrag wurde vor dem Klick nicht frisch gelesen: $($reached.liveReads | ConvertTo-Json -Compress)"
Assert-True ($reached.clicks[0].rid -ceq '7.2') `
  "Der Baumklick ist nicht an die RuntimeId des Eintrags gebunden: '$($reached.clicks[0].rid)'"
Assert-True ($reached.waits.Count -eq 1 -and $reached.waits[0].vorher -ceq 'Startseite' -and
             $reached.waits[0].erwartet -ceq 'Zielseite' -and $reached.waits[0].timeoutMs -eq 4000) `
  "Der Baumweg wartet nicht begrenzt auf den Seitenwechsel: $($reached.waits | ConvertTo-Json -Compress)"
Assert-True ($reached.emitted.ok -eq $true -and $reached.emitted.erreicht -eq $true -and
             $reached.emitted.ueberschrift -ceq 'Zielseite' -and $reached.emitted.richtung -ceq 'Navigationsbaum' -and
             $reached.emitted.schritte -eq 1 -and $reached.emitted.fokusfrei -eq $false) `
  "Der Baumweg meldete keinen eindeutigen Erfolg: $($reached.emitted | ConvertTo-Json -Compress)"
Assert-True ((@($reached.emitted.weg) -join ' | ') -ceq "Startseite | Navigationsbaum 'Zielseite' -> 'Zielseite'") `
  "Der Baumweg meldete einen unvollstaendigen Weg: $(@($reached.emitted.weg) -join ' | ')"

# 2. Versteckter Desktop: kein physischer Klick, die Suche bleibt zustaendig.
$hidden = Invoke-NavigationBlock 'Zielseite' 'sse-hidden' 'Zielseite' @()
Assert-True ($hidden.clicks.Count -eq 0 -and $hidden.liveReads.Count -eq 0 -and $null -eq $hidden.emitted -and $null -eq $hidden.failed) `
  'Auf dem versteckten Desktop wurde der Navigationsbaum gelesen oder geklickt.'
Assert-True ($hidden.start -ceq 'Startseite' -and $hidden.tree -eq $navTree) 'Der versteckte Desktop veraenderte den Suchvorlauf.'

# 3. Uebermittlungsweg und 4. nicht sichtbarer Name: nie klicken.
$transmission = Invoke-NavigationBlock 'Anmeldungen versenden' '' 'Anmeldungen versenden' @()
Assert-True ($transmission.clicks.Count -eq 0 -and $transmission.liveReads.Count -eq 0 -and $null -eq $transmission.emitted) `
  'Ein Uebermittlungsweg wurde im Baum gebunden oder geklickt.'
$absent = Invoke-NavigationBlock 'Nicht im Baum' '' 'Nicht im Baum' @()
Assert-True ($absent.clicks.Count -eq 0 -and $absent.liveReads.Count -eq 0 -and $null -eq $absent.emitted -and $absent.waits.Count -eq 0) `
  'Ein nicht sichtbarer Name loeste einen Baumklick aus.'

# 5. Der Klick fuehrt auf eine andere Seite: kein Erfolg, neuer Startpunkt,
#    frischer Vorlauf fuer die Suche.
$elsewhere = Invoke-NavigationBlock 'Zielseite' '' 'Andere Seite' @()
Assert-True ($null -eq $elsewhere.emitted -and $null -eq $elsewhere.failed) 'Eine falsche Seite wurde als Erfolg gemeldet.'
Assert-True ($elsewhere.start -ceq 'Andere Seite' -and $elsewhere.walks -eq 1 -and $elsewhere.tree -eq $rewalkedTree) `
  'Nach einem Seitenwechsel auf eine andere Seite startet die Suche nicht frisch von dort.'
Assert-True ((@($elsewhere.weg) -join ' | ') -ceq "Startseite | Navigationsbaum 'Zielseite' -> 'Andere Seite'") `
  'Der Weg verschweigt den wirkungslosen Baumklick.'

# 6. Keine Wirkung und ein Pruefhinweis: sofort stoppen, nicht weitersuchen.
$warning = [pscustomobject]@{ hwnd=[int64]777; pid=3131; title="Die Pr$([char]0x00FC)fung hat ergeben, dass ..." }
$blocked = Invoke-NavigationBlock 'Zielseite' '' 'Startseite' @($warning)
Assert-True ($blocked.failed.kind -ceq 'warning-dialog' -and $null -eq $blocked.emitted) `
  'Ein Pruefhinweis nach dem Baumklick wurde nicht als warning-dialog gemeldet.'

# 7. Keine Wirkung ohne Pruefhinweis: goto endet, statt mit der Suche eine
#    zweite Navigation zu starten, die einen spaeten Wechsel ueberholen koennte.
$unchanged = Invoke-NavigationBlock 'Zielseite' '' 'Startseite' @()
Assert-True ($unchanged.failed.kind -ceq 'navigation-blocked' -and $null -eq $unchanged.emitted -and $unchanged.walks -eq 0) `
  "Ein wirkungsloser Baumklick endete nicht als navigation-blocked: $($unchanged.failed | ConvertTo-Json -Compress)"
Assert-True ($unchanged.clicks.Count -eq 1 -and $unchanged.start -ceq 'Startseite') `
  'Ein wirkungsloser Baumklick wurde wiederholt oder veraenderte den Startpunkt.'

# 8. Ein eigenes SSE-Fenster verdeckt den Punkt: kein Klick, Suche wie bisher.
$covered = Invoke-NavigationBlock 'Zielseite' '' 'Zielseite' @() 'other-sse-window'
Assert-True ($covered.probes.Count -eq 1 -and $covered.probes[0].x -eq 75 -and $covered.probes[0].y -eq 250 -and
             $covered.probes[0].window -eq 4242) `
  "Die Verdeckung wurde nicht am Klickpunkt geprueft: $($covered.probes | ConvertTo-Json -Compress)"
Assert-True ($covered.clicks.Count -eq 0 -and $covered.waits.Count -eq 0 -and $null -eq $covered.emitted -and $null -eq $covered.failed) `
  'Ein von einem SSE-Fenster verdeckter Eintrag wurde trotzdem geklickt.'
Assert-True ($covered.start -ceq 'Startseite' -and $covered.tree -eq $navTree -and
             (@($covered.weg) -join ' | ') -ceq "Startseite | Navigationsbaum 'Zielseite' von einem SSE-Fenster verdeckt") `
  'Ein verdeckter Eintrag veraenderte den Suchvorlauf oder verschwieg den Grund.'

# 9. Ein fremdes Fenster davor hebt der verifizierte Klick selbst an; der Weg bleibt.
$foreign = Invoke-NavigationBlock 'Zielseite' '' 'Zielseite' @() 'foreign-app'
Assert-True ($foreign.clicks.Count -eq 1 -and $foreign.emitted.richtung -ceq 'Navigationsbaum') `
  'Ein fremdes Fenster vor SSE verhinderte den Baumweg.'

# 10. Der Eintrag ist seit dem Baumlauf verrutscht: Verdeckung und Klick
#     nehmen den labelnahen Punkt des frischen Rechtecks.
$moved = Invoke-NavigationBlock 'Zielseite' '' 'Zielseite' @() -Fresh (FreshTarget @{ x=40; y=300; w=300; h=40 })
Assert-True ($moved.probes.Count -eq 1 -and $moved.probes[0].x -eq 90 -and $moved.probes[0].y -eq 320) `
  "Die Verdeckung wurde nicht am frischen Punkt geprueft: $($moved.probes | ConvertTo-Json -Compress)"
Assert-True ($moved.clicks.Count -eq 1 -and $moved.clicks[0].x -eq 89 -and $moved.clicks[0].y -eq 319 -and
             $moved.clicks[0].rid -ceq '7.2' -and $moved.emitted.richtung -ceq 'Navigationsbaum') `
  "Der Baumklick nahm nicht den Punkt des frischen Rechtecks: $($moved.clicks | ConvertTo-Json -Compress)"

# 11. Der Eintrag hat sich seit dem Baumlauf veraendert oder ist weg: kein
#     Klick, kein Warten, die Suche bleibt zustaendig und der Weg nennt den Grund.
$changedEntries = [ordered]@{
  'umbenannt'          = (FreshTarget @{ name='Zielseite (alt)' })
  'anderer Typ'        = (FreshTarget @{ type='ListItem' })
  'andere RuntimeId'   = (FreshTarget @{ rid='7.99' })
  'nicht aktivierbar'  = (FreshTarget @{ on=$false })
  'nicht mehr lesbar'  = $null
}
foreach ($case in $changedEntries.GetEnumerator()) {
  $changed = Invoke-NavigationBlock 'Zielseite' '' 'Zielseite' @() -Fresh $case.Value
  Assert-True ($changed.liveReads.Count -eq 1 -and $changed.liveReads[0].rid -ceq '7.2') `
    "Fall '$($case.Key)': der Eintrag wurde nicht genau einmal frisch gelesen."
  Assert-True ($changed.clicks.Count -eq 0 -and $changed.probes.Count -eq 0 -and $changed.waits.Count -eq 0 -and
               $null -eq $changed.emitted -and $null -eq $changed.failed) `
    "Fall '$($case.Key)': ein veraenderter Eintrag wurde trotzdem geklickt oder beendete goto."
  Assert-True ($changed.start -ceq 'Startseite' -and $changed.tree -eq $navTree -and
               (@($changed.weg) -join ' | ') -ceq "Startseite | Navigationsbaum 'Zielseite' vor dem Klick veraendert") `
    "Fall '$($case.Key)': der Suchvorlauf wurde veraendert oder der Grund verschwiegen: $(@($changed.weg) -join ' | ')"
}

# 12. Endet goto danach ueber einen Suchtreffer, nennt der Weg den
#     vorherigen Baumversuch weiterhin.
$searchEmits = @($gotoBody.FindAll({
  param($node)
  $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -ceq 'Emit' -and
  $node.Extent.Text -match "richtung = 'Suche';"
}, $true))
Assert-True ($searchEmits.Count -eq 1 -and
             $searchEmits[0].Extent.Text.Contains('weg = @(@($weg | Select-Object -Skip 1) + @($suchWeg))')) `
  'Der Erfolg ueber einen Suchtreffer verschweigt einen vorherigen Navigationsbaum-Versuch.'

Write-Output 'goto-Navigationsbaum: alle Vertraege bestanden'

# Ein Name kann in einem abgeschnittenen Baum nur scheinbar eindeutig sein.
$navTree.stats.truncated = $true
$incompleteTree = Invoke-NavigationBlock 'Zielseite' '' 'Zielseite' @()
Assert-True ($incompleteTree.clicks.Count -eq 0 -and $incompleteTree.liveReads.Count -eq 0 -and
  $incompleteTree.waits.Count -eq 0 -and $null -eq $incompleteTree.emitted) 'Ein abgeschnittener Navigationsbaum loeste einen Klick aus.'
$navTree.stats.truncated = $false
$navTree.stats.err = 1
$failedTree = Invoke-NavigationBlock 'Zielseite' '' 'Zielseite' @()
Assert-True ($failedTree.clicks.Count -eq 0 -and $failedTree.liveReads.Count -eq 0) 'Ein fehlerhafter Navigationsbaum loeste einen Klick aus.'
$navTree.stats.err = 0
