import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const skillsRoot = join(root, "skills");
const expected = ["steuer-spar-erklaerung"];
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
const openAiMetadata = readFileSync(
  join(skillsRoot, "steuer-spar-erklaerung", "agents", "openai.yaml"),
  "utf8",
);
assert(openAiMetadata.includes("kündige sichtbare Bedienung trotzdem an"));
assert(main.includes("Node.js 22+ mit npm") && main.includes("Python und PowerShell 7 nicht"));
assert(main.includes("MCP ist ein dünner Wrapper darüber") && main.includes("API-Selbstbeschreibung"));
assert(main.includes("NPX-Kurzweg ohne globale Runtime-Installation"));
assert(main.includes("npx.cmd -y @yadimon/steuer-spar-erklaerung-api --case-dir"));
assert(main.includes("npx.cmd -y -p @yadimon/steuer-spar-erklaerung-api steuer-spar-erklaerung-call"));
assert(main.includes("kein dauerhafter Launcher") && main.includes("eine Installation im Ordner und MCP sind dafuer"));
assert(
  main.includes("keine Zugriffssperre der direkten API"),
  "Hauptskill muss --case-dir ehrlich als Referenz-/Schwaerzungsgrenze beschreiben.",
);
assert(
  main.includes("bereits eine SSE-API läuft, fahre") && main.includes("nicht fort"),
  "Hauptskill muss den belegten Loopback-Port als Stopp benennen.",
);
assert(
  main.includes("`case_hash` auf `cases:") && main.includes("Get-FileHash -Algorithm SHA256"),
  "Hauptskill muss die Fallbindung ueber Dateiidentitaet statt ueber eine Ordnerangabe pruefen.",
);
assert(
  main.includes("## Zuerst: ist ein Transport da?")
    && main.includes("Beginne jeden Auftrag mit genau einem Aufruf von `sse_health`")
    && main.includes("Es gibt gar kein `sse_*`-Tool"),
  "Hauptskill muss zuerst den Transport pruefen und ohne MCP in die Anleitung zurueckfallen.",
);
assert(main.includes("ausdrücklich gewählten NPX-/API-Modus") && main.includes("fehlendes MCP ist dort kein Fehler"));
assert(main.includes("steuer-spar-erklaerung-call") && main.includes("--args-file -") && main.includes("Prozessliste"));
assert(main.includes("Die API kennt keine Anmeldung") && main.includes("mit 403 ab"),
  "Hauptskill muss die Herkunftspruefung statt eines Tokens nennen.");
assert(
  main.includes("Der MCP-Eintrag enthält keinen `--config`-Pfad")
    && main.includes("`--config` gehört ausschließlich"),
  "Der Hauptskill muss API-Konfiguration und MCP-Startargumente sauber trennen.",
);
assert(main.includes("describe <operation>") && main.includes("discovery"));
assert(main.includes("sse_capabilities") && main.includes("references/ui-fallback.md"));
assert(main.includes("niemals über ELSTER") && main.includes("Ein bereits eindeutig"));
assert(main.includes("references/case-session.md") && main.includes("Eine Arbeits- oder"));
assert(main.includes("Sonst antworte im Chat") && main.includes("Speicherstatus"));
assert(main.includes("dirty-fähige UI-Navigation oder Mutation")
  && main.includes("genau einmal nach `backups:`")
  && main.includes("Disk-Hash weiterhin zum verifizierten Backup-Tupel passen"));
assert(main.includes("references/ustva.md"));
assert(main.includes("settings.md"));
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
assert(
  main.includes("references/belegmanager-backup.md")
    && main.includes("Eine Falldatei-Sicherung ersetzt diese Sicherung nicht"),
  "Hauptskill muss vor BelegManager-Mutationen die getrennte Datensicherung verlangen.",
);
assert(main.includes("echten Aufruf von `sse_health`") && main.includes("Handshake allein genügt nicht"));
assert(main.includes("geöffneten/bestätigten Fall") && main.includes("dritte Rückfrage"));
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
assert(
  firstRun.includes("beiden veröffentlichten npm-Pakete in den Arbeitsordner installieren")
    && !/Portable/u.test(firstRun),
  "Der First-Run-Plan muss den npm-Weg nennen und darf kein Portable-Release mehr anbieten.",
);
assert(firstRun.includes("`OK`, `OK Standard` oder `OK Default`"));
assert(firstRun.includes("bereits genau ein Steuerfall eindeutig geöffnet")
  && firstRun.includes("ohne Kandidatensuche"));
