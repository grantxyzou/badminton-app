// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ProfileEyebrow from '../../components/primitives/ProfileEyebrow';

describe('ProfileEyebrow', () => {
  afterEach(() => cleanup());

  it('renders its label as a paragraph, outside any card', () => {
    render(<ProfileEyebrow>Settings</ProfileEyebrow>);
    expect(screen.getByText('Settings').tagName).toBe('P');
  });

  it('names the group it sits above through aria-labelledby', () => {
    render(
      <>
        <ProfileEyebrow id="eyebrow-settings">Settings</ProfileEyebrow>
        <div role="group" aria-labelledby="eyebrow-settings" />
      </>,
    );
    expect(screen.getByRole('group', { name: 'Settings' })).toBeTruthy();
  });

  it('takes its colour from the theme token, with no hardcoded fallback', () => {
    render(<ProfileEyebrow>Settings</ProfileEyebrow>);
    expect(screen.getByText('Settings').style.color).toBe('var(--ink-faint)');
  });
});
