import { execFileSync } from "node:child_process";
import { constants, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const requiredPackages = [
  // Keep packaging-sensitive runtime transitive deps explicit; electron-builder
  // can omit hoisted pnpm dependencies even when local development resolves them.
  "@xterm/addon-clipboard",
  "@xterm/addon-fit",
  "@xterm/addon-web-links",
  "@xterm/xterm",
  "ansi-regex",
  "balanced-match",
  "brace-expansion",
  "chalk",
  "cli-highlight",
  "data-uri-to-buffer",
  "glob",
  "hosted-git-info",
  "isexe",
  "lru-cache",
  "mime-types",
  "minimatch",
  "node-pty",
  "parse5",
  "parse5-htmlparser2-tree-adapter",
  "proxy-agent",
  "retry",
  "strip-ansi",
  "which",
  "yargs",
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const packagePlatform = (process.env.PI_APP_PACKAGE_PLATFORM ?? process.platform).trim().toLowerCase();
const packageFlavor = (process.env.PI_APP_PACKAGE_FLAVOR ?? "alpi").trim().toLowerCase();
const packagedAppPaths = resolvePackagedAppPaths(desktopDir, packagePlatform, packageFlavor);
const asarPath = packagedAppPaths.asarPath;
const notificationHelperPath = packagedAppPaths.notificationHelperPath;
const pnpmExecCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const pnpmExecPrefix = ["--yes", "pnpm@10.25.0", "exec"];
const forbiddenPiRuntimePackages = [
  ["@earendil-works", "pi-coding-agent"],
  ["@earendil-works", "pi-ai"],
  ["@earendil-works", "pi-agent-core"],
];
const packagedRuntimeImportChecks = [
  ["cli-highlight", "dist", "index.js"],
  ["proxy-agent", "dist", "index.js"],
];

if (!existsSync(asarPath)) {
  throw new Error(`Packaged app.asar not found at ${asarPath}. Run the packaging step first.`);
}

if (notificationHelperPath && !existsSync(notificationHelperPath)) {
  throw new Error(`Packaged app is missing notification helper: ${notificationHelperPath}`);
}

const extractedDir = mkdtempSync(path.join(tmpdir(), "alamelu-pi-packaged-runtime-"));
try {
  execFileSync(pnpmExecCommand, [...pnpmExecPrefix, "asar", "extract", asarPath, extractedDir], {
    cwd: desktopDir,
    stdio: "pipe",
  });

  verifyRequiredPackages(extractedDir);
  verifyNoPackagedPiRuntime(extractedDir);
  await verifyPackagedRuntimeImports(extractedDir);
  await verifyNativeNodePty(asarPath);
} finally {
  rmSync(extractedDir, { recursive: true, force: true });
}

console.log(`Verified packaged runtime dependencies in ${asarPath}`);

function resolvePackagedAppPaths(desktopDir, packagePlatform, packageFlavor) {
  if (packagePlatform === "darwin") {
    const appName = "alpi.app";
    const releaseDir = "release-alpi";
    const appRoot = path.join(desktopDir, releaseDir, "mac-arm64", appName);
    return {
      asarPath: path.join(appRoot, "Contents", "Resources", "app.asar"),
      notificationHelperPath: path.join(appRoot, "Contents", "MacOS", "alamelu-pi-notification-status-helper"),
    };
  }

  if (packagePlatform === "linux") {
    const releaseDir = path.join(desktopDir, "release-alpi");
    const unpackedAsarPath = readdirSync(releaseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^linux(?:-[\w]+)?-unpacked$/.test(entry.name))
      .map((entry) => path.join(releaseDir, entry.name, "resources", "app.asar"))
      .find((candidatePath) => existsSync(candidatePath));

    return {
      asarPath: unpackedAsarPath ?? path.join(releaseDir, "linux-unpacked", "resources", "app.asar"),
      notificationHelperPath: undefined,
    };
  }

  throw new Error(`Unsupported packaged runtime dependency target: ${packagePlatform}`);
}

function verifyRequiredPackages(extractedDir) {
  const missingPackages = requiredPackages.filter(
    (packageName) => !existsSync(path.join(extractedDir, "node_modules", packageName)),
  );

  if (missingPackages.length > 0) {
    throw new Error(`Packaged app is missing runtime dependencies: ${missingPackages.join(", ")}`);
  }
}

function verifyNoPackagedPiRuntime(extractedDir) {
  const presentPackages = forbiddenPiRuntimePackages
    .map((packageParts) => path.join(extractedDir, "node_modules", ...packageParts))
    .filter((packagePath) => existsSync(packagePath));
  if (presentPackages.length > 0) {
    throw new Error(`Packaged app contains forbidden bundled Pi runtime packages: ${presentPackages.join(", ")}`);
  }
}

async function verifyPackagedRuntimeImports(extractedDir) {
  for (const modulePath of packagedRuntimeImportChecks) {
    const runtimeEntry = path.join(extractedDir, "node_modules", ...modulePath);
    await import(pathToFileURL(runtimeEntry).href);
  }
}

async function verifyNativeNodePty(asarPath) {
  const unpackedResourcesDir = `${asarPath}.unpacked`;
  const nodePtyDir = path.join(unpackedResourcesDir, "node_modules", "node-pty");
  if (!existsSync(nodePtyDir) || !hasFileWithExtension(nodePtyDir, ".node")) {
    throw new Error(`Packaged app is missing unpacked node-pty native module under ${nodePtyDir}`);
  }
  if (packagePlatform !== "darwin") {
    return;
  }
  const helperPath = findFileNamed(nodePtyDir, "spawn-helper");
  if (!helperPath) {
    throw new Error(`Packaged app is missing unpacked node-pty spawn-helper under ${nodePtyDir}`);
  }
  await access(helperPath, constants.X_OK);
}

function hasFileWithExtension(directoryPath, extension) {
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isFile() && entry.name.endsWith(extension)) {
      return true;
    }
    if (entry.isDirectory() && hasFileWithExtension(entryPath, extension)) {
      return true;
    }
  }
  return false;
}

function findFileNamed(directoryPath, fileName) {
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return entryPath;
    }
    if (entry.isDirectory()) {
      const nestedMatch = findFileNamed(entryPath, fileName);
      if (nestedMatch) {
        return nestedMatch;
      }
    }
  }
  return undefined;
}