assert(firstRun.includes("hashverifizierte Prüffallkopie") && firstRun.includes("ausdrücklich isolierten"));
assert(firstRun.includes("Nur wenn keine andere Instanz offen ist und die Bindung stimmt")
  && firstRun.includes("frisch gebundene Kopie"));
assert(firstRun.includes("Setup allein erfüllt") && firstRun.includes("capabilities"));
assert(
  firstRun.includes("Es gibt kein Einrichtungsprogramm und keine Plandatei")
    && firstRun.includes("docs/INSTALLATION.md")
    && !firstRun.includes("setup-decisions.json"),
  "Der First-Run muss auf die Anleitung zeigen statt auf ein entfallenes Setup.",
);
assert(firstRun.includes("Frage sie nicht erneut") && firstRun.includes("gleichwertige Bestätigung"));
assert(firstRun.includes("Standard-Prüflauf ausführen") && firstRun.includes("keiner ELSTER-Aktion"));
assert(firstRun.includes("Release-, Download-, Paket-, Skill-, Cache-"));
assert(firstRun.includes("kurzen NPX-Lauf ohne Installation"));
assert(firstRun.includes("Client-Merge und") && firstRun.includes("gehören nicht zu diesem Kurzweg"));
const uiFallback = readFileSync(
  join(skillsRoot, "steuer-spar-erklaerung", "references", "ui-fallback.md"),
  "utf8",
);
assert(uiFallback.includes("unsupportedButtons") && uiFallback.includes("generischen Toggle-Klick"));
const receiptBackup = readFileSync(
  join(skillsRoot, "steuer-spar-erklaerung", "references", "belegmanager-backup.md"),
  "utf8",
);
for (const requirement of [
  "SSEKonf.user.ini",
  "[BelegManager]",
  "DataDir",
  "BelegManager.db4",
  "SQLite-Online-Backup-API",
  "PRAGMA integrity_check",
  "SHA-256",
]) {
  assert(receiptBackup.includes(requirement), `BelegManager-Sicherungswissen fehlt: ${requirement}`);
}
assert(receiptBackup.includes("außerhalb des Repositorys") && receiptBackup.includes("keine Quellpfade"));
assert(receiptBackup.includes("zusammenhängenden BelegManager-")
  && receiptBackup.includes("Mutationsphase")
  && receiptBackup.includes("keine Sicherung vor jeder Zeile oder jedem Tool-Aufruf"));
const caseSession = readFileSync(
  join(skillsRoot, "steuer-spar-erklaerung", "references", "case-session.md"),
  "utf8",
);
for (const requirement of [
  "Der offene Fall ist maßgeblich",
  "Eine Sicherung je unverändertem Dateistand",
  "Ändern ist nicht Speichern",
  "sse_instances",
  "sse_make_working_copy",
  "sse_save_as",
  "muss `sse_instances` leer sein",
  "Öffnen einer zweiten SSE-Instanz",
  "Erzeuge keinen separaten",
]) {
  assert(caseSession.includes(requirement), `Arbeitssitzungs-Vertrag fehlt: ${requirement}`);
}
assert(caseSession.includes("Erzeuge weder pro MCP/API-Aufruf")
  && caseSession.includes("erzeuge nicht automatisch eine")
  && caseSession.includes("Bei ungespeicherten")
  && caseSession.includes("frage, ob er gespeichert, verworfen oder")
  && caseSession.includes("Verwirf das gemerkte Tupel")
  && caseSession.includes("genügt ein gleicher Hash")
  && caseSession.includes("Behandle lineare Navigation vorsorglich immer als dirty-fähig"));
