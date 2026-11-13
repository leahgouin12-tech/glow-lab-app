import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FitnessPage from '../pages/FitnessPage';
import { ToastHost } from '../ui/primitives';
import { TABLES, type AnyRow } from '../db/schema';
import { db } from '../db/db';
import { put, todayISO } from '../db/repo';
import { DEFAULT_SETTINGS, updateSettings } from '../state/settings';
import { buildDigest, DIGEST_LIMITS, GAP_NOT_EXPLAINED } from '../engine/fitness';

/**
 * The read-only training digest, met the way she meets it: the Fitness page
 * with rows already in the store. The arithmetic is pinned in
 * src/test/fitness.test.ts; what is pinned here is that the page prints exactly
 * what the engine returned, that an empty log prints an empty line rather than
 * figures, that the stated limits are on the screen, and that nothing in the
 * section writes a single row.
 */

const spies = vi.hoisted(() => ({ saveRow: null as unknown as ReturnType<typeof vi.fn> }));

vi.mock('../hooks/live', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/live')>();
  spies.saveRow = vi.fn(actual.saveRow);
  return { ...actual, saveRow: spies.saveRow };
});

let container: HTMLDivElement;
let root: Root;

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const text = () => container.textContent ?? '';

async function settle(rounds = 3) {
  for (let i = 0; i < rounds; i += 1) await act(async () => tick(18));
}

async function mount() {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ToastHost>
          <FitnessPage />
        </ToastHost>
      </MemoryRouter>
    );
  });
  await settle(6);
}

const digestNode = () => container.querySelector('[data-testid="fitness-digest"]') as HTMLElement | null;
const block = (id: string) => digestNode()?.querySelector(`[data-testid="${id}"]`) ?? null;
const blockText = (id: string) => block(id)?.textContent ?? '';

/** Days before today, at local noon so the ISO date is stable in any TZ. */
const ago = (n: number): string => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
};

async function seedSession(id: string, doneOn: string, entries: Record<string, unknown>[], over: Record<string, unknown> = {}) {
  return put(
    TABLES.workoutSessions,
    {
      id,
      doneOn,
      label: `Session ${id}`,
      durationMin: 55,
      rpe: 7,
      note: '',
      planDayId: null,
      entries,
      tags: ['session'],
      ...over
    } as never
  );
}

/** reps × load for one exercise, so the arithmetic below is readable. */
const work = (reps: number, kg: number, done = true) => ({ reps, kg, rpe: 7, done });
const logged = (exerciseId: string, sets: Record<string, unknown>[]) => ({ exerciseId, sets });

async function seedPlan(over: Record<string, unknown> = {}) {
  return put(
    TABLES.workoutPlans,
    {
      id: String(over.id ?? 'p1'),
      name: 'Three days, eight weeks',
      goal: 'get stronger at hinging',
      daysPerWeek: 3,
      weeks: 8,
      split: [],
      active: true,
      tags: ['plan'],
      ...over
    } as never
  );
}

async function seedExercise(id: string, name: string) {
  return put(
    TABLES.exercises,
    { id, name, pattern: 'hinge', focus: ['glutes'], equipment: ['barbell'], difficulty: 2, cue: '', caution: '', mediaIds: [], seed: 0, tags: [] } as never
  );
}

