import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { readJsonFileStrict } from "./json-files.js";

const profileSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[0-9]{4}$/u),
  status: z.enum(["supported", "experimental", "disabled"]),
  operationAccess: z.enum(["full", "verification-only"]),
  product: z.string().min(1),
  taxYear: z.number().int().min(2000).max(2200),
  engineFileMajor: z.number().int().positive(),
  verifiedBuild: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/u),
  nativeQtVersion: z.string().regex(/^\d+\.\d+\.\d+$/u).optional(),
  executable: z.object({
    name: z.literal("SSE.exe"),
    installationFolderName: z.string().min(1),
    defaultRelativePath: z.string().min(1),
  }).strict(),
  startModes: z.record(z.string().min(1)),
  additionalCaseYears: z.record(
    z.string().min(1),
    z.array(z.number().int().min(2000).max(2200)).min(1),
  ),
  pageObjects: z.string().regex(/^[^\\/:]+\.json$/iu),
  policy: z.string().min(1),
}).strict().superRefine((profile, context) => {
  const relative = profile.executable.defaultRelativePath.replaceAll("\\", "/");
  const segments = relative.split("/");
  const unsafe =
    relative.startsWith("/") ||
    /^[A-Za-z]:/u.test(relative) ||
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    segments.length < 2 ||
    segments.at(-1)?.toLowerCase() !== profile.executable.name.toLowerCase() ||
    segments.at(-2)?.toLocaleLowerCase("de-DE") !== profile.executable.installationFolderName.toLocaleLowerCase("de-DE");
  if (unsafe) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["executable", "defaultRelativePath"],
      message: "defaultRelativePath muss ein sicherer relativer Pfad sein und zu EXE/Installationsordner passen.",
    });
  }
  for (const [mode, years] of Object.entries(profile.additionalCaseYears)) {
    if (!Object.hasOwn(profile.startModes, mode)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["additionalCaseYears", mode],
        message: `Zusatzjahre referenzieren unbekannten Startmodus '${mode}'.`,
      });
    }
    if (new Set(years).size !== years.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["additionalCaseYears", mode],
        message: "Zusatzjahre duerfen nicht doppelt vorkommen.",
      });
    }
    for (const year of years) {
      if (year !== profile.taxYear + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["additionalCaseYears", mode],
          message: "Ein Produktprofil darf nur das unmittelbar folgende Falljahr explizit zusaetzlich freigeben.",
        });
      }
    }
  }
});

const pageObjectTableColumnSchema = z.object({
  index: z.number().int().nonnegative(),
  header: z.string().min(1),
  controlType: z.literal("ComboBox"),
  valueKind: z.literal("enum"),
  writePolicy: z.enum(["unsupported-fail-closed", "typed-selection-required"]),
  emptyRowDefault: z.string().min(1).optional(),
  openPattern: z.enum(["Invoke", "InvokeThenVerifiedPointVisibleDesktop"]).optional(),
  optionControlType: z.literal("ListItem").optional(),
  optionSelectPattern: z.literal("SelectionItem").optional(),
  readback: z.array(z.enum(["SelectionItem.IsSelected", "ValuePattern.Value", "checker-diff"])).optional(),
  reason: z.string().min(1),
}).strict().superRefine((column, context) => {
  if (column.emptyRowDefault !== undefined && column.writePolicy !== "typed-selection-required") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["emptyRowDefault"],
      message: "Ein profilierter Leerzeilen-Default ist nur fuer eine typisierte Auswahlspalte erlaubt.",
    });
  }
  if (column.writePolicy !== "typed-selection-required") return;
  if (
    !["Invoke", "InvokeThenVerifiedPointVisibleDesktop"].includes(column.openPattern ?? "") ||
    column.optionControlType !== "ListItem" ||
    column.optionSelectPattern !== "SelectionItem" ||
    !column.readback?.includes("SelectionItem.IsSelected") ||
    !column.readback?.includes("ValuePattern.Value") ||
    !column.readback?.includes("checker-diff")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["writePolicy"],
      message: "Typed table selection requires a profiled semantic/verified open policy, ListItem, SelectionItem and all semantic/visual/checker readbacks.",
    });
  }
});

const pageObjectTableSchema = z.object({
  sumLabel: z.string().min(1),
  sumOccurrence: z.number().int().positive(),
  automationIdSection: z.string().regex(/^[A-Za-z0-9_]+$/u).optional(),
  confirmedEmptyRowCategoryDefaults: z.array(z.literal("Sonst. Leistung EU")).length(1).optional(),
  bindingPolicy: z.string().min(1),
  columns: z.array(pageObjectTableColumnSchema).min(1),
}).strict().superRefine((table, context) => {
  const indices = table.columns.map((column) => column.index);
  if (new Set(indices).size !== indices.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["columns"],
      message: "Tabellenspalten duerfen pro Page-Object nicht doppelt definiert sein.",
    });
  }
  if (table.confirmedEmptyRowCategoryDefaults !== undefined && (
    table.sumLabel !== "Summe" || table.sumOccurrence !== 2 || table.automationIdSection !== "grpEmpf13b" ||
    !table.columns.some((column) => column.index === 3 && column.header === "Kategorie" &&
      column.writePolicy === "typed-selection-required")
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmedEmptyRowCategoryDefaults"],
      message: "Der bestaetigte EU-Leerzeilendefault braucht die exakt profilierte zweite §13b-Kategoriespalte.",
    });
  }
});

