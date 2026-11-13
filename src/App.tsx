import { Suspense, lazy, useEffect, useState, type ComponentType, type FormEvent } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './nav/Shell';
import Boundary from './ui/Boundary';
import { Skeleton, ToastHost } from './ui/primitives';
import { applyDocumentSettings, departmentEnabled, isEmbeddedFrame, loadSettings, subscribeSettings, updateSettings, type AppSettings } from './state/settings';
import { runSeeding } from './db/seed';
import { LockScreen } from './ui/LockScreen';
import { armLock, lockIsSet, noteVisibility, sessionUnlocked } from './state/lock';
import { DEPARTMENTS } from './nav/departments';
import { buildContext, syncRecommendations } from './engine/recommendations';
import Onboarding from './pages/OnboardingPage';

/**
 * Route table — one lazily loaded module per department, so the first paint
 * stays small on a phone (design command §12: route-level code splitting).
 * Paths mirror nav/departments.ts; the shell owns navigation chrome.
 */
const DEPT_PAGES: Record<string, { path: string; load: () => Promise<{ default: ComponentType }> }> = {
  home: { path: '/home', load: () => import('./pages/HomePage') },
  advisor: { path: '/advisor', load: () => import('./pages/AdvisorPage') },
  looksmaxxing: { path: '/looksmaxxing', load: () => import('./pages/LooksmaxxingPage') },
  face: { path: '/face', load: () => import('./pages/FacePage') },
  evidence: { path: '/evidence', load: () => import('./pages/EvidencePage') },
  hair: { path: '/hair', load: () => import('./pages/HairPage') },
  skin: { path: '/skin', load: () => import('./pages/SkinPage') },
  makeup: { path: '/makeup', load: () => import('./pages/MakeupPage') },
  dental: { path: '/dental', load: () => import('./pages/DentalPage') },
  fragrance: { path: '/fragrance', load: () => import('./pages/FragrancePage') },
  closet: { path: '/closet', load: () => import('./pages/ClosetPage') },
  color: { path: '/color', load: () => import('./pages/ColorPage') },
  market: { path: '/market', load: () => import('./pages/MarketPage') },
  fitness: { path: '/fitness', load: () => import('./pages/FitnessPage') },
  posture: { path: '/posture', load: () => import('./pages/PosturePage') },
  discover: { path: '/discover', load: () => import('./pages/DiscoverPage') },
  inspiration: { path: '/inspiration', load: () => import('./pages/InspirationPage') },
  recreate: { path: '/recreate', load: () => import('./pages/RecreatePage') },
  tryon: { path: '/tryon', load: () => import('./pages/TryOnPage') },
  academy: { path: '/academy', load: () => import('./pages/AcademyPage') },
  knowledge: { path: '/knowledge', load: () => import('./pages/KnowledgePage') },
  experiments: { path: '/experiments', load: () => import('./pages/ExperimentsPage') },
  calendar: { path: '/calendar', load: () => import('./pages/CalendarPage') },
  progress: { path: '/progress', load: () => import('./pages/ProgressPage') },
  services: { path: '/services', load: () => import('./pages/ServicesPage') },
  media: { path: '/media', load: () => import('./pages/MediaPage') },
  profile: { path: '/profile', load: () => import('./pages/ProfilePage') },
  search: { path: '/search', load: () => import('./pages/SearchPage') },
  settings: { path: '/settings', load: () => import('./pages/SettingsPage') },
  // Deliberately absent from nav/departments.ts: an acceptance tool, not a department.
  contact: { path: '/contact-sheet', load: () => import('./pages/ContactSheetPage') }
};

const LAZY = Object.fromEntries(
  Object.entries(DEPT_PAGES).map(([id, v]) => [id, lazy(v.load as () => Promise<{ default: ComponentType<Record<string, never>> }>)] as const)
);

