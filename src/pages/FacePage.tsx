/**
 * THE GLOW LAB — Facial Aesthetics Lab (spec Part 6).
 *
 * A photography bench and a study room, not a face reader. This app contains no
 * computer-vision model and no paid analysis call, so nothing on this page
 * detects a landmark, measures a ratio or scores a face. What it does instead:
 * stores photographs under the capture conditions you record, draws guide rules
 * whose positions YOU set, keeps draggable labelled markers on the photo, logs
 * observations with an explicit source label (measured / observed / professional),
 * and holds honest before–after comparisons that warn you when the two shots were
 * not taken the same way.
 *
 * Everything writes through `saveRow` into IndexedDB — reload and it is still here.
 */
import '../styles/departments/face.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Plus, RotateCcw, ScanFace, Trash2 } from 'lucide-react';
import { saveRow, useRow, useRows } from '../hooks/live';
import { addDays, formatDate, newId, restore, softDelete, todayISO } from '../db/repo';
import {
  TABLES,
  type AnyRow,
  type ExperimentRow,
  type MediaItemRow,
  type ObservationRow
} from '../db/schema';
import { techniqueIsRecommendable } from '../engine/prioritisation';
import {
  Button,
  Card,
  CardHead,
  Chip,
  DateInput,
  EmptyState,
  EvidenceChip,
  Field,
  IconButton,
  Modal,
  Range,
  Rating,
  SafetyBanner,
  SegmentedControl,
  Select,
  TextArea,
  TextInput,
  Toggle,
  useToast
} from '../ui/primitives';
import { DeptIntro, EmptyPlate, IndexList, IndexRow, KvList, PullQuote, StatStrip } from '../ui/editorial';
import { conditionRows, NOT_RECORDED } from '../ui/GhostGuide';
import { useImageSrc } from '../media/store';
import {
  CompareSlider,
  PhotoCanvas,
  PhotoPicker,
  type CanvasPin,
  type Guide
} from '../ui/media';

/* ------------------------------------------------------------------ constants */

/** The six capture tabs on the bench. `condition` is the matching value from
 *  `CAPTURE_CONDITIONS` in the shared media picker, so a photo captured through
 *  the standardised flow lines up with the tab it belongs to. */
const POSES: { key: string; label: string; condition: string; note: string }[] = [
  { key: 'front', label: 'Front', condition: 'Front · neutral', note: 'Lens at eye height, mouth closed, eyes open, no head tilt.' },
  { key: 'left', label: 'Left profile', condition: 'Left profile', note: 'Ear visible, nose pointing right, jaw relaxed.' },
  { key: 'right', label: 'Right profile', condition: 'Right profile', note: 'Mirror of the left shot — same distance and height.' },
  { key: 'three-quarter', label: 'Three-quarter', condition: 'Three-quarter', note: 'Head turned roughly 45°, not more.' },
  { key: 'neutral', label: 'Neutral', condition: 'Relaxed', note: 'Deliberately unposed: no talking-head tension, no held expression.' },
  { key: 'smiling', label: 'Smiling', condition: 'Smiling', note: 'Your real smile. A smile changes face height, spacing and lip display — that is information, not a flaw.' }
];

interface GuideLine {
  id: string;
  label: string;
  /** default starting position, percent of the frame. A starting value only —
   *  the sliders underneath exist because the app cannot see the photo. */
  at: number;
}
interface GuideGroup {
  key: string;
  label: string;
  why: string;
  lines: GuideLine[];
}

const GUIDE_GROUPS: GuideGroup[] = [
  {
    key: 'thirds',
    label: 'Facial thirds',
    why: 'Three horizontal rules used to divide the face vertically: hairline to brow, brow to nose base, nose base to chin.',
    lines: [
      { id: 'thirds-1', label: 'Hairline boundary', at: 20 },
      { id: 'thirds-2', label: 'Brow line', at: 39 },
      { id: 'thirds-3', label: 'Nose base', at: 58 }
    ]
  },
  {
    key: 'fifths',
    label: 'Facial fifths',
    why: 'Four vertical rules across the face width, conventionally one-fifth of the face per zone.',
    lines: [
      { id: 'fifths-1', label: 'Outer left edge', at: 24 },
      { id: 'fifths-2', label: 'Left nostril edge', at: 40 },
      { id: 'fifths-3', label: 'Right nostril edge', at: 56 },
      { id: 'fifths-4', label: 'Outer right edge', at: 72 }
    ]
  },
  {
    key: 'eyeline',
    label: 'Eye line',
    why: 'A single horizontal rule through the pupils — the reference height most other vertical claims are measured against.',
    lines: [{ id: 'eyeline', label: 'Pupil line', at: 44 }]
  },
  {
    key: 'browline',
    label: 'Brow line',
    why: 'Where the brows actually sit, which varies far more than the internet claims.',
    lines: [{ id: 'browline', label: 'Brow line', at: 36 }]
  },
  {
    key: 'jawline',
    label: 'Jaw line',
    why: 'A horizontal reference at the lower jaw border, useful for comparing shots of the same person over time.',
    lines: [{ id: 'jawline', label: 'Jaw border', at: 74 }]
  },
  {
    key: 'symmetry',
    label: 'Symmetry axis',
    why: 'One vertical rule down the midline. Place it on your own philtrum, not on the centre of the frame.',
    lines: [{ id: 'symmetry', label: 'Midline', at: 50 }]
  }
];

/** Every guide line flattened, keyed by id, for position lookups. */
const ALL_LINES: Record<string, GuideLine> = {};
for (const g of GUIDE_GROUPS) for (const l of g.lines) ALL_LINES[l.id] = l;

const PROVENANCE: { value: string; label: string; hint: string }[] = [
  { value: 'measured', label: 'What I measured', hint: 'A number you took yourself with a real instrument or a ruler on a printout. Glow Lab owns no measuring device — if you did not do it, it does not go here.' },
  { value: 'observed', label: 'What I observed', hint: 'Something you can see in the photograph or in the mirror, described in words. No number, no verdict.' },
  { value: 'professional', label: 'What a professional said', hint: 'Attributed speech from a dentist, dermatologist, optician, stylist or doctor. Record who and when in the note itself.' }
];

const REACTIONS: { value: ObservationRow['reaction']; label: string }[] = [
  { value: 'none', label: 'No reaction' },
  { value: 'good', label: 'Positive / liked it' },
  { value: 'bad', label: 'Negative / disliked it' },
  { value: 'irritation', label: 'Irritation' },
  { value: 'breakout', label: 'Breakout' },
  { value: 'unknown', label: 'Cannot tell yet' }
];

interface FeatureStudy {
  key: string;
  label: string;
  pose: string;
  describes: string;
  observe: string;
  method: string;
  caveat: string;
}

/**
 * Feature education — spec §6.2. Original prose written for this app. Nothing
 * here is a diagnosis, a score, or a claim that any ratio is a standard.
 */
