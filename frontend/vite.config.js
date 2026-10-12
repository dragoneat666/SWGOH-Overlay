import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In production the backend serves the built files (see the root
// Dockerfile), so the UI and the API share one origin - no CORS. In dev,
// Vite proxies the same paths to a locally running backend instead.
const backend = process.env.BACKEND_URL || "http://localhost:4001";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": backend,
      "/uploads": backend,
      "/health": backend,
    },
  },
});
