/**
 * THE GLOW LAB — the derailment record (src/engine/derailment.ts).
 *
 * When a scheduled thing is missed, `engine/consistency.ts` can say "missed"
 * and nothing else. This module holds the other half of that sentence: what she
 * wrote about why the day came apart, what she said would get her back on it,
 * and the follow-up date she set herself.
 *
 * The one rule everything here obeys: **a record explains a miss, it never
 * removes one.** Nothing in this module is read by the counting code. The
 * scheduled/done/missed numbers, the ratios and the streaks stay computed from
 * routine logs and plan actions, because a note saying "I was ill" is not
 * evidence the session happened. The record travels beside those numbers as an
 * annotation, a tally and a due list — never as a correction.
 *
 * The trigger list is fixed and the labels are hers. The app observed nothing:
 * "sleep" being the most-chosen label means she chose it most often, which is
 * not a finding about cause, and this module says so in the sentence it prints.
 *
 * Pure module: no React, no database reads, no clock. `today` is always passed
 * in by the caller, and every function tolerates a row whose `refId` names a
 * routine, plan or action that no longer exists — `refLabel` is the snapshot
 * that keeps the record readable.
 */

import type { AnyRow, DerailmentRow } from '../db/schema';
import { dayIndex } from './trend';

export const DERAILMENT_RULE_VERSION = 1;

export type DerailmentKind = DerailmentRow['kind'];
export type DerailmentTrigger = DerailmentRow['trigger'];
export type DerailmentStatus = DerailmentRow['status'];

/* ------------------------------------------------------------------- labels */

/**
 * The fixed chip list. Exhaustiveness is checked by the `Record` type: a chip
 * added to the schema without copy here is a compile error, not a silent gap.
 */
const TRIGGER_COPY: Record<DerailmentTrigger, { label: string; ask: string }> = {
  illness: { label: 'illness', ask: 'Sick, injured or recovering — in your words, not a diagnosis.' },
  travel: { label: 'travel', ask: 'Away from home, or a day that did not run like a day.' },
  sleep: { label: 'not enough sleep', ask: 'How the night went, as you remember it.' },
  stress: { label: 'stress', ask: 'What was demanding that day.' },
  work: { label: 'work hours', ask: 'Work got in the way — say which part of it did.' },
  family: { label: 'family demands', ask: 'Someone else needed you that day.' },
  money: { label: 'money', ask: 'Something it costs, in cash or in time.' },
  'appearance-priority': {
    label: 'appearance work came first',
    ask: 'You chose a different appearance thing over this one. That is a choice, not a failure.'
  },
  'lost-motivation': { label: 'lost motivation', ask: 'You did not want to. That is a real answer.' },
  other: { label: 'something else', ask: 'Write it — none of these labels fits.' }
};

/** The chips, in the order the form shows them: concrete reasons first, `other` last. */
export const DERAILMENT_TRIGGERS: { value: DerailmentTrigger; label: string; ask: string }[] = (
  Object.keys(TRIGGER_COPY) as DerailmentTrigger[]
).map((value) => ({ value, label: TRIGGER_COPY[value].label, ask: TRIGGER_COPY[value].ask }));

const TRIGGER_VALUES = DERAILMENT_TRIGGERS.map((t) => t.value);

/** Human text for a stored trigger. Unlisted values print as what she saved, not as a guess. */
export function triggerLabel(value: unknown): string {
  const v = typeof value === 'string' ? value : '';
  if (!v) return 'no label chosen';
  return (TRIGGER_COPY as Record<string, { label: string } | undefined>)[v]?.label ?? v;
}

/** True when the value is one of the fixed chips. */
export function isListedTrigger(value: unknown): value is DerailmentTrigger {
  return typeof value === 'string' && TRIGGER_VALUES.includes(value as DerailmentTrigger);
}

const KINDS: DerailmentKind[] = ['routine', 'plan', 'action', 'general'];

/** What a record is attached to, in words the form and the list can print. */
export const KIND_LABELS: Record<DerailmentKind, string> = {
  routine: 'a routine',
  plan: 'a plan',
  action: 'a plan action',
  general: 'that day, with nothing attached to it'
};

