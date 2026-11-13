/**
 * THE GLOW LAB — shed and breakage counts, and the length they did or did not
 * cost (spec Part 22: no fabricated capability; Part 27: nothing invented).
 *
 * The app's own tutorials tell her to do this: "Count shed hairs for one wash —
 * hair in the drain plus on the brush" and "Log length, shed count and the one
 * variable changed" (`content/academy.ts`, the shedding and growth lessons).
 * Until now the hair record had nowhere to put either number, so the advice was
 * unfollowable inside the app and the correlation the lesson calls "the whole
 * point of tracking" could not be drawn.
 *
 * What these counts are: her own estimate of hairs she saw. Not a hair count,
 * not density, not a follicle measurement, not a diagnosis. A drain is a
 * partial sample of a day and everyone under-counts it differently, so this
 * module normalises to per-day, fits the same line the rest of the app uses,
 * prints the scatter around it, and stops there. Shedding has causes that are
 * medical and causes that are not, and telling them apart is a clinician's job
 * — which is said in the output, not left implied.
 *
 * Length is handled with the one trap it has: a falling line usually means a
 * cut, and a cut is recorded in this same table. So drops are read against the
 * cut rows before any sentence is written.
 */
import type { AnyRow } from '../db/schema';
import { type TrendRead, dayIndex, trend } from './trend';

export const SHED_RULE_VERSION = 1;

/**
 * The window a count was taken over. `days` is the divisor, and each label is
 * phrased so she picks the one that matches what she actually did rather than
 * the nearest-sounding one.
 */
export interface ShedBasis {
  key: string;
  label: string;
  days: number;
  hint: string;
}

export const SHED_BASES: ShedBasis[] = [
  { key: 'wash', label: 'One wash', days: 1, hint: 'Drain plus brush after a single wash — the count the lesson asks for.' },
  { key: 'night', label: 'One night', days: 1, hint: 'Pillow and the first brush in the morning, nothing added later.' },
  { key: 'day', label: 'One day', days: 1, hint: 'Everything you saw between getting up and going to bed.' },
  { key: 'three-days', label: 'Three days', days: 3, hint: 'Counted across three days, usually between washes.' },
  { key: 'week', label: 'A week', days: 7, hint: 'Collected over a whole week, e.g. a shower-catch all seven days.' }
];

/** kinds that shorten hair on purpose — a drop explained by the table itself */
export const CUT_KINDS = ['cut', 'trim', 'take-down', 'repair'];

export interface ShedPoint {
  on: string;
  kind: string;
  count: number;
  basisKey: string;
  basisLabel: string;
  windowDays: number;
  perDay: number;
  variable: string;
  rowId: string;
}

export interface ShedRead {
  rule: number;
  /** hair records inspected, whatever they hold */
  records: number;
  /** shed counts that could be normalised: a number and a recognised window */
  counted: number;
  /** dated records with no count at all — the common case, said out loud */
  noCount: number;
  /** a count was written but the window was blank or unrecognised */
  missingWindow: number;
  shed: TrendRead;
  breakage: TrendRead;
  latest: ShedPoint | null;
  /** each count next to the one variable logged with it, newest first */
  pairs: { on: string; perDay: number | null; count: number | null; variable: string; basisLabel: string }[];
  sentence: string;
}

