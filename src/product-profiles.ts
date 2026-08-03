import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

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
});

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
  const parsed = profileSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  if (parsed.id !== id || String(parsed.taxYear) !== id) {
    throw new Error(`SSE-Profil '${id}' widerspricht id/taxYear im Manifest.`);
  }
  if (parsed.status !== "supported") throw new Error(`SSE-Profil '${id}' ist nicht produktiv freigegeben.`);
  if (Object.keys(parsed.startModes).length === 0) throw new Error(`SSE-Profil '${id}' definiert keine Startmodi.`);
  const pageObjectsPath = join(profileDir, parsed.pageObjects);
  if (!existsSync(pageObjectsPath)) throw new Error(`Page-Objects fuer SSE-Profil '${id}' fehlen: ${pageObjectsPath}`);
  const pageObjects = JSON.parse(readFileSync(pageObjectsPath, "utf8")) as Record<string, unknown>;
  if (pageObjects.taxYear !== parsed.taxYear || pageObjects.engineFileMajor !== parsed.engineFileMajor) {
    throw new Error(`Page-Objects und Manifest des SSE-Profils '${id}' widersprechen sich.`);
  }
  return { ...parsed, profileDir, manifestPath, pageObjectsPath };
}
