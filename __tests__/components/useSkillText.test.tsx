// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh-CN.json';
import { useSkillText } from '../../lib/useSkillText';

afterEach(cleanup);

const DRILL = { id: 'net_play-f', skillKey: 'net_play', title: 'Net tumble & spin feeds', description: 'Partner feeds gentle shuttles to the net.', reason: 'For your net play (rated 2/5)', setting: 'pair' as const };

function Probe() {
  const s = useSkillText();
  return (
    <ul>
      <li data-testid="label">{s.label('net_play')}</li>
      <li data-testid="anchor">{s.anchors('net_play')[0]}</li>
      <li data-testid="title">{s.drillTitle(DRILL)}</li>
      <li data-testid="setting">{s.setting('pair')}</li>
      <li data-testid="reason">{s.drillReason({ ...DRILL, rating: 2 })}</li>
      <li data-testid="reason-old">{s.drillReason(DRILL)}</li>
    </ul>
  );
}

function renderIn(locale: string, messages: Record<string, unknown>) {
  render(<NextIntlClientProvider locale={locale} messages={messages}><Probe /></NextIntlClientProvider>);
  return (id: string) => screen.getByTestId(id).textContent;
}

describe('useSkillText', () => {
  it('reads Chinese on the Chinese tab', () => {
    const text = renderIn('zh-CN', zhMessages);
    expect(text('label')).toBe('网前');
    expect(text('anchor')).toBe('我基本躲着网前；放网不是冒高就是挂网。');
    expect(text('title')).toBe('网前搓球练习');
    expect(text('setting')).toBe('双人');
    expect(text('reason')).toBe('针对你的网前（自评 2/5）');
    // A pick from a server that sends no rating keeps its English line.
    expect(text('reason-old')).toBe('For your net play (rated 2/5)');
  });

  it('reads the same English the app always showed', () => {
    const text = renderIn('en', enMessages);
    expect(text('label')).toBe('Net Play');
    expect(text('title')).toBe('Net tumble & spin feeds');
    expect(text('setting')).toBe('pair');
    expect(text('reason')).toBe('For your net play (rated 2/5)');
  });

  it('falls back to the English source, never a key path, when the copy is missing', () => {
    const text = renderIn('zh-CN', {});
    expect(text('label')).toBe('Net Play');
    expect(text('anchor')).toBe('I mostly avoid the net; my net shots pop up or go into the tape.');
    expect(text('title')).toBe('Net tumble & spin feeds');
    expect(text('setting')).toBe('pair');
  });
});
