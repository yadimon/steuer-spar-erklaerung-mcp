# Öffentlicher Artikeltext

Ich wette, der Agent findet etwas 🙂

Bei mir war es zumindest so – nicht wegen der Software.

Ich habe eine inoffizielle lokale Schnittstelle für SteuerSparErklärung 2025
gebaut. Als Agent Plugin bringt sie Skill, MCP, API, Windows-Runtime, Profile
und alle JavaScript-Abhängigkeiten gemeinsam mit. Codex oder Claude Code kann
damit einen bereits geöffneten Steuerfall prüfen, mit bestätigten Belegen
abgleichen und freigegebene Änderungen direkt zurücklesen.

Gespeichert oder ans Finanzamt übermittelt wird nichts automatisch. ELSTER
bleibt technisch gesperrt. Vor dirty-fähiger Bedienung wird der aktuelle
Dateistand privat und hashgebunden gesichert; Originale und übermittelte Fälle
werden nicht still ersetzt.

Für Codex brauchst du unter Windows Node.js 22+, Git auf `PATH` für das
einmalige Klonen des Plugin-Repositories durch `plugins@1.3.4` und aktuell
zwei Befehle:

```powershell
mkdir C:\mein-steuer-ai
cd C:\mein-steuer-ai
npx -y plugins@1 add yadimon/steuer-spar-erklaerung-mcp --target codex --scope project --yes
codex plugin add steuer-spar-erklaerung@plugins-cli --json
```

Beide Codex-Befehle sind derzeit nötig: Der erste schreibt Cache, Marketplace
und Konfiguration, Codex CLI 0.151 zeigte danach aber noch `not installed`.
Erst der zweite target-native Schritt ergab `installed, enabled`.

Für Claude Code genügt dagegen dieser eine Installerbefehl:

```powershell
npx -y plugins@1 add yadimon/steuer-spar-erklaerung-mcp --target claude-code --scope user --yes
```

Der Windows-VM-Lauf mit Claude Code 2.1.252 zeigte ihn danach mit `Scope: user`
als `enabled` und bestätigte die target-native Entfernung. Anschließend
den jeweiligen Client neu starten und zum Beispiel schreiben:

> Prüfe meinen bereits geöffneten Steuerfall 2025 zunächst nur lesend. Beginne
> mit `sse_preflight`, speichere und schließe ihn nicht und sende nichts über
> ELSTER.

Git wird danach nicht für den MCP-Start gebraucht. Es gibt kein separates
API-Terminal, kein `npm install` im Arbeitsordner und keinen Netzwerkzugriff
beim MCP-Start. `plugins@1.3.4` ignoriert den Scope bei Codex; für Claude Code
ist der VM-verifizierte User-Scope dokumentiert. Beide Ziele verwenden
clientverwaltete Benutzer-Caches und bieten damit keine physische
Projektisolation. Wer Arbeitsdaten strikt
trennen möchte, verwendet zusätzlich einen eigenen absoluten
`SSE_API_CONFIG`-Pfad.

Öffentliche Beta für Windows x64, Open Source, keine Steuerberatung und noch
nicht jeder praktische Weg ist live belegt. Repository, Installation und
offene Verifikation:
https://github.com/yadimon/steuer-spar-erklaerung-mcp

Und an [Wolters Kluwer Steuertipps](https://www.linkedin.com/company/steuertipps-de/):
Mit einer offiziellen API oder geöffneten relevanten Schnittstellen könnte das
noch schneller, zuverlässiger und vollständiger werden. Die AI-Nutzer sind
längst da.