/** Every row the digest reads, so a write inside the section cannot pass unnoticed. */
async function snapshot() {
  const tables = [TABLES.workoutSessions, TABLES.workoutPlans, TABLES.exercises];
  const dump: Record<string, AnyRow[]> = {};
  for (const t of tables) {
    dump[t] = ((await db.table(t).toArray()) as AnyRow[]).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return JSON.stringify(dump);
}

/** The same six weeks, one per Monday bucket, loads rising so the fit has a direction. */
async function seedSixWeeks() {
  await seedExercise('ex1', 'Romanian deadlift');
  await seedExercise('ex2', 'Farmer carry');
  const loads = [60, 70, 80, 90, 100, 110];
  const days = [2, 9, 16, 23, 30, 37];
  for (let i = 0; i < days.length; i += 1) {
    await seedSession(`s${i}`, ago(days[i]), [logged('ex1', [work(5, loads[i])]), logged('ex2', [work(20, 20)])], {
      note: i === 0 ? 'travel week, short session' : ''
    });
  }
}

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
  localStorage.clear();
  await updateSettings({ ...DEFAULT_SETTINGS });
  spies.saveRow?.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  root?.unmount();
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the digest with sessions in the store', () => {
  it('prints the weekly table and the trend sentence the engine produced', async () => {
    await seedSixWeeks();
    await seedPlan();
    await mount();

    const node = digestNode();
    expect(node).not.toBeNull();

    /* twelve Monday-to-Sunday buckets, six of them carrying a session */
    const rows = node!.querySelectorAll('[data-testid="digest-weeks"] tbody tr');
    expect(rows).toHaveLength(12);
    const weeks = blockText('digest-weeks');
    expect(weeks).toContain('no session');
    expect(weeks).toContain('Volume you logged');
    expect(weeks).toContain('Per session');

    const totals = blockText('digest-totals');
    expect(totals).toContain('6 session(s)');
    expect(totals).toContain('4,950 kg');
    expect(totals).toContain('825.0 kg');

    /* the sentence on screen is byte-identical to the trend engine's own read */
    const expected = buildDigest({
      sessions: (await db.workoutSessions.toArray()) as AnyRow[],
      exercises: (await db.exercises.toArray()) as AnyRow[],
      plans: (await db.workoutPlans.toArray()) as AnyRow[],
      today: todayISO()
    });
    expect(blockText('digest-trend-sentence')).toBe(expected.trend.sentence);
    expect(expected.trend.usable).toBe(true);
    expect(block('digest-trend-sentence')?.textContent).not.toContain('no direction is claimed here');
    expect(blockText('digest-trend-meta')).toContain('week(s) with a session fed the fit');
  });

  it('scores adherence against the daysPerWeek the plan row actually carries', async () => {
    await seedSixWeeks();
    await seedPlan({ daysPerWeek: 1 });
    await mount();

    expect(block('digest-adherence-scored')).not.toBeNull();
    expect(block('digest-adherence-weeks')?.querySelectorAll('.gl-list__row')).toHaveLength(11);
    const note = blockText('digest-adherence-note');
    expect(note).toContain('daysPerWeek: 1');
    expect(blockText('digest-adherence-scored')).toContain('target met');
  });

  it('says the plan carries no readable target instead of inventing one', async () => {
    await seedSixWeeks();
    await seedPlan({ daysPerWeek: 0 });
    await mount();

    expect(block('digest-adherence-scored')).toBeNull();
    const note = blockText('digest-adherence-note');
    expect(note).toContain('daysPerWeek');
    expect(note).toContain('No weekly target is computed');
    expect(blockText('digest-cadence-only')).toContain('Cadence with no denominator');
    expect(blockText('digest-cadence-only')).toContain('sessions per logged week');
  });

  it('reports the longest gap, the current gap and that a gap carries no reason', async () => {
    await seedExercise('ex1', 'Romanian deadlift');
    await seedSession('s1', ago(60), [logged('ex1', [work(5, 100)])]);
    await seedSession('s2', ago(20), [logged('ex1', [work(5, 100)])]);
    await seedSession('s3', ago(18), [logged('ex1', [work(5, 100)])]);
    await mount();

    const gaps = blockText('digest-gaps');
    expect(gaps).toContain('Longest gap inside the window');
    expect(gaps).toContain('40 days');
    expect(gaps).toContain('18 days');
    expect(gaps).toContain('Since your last logged session');
    expect(gaps).toContain('21.0 days');
    expect(blockText('digest-gaps-limits')).toBe(GAP_NOT_EXPLAINED);
  });

  it('covers what is logged against what the library holds, without recommending', async () => {
    await seedSixWeeks();
    await seedExercise('ex3', 'Bench press');
    await mount();

    const top = blockText('digest-coverage-top');
    expect(top).toContain('Romanian deadlift');
    expect(top).toContain('Farmer carry');
    expect(top).toContain('6 session(s) · 6 done set(s) · 2,550 kg');
    expect(blockText('digest-coverage-never')).toContain('Bench press');
    expect(blockText('digest-coverage-rest')).toContain('all listed above');
    const coverage = blockText('digest-coverage-top') + blockText('digest-coverage-never');
    expect(coverage).not.toMatch(/you should|add more|need to train|prescribe/);
  });

  it('shows the data-quality line where the logging is thin', async () => {
    await seedExercise('ex1', 'Romanian deadlift');
    await seedSession('s1', ago(2), [logged('ex1', [work(5, 100), work(8, 40, false)])], { note: '' });
    await seedSession('s2', ago(9), []);
    await seedSession('s3', ago(16), [logged('ex1', [{ reps: 6, rpe: 6, done: true }])]);
    await mount();

    const quality = blockText('digest-quality');
    expect(quality).toContain('Too sparse to compute anything from');
    expect(quality).toContain('1 session(s) with no entry row or no completed set');
    expect(quality).toContain('Sets stored as not done');
    expect(quality).toContain('1 of 3 set(s) — excluded from volume');
    expect(quality).toContain('Completed sets with no load written');
    expect(quality).toContain('Sessions carrying a note');
  });

  it('prints no unit when no completed set carries a load', async () => {
    await seedExercise('ex1', 'Romanian deadlift');
    await seedSession('s1', ago(2), [logged('ex1', [{ reps: 12, kg: null, rpe: 5, done: true }])]);
    await mount();

    expect(block('digest-no-unit')).not.toBeNull();
    expect(blockText('digest-no-unit')).toContain('carry no unit');
    expect(blockText('digest-totals')).not.toContain('kg');
    expect(blockText('digest-quality')).toContain('none — no completed set here carries a load');
  });

  it('states its limits in the section header', async () => {
    await seedSixWeeks();
    await mount();
    const note = blockText('digest-limits');
    expect(note).toBe(DIGEST_LIMITS);
    expect(note).toContain('read only from the session rows you logged');
    expect(note).toContain('no claim about your body, your health, or what you should do next');
    expect(note).toContain('prescribes nothing');
    expect(text()).toContain('Read-only · nothing in this section writes');
  });
});

