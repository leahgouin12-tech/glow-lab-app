import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ban, Eye, Layers, RotateCcw, Save, SlidersHorizontal, Trash2, Wand2 } from 'lucide-react';
import {
  Button,
  Chip,
  Field,
  IconButton,
  Modal,
  Range,
  SafetyBanner,
  Select,
  TextArea,
  TextInput,
  Toggle,
  useToast
} from '../ui/primitives';
import { DeptIntro, EmptyPlate, KvList, StatStrip } from '../ui/editorial';
import { CompareSlider, PhotoPicker } from '../ui/media';
import { saveRow, useRows } from '../hooks/live';
import { formatDate, newId, softDelete, todayISO } from '../db/repo';
import { TABLES, type AnyRow } from '../db/schema';
import { ingestImage, objectUrlFor, useImageSrc } from '../media/store';
import { loadSettings, subscribeSettings, type AppSettings } from '../state/settings';
import '../styles/departments/tryon.css';

type BlendKey = 'multiply' | 'overlay' | 'soft-light' | 'color' | 'screen' | 'hue';

interface Region {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

interface HairLayer {
  on: boolean;
  color: string;
  blend: BlendKey;
  opacity: number;
  shape: 'crown' | 'length' | 'fringe';
  region: Region;
}
interface BrowLayer {
  on: boolean;
  color: string;
  opacity: number;
  thickness: number;
  arch: number;
  spread: number;
  region: Region;
}
interface LashLayer {
  on: boolean;
  style: 'natural' | 'voluminous' | 'winged' | 'dramatic';
  color: string;
  opacity: number;
  region: Region;
}
interface LipLayer {
  on: boolean;
  color: string;
  finish: 'matte' | 'gloss' | 'stain';
  opacity: number;
  region: Region;
}
interface SkinLayer {
  on: boolean;
  color: string;
  opacity: number;
  region: Region;
}
interface FrameLayer {
  on: boolean;
  frame: 'rectangular' | 'round' | 'cat' | 'aviator';
  color: string;
  lens: string;
  lensOn: boolean;
  width: number;
  ratio: number;
  opacity: number;
  region: Region;
}
interface GradeLayer {
  on: boolean;
  warmth: number;
  exposure: number;
  contrast: number;
}

interface TryonParams {
  hair: HairLayer;
  brows: BrowLayer;
  lashes: LashLayer;
  lips: LipLayer;
  skin: SkinLayer;
  frame: FrameLayer;
  grade: GradeLayer;
}

type LayerKey = keyof TryonParams;

const LAYER_LABEL: Record<LayerKey, string> = {
  hair: 'Hair colour',
  brows: 'Brow shape & arch',
  lashes: 'Lash style',
  lips: 'Lip shade',
  skin: 'Makeup swatch on skin',
  frame: 'Accessory — eyewear & frame ratio',
  grade: 'Look variant — light & contrast'
};

const BLENDS: BlendKey[] = ['multiply', 'overlay', 'soft-light', 'color', 'screen', 'hue'];

const HAIR_SWATCHES = ['#2b1a12', '#4a2a1a', '#6d3b1e', '#8d5a2b', '#b98a4a', '#3b2a4a', '#6b1226', '#7c2340', '#2a2f45', '#c9a2ae', '#8a8f96', '#efe4d8'];
const LIP_SWATCHES = ['#6b1226', '#8c2233', '#a83246', '#b0475a', '#7c2340', '#4a1420', '#c96a6a', '#8f5a52', '#5c1526', '#d69aa6'];
const SKIN_SWATCHES = ['#f0dcc6', '#e3c3a4', '#c99a76', '#a9744f', '#8a5a3c', '#6b4230', '#3f2620'];
const BROW_SWATCHES = ['#2a1c14', '#3d2a1d', '#553825', '#6d4a30', '#8a6a4a', '#1f1a18'];

function defaultParams(): TryonParams {
  return {
    hair: { on: true, color: '#6b1226', blend: 'color', opacity: 55, shape: 'crown', region: { cx: 50, cy: 16, rx: 34, ry: 16 } },
    brows: { on: false, color: '#3d2a1d', opacity: 55, thickness: 4, arch: 0, spread: 12, region: { cx: 50, cy: 40, rx: 22, ry: 3 } },
    lashes: { on: false, style: 'voluminous', color: '#120e10', opacity: 80, region: { cx: 50, cy: 45, rx: 20, ry: 3 } },
    lips: { on: false, color: '#8c2233', finish: 'gloss', opacity: 65, region: { cx: 50, cy: 72, rx: 11, ry: 5 } },
    skin: { on: false, color: '#c99a76', opacity: 25, region: { cx: 50, cy: 55, rx: 30, ry: 30 } },
    frame: { on: false, frame: 'rectangular', color: '#1b1a1e', lens: '#c9a2ae', lensOn: false, width: 26, ratio: 0.42, opacity: 90, region: { cx: 50, cy: 44, rx: 26, ry: 8 } },
    grade: { on: false, warmth: 0, exposure: 0, contrast: 0 }
  };
}

const BANNER =
  'Simulated preview. Colour and result depend on lighting, camera, hair condition and product. This is not a photograph of the real outcome.';

export default function TryOnPage() {
  const toast = useToast();
  const settings = useSettings();
  const media = useRows(TABLES.mediaItems);
  const experiments = useRows(TABLES.experiments);
  const plans = useRows(TABLES.plans);
  const items = useRows(TABLES.discoveryItems);

  const photos = useMemo(
    () => media.filter((m) => !m.deletedAt && ['upload', 'progress', 'baseline', 'outfit', 'experiment', 'product'].includes(String(m.kind))),
    [media]
  );
  const variants = useMemo(() => media.filter((m) => !m.deletedAt && Boolean((m.data ?? {}) as Record<string, unknown>) && ((m.data as Record<string, unknown>)?.simulated === true)), [media]);

  const [baseId, setBaseId] = useState<string | null>(null);
  const [params, setParams] = useState<TryonParams>(defaultParams());
  const [active, setActive] = useState<LayerKey>('hair');
  const [loaded, setLoaded] = useState<HTMLImageElement | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [variantName, setVariantName] = useState('');
  const [variantNote, setVariantNote] = useState('');
  const [renaming, setRenaming] = useState<AnyRow | null>(null);
  const [rename, setRename] = useState('');
  const [attach, setAttach] = useState<{ mediaId: string; kind: 'experiment' | 'plan'; id: string } | null>(null);
  const [cmp, setCmp] = useState<{ a: string; b: string }>({ a: '', b: '' });
  const [ask, setAsk] = useState<{ title: string; body: string; run: () => void } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const placing = useRef(false);

  const base = useMemo(() => media.find((m) => String(m.id) === baseId), [media, baseId]);
  const baseSrc = useImageSrc(base, 'full');

  /* ------------------------------------------- load the stored draft per photo */
  useEffect(() => {
    if (!base) return;
    const d = ((base.data ?? {}) as Record<string, unknown>).tryonDraft as TryonParams | undefined;
    if (d) setParams(mergeDefaults(d));
    const a = ((base.data ?? {}) as Record<string, unknown>).tryonActive as LayerKey | undefined;
    if (a) setActive(a);
  }, [baseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const persistDraft = useCallback(async () => {
    if (!base) return;
    await saveRow(TABLES.mediaItems, {
      id: String(base.id),
      data: { ...((base.data as Record<string, unknown>) ?? {}), tryonDraft: params, tryonActive: active, draftSavedAt: Date.now() }
    });
    setDirty(false);
  }, [base, params, active]);

  useEffect(() => {
    if (!dirty || !base) return;
    const t = setTimeout(() => void persistDraft(), 900);
    return () => clearTimeout(t);
  }, [dirty, params, active, base, persistDraft]);

  const patch = useCallback(<K extends LayerKey>(key: K, next: Partial<TryonParams[K]>) => {
    setParams((prev) => ({ ...prev, [key]: { ...prev[key], ...next } }));
    setDirty(true);
  }, []);

  /* ------------------------------------------------------------- image loading */
  useEffect(() => {
    if (!baseSrc) {
      setLoaded(null);
      return;
    }
    const img = new Image();
    img.onload = () => setLoaded(img);
    img.onerror = () => setLoaded(null);
    img.src = baseSrc;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [baseSrc]);

  /* ------------------------------------------------------------- the rendering */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded) return;
    drawSimulation(canvas, loaded, params);
  }, [loaded, params]);

  const activeRegion = (params[active] as { region?: Region }).region;

  const placeFromPointer = (clientX: number, clientY: number) => {
    if (!activeRegion || !wrapRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const cy = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
    patch(active, { region: { ...activeRegion, cx, cy } } as never);
  };

  const download = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `glow-simulated-${todayISO()}.png`;
    a.click();
    toast('Downloaded — the PNG keeps no watermark, so do not post it as if it were a real result.', 'info');
  };

  const saveVariant = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded || !base) return;
    const name = variantName.trim() || `Try-on ${variants.length + 1}`;
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png', 0.95));
    if (!blob) {
      toast('This browser refused to export the canvas.', 'bad');
      return;
    }
    const res = await ingestImage({
      blobHint: blob,
      kind: 'experiment',
      album: 'Try-On simulations',
      title: name,
      caption: `${BANNER} Built from “${String(base.title || base.id)}” with the layers listed in this record. ${variantNote.trim()}`,
      sourceKind: 'user',
      private: settings?.privateMediaByDefault ?? true,
      linkedDomain: 'tryon',
      linkedIds: [String(base.id)]
    });
    const saved = await saveRow(TABLES.mediaItems, {
      id: String(res.row.id),
      tags: ['simulated', 'tryon'],
      data: {
        ...((res.row.data as Record<string, unknown>) ?? {}),
        simulated: true,
        baseMediaId: String(base.id),
        params,
        layerSummary: activeLayerNames(params),
        note: variantNote.trim(),
        savedOn: todayISO()
      }
    });
    await saveRow(TABLES.observations, {
      subjectType: 'mediaItem',
      subjectId: String(saved.id),
      on: todayISO(),
      note: `Saved a simulated preview. Layers: ${activeLayerNames(params).join(', ') || 'none'}. ${variantNote.trim() || 'No written expectation.'}`,
      reaction: 'unknown',
      severity: 0,
      mediaIds: [String(saved.id), String(base.id)],
      tags: ['tryon', 'simulated'],
      data: { simulated: true, layers: activeLayerNames(params) }
    });
    setSaveOpen(false);
    setVariantNote('');
    setVariantName('');
    toast(res.duplicate ? 'That exact simulation was already stored — matched by content hash.' : `“${name}” saved and labelled simulated.`, 'ok');
  };

  const attachVariant = async () => {
    if (!attach) return;
    const row = media.find((m) => String(m.id) === attach.mediaId);
    if (!row) return;
    if (attach.kind === 'experiment') {
      const ex = experiments.find((e) => String(e.id) === attach.id);
      if (!ex) return;
      await saveRow(TABLES.experiments, {
        id: String(ex.id),
        data: { ...((ex.data as Record<string, unknown>) ?? {}), variantMediaIds: [...new Set([((((ex.data as Record<string, unknown>)?.variantMediaIds ?? []) as string[])), attach.mediaId])] }
      });
    } else {
      const pl = plans.find((p) => String(p.id) === attach.id);
      if (!pl) return;
      await saveRow(TABLES.plans, {
        id: String(pl.id),
        data: { ...((pl.data as Record<string, unknown>) ?? {}), variantMediaIds: [...new Set([((((pl.data as Record<string, unknown>)?.variantMediaIds ?? []) as string[])), attach.mediaId])] }
      });
    }
    await saveRow(TABLES.mediaItems, {
      id: attach.mediaId,
      linkedDomain: attach.kind,
      linkedIds: [...(((row.linkedIds as string[]) ?? []) as string[]), attach.id].filter(Boolean),
      data: { ...((row.data as Record<string, unknown>) ?? {}), [`linked${attach.kind === 'experiment' ? 'Experiment' : 'Plan'}Id`]: attach.id }
    });
    setAttach(null);
    toast('Attached — the record exists on both sides now.');
  };

  const loadVariant = (v: AnyRow) => {
    const p = ((v.data ?? {}) as Record<string, unknown>).params as TryonParams | undefined;
    const parentId = String(((v.data ?? {}) as Record<string, unknown>).baseMediaId ?? '');
    if (!p) {
      toast('This variant has no stored layer parameters.', 'bad');
      return;
    }
    if (parentId) setBaseId(parentId);
    setParams(mergeDefaults(p));
    setDirty(true);
    toast(`Loaded the settings behind “${String(v.title)}”.`);
  };

  const cmpA = variants.find((v) => String(v.id) === cmp.a);
  const cmpB = variants.find((v) => String(v.id) === cmp.b);

  const referenceIdeas = useMemo(
    () =>
      items
        .filter((i) => ((i.palette as string[]) ?? []).length)
        .slice(0, 8)
        .map((i) => ({ id: String(i.id), title: String(i.title), color: String(((i.palette as string[]) ?? [])[0] ?? '') })),
    [items]
  );

  return (
    <div className="gl-page">
      <DeptIntro
        id="tryon"
        actions={
          <>
            <PhotoPicker
              kind="upload"
              album="Try-On base photos"
              label="Add your own photo"
              onPick={(rows) => {
                if (rows[0]) {
                  setBaseId(String(rows[0].id));
                  setParams(defaultParams());
                  toast('Loaded. Only your own photographs can be simulated here.');
                }
              }}
            />
            <Button variant="primary" icon={<Save size={14} />} onClick={() => setSaveOpen(true)} disabled={!loaded}>
              Save as variant
            </Button>
          </>
        }
        meta={[
          { label: 'Base photos', value: photos.length },
          { label: 'Saved variants', value: variants.length },
          { label: 'Layers live', value: activeLayerNames(params).length },
          { label: 'Vision service', value: 'none in this build' }
        ]}
      />

      <SafetyBanner tone="danger" title="Simulated preview — read this every time">
        <p style={{ margin: 0 }}>{BANNER}</p>
        <p style={{ margin: '8px 0 0' }} className="gl-small">
          There is no face detection, no generative model and no brand-matching in this department. Every layer is a coloured, blend-mode patch
          that <em>you</em> position and size. Saved variants are labelled <code>simulated</code> in their record and filterable as such in the
          Media Studio.
        </p>
      </SafetyBanner>

      <div className="gl-tryon">
        <div className="gl-stack">
          <div className="gl-sim" ref={wrapRef}>
            {loaded ? (
              <canvas
                ref={canvasRef}
                role="img"
                aria-label="Simulated preview of your own photograph with your own layer settings"
                style={{ cursor: activeRegion ? 'crosshair' : 'default', touchAction: 'none' }}
                onPointerDown={(e) => {
                  placing.current = true;
                  placeFromPointer(e.clientX, e.clientY);
                }}
                onPointerMove={(e) => placing.current && placeFromPointer(e.clientX, e.clientY)}
                onPointerUp={() => {
                  placing.current = false;
                }}
                onPointerLeave={() => {
                  placing.current = false;
                }}
              />
            ) : (
              <div className="gl-sim__empty">
                <div>
                  <Wand2 size={22} style={{ opacity: 0.5 }} />
                  <div className="gl-serif" style={{ fontSize: '1.15rem', marginTop: 8 }}>
                    No photograph loaded
                  </div>
                  <p className="gl-small" style={{ maxWidth: '46ch', margin: '6px auto 12px' }}>
                    Choose one of your own images below, or add a new one. The simulation is drawn locally on this device and never uploaded.
                  </p>
                  <PhotoPicker kind="upload" album="Try-On base photos" label="Add your own photo" onPick={(rows) => rows[0] && setBaseId(String(rows[0].id))} />
                </div>
              </div>
            )}
            {loaded ? (
              <div className="gl-sim__watermark">
                <Ban size={13} />
                <span>Simulated preview · not a real result</span>
                <span style={{ marginLeft: 'auto' }}>{activeLayerNames(params).join(' · ') || 'no layers on'}</span>
              </div>
            ) : null}
          </div>

          <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
            <span className="gl-small gl-faint">Move the selected layer:</span>
            {(['hair', 'brows', 'lashes', 'lips', 'skin', 'frame'] as LayerKey[])
              .filter((k) => k !== 'grade')
              .map((k) => (
                <Chip key={k} active={active === k} onClick={() => setActive(k)}>
                  {LAYER_LABEL[k]}
                </Chip>
              ))}
            <span className="gl-tech">tap or drag on the image</span>
          </div>

          <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
            <Field label="Base photograph">
              <Select
                value={baseId ?? ''}
                onChange={(v) => setBaseId(v || null)}
                placeholder="Choose one of your images"
                options={photos.map((p) => ({ value: String(p.id), label: `${String(p.title || p.id)} · ${String(p.kind)} · ${formatDate(String(p.takenOn ?? ''))}` }))}
              />
            </Field>
            <Button variant="ghost" icon={<RotateCcw size={14} />} onClick={() => { setParams(defaultParams()); setDirty(true); }}>
              Reset layers
            </Button>
            <Button icon={<Layers size={14} />} onClick={() => void persistDraft()} disabled={!base}>
              Save draft on this photo
            </Button>
            <Button onClick={() => void download()} disabled={!loaded}>
              Download PNG
            </Button>
            <span className="gl-tech">{dirty ? 'unsaved…' : base ? 'draft stored on the photo record' : 'no photo selected'}</span>
          </div>

          <div className="gl-inset">
            <div className="gl-label" style={{ marginBottom: 6 }}>Bring a colour in from your own references</div>
            <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
              {referenceIdeas.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="gl-pin__act"
                  title={`Use ${r.color} from “${r.title}” on the selected layer`}
                  style={{ width: 30, height: 30, borderRadius: '50%', background: r.color, border: '1px solid var(--glow-line-strong)', cursor: 'pointer' }}
                  onClick={() => {
                    if (active === 'hair' || active === 'lips' || active === 'skin' || active === 'brows' || active === 'frame') {
                      patch(active, { color: r.color } as never);
                      toast(`${r.color} taken from “${r.title}” and applied to ${LAYER_LABEL[active]}.`);
                    } else {
                      toast('Pick a colour-bearing layer first (hair, brows, lips, skin, eyewear).', 'info');
                    }
                  }}
                />
              ))}
              {!referenceIdeas.length ? <span className="gl-small gl-faint">No palette is stored on your references yet.</span> : null}
            </div>
            <p className="gl-small gl-faint" style={{ marginBottom: 0 }}>
              These are palette hexes already recorded on references in your library — a colour you liked, not a recommendation of what suits you.
            </p>
          </div>
        </div>

        {/* ------------------------------------------------------------ layers */}
        <div className="gl-stack">
          <LayerCard title={LAYER_LABEL.hair} layer={params.hair} onToggle={(v) => patch('hair', { on: v })} onActivate={() => setActive('hair')} active={active === 'hair'}>
            <div className="gl-layer__grid">
              <SwatchPicker label="Colour" value={params.hair.color} onChange={(v) => patch('hair', { color: v })} swatches={HAIR_SWATCHES} />
              <Field label="Coverage shape">
                <Select
                  value={params.hair.shape}
                  onChange={(v) => patch('hair', { shape: v as HairLayer['shape'] })}
                  options={[
                    { value: 'crown', label: 'Crown & roots' },
                    { value: 'length', label: 'Length / mid-lengths' },
                    { value: 'fringe', label: 'Face-framing pieces' }
                  ]}
                />
              </Field>
              <Field label="Blend mode">
                <Select value={params.hair.blend} onChange={(v) => patch('hair', { blend: v as BlendKey })} options={BLENDS.map((b) => ({ value: b, label: b }))} />
              </Field>
              <Range label="Strength" value={params.hair.opacity} onChange={(v) => patch('hair', { opacity: v })} format={(v) => `${v}%`} />
              <Range label="Width" min={6} max={60} value={params.hair.region.rx} onChange={(v) => patch('hair', { region: { ...params.hair.region, rx: v } })} format={(v) => `${v}%`} />
              <Range label="Height" min={3} max={40} value={params.hair.region.ry} onChange={(v) => patch('hair', { region: { ...params.hair.region, ry: v } })} format={(v) => `${v}%`} />
            </div>
            <p className="gl-layer__note gl-small gl-faint">
              On locs or tightly coiled hair, colour uptake is mostly about porosity and the section you actually saturate — a flat overlay here
              shows a mood, not a result.
            </p>
          </LayerCard>

          <LayerCard title={LAYER_LABEL.brows} layer={params.brows} onToggle={(v) => patch('brows', { on: v })} onActivate={() => setActive('brows')} active={active === 'brows'}>
            <div className="gl-layer__grid">
              <SwatchPicker label="Pencil/gel shade" value={params.brows.color} onChange={(v) => patch('brows', { color: v })} swatches={BROW_SWATCHES} />
              <Range label="Thickness" min={1} max={14} value={params.brows.thickness} onChange={(v) => patch('brows', { thickness: v })} format={(v) => `${v}px`} />
              <Range label="Arch lift" min={-12} max={12} value={params.brows.arch} onChange={(v) => patch('brows', { arch: v })} format={(v) => `${v > 0 ? '+' : ''}${v}`} />
              <Range label="Separation" min={4} max={30} value={params.brows.spread} onChange={(v) => patch('brows', { spread: v })} format={(v) => `${v}%`} />
              <Range label="Strength" value={params.brows.opacity} onChange={(v) => patch('brows', { opacity: v })} format={(v) => `${v}%`} />
            </div>
            <p className="gl-layer__note gl-small gl-faint">
              Position the pair by dragging on the image. Bone structure and your own hair direction still decide what is achievable.
            </p>
          </LayerCard>

          <LayerCard title={LAYER_LABEL.lashes} layer={params.lashes} onToggle={(v) => patch('lashes', { on: v })} onActivate={() => setActive('lashes')} active={active === 'lashes'}>
            <div className="gl-layer__grid">
              <Field label="Style">
                <Select
                  value={params.lashes.style}
                  onChange={(v) => patch('lashes', { style: v as LashLayer['style'] })}
                  options={[
                    { value: 'natural', label: 'Natural — thin line' },
                    { value: 'voluminous', label: 'Voluminous — dense band' },
                    { value: 'winged', label: 'Winged — outer-heavy' },
                    { value: 'dramatic', label: 'Dramatic — full band + length' }
                  ]}
                />
              </Field>
              <Range label="Line weight" min={1} max={12} value={Math.round(params.lashes.opacity / 10)} onChange={(v) => patch('lashes', { opacity: v * 10 })} format={(v) => `${v}`} />
              <Range label="Width" min={5} max={34} value={params.lashes.region.rx} onChange={(v) => patch('lashes', { region: { ...params.lashes.region, rx: v } })} format={(v) => `${v}%`} />
              <SwatchPicker label="Line colour" value={params.lashes.color} onChange={(v) => patch('lashes', { color: v })} swatches={['#120e10', '#241a1e', '#2b2126', '#3b1e35']} />
            </div>
          </LayerCard>

          <LayerCard title={LAYER_LABEL.lips} layer={params.lips} onToggle={(v) => patch('lips', { on: v })} onActivate={() => setActive('lips')} active={active === 'lips'}>
            <div className="gl-layer__grid">
              <SwatchPicker label="Shade" value={params.lips.color} onChange={(v) => patch('lips', { color: v })} swatches={LIP_SWATCHES} />
              <Field label="Finish">
                <Select
                  value={params.lips.finish}
                  onChange={(v) => patch('lips', { finish: v as LipLayer['finish'] })}
                  options={[
                    { value: 'matte', label: 'Matte — flat' },
                    { value: 'gloss', label: 'Gloss — added highlight' },
                    { value: 'stain', label: 'Stain — soft edge' }
                  ]}
                />
              </Field>
              <Range label="Strength" value={params.lips.opacity} onChange={(v) => patch('lips', { opacity: v })} format={(v) => `${v}%`} />
              <Range label="Width" min={4} max={26} value={params.lips.region.rx} onChange={(v) => patch('lips', { region: { ...params.lips.region, rx: v } })} format={(v) => `${v}%`} />
              <Range label="Height" min={2} max={16} value={params.lips.region.ry} onChange={(v) => patch('lips', { region: { ...params.lips.region, ry: v } })} format={(v) => `${v}%`} />
            </div>
            <p className="gl-layer__note gl-small gl-faint">
              Your natural lip pigment shows through everything except a full-coverage formula. A screen blend is the honest way to read a bright
              shade; a multiply is closer to a sheer one.
            </p>
          </LayerCard>

          <LayerCard title={LAYER_LABEL.skin} layer={params.skin} onToggle={(v) => patch('skin', { on: v })} onActivate={() => setActive('skin')} active={active === 'skin'}>
            <div className="gl-layer__grid">
              <SwatchPicker label="Swatch" value={params.skin.color} onChange={(v) => patch('skin', { color: v })} swatches={SKIN_SWATCHES} />
              <Range label="Strength" min={0} max={70} value={params.skin.opacity} onChange={(v) => patch('skin', { opacity: v })} format={(v) => `${v}%`} />
              <Range label="Radius" min={6} max={50} value={params.skin.region.rx} onChange={(v) => patch('skin', { region: { ...params.skin.region, rx: v, ry: v } })} format={(v) => `${v}%`} />
            </div>
            <p className="gl-layer__note gl-small gl-faint">
              One overlay for blush, bronzer or a foundation swatch — blend strength only. Undertone judgement belongs in Personal Color, where
              you compare palettes against each other instead of against a filter.
            </p>
          </LayerCard>

          <LayerCard title={LAYER_LABEL.frame} layer={params.frame} onToggle={(v) => patch('frame', { on: v })} onActivate={() => setActive('frame')} active={active === 'frame'}>
            <div className="gl-layer__grid">
              <Field label="Frame shape">
                <Select
                  value={params.frame.frame}
                  onChange={(v) => patch('frame', { frame: v as FrameLayer['frame'] })}
                  options={[
                    { value: 'rectangular', label: 'Rectangular' },
                    { value: 'round', label: 'Round' },
                    { value: 'cat', label: 'Cat' },
                    { value: 'aviator', label: 'Teardrop' }
                  ]}
                />
              </Field>
              <Range label="Frame width" min={8} max={50} value={params.frame.width} onChange={(v) => patch('frame', { width: v })} format={(v) => `${v}%`} />
              <Range label="Frame ratio (h ÷ w)" min={0.2} max={1} step={0.05} value={params.frame.ratio} onChange={(v) => patch('frame', { ratio: v })} format={(v) => v.toFixed(2)} />
              <Range label="Temple height" min={2} max={30} value={Math.round(params.frame.region.ry)} onChange={(v) => patch('frame', { region: { ...params.frame.region, ry: v } })} format={(v) => `${v}%`} />
              <Toggle checked={params.frame.lensOn} onChange={(v) => patch('frame', { lensOn: v })} label="Show tinted lenses" />
              <SwatchPicker label="Frame colour" value={params.frame.color} onChange={(v) => patch('frame', { color: v })} swatches={['#1b1a1e', '#c9a2ae', '#8d6b52', '#e2c49a', '#3b1e35', '#5a5f66']} />
              <SwatchPicker label="Lens tint" value={params.frame.lens} onChange={(v) => patch('frame', { lens: v })} swatches={['#c9a2ae', '#7b5a44', '#3b1e35', '#2a2f45', '#dccdb9']} />
            </div>
          </LayerCard>

          <LayerCard title={LAYER_LABEL.grade} layer={params.grade} onToggle={(v) => patch('grade', { on: v })} onActivate={() => setActive('grade')} active={active === 'grade'}>
            <div className="gl-layer__grid">
              <Range label="Warmth" min={-40} max={40} value={params.grade.warmth} onChange={(v) => patch('grade', { warmth: v })} format={(v) => `${v > 0 ? '+' : ''}${v}`} />
              <Range label="Exposure" min={-40} max={40} value={params.grade.exposure} onChange={(v) => patch('grade', { exposure: v })} format={(v) => `${v > 0 ? '+' : ''}${v}`} />
              <Range label="Contrast" min={-40} max={40} value={params.grade.contrast} onChange={(v) => patch('grade', { contrast: v })} format={(v) => `${v > 0 ? '+' : ''}${v}`} />
            </div>
            <p className="gl-layer__note gl-small gl-faint">
              A whole-image light study for planning a shoot or an event look. It changes the photograph, not you — and comparing a graded preview
              to someone else’s ungraded selfie is meaningless.
            </p>
          </LayerCard>
        </div>
      </div>

      {/* ----------------------------------------------------------- variants */}
      <section className="gl-section">
        <div className="gl-row gl-row--between" style={{ marginBottom: 'var(--glow-sp-4)', flexWrap: 'wrap', gap: 'var(--glow-sp-3)' }}>
          <div>
            <h2 className="gl-serif" style={{ margin: 0 }}>
              Saved variants
            </h2>
            <p className="gl-small gl-muted" style={{ margin: '4px 0 0', maxWidth: '62ch' }}>
              Each one is a real image record: your parameters, the base photograph it came from and a <code>simulated</code> label that survives
              export.
            </p>
          </div>
          <div className="gl-row gl-row--tight">
            <Button variant="primary" icon={<Save size={14} />} onClick={() => setSaveOpen(true)} disabled={!loaded}>
              Save current look
            </Button>
          </div>
        </div>

        {variants.length ? (
          <>
            <div className="gl-variants">
              {variants
                .slice()
                .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
                .map((v) => (
                  <VariantCard
                    key={String(v.id)}
                    variant={v}
                    onRename={() => {
                      setRenaming(v);
                      setRename(String(v.title ?? ''));
                    }}
                    onLoad={() => loadVariant(v)}
                    onAttach={() => setAttach({ mediaId: String(v.id), kind: 'experiment', id: '' })}
                    onCompare={() => setCmp({ a: cmp.a || String(v.id), b: String(v.id) })}
                    onDelete={() =>
                      setAsk({
                        title: 'Delete this simulated variant?',
                        body: 'Soft-deleted: it moves to deleted records and can be restored in Settings. The base photograph is untouched.',
                        run: () => void softDelete(TABLES.mediaItems, String(v.id))
                      })
                    }
                  />
                ))}
            </div>
            <div className="gl-inset" style={{ marginTop: 'var(--glow-sp-5)' }}>
              <div className="gl-label" style={{ marginBottom: 8 }}>
                Compare two variants
              </div>
              <div className="gl-form-row">
                <Field label="Left">
                  <Select
                    value={cmp.a}
                    onChange={(v) => setCmp({ ...cmp, a: v })}
                    placeholder="Choose a variant"
                    options={variants.map((v) => ({ value: String(v.id), label: String(v.title || v.id) }))}
                  />
                </Field>
                <Field label="Right">
                  <Select
                    value={cmp.b}
                    onChange={(v) => setCmp({ ...cmp, b: v })}
                    placeholder="Choose a variant"
                    options={variants.map((v) => ({ value: String(v.id), label: String(v.title || v.id) }))}
                  />
                </Field>
              </div>
              {cmpA && cmpB ? (
                <>
                  <CompareSlider before={cmpA} after={cmpB} beforeLabel={String(cmpA.title)} afterLabel={String(cmpB.title)} height={380} />
                  <p className="gl-small gl-faint" style={{ marginBottom: 0 }}>
                    Both sides are simulations of the same capture conditions only if the base photograph is the same. Check the record underneath
                    before drawing a conclusion.
                  </p>
                </>
              ) : (
                <p className="gl-small gl-faint">Pick two saved variants to see them side by side.</p>
              )}
            </div>
          </>
        ) : (
          <EmptyPlate
            kicker="Nothing saved yet"
            title="No simulated variants stored"
            body="Dial in a look and save it: the parameters, the base photo and the rendered preview are stored together on this device, private by default."
            action={<Button variant="primary" onClick={() => setSaveOpen(true)} disabled={!loaded}>Save current look</Button>}
          />
        )}
      </section>

      <section className="gl-section">
        <div className="gl-card gl-card--plain">
          <h3 style={{ marginTop: 0 }}>The honest limits of this page</h3>
          <KvList
            items={[
              { k: 'Face detection', v: 'Not present. You place every layer by hand.' },
              { k: 'Brand or product matching', v: 'None. No shade name, price or availability is implied.' },
              { k: 'Face swaps / other people', v: 'Never. Only images in your own library can be loaded, and they stay private by default.' },
              { k: 'Colour accuracy', v: `Approximate — screen profile, camera white balance and the blend mode you picked all move it.` },
              { k: 'Hair results', v: 'A flat overlay cannot model porosity, pre-pigment, developer volume or how locs take colour.' },
              { k: 'Where the record goes', v: 'mediaItems (simulated), one observation row, plus any experiment or plan you attach it to.' }
            ]}
          />
          <StatStrip
            items={[
              { label: 'Photos on file', value: photos.length },
              { label: 'Variants saved', value: variants.length },
              { label: 'Experiments to attach to', value: experiments.filter((e) => !e.deletedAt).length },
              { label: 'Plans to attach to', value: plans.filter((p) => !p.deletedAt).length }
            ]}
          />
        </div>
      </section>

      {/* ------------------------------------------------------------ modals */}
      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save this simulation as a variant"
        footer={
          <>
            <span className="gl-small gl-faint">Stored privately, labelled <code>simulated</code>, with its parameters.</span>
            <Button variant="primary" onClick={() => void saveVariant()} disabled={!loaded}>
              Save variant
            </Button>
          </>
        }
      >
        <Field label="Name">
          <TextInput value={variantName} onChange={setVariantName} placeholder="oxblood gloss · voluminous · low-key" />
        </Field>
        <Field label="What you are testing" hint="Written into the observation row so a later you knows what you were checking.">
          <TextArea value={variantNote} onChange={setVariantNote} rows={3} placeholder="Would a plum lip be too much for everyday?" />
        </Field>
        <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
          {activeLayerNames(params).map((n) => (
            <Chip key={n} tone="gold">
              {n}
            </Chip>
          ))}
        </div>
      </Modal>

      <Modal
        open={Boolean(renaming)}
        onClose={() => setRenaming(null)}
        title="Rename variant"
        footer={
          <>
            <span className="gl-small gl-faint">Only the title changes.</span>
            <Button
              variant="primary"
              onClick={async () => {
                if (!renaming || !rename.trim()) return;
                await saveRow(TABLES.mediaItems, { id: String(renaming.id), title: rename.trim() });
                setRenaming(null);
                toast('Renamed.');
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Field label="Name">
          <TextInput value={rename} onChange={setRename} />
        </Field>
      </Modal>

      <Modal
        open={Boolean(attach)}
        onClose={() => setAttach(null)}
        title="Attach this variant to a record"
        footer={
          <>
            <span className="gl-small gl-faint">Writes on both rows: the link and the media reference.</span>
            <Button variant="primary" onClick={() => void attachVariant()} disabled={!attach?.id}>
              Attach
            </Button>
          </>
        }
      >
        <Field label="Attach to">
          <Select
            value={attach?.kind ?? 'experiment'}
            onChange={(v) => setAttach({ ...(attach as { mediaId: string; kind: 'experiment' | 'plan'; id: string }), kind: v as 'experiment' | 'plan', id: '' })}
            options={[
              { value: 'experiment', label: 'An experiment (Experimentation Lab)' },
              { value: 'plan', label: 'A plan (Command Center / Recreate)' }
            ]}
          />
        </Field>
        <Field label="Which one">
          <Select
            value={attach?.id ?? ''}
            onChange={(v) => attach && setAttach({ ...attach, id: v })}
            placeholder="Choose a record"
            options={(attach?.kind === 'plan' ? plans : experiments)
              .filter((r) => !r.deletedAt)
              .map((r) => ({ value: String(r.id), label: String(r.name || r.title || r.id) }))}
          />
        </Field>
        <p className="gl-small gl-faint">
          Simulation previews are useful for deciding what to test. They are never evidence — the experiment row is where the real observations
          live.
        </p>
      </Modal>

      <Modal
        open={Boolean(ask)}
        onClose={() => setAsk(null)}
        title={ask?.title ?? ''}
        footer={
          <>
            <span className="gl-small gl-faint">Nothing leaves this device.</span>
            <div className="gl-row gl-row--tight">
              <Button variant="ghost" onClick={() => setAsk(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  ask?.run();
                  setAsk(null);
                }}
              >
                Confirm
              </Button>
            </div>
          </>
        }
      >
        <p className="gl-small">{ask?.body}</p>
      </Modal>
    </div>
  );
}

/* ---------------------------------------------------------------- rendering */

function activeLayerNames(p: TryonParams) {
  return (Object.keys(LAYER_LABEL) as LayerKey[]).filter((k) => p[k].on).map((k) => LAYER_LABEL[k]);
}

function mergeDefaults(raw: TryonParams): TryonParams {
  const d = defaultParams();
  const out = { ...d };
  for (const k of Object.keys(d) as LayerKey[]) {
    const given = (raw as unknown as Record<string, unknown>)[k] as Record<string, unknown> | undefined;
    if (given) (out as Record<string, unknown>)[k] = { ...d[k], ...given, region: { ...(d[k] as { region?: Region }).region, ...((given.region as Region) ?? {}) } };
  }
  return out;
}

function drawSimulation(canvas: HTMLCanvasElement, img: HTMLImageElement, p: TryonParams) {
  const w = img.naturalWidth || 900;
  const h = img.naturalHeight || 1200;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const X = (v: number) => (v / 100) * w;
  const Y = (v: number) => (v / 100) * h;

  const withBlend = (blend: BlendKey, alpha: number, run: () => void) => {
    ctx.save();
    ctx.globalCompositeOperation = blend;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha / 100));
    run();
    ctx.restore();
  };

  const ellipse = (r: Region, offset = 0) => {
    ctx.beginPath();
    ctx.ellipse(X(r.cx + offset), Y(r.cy), X(r.rx), Y(r.ry), 0, 0, Math.PI * 2);
  };

  if (p.skin.on) {
    withBlend('soft-light', p.skin.opacity, () => {
      ellipse(p.skin.region);
      ctx.fillStyle = p.skin.color;
      ctx.fill();
    });
    withBlend('color', Math.round(p.skin.opacity * 0.6), () => {
      ellipse(p.skin.region);
      ctx.fillStyle = p.skin.color;
      ctx.fill();
    });
  }

  if (p.hair.on) {
    const r = { ...p.hair.region };
    withBlend(p.hair.blend, p.hair.opacity, () => {
      if (p.hair.shape === 'length') {
        ctx.beginPath();
        ctx.moveTo(X(r.cx - r.rx), Y(r.cy));
        ctx.quadraticCurveTo(X(r.cx - r.rx * 1.2), Y(r.cy + r.ry * 4), X(r.cx - r.rx * 0.5), Y(Math.min(100, r.cy + r.ry * 6)));
        ctx.lineTo(X(r.cx + r.rx * 0.5), Y(Math.min(100, r.cy + r.ry * 6)));
        ctx.quadraticCurveTo(X(r.cx + r.rx * 1.2), Y(r.cy + r.ry * 4), X(r.cx + r.rx), Y(r.cy));
        ctx.closePath();
      } else if (p.hair.shape === 'fringe') {
        ctx.beginPath();
        ctx.moveTo(X(r.cx - r.rx), Y(r.cy + r.ry));
        ctx.quadraticCurveTo(X(r.cx), Y(r.cy - r.ry * 1.8), X(r.cx + r.rx), Y(r.cy + r.ry));
        ctx.quadraticCurveTo(X(r.cx), Y(r.cy + r.ry * 2.4), X(r.cx - r.rx), Y(r.cy + r.ry));
        ctx.closePath();
      } else {
        ellipse(r);
      }
      ctx.fillStyle = p.hair.color;
      ctx.fill();
    });
  }

  if (p.brows.on) {
    withBlend('multiply', p.brows.opacity, () => {
      ctx.strokeStyle = p.brows.color;
      ctx.lineWidth = Math.max(1, (p.brows.thickness / 1000) * h);
      ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        const cx = p.brows.region.cx + side * p.brows.spread;
        ctx.beginPath();
        ctx.moveTo(X(cx - p.brows.region.rx / 2), Y(p.brows.region.cy));
        ctx.quadraticCurveTo(X(cx), Y(p.brows.region.cy - p.brows.arch - p.brows.thickness), X(cx + p.brows.region.rx / 2), Y(p.brows.region.cy + 1));
        ctx.stroke();
      }
    });
  }

  if (p.lashes.on) {
    const density = p.lashes.style === 'natural' ? 1 : p.lashes.style === 'voluminous' ? 2 : p.lashes.style === 'winged' ? 2 : 3;
    withBlend('multiply', p.lashes.opacity, () => {
      ctx.strokeStyle = p.lashes.color;
      ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        const cx = p.lashes.region.cx + side * (p.lashes.region.rx * 0.55);
        const rx = p.lashes.region.rx * 0.5;
        ctx.lineWidth = Math.max(1, (2 * density / 1000) * h);
        ctx.beginPath();
        ctx.moveTo(X(cx - rx), Y(p.lashes.region.cy));
        ctx.quadraticCurveTo(X(cx), Y(p.lashes.region.cy - p.lashes.region.ry - density), X(cx + rx), Y(p.lashes.region.cy + (p.lashes.style === 'winged' ? -density : 0)));
        ctx.stroke();
        const lashes = density * 5;
        for (let i = 0; i < lashes; i += 1) {
          const t = i / (lashes - 1 || 1);
          const px = cx - rx + t * rx * 2;
          const lift = (p.lashes.style === 'dramatic' ? 3.2 : 1.8) * p.lashes.region.ry * Math.sin(Math.PI * (t * 0.9 + 0.05));
          ctx.lineWidth = Math.max(0.6, (1.1 / 1000) * h);
          ctx.beginPath();
          ctx.moveTo(X(px), Y(p.lashes.region.cy));
          ctx.lineTo(X(px + (p.lashes.style === 'winged' && t > 0.6 ? rx * 0.18 : 0)), Y(p.lashes.region.cy - lift));
          ctx.stroke();
        }
      }
    });
  }

  if (p.lips.on) {
    withBlend(p.lips.finish === 'stain' ? 'multiply' : 'color', p.lips.opacity, () => {
      ellipse(p.lips.region);
      ctx.fillStyle = p.lips.color;
      ctx.fill();
    });
    if (p.lips.finish === 'gloss') {
      withBlend('screen', 30, () => {
        ellipse({ ...p.lips.region, ry: Math.max(1, p.lips.region.ry * 0.4), cy: p.lips.region.cy + p.lips.region.ry * 0.55 });
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      });
    }
    if (p.lips.finish === 'matte') {
      withBlend('soft-light', 22, () => {
        ellipse({ ...p.lips.region, ry: Math.max(1, p.lips.region.ry * 0.3) });
        ctx.fillStyle = '#000000';
        ctx.fill();
      });
    }
  }

  if (p.frame.on) {
    const fw = p.frame.width;
    const fh = Math.max(2, fw * p.frame.ratio);
    const cy = p.frame.region.cy;
    const ry = Math.max(2, p.frame.region.ry);
    const drawFrame = (cx: number) => {
      ctx.beginPath();
      if (p.frame.frame === 'round') {
        ctx.ellipse(X(cx), Y(cy), X(fw / 2), Y(fh / 2), 0, 0, Math.PI * 2);
      } else if (p.frame.frame === 'cat') {
        ctx.moveTo(X(cx - fw / 2), Y(cy - fh / 3));
        ctx.lineTo(X(cx + fw / 2.6), Y(cy - fh / 2));
        ctx.lineTo(X(cx + fw / 2), Y(cy - fh / 6));
        ctx.lineTo(X(cx + fw / 3), Y(cy + fh / 2));
        ctx.lineTo(X(cx - fw / 2.4), Y(cy + fh / 2.4));
        ctx.closePath();
      } else if (p.frame.frame === 'aviator') {
        ctx.moveTo(X(cx - fw / 2), Y(cy - fh / 2));
        ctx.lineTo(X(cx + fw / 2), Y(cy - fh / 2));
        ctx.quadraticCurveTo(X(cx + fw / 3), Y(cy + fh), X(cx - fw / 2.6), Y(cy + fh / 4));
        ctx.closePath();
      } else {
        const rr = Math.min(X(fw / 8), Y(fh / 8));
        roundRect(ctx, X(cx - fw / 2), Y(cy - fh / 2), X(fw), Y(fh), rr);
      }
    };
    const left = p.frame.region.cx - fw / 2 - p.frame.region.rx * 0.16;
    const right = p.frame.region.cx + fw / 2 + p.frame.region.rx * 0.16;
    withBlend('source-over' as BlendKey, p.frame.opacity, () => {
      ctx.lineWidth = Math.max(1.5, (ry / 100) * h * 0.35);
      ctx.strokeStyle = p.frame.color;
      drawFrame(left);
      ctx.stroke();
      drawFrame(right);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(X(left + fw / 2), Y(cy - fh / 4));
      ctx.quadraticCurveTo(X(p.frame.region.cx), Y(cy - fh / 2.2), X(right - fw / 2), Y(cy - fh / 4));
      ctx.stroke();
      if (p.frame.lensOn) {
        ctx.save();
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = 0.42;
        ctx.fillStyle = p.frame.lens;
        drawFrame(left);
        ctx.fill();
        drawFrame(right);
        ctx.fill();
        ctx.restore();
      }
    });
  }

  if (p.grade.on) {
    if (p.grade.warmth !== 0) {
      withBlend('overlay', Math.abs(p.grade.warmth) * 0.9, () => {
        ctx.fillStyle = p.grade.warmth > 0 ? '#d98a3c' : '#4a6c8a';
        ctx.fillRect(0, 0, w, h);
      });
    }
    if (p.grade.exposure !== 0) {
      withBlend(p.grade.exposure > 0 ? 'screen' : 'multiply', Math.abs(p.grade.exposure) * 0.8, () => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
      });
    }
    if (p.grade.contrast !== 0) {
      withBlend(p.grade.contrast > 0 ? 'overlay' : 'soft-light', Math.abs(p.grade.contrast) * 0.7, () => {
        ctx.fillStyle = p.grade.contrast > 0 ? '#100c10' : '#e8dfd6';
        ctx.fillRect(0, 0, w, h);
      });
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
}

