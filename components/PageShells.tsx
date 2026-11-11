'use client';

import dynamic from 'next/dynamic';

/**
 * The two shells the page can render, each in its own chunk.
 *
 * `app/page.tsx` decides on the server which one a visitor gets — the app, or
 * the signed-out shell — but a server component that imports both lists both
 * as client modules, so every visitor downloaded both: a member's every cold
 * start paid for the sign-up forms, the access request and the provider
 * buttons, and a stranger paid for the whole app shell (audit, 2026-11-05).
 *
 * `dynamic()` with server rendering left ON (the default) keeps the first HTML
 * exactly as it was — the launch screen reads `[data-app-shell]` and
 * `[data-signed-out-welcome]` from that HTML — while the browser loads only the
 * chunk for the shell it was sent. No `loading` fallback: the server already
 * rendered the shell, and hydration waits for its chunk.
 */
export const HomeShell = dynamic(() => import('@/components/HomeShell'));
export const SignedOutShell = dynamic(() => import('@/components/onboarding/SignedOutShell'));
