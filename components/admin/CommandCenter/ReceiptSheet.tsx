'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import {
  renderGroupText,
  renderIndividualText,
  renderGroupCanvas,
  type ReceiptInput,
} from '@/lib/receiptTemplate';
import { markExternalExcursion } from '@/lib/excursion';

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

  // Callback ref: draw the moment the canvas element mounts, rather than in a
  // passive effect. The canvas only mounts once `input` has loaded (group
  // mode), and a passive effect that reads `canvasRef.current` could fire
  // before the ref attached on that render — leaving the preview stuck blank.
  // Drawing from the ref callback is deterministic: it runs WITH the element.
  const drawCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    if (!canvas || !input || mode !== 'group') return;
    // Immediate draw (system-font fallback if web fonts aren't ready yet).
    setImageDataUrl(renderGroupCanvas(input, canvas));
    // Best-effort upgrade: redraw with the design fonts once they're ready.
    const fontsReady = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready
      ?? Promise.resolve();
    fontsReady.then(() => {
      if (canvasRef.current === canvas) setImageDataUrl(renderGroupCanvas(input, canvas));
    }).catch(() => {});
  }, [input, mode]);

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
    const canvas = canvasRef.current;
    if (!canvas || !imageDataUrl) return;
    setActionError(null);
    // Build the Blob straight from the canvas rather than round-tripping
    // through `fetch(dataUrl).then(r => r.blob())`. Fetching a `data:` URI to
    // reconstruct a Blob is a known-flaky pattern in iOS Safari's standalone
    // (home-screen PWA) context — the preview `<img src={dataUrl}>` decodes
    // fine (no fetch involved), but the shared file can come out truncated/
    // corrupted ("can't be displayed"). canvas.toBlob() hands back the bitmap
    // directly with no intermediate base64 string round trip.
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      setActionError('Couldn’t generate the image — try again.');
      return;
    }
    const file = new File([blob], 'bpm-receipt.png', { type: 'image/png' });
    let nativeShareTried = false;
    try {
      const navAny = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean; share?: (data: { files: File[] }) => Promise<void> };
      if (navAny.canShare?.({ files: [file] }) && navAny.share) {
        nativeShareTried = true;
        // iOS may evict the PWA while the share sheet / image preview is open;
        // mark the excursion so returning restores this (Admin) tab, not Home.
        markExternalExcursion();
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bpm-receipt.png';
      markExternalExcursion();
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setActionError('Couldn’t download — try Copy text instead.');
    }
  }

  if (!input && !error) return null;

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Receipt" maxHeight="80vh" className="max-w-sm mx-auto">
      <BottomSheetHeader className="flex items-center justify-between p-4">
        <span className="fs-lg" style={{ fontWeight: 600 }}>Share session cost</span>
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
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
      </BottomSheetHeader>

      <BottomSheetBody className="p-5 pb-8">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && (
            <p
              role="alert"
              style={{
                color: 'var(--color-red)',
                fontSize: 'var(--fs-base)',
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              {error}
            </p>
          )}

          {input && (
            <>
              {/* Mode toggle — canonical .segment-control needs `flex` on the
                  wrapper and `flex-1` centered children, else the active pill
                  overlaps its neighbor (the class sets no display of its own). */}
              <div className="segment-control flex" role="tablist" aria-label="Receipt mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'group'}
                  className={`flex-1 flex items-center justify-center fs-sm ${mode === 'group' ? 'segment-tab-active' : 'segment-tab-inactive'}`}
                  onClick={() => setMode('group')}
                >
                  Group
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'individual'}
                  className={`flex-1 flex items-center justify-center fs-sm ${mode === 'individual' ? 'segment-tab-active' : 'segment-tab-inactive'}`}
                  onClick={() => setMode('individual')}
                  disabled={input.playerNames.length === 0}
                >
                  Individual
                </button>
              </div>

              {mode === 'individual' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label className="section-label" style={{ color: 'var(--text-muted)' }}>Recipient</label>
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
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  {/* Offscreen generator — drawn to, then exported as a PNG.
                      Displaying the exported <img> (rather than the live
                      <canvas>) keeps sizing stable across re-renders and never
                      leaves a blank void if the canvas paint races a render. */}
                  <canvas ref={drawCanvas} aria-hidden="true" style={{ display: 'none' }} />
                  {imageDataUrl ? (
                    <img
                      src={imageDataUrl}
                      alt="Receipt preview"
                      style={{
                        width: '100%',
                        maxWidth: 300,
                        height: 'auto',
                        borderRadius: 'var(--radius-lg)',
                        display: 'block',
                      }}
                    />
                  ) : (
                    <div
                      role="status"
                      aria-label="Rendering preview"
                      style={{
                        width: '100%',
                        maxWidth: 300,
                        aspectRatio: '390 / 520',
                        borderRadius: 'var(--radius-lg)',
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border, rgba(255,255,255,0.08))',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-muted)',
                        fontSize: 'var(--fs-sm)',
                      }}
                    >
                      Rendering preview…
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label className="section-label" style={{ color: 'var(--text-muted)' }}>Text version</label>
                <pre
                  style={{
                    fontFamily: 'var(--font-mono), ui-monospace, monospace',
                    fontSize: 'var(--fs-sm)',
                    lineHeight: 1.55,
                    whiteSpace: 'pre-wrap',
                    margin: 0,
                    padding: 12,
                    borderRadius: 'var(--radius-lg)',
                    background: 'var(--input-bg)',
                    border: '1px solid var(--input-border, rgba(255,255,255,0.08))',
                    color: 'var(--text-primary)',
                  }}
                >
                  {text || (mode === 'individual' ? 'Pick a player to render.' : '')}
                </pre>
              </div>

              {actionError && (
                <p role="alert" style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-red)', margin: 0 }}>
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
                    className="cc-btn cc-btn-primary"
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
