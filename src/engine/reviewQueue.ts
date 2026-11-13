/**
 * THE GLOW LAB — the look-alike merge review queue (spec Part 14).
 *
 * The duplicate panels have always been able to *print* candidate pairs. This
 * is the part that lets her get through the list: the current pairs are frozen
 * into an ordered queue and walked one pair at a time, and every step of the
 * way is a decision she makes. Nothing in this file writes a row, deletes a
 * row or merges a row — it turns a list of pairs and a ledger of her answers
 * into "pair 4 of 11", and nothing more.
 *
 * Two stores, and the difference between them matters:
 *
 *  - **This ledger is a UI-scoped ledger in localStorage**
 *    (`glowlab.dupReview.v1`). It holds the frozen queue order, the queue
 *    position, the pass number and her decisions — keep-both, skip, merged,
 *    ruled-out — with the date she answered. Clearing browser storage for this
 *    site drops the queue position; it does not drop any decision that touched
 *    her data, because those live on the rows.
 *  - **Merges and suppressions are database writes** made by the page against
 *    `clothingItems`. A merge goes through the panel's existing merge path
 *    (wears move onto `keeper(a, b)`, the other row keeps itself and stores the
 *    number it gave up). A "these two are not duplicates" answer writes
 *    `data.dupExcluded` on both rows, and `duplicatePairs` honours that note on
 *    every later call — so it is still suppressed after a reload, after a
 *    backup, and on a device that never saw this ledger.
 *
 * The queue is guarded against the list changing underneath it: the frozen
 * order is re-checked against the live pairs on every build, so a pair whose
 * rows collapsed into one is dropped rather than offered twice.
 */
import { pairKey } from './duplicates';

/** Named and versioned the way the coverage rules are, so a future shape can be read. */
export const REVIEW_LEDGER_KEY = 'glowlab.dupReview.v1';
export const REVIEW_LEDGER_VERSION = 1;

/** What she can answer. Four answers, all of them hers; there is no fifth default. */
export type Verdict = 'merge' | 'keep-both' | 'skip' | 'not-duplicates';

export const VERDICTS: Verdict[] = ['merge', 'keep-both', 'skip', 'not-duplicates'];

/** An answer that closes the pair for good in this session, as against deferring it. */
export const SETTLED: Verdict[] = ['merge', 'keep-both', 'not-duplicates'];

export type PairOrigin = 'fields' | 'photo';

/** The identity of one candidate pair. The detail it renders comes from her live rows. */
export interface QueuePair {
  pairId: string;
  aId: string;
  bId: string;
  keeperId: string;
  origin: PairOrigin;
}

export interface ReviewDecision {
  pairId: string;
  verdict: Verdict;
  /** ISO date she answered on — the ledger is a record, not a clock */
  at: string;
  aId: string;
  bId: string;
  keeperId: string | null;
  origin: PairOrigin;
  /** which pass of the queue asked for it; a skip is only honoured within its own pass */
  lap: number;
}

export interface ReviewLedger {
  version: number;
  /** is a review session open right now */
  open: boolean;
  startedAt: string | null;
  updatedAt: string | null;
  /** passes round the queue she has had; a skipped pair is re-offered on the next one */
  lap: number;
  /** the frozen working order — a skip moves a pair to the end of it */
  order: string[];
  pairs: Record<string, QueuePair>;
  decisions: Record<string, ReviewDecision>;
  /** keys from a ledger this build could not interpret, kept verbatim rather than dropped */
  foreign?: Record<string, unknown>;
}

/** The frozen queue, derived from the ledger and the live pair list. */
export interface DupQueue {
  version: number;
  order: string[];
  pairs: Record<string, QueuePair>;
  startedAt: string | null;
  lap: number;
  open: boolean;
}

export interface QueueCounts {
  total: number;
  /** pairs she answered with a closing verdict */
  reviewed: number;
  /** total minus reviewed — everything still owed an answer, seen or not */
  remaining: number;
  /** pairs she has not been shown yet in any pass */
  unseen: number;
  /** pairs she has deferred at least once and not since answered */
  skipped: number;
  /** pairs she ruled out; these are also the ones written onto her rows */
  suppressed: number;
}

const VERDICT_SET = new Set<string>(VERDICTS);