export function kindLabel(kind: unknown): string {
  const k = typeof kind === 'string' ? kind : 'general';
  return (KIND_LABELS as Record<string, string | undefined>)[k] ?? 'that day, with nothing attached to it';
}

/** The invariant, in the one line the digest prints in its `rules`. */
export const DERAILMENT_RULE =
  'A derailment record explains a missed day; it never removes one. The scheduled, done and missed counts, the ratios and the streaks on this card are the same arithmetic with or without a record, because a note that you were ill is not evidence the session happened.';

/** The empty state, said once here so the card and the engine agree on it. */
export const DERAILMENT_EMPTY_LINE =
  'Nothing has been recorded as a derailment on this device. Recording one is optional: the counts above already stand, and a missed day stays a missed day either way.';

/* ------------------------------------------------------------------- records */

const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');
const asRows = (v: unknown): AnyRow[] => (Array.isArray(v) ? (v as AnyRow[]) : []);

/** A dated value, or null for a blank or malformed one — a blank is not a zero. */
function isoOrNull(v: unknown): string | null {
  const s = asStr(v);
  return dayIndex(s) === null ? null : s;
}

export interface DerailmentRecord {
  id: string;
  /** `YYYY-MM-DD`, validated: a row whose date cannot be read is dropped, not guessed. */
  on: string;
  kind: DerailmentKind;
  refId: string | null;
  refLabel: string;
  /** The stored chip value, exactly as saved. */
  trigger: string;
  triggerLabel: string;
  /** False when the stored value is not on the fixed list — printed as typed, never re-labelled. */
  listed: boolean;
  reason: string;
  fix: string;
  followUpOn: string | null;
  status: DerailmentStatus;
  resolvedOn: string | null;
  createdAt: number;
}

/**
 * Normalise one row. Returns null only when the date cannot be read — a record
 * with no usable date can be attached to no day, and inventing one would be
 * worse than dropping the row from the tally.
 */
export function recordFromRow(row: AnyRow): DerailmentRecord | null {
  const on = isoOrNull(row?.on);
  if (!on) return null;
  const rawKind = asStr(row.kind) as DerailmentKind;
  const kind = KINDS.includes(rawKind) ? rawKind : 'general';
  const trigger = asStr(row.trigger);
  return {
    id: asStr(row.id),
    on,
    kind,
    refId: asStr(row.refId) === '' ? null : asStr(row.refId),
    refLabel: asStr(row.refLabel),
    trigger,
    triggerLabel: triggerLabel(trigger),
    listed: isListedTrigger(trigger),
    reason: asStr(row.reason),
    fix: asStr(row.fix),
    followUpOn: isoOrNull(row.followUpOn),
    status: asStr(row.status) === 'resolved' ? 'resolved' : 'open',
    resolvedOn: isoOrNull(row.resolvedOn),
    createdAt: Number.isFinite(Number(row.createdAt)) ? Number(row.createdAt) : 0
  };
}

/** Live records only: soft-deleted rows are ignored, and the list is date-ascending. */
export function liveRecords(rows: AnyRow[]): DerailmentRecord[] {
  const out: DerailmentRecord[] = [];
  for (const row of asRows(rows)) {
    if (!row || row.deletedAt) continue;
    const rec = recordFromRow(row);
    if (rec) out.push(rec);
  }
  return out.sort((a, b) => a.on.localeCompare(b.on) || a.id.localeCompare(b.id));
}

/* --------------------------------------------------------------------- attach */

/** A scheduled thing the digest counts, at the granularity a record can attach to. */
export interface SchedItem {
  on: string;
  kind: DerailmentKind;
  refId: string | null;
}

export interface ItemTarget {
  kind: DerailmentKind;
  refId: string | null;
  /** The dates this item could have been missed on. */
  dates: string[];
}

export function schedKeyOf(on: string, kind: DerailmentKind, refId: string | null): string {
  return `${on}|${kind}|${refId ?? ''}`;
}

export const itemKey = (item: SchedItem): string => schedKeyOf(item.on, item.kind, item.refId);

/**
 * The matching rule, in one place: an exact `on + kind + refId` hit, or a
 * `general` record with no refId, which explains the whole day rather than one
 * item. Nothing else counts — a record about a routine is not a record about a
 * different routine that happened to miss the same day.
 */
