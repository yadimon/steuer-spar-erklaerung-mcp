# Betriebsvertrag des portablen Releases

Lies konkrete Namen und Werte immer aus dem installierten Release. Diese
Referenz beschreibt nur die stabilen Grenzen.

## Release und Konfiguration

- `portable-manifest.json` nennt Plattform, gebündelte Runtime und unterstützte
  Produktprofile. Prüfe die im Release veröffentlichte SHA-256-Prüfsumme.
- `sse-setup.cmd` ist der manuelle Einmal-Einstieg. Ein Agent mit sicherem
  Prozesswerkzeug kann dieselbe `runtime/node.exe dist/setup-main.js` ohne separates
  Konsolenfenster starten.
- Das Setup schreibt lokale API-Konfiguration, eine MCP-Mergevorlage und einen
  fensterlosen VBS-API-Starter außerhalb des Repositorys. Token nie anzeigen.
- Starte den erzeugten VBS-Starter mit Windows Script Host; starte nicht blind
  eine zweite API. Prüfe zuerst `/healthz`.

## Direkte API und MCP

- API nur auf `127.0.0.1` oder `::1` verwenden.
- URL, Token, Endpunkte, Operationen und Parameter aus Setup-Ausgabe und
  API-Selbstbeschreibung lesen.
- MCP nur verwenden, wenn der Agent den Server auflistet und ein echter
  Health-/Workspace-Aufruf gelingt.
- MCP-Konfiguration aus der vom Setup erzeugten vollständigen Mergevorlage
  übernehmen. Vorhandene Client-JSON sichern und nur den Servereintrag mergen.
- Kann der Agent nicht selbst mergen, zeige die vollständige Datei bzw. das
  echte Fragment und bitte um genau eine Aktion: speichern und „Fertig“ melden.
- Die direkte API ist vollständig nutzbar, auch wenn MCP nicht installiert ist.

## Arbeitsbereich

Verwende die vom Setup zurückgelesenen Bereiche für `documents`, `results` und
`backups`. Erzeuge bei Bedarf zusätzlich `cases` und `scenarios` innerhalb des
Workspace. Alle API-Dateireferenzen bleiben relativ und dürfen den Workspace
nicht verlassen.

Textdateien immer unter einer neuen Referenz schreiben. Ein vorhandenes Ziel
ist ein Stoppsignal, keine Aufforderung zum blinden Überschreiben.

Fensterbilder nur über `sse_screenshot` in eine neue Referenz unter `results`
schreiben. Sie dienen als ergänzender Nachweis für aktuelle Seite, sichtbare
Abschnitte und Qt-Elemente, die UIA nicht strukturiert liefert. Vertrauliche
Rohbilder nicht ins Repository übernehmen. Ein Screenshot ersetzt weder den
strukturierten Feld-/Tabellen-Readback noch den Summen- und Hashnachweis.

Speichere eine nicht geheime `setup-decisions.json`, falls das Release keinen
anderen Namen vorgibt. Erlaubt sind Profil, Engine, Workspace, Arbeitsmodus,
freigegebene Quellarten, Kopierentscheidung und Zustimmungszeitpunkte. Verboten
sind Token, Zugangsdaten, Steuerwerte und Dokumentinhalte.

## Szenarien und Recovery

Nutze das aktuelle Schema aus der API. Ein schreibendes Szenario benötigt:

- eindeutige IDs und eng freigegebene Operationen,
- relative Ressourcenreferenzen mit Hash-Vorbedingungen,
- dynamische Werte aus bereits abgeschlossenen Schritten,
- Readback nach jeder Mutation,
- `finally` für Endzustand, Freigabe und sicheren Close.

`finally` darf keine Änderung blind wiederholen und keine ungespeicherten Daten
verwerfen. Wenn eine Mutation eventuell ausgeführt wurde, aber ihr Ergebnis
unklar ist, keine Transportumschaltung und keinen Retry durchführen. Zustand
read-only neu erfassen und stoppen.

## Nachweis

Ein Report gilt erst als geliefert, wenn die Ergebnisdatei zurückgelesen und
ihr SHA-256 mit der API-Antwort konsistent ist. API- und MCP-Ausführung desselben
Szenarios müssen kanonisch dieselben Ergebnisbytes erzeugen.
