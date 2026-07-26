## Plan Audit Round 1

**Reviewer:** codex (gpt-5.6-sol)

### Findings

- [severity: HIGH] The README work contradicts the binding ruling that Matthew Lam's name remains only in the licence. The plan explicitly asks for a README attribution naming him (`documents/plan-audit-implementation/alpi_fork_hygiene_plan.md:34`), does not explicitly remove the current package author (`apps/desktop/package.json:5`), and leaves an upstream-author URL in the tracked video source (`video/src/scenes/ClosingCard.tsx:29`). Revise the plan to remove/rebrand those non-licence surfaces while preserving `LICENSE:3` verbatim and adding Sudhir Jha's derivative-work copyright line. No icon or iconset change is needed.

- [severity: MEDIUM] Deleting `apps/website` has two consumers that the plan misses. The native clipboard helper loads `apps/website/public/og.png` through a path assembled at `apps/desktop/tests/helpers/electron-app.ts:22` and uses it at `apps/desktop/tests/helpers/electron-app.ts:769`; deleting the site would break `apps/desktop/tests/native/paste.spec.ts:26`. Also, `scripts/verify-install-copy.mjs:10` reads two website files and its assertions at `scripts/verify-install-copy.mjs:16` require the release/Homebrew copy that this plan removes. Before the directory deletion in `documents/plan-audit-implementation/alpi_fork_hygiene_plan.md:21`, generate the native clipboard image from the helper's existing tiny-PNG fixture (or move a test-only fixture without touching icons) and delete the now-orphaned install-copy verifier. The `apps/*` workspace glob at `pnpm-workspace.yaml:2` is correct, so no workspace-file edit is needed; `pnpm install` should remove the `apps/website` lockfile importer at `pnpm-lock.yaml:159`.

- [severity: MEDIUM] The `@alamelu-pi/*` rename is broader than the named edit list in section D. There are 67 tracked files with that namespace in the current tree. In addition to manifests, imports, tests, docs, and `apps/desktop/tsconfig.paths.json:5`, executable non-manifest consumers include `apps/desktop/scripts/dev.mjs:12` and `scripts/run-rpc-gui-lab.sh:121`; the lockfile entries at `pnpm-lock.yaml:13`, `pnpm-lock.yaml:180`, and `pnpm-lock.yaml:193` must be regenerated. `apps/desktop/tests/AGENTS.md:11` also names the old filter. Conversely, `tsconfig.base.json:1` has no path mappings, despite the claim at `documents/plan-audit-implementation/alpi_fork_hygiene_plan.md:40`. The electron-builder files have no `@alamelu-pi/*` package reference; their `pi-gui` names are a separate packaging-brand migration.

- [severity: MEDIUM] `apps/desktop/electron-builder.yml` cannot be deleted while retaining the current `package:dir` and packaged production lanes. The unqualified electron-builder commands at `apps/desktop/package.json:19`, `apps/desktop/package.json:20`, `apps/desktop/package.json:21`, and `apps/desktop/package.json:24` through `apps/desktop/package.json:28`, plus the direct invocation at `apps/desktop/package.json:73`, implicitly load it. The dependent packaged lanes are at `apps/desktop/package.json:70` through `apps/desktop/package.json:76`. Without that config they lose, among other settings, the `release` output directory (`apps/desktop/electron-builder.yml:6`), notification helper (`apps/desktop/electron-builder.yml:40`), and package identity; the test helper still defaults to `release` at `apps/desktop/tests/helpers/electron-app.ts:21`. `resolvePackagedAppBundle` prefers `pi-gui.app` but does fall back to the first `.app` (`apps/desktop/tests/helpers/electron-app.ts:397`), so the exact bundle name is not by itself a hard failure. `package:alpi:dir` is independent because `apps/desktop/scripts/package-alpi-dir.mjs:31` explicitly selects `electron-builder.alpi.yml`. Revise the unresolved choice at `documents/plan-audit-implementation/alpi_fork_hygiene_plan.md:42`: preserve local packaged-app tests by explicitly retargeting the relevant dir lanes/helper to the existing Alamelu config, or obtain owner approval to remove each dependent lane. A “rebrand” option must not retain the forbidden GitHub publisher, notarisation, DMG/ZIP release, or Linux release configuration at `apps/desktop/electron-builder.yml:33`, `apps/desktop/electron-builder.yml:34`, `apps/desktop/electron-builder.yml:44`, and `apps/desktop/electron-builder.yml:65`.

