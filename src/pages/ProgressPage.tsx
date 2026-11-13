import '../styles/departments/progress.css';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Activity, Camera, Plus, ShieldAlert, Trash2, Pencil } from 'lucide-react';
import { TABLES, type AnyRow } from '../db/schema';
import { addDays, formatDate, newId, softDelete, todayISO } from '../db/repo';
import { saveRow, useRows } from '../hooks/live';
import { DEPARTMENTS } from '../nav/departments';
import { loadSettings, subscribeSettings, updateSettings, type AppSettings } from '../state/settings';
import {
  Button,
  Card,
  CardHead,
  Chip,
  DateInput,
  Disclosure,
  EmptyState,
  Field,
  IconButton,
  Meter,
  Modal,
  Rating,
  SafetyBanner,
  Section,
  SegmentedControl,
  Select,
  Stat,
  Table,
  TextArea,
  TextInput,
  Toggle,
  useToast,
  fmtMoney,
  pct
} from '../ui/primitives';
import { DeptIntro, EmptyPlate, ProgressRing, StatStrip } from '../ui/editorial';
import { DistributionBars, HeatStrip, LineChart } from '../ui/charts';
import { CompareSlider, PhotoPicker, ShotGridPicker } from '../ui/media';
import { conditionDiff, conditionRows } from '../ui/GhostGuide';
import { useImageSrc } from '../media/store';
import { COVARIATE_FIELDS, coverage, daysFromRows, mergeSignals, signalsFromRows, splitByRatings } from '../engine/covariates';
import { trendByMetric } from '../engine/trend';
import { commitNote, offersForGoal, type GoalOffer, type GoalTables } from '../engine/goalSources';

/**
 * Progress & Analytics — spec Part 31/32 reading.
 *
 * Every figure on this page is arithmetic over rows the user wrote. There is no
 * composite score, no "attractiveness" number, no before/after verdict and no
 * image analysis: the app has no model that could produce one. Where a number
 * would be meaningless on its own it is printed with its denominator, and where
 * there is not enough data to draw a line the chart refuses instead of
 * extrapolating.
 */

const num = (v: unknown, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);
const numOrNull = (v: unknown) => {
  const n = Number(v);
  return v === '' || v === null || v === undefined || !Number.isFinite(n) ? null : n;
};

const WINDOWS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '12 months' }
];

/** Newest recorded capture first; ids break ties so the pick never flickers. */
const byNewestShot = (a: AnyRow, b: AnyRow) =>
  String(b.takenOn ?? '').localeCompare(String(a.takenOn ?? '')) || String(b.id).localeCompare(String(a.id));

/**
 * One plain sentence about how comparable two chosen photographs are, built
 * only from the capture fields recorded on each row. Arithmetic over metadata
 * you typed — the app never looks at either image.
 */
function comparability(a: AnyRow, b: AnyRow): { cls: string; text: string } {
  const gaps = conditionDiff(a, b);
  if (gaps.length) {
    return {
      cls: 'gl-note gl-note--warn',
      text: `Recorded fields that differ: ${gaps
        .map((g) => `${g.label} (${g.from} vs ${g.to})`)
        .join('; ')}. That is what you typed when each file was stored — no pixel of either picture has been examined.`
    };
  }
  if (conditionRows(a, b).some((r) => r.same)) {
    return {
      cls: 'gl-note gl-note--ok',
      text: 'Every capture field both files carry is recorded identically. What that lets you compare is the frame you set up, not a verdict — the gap in days is still yours to read.'
    };
  }
  return {
    cls: 'gl-note',
    text: 'Neither file has capture conditions recorded, so nothing here can say whether the two are comparable. You know how each was shot; the record does not.'
  };
}

/* ------------------------------------------------------------------ page */

