# Pi 0.87.1 + pi-cursor-sdk 0.3.10 — Mac upgrade with ported local fixes, stock servers

Date: 2026-09-23. Builder: Claude (Opus 5.5). Critic: Codex `gpt-6-astra`, reasoning effort `max`.
Workflow: debate-loop (plan → owner approval → implementation → implementation audit).
Nothing in this plan runs before the owner explicitly approves it.

## Owner brief and rulings (2026-09-23)

1. Original ask: update Pi on the laptop, test on the laptop, then "sync pi" to mock + backup.
2. Why the plain upgrade was stopped: Pi ≥ 0.86 gives custom providers a messages-only
   `TranscriptContext` (system prompt and tools live in system messages). The Mac Cursor adapter
   0.1.60 reads `context.systemPrompt` (`src/context.ts:340/386/418`) and `context.tools`
   (`src/cursor-context-tools.ts:6`). Same-prompt A/B probe (private temp cwd, `--no-session`,
   `--tools read`, `cursor/composer-2.5`, code word added with `--append-system-prompt`):
   installed Pi 0.85.1 → Pi `read` tool executed, `CODE=ZEBRA-4471`; staged Pi 0.87.1 → no Pi tool
   execution, `CODE=NONE`, exit 0 (silent failure). Evidence: `/private/tmp/pi-cursor-ab/`.
   Servers' adapter 0.1.42 reads the same fields (7 reads, no transcript helpers).
3. Ruling — Option C: move the Mac adapter to `pi-cursor-sdk` 0.3.10 and port **all three** Mac
   local fix sets onto it: (a) compaction fix, (b) stale-auth recovery, (c) Cursor model
   variants / effort-parameter mapping.
4. Ruling — mock and backup servers get **stock** `pi-cursor-sdk` 0.3.10 (they run stock 0.1.42 today).
5. Ruling — WSL is **deferred** ("note this so that we can tackle WSL later"). WSL stays Pi 0.85.1 +
   adapter 0.3.6. Recorded in Claude memory (`project_wsl_pi087_upgrade_deferred`) and, at the end,
   as Windows *pending* in `REBUILD-PROTECTION.md`. This overrides, for this job only, the
   AGENTS.md line asking for Mac and WSL gates together.
6. The 2026-09-14 freeze of the installed Cursor adapter is lifted for this job only. Its protected
   behavior must survive: omitted or empty Pi tools → no Pi tool bridge (summaries stay plain
   text); the 14 compaction tests; the app model-switch guard unchanged.
7. Builder and critic stay strictly in scope. Anything that grows the job goes to the owner.

## Outcome

The Mac runs Pi 0.87.1 with a 0.3.10 Cursor adapter that keeps every Mac local fix and works with
Pi's new context format; Alamelu Pi's protections still hold. Mock and backup run Pi 0.87.1 with
stock adapter 0.3.10 and Cursor still works there. Everything is recorded so it can be rebuilt,
checked and rolled back.

## Done when

1. Mac Pi is 0.87.1; nvm `bin/pi` points to `dist/cli.js`; the Luna extension RPC check passes
   through `/Users/sudhirjha/.local/bin/pi` (REBUILD-PROTECTION gate 1).
2. Mac adapter is 0.3.10 + reviewed patch; `scripts/check-cursor-compaction.py --package
   ~/.pi/agent/npm/node_modules/pi-cursor-sdk` passes against a new `0.3.10` manifest entry (gate 2).
3. A/B probe on the installed Mac runtime: Pi `read` tool executed and `CODE=ZEBRA-4471`.
4. Ported fixes proven: 14 compaction tests, the 4 ported stale-auth test files and one small
   model-variant test pass on the 0.3.10 build and fail (red) on stock 0.3.10; the model-variant
   test also passes against the installed Mac `model-discovery.ts`; model-ID parity — every
   Cursor model ID listed before the upgrade is still listed after it.
5. Private live manual **and** automatic Cursor compaction on Pi 0.87.1 + candidate: compaction
   events occur, summaries are nonempty text, no Pi tool call or bridge execution during either
   summary, followed by a successful ordinary tool turn (gate 3).
6. `compacted-model-switch.spec.ts` passes against installed Pi 0.87.1 (gate 4) and
   `smoke:tauri:packaged` passes with isolated state.
