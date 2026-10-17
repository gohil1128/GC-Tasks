import { defineConfig, devices } from "@playwright/test";

/*
  End-to-end against a running build. Start it first:

    pnpm build && pnpm start -p 3211

  E2E_EMAIL / E2E_PASSWORD must be an account in that database (CI creates
  one with `pnpm create-user`). PLAYWRIGHT_CHROMIUM lets a machine with a
  preinstalled Chromium use it instead of downloading one.
*/
const baseURL = process.env.BASE_URL ?? "http://localhost:3211";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM }
          : undefined,
      },
    },
  ],
});
