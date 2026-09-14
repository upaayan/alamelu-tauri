// Guard the integration wiring as well as the behavior tests in the build gate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const json = (name) => JSON.parse(read(name));

test('model switch passes freshly awaited Pi messages to the estimator', () => {
  assert.match(read('apps/desktop/electron/app-store-composer.ts'), /const activeMessages = await store\.driver\.getSessionContextMessages\?\.\(sessionRef\);\s*const stats = readThreadStats\(store\.sessionDir, sessionRef\.sessionId, activeMessages\)/);
  assert.match(read('apps/desktop/electron/rpc-desktop-driver.ts'), /return this\.rpc\.getSessionContextMessages\(sessionRef\)/);
});

test('Tauri packaging and backend rebuilds schedule the gate', () => {
  const scripts = json('apps/desktop/package.json').scripts;
  assert.match(scripts['build:tauri:backend'], /^pnpm --dir \.\.\/\.\. run verify:upgrade &&/);
  assert.match(scripts['build:tauri:assets'], /pnpm run build:tauri:backend/);
  assert.equal(json('apps/desktop/src-tauri/tauri.conf.json').build.beforeBuildCommand, 'pnpm run build:tauri:assets');
  const workflow = read('.github/workflows/native-build.yml');
  for (const job of ['macos-apple-silicon', 'windows-amd64']) {
    assert.match(workflow, new RegExp(`  ${job}:\\r?\\n    needs: compatibility`));
  }
  assert.match(workflow, /uses: \.\/\.github\/workflows\/upgrade-compatibility.yml/);
});

test('Tauri packages retain the standalone recovery kit', () => {
  const resources = json('apps/desktop/src-tauri/tauri.conf.json').bundle.resources;
  for (const name of ['documents/REBUILD-PROTECTION.md', 'documents/PI-UPGRADE-WINDOWS.md', 'scripts/check-cursor-compaction.py', 'scripts/check-pi-app-extension.py', 'scripts/test-upgrade-protection.py', 'maintenance/pi-cursor-sdk/']) {
    assert.equal(resources[`../../../${name}`], `maintenance-kit/${name}`);
  }
});
