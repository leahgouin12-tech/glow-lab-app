import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClosetPage from '../pages/ClosetPage';
import { ToastHost } from '../ui/primitives';
import { TABLES, type AnyRow } from '../db/schema';
import { put, todayISO } from '../db/repo';
import { db } from '../db/db';
import { DEFAULT_SETTINGS, updateSettings } from '../state/settings';
/**
 * The three closet additions, met the way she meets them: buttons on the page.
 * What is asserted here is the part a screenshot cannot show — which rows got
 * written, whether her own photographs survived, and whether the app said "no"
 * out loud instead of inventing a picture or a garment.
 */

/**
 * jsdom has no decoder and no canvas, so both the media pipeline and the fit
 * sheet composer run against the same fakes src/test/media.test.ts uses. The
 * prototypes are handed back afterwards because these are direct assignments,
 * not spies — `vi.restoreAllMocks()` would not undo them, and the next test
 * would silently inherit a half-implemented canvas.
 */
class FakeImage {
  naturalWidth = 900;
  naturalHeight = 600;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_v: string) {
    setTimeout(() => this.onload?.(), 0);
  }
}

const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
const pristine = { getContext: proto.getContext, toBlob: proto.toBlob };

const ctx2d = {
  drawImage: () => {},
  fillRect: () => {},
  strokeRect: () => {},
  fillText: () => {},
  save: () => {},
  restore: () => {},
  translate: () => {},
  rotate: () => {},
  scale: () => {},
  setTransform: () => {},
  getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255), width: w, height: h })
};

/** Everything a real browser would give the media pipeline. */
function withMedia() {
  vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
  proto.getContext = (() => ctx2d) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  proto.toBlob = ((cb: (b: Blob | null) => void, type?: string) => cb(new Blob([new Uint8Array(64)], { type: type ?? 'image/webp' }))) as unknown as typeof HTMLCanvasElement.prototype.toBlob;
}

/** The decoder works but the canvas does not — the case the app must report, not paper over. */
function withoutCanvas() {
  vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
  proto.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  proto.toBlob = ((cb: (b: Blob | null) => void) => cb(null)) as unknown as typeof HTMLCanvasElement.prototype.toBlob;
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const text = () => container.textContent ?? '';
/** Inside a dialog when one is open — the page itself carries the same field labels. */
const scope = () => (container.querySelector('.gl-modal') ?? container) as HTMLElement;

async function settle(rounds = 3) {
  for (let i = 0; i < rounds; i += 1) await act(async () => tick(18));
}

let container: HTMLDivElement;
let root: Root;

async function mount() {
  root = createRoot(container);
  await act(async () => root.render(<HashRouter><ToastHost><ClosetPage /></ToastHost></HashRouter>));
  await settle(4);
}

function findButton(label: string) {
  const needle = label.toLowerCase();
  return [...scope().querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').trim().toLowerCase().includes(needle) || (b.getAttribute('aria-label') ?? '').toLowerCase().includes(needle)
  );
}

async function clickNode(node: Element) {
  await act(async () => {
    (node as HTMLElement).click();
    await tick(20);
  });
  await settle(2);
}

async function clickText(label: string) {
  const node = findButton(label);
  if (!node) throw new Error(`no button matching “${label}” — have: ${[...scope().querySelectorAll('button')].map((b) => b.textContent || b.getAttribute('aria-label')).join(' / ').slice(0, 500)}`);
  await clickNode(node);
  return node as HTMLButtonElement;
}

/** A bounded poll on something observable, rather than a guessed tick budget. */
async function waitUntil(what: string, done: () => boolean, budget = 12000) {
  const started = Date.now();
  for (;;) {
    if (done()) return;
    if (Date.now() - started > budget) throw new Error(`timed out waiting for ${what}`);
    await act(async () => {
      await tick(25);
    });
  }
}

/** Storing the pile ingests every photograph before it closes, so wait for the close. */
async function storePile(label: string) {
  await clickText(label);
  await waitUntil('the pile modal to close', () => !container.querySelector('.gl-modal'));
  await settle(1);
}

/** Fields are `<label class="gl-field">`, so a control is found by the words above it. */
function controlIn(labelText: string, tag: 'input' | 'select') {
  const field = [...scope().querySelectorAll('label.gl-field')].find((l) => (l.textContent ?? '').includes(labelText));
  return field?.querySelector(tag) ?? null;
}

async function typeInto(labelText: string, value: string) {
  const input = controlIn(labelText, 'input') as HTMLInputElement | null;
  if (!input) throw new Error(`no input under the field “${labelText}”`);
  await setValue(input, value);
}

async function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(15);
  });
  await settle(1);
}

