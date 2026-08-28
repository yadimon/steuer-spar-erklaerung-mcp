/**
 * Rauchtest: startet den MCP-Server als Unterprozess, spricht ihn ueber das
 * echte MCP-Protokoll an und ruft jedes Werkzeug einmal auf.
 *
 * Aufruf:  node test/smoke.mjs
 *
 * Schreibende Werkzeuge und alles, was das Programm beendet,
 * werden NUR mit --write bzw. --restart ausgefuehrt.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "dist", "index.js");
const WRITE = process.argv.includes("--write");
const RESTART = process.argv.includes("--restart");

let pass = 0;
let fail = 0;
const failures = [];

/** Vollstaendiger Text der Antwort - Zusicherungen muessen darauf laufen. */
function fullText(res) {
  return res?.content?.map((c) => (c.type === "text" ? c.text : `<${c.type}>`)).join("\n") ?? "";
}
/** Gekuerzt, nur fuer die Anzeige. */
function short(res, n = 260) {
  const t = fullText(res);
  return t.length > n ? t.slice(0, n) + " …" : t;
}

async function check(client, name, args, expect) {
  process.stdout.write(`\n▶ ${name} ${JSON.stringify(args)}\n`);
  const t0 = Date.now();
  let res;
  try {
    res = await client.callTool({ name, arguments: args });
  } catch (e) {
    fail++;
    failures.push(`${name}: Aufruf warf ${e.message}`);
    process.stdout.write(`  ✗ Aufruf warf: ${e.message}\n`);
    return null;
  }
  const ms = Date.now() - t0;
  const whole = fullText(res);          // Zusicherung auf dem VOLLEN Text
  const shown = short(res);             // Anzeige gekuerzt
  const verdict = expect ? expect(res, whole) : { ok: !res.isError, why: res.isError ? "isError" : "" };
  if (verdict.ok) {
    pass++;
    process.stdout.write(`  ✓ ${ms} ms\n    ${shown.replace(/\n/g, "\n    ")}\n`);
  } else {
    fail++;
    failures.push(`${name}: ${verdict.why}`);
    process.stdout.write(`  ✗ ${ms} ms — ${verdict.why}\n    ${shown.replace(/\n/g, "\n    ")}\n`);
  }
  return res;
}

const okIf = (fn, why) => (res, text) => ({ ok: !res.isError && fn(text), why: res.isError ? `Fehler: ${text.slice(0, 200)}` : why });
const mustError = (needle) => (res, text) => ({
  ok: res.isError === true && text.includes(needle),
  why: `erwartete Fehlermeldung mit "${needle}"`,
});

