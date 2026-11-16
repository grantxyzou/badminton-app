/**
 * The REAL `web-push`, not a fake. Every other push test mocks the package
 * with a `default` export, which is why a major update that removed `default`
 * (4.0, ES modules with named exports only) passed the whole suite while it
 * would have stopped every Web Push in production (`sendPushTo` never throws,
 * so nothing would have said so). This file loads the installed package and
 * checks that `lib/push.ts` finds the two calls it makes.
 */
import { describe, it, expect } from 'vitest';
import { resolveWebPush } from '@/lib/push';

describe('resolveWebPush', () => {
  it('finds setVapidDetails and sendNotification on the installed web-push', async () => {
    const api = resolveWebPush(await import('web-push'));
    expect(typeof api.setVapidDetails).toBe('function');
    expect(typeof api.sendNotification).toBe('function');
  });

  it('accepts a VAPID key pair on the installed web-push, called on its own', async () => {
    const mod = (await import('web-push')) as unknown as {
      generateVAPIDKeys?: () => { publicKey: string; privateKey: string };
      default?: { generateVAPIDKeys?: () => { publicKey: string; privateKey: string } };
    };
    const generate = mod.generateVAPIDKeys ?? mod.default?.generateVAPIDKeys;
    expect(typeof generate).toBe('function');
    const keys = generate!();
    const { setVapidDetails } = resolveWebPush(mod);
    // Detached from its object, the way a named export is: 4.0 exports this
    // one without `.bind`, so a `this`-reading version would throw here.
    expect(() => setVapidDetails('mailto:test@example.com', keys.publicKey, keys.privateKey)).not.toThrow();
  });

  it('reads a CommonJS-style module from its default export (web-push 3.x)', () => {
    const api = { setVapidDetails: () => undefined, sendNotification: async () => undefined };
    expect(resolveWebPush({ default: api })).toBe(api);
  });

  it('reads an ES module with named exports only (web-push 4.x)', () => {
    const mod = { setVapidDetails: () => undefined, sendNotification: async () => undefined, default: undefined };
    expect(resolveWebPush(mod)).toBe(mod);
  });

  it('throws on a module that carries neither, rather than failing later and silently', () => {
    expect(() => resolveWebPush({ default: {} })).toThrow(/web-push/);
    expect(() => resolveWebPush(undefined)).toThrow(/web-push/);
  });
});
