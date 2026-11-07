# Implementation: Pi on the Mac from nvm to Homebrew, with Alamelu Pi Tauri fixed in the same change

Builder: Claude (Opus 5.5). Critic: Fable (high), as an agent. Plan: `pi_homebrew_migration_plan.md` (Fable PASS, plan
round 2; decision-model check 1 clean). Criteria: `pi_homebrew_migration_criteria.md`. Audit: `pi_homebrew_migration_audit.md`.

## Changes

App (alamelu-tauri, working tree on `main` at bbdc427):
- Deleted (`git rm`): `apps/desktop/resources/alpi-luna-websocket-recovery.ts`,
  `apps/desktop/tests/unit/alpi-luna-websocket-recovery.test.mjs`, `apps/desktop/electron/pi-ai-patch.mjs`,
  `apps/desktop/scripts/patch-global-pi-ai.mjs`, `apps/desktop/tests/unit/pi-ai-patch.test.mjs`.
- `electron/main.ts`: removed the pi-ai patch import, `ensurePiAiPatched` and its call, the Luna extension resolver, its
  constant and the `extensionPaths` spread, the store's `piBin` argument (the driver's own `piBin` at the old line 658
  stays), and the two imports left unused (`writeFile`, `existsSync`).
- `src-tauri/tauri.conf.json`, `scripts/build-tauri-backend.mjs`, `electron-builder.alpi.yml`: the Luna resource entries;
  `tests/unit/alpi-packaging.test.mjs`: the matching expectation.
