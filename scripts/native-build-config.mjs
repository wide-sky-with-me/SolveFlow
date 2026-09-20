import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
export function releaseApiOrigin(value) {
  if (!value) throw new Error('请在 apps/mobile/.env 配置 EXPO_PUBLIC_API_URL，或在构建环境中设置该变量。');
  let url;
  try { url = new URL(value); } catch { throw new Error('App API 地址必须是有效的 HTTPS 源站地址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)
    || /(^|\.)(localhost|example|invalid|test)$/.test(url.hostname) || url.hostname === '[::1]' || /^127\./.test(url.hostname)) {
    throw new Error('App API 必须是手机可访问的 HTTPS 源站，不能使用占位域名、localhost、登录参数或路径。');
  }
  return url.origin;
}
export function androidRequirements(root, catalog) {
  const version = key => { const value = new RegExp(`^${key} = "([0-9.]+)"`, 'm').exec(catalog)?.[1]; if (!value) throw new Error('无法读取锁定RN的Android工具版本。'); return value; };
  const packages = [`platforms;android-${version('compileSdk')}`, `build-tools;${version('buildTools')}`, `ndk;${version('ndkVersion')}`, 'cmake;3.22.1', 'platform-tools'];
  const files = [`platforms/android-${version('compileSdk')}/android.jar`, `build-tools/${version('buildTools')}/aapt`, `ndk/${version('ndkVersion')}/source.properties`, 'cmake/3.22.1/bin/cmake', 'platform-tools/adb'];
  return { packages, missing: files.filter(file => !existsSync(resolve(root, file))) };
}