async function chooseFrom(labelText: string, value: string) {
  const select = controlIn(labelText, 'select') as HTMLSelectElement | null;
  if (!select) throw new Error(`no select under the field “${labelText}”`);
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(15);
  });
  await settle(1);
}

async function pickFiles(files: File[]) {
  const input = scope().querySelector('input[type="file"]') as HTMLInputElement | null;
  if (!input) throw new Error('no file input in the pile modal');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(20);
  });
  await settle(2);
}

const photo = (name: string, seed: number) => new File([Uint8Array.from([9, 8, 7, 6, 5, 4, 3, seed])], name, { type: 'image/jpeg' });

/** A stored picture, with the blob row a real viewer would need. */
async function seedPhoto(id: string, seed: number, palette: string[] = []) {
  await db.mediaBlobs.put({
    id: `blob-${id}`,
    blob: new Blob([`picture ${id}`], { type: 'image/jpeg' }),
    thumb: new Blob([`thumb ${id}`], { type: 'image/jpeg' }),
    createdAt: Date.now(),
    bytes: 12,
    mime: 'image/jpeg'
  } as never);
  /* the palette is what `swatches()` writes during ingest, so this is the same
    field a real photograph would carry — nothing here is hand-picked for the test */
  return put(
    TABLES.mediaItems,
    {
      id,
      kind: 'upload',
      title: `Photo ${id}`,
      blobId: `blob-${id}`,
      private: true,
      ...(palette.length ? { data: { palette } } : {})
    } as never
  );
}

async function seedPiece(id: string, name: string, category: string, over: Record<string, unknown> = {}) {
  await put(TABLES.clothingItems, {
    id,
    name,
    category,
    wears: over.wears ?? 0,
    price: over.price ?? null,
    colors: over.colors ?? [],
    seasons: over.seasons ?? [],
    occasions: over.occasions ?? [],
    mediaId: over.mediaId ?? null,
    data: { lastWornOn: over.lastWornOn ?? null }
  } as never);
}

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
  localStorage.clear();
  /* settings live in a module cache for a page load, so the switch one test
    turns off would otherwise still be off for the next test in this file */
  await updateSettings({ ...DEFAULT_SETTINGS });
  withMedia();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  root?.unmount();
  container.remove();
  proto.getContext = pristine.getContext;
  proto.toBlob = pristine.toBlob;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ bulk log */

