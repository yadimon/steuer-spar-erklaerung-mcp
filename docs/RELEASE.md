# Release-Prozess

Dieses Projekt veröffentlicht keine npm-Pakete und keinen gehosteten Dienst.
Das Produkt ist ein manuell freigegebenes Windows-x64-ZIP mit separater
SHA-256-Datei auf GitHub. `package.json` bleibt deshalb `private: true`.

Die Windows-CI besitzt absichtlich nur Leserechte. Sie baut und prüft ein
kurzlebiges Artefakt, veröffentlicht aber weder Tags noch Releases. Jeder
öffentliche Release-Schritt braucht eine bewusste Maintainer-Freigabe.

## 1. Release-Änderung als Pull Request vorbereiten

Für eine neue Beta müssen gemeinsam aktualisiert werden:

- `package.json` und `package-lock.json`;
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
npm run package:portable
npm run verify:portable-release
```

Der letzte Befehl muss Produkt, Version, Dateizahl, Bytezahl und SHA-256 des
bereits gebauten ZIP als `ok: true` ausgeben. Danach nochmals prüfen, dass der
Worktree sauber ist. Private Steuerdaten, lokale Konfigurationen und
Test-Arbeitskopien dürfen nicht im Commit oder Artefakt liegen.

## 4. Annotierten Tag und GitHub-Prerelease veröffentlichen

Erst nach ausdrücklicher Freigabe:

```powershell
git tag -a $tag -m $tag
git push origin $tag
gh release create $tag `
  --repo yadimon/steuer-spar-erklaerung-mcp `
  --verify-tag --prerelease --title $tag `
  --notes-file "docs/releases/$tag.md" `
  'artifacts\portable\steuer-spar-erklaerung.zip' `
  'artifacts\portable\steuer-spar-erklaerung.zip.sha256'
```

Nur `steuer-spar-erklaerung.zip` und
`steuer-spar-erklaerung.zip.sha256` sind Produktartefakte. Die automatisch von
GitHub angebotenen Quellarchive sind kein portables Release. Schlägt der
Upload fehl, den vorhandenen Tag nicht neu erzeugen oder verschieben; Ursache
beheben und denselben noch unveröffentlichten Releasevorgang fortsetzen.

## 5. Veröffentlichte Bytes zurücklesen

Die GitHub-Assets werden in einen neuen temporären Ordner heruntergeladen und
gegen lokale Bytes sowie die veröffentlichte Sidecar-Datei geprüft:

```powershell
$verifyDir = Join-Path ([System.IO.Path]::GetTempPath()) "sse-release-$version"
if (Test-Path -LiteralPath $verifyDir) { throw "Prüfordner existiert bereits: $verifyDir" }
New-Item -ItemType Directory -Path $verifyDir | Out-Null
gh release download $tag `
  --repo yadimon/steuer-spar-erklaerung-mcp `
  --dir $verifyDir `
  --pattern 'steuer-spar-erklaerung.zip*'

$localHash = (Get-FileHash -Algorithm SHA256 'artifacts\portable\steuer-spar-erklaerung.zip').Hash.ToLowerInvariant()
$remoteZip = Join-Path $verifyDir 'steuer-spar-erklaerung.zip'
$remoteSidecar = Join-Path $verifyDir 'steuer-spar-erklaerung.zip.sha256'
$remoteHash = (Get-FileHash -Algorithm SHA256 $remoteZip).Hash.ToLowerInvariant()
$publishedHash = ((Get-Content -LiteralPath $remoteSidecar -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
if ($localHash -ne $remoteHash -or $remoteHash -ne $publishedHash) {
  throw 'Lokales ZIP, GitHub-Asset und veröffentlichte SHA-256-Datei stimmen nicht überein.'
}
gh release view $tag --repo yadimon/steuer-spar-erklaerung-mcp
```

Den exakten Prüfordner erst nach erfolgreichem Vergleich entfernen. Zusätzlich
muss der annotierte Tag auf dem geprüften `main`-Commit liegen und das Release
als **Pre-release** sichtbar sein.

## 6. Öffentlichen Skill und Einstieg prüfen

Nach Veröffentlichung und Aktualisierung von `main`:

```powershell
npx skills add yadimon/steuer-spar-erklaerung-mcp --list
```

Die Ausgabe muss `steuer-spar-erklaerung` und
`steuer-spar-erklaerung-setup` mit den aktuellen Beschreibungen zeigen. Danach
den README-Schnellstart, den direkten Skill-Link und den Release-Download in
einer frischen Browser-Sitzung öffnen.

Erst wenn Tag, Prerelease, beide Assets, Hash-Readback, Skill-Auflistung und
README gemeinsam stimmen, ist der Stand für eine öffentliche Ankündigung
bereit.
