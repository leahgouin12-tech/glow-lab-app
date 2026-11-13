import { TABLES, ENTITY_TABLES, type AnyRow, type TableName } from '../db/schema';
import { findAll, tokenMatch } from '../db/repo';

/**
 * Global search (spec Part 24). Reads the `text` column that repo.put() keeps
 * up to date, so it covers every field a department stores without each
 * department having to register itself. Also routes: every hit knows where in
 * the app it lives.
 */

export interface SearchHit {
  table: TableName;
  id: string;
  title: string;
  subtitle: string;
  path: string;
  score: number;
  kindLabel: string;
}

/**
 * A routine's `domain` is a record field, not a route name, so it cannot be
 * interpolated straight into a path. Anything unmapped lands on the calendar,
 * which is where routines are actually ticked off.
 */
const DOMAIN_ROUTE: Record<string, string> = {
  hair: '/hair',
  skin: '/skin',
  skincare: '/skin',
  face: '/face',
  makeup: '/makeup',
  dental: '/dental',
  fragrance: '/fragrance',
  posture: '/posture',
  fitness: '/fitness',
  body: '/fitness',
  colour: '/color',
  color: '/color',
  style: '/closet',
  wardrobe: '/closet',
  discovery: '/discover',
  appearance: '/looksmaxxing'
};

