import { TABLES, type AnyRow, type RowFor, type TableName } from './schema';
import { todayISO } from './repo';

/**
 * THE GLOW LAB — CSV export (the spreadsheet half of Part 34).
 *
 * The ZIP backup is for restoring; a CSV is for her to open in a spreadsheet
 * and pivot her own records. Two rules govern everything in this file:
 *
 * 1. Nothing is invented and nothing is summarised in place of a real value.
 *    A cell holds what the row holds. Where a spreadsheet has no shape for
 *    something (the sets inside a workout session) the value is written as
 *    compact JSON in one cell rather than dropped or flattened into a guess.
 * 2. Every table exports. Department maps below make the headers read as
 *    English for the departments she works in most; everything else falls
 *    through to the generic writer, which unions the keys across all her rows
 *    so one missing optional field never deletes a column for the whole file.
 *
 * Encoding notes that are deliberate, not accidental:
 * - RFC 4180 quoting: a field is wrapped in quotes only when it contains the
 *   delimiter, a double quote, CR or LF; inner quotes are doubled. Fields that
 *   do not need it are left bare, so `0012` reaches the file exactly as the
 *   string she typed (no numeric coercion here, and no `="0012"` tricks that
 *   would put text in her data that she never wrote).
 * - A UTF-8 BOM leads the file so Excel opens her characters correctly.
 * - Binary is never carried in a cell. A Blob, File, ArrayBuffer or typed array
 *   becomes the marker `[binary omitted]`; the ZIP backup is what holds files.
 * - `createdAt` / `updatedAt` / `deletedAt` are stored as epoch milliseconds.
 *   They are written as ISO timestamps, which is the same instant in a form a
 *   spreadsheet understands — the raw number is not lost, it is translated.
 * - `text` (the lowercase haystack repo.put builds for search) is a machine
 *   copy of words that are already in her other columns, so it is off unless
 *   she asks for it with `withSearchText`.
 */

export const CSV_DELIMITER = ',';
export const CSV_LINE = '\r\n';
/** Leading UTF-8 BOM, so Excel opens her characters correctly. */
export const CSV_BOM = '\uFEFF';
export const BINARY_PLACEHOLDER = '[binary omitted]';
export const LIST_JOINER = ' | ';
export const CSV_FILE_PREFIX = 'glowlab';

/** The byte Excel needs to read a UTF-8 CSV as UTF-8. */
export function bom(): string {
  return CSV_BOM;
}

/** Every table name in registry order — the same order backup and search walk. */
export const TABLE_KEYS = Object.values(TABLES) as TableName[];

/* ------------------------------------------------------------------ encoding */

function typeTag(value: object): string {
  return Object.prototype.toString.call(value);
}

/** Blob, File, ArrayBuffer or any typed array / DataView. */
const BINARY_TAGS = new Set([
  '[object ArrayBuffer]',
  '[object SharedArrayBuffer]',
  '[object DataView]',
  '[object Blob]',
  '[object File]',
  '[object Uint8Array]',
  '[object Uint8ClampedArray]',
  '[object Int8Array]',
  '[object Uint16Array]',
  '[object Int16Array]',
  '[object Uint32Array]',
  '[object Int32Array]',
  '[object Float32Array]',
  '[object Float64Array]',
  '[object BigInt64Array]',
  '[object BigUint64Array]'
]);

export function isBinary(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
  if (typeof ArrayBuffer !== 'undefined' && (value instanceof ArrayBuffer || ArrayBuffer.isView(value))) return true;
  /* An explicit tag list, never a loose pattern: `[object Array]` would match
     "…Array" and quietly turn every ordinary list of hers into a marker. */
  return BINARY_TAGS.has(typeTag(value));
}

