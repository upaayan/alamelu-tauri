# Alamelu Pi — UX/UI Repair Plan (consultant-report follow-up)

**Date:** 2026-07-25 · rev 4 (2026-07-26, after Plan Audit Rounds 1–3) · **Builder:** Claude (Fable 5) · **Critic:** Claude (Opus 5) · **Owner:** Sudhir
**Baseline:** commit `b4edbbb` (checkpoint incl. in-flight `ensureSessionReady` fix), pushed to private remote `upaayan/alamelu-pi-gui`.
**Source findings:** consultant report delivered 2026-07-25 in chat (verified diagnosis: model-switch "RPC 400" family + UX/UI audit).

## Owner rulings (binding for builder AND critic)

1. **No icon changes.** The Alamelu lady icon and the entire iconset stay byte-identical. Any finding touching icon art/alpha/shape is OUT of scope.
2. **No Anthropic auth work.** Anthropic third-party access is banned upstream; the expired token is the steady state. Anthropic-via-API will not be used (cost); emergency path is OpenRouter. Nothing here may attempt Anthropic re-auth or treat it as a defect.
3. **`No API key for provider: openai-codex` is normal life** (subscription re-auth cycle). Not a defect. UX may *surface it kindly* (1.1) but must not attempt auto-fix.
4. Commit-first safety already done (`b4edbbb`); every phase lands as its own commit(s) on `main`, pushed to `upaayan` after critic PASS of that phase's implementation.
5. Critic is Opus 5 via the `critic` agent. Critic must not expand scope beyond this plan; concerns may be flagged as notes but are not required changes without owner approval. Critic's PASS ends her involvement in that round.
6. Filing a public upstream issue/PR against `earendil-works/pi` for the pi-ai truncation bug is an **owner decision, not in this plan** (outward-facing). Plan includes only the local patch (1.6).

## Scope

Everything from the consultant report EXCEPT the two exclusions above. Phases 1–3 are committed work; Phase 4 is an owner-pick backlog (listed, not scheduled). Multi-layer task → Feature Integration Checklist included.

## Architecture overview (what changes where)

- **Renderer** (`apps/desktop/src/`): New-Thread error wiring in `App.tsx`, dropdown placement, focus-visible & theming CSS, markdown/transcript CSS, copy button, model badge label, pending states, capability-gated slash menu, queue visibility.
- **Electron main** (`apps/desktop/electron/`): error-mapping at the `withError`/`withErrorHandling` implementations in `app-store.ts:1906-1930` (single application above both sinks), model-switch preflight, session-dir plumbing into the store, brand string handling, cancel-neutral plumbing.
- **Desktop driver layer** (`apps/desktop/electron/desktop-driver.ts` + `rpc-desktop-driver.ts`): capability flags live HERE (`supportsWorktrees` already at `desktop-driver.ts:25`; extend to `{worktrees, tree, compact, queueEditing}`), exposed to the renderer via snapshot.
- **RPC driver package** (`packages/pi-rpc-driver/`): distinct cancelled-run outcome only.
- **Session-driver contract package** (`packages/session-driver/`): the `runCancelled` member is declared in the `SessionDriverEvent` union (`src/types.ts:290-302`) — the one shared-types change.
- **Shared state/IPC contract** (`src/desktop-state.ts`, `src/ipc.ts`, `electron/preload.ts`): capability flags + `lastErrorDetail` cross this boundary; every addition lands in all three files.
- **Global pi install** (outside repo): surgical `normalizeToolCallId` patch via idempotent, signature-guarded script in `apps/desktop/scripts/`; the RPC child runs the global `@earendil-works/pi-coding-agent`, so nothing inside the repo can fix the 400 at its source.
- **Tests**: unit (error mapper, preflight, registry-metadata merge), driver regression suite, named **branded** Playwright tests (see Testing strategy — the unbranded half of the core lane is broken at baseline and NOT claimed).

## Feature Integration Checklist

