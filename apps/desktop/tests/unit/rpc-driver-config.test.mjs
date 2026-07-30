import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';
import ts from 'typescript';

const sourcePath = path.resolve('apps/desktop/electron/rpc-driver-config.ts');
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
const tempDir = mkdtempSync(path.resolve('apps/desktop/tests/unit/.tmp-rpc-config-test-'));
const tempModulePath = path.join(tempDir, 'rpc-driver-config.mjs');
writeFileSync(tempModulePath, transpiled, 'utf8');
after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});
const { resolveDesktopDriverConfig, resolveThreadStoragePaths } = await import(
  path.toNamespacedPath(tempModulePath)
);

test('resolveThreadStoragePaths keeps thread data in the app data directory by default', () => {
  assert.deepEqual(
    resolveThreadStoragePaths(
      {},
      '/Users/example/Library/Application Support/com.alamelu.pi.tauri',
      '/Users/example',
    ),
    {
      sessionDir: '/Users/example/Library/Application Support/com.alamelu.pi.tauri/sessions',
      catalogFilePath:
        '/Users/example/Library/Application Support/com.alamelu.pi.tauri/catalogs.json',
      noRepositoryWorkspacePath:
        '/Users/example/Library/Application Support/com.alamelu.pi.tauri/No Repository',
    },
  );
});

test('resolveThreadStoragePaths shares only sessions and the catalogue when requested', () => {
  assert.deepEqual(
    resolveThreadStoragePaths(
      {
        PI_GUI_SHARED_THREAD_DATA_DIR:
          '/Users/example/Library/Application Support/Alamelu Pi',
      },
      '/Users/example/Library/Application Support/com.alamelu.pi.tauri',
      '/Users/example',
    ),
    {
      sessionDir: '/Users/example/Library/Application Support/Alamelu Pi/sessions',
      catalogFilePath:
        '/Users/example/Library/Application Support/Alamelu Pi/catalogs.json',
      noRepositoryWorkspacePath:
        '/Users/example/Library/Application Support/Alamelu Pi/No Repository',
    },
  );
});

test('resolveDesktopDriverConfig defaults to sdk driver and existing userData path', () => {
  const config = resolveDesktopDriverConfig({}, { homeDir: '/Users/example', defaultUserDataDir: '/Users/example/Library/Application Support/pi-gui' });
  assert.equal(config.driver, 'sdk');
  assert.equal(config.userDataDir, '/Users/example/Library/Application Support/pi-gui');
});

test('resolveDesktopDriverConfig accepts rpc only with fully isolated lab paths', () => {
  const config = resolveDesktopDriverConfig(
    {
      PI_GUI_DRIVER: 'rpc',
      PI_GUI_PI_BIN: '/Users/example/.pi/agent/bin/pi',
      PI_CODING_AGENT_DIR: '~/tmp/alamelu-pi-rpc-agent',
      PI_CODING_AGENT_SESSION_DIR: '~/tmp/alamelu-pi-rpc-sessions',
      PI_GUI_USER_DATA_DIR: '~/tmp/alamelu-pi-rpc-user-data',
      PI_GUI_LAB_WORKSPACE: '~/tmp/alamelu-pi-rpc-workspace',
      PI_GUI_RPC_PROVIDER: 'xai',
      PI_GUI_RPC_MODEL: 'grok-code-fast-1',
    },
    { homeDir: '/Users/example', defaultUserDataDir: '/Users/example/Library/Application Support/pi-gui' },
  );
  assert.equal(config.driver, 'rpc');
  assert.equal(config.userDataDir, '/Users/example/tmp/alamelu-pi-rpc-user-data');
  assert.equal(config.rpc.piBin, '/Users/example/.pi/agent/bin/pi');
  assert.equal(config.rpc.agentDir, '/Users/example/tmp/alamelu-pi-rpc-agent');
  assert.equal(config.rpc.sessionDir, '/Users/example/tmp/alamelu-pi-rpc-sessions');
  assert.equal(config.rpc.labWorkspace, '/Users/example/tmp/alamelu-pi-rpc-workspace');
  assert.equal(config.rpc.productionUserDataDir, '/Users/example/Library/Application Support/pi-gui');
  assert.equal(config.rpc.provider, 'xai');
  assert.equal(config.rpc.model, 'grok-code-fast-1');
});

