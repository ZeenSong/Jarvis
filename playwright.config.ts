import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/web",
  workers: 1,
  timeout: 45000,
  use: {
    headless: true,
    launchOptions: {
      executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
      args: ["--no-sandbox"],
    },
    screenshot: "only-on-failure",
  },
  reporter: "list",
});
