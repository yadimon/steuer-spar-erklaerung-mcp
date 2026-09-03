# Das Online-Update-Angebot von SteuerSparErklaerung muss als solches gemeldet
# werden - und darf niemals automatisch angenommen werden.
#
# Der Dialog erscheint beim Programmstart, wenn der Hersteller eine neue Version
# bereitstellt, und blockiert den geladenen Fall. Ohne Kennzeichnung meldet die
# API nur einen namenlosen Qt-Dialog; der Aufrufer muesste deutschen Fliesstext
# auswerten, um zu verstehen, warum der Start haengt.
#
# Die Kennzeichnung erweitert bewusst KEINE Rechte. Sie ist nur dann korrekt,
# wenn 'Weiter' unbeantwortbar bleibt - ein Programmupdate beendet die Anwendung
# und tauscht sie aus, das bleibt die Entscheidung des Benutzers.
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
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-SSEUpdatePromptDescriptor'
}, $true))
if ($definition.Count -ne 1) { throw 'Funktion Test-SSEUpdatePromptDescriptor ist nicht eindeutig vorhanden.' }
Invoke-Expression $definition[0].Extent.Text

function Assert-Equal($Actual, $Expected, [string]$Message) {
  if ("$Actual" -cne "$Expected") { throw "$Message - erwartet '$Expected', erhalten '$Actual'" }
}

function New-Dialog {
  param(
    [string]$Kind = 'qt-dialog',
    [string]$Title = 'Online Update',
    [string[]]$Buttons = @('Abbrechen'),
    [string[]]$Unsupported = @('Weiter'),
    [string[]]$Texts = @(
      'Eine neue Programmversion ist verfügbar!',
      'Für die Aktualisierung wird das Programm jetzt beendet.',
      'Automatische Versionsprüfung bei Programmstart'
    )
  )
  [pscustomobject]@{
    kind = $Kind; title = $Title
    buttons = @($Buttons | ForEach-Object { [pscustomobject]@{ name = $_; enabled = $true } })
    unsupportedButtons = @($Unsupported)
    texts = @($Texts)
  }
}

# 1 Der beobachtete Dialog wird erkannt.
Assert-Equal (Test-SSEUpdatePromptDescriptor (New-Dialog)) $true 'Beobachteter Update-Dialog'

# 2 Die Beschriftung der Kontrollkaestchen-Zeile darf die Erkennung nicht stoeren,
#   und zusaetzliche Absaetze ebenfalls nicht.
Assert-Equal (Test-SSEUpdatePromptDescriptor (New-Dialog -Texts @(
  'Online Update', 'Eine neue Programmversion ist verfügbar!', 'Weitere Hinweise folgen.'
))) $true 'Zusaetzliche Absaetze'

# 3 Nahe Verfehlungen bleiben ungekennzeichnet.
Assert-Equal (Test-SSEUpdatePromptDescriptor (New-Dialog -Kind 'native-dialog')) $false 'Falsche Dialogart'
Assert-Equal (Test-SSEUpdatePromptDescriptor (New-Dialog -Title 'online update')) $false 'Titel in anderer Schreibweise'
Assert-Equal (Test-SSEUpdatePromptDescriptor (New-Dialog -Title 'Steuerprogramm')) $false 'Fremder Titel'
Assert-Equal (Test-SSEUpdatePromptDescriptor (New-Dialog -Buttons @('OK'))) $false 'Ohne Abbrechen'
Assert-Equal (Test-SSEUpdatePromptDescriptor (New-Dialog -Buttons @('Abbrechen','Abbrechen'))) $false 'Abbrechen mehrdeutig'
Assert-Equal (Test-SSEUpdatePromptDescriptor (New-Dialog -Texts @('Es wurde eine Wiederherstellungsdatei gefunden.'))) $false 'Fremder Text'

# 4 Waere 'Weiter' bedienbar, darf NICHT gekennzeichnet werden: die Kennzeichnung
#   behauptet, dass nur 'Abbrechen' offensteht.
Assert-Equal (Test-SSEUpdatePromptDescriptor (New-Dialog -Unsupported @())) $false 'Weiter fehlt in unsupportedButtons'
Assert-Equal (Test-SSEUpdatePromptDescriptor (New-Dialog -Buttons @('Abbrechen','Weiter') -Unsupported @())) $false 'Weiter als bedienbarer Schalter'

# 5 Die eigentliche Sicherheitszusicherung: 'Weiter' steht nicht in der Liste
#   beantwortbarer Schalter. Faellt das, koennte ein Aufrufer ein Programmupdate
#   ausloesen - dann ist diese Kennzeichnung falsch und muss neu bewertet werden.
$listStart = $workerSource.IndexOf('$script:DIALOG_BUTTONS = @(')
if ($listStart -lt 0) { throw 'Liste der Dialogschalter nicht gefunden.' }
$listEnd = $workerSource.IndexOf(')', $listStart)
$buttonList = $workerSource.Substring($listStart, $listEnd - $listStart)
if ($buttonList -cmatch "'Weiter'") {
  throw "'Weiter' ist beantwortbar geworden - ein Programmupdate liesse sich damit ausloesen."
}

# 6 Quelltextbindung: die Kennzeichnung haengt am Deskriptor und wird in beiden
#   Meldewegen ausgegeben. Faellt eines davon weg, erfaehrt der Aufrufer nichts.
if ($workerSource -notmatch 'updatePrompt -NotePropertyValue') {
  throw 'Der Dialog-Deskriptor traegt kein updatePrompt.'
}
$reported = ([regex]::Matches($workerSource, 'updatePrompt\s*=\s*\[bool\]\$_\.updatePrompt')).Count
if ($reported -ne 2) {
  throw "updatePrompt wird an $reported statt an beiden Meldestellen ausgegeben."
}

Write-Output 'Update-Angebot: erkannt, unbeantwortbar, an beiden Meldewegen gemeldet.'
