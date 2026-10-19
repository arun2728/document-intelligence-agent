import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": r("."),
      // `server-only` throws outside a React Server bundle; route handlers are tested directly.
      "server-only": r("./tests/stubs/server-only.ts"),
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
