import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import ts from "typescript";

const sourcePath = path.resolve("apps/desktop/electron/user-facing-errors.ts");
const transpiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    verbatimModuleSyntax: true,
  },
  fileName: sourcePath,
}).outputText;
const tempModuleDir = mkdtempSync(path.join(tmpdir(), "user-facing-errors-module-"));
const tempModulePath = path.join(tempModuleDir, "user-facing-errors.mjs");
writeFileSync(tempModulePath, transpiled, "utf8");

after(() => {
  rmSync(tempModuleDir, { recursive: true, force: true });
});

const { describeError } = await import(path.toNamespacedPath(tempModulePath));

test("explains the duplicate tool-call-id 400 without jargon", () => {
  const raw = `400: {"message":"Duplicate value for 'tool_call_id' of call-abc in message[3]","type":"invalid_request_error"}`;
  const described = describeError(raw);
  assert.match(described.headline, /tool history/i);
  assert.doesNotMatch(described.headline, /tool_call_id|invalid_request_error/);
  assert.equal(described.detail, raw);
});

test("reports context overflow with both numbers", () => {
  const described = describeError("400 request (238155 tokens) exceeds the available context size (32768 tokens), try increasing it");
  assert.match(described.headline, /238,155/);
  assert.match(described.headline, /32,768/);
});

test("names the provider whose login expired", () => {
  const described = describeError("OAuth refresh failed for anthropic");
  assert.match(described.headline, /anthropic/);
  assert.match(described.headline, /Settings → Providers/);
});

test("names a provider that is not connected", () => {
  const described = describeError("No API key for provider: openai-codex");
  assert.match(described.headline, /openai-codex/);
  assert.match(described.headline, /Settings → Providers/);
});

test("turns re-entrant prompt jargon into a wait message", () => {
  const described = describeError("RPC session is already running; re-entrant prompts are not supported by the prototype");
  assert.match(described.headline, /still finishing/i);
  assert.doesNotMatch(described.headline, /RPC|prototype/);
});

test("does not leak the session key in the not-open message", () => {
  const described = describeError("RPC session is not open: /Users/someone/repo:019f-abc");
  assert.doesNotMatch(described.headline, /019f-abc|\/Users/);
  assert.match(described.detail ?? "", /019f-abc/);
});

test("explains a worktree rejection and reassures about the prompt", () => {
  const described = describeError("Worktree threads are not supported by the RPC desktop prototype.");
  assert.match(described.headline, /prompt was kept/i);
});

test("keeps short unknown errors verbatim with no detail", () => {
  const described = describeError("Something odd happened");
  assert.equal(described.headline, "Something odd happened");
  assert.equal(described.detail, undefined);
});

test("truncates long unknown errors but preserves the full text", () => {
  const raw = `${"x".repeat(400)}`;
  const described = describeError(raw);
  assert.ok(described.headline.length < raw.length);
  assert.equal(described.detail, raw);
});

test("handles empty input without throwing", () => {
  assert.equal(describeError("").headline, "Something went wrong.");
});
