/** A complete business inventory needs positive page/body evidence, not just a finished tree walk. */
export interface PositionInventoryNode {
  type: string;
  name: string;
  aid: string;
  on: boolean;
  y: number;
}

type InventoryStats = { truncated?: boolean; err?: number; cyc?: number; valErr?: number; depthLimited?: boolean };
type PositionInventory = { ok: true; rows: { name: string; net: string }[]; createCaption: string }
  | { ok: false; error: string };

export const POSITION_OVERVIEW_HEADINGS = ["Erlöse Lieferungen/Leistungen", "Betriebsausgaben: Eigene Positionen"] as const;

export function readPositionInventory(
  nodes: readonly PositionInventoryNode[], stats: InventoryStats | undefined, heading: string | null,
  allowedHeadings: readonly string[] = POSITION_OVERVIEW_HEADINGS,
): PositionInventory {
  const fail = (error: string): PositionInventory => ({ ok: false, error });
  if (!stats || stats.truncated || stats.err || stats.cyc || stats.valErr || stats.depthLimited
    || heading === null || !allowedHeadings.includes(heading)) {
    return fail("Die vollstaendig geladene Positionenuebersicht wird erwartet; aktuellen Seitenzustand frisch lesen.");
  }
  const links = nodes.filter(node => node.type === "Hyperlink" && node.aid.includes(".GuideViewer."));
  const edits = links.flatMap(node => {
    const match = /^»(.*)« bearbeiten$/u.exec(node.name);
    return match ? [{ node, label: match[1]! }] : [];
  });
  const deletes = links.flatMap(node => {
    const match = /^»(.*)« löschen$/u.exec(node.name);
    return match ? [{ node, label: match[1]! }] : [];
  });
  if (links.some(node => /^».*« erfassen$/u.test(node.name)
    || (node.name.startsWith("»") && /[\r\n\u2028\u2029]/u.test(node.name))) || edits.some(row => !row.label || !row.node.on)
    || deletes.some(row => !row.label || !row.node.on)) {
    return fail("Die Uebersicht enthaelt eine unvollstaendige oder nicht lesbare Position; kein vollstaendiges Inventar.");
  }
  const names = new Set(edits.map(row => row.label));
  const deleteNames = new Set(deletes.map(row => row.label));
  if (names.size !== edits.length || deleteNames.size !== deletes.length || deletes.some(row => !names.has(row.label))) {
    return fail("Positionsnamen oder Zeilenaktionen sind nicht eindeutig und vollstaendig zugeordnet.");
  }
  const rows: { name: string; net: string }[] = [];
  for (const row of edits) {
    const amounts = nodes.filter(node => node.type === "Text" && node.on && node.aid.includes(".GuideViewer.")
      && Math.abs(node.y - row.node.y) < 10 && /^-?(?:[0-9]{1,3}(?:\.[0-9]{3})*|[0-9]+),[0-9]{2}$/u.test(node.name));
    if (amounts.length !== 1) return fail("Eine Positionssumme fehlt oder ist mehrdeutig; kein vollstaendiges Inventar.");
    rows.push({ name: row.label, net: amounts[0]!.name });
  }
  const empty = nodes.filter(node => node.type === "Text" && node.on && node.aid.includes(".GuideViewer.")
    && node.name === "Sie haben noch keine Angaben erfasst");
  const createCaption = rows.length ? "Weitere Position erfassen" : "Position erfassen";
  const commands = links.filter(node => node.on && ["Position erfassen", "Weitere Position erfassen"].includes(node.name));
  if (empty.length !== (rows.length ? 0 : 1) || commands.length !== 1 || commands[0]!.name !== createCaption) {
    return fail("Positionsinventar und Erfassungsbefehl sind nicht vollstaendig geladen und eindeutig gebunden.");
  }
  return { ok: true, rows, createCaption };
}
