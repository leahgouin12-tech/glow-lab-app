import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProgressPage from '../pages/ProgressPage';
import { ToastHost } from '../ui/primitives';
import { TABLES } from '../db/schema';
import { db } from '../db/db';
import { put } from '../db/repo';
import { newId } from '../db/repo';
import { DEFAULT_SETTINGS } from '../state/settings';
import { updateSettings } from '../state/settings';
import { COVARIATE_FIELDS } from '../engine/covariates';

/**
 * The day strip and the trend read, driven the way she would drive them: type a
 * figure, save, and read what the app writes to the store — then check that the
 * comparison speaks only when the counts carry it.
 */

type AnyRow = Record<string, any>;

let container: HTMLDivElement;
let root: Root;

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const settle = async (rounds = 3) => {
  for (let i = 0; i < rounds; i += 1) await act(async () => tick(15));
};

const text = () => container.textContent ?? '';
const scope = () => (container.querySelector('.gl-modal') ?? container) as HTMLElement;

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
  if (!node) throw new Error(`no button matching “${label}”`);
  await clickNode(node);
  return node as HTMLButtonElement;
}

function fieldInput(labelText: string) {
  const field = [...scope().querySelectorAll('label.gl-field')].find((l) => (l.textContent ?? '').includes(labelText));
  /* the day note is a textarea, not an input, so both count as "the field" */
  return (field?.querySelector('input, textarea') ?? null) as HTMLInputElement | HTMLTextAreaElement | null;
}

async function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement : window.HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(15);
  });
  await settle(1);
}

async function typeInto(labelText: string, value: string) {
  const input = fieldInput(labelText);
  if (!input) throw new Error(`no input under the field “${labelText}”`);
  await setValue(input, value);
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

async function mount() {
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
}

/** `YYYY-MM-DD` a given number of days back from today. */
const ago = (n: number) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const today = ago(0);

async function seedDay(on: string, data: Record<string, number>, updatedAt = Date.now()) {
  return put(TABLES.covariateDays, { id: `day-${on}`, on, data, updatedAt } as never);
}

async function seedRating(on: string, rating: number) {
  return put(TABLES.progressEntries, { id: `prg-${on}`, label: `Check-in ${on}`, domain: 'general', on, rating } as never);
}

async function dayRows(): Promise<AnyRow[]> {
  return (await db.covariateDays.toArray()) as AnyRow[];
}

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
  localStorage.clear();
  await updateSettings({ ...DEFAULT_SETTINGS });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  root?.unmount();
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('logging what the day held', () => {
  it('asks for six self-reported figures and states that none of them is measured', async () => {
    await mount();
    expect(text()).toContain('What the day held');
    expect(text()).toContain('nothing here is measured by a device');
    for (const f of COVARIATE_FIELDS) {
      expect(fieldInput(`${f.label} (`) ?? fieldInput(f.label)).toBeTruthy();
    }
    /* fourteen dates are offered, and today is the one open for editing */
    expect(container.querySelectorAll('.pg-day__strip button').length).toBe(14);
    expect(text()).toContain('Log this day');
  });

  it('stores one row for the date with the figures she typed, and says it measured nothing', async () => {
    await mount();
    await typeInto('Sleep', '7.5');
    await typeInto('Stress', '3');
    await clickText('Log this day');
    await waitUntil('the save toast', () => text().includes('figure(s) stored for'));

    const rows = await dayRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].on).toBe(today);
    expect(rows[0].data.sleepHours).toBe(7.5);
    expect(rows[0].data.stress).toBe(3);
    /* a field she never touched is absent, not zero */
    expect(rows[0].data.alcoholUnits).toBeUndefined();
    expect(text()).toContain('the app measured none of it');
  });

  it('patches the same date instead of writing a second row for it', async () => {
    await seedDay(today, { sleepHours: 6 });
    await mount();
    await typeInto('Alcohol', '2');
    await clickText('Update this day');
    await waitUntil('the update toast', () => text().includes('figure(s) stored for'));

    const rows = await dayRows();
    expect(rows).toHaveLength(1);
    /* the figure already on the row survived the patch */
    expect(rows[0].data).toMatchObject({ sleepHours: 6, alcoholUnits: 2 });
  });

  it('clearing a figure back to blank records “not recorded”, not zero', async () => {
    await seedDay(today, { sleepHours: 8, stress: 4 });
    await mount();
    await typeInto('Sleep', '');
    await clickText('Update this day');
    await waitUntil('the update toast', () => text().includes('figure(s) stored for'));

    const rows = await dayRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].data.sleepHours).toBeUndefined();
    expect(rows[0].data.stress).toBe(4);
    expect(JSON.stringify(rows[0].data)).not.toContain('"sleepHours":0');
  });

  it('refuses to store a day that holds nothing at all', async () => {
    await mount();
    await clickText('Log this day');
    await waitUntil('the refusal', () => text().includes('nothing was stored for that day'));
    expect(await dayRows()).toHaveLength(0);
  });

  it('takes a word about the day and keeps it with the figures', async () => {
    await mount();
    const note = fieldInput('Words about the day');
    if (!note) throw new Error('no note field on the day editor');
    await setValue(note, 'flew back at 2am');
    await typeInto('Sleep', '4');
    await clickText('Log this day');
    await waitUntil('the save toast', () => text().includes('figure(s) stored for'));
    const rows = await dayRows();
    expect(rows[0].data.note).toBe('flew back at 2am');
  });

  it('forgets a logged day without deleting anything else', async () => {
    await seedDay(today, { sleepHours: 7 });
    await mount();
    await clickText('Forget this day');
    await waitUntil('the removal toast', () => text().includes('taken out of the day log'));
    const live = await db.covariateDays.filter((r) => !r.deletedAt).toArray();
    expect(live).toHaveLength(0);
    /* soft-deleted: the row is still there to be brought back */
    expect(await db.covariateDays.count()).toBe(1);
  });
});

