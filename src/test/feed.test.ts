import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { put } from '../db/repo';
import { TABLES, type AnyRow } from '../db/schema';
import { DISCOVERY_SOURCES, fetchFeedPage } from '../providers/discovery';

/**
 * The Discover feed promises "scroll as far as you like". That has two halves
 * these tests pin down: it never invents content, and it never stops — once
 * every card has been served it re-serves them, labelled, in an order driven
 * by the interaction log. Every page is filled to the page size (12) so the
 * scroll sentinel always has something new to show, even for a 3-card library.
 */

const PAGE = 12;
const backing = (item: AnyRow) => String(item.id).replace(/#lap\d+$/, '');
const lapOf = (item: AnyRow) => Number((item.data as Record<string, unknown>)?.lap ?? 0);

async function seedCards(n: number, providerId = 'glow-lab-library') {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const row = await put(TABLES.discoveryItems, {
      slug: `${providerId}-${i}`,
      providerId,
      title: `Card ${i}`,
      description: '',
      categories: ['test'],
      aesthetic: '',
      palette: [],
      elements: [],
      seed: 1
    });
    ids.push(String(row.id));
  }
  return ids;
}

beforeEach(async () => {
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
  localStorage.clear();
});

describe('endless feed', () => {
  it('serves the whole library before it repeats a single card', async () => {
    const ids = await seedCards(PAGE);
    const p1 = await fetchFeedPage({ page: 1 });
    expect(p1.items).toHaveLength(PAGE);
    expect(p1.lap).toBe(0);
    expect(p1.items.filter((i) => /#lap/.test(String(i.id)))).toEqual([]);
    expect(p1.items.map(backing).sort()).toEqual([...ids].sort());
  });

  it('fills every page so the scroll never dead-ends, however small the library', async () => {
    await seedCards(3);
    const p1 = await fetchFeedPage({ page: 1 });
    expect(p1.items).toHaveLength(PAGE);
    expect(new Set(p1.items.map(backing)).size).toBe(3);
    // the first three tiles are the untouched library; the rest are labelled repeats
    expect(p1.items.slice(0, 3).map(lapOf)).toEqual([0, 0, 0]);
    expect(p1.items.slice(3).every((i) => lapOf(i) > 0)).toBe(true);
    expect(p1.hasMore).toBe(true);
  });

  it('keeps going page after page and marks the pass on each tile', async () => {
    await seedCards(PAGE);
    for (const [page, pass] of [[2, 1], [3, 2], [12, 11]] as const) {
      const res = await fetchFeedPage({ page });
      expect(res.items).toHaveLength(PAGE);
      expect(res.hasMore).toBe(true);
      expect(res.lap).toBe(pass);
      expect(res.items.every((i) => String(i.id).endsWith(`#lap${pass}`))).toBe(true);
      expect(res.items.every((i) => (i.data as Record<string, unknown>).resurface === true)).toBe(true);
      expect(res.providerStatus.some((s) => s.id === 'resurface' && s.state === 'ok')).toBe(true);
    }
  });

  it('re-served tiles still point at the real row and leave it untouched', async () => {
    const ids = await seedCards(PAGE);
    const page = await fetchFeedPage({ page: 2 });
    for (const item of page.items) expect(ids).toContain(backing(item));
    const stored = await db.table(TABLES.discoveryItems).bulkGet(ids);
    expect(stored.every((r) => r && !((r?.data ?? {}) as Record<string, unknown>).resurface)).toBe(true);
  });

  it('does not start consecutive passes on the same card', async () => {
    await seedCards(PAGE);
    const a = await fetchFeedPage({ page: 2 });
    const b = await fetchFeedPage({ page: 3 });
    expect(backing(a.items[0])).not.toBe(backing(b.items[0]));
  });

  it('orders second looks by the caller’s interaction score', async () => {
    const ids = await seedCards(PAGE);
    const score = (i: AnyRow) => (backing(i) === ids[0] ? 10 : 0);
    const p2 = await fetchFeedPage({ page: 2, resurfaceScore: score });
    const at2 = p2.items.map(backing).indexOf(ids[0]);
    expect(at2).toBeGreaterThan(0);
    const p3 = await fetchFeedPage({ page: 3, resurfaceScore: score });
    const at3 = p3.items.map(backing).indexOf(ids[0]);
    expect(at3).toBeGreaterThanOrEqual(0);
    expect(at3).not.toBe(at2);
  });

  it('takes hidden cards out of the rotation entirely', async () => {
    const ids = await seedCards(6);
    const hidden = new Set([ids[1], ids[4]]);
    const seen = new Set<string>();
    for (const page of [1, 2, 3, 4, 5]) {
      const res = await fetchFeedPage({ page, exclude: hidden });
      expect(res.items).toHaveLength(PAGE);
      res.items.forEach((i) => seen.add(backing(i)));
    }
    expect([...seen].sort()).toEqual([ids[0], ids[2], ids[3], ids[5]].sort());
  });

  it('says it is empty when there is genuinely nothing to serve', async () => {
    const res = await fetchFeedPage({ page: 1 });
    expect(res.items).toEqual([]);
    expect(res.hasMore).toBe(false);
    expect(res.lap).toBe(0);
  });
});

describe('sources', () => {
  it('shows Pinterest saves that came from the user’s own import', async () => {
    // Regression: rows tagged providerId 'pinterest' had no source entry, so
    // the source filter dropped them and imported pins never reached the feed.
    await seedCards(2, 'pinterest');
    expect(DISCOVERY_SOURCES.some((s) => s.id === 'pinterest')).toBe(true);
    const res = await fetchFeedPage({ page: 1 });
    expect(new Set(res.items.map(backing)).size).toBe(2);
    expect(res.items.every((i) => i.providerId === 'pinterest')).toBe(true);
  });

  it('can be narrowed to one source', async () => {
    await seedCards(2, 'glow-lab-library');
    await seedCards(3, 'pinterest');
    const res = await fetchFeedPage({ page: 1, sources: ['glow-lab-library'] });
    expect(new Set(res.items.map(backing)).size).toBe(2);
    expect(res.items.every((i) => i.providerId === 'glow-lab-library')).toBe(true);
  });
});
