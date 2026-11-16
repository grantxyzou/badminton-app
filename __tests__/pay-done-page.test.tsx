import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from 'next-intl';
import en from '../messages/en.json';
import zh from '../messages/zh-CN.json';

/**
 * /pay/done: where Stripe's Checkout returns inside the store app's browser
 * sheet. Its one job is the way home, `bpm://pay/return`, which NativeBridge
 * turns into "close the sheet, show Home".
 */
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => createTranslator({ locale: 'en', messages: en, namespace: namespace as never }),
}));

import PayDonePage from '../app/pay/done/page';

async function html(query: Record<string, string> = {}) {
  return renderToStaticMarkup(await PayDonePage({ searchParams: Promise.resolve(query) }));
}

describe('/pay/done', () => {
  it('after paying: says it went, and links back into the app', async () => {
    const out = await html();
    expect(out).toContain(en.home.payment.done.title);
    expect(out).toContain('href="bpm://pay/return"');
  });

  it('after cancelling: says nothing was charged, same way home', async () => {
    const out = await html({ cancelled: '1' });
    expect(out).toContain(en.home.payment.done.cancelledBody);
    expect(out).not.toContain(en.home.payment.done.title);
    expect(out).toContain('href="bpm://pay/return"');
  });

  it('has Chinese for every line', () => {
    expect(Object.keys(zh.home.payment.done).sort()).toEqual(Object.keys(en.home.payment.done).sort());
  });
});
