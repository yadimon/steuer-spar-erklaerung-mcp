import type { PageObjectsCatalog } from "./product-profiles.js";
import { rejectProof, type CompleteModel } from "./table-cursor-proofs.js";

type Scalar = string | number | boolean | null;
export type RequestedNativeEditRole = {
  wanted: string; edit: Scalar; mode: "exact" | "numeric" | "checkbox";
};

export function amountEqual(actual: unknown, expected: unknown) {
  const normalize = (value: unknown) => {
    const text = String(value ?? "").trim().replace(/\s|€/gu, "");
    const canonical = text.includes(",") ? text.replaceAll(".", "").replace(",", ".") : text;
    return /^[+-]?[0-9]+(?:\.[0-9]{1,2})?$/u.test(canonical) ? Number(canonical) : null;
  };
  const a = normalize(actual), b = normalize(expected);
  return a !== null && b !== null && a === b;
}

function knownEditRole(model: CompleteModel, row: number, column: number, wanted: string): Scalar {
  const prior = model.values[row]![column]!;
  const candidates = model.values.map(cells => cells[column]!).filter(cell =>
    String(cell.display ?? "") === wanted && cell.flags === prior.flags && cell.checkState === null && cell.edit !== null);
  const roles = new Map(candidates.map(cell => [JSON.stringify([typeof cell.edit, cell.edit]), cell.edit]));
  if (roles.size !== 1) rejectProof("mutation-requested-edit-role-unknown-or-ambiguous");
  return [...roles.values()][0]!;
}

/** Bind role values before any cursor input or mutation. Numeric enum codes are never inferred. */
export function bindRequestedNativeEditRoles(model: CompleteModel, row: number, columns: number[],
  args: Record<string, unknown>, tableAid: string, catalog?: PageObjectsCatalog) {
  const values = args.werte;
  if (!Array.isArray(values) || values.length > columns.length) return rejectProof("mutation-requested-values-shape");
  const expected = new Map<number, RequestedNativeEditRole>();
  for (let visible = 0; visible < columns.length; visible++) {
    const wanted: unknown = values[visible];
    if (wanted === null || wanted === undefined) continue;
    if (typeof wanted !== "string") return rejectProof("mutation-requested-value-type");
    const column = columns[visible]!, header = String(model.headers[column] ?? ""), prior = model.values[row]![column]!;
    if ((prior.flags & 16) !== 0 || prior.checkState !== null) {
      if (!["true", "false"].includes(wanted)) rejectProof("mutation-requested-checkbox-value");
      expected.set(column, { wanted, edit: typeof prior.edit === "boolean" ? wanted === "true" : prior.edit, mode: "checkbox" });
      continue;
    }
    const profiled = Object.values(catalog?.pages ?? {}).flatMap(page => Object.values(page.tables ?? {}))
      .filter(table => table.automationIdSection && table.sumLabel === args.sumLabel
        && table.sumOccurrence === (args.sumOccurrence ?? 1)
        && tableAid.split(/[./]/u).includes(table.automationIdSection))
      .flatMap(table => table.columns).filter(profile => profile.index === visible && profile.header === header
        && profile.controlType === "ComboBox" && profile.valueKind === "enum" && profile.writePolicy === "typed-selection-required");
    if (profiled.length > 1) rejectProof("mutation-requested-enum-profile-ambiguous");
    if (profiled.length === 1) {
      expected.set(column, { wanted, edit: knownEditRole(model, row, column, wanted), mode: "exact" });
    } else if (header === "Kategorie") {
      rejectProof("mutation-requested-enum-profile-missing");
    } else if (header === "Datum") {
      // New date formats require a concrete display/edit pair in this same
      // complete model. No speculative parse or normalization follows a write.
      expected.set(column, { wanted, edit: knownEditRole(model, row, column, wanted), mode: "exact" });
    } else if (["Betrag", "Netto", "%", "MwSt"].includes(header)) {
      if (!["string", "number"].includes(typeof prior.edit) || !amountEqual(prior.display, prior.edit)
        || !amountEqual(wanted, wanted)) rejectProof("mutation-requested-numeric-edit-format");
      expected.set(column, { wanted, edit: wanted, mode: "numeric" });
    } else {
      const cells = model.values.map(cells => cells[column]!);
      if (typeof prior.edit !== "string" || prior.display !== prior.edit
        || cells.some(cell => String(cell.display ?? "") !== "" && (typeof cell.edit !== "string" || cell.display !== cell.edit))) {
        rejectProof("mutation-requested-text-edit-format");
      }
      expected.set(column, { wanted, edit: wanted, mode: "exact" });
    }
  }
  return expected;
}
