# Prüfauftrag an Codex

Du prüfst ein MCP-Server-Projekt, das die Windows-Anwendung
„SteuerSparErklärung" (Qt 6) über UI Automation steuert. Es wird für echte
Steuererklärungen benutzt — Fehler kosten Geld oder führen zu falschen
Angaben gegenüber dem Finanzamt.

## Was du prüfen sollst, in dieser Reihenfolge

### 1. Die Versandsperre — das ist das Wichtigste

In `powershell/sse-worker.ps1` gibt es `$script:VERSAND` und `Test-Versand`.
Sie sollen verhindern, dass jemals etwas ans Finanzamt übermittelt wird.

Prüfe konkret:
- Lässt sich die Sperre über die Parameter `aid` oder `rid` umgehen, also
  ein gesperrtes Element adressieren, ohne seinen Namen zu nennen?
- Greift sie in **beiden** Operationen `click` und `click_point`?
- Deckt der reguläre Ausdruck realistische Varianten ab? Was ist mit
  Menüeinträgen wie „Elektronische Steuererklärung (ELSTER)…" mit
  Auslassungspunkten, oder mit Tastenkürzeln über die Operation `keys`?
- `keys` sendet beliebige Tastendrücke an das Fenster. Kann man damit einen
  Versand auslösen (Menü öffnen, Eingabetaste)? Wenn ja: das ist ein Loch.
- Gibt es weitere Operationen, über die man an einen Versand käme?

Schreibe für jedes Loch, das du findest, einen konkreten Aufrufpfad hin.

### 2. Richtigkeit der Datenauslesung

`read_page` fügt Beschriftung und Feldwert zusammen. Ein falsch zugeordneter
Betrag wäre in einer Steuererklärung ein ernster Fehler.

- Die Zeilengruppierung nach Y-Koordinate benutzt eine Toleranz von 12 px.
  Wann geht das schief? Was passiert bei zweizeiligen Beschriftungen?
- `Get-ContentBounds` leitet die Spaltengrenzen aus dem Navigationsbaum und
  dem Knopf „Eingabehilfe" ab, mit Rückfall auf 28 % / 79 % der
  Fensterbreite. Wann liefert das falsche Grenzen, und was ist die Folge?
- Kann ein Wert der falschen Beschriftung zugeordnet werden? Konstruiere
  einen Fall.
- `read_table` gruppiert `DataItem`-Zellen nach Y mit 10 px Toleranz und
  gibt Zeilen als flache Listen zurück. Was passiert bei leeren Zellen —
  verrutschen dann die Spalten?

### 3. Der Parser für die Falldateien

`powershell/akad-parse.py` liest den Klartext-Kopf. Die Wertkodierung hängt
vom Typ ab (Typ 5 = 4 Byte Datum ohne Längenfeld, Typ 6 = 1 Byte, sonst
längenpräfigiert). Die Funktion probiert Deutungen durch und nimmt die
erste, nach der ein plausibler Folgesatz steht.

- Kann diese Heuristik eine falsche Deutung wählen und dadurch Metadaten
  verfälschen? Insbesondere `ElsterTransferTime` — daran wird abgelesen, ob
  eine Erklärung bereits übermittelt wurde. Eine Falschaussage hier ist
  gefährlich.
- Was passiert bei beschädigten oder fremden Dateien? Endlosschleife?
  Ungebremster Speicherverbrauch?

### 4. Robustheit

- `Walk-Tree` hat eine Zyklussperre über RuntimeIds. Reicht sie? Kann der
  Baumlauf trotzdem nicht terminieren?
- Fehlerbehandlung: Wo werden Fehler verschluckt (`catch { }`) und könnten
  dadurch als „kein Treffer" durchgehen statt als Fehler? Das Projekt hat
  genau diesen Fehlermodus als Hauptrisiko identifiziert — prüfe, ob er
  irgendwo noch offen ist.
- `Get-LiveElement` läuft den Baum erneut ab. Kann es das falsche Element
  finden, wenn sich der Baum zwischenzeitlich geändert hat?
- Nebenläufigkeit: Zwei gleichzeitige MCP-Aufrufe starten zwei
  PowerShell-Prozesse gegen dieselbe Anwendung. Was geht dabei schief?

### 5. PowerShell-Fallstricke

Ein Fehler dieser Art war bereits drin und hat exakte Namenssuche in
Teilstringsuche verwandelt: `$a.contains` traf auf einer Hashtable die
eingebaute Methode `Contains` statt des Aufrufparameters.

Suche nach weiteren Zugriffen dieser Art (`.count`, `.keys`, `.values`,
`.clone`, `.item`, `.length`) und nach Stellen, wo einelementige Listen von
`ConvertTo-Json` zu Einzelobjekten entpackt werden und der Aufrufer
deswegen falsch liegt.

## Form der Antwort

Für jeden Befund:
- **Schwere**: kritisch / ernst / mittel / gering
- **Datei und Zeile**
- **Konkreter Auslösepfad** — welcher Werkzeugaufruf mit welchen Argumenten
- **Folge** — was der Nutzer falsch angezeigt bekommt oder was passiert
- **Vorschlag**

Sortiere nach Schwere. Erfinde nichts: wenn du etwas nicht sicher
beurteilen kannst, schreib das hin, statt zu raten. Belege Behauptungen mit
der Codestelle.