function Fallback() {
  return (
    <div className="gl-page gl-stack">
      <Skeleton h={128} />
      <Skeleton h={220} />
      <div className="gl-grid gl-grid--3">
        <Skeleton h={140} />
        <Skeleton h={140} />
        <Skeleton h={140} />
      </div>
    </div>
  );
}

function MissingRoute() {
  return (
    <div className="gl-page">
      <div className="gl-empty">
        <h3>No department at that address</h3>
        <p className="gl-muted">Use the sidebar, the ⌘K search palette, or the Departments menu on mobile.</p>
        <a className="gl-btn gl-btn--primary" href="#/home">
          Back to Home
        </a>
      </div>
    </div>
  );
}

/**
 * A department she switched off. It is not missing and nothing was deleted —
 * it is one of the two, and saying which is the whole point: the refusal names
 * the switch and where to find it.
 */
function DepartmentOff({ id }: { id: string }) {
  const d = DEPARTMENTS.find((x) => x.id === id);
  return (
    <div className="gl-page">
      <div className="gl-empty">
        <h3>{d?.title ?? 'That department'} is switched off</h3>
        <p className="gl-muted">
          It is not in your list of enabled departments, so its screens stay closed. Nothing was deleted: every record you
          made there is still on this device. Turn it back on in Settings → Departments.
        </p>
        <div className="gl-row gl-row--tight">
          <a className="gl-btn gl-btn--primary" href="#/settings?tab=departments">
            Settings → Departments
          </a>
          <a className="gl-btn" href="#/home">
            Back to Home
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * `requireAppLock` is on and no passcode is armed on this device — the state the
 * setup tour used to leave behind. A gate that accepted any typing would be a
 * protection that is not one, so this screen makes the missing passcode real
 * before anything else renders. Nothing behind it mounts.
 */
function PasscodeSetup({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const r = await armLock(code);
    setBusy(false);
    if (!r.ok) {
      setProblem(r.detail);
      return;
    }
    await updateSettings({ requireAppLock: true });
    onDone();
  };

  return (
    <div className="gl-boot" role="region" aria-label="Set a passcode">
      <div className="gl-boot__mark" aria-hidden="true">
        GL
      </div>
      <p className="gl-eyebrow">Your setup asked for a device lock</p>
      <form onSubmit={(e) => void submit(e)} className="gl-stack" style={{ gap: 10, width: 'min(320px, 84vw)' }}>
        <label className="gl-field__label" htmlFor="glow-lock-code">
          Choose a passcode
        </label>
        <input
          id="glow-lock-code"
          className="gl-input"
          type="password"
          autoComplete="off"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setProblem('');
          }}
          autoFocus
        />
        <button className="gl-btn gl-btn--primary" type="submit" disabled={!code || busy}>
          {busy ? 'Setting it…' : 'Set passcode and open'}
        </button>
        <p className="gl-small gl-muted" role="status">
          {problem ||
            'The lab stays closed until this exists. The passcode is kept in this browser profile only — never in a backup, never synced, and not recoverable for you.'}
        </p>
      </form>
    </div>
  );
}

/** `verify` — a passcode exists and this session has not entered it. `arm` — the
 *  app promises a lock this device does not have yet, so one is demanded now. */
type Gate = 'none' | 'verify' | 'arm';

