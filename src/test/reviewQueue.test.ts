/**
 * THE GLOW LAB — the look-alike review queue, engine only.
 *
 * Nothing here renders a page or writes a row: the point of these tests is that
 * the walk is arithmetic over a list of pairs and a ledger of her answers. Where
 * a decision has a database side (a merge, a "not duplicates" ruling) the engine's
 * job stops at remembering that she made it, so that is what is asserted — plus
 * the two properties the panel depends on: a pair she answered is not asked again,
 * and a pair whose rows collapsed is not offered at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { duplicatePairs, keeper, wardrobeSignature } from '../engine/duplicates';
import {
  REVIEW_LEDGER_KEY,
  REVIEW_LEDGER_VERSION,
  buildQueue,
  counts,
  decide,
  emptyLedger,
  nextLap,
  nextPair,
  parseLedger,
  positionOf,
  queueLine,
  queuePair,
  readLedger,
  serializeLedger,
  startReview,
  stopReview,
  suppresses,
  suppressedKeys,
  unqueued,
  undecided,
  writeLedger,
  type QueuePair,
  type ReviewLedger
} from '../engine/reviewQueue';

/* ------------------------------------------------------------------- fixtures */

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    /* a real `clothingItems` row shape — the signature engine tells a closet row
       from a market candidate by these, and the keeper rule reads `wears` off it */
    createdAt: 1000,
    updatedAt: 1000,
    deletedAt: null,
    rev: 1,
    deviceId: 'test',
    tags: [],
    text: '',
    name: `Piece ${id}`,
    category: 'Outerwear',
    brand: '',
    colors: [],
    size: '',
    material: '',
    fit: '',
    price: null,
    boughtOn: '2024-01-01',
    seasons: [],
    occasions: [],
    wears: 0,
    mediaId: null,
    careNotes: '',
    data: {},
    ...over
  } as never;
}

const P = (a: string, b: string, origin: 'fields' | 'photo' = 'fields'): QueuePair => queuePair(a, b, a, origin);
const THREE = [P('a', 'b'), P('c', 'd'), P('e', 'f')];
const TODAY = '2026-11-12';

/** Open a review over `pairs` and hand back the ledger the page would hold. */
function open(pairs: readonly QueuePair[] = THREE): ReviewLedger {
  return startReview(pairs, emptyLedger(), TODAY);
}

const queueOf = (ledger: ReviewLedger, pairs: readonly QueuePair[] = THREE) => buildQueue(pairs, ledger, TODAY);

beforeEach(() => {
  localStorage.clear();
});

/* -------------------------------------------------------------------- building */

describe('freezing the list', () => {
  it('keeps the order the panel was showing when the review started', () => {
    const ledger = open(THREE);
    const q = queueOf(ledger);
    expect(q.order).toEqual(['a~b', 'c~d', 'e~f']);
    expect(q.open).toBe(true);
    expect(q.startedAt).toBe(TODAY);
    expect(nextPair(q, ledger)?.pairId).toBe('a~b');
    expect(positionOf(q, ledger)).toBe(1);
  });

  it('names a pair by its two row ids, so the same two pieces get one place', () => {
    expect(queuePair('zulu', 'alpha', 'zulu', 'fields').pairId).toBe('alpha~zulu');
    const ledger = open([P('a', 'b'), P('b', 'a')]);
    expect(queueOf(ledger).order).toEqual(['a~b']);
  });

  it('does not freeze an order until a review is started', () => {
    const q = buildQueue(THREE, emptyLedger(), TODAY);
    expect(q.open).toBe(false);
    expect(emptyLedger().order).toEqual([]);
    /* the frozen order is what the page walks, and the page only walks it while a
       review is open — stopping one keeps the order and every answer */
    const stopped = stopReview(open(THREE), TODAY);
    expect(stopped.order).toEqual(['a~b', 'c~d', 'e~f']);
    expect(stopped.decisions).toEqual({});
    /* while no review is open the queue is simply the live list, in the order the
       panel produced it — the frozen order starts again at "Start review" */
    expect(buildQueue([P('c', 'd'), P('a', 'b')], stopped, TODAY).order).toEqual(['c~d', 'a~b']);
    expect(buildQueue([P('c', 'd'), P('a', 'b')], { ...stopped, open: true }, TODAY).order).toEqual(['a~b', 'c~d']);
  });

  it('starts at pass 1 and keeps the answers a previous pass already has', () => {
    let ledger = open(THREE);
    ledger = decide(ledger, 'a~b', 'keep-both', TODAY);
    ledger = stopReview(ledger, TODAY);
    expect(ledger.decisions['a~b'].verdict).toBe('keep-both');
    ledger = startReview(THREE, ledger, TODAY);
    expect(ledger.lap).toBe(1);
    expect(queueOf(ledger).order).toEqual(['a~b', 'c~d', 'e~f']);
    expect(nextPair(queueOf(ledger), ledger)?.pairId).toBe('c~d');
  });
});

