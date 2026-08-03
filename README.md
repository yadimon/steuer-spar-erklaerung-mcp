# Inoffizielle API und MCP für SteuerSparErklärung 2025

**Ist deine Steuererklärung wirklich vollständig? Lass sie von deinem
KI-Agenten zusätzlich prüfen – direkt in SteuerSparErklärung 2025.**

> **Öffentliche Beta für Windows:** Vor produktiver Nutzung Sicherungskopien
> anlegen und die vom Agenten gemeldeten Ergebnisse selbst prüfen. Dieses
> Projekt ist keine Steuerberatung und garantiert keine fachlich richtige
> Steuererklärung.

## Am einfachsten starten

### Ohne npm: diesen Text kopieren

**Skill starten:** Gib einem Agenten mit GitHub- und lokalem Kommandozugriff
diesen Text:

```text
Öffne https://github.com/yadimon/steuer-spar-erklaerung-mcp und lies
skills/steuer-spar-erklaerung/SKILL.md. Folge diesem Skill auf Deutsch.
Prüfe meinen vorhandenen Fall in SteuerSparErklärung 2025 zunächst nur lesend.
Stelle eine Frage pro Schritt, verwende sichere Standardwerte und ändere nichts
ohne meine ausdrückliche Freigabe.
```

Der Agent lädt nach Zustimmung das portable Release, prüft dessen SHA-256 und
führt durch die Einrichtung. Dafür müssen weder npm noch Node.js, Python,
PowerShell 7 oder ein MCP-Server installiert sein. Kann der Agent GitHub oder
lokale Programme nicht selbst öffnen, lädt der Nutzer das portable ZIP manuell
herunter und startet `sse-setup.cmd`.

### Mit `npx skills`: Skill installieren

```powershell
npx skills add yadimon/steuer-spar-erklaerung-mcp --skill steuer-spar-erklaerung
```

Danach genügt zum Beispiel:

```text
Prüfe meine Steuererklärung in SteuerSparErklärung 2025. Beginne read-only,
gleiche sie mit meinen Belegen ab und ändere nichts ohne meine Freigabe.
```

`npx` installiert nur den Text-Skill. Die eigentliche Automation läuft auch
hier über das portable Release ohne globale Laufzeitinstallation.

## Was dieses Projekt ist

Eine inoffizielle lokale Windows-Automation, mit der ein KI-Agent die
**SteuerSparErklärung** (Wolters Kluwer Steuertipps / Akademische
Arbeitsgemeinschaft) kontrolliert bedienen kann: Steuerfälle inventarisieren
und öffnen, Seiten auslesen, Belege abgleichen, Werte vergleichen und
verifizierte Arbeitskopien bearbeiten.

Die Produktgrenze kommt aus versionierten Profilen unter `profiles/`. Aktuell
ist nur Profil `2025` mit binärer Engine-Hauptversion 31 produktiv freigegeben.
Andere Jahresversionen werden höchstens gemeldet, niemals bedient.

