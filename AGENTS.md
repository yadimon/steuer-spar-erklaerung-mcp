# Hinweise für Agenten

Diese Datei gilt für jedes Werkzeug, das in diesem Repository arbeitet.
Ergänzend gilt [CONTRIBUTING.md](CONTRIBUTING.md).

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

Solches Material gehört außerhalb dieses Repositorys in eine getrennte lokale
Arbeitsumgebung. Das gilt gleichermaßen für Commit-Nachrichten, Release Notes
und jedes Dokument unter `docs/`. Gitignore-Einträge für frühere lokale
Verzeichnisse bleiben lediglich als zusätzliche Schutzgrenze bestehen.

Öffentliche Dokumentation beschreibt den Code und seine Zusagen: was er tut,
welche Grenzen gelten, wie man ihn selbst nachprüft.
<!-- /REGEL:PRIVATES -->

## Arbeitsweise

- Vor einer Veröffentlichung ist `npm run check` das vollständige lokale Gate.
- Commit-Nachrichten folgen Conventional Commits und beschreiben ausschließlich
  die Codeänderung.
- Keine Fallbacks und keine Attrappen ohne ausdrückliche Aufforderung: Code
  funktioniert nachvollziehbar oder scheitert mit einer aussagekräftigen
  Meldung.
- Keine bedingte Logik in Tests. Ein Test, der sich selbst überspringen kann,
  verbirgt Fehler.
