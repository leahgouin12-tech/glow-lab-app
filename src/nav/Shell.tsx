import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Grip,
  PanelLeftClose,
  PanelLeftOpen,
  Search as SearchIcon,
  Sparkles,
  WifiOff,
  X
} from 'lucide-react';
import { DEPARTMENTS, MOBILE_PRIMARY, NAV_GROUPS, dept, departmentsInGroup } from './departments';
import Boundary from '../ui/Boundary';
import { departmentEnabled, subscribeSettings, updateSettings, type AppSettings } from '../state/settings';
import { THEME_OPTIONS } from '../state/themes';
import { globalSearch, type SearchOutcome } from '../search/globalSearch';
import { useDebounced } from '../ui/primitives';
import { loadSettings } from '../state/settings';
import { findAll, todayISO } from '../db/repo';
import { TABLES } from '../db/schema';
import { useRows } from '../hooks/live';

/**
 * Application shell — expandable desktop rail, topbar with real breadcrumbs
 * and global search, refined mobile bottom navigation with a department menu.
 * Collapsed state, theme and last-visited departments persist.
 */

const RAIL_KEY = 'glow-lab:rail-collapsed';
const RECENT_KEY = 'glow-lab:recent-depts';
const CLOSED_GROUPS_KEY = 'glow-lab:closed-groups';

