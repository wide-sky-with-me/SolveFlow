/** Suites using actual SDK sessions, loopback services or isolated processes.
 * The unit project excludes these exact patterns; the default run includes both. */
export const offlineTestPatterns = [
  'apps/mobile/src/batch-photo-input.offline.test.ts',
  'apps/mobile/src/components/camera-preview.web.offline.test.ts',
  'packages/image-input/src/browser.offline.test.ts',
  'apps/photo-web/src/server/service.test.ts',
  'packages/agent/src/pi/**/*.test.ts',
  'packages/agent/src/mcp/**/*.test.ts',
  'packages/agent/src/application.test.ts',
  'packages/agent/src/policy/isolated-worker.test.ts',
  'packages/agent/src/policy/worker-image.test.ts',
  'packages/agent/src/policy/worker-spend.test.ts',
  'packages/agent/src/policy/probe.test.ts',
  'tests/unit/boundary-check.test.ts',
  'tests/unit/dependency-compat.test.ts',
  'tests/unit/ios-scene.test.ts',
  'tests/unit/mobile-web-server.test.ts',
  'tests/unit/managed-exam-runner.test.ts',
  'tests/unit/web-model-proxy.test.ts',
  'tests/unit/web-model-settings.test.ts',
  'tests/unit/verifier-regression.test.ts',
];

/** Benchmark files also contain correctness guards; the all-browser entry keeps them. */
export const performanceTestPatterns = ['**/*performance.spec.ts'];
