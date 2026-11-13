import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProgressPage from '../pages/ProgressPage';
import { ToastHost } from '../ui/primitives';
import { TABLES } from '../db/schema';
import { db } from '../db/db';
import { put, todayISO } from '../db/repo';
import { DEFAULT_SETTINGS, updateSettings } from '../state/settings';

/**
 * The N-shot same-framing capture set, driven the way she would drive it: open a
 * check-in, choose how many shots the set is, feed one file per slot, then store.
 *
 * The ordering and comparability arithmetic is pure and tested in
 * `shotGrid.test.ts`. What these tests hold the page to is the part only the
 * page can prove: that a finished set becomes ONE `progressEntries` row whose
 * `mediaIds` are the shots in slot order, that a retake swaps that slot's id and
 * releases the frame it displaced, that the privacy switch refuses the whole
 * flow and writes nothing, that the summary names the shots recorded
 * differently from the reference, and that discard leaves neither an entry nor a
 * media row behind — while never touching frames a stored row already points at.
 */

type AnyRow = Record<string, any>;

/* ---------------------------------------------------------------- fake decoder
   jsdom has no image decoder, so the ingest pipeline runs against the same
   stubs `media.test.ts` uses: the rules under test are Glow Lab's own. */

class FakeImage {
  naturalWidth = 1200;
  naturalHeight = 2600;
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

HTMLCanvasElement.prototype.getContext = (() => ctx2d) as unknown as typeof HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.toBlob = ((cb: (b: Blob | null) => void, type?: string) =>
  cb(new Blob([new Uint8Array(64)], { type: type ?? 'image/webp' }))
) as unknown as typeof HTMLCanvasElement.prototype.toBlob;

let container: HTMLDivElement;
let root: Root;

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const settle = async (rounds = 3) => {
  for (let i = 0; i < rounds; i += 1) await act(async () => tick(15));
};

const text = () => container.textContent ?? '';
const scope = () => (container.querySelector('.gl-modal') ?? container) as HTMLElement;

function must<T>(node: T | null | undefined, what: string): T {
  if (!node) throw new Error(`missing ${what}`);
  return node;
}

function findButton(label: string, within: HTMLElement = scope()) {
  const needle = label.toLowerCase();
  return [...within.querySelectorAll('button')].find(
    (b) =>
      (b.textContent ?? '').trim().toLowerCase().includes(needle) ||
      (b.getAttribute('aria-label') ?? '').toLowerCase().includes(needle)
  );
}

async function clickNode(node: Element) {
  await act(async () => {
    (node as HTMLElement).click();
    await tick(20);
  });
  await settle(2);
}

async function clickText(label: string, within?: HTMLElement) {
  const node = findButton(label, within);
  if (!node) throw new Error(`no button matching “${label}”`);
  await clickNode(node);
  return node as HTMLButtonElement;
}

function fieldNode(labelText: string, within: HTMLElement = scope()) {
  return [...within.querySelectorAll('label.gl-field')].find((l) => (l.textContent ?? '').includes(labelText)) ?? null;
}

async function setValue(input: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = input instanceof HTMLSelectElement ? window.HTMLSelectElement : window.HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    await tick(15);
  });
  await settle(1);
}

async function typeInto(labelText: string, value: string) {
  const input = must(fieldNode(labelText)?.querySelector('input, textarea'), `input for “${labelText}”`) as HTMLInputElement;
  await setValue(input, value);
}

async function waitUntil(what: string, done: () => boolean | Promise<boolean>, budget = 15000) {
  const started = Date.now();
  for (;;) {
    if (await done()) return;
    if (Date.now() - started > budget) throw new Error(`timed out waiting for ${what}`);
    await act(async () => {
      await tick(25);
    });
  }
}

/* ---------------------------------------------------------------- grid handles */

const grid = () => must(container.querySelector('[data-testid="shot-grid"]') as HTMLElement | null, 'the shot grid');
const inGrid = (name: string) => grid().querySelector(`[data-testid="${name}"]`) as HTMLElement | null;
const gridText = () => grid().textContent ?? '';
const slotText = (n: number) => must(inGrid(`shot-slot-${n}`), `slot ${n}`).textContent ?? '';
const filled = (n: number) => inGrid(`shot-slot-${n}`)?.getAttribute('data-filled') === 'true';
const isDisabled = (name: string) => (must(inGrid(name), name) as HTMLButtonElement).disabled;

