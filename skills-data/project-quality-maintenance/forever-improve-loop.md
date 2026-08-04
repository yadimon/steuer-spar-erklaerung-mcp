# Forever Improvement Plan

Last verified: 2026-08-04 05:33
Verification mode: corrected full-refresh

## 1) Scope And Guardrails

- Mode: quality-only; existing API/MCP behavior may become safer, faster, clearer
  and more broadly tested, but no tax-submission feature may be added.
- ELSTER, sending and every other transmission to the tax authority stay hard
  blocked.
- Real tax data, local case paths, screenshots and hashes stay outside Git.
- Preserve the direct-API-core / PC-blind-MCP-wrapper boundary.

## 2) Workspace Fingerprint

- Repo shape: single npm package; the bootstrap scanner's `monorepo` result is
  a false positive caused by ignored generated copies.
- Generated or ignored copies under `.tmp/` and `artifacts/` are not workspaces.
- Runtime: Node.js 22+, TypeScript, Windows PowerShell 5.1-compatible worker,
  bundled C# helper DLL.
- Main components: `src/` API and MCP wrapper, `powershell/sse-worker.ps1`
  desktop worker, `test/` contract/integration suite, `skills/` public skills.

## 3) Baseline Snapshot

- Date/time: 2026-08-04 00:05 Europe/Berlin.
- Branch/commit: `main` at `3cb9535`, with the tested UStVA worktree changes
  intentionally still uncommitted while the requested Claude review is blocked
  by missing authentication.
- Command: `npm test`.
- Result: pass in 64,232 ms.
- Coverage: 85 API operations, 85 PC-blind MCP schemas, portable package,
  API/MCP parity, console-window sentinel, product gates and hash-bound checks.
- Expected skip: archive fixture test when `SSE_ARCHIVE_FIXTURE` is absent.

## 4) Smoke Verification Before Reuse

- Confirm `package.json`, `src/`, `powershell/` and `test/run-suite.mjs` exist.
- Confirm `.tmp/` and `artifacts/` remain ignored and excluded from inventory.
- Run `npm run build:ts` plus impacted tests for Tier 0.
- Run `npm test` for Tier 1 before committing a cross-cutting change.

## 5) Prioritized Backlog

