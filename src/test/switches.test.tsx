import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '../pages/HomePage';
import { PhotoCanvas, PhotoPicker, ShotGridPicker } from '../ui/media';
import { ToneReadCard } from '../ui/photoTone';
import { ToastHost } from '../ui/primitives';
import { TABLES } from '../db/schema';
import { findAll, put } from '../db/repo';
import { db } from '../db/db';
import { ingestImage } from '../media/store';
import { flushSyncQueue } from '../db/backup';
import { fetchFeedPage } from '../providers/discovery';
import { DEFAULT_SETTINGS, updateSettings, type AppSettings } from '../state/settings';

/**
 * Privacy-switch verification round.
 *
 * The rule this suite holds the app to is the one the product is built on: an
 * optional behaviour sits behind a switch she controls, and a switch that is off
 * means the action does not happen at all — no partial write, no silent fallback,
 * no request sent. Every pair below runs the same flow twice, off then on, so a
 * test that passes because it cannot observe anything is caught immediately.
 *
 * The read sites are cited in each test name or comment. Where a switch does not
 * actually block what it claims to, the assertion stays honest and the test is
 * skipped with the defect named — see the report that goes with this file.
 */

/* ------------------------------------------------------------ fake decoder */
/* jsdom has no image decoder and no canvas. Same fakes `media.test.ts` and
   `closetPage.test.tsx` use: the rules under test are Glow Lab's own. */

class FakeImage {
  naturalWidth = 900;
  naturalHeight = 600;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_v: string) {
    setTimeout(() => this.onload?.(), 0);
  }
}

const getImageData = vi.fn((_x: number, _y: number, w: number, h: number) => ({
  data: new Uint8ClampedArray(w * h * 4).fill(255),
  width: w,
  height: h
}));

const ctx2d = {
  drawImage: () => {},
  fillRect: () => {},
  save: () => {},
  restore: () => {},
  translate: () => {},
  rotate: () => {},
  scale: () => {},
  setTransform: () => {},
  getImageData: (x: number, y: number, w: number, h: number) => getImageData(x, y, w, h)
};

function withCanvas() {
  getImageData.mockClear();
  vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx2d as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: (b: Blob | null) => void, type?: string) => {
    cb(new Blob([new Uint8Array(64)], { type: type ?? 'image/webp' }));
  });
}

/* --------------------------------------------------------------- harness */

let container: HTMLDivElement;
let root: Root | null = null;

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const settle = async (rounds = 3) => {
  for (let i = 0; i < rounds; i += 1) await act(async () => tick(16));
};
const text = () => container.textContent ?? '';

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

const photo = (seed: number) =>
  new File([Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, seed])], `piece-${seed}.jpg`, { type: 'image/jpeg' });

/** Writes a plain row through the app's own repo helper so the sync queue fills too. */
const aGoal = async (id: string) =>
  put(TABLES.goals, { id, title: `Even out tone ${id}`, domain: 'skin', status: 'active', priority: 1 });

/** Settings are reset to factory defaults before every test, then patched per test. */
async function settings(over: Partial<AppSettings> = {}) {
  await updateSettings({ ...DEFAULT_SETTINGS, ...over });
}

const counts = async () => ({
  mediaItems: await db.mediaItems.count(),
  mediaBlobs: await db.mediaBlobs.count(),
  clothingItems: await db.clothingItems.count(),
  routineLogs: await db.routineLogs.count(),
  calendarEvents: await db.calendarEvents.count(),
  profile: await db.profile.count()
});

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
  localStorage.clear();
  await settings();
  withCanvas();
});

