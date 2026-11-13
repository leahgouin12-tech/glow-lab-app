/**
 * THE GLOW LAB — shared data architecture (Part 33).
 *
 * Every department writes through this one schema. Tables are typed row
 * stores; department-specific extras live in `data` so adding a field never
 * requires a schema migration, while global search, backup and sync keep
 * working because they read the common base columns.
 */

export interface BaseRow {
  id: string;
  /** epoch ms */
  createdAt: number;
  updatedAt: number;
  /** soft delete — restore-safe, filtered by default */
  deletedAt: number | null;
  /** increment on every mutation; used for sync + conflict detection */
  rev: number;
  /** device that last wrote this row */
  deviceId: string;
  tags: string[];
  /** denormalised lowercase search text, rebuilt by repo.put() */
  text: string;
  /** department-specific payload */
  data?: Record<string, any>;
}

export type EvidenceGrade =
  | 'strong'
  | 'moderate'
  | 'limited'
  | 'weak'
  | 'unsupported'
  | 'emerging'
  | 'traditional'
  | 'cosmetic'
  | 'professional'
  | 'dangerous';

export interface ProfileRow extends BaseRow {
  kind: 'personal' | 'appearance' | 'hair' | 'skin' | 'style' | 'fitness' | 'aesthetic-dna' | 'constraints';
  /** profile sections are singletons keyed by kind */
  singleton: 0 | 1;
}
export interface GoalRow extends BaseRow {
  title: string;
  domain: string;
  status: 'active' | 'paused' | 'completed' | 'dropped';
  priority: number;
  startOn: string | null;
  targetOn: string | null;
  metric: string;
  targetValue: number | null;
  unit: string;
  planId: string | null;
}
export interface MeasurementRow extends BaseRow {
  kind: 'body' | 'hair' | 'face' | 'clothing';
  site: string;
  value: number;
  unit: string;
  takenOn: string;
  method: string;
  note: string;
}
export interface WeightRow extends BaseRow {
  kg: number;
  loggedOn: string;
  context: string;
}
export interface RoutineRow extends BaseRow {
  name: string;
  domain: 'skin' | 'hair' | 'makeup' | 'fitness' | 'dental' | 'grooming' | 'fragrance' | 'posture';
  timeOfDay: string;
  active: boolean;
  steps: RoutineStep[];
}
export interface RoutineStep {
  id: string;
  order: number;
  label: string;
  detail: string;
  productId: string | null;
  durationMin: number;
  skipIf: string;
}
export interface RoutineLogRow extends BaseRow {
  routineId: string;
  doneOn: string;
  completedSteps: string[];
  mood: number;
  note: string;
}
export interface ProductRow extends BaseRow {
  name: string;
  category: string;
  brand: string;
  form: string;
  sizeLabel: string;
  pricePaid: number | null;
  currency: string;
  owned: boolean;
  openedOn: string | null;
  expiresOn: string | null;
  finishedOn: string | null;
  rating: number;
  ingredients: string;
  sourceUrl: string;
  status: 'own' | 'want' | 'tried' | 'out' | 'avoid';
  duplicateKey: string;
}
export interface PurchaseRow extends BaseRow {
  productId: string;
  label: string;
  amount: number;
  currency: string;
  boughtOn: string;
  retailer: string;
  orderRef: string;
  reason: string;
  wouldBuyAgain: number | null;
}
export interface ListRow extends BaseRow {
  kind: 'wishlist' | 'shopping';
  name: string;
  budget: number | null;
  period: string;
  items: ListItem[];
  closedOn: string | null;
}
export interface ListItem {
  id: string;
  label: string;
  productId: string | null;
  estPrice: number | null;
  quantity: number;
  neededFor: string;
  linkedMediaId: string | null;
  checked: boolean;
}
export interface ClothingItemRow extends BaseRow {
  name: string;
  category: string;
  brand: string;
  colors: string[];
  size: string;
  material: string;
  fit: string;
  price: number | null;
  boughtOn: string;
  seasons: string[];
  occasions: string[];
  wears: number;
  mediaId: string | null;
  careNotes: string;
}
export interface OutfitRow extends BaseRow {
  name: string;
  itemIds: string[];
  occasion: string;
  season: string;
  aesthetic: string;
  rating: number;
  wornCount: number;
  lastWornOn: string | null;
  mediaId: string | null;
  note: string;
}
export interface HairstyleRow extends BaseRow {
  name: string;
  family: string;
  lengthCm: number | null;
  protective: boolean;
  installMinutes: number;
  takeMinutes: number;
  costLabel: string;
  maintenanceEveryDays: number;
  suitableFor: string[];
  mediaIds: string[];
  tried: boolean;
}
export interface HairRecordRow extends BaseRow {
  kind: 'cut' | 'colour' | 'retwist' | 'treatment' | 'install' | 'take-down' | 'repair' | 'trim' | 'note';
  doneOn: string;
  label: string;
  detail: string;
  cost: number | null;
  professionalId: string | null;
  locCount: number | null;
  locThickness: string;
  lengthCm: number | null;
  mediaIds: string[];
}
export interface ExerciseRow extends BaseRow {
  name: string;
  pattern: string;
  focus: string[];
  equipment: string[];
  difficulty: number;
  cue: string;
  caution: string;
  mediaIds: string[];
}
export interface WorkoutPlanRow extends BaseRow {
  name: string;
  goal: string;
  daysPerWeek: number;
  weeks: number;
  split: WorkoutDay[];
  active: boolean;
}
export interface WorkoutDay {
  id: string;
  label: string;
  focus: string;
  blocks: { exerciseId: string; sets: number; reps: string; restSec: number; note: string }[];
}
export interface WorkoutSessionRow extends BaseRow {
  planDayId: string | null;
  doneOn: string;
  label: string;
  durationMin: number;
  rpe: number;
  entries: { exerciseId: string; sets: { reps: number; kg: number; rpe: number; done: boolean }[] }[];
  note: string;
}
export interface AssessmentRow extends BaseRow {
  name: string;
  takenOn: string;
  baselineMediaIds: string[];
  categories: AssessmentCategory[];
  summary: string;
}
export interface AssessmentCategory {
  id: string;
  label: string;
  baseline: string;
  desired: string;
  options: ImprovementOption[];
  rankScore: number;
  band: 'quick-win' | 'worthwhile' | 'consider' | 'hold' | 'avoid';
  note: string;
}
export interface ImprovementOption {
  id: string;
  label: string;
  techniqueId: string | null;
  impact: number;
  effort: number;
  costBand: 'free' | 'low' | 'mid' | 'high' | 'professional';
  weeksToSee: number;
  reversibility: number;
  risk: number;
  evidence: EvidenceGrade;
  limitations: string;
  nextStep: string;
}
export interface PlanRow extends BaseRow {
  name: string;
  template: string;
  days: number;
  startOn: string;
  reviewEveryDays: number;
  budget: number | null;
  priorities: string[];
  actions: PlanAction[];
  milestones: PlanMilestone[];
  status: 'draft' | 'active' | 'review' | 'done' | 'archived';
  adjustments: { on: string; note: string }[];
}
export interface PlanAction {
  id: string;
  label: string;
  category: string;
  cadence: 'daily' | 'weekly' | 'monthly' | 'once';
  dayOffset: number;
  weeks: number[];
  costBand: string;
  techniqueId: string | null;
  productId: string | null;
  goalId: string | null;
  doneOn: string[];
}
export interface PlanMilestone {
  id: string;
  label: string;
  dueOn: string;
  metOn: string | null;
  mediaId: string | null;
}
export interface TechniqueRow extends BaseRow {
  slug: string;
  title: string;
  domain: string;
  claim: string;
  evidence: EvidenceGrade;
  evidenceSummary: string;
  evidenceGaps: string;
  benefits: string[];
  limitations: string[];
  costBand: string;
  timeToTry: string;
  risks: string[];
  reversibility: string;
  saferAlternatives: string[];
  whenToConsult: string;
  sources: SourceRef[];
  safety: 'ok' | 'caution' | 'unsafe';
}
export interface SourceRef {
  label: string;
  url: string;
  kind: 'study' | 'guideline' | 'review' | 'documentation' | 'other';
  accessedOn: string;
}
export interface KnowledgeEntryRow extends BaseRow {
  title: string;
  kind: 'note' | 'research' | 'reference' | 'observation' | 'skill';
  body: string;
  domain: string;
  confidence: number;
  worked: 'yes' | 'no' | 'mixed' | 'unset';
  linkedGoalIds: string[];
  linkedTechniqueIds: string[];
  linkedProductIds: string[];
  linkedExperimentIds: string[];
}
export interface TutorialRow extends BaseRow {
  slug: string;
  title: string;
  domain: string;
  summary: string;
  difficulty: number;
  minutes: number;
  materials: { label: string; productId: string | null; optional: boolean }[];
  steps: { id: string; order: number; label: string; detail: string; mediaId: string | null; caution: string }[];
  pitfalls: string[];
  relatedTechniqueIds: string[];
  relatedProductIds: string[];
  relatedGoalIds: string[];
  favorite: boolean;
  completedOn: string | null;
  attempts: number;
}
export interface LearningPathRow extends BaseRow {
  title: string;
  goal: string;
  tutorialIds: string[];
  doneIds: string[];
}
export interface MediaItemRow extends BaseRow {
  kind: 'upload' | 'library' | 'progress' | 'outfit' | 'board' | 'product' | 'cover' | 'experiment' | 'baseline';
  album: string;
  title: string;
  caption: string;
  blobId: string | null;
  remoteUrl: string;
  width: number;
  height: number;
  takenOn: string;
  conditions: string;
  pose: string;
  lighting: string;
  distance: string;
  linkedDomain: string;
  linkedIds: string[];
  sourceKind: 'user' | 'glow-lab-original' | 'pexels' | 'unsplash' | 'pixabay' | 'manual-link' | 'pinterest';
  sourceUrl: string;
  attribution: string;
  license: string;
  private: boolean;
  hash: string;
  star: boolean;
}
export interface BoardRow extends BaseRow {
  kind: 'inspiration' | 'moodboard' | 'collection' | 'goal';
  name: string;
  purpose: string;
  identity: string;
  coverMediaId: string | null;
  itemIds: string[];
  palette: string[];
  exported: boolean;
}
export interface DiscoveryItemRow extends BaseRow {
  slug: string;
  providerId: string;
  title: string;
  description: string;
  categories: string[];
  aesthetic: string;
  palette: string[];
  elements: string[];
  mediaId: string | null;
  sourceUrl: string;
  attribution: string;
  license: string;
  recreatable: boolean;
  seed: number;
}
export interface DiscoveryInteractionRow extends BaseRow {
  itemId: string;
  action:
    | 'like'
    | 'unlike'
    | 'dislike'
    | 'hide'
    | 'save'
    | 'unsave'
    | 'try'
    | 'buy'
    | 'own'
    | 'board'
    | 'mood'
    | 'goal'
    | 'more'
    | 'less'
    | 'report'
    | 'view'
    | 'open-source'
    | 'share';
  weight: number;
  boardId: string | null;
  reason: string;
}
export interface ProgressEntryRow extends BaseRow {
  label: string;
  domain: string;
  on: string;
  metric: string;
  value: number | null;
  unit: string;
  rating: number | null;
  note: string;
  mediaIds: string[];
  linkedGoalId: string | null;
  linkedPlanId: string | null;
  linkedExperimentId: string | null;
}
/**
 * One row per calendar date: the self-reported day figures the advice keeps
 * naming (sleep, alcohol, fluids, salty meals, stress, cycle day) and nothing
 * else. Every field is optional and none of them is measured by this app — a
 * phone cannot know how many hours she slept. See `engine/covariates.ts`.
 */
