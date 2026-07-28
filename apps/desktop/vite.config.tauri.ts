import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const desktopDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(desktopDir, "tauri"),
  base: "./",
  plugins: [
    react(),
    tsconfigPaths({ projects: [path.join(desktopDir, "tsconfig.paths.json")] }),
  ],
  build: {
    outDir: path.join(desktopDir, "out", "tauri"),
    emptyOutDir: true,
  },
  server: {
    port: 5184,
    strictPort: true,
  },
});
