# Sicherheitsrichtlinie

## Unterstützte Version

Während der öffentlichen Beta wird nur die jeweils neueste vollständige
Release-Version unterstützt. `v0.1.0-beta.20` ist die aktuelle öffentlich
unterstützte Version für SteuerSparErklärung 2025: Release-Tag und die beiden
gleichnamigen npm-Pakete gehören zusammen. Ein künftiger vorbereiteter
Quellstand wird erst öffentlich unterstützt, wenn beide Pakete unter dieser
Version veröffentlicht sind; bis dahin bleibt das jeweils jüngste
dort vollständige Release maßgeblich.
Ein Quellstand, ein Tag oder ein automatisch erzeugtes GitHub-Quellarchiv
allein ist kein unterstütztes Release.

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
- Offenlegung von Steuerdaten oder lokalen Dateipfaden;
- falsche Fenster-, Dialog-, Feld- oder Tabellenbindung bei Schreibaktionen.

## Keine persönlichen Daten einsenden

Füge einem Bericht niemals echte Steuerfälle, Belege, Namen, Anschriften,
Steuernummern, Steuer-IDs, IBANs, Zugangsdaten oder vollständige Screenshots
mit persönlichen Angaben bei. Erstelle eine synthetische Reproduktion oder
beschreibe zunächst nur die technische Fehlerklasse. Falls weitere Daten
unvermeidbar erscheinen, warte auf eine private Rückfrage des Maintainers.

## Betriebsgrenze

Die lokale API bindet ausschließlich an Loopback und kennt **keine
Anmeldung**. Jeder Prozess des angemeldeten Windows-Kontos darf sie aufrufen —
dieselbe Vertrauensgrenze, in der auch die Steuersoftware selbst läuft. Ein
Token hätte daran nichts geändert: Wer lokal Code ausführt, kann es lesen.

Was die API abwehrt, ist der eine Weg von außen in diese Grenze hinein: eine
beliebige Webseite im Browser des Nutzers erreicht `127.0.0.1` ebenfalls.
Deshalb beantwortet die API jede Anfrage mit `403`, die

- eine `Origin`-Kopfzeile trägt — Browser senden sie bei fremder Herkunft und
  können sie nicht fälschen;
- eine `Sec-Fetch-Site`-Kopfzeile ungleich `none` trägt — aktuelle Browser
  senden sie immer mit;
- deren `Host` kein Loopback-Name ist — das schlägt DNS-Rebinding, bei dem eine
  Seite ihren eigenen Namen auf `127.0.0.1` zeigen lässt und der Browser danach
  ohne `Origin` sendet.

Ergänzend verlangt jedes POST `Content-Type: application/json`, was ein
HTML-Formular nicht erzeugen kann. Ein lokaler Klient sendet keine dieser
Kopfzeilen; ein Browser mindestens eine.

Der MCP-Wrapper kennt keine lokalen PC-Pfade. Der Server darf keine
Steuererklärung übermitteln und ersetzt weder fachliche Prüfung noch
Steuerberatung.

Wer die API erreicht, hat volle Autorität für alle vom aktiven Profil
serverseitig zugelassenen Operationen. Eine Freigabefrage im Agenten-Skill ist
eine Bedienrichtlinie, keine zweite serverseitige Approval-Sperre. Deshalb:

- API ausschließlich auf Loopback betreiben und niemals per Proxy, Tunnel,
  Portweiterleitung oder gemeinsamem Remote-Desktop-Dienst veröffentlichen —
  ein Reverse-Proxy, der die Herkunftskopfzeilen entfernt, hebt genau den
  Schutz auf, der hier beschrieben ist;
- Dateirechte des Konfigurations- und Arbeitsordners auf das jeweilige
  Windows-Konto begrenzen;
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
`status=supported` zusammen mit `operationAccess=full` darf produktiv
angeboten werden. Ein Profil mit `verification-only` bleibt auch nach einer versehentlichen
reinen Statusänderung auf den expliziten Opt-in-Verifikationskatalog begrenzt.
