import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import ProfilePage from '../pages/ProfilePage';
import { ToastHost } from '../ui/primitives';
import { TABLES } from '../db/schema';
import { findAll, put, todayISO } from '../db/repo';
import { db } from '../db/db';

/**
 * The profile is the one place the user types about themselves, so the test
 * that matters is "can a field be filled in on a install that never ran
 * onboarding" — that is, with no `profile` row for the section yet.
 */

let container: HTMLDivElement;
let root: Root;

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const settle = async (rounds = 4) => {
  for (let i = 0; i < rounds; i += 1) await act(async () => tick(18));
};

/** Cards are per section, so a label like "Notes" is only ambiguous once scoped. */
function cardTitled(title: string) {
  const card = [...container.querySelectorAll('.gl-profile__section')].find((el) =>
    (el.querySelector('.gl-card__head')?.textContent ?? '').toLowerCase().includes(title.toLowerCase())
  );
  if (!card) throw new Error(`no profile card titled "${title}"`);
  return card;
}

function fieldByLabel(label: string, sectionTitle = '') {
  const scope = sectionTitle ? cardTitled(sectionTitle) : container;
  const host = [...scope.querySelectorAll('.gl-field')].find(
    (el) => (el.querySelector('.gl-field__label')?.textContent ?? '').trim().toLowerCase() === label.toLowerCase()
  );
  const input = host?.querySelector('input, textarea, select') as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  if (!input) throw new Error(`no control rendered for the "${label}" field${sectionTitle ? ` in ${sectionTitle}` : ''}`);
  return input;
}

async function type(input: HTMLElement, value: string) {
  await act(async () => {
    const proto =
      input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // the card writes on a beat, not per keystroke — wait past it
  await act(async () => tick(700));
  await settle(2);
}

const hairRow = async () => (await findAll(TABLES.profile)).find((r) => r.kind === 'hair');
const data = (row: any) => (row?.data ?? {}) as Record<string, unknown>;

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
  container = document.createElement('div');
  document.body.appendChild(container);
});

async function mount() {
  root = createRoot(container);
  await act(async () => root.render(<ToastHost><ProfilePage /></ToastHost>));
  await settle();
}

async function unmount() {
  await act(async () => root.unmount());
  container.remove();
}

describe('filling in the profile', () => {
  it('writes a section that has no row yet, instead of dying on an undefined key', async () => {
    await mount();
    // Onboarding was skipped: no `profile` rows exist at all.
    expect((await findAll(TABLES.profile)).length).toBe(0);

    await type(fieldByLabel('Retwist interval (weeks)', 'Hair'), '4');
    const row = await hairRow();
    expect(row).toBeTruthy();
    expect(String(row!.id)).not.toBe('undefined');
    expect(data(row).retwistEveryWeeks).toBe(4);
    await unmount();
  });

  it('keeps every field of a section on one row as you go', async () => {
    await mount();
    await type(fieldByLabel('Texture', 'Hair'), 'coily');
    await type(fieldByLabel('Porosity', 'Hair'), 'low');
    await type(fieldByLabel('Notes', 'Hair'), 'pineapple at night');

    const rows = (await findAll(TABLES.profile)).filter((r) => r.kind === 'hair');
    expect(rows.length).toBe(1);
    expect(data(rows[0]).texture).toBe('coily');
    expect(data(rows[0]).porosity).toBe('low');
    expect(data(rows[0]).notes).toBe('pineapple at night');
    await unmount();
  });

  it('writes into a section that already has a row without replacing what is stored', async () => {
    await put(TABLES.profile, { kind: 'skin', singleton: 1, data: { type: 'combination', concerns: 'texture along the jaw' } } as any);
    await mount();
    await type(fieldByLabel('Sensitivity', 'Skin'), 'high');

    const rows = (await findAll(TABLES.profile)).filter((r) => r.kind === 'skin');
    expect(rows.length).toBe(1);
    expect(data(rows[0]).sensitivity).toBe('high');
    expect(data(rows[0]).type).toBe('combination');
    expect(data(rows[0]).concerns).toBe('texture along the jaw');
    await unmount();
  });

  it('lets a number field be cleared again', async () => {
    await put(TABLES.profile, { kind: 'hair', singleton: 1, data: { currentLengthCm: 22 } } as any);
    await mount();
    const input = fieldByLabel('Current length (cm)', 'Hair');
    expect((input as HTMLInputElement).value).toBe('22');
    await type(input, '');
    const row = await hairRow();
    expect(data(row).currentLengthCm).toBeNull();
    await unmount();
  });

  it('hides the photo read while the image switch stays off, and shows it once it is on', async () => {
    await mount();
    // DEFAULT_SETTINGS ships imageAnalysis off, so nothing is read by default
    expect(container.textContent).toContain('Photo-assisted reading is switched off');
    expect(container.textContent).not.toContain('Read the framed area');

    // the switch is on this very page, so flipping it must open the card here
    const gate = [...container.querySelectorAll('[role="switch"]')].find((el) => (el.textContent ?? '').includes('On-device image tools')) as HTMLElement | undefined;
    if (!gate) throw new Error('no on-device image tools switch rendered');
    await act(async () => gate.click());
    await settle();
    expect(container.textContent).toContain('Read the two colour bands off a photo');
    expect(container.textContent).toContain('Read the framed area');
    await unmount();
  });

  it('writes text fields that are not one of the preset selects', async () => {
    await mount();
    await type(fieldByLabel('Name or nickname', 'Person'), 'Nia');
    await type(fieldByLabel('Pronouns', 'Person'), 'she/her');
    await type(fieldByLabel('Typical sleep', 'Person'), '23:30-06:45');

    const row = (await findAll(TABLES.profile)).find((r) => r.kind === 'personal');
    expect(data(row).name).toBe('Nia');
    expect(data(row).pronouns).toBe('she/her');
    expect(data(row).sleep).toBe('23:30-06:45');
    await unmount();
    // 20s rather than the 5s default: three type-and-save round trips take ~9s
    // when the whole suite runs in parallel, and pass in 2.5s on their own.
  }, 20_000);
});