- `electron/model-switch-preflight.ts`: `evaluateModelSwitch(stats, target)` keeps only the connection and context-size
  checks; the collision branch, `piPatchApplied`, the archive scan (`legacyNormalizedId`, `hasCollidingToolCallIds`,
  history model fields), `isPiPatchApplied` and its constants are gone. `readThreadStats` keeps its signature (the
  upgrade gate's wiring test asserts the call site) and now only estimates the active context; its folder and id
  parameters are marked unused with a comment.
- `electron/app-store-composer.ts`: import and third argument removed. `electron/app-store.ts`,
  `electron/app-store-internals.ts`: the store's `piBin` (read only by the patch check) removed.
- `tests/unit/model-switch-preflight.test.mjs`: collision, patch and archive-scan cases removed; third argument dropped;
  8 tests remain (connection, context size, compaction, content estimate).
- `electron/external-pi-auth-bridge.ts`: new `externalPiPackageRoot` (three layouts: `dist/cli.js`, `dist/bundle/cli.js`,
  Homebrew `<keg>/bin/pi` with `<keg>/libexec/lib/node_modules/@earendil-works/pi-coding-agent/package.json` naming the
  package); `externalPiAuthModulePaths` uses it and keeps its error text. `tests/unit/external-pi-auth-bridge.test.mjs`:
  three new tests (bundled entry; Homebrew keg, including a wrong package name; unknown layouts).

## Verification Round 1 — app change (2026-11-07 16:23 IST)

```
$ grep -rn -i -E "luna-websocket|alpi-luna|pi-ai-patch|patch-global-pi-ai|isPiPatchApplied|piPatchApplied|ensurePiAiPatched|pi-patch-state" (code, config, tests; excluding node_modules, out/, documents/)
packages/pi-rpc-driver/test/rpc-client.test.mjs:281:  const extensionPath = '/tmp/alpi-luna-websocket-recovery.mjs';
```
(only the driver's generic extension-path fixture name, which the plan keeps unchanged)

```
$ node --test apps/desktop/tests/unit/model-switch-preflight.test.mjs        -> tests 8, pass 8, fail 0
$ node --test apps/desktop/tests/unit/external-pi-auth-bridge.test.mjs apps/desktop/tests/unit/alpi-packaging.test.mjs
                                                                              -> tests 10, pass 10, fail 0
$ pnpm --filter @alamelu-pi/desktop run typecheck
  tsc -p tsconfig.json --noEmit && tsc -p tsconfig.electron.json --noEmit    -> no errors
$ node --test apps/desktop/tests/unit/*.mjs (17 files)                         -> tests 73, pass 73, fail 0
$ pnpm run verify:upgrade
  tests 20, pass 20, fail 0 (8 preflight, 9 RPC tree/compaction, 3 wiring)
  PASS: recovery patches and version-specific tests intact (installed runtime not checked)
  Ran 8 tests ... OK
  Upgrade build gate passed.
```

## Verification Round 2 — build, Homebrew pi, candidate, cutover, Cursor (2026-11-07 16:24-16:33 IST)

Build and sign (I2):
```
$ pnpm run package:tauri            -> EXIT 0 (gate passed; Rust "Finished release in 1m 05s"; bundle built 16:25)
  (rebuilt 16:28 after a one-sentence checklist fix: Rust 15.75s; EXIT 0)
  bundled maintenance-kit REBUILD-PROTECTION.md and PI-UPGRADE-WINDOWS.md: cmp-identical to the repository
  Contents/Resources: alpi-icon.icns backend maintenance-kit   (no extensions/ folder: the Luna extension is gone)
$ pnpm --filter @alamelu-pi/desktop run sign:tauri -> valid on disk; satisfies its Designated Requirement
$ codesign -dvvv <bundle> | grep Authority          -> Authority=Alamelu Pi Local Code Signing (same as the old app)
Rust build folder apps/desktop/src-tauri/target: 1.3G
```
Homebrew pi (Order step 4). `brew install --dry-run` showed pi 1.5.0, 4 new dependencies and 17 upgraded ones (node
26.5.0 -> 26.13.0_2 among them). Installed with `HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1` so the install did not go on
to upgrade unrelated formulae that depend on those libraries (16:26:37-16:27:13, exit 0).
```
/opt/homebrew/bin/pi -> ../Cellar/pi-coding-agent/1.5.0/bin/pi
wrapper: #!/bin/bash / PI_SKIP_VERSION_CHECK="1" exec "/opt/homebrew/Cellar/pi-coding-agent/1.5.0/libexec/bin/pi" "$@"
libexec/bin/pi -> ../lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js
dist/bundle/cli.js first line: #!/opt/homebrew/opt/node/bin/node   (Homebrew rewrote the shebang: pi runs on Homebrew Node)
dist/cli.js, dist/index.js, dist/modes/interactive/interactive-mode.js present; package.json name @earendil-works/pi-coding-agent
/opt/homebrew/bin/pi --version -> 1.5.0
```
This corrected one sentence I had written into REBUILD-PROTECTION.md (that the app would run pi on nvm's Node); fixed
before the rebuild.

Candidate test (Order step 5; old app closed and not running, no single-instance lock in the Rust code):
```
$ PI_GUI_PI_BIN=~/.nvm/.../pi-coding-agent/dist/cli.js pnpm --filter @alamelu-pi/desktop run smoke:tauri:packaged
  nvm exit 0: Packaged Tauri smoke: OK (49 providers, 860 models, 91 API members)
$ PI_GUI_PI_BIN=/opt/homebrew/bin/pi pnpm --filter @alamelu-pi/desktop run smoke:tauri:packaged
  homebrew exit 0: Packaged Tauri smoke: OK (49 providers, 860 models, 91 API members)
```
Same N (49), far above the 17-18 of a broken bridge.

Cutover (Order step 6; nothing named the old paths: no running pi, crontab, LaunchAgents or shell files). Moved into
`~/pi-homebrew-hold/` at 16:29:51, with `RESTORE.txt` listing each item's original path: the old
`/Applications/Alamelu Pi Tauri.app`, nvm's `pi-coding-agent` package and its `bin/pi` link, `~/.local/bin/pi`,
`~/.local/bin/pi_update_safe`, the old `~/.pi/agent/bin/pi` link; a copy of `settings.json`. Then: `ditto` of the signed
bundle into `/Applications` (codesign -v valid; Authority=Alamelu Pi Local Code Signing); `~/.pi/agent/bin/pi ->
/opt/homebrew/bin/pi` (node/npm/npx links unchanged); `settings.json` gained
`selfUpdateCommand: ["/opt/homebrew/bin/brew","upgrade","pi-coding-agent"]`, every other key kept (`npmCommand` set).

I3:
```
$ bash -lc 'type -a pi | sort -u; pi --version'   -> pi is /opt/homebrew/bin/pi / 1.5.0
$ zsh -lic 'whence -a pi | sort -u; pi --version' -> /opt/homebrew/bin/pi / 1.5.0
$ ~/.nvm/versions/node/v24.16.0/bin/npm ls -g --depth=0 | grep pi-coding -> no pi-coding-agent under nvm
```
I4 (app opened through LaunchServices with `open -a`, as Finder does; Sudhir told first):
```
60794 /Applications/Alamelu Pi Tauri.app/Contents/MacOS/alamelu-pi-tauri
61423 /Users/sudhirjha/.hermes/node/bin/node .../Resources/backend/main.cjs   (backend Node: unchanged, Rust's own lookup)
61889 pi   (txt: /opt/homebrew/Cellar/node/26.13.0_2/bin/node)
backend env: PI_GUI_PI_BIN=/opt/homebrew/Cellar/pi-coding-agent/1.5.0/bin/pi, PI_GUI_BRAND=alpi
alpi-startup-debug.log 11:00:17Z: store initialized workspaces=12 sessions=263 providerCounts=49 (x12) modelCounts=860 (x12)
  (2 Nov with nvm pi: providerCounts=49, sessions=262)
```
Turns (private throwaway sessions under `/private/tmp`, cwd there; never Sudhir's threads):
```
pi -p --session-dir $T/sessions --provider openai-codex --model gpt-6-luna:low "Reply with the single word: alpha" -> alpha
pi -p --session-dir $T/sessions -c --provider cursor --model composer-2-5 "What single word did you reply with ..." -> alpha
session: model_change openai-codex gpt-6-luna; assistant openai-codex gpt-6-luna stop; assistant cursor composer-2-5 stop
```
That is a chat reply, a model switch with history replay, a gpt-6-luna turn and a Cursor turn (patched adapter still in
place), on Homebrew's pi. The chat UI itself was not clicked; it drives the same pi RPC child. The app was then quit
with AppleScript (it had been closed before); no app or pi process left.

I5:
```
$ pi update --self      -> pi is already up to date (v1.5.0)
$ pi update --self --force -> Updating pi with /opt/homebrew/bin/brew upgrade pi-coding-agent... / Warning: pi-coding-agent 1.5.0 already installed / exit 0
```
Cursor adapter (Order step 7):
```
$ check-cursor-compaction.py --package ~/.pi/agent/npm/node_modules/pi-cursor-sdk -> PASS: 0.5.3, source and manifest-loaded runtime fixed (patched, before)
moved the patched package to ~/pi-homebrew-hold/pi-cursor-sdk-patched (RESTORE.txt updated)
$ pi install npm:pi-cursor-sdk@0.5.3 -> Installed npm:pi-cursor-sdk@0.5.3 (version 0.5.3; settings packages unchanged)
$ check-cursor-compaction.py --package ... --baseline -> PASS: pi-cursor-sdk 0.5.3, baseline only (stock hashes)
pi -p --no-session --provider cursor --model composer-2-5 "Reply with the single word: beta" -> beta
pi -p --session-dir $T/sessions --provider cursor --model "claude-haiku-5-5@300k" "... gamma" -> gamma (assistant cursor claude-haiku-5-5@300k stop)
```
Stale-login recovery not staged (owner change 16:02).

## Verification Round 3 — "sync pi", documents, cards, rules (2026-11-07 16:34-16:40 IST)

alamelu `scripts/server_pi_maintenance.sh`: one block before the Mac preflight (Homebrew missing -> skip line; dry run ->
"would run" line; real run -> `HOMEBREW_NO_INSTALL_CLEANUP=1 /opt/homebrew/bin/brew upgrade pi-coding-agent` inside
`if brew_output=$(...)`, version before/after, summary line, FAIL sets `overall_status=1` and the run carries on).
```
$ bash -n scripts/server_pi_maintenance.sh -> OK
$ bash scripts/server_pi_maintenance.sh --dry-run < /dev/null   (16:34:11-16:34:15, EXIT 0)
  === PI upgrade (Mac, Homebrew) ===  DRY_RUN: would run brew upgrade pi-coding-agent
  summary: Mac brew: would run brew upgrade pi-coding-agent / Mac tests: skipped (dry run) /
           mock pi: 1.1.0 (would_update) ... result: PASS / backup pi: 1.1.0 (would_update) ... result: PASS / RESULT: PASS
$ the block alone, real path (set -Eeuo pipefail, DRY_RUN=0; no servers touched):
  PASS brew upgrade: pi 1.5.0, already up to date / overall_status=0 / summary "Mac brew: pi 1.5.0, already up to date"
```
alamelu `AGENTS.md` "sync pi" paragraph: the Mac Homebrew step, held-back clean-up, reopen the app; "upgrades pi on the
servers". The lazydata copy is copied after the alamelu push (owner, 16:12).

Global rule (`~/.repo-memory/owner-rules.md:210`, copy kept at `/private/tmp/pi-homebrew-debate.P1EvTj/owner-rules.md.before`):
```
- **Pi updates on the Mac:** "sync pi" (it runs `brew upgrade pi-coding-agent` first, then the servers), or
  `brew upgrade pi-coding-agent` / `pi update` for the Mac alone; reopen Alamelu Pi afterwards (Homebrew pi since 7 Nov
  2026). The full checklist is in repo-memory's Pi cards.
$ repomem rules sync -> ~/.claude/CLAUDE.md:211 carries the new line
```
repo-memory cards (global): new mem_367905eed951 ([G-ops] summary), mem_29550fc61a9a (routine Mac Pi updates),
mem_4ef89d9260c6 (Tauri rebuild/Pi update) approved -> active; old mem_5768716fdec7, mem_98db28bf6d3d,
mem_60a5e7594386 rejected -> retracted. `~/.local/bin/memory_check` -> OK: 16 global rules match.

agents-brain `access/operating-facts.md:34` -> the same route as the global rule.

Maintenance kit (`~/Library/Application Support/Alamelu Pi/maintenance-kit`): of its 32 manifest entries only the two
documents differed from the repository; copied them and rewrote their hashes. After: 32 entries, 0 mismatches between
manifest, kit files and repository (old manifest kept at `/private/tmp/pi-homebrew-debate.P1EvTj/kit-manifest.json.before`).

alamelu-tauri docs: `README.md` "The pi-ai patch" section removed; `AGENTS.md` rebuild line; `documents/REBUILD-PROTECTION.md`
(top line, three table rows, gate test counts 20 and 8, adapter recovery and the Mac checker `--baseline`, release gate 1
WSL only, new section "Mac release 2026-11-07", Mac evidence copies); `documents/PI-UPGRADE-WINDOWS.md` (Mac line at the top).

alamelu `documents/progress.md`: new 2026-11-07 entry. The file already held older uncommitted entries that are not part of
this work (2 Oct - 13 Oct); they stay uncommitted: the commit stages only this entry, from a patch against HEAD
(`git apply --cached --check` passes).

## Verification Round 4 — Finder-like launch and in-app check (2026-11-07 16:43-16:51 IST)

First relaunch with a bare `env -i ... PATH=/usr/bin:/bin:/usr/sbin:/sbin open -a`: backend on nvm Node 24.16.0, PATH
`~/.nvm/versions/node/v24.16.0/bin:/opt/homebrew/Cellar/pi-coding-agent/1.5.0/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
`PI_GUI_PI_BIN=/opt/homebrew/Cellar/pi-coding-agent/1.5.0/bin/pi`, providerCounts=49 (x12), modelCounts=813.
A real Finder launch also carries the five `CURSOR_*` variables launchd holds (set by
`com.sudhirjha.opencode-pi-cursor-env`), so the app was relaunched once more with launchd's PATH plus those five
(`/private/tmp/pi-homebrew-debate.P1EvTj/finder_launch.sh`). A first attempt of that script put the variables after
`open -a`, so `open` printed them as missing files; they are settings, not secrets (`CURSOR_API_KEY` is set to a placeholder,
not a credential). Fixed and relaunched:
```
88674 ~/.nvm/versions/node/v24.16.0/bin/node .../Resources/backend/main.cjs
PATH=~/.nvm/versions/node/v24.16.0/bin:/opt/homebrew/Cellar/pi-coding-agent/1.5.0/bin:/usr/bin:/bin:/usr/sbin:/sbin
PI_GUI_PI_BIN=/opt/homebrew/Cellar/pi-coding-agent/1.5.0/bin/pi
CURSOR variables present (names): CURSOR_ACP_BACKEND CURSOR_ACP_MODEL_AUTO_REFRESH CURSOR_ACP_SDK_RUNNER_PATH CURSOR_ACP_TOOL_LOOP_MODE CURSOR_API_KEY
alpi-startup-debug.log: workspaces=12 sessions=263 providerCounts=49 (x12) modelCounts=813 (x12)
```
Model count 813, against 860 at 16:30. Cause, checked: the stock Cursor adapter (installed 16:32) lists 251 Cursor models;
47 unqualified ids are gone and only their context-sized forms remain (`claude-opus-5-5` -> only `claude-opus-5-5@...`;
also `claude-fable-5-1`, `claude-haiku-5-5`, `claude-sonnet-4-6`, ...). That is the "unqualified context-variant model
IDs" fix in `0.5.3/mac-local-fixes.patch`, dropped by Sudhir's ruling. Default model (xai-i2o grok-4.6) unaffected; of
7,100 session files, 1 thread's current model is Cursor `claude-opus-5-5`, which now needs a re-pick. Reported to Sudhir;
the patched copy stayed in the hold folder until he decided.

In-app check (I1-1 remedy), 16:51 IST: Sudhir tested the Finder-like-launched app himself: "I checked cursor opus 5.5@1M
and gpt luna 5.6 and 6 and everything is fine." That is turns on three models (a Cursor context-sized id, gpt-5.6-luna
and gpt-6-luna) in the app's own chat, on Homebrew's pi. On the Cursor ids he answered "2 is fine": the stock adapter
stays (owner change recorded in the criteria). No throwaway thread was created by me; no computer-use access was requested.

After Sudhir's "keep the stock Cursor adapter" (16:52): `REBUILD-PROTECTION.md` adapter-recovery paragraph now says stock
0.5.3 lists Cursor models only with their context size (47 unqualified ids came from the patch); the kit copy and its hash
re-synced (32 entries, 0 mismatches); card mem_4ef89d9260c6 replaced by mem_fb0ea5dba49f with the same note
(`memory_check` OK). The app bundle installed at 16:29 carries the checklist from 16:28 inside its own kit copy; the next
build refreshes it, and the stable kit in Application Support is current.
