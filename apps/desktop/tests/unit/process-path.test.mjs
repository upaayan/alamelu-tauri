import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import ts from 'typescript';

const sourcePath = path.resolve('apps/desktop/electron/process-path.ts');
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
const tempModuleDir = mkdtempSync(path.join(tmpdir(), 'process-path-module-'));
const tempModulePath = path.join(tempModuleDir, 'process-path.mjs');
writeFileSync(tempModulePath, transpiled, 'utf8');

after(() => {
  rmSync(tempModuleDir, { recursive: true, force: true });
});

const {
  buildPackagedAppPath,
  normalizeProcessPathForPackagedApp,
  splitPath,
  uniquePathEntries,
} = await import(path.toNamespacedPath(tempModulePath));

test('splitPath trims empty entries', () => {
  assert.deepEqual(splitPath(`/usr/bin${path.delimiter}${path.delimiter} /bin `), ['/usr/bin', '/bin']);
});

test('uniquePathEntries preserves first occurrence', () => {
  assert.deepEqual(uniquePathEntries(['/a', '/b', '/a', '/c', '/b']), ['/a', '/b', '/c']);
});

test('buildPackagedAppPath prepends existing executable dirs for Finder-style PATH', () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'process-path-test-'));
  const piBinDir = path.join(tempRoot, 'agent-bin');
  const homebrewDir = path.join(tempRoot, 'homebrew-bin');
  const missingDir = path.join(tempRoot, 'missing-bin');
  const piBin = path.join(piBinDir, 'pi');
  rmSync(tempRoot, { recursive: true, force: true });
  const existing = new Set([piBinDir, homebrewDir]);

  const normalized = buildPackagedAppPath({
    currentPath: `/usr/bin${path.delimiter}/bin${path.delimiter}/usr/bin`,
    homeDir: tempRoot,
    piBin,
    candidateDirs: [homebrewDir, missingDir],
    exists: (entry) => existing.has(entry),
  });

  assert.deepEqual(normalized.split(path.delimiter), [piBinDir, homebrewDir, '/usr/bin', '/bin']);
});

test('normalizeProcessPathForPackagedApp updates only the provided env object', () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'process-path-env-test-'));
  const piBinDir = path.join(tempRoot, 'pi-bin');
  const extraDir = path.join(tempRoot, 'extra-bin');
  const env = { PATH: '/usr/bin:/bin' };
  const normalized = normalizeProcessPathForPackagedApp({
    env,
    currentPath: env.PATH,
    homeDir: tempRoot,
    piBin: path.join(piBinDir, 'pi'),
    candidateDirs: [extraDir],
    exists: (entry) => entry === piBinDir || entry === extraDir,
  });

  assert.equal(env.PATH, normalized);
  assert.deepEqual(normalized.split(path.delimiter), [piBinDir, extraDir, '/usr/bin', '/bin']);
});
