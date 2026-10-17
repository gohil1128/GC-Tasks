import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/*
  Two kinds of test, one runner.

  tests/unit — pure functions (positions, dates, validation). No database.
  tests/integration — the task service against a real Postgres, because the
  parts most worth pinning (version conflicts, the revision counter, cascade
  deletes) are things a mock would happily pretend work. They need
  DATABASE_URL pointing at a database they are allowed to empty, and are
  skipped when TEST_DATABASE_URL is not set.

  Integration files share one database, so files run one at a time.
*/
export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts", "src/**/*.test.ts"],
    fileParallelism: false,
    reporters: ["default"],
  },
});
