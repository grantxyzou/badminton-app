import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Apple HIG: a hit target of at least 44×44 pt. The app-wide Apple pass
 * (2026-11-12) measured Home and Stats in a browser by probing 21px above and
 * below each control's centre, and found the register switch's 28px tabs, a
 * 16px "Add to calendar", the Balance row's header and Stats' small text
 * actions short of it. Each now takes an invisible 44px overlay (the
 * `.bpm-switch` pattern), so nothing is redrawn. jsdom lays nothing out, so
 * this pins the SOURCE: the selector list, the overlay, and the two call sites
 * that wear `.tap-44`.
 */
const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const SMALL = [
  '.segment-control > button',
  '.state-link--aside',
  '.you-update',
  '.skill-panel-link',
  '.setup-share-btn',
  '.setup-chip-dashed',
  '.setup-next-name',
  '.setup-price-row',
  '.kudos-all-link',
  '.date-picker-trigger',
  '.tap-44',
];

describe('44pt tap targets', () => {
  it('gives every short control a 44px overlay centred on itself', () => {
    const anchor = SMALL.map((s) => `${s}::after`).join(',\n');
    const at = css.indexOf(anchor);
    expect(at).toBeGreaterThan(-1);
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toMatch(/content:\s*'';/);
    expect(rule).toMatch(/position:\s*absolute;/);
    expect(rule).toMatch(/height:\s*44px;/);
    expect(rule).toMatch(/transform:\s*translateY\(-50%\);/);
    // Each is the overlay's containing block.
    expect(css).toContain(`${SMALL.join(',\n')} {\n  position: relative;\n}`);
  });

  it('keeps the register switch\'s tabs as the direct buttons the selector names', () => {
    const sw = read('components', 'primitives', 'RegisterSwitch.tsx');
    expect(sw).toMatch(/className="segment-control flex w-full">\s*\{views\.map\(\(id\) => \(\s*<button/);
  });

  it('puts .tap-44 on the Roster filter chips, with rows far enough apart to keep each tap', () => {
    const roster = read('components', 'admin', 'CommandCenter', 'RosterPage.tsx');
    expect(roster).toContain("? 'tap-44 motion-fade' : 'tap-44'}");
    // 32px chips with 44px taps: at a 6px row gap the second row covered the first.
    expect(roster).toContain("columnGap: 'var(--space-2)', rowGap: 'var(--space-4)', flexWrap: 'wrap'");
  });

  it('gives the round top buttons a tap that measures 44 across', () => {
    // A circle's edge pixels take no pointer: -4px (44 drawn) hit-tested at 42.
    expect(css).toMatch(/\.theme-toggle::before,\s*\.lang-toggle::before,\s*\.notif-toggle::before\s*\{[^}]*inset:\s*-5px;/);
  });

  it('never clips the date field, whose tap area reaches past it', () => {
    const picker = read('components', 'DatePicker.tsx');
    const trigger = picker.slice(picker.indexOf('className="date-picker-trigger"'), picker.indexOf('calendar_today'));
    expect(trigger).not.toMatch(/overflow:\s*'hidden',\s*whiteSpace/);
  });

  it('puts .tap-44 on the Balance row and the location link, with the clamp on the text', () => {
    expect(read('components', 'UnpaidSessionsCard.tsx')).toMatch(/aria-expanded=\{open\}\s*className="tap-44"/);
    const home = read('components', 'HomeTab.tsx');
    expect(home).toContain('decoration-dotted block tap-44"');
    // A clamp clips its box, so it never sits on the link that carries the overlay.
    expect(home).toContain('<span className="line-clamp-2">{session.locationAddress}</span>');
  });

  it('gives a 32px round control a 44pt square (.tap-44-box), used by the check-in sheet\'s close', () => {
    expect(css).toMatch(/\.tap-44-box::before\s*\{[^}]*inset:\s*calc\(-1 \* \(var\(--space-2\) \+ var\(--space-hair\)\)\);/);
    expect(read('components', 'stats', 'CheckInSheet.tsx')).toContain('className="flex items-center justify-center rounded-full tap-44-box"');
  });

  it('keeps "What\'s new" readable and closable: AA prompt grey, a 44pt close inside the bar', () => {
    expect(css).toMatch(/--terminal-titlebar-bg:\s*#1e2128;[\s\S]{0,200}--terminal-prompt:\s*#9ca3af;/);
    expect(css).toMatch(/--terminal-titlebar-bg:\s*#e5e7eb;[\s\S]{0,200}--terminal-prompt:\s*#4b5563;/);
    expect(css).toMatch(/\.terminal-close\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/);
    expect(read('components', 'ReleaseNotesSheet.tsx')).toContain('className="terminal-prompt terminal-close transition-colors"');
  });

  it('labels the Skip dates field and gives Sign-in readiness names a 44pt tap', () => {
    expect(read('components', 'admin', 'CommandCenter', 'SkipDatesEditor.tsx')).toContain('aria-label="Date to skip"');
    const card = read('components', 'admin', 'CommandCenter', 'SignInReadinessCard.tsx');
    expect(card).toContain('className="fs-sm tap-44"');
    expect(card).toContain("columnGap: 'var(--space-2)', rowGap: 'var(--space-4)'");
  });
});
