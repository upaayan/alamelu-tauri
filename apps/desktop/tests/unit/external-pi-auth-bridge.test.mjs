import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(testDir, "../../electron/external-pi-auth-bridge.ts");
const source = readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    verbatimModuleSyntax: true,
  },
  fileName: sourcePath,
}).outputText;
const tempModuleDir = mkdtempSync(path.join(tmpdir(), "external-pi-auth-bridge-module-"));
const tempModulePath = path.join(tempModuleDir, "external-pi-auth-bridge.mjs");
writeFileSync(tempModulePath, transpiled, "utf8");

after(() => {
  rmSync(tempModuleDir, { recursive: true, force: true });
});

const { externalPiAuthModulePaths, loadExternalPiAuthBridge } = await import(path.toNamespacedPath(tempModulePath));

test("derives the installed Pi public auth module from its CLI entrypoint", () => {
  assert.deepEqual(
    externalPiAuthModulePaths("/Users/example/.nvm/versions/node/v24/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
    {
      packageRoot: "/Users/example/.nvm/versions/node/v24/lib/node_modules/@earendil-works/pi-coding-agent",
      indexModulePath: "/Users/example/.nvm/versions/node/v24/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js",
      interactiveModulePath:
        "/Users/example/.nvm/versions/node/v24/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js",
    },
  );
});

test("supports Pi's ModelRuntime auth API", async () => {
  const calls = [];
  const runtime = {
    getProviders: () => [
      {
        id: "openai-codex",
        name: "OpenAI Codex",
        auth: { oauth: { name: "OpenAI (ChatGPT Plus/Pro)" } },
      },
      {
        id: "nvidia",
        name: "NVIDIA",
        auth: { apiKey: { name: "NVIDIA API key", login: async () => ({ type: "api_key", key: "unused" }) } },
      },
    ],
    getModels: () => [{ provider: "openai-codex" }, { provider: "nvidia" }],
    getProviderAuthStatus: (providerId) =>
      providerId === "openai-codex"
        ? { configured: true, source: "stored" }
        : { configured: false },
    getProvider: (providerId) =>
      runtime.getProviders().find((provider) => provider.id === providerId),
    getProviderDisplayName: (providerId) => runtime.getProvider(providerId)?.name ?? providerId,
    listCredentials: async () => [{ providerId: "openai-codex", type: "oauth" }],
    login: async (providerId, type, interaction) => {
      calls.push(["login", providerId, type]);
      await interaction.prompt({ type: "secret", message: "API key" });
      interaction.notify({ type: "progress", message: "done" });
    },
    logout: async (providerId) => {
      calls.push(["logout", providerId]);
    },
  };
  class ModelRuntime {
    static async create(options) {
      calls.push(["create-runtime", options]);
      return runtime;
    }
  }

  const bridge = await loadExternalPiAuthBridge({
    piBin: "/Users/example/.pi/agent/bin/pi",
    agentDir: "/Users/example/.pi/agent",
    resolvePiBin: async () => "/opt/pi/dist/cli.js",
    importModule: async (moduleUrl) => (moduleUrl.endsWith("/dist/index.js") ? { ModelRuntime } : {}),
  });

  assert.deepEqual(bridge.getOAuthProviders(), [
    { id: "openai-codex", name: "OpenAI (ChatGPT Plus/Pro)" },
  ]);
  assert.deepEqual(bridge.listModelProviderIds(), ["nvidia", "openai-codex"]);
  assert.deepEqual(bridge.listCredentialProviderIds(), ["openai-codex"]);
  assert.deepEqual(bridge.getAuthStatus("openai-codex"), { configured: true, source: "stored" });
  assert.equal(bridge.getStoredAuthType("openai-codex"), "oauth");
  assert.equal(bridge.supportsApiKey("nvidia"), true);
  assert.equal(bridge.supportsApiKey("openai-codex"), false);

  await bridge.login("openai-codex", {
    onAuth: () => undefined,
    onPrompt: async () => "response",
  });
  await bridge.setApiKey("nvidia", "test-api-key");
  await bridge.logout("nvidia");

  assert.deepEqual(calls.map(([name, providerId, type]) => [name, providerId, type]), [
    ["create-runtime", { authPath: "/Users/example/.pi/agent/auth.json", modelsPath: "/Users/example/.pi/agent/models.json", allowModelNetwork: false }, undefined],
    ["login", "openai-codex", "oauth"],
    ["login", "nvidia", "api_key"],
    ["logout", "nvidia", undefined],
  ]);
});

test("delegates login and API-key persistence to the installed Pi AuthStorage", async () => {
  const calls = [];
  const authStorage = {
    getOAuthProviders: () => [{ id: "openai-codex", name: "ChatGPT" }],
    get: (providerId) => (providerId === "anthropic" ? { type: "api_key", key: "test-api-key" } : undefined),
    getAuthStatus: (providerId) =>
      providerId === "openai"
        ? { configured: false, source: "environment" }
        : {
            configured: providerId === "openai-codex",
            source: providerId === "openai-codex" ? "stored" : undefined,
            label: providerId === "openai-codex" ? "ChatGPT subscription" : undefined,
          },
    hasAuth: (providerId) => providerId === "openai" || providerId === "openai-codex",
    list: () => ["openai-codex"],
    login: async (providerId, callbacks) => {
      calls.push(["login", providerId, callbacks]);
    },
    set: (providerId, credential) => {
      calls.push(["set", providerId, credential]);
    },
    logout: (providerId) => {
      calls.push(["logout", providerId]);
    },
  };
  class AuthStorage {
    static create(authPath) {
      calls.push(["create", authPath]);
      return authStorage;
    }
  }
  const modelRegistry = {
    getAll: () => [{ provider: "openai" }, { provider: "anthropic" }, { provider: "openai" }],
    getProviderAuthStatus: (providerId) =>
      providerId === "openai"
        ? { configured: true, source: "environment", label: "OPENAI_API_KEY" }
        : { configured: false },
    getProviderDisplayName: (providerId) => (providerId === "openai" ? "OpenAI" : providerId),
  };
  class ModelRegistry {
    static create(storage, modelsPath) {
      calls.push(["create-model-registry", storage, modelsPath]);
      return modelRegistry;
    }
  }

  const bridge = await loadExternalPiAuthBridge({
    piBin: "/Users/example/.pi/agent/bin/pi",
    agentDir: "/Users/example/.pi/agent",
    resolvePiBin: async () => "/opt/pi/dist/cli.js",
    importModule: async (moduleUrl) => {
      if (moduleUrl.endsWith("/dist/index.js")) {
        return { AuthStorage, ModelRegistry };
      }
      return {
        isApiKeyLoginProvider: (providerId, oauthProviderIds, builtInProviderIds) =>
          providerId === "openai" && !oauthProviderIds.has(providerId) && builtInProviderIds.has(providerId),
      };
    },
  });

  assert.deepEqual(bridge.getOAuthProviders(), [{ id: "openai-codex", name: "ChatGPT" }]);
  assert.deepEqual(bridge.listModelProviderIds(), ["anthropic", "openai"]);
  assert.deepEqual(bridge.listCredentialProviderIds(), ["openai-codex"]);
  assert.deepEqual(bridge.getAuthStatus("openai-codex"), {
    configured: true,
    source: "stored",
    label: "ChatGPT subscription",
  });
  assert.deepEqual(bridge.getAuthStatus("openai"), {
    configured: true,
    source: "environment",
    label: "OPENAI_API_KEY",
  });
  assert.equal(bridge.getStoredAuthType("anthropic"), "api_key");
  assert.equal(bridge.getProviderDisplayName("openai"), "OpenAI");
  assert.equal(bridge.supportsApiKey("openai", new Set(["openai"])), true);
  assert.equal(bridge.supportsApiKey("openai-codex", new Set(["openai-codex"])), false);

  const callbacks = {
    onAuth: () => undefined,
    onPrompt: async () => "response",
  };
  await bridge.login("openai-codex", callbacks);
  await bridge.setApiKey("openai", "test-api-key");
  await bridge.logout("openai");

  assert.deepEqual(calls.slice(0, 2), [
    ["create", "/Users/example/.pi/agent/auth.json"],
    ["create-model-registry", authStorage, "/Users/example/.pi/agent/models.json"],
  ]);
  assert.equal(calls[2][0], "login");
  assert.equal(calls[2][1], "openai-codex");
  assert.equal(typeof calls[2][2].onAuth, "function");
  assert.equal(typeof calls[2][2].onPrompt, "function");
  assert.deepEqual(calls.slice(3), [
    ["set", "openai", { type: "api_key", key: "test-api-key" }],
    ["logout", "openai"],
  ]);
});

test("keeps legacy auth loading when API-key capability metadata is absent", async () => {
  const authStorage = {
    get: () => undefined,
    getOAuthProviders: () => [],
    getAuthStatus: () => ({ configured: false }),
    hasAuth: () => false,
    list: () => [],
    login: async () => undefined,
    set: () => undefined,
    logout: () => undefined,
  };
  class AuthStorage {
    static create() {
      return authStorage;
    }
  }
  class ModelRegistry {
    static create() {
      return {
        getAll: () => [],
        getProviderAuthStatus: () => ({ configured: false }),
        getProviderDisplayName: (providerId) => providerId,
      };
    }
  }

  const bridge = await loadExternalPiAuthBridge({
    piBin: "/Users/example/.pi/agent/bin/pi",
    agentDir: "/Users/example/.pi/agent",
    resolvePiBin: async () => "/opt/pi/dist/cli.js",
    importModule: async (moduleUrl) => (moduleUrl.endsWith("/dist/index.js") ? { AuthStorage, ModelRegistry } : {}),
  });
  assert.equal(bridge.supportsApiKey("openai"), false);
});