- [ ] Capability contract defined once at the desktop-driver layer and exposed via snapshot (`{worktrees, tree, compact, queueEditing}`; `undefined` ⇒ supported, `false` ⇒ hidden/disabled affordance); `runCancelled` union member declared in `packages/session-driver/src/types.ts`
- [ ] Error mapper applied once, inside `withError`/`withErrorHandling` implementations (`app-store.ts:1906-1930`), above BOTH sinks (`sessionErrorsBySession` and `state.lastError`)
- [ ] State/IPC contract changes (`lastErrorDetail?: string`, capability flags) land in `desktop-state.ts` + `ipc.ts` + `preload.ts` together, with consumers enumerated
- [ ] Preflight implemented main-side as a pure, unit-tested decision function; renderer only renders its verdict
- [ ] Renderer surfaces use real state (store `lastError` wired into New Thread via existing banner; no silent `.then()` clears)
- [ ] Error and pending/failure states handled for every new async control (model switch, Start, rename)
- [ ] Every new/changed theme token defined in BOTH `:root` and `:root.dark`; contrast verified against the surfaces the token is actually used on (not only `--main`)
- [ ] Global pi patch script idempotent, signature-guarded per branch, and verified by live RPC repro with outbound-ID capture
- [ ] End-to-end verified on the real Electron surface (Playwright, `PI_GUI_BRAND=alpi`, isolated user-data dirs) per repo rule
- [ ] Each phase committed separately and pushed to `upaayan`

---

## Phase 1 — Bug & trust (P0)

### 1.1 Human error language at the single funnel
**Now:** `withError`/`withErrorHandling` are declared in `app-store-internals.ts:43-44` and **implemented in `app-store.ts:1906-1930`**; the raw `Error.message` is written into two sinks (`sessionErrorsBySession` at `:1913`, `state.lastError` at `:1917`) and shown verbatim by the composer banner (`composer-surface.tsx:217-221`), timeline error rows (`app-store-timeline.ts:196-207`), and failure notifications.
**Target:** new module `apps/desktop/electron/user-facing-errors.ts` exporting `describeError(raw: string): { headline: string; detail?: string }`, applied ONCE inside the `app-store.ts` implementations before both sinks, and at the `runFailed` timeline/notification text production.
**Error contract across the boundary (decision):** `DesktopAppState.lastError` **stays `string`** and carries the *headline*; new optional `DesktopAppState.lastErrorDetail?: string` carries the raw text. Consumers: `ComposerSurface` and New-Thread banner render headline + small `detail` line; provider-dialog return values (`App.tsx:1811-1829`) are **headline-only** (string contract unchanged); timeline error rows use headline as label and raw text in the existing `detail` slot (today bound to `error.code` — extended). `sessionErrorsBySession` stores the headline (its consumers are banners).
**Mapped cases (initial table, extendable):**
| Raw pattern | Headline |
|---|---|
| `Duplicate value for 'tool_call_id'` | "This thread's grok tool history can't replay on {provider}. Switch back to the original model, or use an Anthropic/Codex model." |
| `exceeds the available context size` | "This thread is too long for {model} ({need} vs {limit} tokens). Pick a larger-context model or start a new thread." |
| `OAuth refresh failed for {p}` / `No API key for provider: {p}` | "{p} login has expired or is not connected. Reconnect in Settings → Providers to use its models." |
| `RPC session is already running; re-entrant…` | "Alamelu Pi is still finishing the previous message — try again in a moment." |
| `RPC steering and follow-up messages require a running session` | "That message just missed the run — it was kept as your draft. Send it again." |
| `RPC session is not open: …` | "This thread's engine isn't running. Reopen the thread and retry." |
| `RPC transport closed…` / `RPC stdout ended` | "The pi engine for this thread stopped. Your next message restarts it." |
| `Worktree threads are not supported…` | "Worktree mode isn't available in this build — thread not created; your prompt is kept." |
| `Replacement Pi RPC … mismatch` | "Thread engine restart hit a mismatch. Retry; if it repeats, reopen the thread." |
| *(fallback)* | "Something failed: {first 120 chars}" + full raw in detail |
**Interpolation** ({need}/{limit}/{provider}) parsed from the raw string where present; omitted gracefully otherwise. **Unit tests:** table-driven over every row + fallback + interpolation-missing cases.

