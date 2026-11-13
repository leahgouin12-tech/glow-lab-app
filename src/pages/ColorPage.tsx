/**
 * THE GLOW LAB — Personal Colour & Style Analysis (spec Part 15).
 *
 * Nothing here measures you. There is no camera analysis, no pixel sampling of
 * your face and no validated season algorithm — the 12-season taxonomy itself
 * has no formal validation, which is stated on the page. What exists: the
 * answers you give to your own perception questions, the hex codes you type or
 * pick, the palettes you save, and the tag you choose to write onto your own
 * closet pieces. Every tally shown is a count of your own answers.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Palette, Plus, Quote, Sparkles, Tag, Trash2 } from 'lucide-react';
import { saveRow, useRows } from '../hooks/live';
import { formatDate, softDelete, todayISO } from '../db/repo';
import { TABLES, type AnyRow, type TableName } from '../db/schema';
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
  Modal,
  SafetyBanner,
  Select,
  TextArea,
  TextInput,
  useToast
} from '../ui/primitives';
import { useUndoDelete } from '../ui/undo';
import { DeptIntro, EmptyPlate, IndexList, IndexRow, KvList, PullQuote, StatStrip } from '../ui/editorial';
import '../styles/departments/color.css';

/* ------------------------------------------------------------------ taxonomy */

const SEASONS = [
  'Spring Bright',
  'Spring Light',
  'Summer Cool',
  'Summer Light',
  'Summer Soft',
  'Autumn Warm',
  'Autumn Deep',
  'Autumn Muted',
  'Winter Bright',
  'Winter Cool',
  'Winter Deep',
  'Mixed — no single season',
  'Still exploring'
];

type Lean = 'warm' | 'cool' | 'neutral';
type Tone = 'light' | 'deep' | 'bright' | 'muted';

interface QDef {
  id: string;
  q: string;
  help: string;
  axis: 'temperature' | 'depth';
  options: { label: string; lean?: Lean; tone?: Tone }[];
}

/**
 * Nine self-report questions. Each answer is stored verbatim so you can read it
 * back and change it. The mapping column is printed next to every option — the
 * tally is arithmetic over the nine stored answers, nothing else.
 */
const QUESTIONS: QDef[] = [
  {
    id: 'metal',
    q: 'In daylight, which metal near the face reads healthier on you?',
    help: 'Judge in a window-lit room, not under office lighting.',
    axis: 'temperature',
    options: [
      { label: 'Gold', lean: 'warm' },
      { label: 'Silver / platinum', lean: 'cool' },
      { label: 'Genuinely no difference', lean: 'neutral' }
    ]
  },
  {
    id: 'white',
    q: 'Which white makes you look less tired?',
    help: 'Hold both fabrics at the same time, same light.',
    axis: 'temperature',
    options: [
      { label: 'Cream / ivory', lean: 'warm' },
      { label: 'Pure bright white', lean: 'cool' },
      { label: 'Either works', lean: 'neutral' }
    ]
  },
  {
    id: 'veins',
    q: 'Wrist veins in natural light look mostly…',
    help: 'A weak signal at best. It is included because you can check it, not because it decides anything.',
    axis: 'temperature',
    options: [
      { label: 'Greenish', lean: 'warm' },
      { label: 'Blue / violet', lean: 'cool' },
      { label: 'A mix I cannot separate', lean: 'neutral' }
    ]
  },
  {
    id: 'hairSun',
    q: 'Your hair in direct sunlight shows…',
    help: 'Daylight, not a bathroom bulb, and not a filter.',
    axis: 'temperature',
    options: [
      { label: 'Golden, copper or red flecks', lean: 'warm' },
      { label: 'Ash, blue-black or cool beige', lean: 'cool' },
      { label: 'Both depending on the day', lean: 'neutral' }
    ]
  },
  {
    id: 'reaction',
    q: 'Sun response you actually experience:',
    help: 'This is a physiology habit you observed, not a diagnosis.',
    axis: 'temperature',
    options: [
      { label: 'Browns easily, rarely burns', lean: 'warm' },
      { label: 'Burns, then reddens', lean: 'cool' },
      { label: 'Browns slowly after burning', lean: 'neutral' }
    ]
  },
  {
    id: 'contrast',
    q: 'Contrast between your hair, skin and eyes:',
    help: 'Squint at a bare-face daylight photo — the value gap, not the colour gap.',
    axis: 'depth',
    options: [
      { label: 'High — strong separation', tone: 'deep' },
      { label: 'Low — everything close in value', tone: 'light' },
      { label: 'Medium, depends on lighting', tone: 'muted' }
    ]
  },
  {
    id: 'saturation',
    q: 'Colours you already reach for tend to be…',
    help: 'Read your own closet, not your ideal closet.',
    axis: 'depth',
    options: [
      { label: 'Clear and saturated', tone: 'bright' },
      { label: 'Soft, dusty, greyed', tone: 'muted' },
      { label: 'Deep and heavy', tone: 'deep' },
      { label: 'Pale and light', tone: 'light' }
    ]
  },
  {
    id: 'worst',
    q: 'Which has made you look worst in a photograph you remember?',
    help: 'A real memory beats a theory. One colour family is enough.',
    axis: 'depth',
    options: [
      { label: 'A neon or extremely clear colour', tone: 'muted' },
      { label: 'A muddy greyed tone', tone: 'bright' },
      { label: 'Something very pale that washed me out', tone: 'deep' },
      { label: 'Nothing stands out', tone: 'light' }
    ]
  },
  {
    id: 'eyes',
    q: 'Iris next to a white sheet in daylight reads as…',
    help: 'White paper, window light, no screen colour cast.',
    axis: 'temperature',
    options: [
      { label: 'Honey, amber, warm grey-green', lean: 'warm' },
      { label: 'Blue, grey, cool brown', lean: 'cool' },
      { label: 'I cannot tell', lean: 'neutral' }
    ]
  }
];

