const { withGradleProperties, withAppBuildGradle } = require('expo/config-plugins');

// Persist release settings through Expo prebuild without another runtime dependency.
module.exports = function withAndroidReleaseSize(config) {
  config = withGradleProperties(config, config => {
    const settings = {
      'android.enableMinifyInReleaseBuilds': 'true',
      'android.enableShrinkResourcesInReleaseBuilds': 'true',
      // Locked AGP 8.12 supports tracing resource and code reachability together.
      'android.r8.optimizedResourceShrinking': 'true',
    };
    config.modResults = config.modResults.filter(item => item.type !== 'property' || !(item.key in settings));
    for (const [key, value] of Object.entries(settings)) config.modResults.push({ type: 'property', key, value });
    return config;
  });
  return withAppBuildGradle(config, config => {
    const source = config.modResults.contents;
    if (config.modResults.language !== 'groovy' || !/getDefaultProguardFile\("proguard-android(?:-optimize)?\.txt"\)/.test(source)) {
      throw new Error('Unsupported Android ProGuard template');
    }
    config.modResults.contents = source.replace('getDefaultProguardFile("proguard-android.txt")', 'getDefaultProguardFile("proguard-android-optimize.txt")');
    return config;
  });
};
