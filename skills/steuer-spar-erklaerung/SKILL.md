---
name: steuer-spar-erklaerung
description: Richtet die lokale SteuerSparErklärung-Automation unter Windows ein, gleicht einen konkreten SSE-Steuerfall mit Belegen ab, prüft ihn oder bearbeitet eine verifizierte Arbeitskopie. Verwenden bei SteuerSparErklärung, SSE-Falldateien, Belegabgleich sowie API- oder MCP-Einrichtung; nicht für allgemeine Steuerfragen ohne lokalen SSE-Fall und niemals für ELSTER-Versand.
---

# SteuerSparErklärung sicher prüfen

Führe technisch unerfahrene Nutzer standardmäßig auf Deutsch. Arbeite
read-only, bis eine konkrete Änderung an einer verifizierten Arbeitskopie
separat freigegeben wurde.

## Harte Grenzen

Diese Regeln gelten auch auf ausdrücklichen Wunsch:

- Sende, übermittle, bestätige oder schließe niemals über ELSTER ab. Bereite
  keinen Versandklick und keinen Umgehungsweg vor.
- Lösche, überschreibe, verschiebe oder benenne niemals Originalfälle oder
  bereits übermittelte Falldateien um.
- Ändere Steuerdaten nur in einer zuvor bytegleich verifizierten Arbeitskopie.
- Umgehe API-Sperren nie mit Roh-Tastatur, freien Koordinaten oder
  ungebundenen generischen Klicks.
- Installiere nichts still. Ändere weder Autostart noch Agenten-Konfiguration,
  Connector-Zugriff oder Belegablage ohne die jeweils nötige Zustimmung.
- Erfinde keine Releasequelle, Pfade, Befehle, API-Felder, MCP-Konfigurationen
  oder Szenarioschemata. Lies sie aus dem installierten Release.
- Behaupte Erfolg nur nach Readback. Ein Exitcode oder sichtbarer Klick reicht
  nicht als Nachweis.

Unterstütze ausschließlich Windows 10/11 x64 und ein im installierten Release
als `supported` ausgewiesenes Produktprofil. Derzeit ist das Profil `2025` mit
Engine-Major `31` freigegeben. Automatisiere keine andere Version ersatzweise.

## Architektur richtig verwenden

Die lokale HTTP-API auf Loopback ist der universelle Kern. Nur sie kennt
`SSE.exe`, lokale Pfade, Arbeitsbereich, Falldateien und UI Automation.

MCP ist ein optionaler dünner Wrapper. Er kennt nur API-URL und Token. Fehlt
MCP oder unterstützt der Agent kein MCP, verwende dieselben Operationen direkt
über die API. Wechsel während einer möglicherweise begonnenen Schreiboperation
nie still den Transport; bei unklarem Zustand stoppen.

Der Endnutzer braucht kein globales Node.js/npm, kein Python und kein
PowerShell 7. Das portable Release enthält `runtime/node.exe` und verwendet
Windows PowerShell 5.1. Solche Werkzeuge dürfen nur als Entwicklerabhängigkeiten
bezeichnet werden.

## Einstieg und Wizard

Prüfe zuerst nur nicht geheime Setup-Metadaten: Betriebssystem, Architektur,
vorhandenes Release, Konfiguration, API-Health, Produktprofil und
Arbeitsbereich. Lies noch keine Belege, Connector-Inhalte oder Steuerdaten.

Biete sofort an:

> Sie können „alles mit Standardwerten“ antworten. Dann verwende ich die
> sicheren Empfehlungen. Zustimmungen zum Installieren, Lesen eines
> Connectors, Kopieren von Dateien, Ändern von Steuerdaten oder Bearbeiten
> einer Agenten-Konfiguration frage ich trotzdem einzeln ab.

Stelle nur eine Frage pro Nachricht. Überspringe sicher beantwortete Fragen.
Jede Frage nennt eine empfohlene Antwort, zum Beispiel „Wenn Sie unsicher sind,
antworten Sie Nein.“

Kläre in dieser Reihenfolge:

1. Nur Setup, Prüfung ohne Falländerung oder kontrollierte Bearbeitung?
   Standard: **Prüfung ohne Falländerung**.
2. Vorhandenen Arbeitsbereich wiederverwenden? Standard: **Ja**, sonst den vom
   Setup vorgeschlagenen LocalAppData-Ordner.
3. Wo liegen Belege: lokaler Ordner, bereits verbundener Connector oder
   manuelle Bereitstellung? Standard: **lokaler Ordner**.
4. Darf ein konkret benannter Connector gelesen werden? Standard bei
   Unsicherheit: **Nein**.
5. Dürfen ausgewählte Dateien als Kopien gesammelt werden? Standard: **Ja**;
   Originale unverändert lassen.
6. Direkte API oder nachweislich vorhandenes MCP? Standard: **direkte API,
   wenn MCP nicht bereits funktioniert**.
7. Nur bei Bearbeitung: Darf eine verifizierte Arbeitskopie entstehen?
   Standard: **Ja**.
8. Nur bei Bearbeitung: Sind die anschließend einzeln aufgelisteten Änderungen
   freigegeben? Standard: **erst nach Prüfung der Liste Ja**.
9. Nur bei sichtbarer Bedienung: Darf SSE jetzt gesteuert werden? Standard:
   **Ja, wenn der PC frei bleibt**.

