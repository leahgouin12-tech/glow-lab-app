import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TABLES } from '../db/schema';
import { db } from '../db/db';
import ContactSheetPage from '../pages/ContactSheetPage';
import { DEPARTMENTS } from '../nav/departments';
import { THEME_OPTIONS } from '../state/themes';
import { DEFAULT_SETTINGS, applyDocumentSettings, isEmbeddedFrame, loadSettings, previewThemeFromUrl, updateSettings } from '../state/settings';

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const settle = async (rounds = 3) => {
  for (let i = 0; i < rounds; i += 1) await act(async () => tick(15));
};

function at(search: string) {
  window.history.replaceState({}, '', `${window.location.pathname}${search}`);
}

let container: HTMLDivElement;

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<ContactSheetPage />));
  await settle();
  return root;
}

async function unmount(root: Root) {
  await act(async () => root.unmount());
  container.remove();
}

beforeAll(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  for (const t of Object.values(TABLES)) await db.table(t).clear();
});

beforeEach(async () => {
  at('');
  await act(async () => {
    await updateSettings({ ...DEFAULT_SETTINGS, visualChecks: [] });
  });
});

describe('re-rendering one page in another theme', () => {
  it('takes the theme from the address bar without writing it to your settings', async () => {
    at('?theme=editorial');
    expect(previewThemeFromUrl()).toBe('editorial');
    await act(async () => applyDocumentSettings(await loadSettings()));
    expect(document.documentElement.getAttribute('data-theme')).toBe('editorial');
    expect((await loadSettings()).theme, 'a preview must not silently become your theme').toBe(DEFAULT_SETTINGS.theme);

    at('?theme=oxblood');
    expect(previewThemeFromUrl()).toBe('oxblood');
  });

  it('ignores a theme the app does not ship', () => {
    at('?theme=hotpink');
    expect(previewThemeFromUrl()).toBeNull();
    at('');
    expect(previewThemeFromUrl()).toBeNull();
  });

  it('knows a pane from a real visit, and keeps the two flags apart', () => {
    at('?theme=obsidian');
    expect(isEmbeddedFrame(), 'a forced theme alone still seeds and syncs').toBe(false);
    at('?theme=obsidian&sheet=1');
    expect(isEmbeddedFrame()).toBe(true);
    at('?sheet=1');
    expect(isEmbeddedFrame()).toBe(true);
  });
});

describe('the visual contact sheet', () => {
  it('renders the department live in all three themes, forced and self-suppressing', async () => {
    const root = await mount();

    const frames = [...container.querySelectorAll('iframe.cs-frame')];
    expect(frames.map((f) => f.getAttribute('title'))).toEqual(
      THEME_OPTIONS.map((t) => `${DEPARTMENTS[0].title} in the ${t.name} theme`)
    );
    for (const frame of frames) {
      const src = new URL(frame.getAttribute('src') as string);
      expect(src.searchParams.get('sheet'), 'panes must not write to the database').toBe('1');
      expect(THEME_OPTIONS.some((t) => t.id === src.searchParams.get('theme'))).toBe(true);
      expect(src.hash, 'the pane opens on a real route').toBe(`#${DEPARTMENTS[0].path}`);
    }
    expect(container.querySelectorAll('[role="switch"]').length, 'one sign-off switch per theme').toBe(3);
    await unmount(root);
  });

  it('keeps the record of what I have signed off, and lets me take it back', async () => {
    const root = await mount();

    const first = container.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(first.getAttribute('aria-checked')).toBe('false');
    await act(async () => first.click());
    await settle();
    const key = `${DEPARTMENTS[0].id}:${THEME_OPTIONS[0].id}`;
    expect((await loadSettings()).visualChecks).toEqual([key]);
    expect(container.textContent).toContain('1 of');

    const again = container.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(again.getAttribute('aria-checked')).toBe('true');
    await act(async () => again.click());
    await settle();
    expect((await loadSettings()).visualChecks, 'a tick is reversible').toEqual([]);
    await unmount(root);
  });

  it('signs off the row it belongs to, not whichever department the panes happen to show', async () => {
    const root = await mount();

    const rows = [...container.querySelectorAll('.cs-gridrow')];
    expect(rows.length).toBe(DEPARTMENTS.length);
    const target = rows[5];
    const cell = target.querySelector('.cs-cell') as HTMLButtonElement;
    await act(async () => cell.click());
    await settle();

    expect((await loadSettings()).visualChecks).toEqual([`${DEPARTMENTS[5].id}:${THEME_OPTIONS[0].id}`]);
    await unmount(root);
  });
});