| ID | Priority | Category | Files/Area | Planned Change | Validation | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Q-001 | P1 | performance | `test/run-suite.mjs` | Measure individual steps and safely parallelize independent tests without reducing coverage | timing contract + `npm test` | done |
| Q-002 | P1 | refactor | API composition | Extract declarative operation handlers from the executor and remove repeated mutation envelopes | focused contracts + `npm test` | done |
| Q-003 | P1 | coverage | MCP/API catalog | Add option/button/method matrix and generic fallback coverage | catalog and wrapper tests | done |
| Q-004 | P1 | reliability | MCP/API errors | Preserve structured fail-closed diagnostics through wrapper and scenarios | error contract tests | done |
| Q-005 | P2 | docs | README/architecture | Keep performance, fallback and safety documentation aligned with measured behavior | docs contract + `npm test` | done |
| Q-006 | P1 | safety | scenarios/workspace | Restrict error continuation to read-only work and reject malformed UTF-8 instead of silently replacing bytes | control-flow + containment contracts | done |
| Q-007 | P1 | coverage | direct API router | Exercise every operation through the authenticated HTTP boundary and prove strict unknown-argument rejection before execution | 86-operation route matrix | done |
| Q-008 | P1 | coverage | UStVA | Cover every supported period, flag, amount field and section without adding submission behavior | UStVA contract | done |
| Q-009 | P1 | security | dependencies | Remove known production dependency advisories without a direct or major dependency upgrade | `npm audit --omit=dev` + full suite | done |
| Q-010 | P2 | reliability | API process lifecycle | Audit startup, shutdown, logging and transport edge cases; add focused contracts for material gaps | API-main contracts + `npm test` | done |
| Q-011 | P1 | safety | worker transport | Remove every direct submission bypass and bound/strictly decode worker output | product gate + worker timeout | done |
| Q-012 | P1 | safety | scenario engine | Preflight every operation and allow only read-only/cleanup operations in `finally` | scenario control-flow contract | done |
| Q-013 | P1 | coverage | MCP plus HTTP | Send all 86 tools through the real MCP process and authenticated validating API router | combined end-to-end matrix | done |
| Q-014 | P2 | agent UX | operation traits | Publish one typed read-only/destructive catalog as MCP annotations and capabilities | wrapper + capabilities contracts | done |
| Q-015 | P2 | reliability | setup backups | Verify overwrite-backup integrity and avoid partial configuration drift | setup-wizard contract | done |
| Q-016 | P1 | reliability | API response path | Bound and strictly decode API responses and screenshot attachments | API/API-main contracts | done |
| Q-017 | P2 | reliability | setup/profile | Fully stage setup writes and fail early on page-object compatibility drift | atomic/setup/profile contracts | done |
| Q-018 | P1 | reliability | scenario result | Reject unknown scenario fields and always retain a bounded deterministic result report | scenario control-flow + parity | done |
| Q-019 | P1 | safety | operation inputs/traits | Bound UI argument trees and classify every operation as read-only or stateful | catalog/wrapper/capabilities | done |
| Q-020 | P1 | safety | output files | Prevent screenshot overwrite and bound all screenshot file reads | resource/API-main contracts | done |
| Q-021 | P2 | refactor | API executor | Extract workspace and scenario execution from central orchestration | focused workspace/scenario gates | done |
| Q-022 | P1 | reliability | worker queue/types | Bound queued UI work and enable stricter undefined, optional, return and unused-code compiler gates | worker timeout + TypeScript build | done |
| Q-023 | P1 | reliability | API lifecycle/transport | Keep logging failures non-fatal and bound loopback listener headers, request bodies and keep-alive lifetime | API/API-main contracts | done |
| Q-024 | P2 | refactor | MCP transport | Extract strict registration, cancellation, argument budgets and error translation from the tool catalog | wrapper boundary/catalog/cancellation | done |
| Q-025 | P1 | safety | local files/images | Bound config, profile, setup and workspace reads; verify screenshot metadata and PNG signature | setup/workspace/API-main/wrapper contracts | done |
| Q-026 | P1 | safety | direct worker | Reject malformed/non-object direct arguments and strictly bound profile/desktop-marker reads | product gate | done |
| Q-027 | P2 | release | npm package | Verify a small, source-free npm artifact with API, MCP, setup, profiles and both public skills | npm pack contract | done |
| Q-028 | P1 | safety | output targets | Remove the last `save_as` overwrite option and enforce new screenshot/export/save targets before UI work | schema/resource/product gates | done |
| Q-029 | P1 | reliability | copies/backups/archive | Use exclusive no-overwrite file creation, verify backup bytes, make rollback ownership-aware and replace the archive fixture gap with synthetic AKAD coverage | backup/archive/product contracts | done |
| Q-030 | P3 | refactor | API/worker helpers | Remove duplicate array helpers and keep one shared normalization authority | TypeScript build + API/worker contracts | done |
| Q-031 | P1 | safety | workspace/worker output | Revalidate real paths while listing and bind worker response files to exclusive temp names | containment + worker-output contracts | done |
| Q-032 | P2 | agent UX | public click/catalog | Advertise only executable click patterns and validate every profile/option through API and MCP | capability/profile/route matrices | done |
| Q-033 | P1 | privacy/performance | repository/tests | Add a public-repo privacy gate and split direct worker checks from the API product gate | privacy + full-suite timing | done |
| Q-034 | P1 | reliability | MCP registry | Catch and redact unexpected synchronous/asynchronous tool-handler failures at the transport boundary | MCP registry contract | done |
| Q-035 | P1 | setup safety | scheduled-task launcher | Replace the fixed overwriteable VBS launcher with exclusive, content-addressed creation | setup-task contract | done |
| Q-036 | P1 | output safety | collect artifacts | Make every collection result immutable and remove the long-running hash-overwrite path | schema/direct-worker/wrapper contracts | done |
| Q-037 | P1 | output safety | workspace/scenarios | Make text and scenario results immutable, reuse identical results and divert conflicts to deterministic references | containment/scenario parity | done |
| Q-038 | P2 | performance | direct worker tests | Split independent worker guards so the suite can schedule them in parallel | suite plan + measured focused runs | done |
| Q-039 | P1 | release safety | portable package | Delete only owned portable build outputs and verify existing ZIP/checksum pairs before replacement | portable package contract | done |
| Q-040 | P1 | agent safety | generic selectors | Require meaningful selectors locally in MCP/API and support conjunctive type-only discovery without HTTP/UI work on invalid calls | schema/wrapper/capability matrices | done |
| Q-041 | P1 | reliability | worker JSON reads | Stream and strictly decode bounded verification/recovery JSON instead of allocating an unbounded file | direct file guard | done |
| Q-042 | P1 | performance safety | UI numeric inputs | Bound loops, snapshots, waits and coordinates in MCP/API and before direct Worker window resolution | schema/direct-worker/wrapper matrices | done |
| Q-043 | P1 | identity safety | API/MCP/worker | Use one safe-integer contract for every HWND/PID and reject direct bypasses before window inventory | schema/wrapper/direct-worker | done |
| Q-044 | P1 | performance safety | UI collections | Bound occurrences, table columns, VaSt plans, verification sets, readbacks and archive lists in all layers | schema/direct-worker matrices | done |
| Q-045 | P2 | test performance | worker guards | Separate resource-heavy direct guards from process/input guards for bounded parallel execution | suite-runner + full timing | done |
| Q-046 | P1 | privacy/reliability | worker transport | Replace Base64 process arguments with exclusive bounded JSON argument files and hidden-desktop forwarding | input/setup/console contracts | done |
| Q-047 | P1 | cleanup safety | worker transport | Surface argument-file write/delete failures on spawn, success, timeout and cancellation | worker input/timeout/cancellation | done |
| Q-048 | P2 | API UX | API client | Validate schemas and request body size before loopback HTTP without changing valid wire aliases | API/MCP matrices | done |
| Q-049 | P1 | direct worker safety | argument preflight | Enforce depth/node/string/list budgets before profile, native and UI initialization | input/resource/product contracts | done |
| Q-050 | P2 | agent UX | capabilities | Publish request, response, worker and operation-domain limits in the PC-blind runtime contract | capabilities/wrapper contracts | done |
| Q-051 | P1 | reliability/refactor | PowerShell transport | Share temp-root validation and bounded strict UTF-8 reads between worker and hidden launcher | input/output/setup/product contracts | done |
| Q-052 | P2 | API UX | authenticated discovery | Publish all 86 API argument schemas, traits, limits and safety status without requiring MCP | discovery/API/package contracts | done |
| Q-053 | P2 | test reliability | isolated worker fixtures | Keep one complete Worker-runtime file inventory for profile and native-drift installations | profile/native/privacy/full suite | done |
| Q-054 | P2 | test performance | direct resource guards | Schedule numeric, identity and collection bypass probes independently without reducing PID/desktop assertions | focused timing + full suite | done |
| Q-055 | P2 | developer feedback | fast test tier | Add a bounded fast loop that retains broad API/MCP/schema/privacy coverage while full tests own real Worker, portable and console gates | fast-plan contract + measured run | done |
| Q-056 | P2 | API interoperability | OpenAPI | Project the same 86 authenticated runtime schemas and traits into OpenAPI 3.1 without a second permissive catalog | OpenAPI/API/fast/package contracts | done |
| Q-057 | P1 | API resource safety | response envelope | Enforce the 40-MiB response bound before socket writes and distinguish oversized output from a disconnected client | oversized response/API/fast contracts | done |
| Q-058 | P2 | API client UX | discovery client | Add bounded authenticated discovery/OpenAPI readers that require exact v1 operation/path coverage before use | API protocol and mismatch contracts | done |
| Q-059 | P2 | agent UX | direct API CLI | Add a config-aware CLI with bounded argument files and explicitly reject values embedded in process arguments | CLI/package/portable contracts | done |
| Q-060 | P2 | public skills | direct API fallback | Teach both German runtime skills to use the portable CLI/Discovery and keep argument values out of process lists | public skill/privacy contracts | done |
| Q-061 | P2 | CLI reliability | config precedence | Make explicit `--config` authoritative over stale SSE environment overrides | hostile-environment CLI contract | done |
| Q-062 | P2 | agent discovery | capabilities | Publish the direct CLI and authenticated Discovery/OpenAPI paths through the PC-blind MCP capability response | capability/wrapper contracts | done |
| Q-063 | P1 | dependency compatibility | Zod floor | Align the declared Zod range with schema conversion and the 86-tool TypeScript depth requirement | install graph/audit/fast suite | done |
| Q-064 | P2 | API maintainability | JSONL logging | Extract bounded rotation from API startup and keep serialization/file failures non-fatal | logger contract + API-main smoke | done |
| Q-065 | P2 | test performance | suite scheduling | Raise the measured concurrency cap and start long conflict-free gates earlier | runner contract + repeated full timing | done |
| Q-066 | P2 | public clarity | historical audit | Mark the pre-hardening security report as historical and remove machine-local links | privacy gate + link scan | done |
| Q-067 | P2 | skill distribution | npx scanner | Verify both public German skills through the real `npx skills` discovery path | `npx skills add . --list` | done |
| Q-068 | P2 | API efficiency | single discovery | Serve and validate one operation schema/traits through HTTP, CLI and OpenAPI without loading the full catalog | API/CLI/OpenAPI/fast contracts | done |
| Q-069 | P1 | agent safety | launch dialog guidance | Replace stale generic-click recovery guidance with fingerprint-bound dialog handling | real MCP catalog + product gate | done |
| Q-070 | P2 | skill compatibility | Codex/Claude install | Install both public skills in an isolated project for both agents and compare source/copy hashes | real `npx skills add --agent codex claude-code --copy` | done |
| Q-071 | P1 | API configuration | explicit precedence | Make `--config` authoritative for both server and CLI over inherited `SSE_*` values | hostile-environment config/CLI/real-server contracts | done |
| Q-072 | P2 | API entrypoint UX | strict arguments | Provide setup-free help and reject every unknown, missing or extra server argument | parser/real-process/package contracts | done |
| Q-073 | P2 | setup portability | Windows contract | Express the actual x64/PowerShell 5.1 requirement instead of an artificial Windows 10/11 allowlist | public-skill and portable contracts | done |
| Q-074 | P1 | release identity | next beta | After the required review, bump source/docs/artifact together instead of changing the already published beta.2 identity | version/package/full/release checks | pending |
| Q-075 | P2 | release evidence | public assets | Verify the existing beta.2 tag, ZIP and checksum asset before changing public guidance | GitHub release metadata + public URL | done |
| Q-076 | P1 | package completeness | new runtime surfaces | Require all four bins plus CLI, discovery, OpenAPI and bounded logger in the public npm dry-run | build + package + public-skill contracts | done |
| Q-077 | P1 | runtime configuration | override separation | Clear only config-bearing variables for `--config` while preserving the managed PowerShell runtime override | config/CLI/real-server contracts | done |
| Q-078 | P2 | logging resilience | inherited state | Remove inherited oversized rotations and make diagnostic sinks fully best-effort | logger + API-main contracts | done |
| Q-079 | P1 | log privacy | request-derived errors | Keep arbitrary request field names and all other request-derived message text out of operational logs | API privacy + lifecycle contracts | done |
| Q-080 | P1 | MCP privacy | startup stacks | Redact Windows file URLs as well as native paths from MCP errors and startup diagnostics | registry + real failed process + full wrapper contracts | done |
| Q-081 | P1 | Windows file safety | device references | Reject CON/PRN/AUX/NUL/COM/LPT segments in published resource schemas as well as central resolution | schema/resource/discovery contracts | done |
| Q-082 | P1 | client protocol | discovery validation | Require exact schema markers, traits, safety, versions, Bearer security and GET/POST methods before trusting API documents | corrupt-document/API/CLI/fast contracts | done |
| Q-083 | P2 | dependencies | current compatible line | Confirm no compatible updates or advisories and intentionally avoid unreviewed Zod/TypeScript/Node-type major migrations | `npm outdated` + production audit | done |
| Q-084 | P1 | agent safety metadata | destructive traits | Mark generic point clicks and VaSt mapping selection as potentially destructive; verify field-tool mappings and the neutral search-field exception | capabilities/OpenAPI/real MCP catalog | done |
| Q-085 | P2 | MCP maintainability | tool/schema modules | Split tool registrations and their schemas into the same six bounded domains while retaining one exact 86-operation API projection | module boundary/API/MCP matrices | done |
| Q-086 | P2 | agent UX | schema descriptions | Describe every nested MCP and direct API argument property and reject undocumented future fields in Discovery contracts | 344 MCP plus 376 API property assertions | done |
| Q-087 | P2 | source maintainability | architecture | Keep every TypeScript module below 24 KiB and reject internal import cycles | source architecture contract + fast suite | done |
| Q-088 | P2 | setup UX | entrypoint | Give setup a strict, side-effect-free help/error path and lazy-load the interactive wizard | setup process contract + package/portable gates | done |
| Q-089 | P2 | API-only fallback | Discovery | Publish selectors, click/dialog rules and the generic fallback ladder in full and per-operation Discovery | client/API/OpenAPI contracts | done |
| Q-090 | P1 | release verification | full gate | Re-run portable, Worker, product and exclusive no-console gates after the modularization and setup changes | `npm test` plus privacy/audit/diff checks | done |
| Q-091 | P1 | MCP isolation | transitive boundary | Scan all MCP modules and their local dependency closure; allow only API URL/token environment knowledge and reject PC-runtime reachability | wrapper boundary + fast/stress suites | done |
| Q-092 | P1 | native integrity | DLL loader | Bind both C# source and compiled DLL bytes before `Add-Type`; bound/strictly decode the manifest and exercise source drift, DLL tampering and malformed manifests | native/product/portable gates | done |
| Q-093 | P2 | public repository | documentation links | Repair the broken historical reference and verify every local Markdown/image/data target outside generated trees | link contract + fast suite | done |
| Q-094 | P1 | npm completeness | Worker runtime | Require the entire isolated Worker/native/hidden-launcher runtime, including the integrity manifest, in the npm dry-run artifact | package contract | done |
| Q-095 | P2 | dependency reliability | lock metadata | Synchronize and enforce root CLI/dependency metadata between `package.json` and `package-lock.json` | lock parity + package contract + production audit | done |
| Q-096 | P2 | Windows maintainability | syntax coverage | Parse every runtime and test PowerShell script with Windows PowerShell 5.1 in both fast and full plans | 17-file parser contract | done |
| Q-097 | P2 | test ergonomics | bounded output | Keep successful full-suite output compact while retaining opt-in verbose output and a bounded failure excerpt | runner contract + fast/full suites | done |
| Q-098 | P1 | native integrity | bounded reads | Recheck source, DLL and manifest sizes on opened read-locked streams and reject malformed source UTF-8 during the build | native/product/PowerShell gates | done |
| Q-099 | P0 | worker isolation | cleanup circuit breaker | Refuse queued and future UI work after the process tree cannot be proven terminated even after the hard watchdog | worker timeout + product + full gates | done |
| Q-100 | P1 | MCP privacy/recovery | cross-platform paths | Redact Windows, UNC, file-URL and common POSIX local paths while preserving web URLs; publish explicit isolation-loss recovery | registry + 86-tool/509-roundtrip matrix | done |
| Q-101 | P1 | API client integrity | response binding | Disable redirects, request JSON and validate UUID/duration/error envelopes before accepting API results | API contract + MCP catalog/cancellation | done |
| Q-102 | P2 | setup recovery | partial artifacts | Detect any of the four generated setup targets before the write phase and offer the same redacted-backup decision with default no | setup contract + architecture gate | done |
| Q-103 | P2 | HTTP interoperability | response headers | Publish Bearer challenge, method allowlist and same-origin/no-store/nosniff headers without enabling CORS | API contract + source architecture | done |
| Q-104 | P0 | file safety | resource topology | Reject nonnumeric config ports, control characters and overlapping case/document/result/backup roots before API or setup writes | config/setup/resource/architecture gates | done |
| Q-105 | P1 | MCP privacy | direct response contract | Cover encoded Windows file URLs plus Windows, UNC, Linux-root and macOS paths while proving HTTPS/API/date text survives | dedicated response + registry + wrapper gates | done |
| Q-106 | P2 | API protocol | OpenAPI parity | Reject empty JSON POST bodies and publish the implemented 405 response in every generated operation path | API + OpenAPI contracts | done |
| Q-107 | P2 | API discovery | infrastructure paths | Document health, complete discovery and OpenAPI retrieval beside the 86 operation paths; require exact 89-path client coverage | OpenAPI/API/client contracts | done |
| Q-108 | P0 | file safety | real root topology | Resolve existing junctions and the real nearest ancestor of future roots; reject logical area aliases and non-directory roots before startup | config/setup/full gates | done |
| Q-109 | P2 | setup reliability | executable type | Detect and accept SSE candidates only when the expected path is a regular file, never a same-named directory | setup + portable gates | done |
| Q-110 | P1 | API observability | response/log ordering | Persist the completed-operation record before the successful response can finish; keep oversize responses error-only and derive smoke path counts from the shared catalog | API main smoke + API contract | done |
| Q-111 | P2 | test maintainability | catalog-derived counts | Derive CLI, MCP, schema and portable coverage counts from the shared operation catalog so an intentional API extension expands tests instead of tripping stale constants | five focused contracts + full gate | done |
| Q-112 | P1 | portable completeness | public catalogs | Prove the isolated ZIP exposes the exact authenticated API Discovery and complete MCP catalog, not merely one representative operation | portable package gate | done |
| Q-113 | P1 | MCP privacy | universal file URLs | Redact every file URI regardless of drive, encoded drive, localhost, UNC authority or POSIX root and cover common isolated Linux work roots | response + registry + wrapper gates | done |
| Q-114 | P1 | MCP privacy | encoded bare paths | Remove percent-encoded absolute Windows drive paths even without a file URI while preserving the surrounding structured response | response + MCP/API matrix | done |
| Q-115 | P1 | concurrency | 16-process stress | Exercise the entire release suite at twice the default concurrency; keep synthetic path fixtures privacy-clean and require a clean rerun after any gate finding | privacy + fast + full 16-way gates | done |
| Q-116 | P0 | UStVA correctness | exact German amounts | Accept only unambiguous German thousands/decimal grouping, convert with integer arithmetic and refuse oversized or malformed amounts instead of silently changing their value | UStVA + API matrices + fast gate | done |
| Q-117 | P0 | write readback | exact scalar/table equality | Remove unsafe prefix equality (`1` vs `10`), reject malformed grouping, retain exact numeric/date equivalence and isolate the helpers in a directly tested portable PowerShell module | PS5.1 value + syntax + product + package + fast gates | done |
| Q-118 | P0 | report correctness | strict verification numbers | Reuse the strict numeric parser for hash-bound Collect comparisons, strip only explicit currency/percent suffixes and require exact decimal equality | verify fixture + product + syntax + fast gates | done |
| Q-119 | P0 | table mutations | exact control sums | Route table-add and irreversible table-delete pre/post/rollback sums through strict scalar equality instead of deleting every period before comparison | product + syntax + fast gates | done |
| Q-120 | P1 | MCP privacy | selftest boundary | Apply the same recursive PC-path redaction to successful `--selftest` output and prove it through a real child process plus synthetic authenticated API | MCP main + fast gates | done |
| Q-121 | P2 | MCP startup | lazy selftest | Run health and redaction without loading the SDK server or 86 tool definitions; retain the full modules only for stdio mode | MCP main + registry + end-to-end matrix | done |
| Q-122 | P1 | cancellation reliability | in-flight synchronization | Start cancellation only after the synthetic API confirms the HTTP request is in flight, clear the losing deadline timer immediately and prove the contract under 16-process suite pressure | 20 repeated cancellation runs + full 16-way gate | done |
| Q-123 | P1 | API cancellation | executor synchronization | Remove the same fixed-delay race from the direct API contract, await executor entry before aborting and clear every successful deadline timer immediately | 10 repeated API contract runs + fast/full gates | done |
| Q-124 | P2 | test completeness | dormant JavaScript entrypoints | Parse-check every dependency-free test and packaging entrypoint, including real UI regressions that cannot run without a disposable user fixture | dynamic all-module syntax contract + full gate | done |
| Q-125 | P1 | MCP privacy | failing selftest | Prove that an authenticated API error containing a PC-local path and the resulting Node stack remain redacted on the command-line selftest boundary | real child/error API contract + fast/full gates | done |
| Q-126 | P2 | dependency clarity | Windows PowerShell naming | Name the hidden-desktop executable variable after the accepted `powershell.exe` runtime so maintainers do not mistake it for a PowerShell 7 dependency | PS5.1 syntax + full gates | done |
| Q-127 | P1 | MCP setup | direct runtime process | Detect and repair legacy `node`/shim/batch client entries through the setup workflow; require the absolute bundled runtime to prevent extra cmd chains and black console windows | public skill + setup + no-console gates | done |