- [severity: MEDIUM] The sibling-repo inventory count is stale. The claim at `documents/plan-audit-implementation/alpi_fork_hygiene_plan.md:53` says 70 files (38 modified, 32 untracked), but `git status --porcelain=v1 -uall` in `/Users/sudhirjha/playground/pi-gui-rpc-lab` currently reports 101 files: 38 modified and 63 untracked. The “enumerate every file” rule is sound, but the plan must update the expected reconciliation total so 31 untracked files cannot be silently missed. The two tracked workflow files do exist there, while this repository currently has no tracked `.github/workflows/*`.

- [severity: LOW] `update-checker.ts` has no consumer beyond `electron/main.ts`, but section A inaccurately names an IPC handler. The only import is `apps/desktop/electron/main.ts:27`; all remaining wiring is also in that file: lifecycle state at line 67, manual dialogs at line 582, the menu item at line 630, startup at line 948, and cleanup at lines 1267 and 1284. There is no matching preload, renderer, or IPC channel. Removing the feature should also remove the now-unused `MessageBoxOptions` import at `apps/desktop/electron/main.ts:11`.

- [severity: LOW] Pi's RPC support is real and the proposed driver delegation is implementable, but the plan describes the setting as a “per-session default” at `documents/plan-audit-implementation/alpi_fork_hygiene_plan.md:66`. Installed Pi 0.80.10 declares `{type:"set_auto_compaction", enabled}` at `/Users/sudhirjha/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-types.d.ts:72`, handles it at `dist/modes/rpc/rpc-mode.js:415`, and reports `autoCompactionEnabled` in `get_state` at `dist/modes/rpc/rpc-mode.js:354`. However, `AgentSession.setAutoCompactionEnabled` delegates to a global persisted setting (`dist/core/agent-session.js:1737`; `dist/core/settings-manager.js:512`), whose default is already `true` (`dist/core/settings-manager.js:509`). The current app does not disable it. Keep the requested default-on toggle, but describe it as explicit control of Pi's global native setting, add the method to the driver contract at `packages/session-driver/src/types.ts:314`, and specify whether toggling updates currently open idle sessions or only applies on subsequent create/open. The existing serialized mutation path is `packages/pi-rpc-driver/src/pi-rpc-driver.ts:431`.

- [severity: LOW] The zero-hit grep gates are self-matching. The update pattern is written into `documents/plan-audit-implementation/alpi_fork_hygiene_plan.md:19`, and the old package namespace occurs in the plan at lines 40 and 45 and now necessarily in this audit. Use `git grep` (or explicit exclusions for `documents/plan-audit-implementation`, generated output, and `LICENSE`) so the gates measure surviving product/config consumers rather than their own audit instructions.

### Confirmed claims

- `patches/@mariozechner__pi-ai@0.60.0.patch` is functionally orphaned: no manifest, `pnpm-workspace.yaml`, lockfile setting, `.npmrc`, source, or script declares `patchedDependencies` or references that patch. The current `mariozechner` website link disappears earlier in build order B.
- The installed extension scripts are exactly `00-path-fix.ts`, `global-mandate.ts`, and `repomem.ts`; none implements auto-compaction.
- The current test-count claims are accurate: `node --test apps/desktop/tests/unit/*.test.mjs` passed 69/69, and `pnpm --filter @alamelu-pi/pi-rpc-driver test` passed 58/58. The manual compact command still uses the 120-second timeout at `packages/pi-rpc-driver/src/pi-rpc-driver.ts:29` and `packages/pi-rpc-driver/src/pi-rpc-driver.ts:287`.
- The baseline and remote claims are accurate: `HEAD` is the Phase 5 D commit `fbc81c4` on top of `f43e123`, and `origin` is `upaayan/alamelu-pi-gui`.

**Verdict: REVISE.** There is 1 HIGH, 4 MEDIUM, and 3 LOW findings, so the PASS threshold is not met.

---

## Response to Plan Audit Round 1

**Builder:** Claude (Opus 5) · Plan revised in place to rev 2. Every finding independently re-verified against the tree before acceptance.

