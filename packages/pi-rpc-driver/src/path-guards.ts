import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface LabPathInput {
  readonly agentDir: string;
  readonly sessionDir: string;
  readonly userDataDir: string;
  readonly labWorkspace: string;
  readonly productionAgentDir?: string;
  readonly productionUserDataDir?: string;
  readonly expectedLabWorkspaceRoot?: string;
  readonly allowRealPiState?: boolean;
  readonly allowSharedAgentDir?: boolean;
  readonly allowProductionUserData?: boolean;
  readonly allowRealWorkspace?: boolean;
}

export interface LabPathValidationOptions {
  readonly homeDir?: string;
}

export interface ValidatedLabPaths {
  readonly agentDir: string;
  readonly sessionDir: string;
  readonly userDataDir: string;
  readonly labWorkspace: string;
  readonly productionAgentDir: string;
  readonly productionUserDataDir: string;
  readonly expectedLabWorkspaceRoot: string;
}

export function expandHomePath(value: string, homeDir = os.homedir()): string {
  if (value === "~") return homeDir;
  if (value.startsWith(`~${path.sep}`) || value.startsWith("~/")) return path.join(homeDir, value.slice(2));
  if (value.startsWith("$HOME")) return path.join(homeDir, value.slice("$HOME".length));
  return value;
}

export function canonicalizePath(value: string, homeDir = os.homedir()): string {
  const expanded = expandHomePath(value, homeDir);
  const absolute = path.resolve(expanded);
  try {
    return fs.realpathSync.native(absolute);
  } catch {
    return canonicalizeViaNearestExistingAncestor(absolute);
  }
}

function canonicalizeViaNearestExistingAncestor(absolutePath: string): string {
  const parsed = path.parse(absolutePath);
  let current = absolutePath;
  const missingSegments: string[] = [];

  while (current !== parsed.root && !fs.existsSync(current)) {
    missingSegments.unshift(path.basename(current));
    current = path.dirname(current);
  }

  try {
    const realAncestor = fs.realpathSync.native(current);
    return path.join(realAncestor, ...missingSegments);
  } catch {
    return absolutePath;
  }
}

export function pathContains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function validateLabPaths(input: LabPathInput, options: LabPathValidationOptions = {}): ValidatedLabPaths {
  const homeDir = options.homeDir ?? os.homedir();
  const agentDir = canonicalizePath(input.agentDir, homeDir);
  const sessionDir = canonicalizePath(input.sessionDir, homeDir);
  const userDataDir = canonicalizePath(input.userDataDir, homeDir);
  const labWorkspace = canonicalizePath(input.labWorkspace, homeDir);
  const productionAgentDir = canonicalizePath(input.productionAgentDir ?? "~/.pi/agent", homeDir);
  const productionUserDataDir = canonicalizePath(input.productionUserDataDir ?? defaultProductionUserDataDir(homeDir), homeDir);
  const expectedLabWorkspaceRoot = canonicalizePath(input.expectedLabWorkspaceRoot ?? "~/tmp/pi-gui-rpc-workspace", homeDir);

  if (!input.allowRealPiState && pathContains(productionAgentDir, agentDir)) {
    if (!input.allowSharedAgentDir || agentDir !== productionAgentDir) {
      throw new Error(`Refusing to use production Pi agent directory for RPC lab: ${agentDir}`);
    }
  }

  if (!input.allowRealPiState && pathContains(productionAgentDir, sessionDir)) {
    throw new Error(`Refusing to use production Pi session directory for RPC lab: ${sessionDir}`);
  }

  if (!input.allowProductionUserData && pathContains(productionUserDataDir, userDataDir)) {
    throw new Error(`Refusing to use production pi-gui userData directory for RPC lab: ${userDataDir}`);
  }

  if (!input.allowRealWorkspace) {
    if (pathContains(productionAgentDir, labWorkspace)) {
      throw new Error(`Refusing to use production Pi path as RPC lab workspace: ${labWorkspace}`);
    }
    if (!pathContains(expectedLabWorkspaceRoot, labWorkspace)) {
      throw new Error(`Refusing to use non-throwaway RPC lab workspace without explicit override: ${labWorkspace}`);
    }
  }

  return {
    agentDir,
    sessionDir,
    userDataDir,
    labWorkspace,
    productionAgentDir,
    productionUserDataDir,
    expectedLabWorkspaceRoot,
  };
}

function defaultProductionUserDataDir(homeDir: string): string {
  return path.join(homeDir, "Library", "Application Support", "pi-gui");
}
