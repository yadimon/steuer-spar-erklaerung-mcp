# Skill Profile

## Scope

- skill: clean-code-refactoring
- purpose: preserve behavior while separating domain composition, schemas,
  wrapper glue and desktop side effects

## Stable Project Facts

- project_shape: npm workspace with shared TypeScript orchestration, separate
  API/MCP publication packages and a PowerShell 5.1-compatible Windows UI
  worker
- main_languages: TypeScript, JavaScript tests, PowerShell, C# helper
- architecture_or_layering_rules:
  - MCP is a thin, PC-blind wrapper.
  - The loopback HTTP API owns configuration, resource references and domain
    composition.
  - The PowerShell worker owns only bounded desktop interactions.
  - All write operations require explicit preconditions and readback.

## Approved Defaults

- preferred_test_commands:
  - `npm run build:ts`
  - closest contract test under `test/`
- preferred_broader_checks:
  - `npm test`
  - `git diff --check`
- documentation_expectations:
  - document non-obvious safety invariants and public semantic operations
  - do not add comments for obvious control flow

## Area Notes

- `src/api-executor.ts`:
  - role: generic API orchestration and semantic compositions
  - keep_stable: validation, resource redaction, timeout and abort behavior
  - timeout_budget: local parser stages and worker fallbacks share one resolved
    deadline; do not start a new worker with less than the documented safe
    startup reserve
  - refactor_goals: keep domain handlers and resource bindings declarative;
    avoid moving UI side effects out of the worker
  - extra_test_expectations: API contract, operation catalog, domain contracts
- `src/product-profiles.ts`:
  - role: gemeinsame strikte Manifest- und Page-Object-Validierung fuer API
    und lokale Metadatenpfade
  - keep_stable: page_objects liest Profile pro Aufruf neu; exakte IDs haben
    Vorrang, nur eindeutige case-insensitive Treffer sind lokal zulaessig und
    reine Case-Kollisionen sind bereits bei der Profilvalidierung ungueltig
  - extra_test_expectations: beide ausgelieferten Profile gegen den echten
    Worker vergleichen, ohne eine SSE-UI zu starten
- `src/page-objects-executor.ts`:
  - role: lokaler read-only Page-Object-Vertrag mit Reload, Deadline,
    Pfadredaktion und explizitem Worker-Fallback-Signal
  - keep_stable: keine UI-/Worker-Seiteneffekte im lokalen Erfolgsweg; der
    generische API-Executor allein startet und budgetiert einen Fallback
- `src/collect-verification.ts`, `src/verify-executor.ts`:
  - role: reiner Collect-Soll/Ist-Vergleich getrennt von stabiler,
    hashgebundener Datei-, Deadline- und Ressourcenorchestrierung
  - keep_stable: striktes UTF-8/JSON und 16-MiB-Limit, SHA-256 plus
    Dateiidentitaet vor/nach der Auswertung, echtes Boolean fuer
    Vollstaendigkeit, exakte Dezimalarithmetik und fail-closed Worker-Fallback
    fuer nicht beweisbar gleiche PowerShell-Unicode-/Quelltypen
  - extra_test_expectations: lokaler API-Pfad gegen echten Worker feldgleich
    pruefen; Abort und Timeout duerfen keinen neuen Worker starten
- `src/working-copy-executor.ts`, `src/file-identity.ts`:
  - role: lokale hashgebundene Arbeitskopie und gemeinsame stabile
    Dateiidentitaet ohne UI-/Worker-Start
  - keep_stable: Ziel nur atomar neu mit `wx+`; Quelle/Ziel ueber offene
    Handles doppelt hashen und gegen Pfadidentitaet/-zustand binden; nach
    begonnener Mutation niemals Worker-Fallback; Cleanup nur bei passender
    Identitaet, Bytezahl und Eigenhash
  - windows_limit: Node kann weder die exklusiveren Share-Modi des Workers noch
    `DELETE_ON_CLOSE` ausdruecken; Konkurrenz wird fail-closed erkannt und das
    kleine TOCTOU-Fenster vor `unlink` bleibt explizit dokumentiert;
    Datei-Open ist abortable mit Late-Cleanup, Read/Write prueft kooperativ pro
    1-MiB-Block, weil laufende FileHandle-I/O nicht sicher abbrechbar ist
  - extra_test_expectations: Erfolgsparitaet gegen echten Worker, beide
    Profile, Quellen-/Zielinterferenz, Redaction sowie Abort/Timeout ohne
    verwaiste Eigenkopie
