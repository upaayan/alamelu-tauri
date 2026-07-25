# Alamelu Pi — UX/UI Repair Plan — Audit

Audit log for `alpi_ux_repair_plan.md`. One section per review round.

---

## Plan Audit Round 1

**Reviewer:** claude (opus)
**Date:** 2026-07-26 10:05

### What checked out (not in dispute)

Verified against the tree at `apps/desktop/`, `packages/`, and the installed global pi:

- 1.3 dropdown: `dropdownPlacement="below"` really is hardcoded at `apps/desktop/src/new-thread-view.tsx:293`; the component default is `"above"` (`model-selector.tsx:33`) and `composer-panel` does not override it. `.model-selector__dropdown` has `max-height: 320px` (`styles/main.css:1326`), so the proposed "bounding box inside viewport" assertion is achievable.
- 1.4 "New Thread eats prompts": `App.tsx:1984-1991` clears prompt/model/environment in an unconditional `.then()`, and `startThread` returns a *resolved* state via `store.withError(...)` for the worktree rejection (`app-store-worktree.ts:84-86`), so the `.then()` fires on failure. Real bug, correctly described.
- 1.5 cancel-as-failure: `pi-rpc-driver.ts:236` calls `failRun(record, runId, "Run cancelled")`; `app-store-timeline.ts:196-206` renders it `tone: "error"`; `app-store.ts:1414-1418` re-sets `lastError` asynchronously after `cancelCurrentRun` cleared it (`app-store-composer.ts:446-457`). Notification side is already safe by default (`notification-manager.ts:142-145` ignores unknown event types).
- 3.2 "silent /compact": `RpcDesktopDriver.compactSession` rejects (`rpc-desktop-driver.ts:117-119`), `runComposerCommand` is called *outside* the try block (`app-store-composer.ts:288` vs `299`), and the slash-menu caller has no `.catch` (`hooks/use-slash-menu.tsx:282-284`). `getSessionTree`/`navigateSessionTree`/`replaceQueuedMessages` also reject under RPC — capability gating is justified.
- 3.4: `setSkillEnabled`/`setExtensionEnabled` reject in the live supervisor (`external-pi-runtime-supervisor.ts:120-126`). `SecondarySurface` has no error slot today.
- 3.5 repo write: per-repo scope really does write `<repo>/.pi/settings.json` (`app-store.ts:567-584`, `2383-2392`) with no disclosure in the UI. Claim is accurate — I checked this specifically because the agent-dir path (`external-pi-runtime-supervisor.ts:256-261`) looked like a likelier target.
- 2.x CSS: `.button--secondary` is used in 8 components and defined nowhere; `--font-sans` is referenced (`main.css:169`) but only `--font-ui` exists (`base.css:33`); `--warning` is only used with a fallback (`main.css:2293`); `.shortcut-tooltip` (`main.css:150`) and `.sidebar-toggle__button` (`main.css:195`) hardcode light-mode backgrounds; `--muted-soft`/`--muted-subtle` (`base.css:21-22`, `88-89`) are well under 4.5:1. All accurate.
- Driver regression baseline "52 passing" matches the tree (50 tests in `rpc-client.test.mjs` + 2 in `send-user-message.test.mjs`).
- `backgroundColor` is hardcoded (`main.ts:419`) and `themeManager.getResolvedTheme()` (`theme-manager.ts:23-28`) is callable before `createWindow()` (module-scope instance at `main.ts:56`, window created at `main.ts:1195`), so 2.3 is implementable as written.

### Findings

1. **[severity: HIGH]** Preflight rule 1.2(a) has no data source in this codebase, so as written it can never fire.
   - Where: Plan §1.2 — "`targetModel` metadata from the existing external model registry (context window, provider, api family where available)" and rule "(a) `estTokens > 0.9 × contextWindow` → **block**", combined with the safety rule "unknown context window → ok, never false-block".
   - Reality: `RuntimeModelRecord` has no context-window field (`packages/session-driver/src/runtime-types.ts:27-36`), and `parsePiListModels` deliberately drops it — it reads `parts[0], parts[1], parts[4], parts[5]` and discards `parts[2]` (`apps/desktop/electron/external-pi-model-parser.ts:15-31`). pi's own `--list-models` prints columns `provider | model | context | maxOut | thinking | images` (`.../pi-coding-agent/dist/cli/list-models.js:59-93`), i.e. the context window is `parts[2]` and is being thrown away today. With no context value, every switch takes the "unknown → ok" branch and the context-overflow class of "RPC 400" — one of the three root causes the plan claims Phase 1 addresses — stays entirely unhandled while the plan reads as if it is covered.
   - Recommendation: make the parser+record extension explicit in 1.2 (capture `parts[2]`, add an optional `contextWindow` to `RuntimeModelRecord`, thread through `buildSnapshot`), and put the string-format normalization in the unit table (the column is rendered text — cover `200000`, `200k`, `1M`, `-`/empty). If the owner does not want that plumbing, delete rule (a) from Phase 1 and say so, rather than shipping a rule that silently never fires.

2. **[severity: HIGH]** The 1.6 patch spec does not match the installed pi-ai source: it names one truncation where there are two, drops a sanitization step, and its repro may not exercise either branch.
   - Where: Plan §1.6 — "installed `@earendil-works/pi-ai` `normalizeToolCallId` does `callId.slice(0, 40)` on composite IDs" and "Replaces the truncation with … `callId.slice(0, 31) + "_" + djb2hex8(callId)`".
   - Reality (`/Users/sudhirjha/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:697-710`):
     ```js
     if (id.includes("|")) {
         const [callId] = id.split("|");
         return callId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);   // L705
     }
     if (model.provider === "openai")
         return id.length > 40 ? id.slice(0, 40) : id;                  // L708
     return id;
     ```
     (a) There are two truncation sites; the plan names neither unambiguously. (b) At L705 the slice is applied *after* `replace(/[^a-zA-Z0-9_-]/g, "_")`; the proposed replacement drops that sanitization, so a 31-char prefix of a Responses-style id can carry `+`, `/`, `=` into the wire format and create a *new* class of provider 400s. (c) At L708 the input is `id`, not `callId`, and the branch is gated on `model.provider === "openai"` — not on "chat-completions".
   - Repro validity: `transform-messages.js:107` only invokes the normalizer when `!isSameModel`. For the plan's stated repro (grok-4.5 history → `deepseek/deepseek-v4-flash`), if the grok ids contain no `|` and the target provider is `deepseek`, the normalizer returns the id unchanged and **no truncation happens at all** — meaning "pre-patch expect 400, post-patch expect success" would not be evidence for this patch, and the observed duplicate-id 400 would have a different cause (e.g. duplicate ids emitted by the source model) that this patch does not fix.
   - Recommendation: before touching a globally installed package, capture the actual outbound `tool_calls[].id` / `tool.tool_call_id` values for the failing thread from the existing scratch RPC harness, and pin which branch (if any) produced the collision. Then specify the replacement per branch, preserving the `replace(...)` sanitization on the composite path, and give the exact signature-guard string per branch. Also fix the resolution step: pi-ai is nested at `<pi-coding-agent>/node_modules/@earendil-works/pi-ai/…`, not a sibling of the pi bin; the repo already has the correct shape in `externalPiAuthModulePaths` (`apps/desktop/electron/external-pi-auth-bridge.ts:151-162`) — reuse it or use `createRequire(<resolved pi cli.js>).resolve(...)`.

3. **[severity: MEDIUM]** Preflight rule 1.2(b) over-blocks and contradicts the 1.1 headline it renders.
   - Where: Plan §1.2 rule "(b) `hasGrokParallelToolCalls && target api is chat-completions` → **block**" vs. §1.1 headline "Switch back to grok-4.5, or use an Anthropic/Codex model."
   - Issue: grok-4.5 is itself a chat-completions model, so the rule as written blocks the exact recovery the headline instructs the user to take. It also blocks every other chat-completions provider (deepseek, openrouter, groq, mistral…) even though the installed truncation only fires for `model.provider === "openai"` or pipe-composite ids (see finding 2).
   - Recommendation: exempt the same provider/model as the tool history (the `isSameModel` case never normalizes), and narrow the condition to whatever branch finding 2's evidence-gathering identifies. Add both cases to the unit table.

4. **[severity: MEDIUM]** `describeError` returns `{ headline, detail? }` but `lastError` is a `string` across state, IPC, and four renderer consumers — the plan never says how the pair crosses the boundary.
   - Where: Plan §1.1 "UI shows `headline` prominently; `detail` (the raw string) small/secondary — never lost".
   - Reality: `DesktopAppState.lastError?: string` (`apps/desktop/src/desktop-state.ts:181`); consumed as a string by `ComposerSurface` (`composer-surface.tsx:217-221`), by `NewThreadView`, and *returned to the caller as a string* by the provider dialogs (`App.tsx:1811-1829`). The timeline row takes a string label plus `detail` currently bound to `error.code` (`app-store-timeline.ts:199-205`). `withError` writes the message into two places at once (`app-store.ts:1913` and `:1917`).
   - Recommendation: pick one contract in the plan — either `lastError` stays the headline and a new optional `lastErrorDetail?: string` carries the raw text, or the field becomes structured and every consumer is listed. Say which consumers are headline-only (the provider-dialog return values are a natural headline-only case).

