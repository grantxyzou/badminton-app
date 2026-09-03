import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The App Store / Google Play shell.
 *
 * `server.url` means the WebView loads the LIVE production bundle — there is
 * no native build of the web app, no `cap sync` in CI, and a web deploy is
 * already a native update. `webDir` exists only because the CLI insists on
 * one; nothing in it is served. `errorPath` is the one file that IS served
 * from the bundle: what the person sees when the URL cannot load (airplane
 * mode on first launch — App Review tests exactly this).
 *
 * Runtime detection is `lib/native.ts`, not a flag: this build has no env of
 * its own. See docs/plans/native-shell.md.
 */
const config: CapacitorConfig = {
  appId: 'com.motioncraft.bpm',
  appName: 'BPM Badminton',
  webDir: 'native/www',
  server: {
    url: 'https://bpm.grantzou.com/bpm',
    cleartext: false,
    errorPath: 'error.html',
  },
  ios: {
    // The page handles the status bar itself via env(safe-area-inset-top);
    // an automatic inset would double it.
    contentInset: 'never',
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    FirebaseMessaging: {
      // Show a push that arrives while the app is in the foreground — the
      // default on iOS is to swallow it silently.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
    },
  },
};

export default config;
