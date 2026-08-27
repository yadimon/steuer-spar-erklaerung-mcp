/**
 * Fail-closed regression test for the SSE-2025 product boundary.
 * All calls are rejected before a process, desktop, or tax case can be opened.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SSE_MCP_TOOL_OPERATIONS } from "../dist/operation-catalog.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const server = join(root, "dist", "index.js");
const worker = join(root, "powershell", "sse-worker.ps1");
const workerSource = readFileSync(worker, "utf8");
const workerBridgeSource = readFileSync(join(root, "src", "worker.ts"), "utf8");
const desktopMarkerNodeSource = readFileSync(join(root, "src", "desktop-marker.ts"), "utf8");
const desktopMarkerWorkerSource = readFileSync(join(root, "powershell", "desktop-marker.ps1"), "utf8");
const desktopLauncherSource = readFileSync(join(root, "powershell", "run-on-desktop.ps1"), "utf8");
const workerTransportSource = readFileSync(join(root, "powershell", "worker-transport-common.ps1"), "utf8");
const tableRegionSource = readFileSync(join(root, "powershell", "table-region.ps1"), "utf8");
const tableValuesSource = readFileSync(join(root, "powershell", "table-values.ps1"), "utf8");
const tableComboSource = readFileSync(join(root, "powershell", "table-combobox.ps1"), "utf8");
const mcpRegistrySource = readFileSync(join(root, "src", "mcp-registry.ts"), "utf8");
const mcpToolSources = readdirSync(join(root, "src"))
  .filter((name) => /^mcp-tools(?:-[a-z]+)?\.ts$/.test(name))
  .sort()
  .map((name) => readFileSync(join(root, "src", name), "utf8"));
const serverSource = [readFileSync(join(root, "src", "index.ts"), "utf8"), mcpRegistrySource, ...mcpToolSources].join("\n");
const mcpResponseSource = readFileSync(join(root, "src", "mcp-response.ts"), "utf8");
const operationCatalogSource = readdirSync(join(root, "src"))
  .filter((name) => /^(?:operation-catalog|operation-schema-primitives|mcp-operation-schemas|mcp-schemas-[a-z]+)\.ts$/.test(name))
  .sort()
  .map((name) => readFileSync(join(root, "src", name), "utf8"))
  .join("\n");
const apiContractSource = readFileSync(join(root, "src", "api-contract.ts"), "utf8");
const apiExecutorSource = readFileSync(join(root, "src", "api-executor.ts"), "utf8");
const pageObjectsExecutorSource = readFileSync(join(root, "src", "page-objects-executor.ts"), "utf8");
const launchExecutorSource = readFileSync(join(root, "src", "launch-executor.ts"), "utf8");
const skillSource = readFileSync(join(root, "skills", "steuer-spar-erklaerung", "SKILL.md"), "utf8");
const liveWriteJourneySource = readFileSync(join(root, "test", "live-write-journey.mjs"), "utf8");
const liveJourneyRunnerSource = readFileSync(join(root, "test", "run-live-journey.mjs"), "utf8");
const hiddenDesktopLifecycleSource = readFileSync(join(root, "test", "hidden-desktop-lifecycle.mjs"), "utf8");
const profileManifest = JSON.parse(readFileSync(join(root, "profiles", "2025", "profile.json"), "utf8"));
const catalog = JSON.parse(readFileSync(join(root, "profiles", "2025", "page-objects.json"), "utf8"));
const catalogText = JSON.stringify(catalog);
const nativeSource = join(root, "powershell", "sse-native.cs");
const nativeDll = join(root, "powershell", "sse-native.dll");
const nativeSourceText = readFileSync(nativeSource, "utf8");
const nativeLoaderSource = readFileSync(join(root, "powershell", "load-native.ps1"), "utf8");
const nativeBuildSource = readFileSync(join(root, "powershell", "build-native.ps1"), "utf8");
const nativeHashSidecar = join(root, "powershell", "sse-native.sha256");
const markerPath = join(tmpdir(), "sse-mcp-desktop.txt");
const requireInstalledProduct = process.argv.includes("--require-installed");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const text = (result) => result?.content?.filter((c) => c.type === "text").map((c) => c.text).join("\n") ?? "";
const json = (result, name) => {
  if (result?.isError) throw new Error(`${name}: ${text(result)}`);
  return JSON.parse(text(result));
};
const expectError = async (client, name, args, needle) => {
  const result = await client.callTool({ name, arguments: args });
  assert(result?.isError === true, `${name} wurde unerwartet akzeptiert: ${text(result)}`);
  assert(text(result).includes(needle), `${name} meldet nicht '${needle}': ${text(result)}`);
};
const workerOpBlock = (op) => {
  const marker = `\n  '${op}' {`;
  const start = workerSource.indexOf(marker);
  assert(start >= 0, `Worker-Operation '${op}' fehlt.`);
  const next = workerSource.indexOf("\n  '", start + marker.length);
  return workerSource.slice(start, next >= 0 ? next : workerSource.length);
};
const ssePids = () => execFileSync(
    "powershell.exe",
  ["-NoLogo", "-NoProfile", "-Command", "@(Get-Process -Name SSE -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id | Sort-Object) -join ','"],
  { encoding: "utf8", windowsHide: true },
).trim();

const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env } });
const client = new Client({ name: "sse-product-gate", version: "1.0.0" });
const pidsBefore = ssePids();
const markerBefore = existsSync(markerPath) ? readFileSync(markerPath, "utf8") : null;

assert(workerBridgeSource.includes('"System32",') && workerBridgeSource.includes('"taskkill.exe"') &&
  !workerBridgeSource.includes('spawn("taskkill.exe"'),
"Worker-Cleanup darf taskkill.exe nicht ueber PATH aufloesen.");
assert(workerBridgeSource.includes("workerRuntimeFailure") &&
  workerBridgeSource.includes('"worker-isolation-lost"') &&
  workerBridgeSource.match(/if \(workerRuntimeFailure\)/g)?.length === 2 &&
  workerBridgeSource.indexOf("if (workerRuntimeFailure)") < workerBridgeSource.indexOf("if (queueDepth >= MAX_WORKER_QUEUE_DEPTH)"),
"Nicht nachweisbarer Prozessbaum-Cleanup sperrt nachfolgende Worker nicht fail-closed.");
assert(workerBridgeSource.includes("resolveDesktopMarkerForOperation(") &&
  desktopMarkerNodeSource.includes("readFileBounded(markerPath, MAX_DESKTOP_MARKER_BYTES)") &&
  desktopMarkerNodeSource.includes('new TextDecoder("utf-8", { fatal: true })') &&
  desktopMarkerWorkerSource.includes("$markerFile.Length -gt 4KB") &&
  desktopMarkerWorkerSource.includes("New-Object Text.UTF8Encoding($false, $true)"),
"Desktop-Marker wird nicht in Node und PowerShell begrenzt als striktes UTF-8 gelesen.");
assert(workerBridgeSource.includes('"-ArgsFile", argsFile') &&
  !workerBridgeSource.includes('"-B64", b64') &&
  workerSource.indexOf("try { $a = Read-Args }") < workerSource.indexOf("Initialize-SSEProductProfile") &&
  workerSource.includes("Get-SSEBoundedArrayArg") &&
  workerSource.includes("vor Profil-, DLL- und UI-Start"),
"Worker-Argumente werden nicht dateibasiert oder erst nach teurer Produkt-/Native-Initialisierung begrenzt.");
assert(desktopLauncherSource.includes("$maxWorkerOutputBytes = 32MB") &&
  desktopLauncherSource.includes("Read-SSEBoundedUtf8File $aus $maxWorkerOutputBytes") &&
  desktopLauncherSource.includes("kind = 'output-too-large'") &&
  desktopLauncherSource.includes("if ($workerExit -ne 0)") &&
  workerSource.includes("[IO.FileMode]::CreateNew") &&
  workerTransportSource.includes("^sse-out-[0-9a-fA-F]{32}\\.json$") &&
  workerTransportSource.includes("function Read-SSEBoundedUtf8File"),
"Hidden-Desktop-Launcher liest Workerantworten nicht begrenzt und strikt als UTF-8.");
assert(nativeLoaderSource.includes("if ($stream.Length -gt $MaxBytes)") &&
  nativeLoaderSource.includes("Read-SSENativeBoundedUtf8 $hashPath 1KB") &&
  nativeBuildSource.includes("Read-SSEBoundedFileBytes $source (1MB)") &&
  nativeBuildSource.includes("[Text.UTF8Encoding]::new($false, $true).GetString($sourceBytes)"),
"Native-Build/Loader pruefen geoeffnete Streams nicht erneut begrenzt und dekodieren den Quelltext nicht strikt.");

try {
  await client.connect(transport);
  const product = json(await client.callTool({ name: "sse_product_info", arguments: {} }), "product-info");
  const listedTools = await client.listTools();
  const dialogAnswerTool = listedTools.tools.find((tool) => tool.name === "sse_dialog_answer");
  const vastApplyTool = listedTools.tools.find((tool) => tool.name === "sse_vast_apply");
  const centerCasesTool = listedTools.tools.find((tool) => tool.name === "sse_center_cases");
  const centerRefreshTool = listedTools.tools.find((tool) => tool.name === "sse_center_refresh");
  const windowCloseTool = listedTools.tools.find((tool) => tool.name === "sse_window_close");
  const saveTool = listedTools.tools.find((tool) => tool.name === "sse_save");
  const dialogButtonEnum = dialogAnswerTool?.inputSchema?.properties?.button?.enum ?? [];
  assert(product.taxYear === 2025 && product.engineFileMajor === 31, "Produktgrenze ist nicht 2025/31.");
  assert(workerSource.includes("unsupportedButtons = $unsupportedButtons") &&
    workerSource.includes("$unsupportedButtons.Count") &&
    !dialogButtonEnum.includes("__unbekannter_button__"),
  "Unbekannte Dialogbuttons werden nicht sichtbar gemeldet oder waeren ohne Freigabe klickbar.");
  assert(product.profileId === profileManifest.id && product.profileStatus === profileManifest.status &&
    product.product === profileManifest.product,
  `Worker meldet nicht das aktive Profilmanifest: ${JSON.stringify(product)}`);
  assert(typeof product.defaultExecutable?.supported === "boolean",
    `Produktinfo meldet keinen pruefbaren Standard-EXE-Status: ${JSON.stringify(product.defaultExecutable)}`);
  if (product.defaultExecutable.supported) {
    assert(product.defaultExecutable.reason === `${profileManifest.product} verifiziert.`,
      `EXE-Identitaet stammt nicht aus dem Profil: ${JSON.stringify(product.defaultExecutable)}`);
    assert(product.defaultExecutable.fileMajorSource === "FileMajorPart", "Engine-Major stammt nicht aus FileMajorPart.");
  } else {
    assert(!requireInstalledProduct, "Lokale SSE-2025-Standardinstallation wurde nicht verifiziert.");
    assert(product.defaultExecutable.exists === false &&
      product.defaultExecutable.reason === "Programmdatei existiert nicht.",
    `Ein portabler Lauf darf nur eine nachweislich fehlende Standard-EXE akzeptieren: ${JSON.stringify(product.defaultExecutable)}`);
  }
  assert(product.workerInitializationMs?.nativeInteropMode === "precompiled-dll",
    `Normaler Worker nutzt nicht die vorkompilierte DLL: ${JSON.stringify(product.workerInitializationMs)}`);
  assert(product.workerInitializationMs?.nativeHashMatch === true &&
    product.workerInitializationMs?.nativeDllHashMatch === true &&
    !product.workerInitializationMs?.nativeDllError,
  `DLL ist nicht an aktuelle Quell- und Binaerhashes gebunden: ${JSON.stringify(product.workerInitializationMs)}`);
  assert(product.interactionGuards?.lastInputInfoAvailable === true &&
    product.interactionGuards?.windowSetFingerprint === true &&
    product.interactionGuards?.noBlindRollbackAfterInterference === true,
  `Eingabe-/Fenster-Guard ist nicht vollstaendig verfuegbar: ${JSON.stringify(product.interactionGuards)}`);
  const actualNativeHash = createHash("sha256").update(readFileSync(nativeSource)).digest("hex").toUpperCase();
  const nativeDllBytes = readFileSync(nativeDll);
  const actualNativeDllHash = createHash("sha256").update(nativeDllBytes).digest("hex").toUpperCase();
  const privateUserFragment = ["di", "mon"].join("");
  const privateFolderFragment = ["Meine", "Ablage"].join("\\s+");
  const nativePrivacyPattern = new RegExp(`[A-Za-z]:[\\\\/]|${privateUserFragment}|${privateFolderFragment}`, "iu");
  for (const decodedNativeDll of [nativeDllBytes.toString("latin1"), nativeDllBytes.toString("utf16le")]) {
    assert(!nativePrivacyPattern.test(decodedNativeDll),
      "Native DLL enthaelt einen lokalen Build-PC-Pfad oder Nutzernamen.");
  }
  const nativeIntegrity = JSON.parse(readFileSync(nativeHashSidecar, "utf8"));
  assert(nativeIntegrity.schemaVersion === 1 &&
    actualNativeHash === nativeIntegrity.sourceSha256 &&
    actualNativeHash === product.workerInitializationMs.nativeSourceHash &&
    actualNativeDllHash === nativeIntegrity.dllSha256 &&
    actualNativeDllHash === product.workerInitializationMs.nativeDllHash,
  "Native DLL, Integritaetsmanifest und aktueller C#-Quelltext haben unterschiedliche Hashes.");
  assert(product.catalogCompatibility?.compatible === true, "Page-Object-Katalog und Worker-Grenze sind auseinandergelaufen.");
  assert(product.catalogCompatibility?.executableName === profileManifest.executable.name &&
    product.catalogCompatibility?.installationFolderName === profileManifest.executable.installationFolderName,
  "Katalogkompatibilitaet verwendet nicht EXE und Installationsordner des Profils.");
  assert(catalog.taxYear === product.taxYear && catalog.engineFileMajor === product.engineFileMajor,
    "Katalogwerte stimmen nicht mit sse_product_info ueberein.");
  assert(!/[A-Za-z]:\\\\/.test(catalogText) &&
    !/\.(?:ESt|Gew|USt)2025\b/.test(catalogText) &&
    !/\b\d{1,3}(?:\.\d{3})*,\d{2}\s*€/.test(catalogText),
  "Page-Object-Katalog enthaelt einen privaten Fallpfad, Dateinamen oder konkreten Geldwert.");
  const forbiddenCatalogKeys = new Set(["value", "currentValue", "expectedValue", "sampleValue", "casePath", "caseName"]);
  const catalogKeyStack = [catalog];
  while (catalogKeyStack.length) {
    const current = catalogKeyStack.pop();
    if (!current || typeof current !== "object") continue;
    for (const [key, value] of Object.entries(current)) {
      assert(!forbiddenCatalogKeys.has(key), `Page-Object-Katalog speichert das private/konkrete Feld '${key}'.`);
      if (value && typeof value === "object") catalogKeyStack.push(value);
    }
  }
  const catalogTools = Object.keys(SSE_MCP_TOOL_OPERATIONS).sort();
  const runtimeTools = listedTools.tools.map((tool) => tool.name).sort();
  assert(JSON.stringify(catalogTools) === JSON.stringify(runtimeTools) && catalogTools.length > 0,
    `Katalog und MCP-Laufzeit laufen auseinander: ${catalogTools.length} statt ${runtimeTools.length}.`);
  assert(skillSource.includes("API-Selbstbeschreibung") && skillSource.includes("installierten API-Vertrag"),
    "Public Skill weist nicht auf den versionsgebundenen API-/Tool-Katalog hin.");
  assert(centerCasesTool?.inputSchema?.properties?.hwnd,
    "sse_center_cases kann nicht an ein exaktes Steuertipps-Center-Fenster gebunden werden.");
  const centerRefreshRequired = centerRefreshTool?.inputSchema?.required ?? [];
  assert(centerRefreshRequired.includes("hwnd") &&
    centerRefreshTool?.inputSchema?.properties?.expectedDirectoryRef &&
    centerRefreshTool?.inputSchema?.properties?.expectedMode &&
    !centerRefreshTool?.inputSchema?.properties?.expectedDirectory,
    "sse_center_refresh ist nicht an exaktes Center-Fenster und gelesenen Ansichtsmodus gebunden.");
  const windowCloseRequired = windowCloseTool?.inputSchema?.required ?? [];
  assert(windowCloseRequired.includes("pid") && windowCloseRequired.includes("hwnd") && windowCloseRequired.includes("titleFingerprint") &&
    !windowCloseTool?.inputSchema?.properties?.expectedTitle,
  "sse_window_close ist nicht PC-blind an den gelesenen Titel-Fingerprint gebunden.");
  const centerCasesBlock = workerOpBlock("center_cases");
  assert(workerSource.includes("function Get-SSECenterViewState") &&
    workerSource.includes("*.m_currentDataPathLabel") &&
    workerSource.includes("*.m_taxFilesView") &&
    workerSource.includes("*.m_buttonStorageRecent") &&
    centerCasesBlock.includes("Resolve-SteuertippsCenterWindow") &&
    centerCasesBlock.includes("Get-SSECenterViewState") &&
    centerCasesBlock.includes("dateisystemVerglichen") &&
    centerCasesBlock.includes("$centerTypes = @('ESt','Gew')") &&
    centerCasesBlock.includes("[string]$script:SSE_TAX_YEAR") &&
    centerCasesBlock.includes("Test-SSEProfileCaseFileName $_ $false $centerTypes") &&
    !centerCasesBlock.includes("*.ESt2025") &&
    !centerCasesBlock.includes("*.Gew2025") &&
    centerCasesBlock.includes("konsistent =") &&
    !centerCasesBlock.includes("Click-VerifiedPoint"),
  "sse_center_cases ist nicht read-only an Center-Verzeichnis, UI-Liste und primaere Falldateien gebunden.");
  const listCasesBlock = workerOpBlock("list_cases");
  const workingCopyBlock = workerOpBlock("make_working_copy");
  const archiveCasesBlock = workerOpBlock("archive_cases");
  const backupCasesBlock = workerOpBlock("backup_cases");
  assert(workerSource.includes("$script:SSE_CASE_FILE_REGEX") &&
    workerSource.includes("$profileManifest.startModes.PSObject.Properties") &&
    workerSource.includes("function Get-SSECaseFileMatch") &&
    workerSource.includes("function Test-SSEProfileCaseFileName") &&
    workerSource.includes("function Get-CasePathFromTitle") &&
    workerSource.includes("if (Test-SSEProfileCaseFileName $candidate $true)") &&
    workerSource.includes("function Get-CasePathFromCommandLine") &&
    listCasesBlock.includes("Test-SSEProfileCaseFileName $_.Name $incBackup") &&
    workingCopyBlock.includes("Test-SSEProfileCaseFileName $source $true") &&
    archiveCasesBlock.includes("Test-SSEProfileCaseFileName $name $true") &&
    archiveCasesBlock.includes("Test-SSEProfileCaseFileName $_.Name $true") &&
    backupCasesBlock.includes("Test-SSEProfileCaseFileName $_.Name $true"),
  "Fallpfad-, Listen-, Kopier-, Archiv- oder Backup-Pfade nutzen nicht denselben profilgebundenen Typ-/Jahresregex.");
  assert(!/^\s*\$[A-Za-z][A-Za-z0-9_]*\s*=\s*Get-Windows 'SSE'\s*$/gmu.test(workerSource) &&
    !workerSource.includes("(Get-Windows 'SSE').Count"),
  "Ein einzelnes SSE-Fenster kann weiterhin durch PowerShell-Collection-Unrolling faelschlich als leer gelten.");
  assert(workerSource.includes("function Copy-SSEFileNew") &&
    workerSource.includes("[IO.FileMode]::CreateNew") &&
    workingCopyBlock.includes("Copy-SSEFileNew $source $target") &&
    backupCasesBlock.includes("Copy-SSEFileNew $file.FullName $target") &&
    !workingCopyBlock.includes("Copy-Item -LiteralPath") &&
    !backupCasesBlock.includes("Copy-Item -LiteralPath"),
  "Arbeitskopien werden nicht mit einem atomaren No-Overwrite-Dateiaufruf erzeugt.");
  assert(archiveCasesBlock.includes("New-Item -ItemType Directory -Path ([WildcardPattern]::Escape($dest))") &&
    !archiveCasesBlock.includes("[IO.Directory]::CreateDirectory($dest)") &&
    !archiveCasesBlock.includes("Remove-Item -LiteralPath $dest -Recurse") &&
    archiveCasesBlock.includes("Get-ChildItem -LiteralPath $dest -Force"),
  "Archivziele werden nicht exklusiv erstellt oder ein Rollback kann fremde Dateien rekursiv loeschen.");
  const centerRefreshBlock = workerOpBlock("center_refresh");
  assert(centerRefreshBlock.includes("Resolve-SteuertippsCenterWindow") &&
    centerRefreshBlock.includes("expectedMode") &&
    centerRefreshBlock.includes("Set-SSECenterViewMode") &&
    workerSource.includes("function Set-SSECenterViewMode") &&
    workerSource.includes("InvokePattern") &&
    workerSource.includes("[DateTime]::UtcNow.AddSeconds(8)") &&
    workerSource.includes("-AllowInvalid") &&
    centerRefreshBlock.includes("sucheUnveraendert") &&
    centerRefreshBlock.includes("sortierungUnveraendert") &&
    !centerRefreshBlock.includes("Move-Item") && !centerRefreshBlock.includes("Remove-Item"),
  "sse_center_refresh ist nicht eng und dateineutral an die beiden Center-Ansichtsumschalter gebunden.");
  const windowCloseBlock = workerOpBlock("window_close");
  assert(catalog.windows.taxTips.role === "nonmodal-help-window" &&
    catalog.windows.resultComparison.role === "nonmodal-result-window" &&
    catalog.windows.taxTips.closePolicy === "allow-exact-nonmodal-close" &&
    catalog.windows.resultComparison.closePolicy === "allow-exact-nonmodal-close" &&
    workerSource.includes("function Resolve-SSEClosableNonmodalWindowPolicy") &&
    workerSource.includes("titleFingerprint = Get-SSETextSha256 ($t.ToString())") &&
    windowCloseBlock.includes("$actualTitleFingerprint") &&
    windowCloseBlock.includes("$actualTitleFingerprint -ne $titleFingerprint") &&
    windowCloseBlock.includes("$win.title -cne $expectedTitle") &&
    windowCloseBlock.includes("Get-SSEBoundedIntegerArg $a 'pid'") &&
    windowCloseBlock.includes("Resolve-SSEClosableNonmodalWindowPolicy $win") &&
    workerSource.includes("elseif (Resolve-SSEClosableNonmodalWindowPolicy $Window) { $kind = 'known-nonmodal' }") &&
    windowCloseBlock.includes("Test-SSESafeAuxiliaryDescriptor $win") &&
    windowCloseBlock.includes("$win.cls -notmatch '^Qt'") &&
    windowCloseBlock.includes("Test-Versand ([string]$win.title)") &&
    windowCloseBlock.includes("$onlyTargetRemoved") &&
    windowCloseBlock.includes("$missingOrChangedPeers") &&
    windowCloseBlock.includes("$newWindows"),
  "sse_window_close ist nicht an Profilrolle, PID, Titel-Fingerprint und exklusiven Window-Set-Readback gebunden.");
  assert(dialogButtonEnum.includes("Klicken Sie hier, um Ihre Daten zu exportieren") &&
    !dialogButtonEnum.includes("Exportieren") && !dialogButtonEnum.includes("*"),
  "sse_dialog_answer veroeffentlicht nicht den exakten CSV-Export-Schalter oder erlaubt einen generischen Export-Button.");
  const vastApplyRequired = vastApplyTool?.inputSchema?.required ?? [];
  assert(vastApplyTool &&
    ["hwnd", "expectedMainHwnd", "expectedCaseRef", "expectedCaseHash", "mappingFingerprint", "plan", "acknowledgeApply"]
      .every((name) => vastApplyRequired.includes(name)) &&
    vastApplyTool.inputSchema?.properties?.acknowledgeApply?.const === true,
  "sse_vast_apply ist nicht an Dialog, Hauptfenster, Fall/Hash, Plan, Fingerprint und explizite Bestaetigung gebunden.");
  const vastApplyBlock = workerOpBlock("vast_apply");
  assert(vastApplyBlock.includes("Test-CaseBinding $main $expectedCasePath") &&
    vastApplyBlock.includes("$diskHashBefore = Get-Sha256 $expectedCasePath") &&
    vastApplyBlock.includes("$state.mappingFingerprint -ne $expectedMapping") &&
    vastApplyBlock.includes("$plan.Count -ne $state.rows.Count") &&
    vastApplyBlock.includes("SSE_Application.AssignVaStDlg.QWidget.m_pbtnOK") &&
    vastApplyBlock.includes("Test-SSELastInputUnchanged $inputBaseline") &&
    vastApplyBlock.includes("$diskHashAfter -ne $diskHashBefore") &&
    !vastApplyBlock.includes("Click-VerifiedPoint"),
  "VaSt-Uebernahme prueft Plan/Fall/Eingabe/Disk-Invariante nicht vollstaendig oder hat einen physischen Fallback.");
  assert(!catalogTools.includes("sse_keys") &&
    workerSource.includes("Roh-Tastatureingabe ist aus der MCP-Oberflaeche entfernt") &&
    !workerSource.includes("SendWait($k)"),
  "Unsichere Roh-Tastatur ist registriert oder der direkte Worker-Pfad enthaelt noch seinen SendWait-Aufruf.");
  assert(!workerSource.includes("allowSend") && !workerSource.includes("confirmSend"),
    "Der direkte Worker besitzt weiterhin einen Schalter, der die Versand-/ELSTER-Sperre lockern kann.");
  assert(!workerSource.includes("allowOverwrite") && !workerSource.includes("expectedTargetHash") &&
    workerOpBlock("save_as").includes("Zieldatei existiert bereits"),
  "Der direkte save_as-Worker kann ein vorhandenes Ziel weiterhin ueberschreiben.");
  assert(workerBridgeSource.includes("MAX_WORKER_STDOUT_BYTES") &&
    workerBridgeSource.includes("MAX_WORKER_STDERR_BYTES") &&
    workerBridgeSource.includes('"output-too-large"') &&
    workerBridgeSource.includes('new TextDecoder("utf-8", { fatal: true })'),
  "Worker-Ausgabe ist nicht begrenzt oder wird nicht als striktes UTF-8 dekodiert.");
  const saveRequired = saveTool?.inputSchema?.required ?? [];
  assert(saveTool?.inputSchema?.properties?.hwnd &&
    saveRequired.includes("caseRef") && saveRequired.includes("expectedHashBefore") &&
    saveTool.inputSchema.properties.hwnd.description?.includes("mehreren offenen Steuerfaellen Pflicht"),
  "sse_save kann bei mehreren offenen Steuerfaellen nicht an ein exaktes Hauptfenster gebunden werden.");
  assert(serverSource.includes('"sse_click_point"'),
    "Die MCP-Quelldefinition fuer sse_click_point fehlt.");
  assert(workerSource.includes("Erfassen-/Bearbeiten-Hyperlinks zugelassen") &&
    workerSource.includes("$_.type -eq 'TreeItem'") &&
    workerSource.includes("$_.type -eq 'Hyperlink' -and $_.name -match '(?i)(erfassen|bearbeiten)$'") &&
    serverSource.includes("Checkboxen, Radios, Dropdowns, Tabellenzellen und Dialogknöpfe sind gesperrt"),
  "sse_click_point ist nicht eng genug auf TreeItems und reine Detailnavigation begrenzt.");
  const hashBoundCloseGuidance = workerSource.match(
    /Zuerst sse_save mit expectedPath\/expectedHashBefore hashgebunden ausfuehren oder explizit discardChanges=true verwenden/g,
  ) ?? [];
  assert(hashBoundCloseGuidance.length >= 4,
    "Close und Desktop-Stop erklaeren den hashgebundenen Speicherschritt nicht in allen Dirty-/Unknown-Zweigen.");
  assert(!workerSource.includes("Zuerst sse_save oder explizit discardChanges=true verwenden"),
    "Veraltete, ungebundene Speicheranleitung ist noch im Worker enthalten.");
  assert(tableRegionSource.includes("previousSummaryY") &&
    tableRegionSource.includes("$_.y -gt $previousSummaryY -and $_.y -lt $targetSumY") &&
    workerSource.includes("$byY.Keys | Sort-Object -Descending") &&
    workerSource.includes("Resolve-SSETableProfile $headingBefore $sumLabel $sumOccurrence $region") &&
    workerSource.includes("Test-SSETableRowFreeWithProfileDefaults $byY[$_] $resolvedTableProfile") &&
    tableComboSource.includes("$neutralTaxSelector = $cellName -in @('7','19') -and [int]$cell.w -le 80") &&
    tableComboSource.includes("$TableProfile.known -and $TableProfile.bindingOk") &&
    tableComboSource.includes("emptyRowDefault"),
  "sse_table_add bindet die Leerzeile nicht fail-closed an die gewaehlte Summenregion.");
  assert(workerSource.includes("$targetRegion = Get-SSETableRegion") &&
    workerOpBlock("table_delete").includes("Read-LabeledValueFromTree $tree $window $label $occurrence") &&
    workerOpBlock("table_delete").includes("$matches = @($read.candidates | Where-Object { Test-SSEScalarEqual $_.value $expectedHint })") &&
    workerOpBlock("table_delete").includes("$matches.Count -eq 1") &&
    tableRegionSource.includes("$value = [string]$field.val") &&
    tableRegionSource.includes("if (-not $value) { $value = [string]$field.name }") &&
    workerOpBlock("table_delete").includes("function Resolve-TableDeleteFreshTarget") &&
    workerOpBlock("table_delete").includes("Resolve-TableDeleteFreshTarget $pointRegion") &&
    workerOpBlock("table_delete").includes("Resolve-TableDeleteFreshTarget $preDeleteRegion") &&
    workerOpBlock("table_delete").includes("$_.name -eq $text -and $_.aid -eq $targetAid") &&
    workerOpBlock("table_delete").includes("$rows.Count -eq $targetRowsBeforeActivate.Count") &&
    workerOpBlock("table_delete").includes("row-column-after-ambiguous-automation-id") &&
    workerSource.includes("activationCheck=[pscustomobject]") &&
    (workerSource.match(/no-blind-undo-after-interference/g) ?? []).length >= 2,
  "sse_table_delete bindet Ziel/Seite nicht an die gemeinsame Summenregion oder kann nach Interferenz blind Undo ausloesen.");
  assert(workerSource.includes("[IO.File]::Move($temporaryPath, $fullPath)") &&
    workerSource.includes("Screenshot-Ziel existiert bereits") &&
    !workerSource.includes("$bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)"),
  "Screenshot-Schreiben kann ein zwischen Preflight und Save angelegtes Ergebnisziel ueberschreiben.");
  assert(workerSource.includes("function Test-SSEForegroundIsLockScreen") &&
    workerOpBlock("table_add").includes("$lockScreenIsolation") &&
    workerOpBlock("table_update").includes("$lockScreenIsolation") &&
    workerOpBlock("table_add").includes("Test-SSEForegroundIsLockScreen") &&
    workerOpBlock("table_update").includes("Test-SSEForegroundIsLockScreen") &&
    !workerOpBlock("table_delete").includes("$lockScreenIsolation"),
  "UIA-Tabellenschreiben behandelt Lockscreen-Ticks nicht isoliert oder lockert physische Loeschaktionen.");
  assert(workerSource.includes("function Get-SSEPointObstruction") &&
    workerOpBlock("table_delete").includes("Get-SSEPointObstruction $hwnd $px $py") &&
    workerOpBlock("table_delete").includes("obstruction=$obstruction") &&
    mcpRegistrySource.includes("return apiErrorResult(operation, result)") &&
    mcpResponseSource.includes("Alle API-Fehler bleiben strukturiert") &&
    mcpResponseSource.includes("structuredContent: structuredContent as Record<string, unknown>") &&
    mcpResponseSource.includes("isError: true") &&
    liveWriteJourneySource.includes("assert.notEqual(result?.isError, true") &&
    liveJourneyRunnerSource.includes('assert.equal(ssePids(), ""') &&
    liveJourneyRunnerSource.includes("copyFileSync(source, copy)"),
  "sse_table_delete ist nicht strukturiert fail-closed oder die Live-Reise ist nicht an eine freie Wegwerfkopie gebunden.");
  assert(workerSource.includes("$rollbackPrepared = New-Object System.Collections.ArrayList") &&
    workerSource.includes("Kein blinder Rollback nach fremdem Zellwert/Eingabe/Fensterwechsel") &&
    workerSource.includes("Test-SSETableCellEquivalent $liveBefore $entry.before") &&
    workerOpBlock("table_update").includes("$requested -match '^(?i:true|false)$'") &&
    workerOpBlock("table_update").includes("TogglePattern") &&
    workerOpBlock("table_update").includes("$item.entry.mode -eq 'toggle'") &&
    workerOpBlock("table_update").includes("$mutationMethod = 'verified-cell-click'") &&
    workerOpBlock("table_update").includes("Click-VerifiedPoint $hwnd $rollbackNode"),
  "sse_table_update prueft Zielzellen/Rollback nicht gemeinsam oder kann fremde Werte ueberschreiben.");
  assert(workerSource.includes(". $tableValueHelpers") &&
    tableValuesSource.includes("function ConvertTo-SSETableNumber") &&
    tableValuesSource.includes("$actualNumber = ConvertTo-SSETableNumber $Actual") &&
    tableValuesSource.includes("$requestedNumber = ConvertTo-SSETableNumber $Requested") &&
    tableValuesSource.includes("return $actualNumber -eq $requestedNumber") &&
    !tableValuesSource.includes(".StartsWith($a)") && !tableValuesSource.includes(".StartsWith($e)"),
  "Tabellen-Readback normalisiert numerisch gleiche SSE-Werte wie 0 und 0,00 nicht.");
  const verifyBlock = workerOpBlock("verify");
  assert(verifyBlock.includes("ConvertTo-SSETableNumber $x") &&
    verifyBlock.includes("$a1 -eq $a2") &&
    !verifyBlock.includes("-replace '[^\\d,.\\-]', ''") &&
    !verifyBlock.includes("[Math]::Abs($a1 - $a2) -lt"),
  "Soll/Ist-Verifikation kann mehrdeutigen Zahlentext weiterhin still in einen anderen Betrag umdeuten.");
  assert(workerSource.includes("function Get-SSESearchFieldNode") &&
    workerSource.includes("$suchfeld = Get-SSESearchFieldNode $ts") &&
    workerSource.includes("sse_set_value ist nur fuer das globale steuerneutrale Suchfeld zugelassen") &&
    workerSource.includes("Kein blinder Rollback nach Eingabe-, Fenster-, Seiten- oder Binding-Interferenz") &&
    !skillSource.includes('sse_set_value name="Bürobedarf"'),
  "sse_set_value ist nicht fail-closed auf das globale Suchfeld und den Interference-Vertrag begrenzt.");
  assert(workerSource.includes("$combos = @(Resolve-Nodes $tree $selector)") &&
    workerSource.includes("Option '$wanted' ist virtualisiert") &&
    workerSource.includes("Virtualisierte Liste ist am berechneten Mausradpunkt nicht mehr PID-/Root-verifiziert") &&
    workerSource.includes("[SW]::mouse_event(0x0800") &&
    workerSource.includes("$method = 'virtualized-paged-click'") &&
    workerSource.includes("$null = Click-VerifiedPoint $hwnd $virtualMatch") &&
    workerSource.includes("Kein blinder Rollback nach Eingabe-, Fenster-, Seiten- oder Binding-Interferenz") &&
    workerSource.includes("Ausgangsoption bietet kein rollbackfaehiges SelectionItemPattern") &&
    workerSource.includes("$rollbackFinalWindows.fingerprint -eq $interactionBefore.fingerprint"),
  "sse_combo_select bindet Seite/ComboBox nicht eindeutig oder kann nach Interferenz blind zurueckrollen.");
  assert(workerSource.includes("Direktes TogglePattern ist gesperrt") &&
    workerSource.includes("Radio-Auswahl braucht die exakte AutomationId") &&
    workerSource.includes("SelectionItemPattern ist nur fuer genau einen per AutomationId gebundenen RadioButton zulaessig") &&
    workerSource.includes("Radio-Gruppe hat vor der Aenderung keinen eindeutig lesbaren Exklusivzustand") &&
    workerSource.includes("RadioButton zeigt vor Rollback nicht mehr exakt den selbst gesetzten Zustand") &&
    workerSource.includes("Radio-Auswahl braucht einen verifizierten physischen Klick") &&
    workerSource.includes("$null = Click-VerifiedPoint $hwnd $radioClickNode") &&
    workerSource.includes("$pattern -ne 'select'") &&
    workerSource.includes("CheckBox zeigt vor Rollback nicht mehr exakt den selbst gesetzten Zustand") &&
    workerSource.includes("$rollbackWindows.fingerprint -eq $interactionBefore.fingerprint"),
  "sse_click kann Checkbox/Radio ungebunden aendern oder sse_toggle rollt nach Interferenz blind zurueck.");
  assert(workerSource.includes("function Test-KnownPageHeading") &&
    workerSource.includes("$expectedNumberedDetailPrefix = $expectedNumberedLabel + ': '") &&
    workerSource.includes("@($knownStateBefore.fields | Where-Object { -not $_.present }).Count -eq 0") &&
    catalog.pages?.["gew.anlagevermoegen_wirtschaftsgut"]?.headingPrefix === "1. " &&
    catalog.pages?.["gew.fahrzeug"]?.headingNumberedLabel === "Fahrzeug" &&
    !catalog.pages?.["gew.fahrzeug"]?.headingPrefix &&
    catalog.pages?.["gew.fahrzeug_leasingkosten"]?.fields?.vertragsmonate?.automationIdSuffix === ".Dauer.Dauer.Wert" &&
    catalog.pages?.["gew.fahrzeug_private_nutzung"]?.fields?.bruttolistenpreis?.valueKind === "currency" &&
    catalog.pages?.["gew.fahrzeug_private_nutzung"]?.fields?.nutzungsmonate?.valueKind === "text",
  "Dynamische Detailseitenkoepfe sind nicht zugleich an Praefix und alle exakten Page-Object-Felder gebunden.");
  const saveBlock = workerOpBlock("save");
  assert(workerSource.includes("if ($summaryBefore.transmitted -ne $false)") &&
    saveBlock.includes("'transmitted-case-locked'") &&
    saveBlock.includes("(?i)(korrektur|berichtigung)") &&
    saveBlock.includes("Korrekturstand, uebermitteltes Original und Sicherung muessen drei verschiedene Dateien sein") &&
    saveBlock.includes("$actualBackupHash -ne $before") &&
    saveBlock.includes("$sourceSummary.transmitted -ne $true") &&
    saveBlock.includes("elsterTransmissionTriggered = $false") &&
    !saveBlock.includes("Arg $a 'force'"),
  "Der Save-Worker besitzt keinen vollstaendig gebundenen Korrekturmodus oder eine generische Force-Luecke.");
  assert(SSE_MCP_TOOL_OPERATIONS.sse_page_objects === "page_objects" &&
    serverSource.includes('"sse_page_objects"') &&
    apiContractSource.includes('"page_objects"') &&
    apiExecutorSource.includes('if (operation === "page_objects")') &&
    apiExecutorSource.includes("executeLocalPageObjects") &&
    pageObjectsExecutorSource.includes("loadProductProfile(options.profileId, options.profilesRoot)") &&
    pageObjectsExecutorSource.includes("resolvePageObjectDefinition") &&
    workerOpBlock("page_objects").includes("Get-SSEPageObjects"),
  "Page Objects werden nicht pro API-Aufruf neu geladen oder verlieren ihren Worker-Kompatibilitaetspfad.");
  const strictMainWindowOps = [
    "click", "set_value", "combo_options", "click_point",
    "positions", "export_csv", "collect", "goto_tree", "goto", "table_read",
    "table_add", "table_update", "table_delete", "menu", "menu_click", "menu_close",
  ];
  for (const op of strictMainWindowOps) {
    assert(workerOpBlock(op).includes("Resolve-SSEMainWindowDescriptor $a -RestoreMinimized"),
      `${op} waehlt bei mehreren SSE-Faellen weiterhin implizit ein Fenster.`);
  }
  for (const op of ["toggle", "combo_select"]) {
    assert(workerOpBlock(op).includes("Resolve-BoundWriteWindow $a"),
      `${op} ist nicht an eindeutiges Fenster und optionale Fall-/Hashidentitaet gebunden.`);
  }
  assert(workerOpBlock("goto").includes("keine Wiederholung") &&
    workerOpBlock("goto").includes("sse_warning_popup_read mit dem gemeldeten Dialog-HWND") &&
    workerOpBlock("goto").includes("$warnfenster.Count"),
  "sse_goto stapelt bei einem blockierenden Pruefhinweis weiterhin identische Warnfenster.");
  assert(!workerOpBlock("goto").includes("$unscharferTreffer") &&
    workerOpBlock("goto").includes("niemals einen") &&
    workerOpBlock("goto").includes("unscharfen Treffer doppelklicken"),
  "sse_goto kann ohne fachlich gebundenen Suchtreffer weiterhin eine beliebige Seite oeffnen.");
  assert((workerOpBlock("goto").match(/erreicht\s*=\s*\$true/g) ?? []).length === 5,
    "Mindestens ein erfolgreicher sse_goto-Pfad meldet erreicht=true nicht konsistent.");
  const checkerCloseBlock = workerOpBlock("checker_close");
  assert(checkerCloseBlock.includes("Get-SSEContainerDescendants $before.nodes '.PrueferWidgetSSE.FrameTitle' 'Button' 'Group'") &&
    checkerCloseBlock.includes("$buttons.Count -ne 1") &&
    checkerCloseBlock.includes("$invoke.Invoke()") &&
    checkerCloseBlock.includes("$headingAfter -eq $headingBefore") &&
    checkerCloseBlock.includes("$dirtyAfter -eq $dirtyBefore") &&
    checkerCloseBlock.includes("-not $afterResult.aktiv") &&
    !checkerCloseBlock.includes("Click-VerifiedPoint"),
  "sse_checker_close ist nicht an exakte Leiste sowie Seiten-/Dirty-Invariante gebunden.");
  assert(workerSource.includes("$wins = @($Windows | Where-Object { $null -ne $_ })"),
    "Strenger Hauptfensterresolver behandelt @($null) weiterhin als vorhandene Fensterliste.");
  assert(workerSource.includes("$loadedCases = @($wins | Where-Object { $_.title -match 'SteuerSparErklärung' })") &&
    workerSource.includes("Sobald ein konkreter Fall existiert, ist dieses kein zweiter Fall"),
  "Generisches Startfenster wird parallel zu einem geladenen Fall weiterhin als zweiter Steuerfall gewertet.");
  const collectBlock = workerOpBlock("collect");
  assert(collectBlock.includes('$seitenWeg = "$eingetretenVon`u{001F}$head"') &&
    collectBlock.includes('$naechsterWeg = "$head`u{001F}$afterHeading"') &&
    !collectBlock.includes("$gesehen.ContainsKey($head)") &&
    !collectBlock.includes("$gesehen.ContainsKey($afterHeading)") &&
    collectBlock.includes("Arg $a 'maxPages' 3") &&
    collectBlock.includes("$max -gt 5") &&
    collectBlock.includes("degraded-memory") &&
    collectBlock.includes("$privateDeltaLimitBytes") &&
    operationCatalogSource.includes(".max(5)") && operationCatalogSource.includes("Vorgabe 3, Maximum 5"),
  "sse_collect verwechselt Seitentitel mit Zyklen oder erlaubt weiterhin ueberlastende Monolithlaeufe.");
  assert(workerOpBlock("launch").includes("instance=$null") &&
    workerOpBlock("launch").includes("-WindowStyle Normal") &&
    apiExecutorSource.includes("executeLaunchOperation") &&
    (launchExecutorSource.match(/await worker\("launch"/g) ?? []).length === 1 &&
    launchExecutorSource.includes('await (worker as LaunchWorkerExecutor)("launch_probe"') &&
    launchExecutorSource.includes('planKind: "launch-readiness"') &&
    launchExecutorSource.includes("deadlineUnixMs: deadline") &&
    launchExecutorSource.includes('bindingMode: "launch-window"') &&
    launchExecutorSource.includes("cleanupStartedProcess") &&
    serverSource.includes("instance: r.instance, ready: r.ready") &&
    liveWriteJourneySource.includes("const hwnd = launched.instance?.hwnd") &&
    liveWriteJourneySource.includes('sse_ui_state", { hwnd }'),
  "sse_launch trennt Start und frischen Readback nicht oder liefert kein explizit weiterverwendbares Start-HWND.");
  assert(workerOpBlock("desktop_start").includes("bindingMode='desktop-launch-window'") &&
    workerOpBlock("desktop_start").includes("$_.title -match 'SteuerSparErklärung'") &&
    workerOpBlock("desktop_start").includes("blockedByDialog=[bool]($startupDialogWindows.Count)") &&
    serverSource.includes("instance: r.instance") &&
    hiddenDesktopLifecycleSource.includes("state1.instance?.hwnd") &&
    hiddenDesktopLifecycleSource.includes("arguments: { hwnd: state1.instance.hwnd"),
  "Versteckter Start kehrt vor geladenem Fall/Dialog zurueck oder Folgeaktion ignoriert sein Start-HWND.");
  assert(workerSource.includes("hwnd ist auch fuer konsistente Lese-/UI-Aktionen Pflicht") &&
    workerSource.includes("$mainCandidates = @(Get-SSEMainWindowCandidates $wins)"),
  "Legacy-Resolver mischt bei mehreren SSE-Faellen weiterhin implizit Lese-/Scrollzustaende.");
  const positionsBlock = workerOpBlock("positions");
  assert(positionsBlock.includes("Positionen anlegen oder loeschen ist ohne eigenen Seiten-, Feld-, Summen- und Dialogvertrag") &&
    !positionsBlock.includes("SetValue($bez)") && !positionsBlock.includes("SetValue($satz)") &&
    operationCatalogSource.includes('aktion: z.literal("list")'),
  "sse_positions kann weiterhin ungebunden Positionen/Felder aendern.");
  for (const op of ["table_add", "table_update", "table_delete"]) {
    const timeoutPattern = new RegExp(
      `registerApiTool\\(\\s*["']sse_${op}["'][\\s\\S]{0,1800}?\\{ timeoutMs: 300_000 \\},\\s*\\);`,
    );
    assert(timeoutPattern.test(serverSource),
      `${op} hat keinen expliziten 300-Sekunden-Clienttimeout.`);
  }
  for (const op of ["table_add", "table_delete"]) {
    assert(workerOpBlock(op).includes("Test-SSEScalarEqual") && !workerOpBlock(op).includes("$norm ="),
      `${op} vergleicht Kontrollsummen weiterhin durch verlustreiches Entfernen aller Punkte.`);
  }
  assert(workerOpBlock("table_add").includes("Tabellenend-Navigation ueberschritt die interne Frist; nichts geschrieben.") &&
    workerOpBlock("table_delete").includes("Tabellen-Zielsuche ueberschritt die interne Frist; nichts geloescht."),
  "Tabellen-Zielsuche kann ohne interne Frist bis in den externen Kill-Timeout laufen.");
  assert(skillSource.includes("Fensterbindung") && skillSource.includes("`HWND`") &&
    skillSource.includes("genau eine eng gebundene Änderung"),
  "Public Skill beschreibt die fail-closed Fenster- und Schreibbindung nicht.");
  assert(workerSource.includes("function Test-SSEDestructiveAction") &&
    workerOpBlock("click").includes("Assert-SSEDestructiveAcknowledgement") &&
    workerOpBlock("click_point").includes("Assert-SSEDestructiveAcknowledgement") &&
    workerOpBlock("menu_click").includes("Assert-SSEDestructiveAcknowledgement") &&
    workerOpBlock("click").includes("ungespeichertVorher=$dirtyBefore") &&
    workerOpBlock("menu_click").includes("ungespeichertNachher=$(Get-DirtyStateFast $mainHwnd)"),
  "Generische Invoke-/Menuewege haben keinen Destruktiv-Gate oder Dirty-State-Readback.");
  assert(workerOpBlock("goto_tree").includes("Click-VerifiedPoint $hwnd $labelNode") &&
    !workerOpBlock("goto_tree").includes("[SW]::mouse_event"),
  "Alter Navigationsbaum-Fallback umgeht weiterhin den Root-verifizierten TreeItem-Klick.");
  const verifiedClickStart = workerSource.indexOf("function Click-VerifiedPoint(");
  const verifiedClickEnd = workerSource.indexOf("\nfunction ", verifiedClickStart + 1);
  assert(verifiedClickStart >= 0 && verifiedClickEnd > verifiedClickStart,
    "Gemeinsamer Root-verifizierter Klickhelfer fehlt.");
  const verifiedClick = workerSource.slice(verifiedClickStart, verifiedClickEnd);
  assert(workerSource.includes("expectedRoot=[int64]$Hwnd; hitRoot=[int64]$hitRoot") &&
    workerOpBlock("click_point").includes("Click-VerifiedPoint -Window $hwnd -Node $labelPoint") &&
    verifiedClick.includes("Get-SSEPointObstruction $Window $px $py") &&
    verifiedClick.includes("$obstruction.isBoundTarget") &&
    workerOpBlock("tree_top").includes("$hitRoot = [SW]::GetAncestor($hitWindow, 2)") &&
    workerOpBlock("tree_scroll").includes("$hitRoot = [SW]::GetAncestor($hitWindow, 2)") &&
    workerOpBlock("checker_detail").includes("$hitRoot = [SW]::GetAncestor($hitWindow, 2)") &&
    workerOpBlock("table_read").includes("$unterRoot = [SW]::GetAncestor($unter, 2)"),
  "Mindestens ein physischer Fokus-/Scrollpfad bindet nur die PID statt das exakte Hauptfenster-Root.");
  const dialogAnswerBlock = workerOpBlock("dialog_answer");
  assert(nativeSourceText.includes("GetLastActivePopup") &&
    workerSource.includes("function Get-SSEDeepestLastActivePopup") &&
    dialogAnswerBlock.includes("non-topmost-dialog") &&
    dialogAnswerBlock.includes("$newWindows = @($windowsAfter") &&
    !dialogAnswerBlock.includes("$afterInventory = @(Get-DialogInventory") &&
    dialogAnswerBlock.includes("advancedToChildDialog") &&
    dialogAnswerBlock.includes("$buttonName = 'Datei neu zuordnen'") &&
    workerSource.includes("'Datei neu zuordnen'"),
  "Dialogantwort inventarisiert weiterhin alle Qt-Fenster teuer oder kann einen verdeckten Eltern-Dialog beantworten.");
  assert(workerSource.includes("'Klicken Sie hier, um Ihre Daten zu exportieren'") &&
    dialogAnswerBlock.includes("$buttonName -notin $script:DIALOG_BUTTONS") &&
    dialogAnswerBlock.includes("$dialog.title -like 'Export für das Finanzamt (*.csv)*'") &&
    dialogAnswerBlock.includes("$allowsChildDialog") &&
    dialogAnswerBlock.includes("$newDialogs.Count -eq 1") &&
    dialogAnswerBlock.includes("$topAfter -ne [int64]$newDialogs[0].hwnd"),
  "CSV-Export-Antwort ist nicht exakt allowlist-, dialog-, fingerprint- und Folgedialog-gebunden.");
  assert(workerSource.includes("function Test-SSEKnownPassiveTransmissionNotice") &&
    workerSource.includes("Hinweise zur Datenübernahme der vorausgefüllten Steuererklärung") &&
    workerSource.includes("Beiträge für Wahlleistungen bei der Krankenkasse werden nicht immer per VaSt übermittelt.") &&
    dialogAnswerBlock.includes("Test-SSEKnownPassiveTransmissionNotice $dialog $buttonName $probe") &&
    workerSource.includes("$ButtonName -notin @('Schließen','Schliessen')"),
  "Passiver VaSt-Uebermittlungshinweis ist nicht eng auf exakten Dialog/Satz/Schliessen begrenzt.");
  assert(workerSource.includes("function Test-SSESafeTransmissionDialogCancellation") &&
    workerSource.includes("$ButtonName -ceq 'Abbrechen'") &&
    dialogAnswerBlock.includes("Test-SSESafeTransmissionDialogCancellation $buttonName"),
  "Ein fingerprintgebundener Uebermittlungsdialog kann nicht sicher mit dem exakten Button 'Abbrechen' verlassen werden.");
  const exportBlock = workerOpBlock("export_csv");
  assert(exportBlock.includes("$preexistingExport") &&
    exportBlock.includes("Get-SSEDeepestLastActivePopup $hwnd") &&
    exportBlock.includes("Click-VerifiedPoint $eintrag.hwnd $eintrag.node") &&
    exportBlock.includes("$exportDialog = Get-DialogDescriptor") &&
    exportBlock.includes("fingerprint = $exportDialog.fingerprint") &&
    exportBlock.includes("invokeReportedError"),
  "CSV-Export beweist den neuen fingerprintgebundenen Dialog nicht oder verwirft einen trotz Dialog entstandenen Invoke-Fehler.");
  const subpagesBlock = workerOpBlock("subpages");
  assert(subpagesBlock.includes("$_.aid -like '*.RedThreadContent.*'") &&
    subpagesBlock.includes("$_.p -eq $k.p") &&
    subpagesBlock.includes("aid = $k.aid; rid = $k.rid") &&
    subpagesBlock.includes("'Öffnen'") &&
    subpagesBlock.includes("$gesehenUnterseiten") &&
    subpagesBlock.includes("if ($_.type -eq 'Hyperlink') { 0 } else { 1 }"),
  "sse_subpages erkennt offizielle unbeschriftete Caption/Wert/Button-Zeilen nicht generisch.");
  const tableReadBlock = workerOpBlock("table_read");
  assert(tableReadBlock.includes("$_.aid -like '*.RedThreadContent.*'") &&
    tableReadBlock.includes("Get-SSETableRegion $t $hwnd $sumRead") &&
    tableReadBlock.includes("$erst.tabelleAnzahl -eq 1") &&
    operationCatalogSource.includes("sumOccurrence: UI_OCCURRENCE.optional()") &&
    tableReadBlock.indexOf("Get-SSEBoundedIntegerArg $a 'maxRows'") <
      tableReadBlock.indexOf("Resolve-SSEMainWindowDescriptor"),
  "sse_table_read vermischt Werte-Info oder mehrere Eingabetabellen weiterhin als scheinbar vollstaendig.");

  const notepad = join(process.env.WINDIR ?? "C:\\Windows", "System32", "notepad.exe");
  await expectError(client, "sse_launch", { exe: notepad, mode: "einur" }, "Expected never");
  await expectError(client, "sse_desktop_start", { exe: notepad, mode: "einur", name: "SSEVersionGateTest" }, "Expected never");

  const oldSse = "C:\\Program Files\\Steuertipps\\SteuerSparErklaerung\\Steuerjahr 2024\\SSE.exe";
  if (existsSync(oldSse)) {
    await expectError(client, "sse_launch", { exe: oldSse, mode: "einur" }, "Expected never");
  }
  await expectError(client, "sse_launch", { file: "C:\\__sse_mcp_tests__\\fixture.Gew2024", mode: "einur" }, "Unrecognized key");
  await expectError(client, "sse_launch", { file: "C:\\__sse_mcp_tests__\\fixture.ESt2025", mode: "einur" }, "Unrecognized key");
  await expectError(client, "sse_launch", { file: "C:\\__sse_mcp_tests__\\fixture.txt", mode: "einur" }, "Unrecognized key");
  await expectError(client, "sse_health", { unexpected: true }, "Unrecognized key");
  await expectError(client, "sse_close", { pid: process.pid, discardChanges: true }, "verifiziert");

  assert(ssePids() === pidsBefore, "Ein abgewiesener Grenztest hat trotzdem eine SSE-PID erzeugt oder beendet.");
  const markerAfter = existsSync(markerPath) ? readFileSync(markerPath, "utf8") : null;
  assert(markerAfter === markerBefore, "Ein abgewiesener Grenztest hat den Desktop-Marker veraendert.");
  process.stdout.write("OK: SSE-2025-Produkt-, Jahres-, Modus-, Prozess- und Kataloggrenzen sind fail-closed.\n");
} finally {
  await client.close();
}
