import { expect, it } from 'vitest';
import { releaseApiOrigin, androidRequirements } from '../../scripts/native-build-config.mjs';
it('requires an explicit release API without local addresses, credentials or URL parameters', () => {
  expect(releaseApiOrigin('https://api.solveflow.org/')).toBe('https://api.solveflow.org');
  for (const value of [undefined, 'http://api.solveflow.org', 'https://localhost', 'https://127.0.0.1:3100', 'https://[::1]', 'https://your-solveflow.example', 'https://api.invalid', 'https://user:secret@api.solveflow.org', 'https://api.solveflow.org?token=secret', 'https://api.solveflow.org/api/v1', 'https://api.solveflow.org#secret']) expect(() => releaseApiOrigin(value)).toThrow();
});
it('reads Android requirements from the installed version catalog and reports missing files', () => {
  const catalog = 'compileSdk = "36"\nbuildTools = "36.0.0"\nndkVersion = "27.1.12297006"';
  expect(androidRequirements('/nonexistent-solveflow-sdk', catalog)).toMatchObject({ packages: ['platforms;android-36', 'build-tools;36.0.0', 'ndk;27.1.12297006', 'cmake;3.22.1', 'platform-tools'], missing: expect.arrayContaining(['platforms/android-36/android.jar']) });
  expect(() => androidRequirements('/nonexistent-solveflow-sdk', '')).toThrow();
});
