import { describe, it, expect } from 'vitest';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh-CN.json';

function leafPaths(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix];
  const entries = Object.entries(obj as Record<string, unknown>);
  return entries.flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
}

describe('locale parity — en.json and zh-CN.json have identical key shape', () => {
  const enPaths = leafPaths(enMessages).sort();
  const zhPaths = leafPaths(zhMessages).sort();

  it('no key exists in en.json that is missing from zh-CN.json', () => {
    const missingInZh = enPaths.filter((p) => !zhPaths.includes(p));
    expect(missingInZh).toEqual([]);
  });

  it('no key exists in zh-CN.json that is missing from en.json', () => {
    const extraInZh = zhPaths.filter((p) => !enPaths.includes(p));
    expect(extraInZh).toEqual([]);
  });

  it('leaf counts match', () => {
    expect(enPaths.length).toBe(zhPaths.length);
  });
});
