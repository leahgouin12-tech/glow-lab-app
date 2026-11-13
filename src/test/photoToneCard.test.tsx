import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToneReadCard } from '../ui/photoTone';
import { ToastHost } from '../ui/primitives';
import { DEFAULT_SETTINGS } from '../state/settings';
import { TABLES } from '../db/schema';
import { put } from '../db/repo';
import { db } from '../db/db';
import type { AppSettings } from '../state/settings';

/**
 * jsdom has no canvas, which is exactly the case the card has to survive: the
 * read has to say plainly that pixels did not come back. The colour read
 * itself is tested as arithmetic in photoTone.test.ts; here the wiring is.
 */

let container: HTMLDivElement;
let root: Root;
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const settle = async (rounds = 3) => {
  for (let i = 0; i < rounds; i += 1) await act(async () => tick(16));
};

const settings = (over: Partial<AppSettings> = {}): AppSettings => ({ ...DEFAULT_SETTINGS, imageAnalysis: true, ...over });

/** jsdom never fetches a blob URL, so the picture is marked loaded by hand. */
function loadPhoto() {
  const img = container.querySelector('img') as HTMLImageElement | null;
  if (!img) throw new Error('no photo rendered');
  Object.defineProperty(img, 'complete', { value: true, configurable: true });
  Object.defineProperty(img, 'naturalWidth', { value: 600, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: 800, configurable: true });
}

const button = (label: string) => {
  const b = [...container.querySelectorAll('button')].find((el) => (el.textContent ?? '').trim().toLowerCase().includes(label.toLowerCase()));
  if (!b) throw new Error(`no button matching "${label}"`);
  return b as HTMLButtonElement;
};

async function mount(props: Parameters<typeof ToneReadCard>[0]) {
  root = createRoot(container);
  await act(async () => root.render(<ToastHost><ToneReadCard {...props} /></ToastHost>));
  await settle();
}

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
  // objectUrlFor reads a real blob row, so one exists to hand back
  await db.mediaBlobs.put({
    id: 'blob-1',
    blob: new Blob(['tone-sample'], { type: 'image/jpeg' }),
    thumb: new Blob(['thumb'], { type: 'image/jpeg' }),
    createdAt: Date.now(),
    bytes: 10,
    mime: 'image/jpeg'
  });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  root?.unmount();
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the photo read on the profile', () => {
  it('stays shut while the image switch is off, and says so', async () => {
    await mount({ settings: settings({ imageAnalysis: false }), onApply: () => {} });
    expect(container.textContent).toContain('Photo-assisted reading is switched off');
    expect(container.querySelector('input[type="range"]')).toBeNull();
  });

  it('gives the ellipse its three sliders and a read button when the switch is on', async () => {
    await mount({ settings: settings(), onApply: () => {} });
    expect(container.querySelectorAll('input[type="range"]').length).toBe(3);
    expect(button('Read the framed area')).toBeTruthy();
  });

  it('refuses to invent a band when the browser will not hand pixels back', async () => {
    const shot = await put(TABLES.mediaItems, { kind: 'baseline', title: 'Baseline front', blobId: 'blob-1' } as never);
    await mount({ settings: settings(), startShot: shot, onApply: () => {} });
    loadPhoto();
    await act(async () => button('Read the framed area').click());
    await settle();
    expect(container.textContent).toContain('will not hand pixels back');
    expect(container.textContent).not.toContain('Use these two bands');
  });

  it('proposes both bands from the pixels, lets them be edited, and writes what is confirmed', async () => {
    // a warm medium face colour, the arithmetic for which is tested on its own
    const face = [160, 112, 70];
    const ctx = {
      drawImage: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = face[0];
          data[i + 1] = face[1];
          data[i + 2] = face[2];
          data[i + 3] = 255;
        }
        return { data };
      }
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const apply = vi.fn();
    const shot = await put(TABLES.mediaItems, { kind: 'baseline', title: 'Baseline front', blobId: 'blob-1' } as never);
    await mount({ settings: settings(), startShot: shot, onApply: apply });

    loadPhoto();

    await act(async () => button('Read the framed area').click());
    loadPhoto();

    const selects = [...container.querySelectorAll('select')] as HTMLSelectElement[];
    expect(selects.length).toBeGreaterThanOrEqual(2);
    expect(selects[0].value).toBe('tan');
    expect(selects[1].value).toBe('neutral');
    expect(container.textContent).toContain('pixels inside the ellipse');
    expect(button('Use these two bands')).toBeTruthy();

    await act(async () => button('Use these two bands').click());
    await settle();
    expect(apply).toHaveBeenCalledTimes(1);
    const patch = apply.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.skinTone).toBe('tan');
    expect(patch.undertone).toBe('neutral');
    const stamp = patch.toneRead as Record<string, unknown>;
    expect(stamp.pixels).toBeGreaterThan(24);
    expect(stamp.mediaId).toBe(shot.id);
    expect(typeof stamp.L).toBe('number');
    expect(container.textContent).toContain('Saved to Appearance');
  });

  it('adopts the photo the device already holds instead of asking for a new one', async () => {
    const shot = await put(TABLES.mediaItems, { kind: 'baseline', title: 'Baseline front', blobId: 'blob-1' } as never);
    await mount({ settings: settings(), startShot: shot, onApply: () => {} });
    await settle(4);
    expect(container.querySelector('img')).toBeTruthy();
    expect(container.textContent).toContain('Take or choose another front-lit photo');
  });
});
