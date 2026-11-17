import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "dist", assetsInlineLimit: 0 },
  server: {
    proxy: Object.fromEntries(
      ["/api", "/v1", "/health"].map((p) => [p, "http://127.0.0.1:8787"]),
    ),
  },
});