export function emptyLedger(): ReviewLedger {
  return {
    version: REVIEW_LEDGER_VERSION,
    open: false,
    startedAt: null,
    updatedAt: null,
    lap: 1,
    order: [],
    pairs: {},
    decisions: {}
  };
}

/* ------------------------------------------------------------------ identity */

/**
 * The one place a pair's name is built, so a candidate the field comparison
 * found and a candidate the photographs found cannot end up as two queue
 * entries for the same two rows.
 */
export function queuePair(aId: string, bId: string, keeperId: string, origin: PairOrigin): QueuePair {
  const pairId = pairKey(aId, bId);
  return { pairId, aId: String(aId), bId: String(bId), keeperId: String(keeperId), origin };
}

export function isSettled(d: ReviewDecision | undefined): boolean {
  return Boolean(d && SETTLED.includes(d.verdict));
}

/** A skip she made in an earlier pass is owed another look; one made now is not. */
const deferredForThisPass = (d: ReviewDecision | undefined, lap: number) =>
  Boolean(d && d.verdict === 'skip' && d.lap < lap);

/* -------------------------------------------------------------------- ledger */

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function decisionFrom(raw: unknown, pairIdFrom: string): ReviewDecision | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const verdict = str(r.verdict);
  if (!VERDICT_SET.has(verdict)) return null;
  const pairId = str(r.pairId) || pairIdFrom;
  /* an older ledger named the pair by its two row ids joined with "~", so the
     ids are recoverable from the key when the entry itself carries none */
  const [head, tail] = pairId.split('~');
  const aId = str(r.aId) || str(head);
  const bId = str(r.bId) || str(tail);
  if (!pairId || !aId || !bId) return null;
  const lap = Number(r.lap);
  return {
    pairId,
    verdict: verdict as Verdict,
    at: str(r.at),
    aId,
    bId,
    keeperId: typeof r.keeperId === 'string' ? r.keeperId : null,
    /* a pre-v1 ledger stored no origin, so it is recovered when present and
       read as 'fields' otherwise — the same documented fallback `queuePairFrom`
       uses; nothing consumes it except the session-scoped suppression list */
    origin: str(r.origin) === 'photo' ? 'photo' : 'fields',
    lap: Number.isFinite(lap) && lap >= 1 ? Math.floor(lap) : 1
  };
}

function queuePairFrom(raw: unknown, pairId: string): QueuePair | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const aId = str(r.aId);
  const bId = str(r.bId);
  if (!aId || !bId) return null;
  const origin = str(r.origin) === 'photo' ? 'photo' : 'fields';
  return { pairId, aId, bId, keeperId: str(r.keeperId) || aId, origin };
}

/**
 * Read anything this app may have written, and lose nothing it can still
 * understand. A v0 ledger kept `v` and an array of decisions; a v1 ledger keeps
 * a map. Anything unparseable comes back as an empty ledger rather than a
 * throw, and keys this build does not know are carried through untouched.
 */
export function parseLedger(raw: string | null | undefined): ReviewLedger {
  if (!raw) return emptyLedger();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return emptyLedger();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyLedger();
  const r = value as Record<string, unknown>;

  const decisions: Record<string, ReviewDecision> = {};
  const rawDecisions = r.decisions ?? r.verdicts;
  if (Array.isArray(rawDecisions)) {
    for (const entry of rawDecisions) {
      const d = decisionFrom(entry, '');
      if (d) decisions[d.pairId] = d;
    }
  } else if (rawDecisions && typeof rawDecisions === 'object') {
    for (const [pairId, entry] of Object.entries(rawDecisions as Record<string, unknown>)) {
      const d = decisionFrom(entry, pairId);
      if (d) decisions[d.pairId] = d;
    }
  }

  const pairs: Record<string, QueuePair> = {};
  const rawPairs = r.pairs;
  if (rawPairs && typeof rawPairs === 'object' && !Array.isArray(rawPairs)) {
    for (const [pairId, entry] of Object.entries(rawPairs as Record<string, unknown>)) {
      const p = queuePairFrom(entry, pairId);
      if (p) pairs[p.pairId] = p;
    }
  }

  let order: string[] = [];
  if (Array.isArray(r.order)) order = r.order.map((x) => str(x)).filter((x) => x !== '');
  else if (Array.isArray(rawDecisions)) order = Object.keys(decisions);
  order = [...new Set(order)];

  const known = new Set(['version', 'v', 'open', 'startedAt', 'updatedAt', 'lap', 'order', 'pairs', 'decisions', 'verdicts']);
  const foreign: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (!known.has(k)) foreign[k] = v;

  const lap = Number(r.lap);
  return {
    version: REVIEW_LEDGER_VERSION,
    open: Boolean(r.open),
    startedAt: typeof r.startedAt === 'string' ? r.startedAt : null,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : null,
    lap: Number.isFinite(lap) && lap >= 1 ? Math.floor(lap) : 1,
    order,
    pairs,
    decisions,
    ...(Object.keys(foreign).length ? { foreign } : {})
  };
}

