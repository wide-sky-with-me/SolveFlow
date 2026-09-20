const { withAndroidManifest, withMainApplication, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = function withSolveBackground(config) {
  config = withAndroidManifest(config, config => {
    const manifest = config.modResults.manifest;
    const permissions = ['android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_DATA_SYNC', 'android.permission.WAKE_LOCK', 'android.permission.POST_NOTIFICATIONS'];
    manifest['uses-permission'] ??= [];
    for (const name of permissions) if (!manifest['uses-permission'].some(p => p.$['android:name'] === name)) manifest['uses-permission'].push({ $: { 'android:name': name } });
    const app = manifest.application[0]; app.service ??= [];
    if (!app.service.some(s => s.$['android:name'] === '.SolveBackgroundService')) app.service.push({ $: { 'android:name': '.SolveBackgroundService', 'android:exported': 'false', 'android:foregroundServiceType': 'dataSync', 'android:stopWithTask': 'false' } });
    return config;
  });
  config = withMainApplication(config, config => {
    const marker = 'PackageList(this).packages.apply {';
    if (!config.modResults.contents.includes('add(SolveBackgroundPackage())')) {
      if (!config.modResults.contents.includes(marker)) throw new Error('Unsupported MainApplication template');
      config.modResults.contents = config.modResults.contents.replace(marker, marker + '\n          add(SolveBackgroundPackage())');
    }
    return config;
  });
  return withDangerousMod(config, ['android', async config => {
    const target = path.join(config.modRequest.platformProjectRoot, 'app/src/main/java/com/solveflow/app');
    await fs.mkdir(target, { recursive: true });
    for (const file of ['SolveBackgroundModule.kt', 'SolveBackgroundService.kt']) await fs.copyFile(path.join(__dirname, 'solve-background', file), path.join(target, file));
    return config;
  }]);
};
