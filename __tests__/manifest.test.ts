import { describe, it, expect, beforeAll } from 'vitest';

// The manifest reads NEXT_PUBLIC_BASE_PATH at module load, so set it before
// importing. This guards the basePath gotcha: Next does NOT prefix the string
// values inside the manifest, so start_url/scope/icon src must be /bpm-prefixed.
let manifest: () => import('next').MetadataRoute.Manifest;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_BASE_PATH = '/bpm';
  manifest = (await import('@/app/manifest')).default;
});

describe('web app manifest', () => {
  it('is a standalone, portrait, installable PWA', () => {
    const m = manifest();
    expect(m.display).toBe('standalone');
    expect(m.name).toBe('BPM Badminton');
    expect(m.short_name).toBe('BPM');
  });

  it('prefixes start_url and scope with the basePath', () => {
    const m = manifest();
    expect(m.start_url).toBe('/bpm/');
    expect(m.scope).toBe('/bpm/');
  });

  it('declares /bpm-prefixed icons including a maskable one', () => {
    const m = manifest();
    const icons = m.icons ?? [];
    expect(icons.length).toBeGreaterThanOrEqual(3);
    for (const icon of icons) {
      expect(icon.src.startsWith('/bpm/icons/')).toBe(true);
    }
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);
    expect(icons.some((i) => i.sizes === '512x512' && i.purpose === 'any')).toBe(true);
  });
});
