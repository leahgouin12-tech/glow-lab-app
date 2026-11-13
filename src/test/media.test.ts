import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ingestImage } from '../media/store';
import { hasExif, readExif, type ExifSummary } from '../media/exif';
import { dHashFromGray, grayFromRgba, hammingDistance } from '../media/dhash';
import { TABLES } from '../db/schema';
import { findAll, todayISO } from '../db/repo';
import { db } from '../db/db';
import { updateSettings } from '../state/settings';

/**
 * jsdom has no image decoder, so the pipeline is exercised against a fake
 * decoder: the sizing, hashing, dedupe, privacy and licensing rules under test
 * are Glow Lab's own, not the browser's.
 */
class FakeImage {
  naturalWidth = 1200;
  naturalHeight = 2600;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_value: string) {
    setTimeout(() => this.onload?.(), 0);
  }
}

const ctx2d = {
  drawImage: () => {},
  save: () => {},
  restore: () => {},
  translate: () => {},
  rotate: () => {},
  scale: () => {},
  setTransform: () => {},
  getImageData: (_x: number, _y: number, w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    data.fill(255);
    return { data, width: w, height: h };
  }
};

HTMLCanvasElement.prototype.getContext = (() => ctx2d) as unknown as typeof HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.toBlob = ((cb: (b: Blob | null) => void, type?: string) =>
  cb(new Blob([new Uint8Array(64)], { type: type ?? 'image/webp' }))
) as unknown as typeof HTMLCanvasElement.prototype.toBlob;

beforeEach(async () => {
  vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
  /* `imageAnalysis` ships off now, and with it off ingest stores no palette at
     all (switches.test.tsx proves that half). This file is about the decoding,
     sizing, hashing and licensing pipeline, so it runs with the switch on. */
  await updateSettings({ imageAnalysis: true });
});

const bytes = (seed: number) => new Blob([Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, seed])], { type: 'image/png' });

/* ---------------------------------------------------- hand-assembled EXIF files */

type ExifTag =
  | { tag: number; kind: 'short'; value: number }
  | { tag: number; kind: 'long'; value: number }
  | { tag: number; kind: 'ascii'; value: string }
  | { tag: number; kind: 'rationals'; value: [number, number][] };

const TAG_EXIF_POINTER = 0x8769;
const NO_EXIF = { orientation: null, takenOn: null, device: null, camera: null };
const dataOf = (row: { data?: unknown }) => (row.data ?? {}) as Record<string, any>;

/** Writes a TIFF block (IFD0, Exif sub-IFD, out-of-line values) in either byte order. */
function buildTiff(ifd0: ExifTag[], sub: ExifTag[], little: boolean): Uint8Array {
  const typeOf = (t: ExifTag) => (t.kind === 'short' ? 3 : t.kind === 'long' ? 4 : t.kind === 'ascii' ? 2 : 5);
  const countOf = (t: ExifTag) =>
    t.kind === 'short' || t.kind === 'long' ? 1 : t.kind === 'ascii' ? t.value.length + 1 : t.value.length;
  const sizeOf = (t: ExifTag) =>
    t.kind === 'short' ? 2 : t.kind === 'long' ? 4 : t.kind === 'ascii' ? t.value.length + 1 : t.value.length * 8;

  const ifd0At = 8;
  const subAt = ifd0At + 2 + ifd0.length * 12 + 4;
  let heap = subAt + 2 + sub.length * 12 + 4;
  const placed = new Map<ExifTag, number>();
  for (const t of [...ifd0, ...sub]) {
    if (sizeOf(t) > 4) {
      placed.set(t, heap);
      heap += sizeOf(t);
    }
  }
  const view = new DataView(new ArrayBuffer(heap));
  view.setUint8(0, little ? 0x49 : 0x4d);
  view.setUint8(1, little ? 0x49 : 0x4d);
  view.setUint16(2, 0x002a, little);
  view.setUint32(4, ifd0At, little);

  const writeIfd = (at: number, tags: ExifTag[]) => {
    view.setUint16(at, tags.length, little);
    tags.forEach((t, i) => {
      const p = at + 2 + i * 12;
      let value = t.kind === 'short' || t.kind === 'long' ? t.value : 0;
      // the sub-IFD pointer is the one offset only the builder knows
      if (t.tag === TAG_EXIF_POINTER && t.kind === 'long') value = subAt;
      view.setUint16(p, t.tag, little);
      view.setUint16(p + 2, typeOf(t), little);
      view.setUint32(p + 4, countOf(t), little);
      if (sizeOf(t) <= 4) {
        if (t.kind === 'short') view.setUint16(p + 8, value, little);
        else if (t.kind === 'long') view.setUint32(p + 8, value, little);
        else if (t.kind === 'ascii') {
          for (let k = 0; k < t.value.length; k += 1) view.setUint8(p + 8 + k, t.value.charCodeAt(k));
          view.setUint8(p + 8 + t.value.length, 0);
        }
      } else {
        const o = placed.get(t) as number;
        view.setUint32(p + 8, o, little);
        if (t.kind === 'ascii') {
          for (let k = 0; k < t.value.length; k += 1) view.setUint8(o + k, t.value.charCodeAt(k));
          view.setUint8(o + t.value.length, 0);
        } else if (t.kind === 'rationals') {
          t.value.forEach(([n, d], idx) => {
            view.setUint32(o + idx * 8, n, little);
            view.setUint32(o + idx * 8 + 4, d, little);
          });
        }
      }
    });
    view.setUint32(at + 2 + tags.length * 12, 0, little);
  };
  writeIfd(ifd0At, ifd0);
  writeIfd(subAt, sub);
  return new Uint8Array(view.buffer);
}

