import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react';
import { THEME_OPTIONS } from '../state/themes';
import { applyDocumentSettings, loadSettings, updateSettings, type AppSettings } from '../state/settings';
import { armLock, lockIsSet } from '../state/lock';
import { Button, Chip, Field, Select, TextInput, Toggle, Card, useToast } from '../ui/primitives';
import { TABLES } from '../db/schema';
import { saveRow } from '../hooks/live';
import { clearSeedContent } from '../db/seed';
import { DEPARTMENTS } from '../nav/departments';
import '../styles/departments/onboarding.css';

const UNITS = [
  { value: 'metric', label: 'Metric — cm, kg' },
  { value: 'imperial', label: 'Imperial — in, lb' }
];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'INR', 'JPY', 'SEK', 'ZAR', 'BRL', 'NGN', 'AED'].map((c) => ({
  value: c,
  label: c
}));
const GRANULARITY = [
  { value: 'none', label: 'Never store location' },
  { value: 'country', label: 'Country only' },
  { value: 'region', label: 'Country + region' },
  { value: 'city', label: 'Country + city' }
];
const TRACKED = DEPARTMENTS.filter((d) => ['hair', 'skin', 'makeup', 'closet', 'fitness', 'fragrance', 'dental', 'posture'].includes(d.id));

/**
 * First-run setup. Every answer writes a real settings row or profile row —
 * nothing here is cosmetic, and every step is skippable without losing access.
 */
