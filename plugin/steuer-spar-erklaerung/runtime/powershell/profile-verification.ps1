<#
Abgleich des laufenden Produktbuilds mit dem Build, gegen den dieses Profil
zuletzt erfolgreich getestet wurde.

Die Steuerbarkeit haengt weiterhin nur an der Hauptversion; ein Minor-Update
bricht nichts ab. Sichtbar soll es trotzdem sein: das beobachtete Update von
30.0.106 auf 30.0.127 blieb sonst unbemerkt.

Die Funktion ist rein: sie erhaelt bereits gelesene Versionsstrings und
greift weder auf Dateien noch auf Prozesse zu.
#>
function Get-SSEBuildDrift {
  param([string]$VerifiedBuild, [string]$CurrentBuild)
  $aktuell = ([string]$CurrentBuild) -replace '[^0-9.,]', '' -replace ',\s*', '.' -replace '\s', ''
  $verifiziert = ([string]$VerifiedBuild).Trim()
  [pscustomobject]@{
    verified = $verifiziert
    current = $aktuell
    drifted = -not $verifiziert -or $verifiziert -ne $aktuell
  }
}
