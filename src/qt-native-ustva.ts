import type { WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import { QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import { qtNativeContentBounds, qtNativeHeading } from "./qt-native-pages.js";
import { readQtNativeSnapshot, type QtSnapshotNode } from "./qt-native-snapshot.js";
import { normalizeUstvaCurrentPage } from "./ustva.js";

const fieldTypes = new Set(["Edit", "ComboBox", "CheckBox", "RadioButton"]);
const byPosition = (a: QtSnapshotNode, b: QtSnapshotNode) => a.y - b.y || a.x - b.x;

function transmissionName(name: string): boolean {
  const normalized = name.toLowerCase().replaceAll("ä", "a").replaceAll("ö", "o").replaceAll("ü", "u").replaceAll("ß", "ss")
    .replace(/[^\p{L}\p{N}]/gu, "");
  return ["elster", "versend", "versand", "ubermittl", "ubermittel", "abschick", "nachreich", "abschliess", "datenubertrag", "transfer"]
    .some(stem => normalized.includes(stem)) || normalized.startsWith("senden");
}

/** A single GUI-thread snapshot projected directly into the established UStVA read model. */
export async function executeQtNativeUstvaRead(
  client: QtNativeClient,
  args: Readonly<Record<string, unknown>>,
  timeoutMs: number,
  signal?: AbortSignal,
  profile?: ProductProfile,
): Promise<WorkerResult> {
  const snapshot = await readQtNativeSnapshot(client, { hwnd: args.hwnd, maxNodes: 5000 }, timeoutMs, signal);
  if (!snapshot.windowEnabled || snapshot.modalBlocked) {
    return { ok: false, backend: "qt", kind: "dialog-open",
      error: "Ein modaler Dialog blockiert die gebundene UStVA-Seite; keine Werte ausgegeben." };
  }
  if (snapshot.stats.truncated) {
    throw new QtNativeTransportError("The UStVA tree exceeds the native read bound.", "native-incomplete");
  }
  const bounds = qtNativeContentBounds(snapshot.nodes, snapshot.windowRect);
  const captionMinX = bounds.navErkannt ? bounds.minX : bounds.winX;
  const texts = snapshot.nodes.filter(node => node.type === "Text" && node.name
    && node.x >= captionMinX && node.x <= bounds.maxX);
  const fields = snapshot.nodes.filter(node => fieldTypes.has(node.type)
    && node.x >= bounds.minX && node.x <= bounds.maxX).sort(byPosition).map(field => {
      const label = texts.filter(text => Math.abs(text.y - field.y) <= 14 && text.x < field.x)
        .sort((a, b) => field.x - a.x - (field.x - b.x))[0]?.name || field.name;
      return {
        label,
        typ: field.type,
        wert: field.type === "CheckBox" ? field.checked : field.type === "RadioButton" ? field.selected : field.val,
        schreibgeschuetzt: field.ro,
        aid: field.aid.split(".").at(-1) ?? field.aid,
        rid: field.rid,
        y: field.y,
      };
    });
  const actions = snapshot.nodes.filter(node => ["Button", "Hyperlink"].includes(node.type) && node.name)
    .map(node => ({ name: node.name, gesperrt: transmissionName(node.name) }));
  const normalized = normalizeUstvaCurrentPage({
    ok: true,
    ueberschrift: qtNativeHeading(snapshot.nodes, profile),
    felder: fields,
    aktionen: actions,
    blockiert: false,
    prueferMeldungen: [],
    dialoge: [],
  });
  return { ...normalized, backend: "qt", nativeDurationMs: snapshot.nativeDurationMs };
}