function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function readClosedGroups(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CLOSED_GROUPS_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function Shell() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(RAIL_KEY) === '1');
  const [closedGroups, setClosedGroups] = useState<string[]>(readClosedGroups);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const location = useLocation();
  const navigate = useNavigate();
  const active = useMemo(() => DEPARTMENTS.find((d) => location.pathname.startsWith(d.path)) ?? DEPARTMENTS[0], [location.pathname]);
  /* The enabled list is a keep-list, not a pin set: a department left out drops
     out of the rail and out of the mobile grid, and App.tsx refuses its address
     too. An empty list means she has not narrowed anything. `departmentEnabled`
     is the same rule the route table uses, so the two cannot disagree. */
  const enabled = useMemo(() => settings?.enabledDepartments ?? [], [settings]);
  const keep = (id: string) => departmentEnabled(id, enabled);
  const inGroup = (g: string) => [...departmentsInGroup(g)].filter((d) => keep(d.id));
  /* A bottom tab or a notification bell pointing at a department she switched
     off would be a dead control, so the chrome follows the same keep-list. */
  const primaryTabs = useMemo(() => DEPARTMENTS.filter((d) => MOBILE_PRIMARY.includes(d.id) && keep(d.id)), [enabled]);
  const recs = useRows(TABLES.recommendations, { where: { status: 'new' } });

  useEffect(() => {
    loadSettings().then(setSettings);
    return subscribeSettings(setSettings);
  }, []);

  useEffect(() => {
    localStorage.setItem(RAIL_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    const recent = readRecent().filter((id) => id !== active.id);
    localStorage.setItem(RECENT_KEY, JSON.stringify([active.id, ...recent].slice(0, 6)));
  }, [active.id]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        setMoreOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: settings?.reducedMotion ? 'auto' : 'smooth' });
    document.title = `${active.title} · THE GLOW LAB`;
  }, [location.pathname, settings?.reducedMotion, active.title]);

  const personal = useRows(TABLES.profile, { where: { kind: 'personal' } });
  const displayName = String(personal[0]?.data?.name ?? '').trim();

  const nextTheme = () => {
    if (!settings) return;
    const i = THEME_OPTIONS.findIndex((t) => t.id === settings.theme);
    const next = THEME_OPTIONS[(i + 1) % THEME_OPTIONS.length];
    void updateSettings({ theme: next.id });
  };

  return (
    <div className="gl-shell" data-collapsed={collapsed ? 'true' : 'false'}>
      <a className="gl-skip" href="#glow-main">
        Skip to content
      </a>
      <nav className="gl-rail" aria-label="Departments">
        <Link to="/home" className="gl-rail__brand">
          <span className="gl-rail__mark" aria-hidden="true">
            GL
          </span>
          <span className="gl-rail__word">
            THE GLOW LAB
            <em>{settings?.theme === 'editorial' ? 'editorial' : 'private studio'}</em>
          </span>
        </Link>

        <div className="gl-rail__scroll">
          {NAV_GROUPS.map((group) => {
            const items = inGroup(group);
            if (!items.length) return null;
            const open = collapsed || !closedGroups.includes(group);
            return (
              <div className="gl-rail__group" key={group} data-open={open ? 'true' : 'false'}>
                <button
                  type="button"
                  className="gl-rail__grouphead"
                  aria-expanded={open}
                  onClick={() =>
                    setClosedGroups((cur) => {
                      const next = cur.includes(group) ? cur.filter((g) => g !== group) : [...cur, group];
                      localStorage.setItem(CLOSED_GROUPS_KEY, JSON.stringify(next));
                      return next;
                    })
                  }
                >
                  <span>{group}</span>
                  {!collapsed ? <ChevronDown size={13} aria-hidden="true" /> : null}
                </button>
                {open
                  ? items.map((d) => {
                      const Icon = d.icon;
                      return (
                        <NavLink key={d.id} to={d.path} className="gl-rail__link" data-active={d.id === active.id ? 'true' : undefined}>
                          <Icon size={17} aria-hidden="true" />
                          <span>{d.short ?? d.title}</span>
                          {d.id === 'advisor' && recs.length ? <b className="gl-rail__badge">{recs.length}</b> : null}
                        </NavLink>
                      );
                    })
                  : null}
              </div>
            );
          })}
        </div>

        <div className="gl-rail__foot">
          <button className="gl-rail__link" onClick={() => setPaletteOpen(true)} aria-label="Open global search">
            <SearchIcon size={17} />
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>
          <NavLink to="/settings" className="gl-rail__link" data-active={active.id === 'settings' ? 'true' : undefined}>
            <Sparkles size={17} />
            <span>{settings ? THEME_OPTIONS.find((t) => t.id === settings.theme)?.name ?? '' : '…'}</span>
          </NavLink>
          <button className="gl-rail__link" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            <span>{collapsed ? 'Expand' : 'Collapse'}</span>
          </button>
          {keep('profile') ? (
            <NavLink to="/profile" className="gl-rail__link" data-active={active.id === 'profile' ? 'true' : undefined}>
              <CircleDot size={17} />
              <span>Profile</span>
            </NavLink>
          ) : null}
        </div>
      </nav>

      <div className="gl-main">
        <header className="gl-topbar">
          <div className="gl-topbar__crumbs" aria-label="Breadcrumb">
            <span className="gl-topbar__crumbpath">
              <Link to="/home">THE GLOW LAB</Link>
              <ChevronRight size={13} aria-hidden="true" />
              <span>{active.group}</span>
              <ChevronRight size={13} aria-hidden="true" />
            </span>
            <b>{active.title}</b>
          </div>

          <div className="gl-row gl-row--tight">
            {!online ? (
              <span className="gl-chip gl-chip--offline" title="Offline — everything still works and changes queue locally.">
                <WifiOff size={13} /> Offline
              </span>
            ) : null}
            <button className="gl-searchbox" onClick={() => setPaletteOpen(true)} aria-label="Search everything">
              <SearchIcon size={15} />
              <span>Search goals, products, looks, notes…</span>
              <kbd>⌘K</kbd>
            </button>
            <button className="gl-icon-btn" onClick={nextTheme} title="Switch appearance theme">
              <Sparkles size={17} />
              <span className="sr-only">Switch theme</span>
            </button>
            {keep('advisor') ? (
              <Link to="/advisor" className="gl-icon-btn" title={`${recs.length} new recommendation(s)`} data-alert={recs.length ? 'true' : undefined}>
                <Bell size={17} />
                {recs.length ? <span className="gl-icon-btn__dot">{recs.length}</span> : null}
              </Link>
            ) : null}
            {keep('profile') ? (
              <Link to="/profile" className="gl-avatar" aria-label="Personal profile" title={displayName || 'Set your name in Profile'}>
                {displayName ? displayName.slice(0, 1).toUpperCase() : 'GL'}
              </Link>
            ) : null}
          </div>
        </header>

        <main className="gl-content" id="glow-main" key={active.id}>
          <Boundary>
            <Outlet />
          </Boundary>
        </main>

        <nav className="gl-tabbar" aria-label="Primary">
          {primaryTabs.map((d) => {
            const Icon = d.icon;
            return (
              <NavLink key={d.id} to={d.path} className="gl-tabbar__item" data-active={d.id === active.id ? 'true' : undefined}>
                <Icon size={19} />
                <span>{d.short ?? d.title}</span>
              </NavLink>
            );
          })}
          <button className="gl-tabbar__item" onClick={() => setMoreOpen(true)} aria-label="All departments" data-active={!primaryTabs.some((d) => d.id === active.id) ? 'true' : undefined}>
            <Grip size={19} />
            <span>More</span>
          </button>
        </nav>
      </div>

      {paletteOpen ? <CommandPalette onClose={() => setPaletteOpen(false)} onGo={(p) => { setPaletteOpen(false); navigate(p); }} /> : null}

      {moreOpen ? (
        <div className="gl-overlay" onClick={() => setMoreOpen(false)}>
          <div className="gl-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="All departments">
            <div className="gl-sheet__head">
              <h3>Every department</h3>
              <button className="gl-icon-btn" onClick={() => setMoreOpen(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="gl-sheet__body">
              {NAV_GROUPS.map((g) => {
                const items = inGroup(g);
                if (!items.length) return null;
                return (
                  <div key={g} style={{ marginBottom: 'var(--glow-sp-5)' }}>
                    <div className="gl-eyebrow">{g}</div>
                    <div className="gl-deptgrid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 'var(--glow-sp-2)' }}>
                      {items.map((d) => {
                        const Icon = d.icon;
                        return (
                          <Link key={d.id} to={d.path} onClick={() => setMoreOpen(false)}>
                            <Icon size={17} />
                            <span>
                              <b>{d.short ?? d.title}</b>
                              <em>{d.deck.slice(0, 46)}…</em>
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Command palette: one query across every stored record, plus route hints. */
function CommandPalette({ onClose, onGo }: { onClose: () => void; onGo: (path: string) => void }) {
  const [q, setQ] = useState('');
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounced = useDebounced(q, 180);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    let live = true;
    if (!debounced.trim()) {
      setOutcome(null);
      return;
    }
    setBusy(true);
    globalSearch(debounced, 24)
      .then((o) => live && setOutcome(o))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [debounced]);

  const rows = useMemo(() => {
    if (!outcome) return [];
    const routes = outcome.routes.map((r) => ({ kind: 'route' as const, path: r.path, title: r.label, sub: 'Department' }));
    const hits = outcome.hits.map((h) => ({ kind: 'hit' as const, path: h.path, title: h.title, sub: `${h.kindLabel} · ${h.subtitle}` }));
    return [...routes, ...hits];
  }, [outcome]);

  useEffect(() => setIndex(0), [debounced]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(rows.length - 1, i + 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    }
    if (e.key === 'Enter' && rows[index]) onGo(rows[index].path);
  };

  return (
    <div className="gl-overlay gl-overlay--top" onClick={onClose}>
      <div className="gl-palette" onClick={(e) => e.stopPropagation()} role="searchdialog" aria-label="Global search">
        <input
          ref={inputRef}
          className="gl-palette__input"
          placeholder="Search records, departments, techniques, products…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          aria-describedby="glow-palette-status"
        />
        <div className="gl-palette__status" id="glow-palette-status">
          {busy ? 'Searching…' : outcome ? `${rows.length} result(s) across ${outcome.searchedTables} tables in ${outcome.tookMs}ms` : 'Type at least two characters.'}
        </div>
        <div className="gl-palette__list">
          {rows.map((r, i) => (
            <button key={`${r.path}-${i}`} className="gl-palette__row" data-on={i === index ? 'true' : undefined} onMouseEnter={() => setIndex(i)} onClick={() => onGo(r.path)}>
              <span>
                <b>{r.title}</b>
                <em>{r.sub}</em>
              </span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          ))}
          {!rows.length && !busy ? (
            <div className="gl-palette__empty">
              Nothing matched “{q}”. Search covers every record you have saved — if a department is empty, that is why.
            </div>
          ) : null}
        </div>
        <div className="gl-palette__foot">
          <span>↑ ↓ to move · Enter to open · Esc to close</span>
          <Link to="/search" onClick={onClose}>
            Open full search page
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Recently-used departments for the home “continue” strip. */
export async function recentDepartments() {
  const ids = readRecent();
  const rows = await findAll(TABLES.progressEntries, { where: { on: todayISO() } });
  return { ids, today: rows.length };
}
