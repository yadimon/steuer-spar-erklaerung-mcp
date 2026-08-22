import { z } from "zod";

export const OPTIONAL_NON_NEGATIVE_NUMBER = z.number().finite().nonnegative().nullable().optional()
  .describe("Optionaler nichtnegativer Wert");
export const OPTIONAL_FINITE_NUMBER = z.number().finite().nullable().optional()
  .describe("Optionaler endlicher Wert inklusive negativer UIA-Sentinelwerte");
export const OPTIONAL_STRING = z.string().nullable().optional().describe("Optionaler Text");
export const OPTIONAL_SHA256 = z.string().regex(/^[A-Fa-f0-9]{64}$/).nullable().optional()
  .describe("Optionaler SHA-256 der gebundenen Ressource");
export const OPTIONAL_BOOLEAN = z.boolean().nullable().optional().describe("Optionales Flag");
export const OPTIONAL_STRING_OR_BOOLEAN = z.union([z.string(), z.boolean()]).nullable().optional()
  .describe("Optionaler Text oder historisches Bestaetigungsflag");
export const OPTIONAL_TRANSMISSION_STATE = z.union([z.boolean(), z.literal("unknown")]).nullable().optional()
  .describe("Sicherer ELSTER-Uebermittlungsstatus: ja, nein oder unbekannt");
export const OPTIONAL_ARRAY = z.array(z.unknown()).nullable().optional().describe("Optionale Ergebnisliste");
export const OPTIONAL_STRING_ARRAY = z.array(z.string()).nullable().optional().describe("Optionale Textliste");
export const OPTIONAL_OBJECT = z.record(z.unknown()).nullable().optional().describe("Optionales Teilresultat");
export const OPTIONAL_MUTATION_VALUE = z.union([z.string(), z.number().finite(), z.boolean()]).nullable().optional()
  .describe("Optionaler gelesener oder geschriebener Skalarwert");

const GUARDED_MUTATION_FIELDS = {
  verified: OPTIONAL_BOOLEAN,
  inputGuard: OPTIONAL_OBJECT,
  windowGuard: OPTIONAL_OBJECT,
  rollback: OPTIONAL_OBJECT,
} as const;

export const TEXT_VALUE_MUTATION_FIELDS = {
  before: OPTIONAL_STRING,
  after: OPTIONAL_STRING,
  expectedAfter: OPTIONAL_STRING,
  page: OPTIONAL_STRING,
  pageBefore: OPTIONAL_STRING,
  pageAfter: OPTIONAL_STRING,
  method: OPTIONAL_STRING,
  ...GUARDED_MUTATION_FIELDS,
} as const;

export const TOGGLE_MUTATION_FIELDS = {
  before: OPTIONAL_BOOLEAN,
  wanted: OPTIONAL_BOOLEAN,
  after: OPTIONAL_BOOLEAN,
  expectedAfter: OPTIONAL_BOOLEAN,
  page: OPTIONAL_STRING,
  pageBefore: OPTIONAL_STRING,
  pageAfter: OPTIONAL_STRING,
  method: OPTIONAL_STRING,
  checkbox: OPTIONAL_OBJECT,
  ungespeichertVorher: OPTIONAL_BOOLEAN,
  ungespeichertNachher: OPTIONAL_BOOLEAN,
  ...GUARDED_MUTATION_FIELDS,
} as const;

export const USTVA_MUTATION_FIELDS = {
  ustva: OPTIONAL_OBJECT,
  effects: OPTIONAL_OBJECT,
} as const;

export const CLICK_RESULT_FIELDS = {
  clicked: OPTIONAL_STRING,
  pattern: OPTIONAL_STRING,
  method: OPTIONAL_STRING,
  kandidaten: OPTIONAL_NON_NEGATIVE_NUMBER,
  ueberschriftVorher: OPTIONAL_STRING,
  ueberschriftNachher: OPTIONAL_STRING,
  navigiert: OPTIONAL_BOOLEAN,
  verified: OPTIONAL_BOOLEAN,
} as const;

const CASE_LIST_ENTRY = z.object({
  name: z.string().min(1).describe("Dateiname des Steuerfalls"),
  path: z.string().nullable().optional().describe("Lokaler oder redigierter Ressourcenpfad des Steuerfalls"),
  kb: z.number().finite().nonnegative().nullable().optional().describe("Dateigroesse in gerundeten KiB"),
  modified: z.string().nullable().optional().describe("Lokaler Aenderungszeitpunkt"),
  module: z.string().nullable().optional().describe("SSE-Modulkennung aus der Dateiendung"),
  fileType: z.union([z.string(), z.number().finite()]).nullable().optional().describe("AKAD-Dateityp"),
  year: z.union([z.string(), z.number().finite()]).nullable().optional().describe("Steuerjahr aus dem AKAD-Kopf"),
  steuernummer: z.union([z.string(), z.number().finite()]).nullable().optional().describe("Steuernummer aus dem AKAD-Kopf"),
  savedBy: z.union([z.string(), z.number().finite()]).nullable().optional().describe("Speichernde SSE-Version"),
  elsterTransferTime: z.string().nullable().optional().describe("Getrimmter ELSTER-Uebermittlungszeitpunkt oder Platzhalter"),
  transmitted: z.union([z.boolean(), z.literal("unknown")]).nullable().optional()
    .describe("Sicherer ELSTER-Uebermittlungsstatus"),
  transmittedReason: z.string().nullable().optional().describe("Begruendung des ELSTER-Uebermittlungsstatus"),
  encryptedBytes: z.number().finite().nonnegative().nullable().optional()
    .describe("Im begrenzten AKAD-Kopf sichtbare verschluesselte Bytes"),
  meta: z.unknown().nullable().optional().describe("Ausfuehrliche Parsermetadaten oder null"),
}).passthrough().describe("Stabiler Eintrag der Fallliste");

export const OPTIONAL_CASE_LIST = z.array(CASE_LIST_ENTRY).nullable().optional().describe("Optionale typisierte Fallliste");
