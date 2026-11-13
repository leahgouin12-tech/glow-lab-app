import '../styles/departments/knowledge.css';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileQuestion, Link2, Plus, RotateCcw, ShieldAlert, Trash2, Undo2 } from 'lucide-react';
import { TABLES, type AnyRow } from '../db/schema';
import { formatDate, hardDelete, newId, restore, softDelete, tokenMatch, todayISO } from '../db/repo';
import { saveRow, useRows } from '../hooks/live';
import {
  Button,
  Card,
  CardHead,
  Chip,
  Disclosure,
  EmptyState,
  EvidenceChip,
  Field,
  IconButton,
  Modal,
  Range,
  SafetyBanner,
  Section,
  SegmentedControl,
  Select,
  TagInput,
  TextArea,
  TextInput,
  useDebounced,
  useToast
} from '../ui/primitives';
import { DeptIntro, EmptyPlate, IndexList, IndexRow, KvList, StatStrip } from '../ui/editorial';

/**
 * Personal Knowledge Library — spec Part 22.
 *
 * Two separate things live here and are never merged:
 *   1. `techniques` rows — Glow Lab's evidence-graded reference records. Read-only
 *      apart from deletion of starter ones; their grading vocabulary is explained,
 *      never invented. Source URLs stay exactly as stored: where a seed left the
 *      url blank, this page prints "no source URL stored" rather than guessing one.
 *   2. `knowledge` rows — the user's own notes, with their own confidence and their
 *      own verdict on whether something worked.
 *
 * No external lookups, no web results, no summaries we did not write.
 */

const GRADES: { grade: string; means: string; notMeans: string }[] = [
  {
    grade: 'strong',
    means: 'Several independent lines of work, or settled professional consensus, point the same way.',
    notMeans: 'Does not mean it will work on you, or that the effect is large — only that the direction is well supported.'
  },
  {
    grade: 'moderate',
    means: 'Genuine support with visible gaps: smaller studies, shorter follow-up, or conditions unlike everyday use.',
    notMeans: 'Does not mean "half proven". It means the uncertainty is specific and you should price it in.'
  },
  {
    grade: 'limited',
    means: 'Something exists, but it is thin, indirect or conflicting.',
    notMeans: 'Does not mean false. It means this is a hypothesis worth testing, not a basis for a plan.'
  },
  {
    grade: 'weak',
    means: 'Very little that would convince a careful reader.',
    notMeans: 'Does not mean banned or impossible — just that you are paying for a guess.'
  },
  {
    grade: 'unsupported',
    means: 'The specific claim is not supported by what currently exists.',
    notMeans: 'Being listed here is a warning label. It is never an invitation.'
  },
  {
    grade: 'emerging',
    means: 'A new area: the mechanism is plausible, long-term human data is missing.',
    notMeans: 'Does not mean "the latest science says yes".'
  },
  {
    grade: 'traditional',
    means: 'A long history of practice across one or more cultures.',
    notMeans: 'Age of a habit is not evidence of measured effect. Duration of use ≠ proof.'
  },
  {
    grade: 'cosmetic',
    means: 'Changes appearance by covering, tinting or shaping. Works while it is on.',
    notMeans: 'Does not change structure and does not accumulate. Removal reverses it entirely.'
  },
  {
    grade: 'professional',
    means: 'Performed by a qualified clinician in a regulated setting, or supplied on their assessment.',
    notMeans: 'This app stores what your clinician told you. It cannot assess candidacy — that is a consultation.'
  },
  {
    grade: 'dangerous',
    means: 'Documented harm without supporting evidence.',
    notMeans: 'Never turned into a step, a task, a plan or a schedule anywhere in Glow Lab.'
  }
];

const KINDS = ['note', 'research', 'reference', 'observation', 'skill'] as const;
const WORKED = ['unset', 'yes', 'mixed', 'no'] as const;

/** Maps a grade onto the tones the shared Chip primitive actually supports. */
type ChipTone = 'strong' | 'moderate' | 'limited' | 'weak' | 'unsupported' | 'unsafe' | 'danger' | 'gold' | 'info';
const GRADE_TONE: Record<string, ChipTone> = {
  strong: 'strong',
  moderate: 'moderate',
  limited: 'limited',
  weak: 'weak',
  unsupported: 'unsupported',
  emerging: 'info',
  traditional: 'info',
  cosmetic: 'gold',
  professional: 'info',
  dangerous: 'danger'
};
const gradeTone = (g: string): ChipTone => GRADE_TONE[g] ?? 'info';

const uid = (p: string) => newId(p);

