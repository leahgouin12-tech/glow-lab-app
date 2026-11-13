import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { isLegacyFnvHash, legacyFnv1aHex, sha256Bytes, sha256Hex, sha256HexBytes, sha256HexJs } from '../engine/sha256';

/**
 * The JS path has to be SHA-256, not a hash that looks like one. A lock record
 * made in a secure context is verified in a non-secure one and the other way
 * round, so the two implementations must agree byte for byte, forever.
 */

const hexOf = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

async function reference(text: string): Promise<string> {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return hexOf(new Uint8Array(digest));
}

async function withoutSubtle<T>(run: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');
  Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
  try {
    return await run();
  } finally {
    if (descriptor) Object.defineProperty(globalThis.crypto, 'subtle', descriptor);
    else delete (globalThis.crypto as { subtle?: unknown }).subtle;
  }
}

describe('the JS SHA-256 path', () => {
  it('matches the published FIPS vectors', () => {
    expect(sha256HexJs('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256HexJs('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256HexJs('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    );
  });

  it('agrees with WebCrypto across every padding boundary', async () => {
    /* 0..70 crosses the 55/56-byte cliff where the message grows a second
       block; 63/64/65 crosses it again inside a full block */
    for (let n = 0; n <= 70; n += 1) {
      const text = 'x'.repeat(n);
      expect(sha256HexJs(text), `length ${n}`).toBe(await reference(text));
    }
    for (const n of [119, 120, 127, 128, 129, 200, 1000, 65535, 65536, 65537]) {
      const text = 'glow'.repeat(Math.ceil(n / 4)).slice(0, n);
      expect(sha256HexJs(text), `length ${n}`).toBe(await reference(text));
    }
  });

  it('hashes the UTF-8 bytes of what she typed, not the code units', async () => {
    for (const text of ['pâle', '🌙 night ritual', '水光', 'a\nb\rc', '   ', '0']) {
      expect(sha256HexJs(text)).toBe(await reference(text));
    }
  });

  it('digests bytes directly for an encoded photograph', async () => {
    const bytes = new Uint8Array(500).map((_, i) => (i * 37) % 256);
    expect(hexOf(sha256Bytes(bytes))).toBe(hexOf(new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes))));
    const empty = new Uint8Array(0);
    expect(hexOf(sha256Bytes(empty))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('never hands WebCrypto the buffer it is asked to keep', async () => {
    const bytes = new TextEncoder().encode('the same bytes twice');
    const first = await sha256HexBytes(bytes);
    const second = await sha256HexBytes(bytes);
    expect(first).toBe(second);
    expect(bytes.length).toBe(20);
  });
});

describe('which path runs', () => {
  it('gives the same answer with SubtleCrypto present or absent', async () => {
    const withSubtle = await sha256Hex('correct horse battery staple');
    const without = await withoutSubtle(() => sha256Hex('correct horse battery staple'));
    expect(without).toBe(withSubtle);
    expect(without).toBe(await reference('correct horse battery staple'));
  });

  it('still produces a hex digest when SubtleCrypto throws', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');
    Object.defineProperty(globalThis.crypto, 'subtle', {
      value: { digest: () => Promise.reject(new Error('blocked by the browser')) },
      configurable: true
    });
    try {
      expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    } finally {
      if (descriptor) Object.defineProperty(globalThis.crypto, 'subtle', descriptor);
    }
  });

  it('returns exactly 64 lowercase hex characters whatever the input', async () => {
    for (const text of ['', 'x', 'the quick brown fox jumps over the lazy dog', '🌙'.repeat(40)]) {
      const hex = await sha256Hex(text);
      expect(hex).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('the FNV-1a records the app used to write', () => {
  it('is stable, so an old lock record can still be recognised', () => {
    /* pinned, not re-derived: these are the values sitting in localStorage on
       libraries that armed the lock before SHA-256 became the only path */
    expect(legacyFnv1aHex('')).toBe('fnv811c9dc5');
    expect(legacyFnv1aHex('abc')).toBe('fnv1a47e90b');
    expect(legacyFnv1aHex('salt:code:0')).toBe('fnv912a0852');
    expect(legacyFnv1aHex('hunter2')).not.toBe(legacyFnv1aHex('hunter3'));
  });

  it('is flagged as legacy and a SHA-256 digest is not', async () => {
    expect(isLegacyFnvHash(legacyFnv1aHex('hunter2'))).toBe(true);
    expect(isLegacyFnvHash(await sha256Hex('hunter2'))).toBe(false);
  });
});
