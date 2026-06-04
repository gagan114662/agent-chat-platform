import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Proxy every backend API path to @acp/app (dev). Keep in sync with the routes.
    proxy: {
      "/threads": { target: "http://localhost:8080", changeOrigin: true },
      "/channels": { target: "http://localhost:8080", changeOrigin: true },
      "/repos": { target: "http://localhost:8080", changeOrigin: true },
      "/search": { target: "http://localhost:8080", changeOrigin: true },
      "/unreads": { target: "http://localhost:8080", changeOrigin: true },
      "/inbox": { target: "http://localhost:8080", changeOrigin: true },
      "/principals": { target: "http://localhost:8080", changeOrigin: true },
      "/dms": { target: "http://localhost:8080", changeOrigin: true },
      "/memory": { target: "http://localhost:8080", changeOrigin: true },
      "/auth": { target: "http://localhost:8080", changeOrigin: true },
      "/runs": { target: "http://localhost:8080", changeOrigin: true },
      "/tasks": { target: "http://localhost:8080", changeOrigin: true },
      "/goals": { target: "http://localhost:8080", changeOrigin: true },
      "/orgs": { target: "http://localhost:8080", changeOrigin: true },
      "/agents": { target: "http://localhost:8080", changeOrigin: true },
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
  },
});
