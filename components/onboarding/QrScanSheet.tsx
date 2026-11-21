'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { cameraFailure, startBarcodeScanner, type ScannerControls } from '@/lib/barcodeScanner';
import { parseInviteInput } from '@/lib/parseInviteInput';

interface Props {
  open: boolean;
  onClose: () => void;
  /** A club's link was read: its token. The sheet closes itself first. */
  onLink: (token: string) => void;
  /** "Paste a link instead". */
  onPaste: () => void;
}

/**
 * Scan a club's QR code (docs/plans/sign-in-redesign.md: "Join a club" scans
 * first, a pasted link is the quiet way). The camera is the stocktake's
 * (`lib/barcodeScanner.ts`), reading QR codes; the caller checks `canScan()`
 * first, so this opens only where the camera can be used.
 *
 * Anything that is not one of our club links is said once and ignored, so a
 * poster's other QR code (a venue's menu) does not take anyone anywhere.
 */
export default function QrScanSheet({ open, onClose, onLink, onPaste }: Props) {
  const t = useTranslations('signedOut.scan');
  const tClose = useTranslations('recovery');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<'starting' | 'on' | 'denied' | 'missing' | 'failed'>('starting');
  const [wrong, setWrong] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    if (!open || !videoRef.current) return;
    let cancelled = false;
    let controls: ScannerControls | null = null;
    done.current = false;
    const video = videoRef.current;
    void startBarcodeScanner(
      video,
      (text) => {
        if (done.current) return;
        const { token } = parseInviteInput(text, window.location.origin);
        if (!token) {
          setWrong(true);
          return;
        }
        done.current = true;
        controls?.stop();
        onClose();
        onLink(token);
      },
      'qr',
    )
      .then((c) => {
        if (cancelled) {
          c.stop();
          return;
        }
        controls = c;
        setCamera('on');
      })
      .catch((err: unknown) => {
        if (!cancelled) setCamera(cameraFailure(err));
      });
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [open, onClose, onLink]);

  const failed = camera === 'denied' || camera === 'missing' || camera === 'failed';

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('title')}>
      <BottomSheetHeader onClose={onClose} closeLabel={tClose('close')}>
        {t('title')}
      </BottomSheetHeader>
      <BottomSheetBody>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <div className="stocktake-camera qr-camera">
            <video ref={videoRef} playsInline muted autoPlay aria-label={t('cameraLabel')} />
            <p className="stocktake-camera-hint fs-sm" role="status">
              {failed ? t(camera) : wrong ? t('notClub') : t('aim')}
            </p>
          </div>
          <button type="button" className="link-quiet" style={{ justifySelf: 'center' }} onClick={onPaste}>
            {t('paste')}
          </button>
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
