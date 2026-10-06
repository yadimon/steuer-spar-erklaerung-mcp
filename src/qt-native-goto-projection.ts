import type { ProductProfile } from "./product-profiles.js";
import { knownHeadingMatches, qtNativeContentBounds, qtNativeHeading, qtNativeKnownHeading } from "./qt-native-pages.js";
import { containerDescendants, findContainerNode, psEquals } from "./qt-native-projections.js";
import type { QtSnapshotNode, readQtNativeSnapshot } from "./qt-native-snapshot.js";

export type GotoSnapshot = Awaited<ReturnType<typeof readQtNativeSnapshot>>;
export type GotoPage = Record<string, unknown>;
export type GotoDirection = "Weiter" | "Zurück";
export const repeatedPagingTitles = ["Innergem. Erwerb, § 13b UStG und Einfuhr", "Abziehbare Vorsteuer", "Vorsteuer aus anderen Rechnungen"];

/** Get-SSEPagingOrder: the mapped form path, not the session's back history. */
export function pagingOrder(year: number): string[] {
  return [
    "Umsatzsteuerzahlungen/-Erstattungen", "Übersicht Betriebseinnahmen", "Erlöse Lieferungen/Leistungen",
    "Einnahmen: Freiberufler", "Erlöse aus Anlagenverkäufen", "Kapitalerträge und sonstige Einnahmen",
    "Private Nutzungen: Sonstiges", "Unberechtigt ausgewiesene Umsatzsteuer", "Betriebsausgaben",
    "Material-/Wareneinkauf", "Innergem. Erwerb, § 13b UStG und Einfuhr", "Fremdleistungen", "Personalkosten",
    "Abschreibung", "Wirtschaftsgüter des Anlagevermögen", "Investitionsabzugsbeträge (IAB)",
    "Raum- und Grundstückskosten/Homeoffice", "Arbeitszimmer/andere Arbeitsräume/Homeoffice",
    "1. Arbeitszimmer/Arbeitsraum/Homeoffice", "Schuldzinsen", "Beiträge, Gebühren und Abgaben",
    "Versicherungen (ohne Gebäude oder Kfz)", "Reisekosten", "1. Reise", "Öffentliche Verkehrsmittel",
    "1. Reise: Verpflegung / Übernachtung", "1. Reise: Übernachtung", "Sonstige Kosten", "Privatanteil Reisekosten",
    "Geschenke bis 50,- €", "Bewirtungskosten", "Wege zum Betrieb (Entfernungspauschale)", "Portokosten",
    "Telefon/Mobilfunk/Internet", "Bürobedarf", "Fachliteratur", "Fortbildungskosten", "Rechts- und Beratungkosten",
    "Miete/Leasing beweglicher Wirtschaftsgüter", "Werbung und Reklame", "Sonstige Betriebsausgaben",
    "Werkzeuge und Kleingeräte", "EDV-Kosten", "Vorsteuer (Übersicht)", "Sonstige Vorsteuerbeträge",
    "Betriebsausgaben: Eigene Positionen", "Journal und BWA", "Zusatzangaben zur Anlage EÜR", "Entnahmen/Einlagen",
    `Umsatzsteuererklärung ${year}`, "Lieferungen/Leistungen zu 19%", "Unentgeltliche Wertabgaben zu 19%",
    "Lieferungen/Leistungen zu 7%", "Unentgeltliche Wertabgaben zu 7%", "Umsätze zu anderen Steuersätzen",
    "Warenbezug von Unternehmen aus dem EU-Ausland", "Steuerschuldner nach § 13b UStG", "Abziehbare Vorsteuer",
    "Vorsteuer aus anderen Rechnungen", `Vorsteuerberichtigungen ${year}`, "Steuerfreie Umsätze",
    "Meldepflichtige oder nicht steuerbare Umsätze", `Umsatzsteuer-Voranmeldungen ${year}`, "Weitere Erlöse zu 19%",
    "Weitere Umsätze", "Steuerschuldnerschaft nach § 13b UStG",
  ];
}

