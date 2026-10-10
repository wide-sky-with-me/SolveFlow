import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';
import { performanceTestPatterns } from './tests/test-suites.js';

export default defineConfig({ ...base, testMatch: performanceTestPatterns });
