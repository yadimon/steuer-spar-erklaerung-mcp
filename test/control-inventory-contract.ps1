# Ein "nicht gefunden" muss sagen, was statt dessen da war.
#
# Drei Bediensackgassen meldeten frueher nur, dass ein Element fehlt:
# 'CheckBox nicht gefunden.' und zweimal 'ComboBox nicht gefunden.'. Damit ist
# nicht unterscheidbar, ob das Element gar nicht existiert oder nur anders
# heisst - und beides verlangt einen voellig anderen naechsten Schritt. Genau
# diese Sackgasse hat die Untersuchung der §13b-Auswahl aufgehalten.
#
# Dieser Vertrag prueft nicht nur, dass der Bestand genannt wird, sondern
# fuehrt den Helfer gegen gebaute Baeume wirklich aus. Ein Text, der nur
# vorkommt, waere kein Beleg dafuer, dass er auch stimmt.
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$workerSource = Get-Content -LiteralPath $workerPath -Raw

# --- 1. Keine der drei Sackgassen darf ohne Bestandsangabe zurueckkehren ---
foreach ($sackgasse in @("Fail 'CheckBox nicht gefunden.' 'not-found'",
                         "Fail 'ComboBox nicht gefunden.' 'not-found'")) {
  if ($workerSource.Contains($sackgasse)) {
    throw "Bediensackgasse ohne Bestandsangabe ist zurueck: $sackgasse"
  }
}

$aufrufe = ([regex]::Matches($workerSource, 'Get-SSETypeInventory \$tree')).Count
if ($aufrufe -lt 3) {
  throw "Erwartet werden mindestens 3 Bestandsangaben in Bedienfehlern, gefunden: $aufrufe"
}

# --- 2. Der Helfer wird ausgefuehrt, nicht nur gelesen ---
$muster = '(?ms)^function Get-SSETypeInventory\(.*?\n\}'
$treffer = [regex]::Match($workerSource, $muster)
if (-not $treffer.Success) { throw 'Get-SSETypeInventory ist im Arbeiter nicht auffindbar.' }
. ([scriptblock]::Create($treffer.Value))

function Neuer-Baum($knoten) { [pscustomobject]@{ nodes = $knoten } }

# Leerer Bestand: die Meldung muss das ausdruecklich sagen.
$leer = Get-SSETypeInventory (Neuer-Baum @(
  [pscustomobject]@{ type = 'Edit'; aid = 'feldA'; name = 'Betrag'; rid = 'r1' })) 'ComboBox'
if ($leer -notmatch 'kein Element vom Typ ComboBox') {
  throw "Leerer Bestand wird nicht benannt: $leer"
}

# Vorhandener Bestand: Anzahl und Bezeichner muessen auftauchen.
$knoten = @(
  [pscustomobject]@{ type = 'ComboBox'; aid = 'cmbSteuersatz'; name = 'Steuersatz'; rid = 'r1' },
  [pscustomobject]@{ type = 'ComboBox'; aid = ''; name = 'Kostenart'; rid = 'r2' },
  [pscustomobject]@{ type = 'ComboBox'; aid = ''; name = ''; rid = 'r3' },
  [pscustomobject]@{ type = 'Edit'; aid = 'feldA'; name = 'Betrag'; rid = 'r4' })
$voll = Get-SSETypeInventory (Neuer-Baum $knoten) 'ComboBox'
foreach ($erwartet in @('3 Element', 'aid=cmbSteuersatz', 'name=Kostenart', 'rid=r3')) {
  if ($voll -notmatch [regex]::Escape($erwartet)) {
    throw "Bestandsangabe nennt '$erwartet' nicht: $voll"
  }
}
if ($voll -match 'feldA') { throw "Bestandsangabe mischt fremde Typen hinein: $voll" }

# Deckelung: mehr als $Max Elemente werden gezaehlt, nicht alle aufgezaehlt.
$viele = @(1..9 | ForEach-Object {
  [pscustomobject]@{ type = 'ComboBox'; aid = "cmb$_"; name = ''; rid = "r$_" } })
$gedeckelt = Get-SSETypeInventory (Neuer-Baum $viele) 'ComboBox' 4
foreach ($erwartet in @('9 Element', 'aid=cmb1', '+5 weitere')) {
  if ($gedeckelt -notmatch [regex]::Escape($erwartet)) {
    throw "Deckelung meldet '$erwartet' nicht: $gedeckelt"
  }
}
if ($gedeckelt -match 'cmb6') { throw "Deckelung greift nicht: $gedeckelt" }

Write-Output 'Bedienbestand: drei Sackgassen nennen ihren Bestand; Helfer gegen leeren, vollen und gedeckelten Baum geprueft'
