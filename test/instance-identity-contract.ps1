$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\powershell\instance-identity.ps1')

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$voll = 'C:\Faelle\2025\pruef-a.ESt2025'
$gekuerzt = 'D:\Ablage\Buchhaltung\Steuerfaelle.../pruef-b.Gew2025'

# Vollstaendiger Titel: er gewinnt, weil er den GERADE geladenen Fall zeigt.
$titel = Resolve-SSEInstanceCaseIdentity $voll 'C:\Faelle\2025\alt.ESt2025'
Assert-True ($titel.path -eq $voll) 'Vollstaendiger Titelpfad wurde nicht bevorzugt.'
Assert-True ($titel.source -eq 'title') 'Quelle des vollstaendigen Titels ist falsch.'
Assert-True (-not $titel.titleTruncated) 'Vollstaendiger Titel wurde als gekuerzt gemeldet.'
Assert-True ($titel.name -eq 'pruef-a.ESt2025') 'Dateiname aus vollstaendigem Titel ist falsch.'

# Der reale Fehlerfall: die SteuerSparErklaerung kuerzt lange Pfade mit '...'.
# Passt die Kommandozeile zum Dateinamen, traegt SIE den belegten Pfad.
$mitKommando = Resolve-SSEInstanceCaseIdentity $gekuerzt 'D:\Ablage\Buchhaltung\Steuerfaelle\2025\pruef-b.Gew2025'
Assert-True ($mitKommando.titleTruncated) 'Gekuerzter Titel wurde nicht erkannt.'
Assert-True ($mitKommando.path -eq 'D:\Ablage\Buchhaltung\Steuerfaelle\2025\pruef-b.Gew2025') `
  'Bei gekuerztem Titel wurde der volle Kommandozeilenpfad nicht uebernommen.'
Assert-True ($mitKommando.source -eq 'command-line') 'Quelle bei gekuerztem Titel ist falsch.'

# Ohne passende Kommandozeile bleibt NUR der Dateiname belegt. Ein gekuerzter
# Pfad darf niemals als Pfad durchgereicht werden - er zeigt ins Leere.
$ohneKommando = Resolve-SSEInstanceCaseIdentity $gekuerzt ''
Assert-True ($null -eq $ohneKommando.path) 'Gekuerzter Titelpfad wurde als belegter Pfad ausgegeben.'
Assert-True ($ohneKommando.name -eq 'pruef-b.Gew2025') 'Dateiname aus gekuerztem Titel fehlt.'
Assert-True ($ohneKommando.source -eq 'title-leaf') 'Quelle bei reinem Dateinamen ist falsch.'

# Eine Kommandozeile mit ANDEREM Dateinamen ist ein veralteter Fall aus der
# Zeit vor einem Fallwechsel und darf den offenen Fall nicht ueberschreiben.
$fremd = Resolve-SSEInstanceCaseIdentity $gekuerzt 'C:\Faelle\2025\ganz-anders.Gew2025'
Assert-True ($null -eq $fremd.path) 'Fremder Kommandozeilenpfad wurde uebernommen.'
Assert-True ($fremd.source -eq 'title-leaf') 'Fremde Kommandozeile haette nicht gewinnen duerfen.'
Assert-True ($fremd.name -eq 'pruef-b.Gew2025') 'Dateiname muss weiterhin aus dem Titel stammen.'

# Ohne Titel bleibt die Kommandozeile die einzige Quelle.
$nurKommando = Resolve-SSEInstanceCaseIdentity '' 'C:\Faelle\2025\pruef-c.Gew2025'
Assert-True ($nurKommando.path -eq 'C:\Faelle\2025\pruef-c.Gew2025') 'Alleinige Kommandozeile wurde nicht genutzt.'
Assert-True ($nurKommando.source -eq 'command-line') 'Quelle ohne Titel ist falsch.'

# Gar keine Quelle: nichts wird behauptet.
$leer = Resolve-SSEInstanceCaseIdentity '' ''
Assert-True ($null -eq $leer.path -and $null -eq $leer.name -and $null -eq $leer.source) `
  'Ohne jede Quelle wurde trotzdem etwas behauptet.'

Write-Output 'OK: Instanzidentitaet meldet nur belegte Pfade und erkennt gekuerzte Fenstertitel.'