describe('the split into good days and off days', () => {
  it('holds the comparison while the counts are too thin, and says which count is short', async () => {
    await seedDay(today, { sleepHours: 8 });
    await seedDay(ago(3), { sleepHours: 5 });
    await seedRating(today, 5);
    await seedRating(ago(3), 1);
    await mount();
    expect(text()).toContain('Split on hold');
    expect(text()).toContain('are wanted');
    expect(text()).not.toContain('Worth a look');
  });

  it('compares the two groups once the days carry enough ratings and spread', async () => {
    const good = [22, 30, 38, 46, 54];
    const off = [26, 34, 42, 50, 58];
    for (const n of good) {
      await seedDay(ago(n), { sleepHours: 8 });
      await seedRating(ago(n), 5);
    }
    for (const n of off) {
      await seedDay(ago(n), { sleepHours: 5 });
      await seedRating(ago(n), 1);
    }
    await mount();
    expect(text()).toContain('Your good days against your off days');
    expect(text()).toContain('8 h on the 5 good day(s)');
    expect(text()).toContain('5 h on the 5 off day(s)');
    expect(text()).toContain('Worth a look, not an explanation');
    /* the rule is stated where she reads it, not hidden in the engine */
    expect(text()).toContain('Groups are your own ratings, not the app’s');
  });

  it('calls a gap the size of her own scatter noise, and refuses to dress it up', async () => {
    /* a real gap (7.5 vs 7) that her own bounce (±0.58) swallows — not two
       identical means, which the engine answers a different way */
    const good = [8, 7, 8, 7];
    const off = [7.5, 6.5, 7.5, 6.5];
    const goodOn = [22, 30, 38, 46];
    const offOn = [26, 34, 42, 50];
    for (let i = 0; i < good.length; i += 1) {
      await seedDay(ago(goodOn[i]), { sleepHours: good[i] });
      await seedRating(ago(goodOn[i]), 5);
    }
    for (let i = 0; i < off.length; i += 1) {
      await seedDay(ago(offOn[i]), { sleepHours: off[i] });
      await seedRating(ago(offOn[i]), 1);
    }
    await mount();
    expect(text()).toContain('size of noise');
    expect(text()).toContain('calling it anything more would be invention');
    expect(text()).not.toContain('Worth a look');
  });

  it('says so when there are rated days but no day rows, and the other way round', async () => {
    await mount();
    expect(text()).toContain('Nothing logged in the day strip yet');

    await seedDay(today, { sleepHours: 7 });
    await mount();
    expect(text()).toContain('no ratings to split them by');
  });
});

