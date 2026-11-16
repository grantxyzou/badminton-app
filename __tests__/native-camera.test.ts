// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cameraUsable, iosBuildHasCamera, IOS_CAMERA_BUILD } from '@/lib/nativeCamera';

/**
 * The stocktake photo quit the store iPhone app: iOS ends an app that opens
 * the camera with no NSCameraUsageDescription, and build 7 had none. The web
 * bundle is newer than the binary, so the photo is offered only where the
 * binary carries the key (lib/nativeCamera.ts).
 */

vi.mock('@capacitor/app', () => ({ App: { getInfo: () => getInfo() } }));
let getInfo: () => Promise<{ build: string }> = async () => ({ build: '7' });

function asNative(platform: 'ios' | 'android') {
  (window as unknown as { Capacitor: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => platform,
  };
}

describe('the camera gate', () => {
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    getInfo = async () => ({ build: '7' });
  });

  it('reads the build number', () => {
    expect(IOS_CAMERA_BUILD).toBe(8);
    expect(iosBuildHasCamera('7')).toBe(false);
    expect(iosBuildHasCamera('8')).toBe(true);
    expect(iosBuildHasCamera('12')).toBe(true);
    expect(iosBuildHasCamera('')).toBe(false);
    expect(iosBuildHasCamera(undefined)).toBe(false);
  });

  it('is open on the web', async () => {
    expect(await cameraUsable()).toBe(true);
  });

  it('is shut on an Android build without the CAMERA permission, and open from versionCode 7', async () => {
    asNative('android');
    getInfo = async () => ({ build: '6' });
    expect(await cameraUsable()).toBe(false);
    getInfo = async () => ({ build: '7' });
    expect(await cameraUsable()).toBe(true);
  });

  it('is shut on an iPhone build without the camera key, and open from build 8', async () => {
    asNative('ios');
    expect(await cameraUsable()).toBe(false);
    getInfo = async () => ({ build: '8' });
    expect(await cameraUsable()).toBe(true);
  });

  it('is shut when the iPhone build cannot be read', async () => {
    asNative('ios');
    getInfo = async () => { throw new Error('UNIMPLEMENTED'); };
    expect(await cameraUsable()).toBe(false);
  });
});
