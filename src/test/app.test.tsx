import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';
import App from '../App';
import { DEPARTMENTS } from '../nav/departments';
import { DEFAULT_THEME } from '../state/themes';
import { loadSettings } from '../state/settings';
import { TABLES } from '../db/schema';
import { findAll } from '../db/repo';
import { db } from '../db/db';

const CRASH_MARK = 'The Glow Lab hit an unexpected error.';
const MISSING_MARK = 'No department at that address';
const BOOT_MARK = 'Opening your lab';

let container: HTMLDivElement;
let root: Root;

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const text = () => container.textContent ?? '';

async function settle(rounds = 3) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await tick(20);
    });
  }
}

/**
 * First run does real work (seeding over a hundred records) and every
 * department is its own lazy chunk, so waiting is a bounded poll on an
 * observable condition rather than a guessed tick budget. A timeout fails
 * loudly instead of masquerading as a blank page.
 *
 * The budgets below are contention budgets, not expected durations: 27 files
 * share this machine, so a chunk that mounts in a third of a second on a quiet
 * run can spend many seconds queued behind the others. A mount poll that gives
 * up early reports a working page as missing.
 */
async function waitFor(what: string, done: () => boolean | Promise<boolean>, budgetMs = 30000) {
  const started = Date.now();
  for (;;) {
    if (await done()) return;
    if (Date.now() - started > budgetMs) throw new Error(`timed out waiting for ${what}`);
    await act(async () => {
      await tick(25);
    });
  }
}

function buttons() {
  return [...container.querySelectorAll('button')];
}

function findButton(label: string) {
  const needle = label.toLowerCase();
  return buttons().find((b) => (b.textContent ?? '').trim().toLowerCase().includes(needle));
}

async function click(node: Element) {
  await act(async () => {
    // jsdom builds the event itself: a hand-made MouseEvent cannot carry a
    // `view` through vitest's window proxy.
    (node as HTMLElement).click();
    await tick(25);
  });
  await settle(2);
}

async function clickText(label: string) {
  const node = findButton(label);
  if (!node) throw new Error(`no button containing “${label}” on ${window.location.hash}`);
  await click(node);
  return node;
}

/** Theme cards carry long descriptive text (Oxblood's mood words include “editorial”), so the labelled control is the honest target. */
async function clickTheme(name: string) {
  const node = container.querySelector(`button[aria-label="Use the ${name} theme"]`);
  if (!node) throw new Error(`no theme control for “${name}” on ${window.location.hash}`);
  await click(node);
}

async function goto(hash: string, mountMs = 45000) {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await tick(20);
  });
  /* One department lazy chunk per route, and 27 files share this machine: the
     mount poll gets a contention-sized budget so a queued chunk cannot be
     misread as a page that never arrives. */
  await waitFor(`${hash} to mount`, () => !container.querySelector('.gl-skeleton'), mountMs);
  await settle(2);
}

async function boot() {
  await act(async () => {
    root.render(<App />);
  });
  await waitFor('the app to finish opening', () => !text().includes(BOOT_MARK) && text().length > 40);
  await settle(3);
}

/** A brand-new visitor lands on the setup tour; the department routes need it behind them. */
async function enterApp() {
  if (container.querySelector('.gl-shell')) return;
  if (findButton('Skip setup')) await clickText('Skip setup');
  await waitFor('the shell to appear', () => Boolean(container.querySelector('.gl-shell')));
}

beforeAll(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await boot();
});

