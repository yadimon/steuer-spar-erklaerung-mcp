# Wird ein Schreibvorgang von einem SSE-eigenen Nebenfenster verdeckt, muss die
# Meldung das Fenster benennen und den Ausweg zeigen.
#
# Der Fall ist nicht exotisch: Auf der Spendenseite oeffnet SteuerSparErklaerung
# das Fenster 'Steuer-Spar-Tipps' von selbst, und es liegt ueber den
# Eingabefeldern. Der Schreibpfad klickt dann bewusst nicht - richtig so -, aber
# ohne Namen im Fehlertext muss der Aufrufer erst sse_windows und sse_ui_state
# nachschieben, um zu erkennen, dass ihm ein mit einem Aufruf schliessbares
# Fenster im Weg stand.
#
# Zweiter Punkt: Die Einordnung der Nebenfenster darf nur an EINER Stelle stehen.
# Haette der Schreibpfad eine eigene Kopie der Schwellenwerte, koennte er ein
# Fenster 'steuer-tipps' nennen, das sse_ui_state nicht kennt - oder umgekehrt.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$workerSource = Get-Content -LiteralPath $workerPath -Raw
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

$definition = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Resolve-SSEToolWindowKind'
}, $true))
if ($definition.Count -ne 1) { throw 'Funktion Resolve-SSEToolWindowKind ist nicht eindeutig vorhanden.' }

# Den Titel NICHT hier hinschreiben, sondern aus dem Worker lesen. Eine eigene
# Kopie wuerde die Funktion gegen einen Wert pruefen, den das Produkt gar nicht
# mehr verwendet - der Vertrag waere gruen und die Einordnung trotzdem kaputt.
$titelZuweisung = [regex]::Match($workerSource, "(?m)^\`$script:WERTE_INFO_TITEL\s*=\s*'(?<titel>[^']+)'")
if (-not $titelZuweisung.Success) { throw 'Die Zuweisung von $script:WERTE_INFO_TITEL ist im Worker nicht auffindbar.' }
$script:WERTE_INFO_TITEL = $titelZuweisung.Groups['titel'].Value
Invoke-Expression $definition[0].Extent.Text

function Assert-Equal($Actual, $Expected, [string]$Message) {
  if ("$Actual" -cne "$Expected") { throw "$Message - erwartet '$Expected', erhalten '$Actual'" }
}

# Die beiden katalogisierten Nebenfenster werden erkannt.
Assert-Equal (Resolve-SSEToolWindowKind 'Steuer-Spar-Tipps' 479 333) 'steuer-tipps' 'Tipps-Fenster wird nicht erkannt'
Assert-Equal (Resolve-SSEToolWindowKind $script:WERTE_INFO_TITEL 800 600) 'werte-info' 'Werte-Info wird nicht erkannt'

# Knapp daneben ist nicht erkannt: Ein Fenster mit demselben Titel, aber weit
# groesser, ist etwas anderes und darf nicht als bekanntes Nebenfenster gelten.
Assert-Equal (Resolve-SSEToolWindowKind 'Steuer-Spar-Tipps' 900 333) '' 'Zu breites Tipps-Fenster gilt faelschlich als bekannt'
Assert-Equal (Resolve-SSEToolWindowKind 'Steuer-Spar-Tipps' 479 700) '' 'Zu hohes Tipps-Fenster gilt faelschlich als bekannt'
Assert-Equal (Resolve-SSEToolWindowKind 'Steuer-Spar-Tipps ' 479 333) '' 'Titelvergleich ist nicht exakt'
Assert-Equal (Resolve-SSEToolWindowKind 'Irgendein Fenster' 479 333) '' 'Fremder Titel gilt faelschlich als bekannt'
Assert-Equal (Resolve-SSEToolWindowKind '' 0 0) '' 'Leerer Titel gilt faelschlich als bekannt'

# Die Sperrstelle muss alles mitliefern, was sse_window_close verlangt: Titel,
# Art und den Fingerprint. Ohne den Fingerprint braeuchte der Aufrufer doch
# wieder einen sse_windows-Aufruf - genau den soll die Meldung ersparen.
foreach ($feld in @(
  'hitTitle=$hitTitle; hitTitleFingerprint=$hitTitleFingerprint; hitWindowKind=$hitWindowKind',
  '$hitTitleFingerprint = Get-SSETextSha256 $hitTitle'
)) {
  if ($workerSource -notmatch [regex]::Escape($feld)) {
    throw "Der Verdeckungsbefund liefert '$feld' nicht mit."
  }
}
if ($workerSource -notmatch [regex]::Escape('$hitWindowKind = Resolve-SSEToolWindowKind $hitTitle')) {
  throw 'Die Sperrstelle ordnet das verdeckende Fenster nicht ueber den gemeinsamen Helfer ein.'
}

# Die Meldung nennt Fenster und Ausweg.
if ($workerSource -notmatch 'Das SSE-eigene Fenster') {
  throw 'Die Verdeckungsmeldung benennt das Fenster nicht.'
}
if ($workerSource -notmatch [regex]::Escape('Danach den Schreibvorgang wiederholen')) {
  throw 'Die Verdeckungsmeldung nennt den Ausweg ueber sse_window_close nicht.'
}

# Der Ausweg muss auf das Fenster der obersten Ebene zeigen. WindowFromPoint
# liefert das unterste Kind unter dem Punkt; sse_window_close nimmt nur, was
# sse_windows auflistet - und das sind Hauptfenster. Ein Verweis auf hitWindow
# waere eine Anleitung, die im Zweifel nicht funktioniert.
if ($workerSource -notmatch [regex]::Escape('hwnd=commitDetails.hitRoot')) {
  throw 'Die Verdeckungsmeldung nennt nicht hitRoot als zu schliessendes Fenster.'
}
if ($workerSource -match [regex]::Escape('hwnd aus commitDetails.hitWindow')) {
  throw 'Die Verdeckungsmeldung verweist weiterhin auf hitWindow statt auf hitRoot.'
}
if ($workerSource -notmatch [regex]::Escape('titleFingerprint=commitDetails.hitTitleFingerprint')) {
  throw 'Die Verdeckungsmeldung nennt den fuer sse_window_close noetigen Fingerprint nicht.'
}

# sse_ui_state benutzt denselben Helfer - keine zweite Kopie der Schwellenwerte.
if ($workerSource -notmatch [regex]::Escape('$art = Resolve-SSEToolWindowKind $w.title')) {
  throw 'sse_ui_state ordnet die Nebenfenster nicht ueber den gemeinsamen Helfer ein.'
}
# Genauer: Titel UND Groessenschwellen duerfen nur einmal gemeinsam auftreten.
# Die Schwellen 850/650 kommen anderswo fuer andere Fragen vor - etwa ob ein
# Qt-Fenster ueberhaupt ein Hinweisfenster sein kann - und das ist in Ordnung.
# Verboten ist nur eine zweite Stelle, die daraus wieder eine Fensterart macht.
$paarung = ([regex]::Matches($workerSource, [regex]::Escape("-eq 'Steuer-Spar-Tipps' -and"))).Count
if ($paarung -ne 1) {
  throw "Titel und Groessenschwellen des Tipps-Fensters stehen an $paarung Stellen zusammen; sie gehoeren ausschliesslich in Resolve-SSEToolWindowKind."
}

Write-Output 'Verdeckende Nebenfenster: Erkennung, Meldung und gemeinsame Einordnung bestanden'
