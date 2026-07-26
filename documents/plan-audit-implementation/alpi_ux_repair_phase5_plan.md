# Alamelu Pi — Phase 5 Plan: self-healing patch, real /compact + /tree, test debt, install

**Date:** 2026-07-26 · **Builder:** Claude (Opus 5) · **Critic:** Claude (Fable 5) · **Owner:** Sudhir
rev 3 (after Plan Audit Rounds 1-2, PASS) · **Baseline:** `f763b51` (Phases 1–3 shipped, both audits PASS) · Remote `upaayan/alamelu-pi-gui`
**Owner approval:** given in chat 2026-07-26 — "Build all. In that order." Order is fixed: **A → B → C → D**.

## Owner rulings (unchanged, binding)

Icon/iconset **byte-identical**. No Anthropic auth work. No openai-codex re-auth automation. No scope beyond the four items below; critic may note concerns but not require expansions.

## Why this order

B changes what C must assert (a spec asserting "/tree is absent" becomes wrong once /tree works), so tests are written against shipped reality rather than rewritten. D is last so the app bundle is replaced **once**.

---

## A. Self-healing pi-ai patch (removes the "remember to re-run it" instruction)

**Problem:** `pi update` re-downloads pi-ai and silently erases the truncation patch. Today the owner must remember to re-apply; the app degrades safely (preflight blocks) but the bug returns.

**Target:** the app re-applies the patch itself when the installed pi changes.

- **Single implementation, no duplication — bundled, not shipped as a resource.** The core lives at `apps/desktop/electron/pi-ai-patch.mjs` (plain ESM, exporting `resolvePiAiTarget`, `checkPiAiPatch`, `applyPiAiPatch`, `shouldReapplyPatch`). `main.ts` **statically imports** it, so electron-vite bundles it into `out/main` — and `out/**/*` is already in `files` (`electron-builder.alpi.yml:12-14`), so it ships with zero packaging changes. `scripts/patch-global-pi-ai.mjs` becomes a thin CLI shim importing the same file by relative path, so the documented command still works and there is exactly one implementation. **`tsconfig.electron.json` gains `allowJs: true`** — without it the static `.mjs` import fails typecheck with TS2307 under `module: NodeNext` (no `.d.mts` alternative: that would mean two sources of truth for the same contract).
  **Correction (Round 1 HIGH, verified):** the rev-1 claim that dropping a file in `resources/` ships it was **false** — `extraResources` is per-file (`electron-builder.alpi.yml:16-20`), and the Luna extension is a *path handed to the pi child* (`main.ts:373-380`), never a main-process import. There is no precedent for importing an ESM resource from the built main bundle, so that mechanism is abandoned entirely in favour of static bundling.
