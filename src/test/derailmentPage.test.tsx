import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsistencyWidget } from '../ui/consistency';
import { ToastHost } from '../ui/primitives';
import { TABLES } from '../db/schema';
import { addDays, put, todayISO } from '../db/repo';
import { db } from '../db/db';
import { findAll } from '../db/repo';

/**
 * The derailment record driven the way she would drive it: click the miss, pick
 * a label, write the words, save — then read what actually landed in
 * `derailments`. The card's own promise is the thing under test here: every
 * printed number stays where it was, because a record explains a miss and never
 * removes it.
 */

let container: HTMLDivElement;
let root: Root | null = null;

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const text = () => container.textContent ?? '';
const settle = async (rounds = 3) => {
  for (let i = 0; i < rounds; i += 1) await act(async () => tick(15));
};

async function clickNode(node: Element) {
  await act(async () => {
    (node as HTMLElement).click();
    await tick(20);
  });
  await settle(2);
}

function findButton(label: string, within: HTMLElement = container) {
  const needle = label.toLowerCase();
  return [...within.querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').trim().toLowerCase().includes(needle) || (b.getAttribute('aria-label') ?? '').toLowerCase().includes(needle)
  );
}

async function clickText(label: string, within?: HTMLElement) {
  const node = findButton(label, within ?? container);
  if (!node) throw new Error(`no button matching “${label}”`);
  await clickNode(node);
  return node as HTMLButtonElement;
}

function fieldInput(labelText: string) {
  const field = [...container.querySelectorAll('label.gl-field')].find((l) => (l.textContent ?? '').includes(labelText));
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
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter>
        <ToastHost>
          <ConsistencyWidget />
        </ToastHost>
      </MemoryRouter>
    );
  });
  await settle(8);
}

async function unmount() {
  if (root) await act(async () => root?.unmount());
  root = null;
  container.remove();
}

/** `YYYY-MM-DD` n days back from the device's own today. */
const ago = (n: number) => addDays(todayISO(), -n);
const ahead = (n: number) => addDays(todayISO(), n);

/**
 * Everything this card prints as arithmetic: the seven cell counts, the totals
 * chip, each meter's percentage and the four stat figures. A record is allowed
 * to move none of them.
 */
function numbers() {
  return JSON.stringify({
    cells: [...container.querySelectorAll('.gl-cons__count')].map((n) => n.textContent?.trim()),
    totals: container.querySelector('.gl-cons__window .gl-chip')?.textContent?.trim() ?? '',
    meters: [...container.querySelectorAll('.gl-meter')].map((m) => m.getAttribute('aria-valuenow')),
    stats: [...container.querySelectorAll('.gl-num')].map((n) => n.textContent?.trim())
  });
}

const routineRow = () => ({
  id: 'r1',
  name: 'Morning skin',
  domain: 'skin',
  timeOfDay: 'am',
  active: true,
  steps: [],
  createdAt: Date.now() - 40 * 86400000
});

const planRow = () => ({
  id: 'p1',
  name: 'Barrier repair',
  days: 28,
  startOn: ago(20),
  reviewEveryDays: 7,
  status: 'active',
  actions: [
    {
      id: 'a1',
      label: 'SPF 50 every morning',
      category: 'skin',
      cadence: 'daily',
      dayOffset: 0,
      weeks: [],
      costBand: 'low',
      techniqueId: null,
      productId: null,
      goalId: null,
      doneOn: []
    }
  ]
});

/** A log two weeks back: it makes the card active, and leaves this week all miss. */
const oldLog = () => ({ id: 'l1', routineId: 'r1', doneOn: ago(14), completedSteps: [], mood: 0, note: '' });

async function seedActivity() {
  await put(TABLES.routines, routineRow() as never);
  await put(TABLES.routineLogs, oldLog() as never);
  await put(TABLES.plans, planRow() as never);
}

const derailSeed = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  on: ago(2),
  kind: 'general',
  refId: null,
  refLabel: 'the day itself',
  trigger: 'illness',
  reason: 'Fever from the morning.',
  fix: 'Went to bed instead.',
  followUpOn: null,
  status: 'open',
  resolvedOn: null,
  ...over
});

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
  localStorage.clear();
});

