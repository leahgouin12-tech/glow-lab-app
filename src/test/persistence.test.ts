import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askToKeepStorage, persistStatus, requestPersistentStorage } from '../state/persistence';

/**
 * The point of these tests is that the app asks, records the honest answer, and
 * never pretends a grant it did not get. A storage promise iOS refused is the
 * difference between "your closet survives a week without opening" and a claim
 * that reads the same but is not true.
 *
 * `navigator` is read at call time rather than captured at module scope: vitest
 * installs the jsdom window after this file is evaluated, so a reference taken
 * at import time is a different object than the one the module will see.
 */

const nav = () => globalThis.navigator as { storage?: unknown };

function setStorage(value: unknown) {
  Object.defineProperty(nav(), 'storage', { value, configurable: true, writable: true });
}

/** persist() is a promise; settle it without guessing how many ticks it takes. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  delete document.documentElement.dataset.storagePersist;
});

afterEach(() => {
  delete nav().storage;
});

describe('requestPersistentStorage', () => {
  it('reports unsupported when the browser has no persist()', async () => {
    setStorage({});
    expect(await requestPersistentStorage()).toBe('unsupported');
    expect(document.documentElement.dataset.storagePersist).toBe('unsupported');
  });

  it('reports unsupported when navigator.storage is absent entirely', async () => {
    setStorage(undefined);
    expect(await requestPersistentStorage()).toBe('unsupported');
  });

  it('records a grant', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    setStorage({ persist });
    expect(await requestPersistentStorage()).toBe('granted');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persistStatus()).toBe('granted');
    expect(document.documentElement.dataset.storagePersist).toBe('granted');
  });

  it('records a refusal as a refusal, not as silence', async () => {
    setStorage({ persist: vi.fn().mockResolvedValue(false) });
    expect(await requestPersistentStorage()).toBe('denied');
    expect(document.documentElement.dataset.storagePersist).toBe('denied');
  });

  it('survives a browser that rejects the request', async () => {
    setStorage({ persist: vi.fn().mockRejectedValue(new Error('NotAllowedError')) });
    await expect(requestPersistentStorage()).resolves.toBe('denied');
  });
});

describe('askToKeepStorage', () => {
  it('asks at boot and again on the first tap only because the first ask failed', async () => {
    const persist = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    setStorage({ persist });

    askToKeepStorage();
    await settle();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persistStatus()).toBe('denied');

    window.dispatchEvent(new Event('pointerdown'));
    await settle();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persistStatus()).toBe('granted');

    /* one gesture, one retry — a listener that kept asking would be a leak */
    window.dispatchEvent(new Event('pointerdown'));
    await settle();
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('does not ask again when the boot request was granted', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    setStorage({ persist });
    askToKeepStorage();
    await settle();
    window.dispatchEvent(new Event('pointerdown'));
    await settle();
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
