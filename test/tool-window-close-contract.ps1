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