- `src/backup-executor.ts`, `src/owned-file.ts`:
  - role: lokale Fallsicherungs-Komposition und gemeinsam eigentumsgeprueftes
    Datei-Cleanup ohne UI-/Worker-Start
  - keep_stable: gemeinsames Deadlinebudget; exaktes Quell-/Zielinventar;
    komponentenweise exklusiv neue Zielkette; bytekompatibles
    PowerShell-Manifest; partielles Manifest nur per Identitaet und
    Sollpraefix entfernen; nach begonnener Mutation kein Worker-Fallback;
    unbekannte Ziele bleiben als `retainedTargets` erhalten
  - extra_test_expectations: API-Erfolg und Manifest bytegleich gegen echten
    Worker; Ressourcenredaktion, Wiederholschutz, Interferenz sowie
    Abort-/Timeout-Rollback pruefen
- `src/archive-executor.ts`, `src/archive-file-copy.ts`,
  `src/sse-process-guard.ts`, `src/local-file-transaction.ts`:
  - role: lokale Fallarchivierungs-Komposition getrennt von verifizierter
    Copy/Delete-Mechanik, Windows-Prozessprobe und gemeinsamen
    Verzeichnis-/Manifest-Helfern
  - keep_stable: vollstaendiges Fallinventar inklusive `_Backup`; fail-closed
    SSE-Prozessprobe vor Preflight und jeder Quellentfernung; Ziel immer exklusiv mit `wx+`, niemals
    ueberschreibendes `rename`; Quell-Handle bis Commit/Rollback offen halten;
    nach erster Mutation kein Worker-Fallback; fremde Quell-/Zielpfade nie
    ueberschreiben oder loeschen; Doppelinterferenz ueber hashverifizierte
    `.sse-recovery-*`-Datei recoverable halten
  - extra_test_expectations: Erfolgsmanifest bytegleich gegen echten Worker;
    Preflight-Fehlerarten, `_Backup`, Zeitstempel, Ressourcenredaktion,
    verschachtelte Ziele, zweite Prozessprobe, Teilmanifest, Abort/Timeout und
    Quell-/Ziel-/Doppelinterferenz pruefen
- `src/abortable.ts`:
  - role: gemeinsame Bindung nicht nativ abortierbarer Promises an
    AbortSignal mit Freigabe spaet eintreffender Handles
  - keep_stable: ein Abbruch gewinnt genau einmal; Late-Cleanup darf nicht
    verloren gehen
- `src/api-main.ts`, `src/api-runtime.ts`:
  - role: minimaler Startvertrag getrennt von Serverlaufzeit und Shutdown
  - keep_stable: Hilfe und Argumentfehler laden keine Worker-/Servermodule;
    der Runtimepfad behaelt Config-Sanitizing, Logging und Abort-Fan-out
- `src/api-server.ts`:
  - role: loopback HTTP transport, browser-origin guard and per-instance
    operation serialization
  - keep_stable: single-flight state and `/healthz` progress belong to exactly
    one created server; separate embedded servers must not leak or block state
  - extra_test_expectations: `test/api-single-flight.mjs`, API contract and
    full suite after shared server changes
- `src/desktop-marker.ts`, `powershell/desktop-marker.ps1`, `src/worker.ts`:
  - role: gemeinsame fail-closed Desktop-Routing- und Eigentumsgrenze vor dem
    UI-Workerstart
  - keep_stable: nur ENOENT bedeutet sichtbarer Desktop; bestehende defekte
    Marker stoppen; neue Marker sind versioniert und exklusiv; Cleanup bindet
    Owner, Name und PID; `center-test` ist opt-in und nur fuer center_cases/
    center_refresh erlaubt
  - extra_test_expectations: reiner Parser-/I/O-Vertrag in Node und
    PowerShell, direkter Worker-Fallbacktest sowie privater 2025-Center-Lauf
