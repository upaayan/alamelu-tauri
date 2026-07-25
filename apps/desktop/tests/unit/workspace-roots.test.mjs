import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import ts from 'typescript';

const sourcePath = path.resolve('apps/desktop/src/workspace-roots.ts');
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
const tempModuleDir = mkdtempSync(path.join(tmpdir(), 'workspace-roots-module-'));
const tempModulePath = path.join(tempModuleDir, 'workspace-roots.mjs');
writeFileSync(tempModulePath, transpiled, 'utf8');

after(() => {
  rmSync(tempModuleDir, { recursive: true, force: true });
});

const {
  isNoRepositoryWorkspace,
  isSystemWorkspace,
  isSystemWorkspacePathOrName,
} = await import(path.toNamespacedPath(tempModulePath));

test('classifies Alpi helper workspace names as system workspaces', () => {
  assert.equal(isSystemWorkspacePathOrName('alpi-provider-login-workspace-abc123'), true);
  assert.equal(isSystemWorkspacePathOrName('alpi-state-workspace-XjBLYL'), true);
  assert.equal(isSystemWorkspacePathOrName('/tmp/alpi-provider-login-workspace-abc123'), true);
  assert.equal(isSystemWorkspacePathOrName('/tmp/nested/alpi-state-workspace-XjBLYL'), true);
  assert.equal(
    isSystemWorkspacePathOrName('/Users/sudhirjha/Library/Application Support/Alamelu Pi/workspace'),
    true,
  );
});

test('does not classify user project or no-repository names as system workspaces', () => {
  assert.equal(isSystemWorkspacePathOrName('alamelu'), false);
  assert.equal(isSystemWorkspacePathOrName('/Users/sudhirjha/playground/lazydata'), false);
  assert.equal(isSystemWorkspacePathOrName('/Users/sudhirjha/playground/workspace'), false);
  assert.equal(isSystemWorkspacePathOrName('No Repository'), false);
});

test('distinguishes no-repository and system workspace records', () => {
  assert.equal(isNoRepositoryWorkspace({ specialKind: 'no-repository' }), true);
  assert.equal(isNoRepositoryWorkspace({ specialKind: 'system' }), false);
  assert.equal(isSystemWorkspace({ specialKind: 'system' }), true);
  assert.equal(isSystemWorkspace({ specialKind: 'no-repository' }), false);
});