const ROUTES: Partial<Record<TableName, (row: AnyRow) => { path: string; title: string; subtitle: string; kindLabel: string }>> = {
  [TABLES.goals]: (r) => ({ path: '/looksmaxxing', title: r.title || 'Untitled goal', subtitle: `${r.domain} · ${r.status}`, kindLabel: 'Goal' }),
  [TABLES.plans]: (r) => ({ path: `/looksmaxxing?plan=${r.id}`, title: r.name || 'Plan', subtitle: `${r.days}-day plan · ${r.status}`, kindLabel: 'Plan' }),
  [TABLES.assessments]: (r) => ({ path: `/looksmaxxing?assessment=${r.id}`, title: r.name || 'Assessment', subtitle: `Taken ${r.takenOn}`, kindLabel: 'Assessment' }),
  [TABLES.techniques]: (r) => ({ path: `/knowledge?technique=${r.slug}`, title: r.title, subtitle: `${r.domain} · evidence: ${r.evidence}`, kindLabel: 'Technique' }),
  [TABLES.knowledge]: (r) => ({ path: `/knowledge?entry=${r.id}`, title: r.title, subtitle: r.domain || 'Note', kindLabel: 'Knowledge' }),
  [TABLES.tutorials]: (r) => ({ path: `/academy?tutorial=${r.slug}`, title: r.title, subtitle: `${r.domain} · ${r.minutes} min`, kindLabel: 'Tutorial' }),
  [TABLES.products]: (r) => ({ path: `/market?product=${r.id}`, title: r.name, subtitle: `${r.brand || 'brand unrecorded'} · ${r.status}`, kindLabel: 'Product' }),
  [TABLES.clothingItems]: (r) => ({ path: `/closet?item=${r.id}`, title: r.name, subtitle: `${r.category} · ${r.brand || ''}`, kindLabel: 'Garment' }),
  [TABLES.outfits]: (r) => ({ path: `/closet?outfit=${r.id}`, title: r.name, subtitle: r.occasion || 'Outfit', kindLabel: 'Outfit' }),
  [TABLES.routines]: (r) => ({ path: `${DOMAIN_ROUTE[String(r.domain)] ?? '/calendar'}?routine=${r.id}`, title: r.name, subtitle: `${r.domain} · ${((r.steps as unknown[]) ?? []).length} steps`, kindLabel: 'Routine' }),
  [TABLES.hairstyles]: (r) => ({ path: `/hair?style=${r.id}`, title: r.name, subtitle: r.family, kindLabel: 'Hairstyle' }),
  [TABLES.hairRecords]: (r) => ({ path: `/hair?record=${r.id}`, title: r.label || r.kind, subtitle: r.doneOn, kindLabel: 'Hair record' }),
  [TABLES.exercises]: (r) => ({ path: `/fitness?exercise=${r.id}`, title: r.name, subtitle: r.pattern, kindLabel: 'Exercise' }),
  [TABLES.workoutSessions]: (r) => ({ path: `/fitness?session=${r.id}`, title: r.label || 'Session', subtitle: r.doneOn, kindLabel: 'Workout' }),
  [TABLES.progressEntries]: (r) => ({ path: `/progress?entry=${r.id}`, title: r.label, subtitle: `${r.domain} · ${r.on}`, kindLabel: 'Progress' }),
  [TABLES.experiments]: (r) => ({ path: `/experiments?id=${r.id}`, title: r.name, subtitle: `${r.category} · ${r.decision}`, kindLabel: 'Experiment' }),
  [TABLES.observations]: (r) => ({ path: `/skin?observation=${r.id}`, title: String(r.note).slice(0, 60) || 'Observation', subtitle: r.on, kindLabel: 'Observation' }),
  [TABLES.calendarEvents]: (r) => ({ path: `/calendar?event=${r.id}`, title: r.title, subtitle: r.kind || 'Event', kindLabel: 'Calendar' }),
  [TABLES.boards]: (r) => ({ path: `/inspiration?board=${r.id}`, title: r.name, subtitle: r.kind, kindLabel: 'Board' }),
  [TABLES.discoveryItems]: (r) => ({ path: `/discover?item=${r.id}`, title: r.title, subtitle: r.aesthetic || (r.categories as string[])?.join(', ') || '', kindLabel: 'Discovery' }),
  [TABLES.mediaItems]: (r) => ({ path: `/media?id=${r.id}`, title: r.title || 'Photo', subtitle: r.kind, kindLabel: 'Media' }),
  [TABLES.consultations]: (r) => ({ path: `/services?consultation=${r.id}`, title: r.procedureTitle, subtitle: r.on, kindLabel: 'Consultation' }),
  [TABLES.providers]: (r) => ({ path: `/services?provider=${r.id}`, title: r.name, subtitle: r.discipline, kindLabel: 'Professional' }),
  [TABLES.dental]: (r) => ({ path: `/dental?record=${r.id}`, title: r.label || r.kind, subtitle: r.on, kindLabel: 'Dental' }),
  [TABLES.fragrances]: (r) => ({ path: `/fragrance?id=${r.id}`, title: r.name, subtitle: r.house || r.family, kindLabel: 'Fragrance' }),
  [TABLES.conversations]: (r) => ({ path: `/advisor?id=${r.id}`, title: r.title, subtitle: r.startedOn, kindLabel: 'Conversation' }),
  [TABLES.messages]: (r) => ({ path: `/advisor?id=${r.conversationId}`, title: String(r.body).slice(0, 70), subtitle: r.on, kindLabel: 'Message' }),
  [TABLES.measurements]: (r) => ({ path: `/fitness?measurement=${r.id}`, title: `${r.site}: ${r.value}${r.unit}`, subtitle: r.takenOn, kindLabel: 'Measurement' }),
  [TABLES.profile]: (r) => ({ path: '/profile', title: `${r.kind} profile`, subtitle: 'Personal baseline', kindLabel: 'Profile' }),
  [TABLES.lists]: (r) => ({ path: `/market?list=${r.id}`, title: r.name, subtitle: r.kind, kindLabel: 'List' }),
  [TABLES.learningPaths]: (r) => ({ path: `/academy?path=${r.id}`, title: r.title, subtitle: r.goal, kindLabel: 'Learning path' }),
  [TABLES.manualReferences]: (r) => ({ path: `/settings?tab=integrations`, title: r.title || r.url, subtitle: r.provider, kindLabel: 'Reference link' }),
  [TABLES.recommendations]: (r) => ({ path: '/advisor', title: r.title, subtitle: r.domain, kindLabel: 'Recommendation' })
};

