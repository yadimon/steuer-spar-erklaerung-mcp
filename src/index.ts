#!/usr/bin/env node
/**
 * MCP-Server fuer die SteuerSparErklaerung (Akademische Arbeitsgemeinschaft).
 *
 * Steuert das Windows-Programm ueber UI Automation. Die Werkzeugbeschreibungen
 * enthalten bewusst die wichtigsten Betriebsregeln, damit ein Agent sie auch
 * ohne den begleitenden Skill richtig anwendet.
 *
 * HARTE GRENZE: Dieser Server uebermittelt NIEMALS etwas ans Finanzamt.
 * Alle ELSTER-/Versandwege sind gesperrt (siehe sse-worker.ps1, $VERSAND).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { callApiOperation, asArray, ApiClientError } from "./api-client.js";
import { SSE_MCP_TOOL_SCHEMAS } from "./operation-catalog.js";
const server = new McpServer({
  name: "steuer-spar-erklaerung",
  version: "0.1.0",
});

/**
 * Der MCP-SDK-Pfad fuer ein rohes Zod-Shape erzeugt zwar JSON Schema mit
 * additionalProperties=false, entfernt unbekannte Argumente zur Laufzeit aber
 * still. Bei optionalen Zielargumenten koennte dadurch eine andere Default-
 * Aktion ausgefuehrt werden. Ein echtes strict object haelt Katalog und
 * Laufzeitverhalten deckungsgleich und weist jeden unbekannten Parameter ab.
 */
function registerStrictTool<Shape extends z.ZodRawShape>(
  name: string,
  config: { title?: string; description?: string; inputSchema: Shape },
  callback: (args: z.infer<z.ZodObject<Shape>>) => CallToolResult | Promise<CallToolResult>,
) {
  return server.registerTool(
    name,
    { ...config, inputSchema: z.object(config.inputSchema).strict() },
    callback,
  );
}

/* ------------------------------------------------------------------ Hilfen */

type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

const LOCAL_PATH_REDACTION = "[Lokaler PC-Pfad von der MCP-Ausgabe entfernt.]";
const WINDOWS_LOCAL_PATH = /(^|[^A-Za-z0-9:/])((?:[A-Za-z]:[\\/]|\\\\(?:\?\\)?)[^;,\)\]\}"'<>|\r\n]*)/g;

function redactLocalPathText(value: string): string {
  return value.replace(WINDOWS_LOCAL_PATH, (_match, prefix: string) =>
    `${prefix}${LOCAL_PATH_REDACTION}`);
}

function redactPcLocalPaths(value: unknown): unknown {
  if (typeof value === "string") return redactLocalPathText(value);
  if (Array.isArray(value)) return value.map(redactPcLocalPaths);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry], index) => [
      redactLocalPathText(key) === key ? key : `lokalerPfadEntfernt${index + 1}`,
      redactPcLocalPaths(entry),
    ]),
  );
}

function textResult(value: unknown, extra: Content[] = []) {
  const redacted = redactPcLocalPaths(value);
  const text = typeof redacted === "string" ? redacted : JSON.stringify(redacted, null, 2);
  return { content: [{ type: "text" as const, text }, ...extra] };
}

function errorResult(message: string) {
  return { ...textResult(message), isError: true };
}

/** Ruft den Arbeiter und uebersetzt Fehler in lesbare MCP-Antworten. */
async function run(
  op: string,
  args: Record<string, unknown> = {},
  shape?: (r: Record<string, unknown>) => unknown,
  timeoutMs?: number,
) {
  try {
    const r = await callApiOperation(op, args, timeoutMs);
    if (r.ok === false) {
      if (
        r.kind === "postcondition-failed" ||
        r.kind === "inventory-mismatch" ||
        r.kind === "interference" ||
        r.kind === "obstructed" ||
        r.kind === "navigation-blocked" ||
        r.kind === "collection-incomplete" ||
        r.kind === "verification-source-incomplete" ||
        r.kind === "verification-source-changed"
      ) {
        // Bei einer fehlgeschlagenen Nachbedingung, Bestandsbindung oder
        // Fremdinteraktion sind Readback-, Guard-, Rollback- und Differenzfelder
        // sicherheitskritisch. Sie duerfen nicht in einer generischen
        // Fehlermeldung verloren gehen.
        return { ...textResult(r), isError: true };
      }
      const hint =
        r.kind === "degraded"
          ? "\n\nHinweis: Zuerst sse_dialog_list pruefen. Ein modaler Dialog kann die UIA-Antwort kuenstlich verlangsamen; ihn gezielt beantworten und nicht durch Schliessen verwerfen. Nur ohne Dialog sse_health und einen bewussten Neustart erwägen."
          : r.kind === "not-found"
            ? "\n\nHinweis: Bei traegem Programm kann 'nicht gefunden' eine Falschmeldung sein. Erst sse_health pruefen."
            : r.kind === "blocked" && ["click", "click_point", "keys", "menu_click"].includes(op)
              ? "\n\nDas ist beabsichtigt: Dieser Server uebermittelt nichts ans Finanzamt."
              : "";
      return errorResult(`${r.error ?? "Unbekannter Fehler"}${hint}`);
    }
    return textResult(shape ? shape(r) : r);
  } catch (e) {
    const msg = e instanceof ApiClientError ? e.message : String(e);
    return errorResult(msg);
  }
}

/* ------------------------------------------------------------- Diagnose */

registerStrictTool(
  "sse_product_info",
  {
    title: "SSE-2025-Produktgrenze pruefen",
    description:
      "Liest die erwartete Steuerjahres-/Engine-Identitaet, prueft die installierte Standarddatei und listet " +
      "laufende verifizierte bzw. ignorierte SSE-Versionen. Dieser MCP steuert ausschliesslich " +
      "SteuerSparErklaerung 2025 (Engine-Hauptversion 31); andere Jahresversionen werden niemals angefasst.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_product_info.shape,
  },
  async () => run("product_info", {}),
);

registerStrictTool(
  "sse_page_objects",
  {
    title: "Bekannte SSE-Seiten und Felder lesen",
    description:
      "Liest den versionierten Page-Object-Katalog mit stabilen Seiten-, Fenster- und Feld-IDs. " +
      "Der Katalog enthaelt ausschliesslich oeffentliche UI-Metadaten, niemals Steuerfallwerte, Namen, " +
      "Steuer-IDs oder Dateipfade. Ohne pageId wird der ganze Katalog geliefert.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_page_objects.shape,
  },
  async (a) => {
    return run("page_objects", a);
  },
);

registerStrictTool(
  "sse_page_state",
  {
    title: "Bekannte Seite schnell und versionsfest lesen",
    description:
      "Liest eine katalogisierte Seite ueber exakte relative AutomationIds statt einer freien Volltextsuche. " +
      "Liefert aktuelle Feldwerte, Fenster-/Dialogstatus und eine kurzlebige state epoch. Diese Epoche kann " +
      "sse_change_known_field als Vorbedingung erhalten; jede zwischenzeitliche Seite-, Scroll-, Feld- oder " +
      "Dirty-State-Aenderung bricht dann vor dem Schreiben ab. Werte werden nicht im Katalog oder auf Platte gespeichert.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_page_state.shape,
  },
  async (a) => run("known_page_state", a),
);

registerStrictTool(
  "sse_workspace_status",
  {
    title: "Portablen SSE-Arbeitsbereich pruefen",
    description:
      "Prueft ueber die API, ob Arbeits-/Ergebnisbereich, Fallordner und optionaler SSE-Programmpfad " +
      "eingerichtet sind. Liefert bewusst keine lokalen PC-Pfade; der MCP kennt nur API-URL und Token.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_workspace_status.shape,
  },
  async () => run("workspace_status", {}),
);

registerStrictTool(
  "sse_workspace_files",
  {
    title: "SSE-Arbeitsdateien auflisten",
    description:
      "Listet maschinenneutrale Dateireferenzen, Groesse und SHA256 in einem konfigurierten API-Ressourcenbereich. " +
      "Absolute Pfade, Pfadwechsel und symbolische Links aus dem Arbeitsbereich heraus sind gesperrt.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_workspace_files.shape,
  },
  async (a) => run("workspace_file_list", a),
);

registerStrictTool(
  "sse_workspace_read_text",
  {
    title: "SSE-Textdatei lesen",
    description:
      "Liest hoechstens 1 MiB UTF-8-Text aus einer maschinenneutralen Ressourcenreferenz und liefert SHA256. " +
      "Greift nie ueber einen frei angegebenen PC-Pfad zu. Enthaltene lokale Pfade werden sichtbar redigiert; " +
      "textRedigiert=true sperrt einen unveraenderten Schreib-Roundtrip.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_workspace_read_text.shape,
  },
  async (a) => run("workspace_file_read_text", a, (r) => {
    const originalText = typeof r.text === "string" ? r.text : "";
    const text = redactLocalPathText(originalText);
    return {
      ...r,
      text,
      textRedigiert: text !== originalText,
      ...(text !== originalText
        ? { redaktionsHinweis: "Lokale PC-Pfade wurden entfernt; diesen Text nicht unveraendert zurueckschreiben." }
        : {}),
    };
  }),
);

registerStrictTool(
  "sse_workspace_write_text",
  {
    title: "SSE-Textdatei sicher schreiben",
    description:
      "Schreibt hoechstens 1 MiB UTF-8-Text in eine relative Dateireferenz. Neue Ziele muessen fehlen; " +
      "vorhandene Ziele verlangen ihren unmittelbar zuvor gelesenen expectedSha256. Pfadwechsel sind gesperrt. " +
      "Der sichtbare Redaktionsplatzhalter aus sse_workspace_read_text wird nie geschrieben.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_workspace_write_text.shape,
  },
  async (a) => {
    if (a.text.includes(LOCAL_PATH_REDACTION)) {
      return errorResult(
        "Schreiben gesperrt: Der Text enthaelt den Redaktionsplatzhalter eines lokalen PC-Pfads. " +
        "Originalquelle gezielt neu lesen oder den Inhalt bewusst ohne Platzhalter rekonstruieren.",
      );
    }
    return run("workspace_file_write_text", a);
  },
);

registerStrictTool(
  "sse_run_scenario",
  {
    title: "SSE-Szenario reproduzierbar ausfuehren",
    description:
      "Fuehrt eine versionierte JSON-Szenariodatei aus dem API-Arbeitsbereich seriell aus. Argumente koennen " +
      "aus relativen UTF-8-/JSON-Eingabedateien kommen. Das kanonische Ergebnis wird im API-Ergebnisbereich " +
      "geschrieben und mit SHA256 geliefert; direkter API-Aufruf und dieser MCP-Wrapper nutzen denselben Codepfad.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_run_scenario.shape,
  },
  async (a) => run("scenario_run", a, undefined, 300_000),
);

