import { describe, expect, it } from 'vitest';
import { TABLES, type AnyRow, type TableName } from '../db/schema';
import {
  BINARY_PLACEHOLDER,
  CSV_BOM,
  CSV_DEPARTMENTS,
  CSV_LINE,
  TABLE_KEYS,
  bom,
  countFor,
  csvCell,
  csvColumns,
  csvFileName,
  csvFor,
  csvGrid,
  departmentLabel,
  hasColumnMap,
  isBinary,
  joinCsv,
  slugify,
  toCsvValue
} from '../db/csv';

/**
 * The CSV writer (Part 34's spreadsheet half). Everything here is checked
 * against the bytes she would actually open: a real RFC 4180 parser runs over
 * the output, so a quoting mistake fails here instead of in her spreadsheet.
 */

/** A small honest CSV reader: BOM off, quotes unfolded, CRLF and bare LF split. */
function parseCsv(text: string): string[][] {
  const body = text.startsWith(CSV_BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\r' && body[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const envelope = (over: Record<string, unknown> = {}): AnyRow =>
  ({
    id: 'r_1',
    createdAt: Date.parse('2026-11-02T08:00:00.000Z'),
    updatedAt: Date.parse('2026-11-03T09:30:00.000Z'),
    deletedAt: null,
    rev: 3,
    deviceId: 'dev_test',
    tags: [],
    text: 'search haystack',
    ...over
  }) as AnyRow;

describe('the field encoder', () => {
  it('quotes a field that contains the delimiter', () => {
    expect(csvCell('Lip stain, cherry')).toBe('"Lip stain, cherry"');
  });

  it('doubles every quote inside a field that contains one', () => {
    expect(csvCell('Size "M" tee')).toBe('"Size ""M"" tee"');
  });

  it('quotes a field with an embedded line feed', () => {
    expect(csvCell('wash\ncondition')).toBe('"wash\ncondition"');
  });

  it('quotes a field with a carriage return', () => {
    expect(csvCell('wash\rin')).toBe('"wash\rin"');
  });

  it('keeps leading and trailing spaces exactly and leaves the field bare', () => {
    expect(csvCell('  silk  ')).toBe('  silk  ');
    const parsed = parseCsv(csvFor(TABLES.clothingItems, [envelope({ name: '  silk  ', category: 'top' })]));
    expect(parsed[1][parsed[0].indexOf('Garment')]).toBe('  silk  ');
  });

  it('writes a numeric-looking string as the text she typed, with its leading zeros', () => {
    expect(csvCell('0012')).toBe('0012');
    const file = csvFor(TABLES.clothingItems, [envelope({ name: 'Swatch', size: '0012' })]);
    expect(file).toContain(',0012,');
    const parsed = parseCsv(file);
    expect(parsed[1][parsed[0].indexOf('Size')]).toBe('0012');
  });

  it('writes an empty string as an empty cell', () => {
    expect(csvCell('')).toBe('');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('does not quote a field that already holds the list separator', () => {
    expect(csvCell('spring | summer')).toBe('spring | summer');
    expect(toCsvValue(['spring', 'summer'])).toBe('spring | summer');
  });

  it('joins a list of scalars and quotes it only if a member needs it', () => {
    expect(toCsvValue(['wool', 'cashmere'])).toBe('wool | cashmere');
    expect(toCsvValue([1, 2, true])).toBe('1 | 2 | true');
    expect(csvCell(['wool', 'cashmere'])).toBe('wool | cashmere');
    expect(csvCell(['dry clean, separately', 'hand wash'])).toBe('"dry clean, separately | hand wash"');
    expect(toCsvValue([])).toBe('');
  });

  it('renders missing values as nothing rather than the word undefined', () => {
    const file = csvFor(TABLES.clothingItems, [envelope({ name: 'Blazer', careNotes: undefined, material: null })]);
    expect(file).not.toContain('undefined');
    expect(file).not.toContain('null');
  });

  it('writes Date objects and epoch stamps as ISO', () => {
    expect(toCsvValue(new Date('2026-11-02T08:00:00.000Z'))).toBe('2026-11-02T08:00:00.000Z');
    const file = csvFor(TABLES.goals, [envelope({ title: 'Even out tone' })]);
    expect(file).toContain('2026-11-02T08:00:00.000Z');
  });

  it('marks binary instead of encoding it', () => {
    const blob = new Blob(['jpeg-bytes-here'], { type: 'image/jpeg' });
    expect(isBinary(blob)).toBe(true);
    expect(isBinary(new ArrayBuffer(8))).toBe(true);
    expect(isBinary(new Uint8Array([1, 2]))).toBe(true);
    expect(isBinary(['not, binary'])).toBe(false);
    expect(isBinary(new Date())).toBe(false);
    expect(toCsvValue(blob)).toBe(BINARY_PLACEHOLDER);
    const file = csvFor(
      TABLES.mediaBlobs,
      [{ id: 'b_1', blob, thumb: new Uint8Array([1, 2]), createdAt: 1, bytes: 2, mime: 'image/jpeg' }] as unknown as AnyRow[]
    );
    expect(file).toContain(BINARY_PLACEHOLDER);
    expect(file).not.toContain('jpeg-bytes-here');
    expect(file).not.toContain('data:image');
    /* the only long run of characters in that file is the ISO stamp and the marker */
    expect(file).not.toMatch(/[A-Za-z0-9+/]{24,}={0,2}/);
  });
});

describe('the file shape', () => {
  it('joins encoded rows with CRLF', () => {
    expect(joinCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d');
    expect(joinCsv([['a']])).toBe('a');
    expect(CSV_LINE).toBe('\r\n');
  });

  it('carries the BOM exactly once, at the very start', () => {
    const file = csvFor(TABLES.clothingItems, [envelope({ name: 'Blazer' })]);
    expect(bom().codePointAt(0)).toBe(0xfeff);
    expect(file.codePointAt(0)).toBe(0xfeff);
    expect(file.slice(1).includes(CSV_BOM)).toBe(false);
    expect([...file].filter((c) => c === CSV_BOM)).toHaveLength(1);
  });

  it('writes a header row and one line per record', () => {
    const file = csvFor(TABLES.clothingItems, [
      envelope({ id: 'c_1', name: 'Blazer, navy', category: 'outerwear' }),
      envelope({ id: 'c_2', name: 'Loafers', category: 'shoes' })
    ]);
    const parsed = parseCsv(file);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].indexOf('Garment')).toBe(0);
    /* the bytes on disk carry the quotes, the value she reads back does not */
    expect(file).toContain('"Blazer, navy",outerwear');
    expect(parsed[1][0]).toBe('Blazer, navy');
    expect(parsed[2][0]).toBe('Loafers');
  });

  it('writes header only for an empty department and never throws', () => {
    const file = csvFor(TABLES.fragrances, []);
    const parsed = parseCsv(file);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toContain('Fragrance');
    expect(parsed[0]).toContain('Row ID');
    expect(csvFor(TABLES.fragrances, [null, undefined, 'junk', {}] as unknown as AnyRow[])).toBeTypeOf('string');
    expect(csvFor(TABLES.workoutSessions, undefined as unknown as AnyRow[])).toBeTypeOf('string');
  });

  it('quotes the header cell when a label needs it and keeps labels bare otherwise', () => {
    const header = csvColumns(TABLES.clothingItems, [envelope()]).map((c) => csvCell(c.label));
    expect(header).toContain('Garment');
    expect(header.filter((h) => h.startsWith('"'))).toHaveLength(0);
  });
});

describe('the columns', () => {
  it('takes the header from the union of keys, not from the first row', () => {
    const file = csvFor(TABLES.observations, [
      envelope({ subjectType: 'product', subjectId: 'p_1', on: '2026-11-01', note: 'stung', severity: 3 }),
      envelope({ subjectType: 'product', subjectId: 'p_2', on: '2026-11-02', note: 'fine', severity: 0, reaction: 'none', mediaIds: ['m_9'] })
    ]);
    const parsed = parseCsv(file);
    for (const label of ['Reaction', 'Media Ids', 'Severity']) {
      expect(parsed[0].some((h) => h.toLowerCase() === label.toLowerCase())).toBe(true);
    }
    const reactionIndex = parsed[0].findIndex((h) => h.toLowerCase() === 'reaction');
    expect(parsed[1][reactionIndex]).toBe('');
    expect(parsed[2][reactionIndex]).toBe('none');
  });

  it('reads as English for the departments she lives in', () => {
    const garments = csvFor(TABLES.clothingItems, [envelope({ name: 'Blazer', colors: ['navy'], wears: 4, seasons: ['winter'] })]);
    const header = parseCsv(garments)[0];
    expect(header.slice(0, 5)).toEqual(['Garment', 'Category', 'Brand', 'Colours', 'Size']);
    expect(header).toContain('Wears');
    expect(header).toContain('Photo ID');
    expect(header).not.toContain('name');
    expect(header).not.toContain('careNotes');

    const sessions = parseCsv(csvFor(TABLES.workoutSessions, [envelope({ doneOn: '2026-11-04', label: 'Push day' })]))[0];
    expect(sessions).toContain('Duration (min)');
    expect(sessions).toContain('Entries (JSON)');

    const purchases = parseCsv(csvFor(TABLES.purchases, [envelope({ boughtOn: '2026-11-04' })]))[0];
    expect(purchases).toContain('Bought on');
    expect(purchases).toContain('Order reference');
  });

  it('handles the row envelope the same way in every table', () => {
    for (const table of [TABLES.clothingItems, TABLES.goals, TABLES.observations, TABLES.hairRecords] as TableName[]) {
      const header = parseCsv(csvFor(table, [envelope()]))[0];
      expect(header).toContain('Row ID');
      expect(header).toContain('Created at');
      expect(header).toContain('Updated at');
      expect(header).toContain('Revision');
      expect(header).toContain('Tags');
      expect(header).not.toContain('Search text');
    }
  });

  it('leaves the search haystack out unless she asks for it', () => {
    expect(parseCsv(csvFor(TABLES.goals, [envelope()]))[0]).not.toContain('Search text');
    const withText = csvFor(TABLES.goals, [envelope()], { withSearchText: true });
    expect(parseCsv(withText)[0]).toContain('Search text');
    expect(withText).toContain('search haystack');
  });

  it('keeps nested training sets as JSON she can parse back', () => {
    const entries = [{ exerciseId: 'e_1', sets: [{ reps: 10, kg: 40, rpe: 8, done: true }, { reps: 8, kg: 42.5, rpe: 9, done: true }] }];
    const file = csvFor(TABLES.workoutSessions, [envelope({ doneOn: '2026-11-04', label: 'Push', entries })]);
    const parsed = parseCsv(file);
    const cell = parsed[1][parsed[0].indexOf('Entries (JSON)')];
    expect(JSON.parse(cell)).toEqual(entries);
    /* one cell, not a spill of extra columns */
    expect(parsed[1]).toHaveLength(parsed[0].length);
  });

  it('serialises a plain nested object as JSON too', () => {
    const recurrence = { freq: 'weekly', interval: 2, until: null, byweekday: [1, 4] };
    const file = csvFor(TABLES.calendarEvents, [envelope({ title: 'Retwist', startAt: Date.parse('2026-12-01T09:00:00.000Z'), recurrence })]);
    const parsed = parseCsv(file);
    expect(JSON.parse(parsed[1][parsed[0].indexOf('Recurrence (JSON)')])).toEqual(recurrence);
    expect(parsed[1][parsed[0].indexOf('Starts at')]).toBe('2026-12-01T09:00:00.000Z');
  });

  it('flattens the day log and does not also dump the payload twice', () => {
    const file = csvFor(TABLES.covariateDays, [envelope({ on: '2026-11-05', data: { sleepHours: 7.5, alcoholUnits: 2, note: 'late' } })]);
    const parsed = parseCsv(file);
    expect(parsed[0]).toContain('Sleep hours');
    expect(parsed[1][parsed[0].indexOf('Sleep hours')]).toBe('7.5');
    expect(parsed[1][parsed[0].indexOf('Alcohol units')]).toBe('2');
    expect(parsed[1][parsed[0].indexOf('Day note')]).toBe('late');
    expect(parsed[0]).not.toContain('Extra data (JSON)');
  });

  it('appends a payload column when a department stored something the map never heard of', () => {
    const file = csvFor(TABLES.clothingItems, [envelope({ name: 'Blazer', data: { costPerWear: 3.5 } })]);
    const parsed = parseCsv(file);
    expect(parsed[0]).toContain('Extra data (JSON)');
    expect(JSON.parse(parsed[1][parsed[0].indexOf('Extra data (JSON)')])).toEqual({ costPerWear: 3.5 });
  });

  it('drops a payload column when the payload is empty in every row', () => {
    const parsed = parseCsv(csvFor(TABLES.clothingItems, [envelope({ name: 'Blazer', data: {} })]));
    expect(parsed[0]).not.toContain('Extra data (JSON)');
  });

  it('excludes deleted rows by default and names the column when they are asked for', () => {
    const live = envelope({ id: 'p_1', label: 'Waist', domain: 'body', on: '2026-11-01', metric: 'waist', value: 74, unit: 'cm', rating: null, note: '', mediaIds: [], linkedGoalId: null, linkedPlanId: null, linkedExperimentId: null });
    const gone = envelope({ id: 'p_2', label: 'Old', domain: 'body', on: '2026-10-01', metric: 'waist', value: 76, unit: 'cm', rating: null, note: '', mediaIds: [], linkedGoalId: null, linkedPlanId: null, linkedExperimentId: null, deletedAt: Date.parse('2026-10-30T10:00:00.000Z') });

    const def = parseCsv(csvFor(TABLES.progressEntries, [live, gone]));
    expect(def).toHaveLength(2);
    expect(def[0]).not.toContain('Deleted at');
    expect(def[1].join()).toContain('Waist');

    const shown = parseCsv(csvFor(TABLES.progressEntries, [live, gone], { includeDeleted: true }));
    expect(shown).toHaveLength(3);
    expect(shown[0]).toContain('Deleted at');
    const deletedIndex = shown[0].indexOf('Deleted at');
    expect(shown[1][deletedIndex]).toBe('');
    expect(shown[2][deletedIndex]).toBe('2026-10-30T10:00:00.000Z');
    expect(csvGrid(TABLES.progressEntries, [live, gone]).skipped).toBe(1);
    expect(csvGrid(TABLES.progressEntries, [live, gone], { includeDeleted: true }).skipped).toBe(0);
  });

  it('survives a value that points back at itself', () => {
    const row = envelope({ title: 'Loop' }) as AnyRow & { self?: unknown };
    row.self = row;
    const file = csvFor(TABLES.goals, [row]);
    expect(file).toContain('[circular]');
    expect(file).toContain('Loop');
  });
});

describe('the filename', () => {
  it('slugifies the department label into ASCII with dashes', () => {
    expect(csvFileName(TABLES.clothingItems, '2026-11-13')).toBe('glowlab-closet-garments-2026-11-13.csv');
    expect(csvFileName(TABLES.covariateDays, '2026-01-02')).toBe('glowlab-day-log-2026-01-02.csv');
  });

  it('turns a slash and stray punctuation into a single dash', () => {
    expect(slugify('Colour / Tone')).toBe('colour-tone');
    expect(slugify('Should I Buy This?')).toBe('should-i-buy-this');
    expect(slugify('  padded / label  ')).toBe('padded-label');
    expect(csvFileName(TABLES.mediaItems, '2026-11-13', 'Photos / clips & bytes')).toBe('glowlab-photos-clips-bytes-2026-11-13.csv');
  });

  it('folds accents and non-ASCII letters instead of dropping the word', () => {
    expect(slugify('Größe')).toBe('grosse');
    expect(slugify('Péplum / Été')).toBe('peplum-ete');
    expect(slugify('Øl')).toBe('ol');
    expect(slugify('日本語')).toBe('');
    expect(csvFileName(TABLES.mediaItems, '2026-11-13', '日本語')).toBe('glowlab-media-records-2026-11-13.csv');
  });

  it('gives every department an ASCII filename ending in .csv', () => {
    for (const table of TABLE_KEYS) {
      const name = csvFileName(table, '2026-11-13');
      expect(name.startsWith(`glowlab-`)).toBe(true);
      expect(name.endsWith('-2026-11-13.csv')).toBe(true);
      expect(name).toMatch(/^glowlab-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.csv$/);
    }
  });
});

describe('every department in the registry', () => {
  const representative = (table: TableName): AnyRow =>
    envelope({
      id: `row-${table}-1`,
      data: { sleepHours: 7.5, extra: [1, 2] },
      entries: [{ exerciseId: 'e_1', sets: [{ reps: 10, kg: 40, rpe: 8, done: true }] }],
      mediaIds: ['m_1', 'm_2'],
      blob: new Blob(['bytes-never-shipped'], { type: 'image/jpeg' }),
      note: `Record for ${table}, with a "quote" and\na newline`
    });

  it('covers every table in the registry with a distinct label and a sorted picker', () => {
    /* registry length moves when another department lands — the writer follows
       it, so the assertion is against TABLES itself rather than a frozen count */
    expect(TABLE_KEYS).toEqual(Object.keys(TABLES).map((k) => (TABLES as Record<string, TableName>)[k]));
    expect(TABLE_KEYS.length).toBeGreaterThanOrEqual(45);
    expect(CSV_DEPARTMENTS).toHaveLength(TABLE_KEYS.length);
    const labels = CSV_DEPARTMENTS.map((d) => d.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    for (const table of TABLE_KEYS) {
      const label = departmentLabel(table);
      expect(label).toBeTypeOf('string');
      /* a labelled department never falls back to the raw key */
      expect(label).not.toBe(String(table));
      expect(label).toMatch(/[A-Z]/);
    }
  });

  it('writes a header and a data row for every table, with no hand-written map missing', () => {
    const failures: string[] = [];
    for (const table of TABLE_KEYS) {
      try {
        const row = representative(table);
        const file = csvFor(table, [row]);
        expect(typeof file).toBe('string');
        expect(file.startsWith(CSV_BOM)).toBe(true);
        const parsed = parseCsv(file);
        expect(parsed.length, table).toBe(2);
        expect(parsed[0].length, table).toBeGreaterThan(1);
        expect(parsed[1].length, table).toBe(parsed[0].length);
        expect(parsed[0], table).toContain('Row ID');
        expect(parsed[0], table).toContain('Created at');
        expect(parsed[0], table).toContain('Updated at');
        expect(parsed[0], table).toContain('Revision');
        expect(parsed[0], table).toContain('Device ID');
        /* nothing invented, nothing stringified by accident */
        expect(file, table).not.toContain('undefined');
        expect(file, table).not.toContain('[object Object]');
        expect(file, table).not.toContain('bytes-never-shipped');
        expect(file, table).toContain(BINARY_PLACEHOLDER);
        /* her own awkward text arrives intact */
        const noteIndex = parsed[0].findIndex((h) => h.toLowerCase() === 'note');
        expect(noteIndex, `${table} has no note column`).toBeGreaterThan(-1);
        expect(parsed[1][noteIndex], table).toBe(row.note);
        /* empty table is header only */
        expect(parseCsv(csvFor(table, [])).length, table).toBe(1);
      } catch (e) {
        failures.push(`${table}: ${(e as Error).message}`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('ships an explicit English map for the departments she exports most', () => {
    const mapped = TABLE_KEYS.filter(hasColumnMap);
    expect(mapped).toEqual(
      expect.arrayContaining([
        TABLES.clothingItems,
        TABLES.outfits,
        TABLES.products,
        TABLES.purchases,
        TABLES.progressEntries,
        TABLES.measurements,
        TABLES.weightEntries,
        TABLES.workoutSessions,
        TABLES.exercises,
        TABLES.routines,
        TABLES.routineLogs,
        TABLES.plans,
        TABLES.consultations,
        TABLES.providers,
        TABLES.calendarEvents,
        TABLES.knowledge,
        TABLES.manualReferences,
        TABLES.fragrances,
        TABLES.covariateDays,
        TABLES.derailments,
        TABLES.goals
      ])
    );
    for (const table of mapped) {
      const header = csvColumns(table, [envelope()], {}).map((c) => c.label);
      expect(header.length, table).toBeGreaterThan(2);
      /* every mapped label is words, not a camelCase key */
      for (const label of header) expect(label, `${table} → ${label}`).not.toMatch(/^[a-z]+[A-Z]/);
    }
  });
});

describe('helpers the Settings block uses', () => {
  it('counts rows without a second filter', () => {
    expect(countFor([1, 2, 3])).toBe(3);
    expect(countFor([])).toBe(0);
    expect(countFor(null)).toBe(0);
    expect(countFor(undefined)).toBe(0);
  });

  it('previews the real first rows under the full header', () => {
    const rows = [
      envelope({ id: 'c_1', name: 'Blazer' }),
      envelope({ id: 'c_2', name: 'Coat' }),
      envelope({ id: 'c_3', name: 'Shirt' })
    ];
    const grid = csvGrid(TABLES.clothingItems, rows, {}, 2);
    expect(grid.header).toEqual(csvGrid(TABLES.clothingItems, rows, {}).header);
    expect(grid.rows).toHaveLength(2);
    expect(grid.rows[0][0]).toBe('Blazer');
    expect(csvFor(TABLES.clothingItems, rows).split(CSV_LINE)).toHaveLength(4);
  });
});