/** Wraps a TIFF block in a real JPEG APP1 segment, behind a decoy DQT segment. */
function jpegWith(tiff: Uint8Array): Uint8Array {
  const len = tiff.length + 6 + 2;
  const head = [
    0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x01, 0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00
  ];
  return Uint8Array.from([...head, ...tiff, 0xff, 0xd9]);
}

const phoneIfd0 = (): ExifTag[] => [
  { tag: 0x0112, kind: 'short', value: 6 },
  { tag: 0x010f, kind: 'ascii', value: 'Apple' },
  { tag: 0x0110, kind: 'ascii', value: 'iPhone 15 Pro' },
  { tag: 0x0132, kind: 'ascii', value: '2026:09:12 18:04:22' },
  { tag: TAG_EXIF_POINTER, kind: 'long', value: 0 }
];
const phoneSub = (): ExifTag[] => [
  { tag: 0x9003, kind: 'ascii', value: '2026:09:12 18:04:22' },
  { tag: 0x9201, kind: 'rationals', value: [[1, 120]] },
  { tag: 0x8822, kind: 'short', value: 200 },
  { tag: 0x920a, kind: 'rationals', value: [[42, 1]] },
  { tag: 0x9209, kind: 'short', value: 1 }
];
const phoneJpeg = (little: boolean) => jpegWith(buildTiff(phoneIfd0(), phoneSub(), little));
/** 18 bytes of JPEG preamble + 8-byte TIFF header + a 5-entry IFD0. */
const IFD0_ONLY_END = 18 + 8 + (2 + phoneIfd0().length * 12 + 4);

