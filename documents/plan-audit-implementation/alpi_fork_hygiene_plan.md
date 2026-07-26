# Alamelu Pi — Fork Hygiene & Repo Housekeeping Plan

**Date:** 2026-07-26 · rev 3 (after Plan Audit Rounds 1-2) · **Builder:** Claude (Opus 5) · **Critic:** Codex (gpt-5.6-sol) · **Owner:** Sudhir
**Baseline:** `f43e123` + Phase 5 D commit (installed build verified) · Remote `upaayan/alamelu-pi-gui`
**Critic-selection rule (owner, standing):** Codex critiques non-UI/UX work; Fable 5 critiques UI/UX. This batch is build/licensing/packaging → Codex.

## Owner rulings (binding)

1. **LICENSE:** Matthew Lam's MIT copyright notice **stays** — the licence requires it and the owner explicitly agreed ("have to respect the license and the work of the author"). Add Sudhir Jha's copyright for the derivative work alongside it. His name is stripped from every **non-licence** surface.
2. **No updates, ever.** Remove the update checker entirely, including any network call or link to `minghinmatthewlam/pi-gui`.
3. Icon/iconset untouchable. No Anthropic auth work. No codex re-auth automation.
4. Upstream bug filing is **cancelled** — the owner declined and the local patch self-heals.
5. macOS-only, local-only, single user. No release pipeline, no Homebrew, no notarisation work (explained separately as a learning note, not built).

## A. Update checker removal

- Delete `apps/desktop/electron/update-checker.ts` and its only consumer wiring in `electron/main.ts` (menu item, both result dialogs, the `disableUpdateChecks` brand flag that exists only to suppress it).
- **Correction (Round 1 LOW):** there is **no** preload, renderer or IPC channel for this feature. All wiring is inside `main.ts`: import `:27`, lifecycle state `:67`, dialogs `:582`, menu item `:630`, startup `:948`, cleanup `:1267` and `:1284`. Also drop the then-unused `MessageBoxOptions` import at `main.ts:11`.
- **Verification (phase-scoped, Round 2 LOW):** `git grep -n "checkForUpdates\|updateChecker\|releases/latest"` returns zero. The **username/author** zero-hit check is *not* run here — `README.md`, `electron-builder.yml` and `video/` legitimately still contain hits until their own phases — it is reserved for the final hygiene gate below. App boots; the menu no longer offers an update item.

## B. Remove `apps/website`

- **Two consumers must be handled first** (Round 1 MEDIUM, verified): `apps/desktop/tests/helpers/electron-app.ts:22` builds a path to `apps/website/public/og.png` and uses it at `:769` for the native clipboard test (`tests/native/paste.spec.ts:26`) — replace with a test-owned fixture generated from the helper's existing `TINY_PNG_BASE64`, touching no icon asset. `scripts/verify-install-copy.mjs` reads two website files and asserts on the release/Homebrew copy this plan removes — delete that now-orphaned verifier and its script entry.
- Then delete the directory. The workspace globs `apps/*` (`pnpm-workspace.yaml:2`), so no workspace edit is needed; `pnpm install` drops the `apps/website` lockfile importer.
- Nothing replaces it; the README is the documentation surface. (Owner note: a Windows build would need a Tauri rewrite — recorded as a future project, **not** in scope.)
- **Verification:** `pnpm install` resolves cleanly; `git grep -n "apps/website"` returns zero.

## C. README rewrite

Rewrite to describe what this actually is:
- A **local, personal** macOS build — not a distributed product. No releases, no Homebrew tap, no auto-update.
- **Philosophy difference from upstream:** upstream pi-gui bundled its own pi runtime; Alamelu Pi is a **thin wrapper over the separately installed `pi` CLI**, which stays the single source of truth for sessions, models, auth and config.
- Build/install instructions that match reality (`package:alpi:dir`, signing via the AWS-backed identity, replace the bundle in `/Applications`).
- Note that the app keeps the global pi-ai truncation patch applied automatically.
- **Attribution without a name outside the licence** (Round 1 HIGH): credit the *project* — "derived from the pi-gui project (MIT); see LICENSE for the original copyright holder" — plus runtime by `earendil-works/pi`. This respects the author's work as the owner asked while keeping his name confined to `LICENSE`, satisfying both rulings instead of trading one off.
- Remove every upstream install path, badge and release link.

