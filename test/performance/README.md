# Synthetic API tax journey benchmark

This harness repeatedly runs the existing `test/api-tax-journeys.mjs` suite.
Those 38 journeys use temporary synthetic case files and the stateful mock
worker; they do not start SSE.exe, drive a GUI, submit through ELSTER, or read
real tax data.

```powershell
npm run perf:tax-journeys -- --warmup 2 --iterations 10
npm run perf:tax-journeys -- --warmup 1 --iterations 5 --output C:\temp\sse-perf-run
```

The parameters may instead be set with `SSE_PERF_WARMUP`,
`SSE_PERF_ITERATIONS`, and `SSE_PERF_OUTPUT`. CLI options take precedence.

By default, `samples.jsonl`, `operations.jsonl`, and `summary.json` are written
below the ignored `.tmp/performance/` directory. Each measurement contains wall time and an
aggregation of the existing value-free operation traces. The summary contains
nearest-rank p50/p90/p95/p99 values, outcome-kind counts, the Git
commit/working-tree fingerprint, and a path-free Node/OS/CPU runtime
fingerprint. `operations.jsonl` preserves every warmup and measurement
operation as an exact, value-free record; temporary per-process trace files are
deleted after this sanitized append-only copy has been written.

## Deterministic receipt workloads

The receipt workload is a separate, product-free benchmark. It creates an
explicit external corpus with exactly 50, 250, or 1,000 deterministic, minimal
valid PDF documents, then executes the same supported receipt upsert/link plan
directly against two fresh stateful test-worker models: once in one-item plans
and once in stable chunks of at most 20.

```powershell
npm run perf:receipt-workload -- --count 50 --seed canonical-20260828 `
  --fixture-root C:\temp\sse-receipts-50 `
  --output C:\temp\sse-receipts-50-results
```

Both target directories are mandatory, must not exist, must be disjoint, and
must stay outside the repository. The manifest uses relative paths only and is
revalidated with real contained file paths and exact hashes before execution.
Generated documents and all result JSON/JSONL remain outside Git. After a
failure, the runner removes only a fully materialized corpus whose manifest,
contained files, sizes, and hashes still prove ownership; it never recursively
deletes an unproven fixture root. The cleanup record says whether a partial
synthetic corpus remains.

The semantic oracle covers values, canonicalized classification sets, links, source hashes,
row order/identity, drafts, and the synthetic allocator. Invalid values,
an unsupported currency field, stale hashes, ambiguous identities,
duplicate content, missing metadata, updates, no-ops, skips, and already-linked
entries have deterministic dispositions and no-mutation checks. Raw direct
worker-call and logical-item records contain no titles, notes, resource
references, or absolute paths. Workload-item, schema-rejected-item, directly
worker-executed-item, and direct-call counts are reported separately.

Timing is a descriptive, fixed-order mock measurement; exact direct-call
reduction is structural evidence, but the timing ratio is not a causal product
speed claim. This benchmark does not start SSE.exe and does not prove API/MCP
mutation execution, PowerShell behavior, installed BelegManager mutation, or
product speed. Public API/MCP receipt mutations remain foreground-required and
are tested separately to return the same structured block before resource
resolution or worker dispatch. Live mutation remains blocked until activation
plus a verified disposable case and separately backed-up disposable
BelegManager data copy are available.

## API/MCP arrivals and bounded soak

The API load workload is also product-free. It wraps the real loopback HTTP
server and real MCP stdio child around a schema-valid synthetic `find`
executor. Raw simultaneous 1/4/8-caller bursts measure the API's intentional
fail-fast single-flight contract: exactly one request is admitted and every
other valid request receives `busy`; the API has no server queue. A separate
harness-owned round-robin queue completes the same caller shapes and reports
client queue wait, transport time, and their sum as true end-to-end time; it
never invents an API queue wait.

```powershell
$outputRoot = Join-Path $env:TEMP "sse-api-load-soak-new"
npm run perf:api-load-soak -- --output $outputRoot
```

The explicit command is fixed at 1,008 alternating API/MCP `find` operations
across eight callers with the last arrival scheduled at 900,000 ms. This is a
single-operation transport soak, not a mixed-command or installed-worker soak.
Immediately before that scheduled interval, lifecycle controls exercise MCP
cancellation and timeout propagation, an injected synthetic executor failure
and recovery, same-port API restart, and MCP child replacement. Two genuinely
post-cleanup quiescence observations remain at least five seconds apart.

A persistent test-only Windows PowerShell observer polls registered process
roots and snapshot-discovered descendants; once discovered, a descendant stays
identity-bound for the rest of the run. It records cumulative CPU,
working/private memory, OS handle counts, immutable process identities,
current-desktop owned-window counts, and global `SSE.exe` count on an absolute
five-second schedule. The canonical gate rejects missed samples, severe
latency/queue/resource drift, live registered or snapshot-observed descendants,
and visible owned windows. Any MCP fallback termination revalidates creation
time, image name, and image-path digest on the exact process object and refuses
an identity mismatch. This polling evidence cannot prove the absence of a
short-lived descendant that both appears and becomes orphaned between samples.
If the run fails, partial operation, lifecycle, executor, and resource telemetry
is still hashed and retained. Raw records omit arguments, results, URLs, paths,
titles, and request values.

This is concurrency, stability, cleanup, and product-free latency evidence. It
does not drive UIA, mutate receipts or a tax case, establish installed-product
speed, or replace the activation/disposable-data prerequisites for live work.
