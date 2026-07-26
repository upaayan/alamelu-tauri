# Alamelu Pi — Phase 5 Implementation

Plan: [`alpi_ux_repair_phase5_plan.md`](./alpi_ux_repair_phase5_plan.md) (rev 3, Fable 5 PASS after 2 rounds)
Baseline `f763b51` · A `874e35b` · B `8b548c3` · C `e88f81d`
Owner rulings honored: icon byte-identical; no Anthropic auth work; no codex re-auth automation.

## A — self-healing pi-ai patch (`874e35b`)

Core moved to `apps/desktop/electron/pi-ai-patch.mjs`, **statically imported** by `main.ts` so electron-vite bundles it into `out/main` (already covered by `files: out/**/*`). `scripts/patch-global-pi-ai.mjs` is now a CLI shim over the same functions — one implementation. Startup hook is awaited before the RPC driver is constructed, skipped when `PI_APP_TEST_MODE` is set, and takes the resolved `piBin` rather than touching `PATH`.

**Bundling proven, not assumed:**
```
grep -c "alpi-patch:toolcallid-v1" apps/desktop/out/main/main.js  →  2
```

**Tests (8/8):** `shouldReapplyPatch` truth table (same version+patched → no-op; version change → apply; unpatched → apply; drifted → never); drift detection; drift refusal; patch/idempotency round-trip on a **temp copy**; and a behavioural row proving the three colliding July-24 ids become distinct and stay ≤40 wire-legal chars. Global pi verified untouched after the run (`--check` → `patched`).

## B — /compact and /tree wired for real (`8b548c3`)

Owner's correction was right: pi's RPC has `compact`, `get_tree` and `fork`; the driver's rejections were leftover stubs. `compactSession` sends on the idle queue with the 120s prompt timeout (the 30s client default would have failed every real session). `getSessionTree` maps pi's `SessionTreeNode`; an unrecognised kind is skipped with children hoisted so no branch is lost. `navigateSessionTree` forks and returns pi's `cancelled` plus `text` → `editorText`. `RpcDesktopDriver` delegates and flips `supportsTree`/`supportsCompact`, so the Phase-1 capability plumbing re-exposes both commands with no renderer change.

**Live against real pi:**
```
get_tree success: true | nodes: 7 | kinds: model_change,thinking_level_change,message | leafId: 05bfe187
compact  → pi answered "Nothing to compact (session too small)"   (pi's own rule; the plumbing works)
```
**Driver suite 58/58**, including 6 new tests (compact timeout + failure, tree mapping, unknown-kind hoisting, fork with editorText, cancelled fork). The old "rejects unsupported Phase-2 methods" test asserted these three reject — updated to the three that genuinely remain unimplemented (`archiveSession`, `unarchiveSession`, `replaceQueuedMessages`).

## C — test debt paid (`e88f81d`)

`apps/desktop/tests/core/ux-repair.spec.ts`, all branded, **4/4 passing**: worktree chip disabled with its reason while the prompt survives; double-click Start yields exactly one thread; model dropdown opens fully inside the window (the 1.3 assertion, restored to the debt list in plan rev 2); `/tree` and `/compact` present again. Plus 6 `readThreadStats` unit rows (collision, true-negative, non-composite, malformed, missing, traversal-refusal). **Unit suites 69/69.**

### The owed run of the four pre-existing branded tests — and one honest finding

`new-thread-composer.spec.ts` → **4 passed, 4 failed**. Three failures are the documented no-window sdk condition (unbranded). The fourth, `Alpi new thread can start from No Repository` (:205, branded), fails on `lastError: ""`.

**It is not a regression.** Checked out `74e351e` — the docs-only commit before any Phase 1–5 code — rebuilt, and reproduced the identical failure:
```
- "lastError": ""
+ "lastError": "OpenAI API error (401): ... Incorrect API key provided: test-ope***-key ..."
```
The seeded test key is fake, pi really calls OpenAI, and the 401 lands in `lastError` while the test asserts it stays empty. On this branch the same failure shows the shortened mapped message instead of raw JSON. Pre-existing and out of scope; reported rather than silently fixed or quietly left unmentioned.
