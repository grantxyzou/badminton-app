// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm/" }
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NAVIGATE_EVENT, SW_NAVIGATE_MESSAGE, routeInApp, useInAppNavigation } from '../lib/inAppNavigate';

afterEach(cleanup);

/**
 * A tapped notification must land INSIDE the app that is already open, not
 * reload it. `window.location.assign` in the native bridge replayed the whole
 * launch; the web service worker only focused the window, so a tap went
 * nowhere. These pin both halves.
 */
describe('routeInApp', () => {
  function capture() {
    const seen: Array<{ tab: string | null }> = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(NAVIGATE_EVENT, on);
    return { seen, off: () => window.removeEventListener(NAVIGATE_EVENT, on) };
  }

  it('the SPA root is a place in the app: Home', () => {
    const { seen, off } = capture();
    expect(routeInApp(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/`)).toBe(true);
    off();
    expect(seen).toEqual([{ tab: null }]);
  });

  it('carries the tab an access-request notification asks for', () => {
    const { seen, off } = capture();
    expect(routeInApp(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/?tab=admin`)).toBe(true);
    off();
    expect(seen).toEqual([{ tab: 'admin' }]);
  });

  it('another route is NOT in-app: it has to load as a page', () => {
    const { seen, off } = capture();
    expect(routeInApp(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/migrate?c=abc`)).toBe(false);
    expect(routeInApp(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/legal/privacy`)).toBe(false);
    off();
    expect(seen).toEqual([]);
  });

  it('another origin is never followed in place', () => {
    const { seen, off } = capture();
    expect(routeInApp('https://evil.example/bpm/?tab=admin')).toBe(false);
    off();
    expect(seen).toEqual([]);
  });
});

describe('useInAppNavigation', () => {
  it('hears a navigation dispatched on the page', () => {
    const onNavigate = vi.fn();
    renderHook(() => useInAppNavigation(onNavigate));
    routeInApp(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/?tab=players`);
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'players' });
  });
});

describe('the service worker tells an open window where to go', () => {
  // Comments stripped: the handler's own comment explains why it avoids
  // client.navigate(), and a scan must read the code, not the explanation.
  const sw = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  it('posts the navigation to the client it focuses, with the type the page listens for', () => {
    const click = sw.slice(sw.indexOf("addEventListener('notificationclick'"));
    expect(click).toContain(`postMessage({ type: '${SW_NAVIGATE_MESSAGE}', url: target })`);
    // A message, not client.navigate(): navigate reloads the page.
    expect(click).not.toContain('.navigate(');
  });
});

describe('the native bridge does not reload the app for an in-app link', () => {
  it('routes a push tap in place before falling back to a page load', () => {
    const bridge = readFileSync(join(process.cwd(), 'components', 'NativeBridge.tsx'), 'utf8');
    const push = bridge.slice(bridge.indexOf("'notificationActionPerformed'"));
    expect(push).toMatch(/if \(!routeInApp\(url\)\) window\.location\.assign\(url\)/);
  });
});