1. **[HIGH — README attribution contradicts the name-stripping ruling] Accepted, resolved without trading off either ruling.** Verified `apps/desktop/package.json:5` really is `"author": "Matthew Lam"` (plus an upstream `description`), and `video/src/scenes/ClosingCard.tsx:29` really renders `github.com/minghinmatthewlam/pi-app`. Resolution: the README credits the **project** — "derived from the pi-gui project (MIT); see LICENSE for the original copyright holder" — so the author's work is respected (owner: "have to respect the license and the work of the author") while his *name* stays confined to `LICENSE` as instructed. New section C2 rebrands the package author/description and **deletes `video/`** (verified standalone: no workspace, script or manifest reference).

2. **[MEDIUM — hidden `apps/website` consumers] Accepted.** Verified `tests/helpers/electron-app.ts:22` resolves `apps/website/public/og.png`. Plan now replaces it with a fixture generated from the helper's existing `TINY_PNG_BASE64` (no icon asset touched) and deletes the orphaned `scripts/verify-install-copy.mjs`, both **before** the directory is removed.

3. **[MEDIUM — rename blast radius understated] Accepted, including the correction against me.** Verified `tsconfig.base.json` contains **zero** `paths` entries — rev 1's claim was wrong and is retracted in place. Added the missed executable consumers (`apps/desktop/scripts/dev.mjs:12`, `scripts/run-rpc-gui-lab.sh:121`, `tests/AGENTS.md:11`) and the 67-file reconciliation target.

4. **[MEDIUM — builder-config deletion unsafe as written] Accepted; decision now made and recorded.** The owner delegated this to builder+critic with the binding constraint "it should not break anything". Decision: **delete `electron-builder.yml` and retarget its consumers to the alpi config** — `package:dir` and `test:prod:notification-onboarding` gain `-c electron-builder.alpi.yml`; the test helper's default release dir becomes `release-alpi`; the `package`, `package:linux*` and `bun:package*` entries are **deleted** as dead lanes (release artefacts and Linux targets that rulings 5 and macOS-only make moot). Your point that `resolvePackagedAppBundle:397` already falls back to the first `.app` is noted and relied upon. Gate: `package:dir` succeeds and `test:prod:packaged-smoke` passes afterwards, proving nothing broke.

5. **[MEDIUM — stale sibling-repo count] Accepted.** Verified: `git status --porcelain=v1 -uall` reports **101** (38 modified, 63 untracked). Rev 1's "70" came from a flag that collapses untracked directories — exactly the silent-miss risk you describe. The harvest table must now reconcile to 101.

6. **[LOW — update-checker wiring described inaccurately] Accepted.** No preload/renderer/IPC exists; the plan now names the six `main.ts` sites and the orphaned `MessageBoxOptions` import.

7. **[LOW — auto-compaction is a global, already-default-on setting] Accepted, and this is the most useful correction in the round.** Verified `getCompactionEnabled()` returns `this.settings.compaction?.enabled ?? true` (`settings-manager.js:509`) and `setCompactionEnabled` writes `globalSettings` (`:512`). So it is **already on** for the owner and it is **global — a toggle changes the `pi` CLI too**. The plan now states this, requires the toggle caption to say it plainly, reads initial state from `get_state`, and adds the method to the driver contract at the cited line. The owner is being told separately, since it changes what the feature is worth.

8. **[LOW — grep gates match their own text] Accepted.** Gates switch to `git grep` with `:!documents/plan-audit-implementation` and `:!LICENSE` exclusions.

Score: 8/8 accepted, one of which corrected a factual error of mine (`tsconfig.base.json`). Rev 2 ready for Round 2.

---

## Plan Audit Round 2

**Reviewer:** codex (gpt-5.6-sol)

### Findings

- [severity: MEDIUM] Section C2 still treats `video/` as standalone, but the tree has two consumers that the deletion must remove. `video` is an explicit workspace entry at `pnpm-workspace.yaml:4` with a lockfile importer at `pnpm-lock.yaml:210`, and `apps/desktop/scripts/capture-showcase.mts:22` writes its captures into that tree (and recreates the directory at `apps/desktop/scripts/capture-showcase.mts:327`). The claim at `documents/plan-audit-implementation/alpi_fork_hygiene_plan.md:42` that no workspace or script references it is therefore false. Remove the workspace entry and the now-orphaned showcase capture script as part of the marketing-video deletion, then let `pnpm install` remove the importer.

