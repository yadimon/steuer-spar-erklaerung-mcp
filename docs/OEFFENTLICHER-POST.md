# Ersatztext für den öffentlichen Post

SteuerSparErklärung MCP ist jetzt einfacher einzurichten: Ein einziges
`npm i @yadimon/steuer-spar-erklaerung-mcp` installiert automatisch die exakt
passende lokale API. Beim Start übernimmt MCP eine bereits laufende kompatible
API oder startet sie unsichtbar als lokalen Singleton — ein separates
API-Terminal ist im Standardweg nicht mehr nötig.

Die Sicherheitsgrenzen bleiben unverändert: nur Loopback, strikte
Versionsprüfung, kein ELSTER-Versand, kein automatisches Speichern und keine
ungebundene Steuerfallbearbeitung. Eine fremde oder anders versionierte API
wird nie beendet oder ersetzt, sondern führt fail-closed zum Startabbruch.

Installation unter Windows x64:

```powershell
mkdir C:\mein-steuer-ai
cd C:\mein-steuer-ai
npm i @yadimon/steuer-spar-erklaerung-mcp
npx -y skills add yadimon/steuer-spar-erklaerung-mcp --skill steuer-spar-erklaerung --agent codex --copy --yes
codex mcp add steuer-spar-erklaerung -- (Get-Command node).Source C:\mein-steuer-ai\node_modules\@yadimon\steuer-spar-erklaerung-mcp\dist\index.js
```

Danach Codex einmal neu starten. Die API bleibt für direkte HTTP-/CLI-Nutzung
weiterhin separat installierbar.