7. Mock and backup: stock 0.3.10 installed; `scripts/server_pi_maintenance.sh` passes and leaves
   both at Pi 0.87.1; on each, the A/B probe passes and the relay chain's Cursor IDs
   (`composer-2.5`, `composer-latest:fast`) are still listed.
8. Records: 0.3.10 patch, tests and manifest entry tracked in alamelu-tauri;
   `REBUILD-PROTECTION.md` updated (Mac verified release, 0.3.10 recovery, WSL pending); release
   evidence; Mac maintenance kit synced; alamelu `progress.md` entry; rollbacks retained.

## Scope

In: the Mac Pi package and launcher; the Mac adapter (install, port, patch, tests, manifest);
installing stock 0.3.10 on mock and backup; running the existing sync script; the gates and records
listed above.

Out (owner decides separately): WSL/Windows; any Rust/Tauri rebuild or app source change; other
Pi packages, extensions or providers; server Pi config beyond the adapter pin; lazydata; changing
`server_pi_maintenance.sh`; reviewing or changing unrelated upstream 0.3.x behavior; new features;
the old 0.1.60 editable checkout at `/Users/sudhirjha/playground/pi-cursor-sdk` (kept unchanged as
the 0.1.60 reference).

## Current state (verified 2026-09-23)

- Mac Pi 0.85.1 at `~/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent`;
  nvm `bin/pi` → `../lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js` (September
  launcher fix); `~/.local/bin/pi` is a wrapper that execs it. Alamelu Pi Tauri is running with two
  live Pi RPC children.
- Staged Pi 0.87.1 (`/private/tmp/pi-0.87.1-stage`): package `bin` is still `dist/bundle/cli.js`.
  Luna check: unbundled `dist/cli.js` PASS; bundled FAIL with the September error
  (`Cannot find module '@earendil-works/pi-coding-agent'`). The launcher fix is still required.
- Pi 0.86/0.87 breaking changes reviewed: only the custom-provider context change affects our
  extensions. `xai-i2o-oauth.ts` / `xai2-oauth.ts` use built-in `openai-responses` /
  `openai-completions`; `pi-web-access` is not a provider; the servers' two NVIDIA packages use
  `openai-completions`. No extension uses the removed `shouldStopAfterTurn`, `turn_end` emit,
  `state.messages` assignment or `context` handlers.
- Mac adapter `~/.pi/agent/npm/node_modules/pi-cursor-sdk` is 0.1.60, loads `src/index.ts`,
  settings `packages: ["npm:pi-cursor-sdk", "../../playground/pi-web-access"]` (no extension
  filters). Versus stock npm 0.1.60, 11 source files differ:
  - (a) compaction — `cursor-context-tools.ts`, `cursor-session-agent.ts` (patch only, match
    manifest `before`), `cursor-provider-turn-prepare.ts` (patch plus stale-auth hunks);
  - (b) stale-auth recovery — new `cursor-provider-auth-recreate.ts` (54 lines) and hunks in
    `cursor-provider-errors.ts`, `cursor-provider-turn-runner.ts` (+165/−52),
    `cursor-live-run-coordinator.ts`, `cursor-provider-live-run-drain.ts`,
    `cursor-provider-run-finalizer.ts`, `cursor-provider-turn-emit.ts`, `cursor-provider-turn-prepare.ts`:
    on retryable Cursor auth codes before any progress, tear down and recreate the agent once;
  - (c) model variants — `model-discovery.ts` (+20/−3): `reasoning_effort` accepted as the effort
    parameter, and an unqualified model ID added for context-variant models (standard context
    256k), which yields IDs such as `cursor/claude-opus-5-5@1m`. This change exists only in the
    installed copy; it is not in the editable checkout and no document records it.
  - The editable checkout holds the tests: `cursor-compaction.test.ts`,
    `cursor-compaction-prepare.test.ts`, `auth-recreate-fixtures.ts`, and four stale-auth files
    (`cursor-live-run-auth-recreate`, `cursor-provider-auth-recreate`,
    `cursor-provider-run-finalizer-auth-recreate`, `cursor-provider-turn-runner-auth-recreate`).
