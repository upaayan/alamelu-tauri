# Alamelu Pi — UX/UI Repair Implementation (Phases 1–3)

Plan: [`alpi_ux_repair_plan.md`](./alpi_ux_repair_plan.md) (rev 4, Opus 5 PASS after 4 rounds) · Audit log: [`alpi_ux_repair_audit.md`](./alpi_ux_repair_audit.md)
Baseline: `b4edbbb` · Phase 1 `3018bc0` · Phase 2 `556defc` · Phase 3 (this commit)
Owner rulings honored: **icon/iconset byte-identical**; **no Anthropic auth work**; **no openai-codex re-auth automation**.

## Baseline reality (recorded before edits, per plan §Testing strategy)

- Unit tests: 34 passing (`node --test apps/desktop/tests/unit/*.test.mjs`)
- Driver suite: 52 passing (`pnpm --filter @alamelu-pi/pi-rpc-driver test`)
- Unbranded half of `tests/core` is broken at baseline in this fork (documented in the plan, out of scope, not claimed green).

## What was built

### Phase 1 — bug & trust (`3018bc0`)
| Item | Where |
|---|---|
| 1.1 Error mapper at the single funnel | `electron/user-facing-errors.ts`; applied in `app-store.ts` `withError` (above both sinks), `runFailed` state, and `sessionErrorsBySession` |
| 1.2 Model-switch preflight | `electron/model-switch-preflight.ts`; called in `app-store-composer.setSessionModel` after `ensureSessionReady` |
| 1.2 Metadata plumbing | `external-pi-auth-bridge.ts` gains `listModelMetadata()`; supervisor merges `contextWindow`/`api` into `RuntimeModelRecord` |
| 1.2 Session-dir/piBin plumbing | `DesktopAppStoreOptions.sessionDir`/`piBin` from main's resolved RPC config |
| 1.3 Dropdown placement | `new-thread-view.tsx` override removed; dead prop + `--below` CSS deleted (**in the repair commit, not Phase 1 — see Round 2**) |
| 1.4 New Thread honesty + capabilities | `App.tsx` (`lastError` wiring, success-gated clear, busy Start), `desktop-driver.ts`/`rpc-desktop-driver.ts` flags, `desktop-state.ts` `DriverCapabilities` |
| 1.5 Cancel ≠ failure | `packages/session-driver` `RunCancelledEvent`; driver `endRun()`; timeline "Stopped by you"; `statusForEvent` → idle |
| 1.6 Global pi-ai patch | `apps/desktop/scripts/patch-global-pi-ai.mjs` (`--check` / `--apply`) |

**Deviation from plan §1.2 (recorded):** the plan specified `getModel(providerId, modelId)` per inventory row. Implementation uses `getModels()` once and merges by key. Reason: `getModels` is already in the bridge's required-method list and already called for provider inventory, so it needs no new capability probe and costs one call instead of ~600. Same typed source, same degradation semantics (missing → `undefined` → no block). The plan's prohibition on extending `asModernModelRuntime`'s required list is respected — nothing was added to it.

### Phase 2 — first-minute polish (`556defc`)
Focus-visible ring globally + `prefers-reduced-motion`; `--muted-soft`/`--muted-subtle` raised in both themes; tooltip/kbd/toggle tokenized with dark values; window `backgroundColor` from resolved theme; `.button--secondary`, `--warning` defined, `--font-sans` → `--font-ui`; transcript tables/images/headings + overflow; hover-reveal copy button on prose code (`message-markdown.tsx`); brand strings (title, boot eyebrow, dialog titles).

### Phase 3 — product depth (this commit)
Capability-gated `/tree` and `/compact`; host commands moved inside the error-handled path (silent `/compact` fixed); follow-up messages echoed in the transcript like steer; model badge shows friendly label + "Switching…" pending state (`title` keeps the raw id); Skills/Extensions toggles disabled with "Managed by the pi CLI in this build" via a dedicated `supportsSkillToggles` capability; per-repo scope discloses the `.pi/settings.json` write. 3.7 (resume fidelity) **deferred** per plan — flagged for owner, not rushed.

## Verification Round 1

**Typecheck** — both projects, after every step:
```
npx tsc --noEmit -p tsconfig.electron.json   → EXIT 0
npx tsc --noEmit -p tsconfig.json            → EXIT 0
```

**Build**
```
pnpm --filter @alamelu-pi/desktop build
✓ 349 modules transformed. ✓ built in 985ms   BUILD EXIT 0
```

