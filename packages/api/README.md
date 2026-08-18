# @yadimon/steuer-spar-erklaerung-api

Lokale, inoffizielle Windows-x64-API mit Setup-Wizard und CLI für
SteuerSparErklärung. Das Paket enthält die PowerShell-/Native-Runtime und die
Produktprofile, aber keinen MCP-Server.

```powershell
npm install --global @yadimon/steuer-spar-erklaerung-api@beta
steuer-spar-erklaerung-setup
```

Für Agenten ohne MCP kann `steuer-spar-erklaerung-call` die vollständige
Loopback-API direkt verwenden. Voraussetzungen, Sicherheitsgrenzen und der
portable Weg ohne Node/npm stehen im
[Repository](https://github.com/yadimon/steuer-spar-erklaerung-mcp).
