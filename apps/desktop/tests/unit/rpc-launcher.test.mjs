import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const launcherPath = path.resolve('scripts/run-rpc-gui-lab.sh');
const repairPath = path.resolve('scripts/repair-electron-dist.mjs');

test('RPC GUI lab launcher and Electron repair script exist', () => {
  assert.equal(Boolean(statSync(launcherPath).mode & 0o111), true);
  assert.equal(readFileSync(repairPath, 'utf8').includes('electron-v${electronVersion}'), true);
});

test('RPC GUI lab launcher uses isolated RPC paths and refuses production state', () => {
  const text = readFileSync(launcherPath, 'utf8');
  for (const token of [
    'PI_GUI_DRIVER=rpc',
    'PI_CODING_AGENT_DIR=',
    'PI_CODING_AGENT_SESSION_DIR=',
    'PI_GUI_USER_DATA_DIR=',
    'PI_GUI_LAB_WORKSPACE=',
    'alamelu-pi-rpc-agent',
    'alamelu-pi-rpc-sessions',
    'alamelu-pi-rpc-user-data',
    'alamelu-pi-rpc-workspace',
    '.pi/agent',
    'chmod 600',
    'repair-electron-dist.mjs',
  ]) {
    assert.match(text, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