const mcpConduct = readFileSync(join(root, "src", "mcp-main.ts"), "utf8");
assert(mcpConduct.includes("Ist genau ein Steuerfall bereits offen")
  && mcpConduct.includes("Aendern erlaubt kein Speichern")
  && mcpConduct.includes("unveraenderten Dateihash")
  && mcpConduct.includes("Eine backups:-Sicherung niemals oeffnen")
  && mcpConduct.includes("speichern, verwerfen, schliessen oder wechseln"),
"MCP-Serverinstruktionen müssen offenen Fall, Speicherfreigabe und Backup-Reuse festschreiben.");
const lifecycleTools = readFileSync(join(root, "src", "mcp-tools-lifecycle.ts"), "utf8");
assert(lifecycleTools.includes("ausdruecklichen Wunsch nach einer neuen Datei/Kopie")
  && lifecycleTools.includes("statt vor jedem Tool-Aufruf")
  && lifecycleTools.includes("erlaubt weder Schliessen noch Verwerfen")
  && lifecycleTools.includes("sse_instances frisch lesen"),
"Lifecycle-Tools dürfen Save As oder Backups pro Aufruf nicht als Standard nahelegen.");
const apiPackageReadme = readFileSync(join(root, "packages", "api", "README.md"), "utf8");
const mcpPackageReadme = readFileSync(join(root, "packages", "mcp", "README.md"), "utf8");
assert(apiPackageReadme.includes("Arbeitskopie und `save_as` nur auf ausdrücklichen Wunsch"));
assert(mcpPackageReadme.includes("dirty-fähigen UI-Navigation oder Mutation")
  && mcpPackageReadme.includes("`save` oder `save_as` wird nie still"));
const ustva = readFileSync(
  join(skillsRoot, "steuer-spar-erklaerung", "references", "ustva.md"),
  "utf8",
);
assert(ustva.includes("sse_ustva_read") && ustva.includes("sse_ustva_open_section"));
assert(ustva.includes("*.GewErfass2026") && ustva.includes("ELSTER"));
assert(ustva.includes("vor jeder UStVA-Lesung oder Navigation einmal")
  && ustva.indexOf("nach `backups:`") < ustva.indexOf("Lies Fallkopf"));
const installation = readFileSync(join(root, "docs", "INSTALLATION.md"), "utf8");
assert(installation.includes("Installation für Menschen und AI-Agenten"));
assert(installation.includes("Codex Cloud") && installation.includes("OpenCode") && installation.includes("Claude Cowork"));
assert(installation.includes("OpenCode ist ein sekundärer, best-effort Client"));
assert(installation.includes("--agent <codex|claude-code|opencode>"));
assert(
  installation.includes("AppData\\Local\\Packages\\Claude_*\\LocalCache")
    && installation.includes("Claude Code CLI unter Windows (nicht Cowork)")
    && installation.includes("Git for Windows"),
  "Die Anleitung muss die MSIX-Virtualisierung und die eigenstaendige Claude-CLI benennen.",
);
assert(
  installation.includes("## Es gibt kein Token")
    && installation.includes("`Origin`- oder `Sec-Fetch-Site`-Kopfzeile")
    && installation.includes("DNS-Rebinding"),
  "Die Anleitung muss erklaeren, warum es kein Token gibt und was stattdessen schuetzt.",
);
assert(installation.includes("Windows x64") && installation.includes("Node.js 22 oder neuer"),
  "Die Anleitung muss Plattform und Node-Voraussetzung nennen.");
assert(
  !/steuer-spar-erklaerung-setup|--with-mcp|--plan-file|--defaults/u.test(installation),
  "Die Anleitung darf kein Setup-Programm mehr nennen; es gibt keines.",
);
assert(installation.includes("Es gibt **kein Setup-Programm**"),
  "Die Anleitung muss den Wegfall des Setups ausdruecklich sagen.");
assert(installation.includes("Eine `config.json` ist **optional**") && installation.includes("settings.md"),
  "Die Anleitung muss die optionale Konfiguration und die Prosa-Einstellungen nennen.");
assert(installation.includes("_npx") && installation.includes("Es laeuft bereits eine SSE-API"),
  "Die Anleitung muss npx-Cache-Falle und den Portkonflikt als Stopp nennen.");
assert(
  installation.includes("/v1/openapi.json") && installation.includes("/v1/operations")
    && installation.includes("Die API selbst dokumentiert sich"),
  "Die Anleitung muss die selbstbeschreibenden Endpunkte nennen, aus denen Klienten entstehen.",
);
assert(installation.includes("enabled_tools") && installation.includes("required = true"),
  "Die Anleitung muss die Codex-Kataloggrenze nennen.");
