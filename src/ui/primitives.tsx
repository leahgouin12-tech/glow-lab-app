import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode
} from 'react';
import { X } from 'lucide-react';

/* ------------------------------------------------------------------ surfaces */

export function Card({
  children,
  variant = 'default',
  className = '',
  accent,
  style,
  onClick
}: {
  children: ReactNode;
  variant?: 'default' | 'flush' | 'raised' | 'accent';
  className?: string;
  accent?: boolean;
  style?: React.CSSProperties;
  onClick?: () => void;
}) {
  const v = accent ? 'accent' : variant;
  return (
    <div
      className={`gl-card gl-card--${v} ${className}`}
      style={style}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      {children}
    </div>
  );
}

export function CardHead({
  title,
  eyebrow,
  right,
  sub
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  right?: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="gl-card__head">
      <div>
        {eyebrow ? <div className="gl-eyebrow">{eyebrow}</div> : null}
        <h3>{title}</h3>
        {sub ? <div className="gl-small gl-muted">{sub}</div> : null}
      </div>
      {right ? <div className="gl-row gl-row--tight">{right}</div> : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  sub,
  actions,
  meta
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="gl-page__head">
      <div className="gl-row gl-row--between" style={{ alignItems: 'flex-end', gap: 'var(--glow-sp-5)' }}>
        <div style={{ minWidth: 0 }}>
          {eyebrow ? <div className="gl-eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</div> : null}
          <h1 className="gl-display" style={{ fontSize: 'var(--glow-text-display)' }}>{title}</h1>
          {sub ? <p className="gl-page__sub" style={{ marginTop: 'var(--glow-sp-3)' }}>{sub}</p> : null}
          {meta ? <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-3)' }}>{meta}</div> : null}
        </div>
        {actions ? <div className="gl-row gl-row--tight">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Section({
  title,
  eyebrow,
  right,
  children,
  description
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
}) {
  return (
    <section className="gl-section">
      {title ? (
        <div className="gl-section__title gl-row gl-row--between">
          <div>
            {eyebrow ? <div className="gl-eyebrow">{eyebrow}</div> : null}
            <h2>{title}</h2>
          </div>
          {right ? <div className="gl-row gl-row--tight">{right}</div> : null}
        </div>
      ) : null}
      {description ? <p className="gl-muted gl-small" style={{ marginBottom: 'var(--glow-sp-4)' }}>{description}</p> : null}
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------- buttons */

type BtnProps = {
  children: ReactNode;
  variant?: 'default' | 'primary' | 'gold' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  block?: boolean;
  icon?: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
  className?: string;
};

export function Button({
  children,
  variant = 'default',
  size = 'md',
  block,
  icon,
  onClick,
  disabled,
  type = 'button',
  title,
  className = ''
}: BtnProps) {
  return (
    <button
      type={type}
      title={title}
      className={`gl-btn gl-btn--${variant} ${size === 'sm' ? 'gl-btn--sm' : ''} ${block ? 'gl-btn--block' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({
  children,
  onClick,
  label,
  active,
  tone
}: {
  children: ReactNode;
  onClick?: () => void;
  label: string;
  active?: boolean;
  tone?: 'on' | 'gold' | 'danger';
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`gl-btn gl-btn--icon ${active ? `gl-chip--${tone ?? 'on'}` : ''}`}
      style={active ? { background: 'rgba(107,18,48,.32)', borderColor: 'var(--glow-line-gold)' } : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- chips/tags */

export function Chip({
  children,
  tone,
  onClick,
  active,
  title
}: {
  children: ReactNode;
  tone?: 'strong' | 'moderate' | 'limited' | 'weak' | 'danger' | 'unsafe' | 'unsupported' | 'gold' | 'info';
  onClick?: () => void;
  active?: boolean;
  title?: string;
}) {
  const cls = `gl-chip ${onClick ? 'gl-chip--clickable' : ''} ${active ? 'gl-chip--on' : ''} ${tone === 'gold' ? 'gl-chip--gold' : ''}`;
  const El: any = onClick ? 'button' : 'span';
  return (
    <El type={onClick ? 'button' : undefined} className={cls} data-tone={tone} onClick={onClick} title={title}>
      {children}
    </El>
  );
}

export function EvidenceChip({ grade, label }: { grade: string; label?: string }) {
  const text: Record<string, string> = {
    strong: 'Evidence: strong',
    moderate: 'Evidence: moderate',
    limited: 'Evidence: limited',
    weak: 'Evidence: weak',
    unsupported: 'Evidence: unsupported',
    emerging: 'Emerging research',
    traditional: 'Traditional practice',
    cosmetic: 'Cosmetic technique',
    professional: 'Professional only',
    dangerous: 'Unsafe — do not attempt'
  };
  return <Chip tone={grade as any}>{label ?? text[grade] ?? `Evidence: ${grade}`}</Chip>;
}

export function SafetyBanner({
  tone = 'warn',
  title,
  children
}: {
  tone?: 'warn' | 'danger' | 'note' | 'ok';
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={tone === 'note' ? 'gl-note' : `gl-note gl-note--${tone}`}>
      {title ? <div style={{ fontWeight: 700, color: 'var(--glow-text-strong)', marginBottom: 4 }}>{title}</div> : null}
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------- forms */

export function Field({
  label,
  hint,
  children,
  after
}: {
  label?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  after?: ReactNode;
}) {
  const id = useId();
  return (
    <label className="gl-field" htmlFor={id}>
      {label ? <span className="gl-field__label">{label}</span> : null}
      {children}
      {hint ? <span className="gl-small gl-faint">{hint}</span> : null}
      {after}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
  onEnter
}: {
  value: string | number | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  onEnter?: () => void;
}) {
  return (
    <input
      id={useId()}
      className="gl-input"
      type={type}
      value={value ?? ''}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      className="gl-textarea"
      rows={rows}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  placeholder
}: {
  value: string | number | undefined;
  onChange: (v: string) => void;
  options: { value: string | number; label: string }[];
  placeholder?: string;
}) {
  return (
    <select className="gl-select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={String(o.value)} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function SegmentedControl({
  value,
  onChange,
  options,
  size = 'md'
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: ReactNode }[];
  size?: 'sm' | 'md';
}) {
  return (
    <div className="gl-row gl-row--tight" role="tablist" style={{ flexWrap: 'wrap' }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={`gl-btn gl-btn--sm ${value === o.value ? 'gl-btn--gold' : 'gl-btn--ghost'}`}
          onClick={() => onChange(o.value)}
          style={size === 'sm' ? { padding: '4px 10px', fontSize: 'var(--glow-text-micro)' } : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className="gl-switch"
        data-on={checked}
        onClick={() => onChange(!checked)}
      >
        <span className="gl-switch__track" />
        <span>{label}</span>
      </button>
      {hint ? <div className="gl-small gl-faint" style={{ marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
}

export function Range({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  format
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: ReactNode;
  format?: (v: number) => string;
}) {
  return (
    <div className="gl-field">
      {label ? (
        <span className="gl-field__label" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{label}</span>
          <span style={{ color: 'var(--glow-gold)', letterSpacing: 'normal' }}>{format ? format(value) : value}</span>
        </span>
      ) : null}
      <input
        type="range"
        className="gl-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--glow-accent-soft)' }}
      />
    </div>
  );
}

export function TagInput({
  values,
  onChange,
  placeholder = 'Add and press Enter'
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const v = draft.trim();
    if (!v) return;
    if (!values.includes(v)) onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className="gl-row gl-row--tight" style={{ gap: 6 }}>
      {values.map((v) => (
        <Chip key={v} onClick={() => onChange(values.filter((x) => x !== v))} title="Remove">
          {v} ✕
        </Chip>
      ))}
      <input
        className="gl-input"
        style={{ maxWidth: 200, flex: 1, minWidth: 130 }}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
        }}
        onBlur={commit}
      />
    </div>
  );
}

export function DateInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <Field label={label}>
      <input
        className="gl-input"
        type="date"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        style={{ colorScheme: 'dark' }}
      />
    </Field>
  );
}

export function Rating({
  value,
  onChange,
  count = 5,
  size = 18
}: {
  value: number;
  onChange?: (v: number) => void;
  count?: number;
  size?: number;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="gl-row gl-row--tight" role={onChange ? 'radiogroup' : undefined} aria-label="Rating">
      {Array.from({ length: count }).map((_, i) => {
        const filled = i < Math.round(shown);
        const node = (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
            <path
              d="M12 2.6l2.9 6.1 6.6.9-4.8 4.7 1.2 6.6L12 17.8 6.1 20.9l1.2-6.6L2.5 9.6l6.6-.9z"
              style={{
                fill: filled ? 'var(--glow-champagne-400)' : 'none',
                stroke: filled ? 'var(--glow-champagne-300)' : 'var(--glow-line-strong)',
                strokeWidth: 1.2
              }}
            />
          </svg>
        );
        return onChange ? (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i + 1}
            aria-label={`${i + 1} of ${count}`}
            style={{ background: 'none', border: 0, cursor: 'pointer', padding: 1, lineHeight: 0 }}
            onMouseEnter={() => setHover(i + 1)}
            onMouseLeave={() => setHover(0)}
            onClick={() => onChange(i + 1)}
          >
            {node}
          </button>
        ) : (
          <span key={i} style={{ lineHeight: 0 }}>{node}</span>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ display */

export function Stat({
  label,
  value,
  hint,
  tone,
  children
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'gold' | 'rose' | 'muted';
  children?: ReactNode;
}) {
  return (
    <div className="gl-inset" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="gl-label">{label}</div>
      <div
        className="gl-num"
        style={
          tone === 'gold'
            ? { color: 'var(--glow-champagne-400)' }
            : tone === 'rose'
              ? { color: 'var(--glow-rose-300)' }
              : undefined
        }
      >
        {value}
      </div>
      {hint ? <div className="gl-small gl-faint">{hint}</div> : null}
      {children}
    </div>
  );
}

export function Meter({ value, max = 100, label, tone }: { value: number; max?: number; label?: ReactNode; tone?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      {label ? (
        <div className="gl-row gl-row--between gl-small" style={{ marginBottom: 5 }}>
          <span className="gl-muted">{label}</span>
          <span style={{ color: tone ?? 'var(--glow-text-strong)' }}>{Math.round(pct)}%</span>
        </div>
      ) : null}
      <div className="gl-meter" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="gl-meter__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="gl-empty">
      {icon ? <div style={{ fontSize: 22, marginBottom: 8, opacity: 0.7 }}>{icon}</div> : null}
      <h3>{title}</h3>
      {body ? <div className="gl-small" style={{ maxWidth: 520, margin: '0 auto' }}>{body}</div> : null}
      {action ? <div style={{ marginTop: 'var(--glow-sp-4)' }}>{action}</div> : null}
    </div>
  );
}

export function Disclosure({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="gl-details">
      <summary>{summary}</summary>
      <div className="gl-details__body">{children}</div>
    </details>
  );
}

export function Table({
  columns,
  rows,
  keyOf
}: {
  columns: { label: ReactNode; render: (row: any) => ReactNode; width?: number }[];
  rows: any[];
  keyOf?: (row: any, i: number) => string;
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="gl-table">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} style={c.width ? { width: c.width } : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={keyOf ? keyOf(r, i) : i}>
              {columns.map((c, j) => (
                <td key={j}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Swatches({ colors, size = 26 }: { colors: string[]; size?: number }) {
  return (
    <div className="gl-row gl-row--tight">
      {colors.filter(Boolean).map((c, i) => (
        <span
          key={i}
          title={c}
          style={{
            width: size,
            height: size,
            borderRadius: 'var(--glow-r-sm)',
            background: c,
            border: '1px solid var(--glow-line-strong)',
            display: 'inline-block'
          }}
        />
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- overlays */

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Escape closes, Tab stays inside, and focus returns to the control that opened the overlay. */
function useDialog(open: boolean, onClose: () => void, ref: { current: HTMLElement | null }) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    window.setTimeout(() => node?.querySelector<HTMLElement>(FOCUSABLE)?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const stops = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => !x.hasAttribute('disabled'));
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose, ref]);
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDialog(open, onClose, ref);
  if (!open) return null;
  return (
    <div className="gl-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gl-modal" ref={ref} style={wide ? { width: 'min(1120px, 100%)' } : undefined} role="dialog" aria-modal>
        <div className="gl-modal__head">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        {children}
        {footer ? <div className="gl-row gl-row--between" style={{ marginTop: 'var(--glow-sp-5)' }}>{footer}</div> : null}
      </div>
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDialog(open, onClose, ref);
  if (!open) return null;
  return (
    <>
      <div className="gl-overlay" style={{ background: 'rgba(4,3,6,.6)' }} onMouseDown={onClose} />
      <div className="gl-sheet" role="dialog" aria-modal ref={ref}>
        <div className="gl-modal__head">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        {children}
      </div>
    </>
  );
}

/* -------------------------------------------------------------- toast layer */

type Toast = {
  id: number;
  body: ReactNode;
  tone?: 'ok' | 'bad' | 'info';
  action?: { label: string; onClick: () => void };
};
export type ToastInput =
  | Toast['tone']
  | { tone?: Toast['tone']; action?: Toast['action']; ttlMs?: number };
const ToastCtx = createContext<(body: ReactNode, input?: ToastInput) => void>(() => {});

/** A toast carrying a decision stays up long enough to make it. */
const TOAST_TTL = 3600;
const TOAST_ACTION_TTL = 9000;

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const drop = useCallback((id: number) => setItems((prev) => prev.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (body: ReactNode, input?: ToastInput) => {
      const opts = typeof input === 'string' || input === undefined ? { tone: input } : input;
      const id = ++seq.current;
      const ttl = opts.ttlMs ?? (opts.action ? TOAST_ACTION_TTL : TOAST_TTL);
      setItems((prev) => [...prev, { id, body, tone: opts.tone, action: opts.action }]);
      setTimeout(() => drop(id), ttl);
    },
    [drop]
  );
  const value = useMemo(() => push, [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="gl-toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="gl-toast" data-tone={t.tone === 'ok' ? 'ok' : t.tone === 'bad' ? 'bad' : undefined}>
            {t.body}
            {t.action ? (
              <button
                type="button"
                className="gl-toast__action"
                onClick={() => {
                  drop(t.id);
                  t.action?.onClick();
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/* ------------------------------------------------------------------- misc */

export function Skeleton({ h = 14, w = '100%' }: { h?: number; w?: string | number }) {
  return <div className="gl-skeleton" style={{ height: h, width: w }} />;
}

export function useDebounced<T>(value: T, ms = 220): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function fmtMoney(amount: number | null | undefined, currency = 'USD') {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export function pct(n: number, digits = 0) {
  return `${(n * 100).toFixed(digits)}%`;
}