const FEATURES: FeatureStudy[] = [
  {
    key: 'thirds',
    label: 'Vertical thirds',
    pose: 'Front',
    describes: 'How the face divides from the hairline to the chin into an upper, middle and lower zone. It is a way of describing where length sits, not a ranking.',
    observe: 'Turn on Facial thirds, then slide each rule onto your own hairline, brow line and nose base. The chin is the fourth boundary — drop a marker on it. Look at whether the three gaps look roughly equal to you, and write down what you actually see.',
    method: 'Straight-edge overlay on a front photograph taken at eye height. Uncertainty is high: hairline position moves with age and hairline shape is inherited, and a tilted head or a wide-angle phone lens at 30cm changes apparent lengths by more than most people’s whole discussion of the topic.',
    caveat: 'The “ideal” one-to-one-to-one third is a classical drawing convention, not a medical standard. Faces that fall well outside it belong to the majority of humanity.'
  },
  {
    key: 'fifths',
    label: 'Horizontal fifths',
    pose: 'Front',
    describes: 'How the face divides across its width into five roughly equal vertical zones, bounded by the outer corners of the eyes and the outer edges of the nostrils.',
    observe: 'Turn on Facial fifths and place the two outer rules on the outer eye corners. Then place the two inner rules on the outer nostril edges. The inner zone is the nose width; the middle two are the eyes; the outer two are the temple space.',
    method: 'Same overlay logic as thirds. Uncertainty: face width and eye spacing are only comparable when the head is square to the lens, so a three-quarter or a selfie held too close will misreport it.',
    caveat: 'The five-equal-zones rule is a proportion sketch used by portrait artists. It carries no health meaning and no attractiveness ranking.'
  },
  {
    key: 'symmetry',
    label: 'Left–right symmetry',
    pose: 'Front',
    describes: 'How closely the two halves of a face match. Every face is asymmetric; the interesting question is only which side and by how much, and whether it matters to you.',
    observe: 'Place the symmetry axis on your own midline — philtrum, cupid’s bow, chin tip. Then look at brow height, eye opening and mouth corner against that single rule. Note which differences are structural and which are just the expression you happened to hold.',
    method: 'Visual comparison against one drawn midline. Uncertainty is significant: a chew-side habit, a resting head tilt, lighting from one side, and the mirroring convention of front cameras all shift apparent symmetry between two photos of the same person.',
    caveat: 'A face that photographs asymmetric is not a defective face. Sudden asymmetry — one side drooping, an inability to close an eye — is a medical event, not an aesthetic note: seek care immediately.'
  },
  {
    key: 'proportions',
    label: 'Feature proportions',
    pose: 'Front',
    describes: 'The size relationships between features — eye to mouth, nose to cheek, lip to chin — rather than any single feature on its own.',
    observe: 'Drop markers on the four points you care about, then read the percent coordinates the bench records for each. Two photos of yourself at different distances will give different numbers: that is lens magnification, and it is the reason this app records distance.',
    method: 'Marker coordinates recorded as percentages of the frame. Uncertainty: these coordinates describe pixels in your photograph, not anatomical measurements of your face, and the app cannot correct for focal length.',
    caveat: 'Proportion talk is where most of the invented “ratios” come from. Treat any precise-sounding universal ratio you find online as an opinion until you can see the population data behind it.'
  },
  {
    key: 'harmony',
    label: 'Harmony',
    pose: 'Front',
    describes: 'A word people use when features read as belonging together. It is real as a perception and impossible to measure, which is exactly why it gets abused.',
    observe: 'Write what you actually respond to in your own photo: the softness or sharpness of a transition, the amount of whitespace around the eyes, how a hairstyle continues a line. Keep it descriptive.',
    method: 'There is no method and no instrument. Glow Lab records your sentence and produces no number for it, ever.',
    caveat: 'Any tool that hands you a harmony score has made it up. This one declines to.'
  },
  {
    key: 'eye-shape',
    label: 'Eye shape',
    pose: 'Front',
    describes: 'The outline of the eye opening: how much of the iris is covered, the angle of the outer corner, the crease pattern, the lid space above and below.',
    observe: 'Look at both eyes in the same frame, straight on. Note whether the outer corner sits above or below the inner corner, and whether the upper lid covers the top of the iris. Then look again in the Smiling tab — the lower lid rises and the whole shape changes.',
    method: 'Front photograph at eye height. Uncertainty: hooded lids, lash coverage and lighting change the apparent shape shot to shot; a lens below eye height makes the eye read rounder than it is.',
    caveat: 'Epicanthic folds, monolids and deep-set eyes are ordinary human variation with a documented genetic basis, not deviations needing correction.'
  },
  {
    key: 'eye-spacing',
    label: 'Eye spacing',
    pose: 'Front',
    describes: 'The distance between the inner corners of the eyes relative to the width of the face and the distance from eye to temple.',
    observe: 'Turn on the symmetry axis and the eye line together. Read where the inner corners sit relative to the nose edges, and note the intercanthal distance as a proportion of the whole face width.',
    method: 'Requires a squared front shot at 1m or more, or a printout. Uncertainty: a phone lens at 30cm exaggerates whatever is nearest the lens, which is the nose, and pushes the apparent spacing out of true.',
    caveat: 'Genuinely unusual spacing is usually a reason a clinician looks for associated findings — it is not an appearance problem to be fixed with makeup, whatever the internet implies.'
  },
  {
    key: 'brows',
    label: 'Brow position and shape',
    pose: 'Front',
    describes: 'Where the brow hair sits relative to the orbital rim, its arch position, its tail length and its density gradient from head to tail.',
    observe: 'Compare the brow line rule against the eye line rule on each side. Then read the natural arch: is it above, below or level with the outer corner of the eye?',
    method: 'Front and three-quarter shots. Uncertainty: grooming history, camera height, and the fact that brows genuinely differ from each other — usually the tail of one sits lower, and that asymmetry is normal.',
    caveat: 'Brow position is largely skeletal and set in adulthood. Temporary mapping and grooming change appearance; no cream, tape or exercise relocates a brow.'
  },
  {
    key: 'nose',
    label: 'Nose',
    pose: 'Left profile',
    describes: 'The dorsal line, the tip rotation, the length of the columella and the width at the alar base — four separate things that get discussed as one.',
    observe: 'Open the profile tabs. Trace the dorsal line visually from the radix down. Compare the two profiles: they should look similar, and if they do not, that is a rotation or asymmetry note, not a defect note.',
    method: 'A true profile needs the lens exactly at eye height and perpendicular to the face; anything else foreshortens the nose. Uncertainty here is the largest on this page.',
    caveat: 'Nose shape is the most culturally coded feature in appearance talk, and the photographic evidence people judge themselves from is the least reliable kind there is.'
  },
  {
    key: 'lips',
    label: 'Lips',
    pose: 'Front',
    describes: 'Vermilion height of the upper and lower lip, the definition of the border, the philtrum length above and the lip show at rest.',
    observe: 'In the neutral tab, note how much of the lip is visible when the mouth is closed and whether the teeth show. In the smiling tab, note how much the display changes.',
    method: 'Front at rest plus smiling. Uncertainty: hydration, time of day and whether the photo was taken after eating all move apparent lip volume within a single day.',
    caveat: 'Lip volume decreases naturally with age for everyone. That is a timeline, not a problem statement.'
  },
  {
    key: 'chin',
    label: 'Chin projection',
    pose: 'Left profile',
    describes: 'How far the chin sits forward relative to the lips in a profile view, and how much vertical length it contributes to the lower face.',
    observe: 'Put a marker on the softest point of the lower lip and one on the chin tip in the profile tab. Read the coordinates and describe the relationship in words.',
    method: 'Requires a true profile. Uncertainty: head position changes it — a chin tucked toward the chest reduces apparent projection, so record whether the head was level.',
    caveat: 'A weak-looking chin on a photograph is frequently a posture or lens artefact. Anyone considering a permanent change should be assessed by a clinician in person, not by a photo.'
  },
  {
    key: 'jawline',
    label: 'Jawline and gonial angle',
    pose: 'Three-quarter',
    describes: 'The visible border from chin to ear, the angle at the back of the jaw, and how much of that border is skin, muscle or fat.',
    observe: 'Compare the front, three-quarter and profile tabs of the same day. A border that is sharp in one and soft in another is usually about lighting direction and hydration, not about the jaw.',
    method: 'Raking light from one side makes a border visible that flat frontal light erases — so record the lighting field honestly. Uncertainty: high, and it moves day to day.',
    caveat: 'A visibly defined jaw border is largely a body-fat and genetics question. Chewing devices, jaw “exercisers” and strapping are unvalidated and can damage the joint — see the Evidence entry on unverified devices.'
  },
  {
    key: 'cheekbones',
    label: 'Cheekbones and midface fullness',
    pose: 'Three-quarter',
    describes: 'Where the malar bone sits, how much soft tissue covers it, and how the transition from cheek to hollow reads in the light.',
    observe: 'In the three-quarter tab, look for the highest point of light on the cheek and where the hollow begins under the jaw border.',
    method: 'Light-dependent. Uncertainty: a smile lifts the whole midface, so compare only like with like.',
    caveat: 'Malar fullness is bone plus fat pad plus lighting. Contour placement changes its appearance for a day; nothing you can apply at home changes its structure.'
  },
  {
    key: 'midface',
    label: 'Midface length',
    pose: 'Front',
    describes: 'The vertical distance between the eye line and the mouth, which is what people mean when they say a face looks “long in the middle”.',
    observe: 'Set the eye line and drop a marker at the mouth. Read the gap as a fraction of the total face height you marked in the thirds exercise.',
    method: 'Front, squared, at distance. Uncertainty: brow position and lip show both change the perceived midface length without the skeleton moving at all.',
    caveat: 'Eyewear, fringe placement and beard length alter apparent midface length more than most surgical options — which is why styling gets tried first here.'
  },
  {
    key: 'profile',
    label: 'Profile line',
    pose: 'Left profile',
    describes: 'The silhouette from forehead to chin, including how the lips relate to an imaginary line from nose to chin.',
    observe: 'Open both profile tabs and compare them to each other first. Then describe the lip position relative to nose and chin in your own words.',
    method: 'Needs the camera level and the head neutral, with the ears aligned. Uncertainty: two photos taken minutes apart can differ enough to reverse the reading.',
    caveat: 'The “E-line” is a mid-twentieth-century orthodontic drawing aid. It was never a health threshold and it was never universal across populations.'
  },
  {
    key: 'skin-texture',
    label: 'Skin texture and tone',
    pose: 'Front',
    describes: 'Pore visibility, surface roughness, marks, redness and evenness of tone — the qualities that change most with light, and therefore most with photography.',
    observe: 'Compare the front tab under two different recorded lighting values. Note what disappears when the light goes flat, and what stays.',
    method: 'The only reliable self-method is repeated photography under recorded conditions over weeks. Uncertainty: single-flash or window-side photos exaggerate texture.',
    caveat: 'Texture is not a hygiene failure. A persistent changing lesion, a non-healing spot or new asymmetrical pigmentation is a dermatology appointment, not an aesthetic note.'
  },
  {
    key: 'balance',
    label: 'Overall balance',
    pose: 'Front',
    describes: 'A summary impression of how the zones and features sit together across a whole face, including how hair, brows, glasses and beard carry the eye around it.',
    observe: 'Write a paragraph. Then read back which parts of the paragraph are actually visible in this photo and which are memory of how you feel on the day.',
    method: 'None that is measurable. Recorded as your note with your name on it and no numeric value attached.',
    caveat: 'This department exists to help you see yourself clearly and choose deliberately. It produces no score, no verdict and no ranking of your face — by design.'
  }
];

const FIXED_CAVEAT =
  'Contested internet ratios are not medical standards. The numbers that circulate in appearance forums are drawing conventions or small-study averages, restated without their error bars. Where a rule below is attributed to a source, that source is described honestly — and Glow Lab never converts a ratio into a verdict about you.';

/* --------------------------------------------------------------- persistence */

