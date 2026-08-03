import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";

export const RESOURCE_AREAS = ["cases", "documents", "workspace", "results", "backups"] as const;
export type ResourceArea = (typeof RESOURCE_AREAS)[number];

export type ResourceRoots = Record<ResourceArea, string | undefined>;

export interface ParsedResourceReference {
  area: ResourceArea;
  relativePath: string;
  ref: string;
}

export interface ResolvedResourceReference extends ParsedResourceReference {
  path: string;
  root: string;
}

const AREA_SET = new Set<string>(RESOURCE_AREAS);
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function nearestExistingAncestor(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = win32.dirname(current);
    if (parent === current) throw new Error("Ressourcenziel hat keinen existierenden, sicheren Vorfahren.");
    current = parent;
  }
  return current;
}

function normalizeRelativePath(value: string): string {
  if (!value || value.includes("\0") || value !== value.trim()) {
    throw new Error("Ressourcenreferenz braucht einen nicht leeren, normalisierten relativen Pfad.");
  }
  if (win32.isAbsolute(value) || value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value)) {
    throw new Error("Absolute Pfade sind in Ressourcenreferenzen nicht erlaubt.");
  }
  if (value.includes(":")) {
    throw new Error("Doppelpunkte sind im relativen Teil einer Ressourcenreferenz nicht erlaubt.");
  }

  const parts: string[] = [];
  for (const part of value.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") throw new Error("Ressourcenreferenz darf kein '..' enthalten.");
    if (/[<>"|?*]/.test(part) || /[. ]$/.test(part) || WINDOWS_DEVICE_NAME.test(part)) {
      throw new Error(`Ungueltiges Windows-Pfadsegment in Ressourcenreferenz: '${part}'.`);
    }
    parts.push(part);
  }
  return parts.length ? parts.join("/") : ".";
}

export function formatResourceReference(area: ResourceArea, relativePath: string): string {
  return `${area}:${normalizeRelativePath(relativePath)}`;
}

export function parseResourceReference(
  value: string,
  allowedAreas: readonly ResourceArea[] = RESOURCE_AREAS,
): ParsedResourceReference {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new Error("Ressourcenreferenz muss eine nicht leere Zeichenkette sein.");
  }
  const separator = value.indexOf(":");
  if (separator < 1) throw new Error("Ressourcenreferenz muss das Format 'bereich:relativer/pfad' haben.");
  const areaText = value.slice(0, separator);
  if (!AREA_SET.has(areaText)) throw new Error(`Unbekannter Ressourcenbereich: '${areaText}'.`);
  const area = areaText as ResourceArea;
  if (!allowedAreas.includes(area)) {
    throw new Error(`Ressourcenbereich '${area}' ist fuer diesen Aufruf nicht erlaubt.`);
  }
  const relativePath = normalizeRelativePath(value.slice(separator + 1));
  return { area, relativePath, ref: `${area}:${relativePath}` };
}

export function resolveResourceReference(
  roots: ResourceRoots,
  value: string,
  allowedAreas: readonly ResourceArea[] = RESOURCE_AREAS,
): ResolvedResourceReference {
  const parsed = parseResourceReference(value, allowedAreas);
  const configuredRoot = roots[parsed.area];
  if (!configuredRoot) throw new Error(`Ressourcenbereich '${parsed.area}' ist lokal nicht konfiguriert.`);
  if (!win32.isAbsolute(configuredRoot)) {
    throw new Error(`Lokaler Ressourcenbereich '${parsed.area}' ist nicht absolut konfiguriert.`);
  }
  if (!existsSync(configuredRoot)) {
    throw new Error(`Lokaler Ressourcenbereich '${parsed.area}' existiert nicht.`);
  }

  const root = realpathSync(configuredRoot);
  const candidate = parsed.relativePath === "." ? root : resolve(root, ...parsed.relativePath.split("/"));
  if (!inside(root, candidate)) throw new Error("Ressourcenreferenz verlaesst ihren konfigurierten Bereich.");

  const existing = existsSync(candidate) ? candidate : nearestExistingAncestor(candidate);
  if (!inside(root, realpathSync(existing))) {
    throw new Error("Ressourcenreferenz folgt einer Junction oder einem Link aus ihrem Bereich heraus.");
  }
  const path = existsSync(candidate) ? realpathSync(candidate) : candidate;
  if (!inside(root, path)) {
    throw new Error("Ressourcenreferenz folgt einer Junction oder einem Link aus ihrem Bereich heraus.");
  }
  return { ...parsed, root, path };
}

interface PreparedResourceRoot {
  area: ResourceArea;
  root: string;
  embeddedPattern: RegExp;
}

function prepareResourceRoots(roots: ResourceRoots): PreparedResourceRoot[] {
  return RESOURCE_AREAS.flatMap((area) => {
    const configuredRoot = roots[area];
    if (!configuredRoot || !win32.isAbsolute(configuredRoot)) return [];
    const root = existsSync(configuredRoot) ? realpathSync(configuredRoot) : resolve(configuredRoot);
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [{ area, root, embeddedPattern: new RegExp(`${escaped}(?:[\\\\/])?`, "gi") }];
  }).sort((left, right) => right.root.length - left.root.length);
}

function referenceForPreparedRoots(prepared: readonly PreparedResourceRoot[], value: string): string | undefined {
  if (typeof value !== "string" || !win32.isAbsolute(value)) return undefined;
  const candidate = existsSync(value) ? realpathSync(value) : resolve(value);
  const match = prepared.find((entry) => inside(entry.root, candidate));
  if (!match) return undefined;
  const rel = relative(match.root, candidate).replaceAll("\\", "/") || ".";
  try {
    return formatResourceReference(match.area, rel);
  } catch {
    return `${match.area}:[lokaler-pfad-entfernt]`;
  }
}

export function createResourcePathRedactor(roots: ResourceRoots): <T>(value: T) => T {
  return <T>(value: T): T => {
    // Einmal pro API-Ergebnis aktualisieren: keine Syscalls pro Nutzstring,
    // aber neu eingebundene Netzwerk-/Wechsellaufwerke bleiben erkennbar.
    const prepared = prepareResourceRoots(roots);
    const redact = <V>(entry: V): V => {
      if (Array.isArray(entry)) return entry.map((item) => redact(item)) as V;
      if (entry && typeof entry === "object") {
        return Object.fromEntries(
          Object.entries(entry as Record<string, unknown>).map(([key, item]) => [redact(key), redact(item)]),
        ) as V;
      }
      if (typeof entry !== "string") return entry;
      const exactRef = referenceForPreparedRoots(prepared, entry);
      if (exactRef) return exactRef as V;

      let redacted: string = entry;
      for (const { area, embeddedPattern } of prepared) {
        redacted = redacted.replace(embeddedPattern, `${area}:`);
      }
      redacted = redacted.replace(
        /\b(cases|documents|workspace|results|backups):([^\s"'<>|;,\)\]\}\r\n]*)/g,
        (_match, area: string, tail: string) => `${area}:${tail.replaceAll("\\", "/")}`,
      );
      return redacted as V;
    };
    return redact(value);
  };
}

export function referenceForAbsolutePath(roots: ResourceRoots, value: string): string | undefined {
  return referenceForPreparedRoots(prepareResourceRoots(roots), value);
}

export function redactResourcePaths<T>(roots: ResourceRoots, value: T): T {
  return createResourcePathRedactor(roots)(value);
}
