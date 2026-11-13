import { beforeEach, describe, expect, it } from 'vitest';
import { TABLES } from '../db/schema';
import { findAll, put, softDelete } from '../db/repo';
import { db } from '../db/db';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  buildBackup,
  eraseEverything,
  exportJson,
  flushSyncQueue,
  restoreFromZip,
  storageFootprint
} from '../db/backup';
import { updateSettings } from '../state/settings';

beforeEach(async () => {
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
});

async function seedUserRows() {
  await put(TABLES.goals, { id: 'g-1', title: 'Even out tone', domain: 'skin', status: 'active', priority: 1 });
  await put(TABLES.products, { id: 'p-1', name: 'Azelaic acid', category: 'acid', status: 'own' });
  const doomed = await put(TABLES.knowledge, { id: 'k-1', title: 'Old note', kind: 'note', body: 'b', domain: 'skin', confidence: 2, worked: 'unset' });
  await softDelete(TABLES.knowledge, doomed.id);
}

async function zipFile(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return new File([bytes], 'glow-lab-backup.zip', { type: 'application/zip' });
}

describe('backup and restore', () => {
  it('round-trips real rows, including soft-deleted ones, through a ZIP', async () => {
    await seedUserRows();
    const pack = await buildBackup({ includeMedia: false, includePrivateMedia: false });
    expect(pack.manifest.format).toBe(BACKUP_FORMAT);
    expect(pack.manifest.version).toBe(BACKUP_VERSION);
    expect(pack.manifest.counts[TABLES.goals]).toBe(1);
    expect(pack.filename.endsWith('.zip')).toBe(true);

    await eraseEverything(false);
    expect(await findAll(TABLES.goals)).toHaveLength(0);

    const report = await restoreFromZip(await zipFile(pack.blob), 'replace');
    expect(report.ok).toBe(true);
    expect((await findAll(TABLES.goals))[0].title).toBe('Even out tone');
    expect(await findAll(TABLES.knowledge)).toHaveLength(0);
    expect(await findAll(TABLES.knowledge, { includeDeleted: true })).toHaveLength(1);
  });

  it('merge keeps work created after the export instead of silently overwriting it', async () => {
    await seedUserRows();
    const pack = await buildBackup({ includeMedia: false });
    await put(TABLES.purchases, { id: 'bu-1', productId: 'p-1', price: 12, currency: 'USD', boughtOn: '2026-11-01' });
    const report = await restoreFromZip(await zipFile(pack.blob), 'merge');
    expect(report.ok).toBe(true);
    expect(await findAll(TABLES.purchases)).toHaveLength(1);
    expect(await findAll(TABLES.goals)).toHaveLength(1);
    expect(await findAll(TABLES.products)).toHaveLength(1);
  });

  it('rejects a file that is not a Glow Lab backup rather than wiping data', async () => {
    const before = await seedUserRows().then(() => findAll(TABLES.goals));
    const report = await restoreFromZip(new File(['definitely not a zip'], 'notes.txt'), 'replace');
    expect(report.ok).toBe(false);
    expect(report.detail).toMatch(/zip|manifest/i);
    expect(await findAll(TABLES.goals)).toHaveLength(before.length);
  });

  it('exports plain JSON the user can actually read', async () => {
    await seedUserRows();
    const parsed = JSON.parse(await exportJson()) as Record<string, unknown>;
    expect(Array.isArray(parsed.goals)).toBe(true);
    expect((parsed.goals as any[])[0].title).toBe('Even out tone');
    expect(parsed.device).toBeTruthy();
  });

  it('queues every write and refuses to sync when sync is off', async () => {
    await seedUserRows();
    const queue = await findAll(TABLES.syncQueue);
    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every((q) => typeof q.targetTable === 'string')).toBe(true);

    await updateSettings({ syncEnabled: false, syncEndpoint: '' });
    const off = await flushSyncQueue();
    expect(off.ok).toBe(false);
    expect(off.detail).toMatch(/sync is off/i);
    // the queue is reported honestly rather than shown as empty
    expect(off.pending).toBe((await findAll(TABLES.syncQueue)).length);
    expect(off.pending).toBeGreaterThanOrEqual(queue.length);

    await updateSettings({ syncEnabled: true, syncEndpoint: '' });
    const noEndpoint = await flushSyncQueue();
    expect(noEndpoint.ok).toBe(false);
    expect(noEndpoint.detail).toMatch(/endpoint/i);
  });

  it('reports a footprint that counts rows, media and pending conflicts', async () => {
    await seedUserRows();
    await put(TABLES.conflicts, { id: 'c-1', targetTable: TABLES.goals, targetId: 'g-1', resolution: 'pending', localRev: 2, remoteRev: 3, payload: '{}' });
    const print = await storageFootprint();
    expect(print.rows).toBeGreaterThanOrEqual(3);
    expect(print.conflicts).toBe(1);
    expect(print.queued).toBeGreaterThan(0);
    expect(print.mediaFiles).toBe(0);
    expect(print.perTable.find((t) => t.table === TABLES.goals)?.count).toBe(1);
  });

  it('erase really removes user records and clears the queue', async () => {
    await seedUserRows();
    await eraseEverything(false);
    const print = await storageFootprint();
    expect(print.rows).toBe(0);
    expect(print.queued).toBe(0);
  });
});
