import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('generates an iOS scene lifecycle for builds using the iOS 27 SDK', () => {
  const app = fileURLToPath(new URL('../../apps/mobile/', import.meta.url));
  const mobile = createRequire(join(app, 'package.json'));
  const fixture = mkdtempSync(join(tmpdir(), 'solveflow-ios-scene-'));
  try {
    for (const entry of ['app.config.ts', 'package.json', 'plugins', 'assets']) {
      cpSync(join(app, entry), join(fixture, entry), { recursive: true });
    }
    symlinkSync(join(app, 'node_modules'), join(fixture, 'node_modules'), 'dir');
    execFileSync(process.execPath, [mobile.resolve('expo/bin/cli'), 'prebuild', '--platform', 'ios', '--no-install'], {
      cwd: fixture, timeout: 60_000, stdio: 'pipe',
      env: { ...process.env, CI: '1', EXPO_NO_DOTENV: '1' },
    });
    const plist = readFileSync(join(fixture, 'ios/SolveFlow/Info.plist'), 'utf8');
    const delegate = readFileSync(join(fixture, 'ios/SolveFlow/AppDelegate.swift'), 'utf8');
    expect(plist).toContain('<key>UIApplicationSceneManifest</key>');
    expect(plist).toContain('<string>EXExpoAppSceneDelegate</string>');
    expect(delegate).toContain('ExpoReactNativeFactoryProvider');
    expect(delegate).not.toContain('factory.startReactNative(');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}, 65_000);