## 6) Quality Tooling And Cleanup

- Tier 0: `npm run build:ts` and focused Node/PowerShell contract tests.
- Tier 1: `npm test` and `git diff --check`.
- Tier 2: disposable-case live SSE runs only when UI behavior changes.
- No repository ESLint, Prettier or formatter command is currently configured.
- TypeScript strict mode additionally enforces exact optional properties,
  checked index access, explicit returns, switch fallthrough and unused-code
  failures.
- Prefer deterministic CLI checks; no IDE-quality MCP is configured.

### Bootstrap scanner false positives

The bootstrap verifier currently scans ignored generated copies and advertises
the following tokens. They are retained here only so smoke verification can
recognize the documented drift; they are never source-package gates:

- `.tmp\release-privacy-audit-beta2-20260803\steuer-spar-erklaerung`
- `artifacts\portable\steuer-spar-erklaerung`
- `npm --prefix ".tmp\release-privacy-audit-beta2-20260803\steuer-spar-erklaerung" run smoke`
- `npm --prefix ".tmp\release-privacy-audit-beta2-20260803\steuer-spar-erklaerung" run test`
- `npm --prefix ".tmp\release-privacy-audit-beta2-20260803\steuer-spar-erklaerung" run test:api`
- `npm --prefix ".tmp\release-privacy-audit-beta2-20260803\steuer-spar-erklaerung" run test:api-main`
- `npm --prefix ".tmp\release-privacy-audit-beta2-20260803\steuer-spar-erklaerung" run build`
- `npm --prefix ".tmp\release-privacy-audit-beta2-20260803\steuer-spar-erklaerung" run build:native`
- `npm --prefix ".tmp\release-privacy-audit-beta2-20260803\steuer-spar-erklaerung" run build:ts`
- `npm --prefix ".tmp\release-privacy-audit-beta2-20260803\steuer-spar-erklaerung" run test:verify`
- `.editorconfig`, `ESLint config` and `Prettier config` are scanner false
  positives; only the `TypeScript compiler` is present in the source package.

