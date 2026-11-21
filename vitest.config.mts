import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url)).replaceAll("\\", "/");

export default defineConfig({
  resolve: {
    alias: {
      "@/": here("./src/"),
      "@docs/": here("./docs/"),
      "@fixtures/": here("./fixtures/"),
      // `server-only` throws outside a React Server build; tests run in plain Node.
      "server-only": here("./tests/stubs/server-only.ts"),
    },
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