afterEach(async () => {
  await teardown();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ============================================================ the defaults */

describe('a brand-new install', () => {
  it('opens the lab with nothing switched on that could touch her photographs or leave the device', async () => {
    expect(DEFAULT_SETTINGS.imageAnalysis, 'Settings → Privacy “On-device image tools”').toBe(false);
    expect(DEFAULT_SETTINGS.allowExternalProcessing, 'Settings → Privacy “Allow external processing”').toBe(false);
    expect(DEFAULT_SETTINGS.syncEnabled, 'Settings → Sync “Enable sync”').toBe(false);
    expect(DEFAULT_SETTINGS.requireAppLock, 'the app-lock switch').toBe(false);
    expect(DEFAULT_SETTINGS.privateMediaByDefault, 'new photographs start private').toBe(true);
    expect(DEFAULT_SETTINGS.advisorEngine, 'the advisor ships local').toBe('local');

    // and the row she actually gets on first boot says the same thing
    const row = (await db.settings.get('app')) as { value: AppSettings } | undefined;
    expect(row?.value.imageAnalysis).toBe(false);
    expect(row?.value.allowExternalProcessing).toBe(false);
    expect(row?.value.syncEnabled).toBe(false);
    expect(row?.value.requireAppLock).toBe(false);
  });

  /**
   * Privacy by default, stated exactly as the code does it now.
   *
   * Flipped off in this round, both of them in src/state/settings.ts:
   *   pinterestTeachesTaste  was true — it learns from material that came off
   *                          someone else's board, which is not her own record
   *   pinterestAutoSync      was true — it imports third-party saves every time
   *                          the app opens, unprompted
   *
   * Two switches still ship on, and the reason is in the code rather than in a
   * skip: `allowUploads` gates LOCAL ingest only (media/store.ts refuses her own
   * file at the top of `ingestImage` before a byte is read; the remote image
   * fetch is refused two lines above it by `allowExternalProcessing`, and nothing
   * in the upload path makes a request), and `reminders` is a reading of her own
   * routine rows rendered inside the app — the dashboard test below proves it
   * with a `fetch` stub. Both are asserted here, not excused, and Settings →
   * Privacy now says which is which and why.
   */
  it('ships everything that leaves the device or learns from third-party data off', async () => {
    const fresh = await updateSettings({ ...DEFAULT_SETTINGS });
    for (const key of [
      'imageAnalysis',
      'allowExternalProcessing',
      'syncEnabled',
      'requireAppLock',
      'pinterestTeachesTaste',
      'pinterestAutoSync'
    ] as const) {
      expect(fresh[key], `${key} should ship off`).toBe(false);
    }
    expect(fresh.privateMediaByDefault, 'new photographs are private').toBe(true);

    // the two that ship on: local ingest, and a local reading of her own rows
    expect(fresh.allowUploads, 'local capture is the app’s first job — see the top of ingestImage in media/store.ts').toBe(true);
    expect(fresh.reminders, 'in-app only, proved by the dashboard test below').toBe(true);
  });
});

/* ==================================================== switch 2: allowUploads */

describe('adding photographs switched off (allowUploads)', () => {
  it('a switched-off upload path stores no photograph, no bytes and no queue row', async () => {
    await settings({ allowUploads: false });
    const before = await counts();
    const queuedBefore = await db.syncQueue.count();

    const err = await ingestImage({ file: photo(1), kind: 'upload', album: 'Unfiled' }).catch((e: Error) => e);
    await settle(2);

    expect(err, 'the ingest path refused her file')
      .toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Adding photographs is switched off in Settings → Privacy.');
    const after = await counts();
    expect(after).toEqual(before);
    expect(after.mediaItems).toBe(0);
    expect(after.mediaBlobs).toBe(0);
    // the refusal happens before any row is even attempted, so the queue gains
    // nothing either. (It is not empty: switching the privacy setting is itself
    // a queued write — `settings` is an ENTITY_TABLE, src/db/repo.ts:96.)
    expect(await db.syncQueue.count()).toBe(queuedBefore);
  });

  it('the same upload path stores the photograph once she switches it back on', async () => {
    await settings({ allowUploads: true });
    const res = await ingestImage({ file: photo(2), kind: 'upload', album: 'Unfiled' });
    const rows = await findAll(TABLES.mediaItems);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(res.row.id);
    expect(await db.mediaBlobs.count()).toBe(1);
    expect(String(rows[0].blobId)).toBeTruthy();
  });

  it('the capture control refuses her in words and offers no file control at all', async () => {
    await settings({ allowUploads: false });
    await render(
      <ToastHost>
        <PhotoPicker onPick={() => {}} label="Add photograph" album="Unfiled" />
      </ToastHost>
    );

    expect(text()).toContain('Capture is off');
    expect(text()).toContain('Adding photographs is off — your existing library is untouched');
    // not merely disabled: the door is not on the page (ui/media.tsx:560)
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector('button:not([disabled])')?.textContent ?? '').not.toContain('Add photograph');
    expect(await db.mediaItems.count()).toBe(0);
  });

  it('the same capture control gives her a file picker once uploads are on', async () => {
    await settings({ allowUploads: true });
    await render(
      <ToastHost>
        <PhotoPicker onPick={() => {}} label="Add photograph" album="Unfiled" />
      </ToastHost>
    );

    expect(text()).not.toContain('Capture is off');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input, 'the file control is back').not.toBeNull();

    // feed it the file she "chose", the way the browser would
    Object.defineProperty(input!, 'files', { value: [photo(3)], configurable: true });
    await act(async () => {
      input!.dispatchEvent(new Event('change', { bubbles: true }));
      await tick(30);
    });
    await settle(3);

    expect(await db.mediaItems.count()).toBe(1);
  });

  it('a multi-shot set refuses to start and captures nothing while uploads are off', async () => {
    await settings({ allowUploads: false });
    await render(
      <ToastHost>
        <ShotGridPicker initialTarget={4} onGroup={() => {}} />
      </ToastHost>
    );
    const grid = container.querySelector('[data-testid="shot-grid"]') as HTMLElement;
    const gridText = grid?.textContent ?? '';

    // ui/media.tsx:1022 — the same refusal copy, plus openSequence's own note
    expect(gridText).toContain('Adding photographs is off — your existing library is untouched');
    expect(gridText).toContain('so no sequence was started. Nothing was captured and nothing was written.');
    for (const name of ['shot-capture', 'shot-save', 'shot-discard', 'shot-target', 'shot-conditions', 'shot-summary']) {
      expect(grid.querySelector(`[data-testid="${name}"]`), name).toBeNull();
    }
    expect(grid.querySelectorAll('[data-testid^="shot-slot-"]')).toHaveLength(0);
    expect(grid.querySelector('input[type="file"]')).toBeNull();
    expect(await db.mediaItems.count()).toBe(0);
    expect(await db.mediaBlobs.count()).toBe(0);
  });

  it('the same multi-shot set starts and captures once uploads are on', async () => {
    await settings({ allowUploads: true });
    await render(
      <ToastHost>
        <ShotGridPicker initialTarget={4} onGroup={() => {}} />
      </ToastHost>
    );
    const grid = container.querySelector('[data-testid="shot-grid"]') as HTMLElement;

    expect(grid.querySelector('[data-testid="shot-capture"]')).not.toBeNull();
    expect(grid.querySelectorAll('[data-testid^="shot-slot-"]')).toHaveLength(4);

    const input = grid.querySelector(':scope > input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [photo(4)], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await tick(30);
    });
    await settle(3);

    expect(await db.mediaItems.count()).toBe(1);
  });

  it('the closet’s bulk-log pile is refused at the ingest call its Store button makes', async () => {
    // ClosetPage's `logBulk` (pages/ClosetPage.tsx:652-679) writes the clothingItems
    // row only AFTER `ingestImage` resolves, so a refusal there cannot leave a
    // half-written garment. This is that exact call, with no row underneath it.
    await settings({ allowUploads: false });
    const before = await counts();

    const err = await ingestImage({ file: photo(5), kind: 'upload', album: 'Closet pieces', title: 'silk blouse', sourceKind: 'user' }).catch(
      (e: Error) => e
    );
    await settle(2);

    expect((err as Error).message).toContain('Adding photographs is switched off');
    expect(await counts()).toEqual(before);
    expect((await counts()).clothingItems).toBe(0);
  });
});

