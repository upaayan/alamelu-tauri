# Audit: Pi on the Mac from nvm to Homebrew, with Alamelu Pi Tauri fixed in the same change

## Plan Audit Round 1 — Fable (high)

Date: 2026-11-07 16:16 IST. Read-only review of `pi_homebrew_migration_plan.md` (as of the 16:12 lazydata ruling) against
`pi_homebrew_migration_criteria.md`, the council record in `/private/tmp/pi-homebrew-council/`, and the code and files the
plan cites. Nothing was installed, built, run or changed; no model or API was called.

### Restatement

Outcome: one pi on the Mac, from Homebrew's `pi-coding-agent` formula, updated by "sync pi" (which now runs
`brew upgrade pi-coding-agent` first), by `brew upgrade` or by `pi update`; Alamelu Pi Tauri rebuilt so it works with that
pi (Luna extension and pi-ai patch out, sign-in bridge taught Homebrew's layout); nvm's pi gone, nvm's Node kept; the Cursor
adapter back to stock 0.5.3; every live document says the new way.
Scope: Path 2 order; the app change only as P2 says; the prudent-path cutover with one hold folder; the Cursor step; the
"sync pi" Mac step with the lazydata copy made byte-identical after the alamelu push (16:12 ruling); the documents list; lean
backups; rollback per stage. Out of scope: the servers' part of "sync pi", mock and backup, WSL and the Windows app,
sudhir-codex, quota board, Hermes, gateways, pi-bootstrap, Rust code, driver rotation, the app's connection and context checks.
Done: P1-P9 answered yes by reading the named plan sections; PASS = zero high, zero medium, at most 3 low, no open owner decision.

### What I verified (so the findings rest on evidence)

- Rust lookup and canonicalize: `apps/desktop/src-tauri/src/lib.rs:1062-1118` (PI_GUI_PI_BIN, PATH, nvm, `~/.local/bin`,
  `/opt/homebrew/bin`, ...; `canonicalize()` at 1107); backend PATH and `PI_GUI_PI_BIN` at 732-748. The backend realpaths
  again (`process-path.ts:52-69`), so the bridge sees `.../Cellar/pi-coding-agent/<v>/bin/pi` both in the candidate test and
  after cutover; the plan's layout 3 (`<keg>/bin/pi`) is the right key.
- Bridge rule `external-pi-auth-bridge.ts:194-205`; supervisor swallow `external-pi-runtime-supervisor.ts:279-286`; RPC
  spawn `rpc-client.ts:313-325, 358-363` (wrapper runs as is). Luna wiring `main.ts:375-383, 834-837, 857`,
  `tauri.conf.json:46`, `build-tauri-backend.mjs:51-52`, `electron-builder.alpi.yml:19-20`, `alpi-packaging.test.mjs:20`.
  pi-ai patch: `main.ts:35, 676-723, 827-830`, `model-switch-preflight.ts:41, 61-64, 175-192`, `app-store-composer.ts:25, 512`.
- `scripts/verify-upgrade.mjs` names `model-switch-preflight.test.mjs`, `tree-compact.test.mjs`, `upgrade-wiring.test.mjs`
  and the two Python checks only; `upgrade-wiring.test.mjs` asserts the kit resources (documents, three scripts, adapter
  folder), not the Luna resource; `test-upgrade-protection.py` tests the adapter checker only. So deleting the Luna and
  pi-ai files does not break the gate, and no extra file needs editing for it.
- Mac today: `~/.local/bin/pi` is the nvm-only bash launcher; nvm `bin/pi -> dist/cli.js` (7 Nov 13:30); `~/.pi/agent/bin/pi`
  -> nvm `bin/pi`, with `node`/`npm`/`npx` links into nvm v24.16.0; `settings.json` has `npmCommand`, no `selfUpdateCommand`;
  the nvm package is 1.5.0 with `bin: dist/bundle/cli.js`, and `dist/cli.js`, `dist/index.js`, `dist/bundle/cli.js`,
  `dist/modes/interactive/interactive-mode.js` all exist; no `.package-lock.json` under nvm's `lib/node_modules` (a plain
  move leaves nothing stale). `brew info`: formula 1.5.0, not installed, depends on `node`; `HOMEBREW_NO_INSTALL_CLEANUP` unset
  in this shell; `man brew` confirms the clean-up on `upgrade` and the 30-day full clean-up, both suppressed by that variable.
