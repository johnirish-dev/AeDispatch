import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Coverage target (>= 70%) applies to the algorithm modules.
      include: ["src/algorithms/**/*.ts"],
    },
  },
});
