import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import ts from "typescript";
import { pathToFileURL } from "node:url";

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

const { evaluateModelSwitch } = await import(pathToFileURL(tempModulePath).href);

const FITS = { estTokens: 1000 };

test("allows a switch that fits", () => {
  const decision = evaluateModelSwitch(FITS, { providerId: "xai", modelId: "grok-4.5", contextWindow: 500000 });
  assert.equal(decision.verdict, "ok");
});

test("blocks a thread that exceeds the target context window", () => {
  const decision = evaluateModelSwitch(
    { estTokens: 40000 },
    { providerId: "backup-llama", modelId: "gemma4-e4b-qat-q4xl", contextWindow: 32768 },
  );
  assert.equal(decision.verdict, "block");
  assert.match(decision.reason ?? "", /too long/i);
});

test("allows a thread just inside the 0.9 safety factor", () => {
  const decision = evaluateModelSwitch(
    { estTokens: 29000 },
    { providerId: "backup-llama", modelId: "small", contextWindow: 32768 },
  );
  assert.equal(decision.verdict, "ok");
});

test("never blocks on size when the context window is unknown", () => {
  const decision = evaluateModelSwitch(
    { estTokens: 5_000_000 },
    { providerId: "mystery", modelId: "unknown" },
  );
  assert.equal(decision.verdict, "ok");
});

test("blocks a provider with no credential at all", () => {
  const decision = evaluateModelSwitch(FITS, { providerId: "mistral", modelId: "large", connected: false });
  assert.equal(decision.verdict, "block");
  assert.match(decision.reason ?? "", /not connected/i);
});

test("lets a connected-but-expired provider through (run-time error explains it)", () => {
  const decision = evaluateModelSwitch(FITS, { providerId: "openai-codex", modelId: "gpt-5.6-sol", connected: true });
  assert.equal(decision.verdict, "ok");
});

/* ── readThreadStats: the active-context estimate ──────────────────────── */

const { readThreadStats } = await import(pathToFileURL(tempModulePath).href);

function writeSession(dir, sessionId, lines) {
  const file = path.join(dir, `2026-07-26T10-00-00-000Z_${sessionId}.jsonl`);
  writeFileSync(file, lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n"), "utf8");
  return file;
}

test("repeated compactions measure fresh Pi context, not the retained archive", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "thread-stats-compactions-"));
  try {
    writeSession(dir, "compacted", [
      { type: "message", id: "old", message: { role: "user", content: "x".repeat(4_400_000) } },
      { type: "compaction", id: "c1", summary: "First summary", firstKeptEntryId: "tail" },
      { type: "message", id: "tail", message: { role: "user", content: "Retained turn" } },
      { type: "compaction", id: "c2", summary: "Second summary", firstKeptEntryId: "tail2" },
    ]);
    const target = { providerId: "cursor", modelId: "small", contextWindow: 32768 };
    for (const summary of ['First summary', 'Second summary']) {
      const messages = [{ role: 'compactionSummary', summary }, { role: 'user', content: 'Retained turn' }];
      const stats = readThreadStats(dir, 'compacted', messages);
      assert.ok(stats.estTokens > 0 && stats.estTokens < 100);
      assert.equal(evaluateModelSwitch(stats, target).verdict, 'ok');
    }
    const grown = readThreadStats(dir, 'compacted', [{ role: 'user', content: 'x'.repeat(160000) }]);
    assert.equal(evaluateModelSwitch(grown, target).verdict, 'block');
    const unknown = readThreadStats(dir, 'compacted');
    assert.equal(evaluateModelSwitch(unknown, target).verdict, 'ok');
  } finally { rmSync(dir, {recursive:true,force:true}); }
});

test('active estimate counts model content, excluding usage metadata and base64 size', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'thread-stats-content-'));
  try {
    writeSession(dir, 'content', []);
    const messages = [
      {role:'user',content:[{type:'text',text:'abcd'},{type:'image',data:'x'.repeat(500000)}]},
      {role:'assistant',content:[{type:'thinking',thinking:'abcd'},{type:'toolCall',name:'read',arguments:{path:'a'}}], usage:{totalTokens:9999999}},
      {role:'toolResult',content:[{type:'text',text:'abcd'}],details:{debug:'x'.repeat(100000)}},
      {role:'custom',content:'abcd'}, {role:'branchSummary',summary:'abcd'},
      {role:'bashExecution',command:'echo',output:'abcd'},
    ];
    const stats = readThreadStats(dir,'content',messages);
    assert.ok(stats.estTokens > 1200 && stats.estTokens < 1300);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
