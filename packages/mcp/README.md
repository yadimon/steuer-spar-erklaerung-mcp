# @yadimon/steuer-spar-erklaerung-mcp

Kleiner, PC-blinder MCP-Wrapper für die lokale SteuerSparErklärung-API. Er
kennt ausschließlich `SSE_API_URL` und `SSE_API_TOKEN`; lokale Steuerfälle,
Belegpfade, PowerShell und Produktprofile bleiben im API-Paket.

```powershell
npm install --global @yadimon/steuer-spar-erklaerung-mcp@beta
steuer-spar-erklaerung-mcp --help
```

Ohne laufende API ist der Wrapper nicht nutzbar. Vollständige Einrichtung,
Sicherheitsgrenzen und der portable Weg stehen im
[Repository](https://github.com/yadimon/steuer-spar-erklaerung-mcp).