### 1.2 Model-switch preflight
**Now:** any of 585 models selectable for any thread; guaranteed failures surface only after the next prompt. The model registry currently **discards the context column**: `parsePiListModels` reads `parts[0],[1],[4],[5]` and drops `parts[2]` (`external-pi-model-parser.ts:15-31`); `RuntimeModelRecord` has no context field (`packages/session-driver/src/runtime-types.ts:27-36`).
**Target:**
- **Metadata plumbing (prerequisite for rules a AND b — single typed source, no text parsing):** the model *inventory list* keeps coming from `pi --list-models` as today; per-model *metadata* (`contextWindow?: number`, `api?: string`) is sourced from pi's in-process `ModelRuntime`, loaded exactly the way `external-pi-auth-bridge.ts:165-181` already does (`ModelRuntime.create({ authPath, modelsPath, allowModelNetwork: false })`). **Accessor: `getModel(providerId, modelId)` per inventory row** — verified present on the modern runtime (`pi-coding-agent/dist/core/model-runtime.js:186-205`); implementation should reuse the runtime instance the auth bridge already creates rather than loading a second one; there is NO `getAll()` on it (that name is this repo's *legacy* interface, `external-pi-auth-bridge.ts:57-59`). `getModel` is probed with a `typeof === "function"` check and **must NOT be added to the required-method list in `asModernModelRuntime` (`external-pi-auth-bridge.ts:325-328`)** — a pi build lacking it must degrade metadata to `undefined`, not break provider auth. pi's `Model` type carries both fields (`pi-ai/dist/types.d.ts:602-621`). Merged by `(provider, modelId)` into optional fields on `RuntimeModelRecord` (`packages/session-driver/src/runtime-types.ts:27-36`), threaded through the snapshot. Load failure / missing accessor / per-row miss → fields `undefined` → rules (a)/(b) degrade to no-block — stated, not silent. `parsePiListModels` untouched. **Positive wiring assertion (mandatory in verification):** after plumbing, assert `xai/grok-4.5` resolves to `api: "openai-responses"`, `contextWindow: 500000` (verified against installed `xai.models.js`) and paste the output — so "registry unavailable" can never masquerade as a passing implementation. Unit rows: merge hit, merge miss, registry unavailable, accessor missing.
- **Session-dir plumbing (prerequisite for thread stats):** `DesktopAppStore` receives `sessionDir` explicitly from the same resolved config main already computes (`rpc-driver-config.ts` → `main.ts:823` today passes it only to the driver). Thread stats reader reuses the driver's file-location shape: suffix match `_<sessionId>.jsonl` + realpath containment (`packages/pi-rpc-driver/src/pi-rpc-driver.ts:572-580, 613-620`). Playwright's isolated dirs then work automatically; the production path is never hardcoded.
- **Decision function:** pure `evaluateModelSwitch(threadStats, targetModel, piPatchApplied): { verdict: "ok"|"warn"|"block"; reason?: string }` in `apps/desktop/electron/model-switch-preflight.ts`, called in the `setSessionModel` path of `app-store-composer.ts` after `ensureSessionReady`, before `driver.setSessionModel`.
- **Inputs:** `threadStats` = `{ estTokens (bytes/4 heuristic, documented), hasCollidingToolCallIds: boolean, historyAuthor: {provider, modelId} }` — the detector computes, for every pipe-composite toolCall id in the history, its **old-algorithm sanitized form** (`callId.replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,40)`) and sets `hasCollidingToolCallIds` when any two forms are equal. This tests the actual collision, so the unit table can assert a true negative (parallel calls whose sanitized forms stay distinct → ok). `targetModel` = enriched registry record (`contextWindow`, `api`); `piPatchApplied` = 1.6 marker check (path resolved as in 1.6).
- **Rules:**
  (a) `contextWindow` known AND `estTokens > 0.9 × contextWindow` → **block** with the 1.1 context headline. Unknown context window → never block on size.
  (b) `hasCollidingToolCallIds` AND target is NOT the same provider+model as `historyAuthor` (same-model switches never normalize — `transform-messages` gates on `!isSameModel`) AND `targetModel.api === "openai-completions"` (from the enriched registry — real field, see metadata plumbing) → **block** with the grok headline; **downgrade to warn** when `piPatchApplied`. Note: grok-4.5 itself is `api: "openai-responses"` (pi `xai.models.js`), so the switch-back recovery is never blocked by this rule. `api` undefined (registry unavailable) → no block — rule 1.1 still catches a residual failure.
  (c) target provider not connected per auth-bridge inventory → **block** with the connect headline. **Limitation stated:** inventory `hasAuth` = `authStatus.configured` (`external-pi-runtime-supervisor.ts:267-278`) — *credential exists*, not *credential works*. Connected-but-expired (codex between re-auths, anthropic permanently per owner ruling) **passes preflight by design** and is surfaced kindly by 1.1 after the fact.
  (d) otherwise ok.
