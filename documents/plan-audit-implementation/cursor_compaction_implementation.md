# Cursor compaction and active-context model switching — implementation

Owner approved adapter fix after Plan Audit Round 2 PASS, then explicitly added the archive-size model-switch bug. Keep original conversation, Pi/auth/settings and other agents' work intact. No Pi or Rust build.

## Verification Round 1 — adapter

Private rollback and live evidence: `/Users/sudhirjha/.pi/agent/backups/cursor-compaction-implementation-qrgjrw_u`. `source-before/` contains the pre-edit adapter source.

Changes: omitted Pi tools normalize to an empty set in `cursor-context-tools.ts`; local turn preparation passes `disablePiToolBridge` when that set is empty; session-agent creation skips registered bridge creation for that call. This is the smaller equivalent option verified by Fable Plan Round 2. Existing native router/drain and lifecycle consume the normalized set; no new lifecycle hooks, prompt changes, empty-summary policy or dependency upgrades.

- Red: native routing/drain reproducer failed 2 of 8 cases, demonstrating omitted tools queue replay and return `tool_use` early.
- Red: prepare/bridge reproducer failed 5 of 6 cases: summary acquired live bridge.
- Green: `npx vitest run`: 43 tests passed in 6 files (29 existing +14 new). `npx tsc --noEmit`: passed.
- Live manual: first attempt against freshly recovered checkpoint correctly returned “Nothing to compact”; no production failure. Rebuilt a private bounded session with Pi SessionManager and `convertToLlm` from the recovered 45-message context (124,617 serialized characters), leaving the owner session untouched. Real `cursor/grok-4.6:fast` compaction PASSED; summary provider result `stop`, content thinking/text, no toolCall; 41,709 input tokens. Following normal prompt used `read` on fixture.txt and returned `COMPACTION_FIXTURE_OK`.
- Live automatic: isolated settings threshold on a second copy triggered `compaction_start reason=threshold`, completed successfully, then returned `AUTO_COMPACTION_OK`. Debug final summaries were nonempty finished text with no toolCall. Observer recorded no Pi tool execution during either summary.
- Test isolation: only explicit candidate SDK adapter and test observer extension loaded; private agent config/auth copies; no global settings changes. Observer provided a Pi bridge probe tool, never executed during summaries. Full private RPC/SDK artifacts under `manual/` and `automatic/`. Initial isolated catalog default was 200k; SDK response updated it to256k. Fixtures fit either value.

## Model-switch correction — approved addition

Root cause reproduced: original saved JSONL has 4,529,612 JS characters; old readThreadStats divides by4, yielding1,132,403 tokens. It includes old compacted history and metadata. Active branch was242,636 before backend recovery. Plan Round3 reviews fetching the current context through Pi get_messages and estimating model content only. Two new preflight tests fail on old behavior (repeated compactions; content-vs-metadata).

## Deployment status

Installed on Mac on 2026-09-14 after Fable Implementation Audit Round1 PASS. Post-install packaged smoke and original-task reopen verified; see Deployment Round1 below. No Rust/Pi build performed.

## Verification Round2 — model-switch backend and candidate

Production changes: optional driver `getSessionContextMessages` requests current Pi `get_messages`, forwarded through RpcDesktopDriver; async preflight uses that array. Estimate covers model content and fixed image cost, excludes archived JSON/usage/details; absent context is unknown. Failed/malformed/throwing context reads return undefined. Existing auth and tool-ID checks remain. No branch reconstruction or Pi dependency was introduced.

- Preflight tests19/19 PASS, including4.4MB accumulated archive, successive compacted contexts, genuinely oversized current context, and image/metadata treatment.
- Entire Pi RPC driver suite78/78 PASS; added throwing-transport case afterward and targeted tree/compact file9/9 PASS (79 total tests now).
- Desktop typecheck PASS; JavaScript backend build PASS; `git diff --check` clean.
- Candidate `/Applications/Alamelu Pi Tauri.compaction-candidate.app` is copied from installed app, with only backend/main.cjs replaced. Ad-hoc signing preserved, codesign deep/strict PASS. Packaged Tauri smoke PASS (47 providers,733 models,91 API members) with isolated state.
- Rust code proof: signature-stripped copies differ in exactly one byte: __LINKEDIT segment vmsize (signature allocation alignment), offset2914. All29 Mach-O sections match exactly. After normalizing only that allocation field, all remaining signature-stripped bytes match. No Rust compiler ran. Evidence `/Users/sudhirjha/.pi/agent/backups/cursor-compaction-implementation-qrgjrw_u/rust-section-verification.json` and `candidate-app.json`.
- Core model-picker regression is underway against baseline bundle. Harness prerequisites discovered: set PI_GUI_PI_BIN to installed dist/cli.js (helper cannot resolve shell wrapper); explicit PI_GUI_DRIVER=rpc and PI_GUI_BRAND=alpi; private fixture must seed the RPC catalog as well as session file. These are test setup corrections only; no global launcher/harness defaults changed.

