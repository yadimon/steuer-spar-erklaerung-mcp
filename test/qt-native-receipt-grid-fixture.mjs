import assert from "node:assert/strict";

// Tests own this complete synthetic model. Production never infers model
// completeness from the visible accessibility tree.
export function receiptGridFixture(nodes, suffix = ".tableWidget_mainTabel") {
  const table = nodes.find(node => node.type === "Table" && node.aid.endsWith(suffix));
  if (!table) return null;
  const groups = new Map();
  for (const cell of nodes.filter(node => node.type === "DataItem" && node.aid === table.aid)) {
    const group = groups.get(cell.y) ?? []; group.push(cell); groups.set(cell.y, group);
  }
  const rows = [...groups.entries()].sort(([a], [b]) => a - b).map(([, cells], row) => {
    cells.sort((a, b) => a.x - b.x);
    return { row, names: cells.map(cell => cell.name), rids: cells.map(cell => cell.rid) };
  });
  const columnCount = rows[0]?.names.length ?? 9;
  assert(rows.every(row => row.names.length === columnCount));
  const headers = nodes.filter(node => ["Header", "HeaderItem"].includes(node.type) && node.aid === table.aid)
    .sort((a, b) => a.x - b.x).map(node => node.name);
  return { tableAid: table.aid, tableRid: table.rid, rowCount: rows.length, columnCount, complete: true,
    canFetchMore: false, incompleteReason: null, headers: Array.from({ length: columnCount }, (_, i) => headers[i] ?? ""),
    hiddenColumns: [], hiddenRows: [], rows };
}

export function reindexReceiptNodes(nodes) {
  const positions = new Map(nodes.map((node, i) => [node.i, i])), result = [];
  for (const [i, node] of nodes.entries()) {
    const p = positions.get(node.p) ?? -1;
    result.push({ ...node, i, p, d: p < 0 ? 0 : result[p].d + 1 });
  }
  return result;
}