/* ------------------------------------------------------------------- decisions */

describe('answering one pair at a time', () => {
  it('a skip goes to the back of the list and is not asked again in this pass', () => {
    let ledger = open(THREE);
    ledger = decide(ledger, 'a~b', 'skip', TODAY);
    const q = queueOf(ledger);
    expect(q.order).toEqual(['c~d', 'e~f', 'a~b']);
    expect(nextPair(q, ledger)?.pairId).toBe('c~d');

    ledger = decide(ledger, 'c~d', 'keep-both', TODAY);
    ledger = decide(ledger, 'e~f', 'keep-both', TODAY);
    /* the pass ends at the pair she skipped — it waits for the next pass */
    expect(nextPair(queueOf(ledger), ledger)).toBeNull();
  });

  it('a skipped pair comes back on the next pass and nothing else does', () => {
    let ledger = open(THREE);
    ledger = decide(ledger, 'a~b', 'skip', TODAY);
    ledger = decide(ledger, 'c~d', 'keep-both', TODAY);
    ledger = decide(ledger, 'e~f', 'not-duplicates', TODAY);
    ledger = nextLap(ledger, TODAY);
    const q = queueOf(ledger);
    expect(q.lap).toBe(2);
    expect(nextPair(q, ledger)?.pairId).toBe('a~b');
    /* an answer that closed a pair stays closed across passes */
    ledger = decide(ledger, 'a~b', 'merge', TODAY);
    expect(nextPair(queueOf(ledger), ledger)).toBeNull();
  });

  it('stamps the answer with the pair, the keeper it was given and the day', () => {
    const pair = queuePair('a', 'b', 'b', 'photo');
    const ledger = decide(open([]), 'a~b', 'merge', TODAY, pair);
    const d = ledger.decisions['a~b'];
    expect(d).toMatchObject({ pairId: 'a~b', verdict: 'merge', at: TODAY, aId: 'a', bId: 'b', keeperId: 'b', origin: 'photo', lap: 1 });
    /* a non-merge answer records no survivor, because it writes nothing */
    expect(decide(ledger, 'a~b', 'keep-both', TODAY).decisions['a~b'].keeperId).toBeNull();
  });

  it('refuses a verdict it does not know and a pair it cannot name', () => {
    const ledger = open(THREE);
    expect(decide(ledger, 'a~b', 'delete-both' as never, TODAY)).toBe(ledger);
    expect(decide(ledger, 'x~y', 'keep-both', TODAY)).toBe(ledger);
    expect(Object.keys(ledger.decisions)).toEqual([]);
  });

  it('putting a decision back is hers to ask for, and only that', () => {
    let ledger = open(THREE);
    ledger = decide(ledger, 'a~b', 'keep-both', TODAY);
    ledger = undecided(ledger, 'a~b', TODAY);
    expect(ledger.decisions['a~b']).toBeUndefined();
    expect(nextPair(queueOf(ledger), ledger)?.pairId).toBe('a~b');
    expect(undecided(ledger, 'a~b', TODAY)).toBe(ledger);
  });
});

/* ------------------------------------------------------------------ the keeper */

