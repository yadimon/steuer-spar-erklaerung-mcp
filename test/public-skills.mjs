import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const skillsRoot = join(root, "skills");
const expected = ["steuer-spar-erklaerung", "steuer-spar-erklaerung-setup"];
const discovered = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(skillsRoot, entry.name, "SKILL.md")))
  .map((entry) => entry.name)
  .sort();
assert.deepEqual(discovered, expected, "Public skills muessen flach und ohne --full-depth auffindbar sein.");
assert.equal(existsSync(join(root, "skill")), false, "Veralteter singulaerer skill/-Container ist noch vorhanden.");

for (const name of discovered) {
  const directory = join(skillsRoot, name);
  const source = readFileSync(join(directory, "SKILL.md"), "utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(source)?.[1] ?? "";
  const keys = [...frontmatter.matchAll(/^([a-z-]+):/gmu)].map((match) => match[1]).sort();
  assert.deepEqual(keys, ["description", "name"]);
  assert.match(frontmatter, new RegExp(`^name: ${name}$`, "mu"));
  assert.match(frontmatter, /^description: \S.+$/mu);
  assert(source.split(/\r?\n/u).length < 500, `${name}/SKILL.md ist nicht progressiv genug.`);
  assert(!source.includes("docs/entwicklung/erfahrungen"), `${name} laedt Entwicklungs-Memory in den Runtime-Kontext.`);
  assert(!/Node (?:18|20|22).*(?:Pflicht|benötigt)/iu.test(source));
  assert(!/PowerShell 7.*(?:Pflicht|installieren)/iu.test(source));

  const openAi = readFileSync(join(directory, "agents", "openai.yaml"), "utf8");
  assert(openAi.includes(`$${name}`), `${name}/agents/openai.yaml nennt den Skill nicht im Default-Prompt.`);
  for (const match of source.matchAll(/\]\((references\/[^)]+)\)/gu)) {
    assert(existsSync(join(directory, ...match[1].split("/"))), `Skill-Referenz fehlt: ${name}/${match[1]}`);
  }
}

