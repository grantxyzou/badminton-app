import { isNative, nativePlatform } from './native';

/**
 * Can this phone open the camera WITHOUT ending the app?
 *
 * iOS ends an app that asks for the camera or the photo library when its
 * Info.plist carries no `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription`.
 * The store shell before build 8 had neither, so the string-shelf stocktake's
 * photo field quit the app the moment it was tapped (2026-11-16). The web
 * bundle is always newer than the binary (`server.url`), so the camera (now
 * the stocktake's barcode scanner) is offered on iOS only from the build that
 * carries the keys.
 *
 * Android does not end the app, but its WebView reads the live camera only
 * when the app DECLARES `android.permission.CAMERA` (Capacitor asks for it at
 * runtime; an undeclared ask is refused at once), which the shell does from
 * versionCode 7. The web answers yes. A build that cannot be read answers NO:
 * counting by hand is a detour, a crash or a refusal is not.
 */
export const IOS_CAMERA_BUILD = 8;
export const ANDROID_CAMERA_BUILD = 7;

export async function cameraUsable(): Promise<boolean> {
  if (!isNative()) return true;
  const platform = nativePlatform();
  if (platform !== 'ios' && platform !== 'android') return false;
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    return platform === 'ios' ? iosBuildHasCamera(info.build) : buildAtLeast(info.build, ANDROID_CAMERA_BUILD);
  } catch {
    return false;
  }
}

const buildAtLeast = (build: string | undefined | null, floor: number) => {
  const n = Number.parseInt(String(build ?? ''), 10);
  return Number.isFinite(n) && n >= floor;
};

/** Pure: does an iOS build number (CFBundleVersion, a string) carry the camera keys? */
export function iosBuildHasCamera(build: string | undefined | null): boolean {
  return buildAtLeast(build, IOS_CAMERA_BUILD);
}