describe('the app as the user meets it', () => {
  it('boots a first-run visitor into setup, not a blank screen', () => {
    expect(text()).not.toContain(CRASH_MARK);
    expect(text()).not.toContain(BOOT_MARK);
    expect(container.querySelector('.gl-onb')).not.toBeNull();
    expect(text().length).toBeGreaterThan(120);
    expect(DEPARTMENTS.length).toBeGreaterThan(20);
  });

  it('gets past setup into the shell', async () => {
    await enterApp();
    expect(container.querySelector('.gl-shell')).not.toBeNull();
    expect(container.querySelector('nav[aria-label="Departments"]')).not.toBeNull();
    expect((await loadSettings()).onboardingDone).toBe(true);
  });

  it('seeds its own starter library on first run, and the seed is removable', async () => {
    const techniques = await findAll(TABLES.techniques);
    expect(techniques.length).toBeGreaterThan(10);
    expect(techniques.every((t) => t.seed === 1 || t.tags?.includes('seed'))).toBe(true);
    expect((await findAll(TABLES.tutorials)).length).toBeGreaterThan(5);
    expect((await findAll(TABLES.exercises)).length).toBeGreaterThan(5);
    expect((await findAll(TABLES.knowledge)).length).toBeGreaterThan(5);
    expect((await findAll(TABLES.mediaItems)).length).toBeGreaterThan(5);
  });

  it('starts on the Oxblood theme', () => {
    expect(DEFAULT_THEME).toBe('oxblood');
    expect(document.documentElement.getAttribute('data-theme')).toBe('oxblood');
  });

  it(
    'renders every department route without crashing',
    async () => {
      await enterApp();
      const broken: string[] = [];
      const thin: string[] = [];
      for (const d of DEPARTMENTS) {
        await goto(d.path);
        const body = text();
        if (body.includes(CRASH_MARK)) broken.push(`${d.path} crashed`);
        else if (body.includes(MISSING_MARK)) broken.push(`${d.path} has no page`);
        else if (body.trim().length < 140) thin.push(`${d.path} → ${body.trim().length} chars`);
      }
      expect({ broken, thin }).toEqual({ broken: [], thin: [] });
    },
    300000
  );

  it(
    'changes and persists the theme from the Settings control',
    async () => {
      await enterApp();
      await goto('/settings?tab=appearance');
      await clickTheme('Obsidian');
      expect(document.documentElement.getAttribute('data-theme')).toBe('obsidian');
      expect((await loadSettings()).theme).toBe('obsidian');

      await clickTheme('Editorial');
      expect(document.documentElement.getAttribute('data-theme')).toBe('editorial');
      expect((await loadSettings()).theme).toBe('editorial');

      await clickTheme('Oxblood');
      expect((await loadSettings()).theme).toBe('oxblood');
    },
    60000
  );

  it(
    'makes the reduced-motion switch do what it says, and keep saying it',
    async () => {
      await enterApp();
      await goto('/settings?tab=appearance');
      const sw = () =>
        [...container.querySelectorAll('[role="switch"]')].find((s) => /reduced motion/i.test(s.textContent ?? '')) as
          | HTMLElement
          | undefined;
      expect(sw(), 'Settings → Appearance offers a reduced-motion switch').toBeTruthy();

      await click(sw() as Element);
      await waitFor('the document to follow the switch', () => document.documentElement.dataset.motion === 'reduced');
      expect((await loadSettings()).reducedMotion).toBe(true);

      // A system-preference mirror used to be re-read on every settings change, which wrote the
      // OS value back the instant the switch was used and self-reverted the user's choice.
      await settle(8);
      expect(document.documentElement.dataset.motion).toBe('reduced');
      expect((await loadSettings()).reducedMotion).toBe(true);

      await click(sw() as Element);
      await waitFor('the document to return to full motion', () => document.documentElement.dataset.motion === 'full');
      expect((await loadSettings()).reducedMotion).toBe(false);
    },
    60000
  );

  it(
    'keeps the advisor honest about what produced an answer',
    async () => {
      await enterApp();
      await goto('/advisor');
      const before = await findAll(TABLES.messages);
      // The advisor page offers ready-made questions; clicking one is the shortest
      // path that goes through the same code as typing a question and pressing Ask.
      const chip = container.querySelector('button[aria-label^="Ask:"]');
      expect(chip, 'the advisor offers at least one clickable question').not.toBeNull();
      await click(chip as Element);
      await waitFor('the answer to be written', async () => (await findAll(TABLES.messages)).length > before.length + 1);
      const after = await findAll(TABLES.messages);
      expect(after.length).toBeGreaterThan(before.length + 1);
      // One visit opens one conversation; the async write must not be raced into a stack of empty ones.
      expect((await findAll(TABLES.conversations)).length).toBe(1);
      const reply = after.filter((m) => m.role === 'advisor').pop();
      expect(reply?.engine).toBe('local-rules');
      expect(String(reply?.body ?? '')).not.toMatch(/\bAI[- ]generated\b/i);
    },
    60000
  );
});
