import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/mobile-e2e", timeout: 45000, workers: 1, fullyParallel: false,
  use: { baseURL: process.env.SOLVEFLOW_TEST_WEB_URL ?? "http://127.0.0.1:3100", launchOptions: { executablePath: process.env.SOLVEFLOW_TEST_CHROME ?? "/usr/bin/google-chrome" }, screenshot: "only-on-failure", trace: "off" },
  projects: [{ name: "desktop", use: { viewport: { width: 1440, height: 1000 } } }, { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }],
});