- `src/index.ts`, `src/mcp-tools.ts`, `src/mcp-tools-*.ts`:
  - role: minimal MCP startup plus grouped PC-blind registrations
  - keep_stable: one API call per ordinary tool and no local PC knowledge
  - refactor_goals: keep six cohesive registration groups below the guarded
    24-KiB module boundary while descriptions remain clear
- `src/mcp-schemas-*.ts`, `src/operation-schema-primitives.ts`,
  `src/operation-catalog.ts`:
  - role: fachlich gruppierte MCP-Schemas plus gemeinsame API-Projektion
  - keep_stable: jede Gruppe hat exakt dieselben Toolnamen und Schemas; alle
    Eingabeeigenschaften bleiben beschrieben und unter 24 KiB pro Modul
- `src/result-contract.ts`, `src/result-schema-types.ts`,
  `src/result-mutation-fields.ts`, `src/result-utility-fields.ts`:
  - role: gemeinsamer operationsspezifischer Ergebnisvertrag fuer API,
    Discovery, OpenAPI und MCP getrennt von wiederverwendbaren Typen und
    Worker-verifizierten Feldtabellen
  - keep_stable: jede der 93 Operationen hat eigene Fachfelder; Tabellen haben
    disjunkte Operationsschluessel; Worker-Feldbelege gelten nur auf der
    aeusseren Emit-Ebene und UIA-Scrollwerte erlauben den negativen NoScroll-
    Sentinel
  - extra_test_expectations: Result-Vertrag, brace-bewusster Worker-Feldguard,
    Discovery/OpenAPI, wertfreie Ergebnisform-Ratsche und 24-KiB-Modulgrenze
- `powershell/sse-worker.ps1`:
  - role: safety-critical UI side effects
  - keep_stable: ELSTER blocks, instance/case/hash/interference guards
  - receipt_manager_binding: adding a draft can replace every Qt RuntimeId;
    after the zero-draft precondition, bind the unique draft semantically and
    request expensive ValuePattern reads only in `receipt_manager_read`
  - transmission_dialog_cancel: only the exact `Abbrechen` button may bypass
    content-based transmission blocking, after HWND and fingerprint binding
  - collect_end_guard: `end-of-branch` requires both the bound content snapshot
    and the separately bounded navigation snapshot to be untruncated
  - refactor_goals: only cohesive helpers backed by focused contracts
- `test/desktop-marker-contract.mjs`,
  `test/desktop-marker-parser-parity.ps1`:
  - role: cross-runtime desktop ownership parity with bounded real Worker/API
    probes
  - keep_stable: batch pure parser fixtures in one PowerShell process; retain
    representative end-to-end checks for valid routing, owner rejection,
    diagnostics and API error transport
- `powershell/build-native.ps1`:
  - role: PowerShell-5.1-kompatibler Build und Integritaetsbindung der
    vorkompilierten Win32-/MSAA-Bruecke
  - keep_stable: vorhandene DLL nur bei strikt passendem Manifest, Quellhash,
    tatsaechlichem DLL-Hash und vollstaendiger Typ-/Methodenoberflaeche
    wiederverwenden; jede Abweichung baut neu
  - windows_limit: der lokale .NET-Framework-Compiler bietet keinen
    deterministischen Modus; Byte-Reproduzierbarkeit gilt nur durch die
    verifizierte Wiederverwendung, nicht fuer zwei frische Compiles
  - extra_test_expectations: Cache-Hit, echter Loader, unvollstaendige
    Assembly, unvollstaendiger frischer Compile, Build-/Loader-/C#-Paritaet,
    Quellaenderung, DLL-Manipulation, strikte Manifestfehler, fehlende DLL,
    fehlendes Manifest und rueckstandsfreies Cleanup isoliert pruefen

## Known Drift Or Gotchas

- Generated `.tmp/` and `artifacts/` copies are not refactoring targets.
- Real SSE controls can share names; stable automation IDs and expected pages
  are required.
- UIA errors invalidate the worker process; never hide incomplete reads.

## Last Confirmed State

- verified_at: 2026-08-25
- notes: receipt binding, detail-value reads and safe dialog cancellation pass
  focused live checks and the complete 120-step suite.
