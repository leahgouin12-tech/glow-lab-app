import '../styles/departments/calendar.css';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  ListChecks,
  Plus,
  Repeat,
  Sunrise,
  Trash2
} from 'lucide-react';
import { TABLES, type AnyRow } from '../db/schema';
import { addDays, formatDate, newId, softDelete, todayISO } from '../db/repo';
import { saveRow, useRows } from '../hooks/live';
import { DEPARTMENTS } from '../nav/departments';
import { todayFocus } from '../engine/recommendations';
import {
  Button,
  Card,
  CardHead,
  Chip,
  Disclosure,
  EmptyState,
  Field,
  IconButton,
  Meter,
  Modal,
  SafetyBanner,
  Section,
  SegmentedControl,
  Select,
  TextArea,
  TextInput,
  useToast
} from '../ui/primitives';
import { DeptIntro, EmptyPlate } from '../ui/editorial';
import { HeatStrip } from '../ui/charts';

/**
 * Beauty & Style Calendar — spec Part 26.
 *
 * `calendarEvents` holds appointments and maintenance. `routines` + `routineLogs`
 * hold the daily checklist and its history. Nothing is synced to an external
 * calendar service and nothing is scheduled "for you": the recurrence rule on an
 * event is the one the user typed, and the .ics file is generated in this tab
 * from those rows and downloaded — no request leaves the device.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_CODE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const KINDS = ['appointment', 'maintenance', 'routine', 'deadline', 'restock', 'review', 'personal'];
const uid = (p: string) => newId(p);

const isoOf = (ms: number) => {
  const d = new Date(Number(ms));
  return todayISO(d);
};
const parts = (iso: string) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return { y, m: m - 1, d };
};
const dowOf = (iso: string) => {
  const { y, m, d } = parts(iso);
  return new Date(y, m, d).getDay();
};
const dayIndex = (iso: string) => Math.round(Date.UTC(parts(iso).y, parts(iso).m, parts(iso).d) / 86400000);

/** Does this event fall on this date, given the recurrence rule the user stored? */
function occursOn(ev: AnyRow, iso: string): boolean {
  const base = isoOf(ev.startAt);
  if (iso < base) return false;
  const rec = (ev.recurrence ?? {}) as AnyRow;
  const until = rec.until ? String(rec.until) : '';
  if (until && iso > until) return false;
  const freq = rec.freq as string | undefined;
  const interval = Math.max(1, Number(rec.interval ?? 1));
  if (!freq || freq === 'once') return iso === base;
  if (freq === 'daily') return (dayIndex(iso) - dayIndex(base)) % interval === 0;
  if (freq === 'weekly') {
    const by = ((rec.byweekday as number[]) ?? []).filter((n) => Number.isFinite(n));
    if (by.length ? !by.includes(dowOf(iso)) : dowOf(iso) !== dowOf(base)) return false;
    return Math.floor((dayIndex(iso) - dayIndex(base)) / 7) % interval === 0;
  }
  if (freq === 'monthly') {
    const a = parts(base);
    const b = parts(iso);
    if (a.d !== b.d) return false;
    return (b.y * 12 + b.m - (a.y * 12 + a.m)) % interval === 0;
  }
  return false;
}

function eventsOn(events: AnyRow[], iso: string) {
  return events
    .filter((e) => occursOn(e, iso))
    .slice()
    .sort((a, b) => Number(a.startAt) - Number(b.startAt));
}

