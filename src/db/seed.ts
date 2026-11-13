import { db } from './db';
import { findAll, newId, put, softDelete, todayISO } from './repo';
import { TABLES, type AnyRow, type TableName } from './schema';
import { REFERENCE_SETS, REFERENCE_SIZES } from '../content/referenceLibrary';
import { DEFAULT_SETTINGS, loadSettings, updateSettings } from '../state/settings';
import { EVIDENCE_TECHNIQUES } from '../content/evidence';
import { ACADEMY_TUTORIALS } from '../content/academy';
import { INGREDIENT_REFERENCE } from '../content/ingredients';
import { EXERCISE_REFERENCE } from '../content/exercises';

export const SEED_VERSION = 4;
const FLAG = 'glow-lab:seed-version';

/**
 * First-run and upgrade seeding. Seeds are real rows in real tables, so they
 * behave exactly like user data: editable, removable, exportable.
 * Every seeded record is tagged `glow-lab-seed` and the UI labels them as
 * optional starter content that can be deleted in one action.
 */
let inFlight: Promise<{ added: number; skipped: boolean }> | null = null;

export function runSeeding(): Promise<{ added: number; skipped: boolean }> {
  // Two boots of the same session used to race past the version flag and seed
  // the reference sets twice, which filled the Discover feed with duplicate
  // cards. One pass at a time, and the pass itself is idempotent.
  if (!inFlight) {
    inFlight = seedingPass().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** Keeps the earliest copy of any reference seeded more than once. */
async function collapseDuplicateSeedRows() {
  let removed = 0;
  const groups: [TableName, (r: AnyRow) => string][] = [
    [TABLES.discoveryItems, (r) => (r.seed === 1 && r.slug ? String(r.slug) : '')],
    [TABLES.mediaItems, (r) => (String(r.hash ?? '').startsWith('seed-') && r.remoteUrl ? String(r.remoteUrl) : '')]
  ];
  for (const [table, identity] of groups) {
    const rows = (await findAll(table, { includeDeleted: true })).filter((r) => !r.deletedAt && identity(r));
    const seen = new Map<string, AnyRow>();
    for (const row of rows.sort((a, b) => Number(a.createdAt) - Number(b.createdAt))) {
      const k = identity(row);
      const first = seen.get(k);
      if (!first) {
        seen.set(k, row);
        continue;
      }
      if (row.blobId) await db.mediaBlobs.delete(row.blobId);
      await softDelete(table, String(row.id));
      removed += 1;
    }
  }
  return removed;
}

async function seedingPass(): Promise<{ added: number; skipped: boolean }> {
  await collapseDuplicateSeedRows();
  const stored = Number(localStorage.getItem(FLAG) ?? 0);
  if (stored >= SEED_VERSION) return { added: 0, skipped: true };

  let added = 0;
  const stamp = todayISO();

  // ---- bundled original reference imagery (discovery provider) ----
  const existingMedia = await findAll(TABLES.mediaItems, { includeDeleted: true });
  const existingSets = await findAll(TABLES.discoveryItems, { includeDeleted: true });
  for (const set of REFERENCE_SETS) {
    const remote = `./${set.file}`;
    if (existingSets.some((d) => d.slug === set.slug)) continue;
    if (existingMedia.some((m) => m.remoteUrl === remote)) continue;
    const [w, h] = REFERENCE_SIZES[set.file] ?? [900, 1200];
    const media = await put(TABLES.mediaItems, {
      id: newId('med'),
      kind: 'library',
      album: 'Glow Lab reference sets',
      title: set.title,
      caption: set.description,
      blobId: null,
      remoteUrl: remote,
      width: w,
      height: h,
      takenOn: stamp,
      linkedDomain: 'discover',
      sourceKind: 'glow-lab-original',
      sourceUrl: '',
      attribution: set.attribution,
      license: set.license,
      private: false,
      hash: `seed-${set.slug}`,
      tags: [...set.categories, set.aesthetic],
      data: { palette: set.palette },
      seed: 1
    } as any);
    await put(TABLES.discoveryItems, {
      id: newId('dsc'),
      slug: set.slug,
      providerId: 'glow-lab-library',
      title: set.title,
      description: set.description,
      categories: set.categories,
      aesthetic: set.aesthetic,
      palette: set.palette,
      elements: set.elements,
      mediaId: media.id,
      sourceUrl: set.sourceUrl,
      attribution: set.attribution,
      license: set.license,
      recreatable: set.recreatable,
      seed: 1,
      tags: [...set.categories, set.aesthetic]
    } as any);
    added += 2;
  }

  // ---- evidence-graded techniques (Parts 7 + 35 safety flags) ----
  const techniqueRows = await findAll(TABLES.techniques, { includeDeleted: true });
  for (const t of EVIDENCE_TECHNIQUES) {
    if (techniqueRows.some((r) => r.slug === t.slug)) continue;
    await put(TABLES.techniques, { ...t, id: newId('tec'), seed: 1 } as any);
    added += 1;
  }

  // ---- ingredient reference (Part 12) ----
  const knowledge = await findAll(TABLES.knowledge, { includeDeleted: true });
  for (const ing of INGREDIENT_REFERENCE) {
    const slug = `ingredient-${ing.slug}`;
    if (knowledge.some((k) => k.text.includes(slug))) continue;
    await put(TABLES.knowledge, {
      id: newId('kno'),
      title: ing.name,
      kind: 'reference',
      body: `${ing.purpose}\n\nWhat the evidence supports: ${ing.evidence}\n\nCombine with care: ${ing.combine}\n\nIntroduce: ${ing.introduce}\n\nWhen to ask a professional: ${ing.professional}`,
      domain: 'skincare',
      confidence: 3,
      worked: 'unset',
      slug,
      evidence: ing.evidenceGrade,
      cautions: ing.cautions,
      linkedGoalIds: [],
      linkedTechniqueIds: [],
      linkedProductIds: [],
      linkedExperimentIds: [],
      tags: ['ingredient', ...ing.family],
      seed: 1
    } as any);
    added += 1;
  }

  // ---- academy tutorials (Part 21 — original written content) ----
  const tutorials = await findAll(TABLES.tutorials, { includeDeleted: true });
  for (const tu of ACADEMY_TUTORIALS) {
    if (tutorials.some((r) => r.slug === tu.slug)) continue;
    await put(TABLES.tutorials, { ...tu, id: newId('tut'), seed: 1 } as any);
    added += 1;
  }

  // ---- exercise library (Part 17) ----
  const exercises = await findAll(TABLES.exercises, { includeDeleted: true });
  for (const ex of EXERCISE_REFERENCE) {
    if (exercises.some((r) => r.name.toLowerCase() === ex.name.toLowerCase())) continue;
    await put(TABLES.exercises, { ...ex, id: newId('exe'), seed: 1 } as any);
    added += 1;
  }

  // ---- default settings row so the Settings screen always has something ----
  await loadSettings();

  localStorage.setItem(FLAG, String(SEED_VERSION));
  const settings = await loadSettings();
  if (!settings.firstRunAt) await updateSettings({ firstRunAt: Date.now() });
  return { added, skipped: false };
}

/** Removes every record this app seeded, leaving user data untouched. */
export async function clearSeedContent() {
  const tables = [
    TABLES.discoveryItems,
    TABLES.mediaItems,
    TABLES.techniques,
    TABLES.knowledge,
    TABLES.tutorials,
    TABLES.exercises
  ];
  let removed = 0;
  for (const t of tables) {
    const rows = await findAll(t, { includeDeleted: true });
    for (const row of rows) {
      if (row.seed !== 1) continue;
      if (t === TABLES.mediaItems && row.blobId) await db.mediaBlobs.delete(row.blobId);
      await db.table(t).delete(row.id);
      removed += 1;
    }
  }
  localStorage.setItem(FLAG, String(SEED_VERSION + 100));
  return removed;
}

export const SEED_LABEL = 'Glow Lab starter content';
