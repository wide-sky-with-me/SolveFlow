/** Build an isolated native acceptance APK. Never change the production Android project or app ID. */
// Decision: .agents/notes/implemented/storage/2026-10-03-native-storage-acceptance.md
import { cp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mobile = resolve(root, 'apps/mobile');
const destination = resolve(root, '.runtime/android-storage-probe');
const android = resolve(destination, 'android');
const applicationId = 'com.solveflow.storageprobe';
const env = { ...process.env, EXPO_NO_DOTENV: '1', CI: '1', ANDROID_HOME: resolve(root, '.runtime/android-sdk'), ANDROID_USER_HOME: resolve(root, '.runtime/android-user'), GRADLE_USER_HOME: resolve(root, '.runtime/gradle'), GRADLE_OPTS: '-Dorg.gradle.project.kotlin.compiler.execution.strategy=in-process' };
await mkdir(destination, { recursive: true });
// Generated native inputs only; no real data, .env, credentials or production build outputs.
await cp(resolve(mobile, 'android'), android, { recursive: true, filter: path => !/(?:^|\/)(?:build|\.gradle|\.cxx)(?:\/|$)/.test(path) });
for (const name of ['node_modules', 'assets', 'metro.config.cjs', 'package.json', 'app.config.ts', 'plugins']) {
  await rm(resolve(destination, name), { force: true, recursive: true });
  await symlink(resolve(mobile, name), resolve(destination, name));
}
const buildFile = resolve(android, 'app/build.gradle');
let gradle = await readFile(buildFile, 'utf8');
if (!gradle.includes("applicationId 'com.solveflow.app'")) throw new Error('Unexpected production app ID');
gradle = gradle.replace("applicationId 'com.solveflow.app'", `applicationId '${applicationId}'`)
  .replace(/^    entryFile = .*$/m, `    root = file('${mobile}')\n    entryFile = file('${mobile}/storage-probe/index.tsx')`)
  .replace('        release {', '        release {\n            debuggable true');
// The probe has no DOM documents; keep the production DOM hook only in the production project.
gradle = gradle.split('// SolveFlow local DOM bootstrap')[0];
await writeFile(buildFile, gradle);
const manifestFile = resolve(android, 'app/src/main/AndroidManifest.xml');
let manifest = await readFile(manifestFile, 'utf8');
manifest = manifest.replace(/android:name="\.(MainActivity|MainApplication|SolveBackgroundService)"/g, 'android:name="com.solveflow.app.$1"')
  .replace('android:scheme="solveflow"', 'android:scheme="solveflow-storage-probe"')
  .replace(/<uses-permission android:name="android.permission.(INTERNET|CAMERA|POST_NOTIFICATIONS)"\/>/g, '<uses-permission android:name="android.permission.$1" tools:node="remove"/>');
await writeFile(manifestFile, manifest);
const stringsFile = resolve(android, 'app/src/main/res/values/strings.xml');
await writeFile(stringsFile, (await readFile(stringsFile, 'utf8')).replace('>SolveFlow<', '>SolveFlow Storage Probe<'));
await new Promise((accept, reject) => {
  const child = spawn(resolve(android, 'gradlew'), ['assembleRelease', '--no-daemon', '--console=plain', '--max-workers=4', '-PreactNativeArchitectures=arm64-v8a', '-Pexpo.useLegacyPackaging=true', '-Pandroid.enableMinifyInReleaseBuilds=false', '-Pandroid.enableShrinkResourcesInReleaseBuilds=false'], { cwd: android, env, stdio: 'inherit' });
  const timer = setTimeout(() => child.kill('SIGTERM'), 20 * 60_000);
  child.once('error', reject); child.once('exit', code => { clearTimeout(timer); code === 0 ? accept() : reject(new Error(`Probe build exited ${code}`)); });
});
const apk = resolve(android, 'app/build/outputs/apk/release/app-release.apk');
const badging = execFileSync(resolve(env.ANDROID_HOME, 'build-tools/36.0.0/aapt'), ['dump', 'badging', apk], { encoding: 'utf8' });
if (!badging.includes(`package: name='${applicationId}'`) || /uses-permission: name='android.permission.INTERNET'/.test(badging)) throw new Error('Probe isolation/permission check failed');
await cp(apk, resolve(destination, 'storage-probe.apk'));
console.log(JSON.stringify({ apk: resolve(destination, 'storage-probe.apk'), applicationId, networkPermission: false, productionProjectUnchanged: true }));
