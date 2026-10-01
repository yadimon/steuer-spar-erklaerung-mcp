<#
Blaetterweg fuer goto.

'Weiter' folgt dem Blaetterpfad des Formulars, 'Zurück' dagegen dem
Seitenverlauf der Sitzung: Nach einem Sprung von der Startseite auf
'Bürobedarf' fuehrt 'Zurück' gemessen zur Startseite, nicht zum Vorgaenger
im Pfad, und 'Weiter' fuehrt danach wieder in den Pfad, nicht im Verlauf vor.
Rueckwaerts trifft der Weg das Ziel also nur, solange der Verlauf dem Pfad
entspricht - etwa nach einer Folge von 'Weiter'-Schritten.

Die Funktionen planen Richtung und Budget und bewerten jede Landung. Sie sind
rein: Sie erhalten Ueberschriften und greifen weder auf UIA noch auf Fenster
zu.
#>

<#
Bekannte Reihenfolge des Blaetterpfads aus der Kartierung des
Gewerbe-Musterfalls. Jede Ueberschrift steht genau einmal darin. Im Formular
kann dieselbe Ueberschrift trotzdem mehrfach vorkommen: Die §-13b-Unterseite
'Innergem. Erwerb, § 13b UStG und Einfuhr' folgt nicht nur auf den
Wareneinkauf, sondern gemessen auch auf weitere Ausgabenseiten wie
'Bürobedarf', und hinter 'Steuerschuldnerschaft nach § 13b UStG' laeuft der
Pfad durch den UStVA-Zweig weiter, dessen Seiten wie die des UStE-Zweigs
heissen ('Abziehbare Vorsteuer', 'Vorsteuer aus anderen Rechnungen').
Dynamische Seiten (weitere Reisen, Fahrzeuge, Arbeitszimmer) fehlen ganz.
#>
function Get-SSEPagingOrder {
  param([Parameter(Mandatory)][int]$TaxYear)
  @(
    'Umsatzsteuerzahlungen/-Erstattungen','Übersicht Betriebseinnahmen','Erlöse Lieferungen/Leistungen',
    'Einnahmen: Freiberufler','Erlöse aus Anlagenverkäufen','Kapitalerträge und sonstige Einnahmen',
    'Private Nutzungen: Sonstiges','Unberechtigt ausgewiesene Umsatzsteuer','Betriebsausgaben',
    'Material-/Wareneinkauf','Innergem. Erwerb, § 13b UStG und Einfuhr','Fremdleistungen','Personalkosten',
    'Abschreibung','Wirtschaftsgüter des Anlagevermögen','Investitionsabzugsbeträge (IAB)',
    'Raum- und Grundstückskosten/Homeoffice','Arbeitszimmer/andere Arbeitsräume/Homeoffice',
    '1. Arbeitszimmer/Arbeitsraum/Homeoffice','Schuldzinsen','Beiträge, Gebühren und Abgaben',
    'Versicherungen (ohne Gebäude oder Kfz)','Reisekosten','1. Reise','Öffentliche Verkehrsmittel',
    '1. Reise: Verpflegung / Übernachtung','1. Reise: Übernachtung','Sonstige Kosten','Privatanteil Reisekosten',
    'Geschenke bis 50,- €','Bewirtungskosten','Wege zum Betrieb (Entfernungspauschale)','Portokosten',
    'Telefon/Mobilfunk/Internet','Bürobedarf','Fachliteratur','Fortbildungskosten','Rechts- und Beratungkosten',
    'Miete/Leasing beweglicher Wirtschaftsgüter','Werbung und Reklame','Sonstige Betriebsausgaben',
    'Werkzeuge und Kleingeräte','EDV-Kosten','Vorsteuer (Übersicht)','Sonstige Vorsteuerbeträge',
    'Betriebsausgaben: Eigene Positionen','Journal und BWA','Zusatzangaben zur Anlage EÜR','Entnahmen/Einlagen',
    "Umsatzsteuererklärung $TaxYear",'Lieferungen/Leistungen zu 19%','Unentgeltliche Wertabgaben zu 19%',
    'Lieferungen/Leistungen zu 7%','Unentgeltliche Wertabgaben zu 7%','Umsätze zu anderen Steuersätzen',
    'Warenbezug von Unternehmen aus dem EU-Ausland','Steuerschuldner nach § 13b UStG','Abziehbare Vorsteuer',
    'Vorsteuer aus anderen Rechnungen',"Vorsteuerberichtigungen $TaxYear",'Steuerfreie Umsätze',
    'Meldepflichtige oder nicht steuerbare Umsätze',"Umsatzsteuer-Voranmeldungen $TaxYear",'Weitere Erlöse zu 19%',
    'Weitere Umsätze','Steuerschuldnerschaft nach § 13b UStG'
  )
}

