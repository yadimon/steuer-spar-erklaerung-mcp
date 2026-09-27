import type { WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import type { QtNativeClient } from "./qt-native-client.js";
import { qtNativeContentBounds } from "./qt-native-pages.js";
import { byPosition, psEquals } from "./qt-native-projections.js";
import { readQtNativeSnapshot, type QtSnapshotNode } from "./qt-native-snapshot.js";

/**
 * Direct Qt port of the worker branch 'help': the right-hand help column
 * (Eingabehilfe, Steuertipps, Pruefer) read from one accessibility snapshot.
 * Every string and every field name below is the worker's; only the tree
 * source changed.
 */

// Windows PowerShell `-in` compares strings case-insensitively like `-eq`.
const psIn = (value: string, set: readonly string[]) => set.some(candidate => psEquals(value, candidate));

const SECTION_HEADINGS = ["Eingabehilfe", "Steuertipps", "Prüfer", "Steuer-Spar-Tipps"] as const;
const SKIPPED_NAMES = ["Mehr Details", "Details"] as const;
const TEXT_TYPES = ["Text", "Hyperlink", "TreeItem", "Button"] as const;
const HELP_HINT = "Die Hilfe wechselt mit dem angewaehlten Feld. Fuer feldbezogene Hilfe erst das Feld anwaehlen.";

const fail = (kind: string, error: string): WorkerResult => ({ ok: false, backend: "qt", kind, error });

interface HelpEntry { typ: string; text: string }
interface HelpSection { text: string; zeilen: string[]; verweise: string[] }

/**
 * A PowerShell [ordered] hashtable keeps insertion order and looks keys up
 * case-insensitively while reporting the first spelling it saw. Both traits
 * decide the emitted section keys, so they are mirrored here explicitly.
 */
class OrderedSections {
  private readonly keys: string[] = [];
  private readonly entries = new Map<string, HelpEntry[]>();

  private lookup(key: string): string | undefined {
    return this.keys.find(known => psEquals(known, key));
  }

  ensure(key: string): HelpEntry[] {
    const known = this.lookup(key);
    if (known !== undefined) return this.entries.get(known)!;
    this.keys.push(key);
    const list: HelpEntry[] = [];
    this.entries.set(key, list);
    return list;
  }

  *sections(): IterableIterator<[string, HelpEntry[]]> {
    for (const key of this.keys) yield [key, this.entries.get(key)!];
  }
}

function projectSection(entries: readonly HelpEntry[]): HelpSection {
  // Qt exposes a linked help line twice: once as Text and once as Hyperlink.
  // Immediate (case-sensitive, -ceq) repeats are therefore one line, not two.
  const zeilen: string[] = [];
  for (const entry of entries) {
    if (!psIn(entry.typ, TEXT_TYPES)) continue;
    if (zeilen.length && zeilen[zeilen.length - 1] === entry.text) continue;
    zeilen.push(entry.text);
  }
  const verweise = entries.filter(entry => psEquals(entry.typ, "Hyperlink")).map(entry => entry.text);
  return { text: zeilen.join(" "), zeilen, verweise };
}

/** Same projection as the worker's 'help' branch over an already observed node set. */
export function qtNativeHelpProjection(
  nodes: readonly QtSnapshotNode[], windowRect: { x: number; w: number },
): { seite: string | null; abschnitte: Record<string, HelpSection> } {
  const bounds = qtNativeContentBounds([...nodes], windowRect);
  const rechts = nodes.filter(node => node.x > bounds.maxX && node.name).sort(byPosition);
  const abschnitte = new OrderedSections();
  let aktuell = "Allgemein";
  for (const node of rechts) {
    if (psIn(node.name, SECTION_HEADINGS)) {
      aktuell = node.name;
      abschnitte.ensure(aktuell);
      continue;
    }
    if (psIn(node.name, SKIPPED_NAMES)) continue;
    abschnitte.ensure(aktuell).push({ typ: node.type, text: node.name });
  }
  const ausgabe: Record<string, HelpSection> = {};
  for (const [key, entries] of abschnitte.sections()) ausgabe[key] = projectSection(entries);
  const ueberschrift = nodes.filter(node => psEquals(node.type, "Text") && node.x >= bounds.minX && node.x <= bounds.maxX)
    .sort((a, b) => a.y - b.y)[0];
  return { seite: ueberschrift ? ueberschrift.name : null, abschnitte: ausgabe };
}

/** Read the help column of the bound page without starting a PowerShell worker. */
export async function executeQtNativeHelp(
  client: QtNativeClient,
  args: Readonly<Record<string, unknown>>,
  timeoutMs: number,
  signal?: AbortSignal,
  _profile?: ProductProfile,
): Promise<WorkerResult> {
  const snapshot = await readQtNativeSnapshot(client, { hwnd: args.hwnd, maxNodes: 4000 }, timeoutMs, signal);
  if (!snapshot.windowEnabled || snapshot.modalBlocked) {
    return fail("dialog-open", "Ein modaler Dialog blockiert die gebundene Seite; keine Hilfe ausgegeben.");
  }
  if (snapshot.stats.truncated) {
    return fail("native-incomplete", "Der native Seitenbaum ueberschreitet die Lesegrenze; keine unvollstaendige Hilfe ausgegeben.");
  }
  const { seite, abschnitte } = qtNativeHelpProjection(snapshot.nodes, snapshot.windowRect);
  return { ok: true, seite, abschnitte, hinweis: HELP_HINT, backend: "qt", nativeDurationMs: snapshot.nativeDurationMs };
}
