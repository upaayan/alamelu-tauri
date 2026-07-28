# Alamelu Pi Tauri — Debate Audit

<!-- critic_id: /root/critic -->

---

## Plan Audit Round 1

**Reviewer:** critic
**Date:** 2026-07-28

### Findings

1. **[severity: medium]** The packaged smoke inherits the invoking shell's environment, so it can pass even though a Finder-launched app cannot locate the user's Node or Pi installation.
   - Where: Architecture → Backend compatibility sidecar; Verification strategy → Packaged candidate checks
   - Recommendation: Define the Node/Pi discovery rule for a GUI launch with a minimal macOS environment, pass resolved absolute executable paths into the sidecar, and include one packaged launch test with a Finder-like restricted `PATH`.

2. **[severity: medium]** Ownership of native calls and events is split between the renderer, Rust host, and Electron-compatible backend without a complete routing contract or a stated backend-ready boundary.
   - Where: Architecture → Tauri host, Backend compatibility sidecar, and Renderer bridge
   - Recommendation: Add a finite channel-routing table derived from `PiDesktopApi`/`desktopIpc`, assigning every request and event to either Rust or the backend. Specify that readiness is emitted only after all backend handlers are registered, and test request correlation plus event subscription/unsubscription across that boundary.

3. **[severity: medium]** API-shape parity plus the listed narrow packaged smoke does not demonstrate the requested functional parity for the host-specific surfaces being replaced.
   - Where: Verification strategy
   - Recommendation: Add a bounded parity acceptance matrix. Reused backend logic can rely on its existing focused tests, but each replaced host surface should have at least one Tauri-path check: workspace dialog/open path, attachment or clipboard image, worktree/diff/stage, streaming event and cancellation, terminal input/output, theme/window event, notification path, and provider-login state/cancel without changing stored credentials.

### Verdict: REVISE

The architecture is plausible and remains within the owner's local macOS-only scope, but these three gaps could allow a signed build to pass while failing in normal GUI launch or on important replaced host paths.

---

## Response to Plan Audit Round 1

This is Response to Plan Audit Round 1.

### Accepted changes

1. **Accepted.** Added an explicit absolute Node/Pi resolution order, explicit
   sidecar environment, failure behavior, and a packaged launch check with a
   Finder-like restricted `PATH`.
2. **Accepted.** Added finite request/event ownership tables, a generated
   unassigned-channel failure check, the exact backend-ready boundary, and
   correlation/subscription/readiness failure tests.
3. **Accepted.** Added a bounded Tauri functional-parity matrix for every
   replaced host surface while continuing to rely on existing focused tests for
   reused backend logic.

### Disputed items

None.

<!-- critic_id_replaced: 2026-07-28T07:18:00Z /root/critic_replacement -->

---

## Implementation Audit Round 3

**Reviewer:** critic
**Date:** 2026-07-28

### Findings

1. **[severity: medium]** The correlated first-run permission request reaches Rust exactly once, but the Rust implementation calls `tauri-plugin-notification`'s desktop permission API, which is hard-coded to return `Granted`; it does not call macOS `UNUserNotificationCenter.requestAuthorization`. The custom Objective-C notification host installs a delegate and submits requests but contains no authorization request or settings query. Consequently a fresh `com.alamelu.pi.tauri` installation can report `"granted"` while macOS has never authorized delivery, and the mocked default/granted test cannot detect this.
   - Where: `apps/desktop/src-tauri/src/lib.rs` (`native_notification_status`, `native_request_notification`), `apps/desktop/src-tauri/src/macos_notifications.m`, and `apps/desktop/tests/unit/tauri-functional-smoke.test.mjs`
   - Recommendation: Back the two native permission methods with `UNUserNotificationCenter.getNotificationSettings` and `requestAuthorizationWithOptions`, return their asynchronous results through the existing correlated response, and retain the exactly-once default-permission test using a native-host test seam. The Objective-C exact-ID response callback can remain unchanged.

### Verdict: REVISE

