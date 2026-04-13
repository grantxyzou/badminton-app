'use client';

import { useEffect } from 'react';

export default function HydrationMark() {
  useEffect(() => {
    document.documentElement.setAttribute('data-hydrated', 'true');
  }, []);
  return null;
}
