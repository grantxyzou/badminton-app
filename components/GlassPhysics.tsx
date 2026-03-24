'use client';

import { useEffect } from 'react';

export default function GlassPhysics() {
  useEffect(() => {
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
