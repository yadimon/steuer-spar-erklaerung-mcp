import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { readJsonFileStrict } from "./json-files.js";

const profileSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[0-9]{4}$/u),
  status: z.enum(["supported", "experimental", "disabled"]),
  product: z.string().min(1),
  taxYear: z.number().int().min(2000).max(2200),
  engineFileMajor: z.number().int().positive(),
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
});

const pageObjectSchema = z.object({
  heading: z.string().min(1),
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
  pages: z.record(pageObjectSchema).refine((value) => Object.keys(value).length > 0, "Seitenkatalog darf nicht leer sein."),
}).passthrough();

export type ProductProfile = z.infer<typeof profileSchema> & {
  profileDir: string;
  manifestPath: string;
  pageObjectsPath: string;
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
  if (parsed.status !== "supported") throw new Error(`SSE-Profil '${id}' ist nicht produktiv freigegeben.`);
  if (Object.keys(parsed.startModes).length === 0) throw new Error(`SSE-Profil '${id}' definiert keine Startmodi.`);
  const pageObjectsPath = join(profileDir, parsed.pageObjects);
  if (!existsSync(pageObjectsPath)) throw new Error(`Page-Objects fuer SSE-Profil '${id}' fehlen: ${pageObjectsPath}`);
  const pageObjects = pageObjectsCompatibilitySchema.parse(
    readJsonFileStrict(pageObjectsPath, `Page-Objects fuer SSE-Profil '${id}'`),
  );
  if (
    pageObjects.product !== parsed.product ||
    pageObjects.taxYear !== parsed.taxYear ||
    pageObjects.engineFileMajor !== parsed.engineFileMajor ||
    pageObjects.compatibility.executableName.toLowerCase() !== parsed.executable.name.toLowerCase() ||
    pageObjects.compatibility.installationFolderName.toLocaleLowerCase("de-DE") !==
      parsed.executable.installationFolderName.toLocaleLowerCase("de-DE")
  ) {
    throw new Error(`Page-Objects und Manifest des SSE-Profils '${id}' widersprechen sich.`);
  }
  return { ...parsed, profileDir, manifestPath, pageObjectsPath };
}
