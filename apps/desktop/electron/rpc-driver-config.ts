import path from "node:path";
import { canonicalizePath, expandHomePath, validateLabPaths } from "@alamelu-pi/pi-rpc-driver";

export type DesktopDriverKind = "sdk" | "rpc";

export interface DesktopDefaultRpcConfig {
  readonly piBin: string;
  readonly agentDir: string;
  readonly sessionDir: string;
  readonly userDataDir: string;
  readonly labWorkspace: string;
  readonly expectedLabWorkspaceRoot?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly allowSharedAgentDir?: boolean;
  readonly noTools?: boolean;
  readonly noExtensions?: boolean;
  readonly noSkills?: boolean;
  readonly noPromptTemplates?: boolean;
  readonly noThemes?: boolean;
  readonly allowRealWorkspace?: boolean;
}

export interface DesktopDriverConfigOptions {
  readonly homeDir?: string;
  readonly defaultUserDataDir: string;
  readonly productionAgentDir?: string;
  readonly productionUserDataDir?: string;
  readonly defaultDriver?: DesktopDriverKind;
  readonly defaultRpc?: DesktopDefaultRpcConfig;
}

export interface DesktopSdkDriverConfig {
  readonly driver: "sdk";
  readonly userDataDir: string;
}

export interface DesktopRpcDriverConfig {
  readonly driver: "rpc";
  readonly userDataDir: string;
  readonly rpc: {
    readonly piBin: string;
    readonly agentDir: string;
    readonly sessionDir: string;
    readonly userDataDir: string;
    readonly labWorkspace: string;
    readonly productionUserDataDir: string;
    readonly provider?: string;
    readonly model?: string;
    readonly allowSharedAgentDir?: boolean;
    readonly noTools?: boolean;
    readonly noExtensions?: boolean;
    readonly noSkills?: boolean;
    readonly noPromptTemplates?: boolean;
    readonly noThemes?: boolean;
    readonly allowRealWorkspace?: boolean;
  };
}

export type DesktopDriverConfig = DesktopSdkDriverConfig | DesktopRpcDriverConfig;

export interface ThreadStoragePaths {
  readonly sessionDir: string;
  readonly catalogFilePath: string;
  readonly noRepositoryWorkspacePath: string;
}

export function resolveThreadStoragePaths(
  env: NodeJS.ProcessEnv,
  defaultUserDataDir: string,
  homeDir?: string,
): ThreadStoragePaths {
  const root = canonicalizePath(
    env.PI_GUI_SHARED_THREAD_DATA_DIR?.trim() || defaultUserDataDir,
    homeDir,
  );
  return {
    sessionDir: path.join(root, "sessions"),
    catalogFilePath: path.join(root, "catalogs.json"),
    noRepositoryWorkspacePath: path.join(root, "No Repository"),
  };
}