export default function KnowledgePage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const entries = useRows(TABLES.knowledge);
  const techniques = useRows(TABLES.techniques);
  const goals = useRows(TABLES.goals);
  const products = useRows(TABLES.products);
  const experiments = useRows(TABLES.experiments);

  const [view, setView] = useState('library');
  const [rawQuery, setRawQuery] = useState('');
  const query = useDebounced(rawQuery, 200);
  const [kind, setKind] = useState('');
  const [dom, setDom] = useState('');
  const [grade, setGrade] = useState('');
  const [tag, setTag] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [openTrash, setOpenTrash] = useState(false);
  const [askPurge, setAskPurge] = useState<AnyRow | null>(null);
  const [askDrop, setAskDrop] = useState<{ row: AnyRow; table: 'knowledge' | 'techniques' } | null>(null);

  const wantedEntry = params.get('entry');
  const wantedTechnique = params.get('technique');
  const paramView = params.get('view');

  useEffect(() => {
    if (paramView === 'unsafe') setView('unsafe');
    if (paramView === 'trash') setOpenTrash(true);
  }, [paramView]);

  useEffect(() => {
    if (wantedEntry) setSelected(wantedEntry);
  }, [wantedEntry]);

  const techniqueRow = wantedTechnique ? techniques.find((t) => t.slug === wantedTechnique) ?? null : null;

  const domains = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.domain || 'unfiled', (m.get(e.domain || 'unfiled') ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [entries]);

  const tags = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) for (const t of ((e.tags as string[]) ?? [])) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 18);
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => (kind ? e.kind === kind : true))
      .filter((e) => (dom ? (e.domain || 'unfiled') === dom : true))
      .filter((e) => (grade ? String(e.evidence ?? '') === grade : true))
      .filter((e) => (tag ? ((e.tags as string[]) ?? []).includes(tag) : true))
      .filter((e) => (q ? tokenMatch(String(e.text ?? ''), q) > 0 || (e.title ?? '').toLowerCase().includes(q) : true))
      .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));
  }, [entries, kind, dom, grade, tag, query]);

  const mine = entries.filter((e) => e.seed !== 1);
  const unsafe = useMemo(() => {
    const hard = techniques.filter((t) => t.safety === 'unsafe');
    const mews = techniques.filter((t) => t.slug === 'mewing');
    return [...hard, ...mews.filter((m) => !hard.some((h) => h.id === m.id))];
  }, [techniques]);

  const selectedEntry = entries.find((e) => e.id === selected) ?? null;

  const createEntry = async () => {
    const row = await saveRow(TABLES.knowledge, {
      id: uid('kno'),
      title: '',
      kind: 'note',
      body: '',
      domain: dom || 'general',
      confidence: 3,
      worked: 'unset',
      slug: `note-${uid('s').slice(-6)}`,
      evidence: '',
      cautions: '',
      linkedGoalIds: [],
      linkedTechniqueIds: [],
      linkedProductIds: [],
      linkedExperimentIds: [],
      tags: [],
      seed: 0
    });
    setSelected(row.id);
    setView('library');
    toast('Blank note created and opened. It is a real row — closing without typing still leaves an empty note you can delete.', 'info');
  };

  /* ------------------------------------------------------------------ render */

  return (
    <div className="gl-page kn">
      <DeptIntro
        id="knowledge"
        actions={
          <>
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => void createEntry()}>
              New note
            </Button>
            <Button variant="ghost" icon={<FileQuestion size={14} />} onClick={() => setView(view === 'unsafe' ? 'library' : 'unsafe')}>
              {view === 'unsafe' ? 'Back to the library' : 'Unsafe register'}
            </Button>
            <Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => setOpenTrash((v) => !v)}>
              {openTrash ? 'Hide bin' : 'Bin'}
            </Button>
          </>
        }
        meta={[
          { label: 'Your entries', value: String(mine.length) },
          { label: 'Reference records', value: String(entries.filter((e) => e.seed === 1).length) },
          { label: 'Graded techniques', value: String(techniques.length) }
        ]}
      />

      {view === 'unsafe' ? (
        <UnsafeRegister unsafe={unsafe} techniques={techniques} onBack={() => setView('library')} onOpen={(slug) => navigate(`/knowledge?technique=${slug}`)} />
      ) : (
        <>
          <StatStrip
            items={[
              { label: 'Entries in the library', value: entries.length, hint: 'knowledge rows' },
              { label: 'You wrote', value: mine.length, hint: 'non-starter' },
              { label: 'Marked as worked', value: entries.filter((e) => e.worked === 'yes').length, hint: 'your own verdict' },
              { label: 'Carrying a caution', value: entries.filter((e) => String(e.cautions ?? '').trim()).length, hint: 'notes with warnings' }
            ]}
          />

          <GradeLegend />

          <div className="kn-work">
            <div className="kn-rail">
              <Card>
                <CardHead eyebrow="Find" title="Search the library" sub={`${entries.length} stored ${entries.length === 1 ? 'entry' : 'entries'}`} />
                <div className="gl-stack" style={{ gap: 'var(--glow-sp-3)' }}>
                  <TextInput value={rawQuery} onChange={setRawQuery} placeholder="Title, body, tag — every word must appear" />
                  <SegmentedControl
                    value={kind}
                    onChange={setKind}
                    size="sm"
                    options={[{ value: '', label: 'Any kind' }, ...KINDS.map((k) => ({ value: k, label: k }))]}
                  />
                  <div className="gl-chipbar">
                    <Chip active={dom === ''} onClick={() => setDom('')}>
                      All domains
                    </Chip>
                    {domains.map(([d, n]) => (
                      <Chip key={d} active={dom === d} onClick={() => setDom(d)}>
                        {d} <span className="gl-tech">{n}</span>
                      </Chip>
                    ))}
                  </div>
                  <div className="gl-chipbar">
                    <Chip active={grade === ''} onClick={() => setGrade('')}>
                      Any grade
                    </Chip>
                    {GRADES.map((g) => (
                      <Chip key={g.grade} tone={gradeTone(g.grade)} active={grade === g.grade} onClick={() => setGrade(g.grade)}>
                        {g.grade}
                      </Chip>
                    ))}
                  </div>
                  {tags.length ? (
                    <div className="gl-chipbar">
                      <Chip active={tag === ''} onClick={() => setTag('')}>
                        Any tag
                      </Chip>
                      {tags.map(([t, n]) => (
                        <Chip key={t} active={tag === t} onClick={() => setTag(t)}>
                          {t} <span className="gl-tech">{n}</span>
                        </Chip>
                      ))}
                    </div>
                  ) : null}
                  {kind || dom || grade || tag || query ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setKind('');
                        setDom('');
                        setGrade('');
                        setTag('');
                        setRawQuery('');
                      }}
                    >
                      Clear all filters
                    </Button>
                  ) : null}
                </div>
              </Card>

              {filtered.length === 0 ? (
                <EmptyPlate
                  kicker={entries.length ? 'No match' : 'Empty shelf'}
                  title={entries.length ? 'Nothing fits that combination' : 'The library holds nothing yet'}
                  body={
                    entries.length
                      ? 'Your filters are stacked — every one must pass. Or write the note yourself: a thing you verified with your own skin, hair, mirror or receipt.'
                      : 'Starter content was never installed, or you removed it. Notes here are yours: what you read, what you concluded, whether it actually worked.'
                  }
                  action={
                    entries.length ? (
                      <Button onClick={() => { setKind(''); setDom(''); setGrade(''); setTag(''); setRawQuery(''); }}>Reset filters</Button>
                    ) : (
                      <Button variant="primary" icon={<Plus size={14} />} onClick={() => void createEntry()}>
                        Write the first note
                      </Button>
                    )
                  }
                />
              ) : (
                <div className="gl-list kn-index">
                  <IndexList>
                    {filtered.map((e, i) => (
                      <IndexRow
                        key={e.id}
                        no={i + 1}
                        title={e.title || 'Untitled note'}
                        sub={
                          <span className="kn-sub">
                            <span>{e.kind}</span>
                            <span>·</span>
                            <span>{e.domain || 'unfiled'}</span>
                            {e.evidence ? (
                              <>
                                <span>·</span>
                                <span>graded {e.evidence}</span>
                              </>
                            ) : null}
                            {e.worked && e.worked !== 'unset' ? (
                              <>
                                <span>·</span>
                                <span>worked: {e.worked}</span>
                              </>
                            ) : null}
                            <span>·</span>
                            <span>{formatDate(new Date(Number(e.updatedAt ?? Date.now())).toISOString().slice(0, 10))}</span>
                          </span>
                        }
                        right={e.seed === 1 ? <Chip tone="info">Reference</Chip> : null}
                        onClick={() => setSelected(e.id)}
                      />
                    ))}
                  </IndexList>
                </div>
              )}
            </div>

            <div className="kn-pane gl-rule-col">
              {techniqueRow ? (
                <TechniqueDossier
                  row={techniqueRow}
                  onClose={() => navigate('/knowledge')}
                  onAskDelete={() => setAskDrop({ row: techniqueRow, table: 'techniques' })}
                />
              ) : selectedEntry ? (
                <EntryEditor
                  entry={selectedEntry}
                  goals={goals}
                  products={products}
                  experiments={experiments}
                  techniques={techniques}
                  onNavigate={(p) => navigate(p)}
                  onDelete={() => setAskDrop({ row: selectedEntry, table: 'knowledge' })}
                />
              ) : (
                <Card>
                  <CardHead eyebrow="How this page works" title="Two kinds of record, never blended" />
                  <div className="gl-stack" style={{ gap: 'var(--glow-sp-3)' }}>
                    <p className="gl-small gl-muted" style={{ margin: 0 }}>
                      On the left is your library: notes you wrote, plus reference entries that shipped with the app. Pick
                      one to read or edit it. Reference entries are marked and you can delete them, but their grading text
                      is Glow Lab's own writing, kept identical for everyone.
                    </p>
                    <p className="gl-small gl-muted" style={{ margin: 0 }}>
                      The techniques that those entries point at are graded separately, and the unsafe ones are quarantined
                      in a register that refuses to plan them.
                    </p>
                    <div className="gl-row gl-row--tight">
                      <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => void createEntry()}>
                        Write a note
                      </Button>
                      <Button size="sm" onClick={() => setView('unsafe')}>
                        Open the unsafe register ({unsafe.length})
                      </Button>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </>
      )}

      {openTrash ? (
        <Trash entries={entries} onClose={() => setOpenTrash(false)} onPurge={(r) => setAskPurge(r)} />
      ) : null}

      <Modal
        open={Boolean(askPurge)}
        onClose={() => setAskPurge(null)}
        title="Delete permanently?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAskPurge(null)}>
              Leave it in the bin
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!askPurge) return;
                await hardDelete(TABLES.knowledge, askPurge.id);
                toast('Row deleted from the database. There is no undo.', 'ok');
                setAskPurge(null);
              }}
            >
              Delete for good
            </Button>
          </>
        }
      >
        <p className="gl-small">
          <b>{askPurge?.title || 'Untitled note'}</b> is already hidden from the library. This removes the row itself.
        </p>
        <p className="gl-small gl-muted">
          Notes that other records link to are referenced by id. If a deleted note was linked somewhere, that link will
          simply stop resolving — nothing else is rewritten.
        </p>
      </Modal>

      <Modal
        open={Boolean(askDrop)}
        onClose={() => setAskDrop(null)}
        title="Remove from your library?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAskDrop(null)}>
              Keep
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!askDrop) return;
                await softDelete(askDrop.table, askDrop.row.id);
                if (askDrop.table === 'knowledge' && selected === askDrop.row.id) setSelected(null);
                const title = askDrop.row.title;
                setAskDrop(null);
                toast(`“${title || 'Untitled'}” moved to the bin — restore it from Bin.`, 'ok');
              }}
            >
              Move to bin
            </Button>
          </>
        }
      >
        <p className="gl-small">
          <b>{askDrop?.row.title}</b> will be hidden from search, counts and links. It stays restorable until you purge it.
        </p>
        {askDrop?.table === 'techniques' ? (
          <p className="gl-small gl-muted">
            This is a graded reference record, not a note you wrote. Removing it means the app can no longer show you the
            safety flags attached to it — that is a real loss, so do it deliberately.
          </p>
        ) : null}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ legend */