> **Der Server übermittelt nichts ans Finanzamt.** Alle ELSTER- und
> Versandwege sind fest gesperrt. Siehe [Sicherheit](#sicherheit).

Dies ist ein unabhängiges Open-Source-Projekt. Es ist weder mit Wolters Kluwer,
Steuertipps oder der Akademischen Arbeitsgemeinschaft verbunden noch von ihnen
freigegeben. Produkt- und Markennamen gehören ihren jeweiligen Inhabern.

## Einfache Anwendungsfälle

| Ziel | Beispiel für den Agenten | Standardverhalten |
| --- | --- | --- |
| **Schnell prüfen** | „Prüfe meinen geöffneten Steuerfall und liste Fehler, Warnungen und unklare Angaben.“ | Nur lesen, nichts verändern |
| **Mit Belegen abgleichen** | „Vergleiche meinen Steuerfall mit den Belegen in diesem Ordner und erstelle einen Abweichungsbericht.“ | Belege nur nach Zustimmung lesen; Originale unverändert lassen |
| **Kontrolliert korrigieren** | „Schlage Korrekturen vor und ändere nach meiner Freigabe nur eine verifizierte Arbeitskopie.“ | Erst Änderungsliste zeigen; jede Änderung zurücklesen |
| **Nur einrichten** | „Richte die portable SteuerSparErklärung-API ein. Wenn ich unsicher bin, verwende die empfohlenen Antworten.“ | Eine Frage pro Schritt; MCP bleibt optional |

Während sichtbarer Bedienung muss Windows entsperrt bleiben. Der Nutzer darf in
dieser kurzen Phase nicht selbst klicken oder tippen; der Agent kündigt Anfang
und Ende ausdrücklich an.

## Demo in weniger als fünf Sekunden

![MCP öffnet eine Musterfall-Kopie, trägt einen synthetischen Wert ein und startet den Steuerprüfer](docs/assets/demo/steuer-spar-erklaerung-demo.gif)

Die kurze Tippsequenz am Anfang ist ein neutral nachgebauter Agent-Prompt; sie
enthält weder einen echten Codex-Chat noch private Desktopdaten. Die danach
gezeigten Programmframes stammen aus einem echten automatisierten Testlauf mit
dem von SteuerSparErklärung installierten Musterfall
`MusterSteuer1.ESt2025`. Die lokale API öffnet eine bytegleiche Temp-Kopie, der
MCP-Wrapper setzt den synthetischen Wert `01.01.2000`, liest ihn zur Kontrolle
zurück und startet den Steuerprüfer. Es wird nichts gespeichert; beim Schließen
wird die Änderung verworfen. Das
[strukturierte Demo-Ergebnis](docs/assets/demo/demo-result.json) hält den Lauf
ohne lokale PC-Pfade fest.

## Was ein Nutzer erhält

- eine lokale, token-geschützte HTTP-API als universellen Kern;
- einen optionalen MCP-Wrapper, der nur diese API aufruft und keine PC-Pfade
  kennen muss;
- ein portables Windows-x64-ZIP mit eigener Node-Laufzeit;
- einen deutschen Setup-Wizard und fensterlosen API-Starter;
- zwei öffentliche deutsche Agent-Skills für Betrieb und Einrichtung;
- versionierte Produktprofile, API/MCP-Paritätstests und einen komplexen
  Szenario-Test mit reproduzierbarer Ergebnisdatei.

Für die reine API-Nutzung muss kein MCP installiert werden. Ein MCP-fähiger
Agent startet bei Bedarf nur den enthaltenen Wrapper. Endnutzer installieren
weder Node/npm noch Python oder PowerShell 7 global.

Die Skills liegen im öffentlichen Standardlayout. `agents/openai.yaml`
verbessert die Codex-Darstellung; der normale `SKILL.md` bleibt zugleich mit
Claude Code und anderen Agent-Skills-kompatiblen Clients verwendbar. Der
Haupt-Skill kann fehlende Setup-Schritte selbst durchführen; der zweite Skill
ist ein direkter Einstieg für reine Installations- oder Reparaturaufträge.

## Warum ein eigener Server statt eines allgemeinen Windows-MCP

Es gibt gute allgemeine UI-Automation-Server (`mcp-windows`,
`uiautomation-mcp`). Für dieses Programm reichen sie nicht, weil dessen
UIA-Anbieter (Qt 6) drei Eigenheiten hat, die einen naiven Client zerstören:

1. `FindAll(Descendants, …)` läuft in Timeout oder `E_UNEXPECTED`.
2. Danach ist die UIA-Verbindung des **gesamten Prozesses** vergiftet: jede
   weitere Abfrage liefert still „0 Treffer" statt eines Fehlers. Ein Agent
   hält das für eine leere Seite und zieht falsche Schlüsse.
3. `GetNextSibling` auf dem ausgewählten Navigationsknoten liefert unbegrenzt
   denselben Knoten — ein Baumlauf ohne Zyklussperre endet nie.

Dieser Server umgeht alle drei: **ein frischer Prozess pro Aufruf**,
ausschließlich `TreeWalker` mit Zyklussperre, und ein Kanarienvogel-Test, der
Überlastung erkennt, *bevor* falsche Daten zurückgemeldet werden.

Die Win32-/MSAA-Brücke wird beim Build einmalig als `sse-native.dll`
kompiliert. Der frische Worker lädt danach die DLL, statt drei C#-Blöcke je
Action neu zu kompilieren. Fehlt die DLL oder ist sie inkompatibel, kompiliert
er fail-safe aus `sse-native.cs`. Ein SHA256-Sidecar bindet die DLL an genau
diesen Quellstand; bei Drift wird die DLL nie geladen. Auch der Launcher für
den versteckten Desktop nutzt dieselbe Brücke statt eigener C#-Kompilierung.
Gemessen ohne laufendes SSE nach der Hashbindung: Worker-Median
ca. 0,130–0,156 s statt 0,41–0,44 s; kompletter Aufruf ca. 0,857–0,890 s statt
1,24–1,30 s. Vier vollständige Hidden-Lifecycle-Läufe lagen nach beiden
Optimierungen bei 36,50–37,04 s (Median 36,92 s) statt zuvor rund 43,5 s.
UI-Laufzeiten kommen bei geöffnetem Formular zusätzlich hinzu.

## Portable Release manuell einrichten

Für Endnutzer ist das portable ZIP der Standard. Die Mindestanforderungen hängen
von der gewählten Bereitstellungsart ab:

- [Portable ZIP v0.1.0-beta.2](https://github.com/yadimon/steuer-spar-erklaerung-mcp/releases/download/v0.1.0-beta.2/steuer-spar-erklaerung.zip)
- [SHA-256-Prüfsumme](https://github.com/yadimon/steuer-spar-erklaerung-mcp/releases/download/v0.1.0-beta.2/steuer-spar-erklaerung.zip.sha256)

| Verwendung | Erforderlich | Nicht erforderlich |
| --- | --- | --- |
| **Portable ZIP (empfohlen)** | Windows 10/11 x64, installierte SteuerSparErklärung 2025 (Engine-Hauptversion 31), entsperrte interaktive Windows-Sitzung während sichtbarer UI-Aktionen | separat installiertes Node.js/npm, Python, PowerShell 7, MCP bei direkter API-Nutzung |
| **Aus dem Quellcode** | Windows 10/11 x64, Node.js 22 oder neuer mit npm, installierte SteuerSparErklärung 2025, entsperrte interaktive Sitzung für UI-Aktionen | Python, PowerShell 7, MCP bei direkter API-Nutzung |
| **Entwicklung aus dem Repository** | Windows 10/11 x64, Node.js 22 oder neuer mit npm; SteuerSparErklärung 2025 nur für echte UI-/Integrationstests | Python, PowerShell 7 |

Windows PowerShell 5.1 gehört zu den unterstützten Windows-Versionen und wird
von API und Build direkt verwendet. Das portable ZIP enthält zusätzlich eine
fest versionierte, per SHA-256 geprüfte Node-Laufzeit (aktuell Node.js 22.22.3).
Es installiert weder Node.js noch npm global und verändert keine systemweite
Node-Installation.

Nach dem Entpacken `sse-setup.cmd` ausführen oder den Setup-Skill verwenden. Der
deutschsprachige Wizard schreibt außerhalb des Produktordners:

- die lokale API-Konfiguration mit zufälligem Token;
- eine PC-neutrale MCP-Mergevorlage;
- einen zur gewählten Konfiguration passenden fensterlosen VBS-Starter.

Der MCP kennt nur `SSE_API_URL` und `SSE_API_TOKEN`. Reale SSE-, Fall-,
Dokument-, Arbeits-, Ergebnis- und Sicherungspfade bleiben ausschließlich in
der API-Konfiguration. Der MCP verwendet logische Referenzen wie
`cases:fall.Gew2025` oder `results:bericht.json`.

Direkter API-Start aus einem entpackten Release:

```powershell
& '<PORTABLE>\runtime\node.exe' '<PORTABLE>\dist\api-main.js' --config '<lokale-config.json>'
```

Der erzeugte VBS-Starter führt denselben Befehl ohne Konsolenfenster aus.

Die API bindet ausschließlich an `127.0.0.1` oder `::1`, verlangt ein
Bearer-Token, akzeptiert nur explizit freigegebene Operationen und protokolliert
weder Argumente noch Ergebnisse. Alle 80 Operationsargumente werden gegen den
gemeinsamen strikten API-/MCP-Katalog geprüft, bevor ein UI-Worker startet;
unbekannte oder unvollständige Felder liefern `400 bad-args`. Für einen
bestätigten fensterlosen Autostart steht `powershell/install-api-task.ps1`
bereit; das Setup registriert ihn nie ungefragt.

Die vom Setup erzeugte Mergevorlage in die Konfiguration des jeweiligen
MCP-Clients mergen; vorhandene Konfiguration nie blind ersetzen:

```json
{
  "mcpServers": {
    "steuer-spar-erklaerung": {
      "command": "<PORTABLE>/runtime/node.exe",
      "args": ["<PORTABLE>/dist/index.js"],
      "env": {
        "SSE_API_URL": "http://127.0.0.1:43127",
        "SSE_API_TOKEN": "<LOKALES_TOKEN>"
      }
    }
  }
}
```

`<PORTABLE>` und das Token lokal ersetzen. Keine echten Fallpfade oder Token in
dieses Repository oder in geteilte Konfigurationsbeispiele übernehmen.

## Entwicklung und Release-Build

Nur die Ausführung aus dem Quellcode und die Entwicklung benötigen Node/npm.
Für den reproduzierbaren portable Release-Build gilt die in
`portable/runtime.json` gepinnte Node-Version 22.22.3. Separate PowerShell- und
Python-Installationen sind auch für den Build nicht erforderlich; der native
Helfer wird mit dem Windows-eigenen PowerShell 5.1 gebaut.

```powershell
npm ci
npm test
npm run package:portable
```

`package:portable` führt einen sauberen `npm ci --omit=dev` aus dem Lockfile
durch, prüft Version und offiziellen SHA-256 der eingebetteten Node-Laufzeit
und erzeugt ZIP plus `.sha256` unter `artifacts/portable/`. Der Build kompiliert
außerdem `sse-native.dll`. `sse_product_info.workerInitializationMs` zeigt, ob
die geprüfte DLL (`precompiled-dll`) oder der sichere Quelltext-Fallback geladen
wurde.

Für eine spätere npm-Veröffentlichung sind drei CLI-Einstiege vorbereitet:
`steuer-spar-erklaerung-api`, `steuer-spar-erklaerung-mcp` und
`steuer-spar-erklaerung-setup`. Das Paket bleibt bis zu einem ausdrücklich
freigegebenen Release auf `private: true`; der Endnutzer-Standard ist weiterhin
das portable ZIP ohne globale npm-Installation.

Direkter API-Aufruf und MCP verwenden denselben Worker-Codepfad. Beispiel:

```powershell
$body = @{ args = @{}; timeoutMs = 90000 } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post `
  -Uri 'http://127.0.0.1:43127/v1/operations/health' `
  -Headers @{ Authorization = 'Bearer <LOKALES_TOKEN>' } `
  -ContentType 'application/json' -Body $body
```

Relative Text-/JSON-Eingaben werden mit `sse_workspace_*` verwaltet.
Enthält gelesener Text einen lokalen PC-Pfad, meldet MCP `textRedigiert=true`
und sperrt das Zurückschreiben des Redaktionsplatzhalters. Für den CSV-Export
kann die API einen neuen leeren `results:`-Unterordner sicher anlegen; bei einem
fehlgeschlagenen Exportstart wird ein leer gebliebener Restordner entfernt.
`sse_run_scenario` führt einen seriellen Ablauf aus und schreibt eine
kanonische Ergebnisdatei. Ein vorhandenes Ergebnis darf nur mit dem zuvor
gelesenen `expectedResultSha256` ersetzt werden.
Der versionierte komplexe Kontrollfall liegt unter
`test/scenarios/complex-wrapper/`; direkter API-Aufruf und echter MCP-Wrapper
müssen beide bytegleich `expected-result.json` mit SHA-256
`13f088c95aab8dc622ac2ef3c494c8b05afe29fb5c7f09d155927c5857c3a214`
erzeugen.

## Betriebswissen

- [Haupt-Skill](skills/steuer-spar-erklaerung/SKILL.md): öffentlicher deutscher
  Einstieg für Setup, Prüfung und kontrollierte Arbeitskopien.
- [Setup-Skill](skills/steuer-spar-erklaerung-setup/SKILL.md): portable
  Installation, API-Start und optionale Agenten-MCP-Anbindung.
- [Entwicklungserfahrungen](docs/entwicklung/erfahrungen/sse-automation-erfahrungen.md):
  getrenntes internes Wissen über gemessene Fehlwege, Nachbedingungen und
  Backlog; wird von Runtime-Skills nicht geladen.
- [Sanitisierte Abgleichvorlage](docs/ABGLEICH-BEISPIEL.md): neutrale Struktur
  für einen Fallabgleich ohne echte Namen, Beträge oder Pfade.

Roh-Screenshots, OCR, Navigationsexporte und UI-Snapshots gehören nur nach
`.tmp/`; dieser Ordner wird nicht versioniert.

## Werkzeuge

| Werkzeug | Zweck |
|---|---|
| `sse_product_info` | Installierte/r laufende SSE-Versionen und die erzwungene 2025-/Engine-31-Grenze lesen |
| `sse_health` | Läuft das Programm, ist es ansprechbar? Kanarienvogel-Messung |
| `sse_windows` | Sichtbare Fenster, erkennt modale Dialoge |
| `sse_center_cases` | Read-only Fallliste des Steuertipps-Centers im Modus „Verzeichnis“, gegen primäre ESt-/Gew-Dateien im Ordner abgeglichen |
| `sse_center_refresh` | Center-Fallliste ohne Dateiänderung über den gebundenen Verzeichnis-Umschalter aktualisieren und vorher/nachher lesen |
| `sse_screenshot` | Fensterfoto (funktioniert im Hintergrund) |
| `sse_warning_popup_read` | Automatische „Die Prüfung hat ergeben …“-Hinweise: UIA-Titel/Aktionen plus optionale lokale OCR des Qt-Fließtexts; Kontrollbild direkt im MCP-Transport |
| `sse_result_details` | PID-gebundene Ergebnistabelle mit Vollständigkeits-, Kopf- und Differenzinvariante |
| `sse_ui_state` | Konsistenter PID/HWND- und SHA256-gebundener Lage-Snapshot; unbekannte/unlesbare Fenster sind blockierend |
| `sse_page_objects` / `sse_page_state` | Öffentliche Page-Objects und kurzlebige UI-Epoche lesen |
| `sse_read_page` | **Hauptwerkzeug**: Seite als `Beschriftung = Wert` |
| `sse_read_table` | Eingabetabelle als Kopf + Zeilen |
| `sse_collect` / `sse_verify` | Kleinen Diagnose-Teilstand von höchstens 5 Seiten erfassen und gegen Sollwerte prüfen; unvollständige Läufe sind Fehler, kein Scheinerfolg |
| `sse_snapshot` | Vollständiger Elementbaum (Fehlersuche) |
| `sse_snapshot_compare` | Schnellen Bulk-Snapshot read-only gegen den Altpfad verifizieren |
| `sse_accessibility_probe` | UIA-Muster, RawView und begrenztes MSAA eines Elements prüfen |
| `sse_vast_dialog_read` / `sse_vast_row_details` | VaSt-Bescheinigungen, aktuelle lokale Ziele und aufgeklappte FA-Werte mit stabiler OCR-Zuordnungsbindung lesen |
| `sse_vast_mapping_options` / `sse_vast_mapping_select` | Lokale VaSt-Ziele popupgebunden lesen bzw. mit exakt einem erwarteten Zeilen-Diff auswählen; noch keine Übernahme |
| `sse_vast_apply` | Vollständig gelesenen VaSt-Plan fingerprint-, fall-, hash- und hauptfenstergebunden einmalig übernehmen; speichert nicht und beantwortet keine Folgedialoge |
| `sse_vast_row_set_expanded` | Ansicht einer VaSt-Zeile kontrolliert auf-/zuklappen, ohne Zuordnung oder Steuerdaten zu ändern |
| `sse_checker_close` | Linke Ergebnisleiste des globalen Prüfers schließen und dabei unveränderte Seite sowie Dirty-State bestätigen |
| `sse_find` | Element nach Beschriftung oder AutomationId |
| `sse_get_value` / `sse_set_value` | Feld eindeutig lesen / ausschließlich globalen Suchtext transaktional setzen |
| `sse_change_known_field` | Katalogisiertes Feld atomar mit PID/Epoche/Readback/Steuer-Diff ändern |
| `sse_change_field` | Noch nicht katalogisiertes Feld atomar mit Vor-/Nachbedingungen sowie Eingabe-/Fenster-Guard ändern |
| `sse_toggle` | Echte Checkbox seiten- und vor-/nachzustandsgebunden setzen; eigener Fehler wird zurückgerollt |
| `sse_combo_options` / `sse_combo_select` | Dropdown eindeutig lesen / seiten- und vor-/nachwertgebunden mit Interference-Stopp auswählen |
| `sse_table_add` | An eine exakte Summenregion gebundene freie Tabellenzeile per ValuePattern anlegen |
| `sse_table_update` | Seiten-/summenregionsgebundene Zeile transaktional aktualisieren, auch versteckt |
| `sse_table_delete` | Seiten-/summenregionsgebundene Zeile mit Interference-Guard löschen (nur sichtbar); verdeckte Punkte melden den Blockierertyp und brechen vor Mutation ab |
| `sse_click` / `sse_click_point` | UIA-Aktion bzw. echter Klick; physischer Pfad nur für Navigations-/Prüfer-TreeItems und exakt benannte Erfassen-/Bearbeiten-Hyperlinks |
| `sse_scroll` | `intoview` / `percent` / `list` |
| `sse_launch` / `sse_close` | Programm starten und eindeutiges Start-HWND für Folgeaktionen liefern / gebunden beenden |

Der VaSt-Ergebnisdialog wird nach `sse_vast_apply` immer erst als neuer
Folgedialog gemeldet. Sein Hinweis, dass Wahlleistungen nicht immer per VaSt
übermittelt werden, ist passiver Informationstext und kein ELSTER-Versand. Nur
dieser exakte offizielle Satz darf beim fingerprintgebundenen `Schließen` den
Versand-Guard passieren; andere Übermittlungs- oder ELSTER-Texte bleiben
gesperrt.
| `sse_list_cases` | Falldateien + ELSTER-Status ohne das Programm zu öffnen |
| `sse_backup_cases` | Sicherung mit SHA256-Prüfsummen |
| `sse_archive_cases` | Alte Test-/Zwischenfälle hashgebunden und wiederherstellbar aus dem aktiven Ordner archivieren |
| `sse_desktop_start` / `sse_desktop_status` / `sse_desktop_stop` | Exakt PID-gebundene SSE-Instanz auf eigenem unsichtbaren Windows-Desktop betreiben |

## Sicherheit

`sse_click` verweigert jeden Namen, der Daten übermitteln könnte:
`ELSTER`, `Anmeldungen versenden`, `Jahreserklärungen abschließen`,
`Belege nachreichen`, `Kommunikation mit dem Finanzamt per ELSTER`,
`Senden`, `Senden & Drucken`, `Versenden`, `Übermitteln`, `Abschicken`
— zusätzlich unscharf über einen regulären Ausdruck.

Der Rauchtest prüft diese Sperren als Positivkriterium: sie **müssen**
fehlschlagen.

Auch der gemeinsame Prozessname `SSE` reicht nie als Eigentumsnachweis. Vor
Start, Fensterzugriff und Beenden werden Dateiname, Installationsordner und die
feste binäre Hauptversion geprüft. Der Start bindet außerdem Falljahr und
Dateiendung an den gewählten Modulmodus. Freie Prozessnamen, Wildcards,
abweichende Jahre und manipulierte Modi brechen vor jeder UI-Aktion ab.

Für neue Schreibabläufe `sse_change_known_field` bevorzugen: Das Werkzeug
bindet die SSE-Instanz, prüft Page-Object-Epoche und Vorwert unmittelbar vor
der Eingabe, liest Feld und optional Werte-Info danach zurück und rollt nur
bei einer eindeutig eigenen, fehlgeschlagenen Änderung zurück.
Der historische Name `sse_set_value` ist fail-closed auf die bekannte
AutomationId des steuerneutralen globalen Suchfelds begrenzt. Auch dort sind
exakter Vor-/Nachwert sowie Eingabe-, Fenster-, Dialog- und Seitenbindung
Pflicht. Steuer-, Formular- und Tabellenfelder werden darüber abgewiesen.
`pattern="toggle"` ist im generischen `sse_click` gesperrt. Checkboxen laufen
über `sse_toggle`; Dropdowns über `sse_combo_select`. `pattern="select"` ist
nur für genau einen über seine exakte AutomationId adressierten RadioButton
zulässig. Dabei liest das Werkzeug die ganze Gruppe, verlangt vorher und
nachher genau eine ausgewählte Option und verwendet einen PID-/Root-verifizierten
physischen Klick, weil Qt eine reine UIA-Auswahl ohne fachliches Formularereignis
anzeigen kann. Auf einem versteckten Desktop bleibt die Aktion gesperrt. Bei
einem eindeutig eigenen
Nachbedingungsfehler nur ohne erkannte Benutzer-/Fenster-/Seiteninterferenz
auf die zuvor ausgewählte Option zurück.
Eine öffentliche Roh-Tastatur gibt es nicht: `sse_keys` wurde entfernt und
der direkte Worker-Pfad blockiert. Suche, Tabellenmaterialisierung/-löschung
und Feldänderungen kapseln notwendige Eingaben intern mit ihren jeweiligen
Seiten-, Ziel-, Summen- und Readback-Verträgen.
Geschrieben wird nur in den Arbeitsspeicher — dauerhaft erst durch Speichern.

Der VaSt-Zuordnungsdialog ist kein automatischer Feld-Merge. Jede FA-
Bescheinigung wird in der rechten Spalte einem vorhandenen lokalen Eingabefenster,
einem neuen Datensatz oder „nicht übernehmen“ zugeordnet. Qt exponiert die
gemalten Zelltexte und Popup-Optionen dort nicht stabil per UIA; der Server nutzt
deshalb UIA für Struktur und exakte Punktbindung, lokales Windows-OCR nur für
diese Texte. Ein normales Dialog-Fingerprint ist nach Auf-/Zuklappen wegen Qts
virtuellem Accessibility-Baum nicht stabil. Die `sse_vast_*`-Werkzeuge verwenden
stattdessen einen Fingerprint der sichtbaren Zertifikat-Ziel-Paare. Mehrere
Bescheinigungen derselben Art auf dasselbe lokale Ziel sind vor einer Übernahme
als Konflikt zu behandeln. Das Öffnen eines Dropdowns darf nur nach bestätigtem
Popup mit Escape geschlossen werden; ein zweiter Pfeilklick kann in Qt den ersten
Listeneintrag auswählen.

`sse_click name="Weiter"` und `sse_click name="Zurück"` vertrauen nicht auf
den erfolgreichen UIA-Aufruf. Sie lesen die Überschrift im selben Worker vor
und nach der Aktion. `expectedPageBefore` bindet die Ausgangsseite;
`expectedPageAfter` kann zusätzlich die Zielseite binden. Öffnet Qt beim
Blättern erst einen Prüfhinweis, kommt strukturiert `navigation-blocked` mit
Dialog-Fingerprint zurück. Dann den Dialog lesen und bewusst beantworten,
anschließend `sse_ui_state` neu lesen — den Navigationsklick nicht wiederholen,
denn Qt kann den bereits wartenden Seitenwechsel danach fortsetzen.
Auch `sse_goto` stoppt beim ersten neu erkannten Prüfhinweis. Es wiederholt den
wartenden Navigationsschritt nicht und stapelt daher keine identischen
Warnfenster.

Qt kann eine offizielle Unterseitenaktion gleichzeitig als sichtbaren
`Hyperlink` und als gleich beschrifteten `Button` exponieren. Ein erfolgreiches
`InvokePattern` des Buttons beweist dabei keinen Seitenwechsel. `sse_subpages`
dedupliziert solche Paare deshalb zugunsten des PID-/Root-verifizierten
Hyperlink-Klicks; reine Buttons bleiben per `sse_click` erreichbar. Das ist eine
generische Qt-Komponentenregel, kein Katalog privater Steuerfälle.

Auf Seiten mit mehreren Eingabetabellen ist ein ungebundener
`sse_table_read` absichtlich kein Vollständigkeitsbeweis. Die Zielregion wird
mit `sumLabel` und `sumOccurrence` an ihre sichtbare Summenzeile gebunden.
Nicht-modale Werte-Info-Tabellen desselben Prozesses werden ausgeschlossen;
ohne eindeutige Tabellenregion kommt `vollstaendig=false`, ohne einen
zufälligen Fokus zu setzen.

Numerische Tabellenwerte werden beim Readback wertgleich verglichen. SSE-
Anzeigen wie `0,00` oder `19,00` erfüllen daher korrekt die angeforderten Werte
`0` bzw. `19`; Textfelder bleiben weiterhin exakt gebunden.

Ein nachweislich aktiver Windows-Sperrbildschirm erzeugt globale Input-Ticks,
obwohl der Nutzer SSE nicht bedienen kann. Nur rein per UIA-`ValuePattern`
gebundene, vollständig rückgelesene `sse_table_add`-/`sse_table_update`-
Transaktionen dürfen diesen Tick als `lockScreenIsolation=true` isolieren.
Verschwindet der Sperrbildschirm während der Aktion, wird gestoppt. Physische
Klicks, Tastaturwege und `sse_table_delete` bleiben am Sperrbildschirm immer
gesperrt.

Dasselbe gilt für Batchläufe: `sse_collect` stoppt beim ersten Dialog,
Seitenscheinerfolg, Zyklus, kranken UIA-Kanarienvogel oder — im sichtbaren
Modus — einer fremden Benutzereingabe. Der zurückgegebene bzw. geschriebene
Teilstand trägt `vollstaendig=false`, `stopKind` und `stopReason`; MCP meldet
`collection-incomplete`. Eine vorhandene JSON-Zieldatei wird nur mit ihrem
exakten `expectedOutputHashBefore` ersetzt, der neue Stand atomar geschrieben
und als `dateiHash` zurückgelesen. Nach einem Prüfhinweis erst antworten und
`sse_ui_state` lesen, niemals den wartenden Weiter-Klick wiederholen.
Die Vorgabe sind 3, das harte Maximum 5 Seiten je Diagnose-Segment. Private-
Memory-Zuwachs und UIA-Kanarienzustand werden vor und nach jedem Seitenwechsel
geprüft. Danach Health, Dialoge, Dirty-State und Ergebniswerte lesen. Für den
Live-Dialog direkte Tree-/Page-Object-Sprünge verwenden; selbst 12 Seiten
konnten auf großen Qt-Seiten SSE in einen Mehr-GB-Zustand treiben.

`sse_verify` akzeptiert den Collect-Stand nur zusammen mit dessen
`dateiHash` als `expectedSourceHash`. Ein Stand mit `vollstaendig=false` oder
ein Altformat ohne Vollständigkeitsfeld ist standardmäßig gesperrt;
`allowIncompleteSource=true` erlaubt ausschließlich einen klar bezeichneten
Teilstandsabgleich ohne Gesamtaussage. Exakte Seiten-/Feldnamen werden zuerst
gesucht, Teilstrings danach literal und nur bei genau einem Treffer. Bei
Mehrdeutigkeit kommen Kandidaten zurück; erst dann darf gezielt eine
`seiteOccurrence` bzw. `labelOccurrence` gewählt werden. Wertabweichungen sind
kein Transportfehler: Das Werkzeug liefert alle Details mit
`vergleichOk=false`.

`sse_export_csv` liefert den geöffneten lokalen Exportdialog mit `hwnd`,
`fingerprint` und erlaubten Schaltern zurück. Zum Fortsetzen genau diese beiden
Werte an `sse_dialog_answer` übergeben und ausschließlich
`button="Klicken Sie hier, um Ihre Daten zu exportieren"` wählen. Ein kürzerer
oder frei formulierter Export-Button ist nicht zugelassen. Der Exportdialog
darf offen bleiben, wenn dadurch genau ein neuer oberster Ordnerdialog entsteht;
diesen danach separat lesen und beantworten. Es findet kein Versand statt.

Für den laufenden Arbeitsdialog `sse_result_details` einmal öffnen und danach
`sse_ui_state` als Standardlesung verwenden. Solange Werte-Info offen ist,
enthält derselbe UIA-Bulk-Snapshot Seite, Dirty-State, Dialoge, Seiten- und
Globalprüfer sowie die vollständige Qt-Ergebnistabelle. `stateFingerprint`
ist unabhängig von neu erzeugten Runtime-Handles des Wertefensters stabil;
beim Folgeaufruf als `previousFingerprint` übergeben, liefert
`changedSince` die Zustandsänderung. Gemessen auf der neutralen Testkopie:
Median 2,128 s für den kombinierten Aufruf statt zusammen 6,187 s für
`sse_check_page`, `sse_checker_results` und bereits geöffnete
`sse_result_details` (rund 66 % weniger Roundtrip-Zeit). Das erstmalige
Öffnen von Werte-Info bleibt ein bewusster einmaliger Lesevorgang.
Bei mehreren sichtbaren SSE-2025-Hauptinstanzen ist ein zuvor gelesenes
eindeutiges `hwnd` für Zustand und Ergebnis Pflicht; Hilfsfenster anderer PIDs
werden nicht vermischt. `vollstaendig=true` für Werte-Info setzt vier
positionierte Spalten, keine virtualisierten 0×0-Zellen, vollständige vertikale
Sicht und `Differenz = Aktuell − Festgehalten` voraus. Unbekannte oder nicht
lesbare SSE-Fenster liefern nie `frei`, sondern `blockiert=true`.

Fallbereinigung erfolgt nicht durch unkontrolliertes Löschen. `sse_archive_cases`
verlangt für jede zu archivierende und jede verbleibende Datei den erwarteten
SHA256, verweigert übermittelte Fälle und prüft den vollständigen Bestand vor
und nach dem Verschieben. Das Archiv liegt außerhalb des aktiven Fallordners
und bleibt wiederherstellbar.

Der unsichtbare Desktop ist fail-closed: Ein Start übernimmt niemals eine
bereits laufende SSE-PID und überschreibt keine aktive Marke. Der Stop verlangt
Name **und** PID aus der Marke sowie ein SSE-Fenster genau dieser PID auf genau
diesem Desktop. Fehlt dieser Eigentumsnachweis, bleiben sichtbare SSE-Instanzen
unangetastet. Unbekannte Hilfsfenster blockieren den Stop; kompakte Werte-Info
und Tipps dürfen geschlossen werden, 50×50-UAC-Systemoverlays werden nur
ignoriert und verschwinden mit dem Prozess. Speichern erfolgt
vorher ausschließlich über `sse_save` mit Pfad und Vorher-Hash; `save=true` in
den Close-/Stop-Werkzeugen ist gesperrt. Ohne `discardChanges=true` wird kein
Speicherdialog verworfen und kein Prozess hart beendet; die Sitzung bleibt zur
Klärung offen.

Dasselbe Datenverlustprinzip gilt sichtbar: `sse_close` bindet genau ein
Hauptfenster/eine PID. Ein Hard-Kill ist ausschließlich mit
`discardChanges=true` zulässig; speichern, Hash prüfen, dann schließen.

Warn-/Prüfer-OCR speichert Bilder nur für die Dauer desselben Worker-Aufrufs.
Ein angefordertes Kontrollbild wird als Base64-MCP-Inhalt zurückgegeben; die
lokale Temporärdatei wird davor nachweislich entfernt. Auch ein harter
Worker-Timeout beendet über ein Windows-Jobobjekt den gesamten Worker-/OCR-
Prozessbaum. `ocr=false` liest bei automatischen Prüfhinweisen nur die
strukturierten Titel und Aktionen. Vor dem Beantworten ist zusätzlich zum
UIA-Fingerprint der OCR-`bodyFingerprint` Pflicht und wird unmittelbar vor dem
Klick neu geprüft.

## Test

```powershell
npm test                        # Build, Selbsttest, fail-closed SSE-2025-Grenzen, Archivtest
npm run test:api                # Auth-, Allowlist-, Body- und Timeout-Vertrag der HTTP-API
npm run test:api-main           # produktiven API-Entry-Point fensterlos starten und prüfen
npm run test:wrapper-boundary   # 80 MCP-Werkzeuge ausschließlich an 80 API-Operationen binden
npm run test:wrapper-catalog    # alle 80 MCP-Werkzeuge dynamisch gegen eine Fake-API aufrufen
npm run test:no-console        # echten MCP/API/PowerShell-Aufruf auf neue sichtbare Konsolenfenster überwachen
npm run test:scenario           # bytegleiche Ergebnisdatei via direkter API und echtem MCP
npm run test:product            # 2025-/Version-/Modus-/Prozessgrenzen ohne Programmstart
npm run test:verify             # synthetischer hashgebundener Collect-/Soll-Ist-Abgleich
node test/smoke.mjs              # nur lesend
node test/smoke.mjs --write      # zusätzlich Sicherung
node test/smoke.mjs --restart    # zusätzlich Beenden/Starten
npm run test:archive             # hashgebundene Archiv-/Rollback-Fixture
npm run test:hidden              # versteckter Start, Lesen, Navigation, Warnhinweis, sauberer Stop
npm run test:hidden-console      # kurzer echter Lifecycle-Smoke ohne sichtbares PowerShell-Fenster
npm run test:visible-guard       # sichtbarer Input-/Fenster-Guard; braucht Fixture-Env und freien SSE-Prozess
npm run test:table-add           # richtige Summenregion, Erfolg und Zell-/Summen-Rollback; braucht Fixture-Env
npm run test:table-update        # gebundene Zeilenaktualisierung, Erfolg und Rollback; braucht Fixture-Env
npm run test:table-delete        # sichtbarer Summenregions-/Auswahl-/Delete-Test; braucht Fixture-Env
```

Add/Update können auf einer neutralen, bereits auf der Zielseite gespeicherten
`.Gew2025`-Vorlage vollständig fensterlos geprüft werden. Der Guard erzeugt
eine bytegleiche Repo-Tempkopie, speichert nie, kontrolliert beide Hashes und
entfernt die Kopie wieder:

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -File test/run-hidden-copy.ps1 `
  -Source 'D:\SSE-Test\neutral.Gew2025' `
  -TestScript table-add-transaction.mjs -HiddenTables
powershell.exe -NoLogo -NoProfile -NonInteractive -File test/run-hidden-copy.ps1 `
  -Source 'D:\SSE-Test\neutral.Gew2025' `
  -TestScript table-update-transaction.mjs -HiddenTables
```

`table_delete` bleibt absichtlich sichtbar: Qt benötigt dafür eine exakt
geprüfte Zeilenauswahl und `Strg+Umschalt+Entf`; hidden bricht der Worker vor
jeder Mutation mit `kind="hidden-desktop"` ab.

`test:hidden` prüft zusätzlich markerlosen Stop, verweigerten Doppelstart,
SSE-2025-/Modul-/PID-/Fensterbindung, stabile und wechselnde Lage-/Ergebnis-
Fingerprints, korrekte Trennung von Warnungen und nicht-modalen Fenstern,
OCR-Bildtransport ohne neue Temp-Datei, fingerprintgebundene Dialogantwort,
Dirty-State, Markerabbau und unveränderten SHA256 der wegwerfbaren Falldatei.
`test:product` erzwingt außerdem einmal den nativen C#-Fallback und prüft, dass
abgewiesene Starts weder SSE-PIDs noch den Desktop-Marker verändern. Zusätzlich
simuliert es eine veraltete DLL und verlangt den sichtbaren Quelltext-Fallback.
`test:visible-guard` arbeitet ausschließlich auf einer MCP-erzeugten Temp-Kopie,
speichert nie und entfernt die Kopie wieder. Bleibt ein fremdes Fenster vor
SSE, bestätigt der Lauf den rollbackfreien `epoch-obstructed`-Abbruch und
meldet den eigentlichen Tastaturtest transparent als `SKIP`.
`test:table-add` schreibt zwei neutrale Zeilen nur in den Speicherzustand einer
wegwerfbaren `.Gew2025`-Kopie. Es beweist die geometrische Bindung an die
angegebene Summenregion, einen erfolgreichen Summenanstieg und den vollständigen
Zell-/Summen-Rollback einer absichtlich falschen Nachbedingung. Abschließend
verwirft es die Sitzung und verlangt einen unveränderten Quellhash.
`test:table-update` aktualisiert eine neutrale bestehende Zeile versteckt von
1,50 auf 1,51 EUR, erzwingt danach einen kontrollierten Zell-/Summen-Rollback
und stellt zuletzt 1,50 EUR wieder her. Auch hier sind graceful Discard,
unveränderter Quellhash und unveränderte fremde PID-Menge Pflicht.
`test:table-delete` erzeugt selbst eine bytegleiche Temp-Kopie und speichert
nie. Ist das Qt-Fenster auf dem aktiven Windows-Desktop exakt klickbar, muss die
gebundene 1,50-EUR-Zeile verschwinden und ihre Summe 0,00 EUR werden. Liegt am
frischen UIA-Zellpunkt dagegen nicht die exakte SSE-PID samt Root-HWND, gilt nur
der bewiesene Abbruch vor Mutation als `SKIP`; die Quelle und PID-Menge müssen
in beiden Fällen unverändert bleiben.

## Aufbau

```
src/index.ts          PC-unabhaengiger MCP-Wrapper und Werkzeugdefinitionen
src/api-main.ts       lokale loopback-only HTTP-API
src/api-server.ts     Auth-, Allowlist-, Request- und Fehlervertrag
src/api-executor.ts   API-Operationen, Workspace und Szenarioausfuehrung
src/operation-catalog.ts gemeinsame strikte Schemas fuer 80 API-/MCP-Operationen
src/api-client.ts     einzige MCP-Verbindung zur lokalen API
src/workspace.ts      relative Textdateien mit Pfad- und SHA256-Schutz
src/scenario.ts       serielle, kanonische API-/MCP-Szenarien
src/setup.ts          deutscher portabler Setup-Wizard
src/worker.ts         API-Bruecke zu PowerShell (ein frischer Prozess je UIA-Aufruf)
powershell/sse-worker.ps1   die gesamte UIA-Logik
powershell/sse-native.cs    öffentliche Win32-/MSAA-Brücke, einmalig kompiliert
powershell/build-native.ps1 reproduzierbarer Build von sse-native.dll
powershell/load-native.ps1  gemeinsamer SHA256-gebundener DLL-/Fallback-Loader
powershell/akad-parser.ps1  Python-freier In-Process-Kopfparser mit ELSTER-Tri-State
portable/runtime.json       gepinnte offizielle Node-Version und SHA-256
scripts/package-portable.mjs reproduzierbarer Release-Ordner, ZIP und Prüfsumme
profiles/             explizit freigegebene Produktversionen und Page Objects
skills/               flache öffentliche Skills für npx/Codex/Claude Code
docs/entwicklung/erfahrungen/ getrennte Entwicklungs-Memory ohne Runtime-Last
test/smoke.mjs        Rauchtest über das echte MCP-Protokoll
```

## Lizenz

MIT. Kein Zusammenhang mit Wolters Kluwer Steuertipps.
