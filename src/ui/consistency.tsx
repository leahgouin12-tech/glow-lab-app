/**
 * THE GLOW LAB — the weekly adherence card (src/ui/consistency.tsx).
 *
 * Renders the digest from engine/consistency.ts and nothing else: every mark,
 * meter and number on this card is a count over a denominator that travels
 * with it. Seven day cells, one meter per routine, streaks, photo cadence, the
 * item with the lowest completion, and the per-action table underneath.
 *
 * The derailment record (engine/derailment.ts) lives beside those numbers. It
 * is an annotation: recording, editing or resolving one writes a row into
 * `derailments` and moves nothing above it — the scheduled, done and missed
 * counts, the ratios and the streaks are computed from logs and actions only.
 * Every affordance is inline (no modal library, no dialog): the chip on a miss
 * opens the form right where the miss is printed.
 */

import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  digest,
  type ActionAdherence,
  type ConsistencyDigest as Digest,
  type RoutineAdherence
} from '../engine/consistency';
import {
  DERAILMENT_TRIGGERS,
  kindLabel,
  recordsAt,
  type DerailmentKind,
  type DerailmentRecord,
  type DerailmentStatus
} from '../engine/derailment';
import { TABLES } from '../db/schema';
import { formatDate, newId, todayISO } from '../db/repo';
import { saveRow, useRows, useRowsState } from '../hooks/live';
import {
  Button,
  Chip,
  DateInput,
  Disclosure,
  EmptyState,
  Field,
  Meter,
  SafetyBanner,
  Stat,
  Table,
  TextArea,
  useToast
} from './primitives';
import { EmptyPlate, KvList } from './editorial';
import { useUndoDelete } from './undo';

const pctText = (pct: number | null): string => (pct === null ? 'no denominator' : `${pct}%`);

/* ---------------------------------------------------------- record affordances */

/** What a record can be attached to, at the granularity the digest counts. */
export interface DerailTarget {
  on: string;
  kind: DerailmentKind;
  refId: string | null;
  refLabel: string;
}

interface DerailDraft extends DerailTarget {
  /** Existing record id when editing; null for a new one. */
  id: string | null;
  /** Which affordance owns the open form, so exactly one form renders at a time. */
  at: string;
  trigger: string;
  reason: string;
  fix: string;
  /** `''` means "no follow-up date", which saves as null, not as a blank day. */
  followUpOn: string;
  status: DerailmentStatus;
  resolvedOn: string | null;
}

/** The record affordances, handed down from the widget that owns the table. */
export interface DerailUi {
  draft: DerailDraft | null;
  busy: boolean;
  start(target: DerailTarget, at: string): void;
  edit(rec: DerailmentRecord): void;
  patch(next: Partial<DerailDraft>): void;
  cancel(): void;
  save(): void;
  resolve(rec: DerailmentRecord): void;
  remove(rec: DerailmentRecord): void;
  recordsFor(target: DerailTarget): DerailmentRecord[];
}

const targetKey = (t: DerailTarget): string => `${t.on}|${t.kind}|${t.refId ?? ''}`;

/** One line naming what a record is attached to — printed wherever a record shows. */
export function targetText(t: DerailTarget): string {
  const what = t.kind === 'general' ? 'that whole day' : `${t.refLabel || kindLabel(t.kind)} (${kindLabel(t.kind)})`;
  return `${what} — ${formatDate(t.on)}`;
}

/** The form renders once, inside the affordance that opened it. */
function openForm(derail: DerailUi | undefined, at: string) {
  if (!derail || !derail.draft || derail.draft.at !== at) return null;
  return <DerailmentForm ui={derail} draft={derail.draft} />;
}