export interface GotoRoute {
  direction: GotoDirection; checkedBack: boolean; budget: number; target: string; startIndex: number; targetIndex: number;
}
/** Get-SSEGotoRoute: one direction and one total bounded step budget. */
export function gotoRoute(order: string[], start: string, target: string, direction?: GotoDirection, maxSteps?: number): GotoRoute {
  const startIndex = repeatedPagingTitles.includes(start) ? -1 : order.indexOf(start), targetIndex = order.indexOf(target);
  const known = startIndex >= 0 && targetIndex >= 0;
  const checkedBack = !direction && known && targetIndex < startIndex;
  const budget = known ? (startIndex === targetIndex ? 0 : Math.abs(targetIndex - startIndex) + 20)
    : startIndex >= 0 ? order.length - 1 - startIndex + 20 : targetIndex >= 0 ? targetIndex + 1 + 20 : order.length + 20;
  return { direction: direction ?? (checkedBack ? "Zurück" : "Weiter"), checkedBack,
    budget: maxSteps === undefined ? budget : Math.min(budget, maxSteps), target, startIndex, targetIndex };
}

/** Test-SSEGotoLanding, including the repeated §13b detail and checked back-history deviation. */
export function gotoLanding(route: GotoRoute, order: string[], position: number, landing: string) {
  if (route.checkedBack) {
    if (position > 0 && landing === order[position - 1]) return { verdict: "continue", position: position - 1 };
    if (landing === repeatedPagingTitles[0]) return { verdict: "continue", position };
    return { verdict: "deviation", position };
  }
  if (route.direction !== "Weiter") return { verdict: "continue", position: order.indexOf(landing) };
  if (repeatedPagingTitles.includes(landing)) return { verdict: "continue", position };
  const index = order.indexOf(landing, position + 1);
  if (index < 0) return { verdict: "continue", position };
  return { verdict: route.targetIndex >= 0 && index > route.targetIndex ? "overshoot" : "continue", position: index };
}

/** Only a unique enabled label fully inside the catalogue's navigation tree. */
export function visibleNavigationItem(nodes: QtSnapshotNode[], name: string): QtSnapshotNode | null {
  const tree = findContainerNode(nodes, "NavWidgetSSE", "Tree");
  if (!name || !tree || tree.w <= 0 || tree.h <= 0) return null;
  const matches = containerDescendants(nodes, "NavWidgetSSE", "TreeItem", "Tree").filter(node => node.name === name);
  const item = matches.length === 1 ? matches[0]! : null;
  return item && item.on && item.w > 0 && item.h > 0 && item.x >= tree.x && item.y >= tree.y
    && item.y + item.h <= tree.y + tree.h ? item : null;
}

/** Select-SSESearchHit: title column only, exact uniqueness before first accepted dynamic title. */
export function selectSearchHit(nodes: QtSnapshotNode[], target: string, page?: GotoPage): QtSnapshotNode | null {
  const table = findContainerNode(nodes, "DialogSearchResultsTableView", "Table");
  if (!target || !table) return null;
  const rowFirsts = new Map<number, QtSnapshotNode>();
  for (const cell of containerDescendants(nodes, "DialogSearchResultsTableView", "DataItem", "Table")) {
    const first = rowFirsts.get(cell.y);
    if (!first || cell.x < first.x) rowFirsts.set(cell.y, cell);
  }
  const titles = new Map([...rowFirsts.values()].map(node => [node.i, node]));
  const cellOf = new Map<number, QtSnapshotNode | null>([[table.i, null]]);
  const exact = new Set<QtSnapshotNode>(), accepted = new Set<QtSnapshotNode>();
  for (const node of nodes) {
    if (node.i === table.i || !cellOf.has(node.p)) continue;
    const cell = titles.get(node.i) ?? cellOf.get(node.p) ?? null;
    cellOf.set(node.i, cell);
    if (!cell || !["DataItem", "Text", "Hyperlink"].includes(node.type)) continue;
    if (node.name === target) exact.add(cell);
    else if (page && node.name && knownHeadingMatches(node.name, page)) accepted.add(cell);
  }
  if (exact.size === 1) return [...exact][0]!;
  return exact.size === 0 && accepted.size ? [...accepted][0]! : null;
}

