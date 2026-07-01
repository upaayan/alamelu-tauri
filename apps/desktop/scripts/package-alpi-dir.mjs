import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, rmSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const releaseDir = path.join(desktopDir, "release-alpi");
const appPath = path.join(releaseDir, "mac-arm64", "alpi.app");
const entitlementsPath = path.join(desktopDir, "resources", "entitlements.mac.plist");
const secretId = process.env.ALAMELU_PI_CODESIGN_SECRET_ID ?? "alamelu/pi-codesign";
const secretRegion = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "ap-south-1";

const secret = readSigningSecret();
for (const field of ["keychain_path", "keychain_password", "identity_hash"]) {
  if (typeof secret[field] !== "string" || secret[field].length === 0) {
    throw new Error(`Missing signing secret field: ${field}`);
  }
}

rmSync(releaseDir, { recursive: true, force: true });
run("pnpm", ["run", "build"], { cwd: desktopDir });
run("pnpm", [
  "exec",
  "electron-builder",
  "--mac",
  "--dir",
  "--publish",
  "never",
  "-c",
  "electron-builder.alpi.yml",
  "-c.mac.identity=null",
], {
  cwd: desktopDir,
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
  },
});

if (!existsSync(appPath)) {
  throw new Error(`Unsigned Alamelu Pi app was not produced at ${appPath}`);
}
if (!existsSync(entitlementsPath)) {
  throw new Error(`Alamelu Pi entitlements file not found: ${entitlementsPath}`);
}

runQuiet("security", ["unlock-keychain", "-p", secret.keychain_password, secret.keychain_path], "keychain unlock");
runQuiet(
  "security",
  ["set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", secret.keychain_password, secret.keychain_path],
  "key partition update",
);
deleteCodeSignTempFiles(appPath);
run("codesign", [
  "--force",
  "--deep",
  "--options",
  "runtime",
  "--entitlements",
  entitlementsPath,
  "--keychain",
  secret.keychain_path,
  "--sign",
  secret.identity_hash,
  appPath,
], { cwd: desktopDir });
run("codesign", ["--verify", "--deep", "--strict", "--verbose=1", appPath], { cwd: desktopDir });

console.log(`Packaged and signed Alamelu Pi at ${appPath}`);

function readSigningSecret() {
  const secretRaw = execFileSync("aws", [
    "secretsmanager",
    "get-secret-value",
    "--region",
    secretRegion,
    "--secret-id",
    secretId,
    "--query",
    "SecretString",
    "--output",
    "text",
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(secretRaw);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
}

function runQuiet(command, args, label) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    throw new Error(`${label} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

function deleteCodeSignTempFiles(rootPath) {
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      deleteCodeSignTempFiles(entryPath);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".cstemp")) {
      unlinkSync(entryPath);
    }
  }
}