- [severity: MEDIUM] The `electron-builder.yml` decision still leaves broken packaged commands and an old-output verifier, so it does not yet satisfy the delegated constraint that nothing break. The plan deletes `package`, but `test:prod:applications-relaunch` and `test:prod:release-zip-smoke` still invoke it at `apps/desktop/package.json:75` and `apps/desktop/package.json:76`; the CI variant at line 77 and the ZIP helpers/specs rooted at `apps/desktop/tests/helpers/electron-app.ts:424` also expect an artefact that the dir-only Alpi config does not produce (`apps/desktop/electron-builder.alpi.yml:40`). Separately, the retained `verify:packaged-runtime-deps` command at `apps/desktop/package.json:31` still defaults to the removed `release/pi-gui.app` layout at `apps/desktop/scripts/assert-packaged-runtime-deps.mjs:40` and `apps/desktop/scripts/assert-packaged-runtime-deps.mjs:83`; the Linux verifier at `apps/desktop/package.json:32` is stranded when the Linux package scripts are deleted. The two gates named at `documents/plan-audit-implementation/alpi_fork_hygiene_plan.md:56` do not exercise these paths. Revise section D to retarget or remove every dependent script/spec/helper and its documentation, make the retained runtime-dependency verifier default to Alpi, and remove the then-orphaned `apps/desktop/scripts/bun-package-wrapper.mjs`.

- [severity: MEDIUM] Pi's RPC capability is real, but section G still does not define a coherent path from `get_state` to the Settings toggle. Today `PiRpcDriver` consumes `get_state` during create/open but maps only session ID, name, model, and thinking level (`packages/pi-rpc-driver/src/pi-rpc-driver.ts:83`, `packages/pi-rpc-driver/src/pi-rpc-driver.ts:871`); `RuntimeSettingsSnapshot` has no auto-compaction field (`packages/session-driver/src/runtime-types.ts:93`), and Settings General receives only that runtime snapshot plus callbacks (`apps/desktop/src/settings-general-section.tsx:6`). No renderer API, preload bridge, main-process IPC handler, AppStore mutation, or state field is named in `documents/plan-audit-implementation/alpi_fork_hygiene_plan.md:79` through `documents/plan-audit-implementation/alpi_fork_hygiene_plan.md:84`. Also, the cited “idle queue” serializes operations but rejects a configuration mutation while a run is active rather than waiting (`packages/pi-rpc-driver/src/pi-rpc-driver.ts:431`, `packages/pi-rpc-driver/src/pi-rpc-driver.ts:446`). Specify the state shape and full renderer-to-driver bridge, behavior when no session is open or the selected session is running, and how already-open RPC sessions are synchronized without inventing a second app-owned preference that can overwrite Pi's global source of truth.

- [severity: LOW] The accepted update-checker correction is internally inconsistent: section A still says to remove an “IPC handler” at `documents/plan-audit-implementation/alpi_fork_hygiene_plan.md:17`, immediately before correctly stating that no IPC channel exists at line 18. The tree confirms only the import and main-process wiring in `apps/desktop/electron/main.ts:27`, `apps/desktop/electron/main.ts:584`, `apps/desktop/electron/main.ts:632`, and `apps/desktop/electron/main.ts:948`. Remove the stale phrase.

- [severity: LOW] The concrete zero-hit commands were not fully converted to the phase-aware `git grep` gates promised at `documents/plan-audit-implementation/alpi_fork_hygiene_plan.md:92`: sections A, B, and D still spell plain recursive `grep` at lines 19, 26, and 59. More importantly, A's username gate cannot be zero after commit A because later phases intentionally retain hits in `README.md:18`, `apps/desktop/electron-builder.yml:67`, and `video/src/scenes/ClosingCard.tsx:29`; and C2's “audited grep gate” at plan line 43 never searches for the literal author name. Make A's gate update-specific, reserve the author/username zero-hit check for the final hygiene gate, and include both `Matthew Lam` and `minghinmatthewlam` while excluding `LICENSE` and the plan/audit documents.

### Confirmed claims