afterEach(async () => {
  await unmount();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------ recording from a miss */

describe('recording from a missed row', () => {
  it('writes a real routine row into derailments and shows it again after a reload', async () => {
    await seedActivity();
    await mount();

    expect(text()).toContain('When it came apart');
    expect(text()).toContain('Nothing has been recorded as a derailment');
    const before = numbers();

    const miss = container.querySelector('[data-derailment-miss^="routine|r1|"]') as HTMLElement;
    expect(miss).not.toBeNull();
    const on = (miss.getAttribute('data-derailment-miss') ?? '').split('|')[2];
    await clickNode(miss.querySelector('button') as Element);
    expect(container.querySelector('[data-derailment-form]')).not.toBeNull();

    await clickText('not enough sleep');
    await typeInto('What happened, in your words', 'Up until three, nothing worked.');
    await typeInto('What would get you back on it', 'Put the alarm on the other side of the room.');
    await clickText('Save');

    await waitUntil('the record to be written', () => text().includes('Up until three, nothing worked.'));
    const rows = await findAll(TABLES.derailments);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      on,
      kind: 'routine',
      refId: 'r1',
      refLabel: 'Morning skin',
      trigger: 'sleep',
      reason: 'Up until three, nothing worked.',
      status: 'open',
      followUpOn: null
    });

    // the arithmetic printed above did not move by a digit
    expect(numbers()).toBe(before);

    // and it is still there after a reload, read straight out of IndexedDB
    await unmount();
    await mount();
    expect(text()).toContain('Up until three, nothing worked.');
    expect(text()).toContain('not enough sleep');
    expect(container.querySelector(`[data-derailment-record="${rows[0].id}"]`)).not.toBeNull();
    expect(numbers()).toBe(before);
  });

  it('explains a day with nothing attached to it, and writes kind general', async () => {
    await seedActivity();
    await mount();
    const before = numbers();

    const day = container.querySelector('[data-derailment-day]') as HTMLElement;
    expect(day).not.toBeNull();
    const on = day.getAttribute('data-derailment-day') as string;
    await clickNode(day.querySelector('button') as Element);
    await clickText('travel');
    await typeInto('What happened, in your words', 'Airport until nine.');
    await clickText('Save');
    await waitUntil('the day record', () => text().includes('Airport until nine.'));

    const rows = await findAll(TABLES.derailments);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ on, kind: 'general', refId: null, trigger: 'travel' });
    expect(numbers()).toBe(before);
    expect(day.getAttribute('data-explained')).toBe('true');
    expect(text()).toContain('you wrote why (1)');
  });

  it('refuses a save with no label and says why', async () => {
    await seedActivity();
    await mount();

    const days = container.querySelector('[data-derailment-day]') as HTMLElement;
    await clickNode(days.querySelector('button') as Element);
    const save = findButton('Save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await typeInto('What happened, in your words', 'No label chosen yet.');
    expect((findButton('Save') as HTMLButtonElement).disabled).toBe(true);
    expect(await findAll(TABLES.derailments)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------- resolved */

describe('marking a record resolved', () => {
  it('moves it out of the open follow-up list and keeps the miss counted', async () => {
    await seedActivity();
    await put(TABLES.derailments, derailSeed({ followUpOn: ago(1), reason: 'Fever from the morning.' }) as never);
    await mount();

    const due = container.querySelector('[data-follow-up]') as HTMLElement;
    expect(due).not.toBeNull();
    expect(due.getAttribute('data-overdue')).toBe('true');
    expect(text()).toContain('1 day past the date you chose');
    expect(text()).toContain('Follow-ups you have not marked resolved');
    const before = numbers();

    await clickText('Mark resolved');
    await waitUntil('the follow-up list to empty', () => container.querySelector('[data-follow-up]') === null);

    expect(numbers()).toBe(before);
    expect(text()).toContain('marked resolved');
    const rows = await findAll(TABLES.derailments);
    expect(rows[0]).toMatchObject({ status: 'resolved' });
    expect(rows[0].resolvedOn).toBe(todayISO());
    expect(rows[0].reason).toBe('Fever from the morning.');
    expect(text()).toContain('Fever from the morning.');
  });

  it('leaves a record with no follow-up date out of the due list but in the summary', async () => {
    await seedActivity();
    await put(TABLES.derailments, derailSeed({ followUpOn: null }) as never);
    await mount();

    expect(container.querySelector('[data-follow-up]')).toBeNull();
    expect(text()).toContain('No follow-up date of yours is due or past due');
    expect(text()).toContain('You recorded 1 derailment');
  });
});

/* ------------------------------------------------------- the counts standing */

describe('the counts above', () => {
  it('are unchanged by adding, editing and deleting a record', async () => {
    await seedActivity();
    await mount();
    const before = numbers();

    const days = container.querySelector('[data-derailment-day]') as HTMLElement;
    await clickNode(days.querySelector('button') as Element);
    await clickText('stress');
    await typeInto('What happened, in your words', 'Deadline moved twice.');
    await clickText('Save');
    await waitUntil('the record', () => text().includes('Deadline moved twice.'));
    expect(numbers()).toBe(before);

    await clickText('Edit');
    await typeInto('What happened, in your words', 'Deadline moved twice, then again.');
    await clickText('Save changes');
    await waitUntil('the edit', () => text().includes('then again.'));
    expect(numbers()).toBe(before);

    await clickText('Move to deleted');
    await waitUntil('the list to empty', () => container.querySelectorAll('[data-derailment-record]').length === 0);
    expect(numbers()).toBe(before);

    const rows = await findAll(TABLES.derailments, { includeDeleted: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).not.toBeNull();

    await clickText('Undo');
    await waitUntil('the restore', () => text().includes('Deadline moved twice, then again.'));
    expect(numbers()).toBe(before);
  });

  it('says the numbers already stand when nothing has been recorded', async () => {
    await seedActivity();
    await mount();

    expect(text()).toContain('Recording one is optional: the counts above already stand');
    expect(text()).toContain('a missed day stays a missed day either way');
    expect(text()).toContain('A derailment record explains a missed day; it never removes one.');
    expect(text()).not.toMatch(/NaN|undefined|\bnull%/);
  });

  it('names the label as hers and not as a cause', async () => {
    await seedActivity();
    await put(TABLES.derailments, derailSeed({ id: 'd1', on: ago(2), trigger: 'sleep' }) as never);
    await put(TABLES.derailments, derailSeed({ id: 'd2', on: ago(1), trigger: 'sleep', refLabel: 'the day itself' }) as never);
    await mount();

    expect(text()).toContain('not enough sleep');
    expect(text()).toContain('2 of 2 recorded');
    expect(text()).toContain('the most frequent label is you saying so, not a finding about cause');
    expect(text()).toContain('The app observed nothing');
  });
});
