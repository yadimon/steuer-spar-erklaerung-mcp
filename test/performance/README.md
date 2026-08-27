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
