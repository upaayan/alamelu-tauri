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

interface ExternalPiAuthStorage {
  get(providerId: string): unknown;
  getOAuthProviders(): readonly ExternalPiOAuthProvider[];
  getAuthStatus(providerId: string): ExternalPiAuthStatus;
  hasAuth(providerId: string): boolean;
  list(): readonly string[];
  login(providerId: string, callbacks: RuntimeLoginCallbacks): Promise<void>;
  set(providerId: string, credential: { readonly type: "api_key"; readonly key: string }): void;
  logout(providerId: string): void;
}

interface ExternalPiModelRegistry {
  getAll(): readonly unknown[];
  getProviderAuthStatus(providerId: string): ExternalPiAuthStatus;
  getProviderDisplayName(providerId: string): string;
}

type ApiKeyLoginProvider = (
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
  constructor(
    private readonly authStorage: ExternalPiAuthStorage,
    private readonly modelRegistry: ExternalPiModelRegistry,
    private readonly isApiKeyLoginProvider: ApiKeyLoginProvider,
  ) {}

  getOAuthProviders(): readonly ExternalPiOAuthProvider[] {
    return this.authStorage
      .getOAuthProviders()
      .filter((provider) => typeof provider.id === "string" && typeof provider.name === "string")
      .map((provider) => ({ id: provider.id, name: provider.name }));
  }

  listCredentialProviderIds(): readonly string[] {
    return this.authStorage.list().filter((providerId): providerId is string => typeof providerId === "string");
  }

  listModelProviderIds(): readonly string[] {
    return [...new Set(
      this.modelRegistry
        .getAll()
        .map((model) => asRecord(model).provider)
        .filter((providerId): providerId is string => typeof providerId === "string"),
    )].sort();
  }

  getAuthStatus(providerId: string): ExternalPiAuthStatus {
    const storageStatus = this.authStorage.getAuthStatus(providerId);
    const registryStatus = this.modelRegistry.getProviderAuthStatus(providerId);
    const storedAuthType = this.getStoredAuthType(providerId);
    return {
      configured: storedAuthType !== undefined || this.authStorage.hasAuth(providerId) || registryStatus.configured === true,
      ...(storedAuthType ? { source: "stored" } : firstString(registryStatus.source, storageStatus.source, "source")),
      ...firstString(registryStatus.label, storageStatus.label, "label"),
    };
  }

  getStoredAuthType(providerId: string): "oauth" | "api_key" | undefined {
    const credential = asRecord(this.authStorage.get(providerId));
    return credential.type === "oauth" || credential.type === "api_key" ? credential.type : undefined;
  }

  getProviderDisplayName(providerId: string): string {
    const displayName = this.modelRegistry.getProviderDisplayName(providerId);
    return typeof displayName === "string" && displayName.trim() ? displayName : providerId;
  }

  supportsApiKey(providerId: string, builtInProviderIds?: ReadonlySet<string>): boolean {
    try {
      return this.isApiKeyLoginProvider(
        providerId,
        new Set(this.getOAuthProviders().map((provider) => provider.id)),
        builtInProviderIds,
      );
    } catch {
      return false;
    }
  }

  login(providerId: string, callbacks: RuntimeLoginCallbacks): Promise<void> {
    return this.authStorage.login(providerId, callbacks);
  }

  setApiKey(providerId: string, apiKey: string): void {
    this.authStorage.set(providerId, { type: "api_key", key: apiKey });
  }

  logout(providerId: string): void {
    this.authStorage.logout(providerId);
  }
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
  const authStorage = createAuthStorage(indexModule, join(options.agentDir, "auth.json"));
  const modelRegistry = createModelRegistry(indexModule, authStorage, join(options.agentDir, "models.json"));
  const interactiveModule = await importModule(pathToFileURL(modulePaths.interactiveModulePath).href).catch((error) => {
    throw new Error(`The installed Pi runtime cannot report API-key provider support: ${errorMessage(error)}`);
  });
  const apiKeyLoginProvider = apiKeyLoginProviderFromModule(interactiveModule);
  if (!apiKeyLoginProvider) {
    throw new Error("The installed Pi runtime does not expose API-key provider support. Update Pi to a compatible release.");
  }
  return new ExternalPiAuthBridge(authStorage, modelRegistry, apiKeyLoginProvider);
}

async function resolveInstalledPiBin(piBin: string): Promise<string> {
  await access(piBin, constants.X_OK);
  return realpath(piBin);
}

function importInstalledPiModule(moduleUrl: string): Promise<unknown> {
  return import(/* @vite-ignore */ moduleUrl);
}

function createAuthStorage(module: unknown, authPath: string): ExternalPiAuthStorage {
  const moduleRecord = asRecord(module);
  const authStorage = asRecord(moduleRecord.AuthStorage);
  const create = authStorage.create;
  if (typeof create !== "function") {
    throw new Error("The installed Pi runtime does not expose its public AuthStorage API.");
  }
  const instance = create(authPath);
  if (!isAuthStorage(instance)) {
    throw new Error("The installed Pi runtime returned an incompatible AuthStorage instance.");
  }
  return instance;
}

function createModelRegistry(
  module: unknown,
  authStorage: ExternalPiAuthStorage,
  modelsPath: string,
): ExternalPiModelRegistry {
  const moduleRecord = asRecord(module);
  const modelRegistry = asRecord(moduleRecord.ModelRegistry);
  const create = modelRegistry.create;
  if (typeof create !== "function") {
    throw new Error("The installed Pi runtime does not expose its public ModelRegistry API.");
  }
  const instance = create(authStorage, modelsPath);
  if (!isModelRegistry(instance)) {
    throw new Error("The installed Pi runtime returned an incompatible ModelRegistry instance.");
  }
  return instance;
}

function apiKeyLoginProviderFromModule(module: unknown): ApiKeyLoginProvider | undefined {
  const candidate = asRecord(module).isApiKeyLoginProvider;
  return typeof candidate === "function" ? candidate as ApiKeyLoginProvider : undefined;
}

function isAuthStorage(value: unknown): value is ExternalPiAuthStorage {
  const candidate = asRecord(value);
  return (
    typeof candidate.getOAuthProviders === "function" &&
    typeof candidate.get === "function" &&
    typeof candidate.getAuthStatus === "function" &&
    typeof candidate.hasAuth === "function" &&
    typeof candidate.list === "function" &&
    typeof candidate.login === "function" &&
    typeof candidate.set === "function" &&
    typeof candidate.logout === "function"
  );
}

function isModelRegistry(value: unknown): value is ExternalPiModelRegistry {
  const candidate = asRecord(value);
  return (
    typeof candidate.getAll === "function" &&
    typeof candidate.getProviderAuthStatus === "function" &&
    typeof candidate.getProviderDisplayName === "function"
  );
}

function firstString(
  primary: unknown,
  fallback: unknown,
  key: "source" | "label",
): Record<string, string> {
  const value = typeof primary === "string" ? primary : typeof fallback === "string" ? fallback : undefined;
  return value ? { [key]: value } : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function"
    ? value as Record<string, unknown>
    : {};
}