/** The grid's own picker, not one nested inside the reference guide. */
const fileInput = () =>
  must(grid().querySelector(':scope > input[type="file"]') as HTMLInputElement | null, 'the grid’s file input');

/** Distinct bytes per call, so no two shots dedupe onto each other. */
const photo = (seed: number) =>
  new File([Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, seed])], `shot-${seed}.jpg`, { type: 'image/jpeg' });

async function mediaRows(): Promise<AnyRow[]> {
  return (await db.mediaItems.toArray()) as AnyRow[];
}

const idOfShot = async (n: number) => {
  const hit = (await mediaRows()).find((r) => String(r.title).startsWith(`Shot ${n} `));
  if (!hit) throw new Error(`no stored row for shot ${n}`);
  return String(hit.id);
};

/** Press the grid's capture control and hand it the file she "chose". */
async function capture(seed: number, expectedCount: number) {
  const before = new Set((await mediaRows()).map((r) => String(r.id)));
  await clickNode(must(inGrid('shot-capture'), 'the capture control'));
  const input = fileInput();
  Object.defineProperty(input, 'files', { value: [photo(seed)], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(20);
  });
  await waitUntil(
    `shot ${seed} stored`,
    async () => {
      const rows = await mediaRows();
      return rows.some((r) => !before.has(String(r.id))) && rows.length === expectedCount && !isDisabled('shot-capture');
    }
  );
  await settle(2);
}

/** Retake one named slot: the file belongs to that slot, not to whichever is active. */
async function retake(slotN: number, seed: number, expectedCount: number) {
  const slot = must(inGrid(`shot-slot-${slotN}`), `slot ${slotN}`);
  const button = must(slot.querySelector('[data-testid="shot-retake"]'), `retake control on slot ${slotN}`);
  const before = new Set((await mediaRows()).map((r) => String(r.id)));
  await clickNode(button);
  const input = fileInput();
  Object.defineProperty(input, 'files', { value: [photo(seed)], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(20);
  });
  await waitUntil(
    `retake of slot ${slotN} stored`,
    async () => {
      const rows = await mediaRows();
      return rows.some((r) => !before.has(String(r.id))) && rows.length === expectedCount && !isDisabled('shot-capture');
    }
  );
  await settle(2);
}

/** Point the working panel at one slot, the way clicking its own caption would. */
async function workOn(slotN: number) {
  await clickNode(must(inGrid(`shot-slot-${slotN}`)?.querySelector('button'), `the work button on slot ${slotN}`));
}

async function chooseInGrid(labelText: string, value: string) {
  const select = must(fieldNode(labelText, grid())?.querySelector('select'), `select for “${labelText}” in the grid`) as HTMLSelectElement;
  await setValue(select, value);
}

/** The grid's own store step: it attaches ids, it does not write the row. */
async function attachToCheckIn() {
  await clickNode(must(inGrid('shot-save'), 'the save control'));
  await settle(2);
}

async function storeCheckIn(label = 'Week 8 same-framing set') {
  await attachToCheckIn();
  await typeInto('Label', label);
  await clickText('Store check-in');
  await waitUntil('the check-in row', async () => (await db.progressEntries.count()) === 1);
  await settle(2);
}

async function storedEntry(): Promise<AnyRow> {
  const rows = (await db.progressEntries.toArray()) as AnyRow[];
  expect(rows).toHaveLength(1);
  return rows[0];
}

const storedIds = async () => (((await storedEntry()).mediaIds as string[]) ?? []).map(String);
const titlesOf = async (ids: string[]) =>
  Promise.all(ids.map(async (id) => String(((await db.mediaItems.get(id)) as AnyRow | undefined)?.title ?? 'gone')));

/** A photograph already in the library, with the blob row a viewer would need. */
async function seedPhoto(id: string) {
  await db.mediaBlobs.put({
    id: `blob-${id}`,
    blob: new Blob([`picture ${id}`], { type: 'image/jpeg' }),
    thumb: new Blob([`thumb ${id}`], { type: 'image/jpeg' }),
    createdAt: Date.now(),
    bytes: 12,
    mime: 'image/jpeg'
  } as never);
  return put(TABLES.mediaItems, {
    id,
    kind: 'progress',
    title: `Stored ${id}`,
    blobId: `blob-${id}`,
    private: true,
    lighting: 'Window light',
    distance: '60cm phone',
    conditions: 'Progress check'
  } as never);
}