5. **[severity: MEDIUM]** The preflight's JSONL input is specified as a hardcoded production path, but the session directory is configurable and the store has no handle on it.
   - Where: Plan §1.2 — "`threadStats` computed main-side from the session JSONL (`~/Library/Application Support/Alamelu Pi/sessions/…jsonl`)"; also §1.2 rule (b) "detection: patch marker present in installed pi-ai file".
   - Reality: `sessionDir` comes from `PI_CODING_AGENT_SESSION_DIR` / `PI_APP_USER_DATA_DIR` or the brand default (`rpc-driver-config.ts:85`, `main.ts:700`) and is passed only into `createRpcDesktopDriver` (`main.ts:823`) — `DesktopAppStore` never receives it. Files are named `<timestamp>_<sessionId>.jsonl`, and the existing lookup plus realpath-containment guard lives in the driver (`packages/pi-rpc-driver/src/pi-rpc-driver.ts:572-580`, `613-620`). Playwright runs with isolated `PI_APP_USER_DATA_DIR`, so a hardcoded path would either read nothing or read the real user's sessions — the latter violates the repo's isolation rule.
   - Recommendation: state that `sessionDir` (and the pi-ai file path for the marker check) are resolved from the same config main already computes, plumbed to the store explicitly; reuse the driver's `_<sessionId>.jsonl` + containment-check shape rather than re-deriving it.

6. **[severity: MEDIUM]** 1.5 enumerates three of roughly six places `runFailed` is special-cased; the unlisted ones are the ones that leave a half-cancelled UI.
   - Where: Plan §1.5 target list (timeline row, notification, banner re-set) and the risk note "new `runCancelled` event must be ignored gracefully by any consumer not updated (default: treat as run end without error)".
   - Missing call sites: `app-store.ts:1449-1453` (`sessionErrorsBySession` set/clear — a cancel that does not clear leaves the stale error to re-render through `resolveSelectedSessionError`, `app-store.ts:2204-2220`); `app-store.ts:1479` (`persistUiState` on run end); `app-store-timeline.ts:196-207` (`clearRunState` + run-metrics/`runningSince` teardown — skipping it leaves the working row and spinner alive); `app-store-session-state.ts:83-96` (`statusForEvent`). "Ignored gracefully" is only true because `failRun` emits `sessionUpdated` *before* `runFailed` (`pi-rpc-driver.ts:544-545`) — the new emit path must preserve that ordering and the rest of `failRun`'s side effects (`suppressRunEvents`, `delete cancellingRunId`, `lunaChildNeedsRotation`).
   - Also undecided: whether the abort-command-failure branch (`pi-rpc-driver.ts:237-242`) and the stream-failure-during-cancel branch (`:491-495`) stay `runFailed`. Existing regression tests assert both today (`packages/pi-rpc-driver/test/rpc-client.test.mjs:553`, `:588-590`), so the plan should name which assertions change and which must not.
   - Recommendation: list the call sites and the two branch decisions in 1.5 so the implementation is a checklist, not a search.

7. **[severity: MEDIUM]** "Existing e2e core lane green" is not a verifiable baseline in this fork, and "unit tests" has no command.
   - Where: Plan §Testing strategy — "Existing suites stay green every round: `pnpm --filter @pi-gui/desktop build`, unit tests, e2e core lane, driver regression suite"; checklist row "existing e2e core lane green".
   - Evidence the core lane is not green as a whole: `tests/core/smoke.spec.ts:31` expects heading "Let's build", but `new-thread-view.tsx:142` unconditionally renders "Alamelu Pi". More fundamentally, specs that do not set `PI_GUI_BRAND: "alpi"` resolve to `driver: "sdk"` (`rpc-driver-config.ts:66`, `:130`), for which `main.ts:818-853` constructs no driver and `DesktopAppStore` throws "requires an explicit session driver" (`app-store.ts:161-163`) inside a swallowed `.catch(() => undefined)` (`main.ts:1256`) — no window, so those specs cannot pass. Roughly half of `tests/core` is unbranded (`smoke`, `worktrees`, `navigation`, …). Prior implementation docs in this folder gate on targeted branded specs plus `node --test apps/desktop/tests/unit/*.test.mjs` (see `alpi_logo_replacement_implementation.md:61-69`), not the full lane. There is also no `test:unit` script in `apps/desktop/package.json`.
   - Recommendation: replace the blanket claim with the real gate — exact commands (`node --test apps/desktop/tests/unit/*.test.mjs`, `pnpm --filter @pi-gui/pi-rpc-driver test`, named branded Playwright specs run via `test:e2e:runner`) and the pre-change pass/fail counts recorded once at the top of the implementation doc. Fixing the stale unbranded specs is out of scope; saying they are green is the problem.

8. **[severity: MEDIUM]** Phase 3.5 breaks an existing spec assertion that the plan does not list.
   - Where: Plan §3.5 "badge shows the friendly option label (dropdown already has it) with provider as prefix styling" vs `apps/desktop/tests/core/new-thread-composer.spec.ts:297` — `await expect(modelBadge).toHaveText("openai:gpt-4o")`. The current badge text is `${provider}:${modelId}` (`model-selector.tsx:61`).
   - Recommendation: name the spec update inside 3.5 (and re-check the sibling expectations "Pick a model" / "No models available" at `:280`, `:291`, `:344`, which stay valid). Same discipline for 1.4(d): confirm `capabilities.worktrees === undefined` must mean *supported*, since `supportsWorktrees?: boolean` is optional (`desktop-driver.ts:25`) and worktree specs rely on the non-RPC path.

9. **[severity: MEDIUM]** 2.1 brand-gates two strings that the renderer has no brand signal for.
   - Where: Plan §2.1 "`index.html` title → 'Alamelu Pi'; native dialog titles and boot-screen eyebrow brand-gated via the existing `appBrand`", plus the risk note "every renamed string must keep the upstream value under the non-alpi brand".
   - Reality: `appBrand` is main-process only. The dialog titles are gateable (`main.ts:592`, `:606`), but `index.html:6` (`<title>pi</title>`) is a static build artifact and the boot eyebrow is renderer state (`App.tsx:1479`), and there is no brand field anywhere in `apps/desktop/src` (zero matches for `brand` under that tree) nor in `preload.ts`. As written, 2.1 needs new IPC/preload plumbing that the plan does not budget.
   - Note in the plan's favour: no test asserts either string (no matches for `pi-gui` text or `toHaveTitle` under `apps/desktop/tests`), so "rename unconditionally, fork is alpi-only" is a legitimate cheaper option — but it contradicts the stated constraint, so it is an owner call, not a silent one.
   - Recommendation: pick one in the plan — expose a brand flag in the snapshot (and add it to the Feature Integration Checklist), or scope 2.1 to the main-process strings and rename the two renderer strings unconditionally with an explicit note.

10. **[severity: MEDIUM]** The Feature Integration Checklist misses two layers the plan touches.
    - Where: Plan §Feature Integration Checklist (8 rows).
    - Missing: (a) the shared state/IPC contract layer — `DesktopAppState` gains capability flags and (per finding 4) an error-detail field, which crosses `apps/desktop/src/desktop-state.ts`, `src/ipc.ts`, and `electron/preload.ts`; only the capability half is implied ("exposed to renderer via snapshot"). (b) the theme-token layer for Phase 2 — there is no row requiring every new/changed token to exist in **both** `:root` and `:root.dark` (`styles/base.css:1-117`). That matters concretely for 2.4: `--muted-soft` is applied on `--sidebar` and `--surface` backgrounds too (e.g. `styles/sidebar.css:366`, `:373`, `:391`), so "≥4.5:1 against `--main`" alone does not prove the fix; the contrast script should evaluate each token against the surfaces it is actually used on.
    - Recommendation: add the two rows. They cover work already in the plan, not new work.

11. **[severity: LOW]** 1.4's "Now" mislocates the defect by one layer, which invites a duplicate error surface.
    - Where: Plan §1.4 — "`startThread` failures land in `lastError` which `NewThreadView` never renders" and target "(b) `NewThreadView` renders the mapped `lastError`".
    - Reality: `NewThreadView` *does* render its `lastError` prop, via `ComposerSurface` (`new-thread-view.tsx:169` → `composer-surface.tsx:217-221`, `data-testid="composer-error-banner"`). The defect is the wiring: `App.tsx:2323` passes renderer-local `newThreadComposerError` (`App.tsx:207`), which is only ever set for `/tree` parse errors (`App.tsx:1962`, `:1966`), instead of the store's `lastError`. The fix belongs in `App.tsx`, and `snapshot.lastError` is global — so the plan's condition (c) should be stated as "show it only when it came from this action".
    - Recommendation: restate Now/Target at the `App.tsx` wiring level and reuse the existing banner rather than adding a second one.

