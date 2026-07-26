import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import ts from "typescript";

const sourcePath = path.resolve("apps/desktop/electron/model-switch-preflight.ts");
const transpiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    verbatimModuleSyntax: true,
  },
  fileName: sourcePath,
}).outputText;
const tempModuleDir = mkdtempSync(path.join(tmpdir(), "model-switch-preflight-module-"));
const tempModulePath = path.join(tempModuleDir, "model-switch-preflight.mjs");
writeFileSync(tempModulePath, transpiled, "utf8");

after(() => {
  rmSync(tempModuleDir, { recursive: true, force: true });
});

const { evaluateModelSwitch } = await import(path.toNamespacedPath(tempModulePath));

const NO_COLLISION = { estTokens: 1000, hasCollidingToolCallIds: false };
const COLLIDING = {
  estTokens: 1000,
  hasCollidingToolCallIds: true,
  historyProvider: "xai",
  historyModelId: "grok-4.5",
};

test("allows a switch that fits and has no colliding history", () => {
  const decision = evaluateModelSwitch(NO_COLLISION, { providerId: "xai", modelId: "grok-4.5", contextWindow: 500000 }, false);
  assert.equal(decision.verdict, "ok");
});

test("blocks a thread that exceeds the target context window", () => {
  const decision = evaluateModelSwitch(
    { estTokens: 40000, hasCollidingToolCallIds: false },
    { providerId: "backup-llama", modelId: "gemma4-e4b-qat-q4xl", contextWindow: 32768 },
    false,
  );
  assert.equal(decision.verdict, "block");
  assert.match(decision.reason ?? "", /too long/i);
});

test("allows a thread just inside the 0.9 safety factor", () => {
  const decision = evaluateModelSwitch(
    { estTokens: 29000, hasCollidingToolCallIds: false },
    { providerId: "backup-llama", modelId: "small", contextWindow: 32768 },
    false,
  );
  assert.equal(decision.verdict, "ok");
});

test("never blocks on size when the context window is unknown", () => {
  const decision = evaluateModelSwitch(
    { estTokens: 5_000_000, hasCollidingToolCallIds: false },
    { providerId: "mystery", modelId: "unknown" },
    false,
  );
  assert.equal(decision.verdict, "ok");
});

test("blocks colliding tool history against a chat-completions target", () => {
  const decision = evaluateModelSwitch(
    COLLIDING,
    { providerId: "deepseek", modelId: "deepseek-v4-flash", api: "openai-completions", contextWindow: 1000000 },
    false,
  );
  assert.equal(decision.verdict, "block");
});

test("warns instead of blocking once the pi-ai patch is applied", () => {
  const decision = evaluateModelSwitch(
    COLLIDING,
    { providerId: "deepseek", modelId: "deepseek-v4-flash", api: "openai-completions", contextWindow: 1000000 },
    true,
  );
  assert.equal(decision.verdict, "warn");
});

test("never blocks a switch back to the model that wrote the history", () => {
  const decision = evaluateModelSwitch(
    { ...COLLIDING, historyProvider: "deepseek", historyModelId: "deepseek-v4-flash" },
    { providerId: "deepseek", modelId: "deepseek-v4-flash", api: "openai-completions", contextWindow: 1000000 },
    false,
  );
  assert.equal(decision.verdict, "ok");
});

test("does not block colliding history against a responses-API target", () => {
  const decision = evaluateModelSwitch(
    COLLIDING,
    { providerId: "openai-codex", modelId: "gpt-5.6-sol", api: "openai-responses", contextWindow: 272000 },
    false,
  );
  assert.equal(decision.verdict, "ok");
});

test("does not block when the target api family is unknown", () => {
  const decision = evaluateModelSwitch(COLLIDING, { providerId: "mystery", modelId: "unknown" }, false);
  assert.equal(decision.verdict, "ok");
});

test("blocks a provider with no credential at all", () => {
  const decision = evaluateModelSwitch(NO_COLLISION, { providerId: "mistral", modelId: "large", connected: false }, false);
  assert.equal(decision.verdict, "block");
  assert.match(decision.reason ?? "", /not connected/i);
});

test("lets a connected-but-expired provider through (run-time error explains it)", () => {
  const decision = evaluateModelSwitch(NO_COLLISION, { providerId: "openai-codex", modelId: "gpt-5.6-sol", connected: true }, false);
  assert.equal(decision.verdict, "ok");
});

/* ── readThreadStats: the JSONL feeder behind rule (b) ─────────────────── */

const { readThreadStats } = await import(path.toNamespacedPath(tempModulePath));

function writeSession(dir, sessionId, lines) {
  const file = path.join(dir, `2026-07-26T10-00-00-000Z_${sessionId}.jsonl`);
  writeFileSync(file, lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n"), "utf8");
  return file;
}

function toolCallTurn(ids) {
  return {
    message: { role: "assistant", content: ids.map((id) => ({ type: "toolCall", id })) },
  };
}

test("readThreadStats detects tool-call ids that collide after truncation", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "thread-stats-collide-"));
  writeSession(dir, "collide", [
    { type: "model_change", provider: "xai", modelId: "grok-4.5" },
    toolCallTurn([
      "call-cadbc1ea-fd79-4982-ba1a-60a9fad1c089-0|fc_a",
      "call-cadbc1ea-fd79-4982-ba1a-60a9fad1c089-1|fc_b",
    ]),
  ]);
  const stats = readThreadStats(dir, "collide");
  assert.equal(stats.hasCollidingToolCallIds, true);
  assert.equal(stats.historyProvider, "xai");
  assert.equal(stats.historyModelId, "grok-4.5");
  assert.ok(stats.estTokens > 0);
  rmSync(dir, { recursive: true, force: true });
});

test("readThreadStats reports no collision when truncated ids stay distinct", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "thread-stats-distinct-"));
  writeSession(dir, "distinct", [
    toolCallTurn(["call-short-a|fc_a", "call-short-b|fc_b"]),
  ]);
  assert.equal(readThreadStats(dir, "distinct").hasCollidingToolCallIds, false);
  rmSync(dir, { recursive: true, force: true });
});

test("readThreadStats ignores non-composite ids, which pi never truncates", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "thread-stats-plain-"));
  writeSession(dir, "plain", [
    toolCallTurn(["toolu_01aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "toolu_01aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab"]),
  ]);
  assert.equal(readThreadStats(dir, "plain").hasCollidingToolCallIds, false);
  rmSync(dir, { recursive: true, force: true });
});

test("readThreadStats skips malformed lines instead of throwing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "thread-stats-malformed-"));
  writeSession(dir, "malformed", [
    "{ not json at all",
    "",
    toolCallTurn(["call-cadbc1ea-fd79-4982-ba1a-60a9fad1c089-0|fc_a", "call-cadbc1ea-fd79-4982-ba1a-60a9fad1c089-1|fc_b"]),
  ]);
  assert.equal(readThreadStats(dir, "malformed").hasCollidingToolCallIds, true);
  rmSync(dir, { recursive: true, force: true });
});

test("readThreadStats returns zeroed stats for a missing session", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "thread-stats-missing-"));
  const stats = readThreadStats(dir, "nope");
  assert.equal(stats.estTokens, 0);
  assert.equal(stats.hasCollidingToolCallIds, false);
  rmSync(dir, { recursive: true, force: true });
});

test("readThreadStats refuses a traversal-shaped session id", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "thread-stats-traversal-"));
  const stats = readThreadStats(dir, "../escape");
  assert.equal(stats.estTokens, 0);
  rmSync(dir, { recursive: true, force: true });
});
