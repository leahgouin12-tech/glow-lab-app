import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { findAll, put } from '../db/repo';
import { TABLES } from '../db/schema';
import { REFERENCE_SETS } from '../content/referenceLibrary';
import { clearSeedContent, runSeeding } from '../db/seed';

beforeEach(async () => {
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
  localStorage.clear();
});

describe('seeding', () => {
  it('puts every commissioned reference in the library exactly once', async () => {
    await runSeeding();
    const sets = await findAll(TABLES.discoveryItems);
    const media = (await findAll(TABLES.mediaItems)).filter((m) => String(m.hash ?? '').startsWith('seed-'));
    expect(sets).toHaveLength(REFERENCE_SETS.length);
    expect(media).toHaveLength(REFERENCE_SETS.length);
    expect(new Set(sets.map((s) => s.slug)).size).toBe(REFERENCE_SETS.length);
  });

  // The boot effect used to fire twice under StrictMode; both passes read an
  // empty table, both inserted, and the Discover feed showed every image twice.
  it('survives two boots racing each other', async () => {
    await Promise.all([runSeeding(), runSeeding()]);
    const sets = await findAll(TABLES.discoveryItems);
    const media = await findAll(TABLES.mediaItems);
    expect(sets).toHaveLength(REFERENCE_SETS.length);
    expect(media).toHaveLength(REFERENCE_SETS.length);
  });

  it('collapses duplicates a previous build already stored', async () => {
    const first = await put(TABLES.mediaItems, {
      kind: 'library',
      album: 'Glow Lab reference sets',
      title: 'Smoke in plum, single gold',
      remoteUrl: `./${REFERENCE_SETS[0].file}`,
      hash: `seed-${REFERENCE_SETS[0].slug}`,
      blobId: null,
      sourceKind: 'glow-lab-original'
    });
    await new Promise((r) => setTimeout(r, 5));
    const second = await put(TABLES.mediaItems, {
      kind: 'library',
      album: 'Glow Lab reference sets',
      title: 'Smoke in plum, single gold',
      remoteUrl: `./${REFERENCE_SETS[0].file}`,
      hash: `seed-${REFERENCE_SETS[0].slug}`,
      blobId: null,
      sourceKind: 'glow-lab-original'
    });
    await put(TABLES.discoveryItems, { slug: REFERENCE_SETS[0].slug, providerId: 'glow-lab-library', title: 'a', seed: 1 });
    await new Promise((r) => setTimeout(r, 5));
    await put(TABLES.discoveryItems, { slug: REFERENCE_SETS[0].slug, providerId: 'glow-lab-library', title: 'b', seed: 1 });

    await runSeeding();

    const aliveMedia = (await findAll(TABLES.mediaItems)).filter((m) => m.remoteUrl === `./${REFERENCE_SETS[0].file}`);
    expect(aliveMedia).toHaveLength(1);
    expect(aliveMedia[0].id).toBe(first.id);
    void second;
    const aliveSets = await findAll(TABLES.discoveryItems, {});
    expect(aliveSets.filter((s) => s.slug === REFERENCE_SETS[0].slug)).toHaveLength(1);
  });

  it('leaves anything the user saved alone while collapsing seed duplicates', async () => {
    await put(TABLES.mediaItems, { kind: 'upload', album: 'My uploads', title: 'my own', remoteUrl: '', blobId: null });
    await runSeeding();
    const mine = (await findAll(TABLES.mediaItems)).find((m) => m.title === 'my own');
    expect(mine).toBeTruthy();
  });

  it('clearSeedContent removes the reference imagery too, not only the rows', async () => {
    await runSeeding();
    const removed = await clearSeedContent();
    expect(removed).toBeGreaterThan(0);
    expect(await findAll(TABLES.mediaItems)).toHaveLength(0);
    expect(await findAll(TABLES.discoveryItems)).toHaveLength(0);
  });
});