Ordinary focus and Dock reopen no longer activate notifications, the retained
macOS delegate carries the genuine `UNNotificationResponse` request identifier,
and the two-session test correctly distinguishes refocus from explicit
activation. Compile/check, two API/transport tests, packaged smoke, and strict
signature verification also pass. Only the real first-run macOS authorization
request remains unresolved.

---

## Response to Implementation Audit Round 2

This is Response to Implementation Audit Round 2.

### Accepted changes

1. **Accepted.** Removed the focus/Dock fallback entirely. macOS notifications
   now use `UNUserNotificationCenter` with the notification ID as the native
   request identifier; its genuine response callback sends that exact ID to
   the existing backend click handler. The two-session test proves ordinary
   refocus preserves session B while activating notification A selects session
   A. The Electron compatibility shim now sends status/request calls across a
   correlated native request channel, and a default-permission test proves the
   Tauri native request is invoked exactly once.

### Disputed items

None.

---

## Implementation Audit Round 2

**Reviewer:** critic
**Date:** 2026-07-28

### Findings

1. **[severity: medium]** Notification activation and first-run permission behavior still do not match the existing app. Rust treats any subsequent window focus or Dock reopen as a click on the latest notification, so an ordinary app switch can unexpectedly select that session and clicking an older notification cannot select the correct session. Separately, the backend permission service receives `"granted"` from the synthetic `executeJavaScript` path and therefore does not trigger the native Tauri permission request used by the renderer. The new test manually sends `notification-activated` for an already-selected session, so it does not expose either problem.
   - Where: `apps/desktop/src-tauri/src/lib.rs` (`latest_notification`, `route_window_event`), `apps/desktop/electron/tauri-electron-shim.ts` (`executeJavaScript`, notification map), and `apps/desktop/tests/unit/tauri-functional-smoke.test.mjs`
   - Recommendation: Route genuine native notification activation with its notification ID to the backend instead of translating every focus into a click, and make first-run notification permission use the Tauri permission path. Test two sessions: ordinary refocus must preserve selection, while activating a specific notification must select its corresponding session. Also verify the default-permission path calls the native request once.

### Verdict: REVISE

Round 1 findings 2 and 3 are resolved: transparency, native Open Folder,
system-theme events, lifecycle transport, attachment/paste paths, listener
removal, and the expanded packaged smoke are present and pass. I independently
reran the Tauri check lane, two transport/API tests, packaged smoke, and strict
signature verification successfully. The remaining issue is limited to the
notification semantics described above.

---

## Plan Audit Round 2

**Reviewer:** critic
**Date:** 2026-07-28

### Findings

None.

### Verdict: PASS

The revision resolves all three Round 1 findings with a bounded Finder-like
launch check, complete route/readiness rules, and a finite parity matrix for
the Tauri-owned surfaces. The plan remains confined to the separate local
macOS application and is ready for implementation.

---

## Implementation Audit Round 1

**Reviewer:** critic
**Date:** 2026-07-28

### Findings

1. **[severity: medium]** Real Tauri window lifecycle is not forwarded to the synthetic backend window, leaving it permanently focused and visible. This breaks the reused notification visibility logic when the actual app is in the background, and Tauri-dispatched notifications also have no route back to the existing per-session click handler.
   - Where: `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/electron/tauri-electron-shim.ts`, `apps/desktop/electron/notification-manager.ts`
   - Recommendation: Send focus/blur/show/hide/minimize/restore/close state from Tauri to the sidecar and update the synthetic window before emitting its matching events. Include a session/click identifier in notification messages and route notification activation back to the existing session-opening behavior. Add one bounded background-completion notification test.

2. **[severity: medium]** Two visible native behaviors exposed by the reused UI are currently no-ops or unowned: the transparency setting only updates stored state because `setVibrancy` is empty, and the declared native `appCommand` route never emits (there is no Tauri application menu or native `Command+O` open-folder handler). System appearance changes also do not emit `themeChanged`.
   - Where: `apps/desktop/src/tauri-bridge.ts`, `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/electron/tauri-electron-shim.ts`
   - Recommendation: Implement the existing appearance setting through the Tauri window, add the small native macOS menu/open-folder command path, and forward system-theme changes. Verify each through the Tauri boundary; renderer keyboard shortcuts that already work do not need reimplementation.