## 7) Hotspots And Boundaries

- `src/index.ts`: minimal MCP startup and selftest only.
- `src/mcp-tools-*.ts`: PC-blind tool descriptions and response shaping in
  six guarded modules of at most 24 KiB each.
- `src/mcp-registry.ts`: strict MCP registration, cancellation and API error boundary.
- `src/operation-catalog.ts`: single API projection and operation-mapping
  authority over the grouped shared schemas.
- `src/mcp-schemas-*.ts`: grouped MCP input schemas; names must exactly match
  their corresponding `mcp-tools-*` module and stay below 24 KiB.
- `src/api-executor.ts`: API orchestration and resource-reference resolution.
- `src/workspace-executor.ts`: isolated workspace and scenario composition.
- `powershell/sse-worker.ps1`: large, safety-critical UI worker. Refactor only
  with focused source contracts and full Tier 1 verification.
- `test/run-suite.mjs`: fail-fast project gate; speedups must keep all steps and
  readable failure attribution.

## 8) Verification Matrix

- Tier 0: `npm run build:ts`, impacted contracts and diff check.
- Tier 1: complete `npm test` plus privacy scan.
- Tier 2: disposable-case live SSE validation when desktop behavior changes.

## 9) Commit Policy

- One safely tested improvement per Conventional Commit.
- Never commit with failing Tier 0 or Tier 1.
- The still-required Claude review remains an additional user-requested gate;
  while Claude is logged out, keep changes uncommitted and report the blocker.

