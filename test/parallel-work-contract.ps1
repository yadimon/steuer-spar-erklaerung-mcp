# Schreiben, waehrend der Benutzer weiterarbeitet - und nur dann.
#
# GetLastInputInfo zaehlt jede Eingabe im System, gleichgueltig wohin sie
# geht. Deshalb brach jede Zellschreibung ab, sobald der Benutzer irgendwo
# tippte - auch in einem voellig anderen Fenster, dessen Anschlaege SSE nie
# erreichen. Genau das machte paralleles Arbeiten unmoeglich.
#
# Fuer den Sperrbildschirm war die Ausnahme laengst begruendet: Kann der
# Benutzer SSE nachweislich nicht bedienen, darf eine reine
# ValuePattern-Schreibung nicht am systemweiten Tick scheitern. Dieselbe
# Begruendung traegt fuer ein fremdes Vordergrundfenster.
#
# Vier Eigenschaften duerfen dabei nie verlorengehen:
#
#   1. **Verglichen wird der Prozess, nicht das Fenster.** Ein Dialog derselben
#      SSE-Instanz gehoert zu SSE; dort waere eine Fremdeingabe gefaehrlich.
#   2. **Im Zweifel streng.** Laesst sich der Vordergrund nicht bestimmen,
#      gilt er nicht als fremd und der Schutz bleibt an.
#   3. **Kein Pfad, der den Fokus braucht.** Der Weg zum Tabellenende und jede
#      Auswahlliste verlangen Klick und Tastatur; beides wuerde dem Benutzer
#      den Fokus mitten im Satz entreissen und wird deshalb abgewiesen statt
#      ausgefuehrt.
#   4. **Endet die Abschirmung, endet die Ausnahme.** Wird SSE waehrend der
#      Transaktion nach vorn geholt, gilt das als Interferenz - und die
#      Meldung nennt, welche der beiden Lagen endete.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$worker = Get-Content -LiteralPath (Join-Path $root 'powershell\sse-worker.ps1') -Raw

function Assert-Enthalten([string]$Muster, [string]$Meldung, [int]$Erwartet = 1) {
  $treffer = ([regex]::Matches($worker, [regex]::Escape($Muster))).Count
  if ($treffer -ne $Erwartet) { throw "$Meldung (gefunden: $treffer, erwartet: $Erwartet)" }
}

# --- 1. Der Schutz kennt die neue Lage, in beiden Schreiboperationen ---
Assert-Enthalten '$foreignForegroundIsolation = [bool](-not $script:DESKTOP_NAME -and -not $lockScreenIsolation -and' `
  'Die Abschirmung ueber den Fremdvordergrund fehlt in einer Schreiboperation.' 2
Assert-Enthalten '-not $foreignForegroundIsolation)' `
  'guardUserInput beruecksichtigt die neue Abschirmung nicht.' 2

# --- 2. Alle Nachpruefstellen decken beide Lagen ab ---
if ($worker -match '\$lockScreenIsolation -and -not \(Test-SSEForegroundIsLockScreen\)') {
  throw 'Eine Nachpruefstelle prueft nur den Sperrbildschirm; der Fremdvordergrund bliebe dort unbemerkt.'
}
Assert-Enthalten 'Test-SSEIsolationEnded $lockScreenIsolation $foreignForegroundIsolation $hwnd' `
  'Nicht alle Nachpruefstellen nutzen die gemeinsame Pruefung.' 8

# --- 3. Fokuspflichtige Pfade werden abgewiesen, nicht ausgefuehrt ---
Assert-Enthalten "'foreground-needed'" `
  'Der Weg zum Tabellenende wird unter Fremdvordergrund nicht abgewiesen.'
Assert-Enthalten 'ist eine Auswahlliste und braucht Klick und Vordergrund' `
  'Auswahllisten werden unter Fremdvordergrund nicht abgewiesen.' 2

# --- 4. Die Antwort legt die Lage offen ---
Assert-Enthalten 'foreignForegroundIsolation=$foreignForegroundIsolation' `
  'Die Telemetrie verschweigt die Abschirmung.' 4

# --- 5. Verhalten der Prozesspruefung, wirklich ausgefuehrt ---
. (Join-Path $root 'powershell\load-native.ps1')
$null = Import-SSENativeInterop

$muster = '(?ms)^function Test-SSEForegroundIsForeignProcess\(\[IntPtr\]\$Hwnd\) \{.*?\n\}'
$treffer = [regex]::Match($worker, $muster)
if (-not $treffer.Success) { throw 'Test-SSEForegroundIsForeignProcess ist nicht auffindbar.' }
. ([scriptblock]::Create($treffer.Value))

# Ohne Fensterhandle keine Aussage - und damit kein Freibrief.
if (Test-SSEForegroundIsForeignProcess ([IntPtr]::Zero)) {
  throw 'Ohne Fensterhandle wird faelschlich auf fremden Vordergrund erkannt.'
}
# Ein Handle, zu dem es keinen Prozess gibt, ebenso wenig.
if (Test-SSEForegroundIsForeignProcess ([IntPtr]0x7FFFFFFF)) {
  throw 'Ein unbekanntes Fensterhandle darf nicht als fremder Vordergrund gelten.'
}

# --- 6. Die Begruendung unterscheidet die beiden Lagen ---
$pruefer = [regex]::Match($worker, '(?ms)^function Test-SSEIsolationEnded\(.*?\n\}')
if (-not $pruefer.Success) { throw 'Test-SSEIsolationEnded ist nicht auffindbar.' }
foreach ($grund in @('Windows-Lockscreen wurde verlassen', 'SSE wurde in den Vordergrund geholt')) {
  if ($pruefer.Value -notmatch [regex]::Escape($grund)) {
    throw "Die gemeinsame Pruefung nennt die Ursache '$grund' nicht."
  }
}
if (([regex]::Matches($worker, [regex]::Escape('$script:SSE_ISOLATION_BREACH'))).Count -lt 9) {
  throw 'Die Meldungen nennen die tatsaechliche Ursache nicht durchgaengig.'
}

Write-Output 'Parallelbetrieb: Abschirmung, strenger Zweifelsfall, abgewiesene Fokuspfade, Telemetrie und Ursachenmeldung geprueft'