- `apps/desktop/electron/update-checker.ts` has no consumer outside `apps/desktop/electron/main.ts`; there is no preload, renderer, or IPC update surface.
- Deleting `apps/website` needs no `pnpm-workspace.yaml` edit because of the `apps/*` glob at `pnpm-workspace.yaml:2`. The revised plan now handles both non-lockfile consumers before deletion.
- The current baseline has exactly 67 tracked files containing `@alamelu-pi/`; `apps/desktop/tsconfig.paths.json:5` is the only scoped path-map source, and `tsconfig.base.json` has none. The revised target list includes the previously missed executable and test-guidance consumers.
- `patches/@mariozechner__pi-ai@0.60.0.patch` remains functionally orphaned: no manifest, workspace configuration, lockfile setting, source, or script declares a patched dependency or consumes it.
- `/Users/sudhirjha/playground/pi-gui-rpc-lab` currently has 101 uncommitted paths (38 modified, 63 untracked), and its two tracked workflows are the only tracked workflow files across the two repositories.
- Installed Pi 0.80.10 declares `set_auto_compaction` at `/Users/sudhirjha/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-types.d.ts:72`, handles it at `dist/modes/rpc/rpc-mode.js:415`, reports it in `get_state` at `dist/modes/rpc/rpc-mode.js:354`, and persists it as a global setting whose fallback is `true` at `dist/core/settings-manager.js:509`.
- The claimed existing suites remain green: desktop unit tests passed 69/69 and the Pi RPC driver suite passed 58/58.

**Verdict: REVISE.** There are 0 HIGH, 3 MEDIUM, and 2 LOW findings, so the PASS threshold is not met.

---

## Response to Plan Audit Round 2

**Builder:** Claude (Opus 5) · Plan revised in place to rev 3. All 5 findings accepted; each re-verified first.

1. **[MEDIUM — `video/` is not standalone] Accepted, and this was a false claim of mine, not an omission.** Verified: `pnpm-workspace.yaml:4` lists `video` as an explicit member, and `capture-showcase.mts:22`/`:327` writes into it. Rev 2 said "verified standalone" because the check grepped `video/` **with a trailing slash** and so missed the bare workspace entry — a bad check reported as a verification. Corrected in place, with the cause recorded. Deletion now also removes the workspace entry, the orphaned `capture-showcase.mts` and its script entry. The owner was told of the error directly.

2. **[MEDIUM — builder-config decision still leaves dangling consumers] Accepted.** Deleting `package` orphaned `test:prod:applications-relaunch` (`:75`), `test:prod:release-zip-smoke` (`:76`) and its CI variant (`:77`), plus the ZIP helper path (`tests/helpers/electron-app.ts:424`) and specs, while `verify:packaged-runtime-deps` still pointed at `release/pi-gui.app` and the Linux verifier and `bun-package-wrapper.mjs` were stranded. Rev 3 deletes the release-distribution lanes (dead by rulings 2 and 5), **retargets** the runtime-deps verifier to `release-alpi/mac-arm64/alpi.app`, deletes the Linux verifier and bun wrapper, and adds a reconciliation rule that every surviving script must resolve to something that exists. This is what the owner's "it should not break anything" actually requires.

3. **[MEDIUM — auto-compaction bridge undefined] Accepted, and the design changed because of it.** Your two observations — the idle queue *rejects* rather than waits during a run, and there is no path from `get_state` to Settings — killed the per-session RPC approach. Rev 3 instead reuses the mechanism pi's other global settings already use: `setDefaultThinkingLevel` → `updateSettings()` → `buildSnapshot()`. So the supervisor writes the same settings file pi reads, it works with no session open, and pi's file stays the single source of truth rather than the app inventing a competing preference. `RuntimeSettingsSnapshot` gains `autoCompactionEnabled`, the renderer path mirrors the existing thinking-level control end to end, and open idle sessions get a best-effort `set_auto_compaction` so a live thread does not lag.

4. **[LOW — stale "IPC handler" phrase] Accepted.** Removed; section A now describes only the `main.ts` wiring.

5. **[LOW — grep gates not phase-aware and never checked the author name] Accepted.** Per-phase gates are now specific to their phase (and A no longer asserts a username zero-hit it cannot satisfy). A single **final hygiene gate** runs `git grep -nE "Matthew Lam|minghinmatthewlam" -- ':!LICENSE' ':!documents/plan-audit-implementation'` and must return zero.

Also noted in rev 3: `docs/readme/{demo.gif,demo.mp4,demo-poster.png}` are the rendered output of the same marketing pipeline and `README.md:7` embeds one. Recommended for deletion but **awaiting the owner's word** — not actioned.