const main = async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env } });
  const client = new Client({ name: "smoke", version: "1.0.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  process.stdout.write(`Werkzeuge angeboten: ${tools.tools.length}\n`);
  process.stdout.write(tools.tools.map((t) => `  - ${t.name}`).join("\n") + "\n");
  if (!tools.tools.some((tool) => tool.name === "sse_keys")) {
    pass++;
  } else {
    fail++;
    failures.push("sse_keys: unsichere Roh-Tastatur ist weiterhin oeffentlich registriert.");
  }
  const clickPatterns = tools.tools.find((tool) => tool.name === "sse_click")
    ?.inputSchema?.properties?.pattern?.enum ?? [];
  if (!clickPatterns.includes("toggle")) {
    pass++;
  } else {
    fail++;
    failures.push("sse_click: gesperrtes TogglePattern wird weiterhin oeffentlich beworben.");
  }
  for (const required of [
    "sse_product_info",
    "sse_capabilities",
    "sse_page_objects",
    "sse_page_state",
    "sse_snapshot_compare",
    "sse_case_hash",
    "sse_window_restore",
    "sse_dialog_list",
    "sse_dialog_answer",
    "sse_warning_popup_read",
    "sse_vast_dialog_read",
    "sse_vast_row_details",
    "sse_vast_row_set_expanded",
    "sse_vast_mapping_options",
    "sse_vast_mapping_select",
    "sse_vast_apply",
    "sse_ui_state",
    "sse_table_read",
    "sse_table_add",
    "sse_table_update",
    "sse_table_delete",
    "sse_change_field",
    "sse_change_known_field",
    "sse_toggle",
    "sse_combo_options",
    "sse_combo_select",
    "sse_ustva_read",
    "sse_ustva_select_period",
    "sse_ustva_set_flag",
    "sse_ustva_change_value",
    "sse_ustva_open_section",
    "sse_menu_close",
    "sse_save",
    "sse_file_dialog_select",
    "sse_save_as",
    "sse_archive_cases",
    "sse_make_working_copy",
    "sse_checker_results",
    "sse_checker_run",
    "sse_checker_reset",
    "sse_checker_close",
    "sse_checker_open",
  ]) {
    if (tools.tools.some((t) => t.name === required)) {
      pass++;
    } else {
      fail++;
      failures.push(`Werkzeug fehlt: ${required}`);
    }
  }
  const changeFieldTool = tools.tools.find((tool) => tool.name === "sse_change_field");
  const changeKnownTool = tools.tools.find((tool) => tool.name === "sse_change_known_field");
  for (const [name, tool] of [["sse_change_field", changeFieldTool], ["sse_change_known_field", changeKnownTool]]) {
    const description = tool?.description ?? "";
    const normalizedDescription = description.toLowerCase();
    const describesRollback = normalizedDescription.includes("rollback") || normalizedDescription.includes("zurueckgerollt");
    if (normalizedDescription.includes("fremde") && describesRollback && normalizedDescription.includes("zustand")) {
      pass++;
    } else {
      fail++;
      failures.push(`${name}: Werkzeugbeschreibung erklaert den Interference-Guard nicht.`);
    }
  }
  const clickTool = tools.tools.find((tool) => tool.name === "sse_click");
  const clickDescription = (clickTool?.description ?? "").toLowerCase();
  const clickProperties = clickTool?.inputSchema?.properties ?? {};
  if (clickDescription.includes("seitenueberschrift") &&
      clickProperties.expectedPageBefore && clickProperties.expectedPageAfter) {
    pass++;
  } else {
    fail++;
    failures.push("sse_click: atomare Navigations-Nachbedingung fehlt in Beschreibung oder Schema.");
  }
  const tableDeleteTool = tools.tools.find((tool) => tool.name === "sse_table_delete");
  const tableDeleteDescription = (tableDeleteTool?.description ?? "").toLowerCase();
  const tableDeleteRequired = new Set(tableDeleteTool?.inputSchema?.required ?? []);
  if (tableDeleteRequired.has("expectedPage") && tableDeleteRequired.has("sumLabel") &&
      tableDeleteRequired.has("expectedBefore") && tableDeleteRequired.has("expectedAfter") &&
      tableDeleteDescription.includes("summenregion") && tableDeleteDescription.includes("interferenz")) {
    pass++;
  } else {
    fail++;
    failures.push("sse_table_delete: Seiten-/Summenregionsbindung oder rollbackfreier Interference-Stopp fehlt.");
  }
  const tableUpdateTool = tools.tools.find((tool) => tool.name === "sse_table_update");
  const tableUpdateDescription = (tableUpdateTool?.description ?? "").toLowerCase();
  const tableUpdateRequired = new Set(tableUpdateTool?.inputSchema?.required ?? []);
  if (tableUpdateRequired.has("expectedPage") && tableUpdateRequired.has("sumLabel") &&
      tableUpdateRequired.has("expectedBefore") && tableUpdateRequired.has("expectedAfter") &&
      tableUpdateDescription.includes("tabellenregion") && tableUpdateDescription.includes("fremde") &&
      tableUpdateDescription.includes("rollback")) {
    pass++;
  } else {
    fail++;
    failures.push("sse_table_update: Seiten-/Summenregionsbindung oder rollbackfreier Interference-Stopp fehlt.");
  }
  const setValueTool = tools.tools.find((tool) => tool.name === "sse_set_value");
  const setValueDescription = (setValueTool?.description ?? "").toLowerCase();
  const setValueRequired = new Set(setValueTool?.inputSchema?.required ?? []);
  const setValueRid = setValueTool?.inputSchema?.properties?.rid;
  if (setValueRequired.has("rid") && setValueRequired.has("expectedBefore") &&
      setValueRequired.has("value") && setValueRequired.has("expectedAfter") &&
      setValueRid?.type === "string" &&
      setValueDescription.includes("steuerneutrale") && setValueDescription.includes("gesperrt")) {
    pass++;
  } else {
    fail++;
    failures.push("sse_set_value: Suchfeld-Allowlist oder Vor-/Nachwertvertrag fehlt.");
  }
  const comboSelectTool = tools.tools.find((tool) => tool.name === "sse_combo_select");
  const comboSelectDescription = (comboSelectTool?.description ?? "").toLowerCase();
  const comboSelectRequired = new Set(comboSelectTool?.inputSchema?.required ?? []);
  if (comboSelectRequired.has("expectedPage") && comboSelectRequired.has("expectedCurrent") &&
      comboSelectRequired.has("value") && comboSelectRequired.has("expectedAfter") &&
      comboSelectDescription.includes("fensterlage") && comboSelectDescription.includes("fremde") &&
      comboSelectDescription.includes("rollback")) {
    pass++;
  } else {
    fail++;
    failures.push("sse_combo_select: Seiten-/Vor-/Nachwert- oder Interference-/Rollback-Vertrag fehlt.");
  }
  const toggleTool = tools.tools.find((tool) => tool.name === "sse_toggle");
  const toggleDescription = (toggleTool?.description ?? "").toLowerCase();
  const toggleRequired = new Set(toggleTool?.inputSchema?.required ?? []);
  if (toggleRequired.has("expectedPage") && toggleRequired.has("expectedBefore") &&
      toggleRequired.has("value") && toggleRequired.has("expectedAfter") &&
      toggleDescription.includes("fensterlage") && toggleDescription.includes("fremde") &&
      toggleDescription.includes("rollback")) {
    pass++;
  } else {
    fail++;
    failures.push("sse_toggle: Seiten-/Vor-/Nachzustands- oder Interference-/Rollback-Vertrag fehlt.");
  }

  // --- Diagnose ---------------------------------------------------------
  const product = await check(
    client,
    "sse_product_info",
    {},
    okIf((t) => t.includes('"taxYear": 2025') && t.includes('"engineFileMajor": 31'), "SSE-2025-Produktgrenze fehlt"),
  );
  let productObj = null;
  try {
    productObj = JSON.parse(product?.content?.find((c) => c.type === "text")?.text ?? "{}");
  } catch { /* egal */ }
  if (productObj?.defaultExecutable?.supported === true) {
    await check(
      client,
      "sse_launch",
      { exe: join(process.env.WINDIR ?? "C:\\Windows", "System32", "notepad.exe"), mode: "einur" },
      mustError("Invalid arguments for tool sse_launch"),
    );
    await check(
      client,
      "sse_desktop_start",
      { exe: join(process.env.WINDIR ?? "C:\\Windows", "System32", "notepad.exe"), mode: "einur", name: "SSEVersionGateTest" },
      mustError("Invalid arguments for tool sse_desktop_start"),
    );
    await check(
      client,
      "sse_launch",
      { file: "C:\\__sse_mcp_tests__\\fixture.Gew2024", mode: "einur" },
      mustError("Invalid arguments for tool sse_launch"),
    );
    await check(
      client,
      "sse_launch",
      { file: "C:\\__sse_mcp_tests__\\fixture.ESt2025", mode: "einur" },
      mustError("Invalid arguments for tool sse_launch"),
    );
  } else {
    process.stdout.write("\n(uebersprungen: SSE-2025-Startgrenzen — Standardinstallation nicht verifiziert)\n");
  }
  const health = await check(client, "sse_health", {}, okIf((t) => t.includes('"running"'), "kein running-Feld"));
  // Vollen Text auswerten, nicht die gekuerzte Anzeige.
  let healthObj = null;
  try {
    healthObj = JSON.parse(health?.content?.find((c) => c.type === "text")?.text ?? "{}");
  } catch { /* egal */ }
  const sseRunning = healthObj?.running === true;
  if (!sseRunning) {
    process.stdout.write("\n⚠ Programm laeuft nicht - UI-abhaengige Lesetests werden sauber uebersprungen.\n");
  } else if (healthObj?.advice !== "gesund") {
    process.stdout.write(
      `\n⚠ Programm nicht gesund (advice='${healthObj?.advice}', canary=${healthObj?.canaryMs} ms) - Lesetests koennten fehlschlagen.\n`,
    );
  } else {
    process.stdout.write(`\n✓ Programm gesund (Kanarienvogel ${healthObj.canaryMs} ms)\n`);
  }

  await check(client, "sse_windows", {}, (res, responseText) => {
    if (res.isError) return { ok: false, why: `Fehler: ${responseText.slice(0, 200)}` };
    try {
      const parsed = JSON.parse(responseText);
      return { ok: Array.isArray(parsed.windows), why: "Fensterliste ist kein stabiles Array" };
    } catch {
      return { ok: false, why: "Fensterliste ist kein JSON" };
    }
  });
  await check(
    client,
    "sse_dialog_list",
    {},
    okIf((t) => t.includes('"dialogs"') && t.includes('"windows"'), "Dialoginventar fehlt"),
  );

  // --- Falldateien (brauchen das Programm nicht) ------------------------
  if (process.env.SSE_CASE_DIR) {
    await check(
      client,
      "sse_list_cases",
      { dir: process.env.SSE_CASE_DIR },
      okIf((t) => t.includes("elsterTransferTime"), "ELSTER-Feld fehlt"),
    );
  } else {
    await check(client, "sse_list_cases", {}, mustError("dir ist Pflicht"));
  }
  await check(client, "sse_archive_cases", {}, mustError("Invalid arguments for tool sse_archive_cases"));

  // --- Lesen ------------------------------------------------------------
  if (sseRunning) {
    await check(client, "sse_screenshot", {}, okIf((t) => t.includes("width"), "keine Bildgroesse"));
    await check(client, "sse_read_page", {}, okIf((t) => t.includes("heading"), "keine Ueberschrift"));
    await check(client, "sse_read_table", {}, okIf((t) => t.includes("rowCount"), "kein rowCount"));
  // Exakte Suche darf NUR exakte Namen liefern. (Der Parameter 'contains'
  // traf frueher immer zu, weil $a.contains auf einer Hashtable die
  // eingebaute Methode Contains erwischte.) Seitenunabhaengig formuliert:
  // jeder Treffer muss exakt "Weiter" heissen.
  await check(
    client,
    "sse_find",
    { name: "Weiter" },
    (res, t) => {
      if (res.isError) return { ok: false, why: `Fehler: ${t.slice(0, 150)}` };
      const hits = JSON.parse(t).hits ?? [];
      const falsch = hits.filter((h) => h.name !== "Weiter");
      return {
        ok: hits.length > 0 && falsch.length === 0,
        why: falsch.length
          ? `exakte Suche lieferte Teilstringtreffer: ${falsch.map((h) => h.name).join(", ")}`
          : "kein Treffer fuer 'Weiter'",
      };
    },
  );
  // Teilstringsuche muss mindestens so viele Treffer liefern wie die exakte.
  await check(
    client,
    "sse_find",
    { name: "Weiter", contains: true },
    (res, t) => {
      if (res.isError) return { ok: false, why: `Fehler: ${t.slice(0, 150)}` };
      const n = JSON.parse(t).count ?? 0;
      return { ok: n >= 1, why: `Teilstringsuche lieferte ${n} Treffer` };
    },
  );
  await check(
    client,
    "sse_snapshot",
    { types: ["Button"], namedOnly: true },
    okIf((t) => t.includes('"count"'), "kein count"),
  );
    await check(client, "sse_scroll", { mode: "list" }, okIf(() => true, ""));
  } else {
    process.stdout.write("\n(uebersprungen: Screenshot, Seiten-/Tabellenlesung, Suche, Snapshot und Scrollen - keine SSE-Instanz)\n");
  }

  // --- Sicherheitssperre: MUSS scheitern ---------------------------------
  // Jeder dieser Faelle stammt aus einem Review-Befund. Sie bleiben stehen,
  // damit die Sperre nicht unbemerkt wieder aufgeht.
  for (const name of [
    "ELSTER",
    "Anmeldungen versenden",
    "Senden",
    "Jahreserklärungen abschließen…",          // Auslassungspunkte
    "Elektronische Steuererklärung (ELSTER)…", // Menueeintrag
    "Belege nachreichen...",                   // drei Punkte
    "Versand per ELSTER",                      // Umschreibung
    "&Senden",                                 // Zugriffstasten-Markierung
    "Steuerdaten übermitteln",
  ]) {
    await check(client, "sse_click", { name }, mustError("GESPERRT"));
  }
  await check(client, "sse_click", { aid: "tb_elster" }, mustError("GESPERRT"));
  await check(client, "sse_click", { name: "Prüfer", pattern: "toggle" }, (res) => ({
    ok: res.isError === true,
    why: "gesperrtes Legacy-TogglePattern muss am MCP-Schema scheitern",
  }));
  await check(client, "sse_click", { name: "Ja", pattern: "select" }, mustError("exakte AutomationId"));
  // Derselbe Schutz muss beim echten Mausklick gelten.
  await check(client, "sse_click_point", { name: "Anmeldungen versenden" }, mustError("GESPERRT"));
  // Ohne Bezeichner darf nicht geklickt werden.
  await check(client, "sse_click_point", {}, mustError("Bezeichner"));
  await check(client, "sse_close", { hwnd: 1, force: true, save: true }, mustError("unvereinbar"));
  await check(client, "sse_close", { hwnd: 1, force: true }, mustError("discardChanges=true"));
  await check(client, "sse_close", { hwnd: 1, save: true }, mustError("sse_save"));
  await check(client, "sse_desktop_stop", { save: true }, mustError("sse_save"));

  // --- Navigation (veraendert nur die Ansicht) --------------------------
  if (sseRunning) {
    await check(client, "sse_click", { name: "Weiter" }, okIf((t) => t.includes("clicked"), "nicht geklickt"));
    await check(client, "sse_read_page", {}, okIf((t) => t.includes("heading"), "keine Ueberschrift"));
    await check(client, "sse_click", { name: "Zurück" }, okIf((t) => t.includes("clicked"), "nicht geklickt"));
  } else {
    process.stdout.write("\n(uebersprungen: Vor-/Zurueck-Navigation - keine SSE-Instanz)\n");
  }
  await check(
    client,
    "sse_warning_popup_read",
    {},
    okIf((t) => t.includes('"active"') && t.includes('"warnings"'), "Pruefhinweisstatus fehlt"),
  );

  // --- Sicherung --------------------------------------------------------
  if (WRITE) {
    await check(
      client,
      "sse_backup_cases",
      { dest: join(process.env.TEMP ?? ".", `sse-smoke-backup-${Date.now()}`) },
      okIf((t) => t.includes("dest"), "kein Zielordner"),
    );
  } else {
    process.stdout.write("\n(uebersprungen: sse_backup_cases — mit --write aktivieren)\n");
  }

  if (RESTART) {
    const instancesResult = await check(
      client,
      "sse_instances",
      {},
      okIf((text) => text.includes('"instances"'), "keine Instanzliste"),
    );
    let restartInstance = null;
    try {
      const parsed = JSON.parse(fullText(instancesResult));
      if (Array.isArray(parsed.instances) && parsed.instances.length === 1) restartInstance = parsed.instances[0];
    } catch { /* wird unten als unsichere Bindung gemeldet */ }
    if (restartInstance?.hwnd && restartInstance?.pid) {
      await check(client, "sse_close", {
        hwnd: restartInstance.hwnd,
        pid: restartInstance.pid,
        force: true,
        discardChanges: true,
      }, okIf(() => true, ""));
      await check(client, "sse_launch", { mode: "einur" }, okIf(() => true, ""));
    } else {
      fail++;
      failures.push("sse_close: --restart verlangt genau eine frisch gebundene SSE-Instanz mit hwnd/pid.");
    }
  } else {
    process.stdout.write("(uebersprungen: sse_close, sse_launch — mit --restart aktivieren)\n");
  }

  await client.close();

  process.stdout.write(`\n${"=".repeat(60)}\nBestanden: ${pass}   Fehlgeschlagen: ${fail}\n`);
  if (failures.length) {
    process.stdout.write("Fehler:\n" + failures.map((f) => `  - ${f}`).join("\n") + "\n");
  }
  process.exit(fail ? 1 : 0);
};

main().catch((e) => {
  process.stderr.write(`Rauchtest abgebrochen: ${e?.stack ?? e}\n`);
  process.exit(2);
});
