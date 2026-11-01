import assert from "node:assert/strict";

export const NEUTRAL_TOOLBAR_AID_SUFFIX = ".MainToolBar.tb_faden";
// Icon-only toolbars expose the same checkbox identity with an empty name.
export const NEUTRAL_TOOLBAR_SNAPSHOT_ARGUMENTS = Object.freeze({ types: ["CheckBox"], namedOnly: false });

export function neutralToolbarCheckbox(snapshot) {
  const matches = (snapshot.nodes ?? []).filter(node => node.type === "CheckBox" &&
    String(node.aid ?? "").endsWith(NEUTRAL_TOOLBAR_AID_SUFFIX));
  assert.equal(matches.length, 1, "Die neutrale Toolbar-CheckBox ist nicht eindeutig gebunden.");
  const target = matches[0];
  assert(target.on === true && target.w > 0 && target.h > 0 && typeof target.checked === "boolean",
    "Die neutrale Toolbar-CheckBox ist nicht sichtbar, aktiviert und lesbar.");
  return target;
}