/* ==================================================== switch 3: imageAnalysis */

describe('image analysis switched off (imageAnalysis)', () => {
  it('no pixel is read from her photograph and the card names the switch she has not given', async () => {
    await settings({ imageAnalysis: false });
    await db.mediaBlobs.put({
      id: 'blob-tone-1',
      blob: new Blob(['tone'], { type: 'image/jpeg' }),
      thumb: new Blob(['t'], { type: 'image/jpeg' }),
      createdAt: Date.now(),
      bytes: 4,
      mime: 'image/jpeg'
    });
    const shot = await put(TABLES.mediaItems, { kind: 'baseline', title: 'Baseline front', blobId: 'blob-tone-1' } as never);
    const apply = vi.fn();

    await render(
      <ToastHost>
        <ToneReadCard settings={DEFAULT_SETTINGS} startShot={shot} onApply={apply} />
      </ToastHost>
    );

    expect(text()).toContain('Photo-assisted reading is switched off');
    expect(text()).toContain('no pixels read');
    // ui/photoTone.tsx:137 returns before any canvas, ellipse or read button exists
    expect(container.querySelector('input[type="range"]')).toBeNull();
    expect(text()).not.toContain('Read the framed area');
    expect(getImageData, 'the pixel read never happens while the switch is off').not.toHaveBeenCalled();
    expect(apply, 'nothing is proposed, so nothing can be written').not.toHaveBeenCalled();

    const toneBearing = (await findAll(TABLES.profile)).filter((r) => JSON.stringify(r.data ?? {}).includes('toneRead'));
    expect(toneBearing).toHaveLength(0);
  });

  it('the same card does read pixels once she switches image analysis on', async () => {
    await settings({ imageAnalysis: true });
    await db.mediaBlobs.put({
      id: 'blob-tone-2',
      blob: new Blob(['tone'], { type: 'image/jpeg' }),
      thumb: new Blob(['t'], { type: 'image/jpeg' }),
      createdAt: Date.now(),
      bytes: 4,
      mime: 'image/jpeg'
    });
    const shot = await put(TABLES.mediaItems, { kind: 'baseline', title: 'Baseline front', blobId: 'blob-tone-2' } as never);

    await render(
      <ToastHost>
        <ToneReadCard settings={{ ...DEFAULT_SETTINGS, imageAnalysis: true }} startShot={shot} onApply={() => {}} />
      </ToastHost>
    );
    expect(text()).toContain('Read the two colour bands off a photo');

    // jsdom never loads a blob URL, so the photo is marked loaded by hand
    const img = container.querySelector('img') as HTMLImageElement;
    Object.defineProperty(img, 'complete', { value: true, configurable: true });
    Object.defineProperty(img, 'naturalWidth', { value: 600, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 800, configurable: true });

    const read = [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Read the framed area'))!;
    await act(async () => {
      read.click();
      await tick(20);
    });
    await settle(2);

    expect(getImageData, 'with the switch on the pixels are read').toHaveBeenCalled();
  });

  it('guides and annotation markers stay off the photo canvas while the switch is off', async () => {
    await settings({ imageAnalysis: false });
    await render(
      <ToastHost>
        <PhotoCanvas
          item={null}
          guides={[{ type: 'h', at: 50, label: 'eye line' }, { type: 'v', at: 50, label: 'midline' }]}
          pins={[{ id: 'p1', x: 40, y: 40, label: 'jaw' }]}
        />
      </ToastHost>
    );

    // ui/media.tsx:315-317 — the tools are not rendered, not merely hidden
    expect(container.querySelectorAll('.gl-guide')).toHaveLength(0);
    expect(container.querySelectorAll('.gl-pin-dot')).toHaveLength(0);
  });

  it('the same guides and markers appear once image analysis is on', async () => {
    await settings({ imageAnalysis: true });
    await render(
      <ToastHost>
        <PhotoCanvas
          item={null}
          guides={[{ type: 'h', at: 50, label: 'eye line' }, { type: 'v', at: 50, label: 'midline' }]}
          pins={[{ id: 'p1', x: 40, y: 40, label: 'jaw' }]}
        />
      </ToastHost>
    );

    expect(container.querySelectorAll('.gl-guide')).toHaveLength(2);
    expect(container.querySelectorAll('.gl-pin-dot')).toHaveLength(1);
  });

  /**
   * Fixed in this round: `ingestImage` no longer reads her pixels for colour at
   * all unless `imageAnalysis` is on. The derived fields are written empty
   * rather than holding values she never authorised (src/media/store.ts,
   * `colourReading`). Proved by reading the row back out of Dexie and by
   * watching the 64x64 sample the palette used to need.
   *
   * STATED LIMIT, not hidden in a skip: the 9x8 luma sample behind the look-
   * alike fingerprint is still taken with the switch off, because the shot grid
   * and the duplicate review queue are built on it. It carries no colour and
   * nothing readable — and Settings says so out loud.
   */
  it('no colour is derived from her photograph while image analysis is off', async () => {
    await settings({ allowUploads: true, imageAnalysis: false });
    const off = await ingestImage({ file: photo(6), kind: 'upload', album: 'Unfiled' });

    const row = (await findAll(TABLES.mediaItems))[0];
    expect(row.tags ?? [], 'no palette tags on the row').toEqual([]);
    expect(((row.data as Record<string, unknown>)?.palette ?? []) as unknown[]).toEqual([]);
    expect(getImageData.mock.calls.filter((c) => c[2] === 64), 'the 64x64 palette sample is never taken').toEqual([]);
    expect(String(off.row.blobId), 'the photograph itself is still stored').toBeTruthy();

    // the switch is the only difference: on, the same ingest reads pixels and persists what it finds
    await settings({ allowUploads: true, imageAnalysis: true });
    const on = await ingestImage({ file: photo(7), kind: 'upload', album: 'Unfiled' });
    expect(getImageData.mock.calls.some((c) => c[2] === 64), 'with the switch on the palette sample happens').toBe(true);
    expect(((on.row.data as Record<string, unknown>)?.palette ?? []) as unknown[]).not.toEqual([]);
    expect((on.row.tags as string[]).length).toBeGreaterThan(0);
  });
});

/* ======================================================== switch 5: reminders */

describe('in-app reminders switched off (reminders)', () => {
  /** An active routine with no log today is due — engine/recommendations.ts:487-491. */
  const dueRoutine = async () =>
    put(TABLES.routines, { id: 'r-retwist', name: 'Retwist the edges', domain: 'hair', active: true, cadence: 'weekly' } as never);

  async function dashboard() {
    await render(
      <MemoryRouter initialEntries={['/home']}>
        <ToastHost>
          <HomePage />
        </ToastHost>
      </MemoryRouter>
    );
  }

  it('nothing due is listed on the dashboard while reminders are off, and nothing is written for them', async () => {
    await settings({ reminders: false });
    await dueRoutine();
    const before = await counts();
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub as unknown as typeof fetch);

    await dashboard();

    // pages/HomePage.tsx:342-348 replaces the list with a note that names the switch
    expect(text()).toContain('In-app reminders are off in Settings → Privacy, so nothing due is listed here.');
    expect(text()).toContain('Turn them back on');
    const checks = container.querySelectorAll('.gl-check');
    expect(checks, 'the due items are not listed at all').toHaveLength(0);

    // Recorded, not asserted as fine or as a defect: the strip above the widget
    // still shows the *count* of things due (pages/HomePage.tsx:231) with the
    // switch off. It names nothing and nags nowhere, so it is a residue of the
    // derivation, not a reminder — but it is the one place "off" is not total.
    expect(text()).toMatch(/Due today/);

    expect(await counts()).toEqual(before);
    expect(await db.routineLogs.count()).toBe(0);
    expect(await db.calendarEvents.count()).toBe(0);
    expect(await db.logs.count(), 'no scheduling record is left behind').toBe(0);
    expect(fetchStub, 'reminders never reach out').not.toHaveBeenCalled();
  });

  it('the same dashboard lists the due routine once reminders are on', async () => {
    await settings({ reminders: true });
    await dueRoutine();

    await dashboard();

    expect(text()).not.toContain('In-app reminders are off in Settings → Privacy');
    const checks = container.querySelectorAll('.gl-check');
    expect(checks.length, 'the routine is listed as due').toBeGreaterThan(0);
    expect(text()).toContain('Retwist the edges');
  });
});

