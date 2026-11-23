'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { canScan } from '@/lib/barcodeScanner';
import { parseInviteInput } from '@/lib/parseInviteInput';
import { useOnline } from '@/lib/useOnline';
import AuthStage from './AuthStage';

// The camera's sheet and its reader load on the tap that opens them.
const QrScanSheet = dynamic(() => import('./QrScanSheet'), { ssr: false });

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  title: string;
  onBack?: () => void;
  heading: string;
  copy: string;
  /**
   * Where the Scan button sits. `middle`: right under the text (Join a club,
   * Grant: "Middle lower of the screen"). `bottom`: the main button's place
   * (Can't sign in?).
   */
  scanAt: 'middle' | 'bottom';
  /** A live club link, checked: its token, and the club's name when the check gave one. */
  onLink: (token: string, club: string | null) => void;
  /** The quiet links beside "Paste a link". */
  links?: ReactNode;
  /** A link they arrived with did not check out: open on the paste page, saying why. */
  landingError?: string | null;
}

/**
 * Find your club by its link (docs/plans/sign-in-redesign.md): scan the QR
 * poster first, paste the link as the quiet way. Both end in the same check —
 * `GET /api/groups/preview`, the one club read a signed-out visitor may make,
 * which names the club behind a live link and nothing else.
 *
 * Where the camera cannot be used (a store build without the camera
 * permission, a browser without one) the Scan button opens the paste page, so
 * it is never a dead button.
 */
export default function ClubLinkPage({ title, onBack, heading, copy, scanAt, onLink, links, landingError }: Props) {
  const t = useTranslations('signedOut');
  const tj = useTranslations('signedOut.join');
  const online = useOnline();
  const [mode, setMode] = useState<'scan' | 'paste'>(landingError ? 'paste' : 'scan');
  const [scanning, setScanning] = useState(false);
  /** `null` while unknown: the button then opens the camera's own check. */
  const [cameraOk, setCameraOk] = useState<boolean | null>(null);
  const [entry, setEntry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(landingError ?? null);

  useEffect(() => {
    let live = true;
    void canScan().then((ok) => {
      if (live) setCameraOk(ok);
    });
    return () => {
      live = false;
    };
  }, []);

  const check = useCallback(
    async (token: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`${BASE}/api/groups/preview?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
        if (!res.ok) {
          setMode('paste');
          setError(res.status === 404 ? tj('linkNotFound') : tj('failed'));
          return;
        }
        const body = (await res.json().catch(() => null)) as { name?: unknown } | null;
        onLink(token, typeof body?.name === 'string' ? body.name : null);
      } catch {
        setMode('paste');
        setError(tj('failed'));
      } finally {
        setBusy(false);
      }
    },
    [onLink, tj],
  );

  function submitPasted() {
    const { token } = parseInviteInput(entry, window.location.origin);
    if (!token) {
      setError(tj('needLink'));
      return;
    }
    void check(token);
  }

  const closeScanner = useCallback(() => setScanning(false), []);
  const scanned = useCallback((token: string) => void check(token), [check]);

  if (mode === 'paste') {
    return (
      <AuthStage
        data-page="paste-link"
        title={title}
        onBack={() => {
          setMode('scan');
          setError(null);
        }}
        backLabel={t('back')}
        heading={tj('pasteHeading')}
        copy={<p className="auth-copy">{tj('pasteBody')}</p>}
        actions={
          <button
            type="button"
            className="auth-btn auth-btn--primary"
            disabled={busy || !online || !entry.trim()}
            onClick={submitPasted}
          >
            {busy ? tj('checking') : tj('continue')}
          </button>
        }
        links={links}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitPasted();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
        >
          <input
            className="auth-field"
            type="text"
            inputMode="url"
            value={entry}
            onChange={(e) => {
              setEntry(e.target.value);
              setError(null);
            }}
            placeholder={tj('linkLabel')}
            aria-label={tj('linkLabel')}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
          />
          {error && (
            <p className="field-error" role="alert" style={{ paddingInline: 'var(--space-5)' }}>
              {error}
            </p>
          )}
        </form>
      </AuthStage>
    );
  }

  const scanButton = (
    <button
      type="button"
      className="auth-btn auth-btn--primary"
      disabled={busy || !online}
      onClick={() => (cameraOk === false ? setMode('paste') : setScanning(true))}
    >
      <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-lg)' }}>
        qr_code_scanner
      </span>
      <span>{tj('scan')}</span>
    </button>
  );

  return (
    <>
      <AuthStage
        data-page="scan-link"
        title={title}
        onBack={onBack}
        backLabel={t('back')}
        heading={heading}
        copy={<p className="auth-copy">{copy}</p>}
        actions={scanAt === 'bottom' ? scanButton : undefined}
        links={
          <>
            <button type="button" className="link-quiet link-quiet--plain" onClick={() => setMode('paste')}>
              {tj('pasteLink')}
            </button>
            {links}
          </>
        }
      >
        {scanAt === 'middle' ? scanButton : null}
      </AuthStage>
      {scanning && (
        <QrScanSheet
          open={scanning}
          onClose={closeScanner}
          onLink={scanned}
          onPaste={() => {
            setScanning(false);
            setMode('paste');
          }}
        />
      )}
    </>
  );
}
