/**
 * THE GLOW LAB — Evidence / Knowledge Center (spec Part 7).
 *
 * An archive, not a recommendation engine. Every technique row here states what
 * is claimed, what the evidence actually is, what is missing, what it costs in
 * money and time, what can go wrong, whether it can be undone, and what kind of
 * source the claim rests on. Where a source has no verified link the page says
 * so out loud rather than printing a confident-looking citation.
 *
 * Personal notes are real `knowledge` rows written through `saveRow`, editable
 * and removable. Starter (seeded) content is labelled as such and can be
 * cleared wholesale with the documented action.
 */
import '../styles/departments/evidence.css';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Plus, Search, ShieldAlert, Trash2 } from 'lucide-react';
import { saveRow, useRows } from '../hooks/live';
import { formatDate, newId, softDelete, todayISO } from '../db/repo';
import { TABLES, type AnyRow, type EvidenceGrade, type KnowledgeEntryRow } from '../db/schema';
import { COST_PENALTY, EVIDENCE_WEIGHT, evidenceTone } from '../engine/prioritisation';
import { clearSeedContent } from '../db/seed';
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
  SegmentedControl,
  Select,
  TextArea,
  TextInput,
  Toggle,
  useToast
} from '../ui/primitives';
import { DeptIntro, EmptyPlate, IndexList, IndexRow, KvList, PullQuote, StatStrip } from '../ui/editorial';

/* ------------------------------------------------------------------ taxonomy */

const GRADES: { value: EvidenceGrade; means: string; how: string }[] = [
  { value: 'strong', means: 'Repeatedly supported by work designed to answer this question', how: 'Systematic reviews, randomised trials or long-standing clinical consensus covering the appearance claim itself.' },
  { value: 'moderate', means: 'Supported, with limits worth knowing', how: ' decent trial evidence, or consistent smaller studies whose populations resemble the person reading.' },
  { value: 'limited', means: 'Something exists, and it is not enough', how: 'Small studies, short follow-up, laboratory work, or trials measuring a proxy rather than what you care about.' },
  { value: 'weak', means: 'Faint or contradictory signals', how: 'Low-quality studies, heavy conflict-of-interest influence, or results that do not replicate.' },
  { value: 'unsupported', means: 'The claim is popular and the evidence is absent', how: 'No study found testing the claim on humans at the dose or method described. Documented here so it is easy to find, not easy to believe.' },
  { value: 'emerging', means: 'Early and genuinely interesting', how: 'Promising first-in-human or mechanistic work. Too young to predict your result from.' },
  { value: 'traditional', means: 'Long cultural use, thin trial data', how: 'Practised for generations; safety is often better evidenced than efficacy.' },
  { value: 'cosmetic', means: 'A styling effect, not a biological one', how: 'Works while it is on. Removed with water, a wash, or by taking the glasses off.' },
  { value: 'professional', means: 'Only available through a qualified practitioner', how: 'The evidence may be strong; the constraint is that you cannot do it to yourself safely.' },
  { value: 'dangerous', means: 'Harm is documented and the benefit is not', how: 'Listed for recognition. Never ranked, never recommended, never placed in a plan.' }
];

const SAFETY: { value: string; label: string; means: string }[] = [
  { value: 'ok', label: 'Reasonable to try', means: 'Ordinary care applies. Read the risks anyway.' },
  { value: 'caution', label: 'Real caveats', means: 'Correct method, concentration or frequency matters; several are easy to overdo.' },
  { value: 'professional', label: 'Practitioner context', means: 'Recorded in the library as needing a qualified person, even where the schema’s canonical values are ok/caution/unsafe.' },
  { value: 'unsafe', label: 'Do not do this', means: 'Documented so you can find the truth about it. Not a suggestion.' }
];

const DOMAINS = ['skin', 'hair', 'face', 'makeup', 'smile', 'body', 'lifestyle', 'posture', 'grooming', 'style', 'fragrance'];
const COST_BANDS = ['free', '$', '$$', '$$$', '$$$$'];
const COST_MEANING: Record<string, string> = {
  free: 'No purchase needed',
  $: 'One low-cost item',
  $$: 'A modest repeated cost',
  $$$: 'Several purchases or a session',
  $$$$ : 'Professional or clinical spend'
};

/** The nine practices the product requires to be named plainly. The library
 *  rows that match are linked where they exist; the rest are written out here
 *  because a person searching for them must not hit an empty page. */
