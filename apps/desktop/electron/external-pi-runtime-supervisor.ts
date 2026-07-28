import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  buildPiRpcPathEnv,
  buildWslPathEnvironment,
  isWslPiExecutable,
  resolvePiRpcSpawnCommand,
} from "@alamelu-pi/pi-rpc-driver";
import type { WorkspaceRef } from "@alamelu-pi/session-driver";
import type {
  ModelSettingsSnapshot,
  RuntimeExtensionRecord,
  RuntimeLoginCallbacks,
  RuntimeModelRecord,
  RuntimeProviderRecord,
  RuntimeSettingsSnapshot,
  RuntimeSkillRecord,
  RuntimeSnapshot,
} from "@alamelu-pi/session-driver/runtime-types";
import type { DesktopRuntimeSupervisor } from "./desktop-driver";
import { unsupportedRpcDesktopOperation } from "./desktop-driver";
import {
  type ExternalPiAuthStatus,
  ExternalPiAuthBridge,
  createUnavailableExternalPiAuthBridge,
  loadExternalPiAuthBridge,
} from "./external-pi-auth-bridge";
import { parsePiListModels } from "./external-pi-model-parser";

const LIST_MODELS_TIMEOUT_MS = 30_000;
const SETTINGS_WRITE_MODE = 0o600;

interface ExternalPiRuntimeSupervisorOptions {
  readonly piBin: string;
  readonly agentDir: string;
  readonly env?: NodeJS.ProcessEnv;
}

export class ExternalPiRuntimeSupervisor implements DesktopRuntimeSupervisor {
  private listModelsInFlight: Promise<string> | undefined;

  constructor(private readonly options: ExternalPiRuntimeSupervisorOptions) {}

  async getRuntimeSnapshot(workspace: WorkspaceRef): Promise<RuntimeSnapshot> {
    return this.buildSnapshot(workspace);
  }

  async refreshRuntime(workspace: WorkspaceRef): Promise<RuntimeSnapshot> {
    return this.buildSnapshot(workspace);
  }

  async getGlobalModelSettings(_workspace: WorkspaceRef): Promise<ModelSettingsSnapshot> {
    const globalSettings = await this.readSettings();
    return modelSettingsFromRecord(globalSettings);
  }

  async login(workspace: WorkspaceRef, providerId: string, callbacks: RuntimeLoginCallbacks): Promise<RuntimeSnapshot> {
    const authBridge = await this.authBridge();
    if (!authBridge.getOAuthProviders().some((provider) => provider.id === providerId)) {
      throw new Error(`Pi does not offer subscription login for provider: ${providerId}`);
    }
    await authBridge.login(providerId, callbacks);
    return this.buildSnapshot(workspace);
  }

  async logout(workspace: WorkspaceRef, providerId: string): Promise<RuntimeSnapshot> {
    const authBridge = await this.authBridge();
    await authBridge.logout(providerId);
    return this.buildSnapshot(workspace);
  }

  async setProviderApiKey(workspace: WorkspaceRef, providerId: string, apiKey: string): Promise<RuntimeSnapshot> {
    const trimmedApiKey = apiKey.trim();
    if (!trimmedApiKey) {
      throw new Error("API key cannot be empty.");
    }
    const authBridge = await this.authBridge();
    if (!authBridge.supportsApiKey(providerId)) {
      throw new Error(`Pi does not offer API-key setup for provider: ${providerId}`);
    }
    await authBridge.setApiKey(providerId, trimmedApiKey);
    return this.buildSnapshot(workspace);
  }

  async setDefaultModel(workspace: WorkspaceRef, selection: { readonly provider: string; readonly modelId: string }): Promise<RuntimeSnapshot> {
    await this.updateSettings((settings) => ({
      ...settings,
      defaultProvider: selection.provider,
      defaultModel: selection.modelId,
    }));
    return this.buildSnapshot(workspace);
  }

