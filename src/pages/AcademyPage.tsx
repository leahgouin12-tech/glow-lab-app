import '../styles/departments/academy.css';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpenCheck,
  CircleDot,
  Clock3,
  Heart,
  ListChecks,
  PencilLine,
  Plus,
  Route as RouteIcon,
  Trash2
} from 'lucide-react';
import { TABLES, type AnyRow } from '../db/schema';
import { formatDate, newId, softDelete, todayISO } from '../db/repo';
import { saveRow, useRows } from '../hooks/live';
import {
  Button,
  Card,
  CardHead,
  Chip,
  Disclosure,
  Field,
  IconButton,
  Modal,
  Range,
  SafetyBanner,
  Section,
  Select,
  TagInput,
  TextArea,
  TextInput,
  useToast
} from '../ui/primitives';
import { DeptIntro, EmptyPlate, IndexList, IndexRow, KvList, ProgressRing, StatStrip } from '../ui/editorial';

/**
 * Glow Academy — spec Part 21.
 *
 * Every tutorial on this screen is a row in `tutorials`. Seeded ones are
 * original written guides authored for this app (tagged `seed: 1`) and are
 * labelled as starter content and individually removable. Nothing here is a
 * hosted video, an influencer recommendation or an external course link,
 * because we do not have any of those to offer — the page says so.
 */

const TIER = ['Not set', 'Gentle', 'Working at it', 'Involved'];

const uid = (p: string) => newId(p);