## Verification Round3 — real model-picker regression

- Baseline Electron bundle reproduced the owner-visible block: “This thread is about 1,100,447 tokens — too long for gpt-4o (128,000)” on a tiny active context after two checkpoints. Screenshot/trace retained in private evidence `model-switch-baseline-ui/`. Earlier attempts failed on fixture setup and a hidden sidebar row; those are not counted as product regression evidence.
- Fixed Electron bundle: targeted `compacted-model-switch.spec.ts` PASS (1 test,7.2s), selecting GPT-4o through the visible composer picker, asserting its title becomes openai:gpt-4o and lastError is absent. Assertion uses the actual model badge title (the prior locator confused title with accessible name). No owner task or provider prompt was used.
- Commands: `pnpm --filter @alamelu-pi/desktop run build`; `PI_GUI_PI_BIN=/Users/sudhirjha/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js pnpm --filter @alamelu-pi/desktop run test:e2e:runner -- apps/desktop/tests/core/compacted-model-switch.spec.ts`.
- Simplicity review: three existing adapter production files, one optional driver seam, existing async caller and local content estimator. No Pi internals copied, dependencies upgraded, renderer changes or new lifecycle. Named self-test/simplify skills are absent from Codex-local skills/project; verification and direct simplicity review performed here instead.

Both fixes ready for combined Fable Implementation Audit Round1. Candidate and installed adapter remain separate pending review. Source types and behavior tested match the candidate backend already smoke-tested.

## Deployment Round1 — Mac complete (2026-09-14)

Fable Implementation Audit Round1 PASS, zero findings. Copied only the three reviewed TypeScript adapter files to `~/.pi/agent/npm/node_modules/pi-cursor-sdk/src`; this package loads source directly. Kept version0.1.60 and every other package file/config unchanged. Hash checks confirmed installed files still matched their original backups before copying and reviewed source after copying.

Installed the reviewed app candidate at `/Applications/Alamelu Pi Tauri.app`. Backend SHA256 `af14fa814ae294239522e8e136add88e7f9ecf186e75d3b033b84e42570ccf66`; Rust code/data unchanged as verified above. Ad-hoc codesign deep/strict PASS. App was closed at activation; no active owner run was interrupted.

- Installed packaged smoke PASS:47 providers,733 models,91 API members; isolated state and no leftover smoke children.
- Reopened real app on the original `I use Alamelu Pi (Electron ) and...` task, Cursor Grok4.6 fast/xhigh, transcript tail visible and idle composer. Historical compaction-failure cards remain in the transcript cache; these are old records, not failures from this installation.
- Checkpoint `2fc85aca`, retained tail boundary `4a091e84`, and complete recovered candidate prefix preserved. App appended one normal RepoMem `custom_message` entry `73cb5320` on reopening (2145 total entries); no recovery rewrite or owner prompt sent. All2141 original entries remain preserved.
- Pi auth/settings/models hashes unchanged. Fresh Grok reply in the owner's actual task remains untested; copied-session manual+automatic compactions and the following normal tool turn passed as above.
- Rollback app: `/Applications/Alamelu Pi Tauri.app.bak-compaction-20260914-215954`. Adapter original files: private evidence `source-before/`. Exact before/after file hashes: `deployment.json`; reopened-task evidence: `post-install-verification.json` and `installed-task-reopened.png` in the same private directory.
- Fable exited through `/exit`; exact owned tmux session absent. Owned critic temporary prompts/heartbeat removed after recording verdict and lifecycle. Evidence/backups retained. No commits, Windows/WSL changes, Pi rebuild or Rust compile.

## Maintenance note

A future adapter package reinstall can replace these local source fixes. Compare the three files named above with the editable `/Users/sudhirjha/playground/pi-cursor-sdk` source and rerun its two compaction test files before accepting an update. Keep the model-switch guard tied to fresh Pi `get_messages`; never restore JSONL file-size estimation. The app regression `apps/desktop/tests/core/compacted-model-switch.spec.ts` proves repeated checkpoints do not block a smaller model on a small active context. Use the CLI path/environment documented in Verification Round3 for that test. Roll back only with the app closed and do not restore a session backup over newer conversation history.

## Windows Verification Round1 — staged, 2026-09-14

Owner approved shipping equivalent fixes to Windows and cleaning task-owned relay/temp files. Local staging: `/var/folders/3g/1c_kpk4n6q9dm_w9sx1_y5lr0000gn/T/compaction-windows-4e05bucq`; remote rollback/evidence: `/home/ubuntu/.pi/agent/backups/compaction-windows-20260914`.