registerStrictTool(
  "sse_health",
  {
    title: "Zustand pruefen",
    description:
      "Prueft, ob die SteuerSparErklaerung laeuft und ansprechbar ist. Misst einen 'Kanarienvogel' " +
      "(billigste UIA-Abfrage). Dauert der laenger als ~1,5 s, ist das Programm ueberlastet und JEDES " +
      "weitere Ergebnis waere unzuverlaessig. Ein offener modaler Dialog kann dieselbe Verzoegerung " +
      "verursachen und wird deshalb separat gemeldet; dann Dialog lesen statt neu starten. IMMER zuerst aufrufen, wenn eine " +
      "vorherige Antwort unerwartet leer war.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_health.shape,
  },
  async () => run("health", {}, (r) => ({ ...r, windows: asArray(r.windows) })),
);

registerStrictTool(
  "sse_windows",
  {
    title: "Fenster auflisten",
    description:
      "Listet alle sichtbaren Fenster der verifizierten SSE 2025 oder des SteuertippsCenters samt " +
      "Groesse und Haenge-Status. Freie Prozessnamen und Wildcards sind gesperrt. Nuetzlich, um modale " +
      "Dialoge zu erkennen (z. B. die Rueckfrage nach einer Wiederherstellungsdatei beim Start).",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_windows.shape,
  },
  async (a) => run("windows", a, (r) => ({ windows: asArray(r.windows) })),
);

registerStrictTool(
  "sse_center_cases",
  {
    title: "Fallliste im Steuertipps-Center lesen",
    description:
      "Liest den Hauptbildschirm des Steuertipps-Centers im Modus 'Verzeichnis': aktiven Ordner, " +
      "Such-/Sortierzustand und die dort angebotenen Steuerfaelle. Die UIA-Liste wird read-only mit " +
      "den primaeren ESt-/Gew-Falldateien im angezeigten Ordner verglichen; Backup-, Protokoll- und " +
      "GewErfass-Dateien werden nicht als Center-Faelle ausgegeben. Aendert, oeffnet oder loescht nichts.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_center_cases.shape,
  },
  async (a) => run("center_cases", a, (r) => {
    const { verzeichnis, ...rest } = r;
    const verzeichnisRef = typeof verzeichnis === "string" && verzeichnis.startsWith("cases:")
      ? verzeichnis
      : null;
    return {
      ...rest,
      verzeichnisRef,
      verzeichnisImFallbereich: verzeichnisRef !== null,
      ...(verzeichnisRef === null
        ? { verzeichnisHinweis: "Das Center zeigt einen Ordner ausserhalb des konfigurierten Fallbereichs; zuerst den Center-Ordner korrigieren." }
        : {}),
      faelle: asArray(r.faelle),
      dateisystemFaelle: asArray(r.dateisystemFaelle),
      nurImCenter: asArray(r.nurImCenter),
      nurImDateisystem: asArray(r.nurImDateisystem),
    };
  }),
);

registerStrictTool(
  "sse_center_refresh",
  {
    title: "Fallliste im Steuertipps-Center aktualisieren",
    description:
      "Aktualisiert ausschliesslich die Ansicht der fingerprintgebundenen Center-Fallliste, indem kurz " +
      "'Zuletzt verwendet' und danach wieder 'Verzeichnis' aktiviert werden. Exaktes Fenster und erwarteter " +
      "Ordnerreferenz aus sse_center_cases sind Pflicht; danach werden Ordner, Filterzustand und Fallnamen zurueckgelesen. Es wird kein " +
      "Steuerfall geoeffnet, gespeichert, verschoben oder geloescht.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_center_refresh.shape,
  },
  async (a) => run("center_refresh", a, (r) => {
    const { verzeichnis, ...rest } = r;
    return {
      ...rest,
      verzeichnisRef: verzeichnis,
      vorher: asArray(r.vorher),
      nachher: asArray(r.nachher),
    };
  }),
);

registerStrictTool(
  "sse_window_close",
  {
    title: "Nebenfenster sicher schliessen",
    description:
      "Schliesst genau ein nicht-modales SSE-Nebenfenster, etwa Steuerberechnung oder Druckvorschau. " +
      "Fenster-ID und der von sse_windows gelieferte Titel-Fingerprint sind Pflicht und werden unmittelbar vor WM_CLOSE erneut geprueft. " +
      "Hauptfenster und modale Dialoge sind gesperrt; dafuer sse_close bzw. sse_dialog_answer verwenden.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_window_close.shape,
  },
  async (a) => run("window_close", a),
);

registerStrictTool(
  "sse_case_hash",
  {
    title: "Steuerfall pruefen und hashen",
    description:
      "Liest eine Falldatei ohne die SteuerSparErklaerung zu oeffnen. Liefert SHA256, Groesse, " +
      "Aenderungszeit, zentrale Kopffelder und den ELSTER-Uebermittlungsstatus. Read-only; dient als " +
      "Vorbedingung fuer sse_save, sse_save_as und sse_make_working_copy.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_case_hash.shape,
  },
  async (a) => run("case_hash", a),
);

registerStrictTool(
  "sse_dialog_list",
  {
    title: "Dialoge sicher lesen",
    description:
      "Listet alle SSE-Fenster, klassifiziert native und Qt-Dialoge und liefert Texte, erlaubte " +
      "Antwortschaltflaechen sowie einen SHA256-Fingerprint. Den Fingerprint unveraendert an " +
      "sse_dialog_answer geben; er verhindert, dass versehentlich ein inzwischen ausgetauschter Dialog beantwortet wird.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_dialog_list.shape,
  },
  async () => run("dialog_list", {}),
);

registerStrictTool(
  "sse_dialog_answer",
  {
    title: "Dialog sicher beantworten",
    description:
      "Beantwortet genau einen zuvor gelesenen Dialog. hwnd, Fingerprint und eine eng begrenzte " +
      "Antwort sind Pflicht. Vor dem Klick wird der Fingerprint erneut berechnet und der gesamte " +
      "Dialog auf ELSTER-/Uebermittlungsbezug geprueft. Neu erscheinende Folgedialoge werden nur " +
      "gemeldet und niemals automatisch beantwortet. Der Dirty-State des Hauptfalls wird vor und " +
      "nach der Antwort mitgeliefert. Automatische Pruefhinweise verlangen zusaetzlich den " +
      "bodyFingerprint; ihr OCR-Fliesstext wird unmittelbar vor der Antwort erneut gebunden. " +
      "Beim lokalen Finanzamt-CSV-Export ist nur der exakt gelesene Schalter " +
      "'Klicken Sie hier, um Ihre Daten zu exportieren' freigegeben; der folgende Ordnerdialog " +
      "bleibt ein separat zu pruefender Dialog.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_dialog_answer.shape,
  },
  async (a) => run("dialog_answer", a, undefined, 90_000),
);

registerStrictTool(
  "sse_warning_popup_read",
  {
    title: "Automatische Pruefhinweise lesen",
    description:
      "Liest das offene Qt-Fenster 'Die Pruefung hat ergeben ...' vollstaendig. Meldungstitel und " +
      "Aktionen kommen strukturiert aus UIA; nur der von Qt nicht exponierte Fliesstext wird lokal " +
      "per Windows-OCR gelesen. Liefert den Dialog-Fingerprint fuer eine spaetere bewusste Antwort " +
      "mit sse_dialog_answer. Bei mehreren Warnfenstern kann deren exakter HWND angegeben werden. " +
      "Aendert weder Steuerdaten noch den Gelesen-/Ignoriert-Status.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_warning_popup_read.shape,
  },
  async (a) => {
    try {
      const r = await callApiOperation("warning_popup_read", {
        ...(a.hwnd === undefined ? {} : { hwnd: a.hwnd }),
        ocr: a.ocr ?? true,
        includeImage: a.includeImage === true,
      }, 90_000);
      if (r.ok === false) return errorResult(String(r.error ?? "Pruefhinweis nicht lesbar"));
      const imageBase64 = String(r.bildBase64 ?? "");
      const extra: Content[] = [];
      if (a.includeImage && imageBase64) {
        extra.push({ type: "image", data: imageBase64, mimeType: "image/png" });
      }
      return textResult({
        active: r.active,
        hwnd: r.hwnd,
        pid: r.pid,
        title: r.title,
        fingerprint: r.fingerprint,
        bodyFingerprint: r.bodyFingerprint,
        warnings: asArray(r.warnings),
        actions: asArray(r.actions),
        leseweg: r.leseweg,
        ocrVerwendet: r.ocrVerwendet,
        ocrOk: r.ocrOk,
        sprache: r.sprache,
        zeilen: r.zeilen,
        text: r.text,
        ocrFehler: r.ocrFehler,
        uiaReadOk: r.uiaReadOk,
        uiaError: r.uiaError,
        msaaReadOk: r.msaaReadOk,
        msaaError: r.msaaError,
        hinweis: r.hinweis,
        kontrollbildEnthalten: extra.length > 0,
      }, extra);
    } catch (e) {
      return errorResult(e instanceof ApiClientError ? e.message : String(e));
    }
  },
);

registerStrictTool(
  "sse_vast_dialog_read",
  {
    title: "VaSt-Zuordnungen sicher lesen",
    description:
      "Liest den offiziellen Dialog 'Daten der vorausgefüllten Steuererklärung' als sieben bzw. aktuell sichtbare " +
      "Bescheinigungs-Zuordnungen. Qt exponiert die gemalten Tabellenwerte nicht stabil; deshalb werden UIA-Struktur " +
      "und lokales Windows-OCR kombiniert. Liefert einen mappingFingerprint, ungelöste Zeilen und riskante " +
      "Mehrfachzuordnungen. Read-only: klappt nichts auf, ändert keine Zuordnung und übernimmt keine Daten.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_vast_dialog_read.shape,
  },
  async (a) => run("vast_dialog_read", a, undefined, 90_000),
);

registerStrictTool(
  "sse_vast_row_details",
  {
    title: "Eine VaSt-Bescheinigung lesen",
    description:
      "Klappt genau eine durch certificate+occurrence adressierte VaSt-Zeile kurz auf, liest die FA-Werte " +
      "strukturiert mit OCR-Rückfall und stellt anschließend denselben mappingFingerprint und Aufklappzustand " +
      "wieder her. Der Qt-Baumpfeil wird gegen SSE-PID und Dialog-Root gebunden; keine Zuordnung wird geändert.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_vast_row_details.shape,
  },
  async (a) => run("vast_row_details", a, undefined, 90_000),
);

