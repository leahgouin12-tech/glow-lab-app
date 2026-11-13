import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HairPage from '../pages/HairPage';
import { ToastHost } from '../ui/primitives';
import { TABLES } from '../db/schema';
import { db } from '../db/db';
import { put } from '../db/repo';
import { DEFAULT_SETTINGS } from '../state/settings';
import { updateSettings } from '../state/settings';

/**
 * The shed counts and the length they cost, driven the way she would drive
 * them: open the archive, count a wash, and read what the store holds and what
 * the panel says about it. The arithmetic lives in `engine/shed.ts` and is
 * tested there; what these tests hold the page to is that every figure on
 * screen came from a row, that a blank takes the figure off the record, and
 * that the panel never says more than the counts allow.
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

function fieldNode(labelText: string) {
  return [...scope().querySelectorAll('label.gl-field')].find((l) => (l.textContent ?? '').includes(labelText)) ?? null;
}

function fieldInput(labelText: string): HTMLInputElement | null {
  return (fieldNode(labelText)?.querySelector('input, textarea') ?? null) as HTMLInputElement | null;
}

function fieldSelect(labelText: string): HTMLSelectElement | null {
  return (fieldNode(labelText)?.querySelector('select') ?? null) as HTMLSelectElement | null;
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
  const input = fieldInput(labelText);
  if (!input) throw new Error(`no input under the field “${labelText}”`);
  await setValue(input, value);
}

async function choose(labelText: string, value: string) {
  const select = fieldSelect(labelText);
  if (!select) throw new Error(`no select under the field “${labelText}”`);
  await setValue(select, value);
}

async function waitUntil(what: string, done: () => boolean | Promise<boolean>, budget = 12000) {
  const started = Date.now();
  for (;;) {
    if (await done()) return;
    if (Date.now() - started > budget) throw new Error(`timed out waiting for ${what}`);
    await act(async () => {
      await tick(25);
    });
  }
}

async function mount(view: string) {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ToastHost>
          <HairPage />
        </ToastHost>
      </MemoryRouter>
    );
  });
  await settle(5);
  await clickText(view);
  await settle(2);
}

const ago = (n: number) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

async function seedRecord(id: string, daysAgo: number, cols: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) {
  return put(
    TABLES.hairRecords,
    {
      id,
      kind: 'note',
      doneOn: ago(daysAgo),
      label: `Record ${id}`,
      detail: '',
      cost: null,
      professionalId: null,
      locCount: null,
      locThickness: '',
      lengthCm: null,
      mediaIds: [],
      data: payload,
      /* kind and length are columns on the row; the counts are the new part */
      ...cols
    } as never
  );
}

const record = async (id: string): Promise<AnyRow> => (await db.hairRecords.get(id)) as AnyRow;

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

describe('counting a wash', () => {
  it('opens the archive with the shed panel empty and honest about being empty', async () => {
    await mount('Event archive');
    expect(text()).toContain('What you counted, and what the length did');
    expect(text()).toContain('0 counted record(s) of 0');
    expect(text()).toContain('No dated hair records to read');
    expect(text()).toContain('not a diagnosis');
    expect(text()).toContain('clinician');
  });

  it('writes the count, its window, the breakage and the variable onto the record', async () => {
    await mount('Event archive');
    await clickText('Log a counted wash');
    await typeInto('Label', 'counted wash');
    await typeInto('Hairs shed', '120');
    await choose('Counted over', 'three-days');
    await typeInto('Hairs broken', '4');
    await typeInto('The one variable changed', 'started the new shampoo');
    await clickText('Save event');
    await waitUntil('the saved record', async () => (await db.hairRecords.count()) > 0);

    const rows = (await db.hairRecords.toArray()) as AnyRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0].data.shedCount).toBe(120);
    expect(rows[0].data.shedBasis).toBe('three-days');
    expect(rows[0].data.breakageCount).toBe(4);
    expect(rows[0].data.variableChanged).toBe('started the new shampoo');
    /* the day is the window divided out, not the raw handful */
    expect(text()).toContain('40 per day (120 over three days)');
    expect(text()).toContain('1 counted record(s) of 1');
  });

  it('drops the figure from the row when she takes it back off the form', async () => {
    await seedRecord('h1', 4, {}, { shedCount: 90, shedBasis: 'wash', variableChanged: 'old note' });
    await mount('Event archive');
    await clickText('Edit event');
    await typeInto('Hairs shed', '');
    await choose('Counted over', '');
    await typeInto('The one variable changed', '');
    await clickText('Save event');
    await waitUntil('the cleared record', async () => (await record('h1')).data.shedCount === undefined);

    const row = await record('h1');
    expect(row.data.shedBasis).toBeUndefined();
    expect(row.data.variableChanged).toBeUndefined();
    expect(text()).toContain('0 counted record(s) of 1');
    expect(text()).toContain('1 record(s) with no count');
  });

  it('counts a number with no window as a number with no window', async () => {
    await seedRecord('h1', 6, {}, { shedCount: 60 });
    await mount('Event archive');
    expect(text()).toContain('1 count(s) with no window');
    expect(text()).toContain('the window it was counted over');
  });
});

describe('the length column', () => {
  it('credits the dated cut for the part of the drop it explains', async () => {
    await seedRecord('l1', 60, { lengthCm: 20 });
    await seedRecord('cut', 30, { kind: 'cut', label: 'took off the split ends' });
    await seedRecord('l2', 10, { lengthCm: 12 });
    await mount('Event archive');
    expect(text()).toContain('2 length reading(s)');
    expect(text()).toContain('cut or take-down record(s) fall inside that span');
    expect(text()).toContain('a decision you recorded');
    expect(text()).toContain('1 cut(s) inside the span');
  });

  it('refuses to explain a drop that has no cut near it', async () => {
    await seedRecord('l1', 60, { lengthCm: 20 });
    await seedRecord('l2', 10, { lengthCm: 12 });
    await mount('Event archive');
    expect(text()).toContain('no cut, trim or take-down dated between them');
    expect(text()).toContain('cannot tell those apart');
    expect(text()).not.toContain('a decision you recorded');
  });

  it('keeps retention and growth as two different questions', async () => {
    await seedRecord('l1', 30, { lengthCm: 14 });
    await mount('Event archive');
    expect(text()).toContain('Retention is not the same as growth');
    expect(text()).toContain('typed by you or your stylist');
  });
});

describe('the panel beside the archive it reads from', () => {
  it('does not count a soft-deleted event among the records', async () => {
    await seedRecord('h1', 6, {}, { shedCount: 60, shedBasis: 'wash' });
    await seedRecord('h2', 12, {}, { shedCount: 60, shedBasis: 'wash' });
    await put(TABLES.hairRecords, { id: 'h2', deletedAt: Date.now() } as never);
    await mount('Event archive');
    expect(text()).toContain('1 counted record(s) of 1');
  });

  it('pairs each count with the one variable, oldest of the pairs last', async () => {
    await seedRecord('h1', 20, {}, { shedCount: 120, shedBasis: 'wash', variableChanged: 'started minoxidil' });
    await seedRecord('h2', 6, {}, { shedCount: 60, shedBasis: 'wash', variableChanged: 'stopped the new shampoo' });
    await mount('Event archive');
    const where = text();
    expect(where).toContain('60 per day (60 over one wash) · stopped the new shampoo');
    expect(where).toContain('120 per day (120 over one wash) · started minoxidil');
    expect(where.indexOf('stopped the new shampoo')).toBeLessThan(where.indexOf('started minoxidil'));
  });
});
