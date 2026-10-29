import { configDefaults, defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["**/*.integration.test.ts"], exclude: [...configDefaults.exclude, '.runtime/**'], testTimeout: 20000, hookTimeout: 30000, fileParallelism: false } });
