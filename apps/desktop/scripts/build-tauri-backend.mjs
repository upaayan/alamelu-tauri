import { build } from "esbuild";
import { chmod, cp, mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const outDir = path.join(desktopDir, "out", "tauri-backend");
const shimPath = path.join(desktopDir, "electron", "tauri-electron-shim.ts");

await rm(outDir, { recursive: true, force: true });
await mkdir(path.join(outDir, "node_modules"), { recursive: true });

await build({
  entryPoints: [path.join(desktopDir, "electron", "tauri-backend-transport.ts")],
  outfile: path.join(outDir, "main.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: false,
  external: ["node-pty"],
  plugins: [
    {
      name: "tauri-electron-shim",
      setup(esbuild) {
        esbuild.onResolve({ filter: /^electron$/ }, () => ({ path: shimPath }));
      },
    },
  ],
});

const nodePty = await realpath(path.join(desktopDir, "node_modules", "node-pty"));
await cp(nodePty, path.join(outDir, "node_modules", "node-pty"), {
  recursive: true,
  dereference: true,
});
if (process.platform !== "win32") {
  const helper = path.join(
    outDir,
    "node_modules",
    "node-pty",
    "prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper",
  );
  await chmod(helper, 0o755);
}
await mkdir(path.join(outDir, "extensions"), { recursive: true });
await cp(
  path.join(desktopDir, "resources", "alpi-luna-websocket-recovery.ts"),
  path.join(outDir, "extensions", "alpi-luna-websocket-recovery.ts"),
);

console.log(`Tauri backend built at ${outDir}`);