test('resolveDesktopDriverConfig rejects rpc without explicit lab userData', () => {
  assert.throws(
    () => resolveDesktopDriverConfig(
      {
        PI_GUI_DRIVER: 'rpc',
        PI_GUI_PI_BIN: '/Users/example/.pi/agent/bin/pi',
        PI_CODING_AGENT_DIR: '~/tmp/alamelu-pi-rpc-agent',
        PI_CODING_AGENT_SESSION_DIR: '~/tmp/alamelu-pi-rpc-sessions',
        PI_GUI_LAB_WORKSPACE: '~/tmp/alamelu-pi-rpc-workspace',
      },
      { homeDir: '/Users/example', defaultUserDataDir: '/Users/example/Library/Application Support/pi-gui' },
    ),
    /PI_GUI_USER_DATA_DIR/,
  );
});

test('resolveDesktopDriverConfig rejects rpc paths that resolve into production state', () => {
  assert.throws(
    () => resolveDesktopDriverConfig(
      {
        PI_GUI_DRIVER: 'rpc',
        PI_GUI_PI_BIN: '/Users/example/.pi/agent/bin/pi',
        PI_CODING_AGENT_DIR: '~/.pi/agent',
        PI_CODING_AGENT_SESSION_DIR: '~/tmp/alamelu-pi-rpc-sessions',
        PI_GUI_USER_DATA_DIR: '~/tmp/alamelu-pi-rpc-user-data',
        PI_GUI_LAB_WORKSPACE: '~/tmp/alamelu-pi-rpc-workspace',
      },
      { homeDir: '/Users/example', defaultUserDataDir: '/Users/example/Library/Application Support/pi-gui' },
    ),
    /production Pi agent directory/,
  );
});

test('resolveDesktopDriverConfig defaults packaged Alamelu Pi to shared Pi config and separate Alpi state', () => {
  const config = resolveDesktopDriverConfig(
    {},
    {
      homeDir: '/Users/example',
      defaultUserDataDir: '/Users/example/Library/Application Support/Alamelu Pi',
      productionUserDataDir: '/Users/example/Library/Application Support/pi',
      defaultDriver: 'rpc',
      defaultRpc: {
        piBin: '~/.pi/agent/bin/pi',
        agentDir: '~/.pi/agent',
        sessionDir: '/Users/example/Library/Application Support/Alamelu Pi/sessions',
        userDataDir: '/Users/example/Library/Application Support/Alamelu Pi',
        labWorkspace: '/Users/example/Library/Application Support/Alamelu Pi/workspace',
        allowSharedAgentDir: true,
        noTools: false,
        noExtensions: false,
        noSkills: false,
        noPromptTemplates: false,
        noThemes: false,
      },
    },
  );
  assert.equal(config.driver, 'rpc');
  assert.equal(config.userDataDir, '/Users/example/Library/Application Support/Alamelu Pi');
  assert.equal(config.rpc.agentDir, '/Users/example/.pi/agent');
  assert.equal(config.rpc.sessionDir, '/Users/example/Library/Application Support/Alamelu Pi/sessions');
  assert.equal(config.rpc.labWorkspace, '/Users/example/Library/Application Support/Alamelu Pi/workspace');
  assert.equal(config.rpc.productionUserDataDir, '/Users/example/Library/Application Support/pi');
  assert.equal(config.rpc.provider, undefined);
  assert.equal(config.rpc.model, undefined);
  assert.equal(config.rpc.noTools, false);
  assert.equal(config.rpc.noExtensions, false);
  assert.equal(config.rpc.noSkills, false);
  assert.equal(config.rpc.noPromptTemplates, false);
  assert.equal(config.rpc.noThemes, false);
});

