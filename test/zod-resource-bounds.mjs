import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// The constrained-collection security fix must stop before parsing elements.
// A separate small heap makes an accidental return to unbounded issue
// accumulation fail without risking the API or the test runner's own memory.
const script = `
  import { z } from "zod";
  let visited = 0;
  const element = z.preprocess(value => { visited++; return value; }, z.object({ value: z.string() }));
  const schema = z.array(element).max(16);
  const rejected = schema.safeParse(Array.from({ length: 100_000 }, () => ({ value: 42 })));
  const beforeValid = visited;
  const accepted = schema.parse([{ value: "synthetic" }]);
  process.stdout.write(JSON.stringify({ rejected: !rejected.success,
    issues: rejected.success ? [] : rejected.error.issues.map(issue => issue.code),
    visitedOversized: beforeValid, visitedValid: visited - beforeValid, accepted: accepted.length }));
`;
const result = JSON.parse(execFileSync(process.execPath,
  ["--max-old-space-size=48", "--input-type=module", "-e", script],
  { encoding: "utf8", windowsHide: true, timeout: 20_000, maxBuffer: 4096 }));
assert.deepEqual(result, { rejected: true, issues: ["too_big"],
  visitedOversized: 0, visitedValid: 1, accepted: 1 });
process.stdout.write("Zod resource bound: oversized collection rejected before element parsing in a bounded heap.\n");