registerStrictTool(
  "sse_vast_row_set_expanded",
  {
    title: "VaSt-Zeile kontrolliert auf- oder zuklappen",
    description:
      "Ändert nur den Ansichtszustand einer exakt fingerprintgebundenen VaSt-Zeile. Vor- und Nachzustand " +
      "werden per OCR und Zeilenbindung geprüft; Zuordnungen und Steuerdaten bleiben unverändert.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_vast_row_set_expanded.shape,
  },
  async (a) => run("vast_row_set_expanded", a, undefined, 90_000),
);

registerStrictTool(
  "sse_vast_mapping_options",
  {
    title: "VaSt-Zuordnungsziele lesen",
    description:
      "Öffnet nur das Dropdown einer exakt gebundenen VaSt-Zeile, liest dessen Ziele aus dem sichtbaren " +
      "Qt-Popup und schließt es ausschließlich nach bestätigtem Popup per Escape. Kein Ziel wird ausgewählt. " +
      "mappingFingerprint und expectedCurrent verhindern Arbeit auf einem überholten Dialogzustand.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_vast_mapping_options.shape,
  },
  async (a) => run("vast_mapping_options", a, undefined, 90_000),
);

registerStrictTool(
  "sse_vast_mapping_select",
  {
    title: "Eine VaSt-Zuordnung ändern",
    description:
      "Wählt genau ein zuvor gelesenes lokales Ziel für eine FA-Bescheinigung. Bindet Dialogzustand, Zeile, " +
      "Vorwert, sichtbaren Options-Text, SSE-PID und Zielpunkt und akzeptiert danach ausschließlich einen " +
      "Ein-Zeilen-Diff. Dies ändert nur den Zuordnungsentwurf; Daten werden noch nicht in den Steuerfall übernommen.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_vast_mapping_select.shape,
  },
  async (a) => run("vast_mapping_select", a, undefined, 90_000),
);

registerStrictTool(
  "sse_vast_apply",
  {
    title: "VaSt-Zuordnungsplan übernehmen",
    description:
      "Übernimmt genau den zuvor vollständig gelesenen VaSt-Zuordnungsplan in den offenen Steuerfall. " +
      "Die Aktion ist an Mapping-Fingerprint, Hauptfenster, Fallpfad, Disk-Hash, exakte Zeilenreihenfolge und " +
      "acknowledgeApply=true gebunden. Ungelöste oder riskant doppelte Ziele werden abgewiesen. Danach müssen " +
      "Felder und Steuerberechnung separat gelesen werden. Speichert nicht und beantwortet keine Folgedialoge.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_vast_apply.shape,
  },
  async (a) => run("vast_apply", a, undefined, 90_000),
);

/* ----------------------------------------------------------------- Lesen */

registerStrictTool(
  "sse_read_full",
  {
    title: "Seite vollstaendig lesen (mit Rollen)",
    description:
      "Liest eine LANGE Seite vollstaendig: rollt den Inhaltsbereich stufenweise durch und fuegt die " +
      "Ergebnisse zusammen. Noetig, weil Qt nur den sichtbaren Ausschnitt im Elementbaum haelt - " +
      "sse_page liefert bei langen Seiten (z. B. 'Umsatzsteuererklaerung 2025') stillschweigend zu " +
      "wenig. Rollt danach wieder nach oben. Braucht weder Tastatur noch Maus, laeuft also auch auf " +
      "dem versteckten Desktop.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_read_full.shape,
  },
  async (a) => run("read_full", a, (r) => ({ ueberschrift: r.ueberschrift, gerollt: r.gerollt, stufen: r.stufen, anzahl: r.anzahl, zeilen: asArray(r.zeilen), hinweis: r.hinweis }), 240_000),
);

registerStrictTool(
  "sse_scroll_page",
  {
    title: "Inhaltsbereich rollen",
    description:
      "Rollt den Inhaltsbereich der Seite (nicht Tabellen - dafuer sse_table_read). " +
      "mode='info' meldet nur Position und sichtbaren Anteil, 'percent' setzt die Position (vPercent), " +
      "'amount' rollt seitenweise (direction up/down). Danach sse_page erneut aufrufen - erst dann " +
      "stehen die neu sichtbaren Felder im Baum. Fuer den Normalfall ist sse_read_full bequemer.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_scroll_page.shape,
  },
  async (a) => run("scroll_page", a),
);

registerStrictTool(
  "sse_help",
  {
    title: "Hilfespalte lesen",
    description:
      "Liest die rechte Spalte: Eingabehilfe, Steuertipps und Prueferhinweise zur aktuellen Seite. " +
      "Dort steht, WIE ein Feld gemeint ist und welche Betraege hineingehoeren - fuer korrektes " +
      "Ausfuellen oft wichtiger als die Feldbeschriftung. Der Inhalt wechselt mit dem angewaehlten " +
      "Feld. Braucht weder Tastatur noch Maus.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_help.shape,
  },
  async (a) => run("help", a, (r) => ({ seite: r.seite, abschnitte: r.abschnitte, hinweis: r.hinweis })),
);

registerStrictTool(
  "sse_subpages",
  {
    title: "Unterseiten auflisten",
    description:
      "Listet die weiterfuehrenden Schalter der Seite ('Erfassen', 'Bearbeiten', 'Position erfassen' ...) " +
      "samt der Beschriftung links davon - also wozu jeder fuehrt. Ueber diese Verweise liegen die " +
      "Detailangaben, die auf der Uebersichtsseite nur als Summe erscheinen. Erkennt auch die offizielle " +
      "Qt-Zeilenstruktur aus Caption, read-only Wert und unbeschriftetem Button und liefert dafuer rid/aid; " +
      "es werden keine privaten Seiten- oder Gegenstandsnamen katalogisiert. Schalter vom Typ Button sind " +
      "mit sse_click erreichbar (auch versteckt), Verweise brauchen " +
      "sse_click_point und damit den sichtbaren Modus.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_subpages.shape,
  },
  async (a) => run("subpages", a, (r) => ({ anzahl: r.anzahl, unterseiten: asArray(r.unterseiten), hinweis: r.hinweis })),
);

registerStrictTool(
  "sse_check_page",
  {
    title: "Seite pruefen",
    description:
      "Prueferlage der aktuellen Seite: Meldungen des Eingabepruefers, rot markierte Fehler im " +
      "Navigationsbaum, leere Pflicht-Auswahlfelder und der angezeigte Ergebniswert (Gewinn bzw. " +
      "Erstattung). ok ist nur true, wenn nichts beanstandet wird. " +
      "Nach JEDER Aenderung aufrufen - das Programm prueft fachlich mit und meldet z. B. fehlende " +
      "Begruendungen, die sonst erst beim Abgabeversuch auffallen.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_check_page.shape,
  },
  async (a) =>
    run("check", a, (r) => ({
      beanstandungsfrei: r.beanstandungsfrei,
      seite: r.seite,
      urteil: r.urteil,
      prueferMeldungen: asArray(r.prueferMeldungen),
      baumFehler: asArray(r.baumFehler),
      leerePflichtfelder: asArray(r.leerePflichtfelder),
      ergebnisAnzeige: r.ergebnisAnzeige,
      steuerpruefer: r.steuerpruefer,
    }), 180_000),
);

registerStrictTool(
  "sse_result_details",
  {
    title: "Steuerergebnis und Auswirkungen lesen",
    description:
      "Liest die ausklappbare Ergebnisanzeige rechts unten als strukturierte Qt-Tabelle: " +
      "Nachzahlung/Erstattung, Einkuenfte, Vorsorgeaufwendungen, Steuer, Soli, Steuersatz und " +
      "weitere konfigurierte Werte. Oeffnet bei Bedarf nur das nicht-modale Werte-Info-Fenster; " +
      "Steuerdaten werden weder geaendert noch gespeichert. 'festgehalten' ist der Vergleichsstand, " +
      "'differenz' die Auswirkung gegen diesen Stand. Fuer die Wirkung einer Eingabe vor und nach " +
      "der Aenderung lesen oder in Werte-Info bewusst einen Vergleichsstand setzen. Bei mehreren " +
      "SSE-2025-Hauptfenstern ist hwnd Pflicht; Ergebnisfenster anderer PIDs werden nie uebernommen.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_result_details.shape,
  },
  async (a) =>
    run("result_details", a, (r) => ({
      geoeffnet: r.geoeffnet,
      fenster: r.fenster,
      spalten: r.spalten,
      anzahl: r.anzahl,
      vollstaendig: r.vollstaendig,
      fingerprint: r.fingerprint,
      zeilen: asArray(r.zeilen),
      unvollstaendigeZeilen: asArray(r.unvollstaendigeZeilen),
      nichtPositionierteZellenAnzahl: r.nichtPositionierteZellenAnzahl,
      kopfVollstaendig: r.kopfVollstaendig,
      vergleichsInvariantGeprueft: r.vergleichsInvariantGeprueft,
      vergleichsInvariantFehler: asArray(r.vergleichsInvariantFehler),
      vertikalUnvollstaendig: r.vertikalUnvollstaendig,
      hinweis: r.hinweis,
    })),
);

registerStrictTool(
  "sse_checker_results",
  {
    title: "Globale Steuerpruefer-Ergebnisse lesen",
    description:
      "Liest den aktuell sicher per UIA erreichbaren Ergebnisbaum des globalen Steuerpruefers " +
      "ohne Serienklicks oder Tastaturnavigation. 'konsistent' ist nur dann wahr, wenn beide " +
      "angezeigten Gruppenzaehler vollstaendig erreicht wurden. Bei false per sse_screenshot " +
      "manuell kontrollieren; die Komfortautomatik fuer Qts zyklischen Baum ist Backlog.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_checker_results.shape,
  },
  async (a) =>
    run("checker_results", a, (r) => ({
      aktiv: r.aktiv,
      fragenWarnungenAngekuendigt: r.fragenWarnungenAngekuendigt,
      tippsAngekuendigt: r.tippsAngekuendigt,
      fragenWarnungenGruppeGesehen: r.fragenWarnungenGruppeGesehen,
      tippsGruppeGesehen: r.tippsGruppeGesehen,
      fragenWarnungen: asArray(r.fragenWarnungen),
      tippsZusatzinfos: asArray(r.tippsZusatzinfos),
      sonstige: asArray(r.sonstige),
      gesamt: r.gesamt,
      aufgeklappt: r.aufgeklappt,
      konsistent: r.konsistent,
      navigationSchritte: r.navigationSchritte,
      fokusVerwendet: r.fokusVerwendet,
      technischeFokusKarten: asArray(r.technischeFokusKarten),
      ungespeichert: r.ungespeichert,
      hinweis: r.hinweis,
    }), 180_000),
);