export default function AcademyPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const tutorials = useRows(TABLES.tutorials);
  const products = useRows(TABLES.products);
  const goals = useRows(TABLES.goals);
  const paths = useRows(TABLES.learningPaths);
  const techniques = useRows(TABLES.techniques);
  const practice = useRows(TABLES.observations, { where: { subjectType: 'tutorial' } });

  const [domain, setDomain] = useState('');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AnyRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AnyRow | null>(null);
  const [pathDraft, setPathDraft] = useState<{ title: string; goal: string } | null>(null);

  const wanted = params.get('tutorial');

  const open =
    tutorials.find((t) => t.id === openId) ??
    (wanted ? tutorials.find((t) => t.slug === wanted) : undefined) ??
    null;

  const domains = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tutorials) m.set(t.domain || 'unfiled', (m.get(t.domain || 'unfiled') ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [tutorials]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tutorials
      .filter((t) => (domain ? (t.domain || 'unfiled') === domain : true))
      .filter((t) => (q ? `${t.title} ${t.summary} ${(t.tags as string[]) ?? []}`.toLowerCase().includes(q) : true))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || String(a.title).localeCompare(String(b.title)));
  }, [tutorials, domain, query]);

  const doneSteps = (t: AnyRow) => ((t.data?.stepDone as string[]) ?? []);
  const totalDone = tutorials.reduce((n, t) => n + doneSteps(t).length, 0);
  const completed = tutorials.filter((t) => t.completedOn).length;
  const favorites = tutorials.filter((t) => t.favorite).length;

  /* ------------------------------------------------------------- mutations */

  const patch = async (t: AnyRow, changes: Record<string, unknown>) => {
    await saveRow(TABLES.tutorials, { id: t.id, ...changes, data: { ...(t.data ?? {}), ...((changes.data as object) ?? {}) } });
  };

  const toggleStep = (t: AnyRow, stepId: string) => {
    const cur = new Set(doneSteps(t));
    if (cur.has(stepId)) cur.delete(stepId);
    else cur.add(stepId);
    void patch(t, { data: { stepDone: [...cur] } });
  };

  const startRun = (t: AnyRow) => {
    void patch(t, { attempts: Number(t.attempts ?? 0) + 1, data: { lastRunOn: todayISO() } });
    toast(`Run ${Number(t.attempts ?? 0) + 1} started on “${t.title}”.`, 'ok');
  };

  const toggleFavorite = (t: AnyRow) => void patch(t, { favorite: !t.favorite });

  const markComplete = (t: AnyRow) => {
    void patch(t, { completedOn: t.completedOn ? null : todayISO() });
    toast(t.completedOn ? 'Completion date cleared.' : `Completed ${formatDate(todayISO())} — stored on the tutorial row.`, 'ok');
  };

  const practiseNow = async (t: AnyRow) => {
    const on = todayISO();
    await saveRow(TABLES.observations, {
      subjectType: 'tutorial',
      subjectId: t.id,
      on,
      note: `Practised “${t.title}”.`,
      reaction: 'none',
      severity: 0,
      mediaIds: [],
      tags: ['practice'],
      data: { source: 'academy' }
    });
    await saveRow(TABLES.logs, {
      channel: 'capture',
      level: 'info',
      message: `Academy practice logged — ${t.title}`,
      detail: `tutorial ${t.id} on ${on}`
    });
    const n = practice.filter((p) => p.subjectId === t.id).length + 1;
    toast(`Practice entry written. That is your ${n}${ordinal(n)} logged run of this tutorial.`, 'ok');
  };

  const linkMaterial = async (t: AnyRow, index: number, productId: string) => {
    const materials = (t.materials as AnyRow[]).map((m, i) => (i === index ? { ...m, productId: productId || null } : m));
    await patch(t, { materials });
  };

  const removeTutorial = async (t: AnyRow) => {
    await softDelete(TABLES.tutorials, t.id);
    setConfirmDelete(null);
    if (openId === t.id) setOpenId(null);
    toast(`“${t.title}” removed from your Academy. Nothing you logged elsewhere was touched.`, 'ok');
  };

  /* ------------------------------------------------------------------ render */

  if (open) {
    return (
      <div className="gl-page acad">
        <TutorialSpread
          tutorial={open}
          products={products}
          goals={goals}
          techniques={techniques}
          practiceCount={practice.filter((p) => p.subjectId === open.id).length}
          onBack={() => {
            setOpenId(null);
            if (wanted) navigate('/academy');
          }}
          onPatch={patch}
          onToggleStep={toggleStep}
          onStartRun={startRun}
          onFavorite={toggleFavorite}
          onComplete={markComplete}
          onPractise={practiseNow}
          onLinkMaterial={linkMaterial}
          onAskDelete={() => setConfirmDelete(open)}
          onEdit={() => setEditing(open)}
        />
        <ConfirmDelete row={confirmDelete} onCancel={() => setConfirmDelete(null)} onConfirm={() => void removeTutorial(confirmDelete!)} />
        {editing ? (
          <TutorialForm
            row={editing}
            onClose={() => setEditing(null)}
            onSave={async (payload) => {
              await patch(editing, payload);
              setEditing(null);
              toast('Your edits are saved on the tutorial row.', 'ok');
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="gl-page acad">
      <DeptIntro
        id="academy"
        actions={
          <>
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
              Write your own tutorial
            </Button>
            <Button variant="ghost" icon={<RouteIcon size={14} />} onClick={() => setPathDraft({ title: '', goal: '' })}>
              New learning path
            </Button>
          </>
        }
        meta={[
          { label: 'Tutorials stored', value: String(tutorials.length) },
          { label: 'Steps ticked', value: String(totalDone) },
          { label: 'Practice entries', value: String(practice.length) }
        ]}
      />

      <StatStrip
        items={[
          { label: 'In your Academy', value: tutorials.length, hint: 'rows in tutorials' },
          { label: 'Marked completed', value: completed, hint: completed ? `last ${formatDate([...tutorials].filter((t) => t.completedOn).sort((a, b) => String(b.completedOn).localeCompare(String(a.completedOn)))[0].completedOn)}` : 'none yet' },
          { label: 'Favourited', value: favorites, hint: 'your own shortlist' },
          { label: 'Learning paths', value: paths.length, hint: 'ordered by you' }
        ]}
      />

      <Section eyebrow="Filter" title="The index">
        <div className="gl-row acad-filter">
          <div style={{ flex: '1 1 260px', minWidth: 200 }}>
            <TextInput value={query} onChange={setQuery} placeholder="Search titles, summaries, tags" />
          </div>
          <div className="gl-chipbar">
            <Chip active={domain === ''} onClick={() => setDomain('')}>
              All domains
            </Chip>
            {domains.map(([d, n]) => (
              <Chip key={d} active={domain === d} onClick={() => setDomain(d)}>
                {d} <span className="gl-tech">{n}</span>
              </Chip>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <EmptyPlate
            kicker="Nothing to open"
            title={tutorials.length ? 'No tutorial matches that filter' : 'Your Academy is empty'}
            body={
              tutorials.length
                ? `${tutorials.length} tutorial${tutorials.length > 1 ? 's are' : ' is'} stored — clear the filter, or write a new one.`
                : 'Written guides, not hosted videos. You can write the first one yourself: a procedure you already know how to do, in steps you actually follow.'
            }
            action={
              tutorials.length ? (
                <Button onClick={() => { setQuery(''); setDomain(''); }}>Clear filters</Button>
              ) : (
                <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
                  Write your first tutorial
                </Button>
              )
            }
          />
        ) : (
          <IndexList>
            {visible.map((t, i) => {
              const done = doneSteps(t).length;
              const total = ((t.steps as AnyRow[]) ?? []).length;
              return (
                <IndexRow
                  key={t.id}
                  no={i + 1}
                  title={t.title}
                  sub={
                    <span className="acad-sub">
                      <span>{t.domain || 'unfiled'}</span>
                      <span className="acad-dot">·</span>
                      <span>{TIER[Number(t.difficulty)] ?? `tier ${t.difficulty}`}</span>
                      <span className="acad-dot">·</span>
                      <span>{Number(t.minutes) || 0} min</span>
                      {total ? (
                        <>
                          <span className="acad-dot">·</span>
                          <span>
                            {done}/{total} steps
                          </span>
                        </>
                      ) : null}
                      {Number(t.attempts) > 0 ? (
                        <>
                          <span className="acad-dot">·</span>
                          <span>{t.attempts} runs</span>
                        </>
                      ) : null}
                    </span>
                  }
                  right={
                    <>
                      {t.completedOn ? <Chip tone="gold">Completed</Chip> : null}
                      {t.seed === 1 ? <Chip tone="info">Starter</Chip> : null}
                      {t.favorite ? <Heart size={13} /> : null}
                    </>
                  }
                  onClick={() => setOpenId(t.id)}
                />
              );
            })}
          </IndexList>
        )}
      </Section>

      <div className="acad-shell">
        <Card>
          <CardHead
            eyebrow="Honest note"
            title="What this Academy is, and what it is not"
            sub="Read this once — it decides how much to trust the rest."
          />
          <div className="gl-stack" style={{ gap: 'var(--glow-sp-3)' }}>
            <SafetyBanner tone="note" title="Written guides, authored for this app">
              The starter tutorials were written by Glow Lab. They are not a video course, there is no streaming, no creator
              feed and no external enrolment. Nothing leaves this device.
            </SafetyBanner>
            <SafetyBanner tone="warn" title="Education, not advice">
              Where a tutorial touches a technique that carries risk, it links to that technique's evidence record in the
              Knowledge Library. Grading and safety flags live there — this page does not overrule them.
            </SafetyBanner>
            <p className="gl-small gl-muted" style={{ margin: 0 }}>
              Starter tutorials are yours to edit or delete. Deleting one only removes it from this list; your own notes,
              practice entries and photographs stay where they are.
            </p>
          </div>
        </Card>

        <Card>
          <CardHead
            eyebrow="Sequencing"
            title="Learning paths"
            right={
              <IconButton label="New learning path" onClick={() => setPathDraft({ title: '', goal: '' })}>
                <Plus size={15} />
              </IconButton>
            }
          />
          {paths.length === 0 ? (
            <div className="gl-stack" style={{ gap: 'var(--glow-sp-3)' }}>
              <p className="gl-small gl-muted" style={{ margin: 0 }}>
                A path is an ordered list of your tutorials with a goal written in your own words. Progress is steps you
                ticked — not a certificate.
              </p>
              <Button variant="primary" size="sm" icon={<ListChecks size={14} />} onClick={() => setPathDraft({ title: '', goal: '' })}>
                Create a path
              </Button>
            </div>
          ) : (
            <div className="gl-stack acad-paths">
              {paths.map((p) => (
                <PathCard
                  key={p.id}
                  path={p}
                  tutorials={tutorials}
                  onOpen={(id) => setOpenId(id)}
                  onChange={async (changes) => {
                    await saveRow(TABLES.learningPaths, { id: p.id, ...changes });
                  }}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      {creating ? (
        <TutorialForm
          onClose={() => setCreating(false)}
          onSave={async (payload) => {
            const saved = await saveRow(TABLES.tutorials, { ...payload, seed: 0, id: uid('tut') });
            setCreating(false);
            setOpenId(saved.id);
            toast('Saved as your own tutorial — no starter badge on it.', 'ok');
          }}
        />
      ) : null}

      <ConfirmDelete row={confirmDelete} onCancel={() => setConfirmDelete(null)} onConfirm={() => void removeTutorial(confirmDelete!)} />

      {pathDraft ? (
        <Modal
          open
          onClose={() => setPathDraft(null)}
          title="New learning path"
          footer={
            <>
              <Button variant="ghost" onClick={() => setPathDraft(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!pathDraft.title.trim()}
                onClick={async () => {
                  await saveRow(TABLES.learningPaths, { id: uid('pth'), title: pathDraft.title.trim(), goal: pathDraft.goal.trim(), tutorialIds: [], doneIds: [] });
                  setPathDraft(null);
                  toast('Path created. Add tutorials to it from the rail.', 'ok');
                }}
              >
                Create path
              </Button>
            </>
          }
        >
          <div className="gl-form-row">
            <Field label="What is the path called?">
              <TextInput value={pathDraft.title} onChange={(v) => setPathDraft({ ...pathDraft, title: v })} placeholder="e.g. Get my documentation habit working" />
            </Field>
          </div>
          <Field label="The goal, in your words" hint="Free text. No target is inferred for you.">
            <TextArea value={pathDraft.goal} onChange={(v) => setPathDraft({ ...pathDraft, goal: v })} rows={3} placeholder="What will you be able to do when this path is finished?" />
          </Field>
        </Modal>
      ) : null}
    </div>
  );
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/** Plain-text navigation button — uses the shared `.gl-btn--link` treatment. */
function TextBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="gl-btn gl-btn--link gl-btn--sm" onClick={onClick}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ spread */

function TutorialSpread({
  tutorial: t,
  products,
  goals,
  techniques,
  practiceCount,
  onBack,
  onPatch,
  onToggleStep,
  onStartRun,
  onFavorite,
  onComplete,
  onPractise,
  onLinkMaterial,
  onAskDelete,
  onEdit
}: {
  tutorial: AnyRow;
  products: AnyRow[];
  goals: AnyRow[];
  techniques: AnyRow[];
  practiceCount: number;
  onBack: () => void;
  onPatch: (t: AnyRow, changes: Record<string, unknown>) => Promise<void>;
  onToggleStep: (t: AnyRow, stepId: string) => void;
  onStartRun: (t: AnyRow) => void;
  onFavorite: (t: AnyRow) => void;
  onComplete: (t: AnyRow) => void;
  onPractise: (t: AnyRow) => void;
  onLinkMaterial: (t: AnyRow, index: number, productId: string) => void;
  onAskDelete: () => void;
  onEdit: () => void;
}) {
  const navigate = useNavigate();
  const steps = (t.steps as AnyRow[]) ?? [];
  const done = new Set(((t.data?.stepDone as string[]) ?? []));
  const notes = String(t.data?.notes ?? '');
  const [noteDraft, setNoteDraft] = useState(notes);
  const materials = (t.materials as AnyRow[]) ?? [];
  const pitfalls = (t.pitfalls as string[]) ?? [];
  const linked = (t.relatedTechniqueIds as string[])?.length
    ? techniques.filter((x) => (t.relatedTechniqueIds as string[]).includes(x.id))
    : techniques.filter((x) => x.domain === t.domain);
  const refused = techniques.filter((x) => x.safety === 'unsafe');

  return (
    <>
      <div className="gl-row gl-row--between acad-back">
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={onBack}>
          Back to the index
        </Button>
        <div className="gl-row gl-row--tight">
          <IconButton label={t.favorite ? 'Remove from favourites' : 'Favourite this tutorial'} active={Boolean(t.favorite)} tone="gold" onClick={() => onFavorite(t)}>
            <Heart size={15} />
          </IconButton>
          <IconButton label="Edit this tutorial" onClick={onEdit}>
            <PencilLine size={15} />
          </IconButton>
          {t.seed === 1 ? (
            <IconButton label="Remove starter tutorial from my Academy" tone="danger" onClick={onAskDelete}>
              <Trash2 size={15} />
            </IconButton>
          ) : null}
        </div>
      </div>

      <article className="acad-spread">
        <header className="acad-spread__head">
          <div className="gl-eyebrow">
            {t.domain || 'unfiled'} · {TIER[Number(t.difficulty)] ?? 'tier ?'} · {Number(t.minutes) || 0} minutes
          </div>
          <h1 className="gl-display acad-hed">{t.title}</h1>
          <p className="gl-lead">{t.summary}</p>
          <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-3)' }}>
            {t.seed === 1 ? <Chip tone="info">Glow Lab starter content</Chip> : <Chip tone="gold">Written by you</Chip>}
            <Chip>
              <Clock3 size={11} /> {done.size}/{steps.length} steps ticked
            </Chip>
            {Number(t.attempts) > 0 ? <Chip>{t.attempts} run{Number(t.attempts) > 1 ? 's' : ''} started</Chip> : null}
            {t.completedOn ? <Chip tone="gold">Completed {formatDate(t.completedOn)}</Chip> : null}
            {t.data?.lastRunOn ? <Chip tone="moderate">Last run {formatDate(String(t.data.lastRunOn))}</Chip> : null}
          </div>
        </header>

        <div className="acad-spread__body">
          <div className="acad-main">
            <div className="gl-row gl-row--tight acad-actions">
              <Button variant="primary" size="sm" icon={<CircleDot size={14} />} onClick={() => onStartRun(t)}>
                Start a run
              </Button>
              <Button size="sm" icon={<BookOpenCheck size={14} />} onClick={() => void onPractise(t)}>
                Practised it now
              </Button>
              <Button size="sm" variant={t.completedOn ? 'ghost' : 'gold'} onClick={() => onComplete(t)}>
                {t.completedOn ? 'Clear completion' : 'Mark completed'}
              </Button>
            </div>

            <ol className="acad-steps">
              {steps.map((s, i) => {
                const isDone = done.has(String(s.id));
                return (
                  <li key={String(s.id ?? i)} className={`acad-step ${isDone ? 'acad-step--done' : ''}`}>
                    <label className="gl-check" style={{ alignItems: 'flex-start' }}>
                      <input type="checkbox" checked={isDone} onChange={() => onToggleStep(t, String(s.id))} />
                      <span>
                        <span className="acad-step__no">{String(i + 1).padStart(2, '0')}</span>
                        <span className="acad-step__label">{s.label}</span>
                        {s.detail ? <span className="acad-step__detail">{s.detail}</span> : null}
                        {s.caution ? <span className="acad-step__caution">Caution — {s.caution}</span> : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ol>

            {practiceCount > 0 ? (
              <div className="gl-note gl-note--ok">
                You have logged <b>{practiceCount}</b> practice {practiceCount === 1 ? 'entry' : 'entries'} against this
                tutorial. They are stored as observations with <code>subjectType: tutorial</code> and appear in your
                Progress counts.
              </div>
            ) : (
              <div className="gl-note">
                No practice entries yet. “Practised it now” writes one dated row — that is the only record this page keeps
                of you having done it.
              </div>
            )}

            <Field label="Your notes on this tutorial" hint="Saved on the tutorial row when you click Save.">
              <TextArea value={noteDraft} onChange={setNoteDraft} rows={4} placeholder="What worked for you, what you would change next time, what you forgot." />
            </Field>
            <Button
              size="sm"
              disabled={noteDraft === notes}
              onClick={() => {
                void onPatch(t, { data: { notes: noteDraft } });
              }}
            >
              {noteDraft === notes ? 'Notes saved' : 'Save notes'}
            </Button>
          </div>

          <aside className="acad-side gl-rule-col">
            <h3 className="gl-serif acad-side__h">What you need</h3>
            {materials.length === 0 ? (
              <p className="gl-small gl-muted">No materials listed for this tutorial.</p>
            ) : (
              <ul className="acad-materials">
                {materials.map((m, i) => {
                  const prod = products.find((p) => p.id === m.productId);
                  return (
                    <li key={`${String(m.label)}-${i}`}>
                      <div className="gl-row gl-row--between" style={{ gap: 8 }}>
                        <span className="gl-small">
                          {String(m.label)}
                          {m.optional ? <span className="gl-faint"> · optional</span> : null}
                        </span>
                        {prod ? (
                          <TextBtn onClick={() => navigate(`/market?product=${prod.id}`)}>
                            {prod.name}
                          </TextBtn>
                        ) : null}
                      </div>
                      {products.length ? (
                        <Select
                          value={String(m.productId ?? '')}
                          onChange={(v) => onLinkMaterial(t, i, v)}
                          placeholder="Link one of your products…"
                          options={products.map((p) => ({ value: p.id, label: `${p.name}${p.brand ? ` — ${p.brand}` : ''}` }))}
                        />
                      ) : (
                        <span className="gl-tech gl-faint">Your product library is empty — link nothing yet.</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {pitfalls.length ? (
              <>
                <h3 className="gl-serif acad-side__h">Where people get it wrong</h3>
                <ul className="acad-pitfalls">
                  {pitfalls.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </>
            ) : null}

            {goals.length ? (
              <>
                <h3 className="gl-serif acad-side__h">Tie it to a goal</h3>
                <Select
                  value={String(t.relatedGoalIds?.[0] ?? '')}
                  onChange={async (v) => {
                    await onPatch(t, { relatedGoalIds: v ? [v] : [] });
                  }}
                  placeholder="Not linked to a goal"
                  options={goals.map((g) => ({ value: g.id, label: g.title }))}
                />
                {t.relatedGoalIds?.[0] ? (
                  <TextBtn onClick={() => navigate('/looksmaxxing')}>
                    Open that goal
                  </TextBtn>
                ) : null}
              </>
            ) : null}

            {linked.length ? (
              <Disclosure summary={`Evidence in this domain (${linked.length})`}>
                <div className="gl-stack" style={{ gap: 6 }}>
                  {linked.slice(0, 8).map((x) => (
                    <TextBtn key={x.id} onClick={() => navigate(`/knowledge?technique=${x.slug}`)}>
                      {x.title}
                    </TextBtn>
                  ))}
                  <p className="gl-tech gl-faint">Grading lives in the Knowledge Library. The Academy does not restate it.</p>
                </div>
              </Disclosure>
            ) : null}

            {refused.length ? (
              <SafetyBanner tone="danger" title={`${refused.length} technique${refused.length > 1 ? 's' : ''} in this app are recorded as unsafe`}>
                The Academy documents them so you can find the truth about them. It will not turn any of them into a step,
                a task or a plan. The full register lives in the Knowledge Library.
                <div style={{ marginTop: 6 }}>
                  <TextBtn onClick={() => navigate('/knowledge?view=unsafe')}>Open the unsafe register</TextBtn>
                </div>
              </SafetyBanner>
            ) : null}

            <KvList
              items={[
                { k: 'Slug', v: <span className="gl-tech">{String(t.slug ?? '—')}</span> },
                { k: 'Row id', v: <span className="gl-tech">{String(t.id)}</span> },
                { k: 'Revisions', v: String(t.rev ?? 1) },
                { k: 'Updated', v: formatDate(new Date(Number(t.updatedAt ?? Date.now())).toISOString().slice(0, 10)) }
              ]}
            />
          </aside>
        </div>
      </article>
    </>
  );
}

/* --------------------------------------------------------------- path card */

function PathCard({
  path,
  tutorials,
  onOpen,
  onChange
}: {
  path: AnyRow;
  tutorials: AnyRow[];
  onOpen: (id: string) => void;
  onChange: (changes: Record<string, unknown>) => Promise<void>;
}) {
  const ids = (path.tutorialIds as string[]) ?? [];
  const done = new Set((path.doneIds as string[]) ?? []);
  const [add, setAdd] = useState('');
  const pctVal = ids.length ? Math.round((ids.filter((i) => done.has(i)).length / ids.length) * 100) : 0;
  const byId = new Map(tutorials.map((t) => [t.id, t]));

  const move = (index: number, dir: -1 | 1) => {
    const next = [...ids];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    void onChange({ tutorialIds: next });
  };

  return (
    <div className="gl-inset acad-path">
      <div className="gl-row gl-row--between" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="gl-serif" style={{ fontSize: '1.15rem', color: 'var(--glow-text-strong)' }}>
            {path.title}
          </div>
          <div className="gl-small gl-muted">{path.goal || 'No goal written yet.'}</div>
        </div>
        <ProgressRing value={pctVal} size={58} sub={`${ids.filter((i) => done.has(i)).length}/${ids.length}`} />
      </div>

      {ids.length === 0 ? (
        <p className="gl-small gl-faint">Empty path — add tutorials below. Order is yours; nothing is auto-sorted.</p>
      ) : (
        <ol className="acad-path__list">
          {ids.map((id, i) => {
            const t = byId.get(id);
            return (
              <li key={id}>
                <label className="gl-check">
                  <input
                    type="checkbox"
                    checked={done.has(id)}
                    onChange={() => {
                      const n = new Set(done);
                      if (n.has(id)) n.delete(id);
                      else n.add(id);
                      void onChange({ doneIds: [...n] });
                    }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <TextBtn onClick={() => onOpen(id)}>{t ? t.title : 'Removed tutorial'}</TextBtn>
                    {t ? <span className="gl-tech gl-faint"> · {Number(t.minutes) || 0} min</span> : null}
                  </span>
                </label>
                <span className="acad-path__tools">
                  <IconButton label="Move earlier" onClick={() => move(i, -1)}>
                    ↑
                  </IconButton>
                  <IconButton label="Move later" onClick={() => move(i, 1)}>
                    ↓
                  </IconButton>
                  <IconButton label="Remove from path" tone="danger" onClick={() => void onChange({ tutorialIds: ids.filter((x) => x !== id) })}>
                    ✕
                  </IconButton>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="gl-row" style={{ marginTop: 'var(--glow-sp-3)' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <Select value={add} onChange={setAdd} placeholder="Add a tutorial…" options={tutorials.filter((t) => !ids.includes(t.id)).map((t) => ({ value: t.id, label: t.title }))} />
        </div>
        <Button
          size="sm"
          disabled={!add}
          onClick={async () => {
            await onChange({ tutorialIds: [...ids, add] });
            setAdd('');
          }}
        >
          Add
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const label = window.prompt('Rename this path');
            if (label) void onChange({ title: label });
          }}
        >
          Rename
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- form modal */

function TutorialForm({
  row,
  onClose,
  onSave
}: {
  row?: AnyRow;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [title, setTitle] = useState(String(row?.title ?? ''));
  const [dom, setDom] = useState(String(row?.domain ?? ''));
  const [summary, setSummary] = useState(String(row?.summary ?? ''));
  const [difficulty, setDifficulty] = useState(Number(row?.difficulty ?? 1));
  const [minutes, setMinutes] = useState(Number(row?.minutes ?? 20));
  const [materials, setMaterials] = useState<string[]>(((row?.materials as AnyRow[]) ?? []).map((m) => String(m.label)));
  const [pitfalls, setPitfalls] = useState<string[]>((row?.pitfalls as string[]) ?? []);
  const [steps, setSteps] = useState<{ id: string; label: string; detail: string }[]>(
    ((row?.steps as AnyRow[]) ?? []).map((s, i) => ({ id: String(s.id ?? `u${i}`), label: String(s.label ?? ''), detail: String(s.detail ?? '') }))
  );
  const [tags, setTags] = useState<string[]>((row?.tags as string[]) ?? []);
  const [busy, setBusy] = useState(false);

  const valid = title.trim().length > 2;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={row ? 'Edit tutorial' : 'Write a tutorial'}
      footer={
        <>
          <span className="gl-tech gl-faint">Steps are stored in order on the row. Nothing is published anywhere.</span>
          <div className="gl-row gl-row--tight">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!valid || busy}
              onClick={async () => {
                setBusy(true);
                await onSave({
                  title: title.trim(),
                  domain: dom.trim() || 'general',
                  summary: summary.trim(),
                  difficulty,
                  minutes: Number(minutes) || 0,
                  materials: materials.filter(Boolean).map((label) => ({ label, productId: null, optional: false })),
                  steps: steps.filter((s) => s.label.trim()).map((s, i) => ({ id: s.id, order: i + 1, label: s.label.trim(), detail: s.detail, mediaId: null, caution: '' })),
                  pitfalls: pitfalls.filter(Boolean),
                  tags,
                  slug: row?.slug ?? `user-${uid('s').slice(-6)}`,
                  ...(row
                    ? {}
                    : { favorite: false, completedOn: null, attempts: 0, relatedTechniqueIds: [], relatedProductIds: [], relatedGoalIds: [] })
                });
                setBusy(false);
              }}
            >
              {busy ? 'Saving…' : 'Save tutorial'}
            </Button>
          </div>
        </>
      }
    >
      <div className="gl-form-row">
        <Field label="Title">
          <TextInput value={title} onChange={setTitle} placeholder="Name the procedure" />
        </Field>
        <Field label="Domain" hint="Used for the filter chips.">
          <TextInput value={dom} onChange={setDom} placeholder="skincare, hair, style…" />
        </Field>
      </div>
      <Field label="One-paragraph summary">
        <TextArea value={summary} onChange={setSummary} rows={3} placeholder="Why this is worth doing properly, in plain words." />
      </Field>
      <div className="acad-form__row">
        <Range label="Difficulty" value={difficulty} min={1} max={3} onChange={setDifficulty} format={(v) => TIER[v] ?? String(v)} />
        <Field label="Minutes you actually need">
          <TextInput type="number" value={minutes} onChange={(v) => setMinutes(Number(v) || 0)} />
        </Field>
      </div>

      <Field label="Materials">
        <Repeater items={materials} onChange={setMaterials} placeholder="Tool, product or record needed" addLabel="Add material" />
      </Field>

      <div className="acad-steps-edit">
        <div className="gl-field__label">Steps, in order</div>
        {steps.map((s, i) => (
          <div className="acad-steps-edit__row" key={s.id}>
            <span className="acad-step__no">{String(i + 1).padStart(2, '0')}</span>
            <div style={{ flex: 1, minWidth: 160 }}>
              <TextInput value={s.label} onChange={(v) => setSteps(steps.map((x, j) => (j === i ? { ...x, label: v } : x)))} placeholder="What you do" />
              <TextArea value={s.detail} onChange={(v) => setSteps(steps.map((x, j) => (j === i ? { ...x, detail: v } : x)))} rows={2} placeholder="How, and what good looks like" />
            </div>
            <IconButton label={`Delete step ${i + 1}`} tone="danger" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
              <Trash2 size={14} />
            </IconButton>
          </div>
        ))}
        <Button size="sm" icon={<Plus size={13} />} onClick={() => setSteps([...steps, { id: uid('u'), label: '', detail: '' }])}>
          Add step
        </Button>
      </div>

      <Field label="Pitfalls">
        <Repeater items={pitfalls} onChange={setPitfalls} placeholder="The mistake people actually make" addLabel="Add pitfall" />
      </Field>

      <Field label="Tags">
        <TagInput values={tags} onChange={setTags} />
      </Field>
    </Modal>
  );
}

function Repeater({ items, onChange, placeholder, addLabel }: { items: string[]; onChange: (v: string[]) => void; placeholder: string; addLabel: string }) {
  return (
    <div className="gl-stack" style={{ gap: 6 }}>
      {items.map((v, i) => (
        <div className="gl-row gl-row--tight" key={i}>
          <div style={{ flex: 1 }}>
            <TextInput value={v} onChange={(x) => onChange(items.map((y, j) => (j === i ? x : y)))} placeholder={placeholder} />
          </div>
          <IconButton label="Remove" tone="danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            ✕
          </IconButton>
        </div>
      ))}
      <div>
        <Button size="sm" icon={<Plus size={13} />} onClick={() => onChange([...items, ''])}>
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

function ConfirmDelete({ row, onCancel, onConfirm }: { row: AnyRow | null; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal
      open={Boolean(row)}
      onClose={onCancel}
      title="Remove this tutorial?"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Keep it
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Remove from my Academy
          </Button>
        </>
      }
    >
      <p className="gl-small">
        <b>{row?.title}</b> will stop appearing in your index, your paths and your counts.
      </p>
      <p className="gl-small gl-muted">
        Practice entries you logged against it stay in your records, because they are facts about what you did, not about
        this guide.
      </p>
    </Modal>
  );
}
