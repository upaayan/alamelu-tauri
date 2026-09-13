# Composer footer, wrap reserve, thinking accept

Repo: `/Users/sudhirjha/playground/alamelu-tauri` only.

## Outcome

Three owner-approved items, nothing else.

1. Session composer footer: left-aligned hint/model/thinking; reserved 36ch elapsed slot after it, with space on both sides of the time; `+` and send stay where they are. Slot stays reserved while idle (empty) so seconds cannot shove the row.
2. Session composer wrap: textarea min-height 3 lines (72px). First wraps use that well. Grow only after it is full, still cap at 220px.
3. Pi child replace is a wrapper, not a validator. If `get_state` succeeded and the Pi session id matches, accept Pi’s provider, model, and thinking. Do not throw because they differ from the GUI snapshot. Snapshot takes Pi’s values when present.

## Owner rulings

- HTML POC at `poc/composer-thinking-20260913/` is the look reference, not the product. Owner agreed the proposals on 2026-09-13 after the visual pass.
- Keep 36ch time reservation (not collapse when idle). Place it between the hint and the `+`. Reasonable space on both sides of the time.
- 3-line wrap reserve is accepted.
- GUI is a wrapper around Pi, not a harness validator. 2026-09-13 later ruling: if Pi is fine, Alamelu Pi is fine — including provider and model, not only thinking.
- Live GUI thinking POC was not possible without a rebuild; planning proceeds without it. Live check is `xhigh` on `xai-i2o` / `grok-4.6` after implementation rebuild, with no mismatch banner.
- No extra chrome, no placeholder text in the time slot, no Electron repo, no `pi-cursor-sdk`, no Windows install in this task.
- Planning + Codex gpt-6-astra/high critic. Implement only after explicit owner approval of this plan.

## Done when

1. Idle session footer: hint starts at the left; empty 36ch slot sits between hint and `+`; `+`/send do not move vs today’s right edge.
2. Running: the same slot shows `runningLabel`; hint left edge and `+` do not shift as seconds change.
3. Session textarea min-height is 72px via a session-only selector; height still caps at 220px with overflow auto only at the cap. New-thread height behavior is unchanged.
4. After a successful `get_state` with the same Pi session id, replace does not throw on different thinking, provider, or model. Snapshot uses Pi’s reported config when present. Session-id mismatch still throws (wrong thread, not config validation).
5. Relevant unit tests pass. No Playwright port.

## Files

- `apps/desktop/src/composer-panel.tsx` — render hint, then elapsed, then the existing actions block.
- `apps/desktop/src/styles/main.css` — keep `.composer__elapsed` at 36ch tabular nums; add horizontal space on both sides of it. Do not change the shared `.composer textarea` min-height (24px). Add the 72px well on a session-only selector, e.g. `.composer:not(.new-thread__composer) textarea`. Leave `.new-thread__textarea` alone. Do not re-add hint `overflow: hidden` / ellipsis / nowrap (pickers must stay clickable).
- `packages/pi-rpc-driver/src/pi-rpc-driver.ts` — remove `assertRestoredSessionConfig` and its call. Keep `get_state` success, session-id match, closed/active guards, and the existing snapshot merge of `restoredConfig`.
- `packages/pi-rpc-driver/test/` — one fake-client case: expected `xai-i2o` / `grok-4.6` / `xhigh`, actual different thinking (and provider/model if easy in the same case), same session id, replace succeeds. If an existing test required a config-mismatch throw, invert or drop that assertion only. Session-id mismatch still fails.
- `apps/desktop/tests/unit/composer-helpers.test.mjs` — only if the 72px min-height changes `fitComposerTextarea` assertions. New-thread still calls `fitComposerTextarea(..., 220)`.

## Out of scope

- Rebuilding/installing the app (that is implementation, after owner plan approval).
- Changing Cursor settingSources, Codex worker, or backup-server Cursor CLI.
- New-thread footer layout (no elapsed slot there).
- Deleting the POC directory before ship.
- Dropping the session-id identity check.

## Verify (implementation, not this planning phase)

- `pnpm --filter @alamelu-pi/pi-rpc-driver test`
- `pnpm --filter @alamelu-pi/desktop run test:tauri:unit:ci`
- After owner implementation approval and Mac rebuild: in Alamelu Pi, `xai-i2o` / `grok-4.6` / thinking `xhigh`, send a prompt that recycles the child; no mismatch banner. Idle vs running footer does not shove hint or `+`. A wrapping line inside the 3-line well does not grow the box.
