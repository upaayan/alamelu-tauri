import { access, constants, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RuntimeLoginCallbacks } from "@pi-gui/session-driver/runtime-types";

export interface ExternalPiAuthStatus {
  readonly configured: boolean;
  readonly source?: string;
  readonly label?: string;
}

export interface ExternalPiOAuthProvider {
  readonly id: string;
  readonly name: string;
}

export interface ExternalPiModelMetadata {
  readonly providerId: string;
  readonly modelId: string;
  readonly api?: string;
  readonly contextWindow?: number;
}

interface ExternalPiAuthAdapter {
  getOAuthProviders(): readonly ExternalPiOAuthProvider[];
  listCredentialProviderIds(): readonly string[];
  listModelProviderIds(): readonly string[];
  listModelMetadata(): readonly ExternalPiModelMetadata[];
  getAuthStatus(providerId: string): ExternalPiAuthStatus;
  getStoredAuthType(providerId: string): "oauth" | "api_key" | undefined;
  getProviderDisplayName(providerId: string): string;
  supportsApiKey(providerId: string, builtInProviderIds?: ReadonlySet<string>): boolean;
  login(providerId: string, interaction: PiAuthInteraction): Promise<void>;
  setApiKey(providerId: string, apiKey: string): Promise<void>;
  logout(providerId: string): Promise<void>;
}

interface PiAuthInteraction {
  readonly signal?: AbortSignal;
  prompt(prompt: unknown): Promise<string>;
  notify(event: unknown): void;
}

interface ModernPiModelRuntime {
  getProviders(): readonly unknown[];
  getModels(): readonly unknown[];
  getProvider(providerId: string): unknown;
  getProviderAuthStatus(providerId: string): unknown;
  listCredentials(): Promise<readonly unknown[]>;
  login(providerId: string, type: "oauth" | "api_key", interaction: PiAuthInteraction): Promise<unknown>;
  logout(providerId: string): Promise<void>;
}

interface LegacyPiAuthStorage {
  get(providerId: string): unknown;
  getOAuthProviders(): readonly unknown[];
  getAuthStatus(providerId: string): unknown;
  hasAuth(providerId: string): boolean;
  list(): readonly unknown[];
  login(providerId: string, callbacks: RuntimeLoginCallbacks): Promise<void>;
  set(providerId: string, credential: { readonly type: "api_key"; readonly key: string }): void;
  logout(providerId: string): void;
}

interface LegacyPiModelRegistry {
  getAll(): readonly unknown[];
  getProviderAuthStatus(providerId: string): unknown;
  getProviderDisplayName(providerId: string): string;
}

type LegacyApiKeyLoginProvider = (
  providerId: string,
  oauthProviderIds: ReadonlySet<string>,
  builtInProviderIds?: ReadonlySet<string>,
) => boolean;

export interface ExternalPiAuthModulePaths {
  readonly packageRoot: string;
  readonly indexModulePath: string;
  readonly interactiveModulePath: string;
}

export interface LoadExternalPiAuthBridgeOptions {
  readonly piBin: string;
  readonly agentDir: string;
  readonly resolvePiBin?: (piBin: string) => Promise<string>;
  readonly importModule?: (moduleUrl: string) => Promise<unknown>;
}

export class ExternalPiAuthBridge {
  constructor(private readonly adapter: ExternalPiAuthAdapter) {}

  getOAuthProviders(): readonly ExternalPiOAuthProvider[] {
    return this.adapter.getOAuthProviders();
  }

  listCredentialProviderIds(): readonly string[] {
    return this.adapter.listCredentialProviderIds();
  }

  listModelProviderIds(): readonly string[] {
    return this.adapter.listModelProviderIds();
  }

  /** Per-model metadata from pi's own registry. Empty when the installed pi cannot supply it. */
  listModelMetadata(): readonly ExternalPiModelMetadata[] {
    try {
      return this.adapter.listModelMetadata();
    } catch {
      return [];
    }
  }

  getAuthStatus(providerId: string): ExternalPiAuthStatus {
    const storageStatus = this.adapter.getAuthStatus(providerId);
    const storedAuthType = this.getStoredAuthType(providerId);
    return storedAuthType
      ? { ...storageStatus, configured: true, source: "stored" }
      : storageStatus;
  }

