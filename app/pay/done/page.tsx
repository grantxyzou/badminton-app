import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export const metadata: Metadata = {
  title: 'Card payment',
  robots: { index: false, follow: false },
};

/**
 * Where Stripe's Checkout returns when the STORE APP started it
 * (`startCardCheckout(…, { native: true })` in lib/cardPay.ts). The page is
 * inside the system browser sheet over the app, which iOS will not close by
 * itself; the button's custom scheme opens the app, and NativeBridge closes
 * the sheet and shows Home. A link to our own domain would open in place.
 *
 * It says what happened and nothing else: the lines are marked paid by
 * Stripe's signed webhook, never by arriving here.
 */
export default async function PayDonePage({ searchParams }: { searchParams: Promise<{ cancelled?: string }> }) {
  const t = await getTranslations('home.payment.done');
  const cancelled = (await searchParams).cancelled === '1';
  return (
    <main style={{ maxWidth: '480px', margin: '0 auto', padding: 'var(--space-9) var(--space-7)', textAlign: 'center' }}>
      <span
        className="material-icons icon-xl"
        aria-hidden="true"
        style={{ color: cancelled ? 'var(--text-muted)' : 'var(--accent)' }}
      >
        {cancelled ? 'close' : 'check_circle'}
      </span>
      <h1 className="bpm-h2" style={{ marginTop: 'var(--space-3)' }}>{cancelled ? t('cancelledTitle') : t('title')}</h1>
      <p className="fs-md" style={{ color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)', marginTop: 'var(--space-3)' }}>
        {cancelled ? t('cancelledBody') : t('body')}
      </p>
      <a
        href="bpm://pay/return"
        className="btn-primary"
        style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 'var(--space-7)' }}
        data-testid="pay-done-back"
      >
        {t('back')}
      </a>
    </main>
  );
}