registerStrictTool(
  "sse_checker_run",
  {
    title: "Globalen Steuerpruefer starten",
    description:
      "Startet auf der Seite 'Steuererklaerung pruefen' den fallweiten Software-Pruefer und " +
      "liefert die sicher erreichbaren Fragen/Warnungen und Tipps samt Konsistenzstatus. " +
      "Loest weder 'Steuererklaerung abschliessen' noch ELSTER oder eine andere Abgabe aus. " +
      "Falls die Seite noch nicht offen ist, per MCP zu 'Pruefen und Abgeben' und danach " +
      "'Steuererklaerung pruefen' navigieren.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_checker_run.shape,
  },
  async (a) =>
    run("checker_run", a, (r) => ({
      gestartet: r.gestartet,
      bereitsAktiv: r.bereitsAktiv,
      fragenWarnungenAngekuendigt: r.fragenWarnungenAngekuendigt,
      tippsAngekuendigt: r.tippsAngekuendigt,
      fragenWarnungen: asArray(r.fragenWarnungen),
      tippsZusatzinfos: asArray(r.tippsZusatzinfos),
      sonstige: asArray(r.sonstige),
      gesamt: r.gesamt,
      konsistent: r.konsistent,
      navigationSchritte: r.navigationSchritte,
      fokusVerwendet: r.fokusVerwendet,
      technischeFokusKarten: asArray(r.technischeFokusKarten),
      ungespeichertVorher: r.ungespeichertVorher,
      ungespeichertNachher: r.ungespeichertNachher,
      ungespeichertEingefuehrt: r.ungespeichertEingefuehrt,
      hinweis: r.hinweis,
    }), 240_000),
);

registerStrictTool(
  "sse_checker_reset",
  {
    title: "Steuerpruefer-Detailkarten sicher schliessen",
    description:
      "Schliesst alle aufgeklappten Detailkarten im globalen Steuerpruefer von unten nach oben " +
      "mit gezielten Klicks. Es werden keine Steuerangaben geaendert. Ob der anschliessende " +
      "UIA-Snapshot beide Gruppen vollstaendig sieht, steht in 'konsistent'.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_checker_reset.shape,
  },
  async (a) =>
    run("checker_reset", a, (r) => ({
      geschlossen: asArray(r.geschlossen),
      anzahlGeschlossen: r.anzahlGeschlossen,
      konsistent: r.konsistent,
      fragenWarnungenAngekuendigt: r.fragenWarnungenAngekuendigt,
      tippsAngekuendigt: r.tippsAngekuendigt,
      fragenWarnungen: asArray(r.fragenWarnungen),
      tippsZusatzinfos: asArray(r.tippsZusatzinfos),
      sonstige: asArray(r.sonstige),
      aufgeklappt: asArray(r.aufgeklappt),
      technischeFokusKarten: asArray(r.technischeFokusKarten),
      ohneOffeneKarten: r.ohneOffeneKarten,
      ungespeichert: r.ungespeichert,
      hinweis: r.hinweis,
    }), 240_000),
);

registerStrictTool(
  "sse_checker_open",
  {
    title: "Steuerpruefer-Meldung oeffnen und lesen",
    description:
      "Oeffnet genau eine Meldung aus sse_checker_results und liest ihre aufgeklappte " +
      "Detailkarte. MCP prueft zuerst UIA-Muster, RawView und eine begrenzte MSAA-Punktabfrage. " +
      "Nur wenn Qt dort keinen Fliesstext bereitstellt, wird die exakte Kartenflaeche fotografiert, " +
      "lokal mit Windows-OCR gelesen und als Text PLUS Kontrollbild zurueckgegeben. Der exakte " +
      "Meldungstext ist Pflicht.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_checker_open.shape,
  },
  async (a) => {
    try {
      const detail = await callApiOperation("checker_open", a, 300_000);
      if (detail.ok === false) return errorResult(String(detail.error ?? "Detailkarte nicht lesbar"));
      const imageBase64 = String(detail.bildBase64 ?? "");
      const extra: Content[] = [];
      if (imageBase64) {
        extra.push({ type: "image", data: imageBase64, mimeType: "image/png" });
      }
      return textResult(
        {
          meldung: detail.meldung,
          leseweg: detail.leseweg,
          strukturiertOk: detail.strukturiertOk,
          strukturQuellen: asArray(detail.strukturQuellen),
          ocrVerwendet: detail.ocrVerwendet,
          ocrOk: detail.ocrOk,
          sprache: detail.sprache,
          zeilen: detail.zeilen,
          text: detail.text,
          ocrFehler: detail.ocrFehler,
          inAnsichtGerollt: detail.inAnsichtGerollt,
          ungespeichert: detail.ungespeichert,
          kontrollbildEnthalten: detail.kontrollbildEnthalten === true,
        },
        extra,
      );
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : String(e);
      return errorResult(msg);
    }
  },
);

registerStrictTool(
  "sse_checker_close",
  {
    title: "Steuerpruefer-Ergebnisleiste schliessen",
    description:
      "Schliesst genau die linke Ergebnisleiste des globalen Steuerpruefers über ihre offizielle Automation-ID. " +
      "Prueft danach, dass die Leiste verschwunden, die aktuelle Eingabeseite unverändert und kein neuer Dirty-State " +
      "entstanden ist. Bereits geschlossen ist ein erfolgreicher No-op.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_checker_close.shape,
  },
  async (a) => run("checker_close", a, undefined, 90_000),
);

registerStrictTool(
  "sse_desktop_start",
  {
    title: "Programm unsichtbar starten",
    description:
      "Startet die SteuerSparErklaerung auf einem EIGENEN, unsichtbaren Windows-Desktop. " +
      "Ausschliesslich SteuerSparErklaerung 2025 und dazu passende 2025-Falldateien werden akzeptiert. " +
      "Das Fenster kann dort auf dem sichtbaren Desktop nicht erscheinen - der Nutzer wird nicht " +
      "mehr unterbrochen, auch nicht beim Blaettern. (Ohne das holt sich das Programm bei JEDEM " +
      "Seitenwechsel selbst den Vordergrund; das ist Verhalten der Anwendung und laesst sich sonst " +
      "nicht abstellen.) " +
      "Danach arbeiten ALLE Werkzeuge automatisch gegen diese Instanz - nichts weiter zu beachten. " +
      "Bei eindeutig geladenem Fall liefert instance zusätzlich das feste PID/HWND für Folgeaktionen; " +
      "ready=false/blockedByDialog=true verlangt zuerst Dialog-Readback. " +
      "ACHTUNG: Der Nutzer kann dann nicht mehr hineinsehen. Bei Unklarheiten sse_screenshot und " +
      "sse_ui_state benutzen und nachfragen, statt blind weiterzuklicken. " +
      "Zum Testen eine KOPIE der Falldatei verwenden, nicht das Original.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_desktop_start.shape,
  },
  async (a) => run("desktop_start", a, (r) => ({
    desktop: r.desktop, pid: r.pid, fenster: asArray(r.fenster), instance: r.instance,
    ready: r.ready, blockedByDialog: r.blockedByDialog, dialogWindows: asArray(r.dialogWindows),
    product: r.product, case: r.case, note: r.note,
  }), 180_000),
);

registerStrictTool(
  "sse_desktop_stop",
  {
    title: "Unsichtbare Instanz beenden",
    description:
      "Beendet die Instanz auf dem versteckten Desktop und raeumt ihn auf. " +
      "Speichern gehoert vorher in den hashgebundenen Schritt sse_save; save=true ist hier gesperrt. " +
      "Ohne discardChanges=true wird kein Speicherdialog mit Nein/Verwerfen beantwortet. Der Stop verlangt Markername, " +
      "eigene SSE-PID und deren Fenster auf genau diesem Desktop. Bei unsicherem Dirty-/Dialogzustand " +
      "bleiben Prozess und Marker zur bewussten Klaerung erhalten.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_desktop_stop.shape,
  },
  async (a) => run("desktop_stop", a, undefined, 120_000),
);

registerStrictTool(
  "sse_desktop_status",
  {
    title: "Laeuft die Instanz versteckt?",
    description: "Prueft die markierte eigene PID und meldet auch eine veraltete oder unvollstaendige Desktop-Marke.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_desktop_status.shape,
  },
  async () => run("desktop_status", {}, (r) => ({
    aktiv: r.aktiv,
    desktop: r.desktop,
    pid: r.pid,
    sseLaeuft: r.sseLaeuft,
    desktopErreichbar: r.desktopErreichbar,
    markeVeraltet: r.markeVeraltet,
    fenster: asArray(r.fenster),
    note: r.note,
  })),
);

registerStrictTool(
  "sse_page",
  {
    title: "Seite vollstaendig erfassen",
    description:
      "DAS HAUPTWERKZEUG. Eine Abfrage liefert alles ueber die aktuell offene Seite: Ueberschrift, " +
      "alle beschreibbaren Felder mit Beschriftung, Wert, Typ und Schreibschutz, die Tabelle mit " +
      "Kopfzeile und sichtbaren Zeilen samt der ersten freien Zeile zum Eintragen, alle ausloesbaren " +
      "Aktionen (mit Angabe, ob sse_click oder sse_click_point noetig ist und ob sie gesperrt sind), " +
      "sowie den Sperrzustand mit Pruefermeldungen. " +
      "Damit braucht man im Regelfall weder Bildschirmfoto noch sse_snapshot. " +
      "Jedes Feld nennt seine 'rid' - fachliche Aenderungen laufen damit ueber die gebundenen Feld- oder Tabellenwerkzeuge.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_page.shape,
  },
  async (a) =>
    run("page", a, (r) => ({
      ueberschrift: r.ueberschrift,
      blockiert: r.blockiert,
      prueferMeldungen: asArray(r.prueferMeldungen),
      leerePflichtfelder: asArray(r.leerePflichtfelder),
      felder: asArray(r.felder),
      tabelle: r.tabelle,
      aktionen: asArray(r.aktionen),
      offeneFenster: r.offeneFenster,
    })),
);