const UNSAFE_PRACTICES: { name: string; why: string; slugs: string[]; instead: { label: string; to: string }[] }[] = [
  {
    name: 'Bone smashing',
    why: 'Deliberately striking facial bone to create micro-fractures. There is no human evidence that controlled fracture remodels into the shape wanted, and there is ample evidence of what happens instead: periosteal injury, infection, asymmetry, nerve damage and fractures in bone you did not intend to break.',
    slugs: ['bone-smashing'],
    instead: [
      { label: 'Read the Evidence entry', to: '/evidence' },
      { label: 'Styling and photography routes', to: '/looksmaxxing' },
      { label: 'Professional consultation prep', to: '/services' }
    ]
  },
  {
    name: 'Unsupervised hormones or anabolic steroids',
    why: 'Appearance changes bought with endocrine disruption. Testosterone suppression, liver and lipid damage, fertility loss, cardiovascular risk and mood effects occur without any monitoring, and the doses circulated online are not clinical doses.',
    slugs: ['unsupervised-steroids'],
    instead: [
      { label: 'Resistance training entry', to: '/evidence' },
      { label: 'Fitness department', to: '/fitness' },
      { label: 'Find a professional', to: '/services' }
    ]
  },
  {
    name: 'Dangerous weight cutting',
    why: 'Rapid dehydration and severe restriction to hit a number. It moves the scale, not the body composition being aimed at, and it carries heat illness, kidney strain, electrolyte disturbance and fainting — plus a well-documented slide into disordered eating.',
    slugs: ['water-cutting'],
    instead: [
      { label: 'Moderate deficit entry', to: '/evidence' },
      { label: 'Progress tracking', to: '/progress' },
      { label: 'Professional consultation', to: '/services' }
    ]
  },
  {
    name: 'Extreme calorie restriction',
    why: 'Hair loss, loss of menstrual cycle, muscle loss, cold intolerance, impaired wound healing and rebound are the expected results, not exceptions. Skin and hair are usually the first things to suffer visibly, which inverts the entire point.',
    slugs: ['extreme-calorie-restriction'],
    instead: [
      { label: 'Protein adequacy', to: '/evidence' },
      { label: 'Sleep and appearance', to: '/evidence' },
      { label: 'Academy: designing an experiment', to: '/academy' }
    ]
  },
  {
    name: 'Unregulated injections',
    why: 'Fillers and botulinum toxin administered without medical licensing, cold-chain assurance or the ability to treat a complication. Vascular occlusion from a misplaced injection causes skin necrosis and blindness. Dissolving a mistake requires a licensed professional and urgent access to one.',
    slugs: ['diy-injections'],
    instead: [
      { label: 'Professional injection entries', to: '/evidence' },
      { label: 'How to prepare for a consultation', to: '/academy' },
      { label: 'Provider records', to: '/services' }
    ]
  },
  {
    name: 'Unsafe teeth modification',
    why: 'Filing, shaping or whitening enamel at home removes tissue that does not regenerate. Enamel loss is permanent, exposes dentine, causes sensitivity that does not go away, and raises long-term decay risk. DIY veneers and “Hollywood white” kits also routinely damage the gums.',
    slugs: ['diy-enamel-filing'],
    instead: [
      { label: 'Professional hygiene entry', to: '/evidence' },
      { label: 'Dental records', to: '/smile' },
      { label: 'Find a dentist', to: '/services' }
    ]
  },
  {
    name: 'Aggressive DIY chemical treatments',
    why: 'Peels, relaxers, depigmenting agents and high-concentration acids bought online and used without supervision cause chemical burns, permanent pigment change — often darker, not lighter — and scarring. Neutralising a deep peel in time is a clinical skill.',
    slugs: ['in-clinic-peel'],
    instead: [
      { label: 'Professional peel entry', to: '/evidence' },
      { label: 'Barrier and sunscreen entries', to: '/skin' },
      { label: 'Find a dermatologist', to: '/services' }
    ]
  },
  {
    name: 'Unverified facial devices',
    why: 'Jaw Exercisers, face rollers claimed to reshape bone, “mewing” braces, microcurrent sold with skeletal promises, at-home lasers of unknown fluence. The device market is not held to the same evidence standard as a drug, so a CE mark or a five-star rating says nothing about the claim being made.',
    slugs: ['gua-sha-massage', 'ice-rolling'],
    instead: [
      { label: 'What devices actually do', to: '/evidence' },
      { label: 'Photography and framing', to: '/face' },
      { label: 'Glow Academy guides', to: '/academy' }
    ]
  },
  {
    name: 'Claims of changing adult bone structure through exercise or pressure',
    why: 'Tongue posture, facial “yoga”, strapping and pressure devices do not move a fused adult skeleton. Mewing in particular is an orthotropic idea about children’s development, restated online as an adult jawline programme. Any visible change reported is posture, fat, lighting, or months of coincidence.',
    slugs: ['mewing', 'posture-motor-training'],
    instead: [
      { label: 'Mewing entry — grade and gaps', to: '/evidence' },
      { label: 'Posture training that is real', to: '/posture' },
      { label: 'Rank what actually works', to: '/looksmaxxing' }
    ]
  }
];

const SCALE_NOTE =
  'These grades are Glow Lab’s own reading of the published evidence, written for a person deciding what to try. They are not medical advice, not a regulatory classification and not a substitute for an assessment by a qualified clinician. Where an entry says the evidence is missing, that is a statement about the literature, not about you.';

const NO_LINK = 'no verified link — Glow Lab records the type of source only; verify before relying on it';

/* -------------------------------------------------------------------- page */