export interface LengthRead {
  rule: number;
  n: number;
  skipped: number;
  first: { on: string; cm: number } | null;
  latest: { on: string; cm: number } | null;
  change: number | null;
  spanDays: number | null;
  fitted: TrendRead;
  /** cut rows dated between the first and latest length, newest first */
  cuts: { on: string; label: string; kind: string }[];
  sentence: string;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function data(r: AnyRow, key: string): unknown {
  const d = r?.data ?? {};
  return d[key];
}

function dated(r: AnyRow): string {
  return String(r?.doneOn ?? '');
}

export function basisFor(v: unknown): ShedBasis | null {
  const key = String(v ?? '').trim().toLowerCase();
  if (!key) return null;
  return SHED_BASES.find((b) => b.key === key || b.label.toLowerCase() === key) ?? null;
}

/** Hairs per day, or null when the count or its window cannot be read. */
export function perDay(count: unknown, basis: unknown): { value: number; basis: ShedBasis } | null {
  const c = num(count);
  const b = basisFor(basis);
  if (c === null || c < 0 || !b) return null;
  return { value: c / b.days, basis: b };
}

function newestFirst(rows: AnyRow[]): AnyRow[] {
  return (rows ?? [])
    .filter((r) => r && !r.deletedAt && dayIndex(dated(r)) !== null)
    .sort((a, b) => dated(b).localeCompare(dated(a)));
}

/**
 * The shed and breakage picture from her own hair records.
 *
 * `opts.metric` only renames the printed series, so the same arithmetic serves
 * a shed line and a breakage line.
 */
export function shedRead(rows: AnyRow[], opts: { unit?: string } = {}): ShedRead {
  const live = newestFirst(rows);
  const shedPoints: { on: string; value: unknown; source: string }[] = [];
  const breakagePoints: { on: string; value: unknown; source: string }[] = [];
  const pairs: ShedRead['pairs'] = [];
  let counted = 0;
  let noCount = 0;
  let missingWindow = 0;
  let latest: ShedPoint | null = null;

  for (const r of live) {
    const count = num(data(r, 'shedCount'));
    const basisRaw = data(r, 'shedBasis');
    const broken = num(data(r, 'breakageCount'));
    const variable = String(data(r, 'variableChanged') ?? '').trim();
    const on = dated(r);
    const done = perDay(count, basisRaw);
    const brokenDone = broken === null ? null : perDay(broken, basisRaw);

    if (count === null && broken === null) {
      noCount += 1;
    } else if (!basisFor(basisRaw)) {
      missingWindow += 1;
    }

    if (done) {
      counted += 1;
      shedPoints.push({ on, value: Number(done.value.toFixed(2)), source: 'Hairs shed per day' });
      if (!latest) {
        latest = {
          on,
          kind: String(r.kind ?? 'note'),
          count: done.value * done.basis.days,
          basisKey: done.basis.key,
          basisLabel: done.basis.label,
          windowDays: done.basis.days,
          perDay: done.value,
          variable,
          rowId: String(r.id)
        };
      }
    }
    if (brokenDone) {
      breakagePoints.push({ on, value: Number(brokenDone.value.toFixed(2)), source: 'Hairs broken per day' });
    }
    if (count !== null || broken !== null || variable) {
      pairs.push({
        on,
        perDay: done ? Number(done.value.toFixed(1)) : null,
        count,
        variable,
        basisLabel: basisFor(basisRaw)?.label ?? 'window not recorded'
      });
    }
  }

  const unit = opts.unit ?? 'hairs/day';
  const shed = trend(shedPoints, { unit });
  const breakage = trend(breakagePoints, { unit });

  let sentence: string;
  if (!counted && breakagePoints.length) {
    sentence = `${breakagePoints.length} record(s) count hairs broken, but none counts hairs shed over a named window — so the shed line has nothing to fit. Breakage is read on its own line below.`;
  } else if (!counted) {
    sentence =
      live.length === 0
        ? 'No dated hair records to read. A count belongs on a hair record — the form is on the Hair page.'
        : `None of the ${live.length} hair record(s) on this device has both a count and the window it was counted over${missingWindow ? ` (${missingWindow} with a count but no window)` : ''}. Add the window and the line appears.`;
  } else if (counted < 2) {
    sentence =
      'One counted day is not a pattern, so no line is drawn through it. Count one wash a week for a few weeks and the same rule will fit them together.';
  } else {
    sentence = shed.sentence;
  }

  return {
    rule: SHED_RULE_VERSION,
    records: live.length,
    counted,
    noCount,
    missingWindow,
    shed,
    breakage,
    latest,
    pairs,
    sentence
  };
}

/**
 * Length over time, read against the cuts in the same table.
 *
 * The fitted line is the shared `trend()` arithmetic; what this adds is the
 * context a length series needs — a drop with a cut dated before it is a trim,
 * and a drop with nothing dated around it is a question for a person with a
 * dermatoscope, not a conclusion available here.
 */
export function lengthRead(rows: AnyRow[]): LengthRead {
  const live = newestFirst(rows).filter((r) => num(r.lengthCm) !== null);
  const points = [...live]
    .reverse()
    .map((r) => ({ on: dated(r), value: num(r.lengthCm), source: 'Hair length' }));
  const fitted = trend(points, { unit: 'cm' });

  const first = points.length ? { on: points[0].on, cm: points[0].value as number } : null;
  const latest = points.length ? { on: points[points.length - 1].on, cm: points[points.length - 1].value as number } : null;

  const cuts = newestFirst(rows)
    .filter((r) => CUT_KINDS.includes(String(r.kind ?? '').toLowerCase()))
    .map((r) => ({ on: dated(r), label: String(r.label ?? ''), kind: String(r.kind) }))
    .filter((c) => first && latest && c.on >= first.on && c.on <= latest.on);

  const change = first && latest ? Number((latest.cm - first.cm).toFixed(1)) : null;
  const span = first && latest ? (dayIndex(latest.on) as number) - (dayIndex(first.on) as number) : null;

  let sentence: string;
  if (!points.length) {
    sentence = 'No hair record on this device holds a length in cm, so there is nothing to join up.';
  } else if (change === null) {
    sentence = 'One length reading only — it is stored, and no direction is claimed from it.';
  } else if (change < 0 && cuts.length) {
    sentence = `Length went from ${first!.cm} cm on ${first!.on} to ${latest!.cm} cm on ${latest!.on} (${span} days). ${cuts.length} cut or take-down record(s) fall inside that span — the newest being ${cuts[0].kind}${cuts[0].label ? ` “${cuts[0].label}”` : ''} on ${cuts[0].on} — so a large part of the drop is a decision you recorded, not hair lost. What is left after the cuts is still your number to read, not this app's conclusion.`;
  } else if (change < 0) {
    sentence = `Length went from ${first!.cm} cm on ${first!.on} to ${latest!.cm} cm on ${latest!.on} (${span} days) with no cut, trim or take-down dated between them. Nothing here explains that: it could be how it was measured, how it was styled, or something a clinician would want to know about. This app cannot tell those apart.`;
  } else {
    sentence = fitted.usable
      ? `${fitted.sentence}`
      : `Length is ${latest!.cm} cm on ${latest!.on} against ${first!.cm} cm on ${first!.on} (${span} days). ${fitted.sentence}`;
  }

  return { rule: SHED_RULE_VERSION, n: points.length, skipped: fitted.skipped, first, latest, change, spanDays: span, fitted, cuts, sentence };
}

/** The line every panel carrying these numbers ends with, so the limit travels with the figure. */
export const SHED_LIMIT_NOTE =
  'A count of hairs is what you saw in the drain and on the brush — not a hair count, not density, not a diagnosis. Shedding that is medical and shedding that is not look identical in a sink. If a number here worries you, the reading worth getting is a clinician’s.';