- pi 1.5.0: `PI_SKIP_VERSION_CHECK` short-circuit at `dist/utils/version-check.js:66`; `selfUpdateCommand` honoured via
  `getConfiguredSelfUpdateArgv` (`dist/config.js:268-276`, `package-manager-cli.js:959-972`).
- "sync pi": `server_pi_maintenance.sh:2` `set -Eeuo pipefail`; outer run at :46-105 (preflight :51-77, servers :79-95,
  summary :97-105); `LOCAL_VERSION` read per server child at :796 from `pi --version` (:475-477), so a Mac upgraded by the new
  block is what the servers are compared with; servers install `@latest` (:674). alamelu and lazydata copies are identical
  today (same blob `a7deb918`; lazydata's last change 76b15747 on `dev-main`).
- Documents sweep (P7), mine: alamelu (`pi_update_safe`, nvm path, `dist/cli.js`, Luna, pi-ai, `~/.local/bin/pi`): only
  history (`TODO-13Sep26.md:105`, older `progress.md` entries), `_tool_path.sh:10-11` (nvm Node dirs; still correct, Node
  stays), `AGENTS.md:175-182` (named; "Identical to the lazydata copy" stays true after the 16:12 ruling). agents-brain:
  `access/operating-facts.md:34` only (named). `~/.repo-memory/owner-rules.md:210` (named; `~/.claude/CLAUDE.md:211` is its
  generated copy). repo-memory active cards naming the old way: `mem_98db28bf6d3d`, `mem_60a5e7594386` (named) and
  `mem_5768716fdec7` (named); one more, `mem_e81696e70268`, belongs to the retired alamelu-pi-gui Electron project and
  describes it (history, no change). lazydata documents: only history, backups and the runbook row about `< /dev/null`
  (still correct). alamelu-tauri outside history: `README.md:82-90`, `AGENTS.md:35`, the two documents, the kit (all named);
  `packages/pi-rpc-driver/test/rpc-client.test.mjs:161-178` and `external-pi-auth-bridge.test.mjs:33-38` use the nvm layout
  as path fixtures (still correct, named); `.agent-memory/cards`: no mention (confirmed). The kit manifest lists only files
  that stay in the repository. No crontab entry, LaunchAgent or shell dotfile names `pi_update_safe` or `~/.local/bin/pi`
  (`~/.config/opencode/launchd-set-pi-cursor-env.sh` names no pi path). The plan's list is complete and each "no change" is right.

### Findings

F1-1 (medium). The candidate test cannot show that the bridge fix works. Serves P1 and I2 ("passes the candidate test
against Homebrew pi before the cutover"). Evidence: the plan's pass for Order step 5 is "the smoke passes and its boot log has
no 'unsupported layout' or Luna error, and connected providers are listed (bridge loaded)". `apps/desktop/scripts/smoke-tauri-packaged.mjs:66-67`
asserts only `providerCount > 10` and `modelCount > 100`; `tauri-main.tsx:169-175` counts `runtime.providers.length`, the
catalog, which is listed whether or not the bridge loaded; the supervisor's warning on a failed bridge
(`external-pi-runtime-supervisor.ts:283`) goes to the backend's stderr, which the smoke prints only when it fails. With the bridge
broken the app still shows 17-18 providers (alamelu `documents/progress.md:203`, seen 14 Sep and 11 Oct), so the smoke passes
with break 1 unfixed and the cutover proceeds on a false pass. Remedy (one sentence in the plan, no code): define the pass as
the smoke's closing line `Packaged Tauri smoke: OK (N providers, ...)` showing the same N as the installed app today (49 on
11 Oct per `REBUILD-PROTECTION.md`; record today's N in the baseline before step 5), and keep the child's output so the
"could not load Pi provider authentication metadata" / "unsupported layout" lines can be grepped.

F1-2 (medium). The cutover verification drops the Cursor turn that I4 requires. Serves I4 ("a chat reply, a model switch, a
Cursor turn and a gpt-6-luna turn work") and the council's reason for a separate Cursor step ("so a failure points at one
change", `final_plan.md` and the plan's own "Cursor adapter" step). Evidence: plan "Cutover" step 4 lists "a chat reply, a
model switch, a gpt-6-luna turn"; the first Cursor turn is in "Cursor adapter" step 4, after the patched adapter has been
replaced. Consequence: a Cursor failure there cannot be pinned on Homebrew pi or on the stock adapter, and the I4 evidence is
incomplete. Remedy: add "a Cursor turn (patched adapter still in place)" to Cutover step 4.

F1-3 (low). The pi-ai removal list misses two spots and makes the check that would catch them optional. Serves P2 and I1.
Evidence: the plan names `app-store.ts:138` for the `piBin` field, but `app-store-internals.ts:39` (`readonly piBin`) and
`main.ts:875` (`piBin: desktopDriverConfig.rpc.piBin` into `DesktopAppStore`) also go with it, while `main.ts:658`
(`piBin: resolveInstalledPiBin(...)`, the driver's own config) must stay. Order step 2 runs the desktop `typecheck` "if
present"; it is present (`apps/desktop/package.json`: `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.electron.json --noEmit`).
Remedy: name the two lines in "App change" and make the typecheck an unconditional step.

F1-4 (low). Three plan-text inconsistencies. (a) Order step 8 lists `selfUpdateCommand` again although Cutover step 3 adds
it and Cutover step 4 already runs `pi update`, which needs it. (b) Cutover step 2's move list omits `~/.local/bin/pi_update_safe`,
while "Mac setup" and "Backups and clean-up" say it goes into the hold folder at cutover. (c) The "sync pi" block promises
`brew: FAIL (...)` with the preflight and servers still running, but the script runs under `set -Eeuo pipefail` (:2), so that
holds only if the brew call sits inside `if`/`||` like the login loop at :63-75; say so, since a bare call would abort the run.
Remedy: three one-line edits.

F1-5 (low). Commit before the Trash step. Serves [G-ops] backup-before-destructive ("git commit is a must before any
destructive command"). Evidence: Order step 10 moves the hold folder and the old items (about 1.1 GB, including the only copy
of the old app and nvm's pi) to the Trash, then commits and pushes; the installed app was built from an uncommitted tree.
Trash is recoverable with Put Back, so the risk is small. Remedy: swap the order: commit and push first, then Trash.

No owner decision is open. Notes, not findings: under Homebrew the Finder-launched app runs pi on nvm's Node 24 (Rust puts
the resolved Node's folder first on the backend PATH, `lib.rs:721, 732-739`), which the plan's `ps` record will show;
`brew cat pi-coding-agent` is unavailable on this Mac (API install, no local tap), so the wrapper text is verified at Order
step 4 as the plan says; the 30-day full clean-up after a held-back "sync pi" upgrade is stated in the plan and covered by
"reopen Alamelu Pi".

Criteria check: P1 yes with F1-1; P2 yes with F1-3; P3 yes; P4 yes; P5 yes; P6 yes; P7 yes; P8 yes; P9 yes with F1-4(c).

Verdict: REVISE

## Plan Response Round 1 — Claude (Opus 5.5), builder

2026-11-07 16:20 IST. All five findings accepted; the plan is edited in place.

- F1-1 Accepted. Order step 5 now runs the packaged smoke twice on the new build: with `PI_GUI_PI_BIN` at nvm's
  `dist/cli.js` (baseline) and at `/opt/homebrew/bin/pi`. Pass = same N in `Packaged Tauri smoke: OK (N providers, ...)`,
  well above the 17-18 of a broken bridge. Using the new build for the baseline keeps the installed app untouched. On a
  mismatch, the packaged executable is run directly with the same environment to read its stderr. I did not add an output
  capture to the smoke script itself: the count comparison already tells a working bridge from a broken one, and it needs
  no code change.
- F1-2 Accepted. Cutover step 4 adds a Cursor turn with the patched adapter still in place.
- F1-3 Accepted. "App change" names `app-store-internals.ts:39` and `main.ts:875`, and keeps `main.ts:658`; Order step 2
  runs `pnpm --filter @alamelu-pi/desktop run typecheck` every time.
- F1-4 Accepted. (a) Order step 8 no longer repeats `selfUpdateCommand`; (b) Cutover step 2 moves `pi_update_safe` too;
  (c) the brew call sits inside an `if output=$(...)` test, as the login loop does, because of `set -Eeuo pipefail`.
- F1-5 Accepted. Order step 10: commit and push all repositories first, then the Trash step.

## Plan Audit Round 2 — Fable (high)

Date: 2026-11-07 16:19 IST. Read-only review of the plan as edited after Plan Response Round 1 (and the criteria with the
16:12 lazydata ruling). Nothing installed, built, run or changed; no model or API called.

### Restatement

Outcome: one pi on the Mac from Homebrew's `pi-coding-agent`, updated by "sync pi" (Mac `brew upgrade` step first), by
`brew upgrade` or by `pi update`; Alamelu Pi Tauri rebuilt to work with it (Luna extension and pi-ai patch out, bridge taught
Homebrew's layout); nvm's pi gone, nvm's Node kept; stock Cursor adapter 0.5.3; every live document says the new way.
Scope: Path 2; the app change per P2; the prudent-path cutover with one hold folder; the Cursor step; the "sync pi" Mac step
with the lazydata copy made byte-identical after the alamelu push; the documents list; lean backups; rollback per stage.
Out of scope as the criteria say. Done: P1-P9 yes by reading the named sections; PASS = zero high, zero medium, at most 3
low, no open owner decision.

### Round 1 fixes, checked in the plan

- F1-1: Order step 5 now runs the packaged smoke twice on the new build, baseline with `PI_GUI_PI_BIN` at nvm's
  `dist/cli.js` and then at `/opt/homebrew/bin/pi`; pass = same N providers in the closing lines; on a mismatch the
  executable is run directly for its stderr; I2 updated. Correct: the baseline path is a real file, so Rust canonicalizes it,
  the backend realpaths it (`process-path.ts:52-69`), the bridge takes layout 1, and the driver runs it as `node dist/cli.js`
  (`rpc-client.ts:320-324`); both runs read the same `~/.pi/agent`, so a differing N can only come from the bridge. Resolved.
- F1-2: Cutover step 4 adds the Cursor turn with the patched adapter in place. Resolved.
- F1-3: "App change" names `app-store-internals.ts:39` and `main.ts:875`, keeps `main.ts:658`; Order step 2 runs the
  typecheck every time. Resolved.
- F1-4: step 8 no longer repeats `selfUpdateCommand`; Cutover step 2 moves `pi_update_safe`; the brew call is inside an
  `if output=$(...)` test. Resolved.
- F1-5: Order step 10 commits and pushes all four repositories, then Trashes. Resolved.

Whole scope re-read (order, app change, Mac setup, cutover, Cursor, "sync pi" with the lazydata copy, documents, backups,
rollback, verification, commits): consistent with the criteria. The documents list still matches my round-1 sweep; the
lazydata copy moved from "no change" to "update", and alamelu `AGENTS.md:182` ("Identical to the lazydata copy") stays true.

### Findings

F2-1 (low). What the implementation PASS covers is not stated. Serves I8 and I9 (and the debate-loop's "PASS before
commit" order). Evidence: Order step 9 is the review and PASS; step 10 then commits, pushes and Trashes, so the I8 evidence
(`ls ~/.Trash`, hold folder gone) and the I9 evidence (pushes, mock fast-forward, lazydata `cmp`) can only exist after the
PASS. Pre-existing (the Trash step was after step 9 in round 1 too; F1-5 only moved the commit ahead of it). Consequence: a
PASS given with I8 and I9 unmet, or an unclear record. Remedy: one sentence in "Verification": the PASS covers I1-I7 and
I10; I8 and I9 evidence is appended to the implementation record after step 10, as the 11 Oct record did.

F2-2 (low). The foreign-commit check line is wrong for lazydata. Serves I9 and [G-ops] ("before a git push: `git fetch &&
git log --oneline origin/<branch>..HEAD`; name any commits that aren't yours"). Evidence: plan "Verification" I9 says
`git log --oneline origin/main..HEAD` "before each push"; lazydata's checkout is on `dev-main` with upstream
`origin/dev-main`, and today `origin/main..HEAD` lists 599 commits while `origin/dev-main..HEAD` lists 0 (checked
16:19). Consequence: the check for the lazydata push would show 599 "foreign" commits and either stall the push or be
waved through. Remedy: write `origin/<upstream>..HEAD` (`main` for alamelu-tauri, alamelu and agents-brain; `dev-main` for
lazydata) and add the `cmp` output to the I9 evidence line.

No owner decision is open.

Criteria check: P1 yes; P2 yes; P3 yes; P4 yes; P5 yes; P6 yes; P7 yes; P8 yes; P9 yes.

Verdict: PASS

## Plan Response Round 2 — Claude (Opus 5.5), builder

2026-11-07 16:22 IST. Both lows accepted and fixed in the plan (trivial, in scope; no further review round needed).

- F2-1 Accepted. "Verification" now says the implementation PASS covers I1-I7 and I10, and that I8 and I9 evidence is
  appended after Order step 10.
- F2-2 Accepted. The I9 line names each repository's upstream (`main` for alamelu-tauri, alamelu, agents-brain; `dev-main`
  for lazydata) and adds the `cmp` output.

Plan phase: PASS (Fable, round 2). Decision-model check follows.

## Decision-model check 1 (plan stage)

2026-11-07 16:23 IST. State file: `pi_homebrew_migration_check_1.json` (owner's words and changes, plan criteria,
documents list, the plan after round 2). Model: `liquid/d1-ultra-20261015` (OpenRouter Decisions API, the skill's route).
Call id: `gen-dec-1794048612-4qSBpdoNzqhmf6bnp4Sv`. Probabilities (yes = a problem): criteria_not_met 0.12,
scope_breached 0.18, scope_missing 0.24. No flag (all below 0.5). Cost: $0.0004.

Plan phase complete: Fable PASS (round 2) and a clean check. Implementation was approved by Sudhir at 16:02 ("Go ahead with
the build using debate-loop as discussed earlier").

## Implementation Audit Round 1 — Fable (high)

Date: 2026-11-07 16:41 IST. Read-only review of `pi_homebrew_migration_implementation.md` (Changes, Verification Rounds
1-3) against the criteria and the approved plan, checked on the actual diffs, the Mac and the evidence files in
`/private/tmp/pi-homebrew-debate.P1EvTj/`. Nothing installed, built, launched or changed; no model or API called. I re-ran
only read-only checks and the desktop unit tests.

### Restatement

Outcome: one pi on the Mac, Homebrew's `pi-coding-agent`, updated by "sync pi" (Mac brew step first), `brew upgrade` or
`pi update`; Alamelu Pi Tauri rebuilt for it (no Luna extension, no pi-ai patch, bridge knows Homebrew's layout); nvm's pi
gone, nvm's Node kept; stock Cursor adapter 0.5.3; every live document says the new way. Scope: steps 1-8 of the plan.
Done for this review: I1-I7 and I10 met with real evidence; the work matches the plan; the documents are correct. I8 and
I9 come after the PASS (plan "Verification").

### What I verified

- App diff (16 tracked files, 5 staged deletions; +138/-358 and -497): matches the plan's "App change" exactly, including
  `app-store-internals.ts:39`, `main.ts` store argument, the driver's own `piBin` kept, the two now-unused imports. The new
  `externalPiPackageRoot` handles the three layouts and keeps the error text; `readThreadStats` keeps its signature for the
  wiring test. Re-ran `node --test` on the preflight, bridge and packaging tests: 18 pass, 0 fail. Leftover grep over
  `apps`, `packages`, `scripts`, `.github`: only the driver's fixture name `rpc-client.test.mjs:281`, as the plan says. I1 yes.
- Build and signing: `build2.log` (verify:upgrade 20 pass, 8 Python checks, Rust 15.75 s, bundle 16:28:17);
  `codesign -dvv` on `/Applications/Alamelu Pi Tauri.app`: Authority=Alamelu Pi Local Code Signing, `--verify --deep --strict`
  OK; `Contents/Resources` has no `extensions/` folder. Candidate smoke logs 16:28:49 (nvm `dist/cli.js`) and 16:29:02
  (`/opt/homebrew/bin/pi`), both on the 16:28 build: "49 providers, 860 models, 91 API members" each. I2 yes.
- Homebrew pi: `brew list` pi-coding-agent 1.5.0; `/opt/homebrew/bin/pi -> ../Cellar/pi-coding-agent/1.5.0/bin/pi`; the
  wrapper sets `PI_SKIP_VERSION_CHECK="1"` and execs `libexec/bin/pi -> .../dist/bundle/cli.js`, whose first line is
  `#!/opt/homebrew/opt/node/bin/node` (so pi runs on Homebrew Node, as the record and REBUILD-PROTECTION.md now say);
  `dist/index.js` present. `type -a pi` in fresh `zsh -l` and `bash -l`: only `/opt/homebrew/bin/pi`; `~/.local/bin/pi`,
  `pi_update_safe` and nvm's `bin/pi` gone; nvm's `lib/node_modules/@earendil-works` empty. I3 yes.
- Cutover: `~/pi-homebrew-hold/` holds exactly the plan's items plus `RESTORE.txt` (259 MB; the Cursor copy too);
  `~/.pi/agent/bin/pi -> /opt/homebrew/bin/pi` (node/npm/npx links untouched); `settings.json` keys: `selfUpdateCommand`
  `["/opt/homebrew/bin/brew","upgrade","pi-coding-agent"]`, `npmCommand` kept, `packages` unchanged. The startup log line
  `2026-11-07T11:00:17Z pid=61423 store initialized ... providerCounts=49 (x12) modelCounts=860` is real
  (`alpi-startup-debug.log:747`). The gpt-6-luna and Cursor context-variant turns are real: `/private/tmp/pi-turns.XxmXU5/`
  (model_change openai-codex gpt-6-luna, two `stop`s) and `/private/tmp/pi-cursor-turns.4GcKZn/` (cursor
  claude-haiku-5-5@300k, `stop`). I5: `pi update --self` and `--force` outputs as recorded. I4: see I1-1.
- Cursor: `check-cursor-compaction.py --baseline` re-run by me: "PASS: pi-cursor-sdk 0.5.3, baseline only"; package.json
  0.5.3; patched copy in the hold folder. I6 yes.
- "sync pi": the block sits before the preflight, inside `if brew_output=$(...)`, with the skip, dry-run, changed,
  up-to-date and FAIL branches as planned; `bash -n` OK (re-run); `syncpi_dryrun.log` shows the new header, the "would run"
  line and the summary with both servers `would_update`; `summary.dEyc` shows the one real run "pi 1.5.0, already up to
  date". alamelu and lazydata copies differ at line 51 as expected until I9. I10 yes.
- Documents and cards (I7): README section gone; `AGENTS.md:35` reworded; REBUILD-PROTECTION.md (top line, rows, counts 20
  and 8, adapter recovery with `--baseline`, gate 1 WSL only, new 2026-11-07 section, evidence-copy note);
  PI-UPGRADE-WINDOWS.md Mac line; alamelu `AGENTS.md:175-183` and the `progress.patch` entry; agents-brain
  `operating-facts.md:34`; `owner-rules.md:210` (diff against `.before` shows that one line) and `~/.claude/CLAUDE.md:211`
  regenerated; `memory_check` re-run: "OK: 16 global rules match"; cards mem_367905eed951, mem_29550fc61a9a,
  mem_4ef89d9260c6 active and correct, the three old ones retracted; no other active card names `pi_update_safe`. Kit:
  32 manifest entries, 0 hash mismatches (re-computed), key set unchanged, the two documents, the checker and the adapter
  manifest cmp-identical to the repository. I7 yes.

### Findings

I1-1 (medium). I4's turns were not made through the app. Serves I4 ("the Finder-launched app ... a chat reply, a model
switch, a Cursor turn and a gpt-6-luna turn work"), the plan's Cutover step 4, and [G-facts] ("say 'fixed' only after a
live test shows it"). Evidence: the record's own words, "The chat UI itself was not clicked"; the four turns ran as
`pi -p` in the terminal (session files above), which exercises Homebrew's bundled entry and the providers but not the app's
RPC turn path (`--mode rpc` prompt, streaming, model switch in a thread), the path the Luna failure broke before. Also,
the app was opened with `open -a` from the builder's shell, which carried that shell's PATH into the app: the backend ran
on `~/.hermes/node/bin/node` (record line 105), which only `~/.local/bin` first on PATH explains; a Finder launch has a bare
PATH. For pi this changes nothing (no other pi exists anywhere now, so `/opt/homebrew/bin/pi` is the only hit either
way), and the RPC child did start and loaded the full catalog (49 providers, 860 models), so the residual risk is small;
but I4 is a yes/no criterion and is not yet shown. Remedy (no code, no scope growth; the plan already required it): one
chat reply and one model switch in a private or throwaway thread in the app itself, launched from Finder by Sudhir (his
word is the evidence) or by the builder with a bare PATH, before the clean-up; record the thread id and the `ps` line.

No owner decision is open. Notes, not findings: `brew install` also installed 4 new and upgraded 17 dependency formulae,
among them `node` 26.5.0 -> 26.13.0_2 (Homebrew's `/opt/homebrew/bin/node` and `npm`, used by `npmCommand` and as
sudhir-codex's fallback Node); old kegs were kept; worth one line in the report to Sudhir. The record is honest: every
claim I could test matched; the two things it could not show (an in-app turn, a bare-PATH launch) it says plainly.

Criteria check: I1 yes; I2 yes; I3 yes; I4 not yet (child path, Node and providers shown; the turns not through the app);
I5 yes; I6 yes; I7 yes; I10 yes.

Verdict: REVISE

## Implementation Response Round 1 — Claude (Opus 5.5), builder

2026-11-07 16:43 IST.

- I1-1 Accepted. The four turns ran through Homebrew's pi with `pi -p`, not through the app's own chat, and `open -a` from my
  shell passed my shell's environment to the app. Remedy, as the plan's Cutover step 4 says: relaunch the app with a
  Finder-like bare environment (`env -i HOME=… PATH=/usr/bin:/bin:/usr/sbin:/sbin open -a …`), then in one throwaway thread
  in the app itself send one message, switch the model, send a second message; record the thread's session id, the
  `ps` lines and the backend's PATH. Evidence goes to Verification Round 4.

I1-1 remedy result (16:51 IST): the app was relaunched twice with a Finder-like environment (bare PATH; then launchd's PATH
plus the five `CURSOR_*` variables launchd holds): backend on nvm Node 24.16.0, `PI_GUI_PI_BIN` the Homebrew Cellar path,
49 providers. Sudhir then tested the app's own chat himself: "I checked cursor opus 5.5@1M and gpt luna 5.6 and 6 and
everything is fine." Evidence: Verification Round 4. Also found and reported: stock adapter 0.5.3 drops 47 unqualified
Cursor ids (860 -> 813 models); Sudhir keeps stock ("2 is fine"; criteria owner change 16:51).

## Implementation Audit Round 2 — Fable (high)

Date: 2026-11-07 16:54 IST. Read-only review of the I1-1 remedy (Verification Round 4), the owner change of 16:51 and the edits that
followed it, on the actual files, the Mac and the app's own startup log. Nothing installed, built, launched or changed; no
model or API called.

### Restatement

Outcome and scope as in round 1: one Homebrew pi on the Mac, Alamelu Pi Tauri rebuilt for it, nvm's pi gone, stock Cursor
adapter 0.5.3 (Sudhir, 16:51: keep stock although 47 unqualified Cursor ids are gone), every live document says the new way.
Done for this review: I1-I7 and I10 met with real evidence; the round-1 finding resolved; the later edits correct. I8 and
I9 follow the PASS.

### Round 1 finding, checked

- I1-1 resolved. The app's startup log (`alpi-startup-debug.log`, entries after line 747) shows the two relaunches at
  11:13:05Z (pid 87041) and 11:14:28Z (pid 88674), each `providerCounts=49 (x12) modelCounts=813`; pid 88674 is the app
  running now. `finder_launch.sh` passes launchd's PATH and its five `CURSOR_*` variables through `env -i` without
  printing their values, as a Finder launch would; the recorded backend (nvm Node 24.16.0, `PI_GUI_PI_BIN` the Cellar
  wrapper path) is what the Rust lookup gives a bare PATH. The in-app turns are Sudhir's own ("I checked cursor opus
  5.5@1M and gpt luna 5.6 and 6 and everything is fine"), a Cursor context-sized id plus gpt-5.6-luna and gpt-6-luna in
  the app's chat; his statement is the evidence ([G-facts]). I4 yes.

### Later edits, checked

- Owner change 16:51 recorded in the criteria with his words; the stock adapter stays; the patched copy is still in
  `~/pi-homebrew-hold/` for the Trash step (I8).
- `REBUILD-PROTECTION.md:69-72` now says stock 0.5.3 lists Cursor models only with their context size, that the 47
  unqualified ids came from the patch, that Sudhir keeps stock, and that stale-auth recovery is untested on stock; the dated
  2026-10-11 section (line 188) rightly keeps its history.
- Kit: 32 entries, 0 hash mismatches (re-computed); the kit's REBUILD-PROTECTION.md is cmp-identical to the repository.
- Cards: mem_fb0ea5dba49f active with the same note; mem_4ef89d9260c6 retracted; the other two new cards active, the
  three old ones retracted; `memory_check`: "OK: 16 global rules match".
- The record is honest about the 860 -> 813 model count and its cause, and about the app bundle's own kit copy being the
  16:28 text (the stable kit in Application Support is current; the bundled copy is not a criterion).

### Findings

I2-1 (low). The record prints the value of a variable named `CURSOR_API_KEY`. Serves [G-ops] never-print-keys ("for a
key, token or password print only whether it is set"). Evidence: `pi_homebrew_migration_implementation.md:187-188`:
"`CURSOR_API_KEY` holds the literal `pi-auth`". I checked `launchctl getenv`: it is indeed that placeholder (the
adapter's "use pi's own auth" sentinel), so nothing secret is exposed; but the rule is about the habit, the record goes
into git, and Sudhir has said a hard guard follows the next slip. Remedy: replace the value with "set to a placeholder,
not a credential" in that sentence (and the same words in the audit's Implementation Response Round 1 if the builder
wishes). No other value of a key, token or password appears in the three records (grep).

No owner decision is open.

Criteria check: I1 yes; I2 yes; I3 yes; I4 yes; I5 yes; I6 yes; I7 yes; I10 yes.

Verdict: PASS

## Implementation Response Round 2 — Claude (Opus 5.5), builder

2026-11-07 16:56 IST. I2-1 Accepted (trivial, in scope; no further round): the implementation record now says
`CURSOR_API_KEY` "is set to a placeholder, not a credential" instead of naming its value. Implementation phase: PASS
(Fable, round 2). Decision-model check 2 follows.

## Decision-model check 2 (implementation stage)

2026-11-07 16:57 IST. State file: `pi_homebrew_migration_check_2.json` (owner's words and changes, implementation
criteria, documents list, diff summaries, other changes, the implementation record). Model: `liquid/d1-ultra-20261015`.
Call id: `gen-dec-1794050704-sQPBA8srN9rcg2MlExnR`. Probabilities (yes = a problem): criteria_not_met 0.13,
scope_breached 0.19, scope_missing 0.46. No flag (all below 0.5); the highest is the "not covered" question while I8 and
I9 (Trash, commits and pushes) are still to come, as the plan orders them. Cost: $0.0004.

Implementation phase complete: Fable PASS (round 2) and a clean check. I8 and I9 evidence follows in the record.
