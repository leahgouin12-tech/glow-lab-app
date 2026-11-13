import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { db } from '../db/db';
import { findAll, put, softDelete } from '../db/repo';
import { TABLES } from '../db/schema';
import { updateSettings, loadSettings } from '../state/settings';
import { fetchFeedPage } from '../providers/discovery';
import { syncPinterestArchive } from '../providers/pinterestSync';
import { importExportZip, importImageFiles, importPinLinks, parseCsv, pinFromCsvRow } from '../providers/pinterestImport';

/**
 * The Pinterest route is deliberately an importer, not a client: Pinterest
 * sends no CORS header from this app's origin, so a live feed would need a
 * server holding the user's token. These tests prove the import path works on
 * the data archive alone, that re-importing is harmless, and that nothing ever
 * reaches out to the network.
 */

class FakeImage {
  naturalWidth = 900;
  naturalHeight = 1200;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    setTimeout(() => this.onload?.(), 0);
  }
}

const ctx2d = {
  drawImage: () => {},
  save: () => {},
  restore: () => {},
  translate: () => {},
  rotate: () => {},
  scale: () => {},
  setTransform: () => {},
  getImageData: (_x: number, _y: number, w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    data.fill(255);
    return { data, width: w, height: h };
  }
};

beforeEach(async () => {
  vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
  HTMLCanvasElement.prototype.getContext = (() => ctx2d) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toBlob = ((cb: (b: Blob | null) => void, type?: string) =>
    cb(new Blob([new Uint8Array(64)], { type: type ?? 'image/webp' }))
  ) as unknown as typeof HTMLCanvasElement.prototype.toBlob;
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
  localStorage.clear();
  await updateSettings({ allowUploads: true });
});

/** Nothing may contact Pinterest — or anyone — during an import. */
function forbidNetwork() {
  const spy = vi.fn(() => Promise.reject(new Error('network used during import')));
  vi.stubGlobal('fetch', spy);
  return spy;
}

const pngBytes = (seed: number) => new Blob([new Uint8Array(Array.from({ length: 24 }, (_, i) => (i + seed) % 251))], { type: 'image/png' });

function csvOf(rows: string[][]) {
  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

async function zipOf(files: Record<string, Blob | string>) {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body as never);
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'pinterest-export.zip', { type: 'application/zip' });
}

describe('export csv parsing', () => {
  it('reads quoted fields with commas, newlines and doubled quotes', () => {
    const text =
      '﻿id,pin_url,description\r\n' +
      '"1234567890123","https://pin.it/abc","slow, sweet\r\nblush"\r\n' +
      '"9876543210987","https://pinterest.com/pin/42/","he said ""no"""\r\n';
    const rows = parseCsv(text);
    expect(rows).toHaveLength(2);
    expect(rows[0].description).toBe('slow, sweet\r\nblush');
    expect(rows[1].description).toBe('he said "no"');
  });

  it('finds a pin whatever Pinterest called the columns', () => {
    const a = pinFromCsvRow({ 'Pin URL': 'https://www.pinterest.com/pin/1234567890123/', Name: 'ear stack' });
    expect(a?.id).toBe('1234567890123');
    expect(a?.title).toBe('ear stack');
    const b = pinFromCsvRow({ id: '424242424242', title: 'fine line moth', board: 'Tattoos' });
    expect(b?.id).toBe('424242424242');
    expect(b?.board).toBe('Tattoos');
    expect(pinFromCsvRow({ note: 'no pin fields at all' })).toBeNull();
  });
});