describe('the survivor is still keeper(a, b) and nothing else', () => {
  const navy = row('cl-navy', {
    name: 'Navy wool blazer',
    brand: 'Zephyr Atelier',
    colors: ['navy'],
    material: 'wool',
    fit: 'True to size',
    seasons: ['All-season'],
    price: 210,
    wears: 12,
    boughtOn: '2023-11-02',
    data: { subcategory: 'Blazer' }
  });
  const darkBlue = row('cl-darkblue', {
    name: 'Dark blue blazer',
    brand: 'Northbound Mills',
    colors: ['dark blue'],
    fit: 'Relaxed',
    seasons: ['Winter'],
    price: 95.5,
    wears: 3,
    boughtOn: '2024-06-18',
    data: { subcategory: 'Blazer' }
  });

  it('the queue stores the keeper the engine chose, in either row order', () => {
    const pairs = duplicatePairs([navy, darkBlue]);
    expect(pairs).toHaveLength(1);
    const chosen = keeper(wardrobeSignature(navy), wardrobeSignature(darkBlue)).id;
    expect(chosen).toBe('cl-navy');
    const fromPairs = queuePair(pairs[0].a.id, pairs[0].b.id, pairs[0].keeperId, 'fields');
    expect(fromPairs.keeperId).toBe(chosen);
    /* walking it backwards cannot flip the survivor */
    const reversed = queuePair(pairs[0].b.id, pairs[0].a.id, pairs[0].keeperId, 'fields');
    expect(reversed.keeperId).toBe(chosen);
    expect(reversed.pairId).toBe(fromPairs.pairId);

    const ledger = decide(open([fromPairs]), fromPairs.pairId, 'merge', TODAY);
    expect(ledger.decisions[fromPairs.pairId].keeperId).toBe('cl-navy');
  });

  it('a merge answer settles the pair so the walk cannot offer it twice', () => {
    let ledger = open([fromDuplicate()]);
    ledger = decide(ledger, 'cl-darkblue~cl-navy', 'merge', TODAY);
    /* the merge landed: the two rows are now one, so the list she is walking shrank */
    const q = buildQueue([], ledger, TODAY);
    expect(q.order).toEqual([]);
    expect(nextPair(q, ledger)).toBeNull();
    expect(counts(q, ledger).total).toBe(0);
  });

  function fromDuplicate() {
    const p = duplicatePairs([navy, darkBlue])[0];
    return queuePair(p.a.id, p.b.id, p.keeperId, 'fields');
  }
});

/* ------------------------------------------------------- the list moving under */

