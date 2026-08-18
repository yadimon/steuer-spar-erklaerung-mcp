import { existsSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { readJsonFileStrict } from "./json-files.js";

export const SETUP_MODES = ["setup-only", "read-only-check", "controlled-edit"] as const;
export type SetupMode = typeof SETUP_MODES[number];

export const SETUP_TRANSPORTS = ["api", "api-and-mcp"] as const;
export type SetupTransport = typeof SETUP_TRANSPORTS[number];

export const DOCUMENT_COLLECTION_POLICIES = ["copy-after-confirmation", "reference-only"] as const;
export type DocumentCollectionPolicy = typeof DOCUMENT_COLLECTION_POLICIES[number];

export interface SetupConnectorPreference {
  name: string;
  access: "approved" | "not-approved";
}

export interface SetupTrackingPreference {
  format?: "markdown" | "xlsx";
  path?: string;
}

export interface SetupPreferenceValues {
  useSafeDefaults?: boolean;
  mode?: SetupMode;
  transport?: SetupTransport;
  documentCollection?: DocumentCollectionPolicy;
  sourceFolders?: readonly string[];
  connectors?: readonly SetupConnectorPreference[];
  tracking?: SetupTrackingPreference;
  initialReadOnlyCheck?: boolean;
  priorities?: readonly string[];
}

export interface NormalizedSetupPreferences {
  useSafeDefaults: boolean;
  mode: SetupMode;
  transport: SetupTransport;
  documentCollection: DocumentCollectionPolicy;
  sourceFolders: readonly string[];
  connectors: readonly SetupConnectorPreference[];
  tracking: { format: "markdown" | "xlsx"; path: string };
  initialReadOnlyCheck: boolean;
  priorities: readonly string[];
  settingsPath: string;
}

const MAX_STORED_SETUP_DECISIONS_BYTES = 16 * 1024 * 1024;

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Gespeicherte Setup-Entscheidung '${name}' ist ungueltig.`);
  }
  return value as string[];
}

export function loadStoredSetupPreferences(workspaceDir: string): SetupPreferenceValues | undefined {
  const path = join(workspaceDir, "setup-decisions.json");
  if (!existsSync(path)) return undefined;
  const parsed = readJsonFileStrict(path, "Setup-Entscheidungen", MAX_STORED_SETUP_DECISIONS_BYTES);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Setup-Entscheidungen sind kein JSON-Objekt: ${path}`);
  }
  const value = parsed as Record<string, unknown>;
  if (value.schemaVersion !== 2) return undefined;
  if (typeof value.requestedMode !== "string" || !SETUP_MODES.includes(value.requestedMode as SetupMode)) {
    throw new Error("Gespeicherter Setup-Modus ist ungueltig.");
  }
  if (typeof value.transport !== "string" || !SETUP_TRANSPORTS.includes(value.transport as SetupTransport)) {
    throw new Error("Gespeicherter Setup-Transport ist ungueltig.");
  }
  if (
    typeof value.documentCollection !== "string" ||
    !DOCUMENT_COLLECTION_POLICIES.includes(value.documentCollection as DocumentCollectionPolicy)
  ) {
    throw new Error("Gespeicherte Dokumententscheidung ist ungueltig.");
  }
  if (!Array.isArray(value.connectors)) throw new Error("Gespeicherte Connector-Entscheidungen sind ungueltig.");
  const connectors = value.connectors.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Gespeicherter Connector-Eintrag ist ungueltig.");
    }
    const connector = entry as Record<string, unknown>;
    if (
      typeof connector.name !== "string" ||
      (connector.access !== "approved" && connector.access !== "not-approved")
    ) {
      throw new Error("Gespeicherter Connector-Eintrag ist ungueltig.");
    }
    const access: SetupConnectorPreference["access"] = connector.access;
    return { name: connector.name, access };
  });
  if (!value.tracking || typeof value.tracking !== "object" || Array.isArray(value.tracking)) {
    throw new Error("Gespeicherte Tracking-Entscheidung ist ungueltig.");
  }
  const tracking = value.tracking as Record<string, unknown>;
  if (
    (tracking.format !== "markdown" && tracking.format !== "xlsx") ||
    typeof tracking.path !== "string"
  ) {
    throw new Error("Gespeicherte Tracking-Entscheidung ist ungueltig.");
  }
  if (typeof value.useSafeDefaults !== "boolean" || typeof value.initialReadOnlyCheck !== "boolean") {
    throw new Error("Gespeicherte Setup-Flags sind ungueltig.");
  }
  return {
    useSafeDefaults: value.useSafeDefaults,
    mode: value.requestedMode as SetupMode,
    transport: value.transport as SetupTransport,
    documentCollection: value.documentCollection as DocumentCollectionPolicy,
    sourceFolders: stringArray(value.sourceFolders, "sourceFolders"),
    connectors,
    tracking: { format: tracking.format, path: tracking.path },
    initialReadOnlyCheck: value.initialReadOnlyCheck,
    priorities: stringArray(value.priorities, "priorities"),
  };
}

