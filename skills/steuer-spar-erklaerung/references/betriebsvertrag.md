# Betriebsvertrag

Lies konkrete Namen und Werte immer aus dem installierten Release. Diese
Referenz beschreibt nur die stabilen Grenzen.

## Erreichbarkeit und Konfiguration

- Die API läuft nur auf `127.0.0.1` oder `::1`. Prüfe vor allem anderen
  `/healthz` beziehungsweise `sse_health`; starte nie blind eine zweite API.
- Es gibt kein Token und keine Anmeldung. Die API weist Anfragen mit `Origin`,
  `Sec-Fetch-Site` oder einem fremden `Host` mit `403` ab — das trennt einen
  lokalen Klienten von einer Webseite im Browser des Nutzers.
- Es gibt kein Einrichtungsprogramm. Der erste API-Start legt die
  Ressourcenbereiche an; eine `config.json` ist optional und nur für einen
  abweichenden Port, ein festgepinntes `sseExecutable` oder einen festen
  `caseDir` nötig.
- Endpunkte, Operationen und Parameter aus der API-Selbstbeschreibung lesen
  (`discovery`, `describe <operation>`, `openapi`), nicht aus dieser Datei.
- MCP nur verwenden, wenn der Agent den Server auflistet und ein echter
  Health-/Workspace-Aufruf gelingt. Die direkte API ist vollständig nutzbar,
  auch wenn MCP nicht installiert ist.
- MCP-Servereintrag beim Client additiv mergen: eine vorhandene Client-JSON nie
  vollständig ersetzen. Kann der Agent nicht selbst mergen, zeige das echte
  Fragment und bitte um genau eine Aktion: speichern und „Fertig“ melden.

## Arbeitsbereich

Verwende die von `workspace_status` zurückgelesenen Bereiche für `documents`,
`results` und `backups`. Diese Bereiche dürfen getrennt außerhalb des Workspace
liegen. Erzeuge bei Bedarf zusätzlich `cases` und `scenarios` innerhalb des
Workspace. Alle API-Dateireferenzen bleiben relativ und dürfen den jeweils
konfigurierten Ressourcenbereich nicht verlassen.

Textdateien immer unter einer neuen Referenz schreiben. Ein vorhandenes Ziel
ist ein Stoppsignal, keine Aufforderung zum blinden Überschreiben.

Fensterbilder nur über `sse_screenshot` in eine neue Referenz unter `results`
schreiben. Sie dienen als ergänzender Nachweis für aktuelle Seite, sichtbare
Abschnitte und Qt-Elemente, die UIA nicht strukturiert liefert. Vertrauliche
Rohbilder nicht ins Repository übernehmen. Ein Screenshot ersetzt weder den
strukturierten Feld-/Tabellen-Readback noch den Summen- und Hashnachweis.

Dauerhafte Vorlieben gehören in `settings.md` im Arbeitsbereich: Belegquellen,
Prioritäten, Arbeitsmodus. Verboten sind dort Zugangsdaten, Steuerwerte und
Dokumentinhalte.

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