async function seedEntry(id: string, mediaIds: string[]) {
  return put(
    TABLES.progressEntries,
    { id, label: 'Already stored set', domain: 'skin', on: todayISO(), note: '', metric: '', value: null, unit: '', rating: null, mediaIds } as never
  );
}

/* ------------------------------------------------------------------- lifecycle */

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
  localStorage.clear();
  await updateSettings({ ...DEFAULT_SETTINGS });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ToastHost>
          <ProgressPage />
        </ToastHost>
      </MemoryRouter>
    );
  });
  await settle(5);
});

afterEach(() => {
  root?.unmount();
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openCheckIn() {
  await clickText('Log a check-in');
  await settle(2);
}

describe('the grid as a control surface', () => {
  it('names the controls the brief promises, and refuses the ones nothing backs', async () => {
    await openCheckIn();
    expect(container.querySelector('[data-testid="shot-grid"]')).toBeTruthy();
    for (const name of ['shot-target', 'shot-capture', 'shot-conditions', 'shot-summary', 'shot-save', 'shot-discard']) {
      expect(inGrid(name), name).toBeTruthy();
    }
    for (let n = 1; n <= 4; n += 1) expect(inGrid(`shot-slot-${n}`)).toBeTruthy();
    expect(gridText()).toContain('0 of 4 captured');
    expect(slotText(1)).toContain('Front');
    expect(slotText(4)).toContain('Detail');
    // nothing shot yet: no retake anywhere, nothing to store, nothing to discard
    expect(grid().querySelectorAll('[data-testid="shot-retake"]')).toHaveLength(0);
    expect(isDisabled('shot-save')).toBe(true);
    expect(isDisabled('shot-discard')).toBe(true);
  });

  it('states the limit of the set in the same words the summary uses', async () => {
    await openCheckIn();
    const summary = must(inGrid('shot-summary'), 'the summary').textContent ?? '';
    expect(summary).toContain('No shot taken yet in this set');
    expect(summary).toContain('two different sets, or a set and a casual selfie, are not');
  });
});

describe('shooting a four-frame set', () => {
  it('fills four slots and stores one check-in whose mediaIds are the shots in slot order', async () => {
    await openCheckIn();

    await capture(1, 1);
    expect(filled(1)).toBe(true);
    expect(gridText()).toContain('1 of 4 captured');

    await capture(2, 2);
    await capture(3, 3);
    await capture(4, 4);

    expect([1, 2, 3, 4].map(filled)).toEqual([true, true, true, true]);
    expect(gridText()).toContain('4 of 4 captured');
    expect(await db.mediaItems.count()).toBe(4);
    expect(await db.mediaBlobs.count()).toBe(4);

    // the grid's own store step only attaches: the row is written by the check-in
    await attachToCheckIn();
    expect(await db.progressEntries.count()).toBe(0);

    await storeCheckIn();
    const ids = await storedIds();
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(await titlesOf(ids)).toEqual(['Shot 1 — Front', 'Shot 2 — Side', 'Shot 3 — Back', 'Shot 4 — Detail']);
    expect(await db.progressEntries.count()).toBe(1);
  });

  it('saves a half-shot set as what was actually shot, empty slots still empty', async () => {
    await openCheckIn();
    await capture(5, 1);

    expect(gridText()).toContain('1 of 4 shots captured');
    expect(gridText()).toContain('shots 2, 3 and 4 still empty');
    expect(gridText()).toContain('no placeholder frame is written');
    expect([2, 3, 4].map(filled)).toEqual([false, false, false]);

    await storeCheckIn('Half-shot set');
    const ids = await storedIds();
    expect(ids).toHaveLength(1);
    expect(await titlesOf(ids)).toEqual(['Shot 1 — Front']);
    expect(await db.mediaItems.count()).toBe(1);
  });

  it('takes the first shot as the reference and lines later slots up against it', async () => {
    await openCheckIn();
    // before anything is shot there is no reference and nothing to ghost
    await clickText('Line up first', grid());
    expect(grid().querySelector('img[alt="The reference photograph"]')).toBeNull();

    await capture(6, 1);
    expect(slotText(1)).toContain('reference');
    expect(slotText(2)).not.toContain('reference');

    await clickText('Line up against shot 1', grid());
    expect(grid().querySelector('.sg__lineup .gg')).toBeTruthy();
    await waitUntil('the reference frame in the guide', () => Boolean(grid().querySelector('img[alt="The reference photograph"]')));

    // the guide is the same overlay the rest of the app uses, not a second one
    expect(grid().querySelectorAll('.gg')).toHaveLength(1);
    await capture(7, 2);
    expect(filled(2)).toBe(true);
    // a later shot never displaces the reference slot
    expect(slotText(1)).toContain('reference');
  });

  it('grows the set on request and refuses to shrink past a frame she already shot', async () => {
    await openCheckIn();
    await capture(8, 1);

    await chooseInGrid('Shots in this set', '6');
    expect(grid().querySelectorAll('[data-testid^="shot-slot-"]')).toHaveLength(6);
    expect(gridText()).toContain('1 of 6 captured');

    // a framing she shot late in the set is the reason a smaller number is refused
    await workOn(5);
    await capture(9, 2);
    expect(gridText()).toContain('2 of 6 captured');

    await chooseInGrid('Shots in this set', '3');
    expect(grid().querySelectorAll('[data-testid^="shot-slot-"]')).toHaveLength(6);
    expect(gridText()).toContain('shot 5 (Free)');
    expect(gridText()).toContain('Retake or clear it first, or leave the set at 6');
    // and empty slots go without a fight
    await chooseInGrid('Shots in this set', '5');
    expect(grid().querySelectorAll('[data-testid^="shot-slot-"]')).toHaveLength(5);
    expect(gridText()).toContain('2 of 5 captured');
    expect(await db.mediaItems.count()).toBe(2);
  });
});

describe('retaking one slot', () => {
  it('replaces that slot’s id, releases the frame it displaced, and leaves the other three alone', async () => {
    await openCheckIn();
    await capture(10, 1);
    await capture(11, 2);
    await capture(12, 3);
    await capture(13, 4);

    const keep1 = await idOfShot(1);
    const keep2 = await idOfShot(2);
    const dropped = await idOfShot(3);
    const keep4 = await idOfShot(4);

    await retake(3, 14, 4);

    // the displaced frame is gone, row and image data both, so no orphan is left
    expect(await db.mediaItems.get(dropped)).toBeFalsy();
    expect(await db.mediaBlobs.count()).toBe(4);
    expect(await mediaRows()).toHaveLength(4);
    expect(slotText(3)).toContain('Back');

    await storeCheckIn();
    const ids = await storedIds();
    expect(ids).toHaveLength(4);
    expect(ids[0]).toBe(keep1);
    expect(ids[1]).toBe(keep2);
    expect(ids[3]).toBe(keep4);
    expect(ids[2]).not.toBe(dropped);
    expect(ids[2]).toBe(await idOfShot(3));
    expect(await titlesOf(ids)).toEqual(['Shot 1 — Front', 'Shot 2 — Side', 'Shot 3 — Back', 'Shot 4 — Detail']);
  });

  it('keeps a slot’s own frame when she retakes the reference slot', async () => {
    await openCheckIn();
    await capture(15, 1);
    await capture(16, 2);
    const second = await idOfShot(2);

    await retake(1, 17, 2);
    expect(slotText(1)).toContain('reference');
    expect(await idOfShot(2)).toBe(second);

    await storeCheckIn();
    const ids = await storedIds();
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(second);
    expect(ids[0]).not.toBe(second);
  });
});

describe('the set’s own condition read-out', () => {
  it('names the shot recorded differently from the reference, and on what', async () => {
    await openCheckIn();
    await capture(20, 1);

    // slot 2 goes out under a different light on purpose
    await workOn(2);
    await chooseInGrid('Lighting', 'Overhead indoor');
    await capture(21, 2);
    await capture(22, 3);

    const summary = must(inGrid('shot-summary'), 'the summary').textContent ?? '';
    expect(summary).toContain('Recorded differently from shot 1 (Front)');
    expect(summary).toContain('shot 2 (Side)');
    expect(summary).toContain('Lighting: Window light vs Overhead indoor');
    expect(summary).toContain('not interchangeable with the reference');
    // a shot that matches is not dragged into the list
    expect(summary).not.toContain('shot 3 (Back) —');
    // what the set guarantees, and what it cannot
    expect(summary).toContain('Glow Lab reads no pixels');

    const row = (await db.mediaItems.get(await idOfShot(2))) as AnyRow;
    expect(row.lighting).toBe('Overhead indoor');
    expect(((await db.mediaItems.get(await idOfShot(1))) as AnyRow).lighting).toBe('Window light');
  });

  it('says the shots agree when nothing was changed, instead of inventing a difference', async () => {
    await openCheckIn();
    await capture(23, 1);
    await capture(24, 2);
    const summary = must(inGrid('shot-summary'), 'the summary').textContent ?? '';
    expect(summary).toContain('records the same conditions, lighting and distance');
    expect(summary).not.toContain('Recorded differently');
  });
});

describe('discarding a sequence', () => {
  it('leaves no entry and no media row, image data included', async () => {
    await openCheckIn();
    await capture(30, 1);
    await capture(31, 2);
    expect(await db.mediaItems.count()).toBe(2);
    expect(await db.mediaBlobs.count()).toBe(2);

    await clickNode(must(inGrid('shot-discard'), 'the discard control'));
    expect(gridText()).toContain('It cannot be undone, and there is no server copy');
    // a second press is the only way through
    await clickText('Keep them', grid());
    expect(await db.mediaItems.count()).toBe(2);

    await clickNode(must(inGrid('shot-discard'), 'the discard control'));
    await clickText('Yes, delete them', grid());
    await waitUntil('the frames gone', async () => (await db.mediaItems.count()) === 0);
    await settle(2);

    expect(await db.mediaItems.count()).toBe(0);
    expect(await db.mediaBlobs.count()).toBe(0);
    expect(await db.progressEntries.count()).toBe(0);
    expect(gridText()).toContain('0 of 4 captured');
    expect([1, 2, 3, 4].map(filled)).toEqual([false, false, false, false]);
  });

  it('never deletes frames a stored check-in already points at', async () => {
    await seedPhoto('m-old-1');
    await seedPhoto('m-old-2');
    await seedEntry('prg-old', ['m-old-1', 'm-old-2']);
    await settle(2);

    await clickText('Edit check-in');
    await settle(2);
    expect(container.querySelector('.gl-modal')).toBeTruthy();

    await capture(35, 3);
    expect(await db.mediaItems.count()).toBe(3);

    await clickNode(must(inGrid('shot-discard'), 'the discard control'));
    await clickText('Yes, delete them', grid());
    await waitUntil('only the new frame gone', async () => (await db.mediaItems.count()) === 2);
    await settle(2);

    expect(await db.mediaItems.get('m-old-1')).toBeTruthy();
    expect(await db.mediaItems.get('m-old-2')).toBeTruthy();
    expect(await db.mediaBlobs.count()).toBe(2);
    // the stored row keeps its two frames until she saves over it
    expect(await storedIds()).toEqual(['m-old-1', 'm-old-2']);
  });
});

describe('capture switched off in Settings → Privacy', () => {
  it('refuses the whole sequence and writes nothing', async () => {
    await updateSettings({ allowUploads: false });
    await openCheckIn();

    expect(gridText()).toContain('Adding photographs is off — your existing library is untouched');
    expect(gridText()).toContain('so no sequence was started. Nothing was captured and nothing was written.');
    // the sequence controls are not merely disabled — they are not there
    for (const name of ['shot-capture', 'shot-save', 'shot-discard', 'shot-target', 'shot-conditions', 'shot-summary']) {
      expect(inGrid(name), name).toBeNull();
    }
    expect(grid().querySelectorAll('[data-testid^="shot-slot-"]')).toHaveLength(0);
    expect(grid().querySelector('input[type="file"]')).toBeNull();
    // the single-photo picker beside it refuses in the same words
    expect(text()).toContain('Capture is off');
    // and the check-in can still be stored without a frame
    await typeInto('Label', 'No photos allowed');
    await clickText('Store check-in');
    await waitUntil('the photo-less row', async () => (await db.progressEntries.count()) === 1);

    expect(await storedIds()).toEqual([]);
    expect(await db.mediaItems.count()).toBe(0);
    expect(await db.mediaBlobs.count()).toBe(0);
  });
});
