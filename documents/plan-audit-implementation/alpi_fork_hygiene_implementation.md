# Alamelu Pi — Fork Hygiene & Repo Housekeeping: Implementation

Plan: [`alpi_fork_hygiene_plan.md`](./alpi_fork_hygiene_plan.md) (rev 4) · Audit: [`alpi_fork_hygiene_audit.md`](./alpi_fork_hygiene_audit.md) — **Codex PASS** after 4 rounds (1H/4M/3L → 0/3/2 → 0/2/2 → 0/0/3).
Commits: A `04561af` · B `cbe30a6` · C `c818c7b` · D `a78c5ed` · E `13dbed6` · G (auto-compaction + playwright) · F (this doc).

## What shipped

**A — update checker gone.** `update-checker.ts` deleted plus all six `main.ts` sites and the `disableUpdateChecks` brand flag that existed only to suppress it. No update mechanism, no network call to upstream, no menu item.

**B — 58MB of upstream marketing gone.** `apps/website` (57MB Next.js site linking to upstream's GitHub/releases), `video/` (Remotion promo project whose closing card rendered upstream's repo URL; footage was June-4 captures of upstream's UI), `docs/readme/` (that project's rendered output, embedded in the README), and the orphaned `verify-install-copy.mjs` / `readme-demo.mts`. The `video` workspace member and `capture-showcase.mts` went with it. The native clipboard test now writes its own fixture from `TINY_PNG_BASE64` instead of borrowing `apps/website/public/og.png`.

**C — README rewritten** to describe a local, macOS-only, single-user build that wraps the installed `pi` CLI rather than bundling a runtime, with no releases/Homebrew/updates. It credits the **project** and points at LICENSE for the copyright holder, so the author's work is acknowledged without carrying his name outside the licence.

**D — naming and packaging.** `@pi-gui/*` → `@alamelu-pi/*` across 87 files; log prefixes, user-facing copy, IPC channel names and the notification helper binary rebranded; sidebar `localStorage` key moved with a one-time read of the old key. `electron-builder.yml` **deleted** — it carried the last upstream app id, the upstream copyright metadata and the GitHub-publisher/notarize/DMG/AppImage release config the owner ruled out. Consumers were retargeted, not removed: `package:dir` and the notification-onboarding lane use `electron-builder.alpi.yml` (with `-c.mac.identity=null`, mirroring the sanctioned packager), the test helper resolves `release-alpi/mac-arm64/alpi.app`, and the runtime-deps verifier defaults to the alpi flavour. Dead release/Linux/bun scripts, the four release-ZIP production specs, their helper, and the Homebrew publishing scripts were deleted.

**E — `patches/` deleted.** Verified orphaned: no manifest, workspace file, lockfile setting or script referenced it.

**G — auto-compaction exposed.** Follows the mechanism pi's other global settings use (`updateSettings` → `buildSnapshot`), not a per-session RPC call — the idle queue rejects config mutations during a run and cannot work with no session open. `RuntimeSettingsSnapshot.autoCompactionEnabled` reads `compaction.enabled` with pi's own absent-means-true default; the full renderer path mirrors the skill-commands toggle; the store refreshes **every** cached workspace snapshot because the setting is global. Settings → General toggle, default on, captioned that it is pi's global setting and also applies to the `pi` CLI.

## F — sibling repo harvest (reconciled to 101)

`git status --porcelain=v1 -uall` in `pi-gui-rpc-lab`: **101 paths — 38 modified, 63 untracked.** Reconciliation:

| Group | Count | Present in alamelu? | Verdict |
|---|---|---|---|
| Modified tracked files | 38 | All 38 exist; contents differ | **Nothing to harvest** — alamelu has diverged forward by five months of work; the lab's copies are older |
| Untracked, also present in alamelu | 48 | Yes | Already here |
| `.tmp-alpi-*.mjs` scratch scripts | 13 | No | Throwaway June debug scripts — discard |
| `apps/desktop/resources/alpi-icon.svg` | 1 | No | The superseded π icon, deliberately deleted by the logo change — **do not restore** |
| `packages/pi-sdk-driver/test/runtime-supervisor.test.mjs` | 1 | No | Tests the SDK driver this fork does not have — discard |

**Decisive evidence that nothing is owed:** every uncommitted lab path has an mtime of **2026-06-27 or earlier**, and `SOURCE_SNAPSHOT.txt` records the copy into alamelu at **2026-07-01T03:48:49Z** from that working tree. All of it is therefore already in alamelu's initial commit.

**CI:** the lab holds the only tracked workflows (`ci.yml` 68 lines, `release.yml` 164). `release.yml` contradicts the no-release ruling. `ci.yml` would be scope expansion and was **not** imported — recorded for the owner.

**The lab repo was not deleted.** Recommendation: it is fully superseded and safe to archive, but that is the owner's call.

## Verification

```
pnpm install                                   clean
tsc --noEmit (renderer + electron)             EXIT 0 / EXIT 0
pnpm --filter @alamelu-pi/desktop build        ✓ built
node --test apps/desktop/tests/unit/*          71 pass / 0 fail
pnpm --filter @alamelu-pi/pi-rpc-driver test   58 pass / 0 fail
branded e2e (ux-repair.spec.ts)                4 passed
package:dir  → release-alpi/mac-arm64/alpi.app produced
test:prod:packaged-smoke                       1 passed — the packaged bundle
                                               launches and starts a real thread
FINAL HYGIENE GATE
git grep -nE "Matthew Lam|minghinmatthewlam" -- ':!LICENSE' ':!documents/…'
                                               zero hits
```

## Two things found mid-implementation

**1. pi updated itself to 0.82.1 and fixed the tool-call-id bug upstream.** Its new `normalizeToolCallId` folds the item id into the normalised id and hashes on overflow. Verified against the exact ids from the 2026-07-24 failure: the three siblings now produce distinct, ≤40-char, wire-legal ids. **Our self-healing patcher refused to touch the changed source** (state `drifted`) rather than corrupting it — the safety design working unrehearsed. Both the patcher and the switch preflight now recognise a new `fixed-upstream` state as collision-safe, so pi's own fix is never overwritten and model switches are not falsely blocked. Our patch is effectively retired while remaining available if pi ever regresses.

**2. Deleting `apps/website` exposed an undeclared test dependency.** `@playwright/test` was never declared by the desktop package — it arrived as an *optional peer dependency of Next.js* from the website and pnpm hoisted it, so the e2e lane resolved it by accident. Now a proper devDependency of the package that uses it.
