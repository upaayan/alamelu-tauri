import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('desktop lab uses Electron 39 or newer', () => {
  const pkg = require('../../package.json');
  const declared = pkg.devDependencies?.electron ?? '';
  assert.match(declared, /(?:\^|~|>=)?(?:39|[4-9]\d)\./, `declared electron version should target 39+, got ${declared}`);

  const electronPath = require('electron');
  const version = execFileSync(electronPath, ['--version'], { encoding: 'utf8' }).trim().replace(/^v/, '');
  const major = Number(version.split('.')[0]);
  assert.ok(major >= 39, `installed Electron should be 39+, got ${version}`);
});
