import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Identifies this build: shown in the sidebar and served as /version.json. */
function buildInfo() {
  const git = (args: string) => {
    try {
      return execSync("git " + args, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "";
    }
  };
  const commit = git("rev-parse --short HEAD") || "unknown";
  const dirty = commit !== "unknown" && git("status --porcelain") !== "";
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return { version: pkg.version as string, commit: commit + (dirty ? "-dirty" : ""), builtAt: new Date().toISOString() };
}
const build = buildInfo();
const versionFile: Plugin = {
  name: "version-file",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify(build) });
  },
};
export default defineConfig({
  root: "web",
  plugins: [react(), versionFile],
  define: { __BUILD__: JSON.stringify(build) },
  build: { outDir: "dist", assetsInlineLimit: 0 },
  server: {
    proxy: Object.fromEntries(
      ["/api", "/v1", "/health"].map((p) => [p, "http://127.0.0.1:8787"]),
    ),
  },
});
