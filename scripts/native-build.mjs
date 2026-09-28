import { readFile, mkdir, copyFile, writeFile, stat, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { androidRequirements } from './native-build-config.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)); const app = resolve(root, 'apps/mobile');
const command = process.argv[2]; const compileOnly = process.argv.includes('--compile-only');
const require = createRequire(resolve(app, 'package.json'));
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? resolve(root, '.runtime/android-sdk');
const env = { ...process.env, ANDROID_HOME: sdk, ANDROID_USER_HOME: process.env.ANDROID_USER_HOME ?? resolve(root, '.runtime/android-user'), GRADLE_USER_HOME: process.env.GRADLE_USER_HOME ?? resolve(root, '.runtime/gradle'), EXPO_NO_DOTENV: '1', CI: '1' };
async function run(executable, args, cwd = root) {
  await new Promise((accept, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: 'inherit' }); let force; let interrupted = false;
    const stop = () => { interrupted = true; child.kill('SIGTERM'); force = setTimeout(() => child.kill('SIGKILL'), 5000); force.unref(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    const timeout = setTimeout(stop, 30 * 60 * 1000);
    const cleanup = () => { clearTimeout(timeout); clearTimeout(force); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('exit', code => { cleanup(); code === 0 && !interrupted ? accept() : reject(new Error(`构建子命令失败或已中断（退出码${code ?? 'signal'}），请检查上面的工具输出。`)); });
  });
}
/** Prebuild rewrites the native project from app.config.ts, plugins and assets: only rerun it when one of those is newer. */
async function prebuildNeeded() {
  const newest = async path => {
    const info = await stat(path);
    if (!info.isDirectory()) return info.mtimeMs;
    let value = info.mtimeMs;
    for (const entry of await readdir(path)) value = Math.max(value, await newest(resolve(path, entry)));
    return value;
  };
  try {
    const target = (await stat(resolve(app, 'android/app/build.gradle'))).mtimeMs;
    for (const path of ['app.config.ts', 'plugins', 'assets']) if (await newest(resolve(app, path)) > target) return true;
    return false;
  } catch { return true; }
}
/** The Expo template pins a small heap; raise it for the release build without touching sources. */
async function tuneGradleMemory() {
  const properties = resolve(app, 'android/gradle.properties');
  const text = await readFile(properties, 'utf8');
  const tuned = text.replace(/^org\.gradle\.jvmargs=.*$/m, 'org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m');
  if (tuned !== text) await writeFile(properties, tuned);
}
try {
  if (!['check', 'prepare', 'apk'].includes(command)) throw new Error('用法：native-build.mjs check|prepare|apk [--compile-only]');
  delete env.EXPO_PUBLIC_API_URL; // Model services are configured on the device.
  const catalog = await readFile(resolve(require.resolve('react-native/package.json'), '../gradle/libs.versions.toml'), 'utf8');
  const android = androidRequirements(sdk, catalog);
  let java = false;
  try { execFileSync(process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin/java') : 'java', ['-version'], { stdio: 'pipe', timeout: 5000 }); java = true; } catch { /* Report as a missing tool below. */ }
  let xcode = false;
  if (process.platform === 'darwin') { try { execFileSync('xcodebuild', ['-version'], { stdio: 'pipe', timeout: 5000 }); xcode = true; } catch { /* Xcode has not been configured. */ } }
  if (command === 'check') {
    console.log(JSON.stringify({ mode: 'local-direct-model', configuration: 'on-device settings', android: { java, sdk, packages: android.packages, missing: android.missing, ready: java && !android.missing.length }, ios: { xcode, ready: xcode, cloudAlternative: 'EAS Build 的 macOS 构建环境；真机分发需要Apple签名配置。' } }, null, 2));
    if (!(java && !android.missing.length || xcode)) process.exitCode = 1;
  } else {
    if (command === 'apk' && (!java || android.missing.length)) throw new Error(`Android编译工具尚未就绪，请先运行 pnpm mobile:doctor。缺少：${!java ? 'Java ' : ''}${android.missing.join(', ')}`);
    if (compileOnly) console.log('--compile-only 为旧版兼容参数；当前生成可在设置页配置模型的本地应用。');
    await run(process.execPath, ['scripts/prepare-mobile-agent.mjs']);
    await run('pnpm', ['--filter', '@solveflow/contracts', 'build']); await run('pnpm', ['--filter', '@solveflow/client', 'build']);
    await run('pnpm', ['--filter', '@solveflow/agent', 'build']);
    await run(process.execPath, ['scripts/prepare-mobile-assets.mjs']);
    if (command === 'apk') {
      if (await prebuildNeeded()) await run('pnpm', ['--filter', '@solveflow/mobile', 'exec', 'expo', 'prebuild', '--platform', 'android', '--no-install']);
      else console.log('原生工程未变化，跳过 prebuild（app.config.ts / plugins / assets 均早于 android/app/build.gradle）。');
      await tuneGradleMemory();
      // Gradle can keep the Metro bundle task up to date while the generated agent bundle changed;
      // Drop the entire task-owned assets directory: removing only the Hermes file
      // leaves obsolete hashed DOM entry scripts in the next APK.
      const bundleDirectory = resolve(app, 'android/app/build/generated/assets/react/release');
      const bundleArtifact = resolve(bundleDirectory, 'index.android.bundle');
      const generated = Math.max((await stat(resolve(app, '.generated/agent.mjs'))).mtimeMs, (await stat(resolve(app, '.generated/katex.css'))).mtimeMs);
      let bundledAt = 0;
      try { bundledAt = (await stat(bundleArtifact)).mtimeMs; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (generated > bundledAt) {
        await rm(bundleDirectory, { recursive: true, force: true });
        console.log('已清理旧 bundle 和 DOM 资源以强制重新打包，避免重试构建遗留过期脚本。');
      }
      // The Gradle daemon and parallel workers are reused across local builds; set
      // SOLVEFLOW_GRADLE_NO_DAEMON=1 for a one-shot CI-style run.
      // Direct APK distribution benefits from compressed .so files. Keep Expo's
      // default mmap-friendly packaging for store AABs and Hermes startup.
      const gradle = ['assembleRelease', '--console=plain', `--max-workers=${Math.max(2, Math.min(8, cpus().length - 2))}`, '-PreactNativeArchitectures=arm64-v8a', '-Pexpo.useLegacyPackaging=true'];
      if (process.env.SOLVEFLOW_GRADLE_NO_DAEMON === '1') gradle.push('--no-daemon');
      await run(resolve(app, 'android/gradlew'), gradle, resolve(app, 'android'));
      const source = resolve(app, 'android/app/build/outputs/apk/release/app-release.apk'); await stat(source);
      const directory = resolve(root, '.runtime/artifacts'); await mkdir(directory, { recursive: true });
      const name = 'solveflow-arm64-local.apk'; const target = resolve(directory, name); await copyFile(source, target);
      const checksum = createHash('sha256').update(await readFile(target)).digest('hex');
      await writeFile(`${target}.sha256`, `${checksum}  ${name}\n`);
      await run(process.execPath, ['scripts/check-apk.mjs', target]);
      // R8 stack traces need the mapping from the exact build, kept outside Git.
      const report = JSON.parse(await readFile(resolve(directory, 'android-local-build-report.json'), 'utf8'));
      await copyFile(resolve(app, 'android/app/build/outputs/mapping/release/mapping.txt'), resolve(directory, `solveflow-arm64-local-${report.version}-${checksum.slice(0, 12)}-mapping.txt`));
      console.log(`APK已生成：${target}\nARM64内部测试签名，不是商店发布签名；首次打开请在设置中填写模型服务，含JS、Skill和公式资源，不依赖Metro或SolveFlow后端。`);
    }
  }
} catch (error) { console.error(error instanceof Error ? error.message : '原生构建准备失败。'); process.exitCode = 1; }