  getStoredAuthType(providerId: string): "oauth" | "api_key" | undefined {
    return this.adapter.getStoredAuthType(providerId);
  }

  getProviderDisplayName(providerId: string): string {
    const displayName = this.adapter.getProviderDisplayName(providerId);
    return displayName.trim() ? displayName : providerId;
  }

  supportsApiKey(providerId: string, builtInProviderIds?: ReadonlySet<string>): boolean {
    return this.adapter.supportsApiKey(providerId, builtInProviderIds);
  }

  async login(providerId: string, callbacks: RuntimeLoginCallbacks): Promise<void> {
    const { interaction, pendingNotifications } = createPiAuthInteraction(callbacks);
    await this.adapter.login(providerId, interaction);
    await Promise.all(pendingNotifications);
  }

  async setApiKey(providerId: string, apiKey: string): Promise<void> {
    await this.adapter.setApiKey(providerId, apiKey);
  }

  async logout(providerId: string): Promise<void> {
    await this.adapter.logout(providerId);
  }
}

export function createUnavailableExternalPiAuthBridge(reason: string): ExternalPiAuthBridge {
  const unavailable = async (): Promise<never> => {
    throw new Error(`Pi provider authentication is unavailable: ${reason}`);
  };
  return new ExternalPiAuthBridge({
    getOAuthProviders: () => [],
    listCredentialProviderIds: () => [],
    listModelMetadata: () => [],
    listModelProviderIds: () => [],
    getAuthStatus: () => ({ configured: false }),
    getStoredAuthType: () => undefined,
    getProviderDisplayName: (providerId) => providerId,
    supportsApiKey: () => false,
    login: unavailable,
    setApiKey: unavailable,
    logout: unavailable,
  });
}

export function externalPiAuthModulePaths(resolvedPiBin: string): ExternalPiAuthModulePaths {
  const distDir = dirname(resolvedPiBin);
  if (basename(resolvedPiBin) !== "cli.js" || basename(distDir) !== "dist") {
    throw new Error(`Installed Pi executable has an unsupported layout: ${resolvedPiBin}`);
  }
  const packageRoot = dirname(distDir);
  return {
    packageRoot,
    indexModulePath: join(distDir, "index.js"),
    interactiveModulePath: join(distDir, "modes", "interactive", "interactive-mode.js"),
  };
}

export async function loadExternalPiAuthBridge(options: LoadExternalPiAuthBridgeOptions): Promise<ExternalPiAuthBridge> {
  const resolvePiBin = options.resolvePiBin ?? resolveInstalledPiBin;
  const importModule = options.importModule ?? importInstalledPiModule;
  const modulePaths = externalPiAuthModulePaths(await resolvePiBin(options.piBin));
  const indexModule = await importModule(pathToFileURL(modulePaths.indexModulePath).href);
  const indexRecord = asRecord(indexModule);

  const modelRuntimeClass = asRecord(indexRecord.ModelRuntime);
  const createModelRuntime = modelRuntimeClass.create;
  if (typeof createModelRuntime === "function") {
    const runtime = await createModelRuntime.call(modelRuntimeClass, {
      authPath: join(options.agentDir, "auth.json"),
      modelsPath: join(options.agentDir, "models.json"),
      // The supervisor already asks Pi for the model catalog. Auth status must
      // not make every Alpi startup wait on remote model availability checks.
      allowModelNetwork: false,
    });
    return createModernAuthBridge(asModernModelRuntime(runtime));
  }

  const legacyBridge = await createLegacyAuthBridge(indexRecord, modulePaths, options, importModule);
  if (legacyBridge) {
    return legacyBridge;
  }

  throw new Error("The installed Pi runtime exposes neither its public ModelRuntime API nor the legacy auth API.");
}

async function resolveInstalledPiBin(piBin: string): Promise<string> {
  await access(piBin, constants.X_OK);
  return realpath(piBin);
}