const main = readFileSync(join(skillsRoot, "steuer-spar-erklaerung", "SKILL.md"), "utf8");
assert(main.includes("kein globales Node.js/npm") && main.includes("kein Python") && main.includes("PowerShell 7"));
assert(main.includes("MCP ist ein optionaler dünner Wrapper") && main.includes("API-Selbstbeschreibung"));
assert(main.includes("NPX-Kurzweg ohne globale Runtime-Installation"));
assert(main.includes("npx.cmd -y @yadimon/steuer-spar-erklaerung-api --case-dir"));
assert(main.includes("npx.cmd -y -p @yadimon/steuer-spar-erklaerung-api steuer-spar-erklaerung-call"));
assert(main.includes("kein dauerhafter Launcher") && main.includes("Setup-Skill und MCP sind nicht erforderlich"));
assert(main.includes("ausdrücklich gewählten NPX-/API-Modus") && main.includes("fehlendes MCP ist dort kein Fehler"));
assert(main.includes("Client-Konfiguration selbst bleibt tokenfrei") && main.includes("setup --check"));
assert(main.includes("steuer-spar-erklaerung-call") && main.includes("--args-file -") && main.includes("Prozessliste"));
assert(main.includes("`config.json` niemals") && main.includes("keinen `curl`-") && main.includes("Nur `/healthz`"));
assert(main.includes("tokenfreie MCP-Eintrag") && main.includes("expliziten `--config`-Pfad"));
assert(main.includes("describe <operation>") && main.includes("discovery"));
assert(main.includes("sse_capabilities") && main.includes("references/ui-fallback.md"));
assert(main.includes("niemals über ELSTER") && main.includes("verifizierten Arbeitskopie"));
assert(main.includes("UI-gebundene reine Prüfung niemals den Originalfall"));
assert(main.includes("sse_make_working_copy") && main.includes("discardChanges=true"));
assert(main.includes("references/ustva.md"));
assert(main.includes("setup-decisions.json") && main.includes("settings.md"));
assert(main.includes("powershell/render-pdf.ps1") && main.includes("ocr-image.ps1"));
assert(main.includes("Tracking") && main.includes(".xlsx") && main.includes("Excel niemals still"));
assert(main.includes("API-/HTTP-Transporttimeout") && main.includes("nicht als Unerreichbarkeit behandeln"));
assert(main.includes("--journal-file") && main.includes("`pending`") && main.includes("leerer stdout"));
assert(main.includes('status="complete"') && main.includes("JSON-stdout"));
assert(main.includes("Nicht-ASCII-Zeichen") && main.includes("PowerShell-Pipeline") && main.includes("durch `?` ersetzen"));
assert(main.includes("-NonInteractive -File") && main.includes("Exitcode 0") && main.includes("`ok=true`"));
assert(main.includes("kodierungsbeschädigt") && /UTF-8-\s*Argumentdatei/u.test(main));
assert(main.includes("Get-CimInstance") && main.includes("beweist keine beendete SSE-PID"));
assert(main.includes("SSE kann noch geöffnet sein") && main.includes("stillRunning=false"));
assert(main.includes("kein laufender Build messbar") && main.includes('kind="collection-incomplete"'));
assert(main.includes("references/first-run.md") && main.includes("OK Standard"));
assert(main.includes("echten Aufruf von `sse_health`") && main.includes("Handshake allein genügt nicht"));
assert(main.includes("sichtbare read-only UI-Navigation") && main.includes("dritte Rückfrage"));
assert(main.includes("Runtime-Dateien oder") && main.includes("niemals manuell als Umgehung"));
assert(main.includes("ersten `launch` in einer VM") && main.includes("`--timeout-ms 280000`"));
assert(
  main.includes("`Prüfen und Abgeben`")
    && main.includes('`direction="Weiter"`')
    && main.includes("`checker_open`")
    && main.includes("`checker_detail` nicht"),
  "Der Runtime-Skill muss Claude den deterministischen Steuerprüfer-Pfad vorgeben.",
);
assert(
  main.includes('`stopKind="no-table"`')
    && main.includes("frische `rid`")
    && main.includes("Zurück-/Historienaktion")
    && main.includes("niemals mit `Out-Null`"),
  "Der Runtime-Skill muss dynamische Listen mit frischem Readback statt Suchschleifen führen.",
);
const firstRun = readFileSync(
  join(skillsRoot, "steuer-spar-erklaerung", "references", "first-run.md"),
  "utf8",
);
assert(firstRun.includes("der richtige Steuerfall") && firstRun.includes("vollständige Liste der Belegordner"));
assert(firstRun.includes("höchstens 100") && firstRun.includes("Durchsuche niemals das gesamte Laufwerk"));
assert(firstRun.includes("aktuellste") && firstRun.includes("passende veröffentlichte Portable-Release"));
assert(firstRun.includes("`@beta`-Pakete persistent installieren"));
assert(firstRun.includes("`OK`, `OK Standard` oder `OK Default`"));
assert(firstRun.includes("hashverifizierte Prüffallkopie") && firstRun.includes("ausschließlich diese öffnen"));
assert(firstRun.includes("Setup allein erfüllt") && firstRun.includes("capabilities"));
assert(firstRun.includes("--plan-file") && firstRun.includes('"schemaVersion": 1'));
assert(firstRun.includes("genau einmal") && /fingerprint/iu.test(firstRun));
assert(firstRun.includes("Frage sie nicht erneut") && firstRun.includes("gleichwertige Bestätigung"));
assert(firstRun.includes("Standard-Prüflauf ausführen") && firstRun.includes("keiner ELSTER-Aktion"));
assert(firstRun.includes("Release-, Download-, Paket-, Skill-, Cache-"));
assert(firstRun.includes("kurzen NPX-Lauf ohne globale Installation"));
assert(firstRun.includes("keinen dauerhaften Launcher") && firstRun.includes("MCP, Setup-Skill"));
const uiFallback = readFileSync(
  join(skillsRoot, "steuer-spar-erklaerung", "references", "ui-fallback.md"),
  "utf8",
);
assert(uiFallback.includes("unsupportedButtons") && uiFallback.includes("generischen Toggle-Klick"));
const ustva = readFileSync(
  join(skillsRoot, "steuer-spar-erklaerung", "references", "ustva.md"),
  "utf8",
);
assert(ustva.includes("sse_ustva_read") && ustva.includes("sse_ustva_open_section"));
assert(ustva.includes("*.GewErfass2026") && ustva.includes("ELSTER"));
const setup = readFileSync(join(skillsRoot, "steuer-spar-erklaerung-setup", "SKILL.md"), "utf8");
assert(setup.includes("runtime/node.exe dist/api-cli.js health") && setup.includes("discovery"));
assert(setup.includes("`config.json` niemals") && setup.includes("keinen `curl`-") && setup.includes("Nur `/healthz`"));
assert(setup.includes('command = "node"') && setup.includes("schwarze `cmd.exe`-Fenster"));
assert(setup.includes("Windows x64") && setup.includes("Windows PowerShell 5.1"));
assert(setup.includes("--defaults") && setup.includes("--no-start"));
assert(setup.includes("--with-mcp") && setup.includes("setup --check"));
assert(setup.includes("--plan-file") && setup.includes("automatisiere `stdin` dafür nicht"));
assert(setup.includes("vollständige Dateiliste") && setup.includes("Manifest aus"));
assert(setup.includes("settings.md") && setup.includes("tracking.md") && setup.includes(".xlsx"));
assert(setup.includes("Connector") && setup.includes("read-only Prüfung"));
assert(setup.includes("aktuellste dort veröffentlichte") && setup.includes("OK Standard"));
assert(setup.includes("`Standard-Setup ausführen`") && setup.includes("tokenfreien") && setup.includes("additiven Merge"));
assert(setup.includes("npm.cmd install --global") && setup.includes("@yadimon/steuer-spar-erklaerung-api@beta"));
assert(setup.includes("npx.cmd") && setup.includes("Execution Policy"));
assert(setup.includes("Bei OpenCode") && setup.includes("npm der") && setup.includes("kurze Standardweg"));
assert(setup.includes("@yadimon/steuer-spar-erklaerung-mcp@beta") && setup.includes("flüchtigen `npx`-Cache"));
assert(setup.includes("`--defaults` nur") && setup.includes("frage den Nutzer nicht erneut"));
assert(setup.includes("internen Loopback-Setup-Endpunkt") && setup.includes("Konfigurationsfingerprint"));
assert(setup.includes("zuvor leere Fall-/Quellbindungen") && setup.includes("Bereits nicht leere"));
assert(setup.includes("führt `sse_health` real aus") && setup.includes("Handshake ist kein Ersatz"));
assert(setup.includes("Technisches Setup bereit; Client-Verifikation nach Neustart offen."));
assert(setup.includes("genau einen Neustart") && setup.includes("nächste Fachauftrag zuerst die Serverliste"));
assert(
  setup.includes("%USERPROFILE%\\.steuer-spar-erklaerung")
    && setup.includes("Packages\\Claude_*\\LocalCache")
    && setup.includes("eigenständig angemeldete Claude Code CLI")
    && setup.includes("Git for Windows")
    && setup.includes("Claude Cowork")
    && setup.includes("`--config`"),
  "Der Setup-Skill muss Claude Code CLI und Cowork trennen und einen dauerhaften Benutzerpfad verwenden.",
);
assert(setup.includes("arbeite nicht darum herum") && setup.includes("Prozesse weder lesen noch manuell ändern"));
assert(setup.includes("öffnet nie selbst einen Steuerfall") && setup.includes("hashverifizierte Prüffallkopie"));
assert(setup.includes("Windows-`tar.exe`") && setup.includes("Teilordner darf nicht gestartet werden"));
const installation = readFileSync(
  join(skillsRoot, "steuer-spar-erklaerung-setup", "references", "installation.md"),
  "utf8",
);
assert(installation.includes("System32\\tar.exe") && installation.includes("nicht in denselben Ordner nachentpacken"));
assert(installation.includes("WinRT") && installation.includes("Exitcode 0"));
assert(installation.includes("Installation für Menschen und AI-Agenten"));
assert(installation.includes("Codex Cloud") && installation.includes("OpenCode") && installation.includes("Claude Cowork"));
assert(installation.includes("Node.js 22+ mit npm") && installation.includes("Portable"));
assert(installation.includes("Für OpenCode ist der npm-Weg der einfache Standard"));
assert(installation.includes("OpenCode ist ein sekundärer, best-effort Client"));
assert(
  installation.includes("OpenCode darf die rohe API-Datei `config.json` weder öffnen, lesen noch parsen")
    && installation.includes("Setup-CLI")
    && installation.includes("MCP-Bootstrap laden das Token intern"),
);
assert(installation.includes("--agent <codex|claude-code|opencode>"));
assert(installation.includes("steuer-spar-erklaerung-setup --defaults --with-mcp") && installation.includes("niemals Antworten über `stdin`"));
assert(installation.includes("steuer-spar-erklaerung-setup --check"));
assert(
  installation.includes("$sseRuntimeRoot")
    && installation.includes("$sseConfigPath")
    && installation.includes("--config $sseConfigPath --defaults --with-mcp")
    && installation.includes("AppData\\Local\\Packages\\Claude_*\\LocalCache")
    && installation.includes("Claude Code CLI unter Windows (nicht Cowork)")
    && installation.includes("Git for Windows"),
  "Die Installationsanleitung braucht einen kopierbaren Host-Weg für die eigenständige Claude Code CLI.",
);
assert(installation.includes("enthält **kein Token**") && installation.includes("containsToken: false"));
assert(installation.includes("## Zwei kopierbare Prompts") && installation.includes("$steuer-spar-erklaerung"));
assert(installation.includes("tokenfreien additiven MCP-Merges") && installation.includes("fragt innerhalb dieser Grenzen aber nicht erneut"));
assert(installation.includes("`Standard-Setup ausführen`") && installation.includes("`Standard-Prüflauf ausführen`"));
assert(installation.includes("hashverifizierte Kopie") && installation.includes("kein Speichern und kein ELSTER"));
assert(installation.includes("MCP-Tools `sse_health`") && installation.includes("`ok=true`"));
assert(installation.includes("Technisches Setup bereit; Client-Verifikation nach Neustart") && installation.includes("Prompt 2 übernimmt"));
assert(
  installation.includes("required = true")
    && installation.includes("startup_timeout_sec = 30")
    && installation.includes("tool_timeout_sec = 300")
    && installation.includes('"sse_health", "sse_capabilities", "sse_product_info"')
    && installation.includes('"sse_checker_results", "sse_checker_run", "sse_checker_open"'),
  "Die Codex-Einrichtung muss den getesteten Kernkatalog und belastbare MCP-Zeitbudgets setzen.",
);
assert(installation.includes("`mcp_tool_call`") && installation.includes("API-CLI-Aufruf `health` ist kein Ersatz"));
assert(!setup.includes("Windows 10/11"), "Setup darf kompatible Windows-Versionen nicht nach Label sperren.");
for (const source of [main, firstRun, setup]) {
  assert(
    !/v\d+\.\d+\.\d+-beta\.\d+/iu.test(source),
    "Runtime-Skills dürfen keine konkrete Beta-Version als Installationsziel festschreiben.",
  );
}

