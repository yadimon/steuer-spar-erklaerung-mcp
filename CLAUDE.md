# Hinweise für Claude Code

Die vollständigen Agentenhinweise stehen in [AGENTS.md](AGENTS.md); die
wichtigste Regel steht zusätzlich hier, damit sie in jedem Fall geladen ist.
Beide Fassungen werden von `test/repository-privacy-contract.mjs` gleich
gehalten.

<!-- REGEL:PRIVATES -->
## Niemals lokale oder private Umgebung ins Repository

Dieses Repository ist öffentlich. Wer es liest, soll den Code verstehen — und
sonst nichts über die Maschinen erfahren, auf denen er entsteht und geprüft
wird.

Nicht committen und nicht in erzeugte Dokumentation schreiben:

- Namen, Kennungen oder Zustände lokaler Prüf- und Entwicklungsumgebungen:
  Maschinen, Abbilder, Rücksetzpunkte, Klone, Freigaben, Betreiberpfade;
- Protokolle einzelner Prüfläufe, Prüfsummen von Transferarchiven, Zeitstempel
  einzelner Sitzungen, Kennungen fremder Dienste;
- gemessene Laufzeiten einzelner Maschinen. Wer Leistung belegen will, nennt
  den **Messweg** — `npm run perf:api-mega` — statt das Ergebnis einer fremden
  Maschine, das ohnehin niemand nachvollziehen kann;
- private Steuerdaten, Fallnamen, lokale Konfigurationen, Anmeldedaten.

Solches Material gehört nach `localdev/` oder `.private/`; beide sind
gitignoriert. Das gilt gleichermaßen für Commit-Nachrichten, Release Notes und
jedes Dokument unter `docs/`.

Öffentliche Dokumentation beschreibt den Code und seine Zusagen: was er tut,
welche Grenzen gelten, wie man ihn selbst nachprüft.
<!-- /REGEL:PRIVATES -->