const SEASON_RULE: { when: string; then: string }[] = [
  { when: 'warm + deep', then: 'Autumn Deep or Autumn Warm' },
  { when: 'warm + light', then: 'Spring Light or Autumn Warm' },
  { when: 'warm + bright', then: 'Spring Bright' },
  { when: 'warm + muted', then: 'Autumn Muted' },
  { when: 'cool + deep', then: 'Winter Deep or Winter Cool' },
  { when: 'cool + light', then: 'Summer Light' },
  { when: 'cool + bright', then: 'Winter Bright' },
  { when: 'cool + muted', then: 'Summer Soft or Summer Cool' },
  { when: 'no majority', then: 'Mixed — which is a common and honest outcome' }
];

/* ---------------------------------------------------------------- colour math */

function normaliseHex(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  if (/^[0-9a-f]{6}$/.test(v)) return `#${v}`;
  return null;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = normaliseHex(hex) ?? '#000000';
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function anyToRgb(raw: string): [number, number, number] | null {
  const v = raw.trim();
  if (v.startsWith('#')) return hexToRgb(v);
  const m = v.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

function channelLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(channelLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG-style ratio: (L1 + 0.05) / (L2 + 0.05). Inputs are printed in the UI. */
function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function useThemeInks() {
  return useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    const read = (token: string, fallback: string) => anyToRgb((cs.getPropertyValue(token) || fallback).trim()) ?? hexToRgb(fallback);
    return { strong: read('--glow-text-strong', '#f8f1e9'), inverse: read('--glow-text-inverse', '#14090c') };
  }, []);
}

/* ------------------------------------------------------------------- shapes */

interface PaletteEditor {
  id?: string;
  name: string;
  season: string;
  note: string;
  swatches: string[];
  draft: string;
}

interface SessionEditor {
  id?: string;
  title: string;
  analyst: string;
  on: string;
  lighting: string;
  season: string;
  notes: string;
}

function blankPalette(favorites: string[]): PaletteEditor {
  return { name: '', season: SEASONS[SEASONS.length - 1], note: '', swatches: [...favorites], draft: '' };
}

export default function ColorPage() {
  const profiles = useRows(TABLES.profile, { where: { kind: 'appearance' } });
  const knowledge = useRows(TABLES.knowledge);
  const items = useRows(TABLES.clothingItems);
  const toast = useToast();
  const remove = useUndoDelete();
  const navigate = useNavigate();
  const inks = useThemeInks();

  const prof: AnyRow | undefined = profiles[0];
  const d = (prof?.data ?? {}) as Record<string, any>;
  const answers = (d.answers ?? {}) as Record<string, string>;
  const favorites = (d.favoriteHexes ?? []) as string[];
  const avoided = (d.avoidedHexes ?? []) as string[];
  const overrideSeason = (d.seasonOverride as string) ?? '';
  const selfNotes = (d.colourNotes as string) ?? '';

  const paletteRows = useMemo(() => knowledge.filter((k) => Array.isArray(k.data?.swatches)), [knowledge]);
  const sessionRows = useMemo(
    () => knowledge.filter((k) => k.domain === 'colour' && typeof k.data?.season === 'string' && !Array.isArray(k.data?.swatches)),
    [knowledge]
  );

  const [paletteEditor, setPaletteEditor] = useState<PaletteEditor | null>(null);
  const [sessionEditor, setSessionEditor] = useState<SessionEditor | null>(null);
  const [tagging, setTagging] = useState<{ palette: AnyRow; ids: string[] } | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ table: TableName; id: string; label: string } | null>(null);
  const [inkSwatch, setInkSwatch] = useState<string>('#b48a5e');
  const [newFav, setNewFav] = useState('#c9a227');
  const [newAvoid, setNewAvoid] = useState('#7d8ca3');

  /* --------------------------------------------------------- tally maths */
  const tally = useMemo(() => {
    const codeOf = (v: string | undefined) => (v ? v.slice(v.lastIndexOf('|') + 1) : '');
    const tempCodes = QUESTIONS.filter((q) => q.axis === 'temperature').map((q) => codeOf(answers[q.id]));
    const depthCodes = QUESTIONS.filter((q) => q.axis === 'depth').map((q) => codeOf(answers[q.id]));
    const warm = tempCodes.filter((c) => c === 'warm').length;
    const cool = tempCodes.filter((c) => c === 'cool').length;
    const neutralT = tempCodes.filter((c) => c === 'neutral').length;
    const tone = (t: string) => depthCodes.filter((c) => c === t).length;
    const answered = QUESTIONS.filter((q) => answers[q.id]).length;
    const temp: Lean | null = warm + cool === 0 ? (neutralT ? 'neutral' : null) : warm > cool ? 'warm' : cool > warm ? 'cool' : 'neutral';
    const depths: Tone[] = ['deep', 'light', 'bright', 'muted'];
    const ranked = depths.map((t) => ({ t, n: tone(t) })).sort((a, b) => b.n - a.n);
    const dominantTone: Tone | null = answered ? (ranked[0].n > 0 ? ranked[0].t : null) : null;
    const key = temp ? `${temp} + ${dominantTone ?? 'muted'}` : 'no majority';
    const suggestion = SEASON_RULE.find((r) => r.when === key)?.then ?? SEASON_RULE[SEASON_RULE.length - 1].then;
    return {
      warm,
      cool,
      neutralT,
      deep: tone('deep'),
      light: tone('light'),
      bright: tone('bright'),
      muted: tone('muted'),
      answered,
      total: QUESTIONS.length,
      temp,
      dominantTone,
      suggestion,
      key
    };
  }, [answers]);

  /* ------------------------------------------------------------- writes */
  async function writeData(patch: Record<string, unknown>) {
    await saveRow(TABLES.profile, {
      id: prof?.id,
      kind: 'appearance',
      singleton: 1,
      data: { ...(prof?.data ?? {}), ...patch }
    });
  }

  async function setAnswer(qid: string, label: string, code: string) {
    await writeData({ answers: { ...answers, [qid]: `${label}|${code}` } });
  }

  async function clearAnswers() {
    await writeData({ answers: {} });
    toast('All nine answers cleared. The tally resets to zero.', 'ok');
  }

  async function addFavorite(list: 'favoriteHexes' | 'avoidedHexes', raw: string, current: string[]) {
    const hex = normaliseHex(raw);
    if (!hex) {
      toast('Type a hex code like #b48a5e or use the picker.', 'bad');
      return;
    }
    if (current.includes(hex)) {
      toast('That exact value is already in the list.', 'info');
      return;
    }
    await writeData({ [list]: [...current, hex] });
  }

  async function removeEntry(list: 'favoriteHexes' | 'avoidedHexes', hex: string, current: string[]) {
    await writeData({ [list]: current.filter((c) => c !== hex) });
  }

  async function savePalette() {
    if (!paletteEditor) return;
    const clean = paletteEditor.swatches.map(normaliseHex).filter((x): x is string => Boolean(x));
    if (!paletteEditor.name.trim()) {
      toast('Name the set — otherwise it is unfindable later.', 'bad');
      return;
    }
    if (clean.length < 2) {
      toast('A palette needs at least two swatches.', 'bad');
      return;
    }
    await saveRow(TABLES.knowledge, {
      id: paletteEditor.id,
      title: paletteEditor.name.trim(),
      kind: 'note',
      body: paletteEditor.note,
      domain: 'colour',
      confidence: 3,
      worked: 'unset',
      data: { swatches: clean, season: paletteEditor.season, type: 'palette' },
      tags: ['palette', paletteEditor.season.toLowerCase()]
    });
    toast(paletteEditor.id ? 'Palette updated.' : 'Palette stored as a real record.', 'ok');
    setPaletteEditor(null);
  }

  async function saveSession() {
    if (!sessionEditor) return;
    if (!sessionEditor.title.trim()) {
      toast('Give the session a title.', 'bad');
      return;
    }
    await saveRow(TABLES.knowledge, {
      id: sessionEditor.id,
      title: sessionEditor.title.trim(),
      kind: 'research',
      body: sessionEditor.notes,
      domain: 'colour',
      confidence: 3,
      worked: 'unset',
      data: { season: sessionEditor.season, analyst: sessionEditor.analyst, on: sessionEditor.on, lighting: sessionEditor.lighting },
      tags: ['colour-session', sessionEditor.season.toLowerCase()]
    });
    toast('Session record saved.', 'ok');
    setSessionEditor(null);
  }

  async function applyTag() {
    if (!tagging) return;
    const tag = `palette:${tagging.palette.title}`;
    let n = 0;
    for (const id of tagging.ids) {
      const it = items.find((x) => x.id === id);
      if (!it) continue;
      const set = new Set((it.tags as string[]) ?? []);
      if (set.has(tag)) set.delete(tag);
      else set.add(tag);
      await saveRow(TABLES.clothingItems, { id, tags: [...set] });
      n += 1;
    }
    toast(`${n} piece${n === 1 ? '' : 's'} re-tagged with “${tag}”.`, 'ok');
    setTagging(null);
  }

  async function runDelete() {
    if (!confirmDel) return;
    await remove(confirmDel.table, confirmDel.id, confirmDel.label);
    setConfirmDel(null);
  }

  /* ------------------------------------------------------------- render */
  const taggedCount = (title: unknown) => items.filter((i) => ((i.tags as string[]) ?? []).includes(`palette:${String(title)}`)).length;

  function inkChoice(hex: string) {
    const rgb = hexToRgb(hex);
    const strongRatio = contrastRatio(rgb, inks.strong);
    const inverseRatio = contrastRatio(rgb, inks.inverse);
    return {
      ratio: { strong: strongRatio, inverse: inverseRatio },
      colour: strongRatio >= inverseRatio ? 'var(--glow-text-strong)' : 'var(--glow-text-inverse)',
      tokenName: strongRatio >= inverseRatio ? '--glow-text-strong' : '--glow-text-inverse'
    };
  }

  function SwatchBar({ swatches, onRemove }: { swatches: string[]; onRemove?: (hex: string) => void }) {
    return (
      <div className="co-swatchbar">
        {swatches.map((s) => {
          const ink = inkChoice(s);
          return (
            <div
              key={s}
              style={{ background: s, color: ink.colour }}
              title={`${s} — ink ${ink.tokenName} at ${Math.max(ink.ratio.strong, ink.ratio.inverse).toFixed(2)}:1`}
              onClick={onRemove ? () => onRemove(s) : undefined}
            >
              {s}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="gl-page co-page">
      <DeptIntro
        id="color"
        deck="A colour exploration you drive. You answer, you type the hex codes, you override the conclusion. This app has no camera analysis and no validated season maths."
        actions={
          <>
            <Button variant="primary" onClick={() => setPaletteEditor(blankPalette(favorites))}>
              <Palette size={14} /> New palette
            </Button>
            <Button onClick={() => setSessionEditor({ title: '', analyst: '', on: todayISO(), lighting: 'Daylight / north-facing window', season: SEASONS[0], notes: '' })}>
              <Plus size={14} /> Log an analysis session
            </Button>
            <Button variant="ghost" onClick={() => navigate('/closet')}>
              Closet
            </Button>
          </>
        }
        meta={[
          { label: 'Questions answered', value: `${tally.answered} of ${tally.total}` },
          { label: 'Palettes stored', value: String(paletteRows.length) },
          { label: 'Sessions logged', value: String(sessionRows.length) }
        ]}
      />

      <SafetyBanner tone="note" title="Read this before you take any of it seriously">
        Lighting and screen calibration change perception — the same fabric and the same hex code look different at 4pm in a window,
        under a shop's downlights, and on a phone at 60% brightness. A panel of swatches on your screen is not a drape across your
        chest under a professional's lamps. Treat every conclusion on this page as your own current opinion, recorded so you can
        revise it. Seasonal colour analysis has no formal validation; the practical part people do notice is hue and value harmony,
                and that is what the self-test approximates.
      </SafetyBanner>

      <StatStrip
        items={[
          { label: 'Warm-tally', value: String(tally.warm), hint: 'answers tagged warm' },
          { label: 'Cool-tally', value: String(tally.cool), hint: 'answers tagged cool' },
          { label: 'Neutral', value: String(tally.neutralT), hint: 'a legitimate result' },
          { label: 'Your current conclusion', value: overrideSeason || tally.suggestion, hint: overrideSeason ? 'you overrode the tally' : `rule row: ${tally.key}` },
          { label: 'Favourite hexes', value: String(favorites.length), hint: `${avoided.length} avoided` }
        ]}
      />

      <PullQuote cite="Method note — recorded on the page, not hidden in a footer">
        “The drapes are a conversation, not a measurement. If I hand you a fabric that reads well, the honest claim is: you looked
        at it in this light, and you preferred it.”
      </PullQuote>

      <div className="co-grid">
        {/* --------------------------------------------------- self-test */}
        <Card>
          <CardHead
            title="Self-test: nine questions"
            eyebrow="your perception, stored verbatim"
            right={<Chip tone="gold">{tally.answered}/{tally.total} answered</Chip>}
          />
          <p className="gl-small gl-muted">
            Every option shows the tag it writes. Nothing is hidden, nothing is auto-locked: change an answer and the tally moves
            because it is literally {`warm = ${tally.warm}`} and {`cool = ${tally.cool}`} counted from your own stored choices.
          </p>
          {QUESTIONS.map((q) => {
            const current = answers[q.id] ?? '';
            return (
              <div className="co-qa" key={q.id}>
                <div className="gl-serif" style={{ fontSize: '1.04rem', color: 'var(--glow-text-strong)' }}>{q.q}</div>
                {q.help ? <div className="gl-small gl-faint">{q.help}</div> : null}
                <div className="gl-row gl-row--tight" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                  {q.options.map((o) => {
                    const code = o.lean ?? o.tone ?? '';
                    const value = `${o.label}|${code}`;
                    const on = current === value;
                    return (
                      <Chip key={o.label} active={on} onClick={() => void setAnswer(q.id, o.label, code)} title={`writes tag: ${code || 'none'}`}>
                        {o.label}
                      </Chip>
                    );
                  })}
                </div>
                {current ? (
                  <div className="gl-tech" style={{ marginTop: 6 }}>
                    stored: {current.split('|')[0]} → tag <span className="co-tally">{current.split('|')[1] || 'none'}</span>
                  </div>
                ) : (
                  <div className="gl-tech" style={{ marginTop: 6 }}>unanswered</div>
                )}
              </div>
            );
          })}

          <div className="gl-inset" style={{ marginTop: 'var(--glow-sp-4)' }}>
            <div className="gl-label">Tally as arithmetic</div>
            <div className="co-lean">
              <span>temperature</span>
              <span>
                warm {tally.warm} · cool {tally.cool} · neutral {tally.neutralT} (out of{' '}
                {QUESTIONS.filter((q) => q.axis === 'temperature').length})
              </span>
              <span>depth</span>
              <span>
                deep {tally.deep} · light {tally.light} · bright {tally.bright} · muted {tally.muted} (out of{' '}
                {QUESTIONS.filter((q) => q.axis === 'depth').length})
              </span>
              <span>rule row</span>
              <span className="co-tally">{tally.key} → {tally.suggestion}</span>
            </div>
          </div>

          <Disclosure summary="Show the full mapping table">
            <div className="co-facts">
              {SEASON_RULE.map((r) => (
                <div key={r.when}>
                  <div className="gl-tech">{r.when}</div>
                  <div className="gl-small gl-strong">{r.then}</div>
                </div>
              ))}
            </div>
            <p className="gl-small gl-faint">
              The table is a fixed convenience mapping, not a discovery about you. Change the answers or override the result.
            </p>
          </Disclosure>

          <Field label="Override the conclusion" hint="If you know your season from a real drape session, that beats nine questions.">
            <Select
              value={overrideSeason}
              onChange={(v) => void writeData({ seasonOverride: v })}
              placeholder="No override — use the tally"
              options={SEASONS.map((s) => ({ value: s, label: s }))}
            />
          </Field>
          <Field label="Notes to your future self">
            <TextArea value={selfNotes} onChange={(v) => void writeData({ colourNotes: v })} rows={3} placeholder="Which colours you keep reaching for, which photographs lied about" />
          </Field>
          <div className="gl-row gl-row--tight">
            <Button size="sm" onClick={clearAnswers}>
              Clear all nine answers
            </Button>
            <Button size="sm" variant="ghost" onClick={() => navigate('/evidence')}>
              Read the evidence grading
            </Button>
          </div>
        </Card>

        {/* ----------------------------------------------------- palettes */}
        <div className="gl-stack">
          {paletteRows.length === 0 ? (
            <EmptyPlate
              kicker="Section 02"
              title="No palettes saved yet"
              body="A palette here is a named set of hex codes you entered — the values you actually liked, from a photograph, a label, a colour picker, or your own favourites below. There is no generated palette, because generated swatches would be decoration disguised as analysis."
              action={
                <Button variant="primary" onClick={() => setPaletteEditor(blankPalette(favorites))}>
                  <Plus size={14} /> Create the first set
                </Button>
              }
            />
          ) : (
            paletteRows.map((p) => {
              const swatches = (p.data?.swatches as string[]) ?? [];
              return (
                <Card key={p.id}>
                  <CardHead
                    title={p.title}
                    eyebrow={`${(p.data?.season as string) ?? 'no season'} · ${swatches.length} swatches · ${taggedCount(p.title)} closet pieces tagged`}
                    right={
                      <>
                        <IconButton
                          label={`Edit ${p.title}`}
                          onClick={() =>
                            setPaletteEditor({
                              id: p.id,
                              name: p.title ?? '',
                              season: (p.data?.season as string) ?? SEASONS[0],
                              note: p.body ?? '',
                              swatches: [...swatches],
                              draft: ''
                            })
                          }
                        >
                          <Sparkles size={14} />
                        </IconButton>
                        <IconButton label={`Delete ${p.title}`} onClick={() => setConfirmDel({ table: TABLES.knowledge, id: p.id, label: p.title })}>
                          <Trash2 size={14} />
                        </IconButton>
                      </>
                    }
                  />
                  <SwatchBar swatches={swatches} />
                  {p.body ? <p className="gl-small gl-muted">{p.body}</p> : null}
                  <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                    {swatches.map((s) => {
                      const ink = inkChoice(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          className="co-ink-test"
                          style={{ background: s, color: ink.colour }}
                          onClick={() => setInkSwatch(s)}
                          title="Load into the ink test"
                        >
                          <span className="gl-tech">{s}</span>
                          <span className="gl-label">{Math.max(ink.ratio.strong, ink.ratio.inverse).toFixed(2)}:1</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="gl-row gl-row--between">
                    <Chip onClick={() => setTagging({ palette: p, ids: items.filter((i) => ((i.tags as string[]) ?? []).includes(`palette:${p.title}`)).map((i) => i.id) })}>
                      <Tag size={12} /> Tag closet pieces
                    </Chip>
                    <span className="gl-tech">saved {formatDate(new Date(p.updatedAt).toISOString().slice(0, 10))}</span>
                  </div>
                </Card>
              );
            })
          )}

          <Card>
            <CardHead title="Analysis sessions you actually attended" eyebrow="drapes, not this app" right={<Chip>{sessionRows.length}</Chip>} />
            {sessionRows.length === 0 ? (
              <EmptyState
                title="No session logged"
                body="If a professional analysed you, record what they said here — including the lighting they used, because that is the part that changes the answer."
                action={
                  <Button size="sm" onClick={() => setSessionEditor({ title: '', analyst: '', on: todayISO(), lighting: 'Daylight / north-facing window', season: SEASONS[0], notes: '' })}>
                    Log a session
                  </Button>
                }
              />
            ) : (
              <IndexList>
                {sessionRows.map((s, i) => (
                  <IndexRow
                    key={s.id}
                    no={i + 1}
                    title={s.title}
                    sub={`${(s.data?.season as string) ?? '—'} · ${formatDate((s.data?.on as string) ?? null)} · ${s.data?.analyst || 'analyst not recorded'}`}
                    right={<Chip>{(s.data?.lighting as string) ?? 'lighting not recorded'}</Chip>}
                    onClick={() =>
                      setSessionEditor({
                        id: s.id,
                        title: s.title ?? '',
                        analyst: (s.data?.analyst as string) ?? '',
                        on: (s.data?.on as string) ?? todayISO(),
                        lighting: (s.data?.lighting as string) ?? '',
                        season: (s.data?.season as string) ?? SEASONS[0],
                        notes: s.body ?? ''
                      })
                    }
                  />
                ))}
              </IndexList>
            )}
          </Card>
        </div>

        {/* --------------------------------------------------- favourites */}
        <div className="gl-stack">
          <Card>
            <CardHead title="Favourites" eyebrow="hex you chose" right={<Chip tone="gold">{favorites.length}</Chip>} />
            <div className="co-picker">
              <input type="color" aria-label="Pick a favourite colour" value={normaliseHex(newFav) ?? '#c9a227'} onChange={(e) => setNewFav(e.target.value)} />
              <TextInput value={newFav} onChange={setNewFav} placeholder="#c9a227" />
              <Button size="sm" onClick={() => void addFavorite('favoriteHexes', newFav, favorites)}>
                <Plus size={13} /> Add
              </Button>
            </div>
            <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-3)', flexWrap: 'wrap' }}>
              {favorites.map((f) => (
                <span className="co-chip" key={f}>
                  <i style={{ background: f }} />
                  <span className="gl-tech">{f}</span>
                  <IconButton label={`Remove ${f}`} onClick={() => void removeEntry('favoriteHexes', f, favorites)}>
                    <Trash2 size={12} />
                  </IconButton>
                </span>
              ))}
              {!favorites.length ? <span className="gl-small gl-muted">Nothing yet — the values you keep buying are data too.</span> : null}
            </div>
          </Card>

          <Card>
            <CardHead title="Avoided" eyebrow="colours that made you look tired" right={<Chip tone="danger">{avoided.length}</Chip>} />
            <div className="co-picker">
              <input type="color" aria-label="Pick an avoided colour" value={normaliseHex(newAvoid) ?? '#7d8ca3'} onChange={(e) => setNewAvoid(e.target.value)} />
              <TextInput value={newAvoid} onChange={setNewAvoid} placeholder="#7d8ca3" />
              <Button size="sm" onClick={() => void addFavorite('avoidedHexes', newAvoid, avoided)}>
                <Plus size={13} /> Add
              </Button>
            </div>
            <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-3)', flexWrap: 'wrap' }}>
              {avoided.map((f) => (
                <span className="co-chip" key={f}>
                  <i style={{ background: f }} />
                  <span className="gl-tech">{f}</span>
                  <IconButton label={`Remove ${f}`} onClick={() => void removeEntry('avoidedHexes', f, avoided)}>
                    <Trash2 size={12} />
                  </IconButton>
                </span>
              ))}
              {!avoided.length ? <span className="gl-small gl-muted">No avoided values recorded.</span> : null}
            </div>
            {favorites.length ? (
              <div style={{ marginTop: 'var(--glow-sp-3)' }}>
                <Button size="sm" variant="ghost" onClick={() => setPaletteEditor(blankPalette(favorites))}>
                  Build a palette from these {favorites.length} favourites
                </Button>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHead title="Ink test on one swatch" eyebrow="contrast arithmetic" sub="Text legibility is a real, computable property of a hex value. Whether the colour flatters you is not." />
            <div className="co-ink-test" style={{ background: inkSwatch, color: inkChoice(inkSwatch).colour, padding: 'var(--glow-sp-5)' }}>
              <div className="gl-serif" style={{ fontSize: '1.5rem' }}>Sample</div>
              <div className="gl-tech">{inkSwatch}</div>
            </div>
            <div className="gl-form-row" style={{ marginTop: 'var(--glow-sp-3)' }}>
              <Field label="Swatch">
                <TextInput value={inkSwatch} onChange={setInkSwatch} placeholder="#b48a5e" />
              </Field>
              <input type="color" aria-label="Pick a test colour" style={{ alignSelf: 'flex-end', width: 44, height: 34 }} value={normaliseHex(inkSwatch) ?? '#b48a5e'} onChange={(e) => setInkSwatch(e.target.value)} />
            </div>
            <div className="gl-inset">
              <div className="gl-label">Formula</div>
              <div className="gl-tech">(L + 0.05) / (L2 + 0.05) with L = 0.2126R + 0.7152G + 0.0722B, channels linearised</div>
              <div className="gl-tech" style={{ marginTop: 6 }}>
                vs --glow-text-strong: {inkChoice(inkSwatch).ratio.strong.toFixed(2)}:1 · vs --glow-text-inverse:{' '}
                {inkChoice(inkSwatch).ratio.inverse.toFixed(2)}:1 → uses {inkChoice(inkSwatch).tokenName}
              </div>
            </div>
            <p className="gl-small gl-faint">
              Ratios are computed against your theme's own ink tokens, so they change with the theme — which is exactly the point
              about calibration. 4.5:1 is the usual WCAG AA reference for body text, nothing more.
            </p>
          </Card>
        </div>
      </div>

      <Card variant="flush">
        <KvList
          items={[
            { k: 'Stored in', v: 'profile (kind: appearance, singleton) for answers/favourites · knowledge (domain: colour) for palettes and sessions · clothingItems tags when you apply one.' },
            { k: 'Analysis', v: 'None automated. No image sampling, no AI, no measurement of skin, teeth or eyes.' },
            { k: 'Limits', v: 'Lighting and screen calibration change perception; the 12-season taxonomy is unvalidated; results are your recorded opinion, revisable.' },
            { k: 'Contrast', v: 'The only computed numbers here are WCAG-style ratios between hex values you entered and your theme ink.' }
          ]}
        />
      </Card>

      {/* ---------------------------------------------------------- modals */}
      <Modal
        open={Boolean(paletteEditor)}
        onClose={() => setPaletteEditor(null)}
        title={paletteEditor?.id ? 'Edit palette' : 'New palette'}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setPaletteEditor(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void savePalette()}>
              <Check size={14} /> Save palette
            </Button>
          </>
        }
      >
        {paletteEditor ? (
          <div className="gl-stack">
            <div className="gl-form-row">
              <Field label="Name">
                <TextInput value={paletteEditor.name} onChange={(v) => setPaletteEditor({ ...paletteEditor, name: v })} placeholder="Autumn, work week" />
              </Field>
              <Field label="Season label (yours)">
                <Select value={paletteEditor.season} onChange={(v) => setPaletteEditor({ ...paletteEditor, season: v })} options={SEASONS.map((s) => ({ value: s, label: s }))} />
              </Field>
            </div>
            {paletteEditor.swatches.length ? <SwatchBar swatches={paletteEditor.swatches} onRemove={(hex) => setPaletteEditor({ ...paletteEditor, swatches: paletteEditor.swatches.filter((s) => s !== hex) })} /> : null}
            <div className="co-picker">
              <input
                type="color"
                aria-label="Pick a swatch colour"
                value={normaliseHex(paletteEditor.draft) ?? '#888888'}
                onChange={(e) => setPaletteEditor({ ...paletteEditor, draft: e.target.value })}
              />
              <TextInput value={paletteEditor.draft} onChange={(v) => setPaletteEditor({ ...paletteEditor, draft: v })} placeholder="#8a5a3c — then Add, or paste a list below" />
              <Button size="sm" onClick={() => {
                const hex = normaliseHex(paletteEditor.draft);
                if (!hex) {
                  toast('That is not a hex value.', 'bad');
                  return;
                }
                setPaletteEditor({ ...paletteEditor, swatches: [...paletteEditor.swatches, hex], draft: '' });
              }}>
                <Plus size={13} /> Add swatch
              </Button>
              <Button size="sm" variant="ghost" onClick={() => {
                const parts = paletteEditor.draft.split(/[,\s]+/).map(normaliseHex).filter((x): x is string => Boolean(x));
                if (!parts.length) {
                  toast('Paste hex codes separated by commas or spaces.', 'bad');
                  return;
                }
                setPaletteEditor({ ...paletteEditor, swatches: [...paletteEditor.swatches, ...parts], draft: '' });
              }}>
                Import pasted list
              </Button>
            </div>
            <Field label="What this set is for">
              <TextArea rows={3} value={paletteEditor.note} onChange={(v) => setPaletteEditor({ ...paletteEditor, note: v })} placeholder="Where you use it, what you tested it against" />
            </Field>
            <p className="gl-small gl-faint">
              Swatch count and the hexes themselves are stored exactly as listed. Applying this set to closet pieces writes a tag of
              the form <code>{'palette:your-name'}</code> onto the clothingItems rows you select — nothing is renamed or
              reclassified automatically.
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(sessionEditor)}
        onClose={() => setSessionEditor(null)}
        title={sessionEditor?.id ? 'Edit session record' : 'Log an analysis session'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSessionEditor(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void saveSession()}>
              Save record
            </Button>
          </>
        }
      >
        {sessionEditor ? (
          <div className="gl-stack">
            <Field label="Title">
              <TextInput value={sessionEditor.title} onChange={(v) => setSessionEditor({ ...sessionEditor, title: v })} placeholder="Studio drape session, 2 hours" />
            </Field>
            <div className="gl-form-row">
              <Field label="Analyst / studio">
                <TextInput value={sessionEditor.analyst} onChange={(v) => setSessionEditor({ ...sessionEditor, analyst: v })} placeholder="Whoever actually did it" />
              </Field>
              <DateInput label="Date" value={sessionEditor.on} onChange={(v) => setSessionEditor({ ...sessionEditor, on: v })} />
            </div>
            <div className="gl-form-row">
              <Field label="Lighting used">
                <Select
                  value={sessionEditor.lighting}
                  onChange={(v) => setSessionEditor({ ...sessionEditor, lighting: v })}
                  options={['Daylight / north-facing window', 'Studio daylight bulbs', 'Shop lighting (mixed)', 'Indoor artificial', 'Unknown'].map((l) => ({ value: l, label: l }))}
                />
              </Field>
              <Field label="Their conclusion">
                <Select value={sessionEditor.season} onChange={(v) => setSessionEditor({ ...sessionEditor, season: v })} options={SEASONS.map((s) => ({ value: s, label: s }))} />
              </Field>
            </div>
            <Field label="What they said, in your words">
              <TextArea rows={4} value={sessionEditor.notes} onChange={(v) => setSessionEditor({ ...sessionEditor, notes: v })} placeholder="Which drapes you reacted to, which you disputed" />
            </Field>
            <div className="gl-note">
              <Quote size={13} /> This record is a note about an external event. The app cannot verify it, and does not present it as
              measured truth.
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(tagging)}
        onClose={() => setTagging(null)}
        title={`Tag closet pieces with “palette:${tagging?.palette.title ?? ''}”`}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setTagging(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void applyTag()} disabled={!tagging?.ids.length}>
              Write the tag ({tagging?.ids.length ?? 0})
            </Button>
          </>
        }
      >
        <p className="gl-small gl-muted">
          Tapping a piece toggles the tag on or off for that row and saves it immediately when you press write. Global search and
          the closet filters read tags, which is how the link works — there is no hidden relation.
        </p>
        {items.length === 0 ? (
          <EmptyState title="No closet pieces to tag" body="Add pieces in the Style & Digital Closet department first." action={<Button onClick={() => navigate('/closet')}>Open the closet</Button>} />
        ) : (
          <div className="cl-pick">
            {items.map((i) => {
              const has = ((i.tags as string[]) ?? []).includes(`palette:${tagging?.palette.title}`);
              const selected = tagging?.ids.includes(i.id) ?? false;
              return (
                <button
                  key={i.id}
                  type="button"
                  data-on={selected}
                  aria-pressed={selected}
                  onClick={() => setTagging((t) => (t ? { ...t, ids: t.ids.includes(i.id) ? t.ids.filter((x) => x !== i.id) : [...t.ids, i.id] } : t))}
                >
                  <span className="gl-serif">{i.name}</span>
                  <span className="gl-tech">{i.category} · {(i.colors as string[])?.length ?? 0} colours logged{has ? ' · already tagged' : ''}</span>
                </button>
              );
            })}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(confirmDel)}
        onClose={() => setConfirmDel(null)}
        title="Delete this colour record?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDel(null)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => void runDelete()}>
              <Trash2 size={14} /> Delete
            </Button>
          </>
        }
      >
        <p>
          <strong>{confirmDel?.label}</strong> will be soft-deleted. Closet pieces already carrying a `palette:` tag keep that tag
          until you remove it themselves — this app does not do silent cascade edits.
        </p>
      </Modal>
    </div>
  );
}