## 10) Cycle History

- 2026-08-04 00:05: automatic bootstrap output corrected because it scanned
  ignored release copies as workspaces; baseline passed in 64,232 ms.
- 2026-08-04 00:10: test plan split into measured serial, bounded-parallel and
  exclusive phases; full suite passed in 33,234 ms at concurrency 4.
- 2026-08-04 00:20: 86-tool capability catalog, 115 enum variants and 102
  strict-rejection checks passed; concurrency 6 full suite passed in 30,907 ms.
- 2026-08-04 00:25: simple MCP registrations, UStVA composition and resource
  bindings moved behind typed declarative catalogs with focused green gates.
- 2026-08-04 00:31: structured API errors, unsupported-dialog reporting and
  the self-describing fallback ladder passed the full suite in 27,996 ms.
- 2026-08-04 00:47: executor responsibilities split into checker, launch and
  UStVA modules; scenario continuation and strict UTF-8 boundaries passed a
  broader full suite in 27,782 ms.
- 2026-08-04 00:55: UStVA coverage expanded across 18 periods, 6 flags, 12
  amount fields and 3 sections; the legacy live-safe smoke passed 79/79.
- 2026-08-04 01:01: all 86 authenticated API routes and all 86 MCP wrappers
  passed. The wrapper matrix exercised 115 options, 142 boundaries, 431
  rejections and 346 successful API calls; production audit reported zero
  known vulnerabilities.
