import { useEffect } from 'react';
import { useTabActive } from '@/lib/tabActivity';

/**
 * A stand-in for one of HomeShell's tabs that records how often it MOUNTS and
 * shows whether it believes it is on screen. Used by the keep-alive tests,
 * which are about the shell's decisions, not about what the real tabs fetch.
 */
export function tabStub(name: string, mounts: Record<string, number>) {
  return {
    default: function TabStub() {
      const active = useTabActive();
      useEffect(() => {
        mounts[name] = (mounts[name] ?? 0) + 1;
      }, []);
      return <div data-testid={`${name}-tab`} data-active={String(active)} />;
    },
  };
}
