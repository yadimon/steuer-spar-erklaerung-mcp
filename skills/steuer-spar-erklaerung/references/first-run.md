# Einfacher First-Run-Wizard

Lies diese Referenz, wenn der Nutzer einen Steuerfall prüfen lassen möchte und
Einrichtung, Fall oder Belegquellen noch nicht sicher bestätigt sind. Das Ziel
ist ein normaler Dialog für technisch unerfahrene Nutzer, kein technisches
Interview.

## Ergebnis des Wizards

Vor der eigentlichen Prüfung müssen genau zwei fachliche Entscheidungen vom
Nutzer bestätigt sein:

1. der richtige Steuerfall;
2. die vollständige Liste der Belegordner für diesen Auftrag, wobei
   „keine Belege“ eine gültige Antwort ist.

Alle technischen Empfehlungen danach als einen sichtbaren Standardplan
zusammenfassen. Der Nutzer kann ihn mit `OK`, `OK Standard` oder `OK Default`
gemeinsam bestätigen oder einzelne Abweichungen nennen.

Nennt der aktuelle Auftrag bereits genau einen absoluten Steuerfallpfad, die
vollständige Liste absoluter Belegordner und ausdrücklich `OK Standard` oder
die gleichwertige Bestätigung des unten beschriebenen Standardplans, gelten
die beiden fachlichen Antworten und der Standardplan für diesen Auftrag als
bestätigt. Frage sie nicht erneut. Eine allgemeine Bitte „prüfe meine
Steuererklärung“ ohne diese Angaben ist keine solche Bestätigung.
`Standard-Prüflauf ausführen` ist eine solche
gleichwertige Bestätigung, ebenso die kombinierte Formel
`Standard-Einrichtung und Prüflauf ausführen` aus der Installationsanleitung;
bei ihr läuft die Prüfung direkt nach dem Setup in derselben Sitzung über die
lokale API-CLI, ohne auf den MCP-Neustart zu warten. Beide umfassen nur die
unten definierten sicheren Schritte: hashverifizierte Prüffallkopie,
sichtbare read-only Navigation, Report, kein Speichern, keiner ELSTER-Aktion.

Diese Formel legt zugleich den fachlichen Umfang fest und gilt damit als
fachlicher Prüfauftrag. Sie verlangt mehr als das Auswerten des
Programm-Prüfers:

1. den Programm-Prüfer öffnen und auswerten;
2. die Eingaben des Falls entlang des linearen Pfads lesen, nicht nur die vom
   Prüfer gemeldeten Stellen;
3. sie gegen die bestätigten Belege abgleichen;
4. Fehlendes, Widersprüchliches und Auffälliges benennen, auch wenn der
   Programm-Prüfer dazu schweigt;
5. erkennbar ungenutzte Möglichkeiten nennen, sofern sie sich aus den
   vorliegenden Daten und offiziellen Quellen ergeben.

Ohne bestätigte Belege entfallen die Punkte 3 und 4 für den Belegabgleich; der
Bericht muss das dann ausdrücklich sagen.

`Standard-Prüflauf ausführen` bestätigt zugleich, dass die im selben Auftrag
genannten Belegpfade für diese Prüfung vollständig sind, einschließlich der
Angabe „keine Belege“. Ein zusätzlicher Satz wie „Diese Pfade sind
vollständig“ ist dann nicht nötig; frage die Vollständigkeit nicht erneut ab.
Fehlt dagegen jede Belegangabe, ist die zweite fachliche Frage weiterhin
offen und muss gestellt werden.

## Weiterlesen nach einem Navigations-Stopp

SSE kann beim bloßen Navigieren die zuletzt besuchte Seite als ungespeicherte
Änderung markieren. Meldet die Prüffallkopie `ungespeichert=true`, endet der
Prüflauf dort nicht — er wechselt die Kopie:

1. Die Prüffallkopie mit `discardChanges=true` schließen.
   `Standard-Prüflauf ausführen` bestätigt genau dieses Verwerfen bereits:
   verworfen wird nur der reine Navigationszustand einer hashverifizierten
   Kopie, nie der Originalfall und nie eine echte Eingabe. Nach dem Schließen
   `stillRunning=false`, Fenster, Health sowie die unveränderten Hashes von
   Original und Kopie zurücklesen.
2. Dieselbe Kopie erneut öffnen und ausschließlich die noch ungelesenen
   Abschnitte lesen. Bereits Gelesenes nicht wiederholen.
3. Höchstens zwei solcher Neustarts je Prüflauf. Blockiert derselbe Zustand
   danach weiterhin, endet der Lauf mit einem ehrlichen Teilbericht, der die
   ungelesenen Abschnitte einzeln benennt.

## Bearbeiten im Original auf ausdrücklichen Wunsch