- `pi-cursor-sdk` 0.3.10 (npm, upstream `github.com/fitchmultz/pi-cursor-sdk` tag `v0.3.10` =
  `8a5c0aa`): loads `dist/index.js`; supports transcript contexts via `src/cursor-pi-context.ts`
  (0.3.7+); has **no** `disablePiToolBridge`, no stale-auth recreate, no variant IDs. The functions
  the stale-auth code hooks (`emitCursorLiveTurn`, `awaitFinalizeCursorRunOutcome`,
  `startLiveRunCompletion`, `applyTerminalEvent`, `invalidateSessionAgent`,
  `resetSessionCursorAgent`, `cursorLiveRuns`, `sdkProcessErrorGuard`,
  `classifyCursorConnectError`) all exist. Source tree 114 files vs 107. The npm tarball ships
  `src`, `dist`, build script and tsconfig, but no tests or lockfile.
- Servers: Pi 0.85.1; adapter stock 0.1.42 (`src/index.ts`); packages `npm:pi-cursor-sdk`,
  `npm:pi-nvidia-nim`, `npm:pi-extension-nvidia-nim`, `../../playground/pi-web-access`.
- `pi install npm:<pkg>@<version>` writes a pinned spec to `settings.json`.

## Build order

Task workspace (0700, retained): `~/.pi/agent/backups/pi087-cursor-0310-20260923/` —
`evidence/`, `rollback/`, `dev/` (upstream clone), `runtime/` (private npm prefix), `probe/`.

### Phase 0 — baselines (no production change)

1. Record Mac Pi version and launcher target; SHA-256 of `settings.json`, `models.json`,
   `extensions/*.ts`, the app's `alpi-luna-websocket-recovery.ts`, and every adapter `src/*.ts`.
2. Record the Cursor model-ID baseline from the installed runtime: `pi --list-models cursor`
   (stdin `/dev/null`), IDs only.
3. Save the A/B probe (script + parser from `/private/tmp/pi-cursor-ab`) in `probe/` for reuse.

### Phase 1 — port in the upstream clone (no production change)

1. `git clone --branch v0.3.10 --depth 1` upstream into `dev/`; confirm `HEAD` = `8a5c0aa` and that
   its `src/` matches the npm tarball `src/` byte-for-byte. Install dev dependencies from the
   repo's lockfile (`npm ci`), never upgrading versions.
2. Baselines on the untouched tag: `npm run build` must reproduce the tarball `dist/`
   byte-for-byte; record `npm run typecheck` and `npm test` results (pre-existing failures are
   recorded, not fixed). **Stop and ask** if `dist/` does not reproduce.
3. Copy the ported tests into `test/` (the 0.3.6 maintenance copies for compaction; the checkout's
   four stale-auth files and fixture helper), adapting only imports/stubs needed for 0.3.10.
   Add one small `cursor-model-variants.test.ts` for fix (c) using the existing
   `__testUtils.registerModelItems` / metadata getters / `buildCursorModelSelection` seam: a
   context-variant model keeps its unqualified and context-qualified IDs with their selection and
   context parameters, and a `reasoning_effort` model keeps its thinking levels and sends the
   chosen effort under `reasoning_effort` (audit P1-03). Its expected values are confirmed by
   running it against the installed Mac `model-discovery.ts` in a temporary copy of the 0.1.60
   checkout. Run all ported tests on stock 0.3.10 and record the red failures.
4. Port the fixes as small edits to 0.3.10's existing functions — no new architecture:
   - (a) omitted or empty tools resolve to an empty set; turn preparation passes
     `disablePiToolBridge` when that set is empty; session-agent creation skips bridge
     registration for that call. Tools come from 0.3.10's `resolveCursorPiContext`, so the rule
     covers both legacy and transcript contexts.
   - (b) put the three stale-auth helpers (`hasEmittedProgress`, `shouldAttemptAuthRecreate`,
     `teardownFailedAuthAttempt`) into the already-patched `cursor-provider-turn-runner.ts` — their
     only importer on the Mac; none of their dependencies imports the turn runner, so no cycle —
     and apply the matching hunks at the hook points above. No new file is added, so every
     patched runtime file has a stock before-image and the unchanged checker works (audit P1-01).
     The two stale-auth test files that import the helper module import the turn runner instead.
   - (c) apply the `model-discovery.ts` logic using 0.3.10's own ID encoding.
   - **Stop and ask** if 0.3.10 changed a behavior a Mac fix depends on so that porting needs a
     redesign rather than an equivalent edit.