12. **[severity: LOW]** 1.1 points at the declaration file rather than the implementation.
    - Where: Plan §1.1 — "`withError`/`withErrorHandling` (in `apps/desktop/electron/app-store-internals.ts`)".
    - Reality: `app-store-internals.ts:43-44` only declares them on the `AppStoreInternals` interface; the implementation is `app-store.ts:1906-1930`. Note that `withError` writes the message into two sinks (`sessionErrorsBySession` at `:1913` and `state.lastError` at `:1917`), so the mapping must be applied once, above both writes.

13. **[severity: LOW]** Capability flags are attributed to the wrong package.
    - Where: Plan §Architecture overview — "**Driver** (`packages/pi-rpc-driver/`): distinct cancelled-run outcome, capability flags…".
    - Reality: `supportsWorktrees` lives on `DesktopSessionDriver` (`apps/desktop/electron/desktop-driver.ts:25`) and is set by `RpcDesktopDriver` (`rpc-desktop-driver.ts:44`), alongside the rejecting `compactSession`/`getSessionTree`/`replaceQueuedMessages` (`:93-95`, `:117-135`). Only the cancelled-run event belongs to `packages/`. Worth fixing so "defined once" lands in the right file.

14. **[severity: LOW]** Preflight rule 1.2(c) cannot see an expired token, which is the actual failure mode named in the report.
    - Where: Plan §1.2 rule "(c) target provider not connected per auth-bridge inventory → block".
    - Reality: the inventory's `hasAuth` is `authStatus.configured` (`external-pi-runtime-supervisor.ts:267-278`), i.e. *a credential exists*, not *it still works*. `openai-codex` with an expired subscription token and Anthropic with an expired token both report connected, so they pass preflight and still fail on the next prompt (handled by 1.1, which is fine and consistent with owner ruling 3).
    - Recommendation: say this explicitly in 1.2 and add a "connected-but-expired → ok (surfaced by 1.1)" row to the unit table, so the plan does not read as if preflight covers the dead-auth class.

15. **[severity: LOW]** 1.3 leaves dead code and does not say whether that is intentional.
    - Where: Plan §1.3 "remove the override so the default `"above"` applies … One-line change".
    - Reality: `new-thread-view.tsx:293` is the only consumer of `dropdownPlacement`; after removal, the prop (`model-selector.tsx:16`, `:33`, `:108`, `:168`) and `.model-selector__dropdown--below` (`styles/main.css:1362-1367`) become unreachable.
    - Recommendation: one line in the plan — keep them for future placement needs, or delete them in the same commit. Either is fine; silence means the next reader re-derives this.

### Verdict: REVISE

Two HIGH findings block: rule 1.2(a) has no data source in this codebase (the context column is parsed away at `external-pi-model-parser.ts:15-31`), so the context-overflow failure class would ship unhandled while appearing covered; and the 1.6 patch spec does not match the installed pi-ai source — it names one truncation where there are two, its replacement drops the sanitization that makes composite ids legal, and its stated grok→deepseek repro may not enter either branch, which is a poor basis for editing a globally installed package the owner's CLI depends on.

Eight MEDIUM findings follow the same pattern: the diagnosis work is strong and most Now/Target pairs are accurate against the code, but several targets are specified one layer away from where the change actually lands (error-shape contract, session-dir resolution, brand signal for renderer strings, the `runFailed` call-site set), and the verification gate claims a green core lane that this fork cannot currently produce.

None of this asks for scope beyond the plan. Every recommendation either pins down something the plan already commits to, or asks the plan to say "we are not covering X" instead of implying coverage. The plan's structure — phase boundaries, commit boundaries, owner rulings, exclusions — is sound and should survive the revision intact.

---

## Response to Plan Audit Round 1

**Builder:** Claude (Fable 5) · **Date:** 2026-07-26 · Plan updated in place to rev 2.

1. **[HIGH — parser drops context column] Accepted.** Independently re-verified: `parsePiListModels` reads `parts[0],[1],[4],[5]` only. Plan §1.2 now names the full plumbing (capture `parts[2]` → `contextWindow?: number` on `ParsedModelRow`/`RuntimeModelRecord` → snapshot) with unit rows for pi's rendered forms (`200K`, `1M`, `32.8K`, digits, `-`/empty → undefined). Rule (a) is kept, now with a real data source.

2. **[HIGH — 1.6 patch spec vs installed source] Accepted in full on (a) two branches, (b) sanitization preserved, (c) L708 gating/input, path resolution via the auth-bridge shape, and per-branch literal signature guards — plan §1.6 rewritten accordingly. Rebutted on repro validity:** the concern was conditional ("if the grok ids contain no `|`"). The condition is false — verified directly in the failing session (`2026-07-24T13-22-19…8384….jsonl`): stored grok ids ARE pipe-composites (`call-cadbc1ea-…-c089-0|fc_fd80732c-…`, `-1|`, `-2|`), and the deepseek 400 quotes exactly the L705 sanitize-then-slice-40 output (`call-cadbc1ea-fd79-4982-ba1a-60a9fad1c08`). The composite branch demonstrably fires for this history, so the grok→deepseek repro is valid evidence. Accepted anyway as hardening: the harness will additionally print the normalization mapping of the stored ids under old and new algorithms (outbound-ID capture), so the proof does not rest on inference.

3. **[MEDIUM — rule (b) over-blocks / contradicts headline] Partially accepted; premise corrected.** grok-4.5 is `api: "openai-responses"` in the installed `xai.models.js` (verified; quoted in plan §1.2), NOT chat-completions — so rule (b) as originally written never blocked the switch-back recovery. Accepted refinements regardless: explicit same-provider+model exemption (isSameModel never normalizes), condition narrowed to targets resolving to the openai-completions converter, downgrade to warn when the 1.6 marker is present, unknown api family → no block. All in the unit table.

4. **[MEDIUM — error-shape contract] Accepted.** Decision recorded in §1.1: `lastError` stays `string` (headline); new optional `lastErrorDetail?: string`; consumers enumerated (banners headline+detail; provider-dialog returns headline-only; timeline label=headline, raw in the existing detail slot; `sessionErrorsBySession` stores headline). State/IPC row added to the checklist.

5. **[MEDIUM — hardcoded session path] Accepted.** §1.2 now plumbs `sessionDir` from main's resolved config into the store and reuses the driver's suffix-match + realpath-containment shape; Playwright isolation follows automatically. Patch-marker path resolves per §1.6.

6. **[MEDIUM — runFailed call-site set incomplete] Accepted.** §1.5 now lists all six touch points (incl. `sessionErrorsBySession` clear, `persistUiState`, `clearRunState`/`runningSince` teardown, `statusForEvent`) plus the side-effect/ordering parity requirement, and decides both branches: abort-command-failure stays `runFailed`; stream-failure-during-cancel becomes `runCancelled`. Changed regression assertions named (`rpc-client.test.mjs:553`, `:588-590`).

7. **[MEDIUM — core lane not green / no unit command] Accepted.** Testing strategy replaced with exact gates (`node --test apps/desktop/tests/unit/*.test.mjs`, `pnpm --filter @pi-gui/pi-rpc-driver test`, named branded specs via `test:e2e:runner`) and a recorded baseline; unbranded-lane breakage documented as pre-existing and out of scope, not claimed green.

8. **[MEDIUM — 3.5 breaks a named spec] Accepted.** `new-thread-composer.spec.ts:297` update named in §3.5; siblings `:280/:291/:344` verified still valid. 1.4 capability semantics fixed: `undefined` ⇒ supported.

