/**
 * THE GLOW LAB — trend arithmetic (spec Part 22: honest measurement).
 *
 * A line through her own logged numbers, and a plain statement of how much the
 * numbers scatter around it. Nothing here is a diagnosis, a body-composition
 * claim, or a prediction: the only inputs are dated values she typed into
 * `measurements`, `weightEntries`, `progressEntries` or `hairRecords`.
 *
 * The rule that makes this worth reading:
 *
 *   1. least squares on (day, value), so the fitted direction is one number;
 *   2. the scatter around that line (RMSE) is computed too, because a change
 *      smaller than the noise around it is not a trend — it is a line with an
 *      arrow on it;
 *   3. under five points or under three weeks of span the read refuses and
 *      prints what it would need, rather than guessing a direction.
 */

export const TREND_RULE_VERSION = 1;

/** Fewer dated points than this and the fit is reported, not interpreted. */
export const MIN_POINTS = 5;
/** A shorter window than this cannot separate a change from day-to-day wobble. */
export const MIN_SPAN_DAYS = 21;
/** Fitted changes are also printed per this many days, so lines of different spans compare. */
export const DEFAULT_PER_DAYS = 30;

export interface SeriesPoint {
  /** ISO date, `YYYY-MM-DD`. Anything else is skipped and counted. */
  on: string;
  /**
   * Whatever the row holds. `null`, `''` and non-numbers are skipped and
   * reported in `skipped` — a blank measurement is not a zero measurement, and
   * silently dropping it without saying so would hide rows from the read.
   */
  value: unknown;
  /** Where the number came from, printed back to her verbatim. */
  source?: string;
}

export type TrendDirection = 'rising' | 'falling' | 'flat' | 'unknown';

export interface TrendRead {
  rule: number;
  /**
   * The metric name this line belongs to, carried through from the points when
   * a group of rows was fitted (`trendByMetric`). Blank for a bare fit.
   */
  metric: string;
  /** Points actually used, after bad dates and non-numbers are dropped. */
  n: number;
  /** Points in the input that were thrown away, so a short read is not a mystery. */
  skipped: number;
  from: string | null;
  to: string | null;
  spanDays: number;
  unit: string;
  first: number | null;
  last: number | null;
  /** last − first, on the two ends of the series rather than on the fit. */
  rawChange: number | null;
  /** Slope per `perDays` days from the fit. Null when the fit refused. */
  slopePerSpan: number | null;
  /** Total fitted change across her own span. */
  fittedChange: number | null;
  /** Root mean square error of the points around the line. */
  rmse: number | null;
  /** Coefficient of determination, null when the values never moved. */
  r2: number | null;
  perDays: number;
  direction: TrendDirection;
  /** False whenever `direction` is `unknown`, so callers cannot over-read it. */
  usable: boolean;
  /** Why the read refused, in the words printed under the chart. */
  needs: string[];
  sentence: string;
}

const DAY_MS = 86400000;

/** `YYYY-MM-DD` → whole days since the epoch, or null for anything malformed. */
export function dayIndex(iso: unknown): number | null {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  // rejects 2026-02-31 and friends, which Date.UTC silently rolls forward
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return Math.round(t / DAY_MS);
}

export function isoFromDayIndex(index: number): string {
  return new Date(index * DAY_MS).toISOString().slice(0, 10);
}

