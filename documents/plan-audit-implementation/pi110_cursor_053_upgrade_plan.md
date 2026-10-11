# Pi 1.1.0 + pi-cursor-sdk 0.5.3 — Mac upgrade, then "sync pi" to the servers

Date: 2026-10-11. Builder: Claude (Opus 5.5). Critic: Claude Fable (effort high).
Workflow: debate-loop — full plan → Plan Audit until PASS → owner approval → implementation →
Implementation Audit. Nothing in this plan runs before the owner explicitly approves it.

## Owner brief (2026-10-10/11)

1. "Looks like we are way behind on pi. Can we upgrade on this laptop and then sync pi please?"
2. After the builder explained the risks: "so do it using debate-loop, Fable critic — full plan. I
   approve and then you implement."
3. Standing rules that apply: follow `documents/REBUILD-PROTECTION.md` for any Pi upgrade; WSL is
   deferred (owner has no access to the Windows laptop until month end); keep scope tight and a
   sense of proportion — what really matters vs "ok, whatever".

## Outcome

The Mac runs Pi 1.1.0 with a Cursor adapter that keeps every Mac fix still needed, and Alamelu Pi's
protections still hold. Mock and backup run Pi 1.1.0 with Cursor still working for the relay and
readiness chains. Everything is recorded so it can be rebuilt, checked and rolled back.

## Done when

1. Mac Pi is 1.1.0; nvm `bin/pi` → `dist/cli.js`; the Luna extension RPC check passes through
   `/Users/sudhirjha/.local/bin/pi` (REBUILD-PROTECTION gate 1).
2. Mac adapter is `pi-cursor-sdk` 0.5.3 (+ reviewed patch only for fixes upstream does not already
   cover); `scripts/check-cursor-compaction.py --package ~/.pi/agent/npm/node_modules/pi-cursor-sdk`
   passes against a new `0.5.3` manifest entry (gate 2).
3. Every ported test that is red on stock 0.5.3 is green on the patched build; tests green on stock
   0.5.3 are recorded as "covered upstream" and those fixes are not ported.
4. A/B probe on the installed Mac runtime: Pi `read` tool executed and `CODE=ZEBRA-4471`.
5. Private live manual **and** automatic Cursor compaction on the staged runtime: compaction events
   occur, summaries are nonempty text, no Pi tool call or bridge execution inside either summary, then
   a successful ordinary tool turn (gate 3).
6. `compacted-model-switch.spec.ts` passes against installed Pi 1.1.0 (gate 4) and
   `smoke:tauri:packaged` passes with isolated state; after the owner reopens the app, its Pi children
   start with no extension-load failure.
7. Model-ID parity: every Cursor model ID listed before (Mac and servers) is still listed after, or
   each difference is explained by an upstream catalog change and the relay-chain IDs
   (`composer-2.5`, `composer-latest:fast`) are present.
8. Mock and backup: `scripts/server_pi_maintenance.sh` passes and leaves both on Pi 1.1.0; on each,
   the A/B probe passes and the relay-chain Cursor IDs are listed (adapter per ruling D1).
9. Records: 0.5.3 assets and manifest entry tracked in alamelu-tauri; `REBUILD-PROTECTION.md` updated;
   dated release evidence; Mac maintenance kit synced; alamelu `progress.md` entry; rollbacks retained.

## Decisions for the owner (needed at approval)

- **D1 — servers' Cursor adapter.** Both servers run Pi on Node 22.22.3
  (`~/.local/share/pi-node/node-v22.22.3-linux-x64`, via the `~/.local/bin/pi` wrapper). Adapter
  0.4.0+ requires Node 24, so stock 0.5.3 cannot simply be installed there. Options:
  (a) keep stock 0.3.10 on the servers under Pi 1.1.0, decided by a non-destructive staged test on
  mock first (Phase 2.9) — **recommended**; (b) add Node 24 for the servers' Pi and move them to stock
  0.5.3 (new Node runtime, wrapper change, Pi reinstall — larger); (c) leave the servers on Pi 0.87.1
  (do not sync). **Owner ruling 2026-10-11: try (a); if (a)'s staged test fails, do (b); (c) only if
  (b) also fails.** Under (b), the builder first stages Node 24 + Pi 1.1.0 + stock 0.5.3 on mock
  non-destructively (same method as Phase 2.9), writes the exact (b) server steps into the
  implementation record, and they are covered by the Implementation Audit before any server change.
