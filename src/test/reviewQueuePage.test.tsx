/**
 * THE GLOW LAB — the look-alike review queue as she meets it: buttons on the
 * closet page, rows in IndexedDB.
 *
 * The split these tests exist to pin down is the one the product rule turns on.
 * Keep-both and skip are answers about *the walk*, so they must not reach her data
 * at all — the row dump is compared byte for byte around them. A merge and a "not
 * duplicates" ruling are answers about *her closet*, so they must land on the rows
 * and still be there after the page is torn down and rebuilt.
 *
 * Nothing asserts which pair comes first: the two seeded pairs score the same, so
 * the names on screen are read from the panel rather than guessed at.
 *
 * Setup follows `closetPage.test.tsx` exactly — same providers, same seed helpers,
 * same imperative click/wait idiom — so a failure here reads the same way.
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
import { REVIEW_LEDGER_KEY } from '../engine/reviewQueue';

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
/** whitespace collapsed, because the panel's sentences wrap over JSX lines */
const flat = (s: string) => s.replace(/\s+/g, ' ');
const text = () => flat(container.textContent ?? '');
const modal = () => flat(scope().textContent ?? '');
const scope = () => (container.querySelector('.gl-modal') ?? container) as HTMLElement;
/** the walk's own panel, so the ordinary candidate list below it cannot muddy a claim */
const reviewPanel = () => container.querySelector('[data-testid="dup-review"]') as HTMLElement | null;
const review = () => flat(reviewPanel()?.textContent ?? '');
/** whose two pieces the walk is showing right now, in the order the card prints them */
const shownNames = () =>
  [...(reviewPanel()?.querySelectorAll('.cl-dup__name') ?? [])].map((n) => String(n.textContent ?? '').trim());

const dump = async () =>
  JSON.stringify(
    (await db.clothingItems.orderBy('id').toArray()).map((r) => ({
      id: r.id,
      name: r.name,
      wears: r.wears,
      price: r.price,
      seasons: r.seasons,
      tags: r.tags,
      text: r.text,
      deletedAt: r.deletedAt,
      rev: r.rev,
      updatedAt: r.updatedAt,
      data: r.data
    }))
  );

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
    data: { lastWornOn: over.lastWornOn ?? null, ...(over.data as Record<string, unknown>) }
  } as never);
}

async function photoRow(id: string, phash: string) {
  await db.mediaBlobs.put({
    id: `blob-${id}`,
    blob: new Blob([`picture ${id}`], { type: 'image/jpeg' }),
    thumb: new Blob([`picture ${id}`], { type: 'image/jpeg' }),
    createdAt: Date.now(),
    bytes: 12,
    mime: 'image/jpeg'
  } as never);
  return put(
    TABLES.mediaItems,
    { id, kind: 'upload', title: `Photo ${id}`, blobId: `blob-${id}`, private: true, data: { phash } } as never
  );
}

/**
 * Two pairs, filed in categories that cannot pair with each other, so the field
 * comparison flags exactly two things and the walk has exactly two questions. Both
 * clear the floor on category + kind + colour + name.
 */
async function seedTwoPairs() {
  await piece('cl-navy', 'Navy wool blazer', 'Outerwear', { wears: 12, price: 210, colors: ['navy'] });
  await piece('cl-navy-2', 'Navy wool blazer second entry', 'Outerwear', { wears: 3, price: 90, colors: ['navy'] });
  await piece('sh-white', 'White leather sneaker', 'Footwear', { wears: 20, price: 95, colors: ['white'] });
  await piece('sh-white-2', 'White leather sneaker second entry', 'Footwear', { wears: 4, price: 88, colors: ['white'] });
}

const byId = async (id: string) => (await db.clothingItems.toArray()).find((r) => r.id === id) as AnyRow | undefined;
const idOfName = (name: string) => {
  const all: Record<string, string> = {
    'Navy wool blazer': 'cl-navy',
    'Navy wool blazer second entry': 'cl-navy-2',
    'White leather sneaker': 'sh-white',
    'White leather sneaker second entry': 'sh-white-2'
  };
  return all[name];
};
const excluded = (row?: AnyRow) => (((row?.data as Record<string, unknown>)?.dupExcluded as string[]) ?? []);

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
  localStorage.clear();
  /* settings live in a module cache for a page load, so the switch one test turns
     off would otherwise still be off for the next test in this file */
  await updateSettings({ ...DEFAULT_SETTINGS });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) unmount();
  container.remove();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------- the walk */

