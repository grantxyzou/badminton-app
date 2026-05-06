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
  /** All data needed to render the receipt. */
  input: ReceiptInput | null;
  /** Initial mode. Group is the primary use case. */
  initialMode?: 'group' | 'individual';
  /** Pre-selected player when opening in individual mode. */
  initialPlayerName?: string;
}

export default function ReceiptSheet({ open, onClose, input, initialMode = 'group', initialPlayerName }: ReceiptSheetProps) {
  const [mode, setMode] = useState<'group' | 'individual'>(initialMode);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(initialPlayerName ?? null);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string>('');

  // Reset state when sheet opens or input changes.
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setSelectedPlayer(initialPlayerName ?? null);
      setCopied(false);
    }
  }, [open, initialMode, initialPlayerName]);

  const text = useMemo(() => {
    if (!input) return '';
    if (mode === 'group') {
      return renderGroupText(input);
    }
    if (!selectedPlayer) return '';
    return renderIndividualText({ ...input, playerName: selectedPlayer });
  }, [input, mode, selectedPlayer]);

  // Render canvas (group only — individual stays text-only for v1).
  useEffect(() => {
    if (!open || !input || mode !== 'group') return;
    let cancelled = false;
    (async () => {
      try {
        await (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
      } catch {
        // continue without font wait
      }
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const url = renderGroupCanvas(input, canvas);
      setImageDataUrl(url);
    })();
    return () => { cancelled = true; };
  }, [open, input, mode]);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — fall back to manual select
    }
  }

  async function shareImage() {
    if (!imageDataUrl) return;
    // Try Web Share API with files first.
    try {
      const blob = await (await fetch(imageDataUrl)).blob();
      const file = new File([blob], `bpm-receipt.png`, { type: 'image/png' });
      const navAny = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean; share?: (data: { files: File[] }) => Promise<void> };
      if (navAny.canShare?.({ files: [file] }) && navAny.share) {
        await navAny.share({ files: [file] });
        return;
      }
    } catch {
      // fall through to download
    }
    // Fallback: download.
    const a = document.createElement('a');
    a.href = imageDataUrl;
    a.download = 'bpm-receipt.png';
    a.click();
  }

  if (!input) {
    return null;
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Receipt" maxHeight="90vh">
      <BottomSheetHeader>
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="bpm-h3">Receipt</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-200" aria-label="Close">
            <span className="material-icons">close</span>
          </button>
        </div>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div className="space-y-4 pb-6">
          {/* Mode toggle */}
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

          {/* Individual: pick a player */}
          {mode === 'individual' && (
            <div className="space-y-2">
              <label className="text-xs text-gray-400">Recipient</label>
              <select
                value={selectedPlayer ?? ''}
                onChange={(e) => setSelectedPlayer(e.target.value || null)}
                className="w-full text-sm rounded-lg p-2"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' }}
              >
                <option value="">Choose a player…</option>
                {input.playerNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Image preview (group only) */}
          {mode === 'group' && (
            <div className="rounded-lg overflow-hidden flex justify-center" style={{ background: 'rgba(255,255,255,0.02)' }}>
              <canvas ref={canvasRef} aria-label="Receipt image preview" />
            </div>
          )}

          {/* Text */}
          <div className="space-y-2">
            <label className="text-xs text-gray-400">Text version</label>
            <pre
              className="text-xs leading-relaxed whitespace-pre-wrap rounded-lg p-3 font-mono"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              {text || (mode === 'individual' ? 'Pick a player to render.' : '')}
            </pre>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyText}
              disabled={!text}
              className="text-sm px-4 py-2 rounded-full disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              {copied ? 'Copied ✓' : 'Copy text'}
            </button>
            {mode === 'group' && (
              <button
                type="button"
                onClick={shareImage}
                disabled={!imageDataUrl}
                className="text-sm px-4 py-2 rounded-full disabled:opacity-50"
                style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#86efac' }}
              >
                Share image
              </button>
            )}
          </div>
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