function DerailmentForm({ ui, draft }: { ui: DerailUi; draft: DerailDraft }) {
  const picked = DERAILMENT_TRIGGERS.find((t) => t.value === draft.trigger);
  return (
    <div className="gl-inset" data-derailment-form={targetKey(draft)} style={{ marginTop: 10 }}>
      <p className="gl-small gl-muted" style={{ marginTop: 0 }}>
        What got in the way for {targetText(draft)}. This writes one note of your own; it changes no count on this card.
      </p>

      <div
        className="gl-row gl-row--tight"
        role="group"
        aria-label="What got in the way"
        style={{ flexWrap: 'wrap', marginBottom: 8 }}
      >
        {DERAILMENT_TRIGGERS.map((t) => (
          <Chip key={t.value} active={draft.trigger === t.value} onClick={() => ui.patch({ trigger: t.value })} title={t.ask}>
            {t.label}
          </Chip>
        ))}
      </div>
      {picked ? (
        <p className="gl-small gl-faint" style={{ margin: '0 0 8px' }}>
          {picked.ask}
        </p>
      ) : null}

      <div className="gl-grid gl-grid--2">
        <Field label="What happened, in your words">
          <TextArea
            value={draft.reason}
            onChange={(v) => ui.patch({ reason: v })}
            placeholder="The day went like this…"
            rows={3}
          />
        </Field>
        <Field label="What would get you back on it">
          <TextArea
            value={draft.fix}
            onChange={(v) => ui.patch({ fix: v })}
            placeholder="What you actually did, or would. Not advice."
            rows={3}
          />
        </Field>
      </div>

      <div className="gl-grid gl-grid--2" style={{ marginTop: 10 }}>
        <DateInput label="Follow-up date, optional" value={draft.followUpOn} onChange={(v) => ui.patch({ followUpOn: v })} />
        <div className="gl-row gl-row--tight" style={{ alignItems: 'flex-end' }}>
          <Button variant="gold" size="sm" onClick={() => ui.save()} disabled={!draft.trigger.trim() || ui.busy}>
            {ui.busy ? 'Saving…' : draft.id ? 'Save changes' : 'Save'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => ui.cancel()}>
            Cancel
          </Button>
        </div>
      </div>

      <p className="gl-small gl-faint" style={{ marginTop: 10 }}>
        Save waits on one label — the tally below only counts what you picked. The two boxes can stay blank if you have no
        words for them yet.
      </p>
    </div>
  );
}

