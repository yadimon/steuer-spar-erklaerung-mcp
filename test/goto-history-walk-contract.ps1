# Blaetterweg von `goto`: 'Weiter' folgt dem Blaetterpfad, 'Zurück' dem
# Seitenverlauf der Sitzung.
#
# Belegt ist: Nach einem Sprung von der Startseite auf 'Bürobedarf' fuehrt
# 'Zurück' zur Startseite, nicht zum Vorgaenger im Pfad; nach einer Folge von
# 'Weiter'-Schritten faehrt 'Zurück' denselben Weg zurueck; 'Weiter' fuehrt
# danach wieder in den Pfad. Die Startseite hat weder 'Weiter' noch 'Zurück',
# und am Anfang des Verlaufs ist nur der Verlaufspfeil 'vor' aktiv.
#
# Dieser Vertrag haelt fest:
#   1. Automatisch gibt es genau eine Richtung. Ein Ziel davor erreicht nur
#      ein gepruefter Rueckweg; die erste Landung neben dem Pfad beendet ihn
#      nach diesem einen Klick und nennt, wo SSE jetzt steht.
#   2. 'Weiter' erreicht ein Ziel dahinter ueber unbekannte und wiederkehrende
#      Zwischenseiten; ein uebersprungenes Ziel beendet den Weg sofort.
#   3. Eine Seite ohne Blaetterschalter endet als 'dead-end'; der
#      Verlaufspfeil wird nie gedrueckt.
#   4. Ein wiederholter Uebergang innerhalb desselben nummerierten Eintrags
#      endet als 'no-progress'; gleiche Unterseiten anderer Eintraege laufen.
#   5. Das Budget ist Abstand plus Reserve, ohne feste Untergrenze; maxSteps
#      begrenzt es nur.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
. (Join-Path $root 'powershell\goto-route.ps1')
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$null, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$order = Get-SSEPagingOrder 2025
$UStE = 'Umsatzsteuererklärung 2025'
$UStVA = 'Umsatzsteuer-Voranmeldungen 2025'
$startseite = 'Gewinnermittlung für das Jahr 2025'
$paragraph13b = 'Innergem. Erwerb, § 13b UStG und Einfuhr'

# --- Reihenfolge ---------------------------------------------------------------
Assert-True ($order.Count -eq 66 -and @($order | Select-Object -Unique).Count -eq 66) `
  'Die Blaetterfolge ist nicht mehr die eindeutige Liste der kartierten Seiten.'
Assert-True ([array]::IndexOf($order, $UStE) -eq 49 -and [array]::IndexOf($order, $UStVA) -eq 62 -and
             [array]::IndexOf($order, 'Bürobedarf') -eq 34) 'Die Jahresseiten stehen nicht an ihrer Stelle im Pfad.'
Assert-True (@(Get-SSERepeatedPagingTitles | Where-Object { $_ -cin $order }).Count -eq @(Get-SSERepeatedPagingTitles).Count) `
  'Eine wiederkehrende Unterseite fehlt in der Blaetterfolge.'