Standard bleibt die Arbeitskopie. Verlangt der Nutzer aber ausdrücklich, die
Änderung im Originalfall selbst vorzunehmen („im Original, keine
Arbeitskopie“), ist genau das zu tun — die Sicherheit kommt dann aus der
Sicherung, nicht aus einer Verweigerung:

1. Vorbedingungen: Der Fall ist laut `sse_list_cases` nicht übermittelt und
   es liegt kein Recovery-Zustand vor. Ein bereits übermittelter Fall wird
   nie bearbeitet, auch nicht auf Wunsch.
2. Sicherung anlegen: `sse_make_working_copy` mit dem Original als Quelle und
   einem neuen, datumseindeutigen Ziel in `backups:`. Der bestätigte
   Hashvergleich der Sicherung ist der Rückweg; ohne bestandene Sicherung
   wird das Original nicht geöffnet.
3. Vor der ersten Änderung dem Nutzer in einem Satz nennen: was geändert
   wird, dass es das Original ist, und unter welcher `backups:`-Referenz die
   Sicherung liegt. Das ist die Warnung — nach dem ausdrücklichen Wunsch
   braucht es keine weitere Rückfrage.
4. Danach gilt unverändert der Schreibvertrag: je Änderung Hash-, Fenster-
   und Zustandsbindung mit sofortigem Readback, Speichern nur hashgebunden
   über `sse_save`, ELSTER bleibt gesperrt.
5. Im Abschlussbericht beide Hashes nennen: den der Sicherung (Zustand vor
   der Änderung) und den des gespeicherten Originals — damit der Rückweg
   jederzeit belegt ist.

Fehlt der ausdrückliche Wunsch, bleibt es beim Arbeitskopien-Standard.

## Kandidaten nur oberflächlich suchen

Suche vor den beiden Fragen kurz und ausschließlich anhand von Dateisystem-
Metadaten. Öffne dabei weder Steuerfälle noch Dokumentinhalte.

Beginne mit bereits konfiguriertem `caseDir` und gespeicherten `sourceFolders`.
Falls sie fehlen, prüfe nur vorhandene lokale Windows-Standardorte:

- Dokumente, Desktop und Downloads des aktuellen Nutzers;
- einen bereits lokal verfügbaren OneDrive-Dokumentordner, ohne Online-Dateien
  herunterzuladen;
- darin naheliegende Ordnernamen wie `Steuerfälle`, `Steuer`, `Belege`,
  `Rechnungen` oder `Buchhaltung`.

Für Steuerfälle verwende die vom installierten Release veröffentlichten
Profile und Fallarten. Ist das Release noch nicht vorhanden, dienen Jahr und
übliche SSE-Falldateiendungen nur zur Kandidatensuche; validiere den Treffer
nach der Installation gegen das echte Profil.

Begrenze die Vorschau pro Stammordner auf drei Ebenen, insgesamt höchstens 100
Treffer und wenige Sekunden. Überspringe Reparse Points, nicht erreichbare
Ordner und Zugriffsfehler. Durchsuche niemals das gesamte Laufwerk,
`AppData`, Browserprofile, Passwortspeicher, `.ssh`, Systemordner, Netzwerk-
laufwerke oder nicht lokal verfügbare Cloud-Inhalte. Zeige keine langen
Dateilisten und keine Dokumentinhalte.
Schließe außerdem Release-, Download-, Paket-, Skill-, Cache-, `node_modules`-
und Agentenordner als Belegkandidaten aus. Ein Ordnername mit „steuer“ im
installierten Produkt oder Quellcode ist kein Belegindiz.

Die Vorschau darf nur Typ/Jahr des Falls, Ordner, Änderungszeit und bei
Belegordnern eine grobe Anzahl passender Dateien nennen. Ein Treffer ist noch
keine Lesefreigabe.

## Die zwei Fragen

Stelle immer nur eine Frage pro Nachricht.

### 1. Steuerfall bestätigen

Bei genau einem plausiblen Treffer:

> Ich habe einen passenden Steuerfall für <Jahr/Typ> im Ordner <Ordner>
> gefunden. Ist das der Fall, den ich nur lesend prüfen soll? Antworten Sie
> Ja, wenn Jahr, Typ und Ordner stimmen; andernfalls nennen Sie die Korrektur.

Bei mehreren Treffern nummeriere nur die wenigen plausiblen Kandidaten nach
Typ, Jahr, Ordner und Änderungszeit und bitte um die Nummer. Bei keinem Treffer
bitte den Nutzer, die Falldatei oder ihren Ordner zu nennen. Öffne vorher
nichts.

### 2. Belegordner bestätigen

Fasse die wenigen plausiblen Ordner zusammen und frage:

> Gehören diese Ordner zu den Belegen für den bestätigten Steuerfall, und ist
> die Liste für diese Prüfung vollständig? Sie können Ja, weitere Ordner oder
> „keine Belege“ antworten.