/* -------------------------------------------------------------------- pieces */

function LayerCard({
  title,
  layer,
  onToggle,
  onActivate,
  active,
  children
}: {
  title: string;
  layer: { on: boolean };
  onToggle: (v: boolean) => void;
  onActivate: () => void;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="gl-layer" data-off={!layer.on} data-active={active}>
      <div className="gl-layer__head">
        <button type="button" className="gl-btn gl-btn--sm gl-btn--ghost" onClick={onActivate} aria-pressed={active} style={{ textAlign: 'left' }}>
          <SlidersHorizontal size={13} /> {title}
        </button>
        <Toggle checked={layer.on} onChange={onToggle} label={layer.on ? 'On' : 'Off'} />
      </div>
      {children}
    </div>
  );
}

function SwatchPicker({
  label,
  value,
  onChange,
  swatches
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  swatches: string[];
}) {
  return (
    <div className="gl-field">
      <span className="gl-field__label">{label}</span>
      <div className="gl-swatchpick">
        {swatches.map((s) => (
          <button
            key={s}
            type="button"
            title={s}
            aria-label={`${label} ${s}`}
            aria-pressed={value.toLowerCase() === s.toLowerCase()}
            style={{ background: s }}
            onClick={() => onChange(s)}
          />
        ))}
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          title="Choose any colour you like"
          aria-label={`${label} — custom colour`}
          style={{ width: 30, height: 30, border: '1px solid var(--glow-line-strong)', background: 'none', borderRadius: '50%', padding: 0, cursor: 'pointer' }}
        />
      </div>
      <span className="gl-tech">{value}</span>
    </div>
  );
}

