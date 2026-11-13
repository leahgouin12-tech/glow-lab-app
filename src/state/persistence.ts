/**
 * Asking iOS (and Chrome) not to throw the library away.
 *
 * WebKit treats a website's IndexedDB as disposable cache: after roughly seven
 * days without a visit, or once the device is short on space, it can evict it
 * while the app is closed. For a closet of photographs that is not a slow
 * degradation, it is the loss of the record. `navigator.storage.persist()` is
 * the documented opt-out — Safari 17+ honours it, and it is the single reason
 * the Home Screen install is worth recommending at all.
 *
 * It is a request, not a grant: the browser may answer false, and Chrome only
 * answers at all when the call follows a user gesture or the site is visited
 * often. So this asks at boot, asks again on the first interaction, and reports
 * which of the three outcomes actually happened.
 */

export type PersistStatus = 'granted' | 'denied' | 'unsupported' | 'not-yet-asked';

let last: PersistStatus = 'not-yet-asked';

export function persistStatus() {
  return last;
}

export async function requestPersistentStorage(): Promise<PersistStatus> {
  const store = globalThis.navigator?.storage as { persist?: () => Promise<boolean> } | undefined;
  if (!store || typeof store.persist !== 'function') {
    last = 'unsupported';
  } else {
    try {
      last = (await store.persist()) ? 'granted' : 'denied';
    } catch {
      /* A rejected promise here means the browser refused to answer, which for
         the user is the same as a no — and a boot that throws over it is worse
         than a storage quota that stays evictable. */
      last = 'denied';
    }
  }
  document.documentElement.dataset.storagePersist = last;
  return last;
}

/** Boot ask plus one gesture ask; after that the answer will not change. */
export function askToKeepStorage() {
  void requestPersistentStorage();
  window.addEventListener(
    'pointerdown',
    () => {
      if (persistStatus() !== 'granted') void requestPersistentStorage();
    },
    { once: true, passive: true }
  );
}
