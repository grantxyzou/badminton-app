import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * The hand edits on top of Capacitor's generated projects. `cap add` would
 * regenerate any of these without them, and nothing else would notice: the
 * scheme the OAuth landing hands back to, the App Link the migration link
 * needs, the notification channel every push names, the export-compliance
 * answer, the privacy manifest. Pinned as source scans, like every other
 * shape this repo cannot see at runtime.
 */
const R = (...p: string[]) => join(process.cwd(), ...p);
const read = (...p: string[]) => readFileSync(R(...p), 'utf8');

/**
 * Is this path TRACKED by git? The secrets below must never be COMMITTED,
 * which is not the same as never being on disk — and conflating the two is how
 * this canary started crying wolf. Both files legitimately exist on the
 * maintainer's machine (a device build needs the real Firebase config) and are
 * gitignored, which is the actual invariant. Asserting absence-on-disk passed
 * in CI, where nothing checks them out, and failed only for the one person who
 * could act on it — training exactly the wrong reflex about a red
 * `native-shell-projects`.
 */
const isTracked = (...p: string[]) =>
  execFileSync('git', ['ls-files', '--', join(...p)], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim() !== '';

describe('ios/', () => {
  const plist = read('ios', 'App', 'App', 'Info.plist');

  it('registers the bpm:// scheme', () => {
    expect(plist).toMatch(/<key>CFBundleURLSchemes<\/key>[\s\S]*?<string>bpm<\/string>/);
  });

  it('declares no non-exempt encryption and the push background mode', () => {
    expect(plist).toMatch(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
    expect(plist).toMatch(/<key>UIBackgroundModes<\/key>[\s\S]*?<string>remote-notification<\/string>/);
  });

  it('is portrait-only on iPhone, matching the manifest', () => {
    const block = plist.match(/<key>UISupportedInterfaceOrientations<\/key>\s*<array>([\s\S]*?)<\/array>/)![1]!;
    expect(block.match(/<string>/g)).toHaveLength(1);
    expect(block).toContain('UIInterfaceOrientationPortrait');
  });

  it('has GoogleService-Info.plist and PrivacyInfo.xcprivacy in the app target', () => {
    /* Both are RESOURCES, and both fail silently when they are only on disk:
       an unwired GoogleService-Info means FirebaseApp.configure() finds no
       plist and push is dead with no error, and an unwired PrivacyInfo is an
       App Store rejection at upload time. Wired by hand in Xcode on
       2026-09-03; nothing else would notice if a regenerated project dropped
       them. The FILES stay out of git (see .gitignore) — this pins the
       reference and the Resources build phase. */
    const pbx = read('ios', 'App', 'App.xcodeproj', 'project.pbxproj');
    for (const name of ['GoogleService-Info.plist', 'PrivacyInfo.xcprivacy']) {
      expect(pbx, `${name} file reference`).toContain(`/* ${name} */ = {isa = PBXFileReference`);
      expect(pbx, `${name} in Resources`).toContain(`/* ${name} in Resources */`);
    }
  });

  it('records the signing team so an archive is reproducible', () => {
    // Not a secret — a Team ID is public in every app's receipt. Committed so
    // "Archive" works on a fresh clone without re-picking the team.
    expect(read('ios', 'App', 'App.xcodeproj', 'project.pbxproj')).toContain('DEVELOPMENT_TEAM = T4JGTBUTYM;');
  });

  it('pins Swift package versions with a committed Package.resolved', () => {
    // Capacitor + Firebase resolve through SPM; without this file two machines
    // can build against different Firebase versions.
    const resolved = read('ios', 'App', 'App.xcodeproj', 'project.xcworkspace', 'xcshareddata', 'swiftpm', 'Package.resolved');
    expect(resolved).toContain('firebase-ios-sdk');
    expect(resolved).toContain('capacitor-swift-pm');
  });

  it('has the entitlements wired into the project', () => {
    const ent = read('ios', 'App', 'App', 'App.entitlements');
    expect(ent).toContain('applinks:bpm.grantzou.com');
    expect(ent).toContain('webcredentials:bpm.grantzou.com');
    expect(ent).toContain('aps-environment');
    const pbx = read('ios', 'App', 'App.xcodeproj', 'project.pbxproj');
    expect(pbx).toContain('CODE_SIGN_ENTITLEMENTS = App/App.entitlements;');
    expect(pbx).toContain('TARGETED_DEVICE_FAMILY = 1;');
    expect(pbx).not.toContain('TARGETED_DEVICE_FAMILY = "1,2";');
  });

  // Xcode, adding the widget target (2026-10-25), rewrote both targets' floor to
  // $(RECOMMENDED_IPHONEOS_DEPLOYMENT_TARGET). That is whatever the Xcode on the
  // desk recommends, so the app's minimum iOS would rise silently with an Xcode
  // update and older iPhones could no longer install it. The app stays on 15.0;
  // the widget extension needs 17.0 for interactive widgets (Button(intent:),
  // containerBackground), and iOS simply does not offer it below that.
  it('pins the minimum iOS of the app and of the widget extension', () => {
    const pbx = read('ios', 'App', 'App.xcodeproj', 'project.pbxproj');
    expect(pbx).not.toContain('RECOMMENDED_IPHONEOS_DEPLOYMENT_TARGET');
    const configs = pbx.split('isa = XCBuildConfiguration;').slice(1);
    const appFloors = configs.filter((c) => c.includes('INFOPLIST_FILE = App/Info.plist;'))
      .map((c) => /IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/.exec(c)?.[1]);
    const widgetFloors = configs.filter((c) => c.includes('INFOPLIST_FILE = BPMWidget/Info.plist;'))
      .map((c) => /IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/.exec(c)?.[1]);
    expect(appFloors).toEqual(['15.0', '15.0']);
    expect(widgetFloors).toEqual(['17.0', '17.0']);
  });

  it('ships a privacy manifest that does not track', () => {
    const priv = read('ios', 'App', 'App', 'PrivacyInfo.xcprivacy');
    expect(priv).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(priv).toContain('NSPrivacyCollectedDataTypeOtherFinancialInfo');
    // Matches what App Store Connect declares (2026-10-07).
    for (const t of ['ProductInteraction', 'Health', 'CustomerSupport']) {
      expect(priv).toContain(`NSPrivacyCollectedDataType${t}`);
    }
    expect(priv).toContain('CA92.1');
  });

  it('forwards the APNs token and guards Firebase on its plist', () => {
    const swift = read('ios', 'App', 'App', 'AppDelegate.swift');
    expect(swift).toContain('capacitorDidRegisterForRemoteNotifications');
    expect(swift).toContain('capacitorDidFailToRegisterForRemoteNotifications');
    expect(swift).toContain('GoogleService-Info');
    expect(swift).toContain('FirebaseApp.configure()');
  });

  // docs/plans/native-badge-shortcuts.md. Without the SceneDelegate
  // forwarding the long-press menu still shows, and a tap on it does nothing:
  // the plugin never hears about it under the UIScene lifecycle.
  it('forwards a long-press shortcut to the plugin, at launch and while running', () => {
    const scene = read('ios', 'App', 'App', 'SceneDelegate.swift');
    expect(scene).toContain('import AppShortcutsPlugin');
    expect(scene).toContain('connectionOptions.shortcutItem');
    expect(scene).toContain('performActionFor shortcutItem');
    expect(scene).toContain('AppShortcutsPlugin.notificationName');
  });

  it('builds the badge and shortcut plugins into the app', () => {
    const spm = read('ios', 'App', 'CapApp-SPM', 'Package.swift');
    expect(spm).toContain('CapawesomeCapacitorAppShortcuts');
    expect(spm).toContain('CapawesomeCapacitorBadge');
  });

  /* The home-screen widget (docs/plans/native-widgets.md). The plugin is IN
     the app, not a package, so Capacitor finds it only because
     MainViewController registers it and Main.storyboard names that class; a
     regenerated storyboard back on CAPBridgeViewController would leave the
     widget without a pass and no error anywhere. The App Group is the only
     storage the app and the widget share, so its name has to agree in four
     places. */
  it('registers the widget plugin through the storyboard and the project', () => {
    expect(read('ios', 'App', 'App', 'Base.lproj', 'Main.storyboard')).toContain('customClass="MainViewController" customModule="App"');
    // The scene delegate builds the window IN CODE, so the storyboard's class
    // is never read: the first cut named MainViewController only there, and on
    // a phone `isPluginAvailable('BpmWidget')` answered false.
    const scene = read('ios', 'App', 'App', 'SceneDelegate.swift');
    expect(scene).toContain('rootViewController = MainViewController()');
    expect(scene).not.toContain('CAPBridgeViewController()');
    expect(read('ios', 'App', 'App', 'MainViewController.swift')).toContain('registerPluginInstance(BpmWidgetPlugin())');
    const pbx = read('ios', 'App', 'App.xcodeproj', 'project.pbxproj');
    for (const f of ['MainViewController.swift', 'BpmWidgetPlugin.swift']) {
      expect(pbx).toMatch(new RegExp(`/\\* ${f.replace('.', '\\.')} in Sources \\*/,`));
    }
    expect(read('ios', 'App', 'App', 'BpmWidgetPlugin.swift')).toContain('jsName = "BpmWidget"');
    // The base URL is PARSED: a string prefix let `http://localhost.example.com`
    // through as local (security review, 2026-10-24).
    const plugin = read('ios', 'App', 'App', 'BpmWidgetPlugin.swift');
    expect(plugin).not.toContain('hasPrefix("http://localhost")');
    expect(plugin).toContain('url.host?.lowercased() == "localhost"');
  });

  it('names one App Group for the app, the widget and the stores that share it', () => {
    const group = 'group.com.motioncraft.bpm';
    expect(read('ios', 'App', 'App', 'App.entitlements')).toContain(`<string>${group}</string>`);
    expect(read('ios', 'App', 'BPMWidget', 'BPMWidget.entitlements')).toContain(`<string>${group}</string>`);
    expect(read('ios', 'App', 'App', 'BpmWidgetPlugin.swift')).toContain(`appGroup = "${group}"`);
    expect(read('ios', 'App', 'BPMWidget', 'BPMWidgetStore.swift')).toContain(`appGroup = "${group}"`);
    // The keys too: the plugin writes what the widget reads.
    for (const key of ['widget.token', 'widget.baseUrl', 'widget.snapshot']) {
      expect(read('ios', 'App', 'App', 'BpmWidgetPlugin.swift')).toContain(`"${key}"`);
      expect(read('ios', 'App', 'BPMWidget', 'BPMWidgetStore.swift')).toContain(`"${key}"`);
    }
  });

  it('keeps the money on the lock screen private', () => {
    const widget = read('ios', 'App', 'BPMWidget', 'BPMWidget.swift');
    expect(widget).toContain('.privacySensitive()');
    expect(widget).toContain('.accessoryCircular');
  });

  it('does not commit Firebase config or signing material', () => {
    expect(isTracked('ios', 'App', 'App', 'GoogleService-Info.plist')).toBe(false);
    const gi = read('.gitignore');
    for (const p of ['*.p8', '*.keystore', '*.mobileprovision']) expect(gi).toContain(p);
  });
});

describe('android/', () => {
  const manifest = read('android', 'app', 'src', 'main', 'AndroidManifest.xml');

  it('registers the bpm:// scheme and the App Link for /bpm/migrate only', () => {
    expect(read('android', 'app', 'src', 'main', 'res', 'values', 'strings.xml')).toContain(
      '<string name="custom_url_scheme">bpm</string>',
    );
    expect(manifest).toContain('android:scheme="@string/custom_url_scheme"');
    const appLink = manifest.match(/<intent-filter android:autoVerify="true">([\s\S]*?)<\/intent-filter>/)![1]!;
    expect(appLink).toContain('android:host="bpm.grantzou.com"');
    expect(appLink).toContain('android:pathPrefix="/bpm/migrate"');
    expect(appLink).toContain('android:scheme="https"');
  });

  it('asks for POST_NOTIFICATIONS and refuses cleartext', () => {
    expect(manifest).toContain('android.permission.POST_NOTIFICATIONS');
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
  });

  it('creates the notification channel lib/fcm.ts names', () => {
    const fcm = read('lib', 'fcm.ts');
    const channel = fcm.match(/channel_id:\s*'([^']+)'/)![1];
    expect(manifest).toContain(`android:value="${channel}"`);
    const activity = read('android', 'app', 'src', 'main', 'java', 'com', 'motioncraft', 'bpm', 'MainActivity.java');
    expect(activity).toContain(`CHANNEL_ID = "${channel}"`);
    expect(activity).toContain('createNotificationChannel');
  });

  it('is portrait-only and versioned like iOS', () => {
    expect(manifest).toContain('android:screenOrientation="portrait"');
    expect(read('android', 'app', 'build.gradle')).toContain('versionName "1.0.0"');
    expect(read('ios', 'App', 'App.xcodeproj', 'project.pbxproj')).toContain('MARKETING_VERSION = 1.0.0;');
  });

  it('builds the badge and shortcut plugins into the app', () => {
    const gradle = read('android', 'app', 'capacitor.build.gradle');
    expect(gradle).toContain("implementation project(':capawesome-capacitor-app-shortcuts')");
    expect(gradle).toContain("implementation project(':capawesome-capacitor-badge')");
  });

  /* The home-screen widget (docs/plans/native-widgets.md): the plugin is in
     the app module, so MainActivity has to register it before the bridge
     starts, and the receiver has to be in the manifest or the widget never
     appears in the picker. Not exported: Join and Undo arrive only through
     its own PendingIntents. */
  it('registers the widget plugin and its receiver', () => {
    const activity = read('android', 'app', 'src', 'main', 'java', 'com', 'motioncraft', 'bpm', 'MainActivity.java');
    expect(activity).toMatch(/registerPlugin\(BpmWidgetPlugin\.class\);\s*super\.onCreate/);
    const receiver = manifest.match(/<receiver\s+android:name="\.BpmWidgetProvider"([\s\S]*?)<\/receiver>/)![1]!;
    expect(receiver).toContain('android:exported="false"');
    expect(receiver).toContain('android.appwidget.action.APPWIDGET_UPDATE');
    expect(receiver).toContain('@xml/bpm_widget_info');
    expect(read('android', 'app', 'src', 'main', 'java', 'com', 'motioncraft', 'bpm', 'BpmWidgetPlugin.java')).toContain('@CapacitorPlugin(name = "BpmWidget")');
  });

  it('does not commit google-services.json', () => {
    expect(isTracked('android', 'app', 'google-services.json')).toBe(false);
  });
});