describe('direction, with its noise', () => {
  it('fits a falling waist and prints the scatter beside the change', async () => {
    for (let i = 0; i < 8; i += 1) {
      await put(
        TABLES.measurements,
        { id: `m${i}`, kind: 'body', site: 'Waist', value: 92 - i * 0.6, unit: 'cm', takenOn: ago(60 - i * 8), method: 'tape', note: '' } as never
      );
    }
    await mount();
    expect(text()).toContain('Direction, with its noise');
    expect(text()).toContain('Waist (body)');
    expect(text()).toContain('read as falling');
    expect(text()).toContain('scatter');
  });

  it('won’t name a direction across three weeks of numbers', async () => {
    for (let i = 0; i < 3; i += 1) {
      await put(
        TABLES.measurements,
        { id: `w${i}`, kind: 'body', site: 'Neck', value: 38 - i * 0.2, unit: 'cm', takenOn: ago(20 - i * 7), method: 'tape', note: '' } as never
      );
    }
    await mount();
    expect(text()).toContain('not enough');
    expect(text()).toContain('no direction is claimed here');
  });

  it('keeps two metrics on two lines instead of averaging them together', async () => {
    for (let i = 0; i < 6; i += 1) {
      await put(TABLES.measurements, { id: `a${i}`, kind: 'body', site: 'Waist', value: 90 - i * 0.4, unit: 'cm', takenOn: ago(50 - i * 9), method: 'tape', note: '' } as never);
      await put(TABLES.weightEntries, { id: `b${i}`, kg: 70 - i * 0.5, loggedOn: ago(50 - i * 9), context: '' } as never);
    }
    await mount();
    const cards = [...container.querySelectorAll('.pg-trend')];
    const heads = cards.map((c) => c.querySelector('.pg-trend__t')?.textContent ?? '');
    expect(heads).toContain('Waist (body)');
    expect(heads).toContain('Body weight');
    /* the cm line never quotes a kg figure */
    const waist = cards.find((c) => (c.querySelector('.pg-trend__t')?.textContent ?? '').includes('Waist'));
    expect(waist?.textContent).toContain('cm');
    expect(waist?.textContent).not.toContain('kg');
  });

  it('says plainly that there is nothing to fit rather than drawing an invented line', async () => {
    await mount();
    expect(text()).toContain('Nothing to fit yet');
    expect(container.querySelectorAll('.pg-trend').length).toBe(0);
  });

  it('counts a blank measurement as skipped instead of reading it as zero', async () => {
    for (let i = 0; i < 6; i += 1) {
      await put(
        TABLES.measurements,
        { id: `c${i}`, kind: 'body', site: 'Waist', value: i === 2 ? null : 90 - i * 0.3, unit: 'cm', takenOn: ago(60 - i * 10), method: 'tape', note: '' } as never
      );
    }
    await mount();
    const line = container.querySelector('.pg-trend')?.textContent ?? '';
    expect(text()).toContain('1 blank or undated row(s) skipped');
    /* the proof the blank was dropped, not zeroed: a six-point line with a
       90 cm value in the middle would have fitted a collapse, not a waist */
    expect(line).toContain('5 readings');
    expect(line).not.toContain('6 readings');
    expect(line).toContain('Ends: 90 cm');
    expect(line).toContain('88.5 cm on');
  });
});

describe('the store behind both cards', () => {
  it('hands the day log its own table, so nothing is written to progress entries', async () => {
    await mount();
    await typeInto('Sleep', '9');
    await clickText('Log this day');
    await waitUntil('the save toast', () => text().includes('figure(s) stored for'));
    expect(await db.covariateDays.count()).toBe(1);
    expect(await db.progressEntries.count()).toBe(0);
    expect(newId('day').startsWith('day_')).toBe(true);
  });
});

