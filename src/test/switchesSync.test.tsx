import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { Shell } from '../nav/Shell';
import SettingsPage from '../pages/SettingsPage';
import { ToastHost } from '../ui/primitives';
import { DEPARTMENTS } from '../nav/departments';
import { TABLES } from '../db/schema';
import { findAll, put } from '../db/repo';
import { db } from '../db/db';
import { flushSyncQueue } from '../db/backup';
import { exportJson } from '../db/backup';
import { armLock, lockNow } from '../state/lock';
import { computeDna } from '../engine/taste';
import { DEFAULT_SETTINGS, loadSettings, updateSettings, type AppSettings } from '../state/settings';

/**
 * The second half of the privacy-switch verification round: the switches whose
 * promise is about the outside world (sync, external processing) and about the
 * gate itself (app lock, the department rail, Pinterest teaching taste).
 *
 * Same rule as `switches.test.tsx`: off means the action does not happen at all,
 * and every refusal is proved against the Dexie tables and a `fetch` stub, not
 * against a sentence on the screen. Each off-case is paired with an on-case so a
 * blind test cannot pass.
 */

let container: HTMLDivElement;
let root: Root | null = null;

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const text = () => container.textContent ?? '';

async function settle(rounds = 3) {
  for (let i = 0; i < rounds; i += 1) await act(async () => tick(18));
}

/** Bounded poll on an observable condition — no guessed tick budgets. */
async function waitFor(what: string, done: () => boolean | Promise<boolean>, budgetMs = 25000) {
  const started = Date.now();
  for (;;) {
    if (await done()) return;
    if (Date.now() - started > budgetMs) throw new Error(`timed out waiting for ${what}`);
    await act(async () => {
      await tick(25);
    });
  }
}

/** `?sheet=1` is the app's own read-only flag: it skips seeding, so boots stay cheap. */
function at(search: string) {
  window.history.replaceState({}, '', `${window.location.origin}${window.location.pathname}${search}`);
}

async function render(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  await settle(4);
}

async function teardown() {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
}

async function settings(over: Partial<AppSettings> = {}) {
  await updateSettings({ ...DEFAULT_SETTINGS, ...over });
}

const aGoal = async (id: string) =>
  put(TABLES.goals, { id, title: `Even out tone ${id}`, domain: 'skin', status: 'active', priority: 1 });

const ENDPOINT = 'https://sync.invalid/queue';
const okResponse = () => ({ ok: true, status: 200, json: async () => ({ changes: [], conflicts: [] }) });

/**
 * HashRouter renders `href="#/services"`, MemoryRouter renders `href="/services"`,
 * and this file mounts both ways. Normalise so an assertion about the rail means
 * the same route whichever router drew it.
 */
const railLinks = () =>
  [...container.querySelectorAll('.gl-rail__scroll a.gl-rail__link')]
    .map((a) => (a.getAttribute('href') ?? '').replace(/^#/, ''));

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
  localStorage.clear();
  sessionStorage.clear();
  at('');
  await settings();
});

afterEach(async () => {
  await teardown();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  at('');
});

/* ====================================================== switch 1: syncEnabled */

