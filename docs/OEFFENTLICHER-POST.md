# Ersatztext für den öffentlichen Post

Ich wette, der Agent findet etwas 🙂

Bei mir war es zumindest so – nicht wegen der Software.

Halb vibecoded, aber getestet: eine inoffizielle lokale API samt MCP und
optionalem Skill für SteuerSparErklärung:
https://github.com/yadimon/steuer-spar-erklaerung-mcp

Das MCP-Paket installiert automatisch die exakt passende lokale API und startet
sie bei Bedarf. Ein separates API-Terminal ist im normalen Weg nicht mehr
nötig. Der Agent kann einen geöffneten Steuerfall prüfen, mit bestätigten
Belegen abgleichen und freigegebene Änderungen zurücklesen. Gespeichert oder
ans Finanzamt übermittelt wird nichts automatisch; ELSTER bleibt gesperrt.

Wenn du keine Installationsdetails sehen willst, gib einem lokal laufenden
Codex, Claude Code oder OpenCode einfach diesen Prompt:

```text
Richte SteuerSparErklärung API/MCP und optional den Skill vollständig lokal im
Ordner C:\mein-steuer-ai ein. Folge dabei genau dieser Anleitung:
https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md

Erkenne meinen lokalen Client und ändere nur dessen Projektkonfiguration in
diesem Ordner. Installiere die API nicht separat; sie muss als exakt passende
Dependency des MCP-Pakets kommen. Setze SSE_API_CONFIG auf
C:\mein-steuer-ai\config.json. Vorhandene Konfiguration nur additiv mergen,
nichts global installieren und keine Anmeldedaten kopieren. Führe danach
--selftest mit genau diesem gesetzten SSE_API_CONFIG aus und sage mir klar, ob
ich den Client neu starten muss.
```

Für Leute, die die Befehle selbst kontrollieren wollen, stehen die kurzen
projektlokalen Varianten für Codex, Claude Code und OpenCode direkt in der
Installationsanleitung.

Danach zum Beispiel:

> Prüfe meine Einkommensteuererklärung 2025 und vergleiche sie mit allen von
> mir bestätigten Belegen. Beginne mit `sse_preflight`, speichere nichts und
> sende nichts über ELSTER.

Öffentliche Beta für Windows x64, Open Source, keine Steuerberatung und noch
nicht alles abgedeckt. Testen, Fehler melden oder mitmachen: alle willkommen!

Und an [Wolters Kluwer Steuertipps](https://www.linkedin.com/company/steuertipps-de/):
Mit einer offiziellen API oder geöffneten relevanten Schnittstellen könnte das
sehr viel schneller, zuverlässiger und vollständiger werden. Die AI-Nutzer
sind längst da.