/**
 * Debounced write-behind for free text and coordinates. Local state stays
 * instant, the row lands in IndexedDB ~400ms later, and an unmount flush makes
 * sure nothing typed is lost.
 */
function useCommit<T>(value: T, save: (v: T) => void, ms = 400) {
  const [draft, setDraft] = useState<T>(value);
  const dirty = useRef(false);
  const latest = useRef(draft);
  const saveRef = useRef(save);
  latest.current = draft;
  saveRef.current = save;

  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);

  useEffect(() => {
    if (draft === value) {
      dirty.current = false;
      return;
    }
    dirty.current = true;
    const t = setTimeout(() => {
      dirty.current = false;
      saveRef.current(draft);
    }, ms);
    return () => clearTimeout(t);
  }, [draft, value, ms]);

  useEffect(
    () => () => {
      if (dirty.current) saveRef.current(latest.current);
    },
    []
  );

  return [draft, setDraft] as const;
}

function CommitArea({
  label,
  value,
  onSave,
  placeholder,
  rows = 3,
  hint
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  rows?: number;
  hint?: string;
}) {
  const [draft, setDraft] = useCommit(value, (v) => onSave(String(v)));
  return (
    <Field label={label} hint={hint}>
      <TextArea value={String(draft)} onChange={(v) => setDraft(v)} placeholder={placeholder} rows={rows} />
    </Field>
  );
}

