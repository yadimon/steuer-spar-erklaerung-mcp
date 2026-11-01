import assert from "node:assert/strict";
import { USTVA_VALUE_FIELDS } from "../dist/ustva.js";

export function readUstvaViewport(snapshot) {
  assert(Array.isArray(snapshot.nodes), "UStVA snapshot nodes are missing.");
  for (const property of ["truncated", "depthLimited"]) assert.equal(snapshot.stats?.[property], false);
  for (const property of ["err", "cyc"]) assert.equal(snapshot.stats?.[property], 0);
  const unique = (suffix, type) => {
    const matches = snapshot.nodes.filter(node => typeof node.aid === "string" && node.aid.endsWith(suffix));
    assert.equal(matches.length, 1, "UStVA viewport identity is missing or ambiguous.");
    const node = matches[0];
    assert.equal(node.type, type, "UStVA viewport identity has the wrong control type.");
    assert([node.x, node.y, node.w, node.h].every(Number.isFinite) && node.w > 0 && node.h > 0,
      "UStVA viewport geometry is incomplete.");
    return node;
  };
  const viewport = unique(".DialogWidget.DialogScrollArea.qt_scrollarea_viewport", "Group");
  const body = unique(".DialogWidget.DialogScrollArea.qt_scrollarea_viewport.DialogUI", "Group");
  const field = unique(USTVA_VALUE_FIELDS.special_advance_payment.aid, "Edit");
  assert.equal(body.aid, viewport.aid + ".DialogUI", "UStVA body belongs to a different viewport.");
  assert(field.aid.startsWith(body.aid + "."), "UStVA target belongs to a different content area.");
  assert.equal(field.on, true, "UStVA target is disabled.");
  return { viewport, body, field, overflow: body.h > viewport.h };
}

export function assertUstvaFieldVisible(snapshot) {
  const state = readUstvaViewport(snapshot), { field, viewport } = state;
  assert(field.x >= viewport.x && field.y >= viewport.y && field.x + field.w <= viewport.x + viewport.w &&
    field.y + field.h <= viewport.y + viewport.h, "UStVA target is not fully inside its own viewport.");
  return state;
}