function VariantCard({
  variant,
  onRename,
  onLoad,
  onAttach,
  onCompare,
  onDelete
}: {
  variant: AnyRow;
  onRename: () => void;
  onLoad: () => void;
  onAttach: () => void;
  onCompare: () => void;
  onDelete: () => void;
}) {
  const src = useImageSrc(variant, 'thumb');
  const d = (variant.data ?? {}) as Record<string, unknown>;
  const layers = (d.layerSummary as string[]) ?? [];
  return (
    <article className="gl-variant">
      <div className="gl-variant__img">
        {src ? <img src={src} alt={String(variant.title)} loading="lazy" /> : <div className="gl-missing-img" style={{ height: '100%' }}>Preview unavailable</div>}
        <span className="gl-variant__tag">Simulated</span>
      </div>
      <div className="gl-variant__body">
        <div className="gl-serif" style={{ fontSize: '1.02rem' }}>
          {String(variant.title || 'Untitled variant')}
        </div>
        <div className="gl-tech">
          {formatDate(String(d.savedOn ?? ''))} · {layers.length} layer(s){variant.private ? ' · private' : ''}
        </div>
        <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
          {layers.slice(0, 4).map((l) => (
            <Chip key={l} tone="gold">
              {l}
            </Chip>
          ))}
        </div>
        {d.note ? <p className="gl-small gl-muted" style={{ margin: 0 }}>{String(d.note)}</p> : null}
        <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap', marginTop: 'auto' }}>
          <Button size="sm" icon={<Eye size={13} />} onClick={onLoad}>
            Load
          </Button>
          <Button size="sm" variant="ghost" onClick={onRename} title="Rename">
            Rename
          </Button>
          <Button size="sm" variant="ghost" onClick={onAttach}>
            Attach
          </Button>
          <Button size="sm" variant="ghost" onClick={onCompare}>
            Compare
          </Button>
          <IconButton label="Delete this variant" onClick={onDelete}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>
    </article>
  );
}

function useSettings(): AppSettings | null {
  const [s, setS] = useState<AppSettings | null>(null);
  useEffect(() => {
    let alive = true;
    void loadSettings().then((v) => {
      if (alive) setS(v);
    });
    const unsub = subscribeSettings((v) => {
      if (alive) setS(v);
    });
    return () => {
      unsub();
    };
  }, []);
  return s;
}