describe('reviewing the flagged pairs one at a time', () => {
  it('freezes the list at pair 1 of 2 and shows both pieces at full detail', async () => {
    await seedTwoPairs();
    await mount();

    expect(review()).toContain('Start review');
    await clickText('Start review');

    expect(review()).toContain('Pair 1 of 2');
    expect(shownNames()).toHaveLength(2);
    /* the panel's own card, not a redraw of it: the axis lines and the keeper rule */
    expect(reviewPanel()?.querySelector('.cl-dup')).not.toBeNull();
    expect(review()).toContain('of 24 points');
    expect(review()).toContain('keeper if you merge');
    /* and the sum a merge would write, printed before she is asked anything */
    expect(review()).toMatch(/\d+ \+ \d+ = \d+ wears/);
    expect(review()).toContain('keeper(a, b)');
    expect(review()).toContain('0 of 2 answered');
  });

  it('keep both moves to the next pair and leaves every row byte-identical', async () => {
    await seedTwoPairs();
    await mount();
    const before = await dump();

    await clickText('Start review');
    const first = shownNames();
    await clickText('Keep both');

    expect(review()).toContain('Pair 2 of 2');
    expect(review()).toContain('1 of 2 answered');
    expect(shownNames().filter((n) => first.includes(n))).toEqual([]);
    /* the whole point: an answer about the walk wrote nothing about the closet */
    expect(await dump()).toBe(before);
    const ledger = JSON.parse(String(localStorage.getItem(REVIEW_LEDGER_KEY)));
    const decisions = ledger.decisions as Record<string, { verdict: string }>;
    expect(Object.values(decisions).map((d) => d.verdict)).toEqual(['keep-both']);
  });

  it('skip defers a pair to the end of the list and asks for it again next pass', async () => {
    await seedTwoPairs();
    await mount();
    const before = await dump();

    await clickText('Start review');
    const skipped = shownNames();
    await clickText('Skip this pair');

    /* the other pair came forward; the skipped one went to the back */
    expect(review()).toContain('Pair 1 of 2');
    expect(shownNames().filter((n) => skipped.includes(n))).toEqual([]);
    expect(review()).toContain('0 of 2 answered');
    expect(review()).toContain('1 skipped at least once');

    await clickText('Keep both');
    expect(review()).toContain('Pass 1 finished');
    expect(review()).toContain('Go round again for the 1 skipped');
    /* a skipped pair is not counted as reviewed */
    expect(review()).toContain('1 of 2 answered');

    await clickText('Go round again');
    /* the deferred pair sits where a skip put it: at the end of the list */
    expect(review()).toContain('Pair 2 of 2');
    expect(shownNames().sort()).toEqual(skipped.sort());
    expect(review()).toContain('pass 2');
    expect(await dump()).toBe(before);
  });

  it('stopping and starting again does not re-ask a pair she already answered', async () => {
    await seedTwoPairs();
    await mount();
    await clickText('Start review');
    const answered = shownNames();
    await clickText('Keep both');
    await clickText('Stop review');

    expect(review()).toContain('Start review');
    /* the queue is closed, so the ordinary candidate list is back to showing both */
    expect(container.querySelectorAll('#cl-duplicates .cl-dup').length).toBe(2);

    await clickText('Start review');
    expect(review()).toContain('Pair 2 of 2');
    expect(shownNames().filter((n) => answered.includes(n))).toEqual([]);
  });

  it('merges through the panel’s own confirm step, not around it', async () => {
    await seedTwoPairs();
    await mount();
    await clickText('Start review');

    const wears = new Map((await db.clothingItems.toArray()).map((r) => [r.id, r.wears ?? 0]));
    const [firstName, secondName] = shownNames();
    const [one, two] = [idOfName(firstName), idOfName(secondName)];
    /* the keeper rule this app prints: more logged wears wins */
    const [keeperId, givenId] = (wears.get(one) ?? 0) > (wears.get(two) ?? 0) ? [one, two] : [two, one];
    const givenName = keeperId === one ? secondName : firstName;
    const keeperName = keeperId === one ? firstName : secondName;
    const sum = (wears.get(one) ?? 0) + (wears.get(two) ?? 0);

    expect(text()).toContain(`Merge the wears onto “${keeperName}”`);
    await clickText('Merge the wears onto');
    /* the same dialog the button in the list below opens, arithmetic and all */
    expect(modal()).toContain('Move the wears');
    expect(modal()).toContain(`${wears.get(keeperId)} + ${wears.get(givenId)} = ${sum} wears`);
    expect(modal()).toContain('Cost per wear');

    await clickText('Move the wears');
    await waitUntil('the walk to move past the merged pair', () => !review().includes('Pair 1 of 2') || review().includes('Pass 1 finished'));

    const keeperRow = (await byId(keeperId)) as AnyRow;
    const givenRow = (await byId(givenId)) as AnyRow;
    expect(keeperRow.wears).toBe(sum);
    expect(givenRow.wears).toBe(0);
    /* the real behaviour of this page's merge: the giving row keeps itself */
    expect(givenRow.deletedAt).toBeNull();
    expect((givenRow.data as Record<string, unknown>).mergedInto).toBe(keeperId);
    expect((givenRow.data as Record<string, unknown>).wearsBeforeMerge).toBe(wears.get(givenId));
    expect((givenRow.data as Record<string, unknown>).dupOf).toBe(keeperId);

    expect(review()).toContain('1 of 2 answered');
    /* answered, so the walk never offers that merge a second time */
    await clickText('Stop review');
    await clickText('Start review');
    expect(review()).toContain('Pair 2 of 2');
    expect(shownNames()).not.toContain(givenName);
    /* and the undo the panel already had is still the way back */
    expect(text()).toContain(`Undo the merge on “${givenName}”`);
  });

  it('cancelling the confirm step leaves the pair unanswered and the rows alone', async () => {
    await seedTwoPairs();
    await mount();
    const before = await dump();
    await clickText('Start review');
    await clickText('Merge the wears onto');
    await clickText('Cancel — change nothing');

    expect(await dump()).toBe(before);
    expect(review()).toContain('Pair 1 of 2');
    expect(review()).toContain('0 of 2 answered');
    expect(localStorage.getItem(REVIEW_LEDGER_KEY)).toContain('"decisions":{}');
  });

  it('drops the merged pair from the walk even though both rows are still there', async () => {
    await seedTwoPairs();
    await mount();
    await clickText('Start review');
    const merged = shownNames();
    await clickText('Merge the wears onto');
    await clickText('Move the wears');
    await waitUntil('the pass to move on', () => !review().includes('Pair 1 of 2') || review().includes('Pass 1 finished'));

    /* both rows still exist, and the panel below still lists them as candidates */
    for (const name of merged) expect(await byId(idOfName(name))).toBeTruthy();

    /* the walk has nothing left to ask about them, and cannot point at a dead merge */
    await clickText('Stop review');
    await clickText('Start review');
    expect(shownNames().filter((n) => merged.includes(n))).toEqual([]);
  });
});

