'use client';

import type { ReactNode } from 'react';
import TopBar from '@/components/primitives/TopBar';
import LaunchArt from '@/components/launch/LaunchArt';

export interface AuthStep {
  /** 1-based. */
  n: number;
  total: number;
  /** "Step 1 of 3", already translated. */
  label: string;
}

interface Props {
  /** The top bar's title. */
  title?: ReactNode;
  onBack?: () => void;
  backLabel: string;
  /** A LOGO page (Log in, a club's link): the launch lockup instead of text. */
  logoTagline?: string;
  /** The "Step N of 3" marker. Its line is kept on every text page either way. */
  step?: AuthStep;
  heading?: ReactNode;
  /** Paragraphs under the heading (`.auth-copy` / `.auth-note`). */
  copy?: ReactNode;
  /** What follows the text: a field, the code boxes, a button that belongs to the text. */
  children?: ReactNode;
  /** The buttons at the bottom, highest first; the lowest is the main one. */
  actions?: ReactNode;
  /** The quiet links under the buttons. Their line is kept even when empty. */
  links?: ReactNode;
  /** Tests and the launch screen find a page by this. */
  'data-page'?: string;
}

/**
 * ONE LAYOUT FOR EVERY SIGN-IN PAGE (docs/plans/sign-in-redesign.md; Grant on
 * the canvas, 2026-11-20: "The title should always be on the same height.
 * Same spacing btw texts. CTA button should not jump around too. Apply this
 * rule for all sign-in paths").
 *
 * A slide master with three slots: the text (or the logo) at one height, and
 * the buttons at the bottom with the quiet-links line under them. Each page
 * only fills the slots, so going from one page to the next moves nothing that
 * is in the same place on both. The geometry is `.auth-*` in globals.css.
 */
export default function AuthStage({
  title,
  onBack,
  backLabel,
  logoTagline,
  step,
  heading,
  copy,
  children,
  actions,
  links,
  'data-page': dataPage,
}: Props) {
  return (
    <div className="auth-stage animate-fadeIn" data-auth-page={dataPage}>
      {title !== undefined ? <TopBar title={title} onBack={onBack} backLabel={backLabel} /> : null}
      <div className="auth-body">
        {logoTagline !== undefined ? (
          <div className="auth-logo">
            <LaunchArt tagline={logoTagline} variant="settled" />
          </div>
        ) : (
          <div className="auth-text">
            <div className="auth-copy-block">
              <div className="auth-eyebrow" {...(step ? { role: 'img', 'aria-label': step.label } : { 'aria-hidden': true })}>
                {step && (
                  <>
                    <span className="auth-steps" aria-hidden="true">
                      {Array.from({ length: step.total }, (_, i) => (
                        <span key={i} {...(i < step.n ? { 'data-on': '' } : {})} />
                      ))}
                    </span>
                    <span className="auth-eyebrow-label" aria-hidden="true">
                      {step.label}
                    </span>
                  </>
                )}
              </div>
              {heading !== undefined && <h2 className="auth-heading">{heading}</h2>}
              {copy}
            </div>
            {children}
          </div>
        )}
        <div className="auth-actions">
          {logoTagline !== undefined ? children : null}
          {actions}
          <div className="auth-links">{links}</div>
        </div>
      </div>
    </div>
  );
}