describe('filling a goal from the rows that already hold the number', () => {
  async function seedGoal(metric: string, unit: string, current?: number) {
    await put(
      TABLES.goals,
      {
        id: 'goal-1',
        title: 'Bring the waist down',
        domain: 'body',
        status: 'active',
        priority: 1,
        metric,
        targetValue: 100,
        unit,
        startOn: ago(30),
        targetOn: null,
        data: current === undefined ? {} : { current }
      } as never
    );
  }

  const seedWaist = (value: number, unit = 'cm') =>
    put(TABLES.measurements, { id: 'm-1', kind: 'body', site: 'Waist', value, unit, takenOn: ago(4), method: 'tape', note: '' } as never);

  it('offers the measurement with the rule that produced it, and writes nothing yet', async () => {
    await seedGoal('waist', 'cm');
    await seedWaist(92);
    await mount();
    expect(text()).toContain('Offered from your own rows');
    expect(text()).toContain('Newest Waist measurement: 92 cm');
    expect(text()).toContain('this app cannot take one');
    const row = await db.goals.get('goal-1');
    expect(row.data.current).toBeUndefined();
  });

  it('shows the bar from the offer, then only moves it when she commits', async () => {
    await seedGoal('waist', 'cm');
    await seedWaist(92);
    await mount();
    /* target 100, offered 92 — the ring reads the offer before anything is stored */
    expect(text()).toContain('92%');
    await clickText('Use 92');
    await waitUntil('the commit toast', () => text().includes('committed by hand'));
    const row = await db.goals.get('goal-1');
    expect(row.data.current).toBe(92);
    expect(text()).toContain('the app applied nothing on its own');
  });

  /* The toast is nine seconds of text; the row is the record. The app claims the
     offer's source and date are stamped on the goal, so the sentence has to still
     be there after the page is thrown away and built again from the store. */
  it('keeps naming the source of a committed value after the page is rebuilt', async () => {
    await seedGoal('waist', 'cm');
    await seedWaist(92);
    await mount();
    await clickText('Use 92');
    await waitUntil('the commit toast', () => text().includes('committed by hand'));
    const row = await db.goals.get('goal-1');
    expect(String(row.data.currentNote)).toContain('measurements');
    expect(String(row.data.currentNote)).toContain('committed by hand');

    await act(async () => {
      root.unmount();
    });
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    await mount();

    expect(text()).toContain('from measurements (dated');
    expect(text()).toContain('the app applied nothing on its own');
    /* and the offer is gone: the row carries her number now, so nothing is re-suggested */
    expect(text()).not.toContain('Use 92');
  });

  it('stops offering once the row carries her own number', async () => {
    await seedGoal('waist', 'cm', 88);
    await seedWaist(92);
    await mount();
    expect(text()).not.toContain('Use 92');
    expect(text()).not.toContain('Offered from your own rows');
    expect(text()).toContain('88%');
  });

  it('says what it looked for when nothing on the device names the metric', async () => {
    await seedGoal('jawline definition', '');
    await mount();
    expect(text()).toContain('Nothing on this device names “jawline definition”');
    expect(text()).toContain('only if you type it');
  });

  it('counts this week’s sessions and prints the window beside the count', async () => {
    await put(
      TABLES.goals,
      { id: 'goal-2', title: 'Train', domain: 'fitness', status: 'active', metric: 'sessions', targetValue: 4, unit: '', data: {} } as never
    );
    await put(TABLES.workoutSessions, { id: 's-1', doneOn: ago(1), label: 'legs', durationMin: 50, rpe: 7, entries: [], note: '' } as never);
    await put(TABLES.workoutSessions, { id: 's-2', doneOn: ago(40), label: 'old', durationMin: 40, rpe: 6, entries: [], note: '' } as never);
    await mount();
    expect(text()).toContain('Sessions in the last 7 days: 1');
    expect(text()).toContain('1 workout session row(s) dated in the 7 days');
    expect(text()).toContain('none was inferred');
  });

  it('flags a unit clash instead of offering inches as centimetres', async () => {
    await seedGoal('waist', 'in');
    await seedWaist(92, 'cm');
    await mount();
    expect(text()).toContain('unit differs from the goal row');
  });

  it('divides adherence by the whole window, not by the days she happened to log', async () => {
    await put(
      TABLES.goals,
      { id: 'goal-3', title: 'Keep the routine', domain: 'skin', status: 'active', metric: 'adherence', targetValue: 80, unit: '%', data: {} } as never
    );
    await put(TABLES.routineLogs, { id: 'rl-1', routineId: 'r-1', doneOn: ago(1), completedSteps: [], mood: 0, note: '' } as never);
    await put(TABLES.routineLogs, { id: 'rl-2', routineId: 'r-1', doneOn: ago(2), completedSteps: [], mood: 0, note: '' } as never);
    await mount();
    const pct = Math.round((2 / 28) * 100);
    expect(text()).toContain(`Days logged in the last 28: ${pct} %`);
    expect(text()).toContain('2 separate date(s) with at least one routine log, out of 28 days');
    expect(text()).toContain('never as a zero');
  });
});
