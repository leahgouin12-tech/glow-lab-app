/**
 * THE GLOW LAB — the coverage-hole tagging pass, met the way she meets it:
 * a button in the matrix, then one piece at a time in a dialog.
 *
 * What these tests exist to pin down: the pass writes a season on exactly the
 * row she is looking at and on nothing else (the rows outside the pass are
 * snapshotted and compared field by field), a skip writes nothing at all, no
 * season is ever guessed — not from the name, not from a photograph — and the
 * photograph is decoration that switches off with the privacy setting while the
 * tagging itself keeps working.
 *
 * Setup follows `closetPage.test.tsx` and `reviewQueuePage.test.tsx` exactly —
 * same providers, same seed helpers, same imperative click/wait idiom — so a
 * failure here reads the same way.
 */
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClosetPage from '../pages/ClosetPage';
import { ToastHost } from '../ui/primitives';
import { TABLES, type AnyRow } from '../db/schema';
import { put } from '../db/repo';
import { db } from '../db/db';
import { DEFAULT_SETTINGS, updateSettings } from '../state/settings';

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
/** whitespace collapsed, because the dialog's sentences wrap over JSX lines */
const flat = (s: string) => s.replace(/\s+/g, ' ');
const text = () => flat(container.textContent ?? '');
const scope = () => (container.querySelector('.gl-modal') ?? container) as HTMLElement;
const modal = () => flat(scope().textContent ?? '');
/** the assist dialog's own body, so the matrix behind it cannot muddy a claim */
const assistBox = () => container.querySelector('[data-testid="coverage-assist"]') as HTMLElement | null;
const assistText = () => flat(assistBox()?.textContent ?? '');
const progress = () => flat(container.querySelector('[data-testid="assist-progress"]')?.textContent ?? '');
const pieceBlock = () => flat(container.querySelector('[data-testid="assist-piece"]')?.textContent ?? '');
const openButton = (slot: string) =>
  container.querySelector(`[data-testid="coverage-assist-open"][data-slot="${slot}"]`) as HTMLElement | null;
const openSlots = () =>
  [...container.querySelectorAll('[data-testid="coverage-assist-open"]')].map((b) => String(b.getAttribute('data-slot')));
const seasonChip = (word: string) =>
  scope().querySelector(`[data-testid="assist-season"][data-season="${word}"]`) as HTMLElement | null;
const saveButton = () => scope().querySelector('[data-testid="assist-save"]') as HTMLButtonElement | null;
const skipButton = () => scope().querySelector('[data-testid="assist-skip"]') as HTMLButtonElement | null;
const cell = (slot: string, season: string) =>
  flat(container.querySelector(`[data-cell="${slot}:${season}"]`)?.textContent ?? '');

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

function unmount() {
  act(() => {
    root.unmount();
  });
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
  if (!node)
    throw new Error(
      `no button matching “${label}” — have: ${[...scope().querySelectorAll('button')].map((b) => b.textContent || b.getAttribute('aria-label')).join(' / ').slice(0, 600)}`
    );
  await clickNode(node);
  return node as HTMLButtonElement;
}

/** Choose a season for the piece in front of her and write it on that one row. */
async function tag(word: string) {
  await clickNode(seasonChip(word)!);
  await clickNode(saveButton()!);
}

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

async function piece(id: string, name: string, category: string, over: Record<string, unknown> = {}) {
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

async function seedPhoto(id: string) {
  await db.mediaBlobs.put({
    id: `blob-${id}`,
    blob: new Blob([`picture ${id}`], { type: 'image/jpeg' }),
    thumb: new Blob([`thumb ${id}`], { type: 'image/jpeg' }),
    createdAt: Date.now(),
    bytes: 12,
    mime: 'image/jpeg'
  } as never);
  return put(TABLES.mediaItems, { id, kind: 'upload', title: `Photo ${id}`, blobId: `blob-${id}`, private: true } as never);
}

/**
 * A Tops slot that reads badly until it is gone through: three pieces with no
 * season written, one piece that already carries Summer (so it must never be
 * offered), plus a Bottom, an autumn-tagged trouser and an accessory that fills
 * no slot — all of which must stay exactly as they are.
 */
async function seedCloset(withPhoto = false) {
  if (withPhoto) await seedPhoto('md-tee');
  await piece('t1', 'Grey tee', 'Tops', { wears: 9, price: 15, mediaId: withPhoto ? 'md-tee' : null });
  await piece('t2', 'Linen shirt', 'Tops', { wears: 2, price: 48 });
  await piece('t3', 'Silk blouse', 'Tops', { wears: 0, price: 72 });
  await piece('t4', 'Summer dress shirt', 'Tops', { wears: 5, price: 60, seasons: ['Summer'] });
  await piece('b1', 'Dark jeans', 'Bottoms', { wears: 30, price: 80 });
  await piece('b2', 'Wool trousers', 'Bottoms', { wears: 4, price: 120, seasons: ['Winter'] });
  await piece('x1', 'Cashmere scarf', 'Accessories', { wears: 1, price: 35 });
}

/** everything the pass is not supposed to touch, field by field */
const untouched = async () =>
  JSON.stringify(
    (await db.clothingItems.orderBy('id').toArray())
      .filter((r) => !['t1', 't2', 't3'].includes(String(r.id)))
      .map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        wears: r.wears,
        price: r.price,
        colors: r.colors,
        seasons: r.seasons,
        occasions: r.occasions,
        tags: r.tags,
        mediaId: r.mediaId,
        deletedAt: r.deletedAt,
        rev: r.rev,
        updatedAt: r.updatedAt,
        data: r.data
      }))
  );