describe('archive import', () => {
  it('turns rows with pictures into feed cards and rows without into links', async () => {
    const net = forbidNetwork();
    const zip = await zipOf({
      'pins.csv': csvOf([
        ['id', 'pin_url', 'title', 'description', 'board'],
        ['1111111111111', 'https://www.pinterest.com/pin/1111111111111/', 'fine line forearm moon', 'thin needles', 'Tattoos'],
        ['2222222222222', 'https://www.pinterest.com/pin/2222222222222/', 'gold ear stack', 'three hoops', 'Piercings'],
        ['3333333333333', 'https://www.pinterest.com/pin/3333333333333/', 'wine silk corset', 'night', 'Outfits']
      ]),
      'Images/Lightroom/1111111111111.png': pngBytes(1),
      'Images/Lightroom/2222222222222.png': pngBytes(2)
    });

    const summary = await importExportZip(zip);
    expect(net).not.toHaveBeenCalled();
    expect(summary.pinsFound).toBe(3);
    expect(summary.imagesFound).toBe(2);
    expect(summary.imported).toBe(2);
    expect(summary.linkOnly).toBe(1);

    const items = await findAll(TABLES.discoveryItems, { where: { providerId: 'pinterest' } });
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.title).sort()).toEqual(['fine line forearm moon', 'gold ear stack']);
    expect(items[0].categories).toContain('tattoos');

    const refs = await findAll(TABLES.manualReferences);
    expect(refs).toHaveLength(1);
    expect(refs[0].url).toBe('https://www.pinterest.com/pin/3333333333333/');
    expect(refs[0].provider).toBe('pinterest');

    // the whole point: imported cards reach the feed
    const page = await fetchFeedPage({ page: 1 });
    const seen = page.items.map((i) => String(i.id).replace(/#lap\d+$/, ''));
    expect(page.items.every((i) => i.providerId === 'pinterest')).toBe(true);
    expect(new Set(seen).size).toBe(2);
  });

  it('shows each imported pin once, not also as an upload card', async () => {
    // Regression: the ingest defaulted to sourceKind 'user', so the picture
    // entered the feed twice — as the Pinterest card and as a "my uploads" card.
    forbidNetwork();
    const zip = await zipOf({
      'pins.csv': csvOf([['id', 'pin_url', 'title'], ['9999888877776', 'https://www.pinterest.com/pin/9999888877776/', 'graphic liner']]),
      'Images/9999888877776.png': pngBytes(21)
    });
    await importExportZip(zip);
    const ids = (await findAll(TABLES.discoveryItems)).map((i) => String(i.id));
    const page = await fetchFeedPage({ page: 1 });
    expect(page.items).toHaveLength(12);
    expect(new Set(page.items.map((i) => String(i.id).replace(/#lap\d+$/, ''))).size).toBe(1);
    expect(ids).toHaveLength(1);
    expect((await findAll(TABLES.mediaItems))[0].sourceKind).toBe('pinterest');
  });

  it('re-importing the same archive adds nothing', async () => {
    forbidNetwork();
    const zip = await zipOf({
      'pins.csv': csvOf([
        ['id', 'title', 'pin_url'],
        ['4444444444444', 'blackwork moth', 'https://www.pinterest.com/pin/4444444444444/']
      ]),
      'Images/4444444444444.png': pngBytes(7)
    });
    const first = await importExportZip(zip);
    expect(first.imported).toBe(1);
    const second = await importExportZip(zip);
    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(await findAll(TABLES.discoveryItems)).toHaveLength(1);
    expect(await findAll(TABLES.mediaItems)).toHaveLength(1);
  });

  /**
   * The re-runnable case. Boards are newest-first, so a grab that names saves by
   * position hands the same picture a different title next time. Keying on the
   * title alone would skip every new pin; keying on the picture keeps re-import
   * additive and lets the label follow the new name.
   */
  it('matches a re-grabbed save by its picture when its title moved', async () => {
    forbidNetwork();
    const named = (title: string, file: string) =>
      zipOf({
        'pins.csv': csvOf([['Title', 'Board', 'Description'], [title, 'nails', 'public image']]),
        [`images/${file}`]: pngBytes(31)
      });

    const first = await importExportZip(await named('nails save 1', 'nails-save-1.png'));
    expect(first.imported).toBe(1);

    const again = await importExportZip(await named('nails save a1b2c3d4', 'nails-save-a1b2c3d4.png'));
    expect(again.imported).toBe(0);
    expect(again.duplicates).toBe(1);

    const items = await findAll(TABLES.discoveryItems, { where: { providerId: 'pinterest' } });
    expect(items).toHaveLength(1);
    expect(await findAll(TABLES.mediaItems)).toHaveLength(1);
    expect(items[0].title).toBe('nails save a1b2c3d4');
    expect(String(items[0].slug)).toBe('pinterest-nails save a1b2c3d4');

    // a genuinely new picture in the same board still lands as its own card
    const fresh = await zipOf({
      'pins.csv': csvOf([
        ['Title', 'Board', 'Description'],
        ['nails save a1b2c3d4', 'nails', 'public image'],
        ['nails save zz9yy8x7', 'nails', 'public image']
      ]),
      'images/nails-save-a1b2c3d4.png': pngBytes(31),
      'images/nails-save-zz9yy8x7.png': pngBytes(32)
    });
    const third = await importExportZip(fresh);
    expect(third.imported).toBe(1);
    expect(third.duplicates).toBe(1);
    expect(await findAll(TABLES.discoveryItems, { where: { providerId: 'pinterest' } })).toHaveLength(2);
  });

  it('leaves a tidied-away duplicate away, and renames the card she can still see', async () => {
    forbidNetwork();
    const named = (title: string, file: string) =>
      zipOf({
        'pins.csv': csvOf([['Title', 'Board', 'Description'], [title, 'nails', 'public image']]),
        [`images/${file}`]: pngBytes(31)
      });

    const first = await importExportZip(await named('nails save 1', 'nails-save-1.png'));
    expect(first.imported).toBe(1);
    const [seen] = await findAll(TABLES.discoveryItems, { where: { providerId: 'pinterest' } });

    // The shape her library is actually in. The very first import keyed cards on
    // title alone, so several positional rows landed on one stored picture.
    await put(TABLES.discoveryItems, { id: 'twin', slug: 'pinterest-hair save 1', providerId: 'pinterest', title: 'hair save 1', mediaId: seen.mediaId ?? null });
    await softDelete(TABLES.discoveryItems, String(seen.id));

    const again = await importExportZip(await named('nails save a1b2c3d4', 'nails-save-a1b2c3d4.png'));
    expect(again.imported).toBe(0);

    const live = await findAll(TABLES.discoveryItems, { where: { providerId: 'pinterest' } });
    expect(live).toHaveLength(1);
    expect(String(live[0].id)).toBe('twin');
    expect(live[0].title).toBe('nails save a1b2c3d4');
    const all = await findAll(TABLES.discoveryItems, { includeDeleted: true });
    expect(all.find((r) => String(r.id) === String(seen.id))?.deletedAt).toBeTruthy();
  });

  it('reports a CSV-only archive honestly instead of inventing tiles', async () => {
    forbidNetwork();
    const zip = await zipOf({
      'pins.csv': csvOf([
        ['id', 'pin_url', 'title'],
        ['5555555555555', 'https://www.pinterest.com/pin/5555555555555/', 'septum ring']
      ])
    });
    const summary = await importExportZip(zip);
    expect(summary.imported).toBe(0);
    expect(summary.linkOnly).toBe(1);
    expect(await findAll(TABLES.discoveryItems)).toHaveLength(0);
    expect((await findAll(TABLES.manualReferences))[0].title).toBe('septum ring');
  });

  it('says so when the archive holds no pin rows at all', async () => {
    forbidNetwork();
    const zip = await zipOf({ 'boards.csv': csvOf([['name', 'description'], ['Tattoos', 'ideas']]) });
    const summary = await importExportZip(zip);
    expect(summary.pinsFound).toBe(0);
    expect(summary.detail).toMatch(/No pin rows/);
  });
});

describe('loose files and links', () => {  it('accepts a folder of saved pictures with no CSV', async () => {
    forbidNetwork();
    const res = await importImageFiles([
      new File([pngBytes(11)], 'tattoo-moon.png', { type: 'image/png' }),
      new File([pngBytes(12)], 'ear-stack.png', { type: 'image/png' })
    ]);
    expect(res.imported).toBe(2);
    const items = await findAll(TABLES.discoveryItems, { where: { providerId: 'pinterest' } });
    expect(items).toHaveLength(2);
    expect(items.some((i) => /tattoo moon/i.test(String(i.title)))).toBe(true);
  });

  it('stores pasted pin links and never downloads the image', async () => {
    const net = forbidNetwork();
    const res = await importPinLinks(
      'https://www.pinterest.com/pin/6666666666666/ and https://pin.it/shorty, https://www.pinterest.com/pin/6666666666666/'
    );
    expect(net).not.toHaveBeenCalled();
    expect(res.linkOnly).toBe(2);
    expect(res.duplicates).toBe(0);
    const again = await importPinLinks('https://www.pinterest.com/pin/6666666666666/');
    expect(again.duplicates).toBe(1);
    expect(await findAll(TABLES.discoveryItems)).toHaveLength(0);
  });
});

describe('pulling the archive sitting on this device', () => {
  const archive = async () =>
    zipOf({
      'pins.csv': csvOf([
        ['Title', 'Board', 'Description'],
        ['nails save a1b2c3d4', 'nails', 'public image']
      ]),
      'images/nails-save-a1b2c3d4.png': pngBytes(41)
    });

  it('reads it over the same origin and records the pull', async () => {
    /* `pinterestAutoSync` ships off now, so the pull is only reached once she
       gives it. This test is about the pull mechanism, not the default — the
       default is asserted in switches.test.tsx and engine.test.ts. */
    await updateSettings({ pinterestAutoSync: true });
    const file = await archive();
    // jsdom's Response mangles a Blob body, so the fetch is stood up by hand.
    const spy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      ({
        ok: true,
        status: 200,
        headers: { get: (k: string) => (k === 'etag' ? '"archive-1"' : null) },
        blob: async () => file
      }) as unknown as Response
    );
    vi.stubGlobal('fetch', spy);

    const first = await syncPinterestArchive();
    expect(first.state).toBe('updated');
    expect(first.imported).toBe(1);
    expect(String(spy.mock.calls[0][0])).toContain('pinterest-saves.zip');
    expect((await loadSettings()).pinterestSyncAt).toBeTypeOf('number');

    // with the switch given, an unchanged archive is not re-decoded, and a
    // forced pass over it still adds nothing, because the picture is the key
    const second = await syncPinterestArchive();
    expect(second.state).toBe('unchanged');
    const forced = await syncPinterestArchive({ force: true });
    expect(forced.imported).toBe(0);
    expect(forced.duplicates).toBe(1);
    expect(await findAll(TABLES.discoveryItems, { where: { providerId: 'pinterest' } })).toHaveLength(1);
  });

  it('says so when this device has no archive', async () => {
    await updateSettings({ pinterestAutoSync: true });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response));
    const r = await syncPinterestArchive();
    expect(r.state).toBe('empty');
    expect(r.detail).toMatch(/No archive on this device/);
    expect(await findAll(TABLES.discoveryItems)).toHaveLength(0);
  });

  it('does not even read the folder when the switch is off', async () => {
    await updateSettings({ pinterestAutoSync: false });
    const spy = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', spy);
    expect((await syncPinterestArchive()).state).toBe('off');
    expect(spy).not.toHaveBeenCalled();
    const forced = await syncPinterestArchive({ force: true });
    expect(forced.state).toBe('error');
    expect(forced.detail).toMatch(/offline/);
  });
});