## C2. Remaining upstream-author surfaces (Round 1 HIGH)

Non-licence places the audit found his name/URL, all to be rebranded or removed:
- `apps/desktop/package.json:5` `"author": "Matthew Lam"` → Sudhir Jha; the `description` ("Codex-style desktop shell for pi") → an Alamelu Pi description.
- `video/` — a Remotion project for upstream's demo reel whose `src/scenes/ClosingCard.tsx:29` renders `github.com/minghinmatthewlam/pi-app`. **Delete the directory.** **Correction (Round 2 MEDIUM — rev 2's "verified standalone" was false; the check grepped `video/` with a slash and missed a bare entry):** `video` is an explicit workspace member at `pnpm-workspace.yaml:4` with a lockfile importer at `pnpm-lock.yaml:210`, and `apps/desktop/scripts/capture-showcase.mts:22`/`:327` writes captures into it. Deletion therefore also removes the `- video` workspace entry and the then-orphaned `capture-showcase.mts` (plus its script entry); `pnpm install` drops the importer. It is upstream marketing, like `apps/website`.
- **Pending owner decision (do not act without it):** `docs/readme/{demo.gif,demo.mp4,demo-poster.png}` are the rendered output of that same factory, shot 2026-06-04 against upstream's UI, and `README.md:7` embeds the GIF with alt text "pi-gui demo". Recommended for deletion with the README rewrite; **left in place until the owner says so.**
- **Final hygiene gate (run once, after every phase):** `git grep -nE "Matthew Lam|minghinmatthewlam" -- ':!LICENSE' ':!documents/plan-audit-implementation'` returns **zero**. This is the single authoritative author-name check; per-phase gates never assert it.

## D. Internal names

- **LICENSE:** keep the existing MIT block verbatim; append a second copyright line for Sudhir Jha covering the Alamelu Pi modifications. No other change.
- **Workspace packages** `@pi-gui/desktop`, `@pi-gui/session-driver`, `@pi-gui/catalogs`, `@pi-gui/pi-rpc-driver` → `@alamelu-pi/*`. **67 tracked files** carry the namespace (audited count — enumerate and reconcile against it). Covers: every `package.json` name/dependency, all import specifiers, `apps/desktop/tsconfig.paths.json:5`, `pnpm --filter` invocations in scripts, Playwright/test imports, docs, **and the non-manifest executables the first draft missed — `apps/desktop/scripts/dev.mjs:12` and `scripts/run-rpc-gui-lab.sh:121` — plus `apps/desktop/tests/AGENTS.md:11`**. The lockfile entries regenerate via `pnpm install`. **Correction:** `tsconfig.base.json` has **no** path mappings (rev 1 wrongly claimed it did); the electron-builder files carry no `@pi-gui/*` package reference — their `pi-gui` strings are the separate packaging-brand migration handled below.
- **localStorage key** `pi-gui.sidebarWidth` → `alamelu-pi.sidebarWidth`, reading the old key once as a fallback so the owner's current sidebar width is preserved rather than silently reset.
- **Upstream builder config `apps/desktop/electron-builder.yml` — DECISION MADE (owner delegated to builder+critic, binding constraint "it should not break anything"): delete it, and retarget its consumers to `electron-builder.alpi.yml`.** Rationale: deletion removes the last upstream app id (`com.pi-gui.desktop`), the `Copyright 2026 Matthew Lam` product metadata, and the forbidden GitHub publisher / notarize / DMG-ZIP / AppImage release configuration in one move — all of which contradict rulings 2 and 5. Nothing breaks because every consumer is retargeted rather than removed:
  - `package:dir` (`apps/desktop/package.json:21`) → add `-c electron-builder.alpi.yml`; it then emits `release-alpi/mac-arm64/alpi.app` unsigned, which the packaged lanes can use.
  - `tests/helpers/electron-app.ts:21` default release dir → `release-alpi`. `resolvePackagedAppBundle` already falls back to the first `.app` when `pi-gui.app` is absent (`:397`), so the bundle-name change is safe; the preferred name is updated to `alpi.app` anyway for clarity.
  - `test:prod:notification-onboarding` (`:73`) passes its own `-c.directories.output`; add the same `-c` flag.
  - `package`, `package:linux*`, `bun:package*` (`:19`, `:20`, `:24`-`:28`) build release artefacts and Linux targets that rulings 5 and macOS-only make dead — **delete those script entries** rather than retarget them.
  - **Their dependents must go with them (Round 2 MEDIUM — rev 2 left these dangling):** `test:prod:applications-relaunch` (`:75`), `test:prod:release-zip-smoke` (`:76`) and `test:prod:release-zip-smoke:ci` (`:77`) all require a release/ZIP artefact the dir-only Alpi config never produces (`electron-builder.alpi.yml:40`), as do the ZIP helpers from `tests/helpers/electron-app.ts:424` and their specs. Delete those three script entries, the ZIP helper path and the two specs — they test a distribution flow rulings 2 and 5 abolish.
  - `verify:packaged-runtime-deps` (`:31`) is **retained but retargeted**: `scripts/assert-packaged-runtime-deps.mjs:40`/`:83` default to the removed `release/pi-gui.app` layout and must default to `release-alpi/mac-arm64/alpi.app`.
  - `verify:packaged-runtime-deps:linux` (`:32`) and `scripts/bun-package-wrapper.mjs` become orphaned — delete both.
  - **Reconciliation rule:** after the edit, every remaining `package.json` script must resolve to a file/config that exists; the implementation lists each deleted entry and why it is dead by ruling.
  - `package:alpi`/`package:alpi:dir` are unaffected (`scripts/package-alpi-dir.mjs:31` names the alpi config explicitly).
  - **Gate:** after the change, `pnpm --filter <desktop> run package:dir` succeeds and `test:prod:packaged-smoke` passes, proving the packaged lane still works end to end.