const DEFAULT_PRIORITIES = Object.freeze([
  "Vorhandene Ein- und Ausgangsrechnungen sind die fuehrende Belegquelle.",
  "Kontoauszuege dienen dem spaeteren Zahlungsabgleich und ersetzen keine Rechnung.",
  "Originale bleiben unveraendert; zu sammelnde Unterlagen werden nur als Kopien uebernommen.",
]);

function cleanText(value: string, name: string, maxLength = 500): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f]/u.test(normalized)) {
    throw new Error(`${name} ist leer, zu lang oder enthaelt Steuerzeichen.`);
  }
  return normalized;
}

function assertAbsolutePath(value: string, name: string): string {
  if (!isAbsolute(value) || /[\u0000-\u001f]/u.test(value)) {
    throw new Error(`${name} muss ein absoluter Pfad ohne Steuerzeichen sein.`);
  }
  return resolve(value);
}

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === "" || (rel !== ".." && !rel.startsWith("..\\") && !rel.startsWith("../") && !isAbsolute(rel));
}

export function normalizeSetupPreferences(
  workspaceDir: string,
  input: SetupPreferenceValues = {},
): NormalizedSetupPreferences {
  const mode = input.mode ?? "read-only-check";
  if (!SETUP_MODES.includes(mode)) throw new Error(`Unbekannter Setup-Modus '${mode}'.`);
  const transport = input.transport ?? "api";
  if (!SETUP_TRANSPORTS.includes(transport)) throw new Error(`Unbekannter Setup-Transport '${transport}'.`);
  const documentCollection = input.documentCollection ?? "copy-after-confirmation";
  if (!DOCUMENT_COLLECTION_POLICIES.includes(documentCollection)) {
    throw new Error(`Unbekannte Sammelentscheidung '${documentCollection}'.`);
  }
  const sourceFolders = [...new Set((input.sourceFolders ?? []).map((path, index) =>
    assertAbsolutePath(path, `sourceFolders[${index}]`)))];
  if (sourceFolders.length > 32) throw new Error("Hoechstens 32 lokale Quellordner sind erlaubt.");
  const connectors = (input.connectors ?? []).map((connector, index) => ({
    name: cleanText(connector.name, `connectors[${index}].name`, 100),
    access: connector.access,
  }));
  if (connectors.length > 16) throw new Error("Hoechstens 16 Connector-Entscheidungen sind erlaubt.");
  if (connectors.some((connector) => !["approved", "not-approved"].includes(connector.access))) {
    throw new Error("Connector-Zugriff muss 'approved' oder 'not-approved' sein.");
  }
  const trackingFormat = input.tracking?.format ?? "markdown";
  const trackingPath = input.tracking?.path
    ? assertAbsolutePath(input.tracking.path, "tracking.path")
    : join(workspaceDir, trackingFormat === "markdown" ? "tracking.md" : "tracking.xlsx");
  if (trackingFormat === "markdown") {
    if (extname(trackingPath).toLowerCase() !== ".md") {
      throw new Error("Markdown-Tracking muss auf .md enden.");
    }
    if (!isWithin(workspaceDir, trackingPath)) {
      throw new Error("Markdown-Tracking muss innerhalb des privaten Arbeitsbereichs liegen.");
    }
  } else if (trackingFormat === "xlsx") {
    if (extname(trackingPath).toLowerCase() !== ".xlsx") {
      throw new Error("Excel-Tracking muss auf .xlsx enden.");
    }
  } else {
    throw new Error(`Unbekanntes Tracking-Format '${trackingFormat}'.`);
  }
  const priorities = [...new Set([...DEFAULT_PRIORITIES, ...(input.priorities ?? [])])]
    .map((priority, index) => cleanText(priority, `priorities[${index}]`, 500));
  if (priorities.length > 32) throw new Error("Hoechstens 32 Nutzerprioritaeten sind erlaubt.");
  return {
    useSafeDefaults: input.useSafeDefaults === true,
    mode,
    transport,
    documentCollection,
    sourceFolders,
    connectors,
    tracking: { format: trackingFormat, path: trackingPath },
    initialReadOnlyCheck: input.initialReadOnlyCheck ?? mode === "read-only-check",
    priorities,
    settingsPath: join(workspaceDir, "settings.md"),
  };
}