export function recordsAt(records: DerailmentRecord[], target: ItemTarget): DerailmentRecord[] {
  const dates = new Set(target.dates);
  const refId = target.refId ?? null;
  return records.filter(
    (r) =>
      dates.has(r.on) &&
      ((r.kind === target.kind && r.refId === refId) || (r.kind === 'general' && r.refId === null))
  );
}

export interface DerailmentLookup {
  /** Every live record, date-ascending. */
  records: DerailmentRecord[];
  /** The scheduled items the caller is counting. */
  items: SchedItem[];
  byDay: Map<string, DerailmentRecord[]>;
  byKey: Map<string, DerailmentRecord[]>;
  explains(item: SchedItem): boolean;
  recordsFor(item: SchedItem): DerailmentRecord[];
  /** Any record dated this day — what makes a day cell read "explained". */
  dayRecords(on: string): DerailmentRecord[];
  /** Only the day-level (`general`, no refId) records for a day. */
  generalRecords(on: string): DerailmentRecord[];
  explainsDay(on: string): boolean;
  /** Of the items handed in, how many carry a record. */
  explainedItems: number;
  /** Live records that explain none of the items handed in. */
  unmatched: DerailmentRecord[];
}

/**
 * Index the records against the digest's scheduled keys. Reads nothing but the
 * rows it is given, and writes nothing back: the lookup is a lookup, so the
 * counts a caller has already computed are never touched by it.
 */
export function attach(rows: AnyRow[], keys: Iterable<SchedItem> = []): DerailmentLookup {
  const records = liveRecords(rows);
  const items: SchedItem[] = Array.from(keys ?? []);

  const byDay = new Map<string, DerailmentRecord[]>();
  const byKey = new Map<string, DerailmentRecord[]>();
  for (const rec of records) {
    const day = byDay.get(rec.on) ?? [];
    day.push(rec);
    byDay.set(rec.on, day);
    const key = schedKeyOf(rec.on, rec.kind, rec.refId);
    const bucket = byKey.get(key) ?? [];
    bucket.push(rec);
    byKey.set(key, bucket);
  }

  const recordsFor = (item: SchedItem): DerailmentRecord[] =>
    recordsAt(records, { kind: item.kind, refId: item.refId, dates: [item.on] });

  const daySet = new Set(items.map((i) => i.on));
  const matched = new Set<string>();
  let explainedItems = 0;
  for (const item of items) {
    const hits = recordsFor(item);
    if (hits.length === 0) continue;
    explainedItems += 1;
    for (const hit of hits) matched.add(hit.id || `${hit.on}|${hit.kind}|${hit.refId}`);
  }

  return {
    records,
    items,
    byDay,
    byKey,
    recordsFor,
    explains: (item) => recordsFor(item).length > 0,
    dayRecords: (on) => byDay.get(on) ?? [],
    generalRecords: (on) => (byDay.get(on) ?? []).filter((r) => r.kind === 'general' && r.refId === null),
    explainsDay: (on) => (byDay.get(on)?.length ?? 0) > 0,
    explainedItems,
    unmatched: records.filter((r) => {
      if (matched.has(r.id || `${r.on}|${r.kind}|${r.refId}`)) return false;
      // A day-level record counts as matched if the day is one of the items at all.
      return !(r.kind === 'general' && r.refId === null && daySet.has(r.on));
    })
  };
}

/* ----------------------------------------------------------------- the tally */

export interface TriggerTally {
  trigger: string;
  label: string;
  count: number;
  /** The dates behind the count, ascending, deduped. */
  dates: string[];
  listed: boolean;
}