export interface CovariateDayRow extends BaseRow {
  /** `YYYY-MM-DD`. One row per date is the rule the writer enforces. */
  on: string;
  data: {
    sleepHours?: number;
    alcoholUnits?: number;
    waterMl?: number;
    saltyMeals?: number;
    stress?: number;
    cycleDay?: number;
    note?: string;
  };
}
/**
 * One recorded derailment: the day a scheduled thing came apart, her words for
 * why, her words for what would get her back on it, and an optional follow-up
 * date she set herself. Same shape as `CovariateDayRow` — a dated row of her
 * own reporting, nothing measured, nothing inferred.
 *
 * This table explains a miss and never removes one. No count, ratio or streak
 * in `engine/consistency.ts` reads it; see `engine/derailment.ts` for why that
 * is the whole point.
 */
export interface DerailmentRow extends BaseRow {
  /** `YYYY-MM-DD` — the day the miss happened, not the day she wrote this. */
  on: string;
  /** What the record is attached to. `general` is a day with nothing attached. */
  kind: 'routine' | 'plan' | 'action' | 'general';
  /** The routineId / planId / action id, when there was one. */
  refId: string | null;
  /** Snapshot of the name at the time of writing, so the record still reads after a rename or delete. */
  refLabel: string;
  /** Chosen from the fixed chip list in `engine/derailment.ts` — her label for the day, not a measurement. */
  trigger:
    | 'illness'
    | 'travel'
    | 'sleep'
    | 'stress'
    | 'work'
    | 'family'
    | 'money'
    | 'appearance-priority'
    | 'lost-motivation'
    | 'other';
  /** Free text, her words. */
  reason: string;
  /** Free text — what she says would get her back on it. */
  fix: string;
  /** `YYYY-MM-DD` she chooses, or null for none. */
  followUpOn: string | null;
  status: 'open' | 'resolved';
  /** Set when she marks it resolved. */
  resolvedOn: string | null;
}
export interface ExperimentRow extends BaseRow {
  name: string;
  category: string;
  aim: string;
  startOn: string;
  endOn: string;
  baseline: string;
  baselineMediaIds: string[];
  techniqueIds: string[];
  productIds: string[];
  protocol: string;
  observations: { on: string; note: string; mediaIds: string[]; rating: number | null }[];
  result: string;
  resultMediaIds: string[];
  rating: number;
  decision: 'repeat' | 'stop' | 'extend' | 'open';
  confounders: string;
}
export interface ObservationRow extends BaseRow {
  subjectType: string;
  subjectId: string;
  on: string;
  note: string;
  reaction: 'none' | 'good' | 'bad' | 'irritation' | 'breakout' | 'unknown';
  severity: number;
  mediaIds: string[];
}
export interface CalendarEventRow extends BaseRow {
  title: string;
  kind: string;
  startAt: number;
  endAt: number | null;
  recurrence: { freq: 'daily' | 'weekly' | 'monthly'; interval: number; until: string | null; byweekday: number[] };
  reminders: number[];
  checklist: { id: string; label: string; done: boolean }[];
  linkDomain: string;
  linkId: string;
  cost: number | null;
  doneOn: string | null;
  note: string;
}
export interface ProviderRow extends BaseRow {
  discipline: string;
  name: string;
  credentials: string;
  verified: string;
  location: string;
  contact: string;
  website: string;
  rating: number;
  priceNotes: string;
  lastVisitOn: string;
}
export interface ConsultationRow extends BaseRow {
  providerId: string | null;
  procedureTitle: string;
  on: string;
  purpose: string;
  evidence: string;
  limitations: string;
  risks: string;
  reversibility: string;
  recovery: string;
  quote: number | null;
  currency: string;
  questions: { id: string; label: string; asked: boolean; answer: string }[];
  alternatives: string;
  followUpOn: string | null;
  decision: 'considering' | 'scheduled' | 'done' | 'declined';
  beforeMediaIds: string[];
  afterMediaIds: string[];
  expenseLogged: boolean;
}
export interface DentalRow extends BaseRow {
  kind: 'visit' | 'whitening' | 'alignment' | 'hygiene' | 'expense' | 'note' | 'restoration';
  on: string;
  label: string;
  detail: string;
  cost: number | null;
  dentist: string;
  questions: string;
  nextVisitOn: string | null;
  mediaIds: string[];
}
export interface FragranceRow extends BaseRow {
  name: string;
  house: string;
  status: 'own' | 'sample' | 'want' | 'finished';
  family: string;
  topNotes: string[];
  heartNotes: string[];
  baseNotes: string[];
  concentration: string;
  sizeMl: number | null;
  price: number | null;
  boughtOn: string;
  longevityMin: number | null;
  projection: number | null;
  seasons: string[];
  occasions: string[];
  rating: number;
  layeringWith: string[];
  mediaId: string | null;
}
export interface ConversationRow extends BaseRow {
  advisor: string;
  title: string;
  startedOn: string;
  contextScopes: string[];
}
export interface MessageRow extends BaseRow {
  conversationId: string;
  role: 'user' | 'advisor' | 'system';
  body: string;
  on: string;
  engine: 'local-rules' | 'local-rules+provider' | 'provider';
  citations: { label: string; kind: string; id: string }[];
  pendingActions: { id: string; label: string; table: string; payload: Record<string, unknown>; accepted: boolean }[];
}
export interface RecommendationRow extends BaseRow {
  title: string;
  reason: string;
  domain: string;
  score: number;
  factors: { label: string; value: number }[];
  status: 'new' | 'accepted' | 'dismissed' | 'done';
  sourceEngine: string;
  linkTable: string;
  linkId: string;
  evidence: EvidenceGrade | null;
  costBand: string;
}
export interface IntegrationRow extends BaseRow {
  service: string;
  status: 'disconnected' | 'configured' | 'connected' | 'unavailable' | 'error';
  clientId: string;
  scopes: string[];
  token: string;
  tokenExpiresAt: number | null;
  accountLabel: string;
  lastSyncAt: number | null;
  capabilities: string[];
  notes: string;
}
export interface ManualReferenceRow extends BaseRow {
  url: string;
  title: string;
  note: string;
  provider: string;
  boardHint: string;
  imported: boolean;
}
export interface LogRow extends BaseRow {
  channel: 'analysis' | 'capture' | 'sync' | 'advisor' | 'photo' | 'import' | 'error';
  level: 'info' | 'warn' | 'error';
  message: string;
  detail: string;
}
export interface SyncQueueRow extends BaseRow {
  op: 'put' | 'delete';
  targetTable: string;
  targetId: string;
  targetRev: number;
  baseRev: number;
  attempts: number;
  lastError: string;
  payload: string;
  flushGroup: string;
}
export interface ConflictRow extends BaseRow {
  targetTable: string;
  targetId: string;
  localRev: number;
  remoteRev: number;
  resolution: 'pending' | 'local' | 'remote' | 'merged';
  detail: string;
}
export interface SettingRow extends BaseRow {
  key: string;
  value: unknown;
}

