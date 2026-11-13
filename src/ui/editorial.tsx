import { Children, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { dept, type Department } from '../nav/departments';
import { useImageSrc } from '../media/store';
import { Chip } from './primitives';

export interface IntroMeta {
  label: ReactNode;
  value: ReactNode;
}

/**
 * Department introductions. Four genuinely different treatments so the
 * application reads as an art-directed publication, not a template.
 */
export function DeptIntro({
  id,
  deck,
  image,
  actions,
  meta,
  variant,
  title,
  children
}: {
  id?: Department['id'] | string;
  deck?: ReactNode;
  image?: any;
  actions?: ReactNode;
  meta?: IntroMeta[];
  variant?: Department['intro'];
  title?: ReactNode;
  children?: ReactNode;
}) {
  const d = id ? dept(id as any) : undefined;
  const kind = variant ?? d?.intro ?? 'masthead';
  const heading = title ?? d?.title ?? '';
  const copy = deck ?? d?.deck ?? '';
  return (
    <header className={`gl-intro gl-intro--${kind}`}>
      {kind === 'campaign' ? (
        <CampaignHead d={d} heading={heading} copy={copy} image={image} actions={actions} meta={meta} />
      ) : (
        <>
          <div>
            <div className="gl-intro__kicker">{d ? `${d.group} · Department` : 'THE GLOW LAB'}</div>
            <h1 className="gl-intro__title">{heading}</h1>
            {copy ? <p className="gl-intro__deck">{copy}</p> : null}
          </div>
          {actions ? <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-4)' }}>{actions}</div> : null}
          {meta?.length ? <IntroMeta meta={meta} /> : null}
          {children}
        </>
      )}
    </header>
  );
}

function CampaignHead({
  d,
  heading,
  copy,
  image,
  actions,
  meta
}: {
  d?: Department;
  heading: ReactNode;
  copy: ReactNode;
  image?: any;
  actions?: ReactNode;
  meta?: IntroMeta[];
}) {
  const src = useImageSrc(image, 'full');
  const Icon = d?.icon;
  return (
    <div className="gl-campaign">
      <div className="gl-campaign__img">
        {src ? (
          <img src={src} alt="" className="gl-img-treated" loading="lazy" />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              background:
                'radial-gradient(120% 90% at 20% 0%, color-mix(in srgb, var(--glow-accent) 70%, transparent), transparent 60%), linear-gradient(160deg, var(--glow-plate), var(--glow-canvas))'
            }}
          />
        )}
      </div>
      {d ? (
        <div className="gl-campaign__strip">
          <div>{d.group}</div>
          <div>{d.parts.join(' / ')}</div>
        </div>
      ) : null}
      <div className="gl-campaign__body">
        <div className="gl-intro__kicker" style={{ color: 'var(--glow-metal)', display: 'flex', gap: 8, alignItems: 'center' }}>
          {Icon ? <Icon size={13} strokeWidth={1.4} /> : null}
          {d ? `${d.group} · Department` : 'THE GLOW LAB'}
        </div>
        <h1 className="gl-intro__title" style={{ color: '#fff' }}>
          {heading}
        </h1>
        {copy ? <p className="gl-intro__deck">{copy}</p> : null}
        <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-4)' }}>
          {actions}
        </div>
        {meta?.length ? <IntroMeta strip meta={meta} light /> : null}
      </div>
    </div>
  );
}