export function resolveDesktopDriverConfig(
  env: NodeJS.ProcessEnv,
  options: DesktopDriverConfigOptions,
): DesktopDriverConfig {
  const driver = normalizeDriver(env.PI_GUI_DRIVER, options.defaultDriver);
  const homeDir = options.homeDir;

  if (driver === "sdk") {
    return {
      driver: "sdk",
      userDataDir: canonicalizePath(env.PI_APP_USER_DATA_DIR?.trim() || options.defaultUserDataDir, homeDir),
    };
  }

  const defaultRpc = options.defaultRpc;
  const piBin = envOrDefault(env, "PI_GUI_PI_BIN", defaultRpc?.piBin);
  const expandedPiBin = expandHomePath(piBin, homeDir);
  if (!path.isAbsolute(expandedPiBin)) {
    throw new Error(`PI_GUI_PI_BIN must be a resolved absolute pi binary path, got: ${piBin}`);
  }
  const resolvedPiBin = canonicalizePath(expandedPiBin, homeDir);

  const agentDir = envOrDefault(env, "PI_CODING_AGENT_DIR", defaultRpc?.agentDir);
  const sessionDir = envOrDefault(env, "PI_CODING_AGENT_SESSION_DIR", defaultRpc?.sessionDir);
  const userDataDir = envOrDefault(env, "PI_GUI_USER_DATA_DIR", env.PI_APP_USER_DATA_DIR?.trim() || defaultRpc?.userDataDir);
  const labWorkspace = envOrDefault(env, "PI_GUI_LAB_WORKSPACE", defaultRpc?.labWorkspace);

  const productionUserDataDir = canonicalizePath(options.productionUserDataDir ?? options.defaultUserDataDir, homeDir);
  const paths = validateLabPaths(
    {
      agentDir,
      sessionDir,
      userDataDir,
      labWorkspace,
      productionAgentDir: options.productionAgentDir ?? "~/.pi/agent",
      productionUserDataDir,
      expectedLabWorkspaceRoot: env.PI_GUI_EXPECTED_LAB_WORKSPACE_ROOT || defaultRpc?.expectedLabWorkspaceRoot || defaultRpc?.labWorkspace || labWorkspace,
      allowRealPiState: env.PI_GUI_ALLOW_REAL_PI_STATE === "1",
      allowSharedAgentDir: env.PI_GUI_ALLOW_SHARED_AGENT_DIR === "1" || defaultRpc?.allowSharedAgentDir === true,
      allowProductionUserData: env.PI_GUI_ALLOW_PRODUCTION_USER_DATA === "1",
      allowRealWorkspace: env.PI_GUI_ALLOW_REAL_WORKSPACE === "1" || defaultRpc?.allowRealWorkspace === true,
    },
    { ...(homeDir ? { homeDir } : {}) },
  );

  return {
    driver: "rpc",
    userDataDir: paths.userDataDir,
    rpc: {
      piBin: resolvedPiBin,
      agentDir: paths.agentDir,
      sessionDir: paths.sessionDir,
      userDataDir: paths.userDataDir,
      labWorkspace: paths.labWorkspace,
      productionUserDataDir,
      ...(env.PI_GUI_RPC_PROVIDER?.trim() || defaultRpc?.provider ? { provider: env.PI_GUI_RPC_PROVIDER?.trim() || defaultRpc?.provider } : {}),
      ...(env.PI_GUI_RPC_MODEL?.trim() || defaultRpc?.model ? { model: env.PI_GUI_RPC_MODEL?.trim() || defaultRpc?.model } : {}),
      ...(defaultRpc?.allowSharedAgentDir === true ? { allowSharedAgentDir: true } : {}),
      ...(defaultRpc?.noTools !== undefined ? { noTools: defaultRpc.noTools } : {}),
      ...(defaultRpc?.noExtensions !== undefined ? { noExtensions: defaultRpc.noExtensions } : {}),
      ...(defaultRpc?.noSkills !== undefined ? { noSkills: defaultRpc.noSkills } : {}),
      ...(defaultRpc?.noPromptTemplates !== undefined ? { noPromptTemplates: defaultRpc.noPromptTemplates } : {}),
      ...(defaultRpc?.noThemes !== undefined ? { noThemes: defaultRpc.noThemes } : {}),
      ...(defaultRpc?.allowRealWorkspace === true ? { allowRealWorkspace: true } : {}),
    },
  };
}

function normalizeDriver(value: string | undefined, defaultDriver: DesktopDriverKind = "sdk"): DesktopDriverKind {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return defaultDriver;
  if (normalized === "sdk") return "sdk";
  if (normalized === "rpc") return "rpc";
  throw new Error(`Unsupported PI_GUI_DRIVER: ${value}`);
}

function envOrDefault(env: NodeJS.ProcessEnv, name: string, defaultValue: string | undefined): string {
  const value = env[name]?.trim() || defaultValue?.trim();
  if (!value) {
    throw new Error(`${name} is required when PI_GUI_DRIVER=rpc`);
  }
  return value;
}