- **pi binary resolution never uses `PATH`.** Under a Finder-launched packaged app `which pi` fails. Main already resolves the binary (`desktopDriverConfig.rpc.piBin`); the hook takes it as a parameter. The CLI shim keeps a `which`/`PI_GUI_PI_BIN` fallback for manual use only.
- **Startup hook** in `electron/main.ts`, **awaited inside try/catch, before the RPC driver is constructed** (it is a few fs reads and at most one write — milliseconds):
  1. Read the installed pi version from its `package.json` (no subprocess).
  2. Compare against `<userDataDir>/pi-patch-state.json` → `{ piVersion, patchedAt }`.
  3. If the version differs **or** `checkPiAiPatch()` reports `unpatched`, run `applyPiAiPatch()`; on success write the new state.
  4. `drifted` (pi's source no longer matches the guard) → do **not** patch, log clearly, leave state unwritten.
  Any throw is caught and logged; startup continues regardless.
  **Correction (Round 1 LOW):** rev 1 said fire-and-forget, which raced the pi child spawn and could mark "patched" while a child ran against the unpatched library. Awaiting before driver construction removes the race; the cost is negligible.
- **Never runs under test.** The hook is skipped when `PI_APP_TEST_MODE` is set, so branded Playwright boots (fresh isolated userData every run, parallel workers) can never mutate the owner's global npm tree. This is isolation, not hardening.
- **Silent on success** (maintenance, not news); failures log only. The preflight remains a partial safety net — **qualified**: rule (b) blocks only when registry metadata is available, and is inert without it (plan rev 4 §1.2), so the hook is the real fix, not a nicety.
- **Verification — must actually exercise the hook, not assume it:**
  - unit rows for `shouldReapplyPatch(storedVersion, currentVersion, patchState)`: same version + patched → no-op; version changed → apply; `unpatched` marker → apply; `drifted` → never apply.
  - a fixture test that runs `checkPiAiPatch`/`applyPiAiPatch` against a **temporary copy** of the real pi-ai file (never the global install), asserting unpatched → patched → idempotent second run → refusal on a mutated (drifted) copy.
  - in D, after installing, confirm the packaged app wrote `pi-patch-state.json` with the current pi version — proof the bundled hook is alive in the shipped bundle, which a bare `--check` (already patched) would not prove.

## B. Wire `/compact` and `/tree` for real (replaces Phase-3 hiding)

**Owner correction, verified against installed pi 0.80.10:** pi's RPC protocol has `{type:"compact", customInstructions?}`, `{type:"get_tree"}` → `{tree, leafId}`, and `{type:"fork", entryId}`. The desktop driver's rejections are leftover stubs, not pi limitations. Phase 3 hid working functionality; this restores it.

- **`PiRpcDriver.compactSession`** — replace the rejection with `enqueueIdleOperation` + `prepareIdleLunaClientForMutation` (same discipline as `setSessionModel`), send `compact` **with an explicit timeout** — the client default is 30s (`rpc-client.ts:56`) and pi only answers once compaction finishes (`rpc-mode` compact handler), so reuse the existing `PROMPT_COMMAND_TIMEOUT_MS` (120s). Emit `sessionUpdated` on success.
- **`PiRpcDriver.getSessionTree`** — send `get_tree`; map pi's `SessionTreeNode { entry, children, label? }` to `SessionTreeNodeSnapshot`. pi's `SessionEntry` union (`message | thinking_level_change | model_change | compaction | branch_summary | custom | custom_message | label | session_info`) matches the app's `SessionTreeNodeKind` **exactly** — map by `entry.type`, deriving `id`/`parentId`/`timestamp` from the entry base, `title`/`preview` from its content, and recursing over `children`. Unknown/absent kind → **skip that node but hoist its children to the skipped node's parent**, so no branch is silently lost (the union is exhaustive today; this is only future-proofing against a pi that adds a kind).
- **`PiRpcDriver.navigateSessionTree`** — send `fork` with the target `entryId`; return `{cancelled}` from pi's result — **verified present**: fork responds `data: {text, cancelled}`. Map `data.text` onto `NavigateSessionTreeResult.editorText`, which the existing modal already consumes.
- **`RpcDesktopDriver`** delegates all three to the rpc driver and flips `supportsCompact`/`supportsTree` to `true`; the capability plumbing built in Phase 1 then re-exposes both slash commands automatically, with **no renderer change needed**.
- **Risk:** compaction rewrites session history. It is user-initiated via an explicit command, runs only when idle, and pi owns the operation — no extra guarding beyond the idle queue. **Known behaviour past 120s:** if a very large session exceeds the timeout the client rejects, the user sees a failure banner, but pi still finishes compacting — so the cached transcript diverges until the thread is reloaded. Documented rather than re-tuned; it is not a new bug.
- **Verification:** driver unit tests with a fake RPC client (compact sends the right command; tree maps a representative multi-kind fixture; navigate forks). Live check on a real session in the sandbox: `/compact` returns success and `/tree` renders real nodes.

## C. Test debt (owed from the approved plan, not new scope)

Written **after** B so assertions match shipped behavior:

1. Worktree attempt under RPC → error visible, prompt preserved, no thread created.
2. Double-click Start → exactly one thread.
3. Follow-up typed during a run appears in the transcript.
4. `/tree` **present and functional** under RPC (was planned as "absent"; B makes the original assertion obsolete — recorded as a deliberate change).
5. Unit rows for `readThreadStats`: colliding pipe-composite ids detected; distinct ids → no collision (true negative); malformed JSONL lines skipped; missing file → zeroed stats.

6. The 1.3 dropdown bounding-box assertion (open dropdown fully inside the viewport in the new-thread view) — owed from the original plan §1.3 and omitted in rev 1's debt list.

All Playwright specs branded (`PI_GUI_BRAND: "alpi"`) with isolated user-data dirs. **Correction (Round 1 MEDIUM):** rev 1 named `composer-controls`/`model-scope-toggle` as holding pre-existing branded tests; they hold **zero** `PI_GUI_BRAND` tests. The owed run is the four branded tests already in `new-thread-composer.spec.ts` (`:29`, `:110`, `:161`, `:216`), executed once via `--grep` with results recorded; failures predating this work are reported, not fixed.

## D. Package + install (owner-visible, last)

1. **Back up** `/Applications/Alamelu Pi.app` (currently dated Jul 20) before touching it — non-negotiable.
2. Package via the sanctioned path only: `pnpm --filter @pi-gui/desktop run package:alpi:dir` with the AWS-Secrets-Manager-backed signing described in `~/playground/alamelu/documents/alpi-signing-eli5.md`. No other signing path, no keychain inspection, no command that could prompt for an Apple password.
3. Replace the bundle, launch, and verify on the real installed app: window opens, a thread loads, the model dropdown opens upward with friendly labels, and `patch-global-pi-ai --check` reports `patched`.
4. If signing cannot complete unattended (missing secret/env), **stop and report** — do not fall back to an unsigned or differently-signed build.

## Build order & verification gates

A → B → C → D, each its own commit, pushed to `upaayan`. Every round: `tsc --noEmit` (both projects), `pnpm --filter @pi-gui/desktop build`, `node --test apps/desktop/tests/unit/*.test.mjs`, `pnpm --filter @pi-gui/pi-rpc-driver test`, and the branded Playwright specs via `--grep`. Real command output pasted into `alpi_ux_repair_phase5_implementation.md`; the unbranded half of `tests/core` remains out of scope and is never claimed green.

## Out of scope

Icon, Anthropic/codex auth, upstream issue filing (owner's call), `apps/website`, Phase 4 backlog (streaming indicator, timeline rhythm, scrollbars, Esc-to-stop, cross-thread search), resume fidelity (3.7).