/* ------------------------------------------------------------- ruling a pair out */

describe('ruling a pair out of the candidate list', () => {
  it('writes the note on both rows, drops the pair, and survives a remount', async () => {
    await seedTwoPairs();
    await mount();
    await clickText('Start review');
    const [leftName, rightName] = shownNames();
    const left = idOfName(leftName);
    const right = idOfName(rightName);
    const wears = new Map((await db.clothingItems.toArray()).map((r) => [r.id, r.wears ?? 0]));

    await clickText('Not duplicates');
    await waitUntil('the walk to move on', () => !shownNames().includes(rightName));

    const rowA = (await byId(left)) as AnyRow;
    const rowB = (await byId(right)) as AnyRow;
    expect(excluded(rowA)).toContain(right);
    expect(excluded(rowB)).toContain(left);
    /* a note she can read on the piece, and nothing else about either row */
    expect(String((rowA.data as Record<string, unknown>).dupNote)).toContain('Ruled out as a duplicate of');
    expect(rowA.wears).toBe(wears.get(left));
    expect(rowB.wears).toBe(wears.get(right));
    expect(rowA.deletedAt).toBeNull();
    expect(rowB.deletedAt).toBeNull();

    expect(review()).toContain('0 of 1 answered');
    expect(review()).toContain('1 ruled out as not duplicates');

    /* she closes the walk before reloading — the ledger is what survives */
    await clickText('Stop review');

    unmount();
    container = document.createElement('div');
    document.body.appendChild(container);
    await mount();

    /* the rows remember it, so `duplicatePairs` never offers the pair again */
    expect(review()).toContain('1 pair flagged');
    const duplicatesSection = () => flat(container.querySelector('#cl-duplicates')?.textContent ?? '');
    expect(container.querySelectorAll('#cl-duplicates .cl-dup').length).toBe(1);
    expect(duplicatesSection()).not.toContain(rightName);

    await clickText('Start review');
    expect(review()).toContain('Pair 1 of 1');
    expect(shownNames()).not.toContain(rightName);
    expect(shownNames()).not.toContain(leftName);
  });

  it('a ruling clears by clearing the note, which the page says so', async () => {
    await seedTwoPairs();
    await mount();
    await clickText('Start review');
    await clickText('Not duplicates');
    await settle(6);
    expect(text()).toContain('until you clear the note');
  });
});