Score: 5/5 accepted, one of which corrected a false verification claim of mine. Rev 3 ready for Round 3.

---

## Plan Audit Round 3

**Reviewer:** codex (gpt-5.6-sol)

### Findings

- [severity: MEDIUM] The release-ZIP cleanup still understates the helper's blast radius and would leave broken production specs. Section D says to delete the ZIP helper and “the two specs” (`documents/plan-audit-implementation/alpi_fork_hygiene_plan.md:56`), but `extractPackagedReleaseZipAppBundle` has four spec consumers: `apps/desktop/tests/production/applications-relaunch.spec.ts:7`, `apps/desktop/tests/production/release-zip-smoke.spec.ts:3`, `apps/desktop/tests/production/finder-env-open-folder.spec.ts:6`, and `apps/desktop/tests/production/release-zip-reopen-new-thread.spec.ts:5`. The latter two have no deletion or retargeting instruction, so removing the export at `apps/desktop/tests/helpers/electron-app.ts:438` leaves dangling imports discoverable by the surviving general runner under `apps/desktop/playwright.config.ts:4`. The accepted documentation cleanup is also still absent: `apps/desktop/README.md:39` and `apps/desktop/README.md:93` retain the deleted Linux commands, lines 76-77 and 138-139 retain the deleted release scripts, lines 170-171 describe deleted specs, and `apps/desktop/electron/main.ts:366` still names the deleted config. Revise the plan to decide all four spec consumers and clean the surviving docs/comment; checking only surviving package-script targets at plan line 59 cannot catch these broken imports.

- [severity: MEDIUM] The persisted, no-session auto-compaction path is now coherent, but the live-session synchronization is not. The claim that a running session can be skipped because “its next child picks the setting up” (`documents/plan-audit-implementation/alpi_fork_hygiene_plan.md:91`) is false for Sol and Terra: only Luna is marked for child rotation after a run (`packages/pi-rpc-driver/src/pi-rpc-driver.ts:560`), the rotation path is Luna-only (`packages/pi-rpc-driver/src/pi-rpc-driver.ts:457`), and the explicit regression test proves Sol/Terra reuse one child across prompts (`packages/pi-rpc-driver/test/rpc-client.test.mjs:1007`, `packages/pi-rpc-driver/test/rpc-client.test.mjs:1045`). Pi reads the setting from that child's in-memory `SettingsManager` (`/Users/sudhirjha/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:1741`); an external file edit is observed only after an explicit reload (`dist/core/settings-manager.js:273`). Therefore a toggle made during a Sol/Terra run can remain stale for later prompts indefinitely. Specify a pending post-run/pre-next-prompt RPC sync (or another safe equivalent), including the contract/owner that reaches `RpcDesktopDriver`'s private session map (`apps/desktop/electron/rpc-desktop-driver.ts:40`) from the AppStore/runtime mutation. Also account for the setting's global UI state: the existing thinking-level helper updates only one cached workspace snapshot (`apps/desktop/electron/app-store.ts:742`, `apps/desktop/electron/app-store.ts:756`), so copying it literally can show a stale toggle in another already-loaded workspace. The verification at plan line 94 must exercise the primary settings-file/snapshot/UI bridge and a toggle during an active reused-child run, not only the idle driver command.

- [severity: LOW] The phase-A zero-hit gate still cannot pass at the point where it is scheduled. After deleting the desktop updater, `apps/website/app/page.tsx:10` continues to match `releases/latest` until phase B, while the other two patterns at `documents/plan-audit-implementation/alpi_fork_hygiene_plan.md:19` miss the actual singular/capitalized symbols `checkForUpdate`, `initUpdateChecker`, and `stopUpdateChecker` at `apps/desktop/electron/main.ts:27` and `apps/desktop/electron/main.ts:67`. Scope the gate to `apps/desktop` and search the actual updater filename/symbols (including the API URL), or defer the cross-tree URL check.

- [severity: LOW] Three cleanup bullets still claim package-script entries that do not exist in the tree: `verify-install-copy` at plan line 23, `capture-showcase` at line 42, and the Homebrew scripts at line 62. The complete root script block is `package.json:11`, the desktop script block is `apps/desktop/package.json:9`, and the only video scripts are preview/render/build at `video/package.json:5`. The file deletions remain valid; remove the nonexistent-entry instructions so the implementation inventory and “each deleted entry” reconciliation are factual.

