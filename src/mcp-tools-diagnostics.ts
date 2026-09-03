/**
 * Diagnose-, Discovery-, Workspace- und Sicherheitswerkzeuge.
 */
import { asArray } from "./api-client.js";
import {
  apiErrorResult,
  apiSuccessResult,
  errorResult,
  LOCAL_PATH_REDACTION,
  redactLocalPathText,
  type Content,
} from "./mcp-response.js";
import { apiResultOutputSchema, type McpRegistry } from "./mcp-registry.js";
import { evaluateMcpPreflight, MCP_PREFLIGHT_OUTPUT_SCHEMA } from "./mcp-preflight.js";
import { SSE_MCP_TOOL_SCHEMAS } from "./operation-catalog.js";

export function registerDiagnosticTools(registry: McpRegistry): void {
  const {
    callApiOperation,
    caughtErrorResult,
    registerApiTool,
    registerComposedTool,
    registerShapedApiTool,
    registerStrictTool,
    run,
  } = registry;

  /* ------------------------------------------------------------- Diagnose */

  registerComposedTool(
    "sse_preflight",
    {
      title: "Installation und Laufzeit in einem Schritt pruefen",
      description:
        "Fuehrt vor der ersten fachlichen Arbeit genau einmal die drei read-only Pruefungen " +
        "sse_workspace_status, sse_product_info und sse_health in dieser Reihenfolge aus. " +
        "Liefert stabile Blockercodes, aber keine Pfade, Fenstertexte oder Prozessdaten. " +
        "Startet keinen Steuerfall, beantwortet keinen Dialog und aendert keine Konfiguration. " +
        "Nach einem gruenen Ergebnis mit sse_instances den geoeffneten Fall eindeutig binden.",
      inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_preflight.shape,
      outputSchema: MCP_PREFLIGHT_OUTPUT_SCHEMA,
    },
    async () => {
      let workspace: Record<string, unknown>;
      let product: Record<string, unknown>;
      let health: Record<string, unknown>;
      try {
        workspace = await callApiOperation("workspace_status");
      } catch (error) {
        return caughtErrorResult("workspace_status", error);
      }
      if (workspace.ok === false) return apiErrorResult("workspace_status", workspace);
      try {
        product = await callApiOperation("product_info");
      } catch (error) {
        return caughtErrorResult("product_info", error);
      }
      if (product.ok === false) return apiErrorResult("product_info", product);
      try {
        health = await callApiOperation("health");
      } catch (error) {
        return caughtErrorResult("health", error);
      }
      if (health.ok === false) return apiErrorResult("health", health);
      const result = evaluateMcpPreflight(workspace, product, health);
      return apiSuccessResult(result, result);
    },
  );

  registerApiTool(
    "sse_capabilities",
    {
      title: "SSE-API-/MCP-Faehigkeiten und sichere Fallbacks lesen",
      description:
        "Liefert PC-blind die verfuegbaren Selektoren, Klickmuster, Dialogantworten und die sichere generische " +
        "Fallback-Leiter. Damit kann ein Agent bei einer noch nicht fachlich katalogisierten Seite ueber " +
        "Snapshot, Find, eindeutige AutomationId/RuntimeId und gebundene Basisoperationen weiterarbeiten. " +
        "Nennt auch die rein informative, nicht freigabewirksame Live-Evidenz je Operation sowie direkte " +
        "CLI-, Discovery- und OpenAPI-Pfade fuer einen Betrieb ohne MCP. " +
        "Die Antwort liest keinen Steuerfall und uebermittelt niemals per ELSTER.",
    },
  );

  registerApiTool(
    "sse_product_info",
    {
      title: "Aktive SSE-Produktgrenze pruefen",
      description:
        "Liest die erwartete Steuerjahres-/Engine-Identitaet des von der API konfigurierten Produktprofils, " +
        "prueft die installierte Standarddatei und listet laufende verifizierte bzw. ignorierte SSE-Versionen. " +
        "Nicht zum aktiven Profil passende Jahres-/Engine-Versionen werden niemals ersatzweise angefasst.",
    },
  );

  registerApiTool(
    "sse_page_objects",
    {
      title: "Bekannte SSE-Seiten und Felder lesen",
      description:
        "Liest den versionierten Page-Object-Katalog mit stabilen Seiten-, Fenster- und Feld-IDs. " +
        "Der Katalog enthaelt ausschliesslich oeffentliche UI-Metadaten, niemals Steuerfallwerte, Namen, " +
        "Steuer-IDs oder Dateipfade. Ohne pageId wird der ganze Katalog geliefert.",
    },
  );

  registerApiTool(
    "sse_page_state",
    {
      title: "Bekannte Seite schnell und versionsfest lesen",
      description:
        "Liest eine katalogisierte Seite ueber exakte relative AutomationIds statt einer freien Volltextsuche. " +
        "Liefert aktuelle Feldwerte, Fenster-/Dialogstatus und eine kurzlebige state epoch. Diese Epoche kann " +
        "sse_change_known_field als Vorbedingung erhalten; jede zwischenzeitliche Seite-, Scroll-, Feld- oder " +
        "Dirty-State-Aenderung bricht dann vor dem Schreiben ab. Werte werden nicht im Katalog oder auf Platte gespeichert.",
    },
  );

  registerApiTool(
    "sse_workspace_status",
    {
      title: "SSE-Arbeitsbereich pruefen",
      description:
        "Prueft ueber die API, ob Arbeits-/Ergebnisbereich, Fallordner und optionaler SSE-Programmpfad " +
        "eingerichtet sind. Liefert bewusst keine lokalen PC-Pfade; nur der MCP-API-Supervisor kennt URL, optionale Konfiguration und eigene API-Dependency.",
    },
  );

  registerApiTool(
    "sse_workspace_files",
    {
      title: "SSE-Arbeitsdateien auflisten",
      description:
        "Listet maschinenneutrale Dateireferenzen, Groesse und SHA256 in einem konfigurierten API-Ressourcenbereich. " +
        "truncated kennzeichnet eindeutig, ob weitere Dateien hinter dem angeforderten Limit liegen. " +
        "Absolute Pfade, Pfadwechsel und symbolische Links aus dem Arbeitsbereich heraus sind gesperrt.",
    },
  );

  registerShapedApiTool(
    "sse_workspace_read_text",
    {
      title: "SSE-Textdatei lesen",
      description:
        "Liest hoechstens 1 MiB UTF-8-Text aus einer maschinenneutralen Ressourcenreferenz und liefert SHA256. " +
        "Greift nie ueber einen frei angegebenen PC-Pfad zu. Enthaltene lokale Pfade werden sichtbar redigiert; " +
        "textRedigiert=true sperrt einen unveraenderten Schreib-Roundtrip.",
    },
    (r) => {
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
    },
  );

  registerStrictTool(
    "sse_workspace_write_text",
    {
      title: "SSE-Textdatei sicher schreiben",
      description:
        "Schreibt hoechstens 1 MiB UTF-8-Text exklusiv in eine neue relative Dateireferenz. " +
        "Vorhandene oder waehrend des Schreibens erscheinende Ziele werden nie ersetzt. Pfadwechsel sind gesperrt. " +
        "Der sichtbare Redaktionsplatzhalter aus sse_workspace_read_text wird nie geschrieben.",
      inputSchema: SSE_MCP_TOOL_SCHEMAS.sse_workspace_write_text.shape,
      outputSchema: apiResultOutputSchema("workspace_file_write_text"),
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

  registerApiTool(
    "sse_run_scenario",
    {
      title: "SSE-Szenario reproduzierbar ausfuehren",
      description:
        "Fuehrt eine versionierte JSON-Szenariodatei aus dem API-Arbeitsbereich seriell aus. Argumente koennen " +
        "aus relativen UTF-8-/JSON-Eingabedateien kommen. Das kanonische Ergebnis wird im API-Ergebnisbereich " +
        "geschrieben und mit SHA256 geliefert; direkter API-Aufruf und dieser MCP-Wrapper nutzen denselben Codepfad.",
    },
    { timeoutMs: 300_000 },
  );

  registerShapedApiTool(
    "sse_health",
    {
      title: "Zustand pruefen",
      description:
        "Prueft, ob die SteuerSparErklaerung laeuft und ansprechbar ist. Misst einen 'Kanarienvogel' " +
        "(billigste UIA-Abfrage). Dauert der laenger als ~1,5 s, ist das Programm ueberlastet und JEDES " +
        "weitere Ergebnis waere unzuverlaessig. Ein offener modaler Dialog kann dieselbe Verzoegerung " +
        "verursachen und wird deshalb separat gemeldet; dann Dialog lesen statt neu starten. IMMER zuerst aufrufen, wenn eine " +
        "vorherige Antwort unerwartet leer war.",
    },
    (r) => ({ ...r, windows: asArray(r.windows) }),
  );

  registerShapedApiTool(
    "sse_instances",
    {
      title: "Offene Steuerfaelle unterscheiden",
      description:
        "Nennt jeden offenen Steuerfall mit Fenster-ID, Falldatei, Falltyp (z. B. ESt fuer Einkommensteuer, " +
        "Gew fuer die Gewerbe-/EUER-Rechnung) und Jahr. IMMER zuerst aufrufen, wenn mehr als ein Steuerfall " +
        "offen sein koennte: alle fallbezogenen Werkzeuge verlangen dann zu Recht ein hwnd, und dies ist die " +
        "einzige Quelle dafuer. Ist genau ein Fall offen, ist er fuer normale Lese- und Aenderungsauftraege " +
        "der Arbeitsfall; keine Kopie und keinen anderen Fall still oeffnen. Laesst sich eine Falldatei weder aus dem Fenstertitel noch aus der " +
        "Kommandozeile belegen, bleibt casePath null - es wird nichts geraten. recoveredState=true heisst: " +
        "das Fenster zeigt einen wiederhergestellten Sitzungszustand, NICHT den Inhalt der Falldatei; " +
        "darauf darf nicht berichtet werden. Aendert nichts und wechselt auch keinen Fokus.",
    },
    (r) => ({ ...r, instances: asArray(r.instances) }),
  );

  registerShapedApiTool(
    "sse_windows",
    {
      title: "Fenster auflisten",
      description:
        "Listet alle sichtbaren Fenster des aktiven, verifizierten SSE-Produktprofils oder des SteuertippsCenters samt " +
        "Groesse und Haenge-Status. Freie Prozessnamen und Wildcards sind gesperrt. Nuetzlich, um modale " +
        "Dialoge zu erkennen (z. B. die Rueckfrage nach einer Wiederherstellungsdatei beim Start).",
    },
    (r) => ({ windows: asArray(r.windows) }),
  );

  registerShapedApiTool(
    "sse_center_cases",
    {
      title: "Fallliste im Steuertipps-Center lesen",
      description:
        "Liest den Hauptbildschirm des Steuertipps-Centers in den Modi 'Verzeichnis' und 'Zuletzt verwendet'. " +
        "Im Verzeichnismodus wird die UIA-Liste read-only mit den primaeren ESt-/Gew-Falldateien im angezeigten " +
        "Ordner verglichen; Backup-, Protokoll- und GewErfass-Dateien werden nicht als Center-Faelle ausgegeben. " +
        "'Zuletzt verwendet' liefert die sichtbare Liste ohne behaupteten Dateisystemvergleich. Aendert, oeffnet oder loescht nichts.",
    },
    (r) => {
      const { verzeichnis, ...rest } = r;
      const hasDirectory = typeof verzeichnis === "string" && rest.modus !== "Zuletzt verwendet";
      const verzeichnisRef = hasDirectory && verzeichnis.startsWith("cases:")
        ? verzeichnis
        : null;
      return {
        ...rest,
        verzeichnisRef,
        verzeichnisImFallbereich: hasDirectory ? verzeichnisRef !== null : null,
        ...(verzeichnisRef === null
          ? { verzeichnisHinweis: hasDirectory
            ? "Das Center zeigt einen Ordner ausserhalb des konfigurierten Fallbereichs; zuerst den Center-Ordner korrigieren."
            : "Der Modus 'Zuletzt verwendet' ist nicht an einen einzelnen Fallordner gebunden." }
          : {}),
        faelle: asArray(r.faelle),
        dateisystemFaelle: asArray(r.dateisystemFaelle),
        nurImCenter: asArray(r.nurImCenter),
        nurImDateisystem: asArray(r.nurImDateisystem),
      };
    },
  );

  registerShapedApiTool(
    "sse_center_refresh",
    {
      title: "Fallliste im Steuertipps-Center aktualisieren",
      description:
        "Aktualisiert ausschliesslich die fingerprintgebundene Center-Fallliste, indem kurz in den jeweils anderen " +
        "Modus und danach in den gelesenen Ausgangsmodus zurueckgeschaltet wird. Exaktes Fenster und entweder die " +
        "erwartete Ordnerreferenz oder der erwartete Modus aus sse_center_cases sind Pflicht; Filterzustand und " +
        "Fallnamen werden zurueckgelesen. Es wird kein Steuerfall geoeffnet, gespeichert, verschoben oder geloescht.",
    },
    (r) => {
      const { verzeichnis, ...rest } = r;
      return {
        ...rest,
        verzeichnisRef: typeof verzeichnis === "string" ? verzeichnis : null,
        vorher: asArray(r.vorher),
        nachher: asArray(r.nachher),
      };
    },
  );

  registerApiTool(
    "sse_window_restore",
    {
      title: "Minimiertes Hauptfenster sicher wiederherstellen",
      description:
        "Stellt ausschliesslich ein von sse_windows frisch gelesenes, verifiziertes SSE-Hauptfenster aus dem minimierten Zustand wieder her. " +
        "PID, HWND und Titel-Fingerprint werden unmittelbar vorher und nachher geprueft; alle Peer-Fenster muessen unveraendert bleiben. " +
        "Verwendet nur den Win32-Fensterzustand, keine Tastatur, Maus oder Steuerdatenaktion.",
    },
  );

  registerApiTool(
    "sse_window_close",
    {
      title: "Nebenfenster sicher schliessen",
      description:
        "Schliesst nur ein im Produktprofil freigegebenes nicht-modales Hilfe- oder Ergebnisfenster. " +
        "PID, Fenster-ID und der von sse_windows gelieferte Titel-Fingerprint sind Pflicht und werden unmittelbar vor WM_CLOSE erneut geprueft. " +
        "Der Readback akzeptiert ausschliesslich das Verschwinden dieses Ziels; Hauptfenster, modale Dialoge, Uebermittlungsfenster und unbekannte Titel bleiben gesperrt.",
    },
  );

  registerApiTool(
    "sse_case_hash",
    {
      title: "Steuerfall pruefen und hashen",
      description:
        "Liest eine Falldatei ohne die SteuerSparErklaerung zu oeffnen. Liefert SHA256, Groesse, " +
        "Aenderungszeit, zentrale Kopffelder und den ELSTER-Uebermittlungsstatus. Read-only; dient als " +
        "Vorbedingung fuer sse_save, sse_save_as und sse_make_working_copy.",
    },
  );

  registerApiTool(
    "sse_dialog_list",
    {
      title: "Dialoge sicher lesen",
      description:
        "Listet alle SSE-Fenster, klassifiziert native und Qt-Dialoge und liefert Texte, erlaubte " +
        "Antwortschaltflaechen sowie einen SHA256-Fingerprint. Mit pid wird die aufwendige Inventur " +
        "vor dem UIA-/MSAA-Readback auf genau eine zuvor gelieferte SSE-PID begrenzt. Den Fingerprint unveraendert an " +
        "sse_dialog_answer geben; er verhindert, dass versehentlich ein inzwischen ausgetauschter Dialog beantwortet wird. " +
        "Die exakt erkannte Wiederherstellungsfrage traegt recoveryPrompt=true und requiresCaseBinding=true.",
    },
  );

  registerApiTool(
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
        "Bei recoveryPrompt=true ist nur 'Nein' erlaubt und expectedCaseRef plus expectedCaseHash sind Pflicht; " +
        "PID/Command-Line, Dateihash und das anschliessende regulaere Fallfenster werden verifiziert. " +
        "Wurde die SSE-PID ohne Falldatei gestartet (nie gespeicherter Fall), ersetzt discardUnsavedRecovery=true " +
        "die Dateibindung: der Worker beweist die Kommandozeile ohne Fall, verlangt danach genau ein regulaeres " +
        "Fallfenster und meldet caseBindingModeAfter='file-less-start'. " +
        "Beim lokalen Finanzamt-CSV-Export ist nur der exakt gelesene Schalter " +
        "'Klicken Sie hier, um Ihre Daten zu exportieren' freigegeben; der folgende Ordnerdialog " +
        "bleibt ein separat zu pruefender Dialog.",
    },
    { timeoutMs: 90_000 },
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
      outputSchema: apiResultOutputSchema("warning_popup_read"),
    },
    async (a) => {
      try {
        const r = await callApiOperation("warning_popup_read", {
          ...(a.hwnd === undefined ? {} : { hwnd: a.hwnd }),
          ocr: a.ocr ?? true,
          includeImage: a.includeImage === true,
        }, 90_000);
        if (r.ok === false) return apiErrorResult("warning_popup_read", r);
        const imageBase64 = String(r.bildBase64 ?? "");
        const extra: Content[] = [];
        if (a.includeImage && imageBase64) {
          extra.push({ type: "image", data: imageBase64, mimeType: "image/png" });
        }
        return apiSuccessResult({
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
        }, r, extra);
      } catch (e) {
        return caughtErrorResult("warning_popup_read", e);
      }
    },
  );

  registerApiTool(
    "sse_vast_dialog_read",
    {
      title: "VaSt-Zuordnungen sicher lesen",
      description:
        "Liest den offiziellen Dialog 'Daten der vorausgefüllten Steuererklärung' als sieben bzw. aktuell sichtbare " +
        "Bescheinigungs-Zuordnungen. Qt exponiert die gemalten Tabellenwerte nicht stabil; deshalb werden UIA-Struktur " +
        "und lokales Windows-OCR kombiniert. Liefert einen mappingFingerprint, ungelöste Zeilen und riskante " +
        "Mehrfachzuordnungen. Read-only: klappt nichts auf, ändert keine Zuordnung und übernimmt keine Daten.",
    },
    { timeoutMs: 90_000 },
  );

  registerApiTool(
    "sse_vast_row_details",
    {
      title: "Eine VaSt-Bescheinigung lesen",
      description:
        "Klappt genau eine durch certificate+occurrence adressierte VaSt-Zeile kurz auf, liest die FA-Werte " +
        "strukturiert mit OCR-Rückfall und stellt anschließend denselben mappingFingerprint und Aufklappzustand " +
        "wieder her. Der Qt-Baumpfeil wird gegen SSE-PID und Dialog-Root gebunden; keine Zuordnung wird geändert.",
    },
    { timeoutMs: 90_000 },
  );

  registerApiTool(
    "sse_vast_row_set_expanded",
    {
      title: "VaSt-Zeile kontrolliert auf- oder zuklappen",
      description:
        "Ändert nur den Ansichtszustand einer exakt fingerprintgebundenen VaSt-Zeile. Vor- und Nachzustand " +
        "werden per OCR und Zeilenbindung geprüft; Zuordnungen und Steuerdaten bleiben unverändert.",
    },
    { timeoutMs: 90_000 },
  );

  registerApiTool(
    "sse_vast_mapping_options",
    {
      title: "VaSt-Zuordnungsziele lesen",
      description:
        "Öffnet nur das Dropdown einer exakt gebundenen VaSt-Zeile, liest dessen Ziele aus dem sichtbaren " +
        "Qt-Popup und schließt es ausschließlich nach bestätigtem Popup per Escape. Kein Ziel wird ausgewählt. " +
        "mappingFingerprint und expectedCurrent verhindern Arbeit auf einem überholten Dialogzustand.",
    },
    { timeoutMs: 90_000 },
  );

  registerApiTool(
    "sse_vast_mapping_select",
    {
      title: "Eine VaSt-Zuordnung ändern",
      description:
        "Wählt genau ein zuvor gelesenes lokales Ziel für eine FA-Bescheinigung. Bindet Dialogzustand, Zeile, " +
        "Vorwert, sichtbaren Options-Text, SSE-PID und Zielpunkt und akzeptiert danach ausschließlich einen " +
        "Ein-Zeilen-Diff. Dies ändert nur den Zuordnungsentwurf; Daten werden noch nicht in den Steuerfall übernommen.",
    },
    { timeoutMs: 90_000 },
  );

  registerApiTool(
    "sse_vast_apply",
    {
      title: "VaSt-Zuordnungsplan übernehmen",
      description:
        "Übernimmt genau den zuvor vollständig gelesenen VaSt-Zuordnungsplan in den offenen Steuerfall. " +
        "Die Aktion ist an Mapping-Fingerprint, Hauptfenster, Fallpfad, Disk-Hash, exakte Zeilenreihenfolge und " +
        "acknowledgeApply=true gebunden. Ungelöste oder riskant doppelte Ziele werden abgewiesen. Danach müssen " +
        "Felder und Steuerberechnung separat gelesen werden. Speichert nicht und beantwortet keine Folgedialoge.",
    },
    { timeoutMs: 90_000 },
  );
}
