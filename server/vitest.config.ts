import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