<#
Ueberschriften, die im Blaetterpfad wiederkehren. Die §-13b-Unterseite steht
in der Reihenfolge nur hinter dem Wareneinkauf, folgt gemessen aber auch auf
'Bürobedarf' (Bürobedarf -> §-13b-Unterseite -> Fachliteratur), und 'Zurück'
faehrt nach einem 'Weiter'-Lauf ueber dieselbe Seite zurueck.
#>
function Get-SSERepeatedPagingTitles {
  @('Innergem. Erwerb, § 13b UStG und Einfuhr')
}

<#
Plant den Blaetterweg von $Start zu $Target.

- Ohne vorgegebene Richtung und mit beiden Seiten in der Reihenfolge laeuft
  der Weg zum Ziel dahinter per 'Weiter'. Liegt das Ziel davor, gilt 'Zurück'
  nur als gepruefter Rueckweg: Jede Landung muss der Vorgaenger im Pfad
  sein, sonst endet der Weg (Test-SSEGotoLanding).
- Ist Start oder Ziel unbekannt, gibt es nur 'Weiter'. Ein automatisches
  'Zurück' liefe sonst den Verlauf der Sitzung ab.
- Eine vorgegebene Richtung bleibt Wahl des Aufrufers; 'Zurück' wird dann
  nicht gegen den Pfad geprueft.