### Confirmed claims

- `apps/desktop/electron/update-checker.ts` still has no consumer outside `apps/desktop/electron/main.ts`; the corrected six-site main-process description is accurate.
- `apps/*` at `pnpm-workspace.yaml:2` means deleting `apps/website` needs no workspace edit, and rev 3 handles both hidden consumers first. Conversely, the explicit `video` member at `pnpm-workspace.yaml:4` and `capture-showcase.mts` consumer are now correctly included.
- The current baseline still has exactly 67 tracked files containing `@alamelu-pi/`; the expanded namespace target set, `tsconfig.paths.json` correction, bundle resolver fallback, Alpi output path, and retained packaged-dir direction are accurate subject to the release-spec finding above.
- `patches/@mariozechner__pi-ai@0.60.0.patch` is functionally orphaned. The only other current `mariozechner` hit is the unrelated website link removed earlier in phase B.
- The sibling repository still has 101 uncommitted paths (38 modified, 63 untracked).
- Installed Pi 0.80.10 exposes and handles `set_auto_compaction`, reports `autoCompactionEnabled`, persists it globally, and defaults it to `true`. The 120-second explicit-compaction timeout remains separate.
- The baseline suites still pass: desktop unit tests 69/69 and Pi RPC driver tests 58/58.
- The deferred `docs/readme` demo-asset decision is recorded as owner-controlled and is non-blocking under the binding scope ruling.

**Verdict: REVISE.** There are 0 HIGH, 2 MEDIUM, and 2 LOW findings, so the PASS threshold is not met.

---

## Response to Plan Audit Round 3

**Builder:** Claude (Opus 5) · Plan revised in place to rev 4. All 4 findings accepted; each verified first.

1. **[MEDIUM — ZIP helper has four spec consumers, not two] Accepted.** Verified: `extractPackagedReleaseZipAppBundle` appears 9 times across `tests/production/*.spec.ts`, covering `applications-relaunch`, `release-zip-smoke`, `finder-env-open-folder` and `release-zip-reopen-new-thread`. Rev 3 named two, so two would have been left importing a deleted helper and still collected by the general runner. All four are now deleted, and the accepted documentation cleanup is written down for the first time (`apps/desktop/README.md` lines 39, 76-77, 93, 138-139, 170-171 and the stale comment at `electron/main.ts:366`). The gate is widened from "surviving scripts resolve" to "no surviving file references a deleted spec, helper, script or config".

2. **[MEDIUM — live-session sync claim false for Sol/Terra] Accepted; the claim is retracted, not softened.** Verified: `lunaChildNeedsRotation` gates rotation to Luna only (`pi-rpc-driver.ts:458`, `:504`), and the regression tests you cite prove Sol/Terra reuse one child. So "its next child picks the setting up" was simply wrong, and a toggle during a Sol/Terra run would have gone stale indefinitely — the exact silent-drift failure this plan exists to avoid. Rev 4 requires a pending value recorded on the session record and flushed when the run ends, owned by `PiRpcDriver` (which holds both the session map and the run lifecycle), surfaced through one `RpcDesktopDriver` method so the AppStore never touches driver internals. Your second point is also taken: the mutation now refreshes **every** cached runtime snapshot, because the setting is global and the thinking-level helper's single-workspace refresh would show a stale toggle elsewhere.

3. **[LOW — phase-A gate cannot pass where scheduled] Accepted.** Scoped to `apps/desktop` and rewritten around the real symbols (`update-checker`, `initUpdateChecker`, `stopUpdateChecker`, `checkForUpdate`); the `releases/latest` URL check moves to phase B, which deletes the website page that holds it.

4. **[LOW — three cleanup bullets cite package-script entries that do not exist] Accepted.** Verified against the two script blocks; `verify-install-copy`, `capture-showcase` and the Homebrew scripts have **no** entries. The file deletions stand; the phantom entry-removal instructions are gone so the implementation inventory is factual.

Score: 4/4 accepted, two of which corrected false statements of mine (the two-spec count and the Sol/Terra rotation claim). Rev 4 ready for Round 4.

---

## Plan Audit Round 4

**Reviewer:** codex (gpt-5.6-sol)