export default function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [gate, setGate] = useState<Gate>(() => (lockIsSet() && !sessionUnlocked() ? 'verify' : 'none'));

  useEffect(() => {
    let live = true;
    (async () => {
      const s = await loadSettings();
      applyDocumentSettings(s);
      // Contact-sheet panes are read-only copies: the first document owns seeding
      // and recommendation writes, so three frames never race over one database.
      const embedded = isEmbeddedFrame();
      if (!embedded) {
        try {
          await runSeeding();
        } catch (e) {
          console.warn('Seeding skipped — the app still opens.', e);
        }
      }
      const after = await loadSettings();
      if (!live) return;
      setSettings(after);
      setReady(true);
      if (!embedded) {
        try {
          await syncRecommendations(await buildContext());
        } catch {
          /* recommendations are an enhancement, never a load dependency */
        }
      }
    })();
    return subscribeSettings((s) => {
      applyDocumentSettings(s);
      setSettings(s);
    });
  }, []);

  // Settings → Sync cadence is a live timer: while sync is armed the queue drains on
  // that interval, and changing or disarming it re-arms without a reload.
  useEffect(() => {
    if (!settings?.syncEnabled || !settings.syncEndpoint) return;
    const ms = Math.max(1, settings.syncIntervalMin) * 60000;
    const id = window.setInterval(() => {
      void import('./db/backup')
        .then((m) => m.flushSyncQueue())
        .catch(() => {
          /* a failed flush leaves the queue intact for the next tick */
        });
    }, ms);
    return () => window.clearInterval(id);
  }, [settings?.syncEnabled, settings?.syncEndpoint, settings?.syncIntervalMin]);

  // Pinterest, once per app open. The app only reads an archive this device is
  // already serving — no Pinterest call, no token, no server. With nothing to
  // read it reports "empty" and the feed simply stays as the last import left it.
  useEffect(() => {
    if (!ready || !settings?.pinterestAutoSync) return;
    void import('./providers/pinterestSync')
      .then((m) => m.syncPinterestArchive())
      .catch(() => {
        /* an unreadable archive changes nothing */
      });
  }, [ready, settings?.pinterestAutoSync]);

  // Re-lock when the tab comes back after being left. Three minutes is long
  // enough not to punish an alt-tab, short enough that a shared screen is not
  // still showing your photographs. Keyed off the passcode record rather than
  // the switch: `noteVisibility` only ever answers true when a lock is armed,
  // so an armed passcode re-locks even if the settings row drifted off it.
  useEffect(() => {
    const onVisibility = () => {
      if (noteVisibility(document.hidden, 3)) setGate('verify');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  /**
   * The switch is a promise about a passcode, so the two are checked against
   * each other on every settings read: `requireAppLock` with nothing armed opens
   * the lab on a "choose your passcode" gate instead of pretending it is closed.
   */
  useEffect(() => {
    if (!settings) return;
    if (!lockIsSet() && settings.requireAppLock) setGate('arm');
    else if (lockIsSet() && !sessionUnlocked()) setGate('verify');
  }, [settings]);

  // Follow the system preference only when it actually changes. Reading it on every
  // settings change would undo the switch in Settings → Appearance the moment it is used.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => void updateSettings({ reducedMotion: mq.matches });
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  if (gate === 'verify') return <LockScreen onOpen={() => setGate('none')} />;
  if (gate === 'arm') return <PasscodeSetup onDone={() => setGate('none')} />;

  if (!ready || !settings) {
    return (
      <div className="gl-boot">
        <div className="gl-boot__mark" aria-hidden="true">
          GL
        </div>
        <p className="gl-eyebrow">Opening your lab…</p>
      </div>
    );
  }

  if (!settings.onboardingDone) {
    return (
      <Boundary>
        <ToastHost>
          <Onboarding />
        </ToastHost>
      </Boundary>
    );
  }

  return (
    <Boundary>
      <ToastHost>
        <HashRouter>
          <Suspense fallback={<Fallback />}>
            <Routes>
              <Route element={<Shell />}>
                {Object.entries(DEPT_PAGES).map(([id, d]) => {
                  const Page = LAZY[id];
                  /* Only real departments are gated. `/contact-sheet` is an
                     acceptance tool and is not in the list she narrows. The
                     rule is `departmentEnabled`, the same one the rail uses. */
                  const off = DEPARTMENTS.some((x) => x.id === id) && !departmentEnabled(id, settings.enabledDepartments);
                  return <Route key={id} path={d.path} element={off ? <DepartmentOff id={id} /> : <Page />} />;
                })}
                <Route path="/" element={<Navigate to="/home" replace />} />
                <Route path="*" element={<MissingRoute />} />
              </Route>
            </Routes>
          </Suspense>
        </HashRouter>
      </ToastHost>
    </Boundary>
  );
}