function isScalar(value: unknown): boolean {
  return value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/**
 * One row value → one CSV field string. Dates go ISO, arrays of scalars join
 * with " | ", nested structures go compact JSON (binaries inside them become
 * the marker), binaries anywhere become the marker, and a missing value is an
 * empty cell rather than the word "undefined".
 */
export function toCsvValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return value.toString();
  if (isBinary(value)) return BINARY_PLACEHOLDER;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (Array.isArray(value)) {
    if (!value.length) return '';
    if (value.every(isScalar)) return value.map((v) => toCsvValue(v)).join(LIST_JOINER);
    return safeJson(value);
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    if (!keys.length) return '';
    return safeJson(value);
  }
  return '';
}

/** JSON that never throws and never smuggles a base64 blob into a cell. */
function safeJson(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    const text = JSON.stringify(value, (_key, val) => {
      if (isBinary(val)) return BINARY_PLACEHOLDER;
      if (val && typeof val === 'object') {
        if (seen.has(val as object)) return '[circular]';
        seen.add(val as object);
      }
      return val;
    });
    return text ?? '';
  } catch {
    return '[unserialisable value]';
  }
}

function needsQuoting(text: string, delimiter: string): boolean {
  if (text.includes('"') || text.includes('\n') || text.includes('\r')) return true;
  for (const d of delimiter) if (text.includes(d)) return true;
  return false;
}