describe('media pipeline', () => {
  it('stores a downscaled image, its thumbnail and a metadata row', async () => {
    const first = await ingestImage({ file: bytes(1), kind: 'progress', title: 'Week 1', takenOn: '2026-11-01' });
    expect(first.duplicate).toBe(false);
    expect(first.row.blobId).toBeTruthy();
    // stored at the capped working size, not the 2600px original
    expect(Math.max(Number(first.row.width), Number(first.row.height))).toBeLessThanOrEqual(1500);
    expect(Number(first.row.width)).toBeGreaterThan(1);
    expect(first.bytes).toBeGreaterThan(0);
    expect(first.row.kind).toBe('progress');
    expect(first.row.album).toBe('Unfiled');
    expect((await db.mediaBlobs.toArray())).toHaveLength(1);
    expect((await db.mediaBlobs.toArray())[0].thumb).toBeTruthy();
  });

  it('dedupes identical bytes on hash instead of storing the same photo twice', async () => {
    const first = await ingestImage({ file: bytes(7), kind: 'upload', title: 'Reference' });
    const again = await ingestImage({ file: bytes(7), kind: 'upload', title: 'Reference again' });
    expect(again.duplicate).toBe(true);
    expect(again.row.id).toBe(first.row.id);
    expect(await findAll(TABLES.mediaItems)).toHaveLength(1);
    expect((await db.mediaBlobs.toArray())).toHaveLength(1);
    const different = await ingestImage({ file: bytes(8), kind: 'upload', title: 'Other' });
    expect(different.duplicate).toBe(false);
    expect(await findAll(TABLES.mediaItems)).toHaveLength(2);
  });

  it('is private by default and only shared when the user says so', async () => {
    const quiet = await ingestImage({ file: bytes(2), kind: 'baseline' });
    expect(quiet.row.private).toBe(true);
    const shown = await ingestImage({ file: bytes(3), kind: 'outfit', private: false });
    expect(shown.row.private).toBe(false);
    expect((await findAll(TABLES.mediaItems)).every((m) => typeof m.private === 'boolean')).toBe(true);
  });

  it('labels ownership honestly instead of pretending stock imagery is the user’s', async () => {
    const mine = await ingestImage({ file: bytes(4), kind: 'upload' });
    expect(mine.row.license).toBe('User-owned');
    const borrowed = await ingestImage({
      file: bytes(5),
      kind: 'library',
      sourceKind: 'pexels',
      sourceUrl: 'https://example.org/photo',
      attribution: 'Photo by A. Photographer'
    });
    expect(String(borrowed.row.license)).toContain('verify');
    expect(borrowed.row.attribution).toBe('Photo by A. Photographer');
  });

  it('records a real palette from the pixels it decoded', async () => {
    const row = await ingestImage({ file: bytes(6), kind: 'cover' });
    const palette = (row.row.data as Record<string, unknown>).palette as string[];
    expect(Array.isArray(palette)).toBe(true);
    expect(palette.length).toBeGreaterThan(0);
    expect(palette[0]).toMatch(/^#[0-9a-f]{6}$/);
    expect((row.row.tags as string[]).length).toBeLessThanOrEqual(5);
  });
});

describe('readExif', () => {
  it('reads orientation, capture date, device and camera settings out of a little-endian APP1 block', () => {
    const summary = readExif(phoneJpeg(true).buffer as ArrayBuffer);
    expect(summary.orientation).toBe(6);
    expect(summary.takenOn).toBe('2026-09-12');
    expect(summary.device).toBe('Apple iPhone 15 Pro');
    expect(summary.camera).toEqual({ exposure: '1/120 s', iso: 200, focalMm: 42, flash: true });
    expect(hasExif(summary)).toBe(true);
  });

  it('reads the identical values out of a big-endian block', () => {
    expect(readExif(phoneJpeg(false).buffer as ArrayBuffer)).toEqual(readExif(phoneJpeg(true).buffer as ArrayBuffer));
  });

  it('prefers DateTimeOriginal over the IFD0 DateTime', () => {
    const jpeg = jpegWith(
      buildTiff(
        [{ tag: 0x0132, kind: 'ascii', value: '2019:01:02 03:04:05' }, { tag: TAG_EXIF_POINTER, kind: 'long', value: 0 }],
        [{ tag: 0x9003, kind: 'ascii', value: '2026:09:12 18:04:22' }],
        true
      )
    );
    expect(readExif(jpeg.buffer as ArrayBuffer).takenOn).toBe('2026-09-12');
  });

  it('falls back to the IFD0 DateTime and reports a non-firing flash as false, not missing', () => {
    const jpeg = jpegWith(
      buildTiff(
        [
          { tag: 0x0112, kind: 'short', value: 8 },
          { tag: 0x0132, kind: 'ascii', value: '2024:03:04 10:11:12' },
          { tag: TAG_EXIF_POINTER, kind: 'long', value: 0 }
        ],
        [{ tag: 0x9209, kind: 'short', value: 0 }],
        true
      )
    );
    const summary = readExif(jpeg.buffer as ArrayBuffer);
    expect(summary.orientation).toBe(8);
    expect(summary.takenOn).toBe('2024-03-04');
    expect(summary.camera).toEqual({ exposure: null, iso: null, focalMm: null, flash: false });
  });

  it('formats a long exposure in seconds and drops impossible orientation values', () => {
    const long = jpegWith(
      buildTiff(
        [{ tag: 0x0112, kind: 'short', value: 3 }, { tag: TAG_EXIF_POINTER, kind: 'long', value: 0 }],
        [{ tag: 0x9201, kind: 'rationals', value: [[25, 10]] }],
        true
      )
    );
    expect(readExif(long.buffer as ArrayBuffer).camera?.exposure).toBe('2.5 s');
    const junk = jpegWith(buildTiff([{ tag: 0x0112, kind: 'short', value: 99 }], [], true));
    expect(readExif(junk.buffer as ArrayBuffer).orientation).toBeNull();
    expect(hasExif(readExif(junk.buffer as ArrayBuffer))).toBe(false);
  });

  it('returns nulls rather than throwing on files that carry no EXIF', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(readExif(png.buffer as ArrayBuffer)).toEqual(NO_EXIF);
    expect(hasExif(readExif(png.buffer as ArrayBuffer))).toBe(false);
    expect(readExif(new ArrayBuffer(0))).toEqual(NO_EXIF);
    expect(readExif(undefined)).toEqual(NO_EXIF);
    // APP1 whose recorded length runs past the end of the file
    expect(readExif(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0xff, 0x45, 0x78]).buffer as ArrayBuffer)).toEqual(NO_EXIF);
    // APP1 that is not Exif at all, then scan data
    expect(
      readExif(
        Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0xff, 0xda, 0x00, 0x02, 0x00, 0x01])
          .buffer as ArrayBuffer
      )
    ).toEqual(NO_EXIF);
  });

  it('keeps what is safely inside the file when the tail of the metadata is cut off', () => {
    const whole = phoneJpeg(true);
    const summary = readExif(whole.slice(0, IFD0_ONLY_END).buffer as ArrayBuffer);
    expect(summary.orientation).toBe(6);
    // the strings live past the cut, so they are reported as unknown rather than guessed
    expect(summary.device).toBeNull();
    expect(summary.takenOn).toBeNull();
    expect(summary.camera).toBeNull();
    expect(() => readExif(whole.slice(0, 24).buffer as ArrayBuffer)).not.toThrow();
    expect(() => readExif(whole.slice(24).buffer as ArrayBuffer)).not.toThrow();
  });
});