describe('logging several pieces at once', () => {
  it('writes one closet row per photograph, named from the file and shared fields', async () => {
    await mount();
    await clickText('Log several pieces');
    expect(text()).toContain('Log several pieces at once');
    expect(text()).toContain('does not recognise clothing');

    await pickFiles([photo('linen-shirt.jpg', 1), photo('wool_trouser_final.png', 2), photo('Navy Blazer.jpeg', 3)]);
    expect(text()).toContain('3 in the pile · 3 named');

    await chooseFrom('Category for all of them', 'Tops');
    await typeInto('Brand / maker', 'Market stall');
    await typeInto('Size on the label', 'M');
    await storePile('Store 3 pieces');

    const rows = (await db.clothingItems.toArray()) as AnyRow[];
    expect(rows.map((r) => r.name).sort()).toEqual(['Navy Blazer', 'linen shirt', 'wool trouser final']);
    for (const r of rows) {
      expect(r.category).toBe('Tops');
      expect(r.brand).toBe('Market stall');
      expect(r.size).toBe('M');
      expect(r.wears).toBe(0);
      expect(r.mediaId).toBeTruthy();
      expect(await db.mediaItems.get(String(r.mediaId))).toBeTruthy();
    }
    /* three pictures, three distinct media rows */
    expect(new Set(rows.map((r) => String(r.mediaId))).size).toBe(3);
  });

  it('re-uses a photograph already in the library instead of storing it twice', async () => {
    await mount();
    const before = (await db.mediaItems.toArray()).length;
    await clickText('Log several pieces');
    await pickFiles([photo('same picture.jpg', 4), photo('same picture again.jpg', 4)]);
    await storePile('Store 2 pieces');

    const rows = (await db.clothingItems.toArray()) as AnyRow[];
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => String(r.mediaId))).size).toBe(1);
    expect((await db.mediaItems.toArray()).length - before).toBe(1);
    expect(text()).toContain('re-used rather than stored twice');
  });

  it('takes a price per piece and leaves a blank one unknown', async () => {
    await mount();
    await clickText('Log several pieces');
    await pickFiles([photo('cheap tee.jpg', 5), photo('good jacket.jpg', 6)]);
    const costs = [...scope().querySelectorAll('label.gl-field')]
      .filter((l) => (l.textContent ?? '').includes('Cost'))
      .map((l) => l.querySelector('input') as HTMLInputElement);
    expect(costs.length).toBe(2);
    await setValue(costs[1], '149.50');
    await storePile('Store 2 pieces');
    const rows = (await db.clothingItems.toArray()) as AnyRow[];
    const byName = new Map(rows.map((r) => [String(r.name), r]));
    expect(byName.get('cheap tee')?.price).toBeNull();
    expect(byName.get('good jacket')?.price).toBe(149.5);
  });

  it('refuses to store a pile when adding photographs is switched off, and says where the switch is', async () => {
    await updateSettings({ allowUploads: false });
    await mount();
    await clickText('Log several pieces');
    expect(text()).toContain('Settings → Privacy');
    expect(findButton('Choose photographs')!.disabled).toBe(true);
    expect(findButton('Store ')?.disabled ?? true).toBe(true);
    const before = (await db.clothingItems.toArray()).length;
    expect(before).toBe(0);
  });

  it('lets a photo be taken out of the pile before anything is written', async () => {
    await mount();
    await clickText('Log several pieces');
    await pickFiles([photo('keep me.jpg', 7), photo('drop me.jpg', 8)]);
    await clickText('Take drop me out of the pile');
    expect(text()).toContain('1 in the pile · 1 named');
    await clickText('Store 1 piece');
    await waitUntil('the pile modal to close', () => !container.querySelector('.gl-modal'));
    await settle(1);
    const rows = (await db.clothingItems.toArray()) as AnyRow[];
    expect(rows.map((r) => r.name)).toEqual(['keep me']);
    expect(rows[0].mediaId).toBeTruthy();
  });
});

/* ----------------------------------------------------------------- fit sheet */

