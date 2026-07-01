import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import ts from 'typescript';

const sourcePath = path.resolve('apps/desktop/electron/thread-title-summary.ts');
const source = readFileSync(sourcePath, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    verbatimModuleSyntax: true,
  },
  fileName: sourcePath,
}).outputText;
const tempModuleDir = mkdtempSync(path.join(tmpdir(), 'thread-title-summary-module-'));
const tempModulePath = path.join(tempModuleDir, 'thread-title-summary.mjs');
writeFileSync(tempModulePath, transpiled, 'utf8');

after(() => {
  rmSync(tempModuleDir, { recursive: true, force: true });
});

const { summarizeThreadTitleFromPrompt } = await import(path.toNamespacedPath(tempModulePath));

test('summarizes the first sentence from a prompt', () => {
  assert.equal(
    summarizeThreadTitleFromPrompt('Evaluate Grok MCP Search. Then compare it with the existing web search.'),
    'Evaluate Grok MCP Search',
  );
});

test('uses the second sentence when the first is too short', () => {
  assert.equal(
    summarizeThreadTitleFromPrompt('OK. Please fix the thread title bug.'),
    'OK Please fix the thread title bug',
  );
});

test('strips common greeting lines before summarizing', () => {
  assert.equal(
    summarizeThreadTitleFromPrompt('Hey Codex,\nLook at the repo and diagnose the Alamelu Pi sidebar.'),
    'Look at the repo and diagnose the...',
  );
});

test('strips markdown markers and code fences', () => {
  assert.equal(
    summarizeThreadTitleFromPrompt('# Plan\n- Fix the provider picker\n```ts\nconst x = 1;\n```'),
    'Plan Fix the provider picker',
  );
});

test('returns null for blank prompts and slash-command-only prompts', () => {
  assert.equal(summarizeThreadTitleFromPrompt('   \n\t'), null);
  assert.equal(summarizeThreadTitleFromPrompt('/name'), null);
});

