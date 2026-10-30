import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, closeSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deepStrictEqual } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { LocalRepository } from '../packages/client/dist/local.js';
import { nativePdfFixture } from '../tests/native-pdf-fixture.ts';

// Use Xcode's XCTest and CocoaPods' existing xcodeproj; no additional UI framework.
const root = fileURLToPath(new URL('../', import.meta.url));
const appArgument = process.argv.slice(2).find(argument => argument.startsWith('--app='));
const pdfMode = process.argv.includes('--pdf');
if (process.platform !== 'darwin' || !appArgument || process.argv.slice(2).some(argument => !argument.startsWith('--app=') && argument !== '--pdf')) {
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
  run('signature', '/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
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
  if (pdfMode) {
    run('synthetic-jpeg', '/usr/bin/sips', ['-s', 'format', 'jpeg', '-z', '300', '600', join(root, 'tests/ios/fixture.png'), '--out', join(evidence, 'source.jpg')]);
    run('synthetic-supplement', '/usr/bin/sips', ['-s', 'format', 'jpeg', '-z', '300', '600', join(root, 'apps/mobile/assets/app-icon.png'), '--out', join(evidence, 'supplement.jpg')]);
    const source = nativePdfFixture(`data:image/jpeg;base64,${readFileSync(join(evidence, 'source.jpg')).toString('base64')}`, `data:image/jpeg;base64,${readFileSync(join(evidence, 'supplement.jpg')).toString('base64')}`);
    const values = new Map();
    const repository = new LocalRepository({ get: async key => values.get(key) ?? null, keys: async () => [...values.keys()], put: async (key, value) => { values.set(key, value); }, remove: async key => { values.delete(key); }, batch: async changes => { for (const { key, value } of changes) if (value === null) values.delete(key); else values.set(key, value); } });
    for (const record of source.records) await repository.save(record);
    const container = sim('seed-container', ['get_app_container', uuid, bundle, 'data']);
    const folder = join(container, 'Documents/SQLite'); mkdirSync(folder, { recursive: true });
    const db = new DatabaseSync(join(folder, 'solveflow-local.db'));
    try { db.exec('CREATE TABLE documents(key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL); PRAGMA user_version=1;'); const insert = db.prepare('INSERT INTO documents VALUES(?,?)'); for (const [key, value] of values) insert.run(key, value); } finally { db.close(); }
    state.syntheticSeed = { records: source.records.length, runs: source.records.length, modelRequests: 0 };
  }
  sim('photo', ['addmedia', uuid, join(root, 'apps/mobile/assets/app-icon.png'), join(root, 'tests/ios/fixture.png')], 60_000);
  const pods = run('pods-prefix', 'brew', ['--prefix', 'cocoapods']);
  const ruby = run('ruby-prefix', 'brew', ['--prefix', 'ruby']);
  run('ui-project', join(ruby, 'bin/ruby'), [join(root, 'scripts/create-ios-ui-project.rb'), root, evidence, ...(pdfMode ? ['pdf'] : [])], 30_000,
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
  deepStrictEqual(counts, pdfMode ? [{ records: 6, images: 6, summaries: 6, settings: 0, runs: 6 }] : [{ records: 1, images: 1, summaries: 1, settings: 1, runs: 0 }]);
  state.sqlite = counts[0];
  const materials = JSON.parse(run('sqlite-materials', '/usr/bin/sqlite3', ['-readonly', '-json', database,
    "SELECT sum(json_array_length(value, '$.materials')) AS storedMaterials, sum(json_array_length(value, '$.activeImageIds')) AS activeImages, (SELECT count(*) FROM documents WHERE key GLOB 'material.*') AS materialDocuments FROM documents WHERE key GLOB 'record.*';"]));
  // One original supplement, its immutable edited version, then two committed imports.
  deepStrictEqual(materials, pdfMode ? [{ storedMaterials: 1, activeImages: 2, materialDocuments: 1 }] : [{ storedMaterials: 4, activeImages: 4, materialDocuments: 4 }]);
  state.materials = materials[0];
  if (pdfMode) {
    const db = new DatabaseSync(join(container, 'Documents/SQLite/solveflow-exports.db'), { readOnly: true });
    try {
      const tasks = db.prepare('SELECT value FROM tasks').all().map(row => JSON.parse(row.value));
      deepStrictEqual(tasks.map(task => [task.status, task.mode, task.copies]).sort(), [['succeeded', 'answers', 2], ['succeeded', 'questions', 1]].sort());
      const files = db.prepare('SELECT id,name,mime,data FROM files').all();
      deepStrictEqual(files.length, 2);
      for (const file of files) { const task = tasks.find(task => task.id === file.id); deepStrictEqual(task.file.bytes, file.data.byteLength); writeFileSync(join(evidence, file.name), file.data); }
      state.exports = tasks;
    } finally { db.close(); }
  }
  state.success = true;
} catch (error) {
  state.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  // Preserve actual generated files even when a later UI assertion fails.
  if (pdfMode && uuid && state.syntheticSeed) {
    try {
      const container = sim('pdf-evidence-container', ['get_app_container', uuid, 'com.solveflow.app', 'data']);
      const cache = join(container, 'Library/Caches');
      if (existsSync(cache)) {
        state.shareCache = readdirSync(cache, { recursive: true }).filter(name => name.includes('pdf-share-v1/')).flatMap(name => {
          const path = join(cache, name); const stat = statSync(path);
          if (!stat.isFile()) return [];
          const saved = `share-${name.split('/').at(-1)}`;
          writeFileSync(join(evidence, saved), readFileSync(path));
          return [{ name: saved, bytes: stat.size }];
        });
      }
      const path = join(container, 'Documents/SQLite/solveflow-exports.db');
      if (existsSync(path)) {
        const db = new DatabaseSync(path, { readOnly: true });
        try {
          const records = db.prepare('SELECT value FROM tasks').all().map(row => JSON.parse(row.value));
          const files = db.prepare('SELECT id,mime,data FROM files').all();
          const captured = [];
          for (const file of files) {
            if (!/^[0-9a-f-]{36}$/.test(file.id) || !['application/pdf', 'application/zip'].includes(file.mime)) throw new Error('Invalid evidence metadata');
            const name = `generated-${file.id}.${file.mime === 'application/pdf' ? 'pdf' : 'zip'}`;
            writeFileSync(join(evidence, name), file.data); captured.push({ name, bytes: file.data.byteLength });
          }
          state.generatedEvidence = { tasks: records, files: captured };
        } finally { db.close(); }
      }
    } catch { state.artifactCaptureError = 'Unable to capture generated artifacts'; }
  }
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