const vehicleCostRegionBindingSchema = z.object({
  id: z.enum(["vehicle_costs_with_input_tax", "vehicle_costs_without_input_tax"]),
  page: z.literal("Sonstige Kfz-Kosten"),
  headingPrefix: z.literal("Sonstige Kfz-Kosten: ").optional(),
  sumLabel: z.enum([
    "Summe der sonstigen Kfz-Kosten mit Vorsteuerabzug",
    "Summe der sonstigen Kfz-Kosten ohne Vorsteuerabzug",
  ]),
  summaryAidSuffix: z.string().min(1),
  tableAidSuffix: z.literal("/.SonstigeKfzkosten./.SonstigeKfzkosten.Kosten"),
}).strict().superRefine((binding, context) => {
  const withInputTax = binding.id === "vehicle_costs_with_input_tax";
  const expectedLabel = `Summe der sonstigen Kfz-Kosten ${withInputTax ? "mit" : "ohne"} Vorsteuerabzug`;
  const section = withInputTax ? "TabSumKostMit" : "TabSumKostOhne";
  const expectedSuffix = "/.SonstigeKfzkosten./.SonstigeKfzkosten.Summen." +
    `/.SonstigeKfzkosten.Summen.${section}./.SonstigeKfzkosten.Summen.${section}.Wert`;
  if (binding.sumLabel !== expectedLabel || binding.summaryAidSuffix !== expectedSuffix) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Kfz-Summenbindung muss dem exakt bestaetigten Summen-AutomationId entsprechen.",
    });
  }
});

const pageObjectSchema = z.object({
  heading: z.string().min(1),
  navigationTreeItemName: z.string().regex(/\S/u).optional(),
  fields: z.record(z.unknown()).optional(),
  tables: z.record(pageObjectTableSchema).optional(),
}).passthrough();

const pageObjectsCompatibilitySchema = z.object({
  schemaVersion: z.literal(1),
  product: z.string().min(1),
  taxYear: z.number().int().min(2000).max(2200),
  engineFileMajor: z.number().int().positive(),
  compatibility: z.object({
    executableName: z.string().min(1),
    installationFolderName: z.string().min(1),
  }).passthrough(),
  windows: z.record(z.unknown()).refine((value) => Object.keys(value).length > 0, "Fensterkatalog darf nicht leer sein."),
  tableRegionBindings: z.array(vehicleCostRegionBindingSchema).optional(),
  checkerStartBindings: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9_]+$/u),
    documentTypes: z.array(z.enum(["ESt", "Gew", "GewErfass"])).min(1),
    controlType: z.enum(["Button", "CheckBox"]), name: z.string().min(1),
    automationIdSuffix: z.string().regex(/^\.[^\u0000-\u001f]+$/u),
    heading: z.string().min(1).optional(), pattern: z.literal("Invoke"),
    expectedToggleState: z.literal("Off").optional(),
  }).strict().superRefine((binding, context) => {
    if (binding.controlType === "CheckBox" && (binding.expectedToggleState !== "Off" || binding.heading !== undefined)
      || binding.controlType === "Button" && (!binding.heading || binding.expectedToggleState !== undefined)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Checker start must invoke either an exact page button or a proven unchecked toolbar command." });
    }
  })).optional(),
  tableComboFocusOut: z.object({
    id: z.literal("main_footer_next_focus"), controlType: z.literal("Button"), name: z.literal("Weiter"),
    automationIdSuffix: z.literal(".RedThreadContent.ClientFrameSSE.ClientFooterSSE.HoverButton"),
    action: z.literal("SetFocus"), policy: z.literal("own-typed-table-editor-only"),
  }).strict().optional(),
  tablePositionNameFocusSource: z.object({
    id: z.literal("income_position_name"), controlType: z.literal("Edit"),
    automationIdSuffix: z.literal(
      ".RedThreadContent.ClientFrameSSE.DialogWidget.DialogScrollArea.qt_scrollarea_viewport.DialogUI././.AngabenZumUmsatz./.AngabenZumUmsatz.Bezeichnung./.AngabenZumUmsatz.Bezeichnung.Text",
    ),
    tableAutomationIdSuffix: z.literal(".RedThreadContent.ClientFrameSSE.DialogWidget.DialogScrollArea.qt_scrollarea_viewport.DialogUI././.Tabelle./.Tabelle.Tab"),
    headingPrefix: z.literal("Einnahmen: "),
    headers: z.tuple([z.literal("Nr."), z.literal("Datum"), z.literal("Bezeichnung"), z.literal("Betrag"), z.literal("N"), z.literal("Netto")]),
    policy: z.literal("unchanged-position-name-only"),
  }).strict().optional(),
  pages: z.record(pageObjectSchema).refine((value) => Object.keys(value).length > 0, "Seitenkatalog darf nicht leer sein."),
}).passthrough().superRefine((catalog, context) => {
  const checkerTypes = (catalog.checkerStartBindings ?? []).flatMap((binding) => binding.documentTypes);
  const checkerIds = (catalog.checkerStartBindings ?? []).map((binding) => binding.id);
  if (new Set(checkerTypes).size !== checkerTypes.length || new Set(checkerIds).size !== checkerIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["checkerStartBindings"],
      message: "Checker start bindings must be unique by document type and policy id." });
  }
  const regionIds = (catalog.tableRegionBindings ?? []).map((binding) => binding.id);
  if (new Set(regionIds).size !== regionIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["tableRegionBindings"],
      message: "Profilierte Summen-/Tabellenbindungen duerfen nicht doppelt definiert sein.",
    });
  }
  const foldedIds = new Map<string, string>();
  for (const pageId of Object.keys(catalog.pages)) {
    const folded = pageId.toLocaleLowerCase("de-DE");
    const previous = foldedIds.get(folded);
    if (previous !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pages", pageId],
        message: `Page-Object-IDs '${previous}' und '${pageId}' unterscheiden sich nur in Gross-/Kleinschreibung.`,
      });
    } else {
      foldedIds.set(folded, pageId);
    }
  }
});

