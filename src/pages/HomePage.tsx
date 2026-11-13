import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Compass,
  Gauge,
  Heart,
  RotateCcw,
  Settings2,
  Shirt,
  ShoppingBag,
  Sparkles,
  Target,
  TrendingUp,
  X
} from 'lucide-react';
import { TABLES, type AnyRow } from '../db/schema';
import { formatDate, todayISO } from '../db/repo';
import { saveRow, useRows } from '../hooks/live';
import { loadSettings, updateSettings, type AppSettings } from '../state/settings';
import { DEPARTMENTS, NAV_GROUPS, dept, departmentsInGroup } from '../nav/departments';
import { todayFocus } from '../engine/recommendations';
import { closetGlance, glanceLines } from '../engine/coverage';
import { fetchFeedPage } from '../providers/discovery';
import { computeDna, scoreAgainstDna } from '../engine/taste';
import { Button, Card, Chip, EmptyState, fmtMoney, IconButton, Section, useToast } from '../ui/primitives';
import { DeptIntro, IndexList, IndexRow, StatStrip, Timeline } from '../ui/editorial';
import { ConsistencyWidget } from '../ui/consistency';
import { Pin } from '../ui/media';
import '../styles/departments/home.css';

/**
 * `dashboardCards` ships without this card and src/state/settings.ts is owned
 * elsewhere, so default-on cards are resolved here instead of being written into
 * the stored list: an id that is not switched off shows up. Switching it off
 * stores a `!`-prefixed marker, which survives a settings reset — so a wipe
 * cannot leave the card stranded off, and no one-time seed flag is needed.
 */
const OFF_PREFIX = '!';
const DEFAULT_ON_CARDS: { id: string; after: string }[] = [
  { id: 'consistency', after: 'routines' },
  { id: 'closet', after: 'consistency' }
];

/** The list actually rendered: stored ids (minus off-markers) plus un-switched-off defaults. */
const mergeCards = (stored: string[]): string[] => {
  const off = new Set(stored.filter((c) => c.startsWith(OFF_PREFIX)).map((c) => c.slice(OFF_PREFIX.length)));
  const next = stored.filter((c) => !c.startsWith(OFF_PREFIX));
  for (const d of DEFAULT_ON_CARDS) {
    if (off.has(d.id) || next.includes(d.id)) continue;
    const anchor = next.indexOf(d.after);
    next.splice(anchor >= 0 ? anchor + 1 : next.length, 0, d.id);
  }
  return next;
};

/** Stored shape: the ordered on-list plus the off-markers that produced it. */
const saveCards = (settings: AppSettings, on: string[]) => [
  ...on,
  ...settings.dashboardCards.filter((c) => c.startsWith(OFF_PREFIX) && !on.includes(c.slice(OFF_PREFIX.length)))
];

const CARD_LABELS: Record<string, string> = {
  priorities: 'Your priorities',
  goals: 'Goals in flight',
  advisor: 'Advisor briefing',
  discover: 'Discovery, matched to you',
  routines: 'Routines today',
  consistency: 'This week: did I do it?',
  closet: 'Closet at a glance',
  progress: 'Recent progress',
  calendar: 'Next seven days',
  wishlist: 'Wishlist & spend',
  plans: 'Active plans',
  experiments: 'Open experiments'
};

const TABLE_PATH: Record<string, string> = {
  plans: '/looksmaxxing',
  goals: '/looksmaxxing',
  assessments: '/looksmaxxing',
  routines: '/calendar',
  experiments: '/experiments',
  purchases: '/market',
  products: '/market',
  lists: '/market',
  consultations: '/services',
  calendarEvents: '/calendar',
  progressEntries: '/progress',
  hairRecords: '/hair',
  workoutSessions: '/fitness',
  clothingItems: '/closet',
  outfits: '/closet',
  dental: '/dental'
};