- **D2 — target version.** Pi 1.1.0 (latest, 2026-10-07) — **recommended; owner ruling 2026-10-11:
  1.1.0**. Adapter 0.5.3's published
  qualification is on Pi ≤ 1.0.4, but its maintainers' development line is already aligned to Pi 1.1.0
  (changelog "Unreleased"), and this plan's own gates test 1.1.0 directly. The alternative is Pi 1.0.4.
  A startup refresh race (#337) was demonstrated on official Pi 1.0.4 and is not known to be fixed in
  1.1.0; its effect is cosmetic at startup (temporary fallback models or a spurious missing-key warning),
  and the parity and A/B gates would expose it.
- **FYI, no action planned:** Pi 1.0.0 made fullscreen the default terminal UI (`"tuiMode": "regular"`
  in settings restores scrollback) — only affects interactive terminal use, not the app or `pi -p`.
  Pi 0.99.0 labels the OpenAI Codex provider "legacy"; the `openai-codex` provider key keeps working and
  is probed in Phase 2.

## Scope

In: the Mac Pi package and launcher; the Mac adapter (install, port of still-needed fixes, patch, tests,
manifest); the existing "sync pi" run to mock and backup; the servers' adapter per D1; the gates and
records listed here.

Out (owner decides separately): WSL/Windows; any Rust/Tauri rebuild or app source change (if a gate
shows the app needs one, stop and ask); other Pi packages, extensions or providers; server Node changes
(unless D1(b)); changing `server_pi_maintenance.sh`; new upstream features; Pi-Bolt.

## Current state (verified 2026-10-11)

- Mac: Pi 0.87.1 at `~/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent`;
  `~/.local/bin/pi` is a wrapper that execs nvm `bin/pi` (Node v24.16.0, nvm default). Adapter 0.3.10 +
  `0.3.10/mac-local-fixes.patch`; the checker passes ("source and manifest-loaded runtime fixed").
  Settings `packages`: `npm:pi-cursor-sdk@0.3.10`, `../../playground/pi-web-access`. Extensions:
  `00-path-fix.ts`, `global-mandate.ts`, `repomem.ts`, `xai-i2o-oauth.ts`, `xai2-oauth.ts` (no
  `registerCommand` calls). No `commands/`, `tools/`, `hooks/`, `keybindings.json`, `oauth.json` or stray
  root `.jsonl`, so Pi 1.x's startup migrations (`dist/migrations.js`) have nothing to move or rewrite.
  No `azure-openai-responses` key anywhere (Pi 1.0.3 rename does not apply).
- Pi 1.1.0 package: `bin` is still `dist/bundle/cli.js` (npm will reset the launcher again);
  `dist/cli.js`, `dist/index.js`, `dist/modes/interactive/interactive-mode.js` exist (the app's login
  bridge paths); pi-ai 1.1.0 still has `dist/api/openai-codex-responses.js` (Luna's target) and
  `dist/api/openai-completions.js` (the app's pi-ai patch target; that patch is a no-op since Pi
  0.82.1 fixed the bug upstream). Requires Node ≥ 22.19.
- Pi changelog 0.99.0 → 1.1.0 (no 0.88–0.98 releases): breaking items checked — none touch our
  extensions, RPC (additive fields only), settings `packages`, or the custom-provider API; MCP renames
  and codemode changes do not apply.
- `pi-cursor-sdk` 0.5.3 (2026-10-07): Node 24+, Pi 0.87.1+, wildcard peers. Changelog does not record
  our stale-auth recreate fix (b); 0.5.0 isolates LOCAL compaction/tree summaries in text-only agents
  without tools or bridge (may cover fix (a)); 0.5.0/0.5.3 map `reasoning_effort` / thinking+effort
  (may partly cover fix (c)). Tests decide (Phase 1). 0.5.0 breaking: bare
  `ctx.modelRegistry.complete/streamSimple` unsupported for Cursor models — not used by `pi-web-access`
  or our extensions.
- Servers: Pi 0.87.1 on Node 22.22.3; stock adapter 0.3.10; packages `npm:pi-cursor-sdk@0.3.10`,
  `npm:pi-nvidia-nim`, `npm:pi-extension-nvidia-nim`, `../../playground/pi-web-access`. Cursor is used
  by the relay poller fallback chain and lazydata readiness/health/money-operator scripts.
- September harness kept at `~/.pi/agent/backups/pi087-cursor-0310-20260923/evidence/harness/`
  (`ab-probe.sh`, `parse.py`, `live-compaction.py`, `observer.ts`).

## Build order

Task workspace (0700, retained): `~/.pi/agent/backups/pi110-cursor-053-20261011/` — `evidence/`,
`rollback/`, `dev/` (upstream clone), `runtime/` (private npm prefixes), `probe/` (harness copy and
private agent dirs).

### Phase 0 — baselines (no production change)

1. Mac: Pi version and launcher target; SHA-256 of `settings.json`, `models.json`, `extensions/*.ts`,
   the installed app's `alpi-luna-websocket-recovery.ts`, the adapter's patched files, and the adapter's
   two agent-root state files `cursor-sdk-model-list.json` and `cursor-sdk-context-windows.json`; the
   key names (no values) of the `cursor` entry in `auth.json`.
2. Cursor model-ID baselines (IDs only, stdin `/dev/null`): Mac `pi --list-models cursor`; mock and
   backup the same.
3. Servers: Pi/adapter versions, settings `packages`, Node path, running Pi processes (report only).
4. Confirm npm `latest` is 1.1.0 for `@earendil-works/pi-coding-agent` and 0.5.3 for `pi-cursor-sdk`.
5. Copy the September harness into `probe/`.

### Phase 1 — adapter port in an upstream clone (no production change)

1. `git clone --branch v0.5.3 --depth 1` upstream (`github.com/fitchmultz/pi-cursor-sdk`) into `dev/`;
   confirm its `src/` matches the npm 0.5.3 tarball `src/` byte-for-byte; `npm ci` from the repo
   lockfile (no version changes).
2. Baselines on the untouched tag: `npm run build` must reproduce the tarball `dist/` byte-for-byte;
   record `typecheck` and `test` results (pre-existing failures recorded, not fixed). **Stop and ask**
   if `dist/` does not reproduce.
3. Copy the 0.3.10 maintenance tests (16 compaction, 29 stale-auth in four files + fixture helper,
   4 model-variant) into `test/`, adapting only imports/stubs that 0.5.3 moved. Run them on **stock**
   0.5.3 and record each as red (fix still needed) or green (covered upstream).
4. Port only the red fix sets, as small edits to 0.5.3's existing functions — no new architecture and
   no new files (so every patched file has a stock before-image and the unchanged checker works).
   **Stop and ask** if a port needs a redesign rather than an equivalent edit, or if a red test turns
   out to encode behavior 0.5.3 deliberately changed.
5. `build`, `typecheck`, `test`: ported tests green; no new failures versus the baseline; stock-vs-
   patched `dist/` differs only in modules built from changed sources.
6. Tracked recovery assets in alamelu-tauri: `maintenance/pi-cursor-sdk/0.5.3/mac-local-fixes.patch`
   (every changed `src` and `dist` file, npm layout), `0.5.3/test/`, and a `"0.5.3"` manifest entry
   (`entry: dist/index.js`, before/after hashes, asset hashes). If no fix set is red, the entry records
   stock 0.5.3 as already fixed and no patch file is created. Verify the runbook sequence on a stock
   copy: checker `--baseline`, `patch --dry-run`, `patch`, checker. The checker script is unchanged.

### Phase 2 — staged runtime (no production change)

1. `npm install --prefix runtime/pi-1.1.0 @earendil-works/pi-coding-agent@1.1.0` with Node v24.16.0;
   `npm install --prefix runtime/cursor-0.5.3 pi-cursor-sdk@0.5.3`; apply the Phase 1 patch; checker
   passes on the candidate.
2. Private agent dir (0700) = a copy of `~/.pi/agent` **excluding `backups/` and `sessions/`**, with the
   nested `npm/` replaced by the candidate (credentials copied without printing, deleted at cleanup).
   Its `settings.json` lists the candidate adapter and `pi-web-access` by **absolute path** (the live
   entry `../../playground/pi-web-access` is relative to the agent dir and would not resolve from the
   copy). `PI_CODING_AGENT_DIR` points to it. Before any run, check where `@cursor/sdk` keeps its own
   local store; if it is outside the agent dir and shared with production, set `PI_CURSOR_SDK_STATE_ROOT`
   to a private path for every Phase 2 run (answered in the implementation record). Record the private
   dir's file hashes.
3. Luna check with the staged unbundled `dist/cli.js` (must PASS) and the bundled entry (record).
4. Full-extension start: an RPC `get_state` with the private dir's real extension set; stderr shows no
   extension-load error.
5. Migration check: re-hash the private dir after first start; any rewritten file is listed and
   explained (expected: none beyond token refreshes). **Stop and ask** on an unexplained rewrite.
6. Provider probes with the private dir: xai, xai2, xai-i2o (`grok-4.5:high`), openai-codex
   (`gpt-5.6-luna:high`) answer.
7. A/B probe: Pi `read` executed and `CODE=ZEBRA-4471`.
8. Live compaction by the September method (private session, manifest-loaded package): manual and
   automatic runs show the compaction event, nonempty text summaries, no tool call/bridge execution in
   the summaries, then a successful `read` turn. Automatic may use a private threshold only.
9. Server pre-check for D1(a), on mock, non-destructive: stage Pi 1.1.0 into a temp npm prefix with the
   server's Node 22.22.3 and a private copy of the server's agent dir using its stock 0.3.10 adapter;
   run the A/B probe and list `composer-2.5` / `composer-latest:fast`. Result decides D1 before any
   server change.
10. Model-ID parity of the staged Mac runtime against the Phase 0 baseline.

Implementation Audit Round 1 (Fable) covers Phases 0–2 and the D1 result; Phase 3 starts only after
it passes (the September sequence).

### Phase 3 — Mac activation (maintenance window)

1. Owner quits Alamelu Pi (asked at that time). Confirm no Pi processes remain; snapshot the Phase 0
   hashes plus the list and hashes of owner session files touched in the last 7 days.
2. Rollback capture: tar of the Pi 0.87.1 package directory and its launcher target; tar of
   `~/.pi/agent/npm`; copies of `settings.json`, `cursor-sdk-model-list.json` and
   `cursor-sdk-context-windows.json`.
3. `npm install -g @earendil-works/pi-coding-agent@1.1.0` with nvm Node v24.16.0; re-point nvm
   `bin/pi` to `dist/cli.js`; Luna check through `/Users/sudhirjha/.local/bin/pi`. Record the resolved
   versions of the sibling packages (pi-ai, pi-agent-core, pi-tui and the others), since Pi 1.0.1+ no
   longer pins them.
4. First confirm on a private copy that `pi install npm:pi-cursor-sdk@0.5.3` replaces the 0.3.10 entry
   rather than adding one; then run it for real. Only that entry may change in `settings.json`. Checker
   `--baseline` → apply patch (if any) → checker.
5. Installed gates: Luna check; checker; A/B probe (real config, `--no-session`, `--tools read`); the
   four provider probes; model-ID parity.
6. Gate 4 from a clean `git archive HEAD` export of alamelu-tauri (other agents' uncommitted work stays
   untouched): `pnpm install --frozen-lockfile`, `pnpm --filter @alamelu-pi/desktop run build`, then
   `PI_GUI_PI_BIN=<installed dist/cli.js> PI_GUI_DRIVER=rpc PI_GUI_BRAND=alpi pnpm --filter
   @alamelu-pi/desktop run test:e2e:runner -- apps/desktop/tests/core/compacted-model-switch.spec.ts`;
   and `ALAMELU_TAURI_APP_PATH='/Applications/Alamelu Pi Tauri.app' pnpm --filter @alamelu-pi/desktop
   run smoke:tauri:packaged`.
7. Re-check the snapshot hashes (`auth.json` may change only by token refresh) and compare the `cursor`
   entry's key names with Phase 0 (the sync later copies `auth.json` to servers still on adapter 0.3.10).
   Owner reopens the app;
   confirm its Pi children start, the backend log shows no extension-load failure, and the provider and
   model counts are in line with the packaged smoke.
8. Any failed gate: restore from the rollback tars and settings copy, re-point the launcher, re-run the
   Luna check, report and stop.

### Phase 4 — servers (outside 09:15–15:30 IST on trading days)

SSH `ubuntu@216.48.178.36` (mock) and `ubuntu@216.48.177.217` (backup); S3 relay if SSH times out.

1. Each server: tar `~/.pi/agent/npm`; copy `settings.json`.
2. If D1 is (b): install Node 24 for Pi and move the adapter to stock 0.5.3 per the approved steps
   before syncing. If (a): no adapter change.
3. Confirm npm `latest` is still 1.1.0 (the sync script installs `@latest`); otherwise **stop and ask**.
4. From the laptop: `bash scripts/server_pi_maintenance.sh < /dev/null` (alamelu). It must pass and leave
   both servers on Pi 1.1.0.
5. Each server: A/B probe; `composer-2.5` and `composer-latest:fast` listed; Cursor model-ID parity
   against Phase 0. **Stop and ask** if Cursor fails.
6. Rollback per server: restore the `~/.pi/agent/npm` tar and `settings.json`; reinstall Pi 0.87.1 with
   the server's own npm.

### Phase 5 — records and cleanup

1. alamelu-tauri: the 0.5.3 assets and manifest entry; `REBUILD-PROTECTION.md` — last verified release
   (Mac Pi 1.1.0 + adapter 0.5.3, loader path, launcher fix status, which fixes are upstream), the
   servers' Pi/adapter/Node state, WSL still pending (do not move WSL to Pi ≥ 0.86 before its adapter,
   and adapter ≥ 0.4.0 needs Node 24); dated evidence under the ignored
   `documents/release-evidence/pi110-mac-20261011/`; `pnpm run verify:upgrade` from a clean export
   plus these files.
2. Copy the changed canonical files into the Mac kit (`~/Library/Application Support/Alamelu Pi/maintenance-kit`).
3. Append a `progress.md` entry in alamelu, staging only this entry (the file carries other sessions'
   uncommitted edits).
4. Commit only this task's alamelu-tauri paths after implementation PASS and owner authorization; check
   for other sessions' unpushed commits before pushing.
5. Update the memory notes that record Pi/adapter versions.
6. Delete the private credential copies and temp staging dirs created by this task; keep the task
   workspace evidence and rollbacks. The September task workspace is left as is.

## Verification map

- Done 1 — Phase 3.3/3.5. Done 2 — Phase 3.4. Done 3 — Phase 1.3–1.5. Done 4 — Phase 3.5.
- Done 5 — Phase 2.8. Done 6 — Phase 3.6/3.7. Done 7 — Phases 2.10, 3.5, 4.5. Done 8 — Phase 4.
- Done 9 — Phase 5. Results go in `pi110_cursor_053_upgrade_implementation.md` as Verification Round N
  with the real commands and outcomes.

## Stop conditions and limits

Stop and ask the owner if: `dist/` does not reproduce; a port needs redesign; a migration rewrites a
file unexpectedly; parity loses an ID not explained by upstream; any installed gate fails (after
rollback); a gate shows an app change is needed; servers would land on a version other than 1.1.0;
Cursor fails on a server. Known limit: stale-auth recovery is proven by tests, not by a live expired
login.

## Files this task writes

- alamelu-tauri: `documents/plan-audit-implementation/pi110_cursor_053_upgrade_{plan,audit,implementation}.md`,
  `maintenance/pi-cursor-sdk/manifest.json`, `maintenance/pi-cursor-sdk/0.5.3/**`,
  `documents/REBUILD-PROTECTION.md`, `documents/release-evidence/pi110-mac-20261011/**` (ignored).
- alamelu: `documents/progress.md` (append only).
- Mac runtime: Pi global package and nvm launcher; `~/.pi/agent/npm`; one `settings.json` package
  entry; the Mac maintenance kit; the task workspace.
- Servers: Pi global package (via the sync script, which also does its usual auth/models/extension
  sync); and only under D1(b), the Node runtime and adapter.
