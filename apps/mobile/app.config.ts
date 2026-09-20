import type { ExpoConfig } from 'expo/config';
const config: ExpoConfig = {
  name: 'SolveFlow', slug: 'solveflow', version: '0.1.30', scheme: 'solveflow',
  icon: './assets/app-icon.png',
  orientation: 'default',
  ios: { supportsTablet: true, bundleIdentifier: 'com.solveflow.app' },
  android: { versionCode: 31, adaptiveIcon: { foregroundImage: './assets/app-icon.png', backgroundColor: '#2867dd' }, allowBackup: false, package: 'com.solveflow.app', blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_MEDIA_VIDEO', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE'] },
  web: { bundler: 'metro', name: 'SolveFlow 拍照解题', lang: 'zh-CN', favicon: './assets/app-icon.png' },
  plugins: [
    './plugins/with-solve-background.cjs',
    './plugins/with-dom-bootstrap.cjs',
    ['expo-splash-screen', { backgroundColor: '#ffffff', dark: { backgroundColor: '#0e1520' }, image: './assets/app-icon.png', imageWidth: 72, resizeMode: 'contain' }],
    ['expo-camera', { cameraPermission: '允许 SolveFlow 拍摄题目，用于识别和解答。', microphonePermission: false, recordAudioAndroid: false, barcodeScannerEnabled: false }],
    ['expo-image-picker', { photosPermission: '允许 SolveFlow 选择题目照片，用于识别和解答。', cameraPermission: '允许 SolveFlow 拍摄题目，用于识别和解答。', microphonePermission: false }],
    ['expo-secure-store', { configureAndroidBackup: true, faceIDPermission: false }],
  ],
};
export default config;