export type AnyRow = BaseRow & Record<string, any>;

/** Table names. Registry order drives backup, search and sync. */
export const TABLES = {
  profile: 'profile',
  goals: 'goals',
  measurements: 'measurements',
  weightEntries: 'weightEntries',
  routines: 'routines',
  routineLogs: 'routineLogs',
  products: 'products',
  purchases: 'purchases',
  lists: 'lists',
  clothingItems: 'clothingItems',
  outfits: 'outfits',
  hairstyles: 'hairstyles',
  hairRecords: 'hairRecords',
  exercises: 'exercises',
  workoutPlans: 'workoutPlans',
  workoutSessions: 'workoutSessions',
  assessments: 'assessments',
  plans: 'plans',
  techniques: 'techniques',
  knowledge: 'knowledge',
  tutorials: 'tutorials',
  learningPaths: 'learningPaths',
  mediaItems: 'mediaItems',
  mediaBlobs: 'mediaBlobs',
  boards: 'boards',
  discoveryItems: 'discoveryItems',
  discoveryInteractions: 'discoveryInteractions',
  progressEntries: 'progressEntries',
  covariateDays: 'covariateDays',
  derailments: 'derailments',
  experiments: 'experiments',
  observations: 'observations',
  calendarEvents: 'calendarEvents',
  providers: 'providers',
  consultations: 'consultations',
  dental: 'dental',
  fragrances: 'fragrances',
  conversations: 'conversations',
  messages: 'messages',
  recommendations: 'recommendations',
  integrations: 'integrations',
  manualReferences: 'manualReferences',
  logs: 'logs',
  settings: 'settings',
  syncQueue: 'syncQueue',
  conflicts: 'conflicts'
} as const;