# --- Wegplanung -----------------------------------------------------------------
function Route([string]$Start, [string]$Target, [string]$Direction = '', $MaxSteps = $null) {
  Get-SSEGotoRoute -Order $order -Start $Start -Target $Target -Direction $Direction -MaxSteps $MaxSteps
}
$plans = @(
  [pscustomobject]@{ name='Ziel dahinter'; route=(Route 'Bürobedarf' $UStE); direction='Weiter'; checkedBack=$false; budget=35 }
  [pscustomobject]@{ name='Ziel davor'; route=(Route $UStVA $UStE); direction='Zurück'; checkedBack=$true; budget=33 }
  [pscustomobject]@{ name='Start unbekannt'; route=(Route $startseite 'Bürobedarf'); direction='Weiter'; checkedBack=$false; budget=55 }
  [pscustomobject]@{ name='Ziel unbekannt'; route=(Route 'Bürobedarf' 'Sonstige Kfz-Kosten: Passat'); direction='Weiter'; checkedBack=$false; budget=51 }
  [pscustomobject]@{ name='beide unbekannt'; route=(Route $startseite 'Sonstige Kfz-Kosten: Passat'); direction='Weiter'; checkedBack=$false; budget=86 }
  [pscustomobject]@{ name='vorgegebenes Zurück'; route=(Route $UStVA $UStE 'Zurück'); direction='Zurück'; checkedBack=$false; budget=33 }
  [pscustomobject]@{ name='vorgegebenes Weiter'; route=(Route $UStVA $UStE 'Weiter'); direction='Weiter'; checkedBack=$false; budget=33 }
  [pscustomobject]@{ name='maxSteps begrenzt'; route=(Route 'Bürobedarf' $UStE '' 5); direction='Weiter'; checkedBack=$false; budget=5 }
  [pscustomobject]@{ name='maxSteps ist keine Untergrenze'; route=(Route 'Bürobedarf' $UStE '' 200); direction='Weiter'; checkedBack=$false; budget=35 }
  [pscustomobject]@{ name='Start ist Zielindex'; route=(Route $UStVA $UStVA); direction='Weiter'; checkedBack=$false; budget=0 }
)
foreach ($plan in $plans) {
  Assert-True ($plan.route.direction -ceq $plan.direction -and $plan.route.checkedBack -eq $plan.checkedBack -and
               $plan.route.budget -eq $plan.budget) `
    "Wegplanung '$($plan.name)': $($plan.route | ConvertTo-Json -Compress)"
}

# --- Echte Blaetterschleife mit Uebergangstabellen ------------------------------
$gotoClauses = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.SwitchStatementAst] -and
  @($node.Clauses | Where-Object { $_.Item1.Extent.Text -ceq "'goto'" }).Count -eq 1
}, $true))
Assert-True ($gotoClauses.Count -eq 1) 'Der goto-Zweig ist nicht eindeutig vorhanden.'
$gotoStatements = @(@($gotoClauses[0].Clauses | Where-Object { $_.Item1.Extent.Text -ceq "'goto'" })[0].Item2.Statements)
$texts = @($gotoStatements | ForEach-Object { $_.Extent.Text })
$routeIndex = [array]::IndexOf($texts,
  '$route = Get-SSEGotoRoute -Order $FOLGE -Start $start -Target $ziel -Direction $richtungVorgegeben -MaxSteps $requestedMaxSteps')
$loopIndex = @(0..($gotoStatements.Count - 1) | Where-Object {
  $gotoStatements[$_] -is [Management.Automation.Language.WhileStatementAst] -and
  $gotoStatements[$_].Condition.Extent.Text -ceq '$verbraucht -lt $route.budget'
})
Assert-True ($routeIndex -ge 0 -and $loopIndex.Count -eq 1 -and $loopIndex[0] -gt $routeIndex) `
  'Wegplanung und Blaetterschleife stehen nicht als zusammenhaengender Abschnitt im goto-Zweig.'
$walk = [scriptblock]::Create(($texts[$routeIndex..$loopIndex[0]]) -join "`n")

function Invoke-Walk {
  param([string]$Start, [string]$Target, [hashtable]$Transitions, [string]$Direction = '', $MaxSteps = $null,
    [hashtable]$StateHeadings = @{})
  $script:page = $Start
  $script:transitions = $Transitions
  $script:stateHeadings = @{}
  foreach ($key in $Transitions.Keys) {
    $source = $key.Substring(0,$key.LastIndexOf('|'))
    $script:stateHeadings[$source] = $source
    $script:stateHeadings[[string]$Transitions[$key]] = [string]$Transitions[$key]
  }
  $script:stateHeadings[$Start] = $Start
  foreach ($stateId in $StateHeadings.Keys) { $script:stateHeadings[$stateId] = $StateHeadings[$stateId] }
  $script:presses = New-Object System.Collections.ArrayList
  $script:emitted = $null
  $script:failed = $null
  $FOLGE = $order
  $start = [string]$script:stateHeadings[$Start]; $ziel = $Target; $richtungVorgegeben = $Direction; $requestedMaxSteps = $MaxSteps
  $hwnd = [IntPtr]4242; $gotoPid = 3131; $pageId = ''; $verbraucht = 0
  $weg = New-Object System.Collections.ArrayList
  $null = $weg.Add($start)
  $besucht = New-Object System.Collections.ArrayList
  function AktuelleUeberschrift { param([IntPtr]$h) $script:stateHeadings[$script:page] }
  function IstZielseite { param([IntPtr]$h, [string]$heading) [bool]($heading -ceq $ziel) }
  function DrueckeKnopf {
    param([IntPtr]$h, [string]$name, [string]$wechselVon = '')
    $key = "$($script:page)|$name"
    $exists = $script:transitions.ContainsKey($key)
    $null = $script:presses.Add([pscustomobject]@{ from=$script:stateHeadings[$script:page]; stateId=$script:page; button=$name; pressed=$exists })
    $script:page = @($script:page, $script:transitions[$key])[[int]$exists]
    $exists
  }
  function AktiverBlaetterknopf {
    param([IntPtr]$h, [string]$name)
    @($null, [pscustomobject]@{ name=$name })[[int]$script:transitions.ContainsKey("$($script:page)|$name")]
  }
  function Get-Windows { param([string]$Filter) @() }
  function Emit { param($result) $script:emitted = $result; throw 'goto-walk-emitted' }
  function Fail { param($msg, $kind = 'error', $details = $null) $script:failed = [pscustomobject]@{ kind=$kind; error=$msg }; throw 'goto-walk-failed' }
  try { . $walk } catch {
    Assert-True ($_.Exception.Message -in @('goto-walk-emitted', 'goto-walk-failed')) "Blaetterweg warf unerwartet: $($_.Exception.Message)"
  }
  $pressed = @($script:presses | Where-Object { $_.pressed })
  [pscustomobject]@{
    emitted=$script:emitted; failed=$script:failed; page=$script:stateHeadings[$script:page]; stateId=$script:page; weg=@($weg)
    presses=@($script:presses); clicks=$pressed.Count; buttons=@($script:presses | ForEach-Object { $_.button } | Select-Object -Unique)
  }
}
# Der Pfad laut Blaetterfolge, je Seite ein 'Weiter'.
function PathTransitions([int]$From, [int]$To) {
  $table = @{}
  foreach ($index in $From..($To - 1)) { $table["$($order[$index])|Weiter"] = $order[$index + 1] }
  $table
}

# 1. Rueckweg ueber den Verlauf auf die Startseite (navtop, erste Runde): ein
#    Klick, dann Schluss - kein Wechsel auf 'Weiter', kein Verlaufspfeil.
$navtop0 = Invoke-Walk $UStVA $UStE @{ "$UStVA|Zurück" = $startseite; "$UStVA|Weiter" = 'Weitere Erlöse zu 19%' }
Assert-True ($navtop0.failed.kind -ceq 'not-found' -and $navtop0.clicks -eq 1 -and $navtop0.page -ceq $startseite) `
  "Rueckweg in den Verlauf endete nicht nach einem Klick: $($navtop0 | ConvertTo-Json -Depth 4 -Compress)"
Assert-True ($navtop0.failed.error.Contains("statt auf 'Meldepflichtige oder nicht steuerbare Umsätze'") -and
             $navtop0.failed.error.Contains("SSE steht jetzt auf '$startseite'") -and
             $navtop0.failed.error.Contains('Seitenverlauf, nicht dem Blaetterpfad')) `
  "Die Meldung nennt erwartete Seite, Landung und Grund nicht: $($navtop0.failed.error)"
Assert-True ((@($navtop0.buttons) -join ',') -ceq 'Zurück') 'Nach dem Fehlschritt wurde eine andere Richtung versucht.'

# 2. Verlauf weicht vom Pfad ab (nav-visibility) und 3. Altfall Reisekosten.
foreach ($case in @(
  [pscustomobject]@{ name='Vorsteuerberichtigung -> UStE'; start='Vorsteuerberichtigungen 2025'; target=$UStE; landing=$UStVA; expected='Vorsteuer aus anderen Rechnungen' }
  [pscustomobject]@{ name='Vorsteuerberichtigung -> falsche Vorsteuerseite'; start='Vorsteuerberichtigungen 2025'; target=$UStE; landing='Abziehbare Vorsteuer'; expected='Vorsteuer aus anderen Rechnungen' }
  [pscustomobject]@{ name='Voranmeldung -> fremder Vorsteuer-Verlauf'; start=$UStVA; target=$UStE; landing='Vorsteuer aus anderen Rechnungen'; expected='Meldepflichtige oder nicht steuerbare Umsätze' }
  [pscustomobject]@{ name='1. Reise -> Reisekosten'; start='1. Reise'; target='Reisekosten'; landing='Telefon/Mobilfunk/Internet'; expected='Reisekosten' }
)) {
  $result = Invoke-Walk $case.start $case.target @{ "$($case.start)|Zurück" = $case.landing }
  Assert-True ($result.failed.kind -ceq 'not-found' -and $result.clicks -eq 1 -and
               $result.failed.error.Contains("statt auf '$($case.expected)'") -and
               $result.failed.error.Contains("SSE steht jetzt auf '$($case.landing)'")) `
    "Fall '$($case.name)': kein Abbruch nach dem ersten Klick neben dem Pfad: $($result.failed | ConvertTo-Json -Compress)"
}

# 4. Der Verlauf fuehrt direkt aufs Ziel (navtop, zweite Runde): ein Klick.
$navtop1 = Invoke-Walk $UStVA $UStE @{ "$UStVA|Zurück" = $UStE }
Assert-True ($navtop1.emitted.erreicht -eq $true -and $navtop1.emitted.ueberschrift -ceq $UStE -and $navtop1.clicks -eq 1) `
  "Ein Ziel, das der Verlauf direkt erreicht, wurde nicht mit einem Klick erreicht: $($navtop1 | ConvertTo-Json -Depth 4 -Compress)"

# 5. Rueckweg ueber die wiederkehrende §-13b-Unterseite nach einem
#    'Weiter'-Lauf (gemessen: Bürobedarf -> §-13b-Unterseite -> Fachliteratur).
$retrace = Invoke-Walk 'Fortbildungskosten' 'Bürobedarf' @{
  'Fortbildungskosten|Zurück' = 'Fachliteratur'; 'Fachliteratur|Zurück' = $paragraph13b; "$paragraph13b|Zurück" = 'Bürobedarf'
}
Assert-True ($retrace.emitted.erreicht -eq $true -and $retrace.clicks -eq 3) `
  "Der Rueckweg ueber die wiederkehrende Unterseite wurde abgebrochen: $($retrace | ConvertTo-Json -Depth 4 -Compress)"

# 6. 'Weiter' zum Ziel dahinter: genau ein Klick je Zwischenseite, auch ueber
#    die wiederkehrende Unterseite, deren Titel weiter vorn im Pfad steht.
$forwardTable = PathTransitions 34 49
$forwardTable.Remove('Bürobedarf|Weiter')
$forwardTable['Bürobedarf|Weiter'] = $paragraph13b
$forwardTable["$paragraph13b|Weiter"] = 'Fachliteratur'
$forward = Invoke-Walk 'Bürobedarf' $UStE $forwardTable
Assert-True ($forward.emitted.erreicht -eq $true -and $forward.clicks -eq 16 -and (@($forward.buttons) -join ',') -ceq 'Weiter') `
  "'Weiter' erreichte das Ziel dahinter nicht mit einem Klick je Zwischenseite: $($forward.clicks) Klicks, $($forward.failed.error)"

# 7. Uebersprungenes Ziel: sofort Schluss.
$overshoot = Invoke-Walk 'Bürobedarf' 'Fachliteratur' @{ 'Bürobedarf|Weiter' = 'Fortbildungskosten' }
Assert-True ($overshoot.failed.kind -ceq 'not-found' -and $overshoot.clicks -eq 1 -and
             $overshoot.failed.error.Contains("hinter 'Fachliteratur'") -and $overshoot.failed.error.Contains("SSE steht jetzt auf 'Fortbildungskosten'")) `
  "Ein uebersprungenes Ziel beendete den Weg nicht sofort: $($overshoot.failed | ConvertTo-Json -Compress)"

# 8. Sackgasse Startseite: weder 'Weiter' noch 'Zurück' - kein Klick, kein
#    Verlaufspfeil, 'dead-end' mit Seitennamen.
$deadEnd = Invoke-Walk $startseite 'Bürobedarf' @{}
Assert-True ($deadEnd.failed.kind -ceq 'dead-end' -and $deadEnd.clicks -eq 0 -and
             $deadEnd.failed.error.Contains("'$startseite' hat weder 'Weiter' noch 'Zurück'")) `
  "Die Startseite endete nicht als dead-end: $($deadEnd.failed | ConvertTo-Json -Compress)"
Assert-True ((@($deadEnd.buttons) -join ',') -ceq 'Weiter') 'An der Sackgasse wurde mehr als der geplante Schalter versucht.'

# 9. Pfadende: 'Weiter' fehlt, 'Zurück' ist da - der Weg endet ohne Richtungswechsel.
$pathEnd = Invoke-Walk 'Steuerschuldnerschaft nach § 13b UStG' 'Sonstige Kfz-Kosten: Passat' @{
  'Steuerschuldnerschaft nach § 13b UStG|Zurück' = 'Weitere Umsätze'
}
Assert-True ($null -eq $pathEnd.failed -and $null -eq $pathEnd.emitted -and $pathEnd.clicks -eq 0 -and
             (@($pathEnd.weg) -join ' | ') -ceq 'Steuerschuldnerschaft nach § 13b UStG | Weiter nicht verfuegbar') `
  "Am Pfadende wurde die Richtung gewechselt oder der Grund verschwiegen: $(@($pathEnd.weg) -join ' | ')"

# 10. Ping-Pong: der erste wiederholte Uebergang beendet den Weg.
$pingPong = Invoke-Walk 'Seite A' 'Sonstige Kfz-Kosten: Passat' @{ 'Seite A|Weiter' = 'Seite B'; 'Seite B|Weiter' = 'Seite A' }
Assert-True ($pingPong.failed.kind -ceq 'no-progress' -and $pingPong.clicks -eq 3 -and
             $pingPong.failed.error.Contains("erneut von 'Seite A' auf 'Seite B'")) `
  "Ein Kreis wurde nicht am wiederholten Uebergang erkannt: $($pingPong.failed | ConvertTo-Json -Compress)"

# Gleich benannte Unterseiten zweier Eintraege sind verschiedene Stationen.
# Die echte Worker-Schleife muss beide vollstaendig durchlaufen, ohne Budget
# oder Kreispruefung zu lockern.
$entryHeadings = @{
  assetA='1. Inventar Alpha'; assetB='2. Inventar Beta'; target='Zielseite'
  costsA='Weitere Kosten zur Anschaffung'; costsB='Weitere Kosten zur Anschaffung'
  withdrawalA='Einlage oder Ausscheiden des Wirtschaftsguts'; withdrawalB='Einlage oder Ausscheiden des Wirtschaftsguts'
  allowanceA='Investitionsabzugsbetrag oder Sonderabschreibung'; allowanceB='Investitionsabzugsbetrag oder Sonderabschreibung'
  lifetimeA='Änderung der Restnutzungsdauer'; lifetimeB='Änderung der Restnutzungsdauer'
}
$entryPages = @{
  'assetA|Weiter'='costsA'; 'costsA|Weiter'='withdrawalA'; 'withdrawalA|Weiter'='allowanceA'
  'allowanceA|Weiter'='lifetimeA'; 'lifetimeA|Weiter'='assetB'
  'assetB|Weiter'='costsB'; 'costsB|Weiter'='withdrawalB'; 'withdrawalB|Weiter'='allowanceB'
  'allowanceB|Weiter'='lifetimeB'; 'lifetimeB|Weiter'='target'
}
$entries = Invoke-Walk 'assetA' 'Zielseite' $entryPages 'Weiter' 12 -StateHeadings $entryHeadings
Assert-True ($entries.emitted.erreicht -eq $true -and $entries.stateId -ceq 'target' -and
  $entries.clicks -eq 10 -and $null -eq $entries.failed) `
  "Unterseiten unterschiedlicher Eintraege wurden als Kreis gewertet: $($entries.failed | ConvertTo-Json -Compress)"

$sameEntryCycle = Invoke-Walk '1. Inventar Alpha' 'Zielseite' @{
  '1. Inventar Alpha|Weiter' = 'Weitere Kosten'
  'Weitere Kosten|Weiter' = 'Einlage'
  'Einlage|Weiter' = 'Weitere Kosten'
} 'Weiter' 12
Assert-True ($sameEntryCycle.failed.kind -ceq 'no-progress' -and $sameEntryCycle.clicks -eq 4) `
  'Ein Kreis innerhalb desselben Eintrags wurde nicht am ersten wiederholten Uebergang beendet.'

$returnedEntryCycle = Invoke-Walk 'assetA' 'Zielseite' @{
  'assetA|Weiter'='costsA'; 'costsA|Weiter'='withdrawalA'; 'withdrawalA|Weiter'='assetB'
  'assetB|Weiter'='costsB'; 'costsB|Weiter'='withdrawalB'; 'withdrawalB|Weiter'='assetA'
} 'Weiter' 12 -StateHeadings $entryHeadings
Assert-True ($returnedEntryCycle.failed.kind -ceq 'no-progress' -and $returnedEntryCycle.clicks -eq 7) `
  'Die Rueckkehr zu einem frueheren Eintrag hat dessen bereits besuchte Uebergaenge vergessen.'

Assert-True ((Get-SSEGotoEntryContext '1. Inventar Alpha') -cne (Get-SSEGotoEntryContext '1. Reise Beta')) `
  'Gleiche Nummern verschiedener Listen wurden als derselbe Eintrag behandelt.'

# 11. Budget ohne Untergrenze: Bürobedarf -> UStE ueber lauter unbekannte Seiten
#     endet nach 35 Klicks, nicht nach 90.
$unknownTable = @{ 'Bürobedarf|Weiter' = 'Unbekannt 1' }
foreach ($index in 1..60) { $unknownTable["Unbekannt $index|Weiter"] = "Unbekannt $($index + 1)" }
$budgeted = Invoke-Walk 'Bürobedarf' $UStE $unknownTable
Assert-True ($budgeted.clicks -eq 35 -and $null -eq $budgeted.failed -and $null -eq $budgeted.emitted) `
  "Das Budget ist nicht Abstand plus Reserve: $($budgeted.clicks) Klicks."

# 12. Vorgegebenes 'Zurück' bleibt Wahl des Aufrufers und folgt dem Verlauf.
$explicitBack = Invoke-Walk $UStVA 'Bürobedarf' @{ "$UStVA|Zurück" = 'Bürobedarf' } 'Zurück'
Assert-True ($explicitBack.emitted.erreicht -eq $true -and $explicitBack.clicks -eq 1) `
  'Ein vorgegebenes Zurück wurde gegen den Blaetterpfad geprueft.'

# 13. Der Verlaufspfeil hat im goto-Zweig keinen Ausweg mehr.
$gotoText = (@($gotoClauses[0].Clauses | Where-Object { $_.Item1.Extent.Text -ceq "'goto'" })[0].Item2).Extent.Text
Assert-True (-not $gotoText.Contains('HistoryToolbarBtnSSE')) 'goto drueckt wieder einen Verlaufspfeil.'

Write-Output 'goto-Blaetterweg: eine Richtung, gepruefter Rueckweg, Sackgasse, Kreis und Budget - bestanden'

# Wiederkehrende UStE-/UStVA-Titel bestimmen keine eindeutige Startposition.
foreach ($title in @(Get-SSERepeatedPagingTitles)) {
  $ambiguousRoute = Route $title 'Bürobedarf'
  Assert-True ($ambiguousRoute.startIndex -eq -1 -and -not $ambiguousRoute.checkedBack -and
               $ambiguousRoute.direction -ceq 'Weiter') 'Ein wiederkehrender Titel erzeugt einen geratenen Rueckweg.'
  $landing = Test-SSEGotoLanding -Route $ambiguousRoute -Order $order -Position -1 -From 'Unbekannt' -Landing $title
  Assert-True ($landing.verdict -ceq 'continue' -and $landing.position -eq -1) 'Eine mehrdeutige Landung erzeugt eine falsche Position oder ein Ueberspringen.'
}
