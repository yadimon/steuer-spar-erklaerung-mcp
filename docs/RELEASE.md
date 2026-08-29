# Release-Prozess

Dieses Projekt veröffentlicht keinen gehosteten Dienst. Es hat zwei bewusst
getrennte Distributionsartefakte:

- `@yadimon/steuer-spar-erklaerung-api` für API und CLI;
- `@yadimon/steuer-spar-erklaerung-mcp` als PC-blinden MCP-Wrapper.

Das Root-`package.json` bleibt als Build-Workspace `private: true`. Nur die
beiden Manifeste unter `packages/` sind veröffentlichbar. Das GitHub-Release
trägt keine Anhänge: Es hält Tag, Release Notes und die Verbindung zum
Quellstand: die Produktartefakte sind allein die beiden npm-Tarballs. Ohne
Node.js und npm ist das Produkt nicht installierbar.

Die Windows-CI besitzt absichtlich nur Leserechte. Sie baut und prüft ein
kurzlebiges Artefakt, veröffentlicht aber weder Tags noch Releases. Jeder
öffentliche Release-Schritt braucht eine bewusste Maintainer-Freigabe.

## 1. Release-Änderung als Pull Request vorbereiten

Für eine neue Beta müssen gemeinsam aktualisiert werden:

- `package.json` und `package-lock.json`;
- beide `packages/*/package.json`-Versionen;
- `src/version.ts`;
- `docs/releases/v<version>.md`;
- `SECURITY.md`, Skills und README, soweit sich Supportgrenzen ändern;
- Profile, Evidenzmatrix und Verträge, wenn Operationen betroffen sind.

Der Pull Request nennt bekannte Live-Lücken und behauptet weder Stable- noch
Produktionsreife. Vor dem Merge müssen die Windows-CI und alle vorgesehenen
Reviews grün sein. CI-Artefakte sind nur ein sieben Tage verfügbarer Nachweis,
kein öffentliches Release.

## 2. Exakten Release-Commit herstellen

Nach dem Merge auf einem sauberen, aktuellen `main` arbeiten:

```powershell
git switch main
git pull --ff-only
git status --short
$version = node -p "require('./package.json').version"
$tag = "v$version"
git fetch origin --tags
```

`git status --short` muss leer sein. Paketversion, Lockfile, Runtimeversion und
Release Notes werden zusätzlich durch `test/release-metadata-contract.mjs`
gebunden. Ein vorhandener lokaler oder entfernter Tag darf nicht verschoben
oder wiederverwendet werden.

## 3. Release-Gates ausführen

```powershell
npm ci --ignore-scripts
npm audit --omit=dev --audit-level=high
npm test
npm run test:product
npm run pack
npm run publish:dry-run
npm run test:npm-clean-install
```

Die identische lokale Gatefolge kann als ein Befehl ausgeführt werden:

```powershell
npm run check
```

Der Release-Check begrenzt die umfangreiche Windows-/PowerShell-Suite
standardmäßig auf vier parallele Prozesse. Das priorisiert reproduzierbare
Release-Gates gegenüber maximaler Geschwindigkeit. Maintainer können den Wert
für einen passend dimensionierten Rechner bewusst überschreiben:

```powershell
$env:SSE_TEST_CONCURRENCY = '6'
npm run check
Remove-Item Env:SSE_TEST_CONCURRENCY
```

Der Clean-install-Smoke muss die drei CLI-Einstiege und den 99-Tool-MCP-Vertrag
aus zwei getrennten Tarballs bestätigen. Danach nochmals prüfen, dass der Worktree
sauber ist. Private Steuerdaten, lokale Konfigurationen und Test-Arbeitskopien
dürfen nicht im Commit oder Artefakt liegen.

## 4. Annotierten Tag und GitHub-Prerelease veröffentlichen

Erst nach ausdrücklicher Freigabe:

```powershell
git tag -a $tag -m $tag
git push origin $tag
gh release create $tag `
  --repo yadimon/steuer-spar-erklaerung-mcp `
  --verify-tag --prerelease --title $tag `
  --notes-file "docs/releases/$tag.md"