registerStrictTool(
  "sse_positions",
  {
    title: "Positionen auflisten",
    description:
      "Listet die auf der aktuellen Uebersichtsseite sichtbaren Einnahmen-/Ausgabenpositionen. " +
      "Anlegen und Loeschen sind fail-closed gesperrt, solange dafuer kein eigener Seiten-, Feld-, " +
      "Summen- und Dialogvertrag mit Readback/Rollback existiert. Struktur vorerst manuell anlegen; " +
      "Werte danach nur ueber die gebundenen Feld- und Tabellenwerkzeuge schreiben.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_positions.shape,
  },
  async (a) => run("positions", a),
);

registerStrictTool(
  "sse_export_csv",
  {
    title: "CSV-Export ausloesen",
    description:
      "Loest 'Datei > Export fuer das Finanzamt (CSV-Dateien)' aus. Zweiter, vom Bildschirm " +
      "UNABHAENGIGER Pruefweg: die exportierten Zahlen lassen sich ohne UI-Automation gegen eine " +
      "eigene Aufstellung halten - eine echte Gegenprobe zu sse_collect, die dieselbe Quelle liest. " +
      "Das Werkzeug wartet auf den Exportdialog und gibt dessen HWND, erlaubte Schalter und Fingerprint " +
      "direkt zurueck. Diesen bewusst per sse_dialog_answer beantworten; ein danach geoeffneter " +
      "Ordnerdialog wird als eigener fingerprintgebundener Folgedialog behandelt. " +
      "Ein neuer resultRef-Unterordner wird von der API sicher angelegt und kann danach im Ordnerdialog verwendet werden. " +
      "Dies ist KEIN Versand ans Finanzamt, sondern eine lokale Datei.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_export_csv.shape,
  },
  async (a) => run("export_csv", a, undefined, 120_000),
);

registerStrictTool(
  "sse_collect",
  {
    title: "Erklaerung segmentweise erfassen",
    description:
      "Kontrollierter, auf hoechstens 5 Seiten begrenzter Diagnose-Snapshot ab der aktuellen Seite. Erfasst pro Seite die sichtbaren beschrifteten " +
      "Felder, berechneten Summen und Tabellenzeilen und blaettert per UIA weiter. Vor jedem weiteren Schritt " +
      "werden Dialoge, Seitenscheinerfolg, Zyklus und - im sichtbaren Modus - fremde Benutzereingabe geprueft. " +
      "Bei einer Blockade kommt collection-incomplete mit fortsetzbarem Teilstand statt eines falschen " +
      "Gesamterfolgs; einen hinter einem Pruefhinweis wartenden Klick niemals wiederholen. Fuer weitere Seiten " +
      "mit einem neuen hashgebundenen Segment fortsetzen. Speicherzuwachs und UIA-Kanarienzustand werden auf jeder Seite geprueft. " +
      "Fuer den Live-Dialog direkte Page-Object-/Tree-Spruenge verwenden. Lange Seiten und " +
      "virtualisierte Tabellen brauchen weiterhin sse_read_full/sse_table_read als gezielte Vollstaendigkeitsprobe. " +
      "Mit resultRef wird ein privates JSON-Artefakt im konfigurierten Ergebnisbereich geschrieben; bestehende Ziele duerfen nur " +
      "mit passendem expectedOutputHashBefore ersetzt werden.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_collect.shape,
  },
  async (a) => run("collect", a, (r) => ({
    vollstaendig: r.vollstaendig,
    stopKind: r.stopKind,
    stopReason: r.stopReason,
    anzahl: r.anzahl,
    datei: r.datei,
    dateiHash: r.dateiHash,
    ueberschriften: asArray(r.ueberschriften),
    seiten: r.seiten,
  }), 90_000),
);

registerStrictTool(
  "sse_verify",
  {
    title: "Sollwerte abgleichen",
    description:
      "Vergleicht erwartete Werte gegen einen exakt SHA256-gebundenen sse_collect-JSON-Stand und meldet " +
      "jede Abweichung mit Soll, Ist und Differenz. Zahlen werden centgenau verglichen. Exakte Seiten-/" +
      "Feldnamen haben Vorrang; ein Teilstring darf niemals still den ersten von mehreren Treffern waehlen. " +
      "Mehrdeutigkeiten werden mit Kandidaten gemeldet und koennen bewusst 1-basiert ueber seiteOccurrence/" +
      "labelOccurrence aufgeloest werden. Unvollstaendige oder alte Quellen ohne Vollstaendigkeitsnachweis " +
      "sind standardmaessig gesperrt. allowIncompleteSource prueft nur den ausdruecklich begrenzten Teilstand " +
      "und liefert keine Gesamtaussage zur Erklaerung.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_verify.shape,
  },
  async (a) => run("verify", a, (r) => ({
    vergleichOk: r.vergleichOk,
    sourceHash: r.sourceHash,
    sourceVollstaendig: r.sourceVollstaendig,
    sourceStopKind: r.sourceStopKind,
    zusammenfassung: r.zusammenfassung,
    geprueft: r.geprueft,
    abweichungen: r.abweichungen,
    ergebnis: asArray(r.ergebnis),
  }), 120_000),
);

registerStrictTool(
  "sse_tree_top",
  {
    title: "Navigationsbaum nach oben rollen",
    description:
      "Rollt den virtualisierten Qt-Navigationsbaum per sicher positioniertem Mausrad an den Anfang. " +
      "Noetig, weil der Baum kein UIA-ScrollPattern anbietet und weiter oben liegende Knoten sonst nicht " +
      "adressierbar sind. Aktiviert keinen Knoten und aendert keine Steuerdaten. Holt das Fenster kurz nach vorn.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_tree_top.shape,
  },
  async (a) => run("tree_top", a),
);

registerStrictTool(
  "sse_tree_scroll",
  {
    title: "Navigationsbaum kontrolliert rollen",
    description:
      "Rollt den virtualisierten Qt-Navigationsbaum nach oben oder unten, ohne einen Knoten zu aktivieren. " +
      "Noetig fuer weiter unten liegende Bereiche, die nach sse_tree_top noch nicht im UIA-Baum existieren. " +
      "Der Mausradpunkt wird gegen SSE-PID und exaktes Hauptfenster-Root verifiziert; danach mit sse_click_point den exakt gelesenen " +
      "TreeItem anklicken. Holt das Fenster kurz nach vorn.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_tree_scroll.shape,
  },
  async (a) => run("tree_scroll", a),
);

registerStrictTool(
  "sse_goto",
  {
    title: "Seite ansteuern",
    description:
      "Navigiert zu einer Eingabeseite ueber deren Ueberschrift. Versucht zuerst die globale Suche " +
      "und blaettert danach mit den fokusfreien UIA-Schaltflaechen 'Weiter'/'Zurueck'. " +
      "Qt-Suchtreffer lassen sich auf einem versteckten Windows-Desktop zwar lesen, aber je nach " +
      "Programmseite nicht aktivieren; dann faellt das Werkzeug auf den Blaetterpfad zurueck. Bei " +
      "einem blockierenden Pruefhinweis stoppt es nach dem ersten Klick, statt Warnfenster zu stapeln, und " +
      "meldet den vollstaendigen Weg statt einen Scheinerfolg. Fuer einen rein linearen Lauf kann " +
      "useSearch=false gesetzt werden. Ein Navigationsbaum-Klick braucht den sichtbaren Desktop. " +
      "'Gewinnermittlung beginnen' bleibt eine bekannte Sackgasse ohne Vor-/Zurueck-Schalter.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_goto.shape,
  },
  async (a) =>
    run(
      "goto",
      { ...a, ziel: a.name, viaSuche: a.useSearch },
      (r) => ({ erreicht: r.erreicht, ueberschrift: r.ueberschrift, schritte: r.schritte, weg: asArray(r.weg), hinweis: r.hinweis }),
      300_000,
    ),
);

registerStrictTool(
  "sse_table_read",
  {
    title: "Tabelle vollstaendig lesen",
    description:
      "Liest eine Eingabetabelle VOLLSTAENDIG - im Gegensatz zu sse_read_table, das nur die sichtbaren " +
      "Zeilen liefert. Qt virtualisiert Tabellen: nur was auf dem Schirm ist, steht im Elementbaum, " +
      "es gibt keinen scrollbaren Container und Bild-ab wirkt nicht. Dieses Werkzeug klickt in die " +
      "Tabelle, springt zuerst an den Tabellenanfang und wandert mit der Pfeiltaste durch die Zeilen, bis nichts Neues mehr kommt. " +
      "Auf Seiten mit mehreren Eingabetabellen binden sumLabel und sumOccurrence den Lauf an genau die " +
      "zugehoerige Summenregion; ohne diese Bindung wird nichts fokussiert und vollstaendig=false gemeldet. " +
      "Nicht-modale Werte-Info-Tabellen werden aus dem Eingabeformular ausgeschlossen. " +
      "ACHTUNG: holt das Fenster dafuer kurz nach vorn. " +
      "Das Feld 'vollstaendig' sagt, ob das gelungen ist. Immer gegen die Summenzeile der Seite pruefen.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_table_read.shape,
  },
  async (a) => run("table_read", a, (r) => ({
    kopf: asArray(r.kopf),
    anzahl: r.anzahl,
    vollstaendig: r.vollstaendig,
    tabelleAnzahl: r.tabelleAnzahl,
    bindung: r.bindung,
    ungespeichertVorher: r.ungespeichertVorher,
    ungespeichertNachher: r.ungespeichertNachher,
    ungespeichertEingefuehrt: r.ungespeichertEingefuehrt,
    hinweis: r.hinweis,
    zeilen: asArray(r.zeilen),
  }), 300_000),
);

registerStrictTool(
  "sse_table_add",
  {
    title: "Tabellenzeile anlegen",
    description:
      "Legt eine neue Tabellenzeile als gepruefte Transaktion an. Exakte Seite sowie Seitensumme vor und " +
      "nach der Aktion sind Pflicht. Die freie Zielzeile wird geometrisch an genau diese Summenzeile und " +
      "die davorliegende Summengrenze gebunden; auf Seiten mit mehreren Tabellen kann daher nicht die " +
      "Leerzeile eines anderen Abschnitts gewaehlt werden. Alle Zielzellen werden vorab auf ValuePattern geprueft, nach jeder " +
      "Eingabe rueckgelesen und die Nachsumme kontrolliert. Bei einer normalen Nachbedingungsabweichung " +
      "werden alle eigenen Zellwerte rueckwaerts wiederhergestellt und die Ausgangssumme bestaetigt. " +
      "Bei fremder Eingabe oder veraenderter Fensterlage gibt es keinen blinden Rollback, sondern einen " +
      "strukturierten Interference-Stopp. " +
      "Ist die Leerzeile virtualisiert, wird sie vom Tabellenende aus rein navigierend gesucht. " +
      "'werte' ist eine Liste in SPALTENREIHENFOLGE (meist: Nr., Datum, Bezeichnung, ..., Betrag); " +
      "leere Eintraege werden uebersprungen. " +
      "AENDERT STEUERDATEN: vorher sse_backup_cases. Betraege deutsch mit Komma ('2.340,00').",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_table_add.shape,
  },
  async (a) => run("table_add", a, undefined, 300_000),
);

