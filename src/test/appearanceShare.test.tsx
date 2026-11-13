import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MakeupPage from '../pages/MakeupPage';
import { ToastHost } from '../ui/primitives';
import { TABLES, type AnyRow } from '../db/schema';
import { findAll, put } from '../db/repo';
import { db } from '../db/db';

/**
 * One profile row carries three departments' writing: Personal Colour's answers
 * and hex lists, the photo read's bands, and the Makeup Studio's own words about
 * colouring. `put` merges the row but replaces `data`, so whoever saves last has
 * to spread what was already there or silently delete two colleagues' records.
 *
 * These tests are the regression net for that: they write the shared row from
 * the Makeup Studio and read back what Personal Colour and the photo read left.
 */

let container: HTMLDivElement;
let root: Root | null = null;

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const settle = async (rounds = 3) => {
  for (let i = 0; i < rounds; i += 1) await act(async () => tick(16));
};
const scope = () => (container.querySelector('.gl-modal') ?? container) as HTMLElement;

function fieldNode(labelText: string) {
  return [...scope().querySelectorAll('label.gl-field')].find((l) => (l.textContent ?? '').includes(labelText)) ?? null;
}

function fieldInput(labelText: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  return (fieldNode(labelText)?.querySelector('input, textarea, select') ?? null) as HTMLSelectElement | null;
}

async function typeInto(labelText: string, value: string) {
  const input = fieldInput(labelText);
  if (!input) throw new Error(`no field labelled “${labelText}”`);
  const proto =
    input instanceof HTMLSelectElement ? window.HTMLSelectElement : input instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement : window.HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLInputElement ? 'input' : 'change', { bubbles: true }));
    await tick(15);
  });
  await settle(1);
}

async function clickButton(node: Element) {
  await act(async () => {
    (node as HTMLElement).click();
    await tick(20);
  });
  await settle(2);
}

/** the colouring card lives on the face-chart chapter, and its own control */
async function openColouring() {
  const tab = [...container.querySelectorAll('button.mk-chapter')].find((b) => (b.textContent ?? '').trim() === 'Face chart');
  if (!tab) throw new Error('the studio offers no face-chart chapter');
  await clickButton(tab);

  const card = container.querySelector('.mk-profile');
  const node = [...(card?.querySelectorAll('button') ?? [])].find((b) => /^(edit|record)$/i.test((b.textContent ?? '').trim()));
  if (!node) throw new Error('the colouring card offers no Edit control');
  await clickButton(node);
}

async function saveColouring() {
  const node = [...scope().querySelectorAll('button')].find((b) => /\bsave\b/i.test(b.textContent ?? ''));
  if (!node) throw new Error('the editor has no Save');
  await clickButton(node);
}

async function mount() {
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter>
        <ToastHost>
          <MakeupPage />
        </ToastHost>
      </MemoryRouter>
    );
  });
  await settle(6);
}

const shared = async () => {
  const rows = (await findAll(TABLES.profile)) as AnyRow[];
  return rows.filter((r) => r.kind === 'appearance');
};

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  root?.unmount();
  root = null;
  container.remove();
  vi.restoreAllMocks();
});

describe('the colouring record shared with two other departments', () => {
  it('writes its own words and leaves the Personal Colour answers where they are', async () => {
    await put(TABLES.profile, {
      id: 'ap-1',
      kind: 'appearance',
      singleton: 1,
      tags: [],
      data: {
        undertone: 'cool',
        depth: 'deep',
        evidence: 'veins read green in daylight',
        notes: ['high contrast brows'],
        answers: { q1: 'Warm|warm', q2: 'Neutral|neutral' },
        favoriteHexes: ['#b48a5e'],
        avoidedHexes: ['#1f2a3a'],
        toneRead: { skinTone: 'tan', L: 62, source: 'photo' }
      }
    } as never);
    await mount();

    await openColouring();
    await typeInto('How you know', 'jewellery preference changed after a year abroad');
    await saveColouring();
    await settle(3);

    const rows = await shared();
    expect(rows).toHaveLength(1);
    const data = rows[0].data as Record<string, unknown>;
    expect(data.evidence).toBe('jewellery preference changed after a year abroad');
    expect(data.answers).toEqual({ q1: 'Warm|warm', q2: 'Neutral|neutral' });
    expect(data.favoriteHexes).toEqual(['#b48a5e']);
    expect(data.avoidedHexes).toEqual(['#1f2a3a']);
    expect(data.toneRead).toEqual({ skinTone: 'tan', L: 62, source: 'photo' });
    expect(data.notes).toEqual(['high contrast brows']);
    expect(data.undertone).toBe('cool');
  });

  it('keeps the tone read it never wrote, and the hex lists it never touched', async () => {
    await put(TABLES.profile, {
      id: 'ap-2',
      kind: 'appearance',
      singleton: 1,
      data: {
        answers: { q9: 'Cool|cool' },
        favoriteHexes: ['#000000', '#ffffff'],
        avoidedHexes: [],
        toneRead: { skinTone: 'ebony', undertone: 'neutral', L: 30, source: 'photo' }
      }
    } as never);
    await mount();

    await openColouring();
    await typeInto('Depth as you read it', 'medium');
    await saveColouring();
    await settle(3);

    const data = (await shared())[0].data as Record<string, unknown>;
    expect(data.answers).toEqual({ q9: 'Cool|cool' });
    expect(data.favoriteHexes).toEqual(['#000000', '#ffffff']);
    expect(data.avoidedHexes).toEqual([]);
    expect(data.toneRead).toEqual({ skinTone: 'ebony', undertone: 'neutral', L: 30, source: 'photo' });
    expect(data.depth).toBeTruthy();
  });

  it('does not answer a blank incoming row with other departments’ data of its own', async () => {
    /* the row that does not exist yet is Personal Colour's to create; the studio
       must not write a half-populated singleton that then wins the merge */
    await mount();
    await openColouring();
    await typeInto('How you know', 'a test I took in 2019');
    await saveColouring();
    await settle(3);

    const rows = await shared();
    expect(rows).toHaveLength(1);
    const data = rows[0].data as Record<string, unknown>;
    expect(data.evidence).toBe('a test I took in 2019');
    expect(data.answers).toBeUndefined();
    expect(data.toneRead).toBeUndefined();
    expect(data.favoriteHexes).toBeUndefined();
  });
});
