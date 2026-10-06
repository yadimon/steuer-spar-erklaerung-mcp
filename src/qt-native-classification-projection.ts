import { z } from "zod";
import { receiptPolicySchema } from "./qt-native-receipts.js";
import { powershellCompactJson, textSha256 } from "./qt-native-projections.js";

export type ClassificationKind = "categories" | "persons";
const chooser = z.object({ chooserAutomationIdSuffix: z.string().min(1), chooserExpectedName: z.string().min(1),
  listAutomationIdSuffix: z.string().min(1) }).strict();
const dialog = z.object({ title: z.string().min(1), classPattern: z.string().min(1), rootAutomationId: z.string().min(1),
  tableAutomationId: z.string().min(1), toggleColumn: z.number().int().nonnegative(), labelColumn: z.number().int().nonnegative(),
  saveAutomationId: z.string().min(1), cancelAutomationId: z.string().min(1), manageAutomationId: z.string().min(1),
  manageExpectedName: z.string().min(1), fingerprint: z.string().regex(/^[A-Fa-f0-9]{64}$/u) }).strict();
export const classificationPolicySchema = receiptPolicySchema.extend({
  controls: receiptPolicySchema.shape.controls.extend({ classification: z.object({ categories: chooser, persons: chooser }).strict() }),
  classificationDialogs: z.object({ categories: dialog, persons: dialog }).strict(),
});
export type ClassificationPolicy = z.infer<typeof classificationPolicySchema>;
export type ClassificationDialogPolicy = ClassificationPolicy["classificationDialogs"][ClassificationKind];
const option = z.object({ index: z.number().int().nonnegative(), name: z.string().min(1), selected: z.boolean(),
  toggleRid: z.string().regex(/^42\.-?\d+(?:\.4\.-?\d+)?$/u), toggleAid: z.string().min(1), toggleName: z.string(),
  enabled: z.boolean(), visible: z.boolean() }).strict();
export const classificationGridSchema = z.object({ ok: z.literal(true), hwnd: z.number().int().safe().positive(),
  tableAid: z.string().min(1), rowCount: z.number().int().min(0).max(500), columnCount: z.number().int().min(2).max(20),
  complete: z.literal(true), canFetchMore: z.literal(false), options: z.array(option).max(500) }).passthrough();
export type ClassificationOption = z.infer<typeof option>;
export type ClassificationGrid = z.infer<typeof classificationGridSchema>;

export class ClassificationError extends Error {
  constructor(message: string, readonly kind = "postcondition-failed", readonly outcomeUnknown = false) { super(message); }
}

/** The worker hashes the output pipeline, whose zero/one/many shapes differ. */
export function classificationOptionsFingerprint(options: readonly Pick<ClassificationOption, "index" | "name" | "selected">[]): string {
  const values = options.map(({ index, name, selected }) => ({ index, name, selected }));
  return textSha256(values.length === 0 ? "" : powershellCompactJson(values.length === 1 ? values[0] : values));
}

export function validateClassificationGrid(raw: unknown, hwnd: number, policy: ClassificationDialogPolicy): ClassificationGrid {
  const result = classificationGridSchema.parse(raw);
  if (result.hwnd !== hwnd || result.tableAid !== policy.tableAutomationId || result.rowCount !== result.options.length
    || policy.toggleColumn >= result.columnCount || policy.labelColumn >= result.columnCount || policy.toggleColumn === policy.labelColumn)
    throw new ClassificationError("The complete option grid differs from its exact window/table/column binding.", "stale");
  const names = new Set<string>(), targets = new Set<string>();
  for (const [index, value] of result.options.entries()) {
    const name = value.name.toLowerCase();
    if (value.index !== index || value.name !== value.name.trim() || names.has(name) || targets.has(value.toggleRid)
      || value.toggleAid !== policy.tableAutomationId)
      throw new ClassificationError("The option grid has a missing, duplicate or differently bound row.", "profile-contract");
    names.add(name); targets.add(value.toggleRid);
  }
  return result;
}

export const selectedClassification = (grid: ClassificationGrid) => grid.options.filter(value => value.selected).map(value => value.name);
export const sameClassificationDomain = (left: ClassificationGrid, right: ClassificationGrid) =>
  left.rowCount === right.rowCount && left.columnCount === right.columnCount
    && left.options.every((value, index) => value.index === right.options[index]?.index && value.name === right.options[index]?.name);
export const sameClassificationGrid = (left: ClassificationGrid, right: ClassificationGrid) =>
  sameClassificationDomain(left, right) && left.options.every((value, index) => value.selected === right.options[index]?.selected);
export const sameClassificationSet = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every(value => right.includes(value));