export function serializeLedger(ledger: ReviewLedger): string {
  return JSON.stringify(ledger);
}

/* --------------------------------------------------------------- the storage */

type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void };

function store(): StorageLike | null {
  try {
    const s = (globalThis as { localStorage?: StorageLike }).localStorage;
    return s && typeof s.getItem === 'function' && typeof s.setItem === 'function' ? s : null;
  } catch {
    return null;
  }
}

/** Never throws: no storage, a private-mode block and a corrupt value all read as "no queue". */
export function readLedger(): ReviewLedger {
  const s = store();
  if (!s) return emptyLedger();
  let raw: string | null = null;
  try {
    raw = s.getItem(REVIEW_LEDGER_KEY);
  } catch {
    return emptyLedger();
  }
  return parseLedger(raw);
}

export function writeLedger(ledger: ReviewLedger): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(REVIEW_LEDGER_KEY, serializeLedger(ledger));
  } catch {
    /* a full or blocked storage costs her the queue position, never a row */
  }
}

/* ------------------------------------------------------------------- building */

/**
 * Freeze the live pair list, or resume the freeze already in the ledger.
 *
 * Opening a review takes the order the panel is showing right now. While a
 * review is open the frozen order is authoritative — pairs that have since
 * disappeared (a merge collapsed the rows, a field edit dropped the score below
 * the floor) are pruned so the queue cannot offer a dead pair or a second
 * chance at a merge, and pairs that have since appeared are reported as outside
 * this queue rather than silently inserted in front of her.
 */
export function buildQueue(pairs: readonly QueuePair[], ledger: ReviewLedger, today = ''): DupQueue {
  const live: Record<string, QueuePair> = {};
  for (const p of pairs) {
    if (!p || !p.pairId || live[p.pairId]) continue;
    live[p.pairId] = p;
  }
  const order = ledger.open
    ? [...new Set(ledger.order)].filter((id) => Boolean(live[id]))
    : Object.keys(live);
  const kept: Record<string, QueuePair> = {};
  for (const id of order) kept[id] = live[id];
  return {
    version: REVIEW_LEDGER_VERSION,
    order,
    pairs: kept,
    startedAt: ledger.startedAt ?? (today || null),
    lap: ledger.lap,
    open: ledger.open
  };
}

/** Pairs the comparison is now showing that this frozen queue does not contain. */
export function unqueued(pairs: readonly QueuePair[], queue: DupQueue): QueuePair[] {
  const inQueue = new Set(queue.order);
  return pairs.filter((p) => p && !inQueue.has(p.pairId));
}

/** The next pair to put in front of her, or null when this pass has no answer owed. */
export function nextPair(queue: DupQueue, ledger: ReviewLedger): QueuePair | null {
  for (const id of queue.order) {
    const pair = queue.pairs[id];
    if (!pair) continue;
    const d = ledger.decisions[id];
    if (!d) return pair;
    if (deferredForThisPass(d, queue.lap)) return pair;
  }
  return null;
}

/** Her position in the queue, counted from 1, for the "pair N of M" line. */
export function positionOf(queue: DupQueue, ledger: ReviewLedger): number {
  const next = nextPair(queue, ledger);
  if (!next) return queue.order.length;
  const at = queue.order.indexOf(next.pairId);
  return at < 0 ? queue.order.length : at + 1;
}

/* ------------------------------------------------------------------ decisions */

/**
 * Record what she answered. Pure: the caller does the row writes and passes the
 * result of its own `keeper(a, b)` in, so this file cannot decide a survivor.
 */