registerStrictTool(
  "sse_table_update",
  {
    title: "Sichtbare Tabellenzeile sicher aktualisieren",
    description:
      "Aktualisiert eine eindeutig ueber einen vorhandenen Zelltext gefundene, sichtbare Tabellenzeile " +
      "ueber Qt-ValuePattern sowie fuer boolesche Tabellenzellen ueber TogglePattern und funktioniert " +
      "deshalb auch auf dem versteckten Desktop. " +
      "'werte' folgt der sichtbaren Spaltenreihenfolge; null laesst eine Spalte unveraendert, ein leerer " +
      "String leert sie und 'true'/'false' setzt eine echte Toggle-Zelle. Exakte Seite sowie Seitensumme " +
      "vorher und nachher sind Pflicht; die Zielzeile " +
      "wird auf die zu dieser Summe gehoerende Tabellenregion begrenzt. Bei einer normalen Abweichung " +
      "setzt das Werkzeug alle eigenen Zellwerte transaktional zurueck. Fremde Eingabe, ein fremder " +
      "Zellwert oder eine veraenderte Fenster-/Seitenlage stoppt ohne blinden Rollback. " +
      "AENDERT STEUERDATEN: vorher sse_backup_cases, danach sse_page/sse_check_page und hashgebunden speichern.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_table_update.shape,
  },
  async (a) => run("table_update", a, undefined, 300_000),
);

registerStrictTool(
  "sse_table_delete",
  {
    title: "Tabellenzeile loeschen",
    description:
      "Loescht genau eine Tabellenzeile. Aus Sicherheitsgruenden sind eine eindeutige Zielzelle sowie " +
      "die exakte Seite und erwartete Seitensumme vor und nach der Loeschung Pflicht. Zielsuche und " +
      "Navigation bleiben geometrisch auf die angegebene Summenregion begrenzt. Vor dem Loeschen wird eine alte " +
      "Mehrfachauswahl exklusiv auf die Zielzeile reduziert und geprueft. Virtualisierte, aktuell nicht " +
      "sichtbare Zeilen werden vom Tabellenanfang aus rein navigierend gesucht. Weicht die Nachsumme ab, " +
      "wird nur ohne fremde Eingabe/Fensterwechsel Strg+Z ausgefuehrt und die Wiederherstellung kontrolliert; " +
      "nach Interferenz bleibt der Zustand zur bewussten Neusynchronisierung unangetastet. Ein verdeckter " +
      "Zielpunkt bricht vor der Mutation ab und meldet den Blockierer als lockscreen-shell, foreign-app oder " +
      "other-sse-window. " +
      "AENDERT STEUERDATEN: vorher sse_backup_cases. Holt das Fenster kurz nach vorn.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_table_delete.shape,
  },
  async (a) => run("table_delete", a, undefined, 300_000),
);

registerStrictTool(
  "sse_menu",
  {
    title: "Menue oeffnen und lesen",
    description:
      "Ohne name: listet die Menuezeile (Datei, Bearbeiten, Ansicht, Extras, Musterbriefe, Service, ?). " +
      "Mit name: oeffnet das Menue und liefert seine Eintraege samt Aktivierungszustand und " +
      "Sperrkennzeichen. Ueber die Menuezeile erreicht man Optionen, Datenuebernahme, Steuerrechner " +
      "und Druckfunktionen - sonst waeren sie unerreichbar. " +
      "Menues mit Uebermittlungsbezug sind gesperrt. Sicher schliessen mit sse_menu_close.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_menu.shape,
  },
  async (a) => run("menu", a, (r) => ({ menue: r.menue, menues: asArray(r.menues), eintraege: asArray(r.eintraege), hinweis: r.hinweis })),
);

registerStrictTool(
  "sse_menu_click",
  {
    title: "Menueeintrag ausloesen",
    description:
      "Loest einen zuvor mit sse_menu ermittelten Menueeintrag aus. Eintraege, die zu einer " +
      "Uebermittlung fuehren koennten, sind gesperrt. Lokale Loesch-, Import-, Uebernahme- oder " +
      "Zuruecksetzbefehle verlangen nach dem Readback zusaetzlich acknowledgeDestructive=true; " +
      "Vorher-/Nachher-Dirty-State wird immer gemeldet.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_menu_click.shape,
  },
  async (a) => run("menu_click", a),
);

registerStrictTool(
  "sse_menu_close",
  {
    title: "Menue sicher schliessen",
    description:
      "Schliesst ein offenes Menue ueber dessen ExpandCollapsePattern und prueft, dass keine Popup-/Schattenfenster " +
      "mehr vorhanden sind. Verwendet weder Escape noch andere Tastendruecke und funktioniert daher auch als " +
      "sicherer Abschluss eines reinen Menue-Lesevorgangs.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_menu_close.shape,
  },
  async (a) => run("menu_close", a),
);

registerStrictTool(
  "sse_ui_state",
  {
    title: "Lagebeurteilung",
    description:
      "Schneller, konsistenter Read-only-Snapshot fuer die laufende SSE-Instanz. Ein Aufruf liefert " +
      "PID/HWND, Seite, Dirty-State, fingerprintgebundene Dialoge, Seitenpruefer, globalen Pruefer, " +
      "Warnfenster und - wenn Werte-Info bereits offen ist - die Ergebnis-/Was-waere-wenn-Werte. " +
      "Unbekannte oder nicht lesbare SSE-Fenster setzen blockiert=true und erscheinen unter " +
      "unsichereFenster; sie werden niemals als harmlose Helfer behandelt. " +
      "stateFingerprint bindet die Beobachtung an genau diesen Zustand; beim Folgeaufruf kann er als " +
      "previousFingerprint uebergeben werden, dann zeigt changedSince eine zwischenzeitliche Aenderung. " +
      "IMMER aufrufen, wenn 'Weiter' wirkungslos bleibt oder eine Seite sich seltsam verhaelt. " +
      "Hintergrund: Das Programm SPERRT das Blaettern, solange ein Pflichtfeld leer ist - der Klick " +
      "gelingt, die Seite bleibt stehen, und jeder weitere Versuch oeffnet ein Warnfenster. Ohne dieses " +
      "Werkzeug sieht ein Agent nur, dass nichts passiert, und klickt endlos weiter.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_ui_state.shape,
  },
  async (a) =>
    run("ui_state", a, (r) => ({
      running: r.running,
      instance: r.instance,
      stateFingerprint: r.stateFingerprint,
      changedSince: r.changedSince,
      heading: r.heading,
      blockiert: r.blockiert,
      rat: r.rat,
      prueferMeldungen: asArray(r.prueferMeldungen),
      baumFehler: asArray(r.baumFehler),
      leerePflichtfelder: asArray(r.leerePflichtfelder),
      steuerpruefer: r.steuerpruefer,
      ungespeichert: r.ungespeichert,
      ergebnis: r.ergebnis,
      dialoge: asArray(r.dialoge),
      unsichereFenster: asArray(r.unsichereFenster),
      warnfensterAnzahl: r.warnfensterAnzahl,
      nichtmodaleFenster: asArray(r.nichtmodaleFenster),
      snapshot: r.snapshot,
      workerMs: r.ms,
    }), 180_000),
);

registerStrictTool(
  "sse_dismiss",
  {
    title: "Warnfenster schliessen",
    description:
      "Schliesst nur bekannte kompakte, nicht-modale Fenster: Steuer-Spar-Tipps, Werte-Info und " +
      "Schatten-Popups. Echte Dialoge, automatische Pruefhinweise, unbekannte oder nicht lesbare " +
      "Fenster werden BEWUSST NICHT angetastet und strukturiert unter stehenGelassen gemeldet. " +
      "Pruefhinweise zuerst mit sse_warning_popup_read lesen und fingerprintgebunden beantworten.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_dismiss.shape,
  },
  async (a) => run("dismiss", a, undefined, 120_000),
);

registerStrictTool(
  "sse_screenshot",
  {
    title: "Bildschirmfoto",
    description:
      "Fotografiert das Fenster (PrintWindow). Funktioniert auch, wenn das Fenster NICHT im Vordergrund " +
      "ist, und ist das zuverlaessigste Werkzeug ueberhaupt. Bei jedem Zweifel ueber den Programmzustand " +
      "zuerst hierher greifen.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_screenshot.shape,
  },
  async (a) => {
    try {
      const r = await callApiOperation("screenshot", a);
      if (r.ok === false) return errorResult(String(r.error));
      const shot = r.shot as { path: string; w: number; h: number };
      const extra: Content[] = [];
      const imageBase64 = String(r.imageBase64 ?? "");
      if (a.includeImage && imageBase64) {
        extra.push({
          type: "image",
          data: imageBase64,
          mimeType: "image/png",
        });
      }
      return textResult({ ref: shot.path, width: shot.w, height: shot.h }, extra);
    } catch (e) {
      return errorResult(e instanceof ApiClientError ? e.message : String(e));
    }
  },
);

registerStrictTool(
  "sse_read_page",
  {
    title: "Seite lesen",
    description:
      "Liest die aktuell angezeigte Eingabeseite als Zeilen 'Beschriftung = Wert'. Betraege stehen NICHT " +
      "im Namen eines Feldes, sondern im ValuePattern - dieses Werkzeug holt beides und fuehrt es zusammen. " +
      "Die Spaltengrenzen des Arbeitsbereichs werden aus der Fensterbreite berechnet, funktioniert also " +
      "bei jeder Fenstergroesse. Das Hauptwerkzeug zum Auslesen von Steuerdaten.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_read_page.shape,
  },
  async (a) =>
    run("read_page", a, (r) => ({
      heading: r.heading,
      lines: asArray<{ y: number; cells: string[] }>(r.lines).map((l) => l.cells.join("  ::  ")),
      stats: r.stats,
    })),
);

registerStrictTool(
  "sse_read_table",
  {
    title: "Tabelle lesen",
    description:
      "Liest die Eingabetabelle der aktuellen Seite (z. B. Einnahmenliste) als Kopfzeile und Datenzeilen. " +
      "ACHTUNG: nur die sichtbaren Zeilen. Sind mehr Zeilen vorhanden als angezeigt, vorher sse_scroll " +
      "benutzen und erneut lesen.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_read_table.shape,
  },
  async (a) =>
    run("read_table", a, (r) => ({
      headers: asArray(r.headers),
      rowCount: r.rowCount,
      rows: asArray(r.rows),
    })),
);

