import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';

const configPath = path.resolve('apps/desktop/electron-builder.alpi.yml');

test('Alamelu Pi electron-builder config is separate and uses alpi executable', () => {
  assert.equal(existsSync(configPath), true, 'missing apps/desktop/electron-builder.alpi.yml');
  const config = yaml.load(readFileSync(configPath, 'utf8'));
  assert.equal(config.productName, 'Alamelu Pi');
  assert.equal(config.appId, 'com.alamelu.pi');
  assert.equal(config.electronVersion, '39.8.10');
  assert.equal(config.directories.output, 'release-alpi');
  assert.equal(config.artifactName, 'alpi-${version}-${arch}.${ext}');
  assert.equal(config.mac.executableName, 'alpi');
  assert.equal(config.mac.icon, 'resources/alpi-icon.icns');
  assert.equal(config.extraResources[0].from, 'resources/alpi-icon.png');
  assert.equal(config.extraResources[0].to, 'icon.png');
  assert.equal(config.publish, null);
});

test('desktop package exposes Alamelu Pi packaging scripts', () => {
  const pkg = JSON.parse(readFileSync(path.resolve('apps/desktop/package.json'), 'utf8'));
  assert.match(pkg.scripts['package:alpi:dir'], /electron-builder --mac --dir/);
  assert.match(pkg.scripts['package:alpi:dir'], /electron-builder\.alpi\.yml/);
  assert.match(pkg.scripts['package:alpi'], /electron-builder --mac/);
  assert.match(pkg.scripts['package:alpi'], /electron-builder\.alpi\.yml/);
});