export function decide(
  ledger: ReviewLedger,
  pairId: string,
  verdict: Verdict,
  today: string,
  pair?: QueuePair | null
): ReviewLedger {
  if (!VERDICT_SET.has(verdict)) return ledger;
  const known = ledger.pairs[pairId] ?? pair ?? null;
  if (!known) return ledger;
  const entry: ReviewDecision = {
    pairId,
    verdict,
    at: today,
    aId: known.aId,
    bId: known.bId,
    keeperId: verdict === 'merge' ? known.keeperId : null,
    origin: known.origin,
    lap: ledger.lap
  };
  const order = verdict === 'skip' ? [...ledger.order.filter((id) => id !== pairId), pairId] : ledger.order;
  const pairs = { ...ledger.pairs, [pairId]: known };
  return {
    ...ledger,
    version: REVIEW_LEDGER_VERSION,
    pairs,
    order,
    decisions: { ...ledger.decisions, [pairId]: entry },
    updatedAt: today
  };
}

/** Drop a decision, so the pair goes back on the list — hers to ask for, never automatic. */
export function undecided(ledger: ReviewLedger, pairId: string, today: string): ReviewLedger {
  if (!(pairId in ledger.decisions)) return ledger;
  const decisions = { ...ledger.decisions };
  delete decisions[pairId];
  return { ...ledger, decisions, updatedAt: today };
}

/** Finish this pass and go round again: the pairs she skipped are asked once more. */
export function nextLap(ledger: ReviewLedger, today: string): ReviewLedger {
  return { ...ledger, lap: ledger.lap + 1, updatedAt: today };
}

export function startReview(pairs: readonly QueuePair[], ledger: ReviewLedger, today: string): ReviewLedger {
  const queue = buildQueue(pairs, { ...ledger, open: false }, today);
  return {
    ...ledger,
    version: REVIEW_LEDGER_VERSION,
    open: true,
    startedAt: ledger.startedAt ?? today,
    updatedAt: today,
    lap: 1,
    order: queue.order,
    pairs: queue.pairs
  };
}

/** Closing the review keeps every decision; it only stops walking the list. */
export function stopReview(ledger: ReviewLedger, today: string): ReviewLedger {
  return { ...ledger, open: false, updatedAt: today };
}

/**
 * The pairs she answered "not duplicates", straight out of the ledger. The page
 * uses these to hold a pair out of the photo panel in the same session it was
 * answered, before the row note reaches the live query; on any later visit
 * `duplicatePairs` is the thing that remembers.
 */
export function suppresses(ledger: ReviewLedger): QueuePair[] {
  return Object.values(ledger.decisions)
    .filter((d) => d.verdict === 'not-duplicates')
    .map((d) => ledger.pairs[d.pairId] ?? { pairId: d.pairId, aId: d.aId, bId: d.bId, keeperId: d.keeperId || d.aId, origin: d.origin })
    .sort((a, b) => a.pairId.localeCompare(b.pairId));
}

export function suppressedKeys(ledger: ReviewLedger): Set<string> {
  return new Set(suppresses(ledger).map((p) => p.pairId));
}

export function counts(queue: DupQueue, ledger: ReviewLedger): QueueCounts {
  let reviewed = 0;
  let unseen = 0;
  let skipped = 0;
  let suppressed = 0;
  for (const id of queue.order) {
    if (!queue.pairs[id]) continue;
    const d = ledger.decisions[id];
    if (!d) {
      unseen += 1;
      continue;
    }
    if (d.verdict === 'skip') skipped += 1;
    if (d.verdict === 'not-duplicates') suppressed += 1;
    if (SETTLED.includes(d.verdict)) reviewed += 1;
  }
  const total = queue.order.filter((id) => Boolean(queue.pairs[id])).length;
  return { total, reviewed, remaining: total - reviewed, unseen, skipped, suppressed };
}

/**
 * The line the queue prints about itself. Every number in it is one of the four
 * above, so the sentence cannot claim more than the arithmetic says.
 */
export function queueLine(c: QueueCounts): string {
  if (!c.total) {
    return 'There is nothing in the list to review — the comparison is not flagging a single pair right now.';
  }
  const parts = [`${c.reviewed} of ${c.total} answered`];
  if (c.remaining) parts.push(`${c.remaining} still need${c.remaining === 1 ? 's' : ''} an answer`);
  if (c.suppressed) parts.push(`${c.suppressed} ruled out as not duplicates`);
  if (c.skipped) parts.push(`${c.skipped} skipped at least once`);
  if (c.unseen) parts.push(`${c.unseen} not shown to you yet`);
  return `${parts.join('; ')}.`;
}