registerStrictTool(
  "sse_snapshot",
  {
    title: "Elementbaum",
    description:
      "Vollstaendiger Elementbaum des Fensters (schneller UIA-Bulk-Cache mit explizitem TreeWalker-Fallback). Fuer Fehlersuche und um " +
      "unbekannte Bedienelemente zu finden. Umfangreich - fuer normales Auslesen ist sse_read_page besser.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_snapshot.shape,
  },
  async (a) => run("snapshot", a, (r) => ({ count: r.count, stats: r.stats, nodes: asArray(r.nodes) })),
);

registerStrictTool(
  "sse_snapshot_compare",
  {
    title: "Bulk-Snapshot gegen sicheren Altpfad vergleichen",
    description:
      "Read-only A/B-Diagnose: liest denselben SSE-Zustand einmal mit dem zyklusgeschuetzten TreeWalker " +
      "und einmal mit dem schnellen UIA-Bulk-Cache. Vergleicht Struktur und Feldwerte, gibt aber keine " +
      "privaten Namen oder Werte aus. Dient zur sicheren Freigabe neuer Seiten/Qt-Zustaende.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_snapshot_compare.shape,
  },
  async (a) => run("snapshot_compare", a, undefined, 120_000),
);

registerStrictTool(
  "sse_accessibility_probe",
  {
    title: "Qt-Accessibility eines Elements untersuchen",
    description:
      "Rein lesende Tiefenpruefung fuer ein exakt adressiertes UI-Element. Untersucht UIA-Muster, " +
      "RawView-Nachfahren und ueberlappende MSAA-Knoten. Damit laesst sich belegen, ob ein Qt-Inhalt " +
      "strukturiert lesbar ist oder OCR als Rueckfall noetig bleibt. Bei Mehrdeutigkeit rid aus " +
      "sse_snapshot verwenden.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_accessibility_probe.shape,
  },
  async (a) =>
    run("accessibility_probe", a, (r) => ({
      hwnd: r.hwnd,
      node: r.node,
      uia: r.uia,
      rawDescendants: asArray(r.rawDescendants),
      rawTruncated: r.rawTruncated,
      msaaOverlaps: asArray(r.msaaOverlaps),
      textCandidates: asArray(r.textCandidates),
      fazit: r.fazit,
    })),
);

registerStrictTool(
  "sse_find",
  {
    title: "Element suchen",
    description:
      "Sucht Bedienelemente nach Beschriftung. Liefert Typ, Lage und Zustand. " +
      "WICHTIG: Ein leeres Ergebnis ist bei diesem Programm kein Beweis fuer Abwesenheit - bei " +
      "ueberlastetem UIA liefert es faelschlich nichts. Im Zweifel sse_health.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_find.shape,
  },
  async (a) => run("find", a, (r) => ({ count: r.count, hits: asArray(r.hits) })),
);

registerStrictTool(
  "sse_get_value",
  {
    title: "Feldwert lesen",
    description:
      "Liest den Inhalt genau eines Eingabefeldes samt Schreibschutz-Kennzeichen. " +
      "Mehrdeutige Selektoren werden abgewiesen; fuer unbeschriftete Felder aid oder rid verwenden.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_get_value.shape,
  },
  async (a) => run("get_value", a),
);

/* -------------------------------------------------------------- Bedienen */

registerStrictTool(
  "sse_click",
  {
    title: "Element ausloesen",
    description:
      "Loest ein Bedienelement ueber UI Automation aus - NICHT ueber Bildschirmkoordinaten. " +
      "Das Fenster muss dafuer NICHT im Vordergrund sein. " +
      "Mit expectedPageAfter liest das Werkzeug bei jeder navigierenden Schaltflaeche die Seitenueberschrift " +
      "vor und nach der Aktion selbst zurueck und meldet einen wirkungslosen Klick statt Scheinerfolg. " +
      "Meldet eine Qt-Aktion ein wirkungsloses InvokePattern, ist nur bei unveraenderter Ausgangsseite, " +
      "Dialogfreiheit, erneut vorhandenem InvokePattern und eindeutiger frischer Elementbindung ein " +
      "PID-/Root-verifizierter Mausklick-Fallback erlaubt. " +
      "Direkte Toggle-Pattern sind hier gesperrt: Checkboxen ausschliesslich mit sse_toggle; " +
      "Dropdowns mit sse_combo_select. pattern='select' ist nur fuer genau einen per AutomationId " +
      "gebundenen RadioButton auf dem sichtbaren Desktop zulaessig, aktiviert ihn PID-/Root-verifiziert physisch " +
      "und verifiziert den exklusiven Vor-/Nachzustand der ganzen Gruppe. " +
      "Lokale Loesch-/Import-/Uebernahme-/Zuruecksetzbefehle verlangen einen bewussten Readback und " +
      "acknowledgeDestructive=true; Teilstrings muessen genau einen Kandidaten ergeben. " +
      "GESPERRT sind alle Wege, die Daten ans Finanzamt schicken koennten (ELSTER, 'Anmeldungen versenden', " +
      "'Jahreserklaerungen abschliessen', 'Senden' ...). Diese Sperre ist Absicht und wird nicht umgangen.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_click.shape,
  },
  async (a) => run("click", a, (r) => ({
    clicked: r.clicked,
    pattern: r.pattern,
    method: r.method,
    kandidaten: r.kandidaten,
    ueberschriftVorher: r.ueberschriftVorher,
    ueberschriftNachher: r.ueberschriftNachher,
      navigiert: r.navigiert,
      verified: r.verified,
      ungespeichertVorher: r.ungespeichertVorher,
      ungespeichertNachher: r.ungespeichertNachher,
      dialoge: asArray(r.dialoge),
  })),
);

registerStrictTool(
  "sse_toggle",
  {
    title: "Checkbox transaktional setzen",
    description:
      "Setzt genau eine echte UIA-CheckBox auf einen erwarteten booleschen Zustand. AENDERT moeglicherweise " +
      "STEUERDATEN. Exakte Seite, Vorwert und Nachwert sind Pflicht; RuntimeId/AutomationId, Dialoge, Fensterlage " +
      "und fremde Benutzereingabe werden im selben Worker gebunden. Bei einer eindeutig eigenen verletzten " +
      "Nachbedingung wird der alte Zustand wiederhergestellt; nach Interferenz erfolgt kein blinder Rollback. " +
      "RadioButton-Gruppen sind absichtlich nicht abgedeckt.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_toggle.shape,
  },
  async (a) => run("toggle", a),
);

registerStrictTool(
  "sse_click_point",
  {
    title: "Element wirklich anklicken",
    description:
      "Echter, PID- und Root-verifizierter Mausklick, fail-closed auf TreeItems des Navigationsbaums, eng benannte " +
      "Erfassen-/Bearbeiten-Hyperlinks sowie den intern fingerprintgebundenen read-only Prueferpfad begrenzt. " +
      "Bei TreeItems wird labelnah statt in die oft leere " +
      "Zeilenmitte geklickt. Checkboxen, Radios, Dropdowns, Tabellenzellen und Dialogknöpfe sind gesperrt und " +
      "muessen ueber ihre zustands-, summen- oder fingerprintgebundenen Spezialwerkzeuge laufen. " +
      "Die Koordinaten stammen aus dem Element selbst, nicht aus einem Bildschirmfoto; vor dem Klick " +
      "wird geprueft, dass dort wirklich ein Fenster des Programms liegt, sonst wird abgebrochen. " +
      "Holt das Fenster dafuer kurz nach oben. Fuer Schaltflaechen ist sse_click vorzuziehen.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_click_point.shape,
  },
  async (a) =>
    run("click_point", a, (r) => ({
      clicked: r.clicked,
      at: r.at,
      double: r.double,
      windowClosed: r.windowClosed,
      verified: r.verified,
      ueberschriftVorher: r.ueberschriftVorher,
      ueberschriftNachher: r.ueberschriftNachher,
      seiteGewechselt: r.seiteGewechselt,
      ungespeichertVorher: r.ungespeichertVorher,
      ungespeichertNachher: r.ungespeichertNachher,
      note: r.note,
    })),
);

registerStrictTool(
  "sse_set_value",
  {
    title: "Globales Suchfeld transaktional setzen",
    description:
      "Kompatibler Low-Level-Name fuer genau das bekannte, steuerneutrale globale SSE-Suchfeld. " +
      "Steuerdaten-, Formular- und Tabellenfelder sind hier fail-closed gesperrt und muessen ueber " +
      "sse_change_known_field, sse_change_field, sse_table_add, sse_table_update oder sse_combo_select laufen. " +
      "Vorwert, erwarteter Nachwert, exakte AutomationId, Fensterlage, Dialoge und fremde Benutzereingabe " +
      "werden in einem Worker geprueft; bei Interferenz erfolgt kein blinder Rollback.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_set_value.shape,
  },
  async (a) => run("set_value", a),
);

registerStrictTool(
  "sse_change_field",
  {
    title: "Feld atomar aendern und Steuerwirkung verfolgen",
    description:
      "Bevorzugter schneller Schreibweg fuer ein einzelnes Feld. Fuehrt in EINEM isolierten UIA-Arbeitsprozess " +
      "Seiten-, Vorwert- und optionale Summenpruefung, Wertsetzung, Qt-Commit, Feld-Readback sowie Vorher/Nachher-" +
      "Diff der Werte-Info aus. Bei einer normal verletzten Nachbedingung wird der alte Feldwert automatisch " +
      "wiederhergestellt. Erkennt der Eingabe-/Fenster-Guard dagegen eine fremde Benutzeraktion oder einen neuen " +
      "Dialog, wird bewusst NICHT blind zurueckgerollt: der sichtbare Zustand wird gemeldet und muss neu gelesen werden. " +
      "Das Werkzeug speichert nicht; danach weiterhin hashgebunden sse_save verwenden. " +
      "ELSTER-/Abgabewege bleiben gesperrt.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_change_field.shape,
  },
  async (a) => run("tracked_set_value", a, undefined, 90_000),
);

