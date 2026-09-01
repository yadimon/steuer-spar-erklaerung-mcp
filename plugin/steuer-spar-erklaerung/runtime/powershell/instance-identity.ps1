<#
Welche Falldatei gehoert zu einem offenen Hauptfenster?

Reine Entscheidung ohne Fenster-, Prozess- oder Dateizugriff. Sie bekommt die
beiden bereits geprueften Kandidaten - den Pfad aus dem Fenstertitel und den
aus der Kommandozeile - und bestimmt daraus, was BELEGT ist.

Der Grund fuer diese eigene Datei ist ein real aufgetretener Fehler: die
SteuerSparErklaerung kuerzt lange Pfade im Fenstertitel mit '...'. Eine solche
Zeichenkette besteht jede Endungspruefung, zeigt aber ins Leere. Wer sie als
Pfad weiterreicht, bekommt still eine leere Pruefsumme und haelt einen
geratenen Pfad fuer belegt.
#>

<#
Ergebnis:
  path            Vollstaendiger, belegter Pfad - oder $null.
  name            Dateiname. Steht auch im gekuerzten Titel und reicht, um
                  mehrere offene Faelle auseinanderzuhalten.
  source          'title' | 'command-line' | 'title-leaf' | $null
  titleTruncated  Der Fenstertitel war gekuerzt.
#>
function Resolve-SSEInstanceCaseIdentity {
  param(
    [string]$TitleCandidate = '',
    [string]$CommandCandidate = ''
  )

  $titleTruncated = [bool]($TitleCandidate -and $TitleCandidate.Contains('...'))
  $titlePath = $(if ($TitleCandidate -and -not $titleTruncated) { $TitleCandidate } else { $null })
  $titleName = $(if ($TitleCandidate) { [IO.Path]::GetFileName($TitleCandidate) } else { $null })

  # Die Kommandozeile nennt nur den BEIM START uebergebenen Fall. Nach einem
  # Fallwechsel im Programm waere sie veraltet. Sie darf deshalb nur
  # einspringen, wenn ihr Dateiname zu dem im Titel passt.
  $commandFits = [bool](
    $CommandCandidate -and (
      -not $titleName -or
      [IO.Path]::GetFileName($CommandCandidate).Equals($titleName, [StringComparison]::OrdinalIgnoreCase)
    )
  )

  $path = $(if ($titlePath) { $titlePath } elseif ($commandFits) { $CommandCandidate } else { $null })
  $source = $(
    if ($titlePath) { 'title' }
    elseif ($commandFits) { 'command-line' }
    elseif ($titleName) { 'title-leaf' }
    else { $null }
  )
  $name = $(if ($path) { [IO.Path]::GetFileName($path) } elseif ($titleName) { $titleName } else { $null })

  [pscustomobject]@{
    path = $path
    name = $name
    source = $source
    titleTruncated = $titleTruncated
  }
}
