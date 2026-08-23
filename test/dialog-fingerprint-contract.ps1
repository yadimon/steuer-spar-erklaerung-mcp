# Der Dialog-Fingerprint muss jede Aenderung abbilden, die eine Antwort
# erlaubt oder verbietet.
#
# Er band frueher nur Titel, Schalternamen und Texte. Beim Einwilligungsdialog
# des ersten Starts wechselt der Zustand aber von "keine Option gewaehlt, OK
# deaktiviert" zu "Option gewaehlt, OK aktiviert" - ohne dass sich einer dieser
# Werte aendert. Der Fingerprint haette damit Frische fuer einen Zustand
# bewiesen, den er nie gesehen hat. Deshalb gehoert der Aktivierungszustand
# hinein, und das haelt dieser Vertrag fest.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'

$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

$definition = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-SSEDialogFingerprint'
}, $true))
if ($definition.Count -ne 1) { throw 'Get-SSEDialogFingerprint ist nicht eindeutig vorhanden.' }
Invoke-Expression $definition[0].Extent.Text

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function Schalter([string]$Name, [bool]$Enabled) { [pscustomobject]@{ name = $Name; enabled = $Enabled } }

$titel = 'Programm zur Verbesserung der Benutzerfreundlichkeit'
$texte = @('Helfen Sie bei der Verbesserung dieses Produktes.')

$aus = Get-SSEDialogFingerprint $titel @((Schalter 'OK' $false)) @() $texte
$an = Get-SSEDialogFingerprint $titel @((Schalter 'OK' $true)) @() $texte
Assert-True ($aus -ne $an) 'Ein deaktivierter und ein aktivierter OK-Schalter ergeben denselben Fingerprint.'

$nochmal = Get-SSEDialogFingerprint $titel @((Schalter 'OK' $false)) @() $texte
Assert-True ($aus -eq $nochmal) 'Derselbe Zustand ergibt zwei verschiedene Fingerprints.'

# Reihenfolge der Schalter darf nichts aendern, ihr Bestand schon.
$einsZwei = Get-SSEDialogFingerprint $titel @((Schalter 'Ja' $true), (Schalter 'Nein' $true)) @() $texte
$zweiEins = Get-SSEDialogFingerprint $titel @((Schalter 'Nein' $true), (Schalter 'Ja' $true)) @() $texte
Assert-True ($einsZwei -eq $zweiEins) 'Die Reihenfolge der Schalter veraendert den Fingerprint.'
$nurJa = Get-SSEDialogFingerprint $titel @((Schalter 'Ja' $true)) @() $texte
Assert-True ($einsZwei -ne $nurJa) 'Ein fehlender Schalter veraendert den Fingerprint nicht.'

# Ueberfluessige Leerzeichen im Titel sind dieselbe Frage.
$mitLeerraum = Get-SSEDialogFingerprint "  Programm   zur Verbesserung der Benutzerfreundlichkeit " @((Schalter 'OK' $false)) @() $texte
Assert-True ($aus -eq $mitLeerraum) 'Normalisierte Leerzeichen im Titel ergeben einen anderen Fingerprint.'

# Ein anderer Text ist eine andere Frage.
$andererText = Get-SSEDialogFingerprint $titel @((Schalter 'OK' $false)) @() @('Wollen Sie wirklich loeschen?')
Assert-True ($aus -ne $andererText) 'Ein anderer Dialogtext ergibt denselben Fingerprint.'

# Ein nicht unterstuetzter Schalter darf nicht unsichtbar bleiben.
$mitUnbekannt = Get-SSEDialogFingerprint $titel @((Schalter 'OK' $false)) @('Versenden') $texte
Assert-True ($aus -ne $mitUnbekannt) 'Ein zusaetzlicher nicht unterstuetzter Schalter veraendert den Fingerprint nicht.'

Write-Output 'Dialog-Fingerprint: Aktivierung, Bestand, Text und Fremdschalter gebunden, Reihenfolge und Leerraum nicht.'
