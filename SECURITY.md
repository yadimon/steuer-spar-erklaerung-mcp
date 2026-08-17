# Sicherheitsrichtlinie

## Unterstützte Version

Während der öffentlichen Beta wird nur die jeweils neueste GitHub-Version
unterstützt. Dieser Quellstand bereitet `v0.1.0-beta.3` für
SteuerSparErklärung 2025 vor. Bis ZIP und separate SHA-256-Datei tatsächlich
auf GitHub veröffentlicht sind, bleibt `v0.1.0-beta.2` die letzte öffentliche
unterstützte Version. Quellstand, Tag oder automatisch erzeugtes GitHub-
Quellarchiv allein gelten nicht als portables Release.

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