function CommitLine({
  label,
  value,
  onSave,
  placeholder,
  hint
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  const [draft, setDraft] = useCommit(value, (v) => onSave(String(v)));
  return (
    <Field label={label} hint={hint}>
      <TextInput value={String(draft)} onChange={(v) => setDraft(v)} placeholder={placeholder} />
    </Field>
  );
}

/* ------------------------------------------------------------------- helpers */

const pinsOf = (m: AnyRow | undefined | null): CanvasPin[] => {
  const raw = (m?.data?.pins as CanvasPin[]) ?? [];
  return raw.filter((p) => p && typeof p.x === 'number' && typeof p.y === 'number');
};
const guidesOf = (m: AnyRow | undefined | null): string[] => ((m?.data?.guides as string[]) ?? []).filter((k) => GUIDE_GROUPS.some((g) => g.key === k));
const posOf = (m: AnyRow | undefined | null): Record<string, number> => (m?.data?.guidePos as Record<string, number>) ?? {};

function guidesFor(item: AnyRow | undefined | null): Guide[] {
  const on = guidesOf(item);
  const pos = posOf(item);
  const out: Guide[] = [];
  for (const g of GUIDE_GROUPS) {
    if (!on.includes(g.key)) continue;
    for (const l of g.lines) {
      const isV = l.id.startsWith('fifths') || l.id === 'symmetry';
      out.push({ type: isV ? 'v' : 'h', at: pos[l.id] ?? l.at, label: l.label });
    }
  }
  return out;
}

/** Honest difference report between two stored shots, built only from recorded
 *  fields. Nothing inferred. The four comparable capture fields come from the
 *  shared guide diff (so the bench and the capture guide can never disagree);
 *  the date and the pixel size are added here because a legitimate
 *  before/after pair is *expected* to differ in both. */
function conditionDifferences(a: AnyRow | undefined | null, b: AnyRow | undefined | null) {
  const rows: { k: string; a: string; b: string; same: boolean }[] = conditionRows(a, b).map((r) => ({
    k: r.label,
    a: r.from,
    b: r.to,
    same: r.same
  }));
  const extra = (k: string, x: unknown, y: unknown) => {
    const xs = String(x ?? '').trim();
    const ys = String(y ?? '').trim();
    return { k, a: xs || NOT_RECORDED, b: ys || NOT_RECORDED, same: Boolean(xs) && xs === ys };
  };
  return [
    ...rows,
    extra('Taken on', a?.takenOn, b?.takenOn),
    extra('Width × height', a && b ? `${a.width}×${a.height}` : '', b && a ? `${b.width}×${b.height}` : '')
  ];
}

/** Newest first by the recorded capture date, ids breaking ties deterministically. */
const byNewestShot = (a: AnyRow, b: AnyRow) =>
  String(b.takenOn ?? '').localeCompare(String(a.takenOn ?? '')) || String(b.id).localeCompare(String(a.id));

/* ---------------------------------------------------------------------- page */

export default function FacePage() {
  const toast = useToast();
  const media = useRows(TABLES.mediaItems);
  const observations = useRows(TABLES.observations);
  const experiments = useRows(TABLES.experiments, { includeDeleted: true });
  const techniques = useRows(TABLES.techniques);
  const knowledge = useRows(TABLES.knowledge);
  const goals = useRows(TABLES.goals);

  const [tab, setTab] = useState('bench');
  const [pose, setPose] = useState(POSES[0].label);
  const [shotId, setShotId] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ before: string; after: string }>({ before: '', after: '' });
  const [obsFor, setObsFor] = useState<string | null>(null);
  const [livePins, setLivePins] = useState<CanvasPin[]>([]);

  const faceMedia = useMemo(() => media.filter((m) => m.linkedDomain === 'face' || POSES.some((p) => p.label === m.pose)), [media]);
  const poseShots = useMemo(() => faceMedia.filter((m) => m.pose === pose || m.conditions === POSES.find((p) => p.label === pose)?.condition), [faceMedia, pose]);
  const shot = useMemo(() => poseShots.find((m) => m.id === shotId) ?? poseShots[0] ?? null, [poseShots, shotId]);

  /** What the next capture is measured against: the most recent baseline row
   *  filed under this pose (or labelled with its condition set). Same rows the
   *  bench already loads — no extra query, no new table read. */
  const referenceShot = useMemo(() => {
    const condition = POSES.find((p) => p.label === pose)?.condition ?? '';
    return media
      .filter((m) => m.kind === 'baseline' && !m.deletedAt && (m.pose === pose || m.conditions === condition))
      .sort(byNewestShot)[0] ?? null;
  }, [media, pose]);
  const referenceSrc = useImageSrc(referenceShot, 'full');

  const before = media.find((m) => m.id === compare.before) ?? null;
  const after = media.find((m) => m.id === compare.after) ?? null;
  const diffs = conditionDifferences(before, after);
  const mismatch = diffs.filter((d) => !d.same && d.k !== 'Taken on' && d.k !== 'Width × height');

  const faceObservations = observations.filter((o) => o.subjectType === 'face-feature');
  const savedSets = knowledge.filter((k) => k.domain === 'face' && k.kind === 'reference');

  const styleTechniques = techniques.filter((t) => (t.domain === 'face' || t.domain === 'makeup') && techniqueIsRecommendable(t as any));
  const excludedTechniques = techniques.filter((t) => (t.domain === 'face' || t.domain === 'makeup') && !techniqueIsRecommendable(t as any));

  /* ------------------------------------------------------------- writes */

  const writeMedia = (m: AnyRow, patch: Record<string, unknown>) => void saveRow(TABLES.mediaItems, { id: m.id, ...patch });
  const writeData = (m: AnyRow, dataPatch: Record<string, unknown>) =>
    void saveRow(TABLES.mediaItems, { id: m.id, data: { ...(m.data ?? {}), ...dataPatch } });

  const onCapture = (rows: AnyRow[], poseLabel: string) => {
    const condition = POSES.find((p) => p.label === poseLabel)?.condition ?? '';
    for (const r of rows) {
      // PhotoPicker records conditions/lighting/distance. The bench owns the
      // pose filing and the domain link, so the same photo can be re-shot for
      // another pose without losing either record.
      void saveRow(TABLES.mediaItems, {
        id: r.id,
        pose: poseLabel,
        linkedDomain: 'face',
        linkedIds: [],
        data: { ...(r.data ?? {}), pins: [], guides: [], guidePos: {}, captureCondition: condition }
      });
    }
    if (rows[0]) {
      setShotId(rows[0].id);
      toast(`${rows.length} photograph${rows.length > 1 ? 's' : ''} filed under ${poseLabel}.`, 'ok');
    }
  };

  const toggleGuide = (key: string) => {
    if (!shot) return;
    const on = guidesOf(shot);
    writeData(shot, { guides: on.includes(key) ? on.filter((k) => k !== key) : [...on, key] });
  };

  const setLinePos = (lineId: string, at: number) => {
    if (!shot) return;
    writeData(shot, { guidePos: { ...posOf(shot), [lineId]: at } });
  };

  /** Marker writes are batched: dragging a dot fires continuously, so the canvas
   *  state updates instantly and the row is written ~350ms after the last move.
   *  A shot change or unmount flushes whatever is pending — no lost work. */
  const shotRef = useRef<AnyRow | null>(null);
  shotRef.current = shot;
  const pending = useRef<{ timer: ReturnType<typeof setTimeout> | null; pins: CanvasPin[] | null }>({ timer: null, pins: null });

  const flushPins = () => {
    const m = shotRef.current;
    if (pending.current.timer) {
      clearTimeout(pending.current.timer);
      pending.current.timer = null;
    }
    if (!m || !pending.current.pins) return;
    const pins = pending.current.pins;
    pending.current.pins = null;
    void saveRow(TABLES.mediaItems, { id: m.id, data: { ...(m.data ?? {}), pins } });
  };

  const setPins = (pins: CanvasPin[], immediate = false) => {
    setLivePins(pins);
    pending.current.pins = pins;
    if (pending.current.timer) clearTimeout(pending.current.timer);
    if (immediate) flushPins();
    else pending.current.timer = setTimeout(flushPins, 350);
  };

  useEffect(() => {
    setLivePins(shot ? pinsOf(shot) : []);
    return () => flushPins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot?.id]);

  const movePin = (id: string, x: number, y: number) => {
    setPins(livePins.map((p) => (p.id === id ? { ...p, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 } : p)));
  };

  const [newPinLabel, setNewPinLabel] = useState('');
  const [newPinNote, setNewPinNote] = useState('');

  const addPin = () => {
    if (!shot) return;
    const label = newPinLabel.trim() || `Marker ${livePins.length + 1}`;
    const pin: CanvasPin = { id: newId('pin'), x: 50, y: 50, label, note: newPinNote.trim() };
    setPins([...livePins, pin], true);
    setNewPinLabel('');
    setNewPinNote('');
    toast(`“${label}” added at the centre of the frame — drag it, or type its coordinates.`, 'ok');
  };

  const removePin = (id: string) => setPins(livePins.filter((p) => p.id !== id), true);

  const savePinEdit = (next: CanvasPin) => setPins(livePins.map((p) => (p.id === next.id ? next : p)), true);

  /* -------------------------------------------------------- saved analysis */

  const [saveTitle, setSaveTitle] = useState('');
  const [saveNotes, setSaveNotes] = useState('');

  const saveAnalysis = () => {
    if (!shot) {
      toast('Nothing to save yet — the bench needs a photograph on it.', 'bad');
      return;
    }
    const title = saveTitle.trim() || `${shot.title || 'Untitled'} — ${pose} analysis`;
    void saveRow(TABLES.knowledge, {
      id: newId('know'),
      title,
      kind: 'reference',
      domain: 'face',
      body: saveNotes.trim() || 'No written note was added. The saved entry records the photograph, the guide rules that were switched on and the marker coordinates as they stood at save time.',
      confidence: 3,
      worked: 'unset',
      linkedGoalIds: [],
      linkedTechniqueIds: [],
      linkedProductIds: [],
      linkedExperimentIds: [],
      tags: ['face', 'analysis'],
      data: {
        snapshot: {
          mediaId: shot.id,
          pose,
          pins: pinsOf(shot),
          guides: guidesOf(shot),
          guidePos: posOf(shot),
          conditions: shot.conditions ?? '',
          lighting: shot.lighting ?? '',
          distance: shot.distance ?? '',
          takenOn: shot.takenOn ?? '',
          savedOn: todayISO()
        }
      }
    });
    setSaveNotes('');
    setSaveTitle('');
    toast('Analysis set stored. It can be re-opened below and re-applied to the photo.', 'ok');
  };

  const applySnapshot = (k: AnyRow) => {
    const snap = k.data?.snapshot as { mediaId?: string; pins?: CanvasPin[]; guides?: string[]; guidePos?: Record<string, number> } | undefined;
    if (!snap?.mediaId) {
      toast('This entry has no photograph attached, so there is nothing to re-open.', 'bad');
      return;
    }
    const m = media.find((x) => x.id === snap.mediaId);
    if (!m) {
      toast('The photograph this analysis was taken from is no longer in your library.', 'bad');
      return;
    }
    if (m.pose) setPose(String(m.pose));
    setShotId(m.id);
    writeData(m, { pins: snap.pins ?? [], guides: snap.guides ?? [], guidePos: snap.guidePos ?? {} });
    setTab('bench');
    toast('Re-opened: guides, rule positions and markers written back onto the photograph record.', 'ok');
  };

  /* ------------------------------------------------------------ comparison */

  const compareOptions = faceMedia.map((m) => ({ value: m.id, label: `${m.title || 'Untitled'} · ${m.pose || 'pose not set'} · ${formatDate(String(m.takenOn ?? ''))}` }));

  /* ------------------------------------------------------------------ render */

  const TABS = [
    { key: 'bench', label: 'Photo bench' },
    { key: 'compare', label: 'Before / after' },
    { key: 'study', label: 'Feature study' },
    { key: 'observations', label: 'Observations' },
    { key: 'experiments', label: 'Experiments' },
    { key: 'history', label: 'Analysis history' },
    { key: 'styling', label: 'Styling opportunities' }
  ];

  return (
    <div className="gl-page fa-page">
      <DeptIntro
        id="face"
        deck="Standardised photography, guide rules you position yourself, labelled markers, and a study index that explains what each feature actually is. There is no face reader here — no landmark detection, no ratio verdict, no score."
        actions={
          <>
            <Button variant="primary" onClick={() => setTab('bench')}>
              <ScanFace size={14} /> Open the bench
            </Button>
            <Button onClick={() => setTab('study')}>Feature study</Button>
            <Link className="gl-btn gl-btn--ghost" to="/evidence">
              Evidence library
            </Link>
          </>
        }
        meta={[
          { label: 'Photographs filed', value: String(faceMedia.length) },
          { label: 'Poses covered', value: `${POSES.filter((p) => faceMedia.some((m) => m.pose === p.label)).length} of ${POSES.length}` },
          { label: 'Observations', value: String(faceObservations.filter((o) => !o.deletedAt).length) },
          { label: 'Analysis produced', value: 'None — by design' }
        ]}
      >
        <p className="gl-tech fa-intro-status">
          {shot ? `On the bench: ${String(shot.title || 'Untitled')} · ${pose} · ${String(shot.conditions || 'condition not recorded')}` : 'The bench is empty. Capture a standardised photograph to begin.'}
        </p>
      </DeptIntro>

      <StatStrip
        items={[
          { label: 'Landmark detection', value: 'none', hint: 'no vision model in this app' },
          { label: 'Guide rules', value: `${GUIDE_GROUPS.length} sets`, hint: 'positions set by you' },
          { label: 'Markers stored', value: String(livePins.length), hint: shot ? 'on this photograph' : 'no photo selected' },
          { label: 'Measurements', value: 'only what you enter', hint: 'labelled by source' }
        ]}
      />

      <div className="gl-tabs fa-tabs" role="tablist" aria-label="Facial Aesthetics Lab sections">
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

      {tab === 'bench' ? (
        <div className="fa-editorial">
          <div>
            <Card>
              <CardHead
                title="Capture bench"
                eyebrow="Section 01"
                sub="Six poses. Each photograph is filed with the conditions you recorded when you shot it."
                right={
                  <Chip tone="info">
                    {POSES.find((p) => p.label === pose)?.note ?? ''}
                  </Chip>
                }
              />
              <div className="gl-tabs fa-poses" role="tablist" aria-label="Pose">
                {POSES.map((p) => {
                  const n = faceMedia.filter((m) => m.pose === p.label).length;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      role="tab"
                      aria-selected={pose === p.label}
                      className={`gl-tab ${pose === p.label ? 'gl-btn--gold' : ''}`}
                      onClick={() => {
                        setPose(p.label);
                        setShotId(null);
                      }}
                    >
                      {p.label}
                      <span className="gl-tech fa-poses__n">{n}</span>
                    </button>
                  );
                })}
              </div>
              <PhotoPicker
                label={`Capture or import for “${pose}”`}
                kind="baseline"
                album={`Face — ${pose}`}
                withConditions
                standard
                reference={referenceShot ? { row: referenceShot, src: referenceSrc, pose } : null}
                onPick={(rows) => onCapture(rows, pose)}
              />
              <p className="gl-small gl-faint">
                The condition picker writes straight into the photograph record: pose, condition, lighting, distance and date. Those five fields are what make a
                later comparison honest, and they are also what a casual selfie cannot guarantee.
              </p>
              {poseShots.length > 1 ? (
                <div className="fa-shotline">
                  <span className="gl-label">Filed under {pose}</span>
                  {poseShots.map((m) => (
                    <button key={m.id} type="button" className="fa-shot" data-on={m.id === shot?.id} onClick={() => setShotId(m.id)}>
                      <span>{String(m.title || 'Untitled')}</span>
                      <span className="gl-tech">
                        {formatDate(String(m.takenOn ?? ''))} · {String(m.lighting || 'lighting not set')} · {String(m.distance || 'distance not set')}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {!faceMedia.length ? (
                <EmptyPlate
                  kicker="Nothing stored"
                  title="The bench is empty, and Glow Lab will not put a stock face on it"
                  body="Every guide rule, marker and observation on this page needs your own photograph to be worth anything. Capture one above — the conditions form takes about fifteen seconds and is the only thing that makes a future comparison mean something."
                  action={<Chip tone="info">Photos stay on this device, marked private.</Chip>}
                />
              ) : null}
            </Card>

            <Card>
              <CardHead
                title="Canvas"
                eyebrow="Section 02"
                sub="Zoom, pan and rotate are for reading the photograph. The rules are drawn from your slider positions, never detected."
                right={shot ? <Chip tone="gold">{String(shot.title || 'Untitled')}</Chip> : <Chip tone="limited">no photograph</Chip>}
              />
              <PhotoCanvas item={shot} guides={guidesFor(shot)} pins={livePins} onMovePin={movePin} height={480} overlaysOffLabel="No rules switched on" />
              {!shot ? (
                <p className="gl-small gl-faint" style={{ marginTop: 'var(--glow-sp-3)' }}>
                  Not measured — no analysis available. The canvas needs one of your photographs before a rule or marker can be placed on anything.
                </p>
              ) : null}
              <div className="fa-caption">
                <CommitLine label="Title" value={String(shot?.title ?? '')} onSave={(v) => shot && writeMedia(shot, { title: v })} placeholder="e.g. Baseline — April, window light" />
                <CommitArea
                  label="Caption — what is true about this shot"
                  value={String(shot?.caption ?? '')}
                  onSave={(v) => shot && writeMedia(shot, { caption: v })}
                  placeholder="Anything that affected the frame: after a flight, no sleep, new glasses, harsh top light."
                  rows={2}
                />
              </div>
              {shot ? (
                <div className="gl-grid gl-grid--2">
                  <Field label="Pose filed as" hint="Change it if the photograph was shot for a different angle — the record follows what you set here.">
                    <Select value={String(shot.pose ?? pose)} onChange={(v) => writeMedia(shot, { pose: v })} options={POSES.map((p) => ({ value: p.label, label: p.label }))} />
                  </Field>
                  <CommitLine label="Condition recorded" value={String(shot.conditions ?? '')} onSave={(v) => writeMedia(shot, { conditions: v })} placeholder="e.g. Front · neutral" />
                  <CommitLine label="Lighting recorded" value={String(shot.lighting ?? '')} onSave={(v) => writeMedia(shot, { lighting: v })} placeholder="e.g. Window light" />
                  <CommitLine label="Distance recorded" value={String(shot.distance ?? '')} onSave={(v) => writeMedia(shot, { distance: v })} placeholder="e.g. 1m+" />
                </div>
              ) : null}
            </Card>
          </div>

          <aside className="gl-rule-col fa-rail">
            <div className="fa-railblock">
              <span className="gl-eyebrow">Guide rules</span>
              <p className="gl-small gl-faint">
                Six rule sets, each drawn at a position you set. They start at a conventional place on the frame and are wrong for your photo until you move them —
                that is deliberate, because nothing here can see your face.
              </p>
              {GUIDE_GROUPS.map((g) => {
                const on = shot ? guidesOf(shot).includes(g.key) : false;
                const pos = posOf(shot);
                return (
                  <div className="fa-guide" key={g.key} data-on={on}>
                    <Toggle checked={on} onChange={() => toggleGuide(g.key)} label={g.label} hint={g.why} />
                    {on
                      ? g.lines.map((l) => (
                          <div className="fa-guide__line" key={l.id}>
                            <Range
                              label={l.label}
                              value={Math.round(pos[l.id] ?? l.at)}
                              min={2}
                              max={98}
                              onChange={(v) => setLinePos(l.id, v)}
                              format={(v) => `${v}% of frame — set by you`}
                            />
                          </div>
                        ))
                      : null}
                  </div>
                );
              })}
              {!shot ? <p className="gl-small gl-faint">Switching rules on needs a photograph selected: the positions are stored per photograph.</p> : null}
            </div>

            <div className="fa-railblock">
              <span className="gl-eyebrow">Markers</span>
              <p className="gl-small gl-faint">
                Drag a dot on the canvas, or use the coordinate fields — both write the same record. Coordinates are percentages of the frame, not millimetres of
                your face.
              </p>
              <div className="gl-grid gl-grid--2">
                <Field label="New marker label" hint="Appears on the canvas dot as its title.">
                  <TextInput value={newPinLabel} onChange={setNewPinLabel} placeholder="e.g. Chin tip" />
                </Field>
                <Field label="New marker note" hint="Optional — stored with the coordinates.">
                  <TextInput value={newPinNote} onChange={setNewPinNote} placeholder="What this point marks" />
                </Field>
              </div>
              <Button onClick={addPin} disabled={!shot} block>
                <Plus size={14} /> Add marker{shot ? '' : ' (no photograph)'}
              </Button>
              {livePins.length ? (
                <ul className="fa-pinlist">
                  {livePins.map((p) => (
                    <li className="fa-pin" key={p.id}>
                      <PinEditor pin={p} onSave={savePinEdit} onDelete={() => removePin(p.id)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="gl-small gl-faint">No markers on this photograph yet.</p>
              )}
              {shot ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPins([], true)}
                >
                  <RotateCcw size={13} /> Clear all markers from this photograph
                </Button>
              ) : null}
            </div>

            <div className="fa-railblock">
              <span className="gl-eyebrow">Honest limits</span>
              <SafetyBanner tone="note" title="What this canvas cannot do">
                <ul className="gl-small fa-limits">
                  <li>It cannot find your hairline, brow, nose base or chin. The rules start where conventions say they might be.</li>
                  <li>It cannot convert a marker position into a measurement of your body. Phone lens distortion at 30cm is larger than most of the differences being discussed.</li>
                  <li>It produces no symmetry score, no ratio verdict and no attractiveness number — there is no validated instrument to produce one with.</li>
                </ul>
              </SafetyBanner>
            </div>
          </aside>
        </div>
      ) : null}

      {tab === 'compare' ? (
        <Card>
          <CardHead title="Before / after" eyebrow="Section 03" sub="Two of your own photographs, side by side, with the recording differences stated plainly." />
          <div className="gl-grid gl-grid--2">
            <Field label="Left image" hint="Pick the earlier photograph.">
              <Select
                value={compare.before}
                onChange={(v) => setCompare((c) => ({ ...c, before: v }))}
                options={compareOptions}
                placeholder={compareOptions.length ? 'Choose a photograph' : 'No face photographs stored yet'}
              />
            </Field>
            <Field label="Right image" hint="Pick the later one.">
              <Select
                value={compare.after}
                onChange={(v) => setCompare((c) => ({ ...c, after: v }))}
                options={compareOptions}
                placeholder={compareOptions.length ? 'Choose a photograph' : 'No face photographs stored yet'}
              />
            </Field>
          </div>
          {before || after ? (
            <>
              <CompareSlider
                before={before}
                after={after}
                beforeLabel={before ? `${String(before.title || 'Before')} · ${formatDate(String(before.takenOn ?? ''))}` : 'no image'}
                afterLabel={after ? `${String(after.title || 'After')} · ${formatDate(String(after.takenOn ?? ''))}` : 'no image'}
                height={440}
              />
              <div className="fa-condtable">
                <span className="gl-label">Recorded conditions</span>
                <table className="gl-table">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Left image</th>
                      <th>Right image</th>
                      <th>Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffs.map((d) => (
                      <tr key={d.k}>
                        <td className="gl-small">{d.k}</td>
                        <td className="gl-tech">{d.a}</td>
                        <td className="gl-tech">{d.b}</td>
                        <td>
                          <Chip tone={d.same ? 'strong' : 'limited'}>{d.same ? 'same' : 'differs / not recorded'}</Chip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mismatch.length ? (
                <SafetyBanner tone="warn" title="These two were not shot the same way">
                  <p className="gl-small">
                    Differing: {mismatch.map((d) => `${d.k} (${d.a} vs ${d.b})`).join('; ')}. Differences you see between these images may be the camera, the light
                    or the distance rather than your face. Reshoot both under one recorded condition set before drawing any conclusion — or keep the pair as a
                    record of the day rather than evidence of change.
                  </p>
                </SafetyBanner>
              ) : (
                <SafetyBanner tone="ok" title="Conditions match">
                  <p className="gl-small">
                    Pose, condition, lighting and distance are recorded identically on both files. This is the only comparison on this page worth calling a
                    comparison — and the interval between {formatDate(String(before?.takenOn ?? ''))} and {formatDate(String(after?.takenOn ?? ''))} still matters.
                  </p>
                </SafetyBanner>
              )}
            </>
          ) : (
            <EmptyState title="No pair selected" body="Choose two stored photographs, or capture a standardised pair under the same recorded conditions." />
          )}
          <PullQuote cite="Why the boring fields matter">
            The unglamorous ones — distance, height of the lens, which side the window is on — decide most of what a “progress photo” appears to show. Recording
            them is the whole discipline.
          </PullQuote>
        </Card>
      ) : null}

      {tab === 'study' ? (
        <div className="fa-editorial">
          <div>
            <Card>
              <CardHead
                title="Feature study"
                eyebrow="Section 04"
                sub={`${FEATURES.length} entries. Each says what the feature is, how to look at it on your own photograph, what the method is worth, and where the internet’s numbers come from.`}
              />
              <SafetyBanner tone="note" title="Read this before any of the entries">
                <p className="gl-small">{FIXED_CAVEAT}</p>
              </SafetyBanner>
              <div className="fa-studylist">
                {FEATURES.map((f, i) => (
                  <details className="gl-details fa-study" key={f.key} id={`study-${f.key}`}>
                    <summary>
                      <span className="fa-study__no">{String(i + 1).padStart(2, '0')}</span>
                      <span className="fa-study__name">{f.label}</span>
                      <Chip tone="info">{f.pose}</Chip>
                    </summary>
                    <div className="gl-details__body">
                      <dl className="gl-kv">
                        <dt>What it describes</dt>
                        <dd>{f.describes}</dd>
                        <dt>How to observe it on your own photo</dt>
                        <dd>{f.observe}</dd>
                        <dt>Method and uncertainty</dt>
                        <dd>{f.method}</dd>
                        <dt>Where the popular claim breaks down</dt>
                        <dd>{f.caveat}</dd>
                      </dl>
                      <div className="fa-study__acts">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setPose(f.pose);
                            setShotId(null);
                            setTab('bench');
                            toast(`Bench switched to the ${f.pose} tab.`, 'ok');
                          }}
                        >
                          Open this on the bench
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setObsFor(f.key);
                            setTab('observations');
                          }}
                        >
                          Record an observation about {f.label.toLowerCase()}
                        </Button>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </Card>
          </div>
          <aside className="gl-rule-col fa-rail">
            <div className="fa-railblock">
              <span className="gl-eyebrow">How to use this index</span>
              <p className="gl-small gl-muted">
                Pick one feature, one photograph, one written sentence. Appearance discussion collapses the moment several features get averaged into one
                impression — including your impression of yourself on a bad-sleep day.
              </p>
              <KvList
                items={[
                  { k: 'A description, not a verdict', v: 'Write “the outer corner sits below the inner corner”. Not “wrong”.' },
                  { k: 'One light source', v: 'Compare only photographs recorded under the same lighting value.' },
                  { k: 'Nothing is scored', v: 'There is no number at the end of this index and there never will be.' },
                  { k: 'Health questions go elsewhere', v: 'Pain, lumps, sudden asymmetry, lesions, gum or tooth problems: see a professional via Services.' }
                ]}
              />
              <Link className="gl-btn gl-btn--ghost" to="/services">
                Find a professional consultation
              </Link>
            </div>
          </aside>
        </div>
      ) : null}

      {tab === 'observations' ? (
        <ObservationsPanel
          features={FEATURES}
          observations={faceObservations}
          media={faceMedia}
          preselect={obsFor}
          clearPreselect={() => setObsFor(null)}
        />
      ) : null}

      {tab === 'experiments' ? <ExperimentsPanel experiments={experiments} media={faceMedia} techniques={techniques} goals={goals} /> : null}

      {tab === 'history' ? (
        <Card>
          <CardHead
            title="Analysis history"
            eyebrow="Section 06"
            sub="A saved set is the photograph plus the rules you had switched on, their positions and every marker coordinate. Re-opening writes them back onto the photograph record."
          />
          <div className="gl-grid gl-grid--2">
            <CommitLine label="Save title (optional)" value={saveTitle} onSave={setSaveTitle} placeholder={`${shot?.title || 'Photograph'} — ${pose} analysis`} />
            <div className="gl-inset">
              <span className="gl-label">Stamped with</span>
              <p className="gl-small">
                {formatDate(todayISO())} · {livePins.length} marker(s) · {shot ? guidesOf(shot).length : 0} rule set(s) ·{' '}
                {shot ? String(shot.conditions || 'condition not recorded') : 'no photograph on the bench'}
              </p>
            </div>
          </div>
          <CommitArea
            label="Written analysis — your words"
            value={saveNotes}
            onSave={setSaveNotes}
            rows={4}
            placeholder="What you looked at, what you concluded, what you are not concluding. No generated text appears here."
          />
          <Button variant="primary" onClick={saveAnalysis}>
            <Plus size={14} /> Save this analysis set
          </Button>
          {savedSets.length ? (
            <IndexList>
              {savedSets
                .slice()
                .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))
                .map((k, i) => {
                  const snap = k.data?.snapshot as { mediaId?: string; pins?: CanvasPin[]; guides?: string[]; savedOn?: string } | undefined;
                  return (
                    <div className="gl-list__row fa-hist" key={k.id}>
                      <div style={{ minWidth: 0 }}>
                        <div className="gl-serif fa-hist__title">{String(k.title)}</div>
                        <div className="gl-tech fa-hist__meta">
                          {snap?.savedOn ? formatDate(snap.savedOn) : formatDate(String(k.updatedAt))} · {snap?.pins?.length ?? 0} markers ·{' '}
                          {(snap?.guides ?? []).length} rule sets · saved under Knowledge
                        </div>
                        {k.body ? <p className="gl-small gl-muted fa-hist__body">{String(k.body)}</p> : null}
                      </div>
                      <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                        <Button size="sm" onClick={() => applySnapshot(k)}>
                          Re-open on the bench
                        </Button>
                        <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/knowledge">
                          Open in Knowledge
                        </Link>
                        <IconButton label={`Delete ${String(k.title)}`} onClick={() => void softDelete(TABLES.knowledge, k.id).then(() => toast('Analysis set removed (restorable in Trash).', 'ok'))}>
                          <Trash2 size={13} />
                        </IconButton>
                      </div>
                    </div>
                  );
                })}
            </IndexList>
          ) : (
            <EmptyState
              title="No analysis sets saved"
              body="Save one once the bench has a photograph, your rules positioned and your markers placed. The entry lives in the Knowledge table as a reference, so it is searchable and exportable with everything else."
            />
          )}
        </Card>
      ) : null}

      {tab === 'styling' ? (
        <Card>
          <CardHead
            title="Styling opportunities"
            eyebrow="Section 07"
            sub="Entries in your Evidence library whose domain is face or makeup and which the recommendation rules allow. Grades come from the library; nothing is added."
          />
          {styleTechniques.length ? (
            <div className="fa-stylelist">
              {styleTechniques.map((t) => (
                <div className="fa-style" key={t.id}>
                  <div className="fa-style__head">
                    <span className="gl-serif fa-style__title">{String(t.title)}</span>
                    <EvidenceChip grade={String(t.evidence)} />
                    <Chip tone="info">{String(t.domain)}</Chip>
                    <Chip>cost band {String(t.costBand)}</Chip>
                  </div>
                  <p className="gl-small">{String(t.claim)}</p>
                  <div className="gl-grid gl-grid--2">
                    <div className="gl-inset">
                      <span className="gl-label">Limitations</span>
                      <p className="gl-small gl-muted">{Array.isArray(t.limitations) ? (t.limitations as string[]).join(' · ') : String(t.limitations ?? 'none recorded')}</p>
                    </div>
                    <div className="gl-inset">
                      <span className="gl-label">Time to try · reversibility</span>
                      <p className="gl-small gl-muted">
                        {String(t.timeToTry ?? 'not recorded')} · {String(t.reversibility ?? 'not recorded')}
                      </p>
                    </div>
                  </div>
                  <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                    <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/evidence">
                      Read the full evidence entry
                    </Link>
                    <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/looksmaxxing">
                      Rank it in the Command Center
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No recommendable face or makeup entries yet"
              body="The Evidence library ships with graded entries. If they have been removed, this panel stays empty rather than substituting advice from nowhere."
              action={
                <Link className="gl-btn gl-btn--primary" to="/evidence">
                  Open the Evidence library
                </Link>
              }
            />
          )}
          {excludedTechniques.length ? (
            <SafetyBanner tone="danger" title={`${excludedTechniques.length} face or makeup entries are excluded from recommendations`}>
              <p className="gl-small">
                Excluded by the recommendation rules because of their evidence grade or recorded safety: {excludedTechniques.map((t) => String(t.title)).join('; ')}. They are
                documented, not hidden — read them in the Evidence library, where the unsafe ones are listed under Unsafe practices with the reason.
              </p>
              <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-3)' }}>
                <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/evidence">
                  Unsafe practices
                </Link>
                <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/services">
                  Professional routes instead
                </Link>
              </div>
            </SafetyBanner>
          ) : null}
        </Card>
      ) : null}

      <div className="fa-footer-note">
        <KvList
          items={[
            { k: 'Analysis', v: 'None. No landmark detection, no attractiveness score, no “face ratio verdict”. There is no vision model in this build to produce one.' },
            { k: 'Guides', v: 'Six rule sets drawn at positions you set with sliders, stored per photograph in mediaItems.data.' },
            { k: 'Markers', v: 'Labelled, draggable, keyboard-editable coordinates as percentages of the frame — not of your anatomy.' },
            { k: 'Observations', v: 'Every entry carries a source label: what I measured, what I observed, or what a professional said.' },
            { k: 'Comparisons', v: 'Before/after always states the recorded condition differences, because light and lens distance move the picture more than most change you are looking for.' },
            { k: 'Storage', v: 'mediaItems, observations, experiments and knowledge rows written through saveRow into IndexedDB on this device.' }
          ]}
        />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- marker editor */

function PinEditor({ pin, onSave, onDelete }: { pin: CanvasPin; onSave: (p: CanvasPin) => void; onDelete: () => void }) {
  const [draft, setDraft] = useCommit(pin, onSave, 500);
  return (
    <div className="fa-pin__edit">
      <div className="fa-pin__row">
        <label className="fa-pin__grow">
          <span className="gl-tech">Marker label</span>
          <TextInput value={draft.label} onChange={(v) => setDraft({ ...draft, label: v })} />
        </label>
        <IconButton label={`Delete marker ${pin.label}`} onClick={onDelete}>
          <Trash2 size={13} />
        </IconButton>
      </div>
      <div className="fa-pin__row">
        <label className="fa-pin__num">
          <span className="gl-tech">X % of frame</span>
          <TextInput type="number" value={Math.round(draft.x * 10) / 10} onChange={(v) => setDraft({ ...draft, x: clampPct(Number(v)) })} />
        </label>
        <label className="fa-pin__num">
          <span className="gl-tech">Y % of frame</span>
          <TextInput type="number" value={Math.round(draft.y * 10) / 10} onChange={(v) => setDraft({ ...draft, y: clampPct(Number(v)) })} />
        </label>
      </div>
      <label className="fa-pin__grow fa-pin__note">
        <span className="gl-tech">Note</span>
        <TextInput value={draft.note ?? ''} onChange={(v) => setDraft({ ...draft, note: v })} placeholder="What this point marks" />
      </label>
    </div>
  );
}

function clampPct(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/* ------------------------------------------------------------- observations UI */

function ObservationsPanel({
  features,
  observations,
  media,
  preselect,
  clearPreselect
}: {
  features: FeatureStudy[];
  observations: AnyRow[];
  media: AnyRow[];
  preselect: string | null;
  clearPreselect: () => void;
}) {
  const toast = useToast();
  const all = useRows(TABLES.observations, { includeDeleted: true });
  const [showDeleted, setShowDeleted] = useState(false);
  const [subject, setSubject] = useState(preselect ?? features[0].key);
  const [provenance, setProvenance] = useState('observed');
  const [note, setNote] = useState('');
  const [reaction, setReaction] = useState<ObservationRow['reaction']>('none');
  const [severity, setSeverity] = useState(0);
  const [on, setOn] = useState(todayISO());
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    if (preselect) {
      setSubject(preselect);
      clearPreselect();
    }
  }, [preselect, clearPreselect]);

  const rows = observations
    .filter((o) => (showDeleted ? Boolean(o.deletedAt) : !o.deletedAt))
    .sort((a, b) => String(b.on).localeCompare(String(a.on)));

  const submit = () => {
    const text = note.trim();
    if (!text) {
      toast('Write the observation first. An empty row is not a record.', 'bad');
      return;
    }
    const base = {
      subjectType: 'face-feature',
      subjectId: subject,
      on,
      note: text,
      reaction,
      severity,
      mediaIds,
      tags: ['face', provenance],
      data: { provenance }
    };
    if (editing) {
      void saveRow(TABLES.observations, { id: editing, ...base }).then(() => {
        toast('Observation updated.', 'ok');
        setEditing(null);
      });
    } else {
      void saveRow(TABLES.observations, { id: newId('obs'), ...base }).then(() => toast('Observation stored.', 'ok'));
    }
    setNote('');
    setSeverity(0);
    setReaction('none');
    setMediaIds([]);
  };

  const startEdit = (o: AnyRow) => {
    setEditing(o.id);
    setSubject(String(o.subjectId));
    setNote(String(o.note ?? ''));
    setOn(String(o.on ?? todayISO()));
    setReaction((o.reaction as ObservationRow['reaction']) ?? 'none');
    setSeverity(Number(o.severity ?? 0));
    setMediaIds(Array.isArray(o.mediaIds) ? (o.mediaIds as string[]) : []);
    setProvenance(String(o.data?.provenance ?? 'observed'));
  };

  const featureOf = (key: string) => features.find((f) => f.key === key);

  return (
    <div className="fa-editorial">
      <div>
        <Card>
          <CardHead
            title="Record an observation"
            eyebrow="Section 05"
            sub="One feature, one date, one sentence — with the source of the claim stated, because ‘I measured this’ and ‘a professional said this’ are different kinds of knowledge."
          />
          <div className="gl-form-row">
            <Field label="Feature" hint="Writes into observations.subjectId.">
              <Select value={subject} onChange={setSubject} options={features.map((f) => ({ value: f.key, label: `${f.label} — ${f.pose}` }))} />
            </Field>
            <DateInput label="Observed on" value={on} onChange={setOn} />
          </div>
          <div className="fa-prov">
            <span className="gl-label">Source of this statement</span>
            <SegmentedControl value={provenance} onChange={setProvenance} options={PROVENANCE.map((p) => ({ value: p.value, label: p.label }))} />
            <p className="gl-small gl-faint">{PROVENANCE.find((p) => p.value === provenance)?.hint}</p>
            {provenance === 'measured' ? (
              <SafetyBanner tone="warn" title="Measured by you">
                <p className="gl-small">
                  Glow Lab has no calipers, no photogrammetry and no measuring instrument of any kind. If this is a measurement, you took it — name the tool and
                  the method inside the note so future-you can trust or discount it.
                </p>
              </SafetyBanner>
            ) : null}
          </div>
          <Field label="Observation" hint="Describe what is visible. No score, no verdict, no diagnosis language.">
            <TextArea value={note} onChange={setNote} rows={4} placeholder="e.g. In the left profile the lower lip sits just behind the nose-to-chin line I drew; in the right profile it is level with it." />
          </Field>
          <div className="gl-form-row">
            <Field label="Reaction" hint="How your skin or the day responded, if this is about a product or technique.">
              <Select value={reaction} onChange={(v) => setReaction(v as ObservationRow['reaction'])} options={REACTIONS.map((r) => ({ value: r.value, label: r.label }))} />
            </Field>
            <Range label="Severity / significance you would assign" value={severity} min={0} max={5} onChange={setSeverity} format={(v) => `${v}/5 yours`} />
          </div>
          <Field label="Photographs attached" hint={`Chosen from ${media.length} face-filed photograph(s).`}>
            <div className="fa-mediagrid">
              {media.length ? (
                media.map((m) => {
                  const on2 = mediaIds.includes(m.id);
                  return (
                    <button
                      type="button"
                      key={m.id}
                      className="fa-mediapick"
                      data-on={on2}
                      aria-pressed={on2}
                      onClick={() => setMediaIds((s) => (on2 ? s.filter((x) => x !== m.id) : [...s, m.id]))}
                    >
                      <span>{String(m.title || 'Untitled')}</span>
                      <span className="gl-tech">
                        {String(m.pose || 'no pose')} · {formatDate(String(m.takenOn ?? ''))}
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="gl-small gl-faint">No face photographs stored yet — capture one on the bench to attach it here.</p>
              )}
            </div>
          </Field>
          <div className="gl-row gl-row--tight">
            <Button variant="primary" onClick={submit}>
              <Check size={14} /> {editing ? 'Update observation' : 'Store observation'}
            </Button>
            {editing ? (
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel editing
              </Button>
            ) : null}
          </div>
        </Card>
      </div>

      <aside className="gl-rule-col fa-rail">
        <div className="fa-railblock">
          <div className="gl-row gl-row--between" style={{ alignItems: 'center' }}>
            <span className="gl-eyebrow">Saved observations</span>
            <Toggle checked={showDeleted} onChange={setShowDeleted} label="Show removed" />
          </div>
          {rows.length ? (
            <ul className="fa-obslist">
              {rows.map((o) => {
                const f = featureOf(String(o.subjectId));
                const prov = PROVENANCE.find((p) => p.value === String(o.data?.provenance ?? ''));
                return (
                  <li className="fa-obs" key={o.id} data-deleted={Boolean(o.deletedAt)}>
                    <div className="gl-row gl-row--between" style={{ alignItems: 'baseline', gap: 'var(--glow-sp-3)' }}>
                      <span className="gl-serif fa-obs__title">{f ? f.label : String(o.subjectId)}</span>
                      <span className="gl-tech">{formatDate(String(o.on))}</span>
                    </div>
                    <div className="gl-row gl-row--tight fa-obs__flags" style={{ flexWrap: 'wrap' }}>
                      <Chip tone={prov ? 'gold' : 'limited'}>{prov ? prov.label : 'source not labelled'}</Chip>
                      <Chip tone="info">{String(o.reaction)}</Chip>
                      <Chip>severity {String(o.severity)}/5</Chip>
                    </div>
                    <p className="gl-small">{String(o.note)}</p>
                    {Array.isArray(o.mediaIds) && (o.mediaIds as string[]).length ? (
                      <p className="gl-tech fa-obs__media">
                        {(o.mediaIds as string[])
                          .map((id) => media.find((m) => m.id === id)?.title ?? 'removed photograph')
                          .join(' · ')}
                      </p>
                    ) : null}
                    <div className="gl-row gl-row--tight">
                      {o.deletedAt ? (
                        <Button size="sm" variant="ghost" onClick={() => void restore(TABLES.observations, o.id).then(() => toast('Observation restored.', 'ok'))}>
                          Restore
                        </Button>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => startEdit(o)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setConfirmId(o.id)}>
                            <Trash2 size={13} /> Remove
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              title={showDeleted ? 'Nothing removed' : 'No observations yet'}
              body={
                showDeleted
                  ? 'Soft-deleted rows would appear here, restorable. Nothing has been removed from this department.'
                  : 'One honest sentence is more useful than a verdict. Start with the feature you keep noticing and describe only what the photograph shows.'
              }
            />
          )}
          <p className="gl-small gl-faint">
            {all.filter((o) => o.subjectType === 'face-feature').length} face observation(s) in the table, including removed. Written to IndexedDB as
            observations rows.
          </p>
        </div>
      </aside>

      <Modal
        open={Boolean(confirmId)}
        onClose={() => setConfirmId(null)}
        title="Remove this observation?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmId(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirmId) void softDelete(TABLES.observations, confirmId).then(() => toast('Observation removed. Restorable under “Show removed”.', 'ok'));
                setConfirmId(null);
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="gl-small">
          This soft-deletes the row: it keeps its history, stays out of the live list, and can be restored from the removed view. Nothing is erased until you
          empty Trash.
        </p>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ experiments */

const DECISIONS: { value: ExperimentRow['decision']; label: string }[] = [
  { value: 'open', label: 'Still running' },
  { value: 'repeat', label: 'Repeat — it worked' },
  { value: 'extend', label: 'Extend the window' },
  { value: 'stop', label: 'Stop — not worth it' }
];

/** Every declared ExperimentRow field, filled with an honest empty value. The
 *  base columns (id/createdAt/rev/deviceId…) are supplied by the row store. */
function newExperiment(): Omit<ExperimentRow, keyof import('../db/schema').BaseRow> {
  const start = todayISO();
  return {
    name: '',
    category: 'face',
    aim: '',
    startOn: start,
    endOn: addDays(start, 28),
    baseline: '',
    baselineMediaIds: [],
    techniqueIds: [],
    productIds: [],
    protocol: '',
    observations: [],
    result: '',
    resultMediaIds: [],
    rating: 0,
    decision: 'open',
    confounders: ''
  };
}

function ExperimentsPanel({
  experiments,
  media,
  techniques,
  goals
}: {
  experiments: AnyRow[];
  media: AnyRow[];
  techniques: AnyRow[];
  goals: AnyRow[];
}) {
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const face = experiments.filter((e) => !e.deletedAt && (String(e.category) === 'face' || (e.tags as string[])?.includes('face')));
  const open = useRow(TABLES.experiments, openId ?? undefined);
  const [logNote, setLogNote] = useState('');

  const create = () => {
    void saveRow(TABLES.experiments, { ...newExperiment(), name: `Face experiment ${face.length + 1}`, aim: '', protocol: '' }).then((row) => {
      setOpenId(row.id);
      toast('Experiment row created. Both photographs and the protocol are yours to fill in.', 'ok');
    });
  };

  const patch = (e: AnyRow, p: Record<string, unknown>) => void saveRow(TABLES.experiments, { id: e.id, ...p });

  return (
    <Card>
      <CardHead
        title="Controlled self-experiment"
        eyebrow="Section 06b"
        sub="A before photograph, one variable, a fixed window, an after photograph and a decision. The only honest way to answer ‘does this do anything for me’."
        right={
          <Button size="sm" onClick={create}>
            <Plus size={14} /> New experiment
          </Button>
        }
      />
      {!face.length ? (
        <EmptyPlate
          kicker="No experiments"
          title="Nothing is being tested yet"
          body="Pick one technique from the Evidence library, write down what you expect, photograph the baseline under recorded conditions, run it for a fixed number of weeks, then photograph again the same way. If you skip the second photograph, you will not know."
          action={
            <Button variant="primary" onClick={create}>
              Start an empty experiment row
            </Button>
          }
        />
      ) : null}
      {face.length ? (
        <IndexList>
          {face.map((e, i) => (
            <IndexRow
              key={e.id}
              no={i + 1}
              title={String(e.name || 'Untitled experiment')}
              sub={`${formatDate(String(e.startOn))} → ${formatDate(String(e.endOn))} · ${String(e.decision)}${e.aim ? ` · ${String(e.aim).slice(0, 70)}` : ''}`}
              right={<Chip tone="info">{String(e.category)}</Chip>}
              onClick={() => setOpenId(e.id)}
            />
          ))}
        </IndexList>
      ) : null}
      {open ? (
        <div className="fa-exp">
          <div className="gl-form-row">
            <CommitLine label="Experiment name" value={String(open.name ?? '')} onSave={(v) => patch(open, { name: v })} />
            <CommitLine label="Category" value={String(open.category ?? 'face')} onSave={(v) => patch(open, { category: v })} />
          </div>
          <CommitArea
            label="Aim — what you expect to happen"
            value={String(open.aim ?? '')}
            onSave={(v) => patch(open, { aim: v })}
            rows={2}
            placeholder="Written before you start, so a later result cannot quietly become the prediction."
          />
          <div className="gl-form-row">
            <DateInput label="Start" value={String(open.startOn ?? todayISO())} onChange={(v) => patch(open, { startOn: v })} />
            <DateInput label="Planned end" value={String(open.endOn ?? addDays(todayISO(), 28))} onChange={(v) => patch(open, { endOn: v })} />
          </div>
          <CommitArea label="Baseline state, in words" value={String(open.baseline ?? '')} onSave={(v) => patch(open, { baseline: v })} rows={2} />
          <CommitArea label="Protocol — exactly one variable" value={String(open.protocol ?? '')} onSave={(v) => patch(open, { protocol: v })} rows={3} />
          <div className="gl-form-row">
            <Field label="Technique under test" hint="From your Evidence library.">
              <Select
                value={String((open.techniqueIds as string[])?.[0] ?? '')}
                onChange={(v) => patch(open, { techniqueIds: v ? [v] : [] })}
                options={techniques.map((t) => ({ value: t.id, label: `${String(t.title)} — ${String(t.domain)} (${String(t.evidence)})` }))}
                placeholder="None linked"
              />
            </Field>
            <Field label="Related goal" hint="One of your own goal rows.">
              <Select
                value={String((open.data?.goalId as string) ?? '')}
                onChange={(v) => patch(open, { data: { ...(open.data ?? {}), goalId: v || null } })}
                options={goals.map((g) => ({ value: g.id, label: String(g.title) }))}
                placeholder="No goal linked"
              />
            </Field>
          </div>
          <div className="gl-grid gl-grid--2">
            <div>
              <span className="gl-label">Baseline photograph</span>
              {media.filter((m) => (open.baselineMediaIds as string[])?.includes(m.id)).map((m) => (
                <div className="gl-tech" key={m.id}>
                  {String(m.title)} · {String(m.conditions || 'no conditions')} · {formatDate(String(m.takenOn ?? ''))}
                </div>
              ))}
              <PhotoPicker
                label="Attach baseline"
                kind="experiment"
                album="Face — experiments"
                withConditions
                onPick={(rows) => patch(open, { baselineMediaIds: [...((open.baselineMediaIds as string[]) ?? []), ...rows.map((r) => r.id)] })}
              />
            </div>
            <div>
              <span className="gl-label">Result photograph</span>
              {media.filter((m) => (open.resultMediaIds as string[])?.includes(m.id)).map((m) => (
                <div className="gl-tech" key={m.id}>
                  {String(m.title)} · {String(m.conditions || 'no conditions')} · {formatDate(String(m.takenOn ?? ''))}
                </div>
              ))}
              <PhotoPicker
                label="Attach result"
                kind="experiment"
                album="Face — experiments"
                withConditions
                onPick={(rows) => patch(open, { resultMediaIds: [...((open.resultMediaIds as string[]) ?? []), ...rows.map((r) => r.id)] })}
              />
            </div>
          </div>
          {((open.baselineMediaIds as string[]) ?? [])[0] && ((open.resultMediaIds as string[]) ?? [])[0] ? (
            <>
              <CompareSlider
                before={media.find((m) => m.id === (open.baselineMediaIds as string[])[0])}
                after={media.find((m) => m.id === (open.resultMediaIds as string[])[0])}
                height={380}
              />
              {(() => {
                const b = media.find((m) => m.id === (open.baselineMediaIds as string[])[0]);
                const a = media.find((m) => m.id === (open.resultMediaIds as string[])[0]);
                const bad = conditionDifferences(b, a).filter((d) => !d.same && d.k !== 'Taken on' && d.k !== 'Width × height');
                return bad.length ? (
                  <SafetyBanner tone="warn" title="The two experiment photographs were not shot alike">
                    <p className="gl-small">
                      Differing: {bad.map((d) => `${d.k} (${d.a} vs ${d.b})`).join('; ')}. Reshoot the result under the baseline conditions before writing a result —
                      otherwise the protocol did not change anything, the camera did.
                    </p>
                  </SafetyBanner>
                ) : null;
              })()}
            </>
          ) : (
            <p className="gl-small gl-faint">Both photographs attached will give a comparison here, with its conditions checked automatically against the record.</p>
          )}
          <div className="fa-log">
            <span className="gl-label">Running log ({((open.observations as ExperimentRow['observations']) ?? []).length})</span>
            <div className="gl-row gl-row--tight" style={{ gap: 'var(--glow-sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <TextArea value={logNote} onChange={setLogNote} rows={2} placeholder="Week 2: no visible change, skin tolerating it, one flaky patch near the jaw." />
              </div>
              <Button
                onClick={() => {
                  const text = logNote.trim();
                  if (!text) return;
                  const list = ((open.observations as ExperimentRow['observations']) ?? []).concat([{ on: todayISO(), note: text, mediaIds: [], rating: null }]);
                  patch(open, { observations: list });
                  setLogNote('');
                }}
              >
                Add log entry
              </Button>
            </div>
            {((open.observations as ExperimentRow['observations']) ?? []).length ? (
              <ul className="fa-loglist">
                {((open.observations as ExperimentRow['observations']) ?? []).map((o, i) => (
                  <li key={`${o.on}-${i}`}>
                    <span className="gl-tech">{formatDate(o.on)}</span> <span>{o.note}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <CommitArea label="Result — only after the end date" value={String(open.result ?? '')} onSave={(v) => patch(open, { result: v })} rows={2} />
          <div className="gl-form-row">
            <Field label="Decision">
              <Select value={String(open.decision)} onChange={(v) => patch(open, { decision: v })} options={DECISIONS.map((d) => ({ value: d.value, label: d.label }))} />
            </Field>
            <Field label="Would you do it again?" hint="Your own rating, stored on the row.">
              <Rating value={Number(open.rating ?? 0)} onChange={(v) => patch(open, { rating: v })} count={5} />
            </Field>
          </div>
          <CommitArea label="Confounders — what else changed" value={String(open.confounders ?? '')} onSave={(v) => patch(open, { confounders: v })} rows={2} />
          <div className="gl-row gl-row--tight">
            <Button variant="ghost" onClick={() => setOpenId(null)}>
              Close
            </Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmId(open.id)}>
              <Trash2 size={13} /> Remove experiment
            </Button>
          </div>
        </div>
      ) : null}
      <Modal
        open={Boolean(confirmId)}
        onClose={() => setConfirmId(null)}
        title="Remove this experiment?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmId(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirmId) void softDelete(TABLES.experiments, confirmId).then(() => toast('Experiment removed (restorable in Trash).', 'ok'));
                setConfirmId(null);
                setOpenId(null);
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="gl-small">Soft-deleted, so the protocol, the log and both photographs stay recoverable until you empty Trash.</p>
      </Modal>
    </Card>
  );
}