export type TableName = (typeof TABLES)[keyof typeof TABLES];

/** Tables that departments may create rows in through the entity store. */
export const ENTITY_TABLES: TableName[] = (Object.values(TABLES) as TableName[]).filter(
  (t) => t !== 'mediaBlobs' && t !== 'syncQueue' && t !== 'conflicts' && t !== 'logs'
);

export interface MediaBlobRow {
  id: string;
  blob: Blob;
  thumb: Blob;
  createdAt: number;
  bytes: number;
  mime: string;
}

export type RowFor<T extends TableName> = T extends 'profile'
  ? ProfileRow
  : T extends 'goals'
    ? GoalRow
    : T extends 'measurements'
      ? MeasurementRow
      : T extends 'weightEntries'
        ? WeightRow
        : T extends 'routines'
          ? RoutineRow
          : T extends 'routineLogs'
            ? RoutineLogRow
            : T extends 'products'
              ? ProductRow
              : T extends 'purchases'
                ? PurchaseRow
                : T extends 'lists'
                  ? ListRow
                  : T extends 'clothingItems'
                    ? ClothingItemRow
                    : T extends 'outfits'
                      ? OutfitRow
                      : T extends 'hairstyles'
                        ? HairstyleRow
                        : T extends 'hairRecords'
                          ? HairRecordRow
                          : T extends 'exercises'
                            ? ExerciseRow
                            : T extends 'workoutPlans'
                              ? WorkoutPlanRow
                              : T extends 'workoutSessions'
                                ? WorkoutSessionRow
                                : T extends 'assessments'
                                  ? AssessmentRow
                                  : T extends 'plans'
                                    ? PlanRow
                                    : T extends 'techniques'
                                      ? TechniqueRow
                                      : T extends 'knowledge'
                                        ? KnowledgeEntryRow
                                        : T extends 'tutorials'
                                          ? TutorialRow
                                          : T extends 'learningPaths'
                                            ? LearningPathRow
                                            : T extends 'mediaItems'
                                              ? MediaItemRow
                                              : T extends 'boards'
                                                ? BoardRow
                                                : T extends 'discoveryItems'
                                                  ? DiscoveryItemRow
                                                  : T extends 'discoveryInteractions'
                                                    ? DiscoveryInteractionRow
                                                    : T extends 'progressEntries'
                                                      ? ProgressEntryRow
                                                      : T extends 'experiments'
                                                        ? ExperimentRow
                                                        : T extends 'observations'
                                                          ? ObservationRow
                                                          : T extends 'calendarEvents'
                                                            ? CalendarEventRow
                                                            : T extends 'providers'
                                                              ? ProviderRow
                                                              : T extends 'consultations'
                                                                ? ConsultationRow
                                                                : T extends 'dental'
                                                                  ? DentalRow
                                                                  : T extends 'fragrances'
                                                                    ? FragranceRow
                                                                    : T extends 'conversations'
                                                                      ? ConversationRow
                                                                      : T extends 'messages'
                                                                        ? MessageRow
                                                                        : T extends 'recommendations'
                                                                          ? RecommendationRow
                                                                          : T extends 'integrations'
                                                                            ? IntegrationRow
                                                                            : T extends 'manualReferences'
                                                                              ? ManualReferenceRow
                                                                              : T extends 'settings'
                                                                                ? SettingRow
                                                                                : T extends 'covariateDays'
                                                                                  ? CovariateDayRow
                                                                                  : T extends 'derailments'
                                                                                    ? DerailmentRow
                                                                                    : AnyRow;
