import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ["source"] },
  server: { proxy: { "/api": "http://localhost:8080" } },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "jsdom",
  },
});