  async setDefaultThinkingLevel(workspace: WorkspaceRef, thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"]): Promise<RuntimeSnapshot> {
    await this.updateSettings((settings) => {
      const next = { ...settings };
      if (thinkingLevel) {
        next.defaultThinkingLevel = thinkingLevel;
      } else {
        delete next.defaultThinkingLevel;
      }
      return next;
    });
    return this.buildSnapshot(workspace);
  }

  async setEnableSkillCommands(workspace: WorkspaceRef, enabled: boolean): Promise<RuntimeSnapshot> {
    await this.updateSettings((settings) => ({
      ...settings,
      enableSkillCommands: enabled,
    }));
    return this.buildSnapshot(workspace);
  }

  /**
   * Writes pi's global auto-compaction switch — the same setting the `pi` CLI reads,
   * so this is deliberately not an app-local preference that could drift from it.
   */
  async setAutoCompaction(workspace: WorkspaceRef, enabled: boolean): Promise<RuntimeSnapshot> {
    await this.updateSettings((settings) => {
      const compaction = typeof settings.compaction === "object" && settings.compaction !== null
        ? (settings.compaction as Record<string, unknown>)
        : {};
      return { ...settings, compaction: { ...compaction, enabled } };
    });
    return this.buildSnapshot(workspace);
  }

  async setScopedModelPatterns(workspace: WorkspaceRef, patterns: readonly string[]): Promise<RuntimeSnapshot> {
    await this.updateSettings((settings) => ({
      ...settings,
      enabledModels: [...patterns],
    }));
    return this.buildSnapshot(workspace);
  }

  setSkillEnabled(_workspace: WorkspaceRef, _filePath: string, _enabled: boolean): Promise<RuntimeSnapshot> {
    return Promise.reject(unsupportedRpcDesktopOperation("external pi runtime setSkillEnabled"));
  }

  setExtensionEnabled(_workspace: WorkspaceRef, _filePath: string, _enabled: boolean): Promise<RuntimeSnapshot> {
    return Promise.reject(unsupportedRpcDesktopOperation("external pi runtime setExtensionEnabled"));
  }

  private async buildSnapshot(workspace: WorkspaceRef): Promise<RuntimeSnapshot> {
    const [settings, modelsJson, listOutput, authBridge] = await Promise.all([
      this.readSettings(),
      readJsonRecord(join(this.options.agentDir, "models.json")),
      this.runListModels(),
      this.authBridgeForSnapshot(),
    ]);
    const rows = parsePiListModels(listOutput);
    const customLabels = customModelLabels(modelsJson);
    const providerIds = new Set<string>();
    for (const row of rows) {
      providerIds.add(row.providerId);
    }
    for (const provider of Object.keys(readRecord(modelsJson.providers))) {
      providerIds.add(provider);
    }
    for (const provider of authBridge.listModelProviderIds()) {
      providerIds.add(provider);
    }
    for (const provider of authBridge.listCredentialProviderIds()) {
      providerIds.add(provider);
    }
    for (const provider of authBridge.getOAuthProviders()) {
      providerIds.add(provider.id);
    }
    if (typeof settings.defaultProvider === "string") {
      providerIds.add(settings.defaultProvider);
    }

    const metadataByKey = new Map(
      authBridge.listModelMetadata().map((entry) => [`${entry.providerId}/${entry.modelId}`, entry]),
    );
    const providers = [...providerIds].sort().map((providerId) => providerRecord(providerId, authBridge));
    const providerById = new Map(providers.map((provider) => [provider.id, provider]));
    const models = rows
      .map<RuntimeModelRecord>((row) => {
        const provider = providerById.get(row.providerId);
        const metadata = metadataByKey.get(`${row.providerId}/${row.modelId}`);
        return {
          providerId: row.providerId,
          providerName: provider?.name ?? row.providerId,
          modelId: row.modelId,
          label: customLabels.get(`${row.providerId}/${row.modelId}`) ?? row.modelId,
          available: true,
          authType: provider?.authType ?? "none",
          reasoning: row.reasoning,
          supportsImages: row.supportsImages,
          ...(metadata?.contextWindow !== undefined ? { contextWindow: metadata.contextWindow } : {}),
          ...(metadata?.api !== undefined ? { api: metadata.api } : {}),
        };
      })
      .sort((left, right) =>
        left.providerId === right.providerId
          ? left.modelId.localeCompare(right.modelId)
          : left.providerId.localeCompare(right.providerId),
      );

    return {
      workspace,
      providers,
      models,
      skills: [] satisfies RuntimeSkillRecord[],
      extensions: [] satisfies RuntimeExtensionRecord[],
      settings: runtimeSettingsFromRecord(settings),
    };
  }