/** Get-SSEFieldLabelBindings + Select-SSESummaryFromNodes over one complete tree. */
export function summaryFromNodes(snapshot: GotoSnapshot, label: string, occurrence: number) {
  const bounds = qtNativeContentBounds(snapshot.nodes, snapshot.windowRect);
  const texts = snapshot.nodes.filter(node => node.type === "Text" && node.name && node.x >= bounds.minX && node.x <= bounds.maxX);
  const fields = snapshot.nodes.filter(node => ["Edit", "ComboBox", "Spinner"].includes(node.type)
    && node.x >= bounds.minX && node.x <= bounds.maxX);
  const found: Array<{ label: string; value: string; y: number; x: number }> = [];
  for (const field of fields) {
    // Stable ties retain the original snapshot ordinal, as the worker's X sweep does.
    const caption = texts.filter(text => text.x < field.x && Math.abs(text.y - field.y) <= 14).sort((a, b) => b.x - a.x)[0];
    if (caption && (psEquals(caption.name, label) || caption.name.startsWith(label)))
      found.push({ label: caption.name, value: field.val || field.name, y: field.y, x: field.x });
  }
  found.sort((a, b) => a.y - b.y || a.x - b.x);
  const exact = found.filter(item => psEquals(item.label, label));
  const unique = new Map<string, typeof found[number]>();
  for (const item of exact.length ? exact : found) {
    const key = `${item.y}|${item.value}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].sort((a, b) => a.y - b.y)[occurrence - 1] ?? null;
}

/** Heading, all exact known fields, and every profiled table/sum must belong to this same complete read. */
export function gotoTargetState(snapshot: GotoSnapshot, profile: ProductProfile, target: string, page?: GotoPage) {
  const heading = page ? qtNativeKnownHeading(snapshot.nodes, profile, page) : qtNativeHeading(snapshot.nodes, profile);
  const headingMatches = page ? knownHeadingMatches(heading, page) : heading !== null && psEquals(heading, target);
  if (!headingMatches) return { heading, headingMatches, ready: false };
  const fields = page?.fields && typeof page.fields === "object" ? Object.values(page.fields) : [];
  for (const raw of fields) {
    const field = raw as Record<string, unknown>, relative = String(field.automationIdRelative ?? "");
    const matches = relative ? snapshot.nodes.filter(node => node.aid.endsWith(relative)) : [];
    if (matches.length !== 1 || matches[0]!.type !== field.controlType) return { heading, headingMatches, ready: false };
  }
  const policies = Object.values(profile.pageObjectsCatalog.focuslessCommits ?? {}).filter(raw => {
    const policy = raw as Record<string, unknown>;
    return policy.heading === heading && policy.controlType === "DataItem";
  });
  for (const raw of policies) {
    const policy = raw as Record<string, unknown>, suffix = String(policy.automationIdSuffix ?? "");
    const checks = Array.isArray(policy.requiredSumChecks) ? policy.requiredSumChecks : [];
    const tables = snapshot.nodes.filter(node => node.type === "Table" && node.on && node.w > 0 && node.h > 0 && node.aid.endsWith(suffix));
    if (!suffix || !checks.length || tables.length !== 1 || qtNativeHeading(snapshot.nodes, profile) !== heading)
      return { heading, headingMatches, ready: false };
    for (const rawCheck of checks) {
      const check = rawCheck as Record<string, unknown>;
      const label = String(check.label ?? ""), occurrence = Number(check.occurrence ?? 1);
      if (!label || !Number.isSafeInteger(occurrence) || occurrence < 1) return { heading, headingMatches, ready: false };
      const sum = summaryFromNodes(snapshot, label, occurrence);
      if (!sum || sum.label !== label || !sum.value.trim()) return { heading, headingMatches, ready: false };
    }
  }
  return { heading, headingMatches, ready: true };
}