export default function EvidencePage() {
  const toast = useToast();
  const techniques = useRows(TABLES.techniques);
  const knowledge = useRows(TABLES.knowledge, { includeDeleted: true });
  const assessments = useRows(TABLES.assessments);
  const goals = useRows(TABLES.goals);

  const [tab, setTab] = useState('library');
  const [q, setQ] = useState('');
  const [domain, setDomain] = useState('');
  const [grade, setGrade] = useState('');
  const [cost, setCost] = useState('');
  const [safety, setSafety] = useState('');
  const [sort, setSort] = useState('evidence');
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  /** Impact tie-break is the user's own number from the Command Center. The
   *  library carries no impact field and none is invented here. */
  const userImpact = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assessments) {
      for (const c of ((a.categories as any[]) ?? [])) {
        for (const o of (c.options ?? [])) {
          if (!o.techniqueId) continue;
          m.set(o.techniqueId, Math.max(m.get(o.techniqueId) ?? 0, Number(o.impact) || 0));
        }
      }
    }
    return m;
  }, [assessments]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const tokens = needle.split(/\s+/).filter(Boolean);
    const out = techniques.filter((t) => {
      if (domain && String(t.domain) !== domain) return false;
      if (grade && String(t.evidence) !== grade) return false;
      if (cost && String(t.costBand) !== cost) return false;
      if (safety && String(t.safety) !== safety) return false;
      if (!tokens.length) return true;
      const hay = `${t.title} ${t.claim} ${t.domain} ${t.evidenceSummary} ${t.evidenceGaps} ${(t.tags as string[])?.join(' ') ?? ''} ${(t.text as string) ?? ''}`.toLowerCase();
      return tokens.every((tk) => hay.includes(tk));
    });
    const byTitle = (a: AnyRow, b: AnyRow) => String(a.title).localeCompare(String(b.title));
    if (sort === 'title') return [...out].sort(byTitle);
    if (sort === 'updated') return [...out].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
    if (sort === 'cheapest')
      return [...out].sort((a, b) => COST_PENALTY[(mapCost(String(a.costBand)))] - COST_PENALTY[mapCost(String(b.costBand))] || byTitle(a, b));
    // evidence strength, then the user's own recorded impact, then title
    return [...out].sort(
      (a, b) =>
        (EVIDENCE_WEIGHT[b.evidence as EvidenceGrade] ?? 0) - (EVIDENCE_WEIGHT[a.evidence as EvidenceGrade] ?? 0) ||
        (userImpact.get(b.id) ?? -1) - (userImpact.get(a.id) ?? -1) ||
        byTitle(a, b)
    );
  }, [techniques, q, domain, grade, cost, safety, sort, userImpact]);

  const unsafe = techniques.filter((t) => t.evidence === 'dangerous' || t.safety === 'unsafe');
  const starter = techniques.filter((t) => Number(t.seed) === 1);
  const mine = techniques.filter((t) => Number(t.seed) !== 1);
  const notes = knowledge.filter((k) => k.domain === 'evidence' || k.domain === 'face' || (k.tags as string[])?.includes('evidence-note'));
  const open = rows.find((t) => t.id === openId) ?? rows[0] ?? null;

  const TABS = [
    { key: 'library', label: `Archive · ${techniques.length}` },
    { key: 'unsafe', label: `Unsafe practices · ${UNSAFE_PRACTICES.length}` },
    { key: 'notes', label: `My notes · ${notes.filter((n) => !n.deletedAt).length}` },
    { key: 'scale', label: 'How the scale works' }
  ];

  return (
    <div className="gl-page ev-page">
      <DeptIntro
        id="evidence"
        deck="The technique archive: what is claimed, what the evidence is, what is missing, what it costs, what can go wrong, and what kind of source any of it rests on. Grades are Glow Lab’s reading, not medical advice."
        actions={
          <>
            <Button variant="primary" onClick={() => setTab('notes')}>
              <Plus size={14} /> Write a note
            </Button>
            <Button variant="danger" onClick={() => setTab('unsafe')}>
              <ShieldAlert size={14} /> Unsafe practices
            </Button>
            <Link className="gl-btn gl-btn--ghost" to="/looksmaxxing">
              Rank these for me
            </Link>
          </>
        }
        meta={[
          { label: 'Entries catalogued', value: String(techniques.length) },
          { label: 'Graded dangerous', value: String(unsafe.length) },
          { label: 'Written by you', value: String(mine.length) },
          { label: 'Starter entries', value: String(starter.length) }
        ]}
      />

      <StatStrip
        items={[
          { label: 'Matching now', value: String(rows.length), hint: `of ${techniques.length} catalogued` },
          { label: 'Sorted by', value: sort === 'evidence' ? 'evidence, then your impact' : sort, hint: 'library carries no impact field' },
          { label: 'Verified source links', value: String(techniques.reduce((s, t) => s + ((t.sources as any[]) ?? []).filter((x) => String(x?.url ?? '').trim()).length, 0)), hint: 'rest are type-only, labelled' },
          { label: 'Recommendations made', value: 'none here', hint: 'ranking lives in the Command Center' }
        ]}
      />

      <div className="gl-tabs ev-tabs" role="tablist" aria-label="Evidence sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`gl-tab ${tab === t.key ? 'gl-btn--gold' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'library' ? (
        <div className="ev-archive">
          <div>
            <Card variant="flush">
              <CardHead
                title="Filter the archive"
                eyebrow="Section 01"
                sub="Search reads title, claim, domain, evidence summary and your tags."
                right={
                  rows.length !== techniques.length ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setQ('');
                        setDomain('');
                        setGrade('');
                        setCost('');
                        setSafety('');
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : null
                }
              />
              <div className="ev-filtergrid">
                <Field label="Search" hint="Every word must appear somewhere on the entry.">
                  <div className="ev-search">
                    <Search size={14} aria-hidden />
                    <TextInput value={q} onChange={setQ} placeholder="e.g. retinoid, pigment, minoxidil, frame" />
                  </div>
                </Field>
                <Field label="Domain">
                  <Select value={domain} onChange={setDomain} options={DOMAINS.map((d) => ({ value: d, label: d }))} placeholder="All domains" />
                </Field>
                <Field label="Evidence grade">
                  <Select value={grade} onChange={setGrade} options={GRADES.map((g) => ({ value: g.value, label: g.value }))} placeholder="Any grade" />
                </Field>
                <Field label="Cost band" hint="A band, never a price.">
                  <Select value={cost} onChange={setCost} options={COST_BANDS.map((c) => ({ value: c, label: `${c} — ${COST_MEANING[c]}` }))} placeholder="Any cost" />
                </Field>
                <Field label="Safety record">
                  <Select value={safety} onChange={setSafety} options={SAFETY.map((s) => ({ value: s.value, label: s.label }))} placeholder="Any safety" />
                </Field>
                <Field label="Sort" hint="Tie-break by impact uses the numbers you entered in the Command Center — the archive has no impact field.">
                  <SegmentedControl
                    value={sort}
                    onChange={setSort}
                    size="sm"
                    options={[
                      { value: 'evidence', label: 'Evidence' },
                      { value: 'cheapest', label: 'Cheapest' },
                      { value: 'title', label: 'A–Z' },
                      { value: 'updated', label: 'Edited' }
                    ]}
                  />
                </Field>
              </div>
              <div className="ev-chiprow">
                <span className="gl-label">Quick domains</span>
                <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                  {DOMAINS.map((d) => {
                    const n = techniques.filter((t) => String(t.domain) === d).length;
                    if (!n) return null;
                    return (
                      <Chip key={d} active={domain === d} onClick={() => setDomain(domain === d ? '' : d)}>
                        {d} {n}
                      </Chip>
                    );
                  })}
                </div>
              </div>
            </Card>

            {rows.length ? (
              <IndexList>
                {rows.map((t, i) => (
                  <IndexRow
                    key={t.id}
                    no={i + 1}
                    title={String(t.title)}
                    sub={`${String(t.domain)} · ${String(t.safety)} · cost ${String(t.costBand)} · ${String(t.timeToTry || 'timing not recorded')}${Number(t.seed) === 1 ? ' · starter content' : ''}`}
                    right={<EvidenceChip grade={String(t.evidence)} />}
                    onClick={() => setOpenId(t.id)}
                  />
                ))}
              </IndexList>
            ) : (
              <EmptyPlate
                kicker="No matches"
                title="Nothing in the archive fits those filters"
                body="The archive is a fixed catalogue of what Glow Lab has written up. It is not exhaustive, and it will not pad itself with plausible-sounding entries to match your search."
                action={
                  <Button
                    onClick={() => {
                      setQ('');
                      setDomain('');
                      setGrade('');
                      setCost('');
                      setSafety('');
                    }}
                  >
                    Reset the filters
                  </Button>
                }
              />
            )}
          </div>

          <aside className="gl-rule-col ev-detail">
            {open ? <Detail t={open} impact={userImpact.get(open.id)} /> : <EmptyState title="Select an entry" body="Every catalogued technique opens here with its claim, evidence, gaps, costs, risks, reversibility and sources." />}
          </aside>
        </div>
      ) : null}

      {tab === 'unsafe' ? <UnsafePanel techniques={techniques} /> : null}

      {tab === 'notes' ? <NotesPanel knowledge={notes} techniques={techniques} goals={goals} /> : null}

      {tab === 'scale' ? (
        <div className="ev-archive">
          <div>
            <Card>
              <CardHead title="The evidence scale" eyebrow="Section 04" sub={SCALE_NOTE} />
              <div className="ev-scale">
                {GRADES.map((g) => (
                  <div className="ev-scale__row" key={g.value} data-tone={evidenceTone(g.value)}>
                    <EvidenceChip grade={g.value} />
                    <div>
                      <div className="gl-serif ev-scale__means">{g.means}</div>
                      <p className="gl-small gl-muted">{g.how}</p>
                    </div>
                    <span className="gl-tech ev-scale__n">{techniques.filter((t) => String(t.evidence) === g.value).length}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <CardHead title="Safety records" eyebrow="Section 04b" sub="The library schema defines ok / caution / unsafe. Several entries carry the value ‘professional’, recorded as-is; this page shows it instead of silently folding it into another bucket." />
              <div className="ev-scale">
                {SAFETY.map((s) => (
                  <div className="ev-scale__row" key={s.value}>
                    <Chip tone={s.value === 'unsafe' ? 'danger' : s.value === 'ok' ? 'strong' : 'limited'}>{s.label}</Chip>
                    <div>
                      <p className="gl-small gl-muted">{s.means}</p>
                    </div>
                    <span className="gl-tech ev-scale__n">{techniques.filter((t) => String(t.safety) === s.value).length}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
          <aside className="gl-rule-col">
            <div className="ev-railblock">
              <span className="gl-eyebrow">Cost bands</span>
              <KvList items={COST_BANDS.map((c) => ({ k: c, v: COST_MEANING[c] }))} />
              <p className="gl-small gl-faint">
                A band is a bucket, not a budget. Glow Lab never converts a band into a currency figure, and the money totals you see elsewhere in the app come
                only from purchase rows you recorded yourself.
              </p>
            </div>
            <div className="ev-railblock">
              <span className="gl-eyebrow">Sources, honestly</span>
              <p className="gl-small gl-muted">
                {techniques.reduce((s, t) => s + ((t.sources as any[]) ?? []).filter((x) => String(x?.url ?? '').trim()).length, 0)} of{' '}
                {techniques.reduce((s, t) => s + ((t.sources as any[]) ?? []).length, 0)} source references in this archive have a verified link. The rest record
                the <i>type</i> of source they rest on and say so. That is deliberate: an invented citation is worse than an admitted gap, because a fabricated
                DOI reads as settled science.
              </p>
              <SafetyBanner tone="note" title="This is not a literature review">
                <p className="gl-small">
                  Glow Lab is a personal record-keeping app written by one project. Grades are a careful reading, not a systematic review, and can be wrong. If a
                  decision is irreversible, get it assessed by a professional in your context — {`/services`} holds the record of who you asked and what they said.
                </p>
              </SafetyBanner>
            </div>
            <div className="ev-railblock">
              <span className="gl-eyebrow">Starter content</span>
              <p className="gl-small">
                {starter.length} entries in the archive shipped with Glow Lab and are tagged <Chip tone="gold">starter content</Chip> wherever they appear. They
                behave exactly like your own rows: editable, removable, exportable. Everything you added yourself: {mine.length}.
              </p>
              <Button variant="danger" onClick={() => setConfirmClear(true)}>
                <Trash2 size={13} /> Remove all starter content
              </Button>
              <p className="gl-small gl-faint">
                This clears seeded techniques, knowledge entries, tutorials, exercises, discovery items and seeded media in one documented action
                (clearSeedContent). It is hard to undo, which is why it asks twice.
              </p>
            </div>
          </aside>
        </div>
      ) : null}

      <PullQuote cite="On reading an evidence grade">
        “Limited” does not mean “will not work for you”. It means nobody has done the work properly. That difference is the reason this page exists.
      </PullQuote>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Remove all starter content?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Keep the starter content
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                void clearSeedContent().then((n) => {
                  setConfirmClear(false);
                  toast(`${n} starter row(s) removed. Entries you wrote yourself are untouched.`, 'ok');
                });
              }}
            >
              Remove starter content
            </Button>
          </>
        }
      >
        <p className="gl-small">
          This deletes every row tagged as Glow Lab starter content across the discovery feed, media library, technique archive, knowledge base, tutorials and
          exercises — {starter.length} technique entries in this department alone. Your own assessments, plans, notes, photographs and records are not seeded and
          are not touched. Re-seeding is a separate, deliberate action in Settings.
        </p>
      </Modal>

      <div className="ev-footer-note">
        <KvList
          items={[
            { k: 'What this page is', v: 'A catalogue of techniques with their evidence, gaps, costs, risks and reversibility stated separately.' },
            { k: 'What it is not', v: 'Medical advice, a systematic review, or a source of recommendations. Ranking your own options happens in the Command Center.' },
            { k: 'Notes', v: 'Written to knowledge rows through saveRow — title, kind, body, domain, confidence, worked, links, cautions and grade are all persisted.' },
            { k: 'Sources', v: 'Rendered with the type of source named. Where there is no verified link, that is printed rather than papered over.' }
          ]}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- detail pane */

/** Library cost bands are free/$/$$…; the priority engine indexes by name. */
function mapCost(raw: string): 'free' | 'low' | 'mid' | 'high' | 'professional' {
  if (raw === 'free') return 'free';
  if (raw === '$') return 'low';
  if (raw === '$$') return 'mid';
  if (raw === '$$$') return 'high';
  if (raw === '$$$$') return 'professional';
  return 'mid';
}

function Detail({ t, impact }: { t: AnyRow; impact: number | undefined }) {
  const sources = (t.sources as any[]) ?? [];
  const isStarter = Number(t.seed) === 1;
  return (
    <div className="ev-detailbody">
      <div className="gl-row gl-row--between ev-detail__head" style={{ alignItems: 'baseline', gap: 'var(--glow-sp-3)', flexWrap: 'wrap' }}>
        <h2 className="gl-display ev-detail__title">{String(t.title)}</h2>
        <EvidenceChip grade={String(t.evidence)} />
      </div>
      <div className="gl-row gl-row--tight ev-detail__flags" style={{ flexWrap: 'wrap' }}>
        <Chip tone="info">{String(t.domain)}</Chip>
        <Chip tone={t.safety === 'unsafe' ? 'danger' : t.safety === 'ok' ? 'strong' : 'limited'}>safety: {String(t.safety)}</Chip>
        <Chip>cost {String(t.costBand)} — {COST_MEANING[String(t.costBand)] ?? 'band'}</Chip>
        <Chip>slug {String(t.slug)}</Chip>
        {isStarter ? <Chip tone="gold">starter content</Chip> : <Chip tone="strong">written by you</Chip>}
      </div>

      <dl className="gl-kv">
        <dt>What is claimed</dt>
        <dd>{String(t.claim ?? 'No claim recorded on this entry.')}</dd>
        <dt>What the evidence is</dt>
        <dd>{String(t.evidenceSummary ?? 'Not written up yet.')}</dd>
        <dt>What the evidence is missing</dt>
        <dd>{String(t.evidenceGaps ?? 'No gap analysis recorded — treat that as a warning sign, not a clean bill of health.')}</dd>
        <dt>Time to try, on this entry</dt>
        <dd>{String(t.timeToTry ?? 'not recorded')}</dd>
        <dt>Reversibility</dt>
        <dd>{String(t.reversibility ?? 'not recorded')}</dd>
        <dt>When a professional consultation is appropriate</dt>
        <dd>{String(t.whenToConsult ?? 'No consultation note recorded. Any pain, lesion, sudden change or bleeding is a reason to be seen regardless.')}</dd>
      </dl>

      <div className="gl-grid gl-grid--2">
        <div className="gl-inset">
          <span className="gl-label">Benefits as recorded</span>
          {Array.isArray(t.benefits) && (t.benefits as string[]).length ? (
            <ul className="ev-bullets">
              {(t.benefits as string[]).map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : (
            <p className="gl-small gl-faint">None recorded.</p>
          )}
        </div>
        <div className="gl-inset">
          <span className="gl-label">Limitations as recorded</span>
          {Array.isArray(t.limitations) && (t.limitations as string[]).length ? (
            <ul className="ev-bullets">
              {(t.limitations as string[]).map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : (
            <p className="gl-small gl-faint">None recorded.</p>
          )}
        </div>
        <div className="gl-inset ev-risk">
          <span className="gl-label">Risks</span>
          {Array.isArray(t.risks) && (t.risks as string[]).length ? (
            <ul className="ev-bullets">
              {(t.risks as string[]).map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : (
            <p className="gl-small gl-faint">No risks recorded on this entry — that is not the same as no risks.</p>
          )}
        </div>
        <div className="gl-inset">
          <span className="gl-label">Safer alternatives named on the entry</span>
          {Array.isArray(t.saferAlternatives) && (t.saferAlternatives as string[]).length ? (
            <ul className="ev-bullets">
              {(t.saferAlternatives as string[]).map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : (
            <p className="gl-small gl-faint">None recorded.</p>
          )}
        </div>
      </div>

      {typeof impact === 'number' ? (
        <p className="gl-small gl-muted ev-impactline">
          Your own expected impact for this technique, from your Command Center options: <b>{impact}/10</b>. That number is yours, entered by you — the archive
          itself assigns no impact.
        </p>
      ) : (
        <p className="gl-small gl-faint ev-impactline">
          No impact number exists for this entry, because you have not put it into an assessment. The archive does not supply one.
        </p>
      )}

      <div className="ev-sources">
        <span className="gl-label">Sources ({sources.length})</span>
        {sources.length ? (
          <ul className="ev-sourcelist">
            {sources.map((s, i) => (
              <li key={`${s?.label}-${i}`}>
                <span className="gl-tech ev-sourcelist__kind">{String(s?.kind ?? 'source')}</span>
                <div>
                  <div className="gl-small">{String(s?.label ?? 'Unlabelled reference')}</div>
                  {String(s?.url ?? '').trim() ? (
                    <a className="gl-small" href={String(s.url)} target="_blank" rel="noreferrer noopener">
                      {String(s.url)}
                    </a>
                  ) : (
                    <div className="gl-small ev-nolink">{NO_LINK}</div>
                  )}
                  {s?.accessedOn ? <div className="gl-tech ev-sourcelist__on">accessed {formatDate(String(s.accessedOn))}</div> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="gl-small gl-faint">No source reference of any kind is recorded on this entry.</p>
        )}
      </div>

      {t.safety === 'unsafe' || t.evidence === 'dangerous' ? (
        <SafetyBanner tone="danger" title="This entry is not a recommendation">
          <p className="gl-small">
            It is catalogued so the claim is easy to find and the harm is easy to read. It is excluded from the ranking engine’s recommendations and from every
            plan template. Safer routes: <Link to="/evidence">the evidence scale</Link>, <Link to="/services">professional consultation</Link>.
          </p>
        </SafetyBanner>
      ) : null}

      <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
        <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/looksmaxxing">
          Add to an assessment
        </Link>
        <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/academy">
          Guides that teach the method
        </Link>
        <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/services">
          Record a consultation
        </Link>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- unsafe panel */

function UnsafePanel({ techniques }: { techniques: AnyRow[] }) {
  const matched = (slugs: string[]) => techniques.filter((t) => slugs.includes(String(t.slug)));
  return (
    <Card>
      <CardHead
        title="Unsafe practices"
        eyebrow="Section 02"
        sub="Nine things that circulate widely and cause real harm. They are written here plainly, and they are never ranked, planned or recommended anywhere in this app."
      />
      <SafetyBanner tone="danger" title="Not recommended. All of them, without exception.">
        <p className="gl-small">
          Each entry below states what the practice claims, what actually happens to people who do it, and where the safe version of the intention lives in this
          app. The reason these are catalogued at all is that someone searching for them deserves to find the truth rather than a marketing page.
        </p>
      </SafetyBanner>

      <div className="ev-unsafe">
        {UNSAFE_PRACTICES.map((u, i) => {
          const rows = matched(u.slugs);
          return (
            <details className="gl-details ev-unsafe__item" key={u.name} id={`unsafe-${i}`}>
              <summary>
                <span className="ev-unsafe__no">{String(i + 1).padStart(2, '0')}</span>
                <span className="ev-unsafe__name">{u.name}</span>
                <Chip tone="danger">{rows.length ? `${rows.length} catalogued entry` : 'no library entry'}</Chip>
              </summary>
              <div className="gl-details__body">
                <p className="ev-unsafe__why">{u.why}</p>
                <p className="gl-small ev-notrec">
                  <b>Not recommended.</b> Glow Lab does not rank this, does not place it in a plan template, and does not present any version of it as a
                  reasonable option.
                </p>
                {rows.length ? (
                  <ul className="ev-unsafe__links">
                    {rows.map((t) => (
                      <li key={t.id}>
                        <span className="gl-serif">{String(t.title)}</span>
                        <EvidenceChip grade={String(t.evidence)} />
                        <span className="gl-small gl-muted">{String(t.claim)}</span>
                        {Array.isArray(t.risks) && (t.risks as string[]).length ? <span className="gl-small ev-nolink">Risks: {(t.risks as string[]).join('; ')}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="gl-small gl-faint">
                    Nothing under this name is in your technique archive. That is not a gap to fill by trying
                    it — the statement above stands on its own.
                  </p>
                )}
                <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                  <span className="gl-label">Safer routes for the same intention</span>
                  {u.instead.map((l) => (
                    <Link key={l.to + l.label} className="gl-btn gl-btn--sm gl-btn--ghost" to={l.to}>
                      {l.label}
                    </Link>
                  ))}
                </div>
              </div>
            </details>
          );
        })}
      </div>

      <PullQuote cite="The line this app will not cross">
        Wanting to change how you look is ordinary. Being told your face is a problem that requires hurting it is a sales technique, and this application is not
        built to run it on you.
      </PullQuote>

      <SafetyBanner tone="warn" title="If something on this list has already happened">
        <p className="gl-small">
          Facial trauma, chemical burns, injection complications, tooth pain or sensitivity after filing, fainting or stopped periods after a cut: those are
          medical events. Get assessed — and record the outcome in <Link to="/services">Services</Link> so the consultation, the questions asked and the answer
          are kept together.
        </p>
      </SafetyBanner>
    </Card>
  );
}

/* ------------------------------------------------------------------ notes tab */

const KINDS: { value: KnowledgeEntryRow['kind']; label: string }[] = [
  { value: 'note', label: 'Note — something you want to remember' },
  { value: 'research', label: 'Research — a question you are investigating' },
  { value: 'reference', label: 'Reference — a source or summary you keep' },
  { value: 'observation', label: 'Observation — what you saw on yourself' },
  { value: 'skill', label: 'Skill — something you learned to do' }
];

const WORKED: { value: KnowledgeEntryRow['worked']; label: string }[] = [
  { value: 'unset', label: 'Not tested' },
  { value: 'yes', label: 'Worked for me' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'no', label: 'Did not work' }
];

function blankNote(domain: string): Omit<KnowledgeEntryRow, keyof import('../db/schema').BaseRow> {
  return {
    title: '',
    kind: 'note',
    body: '',
    domain: domain || 'evidence',
    confidence: 3,
    worked: 'unset',
    linkedGoalIds: [],
    linkedTechniqueIds: [],
    linkedProductIds: [],
    linkedExperimentIds: [],
    // extras carried alongside seeded knowledge rows — repo.buildText indexes them
    ...( { evidence: '', cautions: '' } as Record<string, string> )
  } as Omit<KnowledgeEntryRow, keyof import('../db/schema').BaseRow>;
}

function NotesPanel({ knowledge, techniques, goals }: { knowledge: AnyRow[]; techniques: AnyRow[]; goals: AnyRow[] }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, any>>(blankNote('evidence'));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [linkPick, setLinkPick] = useState('');
  const [goalPick, setGoalPick] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);

  const rows = knowledge
    .filter((k) => (showDeleted ? Boolean(k.deletedAt) : !k.deletedAt))
    .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));

  const reset = () => {
    setDraft(blankNote('evidence'));
    setEditingId(null);
    setLinkPick('');
    setGoalPick('');
  };

  const save = () => {
    const title = String(draft.title ?? '').trim();
    if (!title) {
      toast('A note needs a title before it can be stored.', 'bad');
      return;
    }
    const id = editingId ?? newId('know');
    void saveRow(TABLES.knowledge, {
      ...draft,
      id,
      title,
      domain: String(draft.domain ?? '').trim() || 'evidence',
      tags: [...(((draft.tags as string[]) ?? []) as string[]).filter((x) => x !== 'evidence-note'), 'evidence-note']
    }).then(() => {
      toast(editingId ? 'Note updated in your knowledge base.' : 'Note stored in your knowledge base.', 'ok');
      reset();
    });
  };

  const startEdit = (k: AnyRow) => {
    setEditingId(k.id);
    setDraft({ ...k });
    setTab0(k.id);
  };
  const setTab0 = (id: string) => {
    const el = document.getElementById(`note-form`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    void id;
  };

  const linked: string[] = (draft.linkedTechniqueIds as string[]) ?? [];
  const linkedGoals: string[] = (draft.linkedGoalIds as string[]) ?? [];

  return (
    <div className="ev-archive">
      <div>
        <Card>
          <CardHead
            title={editingId ? 'Editing a note' : 'Write a note'}
            eyebrow="Section 03"
            sub="Notes are knowledge rows: title, kind, body, domain, confidence, whether it worked, links, cautions and an optional grade. Every field persists."
            right={editingId ? <Chip tone="gold">editing stored row</Chip> : <Chip tone="info">new row</Chip>}
          />
          <div id="note-form" className="gl-grid gl-grid--2">
            <Field label="Title">
              <TextInput value={String(draft.title ?? '')} onChange={(v) => setDraft({ ...draft, title: v })} placeholder="e.g. Why I stopped the at-home peel" />
            </Field>
            <Field label="Domain" hint="Keeps it findable inside Knowledge.">
              <TextInput value={String(draft.domain ?? 'evidence')} onChange={(v) => setDraft({ ...draft, domain: v })} placeholder="evidence" />
            </Field>
            <Field label="Kind">
              <Select value={String(draft.kind)} onChange={(v) => setDraft({ ...draft, kind: v })} options={KINDS.map((k) => ({ value: k.value, label: k.label }))} />
            </Field>
            <Field label="Evidence grade you would give this" hint="Optional. Your reading, stored as the entry’s grade.">
              <Select
                value={String(draft.evidence ?? '')}
                onChange={(v) => setDraft({ ...draft, evidence: v })}
                options={GRADES.map((g) => ({ value: g.value, label: `${g.value} — ${g.means}` }))}
                placeholder="No grade assigned"
              />
            </Field>
          </div>
          <Field label="Body" hint="What you concluded, and what would change your mind.">
            <TextArea value={String(draft.body ?? '')} onChange={(v) => setDraft({ ...draft, body: v })} rows={6} placeholder="Written in your own words. Nothing here is generated for you." />
          </Field>
          <Field label="Cautions" hint="Warnings you would give someone who asked.">
            <TextArea value={String(draft.cautions ?? '')} onChange={(v) => setDraft({ ...draft, cautions: v })} rows={2} />
          </Field>
          <div className="gl-form-row">
            <Range
              label="Confidence you would state this with"
              value={Number(draft.confidence ?? 3)}
              min={1}
              max={5}
              onChange={(v) => setDraft({ ...draft, confidence: v })}
              format={(v) => `${v}/5 — yours`}
            />
            <Field label="Did it work for you?">
              <Select value={String(draft.worked)} onChange={(v) => setDraft({ ...draft, worked: v })} options={WORKED.map((w) => ({ value: w.value, label: w.label }))} />
            </Field>
          </div>
          <div className="ev-linkadd">
            <Field label="Link a technique from the archive">
              <Select value={linkPick} onChange={setLinkPick} options={techniques.map((t) => ({ value: t.id, label: `${String(t.title)} — ${String(t.domain)}` }))} placeholder="Choose an entry" />
            </Field>
            <Button
              size="sm"
              onClick={() => {
                if (!linkPick) return;
                if (!linked.includes(linkPick)) setDraft({ ...draft, linkedTechniqueIds: [...linked, linkPick] });
                setLinkPick('');
              }}
            >
              <Plus size={13} /> Link
            </Button>
          </div>
          <div className="ev-links">
            {linked.length ? (
              linked.map((id) => {
                const t = techniques.find((x) => x.id === id);
                return (
                  <Chip
                    key={id}
                    tone={t?.evidence === 'dangerous' ? 'danger' : 'info'}
                    onClick={() => setDraft({ ...draft, linkedTechniqueIds: linked.filter((x) => x !== id) })}
                    title="Remove link"
                  >
                    {t ? String(t.title) : 'removed entry'} ✕
                  </Chip>
                );
              })
            ) : (
              <span className="gl-small gl-faint">No techniques linked.</span>
            )}
          </div>
          <div className="ev-linkadd">
            <Field label="Link one of your goals">
              <Select value={goalPick} onChange={setGoalPick} options={goals.map((g) => ({ value: g.id, label: String(g.title) }))} placeholder="Choose a goal" />
            </Field>
            <Button
              size="sm"
              onClick={() => {
                if (!goalPick) return;
                if (!linkedGoals.includes(goalPick)) setDraft({ ...draft, linkedGoalIds: [...linkedGoals, goalPick] });
                setGoalPick('');
              }}
            >
              <Plus size={13} /> Link
            </Button>
          </div>
          <div className="ev-links">
            {linkedGoals.length ? (
              linkedGoals.map((id) => {
                const g = goals.find((x) => x.id === id);
                return (
                  <Chip key={id} onClick={() => setDraft({ ...draft, linkedGoalIds: linkedGoals.filter((x) => x !== id) })} title="Remove link">
                    {g ? String(g.title) : 'removed goal'} ✕
                  </Chip>
                );
              })
            ) : (
              <span className="gl-small gl-faint">No goals linked.</span>
            )}
          </div>
          <div className="gl-row gl-row--tight">
            <Button variant="primary" onClick={save}>
              <Check size={14} /> {editingId ? 'Update note' : 'Store note'}
            </Button>
            {editingId ? (
              <Button variant="ghost" onClick={reset}>
                Cancel editing
              </Button>
            ) : null}
          </div>
        </Card>
      </div>

      <aside className="gl-rule-col ev-railnotes">
        <div className="ev-railblock">
          <div className="gl-row gl-row--between" style={{ alignItems: 'center' }}>
            <span className="gl-eyebrow">Your notes</span>
            <Toggle checked={showDeleted} onChange={setShowDeleted} label="Show removed" />
          </div>
          {rows.length ? (
            <div className="ev-notes">
              {rows.map((k) => {
                const isStarter = Number(k.seed) === 1;
                const techs = ((k.linkedTechniqueIds as string[]) ?? []).map((id) => techniques.find((t) => t.id === id)?.title).filter(Boolean);
                return (
                  <div className="ev-note" key={k.id} data-deleted={Boolean(k.deletedAt)}>
                    <div className="gl-row gl-row--between" style={{ alignItems: 'baseline', gap: 'var(--glow-sp-3)' }}>
                      <span className="gl-serif ev-note__title">{String(k.title)}</span>
                      <span className="gl-tech">{formatDate(String(k.updatedAt))}</span>
                    </div>
                    <div className="gl-row gl-row--tight ev-note__flags" style={{ flexWrap: 'wrap' }}>
                      <Chip tone="info">{String(k.kind)}</Chip>
                      <Chip>confidence {String(k.confidence)}/5</Chip>
                      <Chip tone={k.worked === 'yes' ? 'strong' : k.worked === 'no' ? 'weak' : 'limited'}>worked: {String(k.worked)}</Chip>
                      {k.evidence ? <EvidenceChip grade={String(k.evidence)} /> : null}
                      {isStarter ? <Chip tone="gold">starter content</Chip> : null}
                    </div>
                    <p className="gl-small">{String(k.body)}</p>
                    {k.cautions ? <p className="gl-small ev-nolink">Cautions: {String(k.cautions)}</p> : null}
                    {techs.length ? <p className="gl-tech ev-note__links">linked: {techs.join(' · ')}</p> : null}
                    <div className="gl-row gl-row--tight">
                      {k.deletedAt ? (
                        <Button size="sm" variant="ghost" onClick={() => void saveRow(TABLES.knowledge, { id: k.id, deletedAt: null }).then(() => toast('Note restored.', 'ok'))}>
                          Restore
                        </Button>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => startEdit(k)}>
                            Edit
                          </Button>
                          <IconButton label={`Delete note ${String(k.title)}`} onClick={() => setConfirmId(k.id)}>
                            <Trash2 size={13} />
                          </IconButton>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title={showDeleted ? 'Nothing removed' : 'No notes yet'}
              body={
                showDeleted
                  ? 'Removed notes would appear here, restorable with one press.'
                  : 'Write down the conclusion you reached and the date you reached it. A knowledge base of one person’s honest readings is worth more than a hundred copied forum claims.'
              }
            />
          )}
        </div>
      </aside>

      <Modal
        open={Boolean(confirmId)}
        onClose={() => setConfirmId(null)}
        title="Delete this note?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmId(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirmId) void softDelete(TABLES.knowledge, confirmId).then(() => toast('Note removed. Restorable under “Show removed”.', 'ok'));
                setConfirmId(null);
              }}
            >
              Delete note
            </Button>
          </>
        }
      >
        <p className="gl-small">Soft delete: the row keeps its history and stays restorable until you empty Trash. Links from other departments will simply stop resolving.</p>
      </Modal>
    </div>
  );
}

