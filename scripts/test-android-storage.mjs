/** Real device acceptance against a private, offline probe APK; never clears production data. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const device = process.argv.find(value => value.startsWith('--device='))?.slice(9);
if (!device || !/^[A-Za-z0-9._:-]+$/.test(device)) throw new Error('Pass --device=<explicit adb serial>');
const appId = 'com.solveflow.storageprobe';
const artifact = resolve(root, '.runtime/android-storage-probe/storage-probe.apk');
const output = resolve(root, '.runtime', `storage-device-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(output, { recursive: true });
const adb = (...args) => execFileSync(resolve(root, '.runtime/android-sdk/platform-tools/adb'), ['-s', device, ...args], { encoding: 'utf8', timeout: args[0] === 'install' ? 180_000 : 40_000, stdio: ['ignore', 'pipe', 'pipe'] });
const badging = execFileSync(resolve(root, '.runtime/android-sdk/build-tools/36.0.0/aapt'), ['dump', 'badging', artifact], { encoding: 'utf8' });
assert(badging.includes(`package: name='${appId}'`));
assert(!badging.includes("uses-permission: name='android.permission.INTERNET'"));
const before = adb('shell', 'dumpsys', 'package', 'com.solveflow.app').split('\n').filter(line => /versionCode=|versionName=/.test(line));
const phases = process.argv.includes('--saf-only') ? ['saf-archive'] : ['batch-full', 'engine-full', 'kill-write', 'check-write', 'kill-run', 'check-run', 'kill-import', 'check-import', 'kill-unsaved', 'check-unsaved', 'archive-failures', 'large-archive'];
if (process.argv.includes('--with-saf') && !phases.includes('saf-archive')) phases.push('saf-archive');
const evidence = [];
let installed = false;
let completed = false;
try {
  assert.match(adb('install', '-r', artifact), /Success/); installed = true;
  adb('shell', 'am', 'force-stop', appId);
  console.log(JSON.stringify({ output, device, appId, productionVersion: before }));
  for (const action of phases) {
    const start = Date.now();
    // A slow cold start must never reuse a prior run's success marker.
    adb('shell', 'run-as', appId, 'rm', '-f', 'files/probe-status.json');
    const launch = adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `solveflow-storage-probe://run/${action}`, '-n', `${appId}/com.solveflow.app.MainActivity`);
    await writeFile(resolve(output, `${action}-launch.txt`), launch);
    assert.match(launch, /Status: ok/);
    let last = ''; let peakPssKb = 0; let polls = 0;
    while (Date.now() - start < 15 * 60_000) {
      await delay(1000); polls++;
      let value;
      try { value = JSON.parse(adb('exec-out', 'run-as', appId, 'cat', 'files/probe-status.json')); }
      catch (error) { if (polls > 60) throw error; continue; }
      if (value.action !== action) { assert(polls < 60, 'App did not dispatch the requested action'); continue; }
      const progress = JSON.stringify(value);
      if (progress !== last) { console.log(progress); last = progress; }
      if (polls % 5 === 0) {
        const mem = adb('shell', 'dumpsys', 'meminfo', appId);
        const pss = Number(/TOTAL PSS:\s*(\d+)/.exec(mem)?.[1] ?? /^\s*TOTAL\s+(\d+)/m.exec(mem)?.[1] ?? 0);
        peakPssKb = Math.max(peakPssKb, pss);
      }
      if (value.phase === 'failed') throw new Error(`${action}: ${value.error}`);
      if (value.phase === 'passed' || value.phase === 'kill-ready') {
        assert.equal(value.phase, action.startsWith('kill-') ? 'kill-ready' : 'passed');
        const result = { ...value, elapsedMs: Date.now() - start, sampledMaxPssKb: peakPssKb };
        evidence.push(result); await writeFile(resolve(output, 'results.json'), JSON.stringify(evidence, null, 2));
        if (value.phase === 'kill-ready') {
          adb('shell', 'am', 'force-stop', appId);
          assert(!adb('shell', 'ps', '-A', '-o', 'NAME').split(/\s+/).includes(appId), 'Test process survived force-stop');
        }
        break;
      }
    }
    assert(evidence.some(row => row.action === action), `${action} timed out`);
  }
  assert.deepEqual(adb('shell', 'dumpsys', 'package', 'com.solveflow.app').split('\n').filter(line => /versionCode=|versionName=/.test(line)), before);
  console.log(JSON.stringify({ passed: evidence.length, output }));
  completed = true;
} finally {
  if (installed) {
    adb('shell', 'am', 'force-stop', appId);
    if (completed) {
      // Only this fixed test package is removed, including its synthetic databases and cache.
      const cleanup = adb('uninstall', appId); await writeFile(resolve(output, 'cleanup.txt'), cleanup);
      assert.match(cleanup, /Success/);
    } else {
      console.error(`Stopped ${appId}; retained synthetic test data for diagnosis. Remove this test package after investigation.`);
    }
  }
}