function GradeLegend() {
  const [open, setOpen] = useState(false);
  return (
    <Card className="kn-legend">
      <CardHead
        eyebrow="Vocabulary"
        title="What each grade means — and what it does not"
        sub="Glow Lab's own scale. Read it once; every chip on this page uses it."
        right={
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'Show all ten'}
          </Button>
        }
      />
      <div className={`kn-legend__grid ${open ? '' : 'kn-legend__grid--clamped'}`}>
        {GRADES.map((g) => (
          <div className="kn-grade" key={g.grade}>
            <EvidenceChip grade={g.grade} />
            <p className="kn-grade__means">{g.means}</p>
            <p className="kn-grade__not">{g.notMeans}</p>
          </div>
        ))}
      </div>
      {!open ? (
        <p className="gl-tech gl-faint" style={{ marginTop: 'var(--glow-sp-3)', marginBottom: 0 }}>
          Ten grades · two per row on wide screens · nothing here is a ranking of you
        </p>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ editor */

function EntryEditor({
  entry,
  goals,
  products,
  experiments,
  techniques,
  onNavigate,
  onDelete
}: {
  entry: AnyRow;
  goals: AnyRow[];
  products: AnyRow[];
  experiments: AnyRow[];
  techniques: AnyRow[];
  onNavigate: (path: string) => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(String(entry.title ?? ''));
  const [body, setBody] = useState(String(entry.body ?? ''));
  const [domain, setDomain] = useState(String(entry.domain ?? ''));
  const [cautions, setCautions] = useState(String(entry.cautions ?? ''));
  const [confidence, setConfidence] = useState(Number(entry.confidence ?? 3));
  const [tags, setTags] = useState<string[]>((entry.tags as string[]) ?? []);
  const [evidence, setEvidence] = useState(String(entry.evidence ?? ''));
  const [kind, setKind] = useState(String(entry.kind ?? 'note'));
  const [worked, setWorked] = useState(String(entry.worked ?? 'unset'));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setTitle(String(entry.title ?? ''));
    setBody(String(entry.body ?? ''));
    setDomain(String(entry.domain ?? ''));
    setCautions(String(entry.cautions ?? ''));
    setConfidence(Number(entry.confidence ?? 3));
    setTags((entry.tags as string[]) ?? []);
    setEvidence(String(entry.evidence ?? ''));
    setKind(String(entry.kind ?? 'note'));
    setWorked(String(entry.worked ?? 'unset'));
    setDirty(false);
  }, [entry.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const links = {
    goals: (entry.linkedGoalIds as string[]) ?? [],
    techniques: (entry.linkedTechniqueIds as string[]) ?? [],
    products: (entry.linkedProductIds as string[]) ?? [],
    experiments: (entry.linkedExperimentIds as string[]) ?? []
  };

  const save = async () => {
    await saveRow(TABLES.knowledge, {
      id: entry.id,
      title: title.trim(),
      body,
      domain: domain.trim() || 'general',
      cautions: cautions.trim(),
      confidence,
      tags,
      evidence: evidence || '',
      kind,
      worked
    });
    setDirty(false);
    toast('Saved on the same row — its revision number went up.', 'ok');
  };

  const setList = async (key: 'linkedGoalIds' | 'linkedTechniqueIds' | 'linkedProductIds' | 'linkedExperimentIds', ids: string[]) => {
    await saveRow(TABLES.knowledge, { id: entry.id, [key]: ids });
  };

  const edit = <T,>(v: T, set: (x: T) => void) => (x: T) => {
    set(x);
    setDirty(true);
  };

  return (
    <article className="kn-entry">
      <div className="gl-row gl-row--between kn-entry__top">
        <div className="gl-eyebrow">
          {kind} · {domain || 'unfiled'} · rev {entry.rev ?? 1}
          {entry.seed === 1 ? ' · reference entry shipped with the app' : ''}
        </div>
        <div className="gl-row gl-row--tight">
          {dirty ? <Chip tone="gold">Unsaved</Chip> : null}
          <Button size="sm" variant="primary" onClick={() => void save()} disabled={!dirty}>
            {dirty ? 'Save' : 'Saved'}
          </Button>
          <IconButton label="Move to bin" tone="danger" onClick={onDelete}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>

      <Field label="Title">
        <TextInput value={title} onChange={edit(title, setTitle)} placeholder="Say what this record is" />
      </Field>

      <div className="kn-entry__meta">
        <Field label="Kind">
          <Select value={kind} onChange={(v) => { setKind(v); setDirty(true); }} options={KINDS.map((k) => ({ value: k, label: k }))} />
        </Field>
        <Field label="Domain">
          <TextInput value={domain} onChange={edit(domain, setDomain)} placeholder="skin, hair, style…" />
        </Field>
        <Field label="Grade it yourself">
          <Select
            value={evidence}
            onChange={(v) => { setEvidence(v); setDirty(true); }}
            placeholder="Ungraded (my note only)"
            options={GRADES.map((g) => ({ value: g.grade, label: g.grade }))}
          />
        </Field>
        <Field label="Did it work for you?" hint="Your verdict. Nothing infers it.">
          <SegmentedControl value={worked} onChange={(v) => { setWorked(v); setDirty(true); }} size="sm" options={WORKED.map((w) => ({ value: w, label: w }))} />
        </Field>
      </div>

      <Range
        label="How confident are you?"
        min={0}
        max={5}
        value={confidence}
        onChange={(v) => { setConfidence(v); setDirty(true); }}
        format={(v) => `${v}/5`}
      />

      <Field label="The note itself">
        <TextArea value={body} onChange={edit(body, setBody)} rows={10} placeholder="What you learned, where it came from, what you actually observed. Plain language is fine — this is your shelf." />
      </Field>

      <Field label="Cautions attached to this note" hint="Shown on the entry card. Kept separate from the body so it is never buried.">
        <TextArea value={cautions} onChange={edit(cautions, setCautions)} rows={2} placeholder="Anything that should stop someone reading further and thinking first." />
      </Field>

      <Field label="Tags">
        <TagInput values={tags} onChange={(v) => { setTags(v); setDirty(true); }} />
      </Field>

      {cautions.trim() ? <SafetyBanner tone="warn" title="Caution stored on this note">{cautions}</SafetyBanner> : null}

      <section className="kn-links">
        <h3 className="gl-serif kn-links__h">
          <Link2 size={14} /> Linked records
        </h3>
        <LinkPicker label="Goals" options={goals.map((g) => ({ id: g.id, title: g.title }))} ids={links.goals} onChange={(ids) => void setList('linkedGoalIds', ids)} onOpen={(id) => onNavigate(`/looksmaxxing?goal=${id}`)} />
        <LinkPicker label="Techniques" options={techniques.map((t) => ({ id: t.id, title: t.title }))} ids={links.techniques} onChange={(ids) => void setList('linkedTechniqueIds', ids)} onOpen={(id) => { const t = techniques.find((x) => x.id === id); if (t) onNavigate(`/knowledge?technique=${t.slug}`); }} />
        <LinkPicker label="Products" options={products.map((p) => ({ id: p.id, title: p.name }))} ids={links.products} onChange={(ids) => void setList('linkedProductIds', ids)} onOpen={(id) => onNavigate(`/market?product=${id}`)} />
        <LinkPicker label="Experiments" options={experiments.map((x) => ({ id: x.id, title: x.name }))} ids={links.experiments} onChange={(ids) => void setList('linkedExperimentIds', ids)} onOpen={(id) => onNavigate(`/experiments?id=${id}`)} />
        {!experiments.length && !products.length && !goals.length ? (
          <p className="gl-small gl-faint">Nothing exists to link yet — those departments are empty. Links use real row ids, so they only appear once the row does.</p>
        ) : null}
      </section>

      <KvList
        items={[
          { k: 'Row id', v: <span className="gl-tech">{String(entry.id)}</span> },
          { k: 'Slug', v: <span className="gl-tech">{String(entry.slug ?? '—')}</span> },
          { k: 'Created', v: formatDate(new Date(Number(entry.createdAt ?? Date.now())).toISOString().slice(0, 10)) },
          { k: 'Logged today?', v: todayISO() === new Date(Number(entry.updatedAt ?? 0)).toISOString().slice(0, 10) ? 'Yes — edited today' : 'No' }
        ]}
      />
    </article>
  );
}

function LinkPicker({
  label,
  options,
  ids,
  onChange,
  onOpen
}: {
  label: string;
  options: { id: string; title: string }[];
  ids: string[];
  onChange: (ids: string[]) => void;
  onOpen: (id: string) => void;
}) {
  const [pick, setPick] = useState('');
  const available = options.filter((o) => !ids.includes(o.id));
  return (
    <div className="kn-links__row">
      <div className="gl-label">{label}</div>
      {ids.length ? (
        <div className="gl-stack" style={{ gap: 4 }}>
          {ids.map((id) => {
            const o = options.find((x) => x.id === id);
            return (
              <div className="gl-row gl-row--tight" key={id}>
                <button type="button" className="gl-btn gl-btn--link gl-btn--sm" onClick={() => onOpen(id)}>
                  {o?.title || 'Missing record (deleted)'}
                </button>
                <IconButton label={`Unlink ${label.toLowerCase()}`} onClick={() => onChange(ids.filter((x) => x !== id))}>
                  ✕
                </IconButton>
              </div>
            );
          })}
        </div>
      ) : (
        <span className="gl-small gl-faint">None linked.</span>
      )}
      {available.length ? (
        <div className="gl-row gl-row--tight">
          <div style={{ minWidth: 180, flex: 1 }}>
            <Select value={pick} onChange={setPick} placeholder={`Link a ${label.toLowerCase()}…`} options={available.map((o) => ({ value: o.id, label: o.title || 'Untitled' }))} />
          </div>
          <Button
            size="sm"
            disabled={!pick}
            onClick={() => {
              onChange([...ids, pick]);
              setPick('');
            }}
          >
            Link
          </Button>
        </div>
      ) : (
        <span className="gl-tech gl-faint">Nothing else available in {label.toLowerCase()}.</span>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- technique */

function TechniqueDossier({ row, onClose, onAskDelete }: { row: AnyRow; onClose: () => void; onAskDelete: () => void }) {
  const sources = (row.sources as AnyRow[]) ?? [];
  const isUnsafe = row.safety === 'unsafe';
  return (
    <article className="kn-dossier">
      <div className="gl-row gl-row--between">
        <div className="gl-eyebrow">Graded reference record · {row.domain}</div>
        <div className="gl-row gl-row--tight">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
          {row.seed === 1 ? (
            <IconButton label="Remove this reference record" tone="danger" onClick={onAskDelete}>
              <Trash2 size={14} />
            </IconButton>
          ) : null}
        </div>
      </div>
      <h2 className="gl-display kn-dossier__h">{row.title}</h2>
      <div className="gl-row gl-row--tight" style={{ margin: 'var(--glow-sp-3) 0' }}>
        <EvidenceChip grade={String(row.evidence)} />
        <Chip tone={isUnsafe ? 'danger' : row.safety === 'caution' ? 'weak' : 'strong'}>
          {isUnsafe ? 'Safety: unsafe' : row.safety === 'caution' ? 'Safety: caution' : 'Safety: reasonable to try'}
        </Chip>
        <Chip>Cost band {row.costBand || '—'}</Chip>
        <Chip>{row.timeToTry || 'no time frame recorded'}</Chip>
      </div>

      {isUnsafe ? (
        <SafetyBanner tone="danger" title="This one is documented, not suggested">
          Glow Lab keeps a record of {String(row.title).toLowerCase()} so the claim can be checked against what is known.
          It will not schedule it, add it to a plan, put it in a routine, or compare it favourably to anything. The claim
          below is written here in the third person on purpose.
        </SafetyBanner>
      ) : row.safety === 'caution' ? (
        <SafetyBanner tone="warn" title="Real caveats">
          Graded worth knowing about, with conditions that decide whether it suits you. Read the limitations and the
          consultation line before treating it as a to-do.
        </SafetyBanner>
      ) : null}

      <p className="gl-lead">{row.claim}</p>

      <dl className="kn-dossier__dl">
        <div>
          <dt>What the evidence supports</dt>
          <dd>{row.evidenceSummary || 'Nothing recorded.'}</dd>
        </div>
        <div>
          <dt>Where the evidence stops</dt>
          <dd>{row.evidenceGaps || 'No gaps were recorded for this entry — treat that as a reason to be more careful, not less.'}</dd>
        </div>
        <div>
          <dt>Reversibility</dt>
          <dd>{row.reversibility || 'Not recorded.'}</dd>
        </div>
        <div>
          <dt>When to consult a professional</dt>
          <dd>{row.whenToConsult || 'Not recorded.'}</dd>
        </div>
      </dl>

      <TwoLists left={{ title: 'Benefits as written', items: (row.benefits as string[]) ?? [] }} right={{ title: 'Limitations as written', items: (row.limitations as string[]) ?? [] }} />
      <TwoLists left={{ title: 'Risks recorded', items: (row.risks as string[]) ?? [] }} right={{ title: 'Safer alternatives recorded', items: (row.saferAlternatives as string[]) ?? [] }} />

      <section className="kn-sources">
        <h3 className="gl-serif kn-links__h">Sources</h3>
        {sources.length === 0 ? <p className="gl-small gl-faint">No source was recorded for this entry.</p> : null}
        {sources.map((s, i) => (
          <div className="kn-source" key={i}>
            <span className="kn-source__label">{s.label}</span>
            <span className="gl-tech gl-faint">{s.kind}</span>
            {s.url ? (
              <a href={String(s.url)} target="_blank" rel="noreferrer noopener" className="gl-small">
                Open stored link
              </a>
            ) : (
              <span className="kn-source__missing">No source URL stored — verify before relying on it.</span>
            )}
            {s.accessedOn ? <span className="gl-tech gl-faint">accessed {s.accessedOn}</span> : null}
          </div>
        ))}
        <p className="gl-tech gl-faint" style={{ marginBottom: 0 }}>
          Blank links are deliberate. Glow Lab does not invent citations or guess at URLs it has not verified.
        </p>
      </section>
    </article>
  );
}

function TwoLists({ left, right }: { left: { title: string; items: string[] }; right: { title: string; items: string[] } }) {
  return (
    <div className="kn-two">
      {[left, right].map((c) => (
        <div key={c.title}>
          <div className="gl-label">{c.title}</div>
          {c.items.length ? (
            <ul className="kn-ul">
              {c.items.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="gl-small gl-faint">Nothing recorded.</p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------ unsafe register */

function UnsafeRegister({
  unsafe,
  techniques,
  onBack,
  onOpen
}: {
  unsafe: AnyRow[];
  techniques: AnyRow[];
  onBack: () => void;
  onOpen: (slug: string) => void;
}) {
  const cautionCount = techniques.filter((t) => t.safety === 'caution').length;
  return (
    <Section
      eyebrow="Quarantine"
      right={
        <Button size="sm" variant="ghost" onClick={onBack}>
          Back to the library
        </Button>
      }
      title={
        <span className="kn-unsafe__h">
          <ShieldAlert size={18} /> The unsafe register
        </span>
      }
      description="These records exist in this app because people search for them. Every one of them is documented so the claim can be read next to what is known about the harm. None of them is ever turned into a task, a step, a routine, a schedule or a plan anywhere in Glow Lab."
    >
      {unsafe.length === 0 ? (
        <EmptyState title="Nothing is quarantined" body="There are no techniques flagged unsafe in your database — either the reference set was removed, or it was never installed." />
      ) : (
        <div className="gl-stack kn-unsafe">
          {unsafe.map((t) => {
            const hard = t.safety === 'unsafe';
            return (
              <Card key={t.id} className="kn-unsafe__card">
                <div className="gl-row gl-row--between" style={{ alignItems: 'flex-start', gap: 'var(--glow-sp-4)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="gl-serif" style={{ fontSize: '1.3rem', color: 'var(--glow-text-strong)' }}>
                      {t.title}
                    </div>
                    <div className="gl-small gl-muted" style={{ marginTop: 4 }}>
                      {t.claim}
                    </div>
                    <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-3)' }}>
                      <EvidenceChip grade={String(t.evidence)} />
                      <Chip tone={hard ? 'danger' : 'weak'}>{hard ? 'Flagged unsafe' : 'Flagged caution'}</Chip>
                      <Chip>{t.domain}</Chip>
                    </div>
                    {(t.risks as string[])?.length ? (
                      <ul className="kn-ul kn-ul--risk">
                        {(t.risks as string[]).map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div className="kn-unsafe__side">
                    <SafetyBanner tone={hard ? 'danger' : 'warn'} title={hard ? 'Glow Lab will not plan this' : 'Not planned for you'}>
                      {hard
                        ? 'No entry in a routine, no calendar event, no experiment template, no priority in the Command Center. Read the record; ask a clinician about the question behind it.'
                        : 'Documented here with its caveats. This app will not decide whether those caveats apply to you — that is a consultation, not a checklist.'}
                    </SafetyBanner>
                    {(t.saferAlternatives as string[])?.length ? (
                      <div className="gl-small">
                        <b className="gl-strong">Recorded alternatives:</b>{' '}
                        {(t.saferAlternatives as string[]).join(' · ')}
                      </div>
                    ) : null}
                    <Button size="sm" icon={<Undo2 size={13} />} onClick={() => onOpen(String(t.slug))}>
                      Read the full record
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
          <p className="gl-tech gl-faint" style={{ marginBottom: 0 }}>
            {unsafe.length} of {techniques.length} graded records are shown here. Another {cautionCount} carry a caution
            flag and are not listed — a caution is a condition, not a prohibition.
          </p>
        </div>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------------- bin */

function Trash({ entries, onClose, onPurge }: { entries: AnyRow[]; onClose: () => void; onPurge: (r: AnyRow) => void }) {
  const binned = useRows(TABLES.knowledge, { includeDeleted: true }).filter((e) => e.deletedAt);
  return (
    <Section
      eyebrow="Restore-safe"
      title="Bin"
      right={
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close bin
        </Button>
      }
      description="Deleted entries keep their row until you purge them, so a mistake is recoverable. This is the only place in the app that can permanently destroy a knowledge row."
    >
      {binned.length === 0 ? (
        <EmptyPlate kicker="Nothing in the bin" title="No deleted entries" body="Entries you remove from the library land here first. They are hidden from search and counts, but not gone." />
      ) : (
        <div className="gl-list">
          {binned.map((e) => (
            <div className="gl-list__row" key={e.id}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="gl-serif" style={{ fontSize: '1.05rem' }}>
                  {e.title || 'Untitled note'}
                </div>
                <div className="gl-tech gl-faint">
                  deleted {formatDate(new Date(Number(e.deletedAt)).toISOString().slice(0, 10))} · rev {e.rev}
                </div>
              </div>
              <div className="gl-row gl-row--tight">
                <Button
                  size="sm"
                  icon={<RotateCcw size={13} />}
                  onClick={async () => {
                    await restore(TABLES.knowledge, e.id);
                  }}
                >
                  Restore
                </Button>
                <Button size="sm" variant="danger" onClick={() => onPurge(e)}>
                  Delete for good
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Disclosure summary={`What is in the library right now (${entries.length} live rows)`}>
        <p className="gl-small gl-muted" style={{ margin: 0 }}>
          {entries
            .slice(0, 40)
            .map((e) => e.title || 'Untitled')
            .join(' · ') || 'Nothing.'}
          {entries.length > 40 ? ` …and ${entries.length - 40} more.` : ''}
        </p>
      </Disclosure>
    </Section>
  );
}