export type PageObjectsCatalog = z.infer<typeof pageObjectsCompatibilitySchema>;
export type PageObjectDefinition = PageObjectsCatalog["pages"][string];

export type PageObjectResolution =
  | { status: "found"; page: PageObjectDefinition }
  | { status: "missing" }
  | { status: "ambiguous" };

export function resolvePageObjectDefinition(
  catalog: PageObjectsCatalog,
  pageId: string,
): PageObjectResolution {
  if (Object.hasOwn(catalog.pages, pageId)) {
    return { status: "found", page: catalog.pages[pageId]! };
  }
  const foldedPageId = pageId.toLocaleLowerCase("de-DE");
  const matches = Object.keys(catalog.pages).filter(
    (candidate) => candidate.toLocaleLowerCase("de-DE") === foldedPageId,
  );
  if (matches.length !== 1) return { status: matches.length ? "ambiguous" : "missing" };
  return { status: "found", page: catalog.pages[matches[0]!]! };
}

export type ProductProfile = z.infer<typeof profileSchema> & {
  profileDir: string;
  manifestPath: string;
  pageObjectsPath: string;
  pageObjectsCatalog: PageObjectsCatalog;
};

const here = dirname(fileURLToPath(import.meta.url));
export const defaultProfilesRoot = resolve(here, "..", "profiles");

export function listProductProfileIds(root = defaultProfilesRoot): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[0-9]{4}$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function loadProductProfile(id = "2025", root = defaultProfilesRoot): ProductProfile {
  if (!/^[0-9]{4}$/u.test(id)) throw new Error(`Ungueltige SSE-Profil-ID: ${id}`);
  const profileDir = resolve(root, id);
  const manifestPath = join(profileDir, "profile.json");
  if (!existsSync(manifestPath)) throw new Error(`SSE-Profil '${id}' fehlt: ${manifestPath}`);
  const parsed = profileSchema.parse(readJsonFileStrict(manifestPath, `SSE-Profil '${id}'`));
  if (parsed.id !== id || String(parsed.taxYear) !== id) {
    throw new Error(`SSE-Profil '${id}' widerspricht id/taxYear im Manifest.`);
  }
  if (parsed.status === "disabled") {
    throw new Error(`SSE-Profil '${id}' ist abgeschaltet.`);
  }
  if (Object.keys(parsed.startModes).length === 0) throw new Error(`SSE-Profil '${id}' definiert keine Startmodi.`);
  const pageObjectsPath = join(profileDir, parsed.pageObjects);
  if (!existsSync(pageObjectsPath)) throw new Error(`Page-Objects fuer SSE-Profil '${id}' fehlen: ${pageObjectsPath}`);
  const pageObjectsCatalog = pageObjectsCompatibilitySchema.parse(
    readJsonFileStrict(pageObjectsPath, `Page-Objects fuer SSE-Profil '${id}'`),
  );
  if (
    pageObjectsCatalog.product !== parsed.product ||
    pageObjectsCatalog.taxYear !== parsed.taxYear ||
    pageObjectsCatalog.engineFileMajor !== parsed.engineFileMajor ||
    pageObjectsCatalog.compatibility.executableName.toLowerCase() !== parsed.executable.name.toLowerCase() ||
    pageObjectsCatalog.compatibility.installationFolderName.toLocaleLowerCase("de-DE") !==
      parsed.executable.installationFolderName.toLocaleLowerCase("de-DE")
  ) {
    throw new Error(`Page-Objects und Manifest des SSE-Profils '${id}' widersprechen sich.`);
  }
  return { ...parsed, profileDir, manifestPath, pageObjectsPath, pageObjectsCatalog };
}

export function isProductProfileReleased(
  profile: Pick<ProductProfile, "status" | "operationAccess">,
): boolean {
  return profile.status === "supported" && profile.operationAccess === "full";
}