export default function ProgressPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [days, setDays] = useState('90');
  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [askDrop, setAskDrop] = useState<AnyRow | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const entries = useRows(TABLES.progressEntries);
  const dayRows = useRows(TABLES.covariateDays);
  const routineLogs = useRows(TABLES.routineLogs);
  const routines = useRows(TABLES.routines);
  const goals = useRows(TABLES.goals);
  const observations = useRows(TABLES.observations);
  const measurements = useRows(TABLES.measurements);
  const weights = useRows(TABLES.weightEntries);
  const media = useRows(TABLES.mediaItems);
  const experiments = useRows(TABLES.experiments);
  const sessions = useRows(TABLES.workoutSessions);
  const hairRecords = useRows(TABLES.hairRecords);
  const tutorials = useRows(TABLES.tutorials);
  const products = useRows(TABLES.products);
  const purchases = useRows(TABLES.purchases);
  const outfits = useRows(TABLES.outfits);
  const clothing = useRows(TABLES.clothingItems);
  const events = useRows(TABLES.calendarEvents);
  const providers = useRows(TABLES.providers);
  const consultations = useRows(TABLES.consultations);
  const dental = useRows(TABLES.dental);
  const plans = useRows(TABLES.plans);
  const assessments = useRows(TABLES.assessments);
  const paths = useRows(TABLES.learningPaths);
  const knowledge = useRows(TABLES.knowledge);

  const win = num(days, 90);
  const from = addDays(todayISO(), -(win - 1));
  const inWindow = (iso: unknown) => String(iso ?? '') >= from;

  useEffect(() => {
    let live = true;
    void loadSettings().then((s) => live && setSettings(s));
    const unsub = subscribeSettings((s) => live && setSettings(s));
    return () => {
      unsub();
      live = false;
    };
  }, []);

  /* deep link: /progress?entry=<id> opens that row in the editor */
  const entryParam = params.get('entry');
  useEffect(() => {
    if (!entryParam) return;
    const row = entries.find((e) => e.id === entryParam);
    if (!row) return;
    openEditor(row);
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.delete('entry');
        return n;
      },
      { replace: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryParam, entries.length]);

  const openEditor = (row?: AnyRow) => {
    setEditingId(row?.id ?? null);
    setForm({
      id: row?.id ?? newId('prg'),
      label: row?.label ?? '',
      domain: row?.domain ?? 'skin',
      on: row?.on ?? todayISO(),
      metric: row?.metric ?? '',
      value: row?.value ?? '',
      unit: row?.unit ?? '',
      rating: row?.rating ?? 0,
      note: row?.note ?? '',
      linkedGoalId: row?.linkedGoalId ?? '',
      mediaIds: (row?.mediaIds as string[]) ?? []
    });
  };

  /**
   * One row per date: an existing day is patched field by field, and a field
   * left blank is removed rather than written as 0 — "not recorded" and
   * "recorded nothing" are different answers, and only one of them is a zero.
   */
  const saveDay = async (on: string, values: Record<string, number | null>, note: string) => {
    const existing = dayRows.find((r) => String(r.on) === on);
    const data: Record<string, unknown> = { ...(((existing?.data ?? {}) as Record<string, unknown>) ?? {}) };
    for (const [key, value] of Object.entries(values)) {
      if (value === null) delete data[key];
      else data[key] = value;
    }
    if (note.trim()) data.note = note.trim();
    else delete data.note;
    const filled = COVARIATE_FIELDS.filter((f) => data[f.key] !== undefined).length;
    if (filled === 0 && !data.note) {
      if (existing) {
        await softDelete(TABLES.covariateDays, String(existing.id));
        toast(`Nothing left on ${formatDate(on)}, so that day was taken out of the log.`, 'info');
      } else {
        toast('Every field is blank and no words were written, so nothing was stored for that day.', 'bad');
      }
      return;
    }
    await saveRow(TABLES.covariateDays, { id: existing?.id ?? newId('day'), on, data });
    toast(
      `${filled} figure(s) stored for ${formatDate(on)} on covariateDays. All of them are what you remembered — the app measured none of it.`,
      'ok'
    );
  };

  const forgetDay = async (row: AnyRow) => {
    await softDelete(TABLES.covariateDays, String(row.id));
    toast(`${formatDate(row.on)} taken out of the day log. Undo is in the toast.`, 'info');
  };

  const saveEntry = async (draft: Record<string, unknown>) => {
    const row = await saveRow(TABLES.progressEntries, {
      id: String(draft.id),
      label: String(draft.label || 'Untitled check-in'),
      domain: String(draft.domain || 'general'),
      on: String(draft.on || todayISO()),
      metric: String(draft.metric ?? ''),
      value: numOrNull(draft.value),
      unit: String(draft.unit ?? ''),
      rating: numOrNull(draft.rating),
      note: String(draft.note ?? ''),
      mediaIds: (draft.mediaIds as string[]) ?? [],
      linkedGoalId: draft.linkedGoalId ? String(draft.linkedGoalId) : null,
      linkedPlanId: null,
      linkedExperimentId: null
    });
    setForm(null);
    setEditingId(null);
    toast(`“${row.label}” stored on progressEntries. Nothing else was changed.`, 'ok');
  };

  /* ------------------------------------------------------------- computed */

  const activityStreams = useMemo(
    () => [
      { label: 'Routine logs', rows: routineLogs, date: (r: AnyRow) => r.doneOn },
      { label: 'Observations', rows: observations, date: (r: AnyRow) => r.on },
      { label: 'Progress entries', rows: entries, date: (r: AnyRow) => r.on },
      { label: 'Workout sessions', rows: sessions, date: (r: AnyRow) => r.doneOn },
      { label: 'Hair records', rows: hairRecords, date: (r: AnyRow) => r.doneOn }
    ],
    [routineLogs, observations, entries, sessions, hairRecords]
  );

  const byDay = useMemo(() => {
    const m = new Map<string, { n: number; what: string[] }>();
    for (const s of activityStreams) {
      for (const r of s.rows) {
        const d = String(s.date(r) ?? '');
        if (!d || d < from || d > todayISO()) continue;
        const cur = m.get(d) ?? { n: 0, what: [] };
        cur.n += 1;
        if (cur.what.length < 4) cur.what.push(s.label);
        m.set(d, cur);
      }
    }
    return m;
  }, [activityStreams, from]);

  const totalActivity = [...byDay.values()].reduce((a, b) => a + b.n, 0);
  const activeDays = byDay.size;
  const firstLogDate = useMemo(() => {
    const all: string[] = [];
    for (const s of activityStreams) for (const r of s.rows) all.push(String(s.date(r) ?? ''));
    const clean = all.filter(Boolean).sort();
    return clean[0] ?? '';
  }, [activityStreams]);

  const ratingPoints = useMemo(() => {
    const pts: { on: string; v: number; src: string }[] = [];
    for (const e of entries) {
      const v = numOrNull(e.rating);
      if (v === null || !inWindow(e.on)) continue;
      pts.push({ on: String(e.on), v, src: `progress entry — ${e.label}` });
    }
    for (const o of observations) {
      const v = numOrNull(o.data?.rating);
      if (v === null || !inWindow(o.on)) continue;
      pts.push({ on: String(o.on), v, src: `observation on ${o.subjectType}` });
    }
    return pts.sort((a, b) => String(a.on).localeCompare(String(b.on)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, observations, from]);

  const spend = useMemo(() => {
    const rows = purchases.filter((p) => String(p.boughtOn ?? '') >= from && String(p.boughtOn ?? '') <= todayISO());
    const total = rows.reduce((sum, p) => sum + num(p.amount, 0), 0);
    const currencies = [...new Set(rows.map((p) => String(p.currency || '')).filter(Boolean))];
    return { count: rows.length, total, currencies };
  }, [purchases, from]);

  const patchGoal = async (changes: Record<string, unknown>, note: string) => {
    await saveRow(TABLES.goals, changes);
    toast(note, 'ok');
  };

  const countRows: { label: string; n: number; go: string }[] = [
    { label: 'Progress entries', n: entries.length, go: '/progress' },
    { label: 'Routine logs', n: routineLogs.length, go: '/calendar' },
    { label: 'Observations', n: observations.length, go: '/experiments' },
    { label: 'Experiments', n: experiments.length, go: '/experiments' },
    { label: 'Goals', n: goals.length, go: '/progress' },
    { label: 'Workout sessions', n: sessions.length, go: '/fitness' },
    { label: 'Hair records', n: hairRecords.length, go: '/hair' },
    { label: 'Tutorials', n: tutorials.length, go: '/academy' },
    { label: 'Learning paths', n: paths.length, go: '/academy' },
    { label: 'Knowledge notes', n: knowledge.length, go: '/knowledge' },
    { label: 'Calendar events', n: events.length, go: '/calendar' },
    { label: 'Products', n: products.length, go: '/market' },
    { label: 'Purchases', n: purchases.length, go: '/market' },
    { label: 'Clothing items', n: clothing.length, go: '/closet' },
    { label: 'Outfits', n: outfits.length, go: '/closet' },
    { label: 'Photos', n: media.length, go: '/media' },
    { label: 'Measurements', n: measurements.length, go: '/fitness' },
    { label: 'Weight entries', n: weights.length, go: '/fitness' },
    { label: 'Providers', n: providers.length, go: '/services' },
    { label: 'Consultations', n: consultations.length, go: '/services' },
    { label: 'Dental records', n: dental.length, go: '/dental' },
    { label: 'Plans', n: plans.length, go: '/looksmaxxing' },
    { label: 'Assessments', n: assessments.length, go: '/looksmaxxing' }
  ];

  const milestones = useMemo(
    () => buildMilestones({ entries, routineLogs, observations, goals, experiments, tutorials, plans, media, firstLogDate }),
    [entries, routineLogs, observations, goals, experiments, tutorials, plans, media, firstLogDate]
  );

  const photos = useMemo(() => {
    const byId = new Map(media.map((m) => [String(m.id), m]));
    const out: { on: string; label: string; item: AnyRow; entry: AnyRow }[] = [];
    for (const e of entries) {
      for (const id of (e.mediaIds as string[]) ?? []) {
        const item = byId.get(String(id));
        if (item) out.push({ on: String(e.on), label: String(e.label), item, entry: e });
      }
    }
    return out.sort((a, b) => String(a.on).localeCompare(String(b.on)));
  }, [entries, media]);

  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');

  /** What the next check-in photograph should reproduce: the newest stored
   *  `progress` row, taken with whatever condition set that newest row names.
   *  Built from the `media` rows this page already loads — no second query. */
  const photoReference = useMemo(() => {
    const shots = media.filter((m) => m.kind === 'progress' && !m.deletedAt);
    if (!shots.length) return null;
    const newest = shots.slice().sort(byNewestShot)[0];
    const condition = String(newest.conditions ?? '').trim();
    const sameSet = condition ? shots.filter((m) => String(m.conditions ?? '').trim() === condition) : shots;
    return sameSet.slice().sort(byNewestShot)[0] ?? newest;
  }, [media]);
  useEffect(() => {
    if (!photos.length) return;
    setLeftId((cur) => cur || String(photos[0].item.id));
    setRightId((cur) => cur || String(photos[photos.length - 1].item.id));
  }, [photos.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = photos.find((p) => String(p.item.id) === leftId) ?? null;
  const right = photos.find((p) => String(p.item.id) === rightId) ?? null;

  /* ---------------------------------------------------------------- render */

  return (
    <div className="gl-page pg">
      <DeptIntro
        id="progress"
        actions={
          <>
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => openEditor()}>
              Log a check-in
            </Button>
            <Button variant="ghost" icon={<Camera size={14} />} onClick={() => navigate('/media')}>
              Photo library
            </Button>
          </>
        }
        meta={[
          { label: 'Entries stored', value: String(entries.length) },
          { label: `Records in ${win} days`, value: String(totalActivity) },
          { label: 'Days with a record', value: `${activeDays}/${win}` },
          { label: 'First record', value: firstLogDate ? formatDate(firstLogDate) : 'none yet' }
        ]}
      />

      {/* The one thing this department must say out loud. */}
      <Card variant="accent" className="pg-noscore">
        <div className="pg-noscore__icon">
          <ShieldAlert size={20} />
        </div>
        <div>
          <div className="gl-eyebrow" style={{ color: 'var(--glow-metal)' }}>
            Read this before the numbers
          </div>
          <h2 className="gl-display pg-noscore__h">
            There is no attractiveness score in this app, and no score would mean anything. These are counts of what you
            logged.
          </h2>
          <p className="gl-small gl-muted" style={{ margin: '8px 0 0' }}>
            Nothing here measures your face, your body or other people's opinions of you. There is no computer vision, no
            ranking model and no hidden aggregate — the charts draw only numbers you typed and dates you ticked. A rating
            of 4 is your own 4 on your own day; a line through those points is a description of your records, not a
            prediction and not a verdict. Consistency is not progress, and progress is not worth.
          </p>
        </div>
      </Card>

      <div className="gl-row gl-row--between pg-window">
        <SegmentedControl value={days} onChange={setDays} options={WINDOWS} size="sm" />
        <span className="gl-tech gl-faint">
          All counts below use {formatDate(from)} → {formatDate(todayISO())} ({win} days)
        </span>
      </div>

      <div className="pg-work">
        <div className="pg-main">
          <StatStrip
            items={[
              { label: 'Check-ins', value: String(entries.filter((e) => inWindow(e.on)).length), hint: `of ${entries.length} stored` },
              { label: 'Ratings recorded', value: String(ratingPoints.length), hint: ratingPoints.length < 2 ? 'too few for a trend' : 'plotted below' },
              { label: 'Active goals', value: String(goals.filter((g) => g.status === 'active').length), hint: `${goals.length} total` },
              { label: 'Photos linked', value: String(photos.length), hint: `${media.length} in library` },
              { label: 'Money you typed', value: spend.count ? fmtMoney(spend.total, settings?.currency ?? 'USD') : '—', hint: `${spend.count} purchase rows in window` }
            ]}
          />

          <ConsistencyCard
            win={win}
            from={from}
            byDay={byDay}
            streams={activityStreams}
            total={totalActivity}
            routines={routines}
            logs={routineLogs}
          />

          <AdherenceCard routines={routines} logs={routineLogs} win={win} from={from} onGo={() => navigate('/calendar')} />

          <GoalsCard
            goals={goals}
            tables={{
              progressEntries: entries,
              measurements,
              weightEntries: weights,
              hairRecords,
              workoutSessions: sessions,
              routineLogs
            }}
            onEdit={(changes, note) => void patchGoal(changes, note)}
            onGo={() => navigate('/looksmaxxing')}
          />

          <RatingsCard points={ratingPoints} win={win} />

          <DayLogCard dayRows={dayRows} entries={entries} logs={routineLogs} onSave={saveDay} onForget={(r) => void forgetDay(r)} />

          <TrendCard
            measurements={measurements}
            weights={weights}
            entries={entries}
            hairRecords={hairRecords}
            onGo={() => navigate('/fitness?tab=log')}
          />

          <BodyCard
            settings={settings}
            measurements={measurements}
            weights={weights}
            from={from}
            win={win}
            onToggle={async (key, value) => {
              const next = await updateSettings({ [key]: value } as Partial<AppSettings>);
              setSettings(next);
              toast(
                value
                  ? 'Body data switched on. This only reveals charts for rows you already typed — the app still measures nothing itself.'
                  : 'Body data switched off. Existing rows are kept; they are just not charted here.',
                'ok'
              );
            }}
            onGo={() => navigate('/fitness')}
          />

          <PhotoCard
            photos={photos}
            left={left}
            right={right}
            leftId={leftId}
            rightId={rightId}
            setLeftId={setLeftId}
            setRightId={setRightId}
            onOpenEntry={(e) => openEditor(e)}
            onNewEntry={() => openEditor()}
            onGoMedia={() => navigate('/media')}
            entriesCount={entries.length}
          />

          <LedgerCard
            entries={entries}
            onNew={() => openEditor()}
            onEdit={(e) => openEditor(e)}
            onAskDrop={setAskDrop}
            win={win}
            from={from}
          />

          <Section
            eyebrow="Real dates only"
            title="Milestones"
            description="Built from stored rows: the first entry of each kind, goals marked completed, experiments closed with your verdict, and plan milestones with the date you ticked them. No anniversary is invented, and no milestone is inferred from a gap."
          >
            {milestones.length === 0 ? (
              <EmptyState
                title="No milestones yet"
                body="A milestone appears as soon as a first row exists — your first routine log would be one. Log a check-in and it will start here."
                action={
                  <Button variant="primary" icon={<Plus size={14} />} onClick={() => openEditor()}>
                    Log the first check-in
                  </Button>
                }
              />
            ) : (
              <ol className="pg-milestones">
                {milestones.map((m, i) => (
                  <li key={`${m.on}-${i}`} className="pg-milestone">
                    <span className="pg-milestone__date gl-tech">{formatDate(m.on)}</span>
                    <span className="pg-milestone__dot" aria-hidden />
                    <span className="pg-milestone__body">
                      <span className="pg-milestone__t">{m.title}</span>
                      <span className="gl-small gl-muted">{m.body}</span>
                      {m.note ? <span className="gl-tech gl-faint pg-milestone__note">{m.note}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>

        <aside className="pg-side gl-rule-col">
          <Card>
            <CardHead
              eyebrow="Store census"
              title="Counts by department"
              sub="How many rows each table actually holds. This is a file count, not an achievement."
            />
            <DistributionBars
              rows={countRows
                .filter((c) => c.n > 0)
                .map((c) => ({ label: c.label, value: c.n, tone: 'var(--glow-metal)' }))}
            />
            {!countRows.some((c) => c.n > 0) ? (
              <p className="gl-small gl-muted">Nothing is stored yet — the census fills as you use the app.</p>
            ) : (
              <div className="pg-census-links">
                {[...new Map(countRows.filter((c) => c.n > 0).map((c) => [c.go, c.label])).values()].slice(0, 12).map((label) => {
                  const c = countRows.find((x) => x.label === label)!;
                  return (
                    <button key={c.go + label} type="button" className="gl-btn gl-btn--link gl-btn--sm" onClick={() => navigate(c.go)}>
                      {c.label} · {c.n}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <CardHead eyebrow="Audit" title="Where each number comes from" />
            <div className="gl-stack" style={{ gap: 'var(--glow-sp-2)' }}>
              {[
                ['Days with a record', 'unique dates across routineLogs, observations, progressEntries, workoutSessions, hairRecords inside the window.'],
                ['Routine adherence', 'days with a log for that routine ÷ days in the window. Both integers are printed.'],
                ['Goal progress', 'your typed current value ÷ your typed target value. Missing either one and the bar is withheld.'],
                ['Rating trend', 'the rating column you filled in. One point is never drawn as a line.'],
                ['Spend', 'the amounts you typed on purchase rows. No prices are stored by the app itself.'],
                ['Photos', 'mediaItems linked from a check-in. Comparison is display only — no pixels are analysed.']
              ].map(([k, v]) => (
                <div key={k} className="pg-audit">
                  <div className="gl-label">{k}</div>
                  <p className="gl-small gl-muted" style={{ margin: '2px 0 0' }}>
                    {v}
                  </p>
                </div>
              ))}
            </div>
            <Disclosure summary="What this page deliberately does not do">
              <ul className="pg-ul">
                <li>No score out of 10, no letter grade, no percentile, no “looks rating”.</li>
                <li>No comparison against other users — there are no other users.</li>
                <li>No before/after judgement: the slider shows two of your own photographs, nothing more.</li>
                <li>No trend line, projection or smoothing beyond the points you logged.</li>
                <li>No measurement entered by the app; body data is hidden entirely while the setting is off.</li>
              </ul>
            </Disclosure>
          </Card>

          <Card>
            <CardHead eyebrow="Rows on this page" title="Written back where" />
            <Table
              columns={[
                { label: 'Table', render: (r: AnyRow) => <span className="gl-tech">{r.table}</span> },
                { label: 'What changes', render: (r: AnyRow) => <span className="gl-small">{r.what}</span> }
              ]}
              rows={[
                { table: 'progressEntries', what: 'check-ins you log, edit or delete here' },
                { table: 'goals', what: 'the current value and status you set on your own goal rows' },
                { table: 'settings', what: 'the two body-data switches you flip on this page' },
                { table: 'logs', what: 'one capture row per check-in, so the audit trail shows it happened' }
              ]}
              keyOf={(r) => String(r.table)}
            />
          </Card>
        </aside>
      </div>

      {form ? (
        <EntryForm
          key={`${editingId ?? 'new'}:${String(form.id)}`}
          draft={form}
          goals={goals}
          referenceRow={photoReference}
          onChange={setForm}
          onClose={() => {
            setForm(null);
            setEditingId(null);
          }}
          onSave={saveEntry}
          editing={Boolean(editingId)}
        />
      ) : null}

      <Modal
        open={Boolean(askDrop)}
        onClose={() => setAskDrop(null)}
        title="Delete this check-in?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAskDrop(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 size={13} />}
              onClick={async () => {
                if (!askDrop) return;
                await softDelete(TABLES.progressEntries, askDrop.id);
                toast('Check-in deleted. Any photograph it referenced stays in your media library.', 'ok');
                setAskDrop(null);
              }}
            >
              Delete check-in
            </Button>
          </>
        }
      >
        <p className="gl-small">
          <b>{askDrop?.label}</b> ({askDrop ? formatDate(String(askDrop.on)) : ''}) leaves every chart on this page: the
          consistency counts, the rating points and the ledger. Deleting the row does not delete the photographs it linked —
          those live in your media library and you can remove them there.
        </p>
        <p className="gl-tech gl-faint" style={{ marginBottom: 0 }}>
          Soft delete: the row keeps its id and can be restored from Settings until you clear it.
        </p>
      </Modal>
    </div>
  );
}

/* ----------------------------------------------------------- consistency */

function ConsistencyCard({
  win,
  from,
  byDay,
  streams,
  total,
  routines,
  logs
}: {
  win: number;
  from: string;
  byDay: Map<string, { n: number; what: string[] }>;
  streams: { label: string; rows: AnyRow[]; date: (r: AnyRow) => unknown }[];
  total: number;
  routines: AnyRow[];
  logs: AnyRow[];
}) {
  const days = useMemo(() => {
    const out: { date: string; level: number; title?: string }[] = [];
    let max = 1;
    for (const v of byDay.values()) max = Math.max(max, v.n);
    for (let i = win - 1; i >= 0; i -= 1) {
      const d = addDays(todayISO(), -i);
      const hit = byDay.get(d);
      const level = hit ? Math.min(4, Math.max(1, Math.ceil((hit.n / max) * 4))) : 0;
      out.push({
        date: d,
        level,
        title: hit ? `${hit.n} record(s) — ${[...new Set(hit.what)].join(', ')}` : 'no record'
      });
    }
    return out;
  }, [byDay, win]);

  const longest = useMemo(() => {
    let best = 0;
    let run = 0;
    for (const d of days) {
      run = d.level > 0 ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return best;
  }, [days]);

  const perStream = streams.map((s) => ({
    label: s.label,
    value: s.rows.filter((r) => String(s.date(r) ?? '') >= from && String(s.date(r) ?? '') <= todayISO()).length
  }));

  const activeCount = routines.filter((r) => r.active).length;

  return (
    <Card className="pg-consistency">
      <CardHead
        eyebrow="Consistency"
        title={`${byDay.size} of ${win} days carry a record`}
        sub={`${total} dated rows in this window · longest unbroken stretch ${longest} day${longest === 1 ? '' : 's'} · ${activeCount} routine(s) marked active, ${logs.length} log rows ever`}
      />
      {total === 0 ? (
        <EmptyState
          title="Nothing logged in this window"
          body="The strip stays empty because there is nothing to draw. Add a check-in, or tick a routine on the calendar page, and the squares fill from those rows."
          icon={<Activity size={20} />}
        />
      ) : (
        <>
          <HeatStrip days={days} />
          <div className="pg-streams">
            <DistributionBars rows={perStream.filter((s) => s.value > 0)} />
          </div>
          <div className="gl-row gl-row--between pg-strip-legend">
            <span className="gl-tech gl-faint">darkest square = the busiest day in this window</span>
            <span className="gl-tech gl-faint">an empty day is data, not a failure</span>
          </div>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------- adherence */

function AdherenceCard({
  routines,
  logs,
  win,
  from,
  onGo
}: {
  routines: AnyRow[];
  logs: AnyRow[];
  win: number;
  from: string;
  onGo: () => void;
}) {
  const active = routines.filter((r) => r.active);
  const rows = active.map((r) => {
    const mine = logs.filter((l) => l.routineId === r.id);
    const inWin = mine.filter((l) => String(l.doneOn) >= from && String(l.doneOn) <= todayISO());
    const steps = ((r.steps as AnyRow[]) ?? []).length;
    const full = inWin.filter((l) => steps > 0 && ((l.completedSteps as string[]) ?? []).length >= steps).length;
    return { r, days: inWin.length, full, total: mine.length, steps };
  });

  const overall = rows.length ? Math.round((rows.reduce((a, b) => a + b.days, 0) / (rows.length * win)) * 100) : 0;

  return (
    <Section
      eyebrow="Adherence"
      title="Routine logs against the window"
      description="The denominator is the number of days in the window multiplied by the number of active routines. A 12-month window with four active routines asks for 480 log rows; anything less is a smaller number, honestly shown."
      right={
        <Button size="sm" variant="ghost" onClick={onGo}>
          Open calendar
        </Button>
      }
    >
      {active.length === 0 ? (
        <EmptyState
          title="No active routines to grade"
          body="Adherence needs a routine with steps and an active flag. Create one on the calendar page; this page will not assume a routine for you."
          action={
            <Button variant="primary" onClick={onGo}>
              Go to Calendar & Routines
            </Button>
          }
        />
      ) : (
        <>
          <div className="pg-overall">
            <Stat
              label="Overall adherence"
              value={`${pct(overall)} of ${rows.length * win} possible routine-days`}
              hint={`${rows.reduce((a, b) => a + b.days, 0)} log rows in the window`}
            />
            <span className="gl-tech gl-faint pg-overall__note">
              Only counted for routines you marked active. Pausing a routine removes it from the denominator — that is a
              real change to the maths, so the count of routines is printed above.
            </span>
          </div>
          <div className="pg-adherence">
            {rows
              .sort((a, b) => b.days - a.days)
              .map(({ r, days, full, total, steps }) => (
                <div key={r.id} className="pg-adh">
                  <div className="pg-adh__head">
                    <span className="pg-adh__name">{r.name}</span>
                    <span className="gl-tech gl-faint">
                      {days}/{win} days
                      {steps ? ` · ${full} fully ticked` : ' · no steps'}
                    </span>
                  </div>
                  <Meter value={(days / win) * 100} />
                  <span className="gl-tech gl-faint pg-adh__foot">
                    {total} rows ever logged · domain {String(r.domain ?? '—')} · {String(r.timeOfDay ?? '')}
                  </span>
                </div>
              ))}
          </div>
        </>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ goals */

function GoalsCard({
  goals,
  tables,
  onEdit,
  onGo
}: {
  goals: AnyRow[];
  tables: GoalTables;
  onEdit: (changes: Record<string, unknown>, note: string) => void;
  onGo: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const list = (showAll ? goals : goals.filter((g) => g.status === 'active' || g.status === 'paused')).slice(0, 40);

  if (!goals.length) {
    return (
      <Section eyebrow="Goals" title="Nothing to measure against">
        <EmptyPlate
          kicker="No goal rows"
          title="A goal needs a target you typed"
          body="Progress here is current ÷ target, both stored on the goal row. Goals are written in the Looksmaxxing plan and the profile; nothing is suggested on your behalf."
          action={
            <Button variant="primary" onClick={onGo}>
              Review the goal list
            </Button>
          }
        />
      </Section>
    );
  }

  return (
    <Section
      eyebrow="Goals"
      title="Your typed targets, your typed current"
      description="The bar uses the value you stored in `current` on the goal row. If you never filled it, the app looks through every table that can hold this goal's metric — check-ins, measurements by site, weigh-ins, hair lengths, sessions this week, days logged — and offers what it finds, each with the rule that made it. Nothing is applied until you press it."
      right={
        <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Active & paused only' : `Show all ${goals.length}`}
        </Button>
      }
    >
      <div className="pg-goals">
        {list.map((g) => {
          const target = numOrNull(g.targetValue);
          const current = numOrNull(g.data?.current);
          const currentNote = String(g.data?.currentNote ?? '');
          const found = offersForGoal(g, tables, { today: todayISO() });
          /* the bar reads the committed value first; an offer only fills the gap
             when she has typed nothing, and still needs her hand on the button */
          const used = current ?? (found.offers.length ? found.offers[0].value : null);
          const done = target && used !== null && target !== 0 ? Math.min(100, Math.round((used / target) * 100)) : null;
          const daysLeft = g.targetOn ? Math.round((new Date(String(g.targetOn)).getTime() - Date.now()) / 86400000) : null;
          return (
            <Card key={g.id} className="pg-goal">
              <div className="pg-goal__head">
                <div style={{ minWidth: 0 }}>
                  <div className="gl-eyebrow">
                    {String(g.domain ?? 'general')} · {String(g.status ?? 'active')}
                    {g.priority ? ` · priority ${g.priority}` : ''}
                  </div>
                  <h3 className="gl-serif pg-goal__t">{String(g.title)}</h3>
                </div>
                <div className="pg-goal__ring">
                  <ProgressRing
                    value={done ?? 0}
                    size={78}
                    label={done === null ? '—' : `${done}%`}
                    sub={done === null ? 'no numbers' : `target ${g.targetValue}${g.unit ? ` ${g.unit}` : ''}`}
                  />
                </div>
              </div>

              {done === null ? (
                <p className="gl-small gl-muted" style={{ margin: 0 }}>
                  {target === null
                    ? 'No target value stored on this row, so there is no percentage to show. Fill it in and the bar appears.'
                    : current === null && !found.offers.length
                      ? `Target is ${g.targetValue}${g.unit ? ` ${g.unit}` : ''}. Nothing yet records the metric “${String(g.metric || 'unnamed')}”.`
                      : 'Cannot compute — a value is unreadable.'}
                </p>
              ) : (
                <Meter value={done} />
              )}

              <div className="pg-goal__fields">
                <Field label="Current value" hint="Stored on this goal row when you commit it. The app never fills it in.">
                  <CurrentField
                    current={current}
                    onCommit={(v, note) => onEdit({ ...g, data: { ...(g.data ?? {}), current: v, currentNote: note } }, note)}
                  />
                </Field>
                <Field label="Metric / unit">
                  <div className="gl-tech gl-small">
                    {String(g.metric || 'no metric named')}
                    {g.unit ? ` · ${g.unit}` : ''}
                  </div>
                </Field>
                <Field label="Dates on the row">
                  <div className="gl-small">
                    {g.startOn ? `start ${formatDate(String(g.startOn))}` : 'no start date'}
                    {g.targetOn ? ` · target ${formatDate(String(g.targetOn))}` : ' · no target date'}
                    {daysLeft !== null ? (
                      <span className="gl-tech gl-faint"> · {daysLeft >= 0 ? `${daysLeft} days left` : `${-daysLeft} days past`}</span>
                    ) : null}
                  </div>
                </Field>
                <Field label="Status">
                  <Select
                    value={String(g.status ?? 'active')}
                    onChange={(v) => onEdit({ ...g, status: v }, `Goal marked ${v} on its own row.`)}
                    options={['active', 'paused', 'completed', 'dropped'].map((s) => ({ value: s, label: s }))}
                  />
                </Field>
              </div>

              {current !== null && currentNote ? (
                <p className="gl-tech gl-faint" style={{ margin: '-6px 0 0' }}>
                  {currentNote}
                </p>
              ) : null}

              <GoalOffers
                offers={current === null ? found.offers : []}
                notes={current === null && !found.offers.length ? found.notes : []}
                onCommit={(offer) =>
                  onEdit(
                    { ...g, data: { ...(g.data ?? {}), current: offer.value, currentNote: commitNote(offer) } },
                    commitNote(offer)
                  )
                }
              />

              <div className="gl-row gl-row--tight" style={{ marginTop: 10 }}>
                <Chip>{g.planId ? 'linked to a plan' : 'no plan linked'}</Chip>
                <Chip tone="info">
                  {(tables.progressEntries ?? []).filter((e) => e.linkedGoalId === g.id).length} check-ins reference it
                </Chip>
                <span className="gl-tech gl-faint">row last written {formatDate(todayISO(g.updatedAt))}</span>
              </div>
            </Card>
          );
        })}
        {!list.length ? <p className="gl-small gl-muted">No active or paused goals — “Show all” lists the rest.</p> : null}
      </div>
    </Section>
  );
}

function CurrentField({
  current,
  onCommit
}: {
  current: number | null;
  onCommit: (v: number | null, note: string) => void;
}) {
  const [text, setText] = useState(current === null ? '' : String(current));
  useEffect(() => setText(current === null ? '' : String(current)), [current]);
  const dirty = text !== (current === null ? '' : String(current));

  return (
    <div className="pg-goal__current">
      <TextInput
        type="number"
        value={text}
        onChange={setText}
        onEnter={() => dirty && onCommit(numOrNull(text), 'Current value saved to the goal row.')}
        placeholder="what it is today"
        aria-label="Current value for this goal"
      />
      {dirty ? (
        <Button size="sm" variant="primary" onClick={() => onCommit(numOrNull(text), 'Current value saved to the goal row.')}>
          Save {text === '' ? 'blank' : text}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * What the other tables say about this goal, with the rule attached to each
 * number. Only shown while `current` is still empty, and pressing one is the
 * only way it reaches the goal row.
 */
function GoalOffers({
  offers,
  notes,
  onCommit
}: {
  offers: GoalOffer[];
  notes: string[];
  onCommit: (offer: GoalOffer) => void;
}) {
  if (!offers.length && !notes.length) return null;

  return (
    <div className="pg-goal__offers">
      <div className="gl-eyebrow">Offered from your own rows — nothing is filled in until you press one</div>
      {offers.map((o) => (
        <div className="pg-offer" key={`${o.source}-${o.rowId}`}>
          <div className="pg-offer__head">
            <span className="gl-tech">
              {o.label}: {o.value}
              {o.unit ? ` ${o.unit}` : ''}
              {o.on ? ` · ${formatDate(o.on)}` : o.windowDays ? ` · last ${o.windowDays} days` : ''}
            </span>
            {o.unitDiffers ? <Chip tone="limited">unit differs from the goal row</Chip> : null}
            <Button size="sm" variant="ghost" onClick={() => onCommit(o)}>
              Use {o.value}
            </Button>
          </div>
          <p className="gl-small gl-muted" style={{ margin: '4px 0 0' }}>
            {o.rule}
          </p>
        </div>
      ))}
      {notes.map((n) => (
        <p className="gl-small gl-muted" key={n} style={{ margin: 0 }}>
          {n}
        </p>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- ratings */

function RatingsCard({ points, win }: { points: { on: string; v: number; src: string }[]; win: number }) {
  const labels = points.map((p) => p.on);
  const avg = points.length ? points.reduce((a, p) => a + p.v, 0) / points.length : null;
  const spread = points.length ? `${Math.min(...points.map((p) => p.v))}–${Math.max(...points.map((p) => p.v))}` : '—';

  return (
    <Section
      eyebrow="Self-reported"
      title="Rating trend"
      description={`These are your own numbers on a 1–5 scale you chose, from progress entries and observations in the last ${win} days. The scale is yours, it is not calibrated, and equal steps between 2 and 3 do not mean equal change.`}
    >
      {points.length < 2 ? (
        <EmptyPlate
          kicker={`${points.length} rating${points.length === 1 ? '' : 's'} found`}
          title={points.length === 0 ? 'Nothing has been rated yet' : 'One point is not a trend'}
          body="Drawing a line through a single rating would invent a direction that the data does not contain, so the chart stays off. Log a second dated rating — a check-in with a star value, or an experiment check-in — and the two points will be joined and labelled with their dates."
        />
      ) : (
        <>
          <LineChart
            labels={labels}
            series={[{ label: 'Your rating', data: points.map((p) => p.v), area: true }]}
            height={230}
            yTitle="your 1–5 scale"
          />
          <div className="gl-row gl-row--between pg-ratings__foot">
            <span className="gl-tech gl-faint">
              mean {avg ? avg.toFixed(2) : '—'} · range {spread} · {points.length} points
            </span>
            <span className="gl-tech gl-faint">mean and range are arithmetic over those {points.length} rows</span>
          </div>
          <ol className="pg-ratings__list">
            {points
              .slice()
              .reverse()
              .slice(0, 12)
              .map((p, i) => (
                <li key={`${p.on}-${i}`}>
                  <span className="gl-tech">{formatDate(p.on)}</span>
                  <Rating value={p.v} size={13} />
                  <span className="gl-small gl-muted">{p.src}</span>
                </li>
              ))}
          </ol>
        </>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------ body data */

/**
 * The day strip: what the day actually held, as she remembers it.
 *
 * Nothing here is measured. The app cannot know how many hours she slept, so
 * every field is something she types, and a blank stays "not recorded" rather
 * than becoming a zero. The read underneath only splits the days she has
 * already rated herself and compares her own numbers between the two groups.
 */
function DayLogCard({
  dayRows,
  entries,
  logs,
  onSave,
  onForget
}: {
  dayRows: AnyRow[];
  entries: AnyRow[];
  logs: AnyRow[];
  onSave: (on: string, values: Record<string, number | null>, note: string) => Promise<void>;
  onForget: (row: AnyRow) => void;
}) {
  const today = todayISO();
  const [picked, setPicked] = useState(today);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const days = useMemo(() => daysFromRows(dayRows), [dayRows]);
  const byDate = useMemo(() => new Map(dayRows.map((r) => [String(r.on), r])), [dayRows]);

  /* the draft follows whichever date is picked */
  useEffect(() => {
    const row = byDate.get(picked);
    const data = (row?.data ?? {}) as Record<string, unknown>;
    const next: Record<string, string> = {};
    for (const f of COVARIATE_FIELDS) {
      const v = data[f.key];
      next[f.key] = v === null || v === undefined ? '' : String(v);
    }
    setDraft(next);
    setNote(String(data.note ?? ''));
  }, [picked, byDate]);

  const signals = useMemo(
    () =>
      mergeSignals(
        signalsFromRows(entries, { field: 'rating', source: 'your rating on a check-in', min: 1, max: 5 }),
        signalsFromRows(logs, { field: 'mood', source: 'the mood you noted on a routine log', min: 1, max: 5 })
      ),
    [entries, logs]
  );
  const split = useMemo(() => splitByRatings(days, signals), [days, signals]);
  const covered = useMemo(() => coverage(days), [days]);

  const strip = useMemo(() => {
    const filled = new Map(days.map((d) => [d.on, Object.keys(d.values).length]));
    return Array.from({ length: 14 }, (_, i) => addDays(today, -i)).map((on) => ({ on, filled: filled.get(on) ?? 0 }));
  }, [days, today]);

  const save = async () => {
    setBusy(true);
    try {
      const values: Record<string, number | null> = {};
      for (const f of COVARIATE_FIELDS) values[f.key] = numOrNull(draft[f.key]);
      await onSave(picked, values, note);
    } finally {
      setBusy(false);
    }
  };

  const existing = byDate.get(picked);
  const anyField = COVARIATE_FIELDS.some((f) => draft[f.key] !== undefined && draft[f.key] !== '');

  return (
    <Section
      eyebrow="The days themselves"
      title="What the day held"
      description="Sleep, alcohol, fluids, salty meals, stress and — if you track one — cycle day. These are the levers the advice in this app keeps naming, and until now nothing held a dated number for them, so the app could never show you your own pattern. Every field is something you remember and type: nothing here is measured by a device, and a blank stays a blank rather than becoming a zero."
    >
      <div className="pg-day__strip" role="group" aria-label="Recent days">
        {strip.map((d) => (
          <Chip key={d.on} active={d.on === picked} onClick={() => setPicked(d.on)} title={formatDate(d.on)}>
            {formatDate(d.on).slice(0, 6)}
            <span className="pg-day__count">{d.filled ? `${d.filled}/6` : '—'}</span>
          </Chip>
        ))}
      </div>

      <Card className="pg-day__editor">
        <CardHead
          eyebrow={existing ? 'editing a logged day' : 'nothing logged for this date yet'}
          title={formatDate(picked)}
          sub="Saved as one row on covariateDays, one per date. Tap another date above to change that day instead."
          right={
            existing ? (
              <IconButton label="Forget this day" onClick={() => onForget(existing)}>
                <Trash2 size={13} />
              </IconButton>
            ) : undefined
          }
        />
        <div className="pg-day__fields">
          {COVARIATE_FIELDS.map((f) => (
            <Field key={f.key} label={`${f.label}${f.unit ? ` (${f.unit})` : ''}`} hint={f.ask}>
              <TextInput
                type="number"
                value={draft[f.key] ?? ''}
                placeholder={f.optional ? 'blank if you do not track this' : 'blank = not recorded'}
                onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
              />
            </Field>
          ))}
        </div>
        <Field label="Words about the day" hint="Shift work, a flight, a bad night, a wedding. Kept verbatim.">
          <TextArea rows={2} value={note} onChange={setNote} placeholder="anything that made this day unrepresentative" />
        </Field>
        <div className="pg-day__foot">
          <span className="gl-tech gl-faint">
            {anyField ? 'stored on this device only — the app measured none of it' : 'leave a field blank and it stays “not recorded”'}
          </span>
          <Button size="sm" variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : existing ? 'Update this day' : 'Log this day'}
          </Button>
        </div>
      </Card>

      <Card className="pg-day__read">
        <CardHead
          eyebrow={`${days.length} day(s) logged · ${split.ratedDays} rated day(s) to split`}
          title="Your good days against your off days"
          sub="Groups come from ratings you already gave — a 1–5 on a check-in, else the mood on a routine log — not from anything the app scored."
        />
        <p className="gl-small" style={{ margin: '0 0 6px' }}>
          {split.headline}
        </p>
        {split.reads.map((r) => (
          <div className="pg-day__verdict" key={r.key}>
            <Chip tone={r.verdict === 'worth-a-look' ? 'gold' : r.verdict === 'noise-sized' ? 'info' : 'moderate'}>{r.label}</Chip>
            <span className="gl-small">{r.sentence}</span>
          </div>
        ))}
        <p className="gl-tech gl-faint" style={{ margin: '10px 0 0' }}>
          {covered.map((c) => `${c.short}: ${c.days} day(s)`).join(' · ')}
        </p>
        <p className="gl-small gl-muted" style={{ margin: '8px 0 0' }}>
          {split.note}
        </p>
      </Card>
    </Section>
  );
}

/**
 * Direction, printed with the noise around it. Every line is a least-squares
 * fit over dated numbers she typed; the scatter of her own entries decides
 * whether a fitted change is worth calling a trend at all.
 */
function TrendCard({
  measurements,
  weights,
  entries,
  hairRecords,
  onGo
}: {
  measurements: AnyRow[];
  weights: AnyRow[];
  entries: AnyRow[];
  hairRecords: AnyRow[];
  onGo: () => void;
}) {
  const reads = useMemo(() => {
    const rows = [
      ...measurements.map((m) => ({
        on: String(m.takenOn ?? ''),
        value: m.value,
        metric: `${String(m.site || 'site')} (${String(m.kind || 'body')})`,
        unit: String(m.unit ?? '')
      })),
      ...weights.map((w) => ({ on: String(w.loggedOn ?? ''), value: w.kg, metric: 'Body weight', unit: 'kg' })),
      ...entries
        .filter((e) => String(e.metric ?? '').trim() && numOrNull(e.value) !== null)
        .map((e) => ({ on: String(e.on ?? ''), value: e.value, metric: String(e.metric), unit: String(e.unit ?? '') })),
      ...hairRecords
        .filter((h) => numOrNull(h.lengthCm) !== null)
        .map((h) => ({ on: String(h.doneOn ?? ''), value: h.lengthCm, metric: 'Hair length', unit: 'cm' }))
    ];
    return trendByMetric(rows as never)
      .sort((a, b) => Number(b.usable) - Number(a.usable) || String(b.to).localeCompare(String(a.to)));
  }, [measurements, weights, entries, hairRecords]);

  const shown = reads.slice(0, 8);

  return (
    <Section
      eyebrow="Fitted line, and the bounce around it"
      title="Direction, with its noise"
      description="A straight line through the dated numbers you logged, per metric and per unit — never mixed across them. The fitted change is printed next to the scatter of your own readings, because a change smaller than the bounce around it is not a trend. Under five points or under three weeks the read refuses and names what it would need."
      right={
        <Button size="sm" variant="ghost" onClick={onGo}>
          Where the numbers live
        </Button>
      }
    >
      {shown.length === 0 ? (
        <EmptyPlate
          kicker="no dated numbers"
          title="Nothing to fit yet"
          body="This read only draws a line through values you have already stored: measurements with a site and a date, weights, a numeric metric on a check-in, or hair length on a hair record. None of those tables hold a dated number yet, so there is nothing to fit and nothing is invented to fill the space."
        />
      ) : (
        <div className="pg-trends">
          {shown.map((t) => (
            <Card key={`${t.metric}-${t.unit}`} className="pg-trend">
              <div className="pg-trend__head">
                <h3 className="gl-serif pg-trend__t">{String(t.metric || t.unit || 'unnamed metric')}</h3>
                <Chip tone={t.direction === 'rising' ? 'gold' : t.direction === 'falling' ? 'moderate' : t.direction === 'flat' ? 'info' : 'limited'}>
                  {t.usable ? t.direction : 'not enough'}
                </Chip>
              </div>
              <p className="gl-small" style={{ margin: 0 }}>
                {t.sentence}
              </p>
              <p className="gl-tech gl-faint" style={{ margin: '6px 0 0' }}>
                n {t.n} · span {t.spanDays}d · scatter ±{t.rmse ?? '—'}
                {t.unit ? ` ${t.unit}` : ''} · {t.skipped ? `${t.skipped} blank or undated row(s) skipped` : 'no rows skipped'}
              </p>
            </Card>
          ))}
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------ body data */

function BodyCard({
  settings,
  measurements,
  weights,
  from,
  win,
  onToggle,
  onGo
}: {
  settings: AppSettings | null;
  measurements: AnyRow[];
  weights: AnyRow[];
  from: string;
  win: number;
  onToggle: (key: 'measurementsTracking' | 'weightTracking', value: boolean) => void;
  onGo: () => void;
}) {
  const measOn = Boolean(settings?.measurementsTracking);
  const weightOn = Boolean(settings?.weightTracking);
  const meas = measOn ? measurements.filter((m) => String(m.takenOn) >= from) : [];
  const wt = weightOn ? weights.filter((w) => String(w.loggedOn) >= from) : [];

  const sites = useMemo(() => {
    const bySite = new Map<string, AnyRow[]>();
    for (const m of meas) {
      const k = `${m.kind} · ${String(m.site || 'unspecified')}`;
      bySite.set(k, [...(bySite.get(k) ?? []), m]);
    }
    return [...bySite.entries()]
      .map(([label, rows]) => {
        const sorted = rows.slice().sort((a, b) => String(a.takenOn).localeCompare(String(b.takenOn)));
        return {
          label,
          rows: sorted,
          unit: String(sorted[sorted.length - 1]?.unit ?? ''),
          first: numOrNull(sorted[0]?.value),
          last: numOrNull(sorted[sorted.length - 1]?.value)
        };
      })
      .filter((s) => s.rows.length >= 2)
      .sort((a, b) => b.rows.length - a.rows.length)
      .slice(0, 4);
  }, [meas]);

  const dates = [...new Set(meas.map((m) => String(m.takenOn)))].sort();

  return (
    <Card className="pg-body">
      <CardHead
        eyebrow="Optional, off by default"
        title="Measurements & weight"
        sub="Both panels are hidden until you switch them on. The app cannot take a measurement, cannot weigh you and has no camera-based estimation — it only charts numbers you typed."
      />

      <div className="pg-body__switches">
        <Toggle
          checked={measOn}
          onChange={(v) => onToggle('measurementsTracking', v)}
          label="Show measurement charts"
          hint={`${measurements.length} measurement rows stored${measOn ? ` · ${meas.length} in this ${win}-day window` : ''}`}
        />
        <Toggle
          checked={weightOn}
          onChange={(v) => onToggle('weightTracking', v)}
          label="Show weight chart"
          hint={`${weights.length} weight rows stored${weightOn ? ` · ${wt.length} in this window` : ''}`}
        />
      </div>

      {!measOn && !weightOn ? (
        <SafetyBanner tone="note" title="Both switches are off">
          <p className="gl-small" style={{ margin: 0 }}>
            Nothing is hidden from you here — there is simply no panel. Turning a switch on does not start tracking: it
            only plots rows you already typed on the Body &amp; Fitness page. If those tables are empty the chart stays
            empty, and turning weight tracking off does not delete history.
          </p>
          <div style={{ marginTop: 8 }}>
            <Button size="sm" variant="ghost" onClick={onGo}>
              Go to Body &amp; Fitness
            </Button>
          </div>
        </SafetyBanner>
      ) : (
        <div className="pg-body__grid">
          {measOn ? (
            <div className="pg-body__panel">
              <div className="gl-label">Circumference &amp; length entries you typed</div>
              {sites.length === 0 ? (
                <p className="gl-small gl-muted">
                  {meas.length < 2
                    ? `Only ${meas.length} measurement row(s) in this window — a line needs two. Switch the window to 12 months, or add one on the fitness page.`
                    : 'No site has two dated rows yet, so no site is charted.'}
                </p>
              ) : (
                <>
                  <LineChart
                    labels={dates}
                    series={sites.map((s) => {
                      const map = new Map(s.rows.map((r) => [String(r.takenOn), numOrNull(r.value)]));
                      return { label: `${s.label} (${s.unit})`, data: dates.map((d) => map.get(d) ?? null) };
                    })}
                    height={220}
                    yTitle="your unit, as typed"
                  />
                  <ul className="pg-body__delta">
                    {sites.map((s) => (
                      <li key={s.label}>
                        <span className="gl-serif">{s.label}</span>
                        <span className="gl-tech gl-faint">
                          {s.rows.length} rows · {s.first} → {s.last} {s.unit} ·{' '}
                          {s.first !== null && s.last !== null ? `difference ${Number((s.last - s.first).toFixed(2))}` : '—'}{' '}
                          <em className="pg-plain">plain subtraction, no trend fitted</em>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : null}

          {weightOn ? (
            <div className="pg-body__panel">
              <div className="gl-label">Weight rows you typed (kg as stored)</div>
              {wt.length < 2 ? (
                <p className="gl-small gl-muted">
                  {wt.length} of {weights.length} weight rows fall in this window. Two or more are needed before a line is
                  honest; until then the values are listed instead of plotted.
                </p>
              ) : (
                <>
                  <LineChart
                    labels={[...new Set(wt.map((w) => String(w.loggedOn)))].sort()}
                    series={[{ label: 'kg', data: [...new Set(wt.map((w) => String(w.loggedOn)))].sort().map((d) => numOrNull(wt.find((w) => String(w.loggedOn) === d)?.kg)), stepped: true }]}
                    height={220}
                    yTitle="kg as you logged it"
                  />
                  <p className="gl-tech gl-faint" style={{ margin: 0 }}>
                    {wt.length} rows · {wt.length} weigh-ins you recorded · first {formatDate(String(wt[0]?.loggedOn))} ·
                    latest {formatDate(String(wt[wt.length - 1]?.loggedOn))} · daily fluctuation is not removed, because
                    nothing here can know what caused it.
                  </p>
                </>
              )}
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- photos */

function PhotoCard({
  photos,
  left,
  right,
  leftId,
  rightId,
  setLeftId,
  setRightId,
  onOpenEntry,
  onNewEntry,
  onGoMedia,
  entriesCount
}: {
  photos: { on: string; label: string; item: AnyRow; entry: AnyRow }[];
  left: { on: string; label: string; item: AnyRow; entry: AnyRow } | null;
  right: { on: string; label: string; item: AnyRow; entry: AnyRow } | null;
  leftId: string;
  rightId: string;
  setLeftId: (v: string) => void;
  setRightId: (v: string) => void;
  onOpenEntry: (e: AnyRow) => void;
  onNewEntry: () => void;
  onGoMedia: () => void;
  entriesCount: number;
}) {
  const strip = photos.slice().reverse().slice(0, 24);

  return (
    <Section
      eyebrow="Your own photographs"
      title="Photo timeline & comparison"
      description="Every thumbnail below is a photograph you stored and linked to a dated check-in. The slider pairs any two of them. The app displays them; it does not align them, retouch them, analyse them or decide what they show — and differences in lighting, distance, lens and date are yours to judge, not something this page can correct."
      right={
        <Button size="sm" variant="ghost" onClick={onGoMedia}>
          Open media studio
        </Button>
      }
    >
      {photos.length === 0 ? (
        <EmptyPlate
          kicker={entriesCount ? `${entriesCount} check-ins, 0 with a photograph` : 'No check-ins yet'}
          title="Nothing to compare"
          body="A photograph becomes part of this timeline when you attach it to a progress check-in — the picker lives inside the entry form. Two attached photographs turn the slider on. Until then this stays empty rather than showing stock imagery."
          action={
            <Button variant="primary" icon={<Camera size={14} />} onClick={onNewEntry}>
              Add a check-in with a photo
            </Button>
          }
        />
      ) : (
        <>
          <div className="pg-photos">
            {strip.map((p) => (
              <figure key={String(p.item.id)} className="pg-photo">
                <PhotoThumb item={p.item} />
                <figcaption>
                  <span className="gl-tech">{formatDate(p.on)}</span>
                  <span className="gl-small gl-muted">{p.label}</span>
                  <button type="button" className="gl-btn gl-btn--link gl-btn--sm" onClick={() => onOpenEntry(p.entry)}>
                    open check-in
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>

          <div className="pg-compare">
            <div className="pg-compare__pick">
              <Field label="Left (earlier?)">
                <Select
                  value={leftId}
                  onChange={setLeftId}
                  options={photos.map((p) => ({ value: String(p.item.id), label: `${formatDate(p.on)} — ${p.label}` }))}
                />
              </Field>
              <Field label="Right (later?)">
                <Select
                  value={rightId}
                  onChange={setRightId}
                  options={photos.map((p) => ({ value: String(p.item.id), label: `${formatDate(p.on)} — ${p.label}` }))}
                />
              </Field>
            </div>
            {left && right ? (
              <>
                <CompareSlider
                  before={left.item}
                  after={right.item}
                  beforeLabel={`${formatDate(left.on)} · your own comparison`}
                  afterLabel={`${formatDate(right.on)} · your own comparison`}
                  height={430}
                />
                {(() => {
                  const c = comparability(left.item, right.item);
                  return (
                    <p className={c.cls} style={{ marginTop: 10 }}>
                      {c.text}
                    </p>
                  );
                })()}
                <div className="pg-compare__meta">
                  <span className="gl-tech gl-faint">
                    gap between the two dates:{' '}
                    {Math.max(
                      0,
                      Math.round(
                        (new Date(right.on).getTime() - new Date(left.on).getTime()) / 86400000
                      )
                    )}{' '}
                    days
                  </span>
                  <span className="gl-tech gl-faint">
                    left: {left.item.conditions || 'no conditions recorded'} / {left.item.lighting || 'no lighting recorded'}{' '}
                    / {left.item.distance || 'no distance recorded'}
                  </span>
                  <span className="gl-tech gl-faint">
                    right: {right.item.conditions || 'no conditions recorded'} / {right.item.lighting || 'no lighting recorded'}{' '}
                    / {right.item.distance || 'no distance recorded'}
                  </span>
                </div>
                {leftId === rightId ? (
                  <p className="gl-note gl-note--warn" style={{ marginTop: 10 }}>
                    You have picked the same photograph twice — this shows one image, not a comparison.
                  </p>
                ) : null}
                <p className="gl-note" style={{ marginTop: 10 }}>
                  Your own comparison. Two photographs you took, displayed side by side because you chose them. Nothing on
                  this page has decided whether they differ, why they differ, or whether that is an improvement — and a
                  change in lighting or distance is indistinguishable from a change in appearance without you being the
                  one who knows which it was.
                </p>
              </>
            ) : (
              <p className="gl-small gl-muted">Choose two photographs to place them side by side.</p>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

function PhotoThumb({ item }: { item: AnyRow }) {
  const src = useImageSrc(item, 'thumb');
  return (
    <div className="pg-photo__frame">
      {src ? <img src={src} alt={item.caption || item.title || 'progress photograph'} loading="lazy" /> : <span className="gl-missing-img">image missing</span>}
    </div>
  );
}

/* ----------------------------------------------------------------- ledger */

function LedgerCard({
  entries,
  onNew,
  onEdit,
  onAskDrop,
  win,
  from
}: {
  entries: AnyRow[];
  onNew: () => void;
  onEdit: (e: AnyRow) => void;
  onAskDrop: (e: AnyRow) => void;
  win: number;
  from: string;
}) {
  const rows = entries.slice().sort((a, b) => String(b.on).localeCompare(String(a.on)));
  const inWin = rows.filter((r) => String(r.on) >= from).length;

  return (
    <Section
      eyebrow="Source rows"
      title="Check-in ledger"
      description={`The complete set behind every number above: ${rows.length} progress entries stored, ${inWin} inside the ${win}-day window. Editing keeps the row's id and bumps its revision; deleting is a soft delete, so the row is restorable.`}
      right={
        <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={onNew}>
          Log a check-in
        </Button>
      }
    >
      {rows.length === 0 ? (
        <EmptyPlate
          kicker="Empty table"
          title="No check-ins recorded"
          body="This is the table every chart on this page reads. Adding one row here is the only way anything changes above — a dated label, an optional measurement, an optional rating, and optionally a photograph."
          action={
            <Button variant="primary" icon={<Plus size={14} />} onClick={onNew}>
              Write the first check-in
            </Button>
          }
        />
      ) : (
        <Table
          columns={[
            { label: 'Date', render: (r: AnyRow) => <span className="gl-tech">{formatDate(String(r.on))}</span> },
            { label: 'Label', render: (r: AnyRow) => <span className="gl-serif">{String(r.label)}</span> },
            { label: 'Domain', render: (r: AnyRow) => <span className="gl-small gl-muted">{String(r.domain ?? '—')}</span> },
            {
              label: 'Metric',
              render: (r: AnyRow) =>
                r.value === null || r.value === undefined ? (
                  <span className="gl-faint gl-small">—</span>
                ) : (
                  <span className="gl-tech">
                    {String(r.value)} {String(r.unit ?? '')} {String(r.metric ?? '')}
                  </span>
                )
            },
            {
              label: 'Rating',
              render: (r: AnyRow) =>
                r.rating === null || r.rating === undefined ? (
                  <span className="gl-faint gl-small">—</span>
                ) : (
                  <Rating value={Number(r.rating)} size={13} />
                )
            },
            { label: 'Photos', render: (r: AnyRow) => <span className="gl-tech gl-faint">{((r.mediaIds as string[]) ?? []).length}</span> },
            {
              label: '',
              render: (r: AnyRow) => (
                <span className="gl-row gl-row--tight">
                  <IconButton label="Edit check-in" onClick={() => onEdit(r)}>
                    <Pencil size={13} />
                  </IconButton>
                  <IconButton label="Delete check-in" tone="danger" onClick={() => onAskDrop(r)}>
                    <Trash2 size={13} />
                  </IconButton>
                </span>
              )
            }
          ]}
          rows={rows}
          keyOf={(r) => String(r.id)}
        />
      )}
    </Section>
  );
}

/* ------------------------------------------------------------ entry form */

function EntryForm({
  draft,
  goals,
  referenceRow,
  onChange,
  onClose,
  onSave,
  editing
}: {
  draft: Record<string, unknown>;
  goals: AnyRow[];
  /** the newest stored progress photograph, if any — what a new shot is lined up against */
  referenceRow?: AnyRow | null;
  onChange: (d: Record<string, unknown>) => void;
  onClose: () => void;
  onSave: (d: Record<string, unknown>) => void;
  editing: boolean;
}) {
  const set = (k: string, v: unknown) => onChange({ ...draft, [k]: v });
  const ids = ((draft.mediaIds as string[]) ?? []).map(String);
  /**
   * The ids the stored row already had when this form opened. A capture set
   * deletes the frames it wrote and nothing else — these are off limits, because
   * the saved check-in still points at them.
   */
  const [originalIds] = useState<string[]>(() => ((draft.mediaIds as string[]) ?? []).map(String));
  /** the ids the capture set last handed over, and any of them she detached by hand */
  const [seqIds, setSeqIds] = useState<string[]>([]);
  const [seqDetached, setSeqDetached] = useState<string[]>([]);
  const referenceSrc = useImageSrc(referenceRow ?? null, 'full');

  const detachPhoto = (id: string) => {
    if (seqIds.includes(id)) setSeqDetached((prev) => (prev.includes(id) ? prev : [...prev, id]));
    set('mediaIds', ids.filter((x) => x !== id));
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={editing ? 'Edit check-in' : 'New check-in'}
      footer={
        <>
          <span className="gl-tech gl-faint">progressEntries · the rating and metric columns are yours, blank is allowed</span>
          <div className="gl-row gl-row--tight">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={String(draft.label ?? '').trim().length < 2}
              onClick={() => onSave(draft)}
            >
              {editing ? 'Save changes' : 'Store check-in'}
            </Button>
          </div>
        </>
      }
    >
      <div className="pg-form">
        <Field label="Label" hint="What this check-in is. Required — an unlabelled row is useless in the ledger.">
          <TextInput value={String(draft.label ?? '')} onChange={(v) => set('label', v)} placeholder="e.g. Week 6 loc progress" />
        </Field>
        <Field label="Domain">
          <Select
            value={String(draft.domain ?? '')}
            onChange={(v) => set('domain', v)}
            options={DEPARTMENTS.map((d) => ({ value: d.id, label: d.title }))}
          />
        </Field>
        <Field label="Date">
          <DateInput value={String(draft.on ?? todayISO())} onChange={(v) => set('on', v)} />
        </Field>
        <Field label="Metric" hint="Free text. If it matches a goal's metric, this value is offered as that goal's current.">
          <TextInput value={String(draft.metric ?? '')} onChange={(v) => set('metric', v)} placeholder="e.g. sessions logged, cm, days" />
        </Field>
        <Field label="Value">
          <TextInput type="number" value={String(draft.value ?? '')} onChange={(v) => set('value', v)} />
        </Field>
        <Field label="Unit">
          <TextInput value={String(draft.unit ?? '')} onChange={(v) => set('unit', v)} placeholder="e.g. cm, sessions/week" />
        </Field>
        <Field label="How do you rate it?" hint="Your own 1–5. Stored as text on your row; nothing converts it into a score.">
          <Rating value={num(draft.rating, 0)} onChange={(v) => set('rating', v)} count={5} />
        </Field>
        <Field label="Link to a goal">
          <Select
            value={String(draft.linkedGoalId ?? '')}
            placeholder="No goal"
            onChange={(v) => set('linkedGoalId', v)}
            options={goals.map((g) => ({ value: String(g.id), label: String(g.title) }))}
          />
        </Field>
      </div>

      <Field label="Notes" hint="Anything you want to be able to read back later. Conditions, mood, what changed.">
        <TextArea value={String(draft.note ?? '')} onChange={(v) => set('note', v)} rows={3} />
      </Field>

      <div className="pg-form__media">
        <div className="gl-label">Photographs</div>
        <PhotoPicker
          kind="progress"
          album="Progress"
          standard
          label="Attach a photograph"
          reference={referenceRow ? { row: referenceRow, src: referenceSrc } : null}
          onPick={(rows) => set('mediaIds', [...ids, ...rows.map((r) => String(r.id))])}
        />
        {ids.length ? (
          <ul className="pg-form__thumbs">
            {ids.map((id) => (
              <li key={id}>
                <MediaDot id={id} />
                <button type="button" className="gl-btn gl-btn--link gl-btn--sm" onClick={() => detachPhoto(id)}>
                  detach
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <span className="gl-small gl-faint">No photograph attached. Optional — this app never requires an image.</span>
        )}
      </div>

      <div className="pg-form__media">
        <div className="gl-label">Same-framing set</div>
        <ShotGridPicker
          kind="progress"
          album="Progress"
          protectedIds={originalIds}
          onGroup={(groupIds, _rows, owned) => {
            setSeqIds(groupIds);
            set(
              'mediaIds',
              [...ids.filter((id) => !owned.includes(id) && !seqDetached.includes(id)), ...groupIds.filter((id) => !seqDetached.includes(id))]
            );
          }}
        />
        {editing && originalIds.length ? (
          <p className="gl-small gl-faint">
            {originalIds.length} frame{originalIds.length === 1 ? '' : 's'} already attached to this check-in are listed
            above. This grid starts a new set — it does not delete frames a stored check-in points at, and the shots of
            the set that made those frames are not reloaded into slots here.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function MediaDot({ id }: { id: string }) {
  const rows = useRows(TABLES.mediaItems);
  const item = rows.find((r) => String(r.id) === id);
  const src = useImageSrc(item, 'thumb');
  return (
    <span className="pg-thumb">
      {src ? <img src={src} alt="" loading="lazy" /> : <span className="gl-missing-img">?</span>}
      <span className="gl-tech gl-faint">{item ? formatDate(String(item.takenOn ?? item.createdAt)) : id}</span>
    </span>
  );
}

/* -------------------------------------------------------------- milestones */

function buildMilestones(src: {
  entries: AnyRow[];
  routineLogs: AnyRow[];
  observations: AnyRow[];
  goals: AnyRow[];
  experiments: AnyRow[];
  tutorials: AnyRow[];
  plans: AnyRow[];
  media: AnyRow[];
  firstLogDate: string;
}) {
  const out: { on: string; title: string; body: string; note?: string }[] = [];
  const firstOf = (rows: AnyRow[], date: (r: AnyRow) => unknown, title: string, detail: (f: AnyRow, n: number) => string) => {
    const dated = rows.filter((r) => String(date(r) ?? '')).sort((a, b) => String(date(a)).localeCompare(String(date(b))));
    const f = dated[0];
    if (!f) return;
    out.push({ on: String(date(f)), title, body: detail(f, dated.length), note: `${dated.length} row(s) of this kind stored` });
  };

  firstOf(src.entries, (r) => r.on, 'First progress check-in', (f, n) => `“${String(f.label)}” — the row that started the charts on this page (${n} since).`);
  firstOf(src.routineLogs, (r) => r.doneOn, 'First routine log', (f, n) => `A dated tick on ${formatDate(String(f.doneOn))}. Adherence maths starts here (${n} logs in total).`);
  firstOf(src.observations, (r) => r.on, 'First observation', (f, n) => `Note: “${String(f.note || '(no text stored)')}” (${n} observations stored).`);
  firstOf(src.media, (r) => r.takenOn, 'First photograph in the library', (_f, n) => `Only photographs you attach to a check-in reach the comparison slider (${n} photos stored).`);

  for (const g of src.goals.filter((x) => x.status === 'completed')) {
    const stamped = g.data?.completedOn ? String(g.data.completedOn) : '';
    out.push({
      on: stamped || todayISO(g.updatedAt),
      title: `Goal marked completed — ${String(g.title)}`,
      body:
        g.metric && g.targetValue !== null
          ? `Target was ${g.targetValue}${g.unit ? ` ${g.unit}` : ''} on the metric “${g.metric}”.`
          : 'No metric or target was stored on this row, so nothing further is claimed about it.',
      note: stamped
        ? 'the completion date you stored on the row'
        : 'no completion date is stored, so this shows when the row was last written'
    });
  }
  for (const e of src.experiments.filter((x) => x.result)) {
    out.push({
      on: String(e.endOn || todayISO(e.updatedAt)),
      title: `Experiment closed — ${String(e.name)}`,
      body: `Your verdict: ${String(e.result)}.${e.confounders ? ` Confounders you noted: ${String(e.confounders)}` : ''}`,
      note: e.endOn ? 'the end date you set' : 'no end date on the row, so the last write is shown'
    });
  }
  for (const t of src.tutorials.filter((x) => x.completedOn)) {
    out.push({
      on: String(t.completedOn),
      title: `Tutorial marked done — ${String(t.title)}`,
      body: `${Number(t.attempts ?? 0)} attempt(s) recorded on the row.`,
      note: 'the date you ticked it'
    });
  }
  for (const p of src.plans) {
    for (const m of ((p.milestones as AnyRow[]) ?? []).filter((x) => x.metOn)) {
      out.push({
        on: String(m.metOn),
        title: `Plan milestone met — ${String(m.label)}`,
        body: `Plan “${String(p.name)}”, due ${m.dueOn ? formatDate(String(m.dueOn)) : 'no due date'}${String(m.dueOn) !== String(m.metOn) ? `, met ${formatDate(String(m.metOn))}` : ''}.`,
        note: 'date you marked it'
      });
    }
  }

  return out.filter((m) => m.on).sort((a, b) => String(b.on).localeCompare(String(a.on))).slice(0, 30);
}
