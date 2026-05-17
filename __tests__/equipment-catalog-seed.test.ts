import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogItem, EquipmentCategory } from '../lib/types';

const VALID_CATEGORIES: EquipmentCategory[] = ['racket', 'string', 'shoe', 'shuttle', 'bag', 'grip'];

const raw = readFileSync(join(__dirname, '..', 'scripts', 'data', 'equipment-catalog.json'), 'utf8');
const parsed = JSON.parse(raw) as { items: CatalogItem[] };

describe('equipment-catalog seed data', () => {
  it('parses as JSON with a non-empty items array', () => {
    expect(Array.isArray(parsed.items)).toBe(true);
    expect(parsed.items.length).toBeGreaterThanOrEqual(15);
  });

  it('every item has a stable, unique, deterministic id', () => {
    const ids = parsed.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('every item has a recognized category', () => {
    for (const item of parsed.items) {
      expect(VALID_CATEGORIES).toContain(item.category);
    }
  });

  it('every item has a well-formed skillRange in [1, 6]', () => {
    for (const item of parsed.items) {
      expect(item.skillRange).toHaveLength(2);
      const [lo, hi] = item.skillRange;
      expect(lo).toBeGreaterThanOrEqual(1);
      expect(hi).toBeLessThanOrEqual(6);
      expect(lo).toBeLessThanOrEqual(hi);
    }
  });

  it('every source has a retailer + url + null/string affiliateTag (Decision D — ship null in Slice-0)', () => {
    for (const item of parsed.items) {
      for (const source of item.sources ?? []) {
        expect(source.retailer.length).toBeGreaterThan(0);
        expect(source.url).toMatch(/^https?:\/\//);
        // affiliateTag must be explicitly null (or omitted) for the Slice-0 launch.
        // Once monetization (Decision D) is decided, this assertion gets relaxed.
        if (source.affiliateTag !== undefined) {
          expect(source.affiliateTag).toBeNull();
        }
      }
    }
  });

  it('Slice-0 only ships rackets — strings/shoes/etc arrive in Track 2 if survives', () => {
    for (const item of parsed.items) {
      expect(item.category).toBe('racket');
    }
  });

  it('rackets are diversified across the three primary brands', () => {
    const brands = new Set(parsed.items.map((i) => i.brand));
    // We're not asserting an exact split — just that no single brand owns the seed.
    expect(brands.size).toBeGreaterThanOrEqual(3);
  });

  it('every item is flagged as seeded so admins can distinguish from manual entries', () => {
    for (const item of parsed.items) {
      expect(item.seeded).toBe(true);
    }
  });

  it('seed entries omit createdAt — the API is the source of truth for that field', () => {
    // The catalog isn't a temporal event log. Seed rows can't honestly know
    // when each model was first manufactured/curated. The type marks createdAt
    // optional and the API stamps it on admin-created rows; seed rows leave
    // it unset. If a future seed entry hardcodes a createdAt, this assertion
    // forces the author to defend that choice explicitly.
    for (const item of parsed.items as Array<CatalogItem & { createdAt?: string }>) {
      expect(item.createdAt).toBeUndefined();
    }
  });
});
