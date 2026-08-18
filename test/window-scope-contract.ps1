$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\powershell\window-scope.ps1')

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

# Knotenform von Get-UiSnapshot: Tiefensuche in Vorordnung, Elternindex ist
# IMMER kleiner als der Kindindex.
function Node([int]$I, [int]$P, [int]$D, [string]$Type, [string]$Name,
              [int]$X = 600, [int]$Y = 400, [string]$Aid = '', [string]$Rid = '') {
  [pscustomobject]@{
    i=$I; p=$P; d=$D; type=$Type; name=$Name; aid=$Aid
    x=$X; y=$Y; w=200; h=20; on=$true; val=$null; ro=$null
    checked=$null; selected=$null; scroll=$null
    rid=$(if ($Rid) { $Rid } else { "42.$I" })
  }
}

# --------------------------------------------------------------------------
# A) Fremde Fenster im Baum des gebundenen Fensters
#
# UIA haengt ein BESESSENES Fenster (hier die nicht-modale Werte-Info) als
# Kind an sein Besitzerfenster. Ein Baumlauf ab dem Hauptfenster enthaelt
# deshalb dessen kompletten Teilbaum - samt Header- und DataItem-Knoten, die
# geometrisch mitten im Inhaltsbereich liegen. Ohne Fensterbindung liest
# read_table die Tabelle des fremden Fensters statt der Seite.
# --------------------------------------------------------------------------
$mitFremdfenster = @(
  (Node 0 -1 0 'Window'   'Werte-Info: Werte vergleichen - Was waere wenn' 1758 1060 'SSE_Application.WerteInfo')
  (Node 1  0 1 'ToolBar'  'Werte-Info Symbolleiste'   1763 1105 'SSE_Application.WerteInfo.QWidget.obj_WerteinfoToolbar')
  (Node 2  0 1 'Table'    ''                          1763 1150 'SSE_Application.WerteInfo.QWidget.QTableWidget')
  (Node 3  2 2 'Header'   'Beobachteter Wert'         1770 1160)
  (Node 4  2 2 'Header'   'Aktuell'                   2100 1160)
  (Node 5  2 2 'DataItem' 'Nachzahlung'               1770 1200)
  (Node 6  2 2 'DataItem' '24.564,15 EUR'             2100 1200)
  (Node 7 -1 0 'Pane'     ''                           575  190 'SSE_Application.AAV4GLEngineWindow31.centralWidget')
  (Node 8  7 1 'Text'     'Uebersicht der Kapitalertraege' 575 199 'SSE_Application.AAV4GLEngineWindow31.centralWidget.SearchSplitter.TopLevelHSplitter.RedThreadContent.ClientFrameSSE.ClientHeader.QLabel')
  (Node 9  7 1 'Edit'     ''                           900  402 'SSE_Application.AAV4GLEngineWindow31.centralWidget.Wert')
)

$geteilt = Split-SSEWindowScope $mitFremdfenster
$eigeneIds = @($geteilt.own | ForEach-Object { $_.i })

Assert-True (($eigeneIds -join ',') -eq '7,8,9') `
  "Fremdfenster-Teilbaum wurde nicht vollstaendig entfernt: $($eigeneIds -join ',')"
Assert-True (@($geteilt.own | Where-Object { $_.type -in @('Header','DataItem') }).Count -eq 0) `
  'Tabellenknoten des fremden Fensters blieben im Seitenbestand.'
Assert-True ($geteilt.foreign.Count -eq 1) `
  "Genau ein fremdes Fenster war zu melden, gemeldet: $($geteilt.foreign.Count)"
Assert-True ($geteilt.foreign[0].aid -eq 'SSE_Application.WerteInfo') `
  'Das gemeldete Fremdfenster traegt nicht seine AutomationId.'
Assert-True ($geteilt.foreign[0].nodeCount -eq 7) `
  "Knotenzahl des Fremdfensters falsch: $($geteilt.foreign[0].nodeCount)"

# Ohne fremdes Fenster darf nichts verloren gehen.
$nurEigen = @($mitFremdfenster | Where-Object { $_.i -ge 7 })
$geteiltRein = Split-SSEWindowScope $nurEigen
Assert-True ($geteiltRein.own.Count -eq 3 -and $geteiltRein.foreign.Count -eq 0) `
  'Ein Baum ohne Fremdfenster wurde veraendert.'

# Tiefe Verschachtelung: auch Enkel eines fremden Fensters muessen fallen.
$tief = @(
  (Node 0 -1 0 'Window' 'Fremd' 100 100 'SSE_Application.Fremd')
  (Node 1  0 1 'Pane'   ''      100 120)
  (Node 2  1 2 'Group'  ''      100 140)
  (Node 3  2 3 'DataItem' 'tief verschachtelt' 100 160)
  (Node 4 -1 0 'Text'   'echte Seite' 600 199)
)
$tiefGeteilt = Split-SSEWindowScope $tief
Assert-True ((@($tiefGeteilt.own | ForEach-Object { $_.i }) -join ',') -eq '4') `
  'Enkelknoten eines fremden Fensters ueberlebten die Fensterbindung.'

# Das gebundene Fenster selbst darf nie weggefiltert werden, falls der
# Baumlauf es doch einmal mitliefert.
$mitWurzel = @(
  (Node 0 -1 0 'Window' 'Einkommensteuer 2025' 0 0 'SSE_Application.AAV4GLEngineWindow31' '42.8129466')
  (Node 1  0 1 'Text'   'echte Seite' 600 199)
)
$wurzelGeteilt = Split-SSEWindowScope $mitWurzel -KeepRid '42.8129466'
Assert-True ($wurzelGeteilt.own.Count -eq 2 -and $wurzelGeteilt.foreign.Count -eq 0) `
  'Das gebundene Fenster wurde als fremd behandelt.'

Write-Output 'Fensterbindung: alle Vertraege bestanden'