describe('the digest with nothing logged', () => {
  it('renders the empty line and no figures at all', async () => {
    await mount();

    expect(digestNode()).not.toBeNull();
    expect(block('digest-empty')).not.toBeNull();
    expect(blockText('digest-empty')).toContain('Nothing logged in this window');
    expect(blockText('digest-empty-reach')).toContain('no dated session row in the log at all');

    for (const id of ['digest-weeks', 'digest-totals', 'digest-trend-sentence', 'digest-gaps', 'digest-adherence-scored', 'digest-quality', 'digest-coverage-top']) {
      expect(block(id), id).toBeNull();
    }

    const printed = digestNode()!.textContent ?? '';
    expect(printed).not.toContain('NaN');
    expect(printed).not.toContain('Infinity');
    expect(printed).not.toContain('undefined');
  });

  it('says how many older rows sit outside the window instead of reading as a zero', async () => {
    await seedExercise('ex1', 'Romanian deadlift');
    await seedSession('ancient', ago(400), [logged('ex1', [work(5, 100)])]);
    await mount();

    expect(block('digest-empty')).not.toBeNull();
    expect(blockText('digest-empty-reach')).toContain('1 dated session row(s) sit before this window');
    expect(blockText('digest-limits')).toBe(DIGEST_LIMITS);
  });
});

describe('the digest cannot write', () => {
  it('holds no control, mutates no row and calls no save helper', async () => {
    await seedSixWeeks();
    await seedPlan();
    await mount();

    const before = await snapshot();

    const node = digestNode()!;
    expect(node.querySelectorAll('button, input, select, textarea').length).toBe(0);
    /* the only form control left that could write is a click on a non-control */
    await act(async () => {
      node.querySelectorAll('h2, h3, summary, .gl-list__row, td').forEach((el) => (el as HTMLElement).click());
      await tick(20);
    });
    await settle(4);

    expect(await snapshot()).toBe(before);
    expect(spies.saveRow).not.toHaveBeenCalled();
    expect(await db.workoutSessions.count()).toBe(6);
    expect(await db.workoutPlans.count()).toBe(1);
  });
});
