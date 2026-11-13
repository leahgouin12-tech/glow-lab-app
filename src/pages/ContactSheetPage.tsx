import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, RotateCcw } from 'lucide-react';
import { DEPARTMENTS } from '../nav/departments';
import { THEME_OPTIONS } from '../state/themes';
import { updateSettings, useSettings } from '../state/settings';
import { Button, Card, CardHead, Chip, IconButton, Meter, PageHeader, SafetyBanner, Select, Toggle } from '../ui/primitives';
import '../styles/contact.css';

const WIDTHS = [
  { value: '390', label: 'Phone · 390 px' },
  { value: '768', label: 'Tablet · 768 px' },
  { value: '1180', label: 'Desktop · 1180 px' }
];

const cellKey = (dept: string, theme: string) => `${dept}:${theme}`;

/** The document URL without its query or hash, so a pane can be re-themed. */
function hostBase() {
  const href = window.location.href;
  const cut = Math.min(
    href.includes('?') ? href.indexOf('?') : href.length,
    href.includes('#') ? href.indexOf('#') : href.length
  );
  return href.slice(0, cut);
}

export default function ContactSheetPage() {
  const settings = useSettings();
  const [deptIndex, setDeptIndex] = useState(0);
  const [width, setWidth] = useState('390');
  const [nonce, setNonce] = useState(0);

  const dept = DEPARTMENTS[Math.min(deptIndex, DEPARTMENTS.length - 1)];
  const total = DEPARTMENTS.length * THEME_OPTIONS.length;
  const done = useMemo(() => new Set(settings.visualChecks), [settings.visualChecks]);
  const perTheme = THEME_OPTIONS.map((t) => ({
    id: t.id,
    name: t.name,
    count: DEPARTMENTS.filter((d) => done.has(cellKey(d.id, t.id))).length
  }));

  const paneSrc = (themeId: string) => `${hostBase()}?theme=${themeId}&sheet=1#${dept.path}`;

  async function toggleCell(deptId: string, themeId: string) {
    const key = cellKey(deptId, themeId);
    const next = done.has(key)
      ? settings.visualChecks.filter((k) => k !== key)
      : [...settings.visualChecks, key];
    await updateSettings({ visualChecks: next });
  }

  const step = (delta: number) => setDeptIndex((i) => (i + delta + DEPARTMENTS.length) % DEPARTMENTS.length);

  return (
    <div className="gl-page cs">
      <PageHeader
        eyebrow="System · visual acceptance"
        title="Contact sheet"
        sub="Every department, rendered live in all three themes at once. These are not mockups: each pane boots the real app against your own database with ?theme forced, so what you see here is what the theme actually produces."
        actions={
          <>
            <IconButton label="Previous department" onClick={() => step(-1)}>
              <ChevronLeft size={16} />
            </IconButton>
            <IconButton label="Next department" onClick={() => step(1)}>
              <ChevronRight size={16} />
            </IconButton>
            <Button size="sm" icon={<RotateCcw size={13} />} onClick={() => setNonce((n) => n + 1)}>
              Reload panes
            </Button>
          </>
        }
        meta={
          <>
            <Chip tone={done.size === total ? 'gold' : 'info'}>
              {done.size} of {total} signed off
            </Chip>
            <Chip>
              {dept.title} · {width} px
            </Chip>
          </>
        }
      />

      <Card>
        <CardHead
          title="Where the matrix stands"
          eyebrow="29 departments × 3 themes, ticked by a person rather than a script"
          right={<Chip tone={done.size === total ? 'gold' : 'info'}>{Math.round((done.size / total) * 100)}%</Chip>}
        />
        <Meter value={done.size} max={total} label={`${done.size} of ${total} cells signed off`} />
        <div className="cs-themebar">
          {perTheme.map((t) => (
            <span className="cs-themestat" key={t.id}>
              {t.name}
              <b>
                {t.count}/{DEPARTMENTS.length}
              </b>
            </span>
          ))}
        </div>
        <div className="cs-controls">
          <Select
            value={String(deptIndex)}
            onChange={(v) => setDeptIndex(Number(v))}
            options={DEPARTMENTS.map((d, i) => ({ value: String(i), label: `${d.group} — ${d.title}` }))}
          />
          <Select value={width} onChange={setWidth} options={WIDTHS} />
        </div>
        <SafetyBanner tone="note" title="A live copy is still a copy of your data">
          Panes do not seed the database or write recommendations, but they are the real pages: a form inside a pane
          saves like any other screen. Look and navigate here; do the editing on the department itself.
        </SafetyBanner>
      </Card>

      <div className="cs-row" style={{ ['--cs-w' as string]: `${width}px` }}>
        {THEME_OPTIONS.map((t) => {
          const checked = done.has(cellKey(dept.id, t.id));
          return (
            <section className="cs-pane" key={t.id} data-on={checked || undefined}>
              <header className="cs-panehead">
                <div>
                  <span className="gl-eyebrow">{t.tagline}</span>
                  <h2 className="cs-panetitle">{t.name}</h2>
                </div>
                <a className="gl-btn gl-btn--sm gl-btn--ghost" href={paneSrc(t.id)} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} /> Full size
                </a>
              </header>
              <iframe
                key={`${dept.id}-${t.id}-${nonce}`}
                className="cs-frame"
                title={`${dept.title} in the ${t.name} theme`}
                src={paneSrc(t.id)}
                loading="lazy"
              />
              <Toggle
                checked={checked}
                onChange={() => void toggleCell(dept.id, t.id)}
                label={`Signed off at ${width} px`}
                hint={checked ? 'Recorded in your settings, not in this page.' : 'Only tick what you have actually looked at.'}
              />
            </section>
          );
        })}
      </div>

      <Card>
        <CardHead title="The whole grid" eyebrow="tick a cell without scrolling three panes; the row jumps to that department" />
        <div className="cs-grid">
          {DEPARTMENTS.map((d, i) => (
            <div className="cs-gridrow" key={d.id}>
              <button type="button" className="cs-gridname" onClick={() => setDeptIndex(i)}>
                <span className="gl-faint">{d.group}</span>
                {d.title}
              </button>
              <div className="cs-cells">
                {THEME_OPTIONS.map((t) => {
                  const on = done.has(cellKey(d.id, t.id));
                  return (
                    <button
                      type="button"
                      key={t.id}
                      className="cs-cell"
                      data-on={on || undefined}
                      aria-pressed={on}
                      aria-label={`${d.title} in ${t.name}${on ? ' — signed off' : ''}`}
                      title={`${d.title} · ${t.name}`}
                      onClick={() => {
                        setDeptIndex(i);
                        void toggleCell(d.id, t.id);
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