/* ==================================== switch 8: allowExternalProcessing (no egress) */

describe('nothing leaves the device while external processing is off (allowExternalProcessing)', () => {
  /**
   * Scoped on purpose: jsdom cannot prove a whole-app invariant, so this covers
   * the three flows that could plausibly reach out — the sync flush, the remote
   * image importer, and the dashboard/discover feed builders — plus the two
   * side channels (sendBeacon, `new Image()` loads).
   */
  it('the sync flush, the remote importer and the feed builders all make no request', async () => {
    await settings({ allowExternalProcessing: false, syncEnabled: true, syncEndpoint: 'https://sync.invalid/queue' });
    await aGoal('g-off');
    const queueBefore = await db.syncQueue.count();
    expect(queueBefore).toBeGreaterThan(0);

    const fetchStub = vi.fn().mockRejectedValue(new Error('a real request would have left the device'));
    const beacon = vi.fn().mockReturnValue(false);
    vi.stubGlobal('fetch', fetchStub as unknown as typeof fetch);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
    const images: string[] = [];
    class SpyImage extends FakeImage {
      set src(v: string) {
        images.push(v);
      }
    }
    vi.stubGlobal('Image', SpyImage as unknown as typeof Image);

    const sync = await flushSyncQueue();
    expect(sync.ok).toBe(false);
    expect(sync.detail, 'db/backup.ts:250 refuses on this switch alone').toMatch(/Privacy blocks it/i);
    expect(sync.pushed).toBe(0);
    expect(await db.syncQueue.count()).toBe(queueBefore);

    const remoteErr = await ingestImage({
      remoteUrl: 'https://images.unsplash.com/someone-elses-photo',
      kind: 'upload'
    }).catch((e: Error) => e);
    expect((remoteErr as Error).message).toMatch(/Allow external processing/i);
    expect(await db.mediaItems.count()).toBe(0);

    // the feed builder with no saved provider key stays on the bundled library
    const page = await fetchFeedPage({ page: 1, online: true });
    expect(page.items.length).toBeGreaterThanOrEqual(0);

    await settle(3);
    expect(fetchStub, 'no fetch of any kind').not.toHaveBeenCalled();
    expect(beacon, 'no sendBeacon').not.toHaveBeenCalled();
    expect(images.filter((s) => /^https?:\/\//.test(s)), 'no remote <img> load').toEqual([]);
  });

  it('giving the switch makes the sync flush send exactly one request to her own endpoint', async () => {
    await settings({
      allowExternalProcessing: true,
      syncEnabled: true,
      syncEndpoint: 'https://sync.invalid/queue'
    });
    await aGoal('g-on');

    const fetchStub = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ changes: [], conflicts: [] })
    });
    vi.stubGlobal('fetch', fetchStub as unknown as typeof fetch);

    const res = await flushSyncQueue();
    expect(res.ok).toBe(true);
    expect(res.pushed).toBeGreaterThan(0);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0][0]).toBe('https://sync.invalid/queue');
    expect(await db.syncQueue.count()).toBe(0);
  });

  /**
   * Fixed in this round: src/providers/discovery.ts reads
   * `allowExternalProcessing` before it builds a provider request, so a saved
   * key alone no longer puts her search text on the network. The claim Settings
   * makes about the provider-search path is proved below: zero calls, and the
   * feed's own provider status naming the switch that refused. (Settings states
   * the one path this switch deliberately does not cover — the Pinterest
   * authorisation she starts herself.)
   */
  it('a saved provider key does not put her search on the network while external processing is off', async () => {
    await settings({ allowExternalProcessing: false });
    await put(TABLES.integrations, { id: 'i-pexels', service: 'pexels', token: 'her-own-key', status: 'connected' } as never);

    const fetchStub = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchStub as unknown as typeof fetch);

    const keys: Record<string, string> = {};
    for (const r of await findAll(TABLES.integrations)) {
      if (r.token) keys[String(r.service)] = String(r.token);
    }
    const off = await fetchFeedPage({ page: 1, query: 'locretention protective styles', keys, online: true });

    expect(fetchStub, 'nothing leaves while the switch is off').not.toHaveBeenCalled();
    expect(
      off.providerStatus.some((s) => s.id === 'pexels' && /Allow external processing/.test(s.detail)),
      'and the feed says which switch refused it instead of failing quietly'
    ).toBe(true);

    // paired: give the switch and the same call does go out, with her key
    await updateSettings({ allowExternalProcessing: true });
    await fetchFeedPage({ page: 1, query: 'locretention protective styles', keys, online: true });
    expect(fetchStub, 'the switch was the only thing holding it back').toHaveBeenCalledTimes(1);
    expect(String(fetchStub.mock.calls[0][0])).toContain('api.pexels.com/v1/search?query=locretention');
    expect((fetchStub.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'her-own-key' });
  });

  it('the dashboard feed page asks for nothing when no provider key exists', async () => {
    await settings({ allowExternalProcessing: false });
    const fetchStub = vi.fn().mockRejectedValue(new Error('network'));
    vi.stubGlobal('fetch', fetchStub as unknown as typeof fetch);

    await render(
      <MemoryRouter initialEntries={['/home']}>
        <ToastHost>
          <HomePage />
        </ToastHost>
      </MemoryRouter>
    );

    expect(fetchStub, 'the dashboard builds itself from local rows').not.toHaveBeenCalled();
  });
});
