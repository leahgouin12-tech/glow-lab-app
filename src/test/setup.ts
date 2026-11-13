import 'fake-indexeddb/auto';
import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Test environment for a local-first app: IndexedDB is real (in-memory),
 * canvas decoding is stubbed, and the browser APIs the media pipeline needs
 * exist without a GPU or a network.
 */

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  root = null;
  rootMargin = '';
  threshold = 0;
  takeRecords() {
    return [];
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = globalThis.ResizeObserver || (ResizeObserverStub as unknown as typeof ResizeObserver);
globalThis.IntersectionObserver = globalThis.IntersectionObserver || (IntersectionObserverStub as unknown as typeof IntersectionObserver);

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}

if (!('canParse' in URL)) {
  Object.defineProperty(URL, 'canParse', { value: (u: string) => { try { return new URL(u); } catch { return null; } } });
}

if (!globalThis.crypto) {
  // @ts-expect-error minimal shim for non-secure test contexts
  globalThis.crypto = {};
}
if (!globalThis.crypto.randomUUID) {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => 'uuid-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
  });
}
if (!globalThis.crypto.subtle) {
  Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
}
if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = () => {};
}

// Older jsdom Blobs predate Blob.prototype.arrayBuffer, which the backup and
// hashing code relies on in browsers.
if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

/**
 * On Node 22+ a bare `localStorage` resolves to Node's own accessor, which is
 * undefined without `--localstorage-file` and shadows the jsdom window one.
 * Only replace it when the real thing is unusable.
 */
function ensureStorage(name: 'localStorage' | 'sessionStorage') {
  try {
    const probe = (globalThis as Record<string, any>)[name];
    if (probe && typeof probe.setItem === 'function') {
      probe.setItem('__probe', '1');
      probe.removeItem('__probe');
      return;
    }
  } catch {
    /* fall through to the in-memory store */
  }
  const map = new Map<string, string>();
  const store = {
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k) as string : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    }
  };
  Object.defineProperty(globalThis, name, { value: store, configurable: true, writable: true });
}

ensureStorage('localStorage');
ensureStorage('sessionStorage');
if (!('AbortSignal' in globalThis) || !(AbortSignal as unknown as { timeout?: unknown }).timeout) {
  AbortSignal.timeout = ((ms: number) => new AbortController().signal) as typeof AbortSignal.timeout;
}

Element.prototype.scrollTo = () => {};
// jsdom has no layout, so its window.scrollTo is a "not implemented" error log.
window.scrollTo = () => {};
HTMLCanvasElement.prototype.getContext = ((() => null) as unknown) as typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  vi.stubGlobal('navigator', { ...navigator, onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