const readme = readFileSync(join(root, "README.md"), "utf8");
const fencedPrompt = (source, prefix) => [...source.matchAll(/```text\r?\n([\s\S]*?)\r?\n```/gu)]
  .map((match) => match[1])
  .find((text) => text.startsWith(prefix));
assert.equal(
  fencedPrompt(readme, "Richte SteuerSparErklärung"),
  fencedPrompt(installation, "Richte SteuerSparErklärung"),
  "README und kanonische Anleitung enthalten unterschiedliche Installationsprompts.",
);
assert(
  fencedPrompt(readme, "Richte SteuerSparErklärung").includes("Standard-Setup ausführen: lokale API plus MCP.")
    && !fencedPrompt(readme, "Richte SteuerSparErklärung").includes("sse_health")
    && fencedPrompt(readme, "Richte SteuerSparErklärung").length < 600,
  "Der öffentliche Installationsprompt muss kurz bleiben und darf keine unmögliche Tool-Verifikation vor dem Neustart verlangen.",
);
assert.equal(
  fencedPrompt(readme, "Nutze $steuer-spar-erklaerung"),
  fencedPrompt(installation, "Nutze $steuer-spar-erklaerung"),
  "README und kanonische Anleitung enthalten unterschiedliche Prüfprompts.",
);
assert(
  fencedPrompt(readme, "Nutze $steuer-spar-erklaerung").includes("<ABSOLUTER_PFAD_ZUR_ESt2025-DATEI>")
    && fencedPrompt(readme, "Nutze $steuer-spar-erklaerung").includes("Standard-Prüflauf ausführen.")
    && fencedPrompt(readme, "Nutze $steuer-spar-erklaerung").length < 400,
  "Der öffentliche Prüfprompt muss kurz bleiben und einen exakten Steuerfallpfad verlangen.",
);
assert(readme.includes("## Was die Beta kann") && readme.includes("## Voraussetzungen"));
assert.match(
  readme,
  /--skill steuer-spar-erklaerung --skill steuer-spar-erklaerung-setup/gu,
  "README installiert nicht beide öffentlichen Skills gemeinsam.",
);
for (const agent of ["codex", "claude-code", "opencode"]) {
  assert(
    readme.includes(`--agent ${agent} --global --copy --yes`),
    `README enthält keinen nichtinteraktiven globalen Windows-Installationsweg für ${agent}.`,
  );
}
assert(readme.includes("https://www.skills.sh/docs/cli"), "README verlinkt die offizielle skills-CLI nicht.");
assert(readme.includes("Get-FileHash -Algorithm SHA256"), "README erklärt die manuelle ZIP-Prüfsumme nicht.");
assert.match(readme, /npx skills.*Node\.js 22\+ mit npm/su, "README verschweigt die npx-Voraussetzung.");
assert(readme.includes("npm.cmd install --global @yadimon/steuer-spar-erklaerung-api@beta"));
assert(readme.includes("npm.cmd install --global @yadimon/steuer-spar-erklaerung-mcp@beta"));
assert(readme.includes("npx.cmd") && readme.includes("PowerShell-Execution-Policy"));
assert(readme.toLowerCase().includes("installiere oder aktualisiere beide skills") && readme.includes("gecachte Webansicht"));
assert(readme.includes("## Schnellstart mit zwei Prompts") && readme.includes("steuer-spar-erklaerung-setup --check"));
assert(readme.includes("## Schnell mit NPX, ohne MCP"));
assert(readme.includes("Starte die lokale API über npx. Kein MCP und keine globale Runtime-Installation."));
assert(readme.includes("keine globale Paketinstallation") && readme.includes("kein dauerhafter Startpfad"));
assert(readme.includes("Claude Cowork") && readme.includes("Git for Windows") && readme.includes("$steuer-spar-erklaerung"));
assert(readme.includes("`Standard-Setup ausführen`") && readme.includes("`Standard-Prüflauf ausführen`"));
assert(readme.includes("bedingten tokenfreien additiven MCP-Merges") && readme.includes("Stopp ohne Speichern oder ELSTER"));
assert(readme.includes("OpenCode bleibt ein sekundärer, best-effort Client") && readme.includes("Claude Code CLI"));
assert(readme.includes("Download, persistenter Installation") && readme.includes("Starte den lokalen Agenten dann einmal neu"));
assert(readme.includes("MCP als optionale Produktfunktion") && readme.includes("Agenten-Standard enthält MCP"));
assert(readme.includes("Kernwerkzeuge des Standard-Prüflaufs") && readme.includes("alle 87 Operationen"));
assert(
  main.includes("https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/skills/steuer-spar-erklaerung-setup/references/installation.md")
    && main.includes("Technisches Setup bereit;")
    && main.includes("Client-Verifikation nach Neustart offen."),
  "Der Hauptskill muss fehlendes Setup ohne zirkuläre lokale Referenz und ohne vorgetäuschte Client-Verifikation behandeln.",
);
assert(
  setup.includes("`required`")
    && setup.includes("`startup_timeout_sec`")
    && setup.includes("`tool_timeout_sec`")
    && setup.includes("`enabled_tools`")
    && main.includes("Shell oder direkte API-CLI ist dort kein Ersatz")
    && main.includes("Im ausdrücklich gewählten NPX-/API-Modus"),
  "Setup- und Hauptskill müssen die Codex-Kataloggrenze und den echten MCP-Nachweis erzwingen.",
);
for (const source of [readme, installation, setup, main, firstRun]) {
  assert(!source.includes("Standard-Setup direkt"), "Die alte abweichende Setup-Freigabeformulierung ist noch vorhanden.");
  assert(!source.includes("Standard-Prüflauf direkt"), "Die alte abweichende Prüflauf-Freigabeformulierung ist noch vorhanden.");
}

const architecture = readFileSync(join(root, "docs", "ARCHITEKTUR.md"), "utf8");
assert(
  architecture.includes("installiert `steuer-spar-erklaerung` und")
    && architecture.includes("`steuer-spar-erklaerung-setup` gemeinsam")
    && !architecture.includes("bleibt allein installierbar"),
  "Der Architekturvertrag muss den gemeinsamen Zwei-Skill-Standard beschreiben.",
);

const issueTemplate = readFileSync(join(root, ".github", "ISSUE_TEMPLATE", "fehler.yml"), "utf8");
assert(issueTemplate.includes("npm-Einrichtung") && issueTemplate.includes("Portable Einrichtung"));
assert(issueTemplate.includes(`v${JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version}`));

process.stdout.write("Public Skills: 2 flache npx-kompatible, deutsche und portable Skill-Pakete bestanden\n");
