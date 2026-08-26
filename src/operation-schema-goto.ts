import { z } from "zod";
import { GOTO_MAX_STEPS, WINDOW_HANDLE } from "./operation-schema-primitives.js";

export const SSE_API_GOTO_SCHEMA = z.object({
  name: z.string().optional().describe("Moderner Alias fuer die exakte Zielseitenueberschrift"),
  ziel: z.string().optional().describe("Exakte Zielseitenueberschrift; historischer API-Name"),
  pageId: z.string().min(1).max(200).optional().describe(
    "Stabile Page-Object-ID; bindet dynamische Ueberschriften und Pflichtfelder semantisch",
  ),
  maxSteps: GOTO_MAX_STEPS.optional(),
  direction: z.enum(["Weiter", "Zurück"]).optional().describe("Explizite lineare Suchrichtung"),
  useSearch: z.boolean().optional().describe("Moderne Option fuer die globale Qt-Suche; Vorgabe true"),
  viaSuche: z.boolean().optional().describe("Historischer Alias fuer useSearch"),
  hwnd: WINDOW_HANDLE.optional(),
}).strict().superRefine((value, context) => {
  const hasHeading = value.name !== undefined || value.ziel !== undefined;
  if (hasHeading === (value.pageId !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Genau pageId oder name/ziel ist erforderlich." });
  }
  if (value.name !== undefined && value.ziel !== undefined && value.name !== value.ziel) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "'name' und 'ziel' widersprechen sich." });
  }
  if (value.useSearch !== undefined && value.viaSuche !== undefined && value.useSearch !== value.viaSuche) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "'useSearch' und 'viaSuche' widersprechen sich." });
  }
}).transform(({ name, ziel, useSearch, ...value }) => ({
  ...value,
  ...(ziel !== undefined || name !== undefined ? { ziel: ziel ?? name } : {}),
  ...(value.viaSuche === undefined && useSearch !== undefined ? { viaSuche: useSearch } : {}),
}));
