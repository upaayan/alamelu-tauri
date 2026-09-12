import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = fileURLToPath(new URL("../../electron/external-pi-runtime-supervisor.ts", import.meta.url));
const transpiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText;
const module = { exports: {} };
// Auth/UI/parser imports are unused by the metadata subprocess exercised here.
new Function("require", "module", "exports", transpiled)(
  (name) => name.startsWith(".") ? {} : require(name), module, module.exports,
);
const { ExternalPiRuntimeSupervisor } = module.exports;

test("metadata probes keep CodeGraph writes outside Electron and Tauri bundles", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "app-metadata-cwd-"));
  const originalCwd = process.cwd();
  try {
    const piBin = path.join(root, "cli.js");
    writeFileSync(piBin, `#!/usr/bin/env node
const fs = require("node:fs");
fs.mkdirSync(".codegraph", { recursive: true });
fs.writeFileSync(".codegraph/graph.db", "fixture cache");
console.log(JSON.stringify({ cwd: process.cwd(), agentDir: process.env.PI_CODING_AGENT_DIR, args: process.argv.slice(2) }));
`, { mode: 0o755 });
    const agentDir = path.join(root, "agent");
    for (const location of ["Contents/MacOS", "Contents/Resources/backend"]) {
      const bundleCwd = path.join(root, "Example.app", location);
      mkdirSync(bundleCwd, { recursive: true });
      process.chdir(bundleCwd);
      const userDataDir = path.join(root, "user-data");
      const supervisor = new ExternalPiRuntimeSupervisor({ piBin, agentDir, userDataDir });
      // TypeScript-private method: real subprocess, no provider requests or credentials.
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = JSON.parse(await supervisor.runPi(["--list-models"]));
        assert.equal(existsSync(path.join(bundleCwd, ".codegraph")), false, "probe wrote inside the app bundle");
        assert.equal(result.cwd, realpathSync(path.join(userDataDir, "runtime-metadata")));
        assert.equal(result.agentDir, agentDir);
        assert.deepEqual(result.args, ["--list-models"]);
        assert.equal(existsSync(path.join(result.cwd, ".codegraph", "graph.db")), true);
        assert.equal(process.cwd(), realpathSync(bundleCwd), "parent cwd must not change");
      }
    }
  } finally {
    process.chdir(originalCwd);
    rmSync(root, { recursive: true, force: true });
  }
});
