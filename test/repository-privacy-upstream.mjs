import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

/** Validate every reviewed history reference, hashing identical Git blobs once. */
export function createReviewedUpstreamHistory(root, sources, runGit = execFileSync) {
  const objects = new Map(), hashes = new Map();
  const options = { cwd: root, windowsHide: true };
  return (lines) => {
    const bindings = lines.map((line) => {
      const match = /^([a-f0-9]{40,64}):([^:]+):[0-9]+:/u.exec(line);
      return match && sources.has(match[2]) ? { object: `${match[1]}:${match[2]}`, path: match[2] } : null;
    });
    const pending = [...new Set(bindings.filter(Boolean).map((binding) => binding.object))]
      .filter((object) => !objects.has(object));
    if (pending.length) {
      const metadata = runGit("git", ["cat-file", "--batch-check"], {
        ...options, input: `${pending.join("\n")}\n`, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
      });
      const rows = metadata.trimEnd().split(/\r?\n/u);
      assert.equal(rows.length, pending.length, "Every matching historical upstream reference needs object metadata.");
      rows.forEach((row, index) => {
        const match = /^([a-f0-9]{40,64}) blob ([0-9]+)$/u.exec(row);
        assert(match, "Historical upstream reference is not a readable blob.");
        assert(Number.isSafeInteger(Number(match[2])) && Number(match[2]) <= 2 * 1024 * 1024,
          "Historical upstream blob exceeds the existing read limit.");
        objects.set(pending[index], match[1]);
      });
    }
    for (const binding of bindings.filter(Boolean)) {
      const oid = objects.get(binding.object);
      if (!hashes.has(oid)) {
        const content = runGit("git", ["cat-file", "blob", oid], { ...options, maxBuffer: 2 * 1024 * 1024 });
        hashes.set(oid, createHash("sha256").update(content).digest("hex"));
      }
    }
    return lines.filter((_, index) => !bindings[index]
      || hashes.get(objects.get(bindings[index].object)) !== sources.get(bindings[index].path));
  };
}