function importInstalledPiModule(moduleUrl: string): Promise<unknown> {
  return import(/* @vite-ignore */ moduleUrl);
}

async function createModernAuthBridge(runtime: ModernPiModelRuntime): Promise<ExternalPiAuthBridge> {
  const credentials = await runtime.listCredentials();
  const storedAuthTypes = new Map<string, "oauth" | "api_key">();
  for (const credential of credentials) {
    const record = asRecord(credential);
    const providerId = record.providerId;
    const type = record.type;
    if (typeof providerId === "string" && (type === "oauth" || type === "api_key")) {
      storedAuthTypes.set(providerId, type);
    }
  }

  const providers = () => runtime.getProviders().map(asRecord);
  const providerById = (providerId: string): Record<string, unknown> | undefined =>
    providers().find((provider) => provider.id === providerId);

  return new ExternalPiAuthBridge({
    getOAuthProviders: () =>
      providers()
        .flatMap((provider) => {
          const auth = asRecord(provider.auth);
          const oauth = asRecord(auth.oauth);
          if (!oauth || Object.keys(oauth).length === 0 || typeof provider.id !== "string") {
            return [];
          }
          const name = firstString(oauth.name, oauth.loginLabel, provider.name, provider.id);
          return [{ id: provider.id, name }];
        })
        .filter((provider): provider is ExternalPiOAuthProvider => Boolean(provider)),
    listCredentialProviderIds: () => [...storedAuthTypes.keys()].sort(),
    listModelProviderIds: () => [...new Set(
      runtime
        .getModels()
        .map((model) => asRecord(model).provider)
        .filter((providerId): providerId is string => typeof providerId === "string"),
    )].sort(),
    listModelMetadata: () => modelMetadataFrom(runtime.getModels()),
    getAuthStatus: (providerId) => normalizeAuthStatus(runtime.getProviderAuthStatus(providerId)),
    getStoredAuthType: (providerId) => storedAuthTypes.get(providerId),
    getProviderDisplayName: (providerId) => {
      const provider = providerById(providerId);
      return firstString(provider?.name, providerId);
    },
    supportsApiKey: (providerId) => {
      const provider = providerById(providerId);
      const apiKey = asRecord(asRecord(provider?.auth).apiKey);
      return typeof apiKey.login === "function";
    },
    login: async (providerId, interaction) => {
      await runtime.login(providerId, "oauth", interaction);
    },
    setApiKey: async (providerId, apiKey) => {
      await runtime.login(providerId, "api_key", createApiKeyInteraction(apiKey));
    },
    logout: (providerId) => runtime.logout(providerId),
  });
}