for (const requiredReceiptTool of [
  "sse_menu_click",
  "sse_receipt_manager_action",
  "sse_receipt_manager_list",
  "sse_receipt_manager_read",
  "sse_receipt_manager_import",
  "sse_receipt_manager_delete",
  "sse_snapshot",
  "sse_window_close",
]) {
  assert(
    installation.includes(`"${requiredReceiptTool}"`),
    `Die Codex-Kernliste muss das fuer den BelegManager-Smoke erforderliche Werkzeug ${requiredReceiptTool} freigeben.`,
  );
}
assert(installation.includes("npm i @yadimon/steuer-spar-erklaerung-api")
  && installation.includes("Execution Policy"),
  "Die Anleitung muss den npm-Weg und die PowerShell-Falle nennen.");
assert(installation.includes("## Kopierbare Prompts") && installation.includes("$steuer-spar-erklaerung"));
assert(installation.includes("additiven MCP-Merges") && installation.includes("fragt innerhalb dieser Grenzen aber nicht erneut"));
assert(installation.includes("`Standard-Setup ausführen`") && installation.includes("`Standard-Prüflauf ausführen`"));
assert(installation.includes("hashverifizierte Kopie") && installation.includes("kein Speichern und kein ELSTER"));
assert(installation.includes("MCP-Tool `sse_health`") && installation.includes("`ok=true`"));
assert(installation.includes("Technisches Setup bereit; Client-Verifikation nach Neustart") && installation.includes("Prompt 2 übernimmt"));
assert(
  installation.includes("steuer-spar-erklaerung-api.cmd --config")
    && /steuer-spar-erklaerung-mcp[\\/]dist[\\/]index\.js/u.test(installation),
  "Die Anleitung muss den API-Start und den MCP-Einstieg als .js zeigen.",
);
assert(
  installation.includes("CVE-2024-27980") && installation.includes("Nicht den `.cmd`-Shim"),
  "Die Anleitung muss begruenden, warum der MCP-Eintrag kein Batch-Wrapper sein darf.",
);
assert(
  installation.includes("required = true")
    && installation.includes("startup_timeout_sec = 30")
    && installation.includes("tool_timeout_sec = 300")
    && installation.includes('"sse_health", "sse_capabilities", "sse_product_info"')
    && installation.includes('"sse_checker_results", "sse_checker_run", "sse_checker_open"'),
  "Die Codex-Einrichtung muss den getesteten Kernkatalog und belastbare MCP-Zeitbudgets setzen.",
);
assert(installation.includes("`mcp_tool_call`") && installation.includes("API-CLI-Aufruf `health` ist kein Ersatz"));
for (const source of [main, firstRun]) {
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
assert(readme.includes("## Features") && readme.includes("## Voraussetzungen"));
assert.match(
  readme,
  /--skill steuer-spar-erklaerung --agent/u,
  "README nennt den Skill-Installer nicht mit dem einen öffentlichen Skill.",
);
assert(readme.includes("--agent <codex|claude-code|opencode> --copy --yes"),
  "README muss genau einen lokalen Skill-Installationsweg mit Agentenauswahl zeigen.");
assert(!readme.includes("--global --copy --yes"),
  "README darf den globalen Skill-Weg nicht als kopierbaren Standard ausgeben.");
assert(readme.includes("https://www.skills.sh/docs/cli"), "README verlinkt die offizielle skills-CLI nicht.");
assert(readme.includes("Node.js 22 oder neuer mit npm"), "README verschweigt die npx-Voraussetzung.");
assert(readme.includes("npm.cmd install @yadimon/steuer-spar-erklaerung-api@latest @yadimon/steuer-spar-erklaerung-mcp@latest"));
assert(
  readme.includes("steuer-spar-erklaerung-api.cmd --config")
    && readme.includes("Ein Einrichtungsprogramm gibt es nicht"),
  "README muss den API-Start statt eines Setup-Programms zeigen.",
);
assert(readme.includes("npx.cmd") && readme.includes("PowerShell-Execution-Policy"));
assert(readme.toLowerCase().includes("installiere oder aktualisiere den skill") && readme.includes("gecachte Webansicht"));
assert(readme.includes("### Dauerhaftes Setup mit zwei Prompts") && /einem grünen\s+`health`/u.test(readme));
assert(readme.includes("### Robuster isolierter Prüflauf"));
assert(
  readme.includes("Starte die lokale API im Vordergrund über npx.")
    && readme.includes("Kein MCP, keine globale Installation und keine dauerhafte Konfiguration."),
  "Der isolierte Prompt muss den prozesslokalen NPX-Weg ohne persistente Installation festlegen.",
);
assert(readme.includes("keine globale Paketinstallation") && readme.includes("kein dauerhafter Startpfad"));
assert(
  readme.includes("Die lokale API erzwingt technisch:")
    && readme.includes("Der Prüfablauf der Skills garantiert zusätzlich:")
    && readme.includes("keine technische Sperre der API"),
  "README muss API-Invarianten und Ablaufdisziplin getrennt ausweisen.",
);
assert(
  readme.includes("keine Zugriffssperre der direkten API"),
  "README darf --case-dir nicht als Sandbox darstellen.",
);
assert(readme.includes("Claude Cowork") && readme.includes("Git for Windows") && readme.includes("$steuer-spar-erklaerung"));
assert(readme.includes("`Standard-Setup ausführen`") && readme.includes("`Standard-Prüflauf ausführen`"));
assert(!readme.includes("### Basic Prompt"),
  "README soll den kombinierten Setup-Prompt nicht neben dem empfohlenen Zwei-Prompt-Weg duplizieren.");
assert(readme.includes("bedingten additiven MCP-Merges")
  && /Schließen genau dieser Prüffallkopie\s+ohne Speichern/iu.test(readme)
  && readme.includes("ohne Speichern sowie den Stopp ohne"));
assert(readme.includes("OpenCode bleibt ein sekundärer, best-effort Client") && readme.includes("Claude Code CLI"));
assert(/des Downloads, der\s+Installation in den Ordner/u.test(readme)
  && /Starte den\s+lokalen Agenten dann einmal neu/u.test(readme));
assert(readme.includes("MCP als optionale Produktfunktion") && readme.includes("Agenten-Standard enthält MCP"));
assert(
  !/mcpServers[\s\S]{0,400}steuer-spar-erklaerung-mcp\.cmd/u.test(readme),
  "Das README darf keinen .cmd-Shim als MCP-Befehl zeigen; ein Client kann ihn nicht starten.",
);
assert(readme.includes("begrenzte Kernliste")
  && readme.includes("vollständige Katalog mit 99")
  && readme.includes("gelten für API-CLI und MCP gleichermaßen"));
assert(
  main.includes("https://github.com/yadimon/steuer-spar-erklaerung-mcp/blob/main/docs/INSTALLATION.md")
    && main.includes("Technisches Setup bereit;")
    && main.includes("Client-Verifikation nach Neustart offen."),
  "Der Hauptskill muss fehlendes Setup ohne zirkuläre lokale Referenz und ohne vorgetäuschte Client-Verifikation behandeln.",
);
assert(
  installation.includes("## Aktualisieren")
    && installation.includes("@yadimon/steuer-spar-erklaerung-api@latest")
    && installation.includes("## Entfernen")
    && installation.includes("Nutzerdaten"),
  "Die kanonische Anleitung muss Update und datenerhaltende Deinstallation abdecken.",
);
for (const source of [readme, installation, main, firstRun]) {
  assert(!source.includes("Standard-Setup direkt"), "Die alte abweichende Setup-Freigabeformulierung ist noch vorhanden.");
  assert(!source.includes("Standard-Prüflauf direkt"), "Die alte abweichende Prüflauf-Freigabeformulierung ist noch vorhanden.");
}

const architecture = readFileSync(join(root, "docs", "ARCHITEKTUR.md"), "utf8");
assert(
  architecture.includes("installiert genau einen Skill")
    && architecture.includes("prüft zuerst über `sse_health`")
    && !architecture.includes("steuer-spar-erklaerung-setup"),
  "Der Architekturvertrag muss den Ein-Skill-Standard mit Transportpruefung beschreiben.",
);

const issueTemplate = readFileSync(join(root, ".github", "ISSUE_TEMPLATE", "fehler.yml"), "utf8");
assert(issueTemplate.includes("npm-Einrichtung"));
assert.match(issueTemplate, /Aktuelle Version aus sse_health oder dem installierten npm-Paket/u);
assert.match(issueTemplate, /placeholder: "<Version aus sse_health oder npm>"/u);
assert.doesNotMatch(issueTemplate, /v0\.1\.0-beta\.\d+/u,
  "Das Issue-Formular darf keine bei jedem Release veraltende Beispielversion enthalten.");

process.stdout.write(`Public Skills: ${discovered.length} flaches npx-kompatibles deutsches Skill-Paket bestanden\n`);