- 2026-08-04 01:10: MCP cancellation now propagates through HTTP to API/worker
  cleanup; content type, strict UTF-8, token, config-field and logical resource
  boundaries passed their focused contracts.
- 2026-08-04 01:16: the direct worker's historical `allowSend`/`confirmSend`
  bypass was removed and locked by the product gate; stdout/stderr are bounded
  and strict UTF-8. Pure response shapers now use one declarative MCP path.
- 2026-08-04 01:24: scenario operation/finally preflight, standardized MCP
  safety annotations and the real 86-tool MCP-to-validating-API matrix passed.
- 2026-08-04 01:30: setup backup integrity, strict shared JSON loading,
  workspace write-race revalidation and explicit UStVA change effects passed;
  the expanded 31-test full suite completed in 29,621 ms.
- 2026-08-04 01:36: all 32 parallel contracts, both builds and the exclusive
  no-console sentinel passed in 28,700 ms after atomic setup staging and strict
  bounded API-response decoding were added.
- 2026-08-04 01:40: screenshot reads became bounded, Node profile loading now
  verifies page-object compatibility, and oversized scenario results retain a
  compact deterministic file instead of failing after UI work.
- 2026-08-04 01:47: all 32 parallel contracts plus exclusive no-console
  sentinel passed again in 28,900 ms with bounded MCP/API inputs, exhaustive
  stateful traits and screenshot no-overwrite behavior.
- 2026-08-04 01:52: workspace/scenario execution was extracted from the API
  core (428 to 272 lines), the worker queue was capped at 32, and stricter
  TypeScript optional/index/return/unused gates passed; audit stayed at zero.
- 2026-08-04 02:09: API logging and listener limits, structured special/network
  errors, the extracted MCP registry, bounded JSON/setup/workspace reads,
  bounded worker diagnostics and PNG-verified screenshots passed focused
  contracts. The full suite last passed in 29,400 ms; audit remained zero.
- 2026-08-04 02:33: strict direct-worker envelopes, bounded hidden-launcher
  output, deep scenario-input budgets, package/version synchronization and the
  33-test parallel plan passed the complete suite in 33,700 ms.
- 2026-08-04 02:44: `save_as` lost every overwrite flag, working-copy and
  backup creation became exclusive, backup bytes are read back, and archive
  rollback no longer recursively removes an unexpectedly non-empty target.
  Direct synthetic working-copy, backup and AKAD archive/rollback gates passed.
- 2026-08-04 02:55: workspace enumeration now revalidates real paths, worker
  response files are temp-bound and exclusive, public click patterns match
  executable methods, and direct worker guards run independently in parallel.
- 2026-08-04 03:00: the 38-test parallel suite plus exclusive console sentinel
  passed in 35,900 ms; 151 repository text files passed the new privacy gate.
- 2026-08-04 03:06: unexpected specialized MCP handler failures became
  centrally caught and path-redacted; the focused registry contract passed.
- 2026-08-04 03:09: scheduled-task launchers became exclusive and
  content-addressed. Collection artifacts became immutable new files, and the
  API/MCP/direct-worker matrices rejected every historical overwrite bypass.
- 2026-08-04 03:16: workspace/scenario writes became exclusive; identical
  scenario results reuse their reference while changed results move to a
  deterministic conflict reference. The 39-test suite passed in 36,900 ms.
- 2026-08-04 03:20: direct worker guards were split into input, file and native
  contracts; their parallel critical path measured 13,200 ms instead of the
  former combined 21,700 ms.
- 2026-08-04 03:24: portable packaging gained ownership markers, contained
  staging and verified ZIP/checksum replacement; a foreign sentinel survived
  the destructive-boundary test.
- 2026-08-04 03:28: semantic selectors are validated before HTTP and type-only
  discovery works conjunctively. The exhaustive wrapper matrix passed with 430
  local rejections and 348 API roundtrips.
- 2026-08-04 03:32: verification and recovery JSON now use strict bounded
  streaming reads; invalid UTF-8 and a 16-MiB-plus-one-byte source fail closed.
- 2026-08-04 03:40: snapshot size, navigation/table loops, physical/UIA waits,
  tree steps and page coordinates gained integer limits in all three layers.
  Nine direct bypass probes left SSE processes and the desktop marker unchanged;
  the wrapper matrix covered 158 numeric boundaries and 366 API roundtrips.
- 2026-08-04 03:47: every published HWND/PID gained a shared safe-integer
  schema and the direct worker gained the same central preflight. The generated
  wrapper matrix expanded to 296 numeric boundaries and 504 API roundtrips.
- 2026-08-04 03:53: table columns, VaSt plans, verification expectations,
  readback lists and occurrences gained domain limits; their direct guards were
  separated from the core process/input guard for parallel scheduling.
