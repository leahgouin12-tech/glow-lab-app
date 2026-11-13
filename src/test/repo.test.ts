import { beforeEach, describe, expect, it } from 'vitest';
import { TABLES } from '../db/schema';
import { blankRow, findAll, formatDate, hardDelete, patch, put, restore, softDelete, todayISO, addDays, tokenMatch } from '../db/repo';
import { db } from '../db/db';

beforeEach(async () => {
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
});

describe('repository envelope', () => {
  it('stamps id, revision and denormalised search text on first write', async () => {
    const row = await put(TABLES.goals, { title: 'Fix patchy brows', domain: 'grooming', status: 'active', priority: 1 });
    expect(row.id).toBeTruthy();
    expect(row.rev).toBe(1);
    expect(row.createdAt).toBeGreaterThan(0);
    expect(row.deletedAt).toBeNull();
    expect(row.deviceId).toBeTruthy();
    expect(String(row.text)).toContain('patchy brows');
  });

  it('bumps the revision and preserves the id on update', async () => {
    const first = await put(TABLES.goals, { title: 'A', domain: 'skin', status: 'active' });
    const second = await put(TABLES.goals, { ...first, title: 'B' });
    expect(second.id).toBe(first.id);
    expect(second.rev).toBe(2);
    expect(second.createdAt).toBe(first.createdAt);
    expect((await findAll(TABLES.goals)).length).toBe(1);
  });

  it('queues every entity write for sync', async () => {
    await put(TABLES.products, { name: 'Nothing', category: 'x', status: 'own' });
    const q = await findAll(TABLES.syncQueue);
    expect(q.length).toBe(1);
    expect(q[0].op).toBe('put');
    expect(q[0].targetTable).toBe(TABLES.products);
  });

  it('soft deletes by default, restores, and hard deletes for good', async () => {
    const row = await put(TABLES.knowledge, { title: 'Keep', kind: 'note', body: 'b', domain: 'skin', confidence: 3, worked: 'unset' });
    await softDelete(TABLES.knowledge, row.id);
    expect(await findAll(TABLES.knowledge)).toHaveLength(0);
    expect(await findAll(TABLES.knowledge, { includeDeleted: true })).toHaveLength(1);
    await restore(TABLES.knowledge, row.id);
    expect(await findAll(TABLES.knowledge)).toHaveLength(1);
    await hardDelete(TABLES.knowledge, row.id);
    expect(await findAll(TABLES.knowledge, { includeDeleted: true })).toHaveLength(0);
  });

  it('filters by equality and any-of arrays', async () => {
    await put(TABLES.products, { name: 'one', category: 'acid', status: 'own' });
    await put(TABLES.products, { name: 'two', category: 'retinoid', status: 'want' });
    await put(TABLES.products, { name: 'three', category: 'acid', status: 'tried' });
    expect((await findAll(TABLES.products, { where: { status: 'own' } })).map((r) => r.name)).toEqual(['one']);
    expect((await findAll(TABLES.products, { where: { status: ['own', 'tried'] } })).map((r) => r.name).sort()).toEqual(['one', 'three']);
    expect((await findAll(TABLES.products, { some: { strong: (r) => String(r.category) === 'acid' } })).length).toBe(2);
  });

  it('patches without replacing the whole row', async () => {
    const row = await put(TABLES.lists, { kind: 'wishlist', name: 'Summer', budget: 100, period: 'month', items: [], closedOn: null });
    await patch(TABLES.lists, row.id, { budget: 140 });
    const after = (await findAll(TABLES.lists))[0];
    expect(after.budget).toBe(140);
    expect(after.name).toBe('Summer');
    expect(after.rev).toBe(2);
  });

  it('builds a blank row with a fresh envelope', () => {
    const r = blankRow(TABLES.goals);
    expect(r.rev).toBe(1);
    expect(r.tags).toEqual([]);
    expect(r.deletedAt).toBeNull();
  });

  it('dates correctly across months', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(todayISO(new Date('2026-11-12T10:00:00Z'))).toMatch(/^2026-11-12/);
    expect(formatDate(null)).toBeTruthy();
  });

  it('scores text matches above zero only when tokens appear', () => {
    expect(tokenMatch('retinoid nightly routine', 'retinoid')).toBeGreaterThan(0);
    expect(tokenMatch('retinoid nightly routine', 'zzz')).toBe(0);
  });
});