function IntroMeta({ strip, meta, light }: { strip?: boolean; meta: IntroMeta[]; light?: boolean }) {
  return (
    <dl
      className="gl-intro__meta"
      style={light ? { borderColor: 'rgba(255,255,255,.2)' } : undefined}
    >
      {meta.map((m, i) => (
        <div key={i}>
          <dt className="gl-label" style={light ? { color: 'rgba(255,255,255,.6)' } : undefined}>
            {m.label}
          </dt>
          <dd style={{ margin: 0 }} className="gl-tech">
            <span style={{ color: light ? '#fff' : 'var(--glow-text-strong)', fontSize: '0.95rem', fontFamily: 'var(--glow-font-display)' }}>
              {m.value}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------ strips */

export function StatStrip({ items }: { items: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: string }[] }) {
  return (
    <div className="gl-strip">
      {items.map((s, i) => (
        <div key={i}>
          <div className="gl-label">{s.label}</div>
          <div className="gl-stat" style={{ fontSize: '1.7rem', marginTop: 4, color: s.tone }}>
            {s.value}
          </div>
          {s.hint ? <div className="gl-tech">{s.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function Chipbar({
  items,
  value,
  onChange,
  allLabel = 'Everything'
}: {
  items: { value: string; label: ReactNode; count?: number }[];
  value: string;
  onChange: (v: string) => void;
  allLabel?: string;
}) {
  return (
    <div className="gl-chipbar">
      <Chip active={value === ''} onClick={() => onChange('')}>
        {allLabel}
      </Chip>
      {items.map((i) => (
        <Chip key={i.value} active={value === i.value} onClick={() => onChange(i.value)}>
          {i.label}
          {i.count !== undefined ? <span className="gl-tech" style={{ letterSpacing: 0 }}>{i.count}</span> : null}
        </Chip>
      ))}
    </div>
  );
}

export function IndexRow({
  no,
  title,
  sub,
  right,
  onClick
}: {
  no: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="gl-index__row" onClick={onClick}>
      <span className="gl-index__no">{String(no).padStart(2, '0')}</span>
      <span style={{ minWidth: 0 }}>
        <span className="gl-index__title">{title}</span>
        {sub ? <span className="gl-index__sub" style={{ display: 'block' }}>{sub}</span> : null}
      </span>
      <span className="gl-row gl-row--tight" style={{ color: 'var(--glow-text-faint)' }}>
        {right}
        {onClick ? <ChevronRight size={15} /> : null}
      </span>
    </button>
  );
}

export function IndexList({ children }: { children: ReactNode }) {
  return <div className="gl-index">{children}</div>;
}

export function Timeline({
  items
}: {
  items: { when: ReactNode; title: ReactNode; body?: ReactNode; tone?: 'accent' | 'plain'; right?: ReactNode }[];
}) {
  return (
    <div className="gl-timeline">
      {items.map((it, i) => (
        <div key={i} className="gl-timeline__item" data-tone={it.tone === 'accent' ? 'accent' : undefined}>
          <div className="gl-row gl-row--between" style={{ alignItems: 'baseline' }}>
            <div className="gl-timeline__when">{it.when}</div>
            <div className="gl-row gl-row--tight">{it.right}</div>
          </div>
          <div className="gl-serif" style={{ fontSize: '1.12rem', color: 'var(--glow-text-strong)', marginTop: 2 }}>
            {it.title}
          </div>
          {it.body ? <div className="gl-small gl-muted" style={{ marginTop: 4 }}>{it.body}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function Carousel({ children, height = 220, ratio = '4 / 5' }: { children: ReactNode; height?: number; ratio?: string }) {
  const kids = Children.toArray(children).filter(Boolean);
  return (
    <div className="gl-carousel">
      {kids.map((c, i) => (
        <div key={i} style={{ height, aspectRatio: ratio, flex: 'none' }}>
          {c}
        </div>
      ))}
    </div>
  );
}

export function PullQuote({ children, cite }: { children: ReactNode; cite?: ReactNode }) {
  return (
    <blockquote className="gl-pull-quote">
      {children}
      {cite ? <cite>{cite}</cite> : null}
    </blockquote>
  );
}

export function EmptyPlate({
  kicker,
  title,
  body,
  action
}: {
  kicker?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="gl-card gl-card--plate" style={{ textAlign: 'center', padding: 'var(--glow-sp-7) var(--glow-sp-5)' }}>
      {kicker ? <div className="gl-eyebrow" style={{ justifyContent: 'center', color: 'var(--glow-metal)' }}>{kicker}</div> : null}
      <h3 style={{ marginTop: 10, marginBottom: 6 }}>{title}</h3>
      {body ? (
        <p style={{ margin: '0 auto', maxWidth: '54ch', color: 'rgba(241,231,222,.72)' }} className="gl-small">
          {body}
        </p>
      ) : null}
      {action ? <div style={{ marginTop: 'var(--glow-sp-4)' }}>{action}</div> : null}
    </div>
  );
}

export function KvList({ items }: { items: { k: ReactNode; v: ReactNode }[] }) {
  return (
    <dl className="gl-kv">
      {items.map((it, i) => (
        <div key={`${String(it.k)}-${i}`} style={{ display: 'contents' }}>
          <dt>{it.k}</dt>
          <dd>{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProgressRing({
  value,
  size = 74,
  label,
  sub
}: {
  value: number;
  size?: number;
  label?: ReactNode;
  sub?: ReactNode;
}) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="gl-row" style={{ gap: 'var(--glow-sp-3)' }}>
      <svg width={size} height={size} aria-hidden style={{ flex: 'none' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          style={{ fill: 'none', stroke: 'var(--glow-line-strong)', strokeWidth: 2 }}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeDasharray={`${(clamped / 100) * c} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{
            fill: 'none',
            stroke: 'var(--glow-metal)',
            strokeWidth: 2,
            transition: 'stroke-dasharray var(--glow-dur-3) var(--glow-ease)'
          }}
        />
        <text
          x="50%"
          y="52%"
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fill: 'var(--glow-text-strong)', font: `500 ${size * 0.24}px var(--glow-font-display)` }}
        >
          {Math.round(clamped)}
        </text>
      </svg>
      {label || sub ? (
        <div>
          <div className="gl-serif" style={{ fontSize: '1.05rem' }}>{label}</div>
          <div className="gl-tech">{sub}</div>
        </div>
      ) : null}
    </div>
  );
}