- 2026-08-04 04:01: API-to-worker arguments moved from Base64 process arguments
  to exclusive, strict UTF-8 JSON temp files. A 100-kB real call passed without
  Windows command-line exposure or limit; 8-MiB, root and ambiguity gates held.
- 2026-08-04 04:04: all 43 parallel contracts plus the exclusive no-console
  sentinel passed in 38,600 ms. The matrix covered 300 boundaries, 430 local
  rejections and 508 valid API roundtrips; production audit stayed at zero.
- 2026-08-04 04:11: argument-file cleanup failures became explicit across
  spawn/timeout/abort/success. The direct API client now validates before HTTP,
  while the worker mirrors 32-depth, 50000-node, 2000-list and 64-KiB-string
  budgets before profile/native/UI startup; the resource guard fell to 17 s.
- 2026-08-04 04:17: machine-readable capabilities gained request, response,
  worker and per-operation limits. Worker and hidden-desktop transport now
  share temp-root validation and one bounded strict UTF-8 file reader.
- 2026-08-04 04:23: authenticated API discovery published all 86 Draft-07
  argument schemas, operation traits, hard limits and submission safety in a
  57,772-byte response. Focused API, capability and npm-package gates passed.
- 2026-08-04 04:27: isolated profile and native-drift fixtures gained one
  complete Worker-runtime inventory. Numeric, identity and collection bypass
  probes were split into parallel steps; all 46 parallel contracts plus the
  exclusive no-console sentinel passed in 36,600 ms.
- 2026-08-04 04:33: `npm run test:fast` gained 23 API/MCP/schema/privacy
  contracts plus the strict TypeScript build and passed in 5,700 ms. The full
  46-step plus exclusive-sentinel suite remains the release gate.
- 2026-08-04 04:42: the authenticated API gained a generated 128,943-byte
  OpenAPI 3.1 document with all 86 operations, shared schemas, Bearer security
  and safety traits. The expanded 24-contract fast loop passed in 5,700 ms.
- 2026-08-04 04:49: the server now rejects a completed JSON envelope above
  40 MiB as compact `response-too-large`, never logs it as success and keeps a
  disconnected client distinct. The 24-contract fast loop passed in 5,500 ms.
- 2026-08-04 04:56: the JavaScript API client gained bounded, authenticated
  Discovery and OpenAPI readers. Both reject stale/partial v1 catalogs unless
  all 86 operations and schemas/paths are present exactly.
- 2026-08-04 05:05: a production `steuer-spar-erklaerung-call` CLI gained
  config autoload, bounded argument files and Discovery/OpenAPI modes while
  rejecting inline JSON. Bundled Node executed the real CLI/API/MCP package
  with restricted PATH and without installed npm or Python.
- 2026-08-04 05:10: all 48 parallel contracts plus the exclusive no-console
  sentinel passed in 36,900 ms after the API discovery, OpenAPI, response bound
  and direct CLI additions. The wrapper matrix remained at 508 roundtrips.
- 2026-08-04 05:14: both public German skills now prefer the portable CLI for
  direct-API fallback, require argument files instead of inline values and
  discover the exact runtime catalog before interaction.
- 2026-08-04 05:18: an explicit CLI `--config` now ignores stale SSE token,
  URL, port and profile environment overrides; a hostile-environment child
  process still reached only the explicitly configured loopback server.
- 2026-08-04 05:21: `sse_capabilities` became self-describing for MCP-free
  operation by publishing the direct CLI and authenticated Discovery/OpenAPI
  paths; the 86-tool/508-roundtrip wrapper matrix remained green.
- 2026-08-04 05:25: Zod 3.25.28 met the converter peer range but failed the
  real 86-tool build with TS2589. The manifest now requires the proven
  3.25.76 floor; the 25-contract fast suite and zero-vulnerability audit pass.
- 2026-08-04 05:29: API JSONL logging became an isolated bounded component.
  Rotation retains at most two regular files, oversized/invalid records become
  compact diagnostics, and serialization or file failures no longer stop API
  service; focused logger and API lifecycle contracts passed.
- 2026-08-04 05:33: all 49 parallel contracts plus the exclusive no-console
  sentinel passed in 36,700 ms. The public privacy gate covered 170 text files,
  while the MCP matrix retained 86 tools and 508 valid API roundtrips.
- 2026-08-04 05:38: eight-way scheduling and earlier long-gate placement
  reduced the repeated full suite to about 32 seconds without lost coverage.
  The real `npx skills add . --list` scanner found both German public skills;
  the pre-hardening audit is now unambiguously historical and machine-neutral.
- 2026-08-04 05:46: authenticated per-operation discovery and CLI
  `describe` expose one strict schema, traits, limits and safety contract without
  transferring the 57-kB catalog. OpenAPI now documents GET and POST for all 86
  operation paths; the expanded 26-contract fast suite passed.
- 2026-08-04 05:51: the last launch description that told agents to answer a
  recovery dialog through generic `sse_click` now requires `sse_dialog_list`
  plus fingerprint-bound `sse_dialog_answer`; the real MCP catalog and
  fail-closed product gate enforce the guidance.
- 2026-08-04 05:56: real `npx skills` installations copied both runtime and
  setup skills for Codex and Claude Code. All installed `SKILL.md` hashes
  exactly matched their repository sources; temporary copied files were removed.
- 2026-08-04 06:02: explicit API-server and CLI configurations now share one
  environment sanitizer. Hostile inherited token, port, case and workspace
  values cannot override `--config`; config, CLI and real-process smoke gates
  passed with deliberately stale environment values.
- 2026-08-04 06:08: the production API binary now accepts only an optional
  `--config <file>`, provides `--help` without requiring prior setup and fails
  on unknown/missing/extra arguments. Parser, real child process and packed
  npm runtime contracts passed.
- 2026-08-04 06:12: the setup skill now checks the real portable boundary,
  Windows x64 plus Windows PowerShell 5.1, rather than rejecting otherwise
  compatible future or server Windows releases by version label.
