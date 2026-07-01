import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(testDir, '../../electron/external-pi-model-parser.ts');
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
const tempModuleDir = mkdtempSync(path.join(tmpdir(), 'external-pi-parser-module-'));
const tempModulePath = path.join(tempModuleDir, 'external-pi-model-parser.mjs');
writeFileSync(tempModulePath, transpiled, 'utf8');

after(() => {
  rmSync(tempModuleDir, { recursive: true, force: true });
});

const { parsePiListModels } = await import(path.toNamespacedPath(tempModulePath));

test('parses full pi --list-models output rows', () => {
  const rows = parsePiListModels(`
provider      model                                               context  max-out  thinking  images
anthropic     claude-3-5-haiku-20241022                           200K     8.2K     no        yes
openai-codex  gpt-5.5                                             400K     128K     yes       yes
`);

  assert.deepEqual(rows, [
    {
      providerId: 'anthropic',
      modelId: 'claude-3-5-haiku-20241022',
      reasoning: false,
      supportsImages: true,
    },
    {
      providerId: 'openai-codex',
      modelId: 'gpt-5.5',
      reasoning: true,
      supportsImages: true,
    },
  ]);
});

test('parses provider-scoped z.ai output including glm-5.2', () => {
  const rows = parsePiListModels(`
provider    model                   context  max-out  thinking  images
zai         glm-5-turbo             262.1K   131.1K   yes       no
zai         glm-5.1                 200K     65.5K    yes       no
zai         glm-5.2                 1M       65.5K    yes       no
`);

  assert.equal(rows.some((row) => row.providerId === 'zai' && row.modelId === 'glm-5.2'), true);
  assert.equal(rows.find((row) => row.modelId === 'glm-5.2')?.reasoning, true);
  assert.equal(rows.find((row) => row.modelId === 'glm-5.2')?.supportsImages, false);
});

test('parses custom provider and slash-containing model ids', () => {
  const rows = parsePiListModels(`
provider      model                            context  max-out  thinking  images
backup-llama  qwen/custom-router              128K     8K       no        no
openrouter    z-ai/glm-5.1                    202.8K   4.1K     yes       no
`);

  assert.deepEqual(rows.map((row) => `${row.providerId}/${row.modelId}`), [
    'backup-llama/qwen/custom-router',
    'openrouter/z-ai/glm-5.1',
  ]);
});