/** Departments the query itself names — always surfaced even with no rows. */
const DEPARTMENT_HINTS: [string, string, string][] = [
  ['looksmaxxing', '/looksmaxxing', 'Looksmaxxing Command Center'],
  ['command center', '/looksmaxxing', 'Looksmaxxing Command Center'],
  ['face', '/face', 'Facial Aesthetics Lab'],
  ['hair', '/hair', 'Hair Studio'],
  ['locs', '/hair', 'Hair Studio — loc tracking'],
  ['skin', '/skin', 'Skin & Complexion Lab'],
  ['makeup', '/makeup', 'Makeup Studio'],
  ['closet', '/closet', 'Style & Digital Closet'],
  ['outfit', '/closet', 'Style & Digital Closet'],
  ['market', '/market', 'Beauty Market'],
  ['buy', '/market', 'Beauty Market — SHOULD I BUY THIS?'],
  ['fitness', '/fitness', 'Body & Fitness'],
  ['workout', '/fitness', 'Body & Fitness'],
  ['posture', '/posture', 'Posture & Presentation'],
  ['teeth', '/dental', 'Dental & Smile Care'],
  ['dental', '/dental', 'Dental & Smile Care'],
  ['smile', '/dental', 'Dental & Smile Care'],
  ['fragrance', '/fragrance', 'Fragrance Studio'],
  ['perfume', '/fragrance', 'Fragrance Studio'],
  ['discover', '/discover', 'GLOW DISCOVER'],
  ['inspiration', '/inspiration', 'Inspiration Universe'],
  ['moodboard', '/inspiration', 'Inspiration Universe'],
  ['academy', '/academy', 'Glow Academy'],
  ['learn', '/academy', 'Glow Academy'],
  ['knowledge', '/knowledge', 'Personal Knowledge Library'],
  ['experiment', '/experiments', 'Experimentation Lab'],
  ['calendar', '/calendar', 'Beauty & Style Calendar'],
  ['progress', '/progress', 'Progress & Analytics'],
  ['analytics', '/progress', 'Progress & Analytics'],
  ['professional', '/services', 'Professional Services'],
  ['consultation', '/services', 'Professional Services'],
  ['profile', '/profile', 'Personal Profile'],
  ['advisor', '/advisor', 'Glow Advisor'],
  ['try-on', '/tryon', 'Virtual Try-On'],
  ['tryon', '/tryon', 'Virtual Try-On'],
  ['color', '/color', 'Personal Color Analysis'],
  ['colour', '/color', 'Personal Color Analysis'],
  ['media', '/media', 'Private Media Studio'],
  ['settings', '/settings', 'Settings & Integrations'],
  ['theme', '/settings?tab=appearance', 'Settings — Appearance']
];

export interface SearchOutcome {
  hits: SearchHit[];
  routes: { path: string; label: string }[];
  searchedTables: number;
  tookMs: number;
}

export async function globalSearch(query: string, limit = 40): Promise<SearchOutcome> {
  const t0 = performance.now();
  const q = query.trim().toLowerCase();
  if (q.length < 2) return { hits: [], routes: [], searchedTables: 0, tookMs: 0 };

  const routes = DEPARTMENT_HINTS.filter(([k]) => q.includes(k))
    .slice(0, 5)
    .map(([_, path, label]) => ({ path, label }));

  const hits: SearchHit[] = [];
  let searchedTables = 0;

  for (const table of ENTITY_TABLES) {
    if (table === TABLES.mediaBlobs) continue;
    searchedTables += 1;
    const rows = await findAll(table, { includeDeleted: false });
    for (const row of rows) {
      const text = row.text ?? '';
      const score = tokenMatch(text, q);
      if (!score) continue;
      const route = ROUTES[table];
      const meta = route ? route(row) : { path: '/home', title: row.title || row.name || row.label || table, subtitle: row.domain || '', kindLabel: table };
      hits.push({ table, id: row.id, title: meta.title, subtitle: meta.subtitle, path: meta.path, kindLabel: meta.kindLabel, score });
    }
  }

  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return { hits: hits.slice(0, limit), routes, searchedTables, tookMs: Math.round(performance.now() - t0) };
}

/** Command palette style quick items — deterministic, not "suggested for you". */
export function quickRoutes(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return DEPARTMENT_HINTS.filter(([k]) => k.startsWith(q) || q.startsWith(k)).slice(0, 6).map(([_, path, label]) => ({ path, label }));
}
