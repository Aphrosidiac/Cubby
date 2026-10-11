import { describe, expect, it } from 'vitest';
import type { BrandRow } from '@shared/types';
import { fuzzyScore, rankBrands } from './fuzzy';
import { cleanHandle } from '../brands/draft';

const brand = (name: string, serial: number, handles: string[] = [], tags: string[] = []) =>
  ({ id: name, name, serial, tags, groupName: null, accounts: handles.map((h, i) => ({ id: `${name}${i}`, platform: 'instagram', handle: h, loginState: 'ok', ageTier: 'new', cookieExpiresAt: null })) }) as unknown as BrandRow;

describe('fuzzyScore', () => {
  it('ranks prefix over word start over substring over letters in order', () => {
    const p = fuzzyScore('asc', 'Ascend'), w = fuzzyScore('res', 'Ascend Resources'), s = fuzzyScore('cen', 'Ascend'), l = fuzzyScore('asd', 'Ascend');
    expect(p).toBeGreaterThan(w);
    expect(w).toBeGreaterThan(s);
    expect(s).toBeGreaterThan(l);
    expect(l).toBeGreaterThan(0);
    expect(fuzzyScore('xyz', 'Ascend')).toBe(0);
  });
});

describe('rankBrands', () => {
  const list = [brand('FF Dev Studio', 1, ['ffdev.studio'], ['agency']), brand('Ascend Resources', 2, ['ascend.my']), brand('Kopi Lab', 3, ['kopilab'], ['f&b'])];
  it('finds by name, handle, tag and serial', () => {
    expect(rankBrands(list, 'asc')[0].name).toBe('Ascend Resources');
    expect(rankBrands(list, 'kopilab')[0].name).toBe('Kopi Lab');
    expect(rankBrands(list, 'agency')[0].name).toBe('FF Dev Studio');
    expect(rankBrands(list, '#003')[0].name).toBe('Kopi Lab');
  });
  it('returns everything for an empty query', () => expect(rankBrands(list, ' ')).toHaveLength(3));
});

describe('cleanHandle', () => {
  it('strips @ and profile URLs', () => {
    expect(cleanHandle('instagram', '@ffdev.studio')).toBe('ffdev.studio');
    expect(cleanHandle('instagram', 'https://www.instagram.com/ffdev.studio/')).toBe('ffdev.studio');
    expect(cleanHandle('tiktok', 'https://www.tiktok.com/@ascend.my')).toBe('ascend.my');
    expect(cleanHandle('linkedin', 'company/ffdev')).toBe('company/ffdev');
    expect(cleanHandle('custom', 'https://example.com/login')).toBe('https://example.com/login');
  });
});