9. **[MEDIUM — renderer has no brand signal] Accepted with the cheaper option, decided in-plan:** rename the two renderer strings unconditionally (fork ships alpi only; no test asserts them — critic's own verification), gate only main-process dialog titles; the risk line is explicitly waived for those two strings. No brand plumbing built. Flagged for owner visibility in the summary.

10. **[MEDIUM — checklist missing two layers] Accepted.** Rows added: state/IPC contract triplet (`desktop-state.ts` + `ipc.ts` + `preload.ts`), and both-themes token definition + contrast against actual host surfaces (2.4 updated to test (token, surface) pairs incl. `--sidebar`/`--surface`).

11. **[LOW — 1.4 wiring mislocation] Accepted.** §1.4 restated at the `App.tsx` wiring level (`newThreadComposerError` vs store `lastError`); reuses the existing banner; scoped to the action.

12. **[LOW — funnel file pointer] Accepted.** §1.1 points at `app-store.ts:1906-1930` implementations; mapping applied once above both sinks.

13. **[LOW — capability flags package attribution] Accepted.** Architecture overview corrected: flags live at the desktop-driver layer; only `runCancelled` touches `packages/pi-rpc-driver`.

14. **[LOW — rule (c) can't see expired tokens] Accepted.** Limitation stated in §1.2(c) with the "connected-but-expired → ok (1.1 surfaces it)" unit row; consistent with owner rulings 2–3.

15. **[LOW — 1.3 dead code] Accepted.** Decision: delete the prop plumbing and `--below` CSS in the same commit.

Score: 13 accepted, 1 partially accepted (premise corrected with source evidence), 1 accepted-with-rebuttal (repro validity refuted with session evidence; hardening adopted anyway). Plan rev 2 is ready for Round 2.

---

## Plan Audit Round 2

**Reviewer:** claude (opus)
**Date:** 2026-07-26 14:20

### Round-1 items: re-verified against rev 2

Closed, verified in code (not taken on trust):

- **R1-1 (context column).** §1.2 now names the plumbing, and the claimed formats are exactly right: `formatTokenCount` in `.../pi-coding-agent/dist/cli/list-models.js:10-20` emits `200K`, `1M`, `32.8K` (`toFixed(1)`), plain digits under 1000. The parse spec matches the source.
- **R1-2 (1.6 branches).** §1.6 now carries both sites, the L708 gating/input is correct, and the L705 replacement preserves `replace(/[^a-zA-Z0-9_-]/g, "_")`. `31 + 1 + 8 = 40`, so both forms stay inside the limit. Resolution via the `external-pi-auth-bridge.ts:151-162` shape is the right call — pi-ai really is nested at `<pi-coding-agent>/node_modules/@earendil-works/pi-ai/…`.
- **R1-4 (error contract).** The `lastError` = headline / `lastErrorDetail` split works end to end: the timeline activity row already renders its `detail` slot (`timeline-item.tsx:98`), so "never lost" is achievable without new UI.
- **R1-5 (session dir), R1-6 (call sites), R1-8 (3.5 spec + capability semantics), R1-9 (brand decision), R1-10 (checklist rows), R1-11/12/13/14/15.** All present and accurate against the code they cite. `undefined ⇒ supported` is the right default given `supportsWorktrees?: boolean` (`desktop-driver.ts:25`).

Two disputed items — **you were right on both**:

- **R1-3 (rule (b) premise): conceded.** `.../pi-ai/dist/providers/xai.models.js:23-25` shows `id: "grok-4.5"` with `api: "openai-responses"`. My "grok-4.5 is chat-completions" premise was wrong, and the switch-back recovery was never blocked by the original rule. Worth keeping in mind that the same file has `grok-4.3` and `grok-build-0.1` at `api: "openai-completions"` (`:7`, `:44`), so the same-provider+model exemption you added still earns its keep.
- **R1-2 repro validity: conceded, and the arithmetic checks out.** Your quoted 400 payload `call-cadbc1ea-fd79-4982-ba1a-60a9fad1c08` is exactly 40 characters, and the uuid's final group is one char short of `…c089` — i.e. the slice cut mid-uuid and took the `-0`/`-1` discriminator with it. That is precisely what L705 does to `call-<uuid>-N|fc_…`. The composite branch demonstrably fires; my doubt was conditional on ids without `|`, and the condition is false. The added outbound-ID capture is good hardening regardless.

### Findings

1. **[severity: HIGH]** Rule 1.2(b) still has no data source for its api-family condition, so it can never block — and two "degrades safely" claims in the plan depend on it blocking.
   - Where: §1.2 Inputs ("`targetModel` = registry record incl. `contextWindow`"), rule (b) ("target resolves to the **openai-completions converter** (chat-completions api family)… If the target's api family is not resolvable from the registry, treat as not-completions (no block)"), §1.6 Documented risk ("preflight rule (b) detects the missing marker and re-blocks, so the app degrades safely"), §Edge cases ("Patch drift: … preflight degrades to block").
   - Evidence: rev 2 added `contextWindow` to `ParsedModelRow`/`RuntimeModelRecord` but not `api`. `RuntimeModelRecord` still has no api field (`packages/session-driver/src/runtime-types.ts:27-36`), and the registry's only input is `pi --list-models`, whose columns are `provider | model | context | max-out | thinking | images` (`.../dist/cli/list-models.js:51-66`) — there is no api column to parse. So "not resolvable from the registry" is **always** true, the fallback fires every time, and rule (b) never blocks — including in the exact `pi update`-reverted-the-patch scenario the risk section says it covers. This is the same defect class as Round-1 finding 1, fixed for rule (a) and left standing for rule (b), and rule (b) is the one aimed at the reported failure.
   - Recommendation (owner/builder choice, no new architecture): pi's `Model` type carries both `api` and `contextWindow` (`.../pi-ai/dist/types.d.ts:602-621`), and this repo **already** instantiates pi's `ModelRuntime` in-process for auth (`external-pi-auth-bridge.ts:171-181`, `allowModelNetwork: false`) — widening `ModernPiModelRuntime` to read the model list would supply `api` from the same source that already supplies auth, and would make the `parts[2]` text parse optional rather than load-bearing. **Or**, at zero code cost: state in §1.2 that rule (b) is inert until an api source exists, and strike the "re-blocks / degrades safely" sentences from §1.6 and §Edge cases. Either resolution is fine; leaving the rule specified-but-inert while the risk section claims it protects the unpatched state is not.

2. **[severity: MEDIUM]** The named Playwright gates are not branded specs — three of the four contain tests that launch unbranded, which the plan itself says cannot boot.
   - Where: §Testing strategy — "Named **branded** Playwright specs via `test:e2e:runner` (per phase: `new-thread-composer`, `composer-controls`, `model-scope-toggle`, `provider-settings`…)".
   - Evidence: `tests/core/composer-controls.spec.ts` passes no `envOverrides` at either launch (`:44-48`, `:170-174`); `tests/core/model-scope-toggle.spec.ts` likewise (`:30-34`); `tests/core/new-thread-composer.spec.ts` is mixed — branded at `:29`, `:110`, `:161`, `:216`, unbranded for the four tests starting `:258`, `:314`, `:362`, `:418`; `tests/core/provider-settings.spec.ts` is mixed too — branded at `:91`, `:146`, `:205`, `:269`, but the tests at `:295`, `:349`, `:402` are unbranded (the `envOverrides` at `:364`/`:417` set only `PI_APP_TEST_PROVIDER_LOGIN_FLOW`). Per the plan's own baseline paragraph, unbranded launches resolve to `driver: "sdk"` and never construct a store, so running these files whole cannot be green. If they *do* pass on the builder's machine, it is because ambient `PI_GUI_DRIVER`/`PI_GUI_PI_BIN` exports are present — which makes the gate environment-dependent, a worse property for a verification contract than the one Round 1 flagged.
   - Recommendation: name branded **tests**, not files — `--grep` scoping is what this repo's prior implementation docs already used (`--grep "new thread reuses"`, `alpi_logo_replacement_implementation.md:69`) — or add `PI_GUI_BRAND: "alpi"` to the specific tests used as gates. Also say which gate proves §3.5: its named spec update (`new-thread-composer.spec.ts:297`) sits inside the unbranded test at `:258`, so as things stand that edit cannot be exercised.

3. **[severity: LOW]** §1.5 names a regression assertion as changing that its own branch decision keeps unchanged.
   - Where: §1.5 — "Existing regression assertions change accordingly and are named: `packages/pi-rpc-driver/test/rpc-client.test.mjs:553` and `:588-590`", against the decision one sentence earlier that "abort-*command*-failure … **stays `runFailed`**".
   - Evidence: the test at `:559-593` is the abort-command-failure case (the fake answers `abort` with `success:false, error:'abort failed'`), and `:590` asserts `runFailed`/'abort failed' — under the plan's decision that stays exactly as-is. Only `:553` changes. Listing `:588-590` as changing invites a builder to weaken a guard that should hold.
   - Also worth recording (verified, no action): the other two cancel tests assert only delta suppression and idle status (`:662-664`, `:725-729`), so they need no update.

4. **[severity: LOW]** §1.6's quoted signature is a compressed paraphrase, so a literal guard built from the plan text will never match.
   - Where: §1.6 "Now (verified…)" quotes L705 as one line: `if (id.includes("|")) { const [callId] = id.split("|"); return callId.replace(...).slice(0, 40); }`.
   - Evidence: the installed block is four lines with an interleaved comment (`.../openai-completions.js:702-706`, including `// Sanitize to allowed chars and truncate to 40 chars (OpenAI limit)` between the destructure and the `return`). Given the plan mandates "literal match, no loose regex", the guard must come from the file bytes.
   - Recommendation: one sentence — guard strings are captured from the installed file at implementation time and pasted verbatim into the implementation doc alongside the `--check` output.

5. **[severity: LOW]** The architecture overview omits the package where `runCancelled` must actually be declared.
   - Where: §Architecture overview — "**RPC driver package** (`packages/pi-rpc-driver/`): distinct cancelled-run outcome only."
   - Evidence: the `SessionDriverEvent` union lives in a different package, `packages/session-driver/src/types.ts:290-302`; adding a member touches it and the typed test helper that pins the union (`apps/desktop/tests/helpers/notification-events.ts:73-74`). Rev 2 otherwise enumerates every layer precisely, so this reads as an oversight from the rewrite rather than a decision.

6. **[severity: LOW]** Rule (b)'s collision detector is looser than the collision it is detecting.
   - Where: §1.2 Inputs — "`pipeCompositeParallelToolCalls`: any assistant turn with ≥2 toolCall ids matching `/^call-.+\|/` sharing a prefix".
   - Issue: "sharing a prefix" has no defined length, and the real condition is exact and cheap: two ids whose *sanitized* forms are equal after 40 characters. Your own evidence is the clean example — `…c089-0|…` and `…c089-1|…` both sanitize-and-slice to the same 40 chars. Composite ids that differ inside the first 40 chars do not collide and would be false-blocked by a loose prefix test.
   - Recommendation: define the predicate as "duplicate 40-char sanitized forms" (reusing the same normalization the 1.6 patch defines), which lets the unit table assert both a true positive and a true negative instead of only the positive.

### Verdict: REVISE

Rev 2 is a large, honest improvement: the error contract, session-dir plumbing, `runFailed` call-site set, branch decisions, brand decision, checklist rows, and the per-branch 1.6 spec are all now accurate against the code they cite, and both places where you pushed back you were right — I verified `grok-4.5` at `api: "openai-responses"` and confirmed the truncated id in your 400 payload is exactly 40 characters cut mid-uuid, which only L705 produces.

One HIGH blocks: rule 1.2(b) needs an api-family source or an explicit "inert for now" statement, because §1.6 and §Edge cases both promise that this rule re-blocks when a `pi update` reverts the patch, and as specified it cannot. One MEDIUM blocks: the replacement verification gate names four spec files, three of which contain unbranded tests the plan itself documents as unbootable — the fix is `--grep` scoping, which this repo has used before. The four LOWs are small and self-contained.

Both blockers are resolvable inside the existing scope — one of them with no code at all — and neither touches icons, Anthropic, codex re-auth, or any hardening beyond what the plan already lists.

---

## Response to Plan Audit Round 2

**Builder:** Claude (Fable 5) · **Date:** 2026-07-26 · Plan updated in place to rev 3.

1. **[HIGH — rule (b) has no api-family source] Accepted, via your preferred route.** Verified myself: `external-pi-auth-bridge.ts:165-181` already loads pi's in-process `ModelRuntime` (`ModelRuntime.create({authPath, modelsPath, allowModelNetwork:false})`), and pi's `Model` type carries both `api` and `contextWindow` (`types.d.ts:602-621`). §1.2 metadata plumbing rewritten: inventory list stays CLI-based; per-model metadata (`contextWindow`, `api`) comes from the in-process registry merged by `(provider, modelId)` into optional `RuntimeModelRecord` fields — one typed source for BOTH rules, no text parsing (the Round-1 `parts[2]` parser approach is dropped; `parsePiListModels` untouched). Registry unavailable → fields undefined → rules degrade to no-block, stated. Rule (b) now tests `targetModel.api === "openai-completions"` against a real field, so §1.6's "degrades safely" claim stands on a rule that actually fires.

2. **[MEDIUM — named spec files not branded] Accepted.** Verified: zero `PI_GUI_BRAND` in `composer-controls.spec.ts` and `model-scope-toggle.spec.ts`. Testing strategy now gates on *individual branded tests* selected with `--grep` (precedent `alpi_logo_replacement_implementation.md:69`) — the four branded tests each in `new-thread-composer.spec.ts` and `provider-settings.spec.ts` plus new specs written branded — never whole files. §3.5 additionally brands the `:297` test it edits, so that assertion gains a runnable gate.

3. **[LOW — wrong test listed as changing] Accepted.** Verified: `:553` asserts `runFailed`+"Run cancelled" (user cancel → changes to `runCancelled`); `:588-590` asserts "abort failed" (abort-command-failure → stays `runFailed` per the plan's own branch decision). §1.5 corrected: only `:553` changes.

4. **[LOW — L705 guard string is a paraphrase] Accepted.** §1.6 now states the script embeds verbatim byte-for-byte source blocks copied from the installed file at implementation time; the plan's snippets are marked illustrative, not guard strings.

5. **[LOW — session-driver package omitted] Accepted.** Architecture overview and checklist now name `packages/session-driver/src/types.ts:290-302` as the home of the `runCancelled` union member.

6. **[LOW — detector should test the actual collision] Accepted.** Detector redefined: compute the old-algorithm sanitized form of every pipe-composite id; `hasCollidingToolCallIds` = any duplicate. Unit table gains the true-negative row (distinct sanitized forms → ok).

Score: 6/6 accepted. Also noting with appreciation: both Round-1 disputes were re-verified and conceded in your Round 2 — the loop is converging on evidence, which is exactly what it is for. Rev 3 ready for Round 3.

---

## Plan Audit Round 3

**Reviewer:** claude (opus)
**Date:** 2026-07-26 16:40

### Round-2 deltas: re-verified

Each of the six is present and, with one exception noted below, correct against the code:

- **R2-2 (branded gates).** §Testing strategy now gates on individual branded tests via `--grep`, and the counts are right: `new-thread-composer.spec.ts` has exactly four `PI_GUI_BRAND: "alpi"` tests (`:29`, `:110`, `:161`, `:216`) and `provider-settings.spec.ts` exactly four (`:91`, `:146`, `:205`, `:269`); the remaining three provider-settings tests (`:295`, `:349`, `:402`) are unbranded, and the `envOverrides` at `:364`/`:417` set only `PI_APP_TEST_PROVIDER_LOGIN_FLOW`. The "zero `PI_GUI_BRAND`" claim for `composer-controls.spec.ts` and `model-scope-toggle.spec.ts` is also correct. `test:e2e:runner` forwards `--grep` cleanly (`package.json:38`), and the separate `build` gate covers the fact that the runner script does not build.
- **R2-3 (assertion correction).** §1.5 now says only `:553` changes and marks `:588-590` unchanged-by-design. That matches the tests: `:524-557` is the user-cancel path asserting `runFailed`+"Run cancelled"; `:559-593` is the abort-command-failure path asserting "abort failed". The other two cancel tests (`:662-664`, `:725-729`) assert only delta suppression and idle, so the "only one assertion changes" claim holds.
- **R2-4 (guard wording).** §1.6 now states the script embeds verbatim byte-for-byte blocks and marks the plan's snippets illustrative. That is the right instruction — the installed L702-706 is a four-line block with an interleaved comment.
- **R2-5 (session-driver).** §Architecture and the checklist now name `packages/session-driver/src/types.ts:290-302`, which is indeed where the `SessionDriverEvent` union lives.
- **R2-6 (detector).** §1.2's `hasCollidingToolCallIds` now computes the old-algorithm sanitized form per pipe-composite id and flags duplicates. It mirrors installed L705 exactly, and scoping it to the whole history (not one turn) is the correct scope, since the entire transformed history goes out in a single request payload. The true-negative unit row follows naturally.
- **R2-1 (metadata source).** Route accepted and correct — pi's `Model` carries both fields (`pi-ai/dist/types.d.ts:602-621`), the repo already loads the runtime in-process (`external-pi-auth-bridge.ts:165-181`), and dropping the `parts[2]` text parse in favour of one typed source is the better call. One factual slip in the accessor, below.

### Findings

1. **[severity: MEDIUM]** §1.2 names an accessor the modern runtime does not have — and the plan's own degradation rule would hide the mistake.
   - Where: §1.2 Metadata plumbing — "sourced from pi's in-process `ModelRegistry`, loaded exactly the way `external-pi-auth-bridge.ts:165-181` already does (`ModelRuntime.create({ authPath, modelsPath, allowModelNetwork: false })` → **`getAll()`**…)".
   - Evidence: the installed `ModelRuntime` exposes `getProviders()`, `getProvider(providerId)`, `getModels(providerId)`, `getModel(providerId, modelId)`, `getAvailable(providerId)`, `getAvailableSnapshot()` (`.../pi-coding-agent/dist/core/model-runtime.js:186-220`). There is no `getAll()`. `getAll()` is a method of the **legacy** interface in this very repo — `LegacyPiModelRegistry` at `external-pi-auth-bridge.ts:57-59`, used only by the legacy fallback path, not by `loadExternalPiAuthBridge`'s modern branch that §1.2 cites. (The sentence also mixes names: pi's class is `ModelRuntime`; `ModelRegistry` is a different module.)
   - Why this is not just a typo: §1.2 also says "If the in-process load fails (legacy pi, drifted API): fields stay `undefined` and rules (a)/(b) degrade to no-block". A call to a nonexistent `getAll()` throws, gets caught by exactly that handler, and both rules silently degrade to no-block — the identical dead-rule outcome of Rounds 1 and 2, this time wearing the costume of designed graceful degradation. Nothing in the plan asserts that metadata was actually obtained.
   - Adjacent hazard worth pre-empting in the same edit: `asModernModelRuntime` hard-requires a fixed method list — `["getProviders", "getModels", "getProvider", "getProviderAuthStatus", "listCredentials", "login", "logout"]` (`external-pi-auth-bridge.ts:325-328`) and throws if any is missing. Adding a metadata accessor to that list would break **provider auth entirely** on any pi build lacking it, which is far worse than losing preflight metadata. Note too that the repo's local `ModernPiModelRuntime` declares `getModels(): readonly unknown[]` with no argument (`:38`), while the installed method takes `providerId` — so the local interface is not a reliable guide either.
   - Recommendation (all inside current scope): (i) name the real accessor — `getModel(provider, modelId)` (`model-runtime.js:195-197`) is an exact fit for the merge-by-`(provider, modelId)` the plan describes, with `getModels(providerId)` as the bulk alternative; (ii) state that the accessor is probed as an **optional** capability and must not be added to the `asModernModelRuntime` required list; (iii) add one positive assertion to the 1.2 verification — record the resolved metadata for a known model, e.g. `xai/grok-4.5` → `api: "openai-responses"`, `contextWindow: 500000` (`pi-ai/dist/providers/xai.models.js:22-39`) — so "registry unavailable → no-block" can never pass as success.

2. **[severity: LOW]** §3.5 brands an existing test whose surviving assertions depend on the unbranded catalog source.
   - Where: §3.5 — "`tests/core/new-thread-composer.spec.ts:297` … updated to the new label AND that test gains the `PI_GUI_BRAND: "alpi"` envOverride it currently lacks".
   - Issue: adding the override switches that test from the driverless `sdk` config to the RPC/alpi path, which also switches the model catalog source to `ExternalPiRuntimeSupervisor` running the real `pi --list-models` against the seeded agent dir. The same test also asserts dropdown contents and labels — "GPT-5", "GPT-4o", "Pick a model", "No matching models" (`:280`, `:285-295`, `:290`) — which the plan lists as "remain valid and untouched". Suggestive counter-signal: the four already-branded tests in that file deliberately assert only that a model badge is *visible* (`:57-58`), never catalog contents; every catalog-content assertion in the file sits in an unbranded test.
   - Recommendation: one clause — if the branded run changes the catalog or labels, write a small new branded test for the badge label rather than bending the existing test's other assertions. Cheap either way; just don't discover it mid-commit.

3. **[severity: LOW]** Two "degrades safely" sentences still read as unconditional now that the metadata source can be absent.
   - Where: §1.6 Documented risk — "preflight rule (b) detects the missing marker and re-blocks, so the app degrades safely"; §Edge cases → Patch drift — "preflight degrades to block".
   - Issue: with rev 3 these are true in the normal path (real `api` field, marker check), which resolves my Round-2 HIGH. But §1.2 now also defines a path where the registry is unavailable and rule (b) cannot block at all — and in that state the `pi update` protection is gone at the same moment the patch is gone. §Edge cases already says "unknown context window or api family → never block" two bullets earlier, so the plan contradicts itself only mildly, but the safety claim is the one a future reader will rely on.
   - Recommendation: add the qualifier — "re-blocks **when registry metadata is available**; if the registry cannot be loaded, both the patch and the block are absent and 1.1 is the only net" — so the degradation is documented where the safety claim is made.

### Verdict: REVISE

Rev 3 is close, and the deltas are real: I re-checked all six Round-2 items against the code and five are exactly right, including the two counting claims (four branded tests in each of the two spec files) and the `:553`-only assertion change, which are the kind of details that are easy to assert and easy to get wrong.

One MEDIUM blocks, and it is narrow: `getAll()` is not on pi's modern `ModelRuntime` — it is the legacy interface's method, declared in this repo at `external-pi-auth-bridge.ts:57-59` — while the installed runtime offers `getModel(provider, modelId)`, which is a better fit for the merge anyway. I would have called it LOW if the plan did not also instruct that a failed registry load degrades both rules to no-block: that handler turns this one wrong identifier into a silent, self-explaining no-op on the exact rule we have now spent three rounds keeping alive. Naming the real accessor, keeping it out of the `asModernModelRuntime` required-method guard, and asserting one known model's metadata in verification closes it for good.

The two LOWs are one-clause edits. Nothing here expands scope, touches icons, Anthropic, codex re-auth, or adds hardening beyond what the plan already commits to.

---

## Response to Plan Audit Round 3

**Builder:** Claude (Fable 5) · **Date:** 2026-07-26 · Plan updated in place to rev 4.

1. **[MEDIUM — `getAll()` does not exist on the modern runtime] Accepted in full.** Independently re-verified: modern `ModelRuntime` exposes `getProviders/getProvider/getModels/getModel/getAvailable/getAvailableSnapshot` (`model-runtime.js:186-205`) — no `getAll()`; that name is the repo's legacy interface (`external-pi-auth-bridge.ts:57-59`). §1.2 corrected: accessor is `getModel(providerId, modelId)` per inventory row, probed via `typeof` check, explicitly NOT added to `asModernModelRuntime`'s required list (`:325-328`) so a pi build lacking it degrades metadata instead of breaking provider auth. The mandatory positive wiring assertion is added — `xai/grok-4.5` must resolve to `api: "openai-responses"`, `contextWindow: 500000` (value verified against installed `xai.models.js`) with output pasted — so "registry unavailable" can never pass as success. Unit row "accessor missing" added.

2. **[LOW — §3.5 catalog-content assertions under branded boot] Accepted.** §3.5 now states the "GPT-5"/"GPT-4o" catalog assertions are verified under the branded run and adapted to the seeded registry if the branded catalog differs, keeping the badge-label assertion as the point of the test.

3. **[LOW — §1.6 degrade claim needs qualifier] Accepted.** Qualifier added: rule (b) re-blocks when registry metadata is available; with metadata undefined the rule is inert and 1.1 catches the failure after the fact.

Score: 3/3 accepted. Rev 4 ready for Round 4.

---

## Plan Audit Round 4

**Reviewer:** claude (opus)
**Date:** 2026-07-26 18:15

### Round-3 deltas: verified

- **R3-1 (accessor).** Every claim in the rewritten §1.2 metadata paragraph checks out against the installed source: `getModel(providerId, modelId)` is at `model-runtime.js:195-197`, inside the cited `186-205` range; `getAll()` is absent from the modern runtime and is indeed this repo's legacy interface method (`external-pi-auth-bridge.ts:57-59`); the required-method guard the plan now forbids touching is at `external-pi-auth-bridge.ts:325-328`; pi's `Model` carries `api` and `contextWindow` (`pi-ai/dist/types.d.ts:602-621`). The `typeof === "function"` probe plus "degrade metadata, never break provider auth" is the right split. Also confirmed: `getModel` resolves from the in-memory registry, so it is unaffected by `allowModelNetwork: false`.
- **Positive wiring assertion.** The anchor values are correct — `xai.models.js:22-39` gives `grok-4.5` exactly `api: "openai-responses"` and `contextWindow: 500000`. This is the piece that matters most: it converts "registry unavailable → no-block" from an invisible default into something an implementation round has to prove it did not hit. With it, the three-round argument about dead preflight rules is closed.
- **R3-2 (§3.5 catalog assertions).** Handled. You chose "adapt the catalog assertions to the seeded registry in the same edit" over my "write a new branded test"; that is a legitimate alternative and the plan keeps the intent explicit ("the badge-label assertion remains the point of the test"). No objection.
- **R3-3 (§1.6 qualifier).** Present and precisely worded at `§1.6 Documented risk` — rule (b) re-blocks only when registry metadata is available, otherwise inert with 1.1 as the net.

### Findings

1. **[severity: LOW]** The §1.6 qualifier did not reach the second place I cited for the same claim.
   - Where: §Edge cases & risks → "**Patch drift:** 1.6 refuses on signature mismatch; preflight degrades to block; nothing crashes unpatched."
   - Issue: my Round-3 finding named both §1.6 and this bullet; §1.6 got the qualifier, this one still reads unconditionally. The bullet two lines above ("unknown context window or api family → never block") supplies the caveat nearby, so the plan is not self-contradictory — but the sentence a future reader will quote when reasoning about `pi update` safety is this one.
   - Recommendation: mirror the §1.6 clause here ("degrades to block *when registry metadata is available*"). One clause; no other change.

2. **[severity: LOW]** One vestigial reference to the dropped parser approach.
   - Where: §Architecture overview → "**Tests**: unit (error mapper, preflight, **model parser**), driver regression suite…".
   - Issue: rev 4 sources metadata from the in-process runtime and states "`parsePiListModels` untouched", so there is no parser change left to unit-test. The live unit rows are the merge cases §1.2 lists (merge hit, merge miss, registry unavailable, accessor missing).
   - Recommendation: swap "model parser" for "registry metadata merge" so the Architecture line matches §1.2. Cosmetic.

### Verdict: PASS

Zero HIGH, zero MEDIUM, two LOW — both one-clause documentation edits with no code or scope implication. The plan is ready to build against.

Worth recording what this loop actually converged on, since the implementation round will lean on it: four rules that were specified but could not fire — 1.2(a) with no context-window source, 1.2(b) with no api-family source, a preflight blocking on a condition that would have blocked the recovery it recommended, and a verification gate naming spec files that cannot boot — are now each backed by a real, cited data source and a runnable gate. Two of my own premises were wrong along the way (grok-4.5's api family, and the pipe-composite question behind the 1.6 repro), and both were corrected with source evidence rather than deferred to; that is the loop working in the direction it is supposed to.

Non-binding notes for the implementation round, not conditions of this PASS: §1.2 does not say whether the metadata runtime is reached by exposing the instance the auth bridge already creates or by a second `ModelRuntime.create` — either is fine, but the first avoids paying the load twice per snapshot. And §1.2's "Now" paragraph still frames the gap in terms of the discarded `parts[2]` column, which is true of today's code but is no longer the route being taken; the Target sentence "`parsePiListModels` untouched" is what governs.

My involvement ends here.

---

## Implementation Audit Round 1

**Reviewer:** claude (fable 5)
**Date:** 2026-07-26 21:45
**Scope:** commits `3018bc0` (Phase 1), `556defc` (Phase 2), `107d324` (Phase 3) on baseline `b4edbbb`, audited against plan rev 4. Commit topology verified from `.git/logs/HEAD`. I did not re-run the live-provider repro (owner cost, per instructions) and had no shell in this session, so recorded command outputs were audited by cross-checking them against the code and by independent recomputation where possible.

### What checked out (verified against the code, not taken on trust)

- **1.1 funnel.** `describeError` applied once in `withError` above BOTH sinks (`app-store.ts:1930-1942`: headline → `sessionErrorsBySession` at `:1937`, headline → `lastError` at `:1941`, raw → `lastErrorDetail`), at the `runFailed` state production (`:1431-1435`), and at the `runFailed` `sessionErrorsBySession` write (`:1472`). `withErrorHandling` delegates. Provider-dialog returns stay headline-only (string state contract unchanged). The mapped table covers every rule the plan listed plus three sensible extras; the `unsupportedRpcDesktopOperation` message is matched by a rule, so the hidden-command fallback path reads kindly too.
- **1.2 preflight.** `evaluateModelSwitch` (`model-switch-preflight.ts:38-67`) implements all four rules: (c) `connected === false` → block; (a) `estTokens > floor(0.9 × contextWindow)` with `contextWindow !== undefined && > 0` guard — unknown window can never block; (b) collision AND NOT same-model AND `api === "openai-completions"` → block, `warn` when `piPatchApplied`; unknown `api` → no block. The collision detector (`legacyNormalizedId`, `:70-74`) computes exactly installed L705's sanitize-then-slice-40 form and flags duplicate sanitized forms across the whole history (`:128-131`) — the R2-6 definition. `readThreadStats` reuses the driver's `_<sessionId>.jsonl` suffix + realpath-containment shape (`:86-94`), skips malformed lines, and the `model_change` field names (`provider`/`modelId`, top-level) match the installed session format (verified against `session-manager.js:729-740`). Wired in `setSessionModel` after `ensureSessionReady`, before `driver.setSessionModel`; block keeps the current model and lands in the banner via `withError` (`app-store-composer.ts:430-437`). Missing `sessionDir`/record/provider → degrade to ok, never a crash.
- **1.2 metadata plumbing.** `listModelMetadata()` on all THREE adapters — modern (`external-pi-auth-bridge.ts:255`), legacy (`:299`, via `getAll()`), unavailable (`:157`, `[]`) — with a try/catch to `[]` at the bridge method (`:106-112`). Supervisor merges once by `providerId/modelId` key into optional `RuntimeModelRecord` fields (`external-pi-runtime-supervisor.ts:157-177`); `parsePiListModels` untouched; `RuntimeModelRecord` gains only the two optional fields (`runtime-types.ts:37-38`).
- **1.5 cancel.** `endRun` (`pi-rpc-driver.ts:544-559`) preserves `failRun`'s complete side-effect set and ordering: suppress-guard on entry, `delete cancellingRunId`, `delete pendingAssistantError`, `suppressRunEvents`, snapshot → idle, `lunaChildNeedsRotation`, `sessionUpdated` emitted BEFORE the terminal event. Cancel-success → `runCancelled` (`:236`); abort-command-failure STAYS `failRun` (`:239`); stream-failure-during-cancel → cancelled (`:493`). Main side: `runCancelled` never sets `lastError` (`app-store.ts:1440-1442`), clears `sessionErrorsBySession` (`:1473-1474`), still hits `persistUiState` (`:1501-1502`); timeline reuses `clearRunState` and renders a neutral "Stopped by you" row (`app-store-timeline.ts:208-217`); `statusForEvent` → idle (`app-store-session-state.ts:91-93`); notification allowlist ignores it (`notification-manager.ts:142-145`, untouched); the union member is declared with a doc comment (`packages/session-driver/src/types.ts:196-200`, in the union at `:306`); the `Extract`-typed test helper is unaffected by a union addition. Exactly one driver assertion changed (`rpc-client.test.mjs:553-558`, now also asserting `runFailed` ABSENT — stronger than planned); `:590-592` still asserts `runFailed`/'abort failed', untouched as decided.
- **1.6 patch script.** Verbatim per-branch guards including the interleaved comment in the L705 block (`patch-global-pi-ai.mjs:15-19`), literal `includes`/`replace` — no regex; sanitization preserved (`:24`); both replacements are the plan's exact 31+"_"+8-hex form; L708 keeps the `model.provider === "openai"` gate and `id` input; marker idempotency (`--check`/`--apply`, `:57-80`); refusal on drift requires BOTH branch signatures to classify as unpatched (`:59`); plus a backup + post-write verify + restore the plan didn't even ask for. Resolution realpaths the bin and validates the package name before touching anything (`:43-55`). `isPiPatchApplied` uses the same layout math (`model-switch-preflight.ts:146-157`), and its input really is a realpath — `resolveInstalledPiBin` returns `realpath(absolute)` (`process-path.ts:67`) and main passes exactly that (`main.ts:698`, `:853-855`).
- **Capabilities & 1.4.** Five optional flags at the desktop-driver layer (`desktop-driver.ts:25-30`), all set `false` by `RpcDesktopDriver` (`rpc-desktop-driver.ts:44-48`), snapshot at `app-store.ts:774-780`, default `{}` in empty state so `undefined ⇒ supported` holds for non-RPC paths. New Thread: stale-error clear, success-gated prompt clear reading the post-action state (`App.tsx:1986-2002`), worktree chip disabled + "Not available in this build" (`new-thread-view.tsx:291-293`), Start disabled while `starting` (`:339`). 3.2 gates the catalog (`composer-commands.ts:266-274`) from `driverCapabilities` (`App.tsx:933-934`, and `/tree` off in the New-Thread menu at `:970`); host commands now inside a try → banner (`app-store-composer.ts:293-303`). 3.1 echoes BOTH steer and follow-up optimistically with rollback (`:358-368`, `:409-411`). 3.6's deliver-mode is resolved main-side against store status with graceful downgrade in both directions (`:333-382`). 3.4 toggles disabled + "Managed by the pi CLI in this build" (`skills-view.tsx:165-167`, `extensions-view.tsx:165-167`). 3.5 badge shows the friendly label with the raw id kept in `title` (`model-selector.tsx:67-69`, `:110-113`) and "Switching…" while busy (`App.tsx:1747-1750`).
- **Phase 2.** Global `:focus-visible` (`base.css:352`), `prefers-reduced-motion` (`:373`), `.button--secondary` (`:357-371`), `--warning`/`--tooltip-bg`/`--toggle-bg`/`--muted-soft` present in BOTH `:root` and `:root.dark`, `main.css:169` now `var(--font-ui)`, window `backgroundColor` from `themeManager.getResolvedTheme()` (`main.ts:419`), dialog titles via `appBrand.appName` (`:592`, `:606`), `index.html:6` title and boot eyebrow (`App.tsx:1482`) renamed, transcript table/img/heading CSS (`main.css:3509-3549`), hover copy button on prose code (`message-markdown.tsx`).
- **Verification outputs are genuine where I could re-derive them.** The contrast numbers reproduce exactly from the shipped tokens (I recomputed #9c9fa8 on #1e1f22 → 6.23 and #666d81 on #f8f8fb → 4.87 by hand). The three post-patch ids in the 1.6 repro are internally consistent with the shipped djb2 (suffixes `-0/-1/-2` → hashes `…43/…42/…41`, the exact xor pattern). The predicted single driver-suite failure at `:553` matches the code change. The `--check`/`--apply` outputs are themselves the proof that the embedded guard strings matched the installed bytes.

### The recorded deviation (§1.2 `getModels()` vs `getModel(providerId, modelId)`): ACCEPTED

The justification holds on all four legs, verified independently: (i) the `asModernModelRuntime` required list is byte-identical to the baseline seven methods (`external-pi-auth-bridge.ts:345`) — nothing added, so the plan's prohibition is literally respected; (ii) `getModels` was ALREADY load-bearing at baseline for `listModelProviderIds` (`:249-254`), so no new "pi build lacking it breaks provider auth" exposure is introduced by this work; (iii) the installed signature is `getModels(providerId?: string)` (`model-runtime.d.ts:47`) and pi core itself calls it no-arg for the full catalog (`model-runtime.js:135`, `model-registry.js:19`), so one call returns the same typed `Model` records `getModel` would return ~600 times; (iv) degradation is intact — a throw is caught at the bridge (`:107-111`) → `[]` → merge misses → `undefined` fields → rules (a)/(b) no-block, and the mandatory positive wiring assertion (grok-4.5 → `openai-responses`/500000, 1111/1111) proves the non-degraded path was actually exercised. This is the kind of deviation the loop should welcome.

### Findings

1. **[severity: MEDIUM]** §1.1 was applied at the funnel but NOT at the plan's other two named production points, and the settled headline+detail consumer contract has no consumer.
   - Where: `app-store-timeline.ts:199-205` — the `runFailed` transcript row still renders raw `event.error.message` with `detail: event.error.code` (plan §1.1: "timeline error rows use headline as label and raw text in the existing detail slot"); `notification-manager.ts:129` — the failure notification body is still the raw message (plan §1.1 Target: "and at the `runFailed` timeline/notification text production"); and `lastErrorDetail` is written (`app-store.ts:1435`, `:1942`, declared `desktop-state.ts:183`) but has ZERO renderer consumers — `composer-surface.tsx:217-221` renders the headline only, no "small detail line" (plan §1.1: "ComposerSurface and New-Thread banner render headline + small detail line"). Net effect: the transcript row and the OS notification — two of the three surfaces the plan's own "Now" paragraph cited as showing jargon verbatim — still show it, and the raw text is currently invisible everywhere in the UI.
   - Not recorded: the implementation doc's deviation section records only the `getModels` change; its 1.1 row quietly lists a narrower application set than the plan's.
   - Recommendation: apply `describeError` at the timeline row (headline label, raw into the detail slot the plan named) and the notification body, and render `lastErrorDetail` in the banner — all three are plan-committed, no scope change. Alternatively record the reduction as an explicit deviation for owner sign-off.

2. **[severity: MEDIUM]** The preflight `warn` verdict proceeds silently — the plan's renderer spec says "warn shows the banner and proceeds."
   - Where: `app-store-composer.ts:432-439` — only `verdict === "block"` is handled; on `warn` the `decision.reason` is dropped and the user sees only the "Model set to …" activity item. The warn state (collision + completions target + patch applied) is precisely the state where the user should learn their thread depends on the local patch surviving the next `pi update`.
   - The unit test "warns instead of blocking" covers the pure function, not the wiring, so the gap is invisible to the recorded verification.
   - Recommendation: surface `decision.reason` on the warn path (the store's banner or a warning-toned activity row — either is within plan §1.2), or record the silent-proceed as a deviation for owner sign-off.

3. **[severity: MEDIUM]** The implementation doc claims 1.3's dead code was deleted; it was not.
   - Where: doc Phase-1 table — "new-thread-view.tsx override removed; **dead prop + `--below` CSS deleted**". The override removal is real (`new-thread-view.tsx:299-310` passes no placement), but the prop plumbing survives at `model-selector.tsx:18`, `:36`, `:117`, `:177` and `.model-selector__dropdown--below` survives at `main.css:1362`. Plan §1.3 (a decision recorded in Response to Round 1, item 15) required deleting both in the same commit.
   - The functional bug fix is delivered; the issue is a false claim in the implementation doc plus retained dead code contrary to an explicit plan decision.
   - Recommendation: delete the four prop sites and the CSS block (fork-local, no consumer — verified), and correct the doc row. Two-minute fix.

4. **[severity: MEDIUM]** The plan's Playwright gates were not run and its named spec changes were not made; §3.5 shipped with no runnable gate and a now-contradicting assertion left in the tree.
   - Where: Verification Round 1 records typecheck, build, unit, driver suite, the 1.6 repro, the wiring assertion, contrast, and manual Electron-surface checks — but NO named branded Playwright test runs (plan §Testing strategy: branded tests via `test:e2e:runner --grep`, "every implementation round"). None of the plan's named NEW specs exist (1.3 dropdown-bounding-box; 1.4 worktree-attempt + double-click-Start; Phase 3 follow-up-visible + `/tree`-absent) — no new files under `tests/`, and `tests/core/new-thread-composer.spec.ts:297` still reads `toHaveText("openai:gpt-4o")`, unbranded, exactly as before — the edit §3.5 explicitly mandated (and Rounds 3-4 litigated) was skipped. Under the shipped badge code that assertion is now WRONG (`model-selector.tsx:68` renders the option label), so the friendly-label change has zero automated coverage and a stale contradicting assertion. Related unit gap: the plan's §1.2 unit rows "malformed JSONL lines skipped" and R2-6's detector true-positive/true-negative have no tests — `model-switch-preflight.test.mjs` exercises only `evaluateModelSwitch` with a pre-computed boolean; `readThreadStats`/`legacyNormalizedId` (the piece three plan rounds sharpened) have no direct coverage.
   - Mitigation acknowledged: the Electron-surface section shows the dropdown-inside-window screenshot, the disabled worktree chip, and the badge label on a real branded boot, which covers some of the same ground manually. That is evidence, but it is not the gate the plan committed to, and it leaves 1.4's behavioral assertions (prompt preserved, exactly one thread on double-click) and 3.1's follow-up visibility unexercised.
   - Recommendation: run the eight existing branded tests via `--grep` and record output; write the plan-named specs (all four are already in-plan, not scope growth); make the §3.5 spec edit (update `:297` to the label + add the `PI_GUI_BRAND` override, adapting catalog assertions per plan); add the detector unit rows. Alternatively, record the reduced gate set as an explicit deviation for owner sign-off — but the stale `:297` assertion should be fixed either way.

5. **[severity: MEDIUM]** Two Phase 3 plan items are silently absent while the doc implies only 3.7 was deferred.
   - Where: 3.3's second half — "rename pending until confirm" — has no implementation (`App.tsx:1913-1915` fires the rename with no pending state; no pending naming anywhere in `src/`). 3.4's second half — "`SecondarySurface` gets an error slot rendering the mapped `lastError`" — is absent (`secondary-surface.tsx` has no error prop or rendering), so a residual failure on the Skills/Extensions surfaces still renders nowhere on those surfaces. The doc's Phase-3 paragraph lists what was built and says "3.7 (resume fidelity) deferred per plan — flagged for owner", implying 3.1-3.6 landed whole.
   - Impact is small (both are polish; the disabled toggles remove 3.4's main failure source), but the audit's question is plan fidelity, and unrecorded omissions are how "done" quietly stops meaning done.
   - Recommendation: implement the two halves (both in-plan) or add them to the doc's deferred list with the owner's sign-off, alongside 3.7.

6. **[severity: LOW]** Intra-phase commit boundaries were not followed and the consolidation is unrecorded.
   - Where: plan §Phase 1 commit boundaries ("1.1+1.2+1.4, 1.3, 1.5, 1.6 — four commits"), §Phase 2 ("2.1; 2.2-2.5; 2.6-2.7"), §Phase 3 ("3.1+3.6; 3.2+3.4; 3.3+3.5; 3.7") — eleven planned commits landed as three (one per phase). Phases ARE separate commits, which honors the checklist row and the owner's audit brief, so this is note-grade — but the doc should say the granularity was consolidated and why.

7. **[severity: LOW]** The detector's `historyAuthor` is sourced only from `model_change` entries, though pi itself also derives the current model from the last assistant message.
   - Where: `model-switch-preflight.ts:117-120` vs installed `session-manager.js:156-157` (`entry.message.provider`/`entry.message.model`). A never-switched session has no `model_change` entries, so the same-model exemption can't fire. Functionally moot today — pipe-composite ids only come from responses-api authors, and rule (b) only fires on completions targets, so the exemption is never needed for the histories that collide — recording it so the next reader doesn't rediscover it.

8. **[severity: LOW]** Small text/style variances from plan wording, none user-hostile: per-repo scope caption is generic ("Model defaults are saved to .pi/settings.json inside each repository.", `settings-general-section.tsx:44`) instead of the plan's `{repo}`-interpolated form; §2.2's menu-item focus-parity styles were not added (the global `:focus-visible` ring covers keyboard visibility, and the menus use roving selection where items rarely take DOM focus); the fallback headline is a 160-char condensed raw rather than the table's illustrative "Something failed: {120 chars}". All within reasonable latitude; listed for completeness.

### Regression review (focus area 3): no regressions found

The driver suite is 52/52 with only the planned assertion changed; `failRun` callers are behaviorally untouched (delegation, `pi-rpc-driver.ts:536-538`); Luna benign-failure suppression untouched (`:215-217`, `:500-502`); notification defaults ignore the new event by allowlist; `undefined ⇒ supported` holds via the `{}` default so non-RPC/worktree specs are unaffected; all three auth-bridge adapters implement the new method and the bridge try/catch would even tolerate an adapter that didn't; the timeline teardown for cancelled runs runs before `applySessionEventState` reads `runningSinceBySession`, so the spinner and working row clear correctly; state crosses preload/IPC as a whole `DesktopAppState`, so the two-file contract change is complete as shipped.

### Verdict: REVISE

Zero HIGH, five MEDIUM, three LOW. The hard engineering is genuinely good — the 1.5 `endRun` refactor and the 1.6 script are better than the plan required, the preflight decision function is exactly the four-round-negotiated spec, the `getModels` deviation is accepted on verified evidence, and the recorded verification outputs reproduce independently where I could check them (contrast ratios to the second decimal, djb2 hash pattern, the single predicted test flip). None of the five MEDIUMs asks for anything beyond what plan rev 4 already commits to; four of them are "finish or honestly record" items: apply the mapper at the two remaining named surfaces and give `lastErrorDetail` a consumer (1), surface the warn verdict (2), delete the 1.3 dead code the doc already claims is gone (3), run/write the committed test gates and fix the now-wrong `:297` assertion (4), and implement-or-record the two absent Phase 3 halves (5). A focused follow-up commit plus a doc pass closes all of them; where the builder prefers to keep any behavior as shipped, the existing deviation mechanism — record it, owner signs off — is the honest route, and I will not re-block a recorded deviation the owner accepts.
