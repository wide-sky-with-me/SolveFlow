import * as SplashScreen from 'expo-splash-screen';
// Keep the native artwork until the matching React Native image is decoded.
void SplashScreen.preventAutoHideAsync().catch(() => console.warn('原生开屏保持失败，将使用应用内加载画面。'));
let revealed = false;
export function revealAppFrame(reducedMotion: boolean) {
  if (revealed) return;
  revealed = true;
  // The RN artwork is at the same center/size as the native icon. Cross-fading
  // two independently animated images creates a double image on Android.
  SplashScreen.setOptions({ fade: false, duration: 0 });
  SplashScreen.hide();
}