- **Renderer:** blocked switch keeps the current model and shows the headline via the standard banner; `warn` shows the banner and proceeds. No new dialog surface.
- **Unit tests:** table-driven: each rule, boundary 0.9×, unknown context window, unknown api family, same-model exemption, connected-but-expired → ok, malformed JSONL lines skipped, patch-marker present → warn.

### 1.3 Dropdown placement fix
**Now:** `new-thread-view.tsx:293` hardcodes `dropdownPlacement="below"`; with the composer at the window bottom the menu clips off-screen (screenshot evidence). This is the ONLY consumer of the prop.
**Target:** remove the override so the default `"above"` applies; **delete the now-dead `dropdownPlacement` prop plumbing (`model-selector.tsx:16, 33, 108, 168`) and `.model-selector__dropdown--below` CSS (`styles/main.css:1362-1367`) in the same commit** (fork-local; nothing else uses them). Playwright assertion: open dropdown's bounding box fully inside the viewport in the new-thread view.

### 1.4 New Thread failure surfacing + capability plumbing
**Now (corrected wiring-level statement):** `NewThreadView` *does* render a `lastError` prop via the shared banner (`new-thread-view.tsx:24, 70, 169` → `composer-surface.tsx:217-221`), but `App.tsx:2323` feeds it renderer-local `newThreadComposerError` (set only for `/tree` parse errors at `App.tsx:1962, 1966`) — store failures never reach it. `App.tsx:1984-1991` clears prompt/model/environment in an unconditional `.then()`. Worktree toggle is enabled yet `startThread` always rejects it under RPC (`app-store-worktree.ts:84-86`) via resolved `withError` state.
**Target:** (a) capability flags at the desktop-driver layer: extend `DesktopSessionDriver` (`desktop-driver.ts:25`) with `supportsTree/supportsCompact/supportsQueueEditing`; `RpcDesktopDriver` sets all four; snapshot exposes them. **Semantics: `undefined` ⇒ supported** (non-RPC/worktree specs unaffected), `false` ⇒ disable/hide. (b) `App.tsx` clears any stale `lastError` before `startThread`, then feeds the *store's* mapped `lastError` into the existing NewThreadView banner (single banner, no second surface) — shown only when produced by this action (compare before/after or gate on the New-Thread surface being active). (c) prompt/selections cleared only when the post-action state shows success (no `lastError` from this action AND selected session changed). (d) Worktree chip disabled with caption "Not available in this build" when `capabilities.worktrees === false`. (e) Start button busy state + double-click guard.
**Playwright:** worktree attempt → message visible, prompt preserved, no thread created; double-click Start → exactly one thread.

### 1.5 Cancel is not a failure
**Now:** `cancelCurrentRun` → `failRun(record, runId, "Run cancelled")` (`pi-rpc-driver.ts:236`) → `runFailed` → error-toned timeline row (`app-store-timeline.ts:196-207` sets `tone:"error"` + `clearRunState`), `lastError` re-set after cleanup (`app-store.ts:1414-1418` vs `app-store-composer.ts:446-457`), stale `sessionErrorsBySession`.
**Target:** new `runCancelled` event in the driver used for **user-initiated aborts**; emission preserves `failRun`'s full side-effect set and ordering (`suppressRunEvents`, `delete cancellingRunId`, `delete pendingAssistantError`, `lunaChildNeedsRotation`, and `sessionUpdated` emitted BEFORE the terminal event — `pi-rpc-driver.ts:536-546`).
**Branch decisions:** abort-*command*-failure (`pi-rpc-driver.ts:237-242`) **stays `runFailed`** (the abort itself failed — a real error). Stream-failure arriving while `cancellingRunId` is set (`:491-495`) **becomes `runCancelled`** (user intent). Regression assertions: **only `packages/pi-rpc-driver/test/rpc-client.test.mjs:553` changes** (asserts `runFailed` + "Run cancelled" today → asserts `runCancelled`); `:588-590` asserts the abort-command-failure path ("abort failed") which stays `runFailed` — **unchanged by design**.
**Main/renderer call sites (complete list):** `app-store.ts:1414-1418` (no `lastError` for cancelled), `:1449-1453` (`sessionErrorsBySession` cleared, not set — else `resolveSelectedSessionError` at `:2204-2220` re-renders stale error), `:1479` (`persistUiState` still runs on run end), `app-store-timeline.ts:196-207` (cancelled path reuses `clearRunState`/run-metrics/`runningSince` teardown but renders a neutral muted "Stopped by you" row, not `tone:"error"`), `app-store-session-state.ts:83-96` (`statusForEvent` maps `runCancelled` → idle), notification-manager (no failure notification for cancelled; its unknown-event default already ignores — verified `notification-manager.ts:142-145`). Event-mapper untouched (driver-internal event). Luna benign-failure suppression untouched.