function round(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * A number, or null. `null`, `undefined` and `''` mean "not recorded" and must
 * never reach the fit as 0 — a blank measurement is not a zero measurement.
 */
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Number of days between two ISO dates, negative if reversed, null if either is malformed. */
export function daySpan(fromISO: string, toISO: string): number | null {
  const a = dayIndex(fromISO);
  const b = dayIndex(toISO);
  return a === null || b === null ? null : b - a;
}

/**
 * Fit a straight line through dated numbers.
 *
 * `opts.perDays` changes only how the slope is printed; the fit itself is on
 * real days, so a 9-day series and a 90-day series are both honest about their
 * own span.
 */
export function trend(
  input: SeriesPoint[],
  opts: { unit?: string; minPoints?: number; minSpanDays?: number; perDays?: number } = {}
): TrendRead {
  const unit = opts.unit ?? '';
  const minPoints = opts.minPoints ?? MIN_POINTS;
  const minSpanDays = opts.minSpanDays ?? MIN_SPAN_DAYS;
  const perDays = opts.perDays ?? DEFAULT_PER_DAYS;

  const points: { x: number; y: number }[] = [];
  let skipped = 0;
  for (const p of input ?? []) {
    const x = dayIndex(p?.on);
    const y = toNum(p?.value);
    if (x === null || y === null) {
      skipped += 1;
      continue;
    }
    points.push({ x, y });
  }
  points.sort((a, b) => a.x - b.x || a.y - b.y);

  const base: TrendRead = {
    rule: TREND_RULE_VERSION,
    metric: String(input.find((p) => p?.source)?.source ?? ''),
    n: points.length,
    skipped,
    from: points.length ? isoFromDayIndex(points[0].x) : null,
    to: points.length ? isoFromDayIndex(points[points.length - 1].x) : null,
    spanDays: points.length > 1 ? points[points.length - 1].x - points[0].x : 0,
    unit,
    first: points.length ? points[0].y : null,
    last: points.length ? points[points.length - 1].y : null,
    rawChange: points.length > 1 ? points[points.length - 1].y - points[0].y : null,
    slopePerSpan: null,
    fittedChange: null,
    rmse: null,
    r2: null,
    perDays,
    direction: 'unknown',
    usable: false,
    needs: [],
    sentence: ''
  };

  const needs: string[] = [];
  if (points.length === 0) {
    return { ...base, needs: ['no dated numbers to fit'], sentence: `Nothing dated to read${skipped ? ` (${skipped} row(s) had no usable date or number)` : ''}.` };
  }
  if (points.length < 2) {
    return { ...base, needs: [`only one dated number`], sentence: `One reading is a fact, not a direction. Two or more dated numbers are needed.` };
  }

  if (points.length < minPoints) needs.push(`${points.length} dated points where this read wants ${minPoints}`);
  if (base.spanDays < minSpanDays) needs.push(`${base.spanDays} days of span where this read wants ${minSpanDays}`);

  // least squares on (day, value)
  const n = points.length;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  if (sxx === 0) {
    return { ...base, needs: ['every point carries the same date'], sentence: `All ${n} readings are dated the same day, so there is no line to fit.` };
  }

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const fittedChange = slope * base.spanDays;
  let ssRes = 0;
  for (const p of points) {
    const e = p.y - (intercept + slope * p.x);
    ssRes += e * e;
  }
  const rmse = Math.sqrt(ssRes / n);
  const r2 = syy === 0 ? null : Math.max(0, 1 - ssRes / syy);

  const u = unit ? ` ${unit}` : '';
  const fitted = round(fittedChange, 2);
  const noise = round(rmse, 2);

  let direction: TrendDirection;
  if (syy === 0) {
    // literally every logged value identical: flat is a measured fact here, not a shrug
    direction = 'flat';
  } else if (Math.abs(fitted) <= noise) {
    direction = 'flat';
  } else {
    direction = fitted > 0 ? 'rising' : 'falling';
  }

  const usable = needs.length === 0;
  const perSpan = round(slope * perDays, 2);

  let sentence: string;
  if (!usable) {
    sentence = `${n} readings${u} across ${base.spanDays} days (${base.from} → ${base.to}). Fitted change ${signed(fitted)}${u}; the readings scatter ±${noise}${u} around that line. ${needs.join(' and ')}, so no direction is claimed here.`;
  } else if (direction === 'flat') {
    sentence =
      syy === 0
        ? `All ${n} readings${u} are the same value across ${base.spanDays} days (${base.from} → ${base.to}). Nothing moved in what you logged.`
        : `${n} readings${u} across ${base.spanDays} days (${base.from} → ${base.to}). Fitted change ${signed(fitted)}${u} — about ${signed(perSpan)}${u} per ${perDays} days — while the readings scatter ±${noise}${u} around the line. The change is no bigger than the scatter, so this reads as flat, and a real change of more than ${noise}${u} would show.`;
  } else {
    const strength = r2 !== null && r2 >= 0.8 ? 'The points sit close to the line.' : r2 !== null && r2 >= 0.4 ? 'Some of the movement is unexplained.' : 'Most of the movement is unexplained.';
    sentence = `${n} readings${u} across ${base.spanDays} days (${base.from} → ${base.to}). Fitted change ${signed(fitted)}${u} — about ${signed(perSpan)}${u} per ${perDays} days — against a scatter of ±${noise}${u}, so this is read as ${direction}. ${strength} Ends: ${round(base.first as number, 2)}${u} on ${base.from}, ${round(base.last as number, 2)}${u} on ${base.to}. What you logged, nothing inferred from it.`;
  }

  if (skipped > 0) sentence += ` ${skipped} row(s) were skipped for a missing or unusable date or value.`;

  return {
    ...base,
    slopePerSpan: Number.isFinite(perSpan) ? perSpan : null,
    fittedChange: round(fitted, 4),
    rmse: round(rmse, 4),
    r2: r2 === null ? null : round(r2, 3),
    direction: usable ? direction : 'unknown',
    usable,
    needs,
    sentence
  };
}

function signed(v: number): string {
  return v > 0 ? `+${v}` : String(v);
}

/**
 * The most recent fitted change per metric, over the series she already keeps.
 * Groups by `metric` + `unit` so two different measurements never share a line.
 */
export function trendByMetric(
  rows: { on: string; metric?: unknown; value?: unknown; unit?: unknown }[],
  opts: { minPoints?: number; minSpanDays?: number; perDays?: number } = {}
): TrendRead[] {
  const groups = new Map<string, SeriesPoint[]>();
  for (const r of rows ?? []) {
    const metric = String(r.metric ?? '').trim();
    if (!metric) continue;
    const unit = String(r.unit ?? '').trim();
    const key = `${metric.toLowerCase()}::${unit.toLowerCase()}`;
    const list = groups.get(key) ?? [];
    /* the raw value goes through, so a blank row is counted as skipped rather
      than vanishing from the read */
    list.push({ on: String(r.on), value: r.value, source: metric });
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, points]) => trend(points, { ...opts, unit: key.split('::')[1] ?? '' }))
    .filter((t) => t.n > 0)
    .sort((a, b) => String(b.to).localeCompare(String(a.to)) || a.unit.localeCompare(b.unit));
}
