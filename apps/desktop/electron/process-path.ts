import { existsSync, readdirSync, realpathSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";

export interface BuildPackagedAppPathOptions {
  readonly currentPath?: string;
  readonly homeDir: string;
  readonly piBin?: string;
  readonly candidateDirs?: readonly string[];
  readonly exists?: (entry: string) => boolean;
}

export interface NormalizeProcessPathOptions extends BuildPackagedAppPathOptions {
  readonly env?: NodeJS.ProcessEnv;
}

export function buildPackagedAppPath(options: BuildPackagedAppPathOptions): string {
  const exists = options.exists ?? existsSync;
  const candidates = [
    ...(options.piBin ? [dirname(options.piBin)] : []),
    ...(options.candidateDirs ?? defaultExecutableCandidateDirs(options.homeDir)),
  ];
  return uniquePathEntries([
    ...candidates.filter((entry) => exists(entry)),
    ...splitPath(options.currentPath),
  ]).join(delimiter);
}

export function normalizeProcessPathForPackagedApp(options: NormalizeProcessPathOptions): string {
  const env = options.env ?? process.env;
  const nextPath = buildPackagedAppPath({
    currentPath: env.PATH,
    homeDir: options.homeDir,
    ...(options.piBin ? { piBin: options.piBin } : {}),
    ...(options.candidateDirs ? { candidateDirs: options.candidateDirs } : {}),
    ...(options.exists ? { exists: options.exists } : {}),
  });
  env.PATH = nextPath;
  return nextPath;
}

export interface ResolveInstalledPiBinOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir: string;
  readonly exists?: (entry: string) => boolean;
  readonly realpath?: (entry: string) => string;
  readonly readDir?: (entry: string) => string[];
}

export function resolveInstalledPiBin(options: ResolveInstalledPiBinOptions): string {
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const realpath = options.realpath ?? realpathSync.native;
  const explicit = env.PI_GUI_PI_BIN?.trim();
  const candidates = [
    ...(explicit ? [expandHome(explicit, options.homeDir)] : []),
    ...splitPath(env.PATH).map((entry) => join(entry, "pi")),
    ...nvmPiCandidates(options),
    join(options.homeDir, ".local", "bin", "pi"),
    "/opt/homebrew/bin/pi",
    "/usr/local/bin/pi",
    join(options.homeDir, ".pi", "agent", "bin", "pi"),
  ];

  for (const candidate of candidates) {
    const absolute = isAbsolute(candidate) ? candidate : resolve(candidate);
    if (exists(absolute)) {
      return realpath(absolute);
    }
  }

  throw new Error("Could not find installed pi. Set PI_GUI_PI_BIN to the base pi executable.");
}

export function splitPath(value: string | undefined): string[] {
  return (value ?? "").split(delimiter).map((entry) => entry.trim()).filter(Boolean);
}

export function uniquePathEntries(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const entry of entries) {
    if (!entry || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    unique.push(entry);
  }
  return unique;
}

function defaultExecutableCandidateDirs(homeDir: string): string[] {
  return [
    join(homeDir, ".pi/agent/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/opt/local/bin",
    join(homeDir, ".local/bin"),
  ];
}

function nvmPiCandidates(options: ResolveInstalledPiBinOptions): string[] {
  const readDir = options.readDir ?? ((entry: string) => readdirSync(entry));
  const versionsDir = join(options.homeDir, ".nvm", "versions", "node");
  let versions: string[];
  try {
    versions = readDir(versionsDir);
  } catch {
    return [];
  }

  return versions
    .filter((entry) => /^v?\d+\.\d+\.\d+$/.test(entry))
    .sort(compareNodeVersionsDesc)
    .map((entry) => join(versionsDir, entry, "bin", "pi"));
}

function compareNodeVersionsDesc(left: string, right: string): number {
  const l = parseNodeVersion(left);
  const r = parseNodeVersion(right);
  for (let i = 0; i < 3; i += 1) {
    const diff = (r[i] ?? 0) - (l[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return right.localeCompare(left);
}

function parseNodeVersion(value: string): number[] {
  return value.replace(/^v/, "").split(".").map((part) => Number(part) || 0);
}

function expandHome(value: string, homeDir: string): string {
  if (value === "~") {
    return homeDir;
  }
  if (value.startsWith("~/")) {
    return join(homeDir, value.slice(2));
  }
  return value;
}
