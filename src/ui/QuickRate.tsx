import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Check, ChevronRight, Heart, ShoppingBag, Sparkles, ThumbsDown, Undo2, X } from 'lucide-react';
import { useImageSrc } from '../media/store';
import type { AnyRow, DiscoveryInteractionRow } from '../db/schema';
import { Button, Chip, Meter } from './primitives';

type RateAction = DiscoveryInteractionRow['action'];

/**
 * One reference at a time, big targets, two decisions that matter.
 *
 * The masonry feed already carries a like/dislike rail, but a small icon in a
 * corner is not a habit — this is the version that gets used enough to move the
 * ranking. Every tap writes the same interaction rows the feed writes, so there
 * is no second taste model to keep in sync.
 */

const PRIMARY = [
  { action: 'dislike' as RateAction, label: 'Not for me', key: '←', icon: <ThumbsDown size={20} />, tone: 'bad' },
  { action: 'like' as RateAction, label: 'Like', key: '→', icon: <Heart size={20} />, tone: 'gold' }
];

const SECONDARY = [
  { action: 'save' as RateAction, label: 'Save', key: '↑', icon: <Bookmark size={14} /> },
  { action: 'try' as RateAction, label: 'Want to try', key: 'T', icon: <Sparkles size={14} /> },
  { action: 'buy' as RateAction, label: 'Want to buy', key: 'B', icon: <ShoppingBag size={14} /> },
  { action: 'own' as RateAction, label: 'Already yours', key: 'Y', icon: <Check size={14} /> }
];

export function QuickRate({
  items,
  onRate,
  onUndo,
  onExit,
  onRateMore
}: {
  items: AnyRow[];
  onRate: (item: AnyRow, action: RateAction) => Promise<string>;
  onUndo: (rowId: string) => void;
  onExit: () => void;
  onRateMore: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [log, setLog] = useState<{ item: AnyRow; action: RateAction; rowId: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const item = items[index];
  const src = useImageSrc(item, 'full');

  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  const tally = useMemo(() => {
    const t = { like: 0, dislike: 0, other: 0 };
    for (const e of log) {
      if (e.action === 'like') t.like += 1;
      else if (e.action === 'dislike') t.dislike += 1;
      else t.other += 1;
    }
    return t;
  }, [log]);

  const judge = useCallback(
    async (action: RateAction) => {
      if (!item || busy) return;
      setBusy(true);
      try {
        const rowId = await onRate(item, action);
        setLog((l) => [...l, { item, action, rowId }]);
        setIndex((i) => i + 1);
      } finally {
        setBusy(false);
      }
    },
    [item, busy, onRate]
  );

  const skip = useCallback(() => setIndex((i) => i + 1), []);

  const undo = useCallback(() => {
    setLog((l) => {
      const last = l[l.length - 1];
      if (!last) return l;
      onUndo(last.rowId);
      setIndex((i) => Math.max(0, i - 1));
      return l.slice(0, -1);
    });
  }, [onUndo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onExit();
      if (!item) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        void judge('like');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        void judge('dislike');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        void judge('save');
      } else if (e.key === ' ') {
        e.preventDefault();
        skip();
      } else if (e.key === 'Backspace' || e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else {
        const s = SECONDARY.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
        if (s) {
          e.preventDefault();
          void judge(s.action);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, judge, skip, undo, onExit]);

  const done = index >= items.length;

  return (
    <div className="qr" role="dialog" aria-modal="true" aria-label="Quick rate your references" tabIndex={-1} ref={boxRef}>
      <div className="qr__bar">
        <div>
          <div className="gl-eyebrow">Quick rate</div>
          <div className="qr__count">
            {done ? `${log.length} judged` : `${index + 1} of ${items.length}`}
            <span className="gl-faint"> · {tally.like} liked · {tally.dislike} not for me</span>
          </div>
        </div>
        <div className="qr__meter">
          <Meter value={done ? items.length : index} max={items.length} label="Through this batch" />
        </div>
        <div className="qr__tools">
          <Button size="sm" variant="ghost" onClick={undo} disabled={!log.length}>
            <Undo2 size={13} /> Undo last
          </Button>
          <Button size="sm" variant="ghost" onClick={onExit}>
            <X size={13} /> Done
          </Button>
        </div>
      </div>

      {done ? (
        <div className="qr__end">
          <h3>That is the batch.</h3>
          <p>
            {log.length} action{log.length === 1 ? '' : 's'} written to your interaction log — {tally.like} like
            {tally.like === 1 ? '' : 's'}, {tally.dislike}{" "}
            “not for me”, {tally.other} saved or flagged. The ranking on the feed reads those rows the next time it orders itself;
            nothing here is a model, it is arithmetic over what you just tapped.
          </p>
          <div className="gl-row gl-row--tight">
            <Button onClick={onRateMore}>
              <ChevronRight size={14} /> Rate the next batch
            </Button>
            <Button variant="ghost" onClick={onExit}>
              Back to the feed
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="qr__stage">
            {src ? <img src={src} alt={String(item?.title ?? '')} decoding="async" /> : <div className="gl-missing-img">Image unavailable offline</div>}
          </div>

          <div className="qr__meta">
            <h3 className="qr__title">{String(item?.title ?? 'Untitled reference')}</h3>
            <div className="qr__tags">
              {(((((item?.categories as string[]) ?? []) as string[]).filter(
                (c) => c.toLowerCase() !== String(item?.aesthetic ?? '').toLowerCase()
              )).slice(0, 4) as string[]).map((c) => (
                <Chip key={c}>{c}</Chip>
              ))}
              {item?.aesthetic ? <Chip tone="gold">{String(item.aesthetic)}</Chip> : null}
              <Chip tone="info">{String(item?.providerId ?? 'unknown source')}</Chip>
            </div>
            <p className="qr__credit">
              {String(item?.attribution ?? 'No attribution recorded')} · {String(item?.license ?? 'licence unknown')}
            </p>
          </div>

          <div className="qr__primary">
            {PRIMARY.map((b) => (
              <button key={b.action} type="button" className={`qr__big qr__big--${b.tone}`} disabled={busy} onClick={() => void judge(b.action)}>
                {b.icon}
                <span>{b.label}</span>
                <kbd>{b.key}</kbd>
              </button>
            ))}
          </div>

          <div className="qr__secondary">
            {SECONDARY.map((b) => (
              <Button key={b.action} size="sm" variant="ghost" onClick={() => void judge(b.action)} disabled={busy}>
                {b.icon} {b.label} <kbd className="qr__kbd">{b.key}</kbd>
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={skip}>
              Skip <kbd className="qr__kbd">space</kbd>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
