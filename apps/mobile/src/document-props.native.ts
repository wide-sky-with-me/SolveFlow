import type { DOMProps } from 'expo/dom';
import { Paths } from 'expo-file-system';
import { apiOrigin } from '@solveflow/client/remote';
/** No cookie jar, native module bridge or arbitrary file/network navigation in answer documents. */
export const documentProps: DOMProps = {
  useExpoDOMWebView: false, unstable_useExpoModulesBridge: false, matchContents: true, scrollEnabled: false,
  // RNCWebView 13.16.1 only re-injects injectedObjectJson in onPageStarted
  // when this hook is non-empty. Expo's HTML reads it before its entry script.
  injectedJavaScriptBeforeContentLoaded: 'true;',
  // Packaged DOM HTML separately waits for injectedObjectJson; Android early
  // evaluateJavascript is asynchronous and this hook alone cannot order startup.
  // A ScrollView child needs an initial viewport before DOM size measurement arrives.
  containerStyle: { flex: 0, width: '100%', minHeight: 80 },
  cacheEnabled: false, incognito: true, sharedCookiesEnabled: false, thirdPartyCookiesEnabled: false,
  allowFileAccess: false, allowFileAccessFromFileURLs: false, allowUniversalAccessFromFileURLs: false,
  allowingReadAccessToURL: Paths.bundle.uri, allowsLinkPreview: false, setSupportMultipleWindows: false,
  originWhitelist: ['file://*', 'about:blank', ...(__DEV__ ? ['http://*'] : [])],
  onShouldStartLoadWithRequest: request => {
    if (request.url === 'about:blank') return true;
    if (request.url.startsWith(`${Paths.bundle.uri.replace(/\/$/, '')}/`) || request.url.startsWith('file:///android_asset/www.bundle/')) return true;
    if (__DEV__) { try { return new URL(request.url).protocol === 'http:' && new URL(request.url).origin === apiOrigin(new URL(request.url).origin, true); } catch { return false; } }
    return false;
  },
};