describe('sync switched off (syncEnabled)', () => {
  it('her queued changes stay on the device and no request is even attempted', async () => {
    await settings({ syncEnabled: false, syncEndpoint: ENDPOINT });
    await aGoal('g-queued');
    const queue = await findAll(TABLES.syncQueue);
    expect(queue.length, 'every write is queued locally whether or not sync is on').toBeGreaterThan(0);

    const fetchStub = vi.fn().mockRejectedValue(new Error('a request would have left the device'));
    vi.stubGlobal('fetch', fetchStub as unknown as typeof fetch);

    const res = await flushSyncQueue();
    expect(res.ok).toBe(false);
    expect(res.detail, 'db/backup.ts:237-247').toMatch(/Sync is off/i);
    expect(res.pushed).toBe(0);
    expect(res.pulled).toBe(0);
    expect(res.pending).toBe(queue.length);
    expect(await db.syncQueue.count()).toBe(queue.length);
    expect(fetchStub, 'no fetch is attempted').not.toHaveBeenCalled();
  });

  it('the same queue is pushed to her own endpoint once sync is on', async () => {
    await settings({ syncEnabled: true, syncEndpoint: ENDPOINT, allowExternalProcessing: true });
    await aGoal('g-push');
    const before = await db.syncQueue.count();
    expect(before).toBeGreaterThan(0);

    const fetchStub = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchStub as unknown as typeof fetch);

    const res = await flushSyncQueue();
    expect(res.ok).toBe(true);
    expect(res.pushed).toBe(before);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0][0]).toBe(ENDPOINT);
    expect((fetchStub.mock.calls[0][1] as RequestInit).method).toBe('POST');
    expect(await db.syncQueue.count(), 'a successful flush empties the queue').toBe(0);
  });

  it('switching sync off again stops the next flush, mid-flight', async () => {
    await settings({ syncEnabled: true, syncEndpoint: ENDPOINT, allowExternalProcessing: true });
    await aGoal('g-first');
    const fetchStub = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchStub as unknown as typeof fetch);

    const first = await flushSyncQueue();
    expect(first.ok).toBe(true);
    expect(fetchStub).toHaveBeenCalledTimes(1);

    // she flips the switch off while the app is still running
    await updateSettings({ syncEnabled: false });
    expect((await loadSettings()).syncEnabled).toBe(false);

    await aGoal('g-after-off');
    const second = await flushSyncQueue();
    expect(second.ok).toBe(false);
    expect(second.detail).toMatch(/Sync is off/i);
    expect(fetchStub, 'the flush after switching off sends nothing').toHaveBeenCalledTimes(1);
    const left = await findAll(TABLES.syncQueue);
    expect(left.some((q) => q.targetTable === TABLES.goals && q.targetId === 'g-after-off'), 'her change is still queued').toBe(true);
    expect(second.pending).toBe(left.length);
  });

  it('sync enabled is not enough: external processing off still blocks the POST', async () => {
    await settings({ syncEnabled: true, syncEndpoint: ENDPOINT, allowExternalProcessing: false });
    await aGoal('g-blocked');
    const queue = await db.syncQueue.count();

    const fetchStub = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchStub as unknown as typeof fetch);

    const res = await flushSyncQueue();
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/Privacy blocks it/i);
    expect(fetchStub).not.toHaveBeenCalled();
    expect(await db.syncQueue.count()).toBe(queue);
  });

  it('with sync on but no endpoint she gets the queue kept, not a silent half-sync', async () => {
    await settings({ syncEnabled: true, syncEndpoint: '', allowExternalProcessing: true });
    await aGoal('g-no-endpoint');
    const before = await db.syncQueue.count();
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub as unknown as typeof fetch);

    const res = await flushSyncQueue();
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/endpoint/i);
    expect(res.pushed).toBe(0);
    expect(fetchStub).not.toHaveBeenCalled();
    expect(await db.syncQueue.count(), 'App.tsx:125 refuses to arm the timer for an endpoint that is not there').toBe(before);
  });

  /**
   * NOT COVERED FROM JSDOM — stated rather than faked. `App.tsx:124-135` arms a
   * `window.setInterval` only while `syncEnabled && syncEndpoint` are set, and
   * re-arms on change. Proving the live cadence timer would need fake timers over
   * fake-indexeddb (whose scheduler fake timers also take over), which is a race
   * rather than a test. The flush the timer calls is proved above in both
   * directions, including the switch-off-stops-flushing case.
   */
  it('the queue survives a refused flush so the next arm of the timer has work to do', async () => {
    await settings({ syncEnabled: false, syncEndpoint: ENDPOINT });
    await aGoal('g-keep');
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub as unknown as typeof fetch);

    await flushSyncQueue();
    await flushSyncQueue();
    const kept = (await findAll(TABLES.syncQueue)).filter((q) => q.targetTable === TABLES.goals && q.targetId === 'g-keep');
    expect(kept, 'the change is still waiting for the next time she arms it').toHaveLength(1);
    expect(kept[0].attempts ?? 0, 'a refused flush is not a failed send, so no attempt is counted').toBe(0);
    expect(kept[0].lastError ?? '', 'and no error is written onto it').toBe('');
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

/* ==================================================== switch 4: requireAppLock */

describe('the app lock (requireAppLock)', () => {
  /** The lock gate is `lockIsSet()` in localStorage; the switch is the app's promise about it. */
  async function armAndLock() {
    const armed = await armLock('4242');
    expect(armed.ok).toBe(true);
    lockNow();
    await updateSettings({ requireAppLock: true, onboardingDone: true });
  }

  it('with the lock armed nothing behind it renders — not her records, not her name', async () => {
    await armAndLock();
    await put(TABLES.profile, { kind: 'personal', singleton: 1, data: { name: 'Nia' } } as never);
    await put(TABLES.routines, { id: 'r-private', name: 'Retwist the edges', domain: 'hair', active: true } as never);
    at('?sheet=1');

    await render(<App />);
    await waitFor('the lock screen', () => text().includes('Locked on this device'));

    expect(text()).toContain('Locked on this device');
    expect(container.querySelector('.gl-shell'), 'no department chrome renders').toBeNull();
    expect(text(), 'her routine names are not in the tree').not.toContain('Retwist the edges');
    expect(text()).not.toContain('Nia');
    expect(container.querySelector('nav[aria-label="Departments"]')).toBeNull();
  });

  it('the wrong passcode opens nothing, and the right one opens the lab', async () => {
    await armAndLock();
    at('?sheet=1');
    await render(<App />);
    await waitFor('the lock screen', () => Boolean(container.querySelector('input#glow-lock-code')));

    const input = container.querySelector('input#glow-lock-code') as HTMLInputElement;
    const type = async (value: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await tick(10);
      });
    };
    const submit = async () => {
      await act(async () => {
        (container.querySelector('button[type="submit"]') as HTMLElement).click();
        await tick(30);
      });
      await settle(2);
    };

    await type('1111');
    await submit();
    // verifyLock() is 601 SHA-256 rounds (state/lock.ts:47-51), so the button is
    // still reading "Checking…" the moment the click returns. Wait on the outcome.
    await waitFor('the wrong passcode to be refused', () => text().includes('Not recognised'));
    expect(container.querySelector('.gl-shell')).toBeNull();

    await type('4242');
    await submit();
    await waitFor('the shell to appear', () => Boolean(container.querySelector('.gl-shell')));
    expect(text()).not.toContain('Locked on this device');
  });

  it('nothing is demanded when the switch is off and no passcode exists on this device', async () => {
    await updateSettings({ requireAppLock: false, onboardingDone: true });
    at('?sheet=1#/home');

    await render(<App />);
    await waitFor('the shell to appear', () => Boolean(container.querySelector('.gl-shell')));

    expect(text()).not.toContain('Locked on this device');
    expect(container.querySelector('input#glow-lock-code')).toBeNull();
  });

  it('arming the lock from Settings puts the switch on and keeps the passcode out of every export', async () => {
    await render(
      <MemoryRouter initialEntries={['/settings?tab=privacy']}>
        <ToastHost>
          <SettingsPage />
        </ToastHost>
      </MemoryRouter>
    );
    expect(text()).toContain('App lock on this device');
    expect(text()).toContain('Not armed');

    const code = container.querySelector('input[aria-label="App lock passcode"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(code, 'saffron');
      code.dispatchEvent(new Event('input', { bubbles: true }));
      await tick(10);
    });
    const arm = [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Arm lock');
    expect(arm, 'Settings offers the arming control').toBeTruthy();
    await act(async () => {
      (arm as HTMLElement).click();
      await tick(30);
    });
    // `armLock` runs 601 real SHA-256 digests before it writes anything
    // (state/lock.ts:47-51), so the wait is bounded on the observable result.
    await waitFor('Settings to arm the lock', () => Boolean(localStorage.getItem('glow-lab:lock-hash')));

    // the two facts the button is supposed to leave behind, together
    expect(localStorage.getItem('glow-lab:lock-hash'), 'a passcode is stored on this device').toBeTruthy();
    expect((await loadSettings()).requireAppLock).toBe(true);

    // and the secret stays in localStorage: not in the settings row, not in an export
    const row = (await db.settings.get('app')) as { value: Record<string, unknown> };
    const keys = Object.keys(row.value);
    expect(keys).not.toContain('lockHash');
    expect(keys).not.toContain('lockSalt');
    expect(JSON.stringify(row.value)).not.toMatch(/salt|"hash"/);

    const dump = await exportJson();
    expect(dump).not.toContain('glow-lab:lock-hash');
    expect(dump).toContain('"requireAppLock": true');
    // `settings` IS a queued table, so the row itself travels when sync runs —
    // what must never travel is the passcode material, and it does not:
    const secret = localStorage.getItem('glow-lab:lock-hash') ?? '';
    expect(secret, 'the lock record exists on this device').not.toBe('');
    const queued = await findAll(TABLES.syncQueue);
    expect(queued.some((q) => String(q.payload).includes(secret)), 'no queued change carries the lock').toBe(false);
    expect(queued.some((q) => String(q.payload).includes('"salt"')), 'no queued payload carries a salt').toBe(false);
  });

  it('switching the lock on does not delete the photographs and records it now gates', async () => {
    // The honest limit of a local gate: it hides the UI, it does not un-write a
    // row. A lock must never be sold as a way to make stored data go away.
    await settings({ allowUploads: true });
    const stored = await put(TABLES.mediaItems, { kind: 'baseline', title: 'Baseline front', blobId: 'blob-x' } as never);
    await aGoal('g-keeps');

    await armAndLock();
    expect((await loadSettings()).requireAppLock).toBe(true);

    expect(await db.mediaItems.count()).toBe(1);
    expect(await db.mediaItems.get(String(stored.id))).toBeTruthy();
    expect(await db.goals.count()).toBe(1);
    expect(localStorage.getItem('glow-lab:lock-hash')).toBeTruthy();
  });

  /**
   * Fixed in this round. `App.tsx` now checks the promise against the passcode
   * record instead of trusting the flag: `requireAppLock` with nothing armed
   * opens on a "choose your passcode" gate, and the lab — her records, her
   * name, the whole router — stays unmounted behind it. Setting the passcode
   * there is what makes the lock real, and once it exists an ordinary lock
   * screen is what she gets next time, not a form that accepts anything.
   */
  it('the setup tour’s lock switch really puts a gate in front of the lab', async () => {
    await put(TABLES.routines, { id: 'r-behind-lock', name: 'Retwist the edges', domain: 'hair', active: true } as never);
    await updateSettings({ requireAppLock: true, onboardingDone: true });
    at('?sheet=1#/home');

    await render(<App />);
    await waitFor('a passcode gate', () => Boolean(container.querySelector('input#glow-lock-code')), 4000);

    expect(container.querySelector('input#glow-lock-code'), 'requireAppLock=true must gate the app').toBeTruthy();
    expect(container.querySelector('.gl-shell')).toBeNull();
    expect(text(), 'nothing behind the gate rendered').not.toContain('Retwist the edges');
    expect(localStorage.getItem('glow-lab:lock-hash'), 'no passcode existed when the gate opened').toBeNull();

    // arming through the gate is what makes the promise true
    const input = container.querySelector('input#glow-lock-code') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '4242');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await tick(10);
    });
    await act(async () => {
      (container.querySelector('button[type="submit"]') as HTMLElement).click();
      await tick(30);
    });
    await waitFor('the lab to open', () => Boolean(container.querySelector('.gl-shell')), 25000);

    expect(localStorage.getItem('glow-lab:lock-hash'), 'a real passcode is on this device now').toBeTruthy();
    expect((await loadSettings()).requireAppLock).toBe(true);

    // and locking the session again gives her the verification screen, not the lab
    lockNow();
    await updateSettings({ onboardingDone: true });
    await waitFor('the lock screen', () => text().includes('Locked on this device'));
    expect(container.querySelector('.gl-shell')).toBeNull();
    expect(text()).not.toContain('Retwist the edges');
  });
});