const quoteMarkdown = (value: string): string => value.replaceAll("`", "'");

export function renderSettingsMarkdown(preferences: NormalizedSetupPreferences): string {
  const sourceLines = preferences.sourceFolders.length
    ? preferences.sourceFolders.map((path) => `- Lokaler Ordner: \`${quoteMarkdown(path)}\``)
    : ["- Noch kein externer Quellordner festgelegt; `documents` ist die private Sammelablage."];
  const connectorLines = preferences.connectors.length
    ? preferences.connectors.map((connector) =>
      `- ${quoteMarkdown(connector.name)}: ${connector.access === "approved" ? "Lesen freigegeben" : "nicht freigegeben"}`)
    : ["- Keine Connector-Freigabe gespeichert."];
  return [
    "# Persoenliche Einstellungen fuer SteuerSparErklaerung",
    "",
    "> Diese private Datei bleibt im lokalen Arbeitsbereich. Sie enthaelt keine API-Tokens.",
    "",
    "## Auftrag und Bedienung",
    "",
    `- Standardmodus: \`${preferences.mode}\``,
    `- Transport: \`${preferences.transport}\``,
    `- Erste Read-only-Pruefung nach dem Setup: ${preferences.initialReadOnlyCheck ? "Ja" : "Nein"}`,
    `- Sichere Standardwerte verwendet: ${preferences.useSafeDefaults ? "Ja" : "Nein"}`,
    "",
    "## Quellen",
    "",
    ...sourceLines,
    "",
    "## Connectoren",
    "",
    ...connectorLines,
    "",
    "## Ablage und Kopieren",
    "",
    `- Dokumente sammeln: \`${preferences.documentCollection}\``,
    "- Originale niemals ersetzen, verschieben oder loeschen.",
    "- Vor dem Kopieren Dateiliste und Ziel anzeigen; nur bestaetigte Kopien unter `documents` ablegen.",
    "",
    "## Tracking",
    "",
    `- Format: \`${preferences.tracking.format}\``,
    `- Datei: \`${quoteMarkdown(preferences.tracking.path)}\``,
    "- Pro Beleg Quelle, Datum, Aussteller, Betrag, Steuer, Hash, Zahlungs- und SSE-Status festhalten.",
    ...(preferences.tracking.format === "markdown"
      ? ["- API/MCP ueberschreiben keine Trackingdatei: nach Readback einen datierten Snapshot unter `tracking/` neu anlegen."]
      : ["- Die lokale API liest oder schreibt XLSX nicht; dafuer ist eine freigegebene Tabellen-Faehigkeit des Agenten noetig."]),
    "",
    "## Prioritaeten",
    "",
    ...preferences.priorities.map((priority) => `- ${priority}`),
    "",
    "## Feste Sicherheitsgrenzen",
    "",
    "- ELSTER, Senden und Uebermitteln bleiben gesperrt.",
    "- Aenderungen nur in einer hashverifizierten Arbeitskopie und nach ausdruecklicher Freigabe.",
    "- Bei widerspruechlichen Angaben zuerst diese Datei mit dem Nutzer aktualisieren.",
    "",
  ].join("\n");
}

export function renderTrackingMarkdown(): string {
  return [
    "# Beleg- und Quellen-Tracking",
    "",
    "> Private Arbeitsdatei. Originalbelege bleiben unveraendert; dieses Tracking wird nicht veroeffentlicht.",
    "> Bei API/MCP-Nutzung bleibt dieser Startstand unveraendert; Fortschritte werden als datierte Snapshots unter `tracking/` angelegt.",
    "",
    "## Quellenstatus",
    "",
    "| Quelle | Zeitraum | Vollstaendigkeit | Letzte Pruefung | Hinweis |",
    "| --- | --- | --- | --- | --- |",
    "| `documents` | offen | noch nicht inventarisiert | - | Lokale Sammelablage |",
    "",
    "## Belege",
    "",
    "| ID | Art | Datum | Aussteller/Empfaenger | Brutto | USt | Quelle/Referenz | SHA-256 | Zahlung | SSE-Status | Entscheidung |",
    "| --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- |",
    "",
    "## Offene Punkte",
    "",
    "| Prioritaet | Thema | Fehlender Nachweis | Naechste Aktion | Status |",
    "| --- | --- | --- | --- | --- |",
    "",
  ].join("\n");
}
