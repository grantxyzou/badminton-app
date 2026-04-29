import type { ReactNode } from 'react';

/**
 * Status banner — icon + title + body trio with a tone-tinted background.
 * Wraps the canonical `.status-banner-{green|orange|red}` classes from
 * `app/globals.css:1028+`, with the title color baked into the tone so
 * call sites don't have to thread `text-green-400` etc. inline.
 *
 * Replaces the previously duplicated JSX shape that appeared 6 times in
 * HomeTab alone:
 *
 *   <div className="status-banner-orange">
 *     <span className="material-icons icon-status text-amber-400">{icon}</span>
 *     <div>
 *       <p className="font-semibold text-amber-300 text-sm">{title}</p>
 *       <p className="text-xs text-gray-400 mt-0.5">{body}</p>
 *     </div>
 *   </div>
 *
 * Becomes:
 *
 *   <StatusBanner tone="warn" icon="watch_later" title={title} body={body} />
 *
 * If you need a new tone, add it to the union here — DO NOT override
 * styles inline at the call site.
 */
export type StatusTone = 'success' | 'warn' | 'danger';

export interface StatusBannerProps {
  tone: StatusTone;
  /** Material Symbols glyph name (e.g. `'celebration'`, `'lock_clock'`). */
  icon: string;
  title: ReactNode;
  body?: ReactNode;
}

const TONE_CLASS: Record<StatusTone, string> = {
  success: 'status-banner-green',
  warn: 'status-banner-orange',
  danger: 'status-banner-red',
};

const ICON_TONE_CLASS: Record<StatusTone, string> = {
  success: 'text-green-400',
  warn: 'text-amber-400',
  danger: 'text-red-400',
};

const TITLE_TONE_CLASS: Record<StatusTone, string> = {
  success: 'text-green-400',
  warn: 'text-amber-300',
  danger: 'text-red-400',
};

export default function StatusBanner({ tone, icon, title, body }: StatusBannerProps) {
  return (
    <div className={TONE_CLASS[tone]}>
      <span className={`material-icons icon-status ${ICON_TONE_CLASS[tone]}`} aria-hidden="true">
        {icon}
      </span>
      <div>
        <p className={`font-semibold text-sm ${TITLE_TONE_CLASS[tone]}`}>{title}</p>
        {body && <p className="text-xs text-gray-400 mt-0.5">{body}</p>}
      </div>
    </div>
  );
}