**Unit tests** (34 baseline + 21 new = 55)
```
node --test apps/desktop/tests/unit/*.test.mjs
ℹ tests 34  ℹ pass 34  ℹ fail 0            (baseline suites, unchanged)

node --test apps/desktop/tests/unit/model-switch-preflight.test.mjs
ℹ tests 11  ℹ pass 11  ℹ fail 0
  ✔ blocks a thread that exceeds the target context window
  ✔ allows a thread just inside the 0.9 safety factor
  ✔ never blocks on size when the context window is unknown
  ✔ blocks colliding tool history against a chat-completions target
  ✔ warns instead of blocking once the pi-ai patch is applied
  ✔ never blocks a switch back to the model that wrote the history
  ✔ does not block colliding history against a responses-API target
  ✔ blocks a provider with no credential at all
  ✔ lets a connected-but-expired provider through (run-time error explains it)

node --test apps/desktop/tests/unit/user-facing-errors.test.mjs
ℹ tests 10  ℹ pass 10  ℹ fail 0
  ✔ explains the duplicate tool-call-id 400 without jargon
  ✔ does not leak the session key in the not-open message
  ✔ truncates long unknown errors but preserves the full text
```

**Driver regression suite** — one predicted assertion change, nothing else:
```
before: ℹ tests 52  ℹ pass 51  ℹ fail 1
        ✖ PiRpcDriver cancel success ... emits runFailed   (rpc-client.test.mjs:553 — exactly the test the plan named)
after updating that assertion to runCancelled:
        ℹ tests 52  ℹ pass 52  ℹ fail 0
```
`:588-590` (abort-command-failure → stays `runFailed`) untouched, as decided in plan §1.5.

**1.6 live repro — the actual bug, before and after**
```
PRE-PATCH   grok-4.5 parallel tool calls → switch to deepseek/deepseek-v4-flash → prompt
  [message_end] stopReason=error ERROR="400: {\"message\":\"Duplicate value for 'tool_call_id'
                of call-79c36204-767b-4afa-a188-7227bf16f7d in message[2]\"...}"
  session toolCall ids: call-79c36204-...-7227bf16f7d3-0|fc_69f75e84..., ...-1|fc_69f75e84...

apply: node apps/desktop/scripts/patch-global-pi-ai.mjs --apply  → patched OK
check: state: patched

POST-PATCH  same flow
  [message_end] stopReason=stop        ← clean answer, no 400
```
Old vs new normalization of the July-24 ids (all three collided to one value before; distinct now):
```
-0  OLD call-cadbc1ea-fd79-4982-ba1a-60a9fad1c08   NEW call-cadbc1ea-fd79-4982-ba1a-60_26a12143
-1  OLD call-cadbc1ea-fd79-4982-ba1a-60a9fad1c08   NEW call-cadbc1ea-fd79-4982-ba1a-60_26a12142
-2  OLD call-cadbc1ea-fd79-4982-ba1a-60a9fad1c08   NEW call-cadbc1ea-fd79-4982-ba1a-60_26a12141
```