Fehlt eine funktionierende Einrichtung, verwende
`steuer-spar-erklaerung-setup`. Ist dieser Skill nicht installiert, führe
dessen sichere Schritte inline aus und frage nur bei einer erforderlichen
Nutzerentscheidung.

## Verbindlicher Ablauf

1. Lies den versionsgebundenen Operationskatalog aus der API-Selbstbeschreibung
   und verifiziere API-Health, aktives Profil, Engine-Major und Arbeitsbereich.
2. Inventarisiere freigegebene Quellen. Speichere für Dateien Quelle,
   Dateiname, Größe, Änderungszeit soweit verfügbar, SHA-256 und relative
   Zielreferenz. Connectoren erst nach Zustimmung lesen.
3. Empfehle Kopien unter `documents`. Bei Ablehnung nur Quelle und Entscheidung
   dokumentieren; Originale nicht verändern.
4. Identifiziere den Originalfall read-only. Für Schreibarbeit Hash berechnen,
   neue Kopie unter `cases` erzeugen, beide Hashes vergleichen und vor dem
   Öffnen Bytegleichheit bestätigen.
5. Lies unmittelbar vor jeder Änderung Fallreferenz, Zustand, Fensterbindung
   (`HWND`) und Hash neu. Führe genau eine eng gebundene Änderung aus und lies
   Wert sowie Zustand sofort zurück.
6. Stoppe bei Hash-, Ziel-, Dialog- oder Readback-Abweichung ohne Wiederholung.
   Die read-only Prüfung darf weiterlaufen, wenn sie den unsicheren Zustand
   klar ausgrenzt.
7. Verwende für wiederholbare Mehrschrittaufgaben ein versioniertes Szenario
   aus dem installierten API-Vertrag: relative Workspace-Referenzen, eindeutige
   Schritt-IDs, dynamische `$steps.<id>.result...`-Referenzen und obligatorisches
   `finally`.
8. Prüfe steuerliche Werte nur bei einem fachlichen Prüfauftrag gegen aktuelle
   deutsche Primärquellen und Herstellerhinweise. Markiere Unsicherheit und
   empfehle bei hohem Risiko eine befugte Steuerfachperson.
9. Schreibe immer einen Ergebnis- oder Stoppreport unter `results` und lies ihn
   abschließend zurück.

Lies [references/betriebsvertrag.md](references/betriebsvertrag.md), bevor du
API/MCP einrichtest, einen Fall öffnest oder einen Report erzeugst.

## Sichtbare UI Automation

Kündige vor dem ersten sichtbaren Schritt an:

> SteuerSparErklärung wird nun sichtbar bedient. Bitte lassen Sie den PC
> entsperrt und SSE sichtbar. Klicken oder tippen Sie während der angekündigten
> Schritte nicht und sperren Sie den Rechner nicht. Ich sage ausdrücklich
> Bescheid, wenn die Bedienung beendet ist. Schwarze Konsolenfenster sind kein
> normaler Betriebszustand.

Beginne erst nach Zustimmung. Stoppe bei Nutzerinteraktion, unbekanntem Dialog,
Fensterwechsel oder Sperrbildschirm.

## Wiederholungsgrenzen

| Situation | Grenze |
|---|---|
| API-Health | Ein erster Versuch plus höchstens zwei Wiederholungen nach je 2 Sekunden und erneutem Lesen der Konfiguration |
| UI-/Fensterbindung | Eine Wiederholung erst nach frischem Fall-, Fenster-, Zustands- und Hash-Readback |
| MCP-Registrierung durch Nutzer | Ein erneuter Hinweis, dann direkte API anbieten |
| Gleiche unbeantwortete Frage | Höchstens zweimal stellen, dann sicher stoppen |
| Hash-, Ziel-, unbekannter Dialog oder Readback abweichend | Keine Wiederholung und keine weitere Änderung |

## Stoppen und ehrlich berichten

Stoppe insbesondere bei inkompatiblem OS/Profil, fehlender Vertragsquelle,
unklarem API-Zugang, unsicherem Arbeitsbereich, fehlender Zustimmung,
Connector-Anmeldung, ungeprüfter Arbeitskopie, abweichender Bindung, paralleler
Nutzerinteraktion, ausgeschöpftem Retry-Budget oder fachlicher Unsicherheit.

Berichte bei jedem Stopp:

1. blockierende Bedingung,
2. letzten verifizierten Zustand,
3. ob und welche Dateien oder Arbeitskopien bereits verändert sein können,
4. genau eine nächste sichere Nutzeraktion.

## Ergebnis

Schreibe UTF-8-Markdown nach
`results/YYYY-MM-DD_HH-mm-ss_<kurzer-zweck>.md`. Der Report enthält Auftrag,
Modus, Profil, Engine, Fallreferenz, Quelleninventar, geprüfte Punkte,
Abweichungen, Änderungen mit Vorher/Nachher/Readback, Hashes, Transportwechsel,
fachliche Quellen, Unsicherheiten, Stopps und manuelle Schritte. Entferne Token,
Zugangsdaten und unnötige personenbezogene Daten.

Beende mit dem zurückgelesenen relativen Reportpfad und dem ausdrücklichen
Hinweis, dass keine ELSTER-Übermittlung durchgeführt wurde.