WSL adapter0.3.6 has the same omitted-tools/bridge defects. Exported only src/shared/package metadata through S3, applied the same three small edits to its own source, preserved all other behavior and dependencies. Fourteen compaction tests use the0.3.6 session-store test seam to stub its additional SDK store interface. Corrected-harness baseline:7 failures/7 passes; fixed:14/14 PASS. Initial attempts using Mac auth-recreate tests failed on absent Mac-only modules and the first compaction fixture lacked the newer SDK store stub; neither is counted as a product regression, and no unrelated Mac behavior was ported.

Real staged WSL Grok manual compaction PASS, followed by read fixture.txt and COMPACTION_FIXTURE_OK. Automatic compaction PASS with a threshold event and AUTO_COMPACTION_OK. Initial automatic fixture did not cross the actual256k window threshold; its required-compaction assertion failed correctly. Adjusted only the private reserve threshold to250000 and reran successfully. No production settings changed. Diagnostic event validation is recorded in staged-verification evidence.

Native Windows Node→wsl.exe→Pi baseline reproduced the1,100,409-token rejection of GPT-4o on a tiny active context after two compactions. The identical fixed Mac JavaScript bundle passed on Windows with its existing dependencies. Both isolated native backends exited0. Production executable/backend, settings/auth/models and owner sessions remain unchanged pending review/activation. Post-install native tool reply and preservation checks still required.

Windows verification correction: the initial native no-error check was insufficient. Inspecting persisted model history showed the fixture had not resumed because the existing WSL .bashrc changes cwd to lazytrade. Corrected the private fixture cwd to the documented actual WSL startup cwd; added a persisted-model-change assertion. No product/shell changes. Use native2.log and evidence3.log as final native proof, not the initial native.log. Fable Implementation Round2 is reviewing the Windows port while these checks finish.

## Windows Verification Round2 — runtime packaging correction

Fable CC-I2-01 caught that0.3.6 loads dist/index.js while Mac0.1.60 loads src/index.ts. Accepted before any production activation. Emitted the three changed TS modules with the existing local TypeScript compiler, target ES2022/module ESNext. All three ORIGINAL source emissions match installed WSL dist hashes byte-for-byte (dist-emission.json), establishing equivalent output. Candidate source+dist now contain the fix; every other module/manifest/dependency stays unchanged. Activation script backs up and checks all six files and the backend. Live manual/automatic verification now uses private settings.packages and no source-entry override; results in package-live.log/package-evidence.log supersede source-only live activation evidence. No Pi/Rust build.

## Windows Deployment Round1 — COMPLETE, 2026-09-14

Fable Implementation Round3 PASS. Trivial CC-I3-01 snapshot ordering corrected. Production activation at22:50 IST: checked original hashes, all owner tasks idle, closed Windows app gracefully, snapshotted seven owner-session files, backed up and installed three source+three compiled adapter files and backend/main.cjs. WSL adapter stays0.3.6 and Pi stays0.85.1 on its unbundled launcher. Windows executable, platform dependencies, authentication/settings/models and owner sessions preserved.

Installed native Windows Node→wsl.exe→Pi check PASSED: resumed the two-compaction fixture, persisted GPT-4o selection, switched to Cursor Grok, used the real read tool and returned WINDOWS_COMPACTION_TOOL_OK. Test backend exited0. The actual Windows app reopened with a visible Alamelu Pi window (PID25168 at verification). This is native backend integration plus window/process verification, not a Windows screenshot-based UI audit.

Both platforms' backend hash is af14fa814ae294239522e8e136add88e7f9ecf186e75d3b033b84e42570ccf66. Mac adapter0.1.60 source hashes were rechecked against its completed install. Windows0.3.6 source+dist hashes are in documents/release-evidence/compaction-windows-20260914/compatibility-status.json. That status record and PI-UPGRADE-WINDOWS.md were also copied to the remote private evidence directory and checked against the installed Windows backend.

Cleanup complete: removed this task's relay command/response/transfer/claim objects and verified zero remaining under its prefixes; removed five private Windows native test roots, private WSL test-agent/data directories and adapter candidate; zero test children remained. Fable exited and its owned tmux session was absent; owned critic/local staging directories removed. Exact cleanup count is in release-evidence/compaction-windows-20260914/cleanup.json.

Retained rollback: /home/ubuntu/.pi/agent/backups/compaction-windows-20260914/installed-before (six adapter files and old backend). Retained Windows reports/scripts/runbook in its parent. Local detailed evidence is archived at /Users/sudhirjha/.pi/agent/backups/compaction-windows-20260914; earlier temporary paths in this document/audit refer to the now-cleaned staging area. Reusable source/dist patches and compact release evidence are in documents/release-evidence/compaction-windows-20260914. No owner task prompt, Pi build, Rust build, package version change, auth/config overwrite, or Git commit.
