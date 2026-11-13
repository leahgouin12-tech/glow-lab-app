/**
 * A 9x8 grayscale difference hash — the industry "dHash" — used only to notice
 * that two files look near-identical to a human. It is a rough fingerprint, not
 * an identification: it can never say two photos ARE the same, only that their
 * brightness gradients are close.
 *
 * Pure arithmetic on a Uint8ClampedArray, no canvas, no dependencies, nothing
 * that can phone home.
 */

export const DHASH_WIDTH = 9;
export const DHASH_HEIGHT = 8;

/**
 * Row-major luma of a `width` x `height` sample (default 9x8). Each pixel is
 * compared with its right neighbour, so the signature survives a uniform
 * brightness or contrast change — which is exactly why a re-export of the same
 * selfie lands near the original instead of a thousand miles from it.
 */
export function dHashFromGray(gray: Uint8ClampedArray, width = DHASH_WIDTH, height = DHASH_HEIGHT): string {
  if (!Number.isInteger(width) || width < 2 || !Number.isInteger(height) || height < 1) return '';
  if (gray.length < width * height) return '';
  let bits = '';
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width - 1; x += 1) {
      bits += gray[row + x] > gray[row + x + 1] ? '1' : '0';
    }
  }
  while (bits.length % 4 !== 0) bits += '0';
  let out = '';
  for (let i = 0; i < bits.length; i += 4) {
    out += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return out;
}

/** RGBA pixels (as getImageData returns them) down to row-major luma. */
export function grayFromRgba(rgba: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0; i < out.length; i += 1) {
    const o = i * 4;
    const alpha = o + 3 < rgba.length ? rgba[o + 3] / 255 : 1;
    const luma = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
    // Transparent areas flatten onto white, the same as a browser compositing it.
    out[i] = Math.round(luma * alpha + 255 * (1 - alpha));
  }
  return out;
}

/**
 * Count of differing bits between two hex signatures. Hashes that are missing
 * or malformed are reported as infinitely far apart so a caller's "close
 * enough" test can never accidentally match on garbage; a shorter signature is
 * read as zero-padded.
 */
export function hammingDistance(a: string, b: string): number {
  const x = (a || '').toLowerCase();
  const y = (b || '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(x) || !/^[0-9a-f]+$/.test(y)) return Number.POSITIVE_INFINITY;
  const len = Math.max(x.length, y.length);
  const px = x.padEnd(len, '0');
  const py = y.padEnd(len, '0');
  let d = 0;
  for (let i = 0; i < len; i += 1) {
    d += popcount4(parseInt(px[i], 16) ^ parseInt(py[i], 16));
  }
  return d;
}

function popcount4(n: number): number {
  let v = n & 0xf;
  let c = 0;
  while (v) {
    c += v & 1;
    v >>= 1;
  }
  return c;
}