describe('a pair list that changes mid-review', () => {
  it('drops a pair that vanished rather than offering it again', () => {
    let ledger = open(THREE);
    ledger = decide(ledger, 'a~b', 'merge', TODAY);
    /* c~d is the one still on the panel: a~b collapsed and e~f fell below the floor */
    const q = buildQueue([P('c', 'd')], ledger, TODAY);
    expect(q.order).toEqual(['c~d']);
    expect(nextPair(q, ledger)?.pairId).toBe('c~d');
    expect(counts(q, ledger)).toMatchObject({ total: 1, reviewed: 0, remaining: 1 });
  });

  it('reports pairs that appeared since the freeze without inserting them', () => {
    const ledger = open(THREE);
    const q = queueOf(ledger);
    const grown = [...THREE, P('g', 'h'), P('c', 'd')];
    expect(unqueued(grown.map((p) => p), q).map((p) => p.pairId)).toEqual(['g~h']);
    expect(q.order).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------ suppression */

describe('ruling a pair out', () => {
  it('is remembered by the ledger for this session', () => {
    let ledger = open(THREE);
    ledger = decide(ledger, 'c~d', 'not-duplicates', TODAY);
    expect(suppresses(ledger).map((p) => p.pairId)).toEqual(['c~d']);
    expect(suppressedKeys(ledger).has('c~d')).toBe(true);
    expect(nextPair(queueOf(ledger), ledger)?.pairId).toBe('a~b');
  });

  it('survives a reload — and the pair is gone from the list the rows produce anyway', () => {
    let ledger = open(THREE);
    ledger = decide(ledger, 'c~d', 'not-duplicates', TODAY);
    localStorage.setItem(REVIEW_LEDGER_KEY, serializeLedger(ledger));

    const revived = readLedger();
    expect(revived.decisions['c~d'].verdict).toBe('not-duplicates');
    expect(suppressedKeys(revived).has('c~d')).toBe(true);
    /* `duplicatePairs` honours the note on her rows, so the pair is not even in
       the list handed back to the queue; the ledger is belt, the rows are braces */
    const q = buildQueue([P('a', 'b'), P('e', 'f')], revived, TODAY);
    expect(q.order).toEqual(['a~b', 'e~f']);
    expect(nextPair(q, revived)?.pairId).toBe('a~b');
    expect(counts(q, revived)).toMatchObject({ total: 2, reviewed: 0, suppressed: 0 });
  });

  it('a ruling is not re-asked on a later pass', () => {
    let ledger = open(THREE);
    ledger = decide(ledger, 'a~b', 'not-duplicates', TODAY);
    ledger = decide(ledger, 'c~d', 'skip', TODAY);
    ledger = decide(ledger, 'e~f', 'skip', TODAY);
    ledger = nextLap(ledger, TODAY);
    const q = queueOf(ledger);
    expect(nextPair(q, ledger)?.pairId).toBe('c~d');
  });
});

/* ---------------------------------------------------------------- the ledger io */

describe('reading a ledger this build did not write', () => {
  it('reads the older shape and recovers the rows from the pair name', () => {
    const v0 = JSON.stringify({
      v: 0,
      decisions: [
        { pairId: 'a~b', verdict: 'keep-both', at: '2026-10-01' },
        { pairId: 'c~d', verdict: 'not-duplicates', at: '2026-10-02' },
        { pairId: 'e~f', verdict: 'shredded', at: '2026-10-03' }
      ]
    });
    const ledger = parseLedger(v0);
    expect(ledger.version).toBe(REVIEW_LEDGER_VERSION);
    expect(ledger.decisions['a~b']).toMatchObject({ verdict: 'keep-both', aId: 'a', bId: 'b', lap: 1 });
    expect(suppressedKeys(ledger).has('c~d')).toBe(true);
    /* a verdict this build does not know is dropped rather than trusted */
    expect(ledger.decisions['e~f']).toBeUndefined();
    expect(ledger.order).toEqual(['a~b', 'c~d']);
  });

  it('keeps keys it cannot interpret instead of deleting them', () => {
    const future = JSON.stringify({ version: 9, order: ['a~b'], decisions: { 'a~b': { pairId: 'a~b', verdict: 'skip', lap: 1 } }, deviceId: 'dev-7' });
    const ledger = parseLedger(future);
    expect(ledger.foreign).toEqual({ deviceId: 'dev-7' });
    expect(ledger.decisions['a~b'].verdict).toBe('skip');
    expect(serializeLedger(ledger)).toContain('dev-7');
  });

  it('comes back empty rather than throwing on anything unparseable', () => {
    for (const raw of [null, undefined, '', 'not json', '[]', '42', '{}']) {
      expect(() => parseLedger(raw)).not.toThrow();
      const l = parseLedger(raw);
      expect(l.order).toEqual([]);
      expect(l.decisions).toEqual({});
      expect(l.open).toBe(false);
      expect(l.lap).toBe(1);
    }
  });

  it('reads and writes through storage without ever throwing', () => {
    localStorage.setItem(REVIEW_LEDGER_KEY, '{{{');
    expect(readLedger().order).toEqual([]);
    const ledger = open(THREE);
    writeLedger(ledger);
    expect(JSON.parse(String(localStorage.getItem(REVIEW_LEDGER_KEY))).order).toEqual(['a~b', 'c~d', 'e~f']);

    /* no storage at all — private mode, or a host that refuses it */
    vi.stubGlobal('localStorage', undefined);
    expect(readLedger()).toEqual(emptyLedger());
    expect(() => writeLedger(ledger)).not.toThrow();

    /* storage that throws on both ends — a full quota, a blocked access */
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      }
    });
    expect(readLedger().order).toEqual([]);
    expect(() => writeLedger(ledger)).not.toThrow();
    vi.unstubAllGlobals();
    expect(readLedger().order).toEqual(['a~b', 'c~d', 'e~f']);
  });
});

/* -------------------------------------------------------------------- progress */

describe('the numbers the panel prints', () => {
  it('counts reviewed, remaining, skipped, suppressed and unseen against each other', () => {
    let ledger = open(THREE);
    expect(counts(queueOf(ledger), ledger)).toMatchObject({ total: 3, reviewed: 0, remaining: 3, unseen: 3, skipped: 0, suppressed: 0 });

    ledger = decide(ledger, 'a~b', 'merge', TODAY);
    ledger = decide(ledger, 'c~d', 'skip', TODAY);
    ledger = decide(ledger, 'e~f', 'not-duplicates', TODAY);
    const c = counts(queueOf(ledger), ledger);
    /* a skip is not a review; a ruling out is, and it is also counted as suppressed */
    expect(c).toMatchObject({ total: 3, reviewed: 2, remaining: 1, skipped: 1, suppressed: 1, unseen: 0 });
    expect(c.reviewed + c.remaining).toBe(c.total);
  });

  it('says what is still owed, and says nothing when there is nothing', () => {
    let ledger = open(THREE);
    ledger = decide(ledger, 'a~b', 'keep-both', TODAY);
    ledger = decide(ledger, 'c~d', 'not-duplicates', TODAY);
    ledger = decide(ledger, 'e~f', 'skip', TODAY);
    expect(queueLine(counts(queueOf(ledger), ledger))).toBe(
      '2 of 3 answered; 1 still needs an answer; 1 ruled out as not duplicates; 1 skipped at least once.'
    );
    expect(queueLine(counts(buildQueue([], emptyLedger(), TODAY), emptyLedger()))).toBe(
      'There is nothing in the list to review — the comparison is not flagging a single pair right now.'
    );
    const fresh = open(THREE);
    expect(queueLine(counts(queueOf(fresh), fresh))).toBe('0 of 3 answered; 3 still need an answer; 3 not shown to you yet.');
  });
});