/** Adaptive dashboard (spec Part 22). Sections show only when they have data. */
export default function HomePage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [focus, setFocus] = useState<{ label: string; kind: string; linkTo: string; id: string }[]>([]);
  const [featured, setFeatured] = useState<AnyRow[]>([]);
  const [editing, setEditing] = useState(false);

  const goals = useRows(TABLES.goals, { where: { status: 'active' } });
  const recos = useRows(TABLES.recommendations, { where: { status: 'new' } });
  const routines = useRows(TABLES.routines, { where: { active: true } });
  const logs = useRows(TABLES.routineLogs);
  const events = useRows(TABLES.calendarEvents);
  const progress = useRows(TABLES.progressEntries);
  const lists = useRows(TABLES.lists);
  const plans = useRows(TABLES.plans, { where: { status: 'active' } });
  const experiments = useRows(TABLES.experiments, { where: { decision: 'open' } });
  const media = useRows(TABLES.mediaItems);
  const closetItems = useRows(TABLES.clothingItems);
  const profile = useRows(TABLES.profile, { where: { kind: 'personal' } });
  const interactions = useRows(TABLES.discoveryInteractions);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  const refreshFocus = useCallback(() => {
    todayFocus().then(setFocus).catch(() => setFocus([]));
  }, []);

  useEffect(() => {
    refreshFocus();
  }, [refreshFocus, logs.length, events.length, plans.length, routines.length]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const dna = await computeDna();
      const page = await fetchFeedPage({ page: 1, online: navigator.onLine, score: (i) => scoreAgainstDna(i, dna) });
      if (!alive) return;
      setFeatured(page.items.filter((i) => i.providerId !== 'pinterest').slice(0, 6));
    })().catch(() => alive && setFeatured([]));
    return () => {
      alive = false;
    };
  }, [interactions.length]);

  const name = String((profile[0]?.data as Record<string, unknown> | undefined)?.name ?? '').trim();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const today = todayISO();

  const loggedToday = useMemo(() => new Set(logs.filter((l) => l.doneOn === today).map((l) => l.routineId)), [logs, today]);

  const weekEvents = useMemo(() => {
    const end = Date.now() + 7 * 86400000;
    return events
      .filter((e) => Number(e.startAt) >= Date.now() - 3600000 && Number(e.startAt) <= end)
      .sort((a, b) => Number(a.startAt) - Number(b.startAt))
      .slice(0, 6);
  }, [events]);

  const wishlist = lists.find((l) => l.kind === 'wishlist') ?? lists[0];

  /* Whole-closet arithmetic over her own rows, so the card can say what the
     coverage matrix found without opening the closet page. */
  const glance = useMemo(() => closetGlance(closetItems, todayISO()), [closetItems]);
  const glanceText = useMemo(() => glanceLines(glance), [glance]);

  const cards = settings ? mergeCards(settings.dashboardCards) : [];
  const visible = cards.filter((c) => cardHasData(c, { goals, recos, routines, events, progress, lists, plans, experiments, featured, focus, closet: glance.rows }));
  const hidden = cards.filter((c) => !visible.includes(c));
  const pinned = useMemo(() => new Set(settings?.enabledDepartments ?? []), [settings]);

  const commitCards = (next: string[]) => {
    if (!settings) return;
    const saved = saveCards(settings, next);
    // a default-on card that is now off needs its off-marker, or the merge would turn it back on
    for (const d of DEFAULT_ON_CARDS) {
      if (!next.includes(d.id) && !saved.includes(`${OFF_PREFIX}${d.id}`)) saved.push(`${OFF_PREFIX}${d.id}`);
    }
    setSettings({ ...settings, dashboardCards: saved });
    void updateSettings({ dashboardCards: saved });
  };

  const move = (id: string, dir: -1 | 1) => {
    if (!settings) return;
    const next = [...cards];
    const i = next.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    commitCards(next);
  };

  const toggleCard = (id: string) => {
    if (!settings) return;
    commitCards(cards.includes(id) ? cards.filter((c) => c !== id) : [...cards, id]);
  };

  return (
    <>
      <DeptIntro
        id="home"
        variant="campaign"
        title={`${greeting}${name ? `, ${name}` : ''}.`}
        deck="Everything below is read from records you created. Nothing here is a suggestion the app invented, and no number on this page is an attractiveness score."
        image={media.find((m) => m.star) ?? media[0] ?? null}
        meta={[
          { label: 'Today', value: formatDate(today) },
          { label: 'Active goals', value: String(goals.length) },
          { label: 'Open priorities', value: String(recos.length) },
          { label: 'Departments', value: String(DEPARTMENTS.length) }
        ]}
        actions={
          <>
            <Button variant="gold" icon={<Sparkles size={15} />} onClick={() => navigate('/advisor')}>
              Ask the advisor
            </Button>
            <Button variant="ghost" icon={<Compass size={15} />} onClick={() => navigate('/discover')}>
              Discover
            </Button>
            <IconButton label="Customise dashboard" onClick={() => setEditing((e) => !e)}>
              <Settings2 size={15} />
            </IconButton>
          </>
        }
      />

      <StatStrip
        items={[
          { label: 'Due today', value: focus.length, hint: 'routines, plans and events' },
          { label: 'Logged today', value: `${loggedToday.size}/${routines.filter((r) => r.active).length}`, hint: 'routine completions' },
          { label: 'Progress records', value: progress.length, hint: 'your own entries' },
          { label: 'Saved images', value: media.filter((m) => !m.remoteUrl).length, hint: 'on this device' }
        ]}
      />

      {editing ? (
        <Card className="gl-home__edit" accent>
          <div className="gl-row gl-row--between">
            <div className="gl-eyebrow">Dashboard sections</div>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Done
            </Button>
          </div>
          <div className="gl-onb__chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(CARD_LABELS).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className="gl-chip gl-chip--clickable"
                data-on={cards.includes(id)}
                aria-pressed={cards.includes(id)}
                onClick={() => toggleCard(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="gl-small gl-faint">
            A section also disappears on its own when there is nothing to show — an empty dashboard stays empty rather than showing filler.
            {hidden.length ? ` Hidden for no data: ${hidden.map((h) => CARD_LABELS[h] ?? h).join(', ')}.` : ''}
          </div>
        </Card>
      ) : null}

      <div className="gl-dashgrid">
        {visible.includes('priorities') ? (
          <Widget
            id="priorities"
            editing={editing}
            onMove={move}
            title="Your priorities"
            icon={<Target size={14} />}
            action={
              <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/looksmaxxing">
                Command center
              </Link>
            }
          >
            {recos.length === 0 ? (
              <p className="gl-small gl-muted">
                No open recommendation. The rules engine re-reads your records when you log something; it will not manufacture urgency.
              </p>
            ) : (
              <ul className="gl-home__list">
                {recos.slice(0, 5).map((r) => (
                  <li key={r.id}>
                    <div className="gl-row gl-row--between" style={{ alignItems: 'baseline', gap: 10 }}>
                      <span className="gl-strong">{r.title}</span>
                      <span className="gl-tech gl-faint">{Math.round(Number(r.score))}</span>
                    </div>
                    <p className="gl-small gl-muted" style={{ margin: '4px 0 0' }}>
                      {r.reason}
                    </p>
                    <div className="gl-row gl-row--tight" style={{ marginTop: 8 }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Check size={13} />}
                        onClick={() => {
                          void saveRow(TABLES.recommendations, { ...r, status: 'accepted' });
                          toast('Accepted — the action is yours to schedule.', 'ok');
                        }}
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<X size={13} />}
                        onClick={() => void saveRow(TABLES.recommendations, { ...r, status: 'dismissed' })}
                      >
                        Dismiss
                      </Button>
                      {TABLE_PATH[r.linkTable] ? (
                        <Button size="sm" variant="ghost" onClick={() => navigate(TABLE_PATH[r.linkTable])}>
                          Open record
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Widget>
        ) : null}

        {visible.includes('routines') ? (
          <Widget
            id="routines"
            editing={editing}
            onMove={move}
            title="Today"
            icon={<Check size={14} />}
            action={
              <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/calendar">
                Calendar
              </Link>
            }
          >
            {settings?.reminders === false ? (
              <p className="gl-small gl-muted">
                In-app reminders are off in Settings → Privacy, so nothing due is listed here.{' '}
                <Link to="/settings?tab=privacy" className="gl-tech" style={{ fontSize: 'var(--glow-text-micro)' }}>
                  Turn them back on
                </Link>
              </p>
            ) : focus.length === 0 ? (
              <p className="gl-small gl-muted">Nothing is due in your records today. That is a real state, not a loading state.</p>
            ) : (
              <ul className="gl-home__checks">
                {focus.map((f) => {
                  const isRoutineLog = f.linkTo.includes('focus=routines');
                  const done = loggedToday.has(f.id);
                  return (
                    <li key={`${f.kind}-${f.id}`}>
                      <button
                        type="button"
                        className="gl-check"
                        onClick={() => {
                          if (!isRoutineLog) {
                            navigate(f.linkTo.startsWith('/') ? f.linkTo : '/calendar');
                            return;
                          }
                          void saveRow(TABLES.routineLogs, { routineId: f.id, doneOn: today, completedSteps: [], mood: 0, note: '' });
                          refreshFocus();
                          toast('Logged.', 'ok');
                        }}
                      >
                        <input type="checkbox" checked={done} readOnly aria-hidden />
                        <span>
                          <span className="gl-strong">{f.label}</span>
                          <span className="gl-tech gl-faint" style={{ marginLeft: 8, fontSize: '0.62rem' }}>
                            {f.kind}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Widget>
        ) : null}

        {visible.includes('consistency') ? (
          <Widget
            id="consistency"
            editing={editing}
            onMove={move}
            span
            title="This week: did I do it?"
            icon={<Heart size={14} />}
            action={
              <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/calendar">
                Routines
              </Link>
            }
          >
            <ConsistencyWidget />
          </Widget>
        ) : null}

        {visible.includes('closet') ? (
          <Widget
            id="closet"
            editing={editing}
            onMove={move}
            title="Closet at a glance"
            icon={<Shirt size={14} />}
            action={
              <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/closet">
                Open
              </Link>
            }
          >
            <div data-testid="home-closet">
              <p className="gl-small" style={{ margin: '0 0 8px' }}>
                {glance.headline}
              </p>
              <p className="gl-small gl-muted" style={{ margin: '0 0 8px' }}>
                {glanceText.sitting}
              </p>
              <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                <Chip>{`${glance.placeable} of ${glance.rows} pieces the closet can place`}</Chip>
                {glance.undated ? <Chip>{`${glance.undated} with no last-worn date`}</Chip> : null}
                {glance.seasonHoles ? (
                  <Chip tone="limited">{`${glance.seasonHoles} slot-season pair${glance.seasonHoles === 1 ? '' : 's'} nothing can dress`}</Chip>
                ) : (
                  <Chip tone="strong">every slot covers every season</Chip>
                )}
              </div>
              <p className="gl-small gl-faint" style={{ margin: '8px 0 0' }}>
                {glanceText.note}
              </p>
            </div>
          </Widget>
        ) : null}

        {visible.includes('goals') ? (
          <Widget
            id="goals"
            editing={editing}
            onMove={move}
            title="Goals in flight"
            icon={<Target size={14} />}
            action={
              <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/looksmaxxing">
                Plan
              </Link>
            }
          >
            <IndexList>
              {goals.slice(0, 6).map((g, i) => (
                <IndexRow
                  key={g.id}
                  no={i + 1}
                  title={g.title}
                  sub={`${g.domain}${g.targetOn ? ` · by ${formatDate(g.targetOn)}` : ''}`}
                  right={<Chip>{g.priority === 1 ? 'top' : `p${g.priority}`}</Chip>}
                />
              ))}
            </IndexList>
          </Widget>
        ) : null}

        {visible.includes('calendar') ? (
          <Widget
            id="calendar"
            editing={editing}
            onMove={move}
            title="Next seven days"
            icon={<CalendarDays size={14} />}
            action={
              <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/calendar">
                Open
              </Link>
            }
          >
            {weekEvents.length === 0 ? (
              <p className="gl-small gl-muted">No events in the next week. Add one from the calendar and it appears here.</p>
            ) : (
              <Timeline
                items={weekEvents.map((e) => ({
                  when: new Date(Number(e.startAt)).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
                  title: e.title,
                  body: e.note || e.kind || ''
                }))}
              />
            )}
          </Widget>
        ) : null}

        {visible.includes('progress') ? (
          <Widget
            id="progress"
            editing={editing}
            onMove={move}
            title="Recent progress"
            icon={<TrendingUp size={14} />}
            action={
              <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/progress">
                Analytics
              </Link>
            }
          >
            <IndexList>
              {progress
                .slice()
                .sort((a, b) => String(b.on).localeCompare(String(a.on)))
                .slice(0, 5)
                .map((p, i) => (
                  <IndexRow
                    key={p.id}
                    no={i + 1}
                    title={p.label}
                    sub={`${p.domain} · ${formatDate(p.on)}${p.value ? ` · ${p.value}${p.unit ?? ''}` : ''}`}
                    right={p.rating ? <Chip>{p.rating}/5</Chip> : null}
                  />
                ))}
            </IndexList>
          </Widget>
        ) : null}

        {visible.includes('advisor') ? (
          <Widget
            id="advisor"
            editing={editing}
            onMove={move}
            title="Advisor briefing"
            icon={<Sparkles size={14} />}
            action={
              <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/advisor">
                Ask
              </Link>
            }
          >
            <div className="gl-well gl-small">
              <strong className="gl-strong">Engine: local rules.</strong> The advisor answers from your own rows and the evidence
              library. It is not a language model, and it refuses requests for attractiveness scores, diagnoses and unsafe practices.
            </div>
            <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
              <Chip>What should I do today?</Chip>
              <Chip>Is this worth buying?</Chip>
              <Chip>How is my hair progress?</Chip>
              <Chip>Why was this prioritised?</Chip>
            </div>
          </Widget>
        ) : null}

        {visible.includes('discover') ? (
          <Widget
            id="discover"
            editing={editing}
            onMove={move}
            span
            title="Discovery, matched to your taste profile"
            icon={<Compass size={14} />}
            action={
              <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/discover">
                Open feed
              </Link>
            }
          >
            {featured.length === 0 ? (
              <p className="gl-small gl-muted">
                No discovery records available. Import your own references or add starter content in Settings — the app will not
                invent a feed.
              </p>
            ) : (
              <div className="gl-home__pins">
                {featured.map((it) => (
                  <Pin
                    key={it.id}
                    item={it}
                    title={it.title}
                    sub={(it.categories as string[] | undefined)?.slice(0, 2).join(' · ')}
                    badge={it.providerId === 'pinterest' ? <Chip>your Pinterest</Chip> : undefined}
                    onOpen={() => navigate(`/discover?item=${it.id}`)}
                  />
                ))}
              </div>
            )}
          </Widget>
        ) : null}

        {visible.includes('wishlist') ? (
          <Widget
            id="wishlist"
            editing={editing}
            onMove={move}
            title="Wishlist & spend"
            icon={<ShoppingBag size={14} />}
            action={
              <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/market">
                Market
              </Link>
            }
          >
            {wishlist ? (
              <>
                <div className="gl-row gl-row--between gl-small">
                  <span className="gl-strong">{wishlist.name}</span>
                  <Chip>{(wishlist.items as unknown[])?.length ?? 0} items</Chip>
                </div>
                <ul className="gl-home__list">
                  {((wishlist.items as AnyRow[]) ?? []).slice(0, 4).map((i) => (
                    <li key={i.id}>
                      <div className="gl-row gl-row--between" style={{ alignItems: 'baseline' }}>
                        <span>{i.label}</span>
                        <span className="gl-tech gl-faint">{fmtMoney(i.estPrice, settings?.currency ?? 'USD')}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="gl-small gl-muted">No list yet. Create one in Beauty Market to track intended spend against your budget.</p>
            )}
          </Widget>
        ) : null}

        {visible.includes('plans') ? (
          <Widget
            id="plans"
            editing={editing}
            onMove={move}
            title="Active plans"
            icon={<Gauge size={14} />}
            action={
              <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/looksmaxxing">
                Review
              </Link>
            }
          >
            <IndexList>
              {plans.map((p, i) => (
                <IndexRow
                  key={p.id}
                  no={i + 1}
                  title={p.name}
                  sub={`${p.days}-day · started ${formatDate(p.startOn)} · ${((p.actions as AnyRow[]) ?? []).length} actions`}
                  right={<Chip>{p.status}</Chip>}
                  onClick={() => navigate('/looksmaxxing')}
                />
              ))}
            </IndexList>
          </Widget>
        ) : null}

        {visible.includes('experiments') ? (
          <Widget
            id="experiments"
            editing={editing}
            onMove={move}
            title="Open experiments"
            icon={<RotateCcw size={14} />}
            action={
              <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/experiments">
                Lab
              </Link>
            }
          >
            <IndexList>
              {experiments.map((x, i) => (
                <IndexRow
                  key={x.id}
                  no={i + 1}
                  title={x.name}
                  sub={`${x.category} · ${formatDate(x.startOn)} → ${formatDate(x.endOn)} · ${((x.observations as AnyRow[]) ?? []).length} check-ins`}
                  onClick={() => navigate(`/experiments?id=${x.id}`)}
                />
              ))}
            </IndexList>
          </Widget>
        ) : null}
      </div>

      <Section eyebrow="Continue" title="Where you left off">
        <Resume />
      </Section>

      <Section
        eyebrow="All departments"
        title="Everything is reachable"
        description="Twenty-nine departments over one shared schema. Starter content is tagged and removable."
      >
        {NAV_GROUPS.map((g) => (
          <div key={g} className="gl-home__group">
            <div className="gl-eyebrow">{g}</div>
            <div className="gl-deptgrid">
              {[...departmentsInGroup(g)]
                .sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)))
                .map((d, i) => {
                const Icon = d.icon;
                return (
                  <Link
                    key={d.id}
                    to={d.path}
                    data-pinned={pinned.has(d.id) ? 'true' : undefined}
                    data-feature={i === 0 && g === 'Daily' ? 'true' : undefined}
                  >
                    <Icon size={17} strokeWidth={1.5} />
                    <span className="gl-strong">{d.title}</span>
                    {pinned.has(d.id) ? <span className="gl-tech gl-home__pinnedflag">pinned</span> : null}
                    <span className="gl-small gl-faint">{d.deck}</span>
                    <span className="gl-tech gl-faint" style={{ fontSize: '0.58rem', marginTop: 'auto' }}>
                      {d.parts.join(' · ')}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </Section>
    </>
  );
}

function Widget({
  id,
  title,
  icon,
  action,
  children,
  span,
  editing,
  onMove
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  span?: boolean;
  editing: boolean;
  onMove: (id: string, dir: -1 | 1) => void;
}) {
  return (
    <section className={`gl-widget ${span ? 'gl-widget--span2' : ''}`}>
      <header className="gl-widget__head">
        <h2 className="gl-widget__title">
          {icon}
          {title}
        </h2>
        <div className="gl-row gl-row--tight">
          {editing ? (
            <>
              <IconButton label="Move up" onClick={() => onMove(id, -1)}>
                ↑
              </IconButton>
              <IconButton label="Move down" onClick={() => onMove(id, 1)}>
                ↓
              </IconButton>
            </>
          ) : null}
          {action}
        </div>
      </header>
      {children}
    </section>
  );
}

function cardHasData(
  id: string,
  d: {
    goals: AnyRow[];
    recos: AnyRow[];
    routines: AnyRow[];
    events: AnyRow[];
    progress: AnyRow[];
    lists: AnyRow[];
    plans: AnyRow[];
    experiments: AnyRow[];
    featured: AnyRow[];
    focus: unknown[];
    closet: number;
  }
) {
  switch (id) {
    case 'priorities':
      return d.recos.length > 0;
    case 'goals':
      return d.goals.length > 0;
    case 'advisor':
      return true;
    case 'discover':
      return d.featured.length > 0;
    case 'routines':
      return d.focus.length > 0 || d.routines.length > 0;
    /** Always shown: with zero rows it renders its own honest empty state, which is the point. */
    case 'consistency':
      return true;
    case 'progress':
      return d.progress.length > 0;
    case 'calendar':
      return d.events.length > 0;
    case 'wishlist':
      return d.lists.length > 0;
    /** Hidden while the closet is empty: an empty closet is not a hole to advertise. */
    case 'closet':
      return d.closet > 0;
    case 'plans':
      return d.plans.length > 0;
    case 'experiments':
      return d.experiments.length > 0;
    default:
      return true;
  }
}

function Resume() {
  const ids = (() => {
    try {
      return JSON.parse(localStorage.getItem('glow-lab:recent-depts') ?? '[]') as string[];
    } catch {
      return [];
    }
  })();
  const items = ids.map((id) => dept(id as never)).filter(Boolean);
  if (!items.length) {
    return (
      <EmptyState
        title="Nothing visited yet"
        body="Your last five departments land here once you start moving around. It is stored on this device only."
        action={
          <Link className="gl-btn gl-btn--primary" to="/looksmaxxing">
            Start the baseline assessment <ArrowUpRight size={15} />
          </Link>
        }
      />
    );
  }
  return (
    <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
      {items.map((d) => {
        const Icon = d.icon;
        return (
          <Link key={d.id} className="gl-chip gl-chip--clickable" to={d.path}>
            <Icon size={13} /> {d.title}
          </Link>
        );
      })}
    </div>
  );
}