**Positive wiring assertion (plan §1.2, mandatory)** — proves metadata resolves rather than silently degrading:
```
grok-4.5          => {"api":"openai-responses","contextWindow":500000}     ← matches xai.models.js exactly
deepseek-v4-flash => {"api":"openai-completions","contextWindow":1000000}
backup-llama      => {"id":"gemma4-e4b-qat-q4xl","api":"openai-completions","contextWindow":32768}
total models with metadata: 1111 / 1111
```
(The 32768 backup-llama window is the exact cause of the owner's June/July context-overflow 400s; rule (a) now blocks those switches.)

**Real Electron surface** (isolated `PI_APP_USER_DATA_DIR`/`PI_CODING_AGENT_DIR`, `PI_GUI_BRAND=alpi`, never the real user data):
- App boots; Threads/Skills/Extensions/Settings all render.
- Keyboard focus after 6 Tabs: `outline=solid/2px` (baseline was `auto/1px` UA default).
- Live computed tokens in dark mode: `--tooltip-bg rgba(38,39,44,0.98)` (was hardcoded white), `--tooltip-fg #d8dae0`, `--toggle-bg rgba(255,255,255,0.06)`, `--warning #f59e0b`, `--muted-soft #9c9fa8`; `.button--secondary` → `1px solid`, `rgb(43,45,49)` (previously no rule existed at all).
- Screenshot: model dropdown opens **upward, fully inside the window** (was clipped off the bottom edge); badge reads **"OpenAI · gpt-5"** (was `openai:gpt-5`); Worktree chip disabled under RPC.

**Contrast (computed, not eyeballed)** — every muted token against every surface it sits on:
```
LIGHT #666d81: main 4.87  sidebar 4.73  surface 5.16
DARK  #9c9fa8: main 6.23  sidebar 6.09  surface 5.21
DARK  #9599a2: main 5.77  sidebar 5.64  surface 4.83
```
All ≥ 4.5:1.

## Known / deferred

- **3.7 resume fidelity** (tool cards + thinking rows from JSONL on reload) deferred per plan; owner decides whether to schedule.
- **Patch reverts on `pi update`** — re-run `node apps/desktop/scripts/patch-global-pi-ai.mjs --apply`. Until then preflight rule (b) blocks the dangerous switches, so the app degrades safely.
- Phase 4 backlog untouched (streaming indicator, timeline rhythm, scrollbars, Esc-to-stop, cross-thread search, deeper fork hygiene).
- Upstream issue/PR for the pi-ai truncation bug remains the owner's call (outward-facing action).


---

## Repair round (after Implementation Audit Round 1 — reviewer: Fable 5)

All five MEDIUM findings accepted and fixed; both LOW doc issues corrected. No scope added.

| Finding | Fix |
|---|---|
| M1 — 1.1 not applied at timeline row / notification body; `lastErrorDetail` had no consumer | `app-store-timeline.ts` runFailed row now uses `describeError` (headline as label, raw text in the existing detail slot); `notification-manager.ts` sends the headline; `composer-surface.tsx` renders `lastErrorDetail` as a small mono line under the headline, threaded through `composer-panel.tsx` from `App.tsx` |
| M2 — preflight `warn` proceeded silently | `app-store-composer.ts` now applies the switch **and** surfaces the reason in the banner |
| M3 — doc claimed 1.3 dead code was deleted; it survived | Actually deleted now: `dropdownPlacement` prop/param/usages in `model-selector.tsx` and `.model-selector__dropdown--below` in `main.css`; doc row corrected above |
| M4 — plan-committed test gates skipped; `new-thread-composer.spec.ts:297` contradicted the shipped badge | That test is now branded (`PI_GUI_BRAND: "alpi"`), its badge assertion matches the shipped label (`OpenAI · gpt-4o`) plus a `title="openai:gpt-4o"` assertion, and its catalog assertions were adapted to the seeded pi catalog exactly as plan §3.5 allowed. Branded Playwright gate now actually run — see below |
| M5 — 3.3 rename-pending and 3.4 SecondarySurface error slot silently missing | `sidebar.tsx` keeps the rename editor open and disabled until the rename resolves (no optimistic close-then-revert); `secondary-surface.tsx` gained a `lastError` slot, wired for Skills and Extensions in `App.tsx` |

### Verification Round 2

```
build                                    ✓ built in 898ms            BUILD 0
tsc --noEmit -p tsconfig.json            EXIT 0
tsc --noEmit -p tsconfig.electron.json   EXIT 0
node --test apps/desktop/tests/unit/*    ℹ tests 55  pass 55  fail 0
pnpm --filter @alamelu-pi/pi-rpc-driver test ℹ tests 52  pass 52  fail 0
```

**Branded Playwright gate (the check M4 said was missing) — now executed:**
```
new-thread-composer.spec.ts --grep "onboarding notice after picking a thread model"
  1 passed (5.7s)
provider-settings.spec.ts  → all 4 branded tests (:74, :130, :186, :236) passed
```
Two assertion corrections were needed and made, both proving the gate is real: the branded catalog labels models `OpenAI · gpt-5` (from pi's registry) where the test expected the SDK driver's `GPT-5`, and the badge renders the full label with the raw id in `title`.

**Unbranded specs still fail** (`provider-settings.spec.ts:14, :295, :349, :402` — `firstWindow` timeout, no window). Verified these are exactly the four tests with no `PI_GUI_BRAND` override. This is the pre-existing sdk-driver condition the critic independently verified against the baseline tree during Plan Audit Round 1 and which the plan explicitly does **not** claim green — out of scope, unchanged by this work.


## Post-PASS cleanup (Implementation Audit Round 2 LOWs)

Round 2 verdict: **PASS** — 0 HIGH, 0 MEDIUM, 3 LOW. Of the three LOWs:

- **LOW 2 (New-Thread banner headline-only)** — fixed: `newThreadComposerErrorDetail` state threaded `App.tsx` → `new-thread-view.tsx` → `ComposerSurface`, cleared alongside the headline. Rebuild + 55/55 units + branded gate re-run green after the change.
- **LOW 3 (doc bookkeeping)** — this section is the correction. Specifically: the two Round-1 LOWs referred to (a) the false "dead prop deleted" claim in the Phase 1 table, now corrected in place with a pointer to the repair commit, and (b) the missing note that Phase 3's commit line said "this commit" while the doc was written before the commit existed. **Commit granularity for the record:** `3018bc0` Phase 1 · `556defc` Phase 2 · `107d324` Phase 3 · `d3cfb09` Round-1 repairs · this commit LOW cleanup — five commits, each independently revertable.
- **LOW 1 (preventive-test tail)** — **NOT waived; owner decision.** Outstanding debt, deliberately not silently absorbed because writing it expands scope beyond the approved plan:
  - the four plan-named new Playwright specs (worktree-rejection keeps prompt, double-click Start creates one thread, follow-up visible while running, `/tree` absent under RPC) were not written;
  - unit rows for `readThreadStats` (JSONL parsing / collision detector) were not written — `evaluateModelSwitch` is covered by 11 rows, its JSONL feeder is not;
  - four pre-existing branded tests in `composer-controls`/`model-scope-toggle` were never run because those whole files are unbranded at baseline.
  None of this is a regression; it is coverage the plan promised and this round did not deliver. Owner to schedule or waive.