  private async runPi(args: readonly string[]): Promise<string> {
    const resolvedPiBin = await realPiPath(this.options.piBin);
    const command = resolvePiRpcSpawnCommand(this.options.piBin, resolvedPiBin);
    const baseEnv = {
      ...process.env,
      ...this.options.env,
      PATH: buildPiRpcPathEnv(this.options.piBin, resolvedPiBin, this.options.env?.PATH ?? process.env.PATH),
      PI_CODING_AGENT_DIR: this.options.agentDir,
    };
    const env = isWslPiExecutable(resolvedPiBin)
      ? buildWslPathEnvironment(baseEnv, ["PI_CODING_AGENT_DIR"])
      : baseEnv;
    return new Promise((resolve, reject) => {
      execFile(command.command, [...command.args, ...args], {
        env,
        timeout: LIST_MODELS_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`pi ${args.join(" ")} failed: ${error.message}${stderr ? `\n${stderr}` : ""}`));
          return;
        }
        resolve(stdout);
      });
    });
  }

  private readSettings(): Promise<Record<string, unknown>> {
    return readJsonRecord(join(this.options.agentDir, "settings.json"));
  }

  private runListModels(): Promise<string> {
    if (this.listModelsInFlight) {
      return this.listModelsInFlight;
    }

    const request = this.runPi(["--list-models"]);
    this.listModelsInFlight = request;
    void request.then(
      () => {
        if (this.listModelsInFlight === request) {
          this.listModelsInFlight = undefined;
        }
      },
      () => {
        if (this.listModelsInFlight === request) {
          this.listModelsInFlight = undefined;
        }
      },
    );
    return request;
  }

  private authBridge(): Promise<ExternalPiAuthBridge> {
    return loadExternalPiAuthBridge({
      piBin: this.options.piBin,
      agentDir: this.options.agentDir,
    });
  }

  private async authBridgeForSnapshot(): Promise<ExternalPiAuthBridge> {
    try {
      return await this.authBridge();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Alamelu Pi could not load Pi provider authentication metadata: ${message}`);
      return createUnavailableExternalPiAuthBridge(message);
    }
  }

  private async updateSettings(mutator: (settings: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
    const settingsPath = join(this.options.agentDir, "settings.json");
    const before = await readJsonRecord(settingsPath);
    const next = mutator({ ...before });
    await writeJsonAtomic(settingsPath, next);
  }
}

function providerRecord(providerId: string, authBridge: ExternalPiAuthBridge): RuntimeProviderRecord {
  const oauthProvider = authBridge.getOAuthProviders().find((provider) => provider.id === providerId);
  const apiKeySetupSupported = authBridge.supportsApiKey(providerId);
  const authStatus = authBridge.getAuthStatus(providerId);
  const storedAuthType = authBridge.getStoredAuthType(providerId);
  const authType = storedAuthType ?? (authStatus.configured && apiKeySetupSupported ? "api_key" : "none");
  return {
    id: providerId,
    name: oauthProvider?.name ?? authBridge.getProviderDisplayName(providerId),
    hasAuth: authStatus.configured,
    authType,
    authSource: providerAuthSource(authStatus, authType),
    oauthSupported: Boolean(oauthProvider),
    apiKeySetupSupported,
  };
}

function providerAuthSource(
  authStatus: ExternalPiAuthStatus,
  authType: RuntimeProviderRecord["authType"],
): RuntimeProviderRecord["authSource"] {
  if (!authStatus.configured) {
    return "none";
  }
  if (authStatus.source === "stored") {
    return authType === "oauth" ? "oauth" : authType === "api_key" ? "auth_file" : "external";
  }
  if (authStatus.source === "environment") {
    return "env";
  }
  return "external";
}

/** pi's fallback is `true`, so absence means enabled. */
function autoCompactionFromRecord(record: Record<string, unknown>): boolean {
  const compaction = record.compaction;
  if (typeof compaction !== "object" || compaction === null) return true;
  return (compaction as { enabled?: unknown }).enabled !== false;
}

function runtimeSettingsFromRecord(record: Record<string, unknown>): RuntimeSettingsSnapshot {
  return {
    ...(typeof record.defaultProvider === "string" ? { defaultProvider: record.defaultProvider } : {}),
    ...(typeof record.defaultModel === "string" ? { defaultModelId: record.defaultModel } : {}),
    ...(isThinkingLevel(record.defaultThinkingLevel) ? { defaultThinkingLevel: record.defaultThinkingLevel } : {}),
    enableSkillCommands: record.enableSkillCommands !== false,
    autoCompactionEnabled: autoCompactionFromRecord(record),
    enabledModelPatterns: enabledModelPatternsFromRecord(record),
  };
}

function modelSettingsFromRecord(record: Record<string, unknown>): ModelSettingsSnapshot {
  const settings = runtimeSettingsFromRecord(record);
  return {
    ...(settings.defaultProvider ? { defaultProvider: settings.defaultProvider } : {}),
    ...(settings.defaultModelId ? { defaultModelId: settings.defaultModelId } : {}),
    ...(settings.defaultThinkingLevel ? { defaultThinkingLevel: settings.defaultThinkingLevel } : {}),
    enabledModelPatterns: settings.enabledModelPatterns,
  };
}

function enabledModelPatternsFromRecord(record: Record<string, unknown>): readonly string[] {
  const value = Array.isArray(record.enabledModels) ? record.enabledModels : record.enabledModelPatterns;
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function isThinkingLevel(value: unknown): value is RuntimeSettingsSnapshot["defaultThinkingLevel"] {
  return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

async function readJsonRecord(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return readRecord(parsed);
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }
    throw error;
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function customModelLabels(modelsJson: Record<string, unknown>): Map<string, string> {
  const labels = new Map<string, string>();
  const providers = readRecord(modelsJson.providers);
  for (const [providerId, providerConfig] of Object.entries(providers)) {
    const models = readRecord(providerConfig).models;
    if (!Array.isArray(models)) {
      continue;
    }
    for (const model of models) {
      const modelRecord = readRecord(model);
      if (typeof modelRecord.id !== "string") {
        continue;
      }
      labels.set(`${providerId}/${modelRecord.id}`, typeof modelRecord.name === "string" ? modelRecord.name : modelRecord.id);
    }
  }
  return labels;
}

async function writeJsonAtomic(filePath: string, value: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const existingMode = await fileMode(filePath);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, { mode: existingMode ?? SETTINGS_WRITE_MODE });
  await chmod(tmpPath, existingMode ?? SETTINGS_WRITE_MODE).catch(() => undefined);
  await rename(tmpPath, filePath);
}

async function fileMode(filePath: string): Promise<number | undefined> {
  try {
    return (await stat(filePath)).mode & 0o777;
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function realPiPath(piBin: string): Promise<string> {
  await access(piBin, constants.X_OK);
  return realpath(piBin);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
