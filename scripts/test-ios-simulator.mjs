import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deepStrictEqual } from 'node:assert';

// Use Xcode's XCTest and CocoaPods' existing xcodeproj; no additional UI framework.
const root = fileURLToPath(new URL('../', import.meta.url));
const appArgument = process.argv.slice(2).find(argument => argument.startsWith('--app='));
if (process.platform !== 'darwin' || !appArgument || process.argv.slice(2).some(argument => !argument.startsWith('--app='))) {
  throw new Error('Run on macOS: pnpm test:ios:smoke --app=/absolute/path/SolveFlow.app');
}
const app = resolve(appArgument.slice('--app='.length));
if (!existsSync(join(app, 'Info.plist'))) throw new Error('Expected a compiled simulator .app');
const runtimeRoot = join(root, '.runtime');
mkdirSync(runtimeRoot, { recursive: true });
const evidence = mkdtempSync(join(runtimeRoot, 'ios-smoke-'));
const state = { startedAt: new Date().toISOString(), steps: [], success: false };
let uuid;
const validUuid = /^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/;
function save() { writeFileSync(join(evidence, 'result.json'), JSON.stringify(state, null, 2) + '\n'); }
function run(name, command, args, timeout = 30_000, env = process.env) {
  const step = { name, command, args, startedAt: new Date().toISOString() };
  state.steps.push(step); save();
  const result = spawnSync(command, args, { cwd: root, timeout, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env });
  writeFileSync(join(evidence, `${name}.log`), (result.stdout ?? '') + (result.stderr ?? ''));
  step.exitCode = result.status; step.signal = result.signal; step.completedAt = new Date().toISOString();
  if (result.error) step.error = result.error.message;
  save();
  if (result.status !== 0) throw new Error(`${name} failed; see ${evidence}`);
  return result.stdout.trim();
}
function sim(name, args, timeout) { return run(name, '/usr/bin/xcrun', ['simctl', ...args], timeout); }
try {
  const bundle = run('bundle-id', '/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', join(app, 'Info.plist')]);
  if (bundle !== 'com.solveflow.app') throw new Error('Unexpected application bundle identifier');
  const platform = run('platform', '/usr/bin/plutil', ['-extract', 'CFBundleSupportedPlatforms.0', 'raw', join(app, 'Info.plist')]);
  if (platform !== 'iPhoneSimulator') throw new Error('Expected a simulator build');
  const runtimes = JSON.parse(sim('runtimes', ['list', 'runtimes', '--json'])).runtimes;
  const runtime = runtimes.filter(item => item.isAvailable && item.platform === 'iOS')
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  if (!runtime) throw new Error('No available iOS simulator runtime');
  state.runtime = runtime.identifier;
  uuid = sim('create', ['create', `SolveFlow Smoke ${Date.now()}`, 'com.apple.CoreSimulator.SimDeviceType.iPhone-17', runtime.identifier]);
  if (!validUuid.test(uuid)) throw new Error('Invalid simulator identifier');
  state.device = uuid; save();
  sim('boot', ['boot', uuid], 120_000);
  sim('boot-status', ['bootstatus', uuid, '-b'], 300_000);
  sim('install', ['install', uuid, app], 120_000);
  sim('photo', ['addmedia', uuid, join(root, 'tests/ios/fixture.png')], 60_000);
  const pods = run('pods-prefix', 'brew', ['--prefix', 'cocoapods']);
  const ruby = run('ruby-prefix', 'brew', ['--prefix', 'ruby']);
  run('ui-project', join(ruby, 'bin/ruby'), [join(root, 'scripts/create-ios-ui-project.rb'), root, evidence], 30_000,
    { ...process.env, GEM_HOME: join(pods, 'libexec') });
  const fd = openSync(join(evidence, 'xctest.log'), 'w');
  const step = { name: 'xctest', startedAt: new Date().toISOString() };
  state.steps.push(step); save();
  let test;
  try {
    test = spawnSync('/usr/bin/xcodebuild', ['test', '-project', join(evidence, 'SolveFlowSmoke.xcodeproj'),
      '-scheme', 'SolveFlowSmoke', '-configuration', 'Release', '-destination', `platform=iOS Simulator,id=${uuid}`,
      '-parallel-testing-enabled', 'NO', '-resultBundlePath', join(evidence, 'ui.xcresult'),
      '-collect-test-diagnostics', 'never',
      '-derivedDataPath', join(evidence, 'derived'), '-test-timeouts-enabled', 'YES',
      '-default-test-execution-time-allowance', '600', '-maximum-test-execution-time-allowance', '900'],
      { cwd: root, timeout: 1_200_000, stdio: ['ignore', fd, fd] });
  } finally { closeSync(fd); }
  step.exitCode = test.status; step.signal = test.signal; step.completedAt = new Date().toISOString();
  if (test.error) step.error = test.error.message;
  save();
  if (test.status !== 0) throw new Error(`XCTest failed; see ${evidence}`);
  const container = sim('data-container', ['get_app_container', uuid, bundle, 'data']);
  const database = join(container, 'Documents/SQLite/solveflow-local.db');
  const counts = JSON.parse(run('sqlite-counts', '/usr/bin/sqlite3', ['-readonly', '-json', database,
    "SELECT sum(key GLOB 'record.*') AS records, sum(key GLOB 'image.*') AS images, sum(key GLOB 'summary.*') AS summaries, sum(key = 'settings') AS settings, (SELECT coalesce(sum(json_array_length(value, '$.session.runs')), 0) FROM documents WHERE key GLOB 'record.*') AS runs FROM documents;"]));
  deepStrictEqual(counts, [{ records: 1, images: 1, summaries: 1, settings: 1, runs: 0 }]);
  state.sqlite = counts[0];
  state.success = true;
} catch (error) {
  state.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (uuid && validUuid.test(uuid)) {
    try {
      const devices = JSON.parse(sim('cleanup-state', ['list', 'devices', '--json'])).devices;
      const device = Object.values(devices).flat().find(item => item.udid === uuid);
      if (device && device.state !== 'Shutdown') sim('shutdown', ['shutdown', uuid], 60_000);
      sim('delete', ['delete', uuid], 60_000);
      state.cleanupVerified = true;
    } catch (error) {
      state.cleanupError = error instanceof Error ? error.message : String(error);
      state.success = false;
      process.exitCode = 1;
    }
  }
  state.completedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ ...state, evidence }, null, 2));
}
