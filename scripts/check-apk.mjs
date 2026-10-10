import { readFile, writeFile, copyFile, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { latestVersionedApk, verifySigningContinuity } from './native-build-config.mjs';

/** Post-build verification: signature continuity, version metadata, private-value scan,
 * and the resources the on-device document actually needs. Writes a report and archives
 * a versioned copy next to the rolling artifact. */
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = resolve(root, '.runtime/artifacts');
const apk = resolve(root, process.argv[2] ?? '.runtime/artifacts/solveflow-arm64-local.apk');
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? resolve(root, '.runtime/android-sdk');

function tool(name) {
  const buildTools = resolve(sdk, 'build-tools');
  const versions = execFileSync('ls', [buildTools], { encoding: 'utf8' }).split('\n').filter(Boolean).sort();
  const path = resolve(buildTools, versions.at(-1), name);
  return path;
}
function certificate(path) {
  const output = execFileSync(tool('apksigner'), ['verify', '--print-certs', path], { encoding: 'utf8' });
  const digest = /Signer #1 certificate SHA-256 digest: (\w+)/.exec(output)?.[1];
  if (!digest) throw new Error('未找到签名证书指纹。');
  return digest;
}
function privateValues() {
  const values = [];
  let text = '';
  try { text = execFileSync('cat', [resolve(root, '.env')], { encoding: 'utf8' }); } catch { return values; }
  for (const line of text.split('\n')) {
    if (!line.includes('=') || line.trimStart().startsWith('#')) continue;
    const [key, raw] = line.split(/=(.*)/s);
    const value = (raw ?? '').trim().replace(/^["']|["']$/g, '');
    if (key === 'SOLVEFLOW_APP_S3_ACCESS_KEY') continue;
    if (/KEY$|SECRET$|PASSWORD$|DATABASE_URL$/.test(key) && value.length >= 12 && !value.startsWith('${')) values.push(Buffer.from(value));
  }
  return values;
}

const config = await readFile(resolve(root, 'apps/mobile/app.config.ts'), 'utf8');
const version = /version:\s*'([^']+)'/.exec(config)?.[1];
const versionCode = Number(/versionCode:\s*(\d+)/.exec(config)?.[1]);
if (!version || !versionCode) throw new Error('无法从 app.config.ts 读取版本号。');
await stat(apk);

const digest = certificate(apk);
const previous = latestVersionedApk(await readdir(artifacts));
const sameCertificateAsPrevious = verifySigningContinuity(digest, previous ? certificate(resolve(artifacts, previous)) : null);

const badging = execFileSync(tool('aapt'), ['dump', 'badging', apk], { encoding: 'utf8' });
if (!badging.includes(`versionCode='${versionCode}'`) || !badging.includes(`versionName='${version}'`)) throw new Error(`APK 版本与 app.config.ts 不一致（期望 ${version}/${versionCode}）。`);

const secrets = privateValues();
const names = execFileSync('unzip', ['-Z1', apk], { encoding: 'utf8' }).split('\n').filter(Boolean);
if (!names.includes('assets/index.android.bundle')) throw new Error('缺少 Hermes bundle。');
const documents = names.filter(name => name.startsWith('assets/www.bundle/') && name.endsWith('.html')).length;
if (!documents) throw new Error('缺少本地 DOM 文档资源。');
for (const library of ['lib/arm64-v8a/libexpo-sqlite.so', 'lib/arm64-v8a/libhermesvm.so']) if (!names.includes(library)) throw new Error(`缺少原生库 ${library}。`);
for (const name of names.filter(entry => entry.startsWith('assets/'))) {
  const data = execFileSync('unzip', ['-p', apk, name], { maxBuffer: 128 * 1024 * 1024 });
  for (const secret of secrets) if (data.includes(secret)) throw new Error(`assets 中发现私密配置：${name}`);
  // Official test players are external photo-test sources, never app assets.
  if (/pearson(?:vue)?\.com|StartTestLaunch\.htm|testtaker\/common/i.test(data.toString('latin1'))) throw new Error(`assets 中发现外部考试播放器：${name}`);
  if (/solveflow-storage-probe|probe-status\.json|SolveFlow isolated storage acceptance/.test(data.toString('latin1'))) throw new Error(`正式 APK 不得包含存储故障测试入口：${name}`);
}
if (names.some(name => /(?:^|\/)(?:runs-sim|runs-clean|uat-suite-[^/]+|exam-photo-[^/]+)(?:\/|$)/i.test(name))) throw new Error('APK 不得包含本地评测试卷或答卷目录。');

const bytes = (await stat(apk)).size;
const report = { schemaVersion: 1, artifact: '.runtime/artifacts/solveflow-arm64-local.apk', version, versionCode, bytes,
  sha256: createHash('sha256').update(await readFile(apk)).digest('hex'), mode: 'local-direct-model', architecture: 'arm64-v8a',
  signatureVerified: true, sameCertificateAsPrevious, serverEnvScanPassed: true, privateValuesChecked: secrets.length,
  hermesAndLocalAnswerResources: true, externalTestPlayerScanPassed: true, storageProbeScanPassed: true, documentResources: documents, builtAt: new Date().toISOString() };
await writeFile(resolve(artifacts, 'android-local-build-report.json'), `${JSON.stringify(report, null, 2)}\n`);
const archived = resolve(artifacts, `solveflow-arm64-local-${version}.apk`);
await copyFile(apk, archived);
await writeFile(`${archived}.sha256`, `${report.sha256}  ${archived.split('/').at(-1)}\n`);
console.log(JSON.stringify(report, null, 2));
