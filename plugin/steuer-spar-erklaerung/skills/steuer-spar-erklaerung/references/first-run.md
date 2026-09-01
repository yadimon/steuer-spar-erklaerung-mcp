# First-run-Wizard

Lies diese Referenz nur, wenn der richtige Arbeitsfall oder der vollständige
Belegumfang noch nicht eindeutig feststeht. Sie ist kein Installer und ändert
weder Clientkonfiguration noch Betriebssystem.

## Ziel

Der Wizard klärt nur, was für den ursprünglichen Auftrag nötig ist. Merke dir
diesen Auftrag unverändert, führe die Einrichtung nicht als neues Endziel ein
und setze ihn nach der Planbestätigung fort.

Stelle höchstens **eine Frage pro Nachricht**. Bereits beantwortete Fragen
nicht wiederholen.

## 1. Technischer Preflight

Rufe zuerst das echte MCP-Tool `sse_preflight` auf.

- Bei `ready=true` weiter zur Fallbindung.
- Bei einem stabilen Blocker dem angegebenen `nextTool` folgen und höchstens
  die eine dafür notwendige Frage stellen.
- Fehlt das MCP-Tool vollständig, keine Installerbefehle ausführen, keine
  Clientdatei verändern und keine Steuerdaten lesen. Bitte um Client-Neustart
  beziehungsweise Plugin-Reload und verweise bei weiterem Fehler auf
  `docs/INSTALLATION.md` im öffentlichen Repository.

Ein Handshake oder ein Shell-Aufruf von `health` ersetzt `sse_preflight` nicht.

## 2. Richtiger Steuerfall

Lies `sse_instances`.

- Ist genau ein Fall vollständig und eindeutig geöffnet, gewinnt dieser Fall.
  Frage nicht zusätzlich nach einem Dateipfad und öffne keine andere Datei.
- Sind mehrere Fälle offen, frage in einer Nachricht, welcher davon der
  Arbeitsfall ist. Nenne nur die redigierten, vom Tool gelieferten Merkmale.
- Ist kein Fall offen und enthält der Auftrag bereits einen eindeutigen
  absoluten Fallpfad, bestätige genau diesen Pfad, bevor du ihn öffnest.
- Fehlt auch dieser Pfad, frage nur nach der Falldatei. Suche nicht
  eigenmächtig das Laufwerk.

Eine ausdrücklich erlaubte begrenzte Suche bleibt innerhalb eines bestätigten
Ordners, folgt keinen Reparse Points und zeigt höchstens 100 Kandidaten.
Durchsuche niemals das gesamte Laufwerk, Benutzerprofil oder Netzlaufwerk.
`caseDir` ist eine Ressourcen-/Redaktionsgrenze, keine Fallauswahl und öffnet
nichts.

## 3. Vollständige Belegquellen

Wenn der Auftrag einen Belegabgleich verlangt, frage nach der vollständigen
Liste der freigegebenen Belegordner beziehungsweise nach der ausdrücklichen
Bestätigung „keine Belege“. Eine bereits vollständige Angabe nicht erneut
abfragen.

Externe Connectoren, E-Mail, Cloudspeicher, Bankkonten oder zusätzliche
Ordner erst nach separater Zustimmung lesen. Fehlende Belegquellen nicht durch
eine Laufwerks- oder Kontosuche erraten.

## 4. Sicheren Plan gemeinsam bestätigen

Zeige einen kurzen, auf den ursprünglichen Auftrag zugeschnittenen Plan. Er
nennt mindestens:

- den eindeutig gebundenen Arbeitsfall und die bestätigten Belegquellen;
- zuerst read-only lesen und inventarisieren;
- vor jeder dirty-fähigen Navigation oder Mutation den unveränderten
  Dateistand einmal hashverifiziert nach `backups:` sichern;
- jede Änderung sofort zurücklesen;
- nicht speichern, schließen, verwerfen oder Save As verwenden, sofern das
  nicht ausdrücklich separat beauftragt ist;
- niemals über ELSTER senden oder übermitteln.

Bitte um genau eine Bestätigung dieses Plans. Neue Pfade, Connectoren,
Arbeitskopien oder Speicheraktionen sind eigene Entscheidungen und dürfen nicht
in einem vagen „Standard“ versteckt werden.

## 5. Ursprünglichen Auftrag fortsetzen

Nach Bestätigung ohne neue Einrichtungsrunde zum gemerkten Auftrag
zurückkehren. Bindung, Quellen und Entscheidungen weiterverwenden. Vor der
ersten dirty-fähigen Aktion die detaillierte
[Fallsitzung](case-session.md) anwenden.

Ein technischer First run ist nicht der Abschluss von „prüfe meine
Steuererklärung“. Berichte am Ende über den fachlichen Auftrag und den
Speicher-/Übermittlungsstatus, nicht über die Installation.

## Isolierte Prüffallkopie

Der eindeutig geöffnete persönliche Fall bleibt der Standard. Nur wenn der
Nutzer ausdrücklich einen isolierten Audit oder eine Prüffallkopie verlangt,
darf der bestätigte Plan eine neue hashverifizierte Kopie vorsehen. Ziel muss
neu und eindeutig sein; Original und bereits übermittelte Fälle bleiben
unverändert. Nach dem Audit nur gemäß ausdrücklich bestätigtem Close-/Discard-
Plan handeln.