5. `npm run build`, `npm run typecheck`, `npm test`: ported tests green; no new failures versus
   the baseline; stock-vs-ported `dist/` differs only in modules built from changed sources.
6. Produce the tracked recovery assets in alamelu-tauri:
   `maintenance/pi-cursor-sdk/0.3.10/mac-local-fixes.patch` (every changed `src` and `dist` file,
   relative to the npm package layout; all of them exist in stock 0.3.10), `0.3.10/test/` (the
   ported tests and the model-variant test), and a `"0.3.10"`
   manifest entry (`entry: dist/index.js`, before/after hashes of every changed file, asset
   hashes). Verify with the runbook sequence on a stock copy: checker `--baseline`,
   `patch --dry-run`, `patch`, checker (after). `check-cursor-compaction.py` itself is unchanged.

### Phase 2 — private runtime candidate (no production change)

1. `npm install --prefix runtime/ pi-cursor-sdk@0.3.10` (published production dependencies); apply
   the patch; checker passes on `runtime/node_modules/pi-cursor-sdk`.
2. Private agent dir (0700): `settings.json` with `packages` = the candidate path only;
   `auth.json` (0600) holding only the `cursor` entry, copied without printing and deleted at
   cleanup; `PI_CODING_AGENT_DIR` points to it. Pi = staged 0.87.1 `dist/cli.js` with Node v24.16.0.
3. A/B probe with this runtime: Pi `read` executed and `CODE=ZEBRA-4471`.
4. Live compaction by the September method (`live-check.py` + `observer.ts`, private session,
   manifest-loaded package instead of `-e src/index.ts`): manual and automatic runs must show the
   compaction event, nonempty text summaries, no `probe_executed` / tool call during summaries,
   then a successful `read` turn. Automatic may use a private threshold only.
5. Stale-auth recovery cannot be forced live on demand; its proof is the ported tests plus the
   normal live turns above. Recorded as a known limitation, not worked around.

### Phase 3 — Mac activation (maintenance window)

1. Owner quits Alamelu Pi (asked at that time). Confirm no Pi processes remain; snapshot the
   Phase 0 hashes plus the list and hashes of owner session files touched in the last 7 days.
2. Rollback capture: tar of the Pi 0.85.1 package directory and its launcher target; tar of
   `~/.pi/agent/npm`; copy of `settings.json`.
3. `npm install -g @earendil-works/pi-coding-agent@0.87.1` with nvm Node v24.16.0; re-point nvm
   `bin/pi` to `dist/cli.js`; Luna check through `/Users/sudhirjha/.local/bin/pi`.
4. First confirm on a private agent-dir copy that `pi install npm:pi-cursor-sdk@0.3.10` replaces the
   `npm:pi-cursor-sdk` entry rather than adding one; then run it for real. Only that entry may
   change in `settings.json`. Checker `--baseline` → apply patch → checker (after).
5. Installed gates: Luna check; checker; A/B probe (real config, `--no-session`, `--tools read`);
   the sync script's three provider probes (xai, xai-i2o `grok-4.5:high`, openai-codex
   `gpt-5.6-luna:high`); model-ID parity against the Phase 0 baseline.
6. Gate 4 from a clean `git archive HEAD` export of alamelu-tauri (so other agents' uncommitted
   work is untouched): `pnpm install --frozen-lockfile`, `pnpm --filter @alamelu-pi/desktop run build`,
   then `PI_GUI_PI_BIN=<installed dist/cli.js> pnpm --filter @alamelu-pi/desktop run
   test:e2e:runner -- apps/desktop/tests/core/compacted-model-switch.spec.ts`; and the installed
   app smoke `ALAMELU_TAURI_APP_PATH='/Applications/Alamelu Pi Tauri.app' pnpm --filter
   @alamelu-pi/desktop run smoke:tauri:packaged` (the script's own isolated state; the export
   has no Tauri bundle — audit P1-02).
7. Re-check the snapshot hashes (`auth.json` may change only by token refresh). Owner reopens the
   app; confirm its Pi children start and the backend log shows no extension-load failure.