test('resolveDesktopDriverConfig rejects production Pi child path as shared agent dir', () => {
  assert.throws(
    () => resolveDesktopDriverConfig(
      {},
      {
        homeDir: '/Users/example',
        defaultUserDataDir: '/Users/example/Library/Application Support/Alamelu Pi',
        productionUserDataDir: '/Users/example/Library/Application Support/pi',
        defaultDriver: 'rpc',
        defaultRpc: {
          piBin: '~/.pi/agent/bin/pi',
          agentDir: '~/.pi/agent/sessions',
          sessionDir: '/Users/example/Library/Application Support/Alamelu Pi/sessions',
          userDataDir: '/Users/example/Library/Application Support/Alamelu Pi',
          labWorkspace: '/Users/example/Library/Application Support/Alamelu Pi/workspace',
          allowSharedAgentDir: true,
        },
      },
    ),
    /production Pi agent directory/,
  );
});

test('resolveDesktopDriverConfig rejects shared Pi sessions even when packaged Alpi shares agent config', () => {
  assert.throws(
    () => resolveDesktopDriverConfig(
      {},
      {
        homeDir: '/Users/example',
        defaultUserDataDir: '/Users/example/Library/Application Support/Alamelu Pi',
        productionUserDataDir: '/Users/example/Library/Application Support/pi',
        defaultDriver: 'rpc',
        defaultRpc: {
          piBin: '~/.pi/agent/bin/pi',
          agentDir: '~/.pi/agent',
          sessionDir: '~/.pi/agent/sessions',
          userDataDir: '/Users/example/Library/Application Support/Alamelu Pi',
          labWorkspace: '/Users/example/Library/Application Support/Alamelu Pi/workspace',
          allowSharedAgentDir: true,
        },
      },
    ),
    /production Pi session directory/,
  );
});

test('resolveDesktopDriverConfig rejects non-Alpi workspace override in packaged parity mode', () => {
  assert.throws(
    () => resolveDesktopDriverConfig(
      { PI_GUI_LAB_WORKSPACE: '/Users/example/playground/alamelu' },
      {
        homeDir: '/Users/example',
        defaultUserDataDir: '/Users/example/Library/Application Support/Alamelu Pi',
        productionUserDataDir: '/Users/example/Library/Application Support/pi',
        defaultDriver: 'rpc',
        defaultRpc: {
          piBin: '~/.pi/agent/bin/pi',
          agentDir: '~/.pi/agent',
          sessionDir: '/Users/example/Library/Application Support/Alamelu Pi/sessions',
          userDataDir: '/Users/example/Library/Application Support/Alamelu Pi',
          labWorkspace: '/Users/example/Library/Application Support/Alamelu Pi/workspace',
          allowSharedAgentDir: true,
        },
      },
    ),
    /non-throwaway RPC lab workspace/,
  );
});

test('resolveDesktopDriverConfig rejects relative pi binary in rpc mode', () => {
  assert.throws(
    () => resolveDesktopDriverConfig(
      {
        PI_GUI_DRIVER: 'rpc',
        PI_GUI_PI_BIN: 'pi',
        PI_CODING_AGENT_DIR: '~/tmp/alamelu-pi-rpc-agent',
        PI_CODING_AGENT_SESSION_DIR: '~/tmp/alamelu-pi-rpc-sessions',
        PI_GUI_USER_DATA_DIR: '~/tmp/alamelu-pi-rpc-user-data',
        PI_GUI_LAB_WORKSPACE: '~/tmp/alamelu-pi-rpc-workspace',
      },
      { homeDir: '/Users/example', defaultUserDataDir: '/Users/example/Library/Application Support/pi-gui' },
    ),
    /absolute pi binary/,
  );
});