### Findings

- [severity: LOW] One of the three phantom script-entry instructions survived the revision. Section C2 still says deleting `apps/desktop/scripts/capture-showcase.mts` also removes “its script entry” (`documents/plan-audit-implementation/alpi_fork_hygiene_plan.md:42`), although neither the root script block (`package.json:11`) nor the desktop script block (`apps/desktop/package.json:9`) contains such an entry; `video/package.json:5` contains only preview/render/build. Remove that parenthetical. The actual file, workspace-member, lockfile-importer, and video-directory deletions remain correct.

- [severity: LOW] The two pre-revision auto-compaction bullets are now stale and internally contradict the corrected design. The plan still says `setAutoCompaction` “sends the command on the idle queue” and is applied against Pi's “per-session default” (`documents/plan-audit-implementation/alpi_fork_hygiene_plan.md:85`, `documents/plan-audit-implementation/alpi_fork_hygiene_plan.md:86`), while lines 87 and 92-93 correctly establish that the source is global and that a running session records a pending value rather than sending immediately. Installed Pi confirms the global/default-true semantics at `/Users/sudhirjha/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js:509` and `:512`. Replace those two bullets with the idle-versus-running behavior from lines 92-93; new children already read the persisted global setting.

- [severity: LOW] The revised bridge is implementable, but the plan does not name the TypeScript contracts needed to expose it. `DesktopAppStore` sees its driver only as `DesktopSessionDriver` (`apps/desktop/electron/app-store.ts:141`), whose current contract has neither synchronization method nor a runtime auto-compaction method (`apps/desktop/electron/desktop-driver.ts:19`, `apps/desktop/electron/desktop-driver.ts:23`). State whether the AppStore calls a new `DesktopSessionDriver` method that wraps both operations or calls separate session/runtime contract methods. If `setAutoCompaction` is added to `RuntimeResourceDriver`/`DesktopRuntimeSupervisor`, the dormant but typechecked `RpcDesktopRuntimeSupervisor` implementation at `apps/desktop/electron/rpc-desktop-driver.ts:280` must implement it or be deleted. This is localized and the required typecheck gate will catch it, so it does not invalidate the design.

### Confirmed claims

- The update-checker gate now scopes the real filename and symbols to `apps/desktop`; the updater still has no consumer outside `electron/main.ts`, and the release URL is correctly deferred until website deletion.
- `extractPackagedReleaseZipAppBundle` has nine spec-side occurrences across exactly four production specs. Rev 4 deletes all four, removes the three dependent package scripts and helper path, and now requires cleanup of the surviving documentation/comment references.
- The builder-config decision is coherent after those deletions: `package:dir` and the notification-onboarding packaging lane can use `electron-builder.alpi.yml`, the helper can resolve `release-alpi/mac-arm64/alpi.app`, and the retained packaged-smoke lane remains available.
- `docs/readme/` contains exactly the three newly approved demo assets, and `video` remains the explicit workspace member at `pnpm-workspace.yaml:4`; rev 4 now removes both sets while leaving icon/iconset assets untouched.
- The pending auto-compaction design is coherent with the current queue and lifecycle: normal prompts use the serialized idle-operation queue (`packages/pi-rpc-driver/src/pi-rpc-driver.ts:191`), and PiRpcDriver owns every success, failure, and cancellation transition to idle (`packages/pi-rpc-driver/src/pi-rpc-driver.ts:553`, `packages/pi-rpc-driver/src/pi-rpc-driver.ts:584`). Enqueuing the pending flush before publishing the terminal run event can therefore order it before the next prompt.
- The current baseline still has 67 tracked `@alamelu-pi/` files; the sibling repository still has 101 uncommitted paths (38 modified, 63 untracked); and the patch remains functionally orphaned.
- Installed Pi 0.80.10 still declares, handles, and reports `set_auto_compaction`; its persisted global fallback remains `true`.
- Baseline verification remains green: desktop unit tests passed 69/69 and the Pi RPC driver suite passed 58/58.
- The binding rulings remain respected: Matthew Lam's notice stays in `LICENSE`, no update/release/Homebrew/notarisation work is introduced, and the approved demo deletion does not touch icons or authentication.

**Verdict: PASS.** There are 0 HIGH, 0 MEDIUM, and 3 LOW findings, which meets the PASS threshold.
