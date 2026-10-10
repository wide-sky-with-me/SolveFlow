import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const exec = promisify(execFile);
const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const device = option('device', '');
if (!device || !/^[\w.:-]+$/.test(device)) throw new Error('Specify --device=<adb serial> and open a saved batch before running.');
const steps = Number(option('steps', '12')); const interval = Number(option('interval-ms', '300'));
assert(Number.isInteger(steps) && steps > 0 && steps <= 40 && interval >= 100 && interval <= 1000, 'Bounded steps and interval required');
const recordSeconds = Number(option('record-seconds', '60'));
assert(Number.isInteger(recordSeconds) && recordSeconds >= 15 && recordSeconds <= 180, 'Recording must be 15–180 seconds');
const direction = option('direction', 'next'); assert(['next', 'previous'].includes(direction));
const adb = option('adb', resolve('.runtime/android-sdk/platform-tools/adb'));
const call = async (...args) => (await exec(adb, ['-s', device, ...args], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })).stdout;
const app = 'com.solveflow.app'; const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = resolve('.runtime', `pager-performance-${stamp}`); await mkdir(output, { recursive: true });
const xmlPath = `/sdcard/solveflow-pager-${stamp}.xml`; const videoPath = `/sdcard/solveflow-pager-${stamp}.mp4`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const dump = async () => { await call('shell', 'uiautomator', 'dump', xmlPath); return call('shell', 'cat', xmlPath); };
const position = xml => {
  const matches = [...xml.matchAll(/content-desc="当前第(\d+)题，共(\d+)题，展开题号速选"/g)];
  assert.equal(matches.length, 1, 'Open a saved single-question-per-photo batch with its navigation visible');
  return { index: Number(matches[0][1]), total: Number(matches[0][2]) };
};
let recording; let recorded;
try {
  const activities = await call('shell', 'dumpsys', 'activity', 'activities');
  assert(/(?:mResumedActivity|topResumedActivity)[^\n]*com\.solveflow\.app\//.test(activities), 'SolveFlow must be foreground');
  const xml = await dump(); const before = position(xml); const expected = before.index + steps * (direction === 'next' ? 1 : -1);
  assert(expected >= 1 && expected <= before.total, 'Not enough remaining questions; change --steps or --direction');
  const label = direction === 'next' ? '下一道题' : '上一道题';
  const nodes = [...xml.matchAll(/<node\b[^>]*>/g)].map(match => match[0]).filter(node => node.includes(`content-desc="${label}"`) && node.includes('enabled="true"'));
  assert.equal(nodes.length, 1, 'A unique enabled navigation button is required');
  const bounds = nodes[0].match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/); assert(bounds, 'Button bounds missing');
  const x = String(Math.round((Number(bounds[1]) + Number(bounds[3])) / 2)); const y = String(Math.round((Number(bounds[2]) + Number(bounds[4])) / 2));
  const packageInfo = await call('shell', 'dumpsys', 'package', app);
  const version = { name: packageInfo.match(/versionName=(\S+)/)?.[1], code: packageInfo.match(/versionCode=(\d+)/)?.[1] };
  if (process.argv.includes('--record')) {
    recording = spawn(adb, ['-s', device, 'shell', 'screenrecord', '--size', '630x1400', '--time-limit', String(recordSeconds), videoPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    recorded = new Promise((resolve, reject) => { recording.once('error', reject); recording.once('exit', code => code === 0 ? resolve() : reject(new Error(`screenrecord exited ${code}`))); });
    // Register immediately so early failures never create an unhandled rejection.
    recorded.catch(() => {}); await sleep(1000);
  }
  await call('shell', 'dumpsys', 'gfxinfo', app, 'reset');
  const durations = [];
  for (let i = 0; i < steps; i++) { const start = performance.now(); await call('shell', 'input', 'tap', x, y); durations.push(Math.round(performance.now() - start)); await sleep(interval); }
  await sleep(2500); const after = position(await dump());
  const gfx = await call('shell', 'dumpsys', 'gfxinfo', app); const memory = await call('shell', 'dumpsys', 'meminfo', app);
  const report = { version, before, after, expected, steps, intervalMs: interval, adbTapMs: durations, reachedDestination: after.index === expected && after.total === before.total,
    totalFrames: Number(gfx.match(/Total frames rendered:\s*(\d+)/)?.[1] ?? 0), jankPercent: Number(gfx.match(/Janky frames:\s*\d+\s*\(([\d.]+)%\)/)?.[1] ?? 0), p95Ms: Number(gfx.match(/95th percentile:\s*(\d+)ms/)?.[1] ?? 0),
    totalPssKiB: Number(memory.match(/TOTAL PSS:\s*(\d+)/)?.[1] ?? 0), webViews: Number(memory.match(/WebViews:\s*(\d+)/)?.[1] ?? 0), note: 'ADB timing is not presentation latency. FPS includes the recorded interaction and UI dump. Video needs content review.' };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
  await writeFile(`${output}/gfx.txt`, gfx, { mode: 0o600 }); await writeFile(`${output}/memory.txt`, memory, { mode: 0o600 });
  console.log(JSON.stringify({ output, ...report }));
  assert(report.reachedDestination, 'Navigation did not settle at the requested question'); assert(report.totalFrames > 0 && report.totalPssKiB > 0, 'Missing device metrics');
  if (process.argv.includes('--record')) {
    await recorded;
    const destination = /\.exe$/i.test(adb) ? (await exec('wslpath', ['-w', `${output}/screen.mp4`])).stdout.trim() : `${output}/screen.mp4`;
    await call('pull', videoPath, destination);
  }
} finally {
  if (recorded) await recorded.catch(() => {});
  await call('shell', 'rm', '-f', xmlPath, videoPath);
}
