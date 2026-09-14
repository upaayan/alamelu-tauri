// Credential-free gate shared by local Tauri packaging and native CI.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!process.env.npm_execpath) throw new Error('Run with pnpm run verify:upgrade');
run(process.execPath, [process.env.npm_execpath, '--filter', '@alamelu-pi/session-driver', '--filter', '@alamelu-pi/pi-rpc-driver', 'run', 'build']);
run(process.execPath, ['--test', 'apps/desktop/tests/unit/model-switch-preflight.test.mjs', 'packages/pi-rpc-driver/test/tree-compact.test.mjs', 'scripts/upgrade-wiring.test.mjs']);
const python = process.platform === 'win32' ? 'python' : 'python3';
run(python, ['scripts/check-cursor-compaction.py']);
run(python, ['scripts/test-upgrade-protection.py']);
console.log('Upgrade build gate passed. Installed Pi/adapter and live release checks remain required; see documents/REBUILD-PROTECTION.md.');