const row = async (id: string) => (await db.clothingItems.get(id)) as AnyRow | undefined;

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
  localStorage.clear();
  /* settings live in a module cache for a page load, so the switch one test
     turns off would otherwise still be off for the next test in this file */
  await updateSettings({ ...DEFAULT_SETTINGS });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) unmount();
  container.remove();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ the entry */

describe('the affordance in the matrix', () => {
  it('appears only where a slot holds pieces with no season written, and counts them', async () => {
    await seedCloset();
    await mount();

    /* two slots carry blanks: Top has three, Bottom has one — nothing else gets a button */
    expect(openSlots()).toEqual(['Top', 'Bottom']);
    expect(openButton('Top')?.textContent).toContain('3 pieces have no season tag — go through them');
    expect(openButton('Bottom')?.textContent).toContain('1 piece has no season tag — go through them');
    expect(openButton('Outerwear')).toBeNull();

    /* and the cells themselves read the way the assist says they do — the
       tagged number in brackets, everything blank still reachable outside it */
    expect(cell('Top', 'Winter')).toBe('3 (0)');
    expect(cell('Top', 'Summer')).toBe('4 (1)');
  });

  it('disappears once a slot has nothing left untagged', async () => {
    await piece('t1', 'Grey tee', 'Tops', { wears: 2 });
    await piece('t2', 'Linen shirt', 'Tops', { seasons: ['Summer'] });
    await mount();
    expect(openButton('Top')?.textContent).toContain('1 piece has no season tag');

    await clickNode(openButton('Top')!);
    await tag('Winter');
    await waitUntil('the pass to run out of pieces', () => modal().includes('Nothing left to ask'));
    await clickText('Done');
    await settle(3);

    expect(openButton('Top')).toBeNull();
    expect(cell('Top', 'Winter')).toBe('1 (1)');
  });
});

/* ----------------------------------------------------------------- the pass */

describe('going through the untagged pieces one at a time', () => {
  it('writes a season on exactly the three rows she answered, and nothing anywhere else', async () => {
    await seedCloset();
    await mount();
    const before = await untouched();

    await clickNode(openButton('Top')!);
    expect(assistBox()).not.toBeNull();
    expect(modal()).toContain('Which season?');

    /* the pass is named to her before it starts, in the summary the engine prints */
    expect(assistText()).toContain('3 of 4 pieces filed under Tops carry no season at all.');
    expect(assistText()).toContain('this app has not seen the garment and will not read one off a photograph');

    /* piece 1 — nothing pre-chosen, so the save is dead until she picks for this piece */
    expect(progress()).toContain('Piece 1 of 3');
    expect(progress()).toContain('0 of 3 done');
    expect(pieceBlock()).toContain('Grey tee');
    expect(saveButton()!.disabled).toBe(true);
    await tag('Winter');

    await waitUntil('the pass to move on', () => progress().includes('Piece 2 of 3'));
    expect(progress()).toContain('1 of 3 done');
    expect(pieceBlock()).toContain('Linen shirt');
    expect(saveButton()!.disabled).toBe(true);
    await tag('Summer');

    await waitUntil('the third piece', () => progress().includes('Piece 3 of 3'));
    /* the shirt she already tagged is not in this list — it is t4, and it never shows */
    expect(pieceBlock()).toContain('Silk blouse');
    expect(assistText()).not.toContain('Summer dress shirt');
    await tag('All-season');

    await waitUntil('the pass to finish', () => modal().includes('now has an answer from you'));
    await clickText('Done');
    await settle(3);

    /* the three rows she answered */
    expect((await row('t1'))?.seasons).toEqual(['Winter']);
    expect((await row('t2'))?.seasons).toEqual(['Summer']);
    expect((await row('t3'))?.seasons).toEqual(['All-season']);
    /* tags carry the season beside whatever occasions were already there */
    expect((await row('t1'))?.tags).toEqual(['Winter']);
    /* and only the season answer changed on those rows — wears and price stay hers */
    expect((await row('t1'))?.wears).toBe(9);
    expect((await row('t1'))?.price).toBe(15);

    /* every other row is byte-for-byte what it was before the pass */
    expect(await untouched()).toBe(before);

    /* the matrix re-counted itself: tagged moved up, the untagged column emptied */
    expect(cell('Top', 'Winter')).toBe('2 (1)');
    expect(cell('Top', 'Summer')).toBe('3 (2)');
    expect(openButton('Top')).toBeNull();
    /* Bottom never entered this pass, so its hole is still printed */
    expect(openButton('Bottom')?.textContent).toContain('1 piece has no season tag');
  });

  it('a skip leaves the row exactly as it was and still counts as an answer', async () => {
    await seedCloset();
    await mount();
    const before = await untouched();
    const t1Before = JSON.stringify(await row('t1'));

    await clickNode(openButton('Top')!);
    await clickNode(skipButton()!);

    await waitUntil('the skip to move the pass on', () => progress().includes('Piece 2 of 3'));
    expect(progress()).toContain('1 of 3 done');
    expect(pieceBlock()).toContain('Linen shirt');

    await clickNode(skipButton()!);
    await clickNode(skipButton()!);
    await waitUntil('the pass to finish', () => modal().includes('Nothing left to ask'));
    await clickText('Done');
    await settle(3);

    /* nothing written, and the hole is still reported as a hole */
    expect(JSON.stringify(await row('t1'))).toBe(t1Before);
    expect(await untouched()).toBe(before);
    expect(openButton('Top')?.textContent).toContain('3 pieces have no season tag');
  });

  it('re-running the pass never re-asks a piece she has already tagged', async () => {
    await seedCloset();
    await mount();

    await clickNode(openButton('Top')!);
    await tag('Winter');
    await clickText('Stop here');
    await settle(2);

    /* the matrix already moved while the pass was only a third done: the
       winter-tagged tee plus the two blanks are still reachable */
    expect(cell('Top', 'Winter')).toBe('3 (1)');
    expect(openButton('Top')?.textContent).toContain('2 pieces have no season tag');

    await clickNode(openButton('Top')!);
    expect(progress()).toContain('Piece 1 of 2');
    expect(pieceBlock()).toContain('Linen shirt');
    const names = [pieceBlock()];
    await tag('Summer');
    await waitUntil('the second piece', () => progress().includes('Piece 2 of 2'));
    names.push(pieceBlock());
    await tag('Autumn');
    await waitUntil('the pass to finish', () => modal().includes('Nothing left to ask'));
    await clickText('Done');
    await settle(3);

    /* the tagged tee never came back, and neither did the row that was already summered */
    expect(names.join(' ')).not.toContain('Grey tee');
    expect(names.join(' ')).not.toContain('Summer dress shirt');
    expect((await row('t1'))?.seasons).toEqual(['Winter']);
    expect((await row('t3'))?.seasons).toEqual(['Autumn']);
    expect(openButton('Top')).toBeNull();
  });
});

