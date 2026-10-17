import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The API validates the browser Origin against its own public origin. During
// local development/preview the Vite origin differs, so forward the API origin
// that the server expects instead of the dev-server origin.
const apiOrigin = process.env.JARVIS_DEV_API_ORIGIN ?? "http://127.0.0.1:8080";
const apiTarget = process.env.JARVIS_DEV_API ?? "http://127.0.0.1:8080";
const proxy = {
  "/api": { target: apiTarget, changeOrigin: true, headers: { origin: apiOrigin } },
  "/ws": { target: apiTarget.replace(/^http/, "ws"), ws: true, changeOrigin: true, headers: { origin: apiOrigin } },
};

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { port: 4173, proxy },
  build: { chunkSizeWarningLimit: 1200 },
});