describe('the fit sheet on an outfit', () => {
  it('refuses when fewer than two pieces hold a photograph, and says what is missing', async () => {
    await seedPiece('p1', 'Silk blouse', 'Tops', { mediaId: 'm1' });
    await seedPiece('p2', 'Wool trousers', 'Bottoms');
    await seedPhoto('m1', 1);
    await put(TABLES.outfits, { id: 'o1', name: 'Interview set', itemIds: ['p1', 'p2'] } as never);
    await mount();
    expect(text()).toContain('1 of 2 pieces photographed');
    await clickText('Fit sheet from piece photos');
    expect(text()).toContain('A fit sheet needs at least two photographed pieces');
    expect(text()).not.toContain('would not hand back pixels');
    /* one seeded photograph and nothing else: no sheet row was written */
    expect((await db.mediaItems.toArray()).length).toBe(1);
    /* nothing written against the outfit either */
    expect(((await db.outfits.get('o1')) as AnyRow).data?.sheetMediaId).toBeUndefined();
  });

  it('says plainly that it cannot make one from unphotographed garments', async () => {
    await seedPiece('p1', 'Silk blouse', 'Tops');
    await seedPiece('p2', 'Wool trousers', 'Bottoms');
    await put(TABLES.outfits, { id: 'o1', name: 'Interview set', itemIds: ['p1', 'p2'] } as never);
    await mount();
    await clickText('Fit sheet from piece photos');
    expect(text()).toContain('None of these garments has a photograph yet');
  });

  it('composes from the pieces’ own photographs and attaches the sheet without touching her own photo', async () => {
    await seedPhoto('m1', 1);
    await seedPhoto('m2', 2);
    await seedPhoto('own-photo', 3);
    await seedPiece('p1', 'Silk blouse', 'Tops', { mediaId: 'm1' });
    await seedPiece('p2', 'Wool trousers', 'Bottoms', { mediaId: 'm2' });
    await put(TABLES.outfits, { id: 'o1', name: 'Interview set', itemIds: ['p1', 'p2'], mediaId: 'own-photo' } as never);
    await mount();

    /* every photograph is read and the sheet row written before the toast lands */
    await clickText('Fit sheet from piece photos');
    await waitUntil('the fit sheet verdict', () => text().includes('Fit sheet made from 2'));
    expect(text()).toContain('Fit sheet made from 2 of your own piece photographs');
    await settle(1);

    const row = (await db.outfits.get('o1')) as AnyRow;
    expect(row.mediaId).toBe('own-photo');
    const sheet = (await db.mediaItems.get(String(row.data?.sheetMediaId))) as AnyRow;
    expect(sheet).toBeTruthy();
    expect(sheet.kind).toBe('outfit');
    expect(sheet.album).toBe('Closet fit sheets');
    expect(sheet.title).toBe('Interview set — fit sheet');
    expect(sheet.caption).toContain('Not a photograph of the outfit being worn');
    expect(sheet.sourceKind).toBe('glow-lab-original');
    expect((sheet.linkedIds as string[]).sort()).toEqual(['p1', 'p2']);
    expect(row.data?.sheetPieces).toBe(2);
    expect(text()).toContain('Re-compose fit sheet');

    /* The sheet is an artifact the app composed, not an editorial photograph:
       it is shown whole and without the theme's colour filter, so the greys on
       it are the greys of her actual trousers. Her own outfit photo keeps both. */
    const sheetTile = [...container.querySelectorAll('.gl-tile')].find((t) => /Fit sheet — 2 of 2 pieces/.test(t.textContent ?? ''));
    const sheetImg = sheetTile?.querySelector('img');
    expect(sheetImg).toBeTruthy();
    expect(sheetImg!.className).not.toContain('gl-img-treated');
    const ownImg = [...container.querySelectorAll('.gl-tile img')].find((i) => i !== sheetImg);
    expect(ownImg?.className).toContain('gl-img-treated');
    expect(sheetImg!.getAttribute('style') ?? '').toContain('object-fit');
  });

  it('says so when the browser will not hand pixels back, and writes nothing', async () => {
    withoutCanvas();
    await seedPhoto('m1', 1);
    await seedPhoto('m2', 2);
    await seedPiece('p1', 'Silk blouse', 'Tops', { mediaId: 'm1' });
    await seedPiece('p2', 'Wool trousers', 'Bottoms', { mediaId: 'm2' });
    await put(TABLES.outfits, { id: 'o1', name: 'Interview set', itemIds: ['p1', 'p2'] } as never);
    await mount();
    await clickText('Fit sheet from piece photos');
    expect(text()).toContain('would not hand back pixels, so no sheet was made');
    expect(((await db.outfits.get('o1')) as AnyRow).data?.sheetMediaId).toBeUndefined();
    expect((await db.mediaItems.toArray()).length).toBe(2);
  });

  it('writes nothing when a stored picture has gone missing, and says which step broke', async () => {
    /* rows that point at blobs this device no longer holds — an unfinished sync */
    await put(TABLES.mediaItems, { id: 'm1', kind: 'upload', title: 'Photo m1', blobId: 'blob-gone-1' } as never);
    await put(TABLES.mediaItems, { id: 'm2', kind: 'upload', title: 'Photo m2', blobId: 'blob-gone-2' } as never);
    await seedPiece('p1', 'Silk blouse', 'Tops', { mediaId: 'm1' });
    await seedPiece('p2', 'Wool trousers', 'Bottoms', { mediaId: 'm2' });
    await put(TABLES.outfits, { id: 'o1', name: 'Interview set', itemIds: ['p1', 'p2'] } as never);
    await mount();
    await clickText('Fit sheet from piece photos');
    expect(text()).toContain('A stored picture could not be read, so no sheet was made');
    expect(((await db.outfits.get('o1')) as AnyRow).data?.sheetMediaId).toBeUndefined();
    expect((await db.mediaItems.toArray()).length).toBe(2);
    expect(findButton('Composing…')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ rotation */

describe('drawing what to wear next', () => {
  it('orders the closet on screen and prints the numbers behind the pick', async () => {
    await seedPiece('t1', 'Grey tee', 'Tops', { wears: 44, lastWornOn: todayISO() });
    await seedPiece('t2', 'Linen shirt', 'Tops', { wears: 2, lastWornOn: '2026-01-04' });
    await seedPiece('b1', 'Dark jeans', 'Bottoms', { wears: 30, lastWornOn: '2026-02-04' });
    await mount();
    expect(text()).toContain('3 pieces read');
    await clickText('Draw a look');
    expect(text()).toContain('Assembled from the pieces that have waited longest');
    /* the tee was worn today, so the shirt is picked and the set-aside is admitted */
    const topRow = container.querySelector('[data-slot="Top"]');
    expect(topRow?.textContent).toContain('Linen shirt');
    expect(topRow?.textContent).toContain('last worn');
    expect(text()).toContain('set aside for having been worn in the last 7 days');
    expect(text()).toContain('Nothing in the pieces this look was drawn from is categorised as Footwear');
  });

  it('swaps to the next ranked option instead of inventing one', async () => {
    await seedPiece('t1', 'Grey tee', 'Tops', { wears: 1, lastWornOn: '2026-01-04' });
    await seedPiece('t2', 'Linen shirt', 'Tops', { wears: 1, lastWornOn: '2026-02-04' });
    await seedPiece('b1', 'Dark jeans', 'Bottoms', { wears: 1, lastWornOn: '2026-01-04' });
    await mount();
    await clickText('Draw a look');
    expect(container.querySelector('[data-slot="Top"]')?.textContent).toContain('Grey tee');
    await clickText('another option');
    expect(container.querySelector('[data-slot="Top"]')?.textContent).toContain('Linen shirt');
    await clickText('another option');
    expect(container.querySelector('[data-slot="Top"]')?.textContent).toContain('Grey tee');
  });

  it('saves the drawn look as a real outfit row that says where it came from', async () => {
    await seedPiece('t1', 'Silk blouse', 'Tops', { wears: 0 });
    await seedPiece('b1', 'Wool trousers', 'Bottoms', { wears: 4, lastWornOn: '2026-03-04' });
    await mount();
    await clickText('Draw a look');
    await clickText('Save these 2 pieces as an outfit');
    const rows = (await db.outfits.toArray()) as AnyRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Silk blouse + Wool trousers');
    expect((rows[0].itemIds as string[]).sort()).toEqual(['b1', 't1']);
    expect(rows[0].note).toContain('Drawn by the rotation rule over 2 logged pieces');
    expect(rows[0].wornCount).toBe(0);
  });

  it('wears the drawn look by moving the pieces, not by writing a note', async () => {
    await seedPiece('t1', 'Silk blouse', 'Tops', { wears: 3, lastWornOn: '2026-03-04' });
    await seedPiece('b1', 'Wool trousers', 'Bottoms', { wears: 4, lastWornOn: '2026-03-04' });
    await mount();
    await clickText('Draw a look');
    await clickText('Wore it today');
    const blouse = (await db.clothingItems.get('t1')) as AnyRow;
    expect(blouse.wears).toBe(4);
    expect(blouse.data?.lastWornOn).toBe(todayISO());
    expect((await db.outfits.toArray()) as AnyRow[]).toHaveLength(1);
  });

  it('says the closet has nothing to order when it has nothing to order', async () => {
    await mount();
    await clickText('Draw a look');
    expect(text()).toContain('Nothing could be drawn');
    expect(text()).toContain('No clothing items in the closet');
    expect(findButton('Save these 0 pieces as an outfit')).toBeUndefined();
  });

  /* the pairing layer, seen as she sees it: the chips, the reason on the piece,
    and the gaps admitted in the same breath as the pick */

  const chips = () => container.querySelector('[data-testid="pairing-read"]')?.textContent ?? '';

  it('reads colour off her own photographs and says what it could not read', async () => {
    await seedPhoto('m-blue', 1, ['#4a7ab5', '#3d6a9a', '#2f5580']);
    await seedPhoto('m-teal', 2, ['#1f6f70']);
    await seedPiece('t1', 'Blue shirt', 'Tops', { mediaId: 'm-blue', lastWornOn: '2026-01-04' });
    /* the trouser is the idlest bottom and carries no colour anywhere — it must
      keep its rank as a candidate, not be silently dropped for being unreadable */
    await seedPiece('b1', 'Everyday trouser', 'Bottoms', { lastWornOn: '2026-01-02' });
    await seedPiece('b2', 'Teal skirt', 'Bottoms', { mediaId: 'm-teal', lastWornOn: '2026-02-02' });
    await mount();
    await clickText('Draw a look');

    expect(chips()).toContain('colour read for 2 of 3 placeable pieces');
    expect(chips()).toContain('no two pieces stored together yet');
    expect(chips()).toContain('pairing chose over idlest in 1 of 2 slots');

    const bottom = container.querySelector('[data-slot="Bottom"]');
    expect(bottom?.textContent).toContain('Teal skirt');
    expect(bottom?.textContent).toContain('adjacent hues with “Blue shirt”');
    /* the swatches drawn beside the pick are the palette values the ingest stored */
    const swatches = [...(bottom?.querySelectorAll('span[title]') ?? [])].map((s) => s.getAttribute('title'));
    expect(swatches).toEqual(['#1f6f70']);

    expect(text()).toContain('Colour was read for 2 of 3 placeable pieces (2 from a photograph you stored)');
    expect(text()).toContain('for the other 1, the pairing keys had nothing to say and the idle order decided');
    expect(text()).toContain('You have not stored an outfit yet, so the co-worn key had nothing of yours to rank');
    /* the second layer names relationships; it is not allowed to become advice */
    expect(text()).not.toMatch(/flattering|looks best|you should|avoid/);
  });

  it('puts what she has stored together above what the colour arithmetic prefers', async () => {
    await seedPhoto('m-blue', 1, ['#4a7ab5', '#3d6a9a', '#2f5580']);
    await seedPhoto('m-teal', 2, ['#1f6f70']);
    await seedPiece('t1', 'Blue shirt', 'Tops', { mediaId: 'm-blue', lastWornOn: '2026-01-04' });
    /* b1 was worn more recently, so the idle order and the colour key both want b2 */
    await seedPiece('b1', 'Everyday trouser', 'Bottoms', { lastWornOn: '2026-02-02' });
    await seedPiece('b2', 'Teal skirt', 'Bottoms', { mediaId: 'm-teal', lastWornOn: '2026-01-02' });
    await put(TABLES.outfits, {
      id: 'seen',
      name: 'Shirt and trouser',
      itemIds: ['t1', 'b1'],
      rating: 5,
      wornCount: 3,
      lastWornOn: todayISO()
    } as never);
    await mount();
    await clickText('Draw a look');

    expect(chips()).toContain('1 pair you have stored together');
    const bottom = container.querySelector('[data-slot="Bottom"]');
    expect(bottom?.textContent).toContain('Everyday trouser');
    expect(bottom?.textContent).toContain('worn with “Blue shirt” in 1 outfit you stored, which you rated 5/5');
    expect(text()).toContain('The co-worn key read 1 outfit row you assembled that holds at least two pieces from this pile');
  });
});

/* ------------------------------------------------------------------ coverage */

describe('the coverage matrix', () => {
  const cell = (slot: string, season: string) =>
    container.querySelector(`[data-cell="${slot}:${season}"]`)?.textContent ?? '';

  it('counts on the page without being asked, in two numbers per cell', async () => {
    await seedPiece('t1', 'Linen shirt', 'Tops', { seasons: ['Summer'] });
    /* an untagged piece is reachable everywhere, and is reported as untagged too */
    await seedPiece('t2', 'Grey tee', 'Tops');
    await seedPiece('b1', 'Everyday trouser', 'Bottoms', { seasons: ['All-season'] });
    await mount();

    expect(text()).toContain('What the closet can dress at all');
    expect(cell('Top', 'Summer')).toContain('2 (1)');
    expect(cell('Top', 'Winter')).toContain('1 (0)');
    expect(cell('Bottom', 'Winter')).toContain('1 (0)');
    expect(cell('Dress or set', 'Summer')).toContain('0 (0)');
    expect(text()).toContain('2 of 6 slots have pieces');
    expect(text()).toContain('3 of 3 pieces placeable');
  });

  it('names the holes as counts and refuses to turn one into a shopping list', async () => {
    await seedPiece('t1', 'Linen shirt', 'Tops', { seasons: ['Summer'] });
    await seedPiece('x1', 'Cashmere scarf', 'Accessories');
    await mount();

    expect(text()).toContain('Nothing in the closet is categorised as Dresses & Sets');
    expect(text()).toContain('1 of 2 pieces sit in a category that fills no slot (Accessories 1)');
    expect(text()).toContain('Tops: 1 piece exists but none can dress Spring, Autumn, Winter');
    /* the denial of advice is printed on the page, not only in a test */
    expect(text()).toContain('it is not a shopping list, a price, or a claim that you need anything');
    expect(text()).not.toMatch(/\bbuy\b|\bshop for\b|\brecommend\b|\badd to cart\b/i);
  });

  it('groups her own occasion words, spelled as she spelled them', async () => {
    await seedPiece('d1', 'Black dress', 'Dresses & Sets', { occasions: ['Interview'] });
    await seedPiece('d2', 'Navy dress', 'Dresses & Sets', { occasions: ['interview'] });
    await seedPiece('d3', 'Sun dress', 'Dresses & Sets', { seasons: ['Summer'] });
    await mount();

    const chips = container.querySelector('[data-testid="coverage-occasions"]')?.textContent ?? '';
    expect(chips).toContain('Interview · 2');
    expect(chips).toContain('1 with no occasion');
    expect(text()).toContain('grouped only on spelling');
  });

  it('says so when nothing at all is logged', async () => {
    await mount();
    expect(text()).toContain('No pieces logged yet.');
    expect(text()).toContain('no occasion written on any piece');
  });
});

/* -------------------------------------------------------------------- the week */

describe('dressing the next few days', () => {
  const dayAt = (n: number) => container.querySelectorAll('[data-week-day]')[n];
  const pieceOn = (n: number, slot: string) =>
    dayAt(n).querySelector(`[data-day-slot$=":${slot}"]`)?.textContent ?? '';
  const iso = (offset: number) => {
    const [y, m, d] = todayISO().split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
  };

  it('wears each piece once and hands the rest to the next day', async () => {
    await seedPiece('t1', 'Grey tee', 'Tops');
    await seedPiece('t2', 'Linen shirt', 'Tops');
    await seedPiece('b1', 'Dark jeans', 'Bottoms');
    await seedPiece('b2', 'Wool trousers', 'Bottoms');
    await mount();
    await clickText('Plan from today');

    expect(container.querySelectorAll('[data-week-day]')).toHaveLength(2);
    expect(pieceOn(0, 'Top')).toContain('Grey tee');
    expect(pieceOn(1, 'Top')).toContain('Linen shirt');
    expect(pieceOn(0, 'Bottom')).toContain('Dark jeans');
    expect(pieceOn(1, 'Bottom')).toContain('Wool trousers');
    expect(text()).toContain('2 of 7 days dressed');
    expect(text()).toContain('4 pieces committed');
  });

  it('leaves a day short and says which slot ran out rather than repeating a piece', async () => {
    await seedPiece('t1', 'Grey tee', 'Tops');
    await seedPiece('b1', 'Dark jeans', 'Bottoms');
    await seedPiece('b2', 'Wool trousers', 'Bottoms');
    await seedPiece('s1', 'White sneaker', 'Footwear');
    await mount();
    await clickText('Plan from today');

    expect(container.querySelectorAll('[data-week-day]')).toHaveLength(2);
    expect(dayAt(0).getAttribute('data-week-day')).toBe(iso(0));
    expect(dayAt(1).getAttribute('data-week-day')).toBe(iso(1));
    expect(pieceOn(1, 'Bottom')).toContain('Wool trousers');
    expect(dayAt(1).textContent).toContain('no top');
    /* the day's own reason prints inside the day it explains */
    expect(dayAt(1).textContent).toContain('the top slot stayed empty');
    expect(text()).toContain('nothing left to draw');
    expect(text()).toContain('1 day in this week has no base layer');
    expect(text()).toContain('That is an arithmetic choice, not advice');
  });

  it('pins a swap to that day and lets the rest of the week fall around it', async () => {
    await seedPiece('t1', 'Grey tee', 'Tops');
    await seedPiece('t2', 'Linen shirt', 'Tops');
    await seedPiece('b1', 'Dark jeans', 'Bottoms');
    await seedPiece('b2', 'Wool trousers', 'Bottoms');
    await mount();
    await clickText('Plan from today');
    expect(pieceOn(0, 'Top')).toContain('Grey tee');
    expect(pieceOn(1, 'Top')).toContain('Linen shirt');

    await clickNode(dayAt(0).querySelector('[data-day-slot$=":Top"] button')!);
    expect(pieceOn(0, 'Top')).toContain('Linen shirt');
    /* the pin is not a patch: day two is re-drawn from the pile it leaves behind */
    expect(pieceOn(1, 'Top')).toContain('Grey tee');
    expect(container.querySelectorAll('[data-week-day]')).toHaveLength(2);
  });

  it('offers an assembled outfit to one day only', async () => {
    await seedPiece('t1', 'Grey tee', 'Tops');
    await seedPiece('b1', 'Dark jeans', 'Bottoms');
    await seedPiece('t2', 'Linen shirt', 'Tops');
    await seedPiece('b2', 'Wool trousers', 'Bottoms');
    await put(TABLES.outfits, {
      id: 'stored',
      name: 'Off duty',
      itemIds: ['t1', 'b1'],
      wornCount: 1,
      lastWornOn: '2026-01-04'
    } as never);
    await mount();
    await clickText('Plan from today');

    expect(dayAt(0).textContent).toContain('an outfit you stored — “Off duty”');
    expect(dayAt(1).textContent).not.toContain('an outfit you stored');
    expect(pieceOn(1, 'Top')).toContain('Linen shirt');
  });

  it('opens a day as the single look, so it can be saved or logged worn', async () => {
    await seedPiece('t1', 'Grey tee', 'Tops');
    await seedPiece('b1', 'Dark jeans', 'Bottoms');
    await mount();
    await clickText('Plan from today');
    await clickText('Open as one look');
    expect(text()).toContain('Save these 2 pieces as an outfit');
    await clickText('Save these 2 pieces as an outfit');
    const rows = (await db.outfits.toArray()) as AnyRow[];
    expect(rows).toHaveLength(1);
    expect((rows[0].itemIds as string[]).sort()).toEqual(['b1', 't1']);
  });

  it('says plainly when there is no week to plan', async () => {
    await mount();
    await clickText('Plan from today');
    expect(text()).toContain('Nothing could be dressed from 0 pieces');
    expect(container.querySelectorAll('[data-week-day]')).toHaveLength(0);
    expect(text()).toContain('The closet holds no clothing items, so there is no week to plan.');
  });
});
