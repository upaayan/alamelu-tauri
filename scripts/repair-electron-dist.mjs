#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const electronPackageDir = path.join(root, "node_modules", "electron");
const electronPackageJson = require(path.join(electronPackageDir, "package.json"));
const electronVersion = electronPackageJson.version;
const platform = process.platform;
const arch = process.arch;
const platformPath = platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : platform === "win32" ? "electron.exe" : "electron";
const electronBin = path.join(electronPackageDir, "dist", platformPath);

function currentElectronWorks() {
  if (!existsSync(electronBin)) return false;
  try {
    const version = execFileSync(electronBin, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().replace(/^v/, "");
    return version === electronVersion;
  } catch {
    return false;
  }
}

if (currentElectronWorks()) {
  console.log(`Electron ${electronVersion} already installed at ${electronBin}`);
  process.exit(0);
}

const cacheRoot = path.join(homedir(), "Library", "Caches", "electron");
const zipName = `electron-v${electronVersion}-${platform}-${arch}.zip`;
const zipPath = findFile(cacheRoot, zipName);
if (!zipPath) {
  console.error(`Could not find cached Electron zip: ${zipName}`);
  console.error(`Expected under: ${cacheRoot}`);
  process.exit(1);
}

const distDir = path.join(electronPackageDir, "dist");
rmSync(distDir, { recursive: true, force: true });
rmSync(path.join(electronPackageDir, "path.txt"), { force: true });
mkdirSync(distDir, { recursive: true });
execFileSync("unzip", ["-q", zipPath, "-d", distDir], { stdio: "inherit" });
writeFileSync(path.join(electronPackageDir, "path.txt"), platformPath);

if (!currentElectronWorks()) {
  console.error(`Electron repair failed for ${electronVersion}`);
  process.exit(1);
}

console.log(`Repaired Electron ${electronVersion} at ${electronBin}`);

function findFile(dir, basename) {
  if (!existsSync(dir)) return undefined;
  const queue = [dir];
  while (queue.length > 0) {
    const current = queue.shift();
    let entries;
    try {
      entries = require("node:fs").readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isFile() && entry.name === basename) return full;
      if (entry.isDirectory()) queue.push(full);
    }
  }
  return undefined;
}
