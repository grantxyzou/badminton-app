// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import PageHeader, { titleFit, TITLE_FIT_STEPS } from '../../components/primitives/PageHeader';
import { GROUP_NAME_MAX } from '../../lib/groupRoutes';

afterEach(cleanup);

/**
 * A long club name steps DOWN rather than being cut off (Grant, 2026-11-04).
 * Every step must stay above the condensed 18px, so scrolling still shrinks
 * the title and never grows it (the defect the old `compact` prop had).
 */
describe('titleFit', () => {
  it('keeps the full size for a short name and steps down twice', () => {
    expect(titleFit('BPM Core')).toBe('');
    expect(titleFit(undefined)).toBe('');
    expect(titleFit('Six Feathers Saturday')).toBe('is-long');
    expect(titleFit('Richmond Thursday Night Badminton Club')).toBe('is-longer');
  });

  it('steps at the documented counts, and the longest name the server allows takes the last step', () => {
    expect(titleFit('x'.repeat(TITLE_FIT_STEPS.long - 1))).toBe('');
    expect(titleFit('x'.repeat(TITLE_FIT_STEPS.long))).toBe('is-long');
    expect(titleFit('x'.repeat(TITLE_FIT_STEPS.longer))).toBe('is-longer');
    expect(titleFit('x'.repeat(GROUP_NAME_MAX))).toBe('is-longer');
  });

  it('puts the step on the title only when asked to fit', () => {
    const { container } = render(<PageHeader fitText="Richmond Thursday Night Badminton Club">x</PageHeader>);
    expect(container.querySelector('h1')!.className).toContain('is-longer');
    cleanup();
    const { container: c2 } = render(<PageHeader>Richmond Thursday Night Badminton Club</PageHeader>);
    expect(c2.querySelector('h1')!.className).not.toContain('is-long');
  });
});
