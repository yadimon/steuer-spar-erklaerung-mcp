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
if ($workerSource -notmatch [regex]::Escape('$ok = DrueckeKnopf $hwnd $richtung '''' $vorher')) {
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
$navigationLoops = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.ForEachStatementAst] -and
  $node.Variable.VariablePath.UserPath -eq 'richtung' -and
  $node.Extent.Text.Contains('$stillstand')
}, $true))
if ($navigationLoops.Count -ne 1) { throw 'Blaetterschleife nicht eindeutig vorhanden.' }
$navigationLoop = [scriptblock]::Create($navigationLoops[0].Extent.Text)

function Assert-DelayedNavigationStops([string[]]$Headings, [int]$ExpectedClicks) {
  $script:gotoHeadings = New-Object 'System.Collections.Generic.Queue[string]'
  foreach ($heading in $Headings) { $script:gotoHeadings.Enqueue($heading) }
  $script:gotoClicks = 0
  $script:gotoResult = $null
  $ziel = 'Zielseite'; $pageId = ''; $hwnd = [IntPtr]::Zero
  $reihenfolge = @('Weiter'); $verbraucht = 0; $maxS = 3
  $weg = New-Object System.Collections.ArrayList
  $besucht = New-Object System.Collections.ArrayList
  function AktuelleUeberschrift { param($h) $script:gotoHeadings.Dequeue() }
  function IstZielseite { param($h, $heading) $heading -eq $ziel }
  function DrueckeKnopf {
    param($h, $name, $aid, $wechselVon)
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

Write-Output 'goto-Wartezeiten: begrenzt; verzoegert erreichte Ziele werden vor weiterem Invoke bestaetigt - bestanden'