/* ============================================ switch 6: enabledDepartments (the rail) */

describe('departments left out of the enabled list (enabledDepartments)', () => {
  async function shell() {
    await render(
      <MemoryRouter initialEntries={['/home']}>
        <Shell />
      </MemoryRouter>
    );
    await waitFor('the rail to fill in', () => railLinks().length > 0);
  }

  it('an empty keep-list narrows nothing: every department stays in the rail', async () => {
    await settings({ enabledDepartments: [] });
    await shell();

    const links = railLinks();
    // Shell.tsx reads the list through `departmentEnabled`, whose first rule is
    // that an empty list means she has not picked a subset yet — so a default
    // install keeps all 29 links, and Settings → Departments says so in words.
    expect(links).toContain('/fragrance');
    expect(links).toContain('/services');
    expect(links.filter((l) => l.startsWith('/')).length).toBe(DEPARTMENTS.length);
    expect((await loadSettings()).enabledDepartments).toEqual([]);
  });

  it('a non-empty list is a keep-list: what is left out leaves the rail', async () => {
    await settings({ enabledDepartments: ['fragrance'] });
    await shell();

    const studios = ['/hair', '/skin', '/makeup', '/dental', '/fragrance'];
    const links = railLinks();
    expect(links.filter((l) => studios.includes(l)), 'only the kept studio survives its group').toEqual(['/fragrance']);
    expect(links, 'the rest of the rail is filtered too, not reordered').not.toContain('/advisor');
    expect(links, 'the app chrome survives whatever she picks').toContain('/home');
    expect((await loadSettings()).enabledDepartments).toEqual(['fragrance']);
  });

  it('the mobile grid is filtered by the same list as the rail', async () => {
    await settings({ enabledDepartments: ['fragrance'] });
    await shell();

    const more = [...container.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '') === 'All departments');
    await act(async () => {
      (more as HTMLElement).click();
      await tick(20);
    });
    const hrefs = [...container.querySelectorAll('.gl-sheet a')].map((a) => (a.getAttribute('href') ?? '').replace(/^#/, ''));
    expect(hrefs).toContain('/fragrance');
    expect(hrefs, 'the sheet cannot offer what the rail just refused').not.toContain('/services');
    expect(container.querySelector('[aria-label="All departments"]')).toBeTruthy();
  });

  /**
   * ANSWERED, and the answer is the rule, not a loophole: an empty list narrows
   * nothing, so a default install still answers `#/services` in full. The same
   * address is refused once the list is non-empty — see the test below, which is
   * the one that used to be the defect.
   */
  it('a department left out of an empty list still answers its own address', async () => {
    await settings({ enabledDepartments: [], onboardingDone: true });
    at('?sheet=1#/services');

    await render(<App />);
    await waitFor('the services page to mount', () => text().includes('Professional Services'), 30000);

    expect(container.querySelector('.gl-shell')).not.toBeNull();
    expect(text()).toContain('Consults') /* the rail's own short label */;
    expect(text()).not.toContain('No department at that address');
    expect((await loadSettings()).enabledDepartments).toEqual([]);
  });

  /**
   * Fixed in this round. `App.tsx` runs the route table through the same
   * `departmentEnabled` rule the rail uses, so a department left out of a
   * non-empty list is refused at its own address instead of rendering in full,
   * and the refusal names the switch and where to turn it back on. Nothing is
   * deleted: the DB read-back at the end proves her records survive the switch.
   */
  it('a department she switches off is gone from the rail and refuses its own address', async () => {
    await settings({
      enabledDepartments: DEPARTMENTS.filter((d) => d.id !== 'services').map((d) => d.id),
      onboardingDone: true
    });
    await put(TABLES.consultations, { id: 'svc-kept', procedureTitle: 'A consult she booked', data: {} } as never);
    at('?sheet=1#/services');

    await render(<App />);
    await waitFor('the shell to appear', () => Boolean(container.querySelector('.gl-shell')), 30000);

    expect(railLinks(), 'the rail dropped it').not.toContain('/services');
    expect(text(), 'the refusal says which switch closed it and where').toContain('is switched off');
    expect(text()).toContain('Settings → Departments');
    expect(text(), 'and the department itself never renders').not.toContain('Consults');
    expect(await db.consultations.count(), 'switching a department off deletes nothing').toBe(1);
  });
});

/* ======================================= switch 7: pinterestTeachesTaste */

describe('Pinterest teaching taste (pinterestTeachesTaste)', () => {
  async function seed() {
    await put(TABLES.discoveryItems, {
      id: 'i-own',
      providerId: 'library',
      title: 'My own set',
      categories: ['soft-glam'],
      aesthetic: 'clean',
      palette: [],
      elements: []
    } as never);
    await put(TABLES.discoveryItems, {
      id: 'i-pin',
      providerId: 'pinterest',
      title: 'Someone else’s board',
      categories: ['pinned-only'],
      aesthetic: '',
      palette: [],
      elements: []
    } as never);
    await put(TABLES.discoveryInteractions, { id: 'x-own', itemId: 'i-own', action: 'save' } as never);
    await put(TABLES.discoveryInteractions, { id: 'x-pin', itemId: 'i-pin', action: 'buy' } as never);
  }

  it('her taps on imported pins stay out of the taste arithmetic while the permission is withheld', async () => {
    await settings({ pinterestTeachesTaste: false });
    await seed();

    const off = await computeDna();
    expect(off.interactions, 'engine/taste.ts:82 + :91 drop provider rows').toBe(1);
    expect(off.signals.some((s) => s.key === 'pinned-only')).toBe(false);
    expect(off.top.map((s) => s.key)).toContain('soft-glam');

    // on ⇒ the same rows do feed it
    await updateSettings({ pinterestTeachesTaste: true });
    const on = await computeDna();
    expect(on.interactions).toBe(2);
    expect(on.signals.some((s) => s.key === 'pinned-only')).toBe(true);

    // off again ⇒ they stop feeding it, with nothing cached from the open window
    await updateSettings({ pinterestTeachesTaste: false });
    const again = await computeDna();
    expect(again.interactions).toBe(1);
    expect(again.signals.some((s) => s.key === 'pinned-only')).toBe(false);
    expect(again.top.map((s) => s.key).sort()).toEqual(['clean', 'soft-glam']);
  });

  it('the taste permission is not the same switch as the archive pull', async () => {
    // Documented separation: `pinterestAutoSync` (App.tsx:141) decides whether the
    // local archive is re-read at all; this switch only decides whether what is
    // already on the device counts as taste. Turning taste-permission off leaves
    // the rows stored, it does not delete them.
    await settings({ pinterestTeachesTaste: false });
    await seed();

    expect(await db.discoveryItems.count()).toBe(2);
    await computeDna();
    expect(await db.discoveryItems.count(), 'withholding permission deletes nothing').toBe(2);
    expect(await db.discoveryInteractions.count()).toBe(2);
  });
});