/* -------------------------------------------------------------- no guessing */

describe('what the pass refuses to be', () => {
  it('offers no pre-filled guess and no apply-to-all — the save is dead until she picks', async () => {
    await seedCloset();
    await mount();
    await clickNode(openButton('Top')!);

    expect(saveButton()!.disabled).toBe(true);
    expect(assistText()).toContain('Nothing is chosen yet');
    expect(assistText()).toContain('This dialog will not guess from the name, the category or the photograph');
    expect([...scope().querySelectorAll('button')].some((b) => /apply to all|all pieces at once/i.test(b.textContent ?? ''))).toBe(false);

    /* a chosen word can be put back — no answer is assumed from a click on a chip alone */
    await clickNode(seasonChip('Winter')!);
    expect(saveButton()!.disabled).toBe(false);
    await clickNode(seasonChip('Winter')!);
    expect(saveButton()!.disabled).toBe(true);
    expect(assistText()).toContain('Nothing is chosen yet');
    await clickText('Stop here');
    await settle(2);
    expect((await row('t1'))?.seasons ?? []).toEqual([]);
  });

  it('says in the summary that no season was read off a photograph', async () => {
    await seedCloset(true);
    await mount();
    await clickNode(openButton('Top')!);
    expect(assistText()).toContain(
      'writes a season on the one piece you are looking at, and on nothing else — this app has not seen the garment and will not read one off a photograph'
    );
    /* the row behind the piece says its own seasons are empty — that is the whole ask */
    expect(pieceBlock()).toContain('Seasons on this row right now: none');
  });
});

/* ------------------------------------------------------------------ photos */

describe('the photograph inside the pass', () => {
  it('shows her stored picture when uploads are allowed', async () => {
    await seedCloset(true);
    await mount();
    await clickNode(openButton('Top')!);
    expect(assistBox()?.querySelector('.gl-tile')).not.toBeNull();
    expect(assistText()).toContain('your photo');
  });

  it('shows none when the privacy switch is off, and the tagging still works', async () => {
    await updateSettings({ allowUploads: false });
    await seedCloset(true);
    await mount();
    const before = await untouched();

    await clickNode(openButton('Top')!);
    expect(assistBox()?.querySelector('.gl-tile')).toBeNull();
    expect(assistText()).toContain('Photographs are switched off under Settings → Privacy');
    expect(assistText()).toContain('A season tag does not need one');

    await tag('Winter');
    await waitUntil('the pass to move on with the switch off', () => progress().includes('Piece 2 of 3'));

    /* the tagging works without the picture — it always did, because there was
       nothing in the picture to read */
    expect((await row('t1'))?.seasons).toEqual(['Winter']);
    expect(await untouched()).toBe(before);
  });
});