- **Homebrew scripts** `scripts/{homebrew-tap-utils,release-homebrew-sync,update-homebrew-tap,test-update-homebrew-tap,verify-homebrew-flow}.mjs` → delete; they publish to upstream's tap and contradict ruling 5. Remove their `package.json` script entries.
- **Root package name** `alamelu-pi-gui` → keep (already ours).
- **Verification:** `pnpm install`, both typechecks, `pnpm --filter @alamelu-pi/desktop build`, full unit + driver suites, branded Playwright set, and a fresh `package:alpi:dir` that still produces a signed `alpi.app`. `git grep -n "@pi-gui/" -- ':!documents/plan-audit-implementation'` returns zero.

## E. Delete `patches/`

Verified orphaned: no `patchedDependencies` entry in any manifest, no `mariozechner` reference anywhere in tracked files. Delete the directory. **Verification:** `pnpm install` clean afterwards.

## F. Harvest `pi-gui-rpc-lab`, then decide its fate

The lab holds **101 uncommitted files (38 modified, 63 untracked)** — verified with `git status --porcelain=v1 -uall`; rev 1's "70" came from a flag that collapses untracked directories and would have let 31 files be missed silently. It also holds the **only** CI configs (`ci.yml`, `release.yml`); alamelu has zero tracked workflows. **The harvest table must reconcile to 101.**

- **Enumerate before deciding.** Produce a table of every uncommitted lab file: path, whether an equivalent exists in alamelu, and whether the lab version contains anything alamelu lacks. No file is discarded on assumption.
- Explicit candidates to assess: `packages/pi-sdk-driver` (dead here — this fork is RPC-only), `packages/session-driver/src/runtime-types.ts` edits, and the CI workflows.
- **CI:** alamelu's workflows were deliberately disabled (`ea69e80`) and ruling 5 says no release pipeline. Recommend **not** importing `release.yml`. `ci.yml` may be worth importing in a reduced, local-only form — but that is **scope expansion and requires owner approval**; default is to record it and do nothing.
- The lab repo itself is **not deleted** in this batch. Recommend only after the harvest table exists and the owner approves.
- **Verification:** the harvest table is in the implementation doc; anything imported passes the full gate set.

## G. Enable pi's native auto-compaction