export default function OnboardingPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [lifestyle, setLifestyle] = useState('');
  const [country, setCountry] = useState('');
  const [lockCode, setLockCode] = useState('');
  const [lockArmed, setLockArmed] = useState(() => lockIsSet());

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setName(String((s as unknown as { name?: string }).name ?? ''));
      setLifestyle(s.lifestyle);
      setCountry(s.country);
      setLockArmed(lockIsSet());
    });
  }, []);

  const patch = async (p: Partial<AppSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...p };
    setSettings(next);
    applyDocumentSettings(next);
    await updateSettings(p);
  };

  /**
   * Arming a passcode is the only way this tour switches the lock on. Setting
   * the flag alone used to leave her believing the lab was gated while nothing
   * gated it, so the two are now the same action.
   */
  const armTheLock = async () => {
    const r = await armLock(lockCode);
    if (!r.ok) {
      toast(r.detail, 'bad');
      return;
    }
    setLockArmed(true);
    setLockCode('');
    await patch({ requireAppLock: true });
    toast('Passcode set on this device. It never enters a backup and is never synced.', 'ok');
  };

  const STEPS = ['What this is', 'Your theme', 'Your basics', 'What you track', 'Your privacy'];
  const total = STEPS.length;
  const title = STEPS[step];

  const finish = async () => {
    await patch({
      onboardingDone: true,
      lifestyle: lifestyle.trim(),
      country: country.trim(),
      firstRunAt: settings?.firstRunAt ?? Date.now()
    });
    await saveRow(TABLES.profile, {
      kind: 'personal',
      singleton: 1,
      data: { name: name.trim(), country: country.trim(), lifestyle: lifestyle.trim(), since: new Date().toISOString().slice(0, 10) }
    } as never);
    await saveRow(TABLES.profile, {
      kind: 'style',
      singleton: 1,
      data: {
        units: settings?.units,
        currency: settings?.currency,
        monthlyBudget: settings?.monthlyBudget,
        locationGranularity: settings?.locationGranularity
      }
    } as never);
  };

  const skip = async () => {
    await patch({ onboardingDone: true, firstRunAt: settings?.firstRunAt ?? Date.now() });
  };

  const selected = useMemo(() => new Set(settings?.enabledDepartments ?? []), [settings]);

  if (!settings) return <div className="gl-boot"><div className="gl-boot__mark">GL</div></div>;

  return (
    <div className="gl-onb">
      <aside className="gl-onb__side">
        <div className="gl-onb__mark">THE GLOW LAB</div>
        <ol className="gl-onb__steps">
          {STEPS.map((label, i) => (
            <li key={label} data-active={i === step} data-done={i < step}>
              <button type="button" onClick={() => setStep(i)} disabled={i > step + 1}>
                <span className="gl-onb__no gl-tech">{String(i + 1).padStart(2, '0')}</span>
                <span>{label}</span>
                {i < step ? <Check size={13} aria-hidden /> : null}
              </button>
            </li>
          ))}
        </ol>
        <p className="gl-onb__fine">
          Local-first. Your records live in this browser or device. No account, no subscription, no upload.
        </p>
      </aside>

      <main className="gl-onb__main">
        <div className="gl-eyebrow">
          Step {step + 1} of {total}
        </div>
        <h1 className="gl-display gl-onb__title">{title}</h1>

        {step === 0 ? (
          <div className="gl-onb__body">
            <p className="gl-lead">
              A studio for how you look after your appearance: assessment, routines, wardrobe, fitness, skin, hair, spending,
              evidence and progress — one dataset, one place, working offline.
            </p>
            <div className="gl-grid gl-grid--2">
              <Card>
                <div className="gl-eyebrow">What it is</div>
                <ul className="gl-onb__list">
                  <li>Twenty-nine departments sharing one local database.</li>
                  <li>Evidence grades on every technique, including the ones that are not worth doing.</li>
                  <li>Everything you save is editable, exportable and deletable.</li>
                </ul>
              </Card>
              <Card>
                <div className="gl-eyebrow">What it is not</div>
                <ul className="gl-onb__list gl-onb__list--no">
                  <li>There is no AI, no face scanning and no photo analysis you did not ask for.</li>
                  <li>It never gives an attractiveness score, and never diagnoses.</li>
                  <li>It does not invent products, prices or reviews; a provider only shows real results.</li>
                </ul>
              </Card>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="gl-onb__body">
            <p className="gl-muted">Pick the surface you want to look at every day. You can change it from the top bar at any time.</p>
            <div className="gl-onb__themes">
              {THEME_OPTIONS.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className="gl-onb__theme"
                  aria-label={`Use the ${t.name} theme`}
                  data-on={settings.theme === t.id}
                  onClick={() => void patch({ theme: t.id })}
                  aria-pressed={settings.theme === t.id}
                >
                  <span className="gl-swatch-set">
                    <i style={{ background: t.swatches.canvas }} />
                    <i style={{ background: t.swatches.surface }} />
                    <i style={{ background: t.swatches.accent }} />
                    <i style={{ background: t.swatches.metal }} />
                  </span>
                  <span className="gl-onb__theme-head">
                    <strong className="gl-serif">{t.name}</strong>
                    {t.id === 'oxblood' ? <Chip>default</Chip> : null}
                  </span>
                  <span className="gl-small gl-muted">{t.tagline}</span>
                  <span className="gl-onb__mood">{t.mood.join(' · ')}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="gl-onb__body">
            <div className="gl-form-row">
              <Field label="What should we call you?" hint="Stored locally. Used for the dashboard greeting only.">
                <TextInput value={name} onChange={setName} placeholder="Optional" />
              </Field>
              <Field label="Country">
                <TextInput value={country} onChange={setCountry} placeholder="Optional" />
              </Field>
              <Field label="Units">
                <Select value={settings.units} onChange={(v) => void patch({ units: v as AppSettings['units'] })} options={UNITS} />
              </Field>
              <Field label="Currency">
                <Select value={settings.currency} onChange={(v) => void patch({ currency: v })} options={CURRENCIES} />
              </Field>
              <Field label="Monthly discretionary budget" hint="Used by the purchase worksheet and the market spend view.">
                <TextInput
                  type="number"
                  value={settings.monthlyBudget}
                  onChange={(v) => void patch({ monthlyBudget: Number(v) || 0 })}
                />
              </Field>
              <Field label="A line about your life" hint="Shapes routine length and planning suggestions.">
                <TextInput value={lifestyle} onChange={setLifestyle} placeholder="e.g. long desk hours, 4 gym days, events most Fridays" />
              </Field>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="gl-onb__body">
            <p className="gl-muted">
              These chips are a keep-list, not a decoration. Nothing picked yet, so right now every one of the{' '}
              {DEPARTMENTS.length} departments stays in your sidebar and answers its own address. The moment you pick
              one, only what you pick stays — the rest leave the sidebar and their address stops answering, with a note
              telling you where to bring them back. Nothing is deleted. Only these eight can be picked here, so picking
              any of them also hides the departments that are not on this list; finish narrowing them in Settings →
              Departments.
            </p>
            <p className="gl-small gl-muted" role="status">
              {settings.enabledDepartments.length === 0
                ? `Nothing picked: all ${DEPARTMENTS.length} departments are in your sidebar.`
                : `${settings.enabledDepartments.length} in the list. Everything else is out of your sidebar until you add it back in Settings → Departments.`}
            </p>
            <div className="gl-onb__chips">
              {TRACKED.map((d) => {
                const on = selected.has(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    className="gl-chip gl-chip--clickable"
                    data-on={on}
                    aria-pressed={on}
                    onClick={() =>
                      void patch({
                        enabledDepartments: on
                          ? settings.enabledDepartments.filter((x) => x !== d.id)
                          : [...settings.enabledDepartments, d.id]
                      })
                    }
                  >
                    {d.title}
                  </button>
                );
              })}
            </div>
            <div className="gl-stack">
              <Toggle
                checked={settings.measurementsTracking}
                onChange={(v) => void patch({ measurementsTracking: v })}
                label="Track body measurements"
                hint="Off means the measurement screens stay closed. Nothing is recorded."
              />
              <Toggle
                checked={settings.weightTracking}
                onChange={(v) => void patch({ weightTracking: v })}
                label="Track weight"
                hint="Optional. If trends make you feel worse, leave it off — the app is fully useful without it."
              />
              <Toggle
                checked={settings.imageAnalysis}
                onChange={(v) => void patch({ imageAnalysis: v })}
                label="Allow on-device image tools"
                hint="Cropping, guides and comparison sliders. There is no automated face or body analysis in this app. Off also means a new photograph is filed with no colour palette and no colour tags read off its pixels."
              />
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="gl-onb__body">
            <div className="gl-stack">
              <Toggle
                checked={settings.privateMediaByDefault}
                onChange={(v) => void patch({ privateMediaByDefault: v })}
                label="Mark new photos private by default"
                hint="Private photos are excluded from any export that is not an explicit full backup."
              />
              <Toggle
                checked={settings.allowExternalProcessing}
                onChange={(v) => void patch({ allowExternalProcessing: v })}
                label="Allow external processing"
                hint="Leave off unless you connect your own provider. Off: no remote image fetch, no provider search, no sync push. The only thing that can still leave is a Pinterest authorisation you start yourself — and only when you click it."
              />
              <div className="gl-field">
                <span className="gl-field__label">Gate the lab behind a passcode</span>
                <p className="gl-small gl-muted">
                  A passcode gate in front of the lab, kept in this browser profile only — never in a backup, never
                  synced, not recoverable for you. This is Glow Lab's own passcode: your device or browser lock is a
                  different thing and this app cannot read it.
                </p>
                {lockArmed ? (
                  <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-2)' }}>
                    <Chip tone="gold">Armed</Chip>
                    <span className="gl-small gl-faint">A passcode is on this device, so the lab is gated. Change or remove it in Settings → Privacy.</span>
                  </div>
                ) : (
                  <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-2)', flexWrap: 'wrap' }}>
                    <TextInput type="password" value={lockCode} onChange={setLockCode} placeholder="Choose a passcode, four characters minimum" />
                    <Button variant="primary" size="sm" disabled={lockCode.trim().length < 4} onClick={() => void armTheLock()}>
                      Set passcode
                    </Button>
                  </div>
                )}
                {!lockArmed ? (
                  <p className="gl-small gl-faint">
                    Until a passcode exists on this device nothing gates the lab, so tick-boxes here do not lock
                    anything — set the passcode and the switch follows it.
                  </p>
                ) : null}
              </div>
            </div>
            <Field label="Location granularity" hint="Only affects how queries are phrased locally. No geolocation request is made.">
              <Select
                value={settings.locationGranularity}
                onChange={(v) => void patch({ locationGranularity: v as AppSettings['locationGranularity'] })}
                options={GRANULARITY}
              />
            </Field>
            <Card accent>
              <div className="gl-row gl-row--between">
                <div>
                  <div className="gl-strong">Starter content</div>
                  <div className="gl-small gl-muted">
                    The app ships with original reference imagery, evidence-graded techniques and tutorials, clearly tagged.
                    Delete them now or later from Settings.
                  </div>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (!window.confirm('Delete every bundled reference image, technique, tutorial and exercise? Your own records are untouched.')) return;
                    void clearSeedContent().then((n) => toast(`${n} starter record${n === 1 ? '' : 's'} removed.`));
                  }}
                >
                  Remove starter content
                </Button>
              </div>
            </Card>
          </div>
        ) : null}

        <footer className="gl-onb__foot">
          <div className="gl-row gl-row--tight">
            {step > 0 ? (
              <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => setStep(step - 1)}>
                Back
              </Button>
            ) : null}
          </div>
          <div className="gl-row gl-row--tight">
            <Button variant="ghost" onClick={() => void skip()}>
              Skip setup
            </Button>
            {step < total - 1 ? (
              <Button variant="primary" icon={<Sparkles size={15} />} onClick={() => setStep(step + 1)}>
                Continue
              </Button>
            ) : (
              <Button variant="gold" icon={<ArrowRight size={15} />} onClick={() => void finish()}>
                Enter the lab
              </Button>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}
