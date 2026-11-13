import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composeFitSheet, type FitSheetPiece } from '../media/fitSheet';

/**
 * The fit sheet is the closet's only picture-making code, so the promise under
 * test is a visual one: a stored photograph is placed whole inside its own cell —
 * never cropped, never stretched, never enlarged past its own pixels — and each
 * cell says which garment it came from. The honesty line is asserted too, since
 * a sheet of flat-lay pictures must not read as a photograph of the outfit worn.
 */

/** What the fake decoder reports for the next picture, set per test. */
const spec = { width: 1200, height: 800, fail: (_url: string) => false };

class FakeImage {
  naturalWidth = spec.width;
  naturalHeight = spec.height;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(value: string) {
    setTimeout(() => (spec.fail(value) ? this.onerror?.() : this.onload?.()), 0);
  }
}

type Recorder = {
  calls: { fn: string; args: (string | number)[] }[];
  /** the element's own width/height, read at getContext time — the composer sizes before it draws */
  size: { w: number; h: number };
};

const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
const original = { getContext: proto.getContext, toBlob: proto.toBlob };
let last: Recorder;

function withCanvas() {
  const rec: Recorder = { calls: [], size: { w: 0, h: 0 } };
  last = rec;
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textBaseline: '',
    drawImage: (...a: unknown[]) => rec.calls.push({ fn: 'drawImage', args: a.slice(1) as (string | number)[] }),
    fillRect: (...a: unknown[]) => rec.calls.push({ fn: 'fillRect', args: a as (string | number)[] }),
    strokeRect: (...a: unknown[]) => rec.calls.push({ fn: 'strokeRect', args: a as (string | number)[] }),
    fillText: (...a: unknown[]) => rec.calls.push({ fn: 'fillText', args: a as (string | number)[] })
  };
  proto.getContext = function (this: HTMLCanvasElement) {
    rec.size = { w: this.width, h: this.height };
    return ctx as unknown as CanvasRenderingContext2D;
  };
  proto.toBlob = function (cb: (b: Blob | null) => void, type?: string) {
    cb(new Blob([new Uint8Array(128)], { type: type ?? 'image/png' }));
  } as unknown as typeof HTMLCanvasElement.prototype.toBlob;
  return rec;
}

const noCanvas = () => {
  proto.getContext = () => null;
};

const pieces = (...labels: string[]): FitSheetPiece[] => labels.map((label, n) => ({ label, url: `blob:piece-${n}` }));
const drawn = (rec: Recorder) => rec.calls.filter((c) => c.fn === 'drawImage').map((c) => c.args as number[]);
const texts = (rec: Recorder) => rec.calls.filter((c) => c.fn === 'fillText').map((c) => String(c.args[0]));

beforeEach(() => {
  spec.width = 1200;
  spec.height = 800;
  spec.fail = () => false;
  vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
});

afterEach(() => {
  proto.getContext = original.getContext;
  proto.toBlob = original.toBlob;
  vi.unstubAllGlobals();
});

describe('the fit sheet composer', () => {
  it('hands back nothing when there is nothing to place', async () => {
    withCanvas();
    expect(await composeFitSheet([])).toBeNull();
  });

  it('says so when the browser will not hand pixels back, instead of exporting a blank sheet', async () => {
    // jsdom has no canvas at all, which is exactly the case the app must survive
    noCanvas();
    expect(await composeFitSheet(pieces('Silk blouse'))).toBeNull();
  });

  it('places each whole photograph inside its own cell and never crops it', async () => {
    const rec = withCanvas();
    await composeFitSheet(pieces('Silk blouse', 'Wool trousers'), { columns: 3, cellWidth: 300, cellHeight: 400, gap: 14, padding: 22, header: 62 });
    const boxes = drawn(rec);
    expect(boxes).toHaveLength(2);
    for (const [x, y, w, h] of boxes) {
      // 1200x800 contain-fit into a 300x400 cell is 300 wide, 200 tall
      expect(w).toBe(300);
      expect(h).toBe(200);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(rec.size.w);
      expect(y + h).toBeLessThanOrEqual(rec.size.h);
    }
    /* both cells sit on one row, a cell width plus the gap apart */
    expect(boxes[1][1]).toBe(boxes[0][1]);
    expect(boxes[1][0] - boxes[0][0]).toBe(300 + 14);
  });

  it('centres a picture in its cell and leaves a small one at its own size', async () => {
    const rec = withCanvas();
    spec.width = 100;
    spec.height = 50;
    await composeFitSheet(pieces('Small snapshot'), { columns: 1, cellWidth: 300, cellHeight: 400, gap: 0, padding: 0, header: 0 });
    const [x, y, w, h] = drawn(rec)[0];
    expect(w).toBe(100);
    expect(h).toBe(50);
    expect(x).toBe(100);
    expect(y).toBe(175);
  });

  it('wraps into rows and grows the sheet to fit them', async () => {
    const rec = withCanvas();
    await composeFitSheet(pieces('a', 'b', 'c', 'd', 'e'), { columns: 2, cellWidth: 300, cellHeight: 400, gap: 14, padding: 22, header: 62 });
    expect(drawn(rec)).toHaveLength(5);
    expect(new Set(drawn(rec).map((b) => b[1])).size).toBe(3);
    expect(rec.size.w).toBe(22 * 2 + 2 * 300 + 14);
    expect(rec.size.h).toBe(22 * 2 + 62 + 3 * (400 + 26) + 2 * 14);
  });

  it('labels every cell with the garment name and trims a long one instead of overflowing', async () => {
    const rec = withCanvas();
    const long = 'Hand-me-down cashmere cardigan in heather grey with elbow patches';
    await composeFitSheet(pieces('Silk blouse', long), { columns: 1 });
    const labels = texts(rec);
    expect(labels).toContain('Silk blouse');
    const trimmed = labels.find((t) => t.startsWith('Hand-me-down'));
    expect(trimmed).toBeDefined();
    expect(trimmed!.length).toBe(34);
    expect(trimmed!.endsWith('…')).toBe(true);
  });

  it('prints what the sheet is and what it is not', async () => {
    const rec = withCanvas();
    await composeFitSheet(pieces('Silk blouse'));
    const all = texts(rec).join(' | ');
    expect(all).toContain('composed from the photographs of these pieces');
    expect(all).toContain('Not a photograph of the outfit being worn');
  });

  it('keeps going when one stored picture cannot be decoded, and only claims the ones it placed', async () => {
    const rec = withCanvas();
    spec.fail = (url) => url.endsWith('piece-0');
    const blob = await composeFitSheet(pieces('Lost picture', 'Readable picture'), { columns: 2 });
    expect(blob).not.toBeNull();
    expect(drawn(rec)).toHaveLength(1);
    expect(texts(rec)).not.toContain('Lost picture');
    expect(texts(rec)).toContain('Readable picture');
  });

  it('returns null when every picture fails to load, rather than a header-only sheet', async () => {
    withCanvas();
    spec.fail = () => true;
    expect(await composeFitSheet(pieces('a', 'b'))).toBeNull();
  });

  it('exports a webp blob', async () => {
    withCanvas();
    const blob = await composeFitSheet(pieces('Silk blouse'));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob!.type).toBe('image/webp');
  });
});
