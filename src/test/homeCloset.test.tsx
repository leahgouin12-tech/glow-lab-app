import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '../pages/HomePage';
import { ToastHost } from '../ui/primitives';
import { TABLES } from '../db/schema';
import { put } from '../db/repo';
import { db } from '../db/db';
import { DEFAULT_SETTINGS, updateSettings } from '../state/settings';

/**
 * The dashboard now reads the closet too, so these tests hold it to the same
 * promise the closet page is held to: every number on it is a count over rows
 * she wrote, the piece it names is the one her own wear log says has waited
 * longest, and the card never turns either fact into advice.
 */

const iso = (daysAgo: number) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let container: HTMLDivElement;
let root: Root | null = null;

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const text = () => container.textContent ?? '';
const card = () => container.querySelector('[data-testid="home-closet"]');

async function settle(rounds = 3) {
  for (let i = 0; i < rounds; i += 1) await act(async () => tick(16));
}

async function mount(cards: string[] = []) {
  await updateSettings({ ...DEFAULT_SETTINGS, dashboardCards: cards });
  if (root) {
    await act(async () => root?.unmount());
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter>
        <ToastHost>
          <HomePage />
        </ToastHost>
      </MemoryRouter>
    );
  });
  await settle(6);
}

async function piece(id: string, over: Record<string, unknown> = {}) {
  await put(TABLES.clothingItems, {
    id,
    name: over.name ?? id,
    category: over.category ?? 'Tops',
    wears: over.wears ?? 0,
    seasons: over.seasons ?? [],
    occasions: over.occasions ?? [],
    data: { lastWornOn: over.lastWornOn ?? null }
  } as never);
}

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
  localStorage.clear();
});

afterEach(() => {
  root = null;
  container?.remove();
  vi.restoreAllMocks();
});

describe('the closet glance on the dashboard', () => {
  it('names the piece her own dates say has waited longest', async () => {
    await piece('linen shirt', { wears: 4, lastWornOn: iso(2) });
    await piece('wool jumper', { wears: 1, lastWornOn: iso(40) });
    await mount();

    expect(card()).not.toBeNull();
    expect(text()).toContain('“wool jumper” (Top) was last worn 40 days ago, with 1 wear logged.');
    expect(text()).not.toContain('linen shirt');
  });

  it('puts a never-worn piece first and calls it never worn, not a guess', async () => {
    await piece('silk scarf', { wears: 0, lastWornOn: null });
    await piece('linen shirt', { wears: 9, lastWornOn: iso(1) });
    await mount();

    expect(text()).toContain('“silk scarf” (Top) has never been worn and carries no wear date.');
  });

  it('names the date when the count disagrees with it, and says which is missing', async () => {
    await piece('denim jacket', { category: 'Outerwear', wears: 0, lastWornOn: iso(20) });
    await mount();

    expect(text()).toContain('has waited 20 days since a wear date, but no wears are logged');
    expect(text()).toContain('the number comes from the date alone');
  });

  it('refuses to name a wait when no piece carries a date', async () => {
    await piece(' cotton tee', { wears: 6, lastWornOn: null });
    await piece('wide trouser', { category: 'Bottoms', wears: 2, lastWornOn: null });
    await mount();

    expect(text()).toContain('Every placeable piece here has a wear count but no last-worn date');
    expect(text()).toContain('(2 pieces without one)');
    expect(text()).toContain('2 with no last-worn date');
  });

  it('leaves a category the closet cannot place out of the wait and the count', async () => {
    await piece('silk scarf', { category: 'Accessories', wears: 0, lastWornOn: null });
    await piece('linen shirt', { wears: 1, lastWornOn: iso(30) });
    await mount();

    expect(text()).toContain('“linen shirt” (Top) was last worn 30 days ago, with 1 wear logged.');
    expect(text()).toContain('1 of 2 pieces the closet can place');
  });

  it('counts the season holes the matrix counts, in the same breath', async () => {
    await piece('winter coat', { category: 'Outerwear', wears: 1, lastWornOn: iso(4), seasons: ['Winter'] });
    await mount();

    expect(text()).toContain('1 of 6 slots have pieces');
    expect(text()).toContain('29 slot-season pairs nothing can dress');
  });

  it('says what both numbers are, and what neither one is', async () => {
    await piece('linen shirt', { wears: 3, lastWornOn: iso(12) });
    await mount();

    expect(text()).toContain('Both numbers count only the pieces you logged');
    expect(text()).toContain('Nothing on this card is advice about what to wear or what to buy.');
    expect(text()).not.toMatch(/\bbuy one\b|\bshop for\b|\bpurchase\b|\brecommend\b/i);
  });

  it('keeps the pairing draw off the dashboard, where its evidence does not live', async () => {
    await piece('linen shirt', { wears: 3, lastWornOn: iso(12) });
    await mount();

    expect(text()).not.toContain('pairing chose over idlest');
    expect(text()).not.toContain('another option');
    expect(text()).toContain('runs on the closet page, not here');
  });

  it('hides itself while the closet is empty rather than showing an empty matrix', async () => {
    await mount();

    expect(card()).toBeNull();
    expect(text()).not.toContain('Closet at a glance');
  });

  it('obeys the switch that turns it off', async () => {
    await piece('linen shirt', { wears: 1, lastWornOn: iso(3) });
    await mount(['priorities', 'goals', 'advisor', 'discover', 'routines', 'consistency', '!closet', 'progress', 'calendar', 'wishlist', 'plans', 'experiments']);

    expect(card()).toBeNull();
  });

  it('comes back on its own once the off-marker is gone, since the default is the app’s', async () => {
    await piece('linen shirt', { wears: 1, lastWornOn: iso(3) });
    await mount(['priorities', 'goals', 'advisor', 'discover', 'routines', 'consistency', '!closet', 'progress', 'calendar', 'wishlist', 'plans', 'experiments']);
    expect(card()).toBeNull();

    await mount(['priorities', 'goals', 'advisor', 'discover', 'routines', 'consistency', 'closet', 'progress', 'calendar', 'wishlist', 'plans', 'experiments']);
    expect(card()).not.toBeNull();
  });
});
