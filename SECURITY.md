# Sicherheitsrichtlinie

## Unterstützte Version

Während der öffentlichen Beta wird nur die jeweils neueste GitHub-Version
unterstützt. Aktuell ist dies `v0.1.0-beta.1` für SteuerSparErklärung 2025.

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

Die lokale API bindet ausschließlich an Loopback und verlangt ein Token. Der
MCP-Wrapper kennt keine lokalen PC-Pfade. Der Server darf keine Steuererklärung
übermitteln und ersetzt weder fachliche Prüfung noch Steuerberatung.
