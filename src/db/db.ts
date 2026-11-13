import Dexie, { type Table } from 'dexie';
import type { MediaBlobRow, TableName } from './schema';

/**
 * Schema v1 (2026-11-12): initial local-first store.
 * Indexes are chosen for the queries departments actually run; `updatedAt`
 * powers recency lists, `deletedAt` powers restore-safe deletion, and every
 * row carries `text` for global search.
 */
export class GlowLabDB extends Dexie {
  declare profile: Table<any, string>;
  declare goals: Table<any, string>;
  declare measurements: Table<any, string>;
  declare weightEntries: Table<any, string>;
  declare routines: Table<any, string>;
  declare routineLogs: Table<any, string>;
  declare products: Table<any, string>;
  declare purchases: Table<any, string>;
  declare lists: Table<any, string>;
  declare clothingItems: Table<any, string>;
  declare outfits: Table<any, string>;
  declare hairstyles: Table<any, string>;
  declare hairRecords: Table<any, string>;
  declare exercises: Table<any, string>;
  declare workoutPlans: Table<any, string>;
  declare workoutSessions: Table<any, string>;
  declare assessments: Table<any, string>;
  declare plans: Table<any, string>;
  declare techniques: Table<any, string>;
  declare knowledge: Table<any, string>;
  declare tutorials: Table<any, string>;
  declare learningPaths: Table<any, string>;
  declare mediaItems: Table<any, string>;
  declare mediaBlobs: Table<MediaBlobRow, string>;
  declare boards: Table<any, string>;
  declare discoveryItems: Table<any, string>;
  declare discoveryInteractions: Table<any, string>;
  declare progressEntries: Table<any, string>;
  declare covariateDays: Table<any, string>;
  declare derailments: Table<any, string>;
  declare experiments: Table<any, string>;
  declare observations: Table<any, string>;
  declare calendarEvents: Table<any, string>;
  declare providers: Table<any, string>;
  declare consultations: Table<any, string>;
  declare dental: Table<any, string>;
  declare fragrances: Table<any, string>;
  declare conversations: Table<any, string>;
  declare messages: Table<any, string>;
  declare recommendations: Table<any, string>;
  declare integrations: Table<any, string>;
  declare manualReferences: Table<any, string>;
  declare logs: Table<any, string>;
  declare settings: Table<any, string>;
  declare syncQueue: Table<any, string>;
  declare conflicts: Table<any, string>;

  constructor() {
    super('glow-lab');
    // `id` is the primary key and is implicitly indexed; repeating it (or any
    // index name) in the same table string makes IndexedDB throw ConstraintError
    // during createIndex, which closes the database before any page can read it.
    const common = 'updatedAt, createdAt, deletedAt, tags, text';
    this.version(1).stores({
      profile: `id, kind, singleton, ${common}`,
      goals: `id, domain, status, priority, targetOn, ${common}`,
      measurements: `id, kind, site, takenOn, ${common}`,
      weightEntries: `id, loggedOn, ${common}`,
      routines: `id, domain, timeOfDay, active, ${common}`,
      routineLogs: `id, routineId, doneOn, ${common}`,
      products: `id, category, brand, owned, status, duplicateKey, expiresOn, ${common}`,
      purchases: `id, productId, boughtOn, ${common}`,
      lists: `id, kind, name, ${common}`,
      clothingItems: `id, category, brand, sizes: size, seasons, occasions, ${common}`,
      outfits: `id, occasion, season, aesthetic, itemIds, ${common}`,
      hairstyles: `id, family, protective, tried, ${common}`,
      hairRecords: `id, kind, doneOn, professionalId, ${common}`,
      exercises: `id, pattern, focus, equipment, ${common}`,
      workoutPlans: `id, goal, active, ${common}`,
      workoutSessions: `id, planDayId, doneOn, ${common}`,
      assessments: `id, takenOn, name, ${common}`,
      plans: `id, template, status, startOn, ${common}`,
      techniques: `id, slug, domain, evidence, safety, ${common}`,
      knowledge: `id, kind, domain, confidence, worked, linkedGoalIds, ${common}`,
      tutorials: `id, slug, domain, difficulty, favorite, completedOn, ${common}`,
      learningPaths: `id, title, ${common}`,
      mediaItems: `id, kind, album, sourceKind, takenOn, linkedDomain, blobId, private, star, ${common}`,
      mediaBlobs: 'id, createdAt',
      boards: `id, kind, name, identity, ${common}`,
      discoveryItems: `id, slug, providerId, aesthetic, categories, recreatable, ${common}`,
      discoveryInteractions: `id, itemId, action, boardId, ${common}`,
      progressEntries: `id, domain, on, metric, linkedGoalId, linkedPlanId, ${common}`,
      experiments: `id, category, decision, startOn, endOn, ${common}`,
      observations: `id, subjectType, subjectId, on, reaction, ${common}`,
      calendarEvents: `id, kind, startAt, linkId, doneOn, ${common}`,
      providers: `id, discipline, name, ${common}`,
      consultations: `id, providerId, decision, on, ${common}`,
      dental: `id, kind, on, nextVisitOn, ${common}`,
      fragrances: `id, status, family, house, rating, ${common}`,
      conversations: `id, advisor, startedOn, ${common}`,
      messages: `id, conversationId, role, on, ${common}`,
      recommendations: `id, domain, status, score, sourceEngine, linkId, ${common}`,
      integrations: `id, service, status, ${common}`,
      manualReferences: `id, provider, url, imported, ${common}`,
      logs: `id, channel, level, ${common}`,
      settings: `id, key, ${common}`,
      syncQueue: `id, targetTable, targetId, attempts, flushGroup, createdAt`,
      conflicts: `id, targetTable, targetId, resolution, createdAt`
    });

    /*
     * Schema v2 (2026-11-12): the day log. Additive only — v1 stores are
     * untouched, so an existing library opens with every row it already had and
     * one new empty table. Indexed on `on` because the writer looks up the date
     * before it decides between creating and patching a row.
     */
    this.version(2).stores({
      covariateDays: `id, on, ${common}`
    });

    /*
     * Schema v3 (2026-11-13): the derailment record. Additive only — v1 and v2
     * stores are untouched, so an existing library opens with every row it
     * already had and one new empty table. Indexed on `on` because the weekly
     * digest looks records up by date, and on `kind`, `status`, `refId` because
     * the tally and the follow-up list filter by them.
     */
    this.version(3).stores({
      derailments: `id, on, kind, status, refId, ${common}`
    });
  }
}

export const db = new GlowLabDB();

export function tableOf<T extends TableName>(name: T) {
  return db.table(name) as any;
}

export async function openOrThrow() {
  await db.open();
  return db;
}
