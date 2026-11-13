import { useEffect, useMemo, useRef } from 'react';
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  RadarController,
  RadialLinearScale,
  Tooltip,
  type ChartOptions
} from 'chart.js';

// 'chart.js' is the tree-shaken core: an element is not a controller. Leaving a
// controller out does not fail at build time — the chart throws at mount, and
// the error boundary takes the whole department with it.
ChartJS.register(
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend,
  LineController,
  BarController,
  DoughnutController,
  RadarController
);

function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, fallback: string) => cs.getPropertyValue(n).trim() || fallback;
  return {
    text: v('--glow-text-muted', '#9d8b8b'),
    strong: v('--glow-text-strong', '#f8f1e9'),
    line: v('--glow-line', 'rgba(238,224,212,.1)'),
    grid: 'color-mix' in cs ? v('--glow-line', 'rgba(238,224,212,.1)') : v('--glow-line', 'rgba(238,224,212,.1)'),
    series: [
      v('--glow-chart-1', '#e2c49a'),
      v('--glow-chart-2', '#a8304a'),
      v('--glow-chart-3', '#c08a92'),
      v('--glow-chart-4', '#6d5a86'),
      v('--glow-chart-5', '#7aa98c'),
      v('--glow-chart-6', '#d0a95f')
    ]
  };
}

function withAlpha(color: string, alpha: number) {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const full = hex.length === 3 ? hex.split('').map((h) => h + h).join('') : hex;
    const n = parseInt(full, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  return color;
}

export interface Series {
  label: string;
  data: (number | null)[];
  area?: boolean;
  stepped?: boolean;
}

function Base({ type, labels, series, options, height = 240, yTitle }: {
  type: 'line' | 'bar';
  labels: string[];
  series: Series[];
  options?: ChartOptions<any>;
  height?: number;
  yTitle?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const chart = useRef<ChartJS | null>(null);
  const t = useMemo(tokens, [labels.length, series.length, height]);

  useEffect(() => {
    if (!ref.current) return;
    chart.current?.destroy();
    chart.current = new ChartJS(ref.current, {
      type,
      data: {
        labels,
        datasets: series.map((s, i) => {
          const color = t.series[i % t.series.length];
          return {
            label: s.label,
            data: s.data,
            borderColor: color,
            backgroundColor: s.area || type === 'bar' ? withAlpha(color, type === 'bar' ? 0.55 : 0.16) : 'transparent',
            borderWidth: type === 'bar' ? 1 : 1.6,
            fill: s.area ? 'origin' : false,
            tension: 0.28,
            stepped: s.stepped,
            pointRadius: type === 'line' ? (s.data.length > 40 ? 0 : 2.6) : 0,
            pointHoverRadius: 4,
            pointBackgroundColor: color,
            borderRadius: type === 'bar' ? 2 : 0,
            maxBarThickness: 34
          };
        })
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: series.length > 1,
            labels: { color: t.text, boxWidth: 8, boxHeight: 8, font: { size: 11, family: 'Manrope Variable, sans-serif' } }
          },
          tooltip: {
            backgroundColor: '#0d0709',
            borderColor: 'rgba(238,224,212,.22)',
            borderWidth: 1,
            titleColor: '#f8f1e9',
            bodyColor: '#c2b2ae',
            titleFont: { family: 'Cormorant Garamond, serif', size: 14 },
            bodyFont: { family: 'IBM Plex Mono, monospace', size: 11 },
            padding: 10,
            displayColors: false
          }
        },
        scales: {
          x: {
            grid: { color: t.line, drawTicks: false },
            border: { display: false },
            ticks: { color: t.text, font: { family: 'IBM Plex Mono, monospace', size: 10 }, maxRotation: 0, autoSkip: true }
          },
          y: {
            grid: { color: t.line, drawTicks: false },
            border: { display: false },
            title: yTitle ? { display: true, text: yTitle, color: t.text, font: { size: 10 } } : undefined,
            ticks: { color: t.text, font: { family: 'IBM Plex Mono, monospace', size: 10 } },
            beginAtZero: type === 'bar'
          }
        },
        animation: { duration: 420, easing: 'easeOutQuart' },
        ...options
      }
    });
    return () => {
      chart.current?.destroy();
      chart.current = null;
    };
  }, [type, labels.join('|'), JSON.stringify(series.map((s) => s.data)), height, t.series.join('|')]);

  return (
    <div style={{ height, position: 'relative' }}>
      <canvas ref={ref} role="img" aria-label={series.map((s) => s.label).join(', ')} />
    </div>
  );
}