**Finding:** there is no auto-compact extension installed (`~/.pi/agent/extensions` holds only `00-path-fix.ts`, `global-mandate.ts`, `repomem.ts`). What the owner remembers is pi's **built-in** auto-compaction — `AgentSession.setAutoCompactionEnabled()` → `settingsManager.setCompactionEnabled()`, exposed over RPC as `{type:"set_auto_compaction", enabled}`. pi owns the trigger policy; the app only toggles it.

- `PiRpcDriver.setAutoCompaction(sessionRef, enabled)` sends the command on the idle queue; `RpcDesktopDriver` delegates.
- Applied when a session is opened/created so it follows the user's preference rather than pi's per-session default.
- **Correction (Round 1 LOW, verified):** `setCompactionEnabled` writes pi's **global persisted setting** (`settings-manager.js:512`) and its default is **already `true`** (`:509`), which `get_state` reports as `autoCompactionEnabled`. So auto-compaction is **on for the owner today** and this work adds *explicit control*, not new behaviour. Two consequences the plan must honour: (a) the toggle changes pi **globally — including the `pi` CLI in the terminal** — so its caption must say so plainly; (b) the setting is not per-session, so the plan must state that toggling applies to pi as a whole and the driver call exists to make the change explicit and visible.
- **Full bridge, reusing the mechanism that already manages pi's other global settings (Round 2 MEDIUM — rev 2 named no path at all).** The per-session RPC route is *not* the primary path: the idle queue **rejects** a config mutation while a run is active (`pi-rpc-driver.ts:431`,`:446`), and it cannot work with no session open. Instead follow `setDefaultThinkingLevel` exactly:
  - `ExternalPiRuntimeSupervisor.setAutoCompaction(workspace, enabled)` → existing `updateSettings()` writer → `buildSnapshot()`, i.e. the same file pi itself reads. Works with no session open, and pi's settings file stays the single source of truth (no second app-owned preference that can drift).
  - `RuntimeSettingsSnapshot` (`packages/session-driver/src/runtime-types.ts:93`) gains `autoCompactionEnabled?: boolean`, populated by `runtimeSettingsFromRecord` from `compaction.enabled` with pi's own `?? true` default.
  - Renderer path mirrors the existing thinking-level control end to end: `ipc.ts` channel → `preload.ts` → main handler → `AppStore` method → `settings-general-section.tsx`, which already receives the runtime snapshot plus callbacks. No new state shape is invented.
  - **Open sessions:** after the settings write, best-effort `set_auto_compaction` to each currently-open idle session so a live thread does not lag until restart; a session that is running is skipped (its next child picks the setting up), and a failure there is logged, never surfaced as an error.
  - **Caption (required):** states that this is pi's global setting and also affects the `pi` CLI.
- **The 120s manual-compact timeout stays.** It answers a different question — how long to wait for an explicit `/compact` — and auto-compaction merely makes reaching it unlikely. Removing it would reintroduce the 30s failure.
- **Verification:** driver unit test asserting the command and the idle-queue path; a live check that a session reports auto-compaction enabled after the toggle.

## Build order

A → B → C → D → E → F → G, each its own commit, pushed to `upaayan`. D is the riskiest (touches every manifest and import) so it lands alone and fully verified.

## Verification gates (every round)

**Grep gates use `git grep` with `:!documents/plan-audit-implementation` and `:!LICENSE` exclusions** (Round 1 LOW: the plan and audit texts contain the very patterns being searched, so a plain `grep` would match itself). `pnpm install` · `tsc --noEmit` both projects · `pnpm --filter <desktop> build` · `node --test apps/desktop/tests/unit/*.test.mjs` (69) · driver suite (58) · branded Playwright via `--grep` (`ux-repair.spec.ts` 4, `new-thread-composer` branded 4, `provider-settings` branded 4) · a real `package:alpi:dir` after D. Real output pasted into the implementation doc. The unbranded half of `tests/core` stays out of scope and is never claimed green.

## Out of scope

Icon, Anthropic/codex auth, notarisation (learning note only), Windows/Tauri, the stubbed-functionality and polish backlog (streaming indicator, timeline rhythm, scrollbars, Esc-to-stop, thread cycling, cross-thread search, resume fidelity, queued-message editing), and repairing the unbranded test lane.
