import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appPath = path.join(
  desktopDir,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "macos",
  "Alamelu Pi Tauri.app",
);
const secretId = process.env.ALAMELU_PI_CODESIGN_SECRET_ID ?? "alamelu/pi-codesign";
const secretRegion = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "ap-south-1";

if (!fs.existsSync(appPath)) {
  throw new Error(`Tauri candidate is missing: ${appPath}`);
}

const secret = JSON.parse(
  execFileSync(
    "aws",
    [
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
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
for (const field of ["keychain_path", "keychain_password", "identity_hash"]) {
  if (typeof secret[field] !== "string" || !secret[field]) {
    throw new Error(`Signing secret is missing ${field}`);
  }
}

runQuiet(
  "security",
  ["unlock-keychain", "-p", secret.keychain_password, secret.keychain_path],
  "keychain unlock",
);
runQuiet(
  "security",
  [
    "set-key-partition-list",
    "-S",
    "apple-tool:,apple:,codesign:",
    "-s",
    "-k",
    secret.keychain_password,
    secret.keychain_path,
  ],
  "key partition update",
);
run("codesign", [
  "--force",
  "--deep",
  "--options",
  "runtime",
  "--keychain",
  secret.keychain_path,
  "--sign",
  secret.identity_hash,
  appPath,
]);
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);

const detailResult = spawnSync("codesign", ["-dv", "--verbose=4", appPath], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const details = `${detailResult.stdout || ""}\n${detailResult.stderr || ""}`;
if (!details.includes("Runtime Version")) {
  throw new Error("Signed Tauri candidate does not have hardened runtime");
}
console.log(`Signed Tauri candidate: ${appPath}`);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

function runQuiet(command, args, label) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${(result.stderr || "").trim()}`);
  }
}