export default function CalendarPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const events = useRows(TABLES.calendarEvents);
  const routines = useRows(TABLES.routines);
  const logs = useRows(TABLES.routineLogs);

  const today = todayISO();
  const [view, setView] = useState('month');
  const [cursor, setCursor] = useState(() => today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [editing, setEditing] = useState<AnyRow | null>(null);
  const [askDelete, setAskDelete] = useState<AnyRow | null>(null);

  const monthDays = useMemo(() => gridFor(cursor), [cursor]);
  const past = events.filter((e) => isoOf(e.startAt) < today).length;

  const upcoming = useMemo(() => {
    const out: { date: string; ev: AnyRow }[] = [];
    for (let i = 0; i < 45; i += 1) {
      const d = addDays(today, i);
      for (const ev of eventsOn(events, d)) out.push({ date: d, ev });
    }
    return out;
  }, [events, today]);

  const openForm = (seed: Record<string, unknown>) => setDraft({ title: '', kind: 'appointment', date: selected, time: '09:00', minutes: 60, note: '', cost: '', freq: '', interval: 1, until: '', weekdays: [] as number[], linkDomain: '', linkId: '' , ...seed });

  const saveEvent = async (payload: Record<string, unknown>, id?: string) => {
    const { y, m, d } = parts(String(payload.date));
    const [hh, mm] = String(payload.time || '09:00').split(':').map((x) => Number(x) || 0);
    const start = new Date(y, m, d, hh, mm).getTime();
    const row = await saveRow(TABLES.calendarEvents, {
      id: id ?? uid('cal'),
      title: String(payload.title || 'Untitled'),
      kind: String(payload.kind || 'appointment'),
      startAt: start,
      endAt: payload.minutes ? start + Number(payload.minutes) * 60000 : null,
      recurrence: payload.freq
        ? { freq: payload.freq as 'daily' | 'weekly' | 'monthly', interval: Number(payload.interval) || 1, until: payload.until ? String(payload.until) : null, byweekday: (payload.weekdays as number[]) ?? [] }
        : undefined,
      linkDomain: String(payload.linkDomain ?? ''),
      linkId: String(payload.linkId ?? ''),
      cost: payload.cost === '' ? null : Number(payload.cost),
      note: String(payload.note ?? '')
    });
    setDraft(null);
    setEditing(null);
    toast(`“${row.title}” saved to calendarEvents.`, 'ok');
  };

  /* ------------------------------------------------------------------ render */

  return (
    <div className="gl-page cal">
      <DeptIntro
        id="calendar"
        actions={
          <>
            <Button variant="primary" icon={<CalendarPlus size={14} />} onClick={() => openForm({})}>
              New event
            </Button>
            <Button variant="ghost" icon={<Download size={14} />} onClick={() => exportIcs(upcoming.map((u) => u.ev), toast)}>
              Export .ics
            </Button>
          </>
        }
        meta={[
          { label: 'Events stored', value: String(events.length) },
          { label: 'Routines', value: String(routines.filter((r) => r.active).length) },
          { label: 'Logs', value: String(logs.length) }
        ]}
      />

      <div className="gl-row gl-row--between cal-bar">
        <SegmentedControl
          value={view}
          onChange={setView}
          options={[
            { value: 'month', label: 'Month' },
            { value: 'agenda', label: 'Agenda' },
            { value: 'routines', label: 'Routines & heat' }
          ]}
        />
        <div className="gl-row gl-row--tight">
          <Chip>{events.length} event rows</Chip>
          <Chip tone="info">{upcoming.length} occurrence{upcoming.length === 1 ? '' : 's'} in the next 45 days</Chip>
          <Chip tone="gold">{past} recorded as past</Chip>
        </div>
      </div>

      <div className="cal-work">
        <div className="cal-main">
          {view === 'month' ? (
            <MonthGrid
              cursor={cursor}
              days={monthDays}
              events={events}
              logs={logs}
              routines={routines}
              selected={selected}
              onSelect={setSelected}
              onShift={(delta) => setCursor(shiftMonth(cursor, delta))}
              onToday={() => {
                setCursor(today.slice(0, 7));
                setSelected(today);
              }}
            />
          ) : null}

          {view === 'agenda' ? (
            <Agenda upcoming={upcoming} onOpenEvent={setEditing} onNew={() => openForm({})} onNavigate={navigate} onDone={async (ev) => {
              await saveRow(TABLES.calendarEvents, { id: ev.id, doneOn: ev.doneOn ? null : selected });
              toast(ev.doneOn ? 'Marked not done.' : 'Marked done on the event row.', 'ok');
            }} />
          ) : null}

          {view === 'routines' ? (
            <RoutinesView routines={routines} logs={logs} events={events} selected={selected} onSelected={setSelected} />
          ) : null}
        </div>

        <aside className="cal-side gl-rule-col">
          <DayPanel
            date={selected}
            events={eventsOn(events, selected)}
            logs={logs}
            routines={routines}
            onNew={() => openForm({ date: selected })}
            onOpen={setEditing}
            onAskDelete={setAskDelete}
            onNavigate={navigate}
            onChecklist={async (ev, items) => {
              await saveRow(TABLES.calendarEvents, { id: ev.id, checklist: items });
            }}
            onDone={async (ev) => {
              await saveRow(TABLES.calendarEvents, { id: ev.id, doneOn: ev.doneOn ? null : selected });
            }}
            onExport={(list) => exportIcs(list, toast)}
          />

          <TodayPanel onNavigate={navigate} />

          <Card>
            <CardHead eyebrow="Method" title="How recurrence is decided" />
            <div className="gl-stack" style={{ gap: 'var(--glow-sp-2)' }}>
              <p className="gl-small gl-muted" style={{ margin: 0 }}>
                An event repeats only if you stored a rule on it. Daily and weekly rules count from the event's own start
                date; monthly rules match the day-of-month. An “until” date stops the rule. Nothing extends forever by
                default, and nothing is inferred from how often you happened to book something before.
              </p>
              <p className="gl-tech gl-faint" style={{ margin: 0 }}>
                {events.filter((e) => e.recurrence?.freq).length} of {events.length} events carry a recurrence rule
              </p>
            </div>
          </Card>
        </aside>
      </div>

      {draft ? (
        <EventForm
          title="New event"
          draft={draft}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={(p) => void saveEvent(p)}
        />
      ) : null}

      {editing ? (
        <EventForm
          title="Edit event"
          draft={{
            title: editing.title,
            kind: editing.kind,
            date: isoOf(editing.startAt),
            time: new Date(Number(editing.startAt)).toTimeString().slice(0, 5),
            minutes: editing.endAt ? Math.round((Number(editing.endAt) - Number(editing.startAt)) / 60000) : 60,
            note: editing.note ?? '',
            cost: editing.cost ?? '',
            freq: editing.recurrence?.freq ?? '',
            interval: editing.recurrence?.interval ?? 1,
            until: editing.recurrence?.until ?? '',
            weekdays: (editing.recurrence?.byweekday as number[]) ?? [],
            linkDomain: editing.linkDomain ?? '',
            linkId: editing.linkId ?? ''
          }}
          onChange={setDraft}
          onClose={() => setEditing(null)}
          onSave={(p) => void saveEvent(p, editing.id)}
          onDelete={() => {
            setAskDelete(editing);
            setEditing(null);
          }}
        />
      ) : null}

      <Modal
        open={Boolean(askDelete)}
        onClose={() => setAskDelete(null)}
        title="Delete this event?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAskDelete(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 size={13} />}
              onClick={async () => {
                if (!askDelete) return;
                await softDelete(TABLES.calendarEvents, askDelete.id);
                setAskDelete(null);
                toast('Event removed from the calendar.', 'ok');
              }}
            >
              Delete event
            </Button>
          </>
        }
      >
        <p className="gl-small">
          <b>{askDelete?.title}</b> disappears from the grid, the agenda and any .ics file you export afterwards.
        </p>
        <p className="gl-small gl-muted">
          Routine logs already recorded are separate rows and stay untouched — they are history, not scheduling.
        </p>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------- month grid */

function gridFor(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = addDays(todayISO(first), -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function MonthGrid({
  cursor,
  days,
  events,
  logs,
  routines,
  selected,
  onSelect,
  onShift,
  onToday
}: {
  cursor: string;
  days: string[];
  events: AnyRow[];
  logs: AnyRow[];
  routines: AnyRow[];
  selected: string;
  onSelect: (d: string) => void;
  onShift: (delta: number) => void;
  onToday: () => void;
}) {
  const today = todayISO();
  const [y, m] = cursor.split('-').map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const active = routines.filter((r) => r.active);
  const loggedByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of logs) {
      if (active.length && !active.some((r) => r.id === l.routineId)) continue;
      map.set(String(l.doneOn), (map.get(String(l.doneOn)) ?? 0) + 1);
    }
    return map;
  }, [logs, active]);

  return (
    <Card>
      <div className="gl-row gl-row--between cal-month__bar">
        <div>
          <div className="gl-eyebrow">Scheduled</div>
          <h2 className="gl-display cal-month__label">{label}</h2>
        </div>
        <div className="gl-row gl-row--tight">
          <Button size="sm" variant="ghost" onClick={onToday}>
            Today
          </Button>
          <IconButton label="Previous month" onClick={() => onShift(-1)}>
            <ChevronLeft size={15} />
          </IconButton>
          <IconButton label="Next month" onClick={() => onShift(1)}>
            <ChevronRight size={15} />
          </IconButton>
        </div>
      </div>

      <div className="cal-grid" role="grid" aria-label={`${label} calendar grid`}>
        {WEEKDAYS.map((w) => (
          <div className="cal-dow" key={w} role="columnheader">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const evs = eventsOn(events, d);
          const inMonth = d.slice(0, 7) === cursor;
          const n = loggedByDay.get(d) ?? 0;
          const fill = active.length ? Math.min(4, Math.round((n / active.length) * 4)) : 0;
          return (
            <button
              type="button"
              role="gridcell"
              key={d}
              className={[
                'cal-cell',
                inMonth ? '' : 'cal-cell--out',
                d === today ? 'cal-cell--today' : '',
                d === selected ? 'cal-cell--sel' : ''
              ].join(' ')}
              aria-label={`${formatDate(d)}, ${evs.length} event(s), ${n} routine log(s)`}
              onClick={() => onSelect(d)}
            >
              <span className="cal-cell__n">{Number(d.slice(8, 10))}</span>
              <span className={`cal-cell__heat cal-cell__heat--${fill}`} aria-hidden />
              <span className="cal-cell__dots">
                {evs.slice(0, 4).map((e) => (
                  <i key={e.id} className={`cal-dot cal-dot--${slugKind(e.kind)}`} title={e.title} />
                ))}
                {evs.length > 4 ? <em className="cal-cell__more">+{evs.length - 4}</em> : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="cal-legend">
        {[...new Set(events.map((e) => e.kind))].filter(Boolean).map((k) => (
          <span key={String(k)} className="gl-row gl-row--tight cal-legend__i">
            <i className={`cal-dot cal-dot--${slugKind(k)}`} /> {String(k)}
          </span>
        ))}
        {!events.some((e) => e.kind) ? <span className="gl-tech gl-faint">No kinds recorded yet.</span> : null}
        <span className="gl-tech gl-faint">Cell shading = routines logged that day ÷ active routines.</span>
      </div>
    </Card>
  );
}

const slugKind = (k: unknown) => String(k ?? 'event').toLowerCase().replace(/[^a-z]/g, '') || 'event';

/* ---------------------------------------------------------------- agenda */

function Agenda({
  upcoming,
  onOpenEvent,
  onNew,
  onNavigate,
  onDone
}: {
  upcoming: { date: string; ev: AnyRow }[];
  onOpenEvent: (e: AnyRow) => void;
  onNew: () => void;
  onNavigate: (p: string) => void;
  onDone: (e: AnyRow) => Promise<void>;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, AnyRow[]>();
    for (const u of upcoming) {
      const arr = m.get(u.date) ?? [];
      arr.push(u.ev);
      m.set(u.date, arr);
    }
    return [...m.entries()];
  }, [upcoming]);

  if (!upcoming.length) {
    return (
      <EmptyPlate
        kicker="Nothing booked"
        title="No events in the next 45 days"
        body="The calendar holds whatever you write into it: appointments, retwist windows, a restock you keep forgetting, a review date you set for yourself. Nothing is suggested here."
        action={
          <Button variant="primary" icon={<Plus size={14} />} onClick={onNew}>
            Add the first event
          </Button>
        }
      />
    );
  }

  return (
    <Section eyebrow="Next 45 days" title="Agenda" right={<Button size="sm" icon={<Plus size={13} />} onClick={onNew}>Add event</Button>}>
      <div className="gl-stack cal-agenda">
        {groups.map(([date, evs]) => (
          <div className="cal-agenda__day" key={date}>
            <div className="cal-agenda__when">
              <span className="gl-serif">{WEEKDAYS[dowOf(date)]}</span>
              <span className="gl-tech">{formatDate(date)}</span>
            </div>
            <div className="cal-agenda__list">
              {evs.map((e) => (
                <div className="cal-agenda__row" key={`${date}-${e.id}`}>
                  <button type="button" className="cal-agenda__tick" aria-label={e.doneOn ? 'Mark not done' : 'Mark done'} onClick={() => void onDone(e)} data-on={Boolean(e.doneOn)}>
                    <Check size={13} />
                  </button>
                  <button type="button" className="cal-agenda__body" onClick={() => onOpenEvent(e)}>
                    <span className="gl-serif cal-agenda__title">{e.title}</span>
                    <span className="gl-tech gl-faint">
                      {new Date(Number(e.startAt)).toTimeString().slice(0, 5)}
                      {e.kind ? ` · ${e.kind}` : ''}
                      {e.recurrence?.freq ? ` · repeats ${e.recurrence.freq}` : ''}
                      {e.doneOn ? ' · done' : ''}
                    </span>
                  </button>
                  {e.linkDomain ? (
                    <Button size="sm" variant="ghost" onClick={() => onNavigate(`/${e.linkDomain}`)}>
                      {e.linkDomain}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* --------------------------------------------------------- routines view */

function RoutinesView({
  routines,
  logs,
  events,
  selected,
  onSelected
}: {
  routines: AnyRow[];
  logs: AnyRow[];
  events: AnyRow[];
  selected: string;
  onSelected: (d: string) => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string | null>(null);
  const active = routines.filter((r) => r.active);

  const window120 = useMemo(() => Array.from({ length: 120 }, (_, i) => addDays(todayISO(), -(119 - i))), []);
  const loggedSet = useMemo(() => new Set(logs.map((l) => `${l.routineId}|${l.doneOn}`)), [logs]);
  const daysWithAll = useMemo(() => new Set(window120.filter((d) => active.length && active.every((r) => loggedSet.has(`${r.id}|${d}`)))), [window120, active, loggedSet]);

  const heat = window120.map((d) => {
    const n = active.filter((r) => loggedSet.has(`${r.id}|${d}`)).length;
    return { date: d, level: active.length ? Math.round((n / active.length) * 4) : 0, title: `${n}/${active.length} routines logged` };
  });

  const overall = active.length ? Math.round((daysWithAll.size / 120) * 100) : 0;

  const addRoutine = async () => {
    const name = window.prompt('Name the routine (e.g. "Morning — skin")');
    if (!name?.trim()) return;
    const row = await saveRow(TABLES.routines, { id: uid('rtn'), name: name.trim(), domain: 'skin', timeOfDay: 'morning', active: true, steps: [] });
    setExpanded(row.id);
    toast('Routine created. Add its steps below — a routine with no steps is a wish.', 'ok');
  };

  return (
    <>
      <Card className="cal-heat">
        <CardHead
          eyebrow="Consistency"
          title="Last 120 days"
          sub={`${daysWithAll.size} of 120 days had every active routine logged · ${overall}%`}
          right={
            <Button size="sm" icon={<Download size={13} />} onClick={() => exportIcs(events, toast)}>
              Export events
            </Button>
          }
        />
        {active.length ? (
          <HeatStrip days={heat} />
        ) : (
          <EmptyState title="No active routines" body="Tick a routine active, or create one, and the strip starts filling from your logs." />
        )}
        <div className="gl-row gl-row--between cal-heat__foot">
          <span className="gl-tech gl-faint">darkest = all {active.length} active routine(s) logged · palest = none</span>
          <span className="gl-tech gl-faint">{logs.length} log rows</span>
        </div>
      </Card>

      <Section
        eyebrow="Daily"
        title="Checklist"
        description="Ticking a step writes to routineLogs for the date you are looking at. Change the date to log a day you missed, or to plan nothing at all and simply keep today honest."
        right={
          <>
            <input className="gl-input cal-date" type="date" value={selected} onChange={(e) => onSelected(e.target.value)} style={{ colorScheme: 'dark' }} aria-label="Which day to log" />
            <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => void addRoutine()}>
              New routine
            </Button>
          </>
        }
      >
        {routines.length === 0 ? (
          <EmptyPlate
            kicker="No routines"
            title="Nothing to tick yet"
            body="A routine here is a named list of steps with an order — morning and evening skin, a loc maintenance cycle, the ten minutes before you put the phone down. Steps are what make the log mean something."
            action={
              <Button variant="primary" icon={<ListChecks size={14} />} onClick={() => void addRoutine()}>
                Create a routine
              </Button>
            }
          />
        ) : (
          <div className="gl-stack cal-routines">
            {[...routines]
              .sort((a, b) => Number(b.active) - Number(a.active) || String(a.name).localeCompare(String(b.name)))
              .map((r) => (
                <RoutineCard
                  key={r.id}
                  routine={r}
                  log={logs.find((l) => l.routineId === r.id && l.doneOn === selected)}
                  allLogs={logs.filter((l) => l.routineId === r.id)}
                  date={selected}
                  expanded={expanded === r.id}
                  onExpand={() => setExpanded(expanded === r.id ? null : r.id)}
                  onNavigate={navigate}
                  onSaveLog={async (completedSteps, mood, note) => {
                    const existing = logs.find((l) => l.routineId === r.id && l.doneOn === selected);
                    await saveRow(TABLES.routineLogs, {
                      id: existing?.id ?? uid('rlog'),
                      routineId: r.id,
                      doneOn: selected,
                      completedSteps,
                      mood,
                      note
                    });
                  }}
                  onPatch={async (changes) => {
                    await saveRow(TABLES.routines, { id: r.id, ...changes });
                  }}
                />
              ))}
          </div>
        )}
      </Section>
    </>
  );
}

function RoutineCard({
  routine: r,
  log,
  allLogs,
  date,
  expanded,
  onExpand,
  onNavigate,
  onSaveLog,
  onPatch
}: {
  routine: AnyRow;
  log: AnyRow | undefined;
  allLogs: AnyRow[];
  date: string;
  expanded: boolean;
  onExpand: () => void;
  onNavigate: (p: string) => void;
  onSaveLog: (steps: string[], mood: number, note: string) => Promise<void>;
  onPatch: (c: Record<string, unknown>) => Promise<void>;
}) {
  const toast = useToast();
  const steps = ((r.steps as AnyRow[]) ?? []).slice().sort((a, b) => num(a.order) - num(b.order));
  const done = new Set((log?.completedSteps as string[]) ?? []);
  const dates = new Set(allLogs.map((l) => String(l.doneOn)));
  const streak = currentStreak(dates);
  const best = bestRun(allLogs.map((l) => String(l.doneOn)).sort());
  const pct120 = Math.round((allLogs.filter((l) => l.doneOn >= addDays(todayISO(), -119)).length / 120) * 100);

  const tick = (id: string) => {
    const next = new Set(done);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    void onSaveLog([...next], num(log?.mood, 0), String(log?.note ?? ''));
  };

  const addStep = async () => {
    const label = window.prompt('What is the step called?');
    if (!label?.trim()) return;
    await onPatch({ steps: [...steps, { id: uid('stp'), order: steps.length + 1, label: label.trim(), detail: '', productId: null, durationMin: 1, skipIf: '' }] });
  };

  return (
    <Card className={done.size === steps.length && steps.length ? 'cal-rtn cal-rtn--full' : 'cal-rtn'}>
      <div className="gl-row gl-row--between" style={{ alignItems: 'flex-start', gap: 'var(--glow-sp-3)' }}>
        <div style={{ minWidth: 0 }}>
          <div className="gl-eyebrow">
            {r.domain} · {r.timeOfDay} · {steps.length} step{steps.length === 1 ? '' : 's'}
          </div>
          <div className="gl-serif cal-rtn__h">{r.name}</div>
          <div className="gl-row gl-row--tight" style={{ marginTop: 6 }}>
            <Chip tone={streak ? 'gold' : 'info'}>
              <Repeat size={11} /> {streak}-day run
            </Chip>
            <Chip>best {best}</Chip>
            <Chip>{allLogs.length} logs total</Chip>
            <Chip>{pct120}% of the last 120 days</Chip>
            {!r.active ? <Chip tone="weak">inactive</Chip> : null}
          </div>
        </div>
        <div className="cal-rtn__side">
          <Meter value={steps.length ? (done.size / steps.length) * 100 : 0} />
          <div className="gl-row gl-row--tight" style={{ marginTop: 8 }}>
            <Button size="sm" variant="ghost" onClick={onExpand}>
              {expanded ? 'Close steps' : 'Edit steps'}
            </Button>
            <Button size="sm" onClick={() => void onPatch({ active: !r.active })}>
              {r.active ? 'Pause' : 'Activate'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onNavigate(`/${r.domain}?routine=${r.id}`)}>
              In its studio
            </Button>
          </div>
        </div>
      </div>

      {steps.length === 0 ? (
        <div className="gl-note" style={{ marginTop: 'var(--glow-sp-3)' }}>
          No steps yet — so logging this routine today would just record “I did the thing”. Add them and the log becomes
          usable history.
          <div style={{ marginTop: 6 }}>
            <Button size="sm" icon={<Plus size={12} />} onClick={() => void addStep()}>
              Add the first step
            </Button>
          </div>
        </div>
      ) : (
        <ul className="cal-steps">
          {steps.map((s, i) => {
            const on = done.has(String(s.id));
            return (
              <li key={String(s.id)}>
                <label className="gl-check">
                  <input type="checkbox" checked={on} onChange={() => tick(String(s.id))} />
                  <span>
                    <span className={`cal-steps__label ${on ? 'is-done' : ''}`}>
                      <span className="gl-tech gl-faint">{String(i + 1).padStart(2, '0')}</span> {s.label}
                    </span>
                    {s.detail ? <span className="cal-steps__detail">{s.detail}</span> : null}
                    {num(s.durationMin) > 1 ? <span className="gl-tech gl-faint"> · {s.durationMin} min</span> : null}
                    {s.skipIf ? <span className="gl-tech cal-steps__skip">skip if: {s.skipIf}</span> : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {steps.length ? (
        <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-3)' }}>
          <span className="gl-tech gl-faint">
            {done.size}/{steps.length} ticked for {formatDate(date)}
          </span>
          {done.size === steps.length && steps.length > 0 ? <Chip tone="strong">Complete</Chip> : null}
          <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => void addStep()}>
            Add step
          </Button>
        </div>
      ) : null}

      {expanded ? (
        <div className="cal-rtn__edit">
          <Field label="Routine name">
            <TextInput value={String(r.name ?? '')} onChange={(v) => void onPatch({ name: v })} />
          </Field>
          <Field label="Time of day">
            <Select
              value={String(r.timeOfDay ?? '')}
              onChange={(v) => void onPatch({ timeOfDay: v })}
              options={['morning', 'midday', 'evening', 'night', 'weekly', 'monthly'].map((t) => ({ value: t, label: t }))}
            />
          </Field>
          <Field label="Mood after it, today (0 = skipped)" hint="Stored on the log row for this date.">
            <Select
              value={String(num(log?.mood, 0))}
              onChange={(v) => void onSaveLog([...done], Number(v), String(log?.note ?? ''))}
              options={[0, 1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))}
            />
          </Field>
          <div className="gl-stack" style={{ gap: 6 }}>
            <div className="gl-label">Steps</div>
            {steps.map((s, i) => (
              <div className="gl-row gl-row--tight" key={String(s.id)}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <TextInput
                    value={String(s.label ?? '')}
                    onChange={(v) => void onPatch({ steps: steps.map((x, j) => (j === i ? { ...x, label: v } : x)) })}
                  />
                </div>
                <IconButton
                  label={`Delete step ${i + 1}`}
                  tone="danger"
                  onClick={async () => {
                    if (!window.confirm(`Delete the step “${s.label}”?`)) return;
                    await onPatch({ steps: steps.filter((_, j) => j !== i).map((x, j) => ({ ...x, order: j + 1 })) });
                    toast('Step deleted. Old logs keep the id, so history is not rewritten.', 'ok');
                  }}
                >
                  <Trash2 size={13} />
                </IconButton>
              </div>
            ))}
            {!steps.length ? <span className="gl-small gl-faint">No steps.</span> : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

const num = (v: unknown, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);

function currentStreak(dates: Set<string>) {
  let n = 0;
  let cur = todayISO();
  if (!dates.has(cur)) cur = addDays(cur, -1);
  while (dates.has(cur)) {
    n += 1;
    cur = addDays(cur, -1);
  }
  return n;
}

function bestRun(sorted: string[]) {
  let best = 0;
  let run = 0;
  let prev = '';
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/* ------------------------------------------------------------- day panel */

function DayPanel({
  date,
  events,
  logs,
  routines,
  onNew,
  onOpen,
  onAskDelete,
  onNavigate,
  onChecklist,
  onDone,
  onExport
}: {
  date: string;
  events: AnyRow[];
  logs: AnyRow[];
  routines: AnyRow[];
  onNew: () => void;
  onOpen: (e: AnyRow) => void;
  onAskDelete: (e: AnyRow) => void;
  onNavigate: (p: string) => void;
  onChecklist: (ev: AnyRow, items: Record<string, any>[]) => Promise<void>;
  onDone: (ev: AnyRow) => Promise<void>;
  onExport: (list: AnyRow[]) => void;
}) {
  const [label, setLabel] = useState('');
  const active = routines.filter((r) => r.active);
  const logged = active.filter((r) => logs.some((l) => l.routineId === r.id && l.doneOn === date));

  return (
    <Card>
      <CardHead
        eyebrow={WEEKDAYS[dowOf(date)]}
        title={formatDate(date)}
        sub={`${events.length} event(s) · ${logged.length}/${active.length} routines logged`}
        right={
          <>
            <IconButton label="Export this day to .ics" onClick={() => onExport(events)}>
              <Download size={14} />
            </IconButton>
            <IconButton label="New event on this day" onClick={onNew}>
              <Plus size={15} />
            </IconButton>
          </>
        }
      />

      {events.length === 0 ? (
        <div className="gl-stack" style={{ gap: 'var(--glow-sp-3)' }}>
          <p className="gl-small gl-muted" style={{ margin: 0 }}>
            Nothing booked, nothing recurring on this date.
          </p>
          <Button size="sm" variant="primary" icon={<CalendarDays size={13} />} onClick={onNew}>
            Add an event here
          </Button>
        </div>
      ) : (
        <div className="gl-stack cal-day">
          {events.map((e) => {
            const items = ((e.checklist as AnyRow[]) ?? []);
            return (
              <div className="cal-day__ev" key={e.id}>
                <div className="gl-row gl-row--between" style={{ alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="gl-serif cal-day__t">{e.title}</div>
                    <div className="gl-tech gl-faint">
                      {new Date(Number(e.startAt)).toTimeString().slice(0, 5)}
                      {e.endAt ? `–${new Date(Number(e.endAt)).toTimeString().slice(0, 5)}` : ''}
                      {e.kind ? ` · ${e.kind}` : ''}
                      {e.recurrence?.freq ? ` · ${e.recurrence.freq}${Number(e.recurrence.interval) > 1 ? ` ×${e.recurrence.interval}` : ''}` : ''}
                      {e.cost !== null && e.cost !== undefined ? ` · ${e.cost}` : ''}
                    </div>
                  </div>
                  <div className="gl-row gl-row--tight">
                    <IconButton label={e.doneOn ? 'Mark not done' : 'Mark done'} active={Boolean(e.doneOn)} tone="on" onClick={() => void onDone(e)}>
                      <Check size={14} />
                    </IconButton>
                    <IconButton label="Edit event" onClick={() => onOpen(e)}>
                      <Sunrise size={14} />
                    </IconButton>
                    <IconButton label="Delete event" tone="danger" onClick={() => onAskDelete(e)}>
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                </div>

                {e.note ? <p className="gl-small" style={{ margin: '6px 0 0' }}>{e.note}</p> : null}

                {items.length ? (
                  <ul className="cal-day__check">
                    {items.map((c, i) => (
                      <li key={String(c.id)}>
                        <label className="gl-check">
                          <input
                            type="checkbox"
                            checked={Boolean(c.done)}
                            onChange={() => void onChecklist(e, items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
                          />
                          <span className={c.done ? 'is-done' : ''}>{c.label}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="gl-row gl-row--tight" style={{ marginTop: 8 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={items.length > 0}
                    onClick={() => void onChecklist(e, [{ id: uid('chk'), label: 'First thing to do', done: false }])}
                  >
                    Start a checklist
                  </Button>
                  {items.length ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        const l = window.prompt('Next checklist item');
                        if (l?.trim()) await onChecklist(e, [...items, { id: uid('chk'), label: l.trim(), done: false }]);
                      }}
                    >
                      Add item
                    </Button>
                  ) : null}
                  {e.linkDomain ? (
                    <Button size="sm" onClick={() => onNavigate(`/${e.linkDomain}${e.linkId ? `?id=${e.linkId}` : ''}`)}>
                      Linked {e.linkDomain} record
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="cal-day__add">
        <div style={{ flex: 1, minWidth: 140 }}>
          <TextInput value={label} onChange={setLabel} placeholder="Add a checklist item to the top event" />
        </div>
        <Button
          size="sm"
          disabled={!label.trim() || !events.length}
          onClick={async () => {
            const ev = events[0];
            await onChecklist(ev, [...(((ev.checklist as AnyRow[]) ?? [])), { id: uid('chk'), label: label.trim(), done: false }]);
            setLabel('');
          }}
        >
          Add
        </Button>
      </div>
      {!events.length ? <p className="gl-tech gl-faint" style={{ marginBottom: 0 }}>Checklist items attach to an event — add one first.</p> : null}
    </Card>
  );
}

/* ------------------------------------------------------------ today panel */

function TodayPanel({ onNavigate }: { onNavigate: (p: string) => void }) {
  const [focus, setFocus] = useState<Awaited<ReturnType<typeof todayFocus>> | null>(null);
  useEffect(() => {
    let alive = true;
    todayFocus().then((f) => alive && setFocus(f)).catch(() => alive && setFocus([]));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Card>
      <CardHead eyebrow="Local rules engine" title="Today, from your own rows" sub="todayFocus(): events dated today, unfinished active routines, due plan actions. Nothing invented." />
      {focus === null ? (
        <p className="gl-small gl-faint">Reading your records…</p>
      ) : focus.length === 0 ? (
        <p className="gl-small gl-muted">
          Nothing is due today in your own data. That is a real state, not a loading state — and this app will not invent a
          task to fill it.
        </p>
      ) : (
        <ul className="cal-focus">
          {focus.map((f) => (
            <li key={`${f.kind}-${f.id}`}>
              <button type="button" className="gl-btn gl-btn--link gl-btn--sm" onClick={() => onNavigate(f.linkTo)}>
                {f.label}
              </button>
              <span className="gl-tech gl-faint">{f.kind}</span>
            </li>
          ))}
        </ul>
      )}
      <Disclosure summary="Why this list can be trusted">
        <p className="gl-small gl-muted" style={{ margin: 0 }}>
          Every line traces to a dated row you created: a calendar event whose rule lands on today, an active routine with
          no log for today, or a plan action whose cadence matches today. There is no model, no suggestion engine and no
          ranking — remove the row and the line goes with it.
        </p>
      </Disclosure>
    </Card>
  );
}

/* ------------------------------------------------------------- event form */

function EventForm({
  title,
  draft,
  onChange,
  onClose,
  onSave,
  onDelete
}: {
  title: string;
  draft: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
  onClose: () => void;
  onSave: (d: Record<string, unknown>) => void;
  onDelete?: () => void;
}) {
  const set = (k: string, v: unknown) => onChange({ ...draft, [k]: v });
  const weekdays = ((draft.weekdays as number[]) ?? []);
  const valid = String(draft.title ?? '').trim().length > 1;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={title}
      footer={
        <>
          <div className="gl-row gl-row--tight">
            {onDelete ? (
              <Button variant="danger" icon={<Trash2 size={13} />} onClick={onDelete}>
                Delete event
              </Button>
            ) : null}
            <span className="gl-tech gl-faint">Stored on calendarEvents. Cost is whatever you paid, unverified.</span>
          </div>
          <div className="gl-row gl-row--tight">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!valid} onClick={() => onSave(draft)}>
              Save event
            </Button>
          </div>
        </>
      }
    >
      <div className="cal-form">
        <Field label="Title">
          <TextInput value={String(draft.title ?? '')} onChange={(v) => set('title', v)} placeholder="What is it?" />
        </Field>
        <Field label="Kind">
          <Select value={String(draft.kind ?? '')} onChange={(v) => set('kind', v)} options={KINDS.map((k) => ({ value: k, label: k }))} />
        </Field>
        <Field label="Date">
          <input className="gl-input" type="date" value={String(draft.date ?? '')} onChange={(e) => set('date', e.target.value)} style={{ colorScheme: 'dark' }} />
        </Field>
        <Field label="Start time">
          <input className="gl-input" type="time" value={String(draft.time ?? '')} onChange={(e) => set('time', e.target.value)} style={{ colorScheme: 'dark' }} />
        </Field>
        <Field label="Minutes">
          <TextInput type="number" value={String(draft.minutes ?? 60)} onChange={(v) => set('minutes', num(v, 60))} />
        </Field>
        <Field label="Cost you were quoted" hint="What you typed. The app has no prices.">
          <TextInput type="number" value={String(draft.cost ?? '')} onChange={(v) => set('cost', v)} />
        </Field>
      </div>

      <div className="cal-repeat">
        <div className="gl-label">Repeats</div>
        <SegmentedControl
          value={String(draft.freq ?? '')}
          onChange={(v) => set('freq', v)}
          size="sm"
          options={[{ value: '', label: 'Does not repeat' }, { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]}
        />
        {draft.freq ? (
          <>
            <div className="cal-repeat__row">
              <Field label="Every … periods">
                <TextInput type="number" value={String(draft.interval ?? 1)} onChange={(v) => set('interval', Math.max(1, num(v, 1)))} />
              </Field>
              <Field label="Until (blank = keeps going)">
                <input className="gl-input" type="date" value={String(draft.until ?? '')} onChange={(e) => set('until', e.target.value)} style={{ colorScheme: 'dark' }} />
              </Field>
            </div>
            {draft.freq === 'weekly' ? (
              <div className="gl-row gl-row--tight">
                {WEEKDAYS.map((w, i) => (
                  <Chip key={w} active={weekdays.includes(i)} onClick={() => set('weekdays', weekdays.includes(i) ? weekdays.filter((x) => x !== i) : [...weekdays, i])}>
                    {w}
                  </Chip>
                ))}
              </div>
            ) : null}
            <SafetyBanner tone="note">
              {String(draft.freq)}
              {Number(draft.interval) > 1 ? ` every ${draft.interval}` : ''}
              {draft.freq === 'weekly' && weekdays.length ? ` on ${weekdays.map((i) => WEEKDAYS[i]).join(', ')}` : ''}
              {draft.until ? `, until ${formatDate(String(draft.until))}` : ', indefinitely'} — counted from{' '}
              {formatDate(String(draft.date))}.
            </SafetyBanner>
          </>
        ) : null}
      </div>

      <div className="cal-form">
        <Field label="Link to a department (optional)">
          <Select value={String(draft.linkDomain ?? '')} onChange={(v) => set('linkDomain', v)} placeholder="No link" options={DEPARTMENTS.map((d) => ({ value: d.id, label: d.title }))} />
        </Field>
        <Field label="Row id to link" hint="Paste an id if this event belongs to a specific record.">
          <TextInput value={String(draft.linkId ?? '')} onChange={(v) => set('linkId', v)} />
        </Field>
      </div>

      <Field label="Notes">
        <TextArea value={String(draft.note ?? '')} onChange={(v) => set('note', v)} rows={3} placeholder="Parking, questions to ask, what to bring, who to confirm with." />
      </Field>
    </Modal>
  );
}

/* --------------------------------------------------------------- .ics file */

function icsEscape(s: string) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function buildIcs(events: AnyRow[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//THE GLOW LAB//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:THE GLOW LAB'
  ];
  for (const e of events) {
    const d = new Date(Number(e.startAt));
    if (!Number.isFinite(d.getTime())) continue;
    const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const time = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.id}@glow-lab.local`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${day}T${time}`);
    if (e.endAt) lines.push(`DTEND:${(() => { const x = new Date(Number(e.endAt)); return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}T${String(x.getHours()).padStart(2, '0')}${String(x.getMinutes()).padStart(2, '0')}00`; })()}`);
    const rec = (e.recurrence ?? {}) as AnyRow;
    if (rec.freq) {
      const interval = Math.max(1, Number(rec.interval ?? 1));
      const by = ((rec.byweekday as number[]) ?? []).map((i) => DAY_CODE[i] ?? 'MO').join(',');
      lines.push(
        `RRULE:FREQ=${String(rec.freq).toUpperCase()}${interval > 1 ? `;INTERVAL=${interval}` : ''}${rec.until ? `;UNTIL=${String(rec.until).replace(/-/g, '')}T235959` : ''}${rec.freq === 'weekly' && by ? `;BYDAY=${by}` : ''}`
      );
    }
    lines.push(`SUMMARY:${icsEscape(e.title || 'Untitled')}`);
    if (e.kind) lines.push(`CATEGORIES:${icsEscape(String(e.kind))}`);
    if (e.note) lines.push(`DESCRIPTION:${icsEscape(String(e.note))}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function exportIcs(events: AnyRow[], toast: (body: ReactNode, tone?: 'ok' | 'bad' | 'info') => void) {
  if (!events.length) {
    toast('There is nothing to export — no events in this view.', 'bad');
    return;
  }
  const blob = new Blob([buildIcs(events)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `glow-lab-calendar-${todayISO()}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`${events.length} event(s) written to a local .ics file. Built on this device — nothing was uploaded.`, 'ok');
}
