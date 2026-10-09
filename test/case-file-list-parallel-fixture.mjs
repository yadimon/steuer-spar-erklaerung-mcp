import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename, join } from "node:path";
import { CaseFileParserFallbackError, listCaseFiles } from "../dist/case-file.js";

function gate() {
  let release, timer;
  const ready = new Promise(resolve => { release = resolve; });
  let released = false;
  return {
    get ready() {
      if (!released && !timer) timer = setTimeout(release, 2000);
      return ready;
    },
    release: () => { released = true; clearTimeout(timer); release(); },
  };
}

async function observeReads(directory, hooks, action) {
  const original = fs.promises.open;
  const state = { active: 0, peak: 0, opened: [], closed: [] };
  fs.promises.open = async (...args) => {
    const handle = await original(...args);
    if (!String(args[0]).startsWith(directory + "\\")) return handle;
    const name = basename(String(args[0]));
    state.opened.push(name); state.active++; state.peak = Math.max(state.peak, state.active);
    const stat = handle.stat, close = handle.close;
    let statCalls = 0, closing = false;
    handle.stat = async function (...statArgs) {
      const value = await stat.apply(this, statArgs);
      if (++statCalls === 1) await hooks.firstStat?.(name, state);
      return value;
    };
    handle.close = async function (...closeArgs) {
      if (closing) return await close.apply(this, closeArgs);
      closing = true;
      await hooks.beforeClose?.(name, state);
      const operation = close.apply(this, closeArgs);
      // Node invalidates the FileHandle before an asynchronous close finishes;
      // stream destruction can also request the same idempotent close again.
      assert.equal(this.fd, -1, "Close must invalidate the owned FileHandle.");
      state.active--; state.closed.push(name); hooks.closed?.(name, state);
      const result = await operation;
      hooks.closeCompleted?.(name, state);
      return result;
    };
    hooks.opened?.(name, state);
    return handle;
  };
  syncBuiltinESMExports();
  try { await action(state); }
  finally { fs.promises.open = original; syncBuiltinESMExports(); }
  assert.equal(state.active, 0, "Every started case-header read must release its handle.");
  assert(state.peak <= 4, "Case-header reads must have a small fixed resource bound.");
  return state;
}

export async function testParallelCaseListing(root, profile, fixture) {
  const provision = label => {
    const directory = join(root, label); fs.mkdirSync(directory);
    for (let index = 0; index < 9; index++) {
      fs.writeFileSync(join(directory, `case-${index}.ESt2025`), fixture("not-sent", 1024));
    }
    return { directory, names: fs.readdirSync(directory) };
  };

  const ordered = provision("parallel-order");
  const firstStarted = gate(), secondClosed = gate();
  let orderedState;
  try {
    orderedState = await observeReads(ordered.directory, {
      firstStat: name => {
        if (name === ordered.names[0]) { firstStarted.release(); return secondClosed.ready; }
        return firstStarted.ready;
      },
      closed: name => { if (name === ordered.names[1]) secondClosed.release(); },
    }, async state => {
      const result = await listCaseFiles(ordered.directory, profile, { timeoutMs: 10000 });
      assert.deepEqual(result.cases.map(entry => entry.name), ordered.names,
        "Listing order must follow directory enumeration rather than read completion.");
      assert(state.peak > 1, "Independent case-header reads must overlap.");
      assert(state.closed.indexOf(ordered.names[1]) < state.closed.indexOf(ordered.names[0]),
        "The fixture must force out-of-order completion.");
    });
  } finally { firstStarted.release(); secondClosed.release(); }
  assert.equal(orderedState.opened.length, ordered.names.length);
  assert.equal(orderedState.closed.length, ordered.names.length);
  fs.writeFileSync(join(ordered.directory, ordered.names[0]), fixture("sent", 1024));
  const fresh = await listCaseFiles(ordered.directory, profile);
  assert.equal(fresh.cases[0].transmitted, true, "Listing must reread changed metadata without caching.");

  const failed = provision("parallel-failure");
  fs.writeFileSync(join(failed.directory, failed.names[0]), "malformed AKAD header");
  const laterFailureClosed = gate(), firstClosed = gate();
  try {
    const state = await observeReads(failed.directory, {
      firstStat: name => {
        if (name === failed.names[1]) fs.appendFileSync(join(failed.directory, name), Buffer.from([1]));
        if (name === failed.names[3]) return firstClosed.ready;
      },
      beforeClose: name => name === failed.names[0] ? laterFailureClosed.ready : undefined,
      closed: name => {
        if (name === failed.names[1]) laterFailureClosed.release();
        if (name === failed.names[0]) firstClosed.release();
      },
    }, async observed => {
      await assert.rejects(listCaseFiles(failed.directory, profile), error => error instanceof CaseFileParserFallbackError);
      assert.equal(observed.active, 0, "Fallback must wait for every read in the started batch.");
      assert(observed.closed.indexOf(failed.names[1]) < observed.closed.indexOf(failed.names[0]),
        "The later resource-change error must complete before the earlier parser failure.");
      assert(observed.closed.includes(failed.names[3]), "A slow successful sibling must settle before fallback.");
    });
    assert.deepEqual(state.opened.toSorted(), failed.names.slice(0, 4).toSorted(),
      "No further batch may be started after a failure.");
  } finally { laterFailureClosed.release(); firstClosed.release(); }

  const cancelled = provision("parallel-abort");
  const allStarted = gate(), abort = new AbortController();
  try {
    const state = await observeReads(cancelled.directory, {
      firstStat: () => allStarted.ready,
      opened: (_name, observed) => {
        if (observed.opened.length === 4) setImmediate(() => { abort.abort(); allStarted.release(); });
      },
    }, async observed => {
      await assert.rejects(listCaseFiles(cancelled.directory, profile, { signal: abort.signal }), error => error.kind === "aborted");
      assert.equal(observed.active, 0, "Cancellation must drain the started batch.");
    });
    assert.deepEqual(state.opened.toSorted(), cancelled.names.slice(0, 4).toSorted());
  } finally { allStarted.release(); }

  for (const mode of ["aborted", "timeout"]) {
    const mixed = provision(`parallel-mixed-${mode}`);
    fs.writeFileSync(join(mixed.directory, mixed.names[0]), "malformed AKAD header");
    const sibling = gate(), interrupted = new AbortController();
    let releaseTimer;
    try {
      await observeReads(mixed.directory, {
        firstStat: name => name === mixed.names[1] ? sibling.ready : undefined,
        closeCompleted: name => {
          if (name !== mixed.names[0]) return;
          if (mode === "aborted") setImmediate(() => { interrupted.abort(); sibling.release(); });
          else releaseTimer = setTimeout(sibling.release, 200);
        },
      }, async state => {
        await assert.rejects(listCaseFiles(mixed.directory, profile, {
          signal: interrupted.signal, timeoutMs: mode === "timeout" ? 100 : 10000,
        }), error => error.kind === mode);
        assert.equal(state.active, 0, "Interruption must drain siblings before reporting its outcome.");
        assert(state.opened.length <= 4, "Interruption must prevent any further batch.");
      });
    } finally { clearTimeout(releaseTimer); sibling.release(); }
  }
}