Ein leerer Belegbestand blockiert die reine SSE-Prüfung nicht. Der Bericht muss
dann klar sagen, dass kein Belegabgleich stattfand. Lies nur die ausdrücklich
bestätigten Ordner; Connectoren und andere Quellen bleiben unberührt.

## Ein gemeinsamer Standardplan

Erst nach beiden Antworten zeige kurz den tatsächlichen Plan. Standard ist:

- eine funktionierende vorhandene Installation wiederverwenden; sonst die
  beiden veröffentlichten npm-Pakete in den Arbeitsordner installieren;
- Node.js/npm, Python, Git oder PowerShell 7 nicht eigens installieren; fehlt
  Node.js, ist das eine Voraussetzung und ein Stopp, keine Aufgabe;
- einen privaten Standard-Arbeitsbereich außerhalb von Git verwenden;
- zunächst nur die direkte lokale Loopback-API und read-only arbeiten;
- vor sichtbarer UI-Navigation eine neue hashverifizierte Prüffallkopie neben
  dem Original erzeugen und ausschließlich diese öffnen; die Kopie bleibt als
  klar benannte lokale Prüfkopie bestehen, bis der Nutzer später ihre
  Archivierung oder Bereinigung beauftragt;
- bestätigte Quellen nur lesen und Originale unverändert lassen;
- kein Connector-Zugriff, keine Agenten-Konfigurationsänderung, kein
  Autostart, keine Steuerdatenänderung und keine ELSTER-Aktion.

Frage danach:

> Wenn dieser Standardplan passt, antworten Sie `OK`, `OK Standard` oder
> `OK Default`. Nennen Sie andernfalls nur die gewünschte Abweichung.

Diese Antworten bestätigen genau den gezeigten Plan einschließlich des nötigen
Downloads und der lokalen Standard-Setup-Dateien. Sie sind keine Freigabe für
spätere Steuerdatenänderungen, Connectoren, MCP-Konfigurationsänderungen,
Autostart oder ELSTER.

MCP ist eine optionale Produktfunktion: Die lokale API führt die Arbeit aus;
MCP verbindet einen kompatiblen Agenten damit. Ein reines API-Setup lässt MCP
weg. Ein ausdrücklich beauftragter vollständiger lokaler Standard mit „API plus
MCP“ enthält es nach gezeigtem Konfigurations-Diff.

Hat der Nutzer ausdrücklich einen kurzen NPX-Lauf ohne Installation verlangt
und Node.js 22+ mit npm ist bereits vorhanden, ersetzt dieser die Installation
im Ordner für den aktuellen Auftrag. Der Agent startet das API-Paket im
Vordergrund mit dem bestätigten Fallordner, verwendet die CLI aus demselben
Paket und beendet den Prozess nach dem Report wieder. MCP, Client-Merge und
Neustart gehören nicht zu diesem Kurzweg.

## Einrichten und Auftrag fortsetzen

Fehlt eine erreichbare API, richte sie jetzt ein, außer der Nutzer hat
ausdrücklich den NPX-Kurzweg bestätigt. Übernimm die bereits bestätigten Pfade
und den Standardplan; frage sie nicht erneut.

Es gibt kein Einrichtungsprogramm und keine Plandatei. Die vier Schritte stehen
in der kanonischen Anleitung
`https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md`:
Ordner anlegen, beide npm-Pakete und den Skill installieren, API mit absolutem
`--config`-Pfad starten, MCP-Server beim Client anmelden. Der erste API-Start
legt die Ressourcenbereiche selbst an; eine `config.json` ist optional.

Den bestätigten Fallordner bindest du über `--case-dir <absoluter Ordner>` an
den laufenden Prozess, nicht über eine geschriebene Datei. Dauerhafte
Vorlieben — Belegquellen, Prioritäten — gehören nach `settings.md` im
Arbeitsbereich, und dorthin nur mit ausdrücklicher Zustimmung.

Scheitert der Start, ändere `config.json` oder Runtime-Dateien nicht manuell
als Umgehung und beende keinen fremden Prozess. Melde den konkreten Stopp.

Nach erfolgreichem Setup kehre automatisch zum ursprünglichen Prüfauftrag
zurück. Setup allein erfüllt einen Auftrag wie „Prüfe meine Steuererklärung“
nicht. Stoppe nur bei einem echten Blocker und nenne dann genau eine nächste
sichere Aktion.

Lies anschließend `capabilities` und den Falltyp. Sage vor der Prüfung kurz,
welche gefundenen Module profiliert/live belegt, nur generisch read-only oder
nicht unterstützt sind. Unbekannte Module dürfen die unterstützte read-only
Prüfung nicht verdecken, aber unbekannte Controls werden nicht verändert.
