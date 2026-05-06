'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import {
  renderGroupText,
  renderIndividualText,
  renderGroupCanvas,
  type ReceiptInput,
} from '@/lib/receiptTemplate';

interface ReceiptSheetProps {
  open: boolean;
  onClose: () => void;
  input: ReceiptInput | null;
  error?: string;
  initialMode?: 'group' | 'individual';
  initialPlayerName?: string;
}

export default function ReceiptSheet({ open, onClose, input, error, initialMode = 'group', initialPlayerName }: ReceiptSheetProps) {
  const [mode, setMode] = useState<'group' | 'individual'>(initialMode);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(initialPlayerName ?? null);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string>('');

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setSelectedPlayer(initialPlayerName ?? null);
      setCopied(false);
    }
  }, [open, initialMode, initialPlayerName]);

  const text = useMemo(() => {
    if (!input) return '';
    if (mode === 'group') return renderGroupText(input);
    if (!selectedPlayer) return '';
    return renderIndividualText({ ...input, playerName: selectedPlayer });
  }, [input, mode, selectedPlayer]);

  useEffect(() => {
    if (!open || !input || mode !== 'group') return;
    let cancelled = false;
    (async () => {
      try {
        await (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
      } catch {}
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const url = renderGroupCanvas(input, canvas);
      setImageDataUrl(url);
    })();
    return () => { cancelled = true; };
  }, [open, input, mode]);

  async function copyText() {
    setActionError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setActionError('Couldn’t copy — long-press the text below to copy manually.');
    }
  }

  async function shareImage() {
    if (!imageDataUrl) return;
    setActionError(null);
    let nativeShareTried = false;
    try {
      const blob = await (await fetch(imageDataUrl)).blob();
      const file = new File([blob], `bpm-receipt.png`, { type: 'image/png' });
      const navAny = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean; share?: (data: { files: File[] }) => Promise<void> };
      if (navAny.canShare?.({ files: [file] }) && navAny.share) {
        nativeShareTried = true;
        await navAny.share({ files: [file] });
        return;
      }
    } catch (err) {
      // Native share failure (user dismissed, or platform error). If we
      // had a native path available, the dismissal isn't an error worth
      // surfacing — fall through to download silently. Anything else gets
      // logged so debugging is possible.
      if (!nativeShareTried) console.warn('shareImage:', err);
    }
    try {
      const a = document.createElement('a');
      a.href = imageDataUrl;
      a.download = 'bpm-receipt.png';
      a.click();
    } catch {
      setActionError('Couldn’t download — try Copy text instead.');
    }
  }

  if (!input && !error) return null;

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Receipt" maxHeight="80vh" className="max-w-sm mx-auto">
      <BottomSheetHeader className="flex items-center justify-between p-4">
        <span style={{ fontSize: 16, fontWeight: 600 }}>Share session cost</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            minWidth: 44,
            minHeight: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span className="material-icons" style={{ fontSize: 20 }}>close</span>
        </button>
      </BottomSheetHeader>

      <BottomSheetBody className="p-5 pb-8">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && (
            <p
              role="alert"
              style={{
                color: 'var(--color-red, #ef4444)',
                fontSize: 13,
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              {error}
            </p>
          )}

          {input && (
            <>
              {/* Mode toggle — uses canonical .segment-control */}
              <div className="segment-control">
                <button
                  type="button"
                  className={mode === 'group' ? 'segment-tab-active' : 'segment-tab-inactive'}
                  onClick={() => setMode('group')}
                >
                  Group
                </button>
                <button
                  type="button"
                  className={mode === 'individual' ? 'segment-tab-active' : 'segment-tab-inactive'}
                  onClick={() => setMode('individual')}
                  disabled={input.playerNames.length === 0}
                >
                  Individual
                </button>
              </div>

              {mode === 'individual' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Recipient</label>
                  <select
                    value={selectedPlayer ?? ''}
                    onChange={(e) => setSelectedPlayer(e.target.value || null)}
                  >
                    <option value="">Choose a player…</option>
                    {input.playerNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              )}

              {mode === 'group' && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    borderRadius: 12,
                    overflow: 'hidden',
                  }}
                >
                  <canvas
                    ref={canvasRef}
                    aria-label="Receipt image preview"
                    style={{ maxWidth: '100%', height: 'auto', borderRadius: 12 }}
                  />
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Text version</label>
                <pre
                  style={{
                    fontFamily: 'var(--font-mono), ui-monospace, monospace',
                    fontSize: 12,
                    lineHeight: 1.55,
                    whiteSpace: 'pre-wrap',
                    margin: 0,
                    padding: 12,
                    borderRadius: 12,
                    background: 'var(--input-bg)',
                    border: '1px solid var(--input-border, rgba(255,255,255,0.08))',
                    color: 'var(--text-primary)',
                  }}
                >
                  {text || (mode === 'individual' ? 'Pick a player to render.' : '')}
                </pre>
              </div>

              {actionError && (
                <p role="alert" style={{ fontSize: 12, color: 'var(--color-red, #ef4444)', margin: 0 }}>
                  {actionError}
                </p>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={copyText}
                  disabled={!text}
                  className="cc-btn cc-btn-secondary"
                >
                  {copied ? 'Copied ✓' : 'Copy text'}
                </button>
                {mode === 'group' && (
                  <button
                    type="button"
                    onClick={shareImage}
                    disabled={!imageDataUrl}
                    className="btn-primary"
                    style={{ minWidth: 140 }}
                  >
                    Share image
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
