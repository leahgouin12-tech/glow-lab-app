import { describe, expect, it } from 'vitest';
import {
  L_BOUNDS,
  UNDERTONES,
  TONE_BANDS,
  describeRead,
  readTone,
  sampleToRgb
} from '../engine/photoTone';

/**
 * The engine is pure arithmetic, which means every one of these is a case with
 * a known right answer — no browser, no model, no fixture image to babysit.
 */

const swatch = (r: number, g: number, b: number, n = 240) =>
  Array.from({ length: n }, () => ({ r, g, b }));

const band = (r: number, g: number, b: number, n?: number) => readTone(swatch(r, g, b, n))?.skinTone.value;
const tone = (r: number, g: number, b: number, n?: number) => readTone(swatch(r, g, b, n))?.undertone.value;

describe('reading a tone off pixels the user framed', () => {
  it('walks the lightness scale from a bright crop to a dark one', () => {
    expect(band(228, 204, 186)).toBe('fair');
    expect(band(214, 180, 146)).toBe('light');
    expect(band(190, 150, 120)).toBe('medium');
    expect(band(160, 112, 70)).toBe('tan');
    expect(band(124, 84, 56)).toBe('deep');
    expect(band(74, 48, 36)).toBe('very deep');
  });

  it('separates a pinkish cast from a golden one and both from an olive one', () => {
    expect(tone(74, 48, 36)).toBe('cool');
    expect(tone(228, 204, 186)).toBe('neutral');
    expect(tone(214, 180, 146)).toBe('warm');
    expect(tone(196, 186, 158)).toBe('olive');
  });

  it('says unsure rather than inventing an undertone from a grey crop', () => {
    const read = readTone(swatch(200, 200, 200))!;
    expect(read.undertone.value).toBe('unsure');
    expect(read.undertone.confidence).toBeLessThan(0.25);
    expect(read.notes.join(' ')).toContain('too low');
    // lightness is still a real answer, so it is not thrown away with the hue
    expect(TONE_BANDS).toContain(read.skinTone.value);
  });

  it('refuses to answer when there is nothing to read', () => {
    expect(readTone([])).toBeNull();
    expect(band(214, 180, 146, 10)).toBeUndefined(); // under the pixel floor
    expect(band(214, 180, 146, 23)).toBeUndefined(); // 23 is one short of the floor
    expect(band(214, 180, 146, 24)).not.toBeUndefined(); // and 24 clears it
    expect(readTone(swatch(0, 0, 0))).toBeNull(); // a black crop is a framing mistake
    expect(readTone(swatch(252, 252, 252))).toBeNull(); // a blown-out one holds no tone
  });

  it('is less sure when the lightness lands on a band line than inside a band', () => {
    const straddle = readTone(swatch(214, 180, 146))!; // L* 75.5 against the 71/78 line
    const inside = readTone(swatch(228, 204, 186))!; // L* 83.6, well inside fair
    expect(straddle.skinTone.confidence).toBeLessThan(inside.skinTone.confidence);
    for (const read of [straddle, inside]) {
      expect(read.skinTone.confidence).toBeGreaterThan(0);
      expect(read.skinTone.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('prints the arithmetic the sentence is built from', () => {
    const read = readTone(swatch(190, 150, 120))!;
    expect(read.figures.L).toBeGreaterThan(61);
    expect(read.figures.chroma).toBeGreaterThan(10);
    expect(describeRead(read)).toContain(`${read.pixels} pixels`);
    expect(describeRead(read)).toMatch(/lightness L\* \d/);
    expect(describeRead(read)).toMatch(/hue -?\d/);
  });

  it('warns when one crop is too small or too unevenly lit to trust', () => {
    const thin = readTone(swatch(200, 160, 120, 60))!;
    expect(thin.notes.join(' ')).toContain('small crop');
    const patchy = readTone([...swatch(230, 210, 190, 120), ...swatch(70, 45, 32, 120)])!;
    expect(patchy.notes.join(' ')).toContain('unevenly lit');
    // and it still lands between the extremes rather than inventing a new one
    expect(TONE_BANDS).toContain(patchy.skinTone.value);
  });

  it('names every band it can choose from, and only those', () => {
    for (let r = 30; r <= 250; r += 22) {
      for (const g of [40, 120, 200]) {
        const read = readTone(swatch(r, g, Math.max(20, g - 40)));
        if (!read) continue;
        expect(TONE_BANDS).toContain(read.skinTone.value);
        expect(UNDERTONES).toContain(read.undertone.value);
      }
    }
  });
});

describe('turning pixels into a sample', () => {
  it('drops what is fully transparent and keeps what is not', () => {
    const buf = new Uint8ClampedArray([10, 20, 30, 0, 200, 150, 110, 255, 90, 60, 40, 255]);
    const out = sampleToRgb(buf, 1);
    expect(out.length).toBe(2);
    expect(out[0]).toEqual({ r: 200, g: 150, b: 110 });
  });

  it('steps by whole pixels, so a stride of 4 reads every fourth pixel', () => {
    const buf = new Uint8ClampedArray(4 * 8).fill(200);
    expect(sampleToRgb(buf, 4).length).toBe(2);
  });

  it('returns nothing for an empty or missing buffer instead of throwing', () => {
    expect(sampleToRgb(null)).toEqual([]);
    expect(sampleToRgb(new Uint8ClampedArray(2))).toEqual([]);
  });

  it('has the same six bands the profile form offers, in the same order', () => {
    expect(L_BOUNDS.map((b) => b.band)).toEqual(TONE_BANDS);
    expect(UNDERTONES).toEqual(['cool', 'neutral', 'warm', 'olive', 'unsure']);
  });
});