async function createLegacyAuthBridge(
  indexModule: Record<string, unknown>,
  modulePaths: ExternalPiAuthModulePaths,
  options: LoadExternalPiAuthBridgeOptions,
  importModule: (moduleUrl: string) => Promise<unknown>,
): Promise<ExternalPiAuthBridge | undefined> {
  const authStorageClass = asRecord(indexModule.AuthStorage);
  const createAuthStorage = authStorageClass.create;
  const modelRegistryClass = asRecord(indexModule.ModelRegistry);
  const createModelRegistry = modelRegistryClass.create;
  if (typeof createAuthStorage !== "function" || typeof createModelRegistry !== "function") {
    return undefined;
  }

  const authStorage = asLegacyAuthStorage(createAuthStorage.call(authStorageClass, join(options.agentDir, "auth.json")));
  const modelRegistry = asLegacyModelRegistry(
    createModelRegistry.call(modelRegistryClass, authStorage, join(options.agentDir, "models.json")),
  );
  const interactiveModule = await importModule(pathToFileURL(modulePaths.interactiveModulePath).href).catch(() => ({}));
  const apiKeyLoginProvider = legacyApiKeyLoginProvider(interactiveModule);

  return new ExternalPiAuthBridge({
    listModelMetadata: () => modelMetadataFrom(modelRegistry.getAll()),
    getOAuthProviders: () => authStorage.getOAuthProviders().flatMap(normalizeOAuthProvider),
    listCredentialProviderIds: () => authStorage.list().filter((providerId): providerId is string => typeof providerId === "string"),
    listModelProviderIds: () => [...new Set(
      modelRegistry
        .getAll()
        .map((model) => asRecord(model).provider)
        .filter((providerId): providerId is string => typeof providerId === "string"),
    )].sort(),
    getAuthStatus: (providerId) => {
      const status = normalizeAuthStatus(modelRegistry.getProviderAuthStatus(providerId));
      const storageStatus = normalizeAuthStatus(authStorage.getAuthStatus(providerId));
      return {
        configured: authStorage.hasAuth(providerId) || status.configured || storageStatus.configured,
        ...(firstString(status.source, storageStatus.source) ? { source: firstString(status.source, storageStatus.source) } : {}),
        ...(firstString(status.label, storageStatus.label) ? { label: firstString(status.label, storageStatus.label) } : {}),
      };
    },
    getStoredAuthType: (providerId) => {
      const type = asRecord(authStorage.get(providerId)).type;
      return type === "oauth" || type === "api_key" ? type : undefined;
    },
    getProviderDisplayName: (providerId) => modelRegistry.getProviderDisplayName(providerId),
    supportsApiKey: (providerId, builtInProviderIds) => {
      try {
        return apiKeyLoginProvider?.(
          providerId,
          new Set(authStorage.getOAuthProviders().flatMap(normalizeOAuthProvider).map((provider) => provider.id)),
          builtInProviderIds,
        ) ?? false;
      } catch {
        return false;
      }
    },
    login: (providerId, interaction) => authStorage.login(providerId, interactionToLegacyCallbacks(interaction)),
    setApiKey: async (providerId, apiKey) => {
      authStorage.set(providerId, { type: "api_key", key: apiKey });
    },
    logout: async (providerId) => {
      authStorage.logout(providerId);
    },
  });
}

function asModernModelRuntime(value: unknown): ModernPiModelRuntime {
  const runtime = asRecord(value);
  for (const method of ["getProviders", "getModels", "getProvider", "getProviderAuthStatus", "listCredentials", "login", "logout"]) {
    if (typeof runtime[method] !== "function") {
      throw new Error(`The installed Pi ModelRuntime is missing ${method}().`);
    }
  }
  return value as ModernPiModelRuntime;
}

function asLegacyAuthStorage(value: unknown): LegacyPiAuthStorage {
  const storage = asRecord(value);
  for (const method of ["get", "getOAuthProviders", "getAuthStatus", "hasAuth", "list", "login", "set", "logout"]) {
    if (typeof storage[method] !== "function") {
      throw new Error(`The installed Pi legacy AuthStorage is missing ${method}().`);
    }
  }
  return value as LegacyPiAuthStorage;
}

function asLegacyModelRegistry(value: unknown): LegacyPiModelRegistry {
  const registry = asRecord(value);
  for (const method of ["getAll", "getProviderAuthStatus", "getProviderDisplayName"]) {
    if (typeof registry[method] !== "function") {
      throw new Error(`The installed Pi legacy ModelRegistry is missing ${method}().`);
    }
  }
  return value as LegacyPiModelRegistry;
}

function legacyApiKeyLoginProvider(module: unknown): LegacyApiKeyLoginProvider | undefined {
  const candidate = asRecord(module).isApiKeyLoginProvider;
  return typeof candidate === "function" ? candidate as LegacyApiKeyLoginProvider : undefined;
}

