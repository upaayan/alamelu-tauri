import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { delimiter, dirname, join, sep } from "node:path";
import { homedir } from "node:os";

const homeDir = homedir();
const piBin = resolvePiBin();
const piVersion = runPi(["--version"]).trim();
const zaiModels = runPi(["--list-models", "zai"]);

if (!/^0\.\d+\.\d+/.test(piVersion)) {
  throw new Error(`Unexpected external pi version output from ${piBin}: ${piVersion}`);
}

if (!/^zai\s+glm-5\.2\s/m.test(zaiModels)) {
  throw new Error(`External pi at ${piBin} does not expose zai/glm-5.2 via pi --list-models zai.`);
}

console.log(`Verified external pi runtime ${piVersion} at ${piBin} exposes zai/glm-5.2.`);

function runPi(args) {
  const command = resolvePiCommand(piBin);
  return execFileSync(command.command, [...command.args, ...args], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      PATH: buildPiPath(piBin),
    },
  });
}

function resolvePiBin() {
  const explicit = process.env.PI_GUI_PI_BIN?.trim();
  const candidates = [
    ...(explicit ? [expandHome(explicit)] : []),
    ...splitPath(process.env.PATH).map((entry) => join(entry, "pi")),
    ...nvmPiCandidates(),
    join(homeDir, ".local", "bin", "pi"),
    "/opt/homebrew/bin/pi",
    "/usr/local/bin/pi",
    join(homeDir, ".pi", "agent", "bin", "pi"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return realpathSync.native(candidate);
    }
  }
  throw new Error("Could not find installed pi. Set PI_GUI_PI_BIN.");
}

function resolvePiCommand(resolvedPiBin) {
  const nodeModulesMarker = `${sep}lib${sep}node_modules${sep}`;
  const markerIndex = resolvedPiBin.indexOf(nodeModulesMarker);
  if (markerIndex > 0) {
    const nodeBin = join(resolvedPiBin.slice(0, markerIndex), "bin", process.platform === "win32" ? "node.exe" : "node");
    if (existsSync(nodeBin)) {
      return { command: nodeBin, args: [resolvedPiBin] };
    }
  }
  return { command: resolvedPiBin, args: [] };
}

function buildPiPath(resolvedPiBin) {
  return [...new Set([dirname(resolvedPiBin), ...splitPath(process.env.PATH)])].join(delimiter);
}

function splitPath(value) {
  return (value ?? "").split(delimiter).map((entry) => entry.trim()).filter(Boolean);
}

function nvmPiCandidates() {
  const versionsDir = join(homeDir, ".nvm", "versions", "node");
  let versions;
  try {
    versions = readdirSync(versionsDir);
  } catch {
    return [];
  }
  return versions
    .filter((entry) => /^v?\d+\.\d+\.\d+$/.test(entry))
    .sort(compareNodeVersionsDesc)
    .map((entry) => join(versionsDir, entry, "bin", "pi"));
}

function compareNodeVersionsDesc(left, right) {
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

function parseNodeVersion(value) {
  return value.replace(/^v/, "").split(".").map((part) => Number(part) || 0);
}

function expandHome(value) {
  if (value === "~") {
    return homeDir;
  }
  if (value.startsWith("~/")) {
    return join(homeDir, value.slice(2));
  }
  return value;
}
