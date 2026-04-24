'use client';

import { useEffect } from 'react';

export default function GlassPhysics() {
  useEffect(() => {
    // Touch-only devices never produce meaningful mousemove — the radial
    // hover effect is invisible on phones/tablets but the listener still
    // fires on trackpad-backed iPads. Skip entirely to stop needless RAF
    // + DOM writes (see perf audit: rank 3 heating hot path).
    if (typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches) {
      return;
    }

    const root = document.documentElement;
    let raf: number;

    function onMove(e: MouseEvent) {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        root.style.setProperty('--mx', (e.clientX / window.innerWidth).toFixed(3));
        root.style.setProperty('--my', (e.clientY / window.innerHeight).toFixed(3));
      });
    }

    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