/** A whole CSV field: the value, quoted only when RFC 4180 requires it. */
export function csvCell(value: unknown, delimiter: string = CSV_DELIMITER): string {
  const text = toCsvValue(value);
  return needsQuoting(text, delimiter) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Rows of fields that `csvCell` has already encoded, joined by the delimiter
 * with CRLF line endings — RFC 4180's line shape. This function never quotes,
 * because quoting is `csvCell`'s job and doing it twice would double-escape.
 */
export function joinCsv(rows: string[][], delimiter: string = CSV_DELIMITER): string {
  return (rows ?? []).map((row) => (row ?? []).join(delimiter)).join(CSV_LINE);
}

/* ----------------------------------------------------------------- labelling */

/**
 * Department names per table. `globalSearch.ts` carries the same vocabulary in
 * its private `ROUTES` map (`Garment`, `Outfit`, `Progress`, `Professional`…)
 * but that object is module-private and the file is closed to edits this
 * round, so the names live here as the one list the CSV writer and the Settings
 * block share — a second place to keep them honest does not exist.
 *
 * Typed as a partial map on purpose: another department may add a table to the
 * registry, and `departmentLabel` then spaces the key out rather than leaving a
 * table nameless (and nameless is what a `Record<TableName, …>` would become at
 * runtime the moment the compiler stops being able to insist).
 */
const DEPARTMENT_LABELS: Partial<Record<TableName, string>> = {
  [TABLES.profile]: 'Profile sections',
  [TABLES.goals]: 'Goals',
  [TABLES.measurements]: 'Body measurements',
  [TABLES.weightEntries]: 'Weight entries',
  [TABLES.routines]: 'Routines',
  [TABLES.routineLogs]: 'Routine logs',
  [TABLES.products]: 'Products',
  [TABLES.purchases]: 'Purchases',
  [TABLES.lists]: 'Lists',
  [TABLES.clothingItems]: 'Closet garments',
  [TABLES.outfits]: 'Outfits',
  [TABLES.hairstyles]: 'Hairstyles',
  [TABLES.hairRecords]: 'Hair records',
  [TABLES.exercises]: 'Exercise library',
  [TABLES.workoutPlans]: 'Workout plans',
  [TABLES.workoutSessions]: 'Workout sessions',
  [TABLES.assessments]: 'Assessments',
  [TABLES.plans]: 'Plans',
  [TABLES.techniques]: 'Techniques',
  [TABLES.knowledge]: 'Knowledge notes',
  [TABLES.tutorials]: 'Tutorials',
  [TABLES.learningPaths]: 'Learning paths',
  [TABLES.mediaItems]: 'Media records',
  [TABLES.mediaBlobs]: 'Media files',
  [TABLES.boards]: 'Boards',
  [TABLES.discoveryItems]: 'Discovery items',
  [TABLES.discoveryInteractions]: 'Discovery taps',
  [TABLES.progressEntries]: 'Progress entries',
  [TABLES.covariateDays]: 'Day log',
  [TABLES.derailments]: 'Derailment records',
  [TABLES.experiments]: 'Experiments',
  [TABLES.observations]: 'Observations',
  [TABLES.calendarEvents]: 'Calendar events',
  [TABLES.providers]: 'Professionals',
  [TABLES.consultations]: 'Consultations',
  [TABLES.dental]: 'Dental records',
  [TABLES.fragrances]: 'Fragrance wardrobe',
  [TABLES.conversations]: 'Advisor conversations',
  [TABLES.messages]: 'Advisor messages',
  [TABLES.recommendations]: 'Recommendations',
  [TABLES.integrations]: 'Integrations',
  [TABLES.manualReferences]: 'Reference links',
  [TABLES.logs]: 'Activity log',
  [TABLES.settings]: 'Settings',
  [TABLES.syncQueue]: 'Sync queue',
  [TABLES.conflicts]: 'Sync conflicts'
};

export function departmentLabel(table: TableName): string {
  return DEPARTMENT_LABELS[table] ?? humanKey(String(table));
}

/** Departments for a picker, sorted by label. */
export const CSV_DEPARTMENTS: { table: TableName; label: string }[] = (Object.values(TABLES) as TableName[])
  .map((table) => ({ table, label: departmentLabel(table) }))
  .sort((a, b) => a.label.localeCompare(b.label));

/**
 * Label → filename-safe ASCII slug: spaces and punctuation become single
 * dashes, accents are folded off (`Größe` → `grosse`) and nothing is added.
 */
export function slugify(text: string): string {
  const transliterated = String(text ?? '')
    .replace(/ß/g, 'ss')
    .replace(/æ|Æ/g, 'ae')
    .replace(/œ|Œ/g, 'oe')
    .replace(/ø|Ø/g, 'o')
    .replace(/đ|Đ|ð|Ð/g, 'd')
    .replace(/þ|Þ/g, 'th')
    .replace(/ł|Ł/g, 'l');
  return transliterated
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `glowlab-closet-garments-2026-11-13.csv` */
export function csvFileName(table: TableName, today: string = todayISO(), label: string = departmentLabel(table)): string {
  const slug = slugify(label) || slugify(departmentLabel(table)) || slugify(String(table)) || 'records';
  return `${CSV_FILE_PREFIX}-${slug}-${today}.csv`;
}

/** Tiny helper so the UI can say "N rows" without re-deriving the filter. */
export function countFor(rows: readonly unknown[] | null | undefined): number {
  return Array.isArray(rows) ? rows.length : 0;
}

/* ------------------------------------------------------------------- columns */

export interface CsvColumn {
  /** header text as it appears in row 1 of the file */
  label: string;
  /** row keys this column reads, so no key is silently exported twice */
  keys?: readonly string[];
  /** reads the value; defaults to the row's own `keys[0]` */
  get?: (row: AnyRow) => unknown;
}

export interface CsvOptions {
  /** keep soft-deleted rows; also puts `Deleted at` in the header */
  includeDeleted?: boolean;
  /** include the denormalised lowercase search haystack */
  withSearchText?: boolean;
  delimiter?: string;
}

function col(label: string, key: string): CsvColumn {
  return { label, keys: [key] };
}

function pick(label: string, get: (row: AnyRow) => unknown, ...keys: string[]): CsvColumn {
  return { label, keys, get };
}

/** epoch ms → ISO timestamp; anything else passes through unchanged. */
function stamp(value: unknown): unknown {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return value;
}

/** `careNotes` → `Care notes` — spacing a key out, never renaming what it means. */
function humanKey(key: string): string {
  const spaced = String(key)
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const ENVELOPE_KEYS = ['id', 'createdAt', 'updatedAt', 'rev', 'deviceId', 'tags', 'text', 'data'] as const;

function envelopeColumn(key: string): CsvColumn {
  switch (key) {
    case 'id':
      return col('Row ID', 'id');
    case 'createdAt':
      return pick('Created at', (r) => stamp(r.createdAt), 'createdAt');
    case 'updatedAt':
      return pick('Updated at', (r) => stamp(r.updatedAt), 'updatedAt');
    case 'rev':
      return col('Revision', 'rev');
    case 'deviceId':
      return col('Device ID', 'deviceId');
    case 'tags':
      return col('Tags', 'tags');
    case 'text':
      return col('Search text', 'text');
    default:
      return col('Extra data (JSON)', 'data');
  }
}

const hasValue = (value: unknown): boolean => {
  if (value === undefined || value === null || value === '') return false;
  /* a photograph is a value even though its bytes never go in the cell */
  if (isBinary(value)) return true;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Date) return true;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
};

/**
 * The high-value departments, mapped by hand against the real row types in
 * `schema.ts`. `products` is the makeup and skincare register (there is no
 * separate makeupItems/skincareItems table), `calendarEvents` carries the
 * appointments, `knowledge` carries her notes and `exercises` is the
 * movement library.
 */
const COLUMN_MAPS: Partial<Record<TableName, CsvColumn[]>> = {
  [TABLES.goals]: [
    col('Goal', 'title'),
    col('Domain', 'domain'),
    col('Status', 'status'),
    col('Priority', 'priority'),
    col('Starts on', 'startOn'),
    col('Target date', 'targetOn'),
    col('Metric', 'metric'),
    col('Target value', 'targetValue'),
    col('Unit', 'unit'),
    col('Plan ID', 'planId')
  ],
  [TABLES.measurements]: [
    col('Taken on', 'takenOn'),
    col('Kind', 'kind'),
    col('Site', 'site'),
    col('Value', 'value'),
    col('Unit', 'unit'),
    col('Method', 'method'),
    col('Note', 'note')
  ],
  [TABLES.weightEntries]: [
    col('Logged on', 'loggedOn'),
    col('Weight (kg)', 'kg'),
    col('Context', 'context')
  ],
  [TABLES.routines]: [
    col('Routine', 'name'),
    col('Domain', 'domain'),
    col('Time of day', 'timeOfDay'),
    col('Active', 'active'),
    pick('Steps (JSON)', (r) => r.steps, 'steps')
  ],
  [TABLES.routineLogs]: [
    col('Done on', 'doneOn'),
    col('Routine ID', 'routineId'),
    col('Steps completed', 'completedSteps'),
    col('Mood', 'mood'),
    col('Note', 'note')
  ],
  [TABLES.products]: [
    col('Product', 'name'),
    col('Category', 'category'),
    col('Brand', 'brand'),
    col('Form', 'form'),
    col('Size', 'sizeLabel'),
    col('Price paid', 'pricePaid'),
    col('Currency', 'currency'),
    col('Status', 'status'),
    col('Owned', 'owned'),
    col('Opened on', 'openedOn'),
    col('Expires on', 'expiresOn'),
    col('Finished on', 'finishedOn'),
    col('Rating', 'rating'),
    col('Ingredients', 'ingredients'),
    col('Source URL', 'sourceUrl'),
    col('Duplicate key', 'duplicateKey')
  ],
  [TABLES.purchases]: [
    col('Bought on', 'boughtOn'),
    col('Item', 'label'),
    col('Amount', 'amount'),
    col('Currency', 'currency'),
    col('Retailer', 'retailer'),
    col('Product ID', 'productId'),
    col('Order reference', 'orderRef'),
    col('Reason', 'reason'),
    col('Would buy again', 'wouldBuyAgain')
  ],
  [TABLES.clothingItems]: [
    col('Garment', 'name'),
    col('Category', 'category'),
    col('Brand', 'brand'),
    col('Colours', 'colors'),
    col('Size', 'size'),
    col('Material', 'material'),
    col('Fit', 'fit'),
    col('Price', 'price'),
    col('Bought on', 'boughtOn'),
    col('Seasons', 'seasons'),
    col('Occasions', 'occasions'),
    col('Wears', 'wears'),
    col('Care notes', 'careNotes'),
    col('Photo ID', 'mediaId')
  ],
  [TABLES.outfits]: [
    col('Outfit', 'name'),
    col('Occasion', 'occasion'),
    col('Season', 'season'),
    col('Aesthetic', 'aesthetic'),
    col('Rating', 'rating'),
    col('Times worn', 'wornCount'),
    col('Last worn on', 'lastWornOn'),
    col('Garment IDs', 'itemIds'),
    col('Note', 'note'),
    col('Photo ID', 'mediaId')
  ],
  [TABLES.exercises]: [
    col('Exercise', 'name'),
    col('Pattern', 'pattern'),
    col('Focus', 'focus'),
    col('Equipment', 'equipment'),
    col('Difficulty', 'difficulty'),
    col('Cue', 'cue'),
    col('Caution', 'caution'),
    col('Media IDs', 'mediaIds')
  ],
  [TABLES.workoutSessions]: [
    col('Done on', 'doneOn'),
    col('Session', 'label'),
    col('Duration (min)', 'durationMin'),
    col('RPE', 'rpe'),
    col('Plan day ID', 'planDayId'),
    pick('Entries (JSON)', (r) => r.entries, 'entries'),
    col('Note', 'note')
  ],
  [TABLES.plans]: [
    col('Plan', 'name'),
    col('Template', 'template'),
    col('Status', 'status'),
    col('Starts on', 'startOn'),
    col('Days', 'days'),
    col('Review every (days)', 'reviewEveryDays'),
    col('Budget', 'budget'),
    col('Priorities', 'priorities'),
    pick('Actions (JSON)', (r) => r.actions, 'actions'),
    pick('Milestones (JSON)', (r) => r.milestones, 'milestones'),
    pick('Adjustments (JSON)', (r) => r.adjustments, 'adjustments')
  ],
  [TABLES.knowledge]: [
    col('Title', 'title'),
    col('Kind', 'kind'),
    col('Domain', 'domain'),
    col('Confidence', 'confidence'),
    col('Worked', 'worked'),
    col('Body', 'body'),
    col('Goal IDs', 'linkedGoalIds'),
    col('Technique IDs', 'linkedTechniqueIds'),
    col('Product IDs', 'linkedProductIds'),
    col('Experiment IDs', 'linkedExperimentIds')
  ],
  [TABLES.progressEntries]: [
    col('On', 'on'),
    col('Label', 'label'),
    col('Domain', 'domain'),
    col('Metric', 'metric'),
    col('Value', 'value'),
    col('Unit', 'unit'),
    col('Rating', 'rating'),
    col('Note', 'note'),
    col('Photo IDs', 'mediaIds'),
    col('Goal ID', 'linkedGoalId'),
    col('Plan ID', 'linkedPlanId'),
    col('Experiment ID', 'linkedExperimentId')
  ],
  [TABLES.covariateDays]: [
    col('Date', 'on'),
    pick('Sleep hours', (r) => (r.data as AnyRow | undefined)?.sleepHours, 'data'),
    pick('Alcohol units', (r) => (r.data as AnyRow | undefined)?.alcoholUnits),
    pick('Water (ml)', (r) => (r.data as AnyRow | undefined)?.waterMl),
    pick('Salty meals', (r) => (r.data as AnyRow | undefined)?.saltyMeals),
    pick('Stress', (r) => (r.data as AnyRow | undefined)?.stress),
    pick('Cycle day', (r) => (r.data as AnyRow | undefined)?.cycleDay),
    pick('Day note', (r) => (r.data as AnyRow | undefined)?.note)
  ],
  [TABLES.derailments]: [
    col('Date', 'on'),
    col('Attached to', 'kind'),
    col('Record', 'refLabel'),
    col('Record ID', 'refId'),
    col('Trigger', 'trigger'),
    col('Her words on why', 'reason'),
    col('What gets her back on it', 'fix'),
    col('Status', 'status'),
    col('Follow-up on', 'followUpOn'),
    col('Resolved on', 'resolvedOn')
  ],
  [TABLES.calendarEvents]: [
    col('Event', 'title'),
    col('Kind', 'kind'),
    pick('Starts at', (r) => stamp(r.startAt), 'startAt'),
    pick('Ends at', (r) => stamp(r.endAt), 'endAt'),
    col('Link domain', 'linkDomain'),
    col('Link ID', 'linkId'),
    col('Cost', 'cost'),
    col('Done on', 'doneOn'),
    pick('Recurrence (JSON)', (r) => r.recurrence, 'recurrence'),
    pick('Reminders', (r) => r.reminders, 'reminders'),
    pick('Checklist (JSON)', (r) => r.checklist, 'checklist'),
    col('Note', 'note')
  ],
  [TABLES.providers]: [
    col('Name', 'name'),
    col('Discipline', 'discipline'),
    col('Credentials', 'credentials'),
    col('Verification', 'verified'),
    col('Location', 'location'),
    col('Contact', 'contact'),
    col('Website', 'website'),
    col('Rating', 'rating'),
    col('Price notes', 'priceNotes'),
    col('Last visit on', 'lastVisitOn')
  ],
  [TABLES.consultations]: [
    col('Date', 'on'),
    col('Procedure', 'procedureTitle'),
    col('Provider ID', 'providerId'),
    col('Purpose', 'purpose'),
    col('Evidence', 'evidence'),
    col('Limitations', 'limitations'),
    col('Risks', 'risks'),
    col('Reversibility', 'reversibility'),
    col('Recovery', 'recovery'),
    col('Quote', 'quote'),
    col('Currency', 'currency'),
    col('Decision', 'decision'),
    col('Follow-up on', 'followUpOn'),
    col('Alternatives', 'alternatives'),
    pick('Questions (JSON)', (r) => r.questions, 'questions'),
    col('Before photo IDs', 'beforeMediaIds'),
    col('After photo IDs', 'afterMediaIds'),
    col('Expense logged', 'expenseLogged')
  ],
  [TABLES.fragrances]: [
    col('Fragrance', 'name'),
    col('House', 'house'),
    col('Status', 'status'),
    col('Family', 'family'),
    col('Top notes', 'topNotes'),
    col('Heart notes', 'heartNotes'),
    col('Base notes', 'baseNotes'),
    col('Concentration', 'concentration'),
    col('Size (ml)', 'sizeMl'),
    col('Price', 'price'),
    col('Bought on', 'boughtOn'),
    col('Longevity (min)', 'longevityMin'),
    col('Projection', 'projection'),
    col('Seasons', 'seasons'),
    col('Occasions', 'occasions'),
    col('Rating', 'rating'),
    col('Layering with', 'layeringWith'),
    col('Photo ID', 'mediaId')
  ],
  [TABLES.manualReferences]: [
    col('Title', 'title'),
    col('URL', 'url'),
    col('Provider', 'provider'),
    col('Note', 'note'),
    col('Board hint', 'boardHint'),
    col('Imported', 'imported')
  ]
};

/** A table's hand-written header, when it has one. */
export function hasColumnMap(table: TableName): boolean {
  return COLUMN_MAPS[table] !== undefined;
}

function keepRows(rows: readonly AnyRow[] | null | undefined, opts: CsvOptions): AnyRow[] {
  const list = Array.isArray(rows) ? (rows as unknown[]) : [];
  return list.filter((row): row is AnyRow => {
    if (!row || typeof row !== 'object') return false;
    if (!opts.includeDeleted && (row as AnyRow).deletedAt) return false;
    return true;
  });
}

/**
 * Header columns for this table and this set of rows: mapped department
 * columns first, then any key the rows carry that the map does not mention,
 * then the shared row envelope. Keys are unioned across every row, so a first
 * row missing an optional field cannot take that column away.
 */
export function csvColumns(table: TableName, rows: readonly AnyRow[], opts: CsvOptions = {}): CsvColumn[] {
  const kept = keepRows(rows, opts);
  const mapped = COLUMN_MAPS[table] ?? [];
  const seen = new Set<string>();
  for (const row of kept) for (const key of Object.keys(row)) seen.add(key);

  const mappedKeys = new Set<string>(mapped.flatMap((c) => [...(c.keys ?? [])]));
  const covered = new Set<string>(mappedKeys);
  const columns: CsvColumn[] = [...mapped];

  const envelopeWanted = (key: string): boolean => {
    /* a department map that already reads the key owns it — `data` on the day
       log is flattened into its own columns, so it is not also dumped as JSON */
    if (mappedKeys.has(key)) return false;
    if (key === 'text') return opts.withSearchText === true && seen.has('text');
    if (key === 'data') return kept.some((r) => hasValue((r as AnyRow).data));
    if (kept.length) return seen.has(key);
    return key !== 'data';
  };
  for (const key of ENVELOPE_KEYS) if (envelopeWanted(key)) covered.add(key);

  const extras = [...seen]
    .filter((key) => !(ENVELOPE_KEYS as readonly string[]).includes(key) && key !== 'deletedAt' && !covered.has(key))
    .filter((key) => (mapped.length ? kept.some((r) => hasValue((r as AnyRow)[key])) : true))
    .sort((a, b) => a.localeCompare(b));
  for (const key of extras) columns.push(col(humanKey(key), key));

  for (const key of ENVELOPE_KEYS) if (envelopeWanted(key)) columns.push(envelopeColumn(key));
  if (opts.includeDeleted) columns.push(pick('Deleted at', (r) => stamp(r.deletedAt), 'deletedAt'));
  return columns;
}

function readCell(column: CsvColumn, row: AnyRow, delimiter: string): string {
  const raw = column.get ? column.get(row) : column.keys?.length ? (row as AnyRow)[column.keys[0]] : undefined;
  return csvCell(raw, delimiter);
}

export interface CsvGrid {
  /** header cells, in file order */
  header: string[];
  /** encoded body rows, in file order */
  rows: string[][];
  columns: CsvColumn[];
  /** rows that were dropped by the deleted-row filter */
  skipped: number;
}

/**
 * The whole table as a grid of encoded cells. `previewRows` limits how many
 * body rows are encoded (the header still comes from every row) so the Settings
 * preview can show the real first rows without building a 5,000-row file.
 */
export function csvGrid(table: TableName, rows: readonly AnyRow[], opts: CsvOptions = {}, previewRows?: number): CsvGrid {
  const all = Array.isArray(rows) ? (rows as unknown[]) : [];
  const kept = keepRows(rows, opts);
  const delimiter = opts.delimiter ?? CSV_DELIMITER;
  const columns = csvColumns(table, kept, opts);
  const body = Number.isFinite(previewRows) ? kept.slice(0, Math.max(0, previewRows as number)) : kept;
  const header = columns.map((c) => csvCell(c.label, delimiter));
  return {
    header,
    columns,
    rows: body.map((row) => columns.map((c) => readCell(c, row as AnyRow, delimiter))),
    skipped: all.length - kept.length
  };
}

/** The file body: header row, then one row per record, CRLF, BOM first. */
export function csvFor<T extends TableName>(table: T, rows: readonly AnyRow[] | readonly RowFor<T>[], opts: CsvOptions = {}): string {
  const grid = csvGrid(table, rows as readonly AnyRow[], opts);
  return bom() + joinCsv([grid.header, ...grid.rows], opts.delimiter ?? CSV_DELIMITER);
}

/**
 * Undo RFC 4180 quoting: what a spreadsheet shows once it has opened the cell.
 * The Settings preview renders through this so she reads her own values, while
 * the bytes written to the file stay quoted exactly as the standard asks.
 */
export function csvDisplay(cell: string): string {
  const text = String(cell ?? '');
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1).replace(/""/g, '"');
  return text;
}

/** Same bytes, ready for `downloadBlob`. Excel wants the charset announced. */
export function csvBlob(text: string): Blob {
  return new Blob([text], { type: 'text/csv;charset=utf-8' });
}