/* ------------------------------------------------------------------ photo pairs */

describe('the photograph distance inside the walk', () => {
  it('prints the fingerprint line when the pixel check reached the same pair', async () => {
    /* two signatures differing in 2 of 64 bits — inside the floor of 6 */
    await photoRow('md-a', '0000000000000000');
    await photoRow('md-b', '0000000000000003');
    await piece('tp-one', 'Grey cotton tee', 'Tops', { wears: 6, price: 20, colors: ['grey'], mediaId: 'md-a' });
    await piece('tp-two', 'Grey cotton tee second entry', 'Tops', { wears: 1, price: 18, colors: ['grey'], mediaId: 'md-b' });
    await mount();

    await clickText('Start review');
    expect(review()).toContain('Pair 1 of 1');
    expect(review()).toContain('2 of 64 fingerprint bits');
    expect(review()).toContain('the pixel check');
  });

  it('walks a pair the photographs found even when the typed fields stayed quiet', async () => {
    /* filed so differently the 24-point frame cannot reach half of itself */
    await photoRow('md-c', '0000000000000000');
    await photoRow('md-d', '000000000000000f');
    await piece('cl-x', 'Gift from Sam', 'Accessories', { wears: 2, mediaId: 'md-c' });
    await piece('cl-y', 'Charity shop find', 'Sleep & Lounge', { wears: 0, mediaId: 'md-d' });
    await mount();

    expect(text()).toContain('1 photo pair close');
    await clickText('Start review');
    expect(review()).toContain('Pair 1 of 1');
    expect(shownNames().sort()).toEqual(['Charity shop find', 'Gift from Sam']);
    expect(review()).toContain('4 of 64 fingerprint bits');
  });
});

/* ---------------------------------------------------------------- the honest copy */

describe('what the panel says about itself', () => {
  it('names the browser storage the walk lives in and the rows the answers live on', async () => {
    await seedTwoPairs();
    await mount();
    expect(text()).toContain('glowlab.dupReview.v1');
    expect(text()).toContain('this browser’s storage');
    expect(text()).toContain('database writes on the rows');
    expect(text()).toContain('Nothing is decided for you');
  });

  it('offers no walk when the comparison has flagged nothing', async () => {
    await piece('only-one', 'Lone cardigan', 'Knitwear', { wears: 3 });
    await mount();
    expect(reviewPanel()).toBeNull();
    expect(text()).not.toContain('Start review');
  });
});