registerStrictTool(
  "sse_change_known_field",
  {
    title: "Bekanntes Page-Object-Feld atomar aendern",
    description:
      "Schneller, stabiler Schreibweg fuer ein im Page-Object-Katalog definiertes Feld. Der Aufrufer " +
      "nennt nur stabile pageId/fieldId statt sichtbare Texte oder RuntimeIds. MCP loest die " +
      "AutomationId auf, bringt das exakte SSE-Hauptfenster nach vorn, prueft Seite und Vorwert, " +
      "schreibt per verifizierter Benutzereingabe und liest Feld, optionale Abhaengigkeiten sowie " +
      "Steuerergebnis-Diffs zurueck. Bei normal verletzter Nachbedingung erfolgt Rollback. Fremde Eingabe oder " +
      "eine veraenderte Fensterlage stoppt dagegen ohne blinden Rollback und verlangt einen neuen Zustandsabruf; " +
      "gespeichert wird nicht.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_change_known_field.shape,
  },
  async (a) => run("tracked_set_value", a, undefined, 90_000),
);

registerStrictTool(
  "sse_combo_options",
  {
    title: "Dropdown-Optionen sicher lesen",
    description:
      "Oeffnet genau eine ComboBox ueber ExpandCollapsePattern, liest die aktuell materialisierten, ihr " +
      "zugeordneten Optionen und schliesst sie danach wieder ohne Auswahl. Lange Qt-Listen sind virtualisiert; " +
      "sse_combo_select kann dennoch einen exakten internen Eintrag ueber das Listen-ValuePattern waehlen. Read-only.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_combo_options.shape,
  },
  async (a) => run("combo_options", a, (r) => ({ ...r, options: asArray(r.options) })),
);

registerStrictTool(
  "sse_combo_select",
  {
    title: "Dropdown-Option verifiziert waehlen",
    description:
      "Waehlt eine exakt beschriftete Option aus genau einer ComboBox. AENDERT STEUERDATEN. Der erwartete " +
      "Seiten- und Vorwert sind Pflicht; nach der Auswahl werden exakter Nachwert, Fensterlage, Dialoge und " +
      "fremde Benutzereingabe geprueft und das Dropdown geschlossen. Auch nicht sichtbare Optionen langer " +
      "virtualisierter Qt-Listen werden auf dem sichtbaren Desktop seitenweise materialisiert und erst als " +
      "echter, exakt benannter ListItem-Knoten PID-verifiziert gewaehlt. " +
      "Bei einer eindeutig eigenen verletzten " +
      "Nachbedingung wird die alte Option wiederhergestellt; nach Interferenz erfolgt kein blinder Rollback.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_combo_select.shape,
  },
  async (a) => run("combo_select", a),
);

registerStrictTool(
  "sse_scroll",
  {
    title: "Scrollen",
    description:
      "Rollt den Inhalt. mode='intoview' holt ein benanntes Element in den sichtbaren Bereich " +
      "(bevorzugt, braucht keinen Fokus). mode='percent' setzt die Position eines scrollbaren " +
      "Containers. mode='list' zeigt nur, was ueberhaupt scrollbar ist.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_scroll.shape,
  },
  async (a) => run("scroll", a),
);

// Roh-Tastatureingabe bleibt absichtlich ausserhalb der MCP-Oberflaeche.

/* ----------------------------------------------------- Programm/Steuerfaelle */

registerStrictTool(
  "sse_launch",
  {
    title: "Programm starten",
    description:
      "Startet die SteuerSparErklaerung, optional direkt mit einer Falldatei. Der Startmodus bestimmt " +
      "das Modul. Nur die verifizierte SteuerSparErklaerung 2025 und Falldateien des Steuerjahres 2025 " +
      "werden akzeptiert; andere Jahresversionen werden nicht gesteuert. " +
      "Wenn beim Start genau ein Hauptfenster erkennbar ist, liefert instance dessen PID/HWND zur sofortigen " +
      "expliziten Bindung aller Folgeaktionen. " +
      "einur=Gewinnermittlung/EUER, normal=Einkommensteuer, einurvor=Gewinn-Erfassung Folgejahr, " +
      "fest=Feststellung, ermaess=Lohnsteuer-Ermaessigung, KonsUst=Konsolidierte Umsatzsteuer, vorweg=Prognose. " +
      "Nach dem Start kann eine Rueckfrage nach einer Wiederherstellungsdatei erscheinen - mit " +
      "sse_windows/sse_screenshot pruefen und mit sse_click 'Ja' bzw. 'Nein' beantworten.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_launch.shape,
  },
  async (a) => run("launch", a, (r) => ({
    pid: r.pid, args: r.args, waitedSec: r.waitedSec, windows: asArray(r.windows),
    instance: r.instance, ready: r.ready, blockedByDialog: r.blockedByDialog,
    dialogs: asArray(r.dialogs), product: r.product, case: r.case,
  }), 120_000),
);

registerStrictTool(
  "sse_save",
  {
    title: "Steuerfall sicher speichern",
    description:
      "Speichert nur den bereits geoeffneten, referenzierten Steuerfall. caseRef und expectedHashBefore " +
      "sind Pflicht und muessen mit Fenstertitel und Datei uebereinstimmen. Sind mehrere Steuerfaelle offen, " +
      "muss das exakte Hauptfenster per hwnd gebunden werden. Danach werden Hashwechsel, " +
      "deaktivierte Sichern-Schaltflaeche und Dialogfreiheit geprueft. Nicht fuer Wiederherstellungsfaelle " +
      "ohne Dateibindung verwenden.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_save.shape,
  },
  async (a) => run("save", a, undefined, 90_000),
);

registerStrictTool(
  "sse_file_dialog_select",
  {
    title: "Datei oder Ordner im offenen Windows-Dialog sicher waehlen",
    description:
      "Bedient genau einen bereits offenen nativen Oeffnen-, Speichern- oder Ordnerauswahl-Dialog. Exakter Dialogtitel und " +
      "Dateipfad sind Pflicht. Beim Oeffnen muss die Datei existieren und kann per SHA256 gebunden werden. Beim " +
      "Speichern muss das Ziel neu sein; danach werden Existenz und SHA256 geprueft. Das Werkzeug setzt und liest " +
      "das Datei-/Ordnerfeld zurueck und klickt nur die zum Titel passende native Aktionsschaltflaeche. Der " +
      "Finanzamt-CSV-Export akzeptiert ausschliesslich einen vorhandenen leeren Ausgabeordner.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_file_dialog_select.shape,
  },
  async (a) => run("file_dialog_select", a, undefined, 90_000),
);

registerStrictTool(
  "sse_save_as",
  {
    title: "Steuerfall sicher speichern unter",
    description:
      "Oeffnet den echten SSE-Dialog 'Speichern unter...' mit Strg+Alt+S, setzt den Zielpfad ueber " +
      "UI Automation und prueft anschliessend Zieldatei, SHA256 und Fenstertitel. Quelldateipfad und " +
      "Quell-Hash sind Pflicht. Vorhandene Ziele sind standardmaessig gesperrt; ein Ueberschreibdialog " +
      "wird auch bei allowOverwrite nie blind bestaetigt.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_save_as.shape,
  },
  async (a) => run("save_as", a, undefined, 120_000),
);

registerStrictTool(
  "sse_close",
  {
    title: "Programm beenden",
    description:
      "Beendet das Programm. Versucht zuerst ein normales Schliessen; haengt das Fenster oder ist " +
      "force=true gesetzt, darf genau die gebundene PID nur mit discardChanges=true hart beendet werden. " +
      "Speichern gehoert in den hashgebundenen Schritt sse_save; sse_close save=true wird verweigert. " +
      "Ohne discardChanges=true wird kein neu auftauchender Speicherdialog mit Nein/Verwerfen beantwortet. " +
      "Offene Dialoge muessen vorher separat gelesen und beantwortet werden.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_close.shape,
  },
  async (a) => run("close", a, undefined, 60_000),
);

registerStrictTool(
  "sse_list_cases",
  {
    title: "Steuerfaelle auflisten",
    description:
      "Listet die Falldateien eines Ordners und liest ihren Klartext-Kopf: Modul, Jahr, Steuernummer, " +
      "und vor allem ElsterTransferTime - daran erkennt man OHNE das Programm zu oeffnen, ob eine " +
      "Erklaerung bereits ans Finanzamt uebermittelt wurde. Die eigentlichen Steuerdaten sind " +
      "verschluesselt und nur ueber die Oberflaeche lesbar.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_list_cases.shape,
  },
  async (a) => run("list_cases", a, (r) => ({ dir: r.dir, count: r.count, cases: asArray(r.cases) })),
);

registerStrictTool(
  "sse_backup_cases",
  {
    title: "Steuerfaelle sichern",
    description:
      "Kopiert alle Falldateien in einen Sicherungsordner und schreibt SHA256-Pruefsummen. " +
      "VOR jeder Schreiboperation aufrufen.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_backup_cases.shape,
  },
  async (a) => run("backup_cases", a, undefined, 180_000),
);

registerStrictTool(
  "sse_archive_cases",
  {
    title: "Alte Steuerfaelle sicher archivieren",
    description:
      "Verschiebt eine exakt benannte und SHA256-gebundene Menge nicht uebermittelter Falldateien aus dem " +
      "aktiven Fallordner in einen neuen Archivordner. Der vollstaendige erwartete Restbestand ist Pflicht; " +
      "bei unbekannten, geaenderten oder uebermittelten Dateien wird nichts verschoben. Nach jeder Bewegung " +
      "werden Archiv- und Resthashes geprueft, bei Fehlern erfolgt Rollback. Das ist die sichere, " +
      "wiederherstellbare Alternative zum Loeschen alter Test- und Zwischenstaende.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_archive_cases.shape,
  },
  async (a) => run("archive_cases", a, undefined, 180_000),
);

registerStrictTool(
  "sse_make_working_copy",
  {
    title: "Verifizierte Arbeitskopie erstellen",
    description:
      "Erstellt eine neue, bytegleiche Arbeitskopie einer Steuerfalldatei ohne UI, Tastatur oder Dialog. " +
      "Das Ziel darf nicht existieren; Quell-SHA256 und gleiche Dateiendung sind Pflicht. Danach werden " +
      "Quell- und Zielhash sowie Kopfdaten erneut geprueft. Bei einer Abweichung wird nur das neu erzeugte Ziel entfernt.",
    inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_make_working_copy.shape,
  },
  async (a) => run("make_working_copy", a, undefined, 120_000),
);

/* ------------------------------------------------------------------ Start */

async function main() {
  if (process.argv.includes("--selftest")) {
    const r = await callApiOperation("health");
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    return;
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("steuer-spar-erklaerung MCP-Server bereit\n");
}

main().catch((e) => {
  process.stderr.write(`Start fehlgeschlagen: ${e?.stack ?? e}\n`);
  process.exit(1);
});
