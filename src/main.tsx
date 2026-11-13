import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles/base.css';
import App from './App';
import { askToKeepStorage } from './state/persistence';

/**
 * Boot order: mount first, then let App load settings, seed and open the lab.
 * The service worker registers without blocking, and an available update is
 * applied on the next visit rather than interrupting a session.
 */

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);

/* iOS will discard a website's IndexedDB after a week without a visit. The app
   is a record of photographs, so it asks not to be treated as a cache — see
   state/persistence.ts for why the answer is not guaranteed. */
askToKeepStorage();

try {
  registerSW({
    immediate: true,
    onOfflineReady() {
      document.documentElement.dataset.offlineReady = 'true';
    },
    onNeedRefresh() {
      window.setTimeout(() => {
        if (document.hasFocus()) window.location.reload();
      }, 400);
    }
  });
} catch {
  /* offline capability degrades gracefully when the SW is unavailable */
}