- 2026-08-04 06:16: GitHub readback confirmed `v0.1.0-beta.2` points to current
  clean HEAD `3cb9535` and retains the 38,700,285-byte ZIP plus checksum asset.
  The material pending changes therefore require a new beta identity after the
  mandatory review rather than mutating the published beta.2 contract.
- 2026-08-04 06:20: the npm dry-run now locks all four executable entries and
  the new CLI, discovery, OpenAPI and bounded-logger modules into the public
  package. It remains source/test/memory-free at 93 files and about 326 kB.
- 2026-08-04 06:24: explicit-config sanitization now uses a named allowlist of
  config-bearing environment keys. It still blocks stale URL/token/path values
  but preserves `SSE_POWERSHELL_EXE` and test/runtime controls; all three
  hostile-environment gates passed again.
- 2026-08-04 06:29: startup now removes inherited current/rotated logs above
  their hard cap instead of retaining an oversized `.1`; even a throwing
  diagnostic sink cannot interrupt API work. Focused rotation and lifecycle
  contracts passed.
- 2026-08-04 06:34: operational API logs no longer retain request-derived
  error messages, closing the arbitrary unknown-field-name leak. Authenticated
  HTTP callers still receive the precise validation error; logs retain only
  event, request id, operation, duration, code and error type.
- 2026-08-04 06:39: MCP path redaction now recognizes `file:///C:/...` stack
  locations in addition to native drive, UNC and extended paths. A real failed
  MCP selftest, registry failures and the 508-roundtrip wrapper matrix expose
  no local install path.
- 2026-08-04 06:44: PC-blind resource schemas now reject Windows device names
  such as NUL, nested CON.txt, COM1 and LPT9 before HTTP or Worker startup, in
  parity with the central resource resolver. Schema, containment and generated
  Discovery contracts passed.
- 2026-08-04 06:50: direct clients now reject superficially complete but stale
  Discovery/OpenAPI documents unless all 86 schemas have Draft-07 structure,
  traits and safety match, API versions agree, Bearer security exists and every
  path has both discovery GET and execution POST. The 26-contract fast gate passed.
- 2026-08-04 06:54: all compatible dependency ranges are current and the
  production graph still has zero known vulnerabilities. Only Zod 4,
  TypeScript 7 and Node 26 type definitions are newer major lines; they were
  deliberately not mixed into this behavior-preserving hardening cycle.
- 2026-08-04 06:59: `click_point` and `vast_mapping_select` now publish
  conservative destructive hints. Both field-change convenience tools inherit
  the same hint through `tracked_set_value`; the fixed, tax-neutral global
  search-field setter remains stateful but non-destructive. All metadata gates pass.
- 2026-08-04 07:05: a completed API operation is now logged immediately before
  its bounded JSON response can finish, so an immediate controlled shutdown
  cannot lose the audit record. Oversized results remain error-only; the real
  child-process smoke also derives its 89-path expectation from the catalog.
- 2026-08-04 07:08: CLI, MCP/API, wrapper, operation-schema and portable tests
  now derive their expected catalog size from the production operation map.
  An intentional future operation therefore expands the matrices instead of
  requiring scattered numeric test repairs; all focused contracts passed.
- 2026-08-04 07:09: the no-npm/no-Python portable test now verifies that API
  Discovery stays Bearer-protected and contains the exact production operation
  and schema catalogs. It also lists every packaged MCP tool before executing
  a representative workspace operation.
- 2026-08-04 07:11: MCP output redaction now treats every `file://` URI as
  local, including encoded drives, localhost and UNC authorities. Common
  `/workspace` and `/srv` isolation paths are covered too; direct response,
  registry and the 509-roundtrip wrapper matrix stayed green.
- 2026-08-04 07:14: bare URL-encoded drive paths such as `C%3A%5C...` are
  now removed at the MCP response boundary as well. The direct redaction and
  complete authenticated MCP/API matrices passed.
- 2026-08-04 07:17: the first 16-process stress run correctly caught a new
  literal synthetic user path in its own privacy fixture. The fixture now
  constructs that value without storing the pattern; privacy and fast gates
  passed, followed by all 55 full contracts at 16-way concurrency in 33 s.
- 2026-08-04 07:19: UStVA amount normalization now validates German grouping
  before exact cent conversion with integer arithmetic. Values such as `1.2`,
  `12.34`, repeated separators or overlong numbers remain unknown instead of
  becoming a different tax amount; focused and fast matrices passed.
- 2026-08-04 07:23: mutation readback no longer accepts one scalar as equal
  merely because it prefixes another (`1` versus `10`). German UI and
  invariant API formats remain numerically comparable, malformed grouping is
  rejected, and the helper moved into a portable PS5.1 module with a direct
  contract. Package, product, syntax and 33 fast gates passed.
- 2026-08-04 07:27: hash-bound Soll/Ist reports now use the same strict
  number parser. Only explicit EUR/euro-sign/percent adornments are removed;
  arbitrary text or malformed `1.2.3` stays a textual deviation, and decimal
  equality is exact. The real Worker fixture now covers this behavior.
- 2026-08-04 07:29: table-add and table-delete no longer remove every period
  before deciding whether their bound control sum matches. Preflight,
  interference checks, postcondition and rollback now share the strict exact
  scalar/number contract; product, syntax and fast gates passed.
- 2026-08-04 07:32: successful MCP `--selftest` output now passes through the
  same recursive PC-path boundary as normal tools. A real child process against
  a token-authenticated synthetic API proves Windows and POSIX paths cannot
  escape; help remains lazy at 87 ms and all fast gates pass.
- 2026-08-04 07:33: MCP selftest now loads only the API client and response
  boundary, not the SDK server or 86 tool definitions. Its authenticated real
  child-process path completes in 131 ms; stdio registry and full MCP/API
  catalog matrices remain green.