### 1.6 Global pi-ai truncation patch (the actual 400 fix)
**Now (verified against installed source `…/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:697-710`):** `normalizeToolCallId` has TWO truncation sites:
- L705 composite branch: `if (id.includes("|")) { const [callId] = id.split("|"); return callId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40); }`
- L708 openai-gated branch: `if (model.provider === "openai") return id.length > 40 ? id.slice(0, 40) : id;`
The July 24 failing session **proves L705 fires in production**: stored grok ids are pipe-composites (`call-<uuid>-0|fc_…`) and the deepseek 400 quotes exactly the sanitize-then-slice-40 output.
**Target:** `apps/desktop/scripts/patch-global-pi-ai.mjs`:
- **Resolution:** resolve the installed pi cli real path, then the *nested* pi-ai (`<pi-coding-agent>/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js`) — reuse the resolution shape already proven in `external-pi-auth-bridge.ts:151-162` (`createRequire` against the resolved pi entry).
- **Per-branch signature guards:** the script embeds the **verbatim byte-for-byte current source blocks** (copied from the installed file at implementation time — the real L705 region is a multi-line block with an interleaved comment; the snippets quoted in this plan are illustrative renderings, NOT the guard strings); literal match, no loose regex; refuse with a clear message on drift.
- **Replacement L705 (sanitization preserved):** `const sanitized = callId.replace(/[^a-zA-Z0-9_-]/g, "_"); return sanitized.length > 40 ? sanitized.slice(0, 31) + "_" + djb2hex8(sanitized) : sanitized;`
- **Replacement L708 (same collision-proof form):** `return id.length > 40 ? id.slice(0, 31) + "_" + djb2hex8(id) : id;`
- `djb2hex8` inlined into the patched file (pure, 8 hex chars); pairing preserved because assistant `tool_calls` and `tool` results flow through the same normalization map.
- Idempotent via marker `/* alpi-patch:toolcallid-v1 */`; `--check` mode reports patched/unpatched/drifted; re-run after every `pi update`.
**Verification (before the critic round):** scratch RPC harness run twice — pre-patch: grok-4.5 turn with parallel tool calls → switch to `deepseek/deepseek-v4-flash` → prompt → expect the duplicate-id 400 **and capture the outbound normalized ids implied by history** (harness computes the normalization mapping of the stored ids under both old and new algorithms and prints them); post-patch: same flow → expect success and distinct ≤40-char ids. Both outputs pasted verbatim into the implementation doc. Cost: a few small grok/deepseek calls (owner's existing auth).
**Documented risk:** patch reverts on `pi update`; preflight rule (b) detects the missing marker and re-blocks **when registry metadata is available (see 1.2 — with metadata undefined, rule (b) is inert and only the 1.1 headline catches the failure after the fact)**; re-apply command recorded in `documents/`.

**Phase 1 commit boundaries:** 1.1+1.2+1.4 (shared plumbing), 1.3, 1.5, 1.6 — four commits.

---

## Phase 2 — First-minute polish (icon EXCLUDED)

2.1 **Brand strings (decision — cheaper option chosen):** the renderer has NO brand signal today (zero `brand` matches under `apps/desktop/src`; `appBrand` is main-only) and NO test asserts the current strings. Therefore: rename the two renderer-visible strings **unconditionally** — `index.html:6` title → "Alamelu Pi", boot-screen eyebrow (`App.tsx:1479`) → "Alamelu Pi" — this fork ships only the alpi brand. Gate ONLY the main-process dialog titles (`main.ts:592, 606`) via the existing `appBrand`. The "keep upstream value under non-alpi brand" risk line is explicitly waived for these two renderer strings (no brand plumbing built). Verify `disableUpdateChecks: true` fully covers the alpi brand; if any updater path bypasses it, gate that path.
2.2 **Focus visibility:** global `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }` in `base.css` + focus parity (same style as `--active`) for slash/mention/model/workspace menu items. No `:focus` (mouse) outlines. Menus keep roving active-state; parity styles, not double rings.
2.3 **Dark-theme holes:** tokenize `.shortcut-tooltip` (+kbd) and `.sidebar-toggle__button`; add `:root.dark` values; `BrowserWindow` `backgroundColor` from `themeManager.getResolvedTheme()` before window creation (module-scope instance exists at `main.ts:56`; window at `:1195`).
2.4 **Muted contrast:** raise `--muted-soft`/`--muted-subtle` (both themes) to ≥4.5:1 **against every surface they sit on** — `--main`, `--sidebar`, `--surface` (usages incl. `styles/sidebar.css:366, 373, 391`) — plus accessible diff-stat green/red. Contrast computed by script over the actual (token, surface) pairs; output pasted.
2.5 **Dead styling:** define `.button--secondary` (8 consumer components); `--font-sans` → `--font-ui` (`main.css:169`); define `--warning` (both themes).
2.6 **Transcript markdown CSS:** `.message__content` table/th/td (bordered, `--line`, muted header), `img { max-width:100%; border-radius }`, explicit h1–h4 sizes/margins preserving the 9px rhythm. Both themes.
2.7 **Copy button on prose code blocks:** hover-reveal on `.message__content pre`, reusing the timeline copy-button pattern; `data-language` label already emitted.

**Verification:** build + unit + named branded Playwright specs + sandbox screenshot tour re-run (before/after shots) + contrast script output. **Commits:** 2.1; 2.2–2.5 ("theme & interaction hygiene"); 2.6–2.7 ("transcript polish").

---

## Phase 3 — Product depth

3.1 **Follow-up visibility:** optimistic append of followUp text (as steer already does at `app-store-composer.ts:348-355`) so typed follow-ups never vanish; reconcile on next run events; rollback on send failure (pattern exists).
3.2 **Capability-gate slash commands:** `/tree`, `/compact` hidden from the catalog when `capabilities.tree/compact === false`; `runComposerCommand` moved inside the error-handled path (today outside — `app-store-composer.ts:288` vs try at `:299`) so residual failures reach the banner.
3.3 **Pending states:** model badge in-flight state (disabled + subtle spinner) during `setSessionModel` (covers Luna rotation dead air); rename pending until confirm (no optimistic close-then-revert).
3.4 **Skills/Extensions honesty:** Enable/Disable toggles disabled with caption "Managed by pi CLI in this build" when unsupported (supervisor rejects at `external-pi-runtime-supervisor.ts:120-126`); `SecondarySurface` gets an error slot rendering the mapped `lastError`.
3.5 **Model clarity:** badge shows the friendly option label with provider prefix styling. **Spec updates named:** `tests/core/new-thread-composer.spec.ts:297` (`toHaveText("openai:gpt-4o")`) updated to the new label AND that test gains the `PI_GUI_BRAND: "alpi"` envOverride it currently lacks (it is unbranded today, so the changed assertion would otherwise have no runnable gate). **Caveat handled:** that test also asserts dropdown *catalog contents* ("GPT-5", "GPT-4o"), which no already-branded test in the file exercises — under the branded boot these assertions are verified against the seeded agent-dir registry and, if the branded catalog differs, adapted to the seeded models in the same edit (the badge-label assertion remains the point of the test). Sibling assertions `:280, :291, :344` ("Pick a model" / "No models available") remain valid and untouched. Per-repo scope mode shows caption "Saves to {repo}/.pi/settings.json" (write happens at `app-store.ts:567-584, 2383-2392`, undisclosed today).
3.6 **Steer/queue race:** deliver-mode resolved main-side against driver status at submit time; wrong-guess downgrades gracefully (queue→send, send→queue) instead of throwing.
3.7 **Resume fidelity (stretch, may split out):** `getTranscript` enrichment — map `toolCall` entries from the session JSONL into timeline tool rows; collapsed "thinking" indicator row. If effort balloons, defer with owner note.

**Verification:** driver suite, unit, branded Playwright (+ new specs: follow-up visible while running; `/tree` absent under RPC). **Commits:** 3.1+3.6; 3.2+3.4; 3.3+3.5; 3.7.

---

## Phase 4 — Backlog (owner picks; NOT scheduled)

Streaming indicator + `aria-live`; timeline rhythm; themed scrollbars; `prefers-reduced-motion`; Esc-to-stop + safer empty-Enter; thread-cycling shortcuts; cross-thread search; fork-hygiene sweep beyond 2.1 (README/website/localStorage key/`@alamelu-pi/*` names).

## Build order & dependencies

Phase 1 → 2 → 3. Inside Phase 1: registry+session-dir plumbing (1.2 prerequisites) before the decision function; 1.1 funnel before 1.2 messages; 1.4 capability plumbing before 3.2/3.4 reuse; 1.6 independent (may land first — highest single value). Phases independently shippable; owner can stop after any phase.

## Testing strategy (global, exact gates)

- **Real gates, every implementation round:**
  - `pnpm --filter @alamelu-pi/desktop build`
  - `node --test apps/desktop/tests/unit/*.test.mjs`
  - `pnpm --filter @alamelu-pi/pi-rpc-driver test` (baseline 52 passing)
  - **Branded-only** Playwright tests via `test:e2e:runner` with `--grep` scoping (precedent: `alpi_logo_replacement_implementation.md:69`). Baseline reality: `composer-controls.spec.ts` and `model-scope-toggle.spec.ts` contain **zero** `PI_GUI_BRAND` overrides (fully unbranded — cannot boot in this fork), and `new-thread-composer` / `provider-settings` are mixed. The gate therefore names *individual branded tests* (the four alpi-branded tests in `new-thread-composer.spec.ts`, the four in `provider-settings.spec.ts`, plus new specs written branded), never whole files. Isolated `PI_APP_USER_DATA_DIR`/`PI_CODING_AGENT_DIR` always.
- **Baseline reality (recorded once at the top of the implementation doc):** the unbranded half of `tests/core` is broken at baseline in this fork — `smoke.spec.ts:31` expects heading "Let's build" (hero renders "Alamelu Pi" since `b4edbbb`), and unbranded specs resolve to `driver: "sdk"` for which no driver is constructed (`rpc-driver-config.ts:66,130`; `main.ts:818-853`; throw at `app-store.ts:161-163` inside the swallowed catch at `main.ts:1256`). Fixing those specs is OUT of scope; they are not claimed green. Pre-change pass/fail counts of the named gates recorded before any edits.
- Live-provider checks (1.6 repro) run from the scratch harness outside the repo, tiny prompts, outputs pasted verbatim.
- Every round records `## Verification Round N` with real command output per debate-loop protocol.

## Edge cases & risks

- **Token estimate is a heuristic** (bytes/4, 0.9 factor): only blocks guaranteed-doomed switches; unknown context window or api family → never block. False-block risk accepted as lower harm than a guaranteed 400.
- **JSONL scan cost:** current files ≤ ~1 MB; per switch action (rare), sync read acceptable; missing/corrupt lines skipped.
- **Patch drift:** 1.6 refuses on signature mismatch; preflight degrades to block when registry metadata is available (otherwise rule (b) is inert and 1.1 catches the failure after the fact); nothing crashes unpatched.
- **Brand strings:** two renderer strings renamed unconditionally by explicit decision (2.1); main-process strings brand-gated; no test asserts either today.
- **Cancel compatibility:** `runCancelled` preserves `failRun` side-effect set + `sessionUpdated`-first ordering; unknown-event defaults (notifications) already ignore safely; changed regression assertions named in 1.5.
- **Focus-visible regressions:** parity styles, not double rings; no mouse-click outlines.
- **Capability semantics:** `undefined` ⇒ supported keeps non-RPC paths and existing worktree specs intact.

## Explicitly out of scope (owner rulings + report exclusions)

Icon/iconset (any change), Anthropic re-auth or API enablement, openai-codex re-auth automation, upstream issue/PR filing (owner decision), `apps/website` rebrand, worktree feature *implementation* (only honest disabling), unbranded-lane spec repairs, lab-repo cleanup.
