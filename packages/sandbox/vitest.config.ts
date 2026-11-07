import { defineConfig } from "vitest/config";

// The "source" condition lets workspace packages resolve to TypeScript sources in tests.
export default defineConfig({
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
});
