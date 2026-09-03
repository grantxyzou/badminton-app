import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import config from '../capacitor.config';

/**
 * The shell's contract with the web app. Each of these is a one-line edit
 * that would ship a broken store build with every web test green.
 */
describe('capacitor.config.ts', () => {
  it('loads the LIVE production URL over https, never cleartext', () => {
    expect(config.server?.url).toBe('https://bpm.grantzou.com/bpm');
    expect(config.server?.cleartext).toBe(false);
    expect(config.android?.allowMixedContent).toBe(false);
  });

  it('has the store identity', () => {
    expect(config.appId).toBe('com.motioncraft.bpm');
    expect(config.appName).toBe('BPM Badminton');
  });

  it('points errorPath at a bundled page that exists', () => {
    expect(config.server?.errorPath).toBe('error.html');
    expect(existsSync(join(process.cwd(), config.webDir!, 'error.html'))).toBe(true);
    // And an index, which `cap sync` requires even though it is never shown.
    expect(existsSync(join(process.cwd(), config.webDir!, 'index.html'))).toBe(true);
  });

  it('does not double the status-bar inset', () => {
    // The page applies env(safe-area-inset-top) itself.
    expect(config.ios?.contentInset).toBe('never');
    expect(config.plugins?.StatusBar?.overlaysWebView).toBe(true);
  });

  it('shows foreground pushes on iOS', () => {
    expect(config.plugins?.FirebaseMessaging?.presentationOptions).toEqual(['badge', 'sound', 'alert']);
  });
});

describe('native/www/error.html — the legible-fail page', () => {
  const src = readFileSync(join(process.cwd(), 'native', 'www', 'error.html'), 'utf8');

  it('is not an offline cache: no fetch, no storage, no service worker', () => {
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\b/);
    expect(src).not.toMatch(/serviceWorker/);
  });

  it('retries against the live URL', () => {
    expect(src).toContain("window.location.replace('https://bpm.grantzou.com/bpm')");
  });

  it('is self-contained and bilingual', () => {
    expect(src).not.toMatch(/<link\b/);
    expect(src).not.toMatch(/<script\s+src=/);
    expect(src).toContain("Can't reach BPM");
    expect(src).toContain('无法连接 BPM');
    expect(src).toMatch(/lang="zh-CN"/);
  });
});
