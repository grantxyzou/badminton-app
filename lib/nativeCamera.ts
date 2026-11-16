import { isNative, nativePlatform } from './native';

/**
 * Can this phone open the camera WITHOUT ending the app?
 *
 * iOS ends an app that asks for the camera or the photo library when its
 * Info.plist carries no `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription`.
 * The store shell before build 8 had neither, so the string-shelf stocktake's
 * photo field quit the app the moment it was tapped (2026-11-16). The web
 * bundle is always newer than the binary (`server.url`), so the photo is
 * offered on iOS only from the build that carries the keys.
 *
 * The web and Android answer yes (Android's file provider has served the
 * camera since the shell shipped). An iOS build that cannot be read answers
 * NO: counting by hand is a detour, a crash is not.
 */
export const IOS_CAMERA_BUILD = 8;

export async function cameraUsable(): Promise<boolean> {
  if (!isNative()) return true;
  if (nativePlatform() !== 'ios') return true;
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    return iosBuildHasCamera(info.build);
  } catch {
    return false;
  }
}

/** Pure: does an iOS build number (CFBundleVersion, a string) carry the camera keys? */
export function iosBuildHasCamera(build: string | undefined | null): boolean {
  const n = Number.parseInt(String(build ?? ''), 10);
  return Number.isFinite(n) && n >= IOS_CAMERA_BUILD;
}
