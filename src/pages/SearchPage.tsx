import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CornerDownLeft, Search as SearchIcon } from 'lucide-react';
import { globalSearch, quickRoutes, type SearchHit } from '../search/globalSearch';
import { useDebounced, Chip, EmptyState, Section, TextInput } from '../ui/primitives';
import { DeptIntro, IndexList, IndexRow, StatStrip } from '../ui/editorial';
import { DEPARTMENTS } from '../nav/departments';
import '../styles/departments/search.css';

/** Global search over every table plus department shortcuts (spec Part 24). */
export default function SearchPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [routes, setRoutes] = useState<{ path: string; label: string }[]>([]);
  const [meta, setMeta] = useState({ searchedTables: 0, tookMs: 0 });
  const [kind, setKind] = useState('all');
  const debounced = useDebounced(q, 200);

  const run = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setHits([]);
      setRoutes([]);
      setMeta({ searchedTables: 0, tookMs: 0 });
      return;
    }
    const out = await globalSearch(query, 80);
    setHits(out.hits);
    setRoutes(out.routes);
    setMeta({ searchedTables: out.searchedTables, tookMs: out.tookMs });
  }, []);

  useEffect(() => {
    void run(debounced);
    if (debounced) setParams({ q: debounced }, { replace: true });
  }, [debounced, run, setParams]);

  const kinds = useMemo(() => Array.from(new Set(hits.map((h) => h.kindLabel))).sort(), [hits]);
  const shown = kind === 'all' ? hits : hits.filter((h) => h.kindLabel === kind);
  const grouped = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const h of shown) map.set(h.kindLabel, [...(map.get(h.kindLabel) ?? []), h]);
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [shown]);

  return (
    <>
      <DeptIntro
        id="search"
        deck="One query across every record you have saved. Results are read from your device — there is no index on a server, because there is no server."
        meta={[
          { label: 'Tables scanned', value: String(meta.searchedTables || '—') },
          { label: 'Results', value: String(hits.length) },
          { label: 'Took', value: meta.tookMs ? `${meta.tookMs} ms` : '—' }
        ]}
      />

      <div className="gl-searchpage__bar">
        <SearchIcon size={16} />
        <TextInput value={q} onChange={setQ} placeholder="Search goals, products, garments, techniques, photos, conversations…" />
      </div>

      {q.trim().length < 2 ? (
        <Section eyebrow="Jump to" title="Departments">
          <div className="gl-deptgrid">
            {DEPARTMENTS.map((d, i) => {
              const Icon = d.icon;
              return (
                <a key={d.id} href={`#${d.path}`} data-feature={i === 0 ? 'true' : undefined}>
                  <Icon size={16} strokeWidth={1.5} />
                  <span className="gl-strong">{d.title}</span>
                  <span className="gl-small gl-faint">{d.deck}</span>
                </a>
              );
            })}
          </div>
        </Section>
      ) : null}

      {quickRoutes(q).length && q.trim().length >= 2 ? (
        <StatStrip
          items={quickRoutes(q).map((r) => ({
            label: 'Department',
            value: (
              <button type="button" className="gl-btn gl-btn--link gl-btn--sm" onClick={() => navigate(r.path)}>
                {r.label} <CornerDownLeft size={13} />
              </button>
            )
          }))}
        />
      ) : null}

      {routes.length ? (
        <div className="gl-row gl-row--tight" style={{ margin: '18px 0', flexWrap: 'wrap' }}>
          {routes.map((r) => (
            <button key={r.path} type="button" className="gl-chip gl-chip--clickable" onClick={() => navigate(r.path)}>
              {r.label}
            </button>
          ))}
        </div>
      ) : null}

      {kinds.length > 1 ? (
        <div className="gl-row gl-row--tight" style={{ margin: '0 0 18px', flexWrap: 'wrap' }}>
          <button type="button" className="gl-chip gl-chip--clickable" data-on={kind === 'all'} onClick={() => setKind('all')}>
            all types
          </button>
          {kinds.map((k) => (
            <button key={k} type="button" className="gl-chip gl-chip--clickable" data-on={kind === k} onClick={() => setKind(k)}>
              {k}
            </button>
          ))}
        </div>
      ) : null}

      {q.trim().length >= 2 && shown.length === 0 ? (
        <EmptyState
          title="No records match"
          body={`Nothing in your data contains “${q.trim()}”. Search covers the text you saved, not the wider internet — for that, use Discover and a provider you configured yourself.`}
        />
      ) : null}

      {grouped.map(([label, list]) => (
        <Section key={label} eyebrow={`${list.length} result${list.length === 1 ? '' : 's'}`} title={label}>
          <IndexList>
            {list.map((h, i) => (
              <IndexRow
                key={h.table + h.id}
                no={i + 1}
                title={h.title}
                sub={h.subtitle}
                right={<Chip>{h.table}</Chip>}
                onClick={() => navigate(h.path)}
              />
            ))}
          </IndexList>
        </Section>
      ))}
    </>
  );
}