export function tallyRecords(records: DerailmentRecord[]): TriggerTally[] {
  const map = new Map<string, { label: string; count: number; dates: Set<string>; listed: boolean }>();
  for (const rec of records) {
    const slot = map.get(rec.trigger) ?? { label: rec.triggerLabel, count: 0, dates: new Set<string>(), listed: rec.listed };
    slot.count += 1;
    slot.dates.add(rec.on);
    map.set(rec.trigger, slot);
  }
  return Array.from(map.entries())
    .map(([trigger, slot]) => ({
      trigger,
      label: slot.label,
      count: slot.count,
      listed: slot.listed,
      dates: Array.from(slot.dates).sort()
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label) || a.dates[0].localeCompare(b.dates[0]));
}

/** Count per trigger over every live record, most frequent first, with its dates. */
export function tallyByTrigger(rows: AnyRow[]): TriggerTally[] {
  return tallyRecords(liveRecords(rows));
}

/* -------------------------------------------------------------- follow-ups */

export interface FollowUpItem {
  record: DerailmentRecord;
  followUpOn: string;
  /** Whole days past the date she chose; 0 when it is due today. */
  daysLate: number;
  overdue: boolean;
  dueToday: boolean;
}

export function followUpsFromRecords(records: DerailmentRecord[], today: string): FollowUpItem[] {
  const t = dayIndex(today);
  if (t === null) return [];
  const out: FollowUpItem[] = [];
  for (const rec of records) {
    if (rec.status !== 'open' || !rec.followUpOn) continue;
    const idx = dayIndex(rec.followUpOn);
    if (idx === null || idx > t) continue;
    out.push({ record: rec, followUpOn: rec.followUpOn, daysLate: t - idx, overdue: idx < t, dueToday: idx === t });
  }
  return out.sort(
    (a, b) =>
      a.followUpOn.localeCompare(b.followUpOn) ||
      a.record.on.localeCompare(b.record.on) ||
      a.record.id.localeCompare(b.record.id)
  );
}

/** Open records whose follow-up date is today or earlier, oldest promise first. */
export function followUpsDue(rows: AnyRow[], today: string): FollowUpItem[] {
  return followUpsFromRecords(liveRecords(rows), today);
}

/* ---------------------------------------------------------------- read lines */

/** Up to four dates, then an honest count of the rest. */
function dateList(dates: string[]): string {
  if (dates.length <= 4) return dates.join(', ');
  return `${dates.slice(0, 4).join(', ')} (+${dates.length - 4} more)`;
}

const LIMIT_SENTENCE =
  'Those labels are ones you picked from a fixed list, on the day you picked them: the app observed nothing, so the most frequent label is you saying so, not a finding about cause.';

/**
 * One plain sentence over the tally and the open follow-ups, with its own limit
 * baked in and the invariant restated. Returns the empty-state line when there
 * is nothing to summarise — no "0% of 0", no invented pattern.
 */
export function readLineFromRecords(records: DerailmentRecord[], today: string): string {
  if (records.length === 0) return DERAILMENT_EMPTY_LINE;

  const tally = tallyRecords(records);
  const first = records[0].on;
  const last = records[records.length - 1].on;
  const head = `You recorded ${records.length} derailment${records.length === 1 ? '' : 's'} (${
    first === last ? first : `${first} to ${last}`
  }).`;

  const top = tally[0];
  const leaders = tally.filter((t) => t.count === top.count);
  const labelPart =
    tally.length === 1
      ? ` The only label chosen is “${top.label}” (${top.count} of ${records.length}).`
      : leaders.length > 1
        ? ` No label leads: ${leaders.map((l) => `“${l.label}” at ${l.count}`).join(', ')}.`
        : ` Your most-chosen label is “${top.label}” — ${top.count} of ${records.length}, on ${dateList(top.dates)}.`;

  const due = followUpsFromRecords(records, today);
  const todayIdx = dayIndex(today);
  const stillAhead = records.filter((r) => {
    if (r.status !== 'open' || !r.followUpOn || todayIdx === null) return false;
    const idx = dayIndex(r.followUpOn);
    return idx !== null && idx > todayIdx;
  });
  const overdueCount = due.filter((d) => d.overdue).length;
  const followPart =
    due.length > 0
      ? ` ${due.length} follow-up${due.length === 1 ? '' : 's'} you set yourself ${due.length === 1 ? 'is' : 'are'} outstanding${
          overdueCount > 0 ? `, ${overdueCount} past the date you chose` : ''
        }.`
      : stillAhead.length > 0
        ? ` ${stillAhead.length} follow-up date${stillAhead.length === 1 ? '' : 's'} still ahead.`
        : ' No follow-up date is open.';

  return `${head}${labelPart}${followPart} ${LIMIT_SENTENCE}`;
}

/** The sentence the card prints. */
export function readLine(rows: AnyRow[], today: string): string {
  return readLineFromRecords(liveRecords(rows), today);
}