```

Das Release trägt bewusst **keine Anhänge**. Produktartefakte sind allein die
beiden npm-Tarballs; die automatisch von GitHub angebotenen Quellarchive sind
kein Release. Schlägt der Vorgang fehl, den vorhandenen Tag nicht neu erzeugen
oder verschieben; Ursache beheben und denselben noch unveröffentlichten
Releasevorgang fortsetzen.

## 5. Einmaliger npm-Bootstrap (bereits abgeschlossen)

Die beiden Paketnamen sind veröffentlicht und Trusted Publishing ist
eingerichtet. Diesen Abschnitt bei normalen Releases **nicht** wiederholen;
dafür ist ausschließlich `npm run release:current` maßgeblich. Die folgenden
Schritte bleiben nur als Wiederherstellungsreferenz für einen neuen npm-Scope
oder einen vollständig neuen Paketnamen erhalten.

Für eine echte Erstveröffentlichung muss der Maintainer lokal mit einem
npm-Konto angemeldet sein, das den Scope `@yadimon` besitzt oder darin
Veröffentlichungsrecht hat. npm braucht keine separate Freigabe des
GitHub-Repositorys und GitHub braucht keinen `NPM_TOKEN`. Die Verbindung zum
Repository entsteht danach über Trusted Publishing.

Erst nachdem Tag und GitHub-Prerelease aus Abschnitt 4 vollständig
zurückgelesen wurden, aus demselben sauberen Tag-Checkout einmalig ausführen:

```powershell
npm install --global npm@11.19.0
npm login
npm whoami
npm publish --workspace @yadimon/steuer-spar-erklaerung-mcp --ignore-scripts --tag latest --access public
npm publish --workspace @yadimon/steuer-spar-erklaerung-api --ignore-scripts --tag latest --access public
npm view '@yadimon/steuer-spar-erklaerung-mcp' dist-tags --json
npm view '@yadimon/steuer-spar-erklaerung-api' dist-tags --json
```

`npm whoami` muss `yadimon` oder ein Konto mit Veröffentlichungsrecht im
Scope `@yadimon` zeigen. Beide `latest`-Tags müssen exakt `$version` nennen.

## Ein unterstützter Kanal: `latest`

Das Projekt veröffentlicht und unterstützt bewusst nur den npm-Kanal
`latest`. Historische dist-tags können in der Registry noch sichtbar sein;
sie sind weder Installationsziel noch Supportzusage und werden nicht bei jedem
OIDC-Release nachträglich verwaltet. Der Grund ist eine Eigenschaft von Trusted Publishing: Laut
npm-Dokumentation deckt OIDC ausschließlich `npm publish` und `npm stage publish`
ab. `npm dist-tag` ist nicht enthalten und scheitert in der CI an `ENEEDAUTH`.

Ein Kanal lässt sich ohne Zusatzanmeldung deshalb nur an genau einer Stelle
setzen: beim Publish selbst über `npm publish --tag <kanal>`. Jeder weitere
Kanal bräuchte eine eigene Anmeldung — entweder einen Einmalcode des
Maintainers bei jedem Release oder ein langlebiges Write-Token. Token sind hier
ausgeschlossen, und ein wiederkehrender Handgriff pro Release ist eine
Fehlerquelle.

Daraus folgt: Jeder Publish setzt `latest`; auch `publishConfig` und der
Publish-Dry-run der beiden Paketmanifeste müssen diesen Tag tragen.
Installations- und `npx`-Befehle in README und Skills bleiben ungepinnt und
treffen dadurch automatisch den jeweils veröffentlichten Stand. Der
Workflow-Vertrag verbietet einen nachträglichen dist-tag-Schritt ausdrücklich,
damit diese Eigenschaft nicht unbemerkt verlorengeht.

Bei aktiviertem `auth-and-writes` verlangt npm dabei einen persönlichen OTP-
Schritt; den Code ausschließlich direkt in der eigenen Konsole oder npm-
Sitzung eingeben. Der erste lokale Publish besitzt noch keine OIDC-Provenance.

Danach auf npmjs.com **für beide Pakete getrennt** unter
`Settings -> Trusted Publisher -> GitHub Actions` eintragen:

- Organization or user: `yadimon`
- Repository: `steuer-spar-erklaerung-mcp`
- Workflow filename: `npm-publish.yml`
- Environment name: leer
- Allowed actions: `npm publish`

Anschließend unter `Publishing access` möglichst „Require two-factor
authentication and disallow tokens“ aktivieren. Das sperrt langlebige Tokens,
nicht OIDC. In GitHub weder ein klassisches npm-Token noch ein Secret
`NPM_TOKEN` anlegen.

Ab der nächsten vollständig vorbereiteten Version übernimmt der lokale
Orchestrator die Reihenfolge. Er verlangt einen sauberen `main`, identische
API-/MCP-Versionen und vorhandene Release Notes. Danach führt er alle Gates aus,
pusht Commit und annotierten Tag, erstellt und liest den GitHub-Prerelease
zurück, startet erst danach Trusted Publishing, führt den Registry-Smoke aus und
hängt zuletzt `latest` auf die neue Version:

```powershell
npm run release:current
```

Für eine gezielte Wiederaufnahme kann der Workflow weiterhin bewusst auf dem
bereits veröffentlichten GitHub-Tag gestartet werden:

```powershell
gh workflow run npm-publish.yml --repo yadimon/steuer-spar-erklaerung-mcp --ref $tag
```

Der Workflow akzeptiert nur `refs/tags/v<package-version>`, baut auf einem
GitHub-gehosteten Windows-Runner die Native-Runtime, führt Vollsuite und echten
Tarball-Clean-install aus und veröffentlicht zuerst MCP, danach API. Bei einem
Teilfehler nie eine bereits veröffentlichte Paketversion wiederverwenden oder
den Tag verschieben. Das fehlende Paket aus demselben Tag-Checkout gezielt
fertigstellen und anschließend beide Registry-Versionen zurücklesen. Der
veröffentlichte Installationsvertrag wird separat gegen die echten Registry-
Artefakte geprüft:

```powershell
npm run smoke:published
```

## 6. Öffentlichen Skill und Einstieg prüfen

Nach Veröffentlichung und Aktualisierung von `main`:

```powershell
npx skills add yadimon/steuer-spar-erklaerung-mcp --list
```

Die Ausgabe muss den einen Skill `steuer-spar-erklaerung` mit seiner aktuellen
Beschreibung zeigen. Danach den README-Schnellstart und den direkten Skill-Link
in einer frischen Browser-Sitzung öffnen.

Erst wenn Tag, Prerelease, beide Registry-Versionen, Skill-Auflistung und
README gemeinsam stimmen, ist der Stand für eine öffentliche Ankündigung
bereit.