describe('ingest orientation handling', () => {
  it('stores a rotated phone JPEG upright and records what the file said', async () => {
    const plain = await ingestImage({ file: bytes(20), kind: 'progress', title: 'Plain' });
    const turned = await ingestImage({
      file: new Blob([phoneJpeg(true).buffer as ArrayBuffer], { type: 'image/jpeg' }),
      kind: 'progress',
      title: 'Rotated'
    });

    // FakeImage is 1200x2600, so an untouched working copy is portrait.
    expect(Number(plain.row.width)).toBeLessThan(Number(plain.row.height));
    expect(Number(turned.row.width)).toBeGreaterThan(Number(turned.row.height));

    const plainData = dataOf(plain.row);
    expect(plainData.uprighted).toBe(false);
    expect(plainData.exif).toBeNull();
    expect(plainData.capturedOn).toBeNull();

    const data = dataOf(turned.row);
    expect(data.uprighted).toBe(true);
    expect(data.originalWidth).toBe(1200);
    expect(data.originalHeight).toBe(2600);
    expect(data.capturedOn).toBe('2026-09-12');
    expect((data.exif as ExifSummary).orientation).toBe(6);
    expect(data.exif.device).toBe('Apple iPhone 15 Pro');
    expect(data.exif.camera.iso).toBe(200);
    // nothing the user set is overwritten by what the file claimed
    expect(turned.row.title).toBe('Rotated');
    expect(turned.row.kind).toBe('progress');
  });

  it('dates a shot from the file when I did not type a date, and never over one I did', async () => {
    /** Same camera data, distinct bytes, so each case really is a new file. */
    const phoneFile = (pad: number) => {
      const jpeg = phoneJpeg(true);
      const tail = new Uint8Array(jpeg.length + 1);
      tail.set(jpeg);
      tail[jpeg.length] = pad;
      return new Blob([tail.buffer as ArrayBuffer], { type: 'image/jpeg' });
    };

    const fromFile = await ingestImage({ file: phoneFile(1), kind: 'baseline', title: 'No date typed' });
    expect(fromFile.row.takenOn, 'an empty date field falls back to what the camera wrote').toBe('2026-09-12');

    const blank = await ingestImage({ file: phoneFile(2), kind: 'baseline', title: 'Date blank', takenOn: '  ' });
    expect(blank.row.takenOn, 'a blank is a blank, not a date').toBe('2026-09-12');

    const explicit = await ingestImage({ file: phoneFile(3), kind: 'baseline', title: 'I said when', takenOn: '2024-01-02' });
    expect(explicit.row.takenOn).toBe('2024-01-02');

    const noMetadata = await ingestImage({ file: bytes(21), kind: 'baseline', title: 'Stripped' });
    expect(noMetadata.row.takenOn, 'with nothing to go on, today is recorded as today').toBe(todayISO());
  });
});