8. Any failed gate: restore from the rollback tars and settings copy, re-point the launcher,
   re-run the Luna check, report and stop.

### Phase 4 — servers (outside 09:15–15:30 IST)

SSH `ubuntu@216.48.178.36` (mock) and `ubuntu@216.48.177.217` (backup); S3 relay if SSH times out.

1. Each server: record Pi/adapter versions, the Cursor model-ID list, and running Pi processes
   (report only); tar `~/.pi/agent/npm`; copy `settings.json`.
2. Each server: `pi install npm:pi-cursor-sdk@0.3.10` (stock; still on Pi 0.85.1, which 0.3.10
   supports); A/B probe passes.
3. From the laptop: `bash scripts/server_pi_maintenance.sh` (alamelu). It must pass and leave
   both servers at 0.87.1; if npm `@latest` is no longer 0.87.1, **stop and ask**.
4. Each server: A/B probe on 0.87.1; `composer-2.5` and `composer-latest:fast` still listed.
   **Stop and ask** if Cursor fails under the servers' default (bundled) launcher.
5. Rollback per server: restore the `~/.pi/agent/npm` tar and `settings.json`;
   `npm install -g @earendil-works/pi-coding-agent@0.85.1`.

### Phase 5 — records and cleanup

1. alamelu-tauri: the 0.3.10 assets and manifest entry (Phase 1.6); `REBUILD-PROTECTION.md` —
   last verified release, Mac Pi 0.87.1 + adapter 0.3.10 loading `dist/index.js`, 0.3.10 recovery
   commands, launcher fix still required on 0.87.1, WSL pending (0.85.1 + 0.3.6, deferred
   2026-09-23); dated evidence under the ignored `documents/release-evidence/pi087-mac-20260923/`;
   `pnpm run verify:upgrade` from the clean export plus these files.
2. Copy the changed canonical files into the Mac kit
   (`~/Library/Application Support/Alamelu Pi/maintenance-kit`). The WSL/Windows kits wait for WSL.
3. Append a `progress.md` entry in alamelu. That file already has other uncommitted edits, so the
   owner decides whether and how it is committed.
4. Commit only this task's alamelu-tauri paths after implementation PASS and owner authorization.
5. Update the repo-memory note that still says "Mac 0.1.60 loads src" to the new versions.
6. Delete the private auth copies. Other temp directories (`/private/tmp/pi-0.87.1-stage`,
   `/private/tmp/pcs-*`, `/private/tmp/pi-cursor-ab`) are removed only with owner approval; the task
   workspace and rollbacks are retained.

## Verification map

- Done 1 — Phase 3.3 Luna check. Done 2 — Phase 3.4 checker. Done 3 — Phase 3.5 A/B probe.
- Done 4 — Phase 1.3/1.5 red→green tests (compaction, stale-auth, model-variant; the model-variant
  baseline against the installed Mac file); Phase 3.5 parity. Done 5 — Phase 2.4 live compaction.
- Done 6 — Phase 3.6. Done 7 — Phase 4. Done 8 — Phase 5.
- Results go in `pi087_cursor_0310_upgrade_implementation.md` as Verification Round N with the real
  commands and outcomes.

## Stop conditions and limits

Stop and ask the owner if: `dist/` does not reproduce; a port needs redesign; parity fails for IDs
not covered by fix (c); any installed gate fails (after rollback); servers would land on a Pi version
other than 0.87.1; Cursor fails on the servers' bundled launcher. Known limit: stale-auth recovery
is proven by tests, not by a live expired-login event.

## Files this task writes

- alamelu-tauri: `documents/plan-audit-implementation/pi087_cursor_0310_upgrade_{plan,audit,implementation}.md`,
  `maintenance/pi-cursor-sdk/manifest.json`, `maintenance/pi-cursor-sdk/0.3.10/**`,
  `documents/REBUILD-PROTECTION.md`, `documents/release-evidence/pi087-mac-20260923/**` (ignored).
- alamelu: `documents/progress.md` (append only).
- Mac runtime: Pi global package and nvm launcher; `~/.pi/agent/npm`; one `settings.json` package
  entry; the Mac maintenance kit; the task workspace.
- Servers: `~/.pi/agent/npm`; one `settings.json` package entry; Pi global package (via the sync
  script, which also performs its usual auth/models/extension sync).
