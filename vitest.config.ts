import { defineConfig } from "vitest/config";
import { offlineTestPatterns } from './tests/test-suites.js';

const exclude = ['**/node_modules/**', '**/dist/**', '.runtime/**', '**/*.integration.test.ts', 'tests/mobile-e2e/**'];
export default defineConfig({ test: {
  exclude,
  projects: [
    { extends: true, test: { name: 'unit', exclude: [...exclude, ...offlineTestPatterns] } },
    { extends: true, test: { name: 'offline', include: offlineTestPatterns, exclude } },
  ],
} });