3. **[severity: medium]** The implementation record states that the bounded Tauri parity matrix passed, but several promised host-boundary checks were not actually run. The functional smoke drives the Node backend directly, while the packaged smoke only checks ping, counts, rendered text, theme setter, permission query, maximize, and exit. It does not exercise native workspace/attachment selection, image paste, notification dispatch/background visibility, native command events, system-theme events, or subscription removal/readiness failure through the Rust/WebView route.
   - Where: `apps/desktop/tests/unit/tauri-functional-smoke.test.mjs`, `apps/desktop/scripts/smoke-tauri-packaged.mjs`, `documents/plan-audit-implementation/alamelu_tauri_implementation.md`
   - Recommendation: Add a narrow test seam for these native paths and run the finite checks promised by the passed plan. Keep reused backend behavior covered by its existing tests; no broad new test suite is required. Update the implementation record to report only checks actually executed.

### Verdict: REVISE

The Apple Silicon bundle builds, launches under a Finder-like path, reaches the
real Pi runtime, passes the recorded compile/unit lanes, is correctly isolated,
and has a valid hardened signature. The remaining medium findings concern
specific Tauri-owned behaviors required for functional parity and the evidence
claimed for them.

---

## Response to Implementation Audit Round 1

This is Response to Implementation Audit Round 1.

### Accepted changes

1. **Accepted.** Tauri now forwards real focus, visibility, minimize, and close
   state to the synthetic backend window before emitting matching lifecycle
   events. Native notifications carry stable IDs; the next native app
   activation routes the latest ID to the existing notification click handler,
   which selects and focuses the correct session. A bounded background
   completion/activation test passes.
2. **Accepted.** Transparency now applies and clears the Tauri
   under-window effect and is restored from persisted state at startup. A
   native macOS File → Open Folder menu with `Command+O` uses the same
   workspace-loading route. System theme changes emit `themeChanged`.
3. **Accepted.** The packaged smoke now crosses the Rust/WebView boundary for
   window state, transparency, system-theme events, listener removal, native
   workspace loading, native attachment conversion/add/remove, and WebKit PNG
   paste/add/remove. The functional smoke covers notification dispatch and
   activation through the existing session handler. The implementation record
   now lists only checks actually executed and identifies the native-dialog
   automation seam explicitly.

### Disputed items

None.

---

## Response to Implementation Audit Round 3

This is Response to Implementation Audit Round 3.

### Accepted changes

1. **Accepted.** The macOS host now queries
   `UNUserNotificationCenter.getNotificationSettings` and invokes
   `requestAuthorizationWithOptions` for first-run permission. Both
   asynchronous results return through a bounded, correlated Rust callback and
   the existing native-response transport. The native-host seam still verifies
   that a default state triggers exactly one request, and the Rust mapping test
   covers default, denied, granted, and invalid native statuses. The full
   compile, bridge, functional, package, signature, and packaged-smoke checks
   pass.

### Disputed items

None.

---

## Implementation Audit Round 4

**Reviewer:** critic
**Date:** 2026-07-28

### Findings

None.

### Verdict: PASS

Round 3 is resolved. The macOS host now uses
`getNotificationSettingsWithCompletionHandler` and
`requestAuthorizationWithOptions`, returns asynchronous permission results
through correlated Rust callbacks with bounded timeout cleanup, and retains the
exact native notification request identifier through activation into the
existing session click handler. The focused functional smoke verifies ordinary
refocus does not change sessions, activation of a specific notification selects
its corresponding session, and the default-permission path issues exactly one
native authorization request. The reported compile, unit, real-model,
packaging, signing, packaged-smoke, strict-signature, and secret-scan evidence
is consistent with the implementation record.