describe('perceptual hashing', () => {
  it('hashes a 9x8 luma sample to 16 hex chars, deterministically', () => {
    const increasing = Uint8ClampedArray.from({ length: 72 }, (_v, i) => i % 9);
    const decreasing = Uint8ClampedArray.from({ length: 72 }, (_v, i) => 8 - (i % 9));
    const noisy = Uint8ClampedArray.from({ length: 72 }, (_v, i) => (i * 37) % 251);
    expect(dHashFromGray(increasing)).toBe('0000000000000000');
    expect(dHashFromGray(decreasing)).toBe('ffffffffffffffff');
    expect(dHashFromGray(increasing)).toHaveLength(16);
    expect(dHashFromGray(increasing)).toBe(dHashFromGray(Uint8ClampedArray.from(increasing)));
    expect(dHashFromGray(noisy)).toBe(dHashFromGray(Uint8ClampedArray.from(noisy)));
    expect(dHashFromGray(noisy)).toMatch(/^[0-9a-f]{16}$/);
    // a sample too small to be a 9x8 grid gives no hash rather than a fake one
    expect(dHashFromGray(Uint8ClampedArray.from({ length: 9 }))).toBe('');
  });

  it('counts the differing bits between two signatures', () => {
    const base = dHashFromGray(Uint8ClampedArray.from({ length: 72 }, (_v, i) => (i * 13) % 256));
    const allOn = 'f'.repeat(16);
    const allOff = '0'.repeat(16);
    expect(base).toHaveLength(16);
    expect(hammingDistance(base, base)).toBe(0);
    expect(hammingDistance(allOn, `e${allOn.slice(1)}`)).toBe(1);
    expect(hammingDistance(allOff, allOn)).toBe(64);
    expect(hammingDistance('', base)).toBe(Number.POSITIVE_INFINITY);
    expect(hammingDistance('z'.repeat(16), base)).toBe(Number.POSITIVE_INFINITY);
  });

  it('flattens transparency onto white before hashing', () => {
    const gray = grayFromRgba(new Uint8ClampedArray([0, 0, 0, 0, 255, 0, 0, 255]), 2, 1);
    expect(gray[0]).toBe(255);
    expect(gray[1]).toBeCloseTo(76, 0);
  });

  it('stores a perceptual signature and offers look-alikes on the next shot', async () => {
    const first = await ingestImage({ file: bytes(30), kind: 'progress', title: 'First', takenOn: '2026-05-05' });
    expect(dataOf(first.row).phash).toMatch(/^[0-9a-f]{16}$/);
    expect(first.similar).toBeUndefined();
    const second = await ingestImage({ file: bytes(31), kind: 'progress', title: 'Second' });
    expect(second.duplicate).toBe(false);
    expect(second.similar).toHaveLength(1);
    expect(second.similar?.[0].title).toBe('First');
    expect(second.similar?.[0].takenOn).toBe('2026-05-05');
    expect(second.similar?.[0].distance).toBeLessThanOrEqual(6);
    expect(second.similar?.[0].id).toBe(String(first.row.id));
  });

  it('still stores the image when the 9x8 pixel read is refused', async () => {
    const good = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => ({
      ...ctx2d,
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        if (w === 9) throw new Error('tainted canvas');
        return ctx2d.getImageData(_x, _y, w, h);
      }
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    try {
      const res = await ingestImage({ file: bytes(40), kind: 'progress', title: 'Tainted' });
      expect(res.row.blobId).toBeTruthy();
      expect(dataOf(res.row).phash).toBeUndefined();
      expect(res.similar).toBeUndefined();
      expect(((res.row.data as Record<string, unknown>).palette as string[]).length, 'the 64x64 palette read is a separate call and still happened').toBeGreaterThan(0);
    } finally {
      HTMLCanvasElement.prototype.getContext = good;
    }
  });
});