function RecordLine({ rec, derail, today }: { rec: DerailmentRecord; derail?: DerailUi; today: string }) {
  let followUpText = '';
  if (rec.followUpOn) {
    const when = formatDate(rec.followUpOn);
    followUpText =
      rec.status !== 'open'
        ? `follow-up ${when}`
        : rec.followUpOn > today
          ? `follow-up ${when} — still ahead`
          : rec.followUpOn === today
            ? `follow-up ${when} — due today`
            : `follow-up ${when} — past the date you chose`;
  }
  return (
    <li className="gl-list__row" data-derailment-record={rec.id} style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div className="gl-row gl-row--tight" style={{ marginBottom: 5 }}>
          <Chip tone={rec.status === 'open' ? 'gold' : undefined}>{rec.triggerLabel}</Chip>
          <Chip>{formatDate(rec.on)}</Chip>
          {rec.status === 'resolved' ? (
            <span className="gl-small gl-faint">
              marked resolved {rec.resolvedOn ? formatDate(rec.resolvedOn) : 'on a date that cannot be read'}
            </span>
          ) : null}
          {followUpText ? <span className="gl-small gl-faint">{followUpText}</span> : null}
        </div>
        <div className="gl-small gl-muted">{targetText(rec)}</div>
        <p className="gl-small" style={{ marginTop: 4 }}>
          {rec.reason ? rec.reason : 'no words written — only the label'}
        </p>
        {rec.fix ? (
          <p className="gl-small gl-faint" style={{ marginTop: 3 }}>
            Back on it: {rec.fix}
          </p>
        ) : null}
        {derail?.draft?.at === `record:${rec.id}` ? <div style={{ marginTop: 6 }}>{openForm(derail, `record:${rec.id}`)}</div> : null}
      </div>
      {derail ? (
        <div className="gl-row gl-row--tight" style={{ alignSelf: 'flex-start' }}>
          <Button variant="ghost" size="sm" onClick={() => derail.edit(rec)}>
            Edit
          </Button>
          {rec.status === 'open' ? (
            <Button variant="ghost" size="sm" onClick={() => derail.resolve(rec)}>
              Mark resolved
            </Button>
          ) : null}
          <Button
            variant="danger"
            size="sm"
            title="Soft-deleted, with an undo. The miss it explains stays counted either way."
            onClick={() => derail.remove(rec)}
          >
            Move to deleted
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** Day-level chips under the week strip: one per day that had a miss. */
function DayChips({ cells, derail }: { cells: Digest['cells']; derail?: DerailUi }) {
  if (!derail) return null;
  const days = cells.filter((c) => !c.isFuture && c.missed > 0);
  if (days.length === 0) return null;
  const openAt = derail.draft?.at ?? '';
  return (
    <div data-derailment-days style={{ marginTop: 8 }}>
      <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
        {days.map((c) => {
          const why = derail.recordsFor({ on: c.date, kind: 'general', refId: null, refLabel: '' });
          return (
            <span key={c.date} data-derailment-day={c.date} data-explained={why.length > 0 ? 'true' : undefined}>
              <Chip
                tone={why.length > 0 ? 'gold' : undefined}
                onClick={() =>
                  derail.start(
                    { on: c.date, kind: 'general', refId: null, refLabel: `${c.weekday} ${formatDate(c.date)}` },
                    `day:${c.date}`
                  )
                }
              >
                {c.weekday} {formatDate(c.date)} — {c.missed} not logged ·{' '}
                {why.length > 0 ? `you wrote why (${why.length})` : 'why?'}
              </Chip>
            </span>
          );
        })}
      </div>
      {openAt.startsWith('day:') ? openForm(derail, openAt) : null}
    </div>
  );
}

/** The per-miss affordance for one routine or action: a chip per missed date. */
function MissChips({
  kind,
  refId,
  refLabel,
  dates,
  derail
}: {
  kind: DerailmentKind;
  refId: string;
  refLabel: string;
  dates: string[];
  derail: DerailUi;
}) {
  const openAt = derail.draft?.at ?? '';
  return (
    <div data-derailment-item={`${kind}|${refId}`}>
      <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap', marginTop: 6 }}>
        <span className="gl-small gl-faint">Missed on {dates.join(', ')} — record why, or leave it:</span>
        {dates.map((date) => {
          const n = derail.recordsFor({ on: date, kind, refId, refLabel }).length;
          return (
            <span key={date} data-derailment-miss={`${kind}|${refId}|${date}`}>
              <Chip
                tone={n > 0 ? 'gold' : undefined}
                onClick={() => derail.start({ on: date, kind, refId, refLabel }, `item:${kind}|${refId}|${date}`)}
              >
                {date} · {n > 0 ? `you wrote why (${n})` : 'record why'}
              </Chip>
            </span>
          );
        })}
      </div>
      {openAt.startsWith('item:') ? openForm(derail, openAt) : null}
    </div>
  );
}

function cellTitle(cell: Digest['cells'][number]): string {
  if (cell.isFuture) return `${cell.weekday} ${formatDate(cell.date)} — still ahead this week, nothing scheduled yet`;
  if (cell.scheduled === 0 && cell.logged === 0) return `${cell.weekday} ${formatDate(cell.date)} — nothing scheduled, nothing logged`;
  const bits = [`${cell.logged} of ${cell.scheduled} scheduled logged`];
  if (cell.partial > 0) bits.push(`${cell.partial} logged with steps left out`);
  if (cell.missed > 0) bits.push(`${cell.missed} not logged`);
  if (cell.explained) bits.push('you wrote why this day came apart — the miss is still counted');
  return `${cell.weekday} ${formatDate(cell.date)} — ${bits.join(', ')}`;
}

function WeekRow({ d, derail }: { d: Digest; derail?: DerailUi }) {
  return (
    <>
      <div className="gl-cons__days">
        {d.cells.map((cell) => (
          <div
            key={cell.date}
            className="gl-cons__day"
            data-state={cell.state}
            data-today={cell.isToday ? 'true' : undefined}
            data-explained={cell.explained ? 'true' : undefined}
            title={cellTitle(cell)}
          >
            <span className="gl-cons__dow">{cell.weekday}</span>
            <span className="gl-cons__num">{cell.dayNum}</span>
            <span className="gl-cons__mark" aria-hidden />
            <span className="gl-cons__count">
              {cell.isFuture ? '—' : cell.scheduled === 0 && cell.logged === 0 ? '—' : `${cell.logged}/${cell.scheduled}`}
            </span>
            <span className="sr-only">{cellTitle(cell)}</span>
          </div>
        ))}
      </div>
      <div className="gl-cons__legend">
        <span data-state="done">Full: everything due that day, logged</span>
        <span data-state="partial">Half: logged, with steps left out or a miss</span>
        <span data-state="nothing">Empty: scheduled, nothing logged</span>
        <span data-state="unscheduled">Dash: nothing scheduled in your rows</span>
      </div>
      <DayChips cells={d.cells} derail={derail} />
    </>
  );
}

function RoutineMeters({ items, derail }: { items: RoutineAdherence[]; derail?: DerailUi }) {
  if (items.length === 0) {
    return (
      <p className="gl-small gl-muted">
        No active routines in your records. Add one under Calendar → Routines and it gets a meter here from its first logged day.
      </p>
    );
  }
  return (
    <ul className="gl-cons__meters">
      {items.map((r) => (
        <li key={r.id} className="gl-cons__meter">
          <div className="gl-row gl-row--between" style={{ alignItems: 'baseline', gap: 10 }}>
            <span className="gl-strong">{r.label}</span>
            <span className="gl-tech gl-faint">
              {r.domain} · current {r.streak.current}d · best {r.streak.best}d
            </span>
          </div>
          {r.state === 'scored' ? (
            <>
              <Meter value={r.n} max={r.scheduled} label={<span>{r.ratio} days logged over days scheduled</span>} />
              <div className="gl-small gl-faint">
                {r.fullDays} full, {r.partialDays} partial, {r.missedDays} missed
                {r.partialDays > 0 ? ' — partial means completedSteps was shorter than the step count' : ''}.
              </div>
            </>
          ) : (
            <div className="gl-small gl-muted">
              Nothing scheduled in this window — {r.reason ?? 'no denominator to divide by.'} Logged {r.n} time
              {r.n === 1 ? '' : 's'} anyway.
            </div>
          )}
          {r.explained ? (
            <div className="gl-small gl-faint" data-routine-explained={r.id}>
              explained — the {r.missedDays} missed {r.missedDays === 1 ? 'day is' : 'days are'} still counted, exactly as
              before.
            </div>
          ) : null}
          {derail && r.missedDates.length > 0 ? (
            <MissChips kind="routine" refId={r.id} refLabel={r.label} dates={r.missedDates} derail={derail} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Slipping({ d }: { d: Digest }) {
  if (d.slipping) {
    const s = d.slipping;
    const scoredCount = [...d.routines, ...d.actions].filter((i) => i.state === 'scored').length;
    return (
      <p className="gl-cons__slip">
        <span className="gl-strong">What is slipping:</span> {s.label} — {s.n}/{s.scheduled} logged ({pctText(s.pct)}),{' '}
        {s.missed} scheduled {s.missed === 1 ? 'day' : 'days'} with no log. Lowest of {scoredCount} scored{' '}
        {scoredCount === 1 ? 'item' : 'items'}.
      </p>
    );
  }
  return (
    <p className="gl-cons__slip">
      <span className="gl-strong">Nothing is slipping, and nothing is claimed either:</span> no routine or plan action has a
      denominator in this window, so there is no completion rate to rank.
    </p>
  );
}

function ActionTable({ items, derail }: { items: ActionAdherence[]; derail?: DerailUi }) {
  if (items.length === 0) {
    return <p className="gl-small gl-muted">No plan actions on an active plan. Action counts appear here once a plan is running.</p>;
  }
  return (
    <Table
      columns={[
        { label: 'Action', render: (r: ActionAdherence) => <span className="gl-strong">{r.label}</span> },
        { label: 'Plan', render: (r: ActionAdherence) => <span className="gl-small gl-muted">{r.planName}</span> },
        { label: 'Cadence', render: (r: ActionAdherence) => <Chip>{r.cadence}</Chip> },
        {
          label: 'Logged / scheduled',
          render: (r: ActionAdherence) => (
            <span className="gl-tech">
              {r.ratio}
              {r.state === 'scored' ? ` · ${pctText(r.pct)}` : ''}
            </span>
          )
        },
        {
          label: 'Dates in this window',
          render: (r: ActionAdherence) =>
            r.doneDates.length ? (
              <span className="gl-tech gl-faint">{r.doneDates.join(', ')}</span>
            ) : (
              <span className="gl-small gl-muted">{r.state === 'scored' ? 'none' : r.reason}</span>
            )
        },
        {
          label: 'Why it was missed',
          render: (r: ActionAdherence) =>
            derail && r.missedDates.length > 0 ? (
              <MissChips kind="action" refId={r.id} refLabel={r.label} dates={r.missedDates} derail={derail} />
            ) : r.explained ? (
              <span className="gl-small gl-faint">you wrote why — the miss is still counted</span>
            ) : (
              <span className="gl-small gl-muted">{r.missedDates.length > 0 ? 'nothing recorded' : 'nothing missed'}</span>
            )
        }
      ]}
      rows={items}
      keyOf={(r: ActionAdherence) => r.id}
    />
  );
}

/* --------------------------------------------------------------- the record panel */

function DerailmentPanel({ d, derail }: { d: Digest; derail?: DerailUi }) {
  const s = d.derailments;
  const today = d.week.today;
  const itemCount = d.routines.length + d.actions.length;
  return (
    <div className="gl-cons__block" data-testid="derailment-panel">
      <div className="gl-eyebrow">When it came apart</div>
      <div className="gl-row gl-row--between" style={{ alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <p className="gl-small" style={{ margin: 0, flex: 1, minWidth: 240 }}>
          <span className="gl-strong">
            {s.recorded} record{s.recorded === 1 ? '' : 's'}
          </span>{' '}
          on this device — {s.windowRecords} dated inside this week, {s.openRecords} open, {s.resolvedRecords} marked
          resolved. They sit beside {s.explainedDays} of the seven day cells and {s.explainedMisses} of {itemCount} routine
          or action rows above. Writing one changes none of the numbers above.
        </p>
        {derail ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              derail.start({ on: today, kind: 'general', refId: null, refLabel: `the day itself — ${today}` }, 'panel:day')
            }
          >
            Record for a day
          </Button>
        ) : null}
      </div>

      <p className="gl-small" style={{ marginTop: 8 }}>
        {s.readLine}
      </p>

      {derail?.draft?.at === 'panel:day' ? openForm(derail, 'panel:day') : null}

      {s.items.length === 0 ? (
        <EmptyPlate
          kicker="Optional"
          title="Nothing has been recorded as a derailment"
          body="Recording one is optional: the counts above already stand, and a missed day stays a missed day either way. When a scheduled thing does come apart, the chips on those rows ask for your words."
        />
      ) : (
        <ul className="gl-list" style={{ marginTop: 10 }}>
          {s.items.map((rec) => (
            <RecordLine key={rec.id} rec={rec} derail={derail} today={today} />
          ))}
        </ul>
      )}

      <div className="gl-inset" style={{ marginTop: 12 }}>
        <div className="gl-label">Your own labels, counted</div>
        {s.byTrigger.length === 0 ? (
          <p className="gl-small gl-muted">No labels chosen yet. This list fills in from the records you save.</p>
        ) : (
          s.byTrigger.map((t) => (
            <div
              key={t.trigger || 'unlabelled'}
              className="gl-row gl-row--between"
              data-trigger-tally={t.trigger || 'unlabelled'}
              style={{ gap: 10, marginTop: 6, flexWrap: 'wrap' }}
            >
              <span className="gl-small">
                <span className="gl-strong">{t.label}</span> — {t.count} of {s.recorded} recorded
                {t.listed ? '' : ' (a value not on the chip list, printed as saved)'}
              </span>
              <span className="gl-tech gl-faint">
                {t.dates.slice(0, 4).join(', ')}
                {t.dates.length > 4 ? ` (+${t.dates.length - 4} more)` : ''}
              </span>
            </div>
          ))
        )}

        <div className="gl-label" style={{ marginTop: 14 }}>
          Follow-ups you have not marked resolved
        </div>
        {s.followUps.length === 0 ? (
          <p className="gl-small gl-muted">
            No follow-up date of yours is due or past due. A date you set stays on this list until you mark the record
            resolved.
          </p>
        ) : (
          <ul className="gl-list" style={{ marginTop: 6 }}>
            {s.followUps.map((f) => (
              <li
                key={`${f.record.id}|${f.followUpOn}`}
                className="gl-list__row"
                data-follow-up={f.record.id}
                data-overdue={f.overdue ? 'true' : undefined}
                style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}
              >
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div className="gl-small">
                    <span className="gl-strong">
                      {f.dueToday ? 'Due today' : `${f.daysLate} ${f.daysLate === 1 ? 'day' : 'days'} past the date you chose`}
                    </span>{' '}
                    — {formatDate(f.followUpOn)}, on the record {targetText(f.record)}
                  </div>
                  <div className="gl-small gl-faint" style={{ marginTop: 3 }}>
                    {f.record.triggerLabel}
                    {f.record.reason ? ` · ${f.record.reason}` : ' · no words written'}
                    {f.record.fix ? ` · back on it: ${f.record.fix}` : ''}
                  </div>
                </div>
                {derail ? (
                  <div className="gl-row gl-row--tight" style={{ alignSelf: 'flex-start' }}>
                    <Button variant="ghost" size="sm" onClick={() => derail.edit(f.record)}>
                      Open
                    </Button>
                    <Button variant="gold" size="sm" onClick={() => derail.resolve(f.record)}>
                      Mark resolved
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <SafetyBanner tone="note">
          <div className="gl-small">{s.rule}</div>
          {s.danglingRefs > 0 ? (
            <p className="gl-small" style={{ marginTop: 6 }}>
              {s.danglingRefs} record{s.danglingRefs === 1 ? ' names' : ' name'} a routine or plan row that is not in the rows
              this card counted. It still reads in full here: the label and your words are stored on the record itself, not
              looked up.
            </p>
          ) : null}
          {s.unmatchedRecords > 0 ? (
            <p className="gl-small" style={{ marginTop: 6 }}>
              {s.unmatchedRecords} record{s.unmatchedRecords === 1 ? '' : 's'} dated inside this week line up with nothing
              this card counted, so nothing here calls {s.unmatchedRecords === 1 ? 'it' : 'them'} the explanation for a
              specific miss.
            </p>
          ) : null}
          <p className="gl-small" style={{ marginTop: 6 }}>
            The labels come from a fixed list and you chose them. The app observed nothing: the most frequent label is you
            saying so, not a finding about cause, and nothing here says a derailment was likely, was avoidable, or means
            anything about your health.
          </p>
        </SafetyBanner>
      </div>
    </div>
  );
}

/** Card contents — used inside the dashboard widget and standalone. */
export function ConsistencyBody({ d, derail }: { d: Digest; derail?: DerailUi }) {
  if (!d.hasActivity) {
    return (
      <div className="gl-cons">
        <WeekRow d={d} derail={derail} />
        <EmptyState
          title="Nothing logged in this window"
          body="Log a routine for a week and this fills in. Nothing here is estimated."
          action={
            <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/calendar">
              Open the calendar
            </Link>
          }
        />
        <DerailmentPanel d={d} derail={derail} />
      </div>
    );
  }

  return (
    <div className="gl-cons">
      <div className="gl-cons__window">
        <div>
          <div className="gl-eyebrow">Week of {formatDate(d.week.start)}</div>
          <div className="gl-tech gl-faint">
            {d.week.start} → {d.week.end} · {d.week.elapsedDays} elapsed, {d.week.futureDays} still ahead
          </div>
        </div>
        <Chip title={d.totals.rule}>
          {d.totals.n} of {d.totals.scheduled} scheduled occurrences logged
          {d.totals.state === 'scored' ? ` · ${d.totals.missed} with no log` : ' · nothing scheduled in these seven days'}
        </Chip>
      </div>

      <WeekRow d={d} derail={derail} />
      <Slipping d={d} />

      <div className="gl-cons__stats">
        <Stat
          label="Run you are on"
          value={`${d.streaks.anyRoutine.current} days`}
          hint={
            d.streaks.longestCurrent
              ? `Longest live run belongs to ${d.streaks.longestCurrent.label} (${d.streaks.longestCurrent.streak.current}d). Counts back from today, or yesterday.`
              : 'Consecutive dated logs — the most recent log is not today or yesterday.'
          }
        />
        <Stat
          label="Best run on file"
          value={`${d.streaks.anyRoutine.best} days`}
          hint={
            d.streaks.anyRoutine.bestFrom && d.streaks.anyRoutine.bestTo
              ? `${d.streaks.anyRoutine.bestFrom} to ${d.streaks.anyRoutine.bestTo}, from ${d.streaks.anyRoutine.loggedDates} logged dates.`
              : 'No dated logs yet.'
          }
        />
        <Stat
          label="Progress shots"
          value={d.photos.everyDays === null ? 'no cadence' : `every ${d.photos.everyDays} days`}
          hint={
            d.photos.state === 'scored'
              ? `${d.photos.spanDays} days ÷ ${d.photos.gapsMeasured} gaps between ${d.photos.shots} dated shots. Last one ${
                  d.photos.sinceLastDays ?? 0
                } days ago.`
              : d.photos.reason
          }
        />
        <Stat
          label="Workout sessions"
          value={`${d.workouts.sessions}`}
          hint={
            d.workouts.dates.length
              ? `${d.workouts.dates.length} dated inside this window. ${d.workouts.reason}`
              : d.workouts.reason
          }
        />
      </div>

      <div className="gl-cons__block">
        <div className="gl-eyebrow">Routines, days logged over days scheduled</div>
        <RoutineMeters items={d.routines} derail={derail} />
      </div>

      <DerailmentPanel d={d} derail={derail} />

      <div className="gl-cons__block">
        <div className="gl-eyebrow">Steps</div>
        <p className="gl-small">
          {d.mostSkippedStep ? (
            <>
              <span className="gl-strong">Most skipped:</span> {d.mostSkippedStep.label} in {d.mostSkippedStep.routineLabel} —
              left out of {d.mostSkippedStep.ratio} itemised logs ({d.mostSkippedStep.pct}%).
            </>
          ) : d.stepEvidence.itemisedLogs > 0 ? (
            <>Every step in {d.stepEvidence.itemisedLogs} itemised log{d.stepEvidence.itemisedLogs === 1 ? '' : 's'} was completed.</>
          ) : (
            <>
              No step-level detail in this window — {d.stepEvidence.blankLogs} log
              {d.stepEvidence.blankLogs === 1 ? '' : 's'} came from the day check, which does not itemise steps. Nothing is
              inferred from them.
            </>
          )}
        </p>
      </div>

      {d.gaps.length > 0 ? (
        <div className="gl-cons__block">
          <div className="gl-eyebrow">Scheduled, never logged</div>
          <ul className="gl-cons__gaps">
            {d.gaps.map((g) => (
              <li key={`${g.kind}-${g.id}`}>
                <span className="gl-tech gl-faint">{g.scheduled}</span> {g.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Disclosure summary="Plan actions, item by item">
        <ActionTable items={d.actions} derail={derail} />
      </Disclosure>

      <Disclosure summary="How each number on this card is worked out">
        <KvList items={d.rules.map((r) => ({ k: r.label, v: <span className="gl-small">{r.value}</span> }))} />
        <p className="gl-small gl-faint" style={{ marginTop: 10 }}>
          The totals line is {d.totals.ratio} — {d.totals.rule}
        </p>
      </Disclosure>
    </div>
  );
}

/** Reads the live tables and renders the digest, with the record affordances wired. */
export function ConsistencyWidget() {
  const [routines, routinesReady] = useRowsState(TABLES.routines);
  const [logs, logsReady] = useRowsState(TABLES.routineLogs);
  const [derailments, derailmentsReady] = useRowsState(TABLES.derailments);
  const plans = useRows(TABLES.plans, { where: { status: 'active' } });
  const sessions = useRows(TABLES.workoutSessions);
  const media = useRows(TABLES.mediaItems);

  const today = todayISO();
  const d = useMemo(
    () => digest({ routines, routineLogs: logs, plans, sessions, media, derailments }, { today }),
    [routines, logs, plans, sessions, media, derailments, today]
  );

  const toast = useToast();
  const moveToDeleted = useUndoDelete();
  const [draft, setDraft] = useState<DerailDraft | null>(null);
  const [busy, setBusy] = useState(false);

  /** Live records, oldest date first — the order the engine matches in. */
  const records = useMemo(() => [...d.derailments.items].reverse(), [d.derailments.items]);

  /**
   * One write path for every record action, so a save can only ever touch the
   * `derailments` table. The digest re-reads on the live query and recomputes
   * the same counts it computed before — that is the invariant, and the tests
   * pin it.
   */
  const write = useCallback(
    async (row: Record<string, unknown>, okBody: string) => {
      setBusy(true);
      try {
        await saveRow(TABLES.derailments, row);
        setDraft(null);
        toast(okBody, 'ok');
      } catch {
        toast('That record did not save. Nothing on this card changed.', 'bad');
      } finally {
        setBusy(false);
      }
    },
    [toast]
  );

  const derail = useMemo<DerailUi>(
    () => ({
      draft,
      busy,
      recordsFor: (t) => recordsAt(records, { kind: t.kind, refId: t.refId ?? null, dates: [t.on] }),
      start: (t, at) =>
        setDraft((prev) =>
          prev && prev.at === at && prev.id === null
            ? null
            : {
                id: null,
                at,
                on: t.on,
                kind: t.kind,
                refId: t.refId ?? null,
                refLabel: t.refLabel,
                trigger: '',
                reason: '',
                fix: '',
                followUpOn: '',
                status: 'open',
                resolvedOn: null
              }
        ),
      edit: (rec) =>
        setDraft({
          id: rec.id,
          at: `record:${rec.id}`,
          on: rec.on,
          kind: rec.kind,
          refId: rec.refId,
          refLabel: rec.refLabel,
          trigger: rec.trigger,
          reason: rec.reason,
          fix: rec.fix,
          followUpOn: rec.followUpOn ?? '',
          status: rec.status,
          resolvedOn: rec.resolvedOn
        }),
      patch: (next) => setDraft((prev) => (prev ? { ...prev, ...next } : prev)),
      cancel: () => setDraft(null),
      save: () => {
        if (!draft) return;
        const trigger = draft.trigger.trim();
        if (!trigger) {
          toast('Pick one label first — the tally only counts what you chose.', 'bad');
          return;
        }
        void write(
          {
            id: draft.id ?? newId('der'),
            on: draft.on,
            kind: draft.kind,
            refId: draft.refId ?? null,
            refLabel: draft.refLabel,
            trigger,
            reason: draft.reason.trim(),
            fix: draft.fix.trim(),
            followUpOn: draft.followUpOn ? draft.followUpOn : null,
            status: draft.status,
            resolvedOn: draft.resolvedOn
          },
          draft.id
            ? 'Record updated. The counts on this card did not move.'
            : 'Recorded. It explains the miss — no count on this card moved.'
        );
      },
      resolve: (rec) => {
        if (draft?.id === rec.id) setDraft(null);
        void write(
          { id: rec.id, status: 'resolved', resolvedOn: today },
          `Marked resolved on ${formatDate(today)}. The miss it explains is still counted, exactly as before.`
        );
      },
      remove: (rec) => {
        if (draft?.id === rec.id) setDraft(null);
        void moveToDeleted(TABLES.derailments, rec.id, `${rec.triggerLabel} on ${rec.on}`);
      }
    }),
    [draft, busy, records, today, toast, write, moveToDeleted]
  );

  if (!routinesReady || !logsReady || !derailmentsReady) {
    return <p className="gl-small gl-muted">Reading your logs from this device…</p>;
  }
  return <ConsistencyBody d={d} derail={derail} />;
}
