import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const configPath = path.resolve('apps/desktop/electron-builder.alpi.yml');

test('Alamelu Pi electron-builder config is separate and uses alpi executable', () => {
  assert.equal(existsSync(configPath), true, 'missing apps/desktop/electron-builder.alpi.yml');
  const config = readFileSync(configPath, 'utf8');
  assert.match(config, /^productName: Alamelu Pi$/m);
  assert.match(config, /^appId: com\.alamelu\.pi$/m);
  assert.match(config, /^electronVersion: 39\.8\.10$/m);
  assert.match(config, /^  output: release-alpi$/m);
  assert.match(config, /^artifactName: alpi-\$\{version\}-\$\{arch\}\.\$\{ext\}$/m);
  assert.match(config, /^  executableName: alpi$/m);
  assert.match(config, /^  icon: resources\/alpi-icon\.icns$/m);
  assert.match(
    config,
    /^extraResources:\n  - from: resources\/alpi-icon\.png\n    to: icon\.png\n  - from: resources\/alpi-luna-websocket-recovery\.ts\n    to: extensions\/alpi-luna-websocket-recovery\.ts$/m,
  );
  assert.match(config, /^publish: null$/m);
});

test('desktop package exposes Alamelu Pi packaging scripts', () => {
  const pkg = JSON.parse(readFileSync(path.resolve('apps/desktop/package.json'), 'utf8'));
  assert.equal(pkg.scripts['package:alpi:dir'], 'node scripts/package-alpi-dir.mjs');
  assert.equal(pkg.scripts['package:alpi'], 'node scripts/package-alpi-dir.mjs');
});