function createPiAuthInteraction(callbacks: RuntimeLoginCallbacks): {
  readonly interaction: PiAuthInteraction;
  readonly pendingNotifications: Promise<void>[];
} {
  const pendingNotifications: Promise<void>[] = [];
  const enqueue = (callback: void | Promise<void>): void => {
    pendingNotifications.push(Promise.resolve(callback));
  };

  return {
    pendingNotifications,
    interaction: {
      signal: callbacks.signal,
      prompt: async (prompt) => {
        const record = asRecord(prompt);
        const type = typeof record.type === "string" ? record.type : "text";
        const message = typeof record.message === "string" ? record.message : "Provider login input";
        const placeholder = typeof record.placeholder === "string" ? record.placeholder : undefined;
        if (type === "select") {
          const options = Array.isArray(record.options)
            ? record.options.flatMap((option) => {
                const optionRecord = asRecord(option);
                return typeof optionRecord.id === "string" && typeof optionRecord.label === "string"
                  ? [{ id: optionRecord.id, label: optionRecord.label }]
                  : [];
              })
            : [];
          const selected = callbacks.onSelect
            ? await callbacks.onSelect({ message, options })
            : await callbacks.onPrompt({ message, placeholder });
          if (selected === undefined) {
            throw new Error("Provider login selection was cancelled.");
          }
          return selected;
        }
        if (type === "manual_code" && callbacks.onManualCodeInput) {
          return callbacks.onManualCodeInput();
        }
        return callbacks.onPrompt({
          message,
          ...(placeholder ? { placeholder } : {}),
          allowEmpty: false,
        });
      },
      notify: (event) => {
        const record = asRecord(event);
        const type = record.type;
        if (type === "auth_url" && typeof record.url === "string") {
          enqueue(callbacks.onAuth({
            url: record.url,
            ...(typeof record.instructions === "string" ? { instructions: record.instructions } : {}),
          }));
        } else if (type === "device_code" && typeof record.userCode === "string" && typeof record.verificationUri === "string") {
          enqueue(callbacks.onDeviceCode?.({
            userCode: record.userCode,
            verificationUri: record.verificationUri,
            ...(typeof record.intervalSeconds === "number" ? { intervalSeconds: record.intervalSeconds } : {}),
            ...(typeof record.expiresInSeconds === "number" ? { expiresInSeconds: record.expiresInSeconds } : {}),
          }));
        } else if ((type === "progress" || type === "info") && typeof record.message === "string") {
          enqueue(callbacks.onProgress?.(record.message));
        }
      },
    },
  };
}

function createApiKeyInteraction(apiKey: string): PiAuthInteraction {
  return {
    prompt: async () => apiKey,
    notify: () => undefined,
  };
}

function interactionToLegacyCallbacks(interaction: PiAuthInteraction): RuntimeLoginCallbacks {
  return {
    onAuth: (info) => interaction.notify({ type: "auth_url", ...info }),
    onPrompt: (prompt) => interaction.prompt({ type: "text", ...prompt }),
    onProgress: (message) => interaction.notify({ type: "progress", message }),
    onManualCodeInput: () => interaction.prompt({ type: "manual_code", message: "Paste the redirect URL or code" }),
    onDeviceCode: (info) => interaction.notify({ type: "device_code", ...info }),
    onSelect: (prompt) => interaction.prompt({
      type: "select",
      message: prompt.message,
      options: prompt.options,
    }),
    signal: interaction.signal,
  };
}

function normalizeOAuthProvider(value: unknown): ExternalPiOAuthProvider[] {
  const provider = asRecord(value);
  if (typeof provider.id !== "string") {
    return [];
  }
  const name = firstString(provider.name, provider.id);
  return [{ id: provider.id, name }];
}

function normalizeAuthStatus(value: unknown): ExternalPiAuthStatus {
  const status = asRecord(value);
  return {
    configured: status.configured === true,
    ...(typeof status.source === "string" ? { source: status.source } : {}),
    ...(typeof status.label === "string" ? { label: status.label } : {}),
  };
}

function firstString(...values: unknown[]): string {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function"
    ? value as Record<string, unknown>
    : {};
}

/** Maps pi `Model` records to the subset Alamelu Pi needs for switch preflight. */
function modelMetadataFrom(models: readonly unknown[]): readonly ExternalPiModelMetadata[] {
  const out: ExternalPiModelMetadata[] = [];
  for (const model of models) {
    const record = asRecord(model);
    const providerId = record.provider;
    const modelId = record.id;
    if (typeof providerId !== "string" || typeof modelId !== "string") continue;
    out.push({
      providerId,
      modelId,
      ...(typeof record.api === "string" ? { api: record.api } : {}),
      ...(typeof record.contextWindow === "number" && Number.isFinite(record.contextWindow)
        ? { contextWindow: record.contextWindow }
        : {}),
    });
  }
  return out;
}