export function LineChart(props: { labels: string[]; series: Series[]; height?: number; yTitle?: string }) {
  return <Base type="line" {...props} />;
}

export function BarChart(props: { labels: string[]; series: Series[]; height?: number; yTitle?: string }) {
  return <Base type="bar" {...props} />;
}

export function RadarChart({
  axes,
  sets,
  height = 300
}: {
  axes: string[];
  sets: { label: string; data: number[] }[];
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const chart = useRef<ChartJS | null>(null);
  const t = useMemo(tokens, [axes.length, sets.length]);
  useEffect(() => {
    if (!ref.current) return;
    chart.current?.destroy();
    chart.current = new ChartJS(ref.current, {
      type: 'radar',
      data: {
        labels: axes,
        datasets: sets.map((s, i) => {
          const color = t.series[i % t.series.length];
          return {
            label: s.label,
            data: s.data,
            borderColor: color,
            backgroundColor: withAlpha(color, 0.14),
            pointBackgroundColor: color,
            borderWidth: 1.4,
            pointRadius: 2.4
          };
        })
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: t.text, boxWidth: 8, font: { size: 11 } } },
          tooltip: { backgroundColor: '#0d0709', borderColor: 'rgba(238,224,212,.22)', borderWidth: 1 }
        },
        scales: {
          r: {
            angleLines: { color: t.line },
            grid: { color: t.line },
            pointLabels: { color: t.text, font: { size: 10, family: 'Manrope Variable, sans-serif' } },
            ticks: { display: false },
            suggestedMin: 0,
            suggestedMax: 100
          }
        }
      }
    });
    return () => {
      chart.current?.destroy();
      chart.current = null;
    };
  }, [axes.join('|'), JSON.stringify(sets), t.series.join('|')]);
  return (
    <div style={{ height, position: 'relative' }}>
      <canvas ref={ref} role="img" aria-label={`Radar: ${axes.join(', ')}`} />
    </div>
  );
}

export function DoughnutChart({
  labels,
  values,
  height = 230,
  center
}: {
  labels: string[];
  values: number[];
  height?: number;
  center?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const chart = useRef<ChartJS | null>(null);
  const t = useMemo(tokens, [labels.length]);
  useEffect(() => {
    if (!ref.current) return;
    chart.current?.destroy();
    chart.current = new ChartJS(ref.current, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: labels.map((_, i) => t.series[i % t.series.length]),
            borderColor: '#0a0608',
            borderWidth: 1,
            hoverOffset: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: { position: 'right', labels: { color: t.text, boxWidth: 8, font: { size: 11 } } },
          tooltip: { backgroundColor: '#0d0709', borderColor: 'rgba(238,224,212,.22)', borderWidth: 1 }
        }
      }
    });
    return () => {
      chart.current?.destroy();
      chart.current = null;
    };
  }, [labels.join('|'), values.join(','), t.series.join('|')]);
  return (
    <div style={{ height, position: 'relative' }}>
      <canvas ref={ref} role="img" aria-label={labels.join(', ')} />
      {center ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            pointerEvents: 'none',
            paddingRight: height * 0.42
          }}
        >
          <div className="gl-stat" style={{ fontSize: '1.4rem' }}>{center}</div>
        </div>
      ) : null}
    </div>
  );
}

/** Horizontal distribution bars, no chart.js — cheap and typographic. */
export function DistributionBars({
  rows,
  max
}: {
  rows: { label: string; value: number; tone?: string }[];
  max?: number;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="gl-stack" style={{ gap: 10 }}>
      {rows.map((r, i) => (
        <div key={i}>
          <div className="gl-row gl-row--between gl-small">
            <span className="gl-muted">{r.label}</span>
            <span className="gl-tech">{r.value}</span>
          </div>
          <div className="gl-meter" style={{ marginTop: 4 }}>
            <div
              className="gl-meter__fill"
              style={{ width: `${(r.value / top) * 100}%`, background: r.tone ?? 'var(--glow-metal)' }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Calendar heat strip: 7 columns per week, dense and typographic. */
export function HeatStrip({ days }: { days: { date: string; level: number; title?: string }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(11px, 1fr))', gap: 3 }}>
      {days.map((d) => (
        <div
          key={d.date}
          title={`${d.date}${d.title ? ` — ${d.title}` : ''}`}
          style={{
            height: 13,
            borderRadius: 2,
            background:
              d.level <= 0
                ? 'var(--glow-surface-inset)'
                : `color-mix(in srgb, var(--glow-accent-soft) ${Math.min(100, 22 + d.level * 26)}%, var(--glow-surface-inset))`,
            border: '1px solid var(--glow-line)'
          }}
        />
      ))}
    </div>
  );
}
