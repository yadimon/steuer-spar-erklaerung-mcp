# Sicherheitsrichtlinie

## Unterstützte Version

Während der öffentlichen Beta wird nur die jeweils neueste vollständige
Release-Version unterstützt. `v0.1.0-beta.12` ist die aktuelle öffentlich
unterstützte Version für SteuerSparErklärung 2025: Tag, portables ZIP und
separate SHA-256-Datei sind gemeinsam auf der GitHub-Release-Seite
veröffentlicht. Ein künftiger vorbereiteter Quellstand wird erst mit diesen
drei Artefakten öffentlich unterstützt; bis dahin bleibt das jeweils jüngste
dort vollständige Release maßgeblich.
Quellstand, Tag oder automatisch erzeugtes GitHub-Quellarchiv allein gelten
nicht als portables Release.

Die npm-Pakete `@yadimon/steuer-spar-erklaerung-api` und
`@yadimon/steuer-spar-erklaerung-mcp` haben genau einen Kanal: `latest`. Er
wird beim Veröffentlichen gesetzt und zeigt auf den jüngsten unterstützten
Stand. Beide npm-Pakete müssen dieselbe Version tragen, und diese Version muss
dem jüngsten vollständigen GitHub-Release entsprechen. Ein einzelnes oder
abweichend versioniertes Paket gilt nicht als freigegebener Produktstand.

## Sicherheitsproblem melden

Melde mögliche Sicherheitslücken über GitHubs private Funktion **Report a
vulnerability** im Bereich **Security** dieses Repositorys. Veröffentliche
keine ausnutzbaren Details in einem öffentlichen Issue.

Besonders relevant sind:

- mögliche ELSTER-, Versand- oder Abschlusswege;
- Umgehungen der Arbeitskopie-, Hash-, Pfad- oder Readback-Prüfungen;
- Zugriff auf Pfade außerhalb des eingerichteten Arbeitsbereichs;
- Offenlegung von API-Token, Steuerdaten oder lokalen Dateipfaden;
- falsche Fenster-, Dialog-, Feld- oder Tabellenbindung bei Schreibaktionen.

## Keine persönlichen Daten einsenden

Füge einem Bericht niemals echte Steuerfälle, Belege, Namen, Anschriften,
Steuernummern, Steuer-IDs, IBANs, Zugangsdaten oder vollständige Screenshots
mit persönlichen Angaben bei. Erstelle eine synthetische Reproduktion oder
beschreibe zunächst nur die technische Fehlerklasse. Falls weitere Daten
unvermeidbar erscheinen, warte auf eine private Rückfrage des Maintainers.

## Betriebsgrenze

Die lokale API bindet ausschließlich an Loopback. `/healthz` ist als einzige
technische Zustandsroute ohne Token erreichbar; Discovery, OpenAPI und alle
Operationen verlangen das Bearer-Token. Der MCP-Wrapper kennt keine lokalen
PC-Pfade. Der Server darf keine Steuererklärung übermitteln und ersetzt weder
fachliche Prüfung noch Steuerberatung.
Die vom Setup erzeugte Client-Konfiguration enthält das Token nicht. Ein
API-seitiger lokaler Bootstrap liest die geschützte Konfiguration erst beim
Prozessstart und setzt URL und Token ausschließlich für den MCP-Kindprozess.

Das Token erteilt volle Autorität für alle vom aktiven Profil serverseitig
zugelassenen Operationen. Eine Freigabefrage im Agenten-Skill ist eine
Bedienrichtlinie, keine zweite serverseitige Approval-Sperre. Deshalb:

- API ausschließlich auf Loopback betreiben und niemals per Proxy, Tunnel,
  Portweiterleitung oder gemeinsamem Remote-Desktop-Dienst veröffentlichen;
- Konfigurationsdatei und MCP-Prozessumgebung wie ein lokales Geheimnis
  schützen; Token nicht in Chat, Log, Prozessargumente oder Git kopieren;
- Dateirechte des Konfigurationsordners auf das jeweilige Windows-Konto
  begrenzen;
- bei `buildDrift.drifted=true` keine Mutation ausführen, bis der neue Build
  gezielt verifiziert ist. API und direkter Worker erzwingen dies zusätzlich
  für die in `capabilities.operationPolicy[*].blockedOnBuildDrift`
  ausgewiesenen UI-/Steuerfallmutationen mit `build-drift`; Lesen, Diagnose und
  sicherer Cleanup bleiben möglich;
- einen privaten Desktop nur als Fokus-/UX-Isolation verstehen, nicht als
  Security-Sandbox.

Fehlgeschlagene, abgebrochene oder zeitlich abgelaufene Mutationen können einen
unbekannten Zustand hinterlassen. Vor einer Wiederholung immer Fall, Fenster,
Seite, Wert, Dirty-State und Datei-Hash neu lesen.

Produktfreigabe besteht aus zwei unabhängigen Manifestwerten: Nur
`status=supported` zusammen mit `operationAccess=full` darf vom Setup angeboten
werden. Ein Profil mit `verification-only` bleibt auch nach einer versehentlichen
reinen Statusänderung auf den expliziten Opt-in-Verifikationskatalog begrenzt.
