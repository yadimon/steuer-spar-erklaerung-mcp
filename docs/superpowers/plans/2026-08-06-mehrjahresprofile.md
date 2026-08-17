# Mehrjahresprofile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dieselbe API bedient SteuerSparErklaerung 2024 (Engine 30) und 2025 (Engine 31) durch gemeinsame, strukturelle Elementbindung ohne Jahrescode und ohne Bildschirmkoordinaten.

**Architecture:** Ueberschrift und Suchfeld werden ueber die AutomationId ihres **Containers** gebunden, die in beiden Engines identisch ist, statt ueber die AutomationId des Blattknotens (fehlt in Engine 30) oder ueber Pixelbaender (nutzerabhaengig). Jahresabhaengiges Verhalten im gemeinsamen Code wird durch einen AST-Vertrag verboten. Ein Jahr gilt erst nach bestandenem Live-Smoke als `supported`.

**Tech Stack:** Windows PowerShell 5.1 (Worker, UIA), TypeScript/Node 22 (API, MCP, Profilvalidierung mit zod), Node-Testrunner ueber `test/suite-plan.mjs`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-06-mehrjahresprofile-design.md`.
- Alle PowerShell-Dateien muessen unter **Windows PowerShell 5.1** parsen: kein `??`, kein Ternaeroperator, kein `ForEach-Object -Parallel`. `test/powershell-syntax-contract.ps1` erzwingt das.
- **Keine Bildschirmkoordinaten als Selektor.** Relative Geometrie innerhalb einer strukturell gebundenen Region bleibt erlaubt (Beschriftung links vom Feld).
- **Nichts raten.** Findet eine Strukturregel nichts, wird `null` mit ausdruecklicher Begruendung gemeldet, nie ein Ersatzwert.
- Sicherheitsvertraege bleiben unveraendert: ELSTER-/Uebermittlungssperre, Readback vor Aenderungen, Button-Whitelist, Bindung an PID/HWND/Dateihash.
- Deutsche Bezeichner und Kommentare im Worker, deutsche Fehlertexte, wie im Bestand.
- Jeder neue Test wird in `test/suite-plan.mjs` **und** in der Namensliste in `test/suite-runner-contract.mjs` registriert, sonst schlaegt `suite-runner-contract` fehl.
- Commit-Nachrichten ohne Hinweise auf KI-Werkzeuge.
- Keine echten Steuerdaten in Repository-Dateien; Fixtures enthalten nur oeffentliche UI-Metadaten.

## File Structure

| Datei | Verantwortung |
| --- | --- |
| `powershell/structure-binding.ps1` | **neu.** Reine Funktionen: Container ueber AutomationId-Endung finden, Kindknoten eines Typs darin liefern. Kein UIA-Zugriff. |
| `powershell/sse-worker.ps1` | Ueberschrift, Suchfeld und `navigationAuswahl` auf die Strukturregeln umstellen; `Get-SSEHeadingAidSuffix` entfernen. |
| `profiles/2024/page-objects.json`, `profiles/2025/page-objects.json` | Containerendungen deklarieren; `headingAutomationIdSuffix` entfernen. |
| `profiles/2024/profile.json`, `profiles/2025/profile.json` | `verifiedBuild`; 2024 auf `experimental`. |
| `src/product-profiles.ts` | `verifiedBuild` validieren, `experimental` als ladbaren Status zulassen. |
| `src/api-executor.ts` | Operationen bei `experimental` fail-closed sperren. |
| `test/structure-binding-contract.ps1` | **neu.** Strukturregeln gegen aufgezeichnete Baeume beider Engines. |
| `profiles/<jahr>/fixtures/*.json` | **neu.** Aufgezeichnete Knotenbaeume je Engine, mit und ohne Ueberschriftscontainer. |
| `test/no-year-conditionals-contract.mjs` | **neu.** AST-Vertrag gegen jahresabhaengigen Kontrollfluss. |
| `profiles/<jahr>/tests/expectations.json` | **neu.** Musterfaelle und erwartete Werte fuer den Live-Smoke. |
| `test/live-muster-cases.mjs` | Jahresunabhaengig aus `expectations.json` speisen. |

---

### Task 1: Ehrlicher Profilstatus `experimental`

Heute laedt `loadProductProfile` nur `status = "supported"` und wirft sonst. Ein erkanntes, aber unverifiziertes Jahr hat keinen darstellbaren Zustand; 2024 steht deshalb faelschlich auf `supported`.

**Files:**
- Modify: `src/product-profiles.ts:169`
- Modify: `src/api-executor.ts`
- Modify: `src/api-config.ts` (optionales Feld `operateExperimental`)
- Modify: `profiles/2024/profile.json`
- Test: `test/product-profile-status-contract.mjs` (neu)

**Interfaces:**
- Consumes: nichts.
- Produces: `loadProductProfile(id)` liefert zusaetzlich `status: "supported" | "experimental"`. `src/api-executor.ts` exportiert unveraendert `createApiExecutor`.

- [ ] **Step 1: Write the failing test**

Create `test/product-profile-status-contract.mjs`:

```javascript
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProductProfile } from "../dist/product-profiles.js";

const root = mkdtempSync(join(tmpdir(), "sse-profile-status-"));
const dir = join(root, "2024");
mkdirSync(dir, { recursive: true });

const manifest = {
  schemaVersion: 1, id: "2024", status: "experimental",
  product: "SteuerSparErklaerung 2024", taxYear: 2024, engineFileMajor: 30,
  verifiedBuild: "30.0.127.0",
  executable: {
    name: "SSE.exe", installationFolderName: "Steuerjahr 2024",
    defaultRelativePath: "Steuertipps/SteuerSparErklaerung/Steuerjahr 2024/SSE.exe",
  },
  startModes: { normal: "ESt" }, additionalCaseYears: {},
  pageObjects: "page-objects.json", policy: "Fail closed.",
};
const catalog = {
  schemaVersion: 1, product: "SteuerSparErklaerung 2024", taxYear: 2024,
  engineFileMajor: 30,
  compatibility: { executableName: "SSE.exe", installationFolderName: "Steuerjahr 2024" },
  windows: { main: { process: "SSE", role: "main" } },
  pages: { "est.start": { heading: "Start" } },
};
writeFileSync(join(dir, "profile.json"), JSON.stringify(manifest), "utf8");
writeFileSync(join(dir, "page-objects.json"), JSON.stringify(catalog), "utf8");

const profile = loadProductProfile("2024", root);
assert.equal(profile.status, "experimental", "experimental muss ladbar sein");
assert.equal(profile.verifiedBuild, "30.0.127.0", "verifiedBuild muss durchgereicht werden");

process.stdout.write("Profilstatus: experimental ist ladbar und ausgewiesen\n");
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build:ts && node test/product-profile-status-contract.mjs
```

Expected: FAIL — `SSE-Profil '2024' ist nicht produktiv freigegeben.`

- [ ] **Step 3: Allow experimental to load and carry verifiedBuild**

In `src/product-profiles.ts`, add to `profileSchema` (after `engineFileMajor`):

```typescript
  verifiedBuild: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/u),
```

Replace the status guard at line 169:

```typescript
  if (parsed.status === "disabled") {
    throw new Error(`SSE-Profil '${id}' ist abgeschaltet.`);
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run build:ts && node test/product-profile-status-contract.mjs
```

Expected: PASS

- [ ] **Step 5: Block operating an experimental profile**

In `src/api-config.ts` das optionale Feld `operateExperimental` (boolean)
in das Konfigurationsschema aufnehmen. Der Setup-Wizard schreibt es nie;
es existiert ausschliesslich, damit Verifikationslaeufe und
Fixture-Aufnahmen ein experimentelles Jahr bedienen koennen.

In `src/api-executor.ts`, inside the executor before dispatching an operation, add a guard. Only catalogue and file **questions** stay allowed — `backup_cases` and `archive_cases` write files and are deliberately NOT in the list:

```typescript
const EXPERIMENTAL_ALLOWED = new Set([
  "capabilities", "health", "help", "product_info", "workspace_status",
  "list_cases", "case_hash", "workspace_file_list", "workspace_file_read_text",
]);
```

and before the worker call:

```typescript
if (
  profile.status === "experimental" &&
  config.operateExperimental !== true &&
  !EXPERIMENTAL_ALLOWED.has(operation)
) {
  throw new ExecutorError(
    `Produktprofil '${profile.id}' ist noch nicht verifiziert (status=experimental). ` +
      "Nur Katalog- und Dateiauskuenfte sind erlaubt. Fuer eine bewusste Jahresverifikation " +
      "operateExperimental: true in der API-Konfiguration setzen.",
    "profile-unverified",
  );
}
```

Use the existing error class and construction style already present in `src/api-executor.ts`.

Append to the test from Step 1, before the final `process.stdout.write` (uses the repo profile `2024`, which this task sets to `experimental`):

```javascript
const { createApiExecutor } = await import("../dist/api-executor.js");
const stubConfig = {
  host: "127.0.0.1", port: 1, token: "t".repeat(43),
  configPath: join(root, "config.json"),
  profileId: "2024",
  workspaceDir: join(root, "ws"), resultDir: join(root, "res"), caseDir: join(root, "cases"),
};
mkdirSync(stubConfig.workspaceDir, { recursive: true });
mkdirSync(stubConfig.resultDir, { recursive: true });
mkdirSync(stubConfig.caseDir, { recursive: true });

const blocked = createApiExecutor(stubConfig, async () => ({ ok: true, stub: true }));
await assert.rejects(
  () => blocked("windows", {}, 5000),
  (error) => /profile-unverified|nicht verifiziert/u.test(`${error.kind} ${error.message}`),
  "Ohne operateExperimental muss eine Betriebsoperation scheitern",
);

const allowed = createApiExecutor(
  { ...stubConfig, operateExperimental: true },
  async () => ({ ok: true, stub: true }),
);
const viaStub = await allowed("windows", {}, 5000);
assert.equal(viaStub.stub, true, "Mit operateExperimental muss der Worker erreicht werden");
```

Passt die Signatur von `createApiExecutor` oder des zurueckgegebenen
Executors nicht exakt, den Test an die tatsaechliche Signatur aus
`src/api-executor.ts` anpassen — die beiden Zusicherungen (gesperrt ohne
Flag, Stub erreicht mit Flag) bleiben unveraendert.

- [ ] **Step 6: Set 2024 to experimental and record verified builds**

`profiles/2024/profile.json`: `"status": "experimental"`, add `"verifiedBuild": "30.0.127.0"`.
`profiles/2025/profile.json`: keep `"status": "supported"`, add `"verifiedBuild": "31.0.1.0"`.

- [ ] **Step 7: Register the test**

`test/suite-plan.mjs`: add `nodeFile("product-profile-status", "test/product-profile-status-contract.mjs"),` next to the other `nodeFile` entries, and add `"product-profile-status"` to `FAST_STEP_NAMES`.
`test/suite-runner-contract.mjs`: add `"product-profile-status"` to `expectedNames`.

- [ ] **Step 8: Run the fast suite**

```bash
npm run test:fast
```

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/product-profiles.ts src/api-executor.ts profiles test
git commit -m "feat: let an unverified product year load as experimental"
```

---

### Task 2: Strukturelle Containerbindung

**Files:**
- Create: `powershell/structure-binding.ps1`
- Test: `test/structure-binding-contract.ps1` (neu)

**Interfaces:**
- Consumes: Knotenform aus `Get-UiSnapshot`: `i`, `p`, `d`, `type`, `name`, `aid`, `x`, `y`, `w`, `h`, `rid`. Tiefensuche in Vorordnung, Elternindex immer kleiner als Kindindex.
- Produces:
  - `Find-SSEContainerNode $Nodes $AidSuffix` → Knoten oder `$null`
  - `Get-SSEContainerChild $Nodes $AidSuffix $ChildType` → Knoten oder `$null` (erster Nachfahre des Containers mit diesem Typ, nach `y`,`x` sortiert)

- [ ] **Step 1: Write the failing test**

Create `test/structure-binding-contract.ps1`:

```powershell
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\powershell\structure-binding.ps1')

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Node([int]$I, [int]$P, [int]$D, [string]$Type, [string]$Name, [string]$Aid = '',
              [int]$X = 600, [int]$Y = 400) {
  [pscustomobject]@{
    i=$I; p=$P; d=$D; type=$Type; name=$Name; aid=$Aid
    x=$X; y=$Y; w=200; h=20; on=$true; rid="42.$I"
  }
}

# Engine 31: der Blattknoten traegt selbst eine AutomationId.
$engine31 = @(
  (Node 0 -1 0 'Group' '' 'SSE_Application.AAV4GLEngineWindow31.centralWidget')
  (Node 1  0 1 'Group' '' 'TopLevelHSplitter.RedThreadContent.ClientFrameSSE')
  (Node 2  1 2 'Group' '' 'RedThreadContent.ClientFrameSSE.ClientHeader')
  (Node 3  2 3 'Text'  'Abgabe der Steuererklaerung' 'ClientFrameSSE.ClientHeader.QLabel' 575 199)
)
# Engine 30: identischer Container, Blattknoten OHNE AutomationId.
$engine30 = @(
  (Node 0 -1 0 'Group' '' 'AAV4GLEngineWindow30.centralWidget')
  (Node 1  0 1 'Group' '' 'TopLevelHSplitter.RedThreadContent.ClientFrameSSE')
  (Node 2  1 2 'Group' '' 'RedThreadContent.ClientFrameSSE.ClientHeader')
  (Node 3  2 3 'Text'  'Erhalt der Steuerbescheiddaten' '' 556 153)
)

$suffix = '.ClientFrameSSE.ClientHeader'
Assert-True ((Get-SSEContainerChild $engine31 $suffix 'Text').name -eq 'Abgabe der Steuererklaerung') `
  'Engine-31-Ueberschrift wurde nicht ueber den Container gefunden.'
Assert-True ((Get-SSEContainerChild $engine30 $suffix 'Text').name -eq 'Erhalt der Steuerbescheiddaten') `
  'Engine-30-Ueberschrift wurde nicht ueber den Container gefunden.'

# Fehlt der Container, wird NICHTS geraten.
$ohne = @( (Node 0 -1 0 'Text' 'irgendein Absatz' '' 620 195) )
Assert-True ($null -eq (Get-SSEContainerChild $ohne $suffix 'Text')) `
  'Ohne Container wurde ein Ergebnis geraten statt $null geliefert.'

# Ein Text AUSSERHALB des Containers darf nie gewinnen, auch nicht weiter oben.
$mitAbsatz = @(
  (Node 0 -1 0 'Text'  'der SteuerSparErklaerung fuer das Steuerjahr 2025.' '' 620 100)
  (Node 1 -1 0 'Group' '' 'RedThreadContent.ClientFrameSSE.ClientHeader')
  (Node 2  1 1 'Text'  'Datensicherung' '' 575 199)
)
Assert-True ((Get-SSEContainerChild $mitAbsatz $suffix 'Text').name -eq 'Datensicherung') `
  'Ein Absatz ausserhalb des Containers hat die Ueberschrift verdraengt.'

# Suchfeld: Edit im Container 'SearchSSE', beide Engines.
$suche31 = @(
  (Node 0 -1 0 'ToolBar' '' 'AAV4GLEngineWindow31.MainToolBar')
  (Node 1  0 1 'Group'   '' 'MainToolBar.QWidget')
  (Node 2  1 2 'Group'   '' 'QWidget.SearchSSE')
  (Node 3  2 3 'Edit'    '' 'SearchSSE.QLineEdit' 2149 78)
)
$suche30 = @(
  (Node 0 -1 0 'ToolBar' '' 'AAV4GLEngineWindow30.MainToolBar')
  (Node 1  0 1 'Group'   '' '')
  (Node 2  1 2 'Group'   '' 'AAV4GLEngineWindow30.MainToolBar.QWidget.SearchSSE')
  (Node 3  2 3 'Edit'    '' '' 2149 78)
)
Assert-True ($null -ne (Get-SSEContainerChild $suche31 'SearchSSE' 'Edit')) 'Suchfeld Engine 31 nicht gefunden.'
Assert-True ($null -ne (Get-SSEContainerChild $suche30 'SearchSSE' 'Edit')) 'Suchfeld Engine 30 nicht gefunden.'

# Tiefe Verschachtelung: auch ein Enkel des Containers zaehlt.
$tief = @(
  (Node 0 -1 0 'Group' '' 'RedThreadContent.ClientFrameSSE.ClientHeader')
  (Node 1  0 1 'Group' '' '')
  (Node 2  1 2 'Text'  'tief liegende Ueberschrift' '' 575 199)
)
Assert-True ((Get-SSEContainerChild $tief $suffix 'Text').name -eq 'tief liegende Ueberschrift') `
  'Enkelknoten des Containers wurde nicht gefunden.'

Write-Output 'Strukturbindung: alle Vertraege bestanden'
```

- [ ] **Step 2: Run test to verify it fails**

```bash
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/structure-binding-contract.ps1
```

Expected: FAIL — `structure-binding.ps1` existiert nicht.

- [ ] **Step 3: Write the implementation**

Create `powershell/structure-binding.ps1`:

```powershell
<#
Strukturelle Elementbindung ueber Containerzugehoerigkeit.

Bildschirmkoordinaten sind kein tragfaehiger Selektor: Fenstergroesse, DPI,
Schriftskalierung und verschobene Bereiche unterscheiden sich je Nutzer. Ein
Offset, der auf einem PC stimmt, zeigt auf einem anderen auf den falschen Text.

Engine 30 laesst die AutomationId einzelner Blattknoten weg, die Engine 31
noch beschriftet. Die Containerhierarchie ist jedoch in beiden Engines
identisch beschriftet. Deshalb wird ueber den Container gebunden und von dort
in den gewuenschten Kindtyp abgestiegen.

Die Funktionen sind rein: sie erhalten einen bereits gelesenen Knotenbestand
und greifen weder auf UIA noch auf Fenster zu.
#>

function Find-SSEContainerNode {
  param(
    [Parameter(Mandatory)][AllowEmptyCollection()]$Nodes,
    [Parameter(Mandatory)][string]$AidSuffix
  )
  if (-not $AidSuffix) { return $null }
  foreach ($knoten in @($Nodes)) {
    $aid = [string]$knoten.aid
    if ($aid -and $aid.EndsWith($AidSuffix, [StringComparison]::Ordinal)) { return $knoten }
  }
  $null
}

function Get-SSEContainerChild {
  param(
    [Parameter(Mandatory)][AllowEmptyCollection()]$Nodes,
    [Parameter(Mandatory)][string]$AidSuffix,
    [Parameter(Mandatory)][string]$ChildType
  )
  $container = Find-SSEContainerNode $Nodes $AidSuffix
  if (-not $container) { return $null }

  # Nachfahren sammeln. Der Baum liegt in Vorordnung vor, der Elternindex ist
  # immer kleiner als der Kindindex; ein Vorwaertslauf genuegt.
  $imTeilbaum = @{}
  $imTeilbaum[[int]$container.i] = $true
  $treffer = New-Object System.Collections.ArrayList
  foreach ($knoten in @($Nodes)) {
    $index = [int]$knoten.i
    if ($index -eq [int]$container.i) { continue }
    if (-not $imTeilbaum.ContainsKey([int]$knoten.p)) { continue }
    $imTeilbaum[$index] = $true
    if ($knoten.type -eq $ChildType) { $null = $treffer.Add($knoten) }
  }
  if (-not $treffer.Count) { return $null }
  @($treffer | Sort-Object y, x)[0]
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/structure-binding-contract.ps1
```

Expected: PASS — `Strukturbindung: alle Vertraege bestanden`

- [ ] **Step 5: Register the test**

`test/suite-plan.mjs`: add `psFile("structure-binding", "test/structure-binding-contract.ps1"),` beside `psFile("window-scope", ...)`, and add `"structure-binding"` to `FAST_STEP_NAMES`.
`test/suite-runner-contract.mjs`: add `"structure-binding"` to `expectedNames`.

- [ ] **Step 6: Run the fast suite**

```bash
npm run test:fast
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add powershell/structure-binding.ps1 test
git commit -m "feat: bind ui elements through their labelled container"
```

---

### Task 3: Ueberschrift ueber den Container, ohne Geometrie

**Files:**
- Modify: `powershell/sse-worker.ps1:2108-2140` (`Get-SSEHeadingAidSuffix`, `Get-SSEHeading`)
- Modify: `profiles/2024/page-objects.json`, `profiles/2025/page-objects.json`
- Test: `test/structure-binding-contract.ps1` (erweitern)

**Interfaces:**
- Consumes: `Get-SSEContainerChild` aus Task 2.
- Produces: `Get-SSEHeading $Tree $Bounds $hwnd` → `[pscustomobject]@{ text; quelle }` mit `quelle` aus `clientHeader` oder `nicht-gefunden`. Der Parameter `$Bounds` entfaellt.

- [ ] **Step 1: Declare the container suffixes in both catalogues**

In `profiles/2025/page-objects.json` und `profiles/2024/page-objects.json`, `windows.main` bekommt:

```json
    "main": {
      "process": "SSE",
      "role": "main",
      "headingContainerAutomationIdSuffix": ".ClientFrameSSE.ClientHeader",
      "searchContainerAutomationIdSuffix": "SearchSSE"
    },
```

Das bisherige `headingAutomationIdSuffix` wird in beiden Dateien geloescht.

- [ ] **Step 2: Write the failing test**

Append to `test/structure-binding-contract.ps1` before the final `Write-Output`:

```powershell
# Beide ausgelieferten Kataloge muessen die Containerendungen deklarieren und
# die alte Blattendung losgeworden sein.
foreach ($jahr in @('2024', '2025')) {
  $pfad = Join-Path $PSScriptRoot "..\profiles\$jahr\page-objects.json"
  $katalog = Get-Content -LiteralPath $pfad -Raw | ConvertFrom-Json
  $haupt = $katalog.windows.main
  Assert-True ($haupt.headingContainerAutomationIdSuffix -eq '.ClientFrameSSE.ClientHeader') `
    "Profil $jahr deklariert keine Ueberschrifts-Containerendung."
  Assert-True ($haupt.searchContainerAutomationIdSuffix -eq 'SearchSSE') `
    "Profil $jahr deklariert keine Such-Containerendung."
  Assert-True ($null -eq $haupt.headingAutomationIdSuffix) `
    "Profil $jahr traegt noch die alte Blattendung headingAutomationIdSuffix."
}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/structure-binding-contract.ps1
```

Expected: FAIL, falls Step 1 noch nicht vollstaendig war; sonst PASS. Bei PASS trotzdem weiter — der eigentliche Beweis folgt in Step 5.

- [ ] **Step 4: Replace the heading implementation**

In `powershell/sse-worker.ps1` das Dot-Sourcing ergaenzen, direkt nach `. $windowScopeHelpers`:

```powershell
$structureBindingHelpers = Join-Path $PSScriptRoot 'structure-binding.ps1'
if (-not (Test-Path -LiteralPath $structureBindingHelpers -PathType Leaf)) {
  Fail "Strukturbindungs-Helfer fehlt: $structureBindingHelpers" 'not-found'
}
. $structureBindingHelpers
```

`$script:SSE_HEADING_AID_SUFFIX`, `Get-SSEHeadingAidSuffix` und `Get-SSEHeading` vollstaendig ersetzen durch:

```powershell
# Selektorendungen aus dem Profilkatalog. Einmal je Arbeitsprozess gelesen;
# der Katalog laege sonst bei jeder Seitenabfrage erneut auf der Platte.
$script:SSE_MAIN_WINDOW_SELECTORS = $null
function Get-SSEMainWindowSelectors {
  if ($null -eq $script:SSE_MAIN_WINDOW_SELECTORS) {
    $catalog = Get-SSEPageObjects
    $haupt = $catalog.windows.main
    $heading = [string]$haupt.headingContainerAutomationIdSuffix
    $search = [string]$haupt.searchContainerAutomationIdSuffix
    if (-not $heading -or -not $search) {
      Fail 'Page-Object-Katalog nennt keine Containerendungen fuer Ueberschrift und Suchfeld.' 'invalid-catalog'
    }
    $script:SSE_MAIN_WINDOW_SELECTORS = [pscustomobject]@{ heading = $heading; search = $search }
  }
  $script:SSE_MAIN_WINDOW_SELECTORS
}

# Seitenueberschrift ueber den beschrifteten Container bestimmen.
#
# Der Blattknoten traegt nur in Engine 31 eine eigene AutomationId; der
# Container traegt sie in beiden Engines. Ein Y-Band waere dagegen von
# Fenstergroesse, DPI und Schriftskalierung abhaengig und hat auf einer
# 2024-Statusseite bereits einen Fliesstextabsatz als Titel gemeldet.
#
# Findet der Container nichts, wird NICHTS geraten: eine falsche Ueberschrift
# wird in Segmentaufnahmen als Seitenidentitaet weiterverwendet.
function Get-SSEHeading {
  param($Tree, [IntPtr]$hwnd)
  $kopf = Get-SSEContainerChild $Tree.nodes (Get-SSEMainWindowSelectors).heading 'Text'
  if ($kopf) {
    return [pscustomobject]@{ text = [string]$kopf.name; quelle = 'clientHeader' }
  }
  [pscustomobject]@{ text = $null; quelle = 'nicht-gefunden' }
}
```

- [ ] **Step 5: Update all three call sites**

In `page`: `$kopfzeile = Get-SSEHeading $t $hwnd`.
In `collect`: `$kopfzeile = Get-SSEHeading $t $hwnd`.
In `goto`s `Ueberschrift`:

```powershell
    function Ueberschrift([IntPtr]$h) {
      $t = Walk-BoundTree $h 1200
      (Get-SSEHeading $t $h).text
    }
```

`Get-ContentBounds` wird fuer die Ueberschrift nicht mehr gebraucht; die
uebrigen Verwendungen in `page` und `collect` bleiben unveraendert.

- [ ] **Step 6: Verify syntax and the fast suite**

```bash
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/powershell-syntax-contract.ps1
npm run test:fast
```

Expected: beide PASS

- [ ] **Step 7: Prove it live on 2025**

Start the API against profile 2025, open a case, and read a page:

```bash
node dist/api-cli.js describe page
```

Then via the running API check that `page` returns `ueberschriftQuelle = "clientHeader"` and a real page title.

- [ ] **Step 8: Commit**

```bash
git add powershell/sse-worker.ps1 profiles test
git commit -m "fix: derive the page heading from its labelled container"
```

---

### Task 3b: Restliche Y-Band-Kopfzeilenstellen auf Get-SSEHeading

Task 3 hat die drei geplanten Stellen umgestellt; im Worker verbleiben vier
weitere, unabhaengige Kopfzeilen-Extraktionen mit demselben Y-Band-Muster
(`$r0.T + 190 .. + 290`). Auf Engine 30 liefern sie falsche Titel; die
Klick-Verifikation (`kopfVorher`) entscheidet damit auf 2024 falsch.

**Files:**
- Modify: `powershell/sse-worker.ps1` — die vier Fundstellen bei etwa
  Zeile 3305 (`Get-CurrentHeading`), 5505, 7251 (`kopfVorher`), 10382
  (`$script:kopf`). Vorher per Suche nach `T + 190` exakt bestimmen.
- Test: `test/structure-binding-contract.ps1` (nur falls eine Fundstelle
  eine eigene reine Hilfsfunktion ergibt; sonst keine Testaenderung noetig —
  die Regel selbst ist bereits gebunden).

**Interfaces:**
- Consumes: `Get-SSEHeading $Tree $hwnd` aus Task 3 (liefert `{ text; quelle }`).
- Produces: keine neuen; `Get-CurrentHeading` behaelt Signatur und
  Rueckgabetyp (string), intern via `(Get-SSEHeading $t $hwnd).text`.

- [ ] **Step 1: Alle Y-Band-Kopfzeilenstellen exakt lokalisieren**

```bash
grep -n "T + 190" powershell/sse-worker.ps1
```

Jede Fundstelle lesen und pruefen, ob sie eine SEITENUEBERSCHRIFT bestimmt
(nur diese umstellen) oder etwas anderes im selben Y-Band sucht (dann
unveraendert lassen und im Report begruenden).

- [ ] **Step 2: Jede Ueberschriften-Fundstelle auf Get-SSEHeading umstellen**

Muster: der lokale Baumlauf bleibt; die Zeile, die aus `$t.nodes` per
X/Y-Band den ersten Text greift, wird zu `(Get-SSEHeading $t $hwnd).text`
beziehungsweise nutzt das jeweils gebundene Fenster-Handle der Stelle.
Kein Verhalten sonst aendern; leere Ergebnisse bleiben leer (`$null`),
es wird nichts geraten.

- [ ] **Step 3: Syntax und schnelle Suite**

```bash
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/powershell-syntax-contract.ps1
npm run test:fast
```

Expected: beide PASS

- [ ] **Step 4: Commit**

```bash
git add powershell/sse-worker.ps1 test
git commit -m "fix: route every page heading read through the container rule"
```

---

### Task 4: Suchfeld ueber den Container

Fuenf Stellen binden das Suchfeld heute an die Engine-31-Blattendung `.MainToolBar.QWidget.SearchSSE.QLineEdit` oder an `aid -match 'SearchSSE'`. In Engine 30 traegt das Edit keine AutomationId; `goto` verliert dadurch seinen fokusfreien Suchweg, `accessibility_probe` und `set_value` sind dort unbenutzbar.

**Files:**
- Modify: `powershell/sse-worker.ps1:4489` (`Find-ExactAutomationElement`-Bindung)
- Modify: `powershell/sse-worker.ps1:6050` (`set_value`-Allowlist)
- Modify: `powershell/sse-worker.ps1:10144`, `powershell/sse-worker.ps1:11143` (`goto`-Suchwege)
- Test: `test/structure-binding-contract.ps1` (bereits in Task 2 abgedeckt)

**Interfaces:**
- Consumes: `Get-SSEContainerChild`, `Get-SSEMainWindowSelectors` aus Tasks 2 und 3.
- Produces: `Get-SSESearchFieldNode $Tree` → Knoten oder `$null`.

- [ ] **Step 1: Add the shared accessor**

In `powershell/sse-worker.ps1`, direkt nach `Get-SSEHeading`:

```powershell
# Globales Suchfeld ueber seinen beschrifteten Container binden. In Engine 30
# traegt das Edit selbst keine AutomationId; der Container 'SearchSSE' traegt
# sie in beiden Engines.
function Get-SSESearchFieldNode {
  param($Tree)
  Get-SSEContainerChild $Tree.nodes (Get-SSEMainWindowSelectors).search 'Edit'
}
```

- [ ] **Step 2: Replace both goto lookups**

Zeilen 10144 und 11143 ersetzen:

```powershell
      $feld = Get-SSESearchFieldNode $ts
```

beziehungsweise

```powershell
      $suchfeld = Get-SSESearchFieldNode $ts
```

Die umgebende Logik bleibt unveraendert; beide Stellen pruefen bereits auf
`$null`.

- [ ] **Step 3: Bind the probe and the allowlist structurally**

Bei `set_value` (Zeile ~6050) darf nicht mehr auf die feste Blattendung
verglichen werden. Statt `$allowedAid` das gebundene Suchfeld ermitteln und
den angeforderten Knoten dagegen pruefen:

```powershell
    $ts = Walk-Tree $hwnd
    $suchfeld = Get-SSESearchFieldNode $ts
    if (-not $suchfeld) {
      Fail 'Globales Suchfeld ist nicht strukturell gebunden; sse_set_value bleibt gesperrt.' 'blocked'
    }
    $ridRoh = Arg $a 'rid'
    $rid = [string]$ridRoh
    if (-not $rid -or $rid -ne [string]$suchfeld.rid) {
      Fail ('sse_set_value ist nur fuer das globale steuerneutrale Suchfeld zugelassen und verlangt dessen ' +
            'frische rid. Steuerfelder ueber sse_change_known_field, sse_change_field, sse_table_add, ' +
            'sse_table_update oder sse_combo_select aendern.') 'blocked'
    }
```

Bei der Probe (Zeile ~4489) `Find-ExactAutomationElement` durch die
Strukturbindung plus `Get-LiveElement` ersetzen:

```powershell
    $ts = Walk-Tree $hwnd
    $suchfeld = Get-SSESearchFieldNode $ts
    $target = $(if ($suchfeld) { Get-LiveElement $hwnd $suchfeld.rid } else { $null })
```

Die anschliessenden Pruefungen auf PID, `ValuePattern`, `IsReadOnly` und den
erwarteten Vorwert bleiben unveraendert.

- [ ] **Step 4: Update the argument contract for set_value**

`sse_set_value` verlangt jetzt `rid` statt `aid`. Die zu aendernden Stellen
zuerst genau bestimmen:

```bash
grep -rn "sse_set_value\|set_value" src/
```

In der Schemadatei, die `sse_set_value` definiert, `aid` durch `rid` als
verlangtes Feld ersetzen und die Beschreibung auf die frische RuntimeId des
strukturell gebundenen Suchfeldes umstellen. In `src/operation-catalog.ts`
pruefen, ob dort eine zusaetzliche Regel fuer `set_value` steht, und sie
entsprechend nachziehen. Danach:

```bash
npm run build:ts && npm run test:fast
```

Expected: PASS. Schlaegt `api-all-operations` oder `mcp-wrapper-catalog` fehl,
sind dort noch `aid`-Beispiele fuer `set_value` hinterlegt; diese auf `rid`
umstellen.

- [ ] **Step 5: Verify syntax**

```bash
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/powershell-syntax-contract.ps1
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add powershell/sse-worker.ps1 src test
git commit -m "fix: bind the global search field through its container"
```

---

### Task 5: Navigationsauswahl als eigenes Feld

Die Auswahl im Navigationsbaum ist eine unabhaengige Gegenprobe zur Ueberschrift. Sie darf sie nicht ersetzen: auf Unterseiten weicht sie bewusst ab.

**Files:**
- Modify: `powershell/sse-worker.ps1` (`page`)
- Test: `test/structure-binding-contract.ps1` (erweitern)

**Interfaces:**
- Consumes: Knotenfeld `selected` aus `Walk-BoundTree -WithValues`.
- Produces: `Get-SSENavigationSelectionFromNodes $Nodes` → `string` oder `$null`; `page` liefert zusaetzlich `navigationAuswahl`.

- [ ] **Step 1: Write the failing test**

Append to `test/structure-binding-contract.ps1` before the final `Write-Output`:

```powershell
# Navigationsauswahl: genau das ausgewaehlte TreeItem, sonst $null.
. (Join-Path $PSScriptRoot '..\powershell\structure-binding.ps1')
$baum = @(
  [pscustomobject]@{ i=0; p=-1; d=0; type='TreeItem'; name='Steuererklaerung'; aid=''; x=25; y=229; w=200; h=20; selected=$false; rid='42.0' }
  [pscustomobject]@{ i=1; p=-1; d=0; type='TreeItem'; name='Pruefen und Abgeben'; aid=''; x=25; y=272; w=200; h=20; selected=$true; rid='42.1' }
)
Assert-True ((Get-SSENavigationSelectionFromNodes $baum) -eq 'Pruefen und Abgeben') `
  'Ausgewaehlter Navigationsknoten wurde nicht erkannt.'

$ohneAuswahl = @(
  [pscustomobject]@{ i=0; p=-1; d=0; type='TreeItem'; name='Steuererklaerung'; aid=''; x=25; y=229; w=200; h=20; selected=$false; rid='42.0' }
)
Assert-True ($null -eq (Get-SSENavigationSelectionFromNodes $ohneAuswahl)) `
  'Ohne Auswahl wurde ein Name geraten.'

# Mehrdeutigkeit ist ein Fehlerzustand, kein Ratespiel.
$zweiAuswahlen = @(
  [pscustomobject]@{ i=0; p=-1; d=0; type='TreeItem'; name='A'; aid=''; x=25; y=229; w=200; h=20; selected=$true; rid='42.0' }
  [pscustomobject]@{ i=1; p=-1; d=0; type='TreeItem'; name='B'; aid=''; x=25; y=272; w=200; h=20; selected=$true; rid='42.1' }
)
Assert-True ($null -eq (Get-SSENavigationSelectionFromNodes $zweiAuswahlen)) `
  'Bei zwei ausgewaehlten Knoten wurde einer geraten.'
```

- [ ] **Step 2: Run test to verify it fails**

```bash
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/structure-binding-contract.ps1
```

Expected: FAIL — `Get-SSENavigationSelectionFromNodes` ist nicht definiert.

- [ ] **Step 3: Implement it**

Append to `powershell/structure-binding.ps1`:

```powershell
<#
Name des ausgewaehlten Navigationsknotens.

Unabhaengige Gegenprobe zur Seitenueberschrift; auf Hauptseiten stimmen beide
ueberein. Bei keiner oder mehrdeutiger Auswahl wird $null geliefert - die
Auswahl ist eine Zusatzangabe und darf nie geraten werden.
#>
function Get-SSENavigationSelectionFromNodes {
  param([Parameter(Mandatory)][AllowEmptyCollection()]$Nodes)
  $gewaehlt = @(@($Nodes) | Where-Object { $_.type -eq 'TreeItem' -and $_.selected -eq $true })
  if ($gewaehlt.Count -ne 1) { return $null }
  [string]$gewaehlt[0].name
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/structure-binding-contract.ps1
```

Expected: PASS

- [ ] **Step 5: Expose it in page**

In `powershell/sse-worker.ps1`, in der `Emit`-Struktur von `page`, direkt nach `ueberschriftQuelle`:

```powershell
      navigationAuswahl = (Get-SSENavigationSelectionFromNodes $t.nodes)
```

- [ ] **Step 6: Run the fast suite**

```bash
npm run test:fast
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add powershell test
git commit -m "feat: report the navigation selection as an independent cross-check"
```

---

### Task 6: Verifizierter Build und Drift-Meldung

**Files:**
- Modify: `powershell/sse-worker.ps1` (`health`, `product_info`)
- Test: `test/build-drift-contract.ps1` (neu)

**Interfaces:**
- Consumes: `verifiedBuild` aus `profile.json` (Task 1), `fileVersion` aus der bestehenden Produktidentitaet.
- Produces: `Get-SSEBuildDrift $VerifiedBuild $CurrentBuild` → `[pscustomobject]@{ verified; current; drifted }`; `health` und `product_info` liefern `buildDrift`.

- [ ] **Step 1: Write the failing test**

Create `test/build-drift-contract.ps1`:

```powershell
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\powershell\structure-binding.ps1')

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$gleich = Get-SSEBuildDrift '30.0.127.0' '30, 0, 127, 0'
Assert-True (-not $gleich.drifted) 'Gleicher Build wurde als Drift gemeldet.'

$drift = Get-SSEBuildDrift '30.0.127.0' '30, 0, 140, 0'
Assert-True ($drift.drifted) 'Ein neuerer Build wurde nicht als Drift gemeldet.'
Assert-True ($drift.verified -eq '30.0.127.0') 'Verifizierter Build fehlt in der Meldung.'
Assert-True ($drift.current -eq '30.0.140.0') 'Aktueller Build wurde nicht normalisiert.'

$unbekannt = Get-SSEBuildDrift '' '30, 0, 127, 0'
Assert-True ($unbekannt.drifted) 'Ohne verifizierten Build muss Drift wahr sein.'

Write-Output 'Build-Drift: alle Vertraege bestanden'
```

- [ ] **Step 2: Run test to verify it fails**

```bash
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/build-drift-contract.ps1
```

Expected: FAIL — `Get-SSEBuildDrift` ist nicht definiert.

- [ ] **Step 3: Implement it**

Append to `powershell/structure-binding.ps1`:

```powershell
<#
Abgleich des laufenden Produktbuilds mit dem Build, gegen den dieses Profil
zuletzt erfolgreich getestet wurde.

Die Steuerbarkeit haengt weiterhin nur an der Hauptversion; ein Minor-Update
bricht nichts ab. Sichtbar soll es trotzdem sein: das beobachtete Update von
30.0.106 auf 30.0.127 blieb sonst unbemerkt.
#>
function Get-SSEBuildDrift {
  param([string]$VerifiedBuild, [string]$CurrentBuild)
  $aktuell = ([string]$CurrentBuild) -replace '[^0-9.,]', '' -replace ',\s*', '.' -replace '\s', ''
  $verifiziert = ([string]$VerifiedBuild).Trim()
  [pscustomobject]@{
    verified = $verifiziert
    current = $aktuell
    drifted = -not $verifiziert -or $verifiziert -ne $aktuell
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/build-drift-contract.ps1
```

Expected: PASS

- [ ] **Step 5: Expose it in health and product_info**

Im Worker den verifizierten Build aus dem Profil lesen (`$script:SSE_PROFILE.verifiedBuild`) und in beiden `Emit`-Strukturen ergaenzen:

```powershell
      buildDrift = (Get-SSEBuildDrift ([string]$script:SSE_PROFILE.verifiedBuild) ([string]$identity.fileVersion))
```

`$identity` ist die bereits vorhandene Produktidentitaet der jeweiligen Operation.

- [ ] **Step 6: Register the test and run the fast suite**

`test/suite-plan.mjs`: add `psFile("build-drift", "test/build-drift-contract.ps1"),` and `"build-drift"` to `FAST_STEP_NAMES`.
`test/suite-runner-contract.mjs`: add `"build-drift"` to `expectedNames`.

```bash
npm run test:fast
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add powershell test
git commit -m "feat: report drift from the build a profile was verified against"
```

---

### Task 7: Vertrag gegen jahresabhaengigen Kontrollfluss

**Files:**
- Create: `test/no-year-conditionals-contract.mjs`

**Interfaces:**
- Consumes: nichts.
- Produces: nichts; reiner Vertragstest.

- [ ] **Step 1: Write the test**

Create `test/no-year-conditionals-contract.mjs`:

```javascript
/**
 * Jahresabhaengiges Verhalten gehoert ins Profil, nicht in den gemeinsamen Code.
 *
 * Verboten sind Engine-Literale und Verzweigungen ueber die Profil-ID im
 * geteilten Worker- und API-Code. Reine Zahlen ohne Kontrollfluss - etwa
 * Wertebereiche in Schemata - sind erlaubt und stehen in der Ausnahmeliste.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const roots = ["powershell", "src"];
const forbidden = [
  { pattern: /AAV4GLEngineWindow\d+/gu, why: "Engine-Literal statt Profilangabe" },
  { pattern: /Steuerjahr\s+20\d\d/gu, why: "Installationsordner statt Profilangabe" },
  { pattern: /\bprofileId\s*(===?|-eq|!==?|-ne)\s*['"]20\d\d['"]/gu, why: "Verzweigung ueber die Profil-ID" },
  { pattern: /SSE_PROFILE_ID\s*(===?|-eq|!==?|-ne)\s*['"]20\d\d['"]/gu, why: "Verzweigung ueber die Profil-ID" },
  { pattern: /engineFileMajor\s*(===?|-eq|!==?|-ne)\s*\d+/gu, why: "Verzweigung ueber die Engine-Hauptversion" },
];

// Kurz und begruendet. Jeder weitere Eintrag ist eine bewusste Entscheidung.
const exceptions = new Map([
  ["src/product-profiles.ts", "Wertebereiche des Schemas und der dokumentierte Vorgabewert der Profil-ID"],
]);

const files = [];
for (const root of roots) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(ps1|ts)$/u.test(entry.name)) continue;
    files.push(`${root}/${entry.name}`);
  }
}
assert.ok(files.length > 0, "Keine gemeinsamen Quelldateien gefunden.");

const violations = [];
for (const file of files) {
  if (exceptions.has(file)) continue;
  const text = readFileSync(file, "utf8");
  for (const { pattern, why } of forbidden) {
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      violations.push(`${file}:${line}: ${why} -> ${match[0]}`);
    }
  }
}

assert.deepEqual(
  violations,
  [],
  `Jahresabhaengiges Verhalten im gemeinsamen Code:\n${violations.join("\n")}`,
);
process.stdout.write(`Jahresbedingungen: ${files.length} gemeinsame Dateien sauber\n`);
```

- [ ] **Step 2: Run it and fix what it finds**

```bash
node test/no-year-conditionals-contract.mjs
```

Expected zunaechst FAIL. Jede Fundstelle entweder ins Profil verschieben oder,
wenn sie nachweislich keinen Kontrollfluss verzweigt, mit Begruendung in
`exceptions` eintragen. Kommentare und Meldungstexte, die eine Jahreszahl nur
erwaehnen, duerfen umformuliert werden statt in die Ausnahmeliste zu wandern.

- [ ] **Step 3: Register the test**

`test/suite-plan.mjs`: add `nodeFile("no-year-conditionals", "test/no-year-conditionals-contract.mjs"),` and `"no-year-conditionals"` to `FAST_STEP_NAMES`.
`test/suite-runner-contract.mjs`: add `"no-year-conditionals"` to `expectedNames`.

- [ ] **Step 4: Run the fast suite**

```bash
npm run test:fast
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test
git commit -m "test: keep year dependent control flow out of shared code"
```

---

### Task 8: Aufgezeichnete Fixtures beider Engines

Die Strukturregeln werden bisher gegen handgeschriebene Baeume geprueft. Ein aufgezeichneter echter Baum je Engine bindet zusaetzlich, dass die Annahme ueber die Containerhierarchie im Produkt wirklich gilt.

**Files:**
- Create: `profiles/2024/fixtures/heading-vorhanden.json`, `profiles/2024/fixtures/heading-fehlt.json`
- Create: `profiles/2025/fixtures/heading-vorhanden.json`, `profiles/2025/fixtures/heading-fehlt.json`
- Modify: `test/structure-binding-contract.ps1`

**Interfaces:**
- Consumes: `Get-SSEContainerChild` aus Task 2.
- Produces: Fixture-Format `{ "engine": 30, "erwarteteUeberschrift": "…"|null, "nodes": [ … ] }` mit den Feldern `i`,`p`,`d`,`type`,`name`,`aid`,`x`,`y`,`w`,`h`,`rid`.

- [ ] **Step 1: Record the fixtures**

Mit laufender API je Jahr eine Seite **mit** und eine **ohne**
Ueberschriftscontainer aufnehmen. Auf 2024 ist die ELSTER-Statusseite
`Erhalt der Steuerbescheiddaten` ein belegter Fall mit Container; eine Seite
ohne Container wird beim Durchgang gesucht und, falls keine existiert, durch
Entfernen des Containerknotens aus einer echten Aufnahme erzeugt und im
Fixture als `"kuenstlich": true` gekennzeichnet.

Nur `type`, `name`, `aid`, `i`, `p`, `d`, Geometrie und `rid` uebernehmen.
**Keine Feldwerte**, keine Namen, keine Steuernummern.

- [ ] **Step 2: Write the failing test**

Append to `test/structure-binding-contract.ps1` before the final `Write-Output`:

```powershell
# Aufgezeichnete Baeume beider Engines. Sie binden, dass die Containerannahme
# im echten Produkt gilt und nicht nur in handgeschriebenen Beispielen.
$fixtureAnzahl = 0
foreach ($jahr in @('2024', '2025')) {
  $ordner = Join-Path $PSScriptRoot "..\profiles\$jahr\fixtures"
  Assert-True (Test-Path -LiteralPath $ordner) "Fixture-Ordner fuer $jahr fehlt."
  foreach ($datei in Get-ChildItem -LiteralPath $ordner -Filter '*.json') {
    $fixture = Get-Content -LiteralPath $datei.FullName -Raw | ConvertFrom-Json
    $gefunden = Get-SSEContainerChild $fixture.nodes '.ClientFrameSSE.ClientHeader' 'Text'
    if ($null -eq $fixture.erwarteteUeberschrift) {
      Assert-True ($null -eq $gefunden) "$($datei.Name): Ueberschrift wurde geraten, obwohl keine erwartet ist."
    } else {
      Assert-True ($gefunden.name -eq $fixture.erwarteteUeberschrift) `
        "$($datei.Name): erwartet '$($fixture.erwarteteUeberschrift)', gelesen '$($gefunden.name)'."
    }
    $fixtureAnzahl++
  }
}
Assert-True ($fixtureAnzahl -ge 4) "Zu wenige Fixtures: $fixtureAnzahl"
```

- [ ] **Step 3: Run test to verify it passes**

```bash
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File test/structure-binding-contract.ps1
```

Expected: PASS

- [ ] **Step 4: Check the privacy contract**

```bash
node test/repository-privacy-contract.mjs
```

Expected: PASS. Schlaegt er an, enthaelt ein Fixture noch Werte, die es nicht enthalten darf.

- [ ] **Step 5: Commit**

```bash
git add profiles test
git commit -m "test: bind the container assumption to recorded trees of both engines"
```

---

### Task 9: Musterfall-Erwartungen ins Profil

`test/live-muster-cases.mjs` verdrahtet Pfad, Dateinamen und erwartete Betraege fuer 2025 fest und ist dadurch nur fuer ein Jahr brauchbar.

**Files:**
- Create: `profiles/2025/tests/expectations.json`, `profiles/2024/tests/expectations.json`
- Modify: `test/live-muster-cases.mjs:15-50`

**Interfaces:**
- Consumes: `profile.executable.installationFolderName` fuer den Musterfallordner.
- Produces: Format
  `{ "musterDirRelative": "musterfaelle", "cases": [ { "id": "est", "file": "…", "mode": "normal", "operation": "sse_result_details", "expectedRows": [ ["Label","Wert"] ] } ] }`

- [ ] **Step 1: Move the 2025 expectations into the profile**

`profiles/2025/tests/expectations.json` mit den heute in
`test/live-muster-cases.mjs` stehenden Definitionen und Zeilen fuer `est`
und `gew` anlegen. Werte unveraendert uebernehmen.

- [ ] **Step 2: Create the 2024 expectations**

Fuer 2024 dieselbe Struktur mit den ausgelieferten Musterfaellen
(`.ESt2024`, `.Gew2024`). Die erwarteten Zeilen werden **gemessen**, nicht
geschaetzt: Musterfall oeffnen, `result_details` lesen, Werte uebernehmen.

- [ ] **Step 3: Make the test year agnostic**

In `test/live-muster-cases.mjs` den festen `defaultMusterDir` und
`allDefinitions` ersetzen: Profil-ID aus `SSE_PROFILE_ID` (Vorgabe `2025`)
lesen, `profiles/<id>/tests/expectations.json` laden, den Musterfallordner
aus dem Installationsordner des Profils bilden. `SSE_MUSTER_DIR` bleibt als
Ueberschreibung erhalten.

- [ ] **Step 4: Run the live smoke for 2025**

```bash
node test/with-api.mjs node test/live-muster-cases.mjs
```

Expected: PASS, unveraendertes Ergebnis gegenueber vorher.

- [ ] **Step 5: Run the live smoke for 2024**

Mit `SSE_PROFILE_ID=2024` und der 2024-Konfiguration wiederholen. Solange
2024 `experimental` ist, setzt die Harness-Konfiguration dafuer
`operateExperimental: true` (bewusster Verifikationslauf laut Spec).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add profiles test
git commit -m "test: drive the sample case smoke from per year expectations"
```

---

### Task 10: 2024 verifizieren und freigeben

**Files:**
- Modify: `profiles/2024/profile.json`
- Modify: `docs/ARCHITEKTUR.md:240-244`

**Interfaces:**
- Consumes: alle vorherigen Tasks.
- Produces: `profiles/2024/profile.json` mit `status: "supported"`.

- [ ] **Step 1: Run the full 2024 operation sweep**

Solange 2024 noch `experimental` ist, laeuft der Sweep mit
`operateExperimental: true` in der API-Konfiguration (bewusster
Verifikationslauf laut Spec).

Gegen eine **Kopie** eines Musterfalls, nie gegen einen echten Steuerfall.
Je Operation Ergebnis und Dauer festhalten:
`launch`, `ui_state`, `page`, `read_page`, `goto` (Treffer und Fehlschlag),
`subpages`, `find`, `snapshot`, `menu`, `read_table`, `result_details`,
`checker_run`, `checker_results`, `checker_open`, `checker_detail`,
`checker_close`, `collect`, `case_hash`, `close`.

- [ ] **Step 2: Repeat the sweep for Gew2024**

Startmodus `einur` gegen eine Kopie von `MusterGewinnermittlung.Gew2024`,
zusaetzlich `table_read` und die `ustva_*`-Lesewege.

- [ ] **Step 3: Fix what the sweep reveals, one finding at a time**

Fuer jeden Fehlschlag: erst Ursache belegen, dann einen Test schreiben, der
ihn bindet, dann beheben. Keine Sammelkorrekturen.

- [ ] **Step 4: Confirm nothing was written**

```bash
node dist/api-cli.js case_hash
```

Der SHA-256 jeder Arbeitskopie muss dem Ausgangswert entsprechen.

- [ ] **Step 5: Promote 2024**

`profiles/2024/profile.json`: `"status": "supported"`, `verifiedBuild` auf
den tatsaechlich getesteten Build setzen.

- [ ] **Step 6: Update the architecture contract**

In `docs/ARCHITEKTUR.md` den Satz „Aktuell ist ausschliesslich 2025 produktiv
unterstuetzt" auf den erreichten Stand bringen und den erlaubten
Funktionsumfang je Jahr benennen: 2024 lesend und navigierend, Schreiben
weiterhin fail-closed mangels verifiziertem `focuslessCommits`-Katalog.

- [ ] **Step 7: Run everything**

```bash
npm run test:fast
npm test
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add profiles docs
git commit -m "feat: support product year 2024 for reading and navigation"
```

---

## Offene Punkte ausserhalb dieses Plans

- Schreiben auf 2024. Der `focuslessCommits`-Katalog fuer Engine 30 bleibt
  leer; Schreiboperationen scheitern dort fail-closed.
- Aufteilung des Dispatchers. Gemessen rund 775 ms je Aufruf entfallen auf
  das Kompilieren eines `switch` mit 78 Zweigen und 522 KB Quelltext.
- `Get-Zweig` bildet Seitennamen fest auf Navigationszweige ab und gehoert
  fachlich in den Profilkatalog.