Budget: der Abstand im Pfad plus eine Reserve fuer Seiten, die die
Reihenfolge nicht kennt oder wiederholt. Jede weitere Reise bringt bis zu
vier Seiten, jedes Fahrzeug und jedes weitere Arbeitszimmer eigene, und die
§-13b-Unterseite kehrt hinter mehreren Ausgabenseiten wieder - in beiden
Richtungen; 20 decken mehrere solcher Eintraege, ohne dass ein Fehllauf das
Formular durchblaettert. Ist das Ziel unbekannt, zaehlt der Rest des Pfads.
maxSteps bleibt Obergrenze.
#>
function Get-SSEGotoRoute {
  param(
    [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Order,
    [Parameter(Mandatory)][AllowEmptyString()][string]$Start,
    [Parameter(Mandatory)][string]$Target,
    [string]$Direction = '',
    $MaxSteps = $null,
    [int]$Reserve = 20
  )
  $startIndex = [array]::IndexOf($Order, $Start)
  $targetIndex = [array]::IndexOf($Order, $Target)
  $known = [bool]($startIndex -ge 0 -and $targetIndex -ge 0)
  $checkedBack = [bool](-not $Direction -and $known -and $targetIndex -lt $startIndex)
  $budget = $(
    if ($known -and $targetIndex -eq $startIndex) { 0 }
    elseif ($known) { [Math]::Abs($targetIndex - $startIndex) + $Reserve }
    elseif ($startIndex -ge 0) { $Order.Count - 1 - $startIndex + $Reserve }
    elseif ($targetIndex -ge 0) { $targetIndex + 1 + $Reserve }
    else { $Order.Count + $Reserve }
  )
  if ($null -ne $MaxSteps) { $budget = [Math]::Min($budget, [int]$MaxSteps) }
  [pscustomobject]@{
    direction=$(if ($Direction) { $Direction } elseif ($checkedBack) { 'Zurück' } else { 'Weiter' })
    checkedBack=$checkedBack; budget=[int]$budget
    target=$Target; startIndex=$startIndex; targetIndex=$targetIndex
  }
}

<#
Bewertet die Landung eines Blaetterschritts von $From auf $Landing. Ob die
Landung schon das Ziel ist, prueft der Aufrufer vorher.

Position ist der Index der zuletzt im Pfad bestaetigten Seite (-1:
unbekannt). Geliefert wird verdict 'continue' mit der neuen Position oder
'deviation'/'overshoot' mit einer Meldung, die nennt, wo SSE jetzt steht.

- Gepruefter Rueckweg: Erlaubt ist der Vorgaenger im Pfad oder eine
  wiederkehrende Unterseite (Get-SSERepeatedPagingTitles); jede andere
  Landung zeigt, dass der Verlauf vom Pfad abweicht.
- 'Weiter': Gesucht wird die Landung nur hinter der aktuellen Position. Ein
  Titel, der dort nicht vorkommt, ist eine Seite, die die Reihenfolge nicht
  kennt oder dort wiederholt; die Position bleibt. Ein Ruecksprung laesst
  sich am Titel allein nicht von einer wiederkehrenden Unterseite
  unterscheiden, 'Weiter' folgt aber gemessen stets dem Pfad, und einen
  Kreis erkennt der Aufrufer am wiederholten Uebergang. Liegt die Landung
  hinter dem Ziel, ist es uebersprungen.
- Vorgegebenes 'Zurück' folgt dem Verlauf und wird nicht geprueft.
#>
function Test-SSEGotoLanding {
  param(
    [Parameter(Mandatory)]$Route,
    [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Order,
    [Parameter(Mandatory)][int]$Position,
    [Parameter(Mandatory)][AllowEmptyString()][string]$From,
    [Parameter(Mandatory)][AllowEmptyString()][string]$Landing
  )
  if ($Route.checkedBack) {
    $expected = $(if ($Position -gt 0) { $Order[$Position - 1] } else { '' })
    if ($expected -and $Landing -ceq $expected) {
      return [pscustomobject]@{ verdict='continue'; position=$Position - 1; message=$null }
    }
    if ($Landing -cin @(Get-SSERepeatedPagingTitles)) {
      return [pscustomobject]@{ verdict='continue'; position=$Position; message=$null }
    }
    return [pscustomobject]@{
      verdict='deviation'; position=$Position
      message=("'Zurück' fuehrte von '$From' auf '$Landing' statt auf '$expected'. 'Zurück' folgt dem " +
               "Seitenverlauf, nicht dem Blaetterpfad; ein weiterer Schritt liefe den Verlauf der Sitzung ab, " +
               "'Weiter' vom Ziel weg. SSE steht jetzt auf '$Landing'. Abhilfe: Auf dem sichtbaren Desktop " +
               "klickt goto einen sichtbaren Eintrag des Navigationsbaums selbst; sonst goto von einer Seite " +
               "vor '$($Route.target)' aus starten.")
    }
  }
  if ($Route.direction -cne 'Weiter') {
    return [pscustomobject]@{ verdict='continue'; position=[array]::IndexOf($Order, $Landing); message=$null }
  }
  $index = [array]::IndexOf($Order, $Landing, $Position + 1)
  if ($index -lt 0) {
    return [pscustomobject]@{ verdict='continue'; position=$Position; message=$null }
  }
  if ($Route.targetIndex -ge 0 -and $index -gt $Route.targetIndex) {
    return [pscustomobject]@{
      verdict='overshoot'; position=$index
      message=("'Weiter' fuehrte von '$From' auf '$Landing', die im Blaetterpfad hinter '$($Route.target)' liegt; " +
               "das Ziel wurde uebersprungen oder fehlt in diesem Fall. SSE steht jetzt auf '$Landing'. " +
               "Abhilfe: pruefen, ob die Seite in diesem Fall existiert; auf dem sichtbaren Desktop klickt goto " +
               "einen sichtbaren Eintrag des Navigationsbaums selbst.")
    }
  }
  [pscustomobject]@{ verdict='continue'; position=$index; message=$null }
}
