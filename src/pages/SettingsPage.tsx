import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Database,
  Download,
  Link2,
  Palette,
  Plug,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
  Wand2
} from 'lucide-react';
import { TABLES, type AnyRow, type TableName } from '../db/schema';
import { findAll, formatDate, todayISO } from '../db/repo';
import {
  CSV_DEPARTMENTS,
  countFor,
  csvBlob,
  csvDisplay,
  csvFileName,
  csvFor,
  csvGrid,
  departmentLabel
} from '../db/csv';
import { useLiveQuery } from 'dexie-react-hooks';
import { saveRow, useRows } from '../hooks/live';
import { applyDocumentSettings, departmentEnabled, loadSettings, updateSettings, type AppSettings } from '../state/settings';
import { THEME_OPTIONS } from '../state/themes';
import { SEED_LABEL, SEED_VERSION, clearSeedContent } from '../db/seed';
import {
  APP_VERSION,
  buildBackup,
  downloadBlob,
  eraseEverything,
  exportJson,
  flushSyncQueue,
  resolveConflict,
  restoreFromZip,
  storageFootprint,
  type RestoreReport,
  type SyncResult
} from '../db/backup';
import { armLock, disarmLock, lockIsSet, lockNow } from '../state/lock';
import { DISCOVERY_SOURCES } from '../providers/discovery';
import { describeSync, syncPinterestArchive, type PinterestSyncResult } from '../providers/pinterestSync';
import {
  OPTIONAL_SCOPES,
  PINTEREST_FALLBACK_NOTE,
  REQUIRED_SCOPE,
  disconnect,
  exchangeCode,
  importPins,
  listBoards,
  listPins,
  startAuth
} from '../providers/pinterest';
import { DEPARTMENTS } from '../nav/departments';
import {
  Button,
  Card,
  CardHead,
  Chip,
  Disclosure,
  EmptyState,
  Field,
  Section,
  SegmentedControl,
  Select,
  Stat,
  Table,
  TextInput,
  Toggle,
  useToast
} from '../ui/primitives';
import { DeptIntro, IndexList, IndexRow, KvList } from '../ui/editorial';
import '../styles/departments/settings.css';

const TABS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'departments', label: 'Departments' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'advisor', label: 'Advisor' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'sync', label: 'Backup & sync' },
  { id: 'about', label: 'About' }
];

const ACCENTS = ['champagne', 'rose', 'silver', 'oxblood', 'plum'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'INR', 'JPY', 'SEK', 'ZAR', 'BRL', 'NGN', 'AED'].map((c) => ({ value: c, label: c }));

/**
 * The departments she can actually narrow. Home, Search and Settings are the
 * app's own chrome — they stay in the rail whatever this list says, so a short
 * list can never hide the way back to this page.
 */
const PICKABLE_DEPARTMENTS = DEPARTMENTS.filter((d) => !['home', 'settings', 'search'].includes(d.id));

/** Settings: the control panel for identity, privacy, integrations and data. */
export default function SettingsPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as string) : 'appearance';
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const integrations = useRows(TABLES.integrations);
  const conflicts = useRows(TABLES.conflicts, { where: { resolution: 'pending' } });
  const references = useRows(TABLES.manualReferences);
  const queue = useRows(TABLES.syncQueue);
  const [footprint, setFootprint] = useState<Awaited<ReturnType<typeof storageFootprint>> | null>(null);
  const [restoreReport, setRestoreReport] = useState<RestoreReport | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState('');
  const [lockCode, setLockCode] = useState('');
  const [lockArmed, setLockArmed] = useState(() => lockIsSet());
  const [refUrl, setRefUrl] = useState('');
  const [refTitle, setRefTitle] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [pinClientId, setPinClientId] = useState('');
  const [pinBoards, setPinBoards] = useState<{ id: string; name: string; pinCount?: number }[]>([]);
  const [pinPull, setPinPull] = useState<PinterestSyncResult | null>(null);
  const [pinPulling, setPinPulling] = useState(false);
  const pin = integrations.find((i) => i.service === 'pinterest');

  useEffect(() => {
    loadSettings().then((s) => setSettings(s));
    refreshFootprint();
  }, []);

  const refreshFootprint = () => storageFootprint().then(setFootprint).catch(() => setFootprint(null));

  const patch = async (p: Partial<AppSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...p };
    setSettings(next);
    applyDocumentSettings(next);
    await updateSettings(p);
  };

  const redirectUri = useMemo(() => window.location.origin + window.location.pathname, []);
  const oauthCode = new URLSearchParams(window.location.search).get('code');

  if (!settings) return <div className="gl-boot"><div className="gl-boot__mark">GL</div></div>;

  const setTab = (id: string) => setParams({ tab: id });

  return (
    <>
      <DeptIntro
        id="settings"
        deck="Identity, departments, privacy, the advisor, integrations and your data. Every preference persists to the settings row and syncs with your own endpoint if you turn that on."
        meta={[
          { label: 'Theme', value: THEME_OPTIONS.find((t) => t.id === settings.theme)?.name ?? settings.theme },
          { label: 'Records', value: String(footprint?.rows ?? '—') },
          { label: 'Version', value: APP_VERSION }
        ]}
      />

      <div className="gl-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className="gl-tab"
            data-on={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'sync' && conflicts.length ? <span className="gl-tab__alert" /> : null}
          </button>
        ))}
      </div>

      {tab === 'appearance' ? (
        <Section eyebrow="Dark Femme Editorial" title="Theme" description="Three art directions over one token set. Picking one recolours every department immediately; the choice is stored and travels with your backup.">
          <div className="gl-themegrid">
            {THEME_OPTIONS.map((t) => (
              <button
                key={t.id}
                type="button"
                className="gl-themecard"
                aria-label={`Use the ${t.name} theme`}
                data-on={settings.theme === t.id}
                aria-pressed={settings.theme === t.id}
                onClick={() => {
                  void patch({ theme: t.id });
                  toast(`${t.name} applied.`, 'ok');
                }}
              >
                <span className="gl-theme-preview">
                  <span className="gl-theme-preview__pane" style={{ background: t.swatches.canvas, color: t.swatches.text }}>
                    <span className="gl-serif" style={{ fontSize: '1.2rem' }}>
                      Aa
                    </span>
                    <span className="gl-theme-preview__line" style={{ background: t.swatches.surface }} />
                    <span className="gl-theme-preview__line" style={{ background: t.swatches.surface, opacity: 0.6 }} />
                    <span className="gl-theme-preview__row">
                      <i style={{ background: t.swatches.accent }} />
                      <i style={{ background: t.swatches.metal }} />
                    </span>
                  </span>
                </span>
                <span className="gl-themecard__head">
                  <strong className="gl-serif">{t.name}</strong>
                  {t.id === 'oxblood' ? <Chip>default</Chip> : null}
                </span>
                <span className="gl-small gl-muted">{t.tagline}</span>
                <span className="gl-small gl-faint">{t.notes}</span>
                <span className="gl-themecard__mood">{t.mood.join(' · ')}</span>
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      {tab === 'appearance' ? (
        <Section eyebrow="Reading comfort" title="Density, scale and motion">
          <div className="gl-grid gl-grid--2">
            <Card>
              <CardHead title="Interface" sub="Applies to every department, including the ones you have not opened yet." />
              <div className="gl-stack">
                <Field label="Density">
                  <SegmentedControl
                    value={settings.density}
                    onChange={(v) => void patch({ density: v as AppSettings['density'] })}
                    options={[
                      { value: 'comfortable', label: 'Comfortable' },
                      { value: 'compact', label: 'Compact' }
                    ]}
                  />
                </Field>
                <Field label="Type scale">
                  <SegmentedControl
                    value={settings.typeScale}
                    onChange={(v) => void patch({ typeScale: v as AppSettings['typeScale'] })}
                    options={[
                      { value: 'normal', label: 'Normal' },
                      { value: 'large', label: 'Large' }
                    ]}
                  />
                </Field>
                <Field label="Accent name" hint="Labels only — the palette is set by the theme so contrast stays validated.">
                  <Select value={settings.accentLabel} onChange={(v) => void patch({ accentLabel: v })} options={ACCENTS.map((a) => ({ value: a, label: a }))} />
                </Field>
                <Toggle
                  checked={settings.reducedMotion}
                  onChange={(v) => void patch({ reducedMotion: v })}
                  label="Reduced motion"
                  hint="Also follows your system setting automatically. No function depends on animation."
                />
              </div>
            </Card>
            <Card>
              <CardHead title="Units & money" sub="Used by the closet cost-per-wear maths, the market budget and measurement charts." />
              <div className="gl-stack">
                <Field label="Units">
                  <SegmentedControl
                    value={settings.units}
                    onChange={(v) => void patch({ units: v as AppSettings['units'] })}
                    options={[
                      { value: 'metric', label: 'Metric' },
                      { value: 'imperial', label: 'Imperial' }
                    ]}
                  />
                </Field>
                <Field label="Currency">
                  <Select value={settings.currency} onChange={(v) => void patch({ currency: v })} options={CURRENCIES} />
                </Field>
                <Field label="Monthly discretionary budget">
                  <TextInput type="number" value={settings.monthlyBudget} onChange={(v) => void patch({ monthlyBudget: Number(v) || 0 })} />
                </Field>
                <Field label="Location granularity" hint="Changes how questions are phrased locally. No geolocation permission is ever requested.">
                  <Select
                    value={settings.locationGranularity}
                    onChange={(v) => void patch({ locationGranularity: v as AppSettings['locationGranularity'] })}
                    options={[
                      { value: 'none', label: 'None' },
                      { value: 'country', label: 'Country' },
                      { value: 'region', label: 'Region' },
                      { value: 'city', label: 'City' }
                    ]}
                  />
                </Field>
              </div>
            </Card>
          </div>
        </Section>
      ) : null}

      {tab === 'appearance' ? (
        <Section eyebrow="Acceptance" title="Have you actually looked at all of it?" description="Three themes × 29 departments is 87 screens. The contact sheet renders them live, side by side, at the width you choose, and keeps a record of the ones you have signed off. A script cannot tell you a theme reads well — only you can.">
          <Card>
            <CardHead
              title="Visual contact sheet"
              sub="Hidden from the rail on purpose: a checking tool, not a department."
              right={
                <Chip tone={settings.visualChecks.length ? 'gold' : 'info'}>
                  {settings.visualChecks.length} of {DEPARTMENTS.length * 3} signed off
                </Chip>
              }
            />
            <div className="gl-row gl-row--tight">
              <a className="gl-btn gl-btn--primary" href="#/contact-sheet">
                Open the contact sheet
              </a>
              {settings.visualChecks.length ? (
                <Button
                  variant="ghost"
                  onClick={() => void patch({ visualChecks: [] })}
                  title="Clears your own sign-off marks. Nothing else changes."
                >
                  Reset my sign-offs
                </Button>
              ) : null}
            </div>
          </Card>
        </Section>
      ) : null}

      {tab === 'departments' ? (
        <Section eyebrow="Adaptive interface" title="Departments" description="This list is a keep-list, not a decoration. Empty means you have not narrowed anything: every department stays in the rail and answers its own address. Once it holds any department, only those do — the rest leave the rail and the mobile grid, and their address refuses you with a note saying which switch closed it. Nothing is uninstalled and no record is touched: switch one back on and it is exactly where you left it. Clearing the list back to empty is the same as keeping everything. Home, Search and Settings are the app's own chrome and stay reachable whatever you pick here, so you can never switch your way out of this page; Profile is a normal department and does leave the rail if you take it out.">
          <p className="gl-small gl-muted" role="status">
            {settings.enabledDepartments.length
              ? `${settings.enabledDepartments.length} of ${PICKABLE_DEPARTMENTS.length} kept. Everything left out is out of your rail and refuses its address — nothing is deleted.`
              : `Nothing picked yet, so nothing is filtered: all ${PICKABLE_DEPARTMENTS.length} are in your rail alongside Home, Search and Settings. Taking one out first fills the list with the rest.`}
          </p>
          <div className="gl-grid gl-grid--3">
            {PICKABLE_DEPARTMENTS.map((d) => {
              /* The button state shows whether the department is actually live,
                 which with an empty list is all of them — not whether it happens
                 to appear in the array. Same rule the rail and the routes use. */
              const on = departmentEnabled(d.id, settings.enabledDepartments);
              const Icon = d.icon;
              /* Taking one out of an empty list has to fill the list with the
                 rest, or the single removal would read back as "nothing
                 narrowed". Once the list is real, just drop this id. */
              const nextList = !on
                ? [...settings.enabledDepartments, d.id]
                : settings.enabledDepartments.length === 0
                  ? PICKABLE_DEPARTMENTS.filter((x) => x.id !== d.id).map((x) => x.id)
                  : settings.enabledDepartments.filter((x) => x !== d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  className="gl-depttoggle"
                  data-on={on}
                  aria-pressed={on}
                  title={
                    on
                      ? 'In your rail and answering its address. Taking it out closes both — your records stay put.'
                      : `Not in your keep-list: out of the rail, and ${d.path} refuses you. Put it back with one tap.`
                  }
                  onClick={() => void patch({ enabledDepartments: nextList })}
                >
                  <Icon size={16} strokeWidth={1.5} />
                  <span className="gl-strong">{d.title}</span>
                  <span className="gl-small gl-faint">{d.deck}</span>
                  <span className="gl-tech gl-faint" style={{ fontSize: '0.58rem' }}>
                    {d.parts.join(' · ')}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="gl-row gl-row--tight" style={{ marginTop: 16 }}>
            <Button size="sm" variant="ghost" title="Empties the keep-list, which means every department is kept again." onClick={() => void patch({ enabledDepartments: [] })}>
              Keep every department
            </Button>
          </div>
        </Section>
      ) : null}

      {tab === 'privacy' ? (
        <Section eyebrow="Control" title="Privacy and permissions">
          <div className="gl-split">
            <Card>
              <CardHead
                title="What the app may do"
                sub="Each switch is read where the action happens, not only here. Capture is refused at the file control and again inside the ingest path. Image tools off closes the guides, the markers and the tone read, and a new photograph is filed without the colour palette or colour tags that would otherwise be read off its pixels. External processing off refuses a remote image fetch, a provider search and the sync push before any request is built. The department list is a keep-list: what is left out leaves the rail and refuses its address. Reminders off lists nothing due anywhere in the app. The body-data switches gate their own record forms."
              />
              <div className="gl-stack">
                <Toggle
                  checked={settings.allowUploads}
                  onChange={(v) => void patch({ allowUploads: v })}
                  label="Allow adding photos"
                  hint="Off hides every capture and file control, and the ingest path refuses a file before it reads a byte; your existing photos stay. This one gates local ingest only — a photograph pointed at from the web is blocked by “Allow external processing” instead, and nothing here ever leaves the device. It ships on because logging your own photograph is the app's first job, not an add-on."
                />
                <Toggle
                  checked={settings.privateMediaByDefault}
                  onChange={(v) => void patch({ privateMediaByDefault: v })}
                  label="New photos are private by default"
                  hint="Private items are excluded from anything except a full local backup."
                />
                <Toggle
                  checked={settings.pinterestTeachesTaste}
                  onChange={(v) => void patch({ pinterestTeachesTaste: v })}
                  label="Let my Pinterest saves steer the taste arithmetic"
                  hint="Off, and this build ships it off: your taps on imported pins never enter Aesthetic DNA, so Pinterest-sourced material stays separate from preference learning. The cards still show in your feed; likes and passes on them are simply not learned from. On: they count the same as taps on any other card. Nothing is uploaded either way — this switch is permission to learn from material that came from somewhere else, so it is yours to give."
                />
                <Toggle
                  checked={settings.pinterestAutoSync}
                  onChange={(v) => void patch({ pinterestAutoSync: v })}
                  label="Pull new Pinterest saves when this app opens"
                  hint="Off, and this build ships it off: opening the app reads nothing, and the archive is only read when you press the button below. On: every app open reads the archive already sitting on this device (pinterest-saves.zip, next to the app) and adds only the saves that were not there before. The app never contacts Pinterest, never asks for a password and never needs a server — so with no archive on the device, nothing changes and it says so."
                />
                <div className="gl-row gl-row--tight">
                  <Button
                    size="sm"
                    variant="default"
                    disabled={pinPulling}
                    onClick={() => {
                      setPinPulling(true);
                      void syncPinterestArchive({ force: true })
                        .then((r) => {
                          setPinPull(r);
                          setPinPulling(false);
                          toast(describeSync(r), r.state === 'error' ? 'bad' : 'ok');
                          if (r.state === 'updated') void patch({ pinterestSyncAt: r.at });
                        })
                        .catch((e: Error) => {
                          setPinPull({ state: 'error', pinsFound: 0, imagesFound: 0, imported: 0, duplicates: 0, linkOnly: 0, sizeKb: 0, at: Date.now(), detail: e.message });
                          setPinPulling(false);
                        });
                    }}
                  >
                    {pinPulling ? 'Reading the archive…' : 'Check for new saves now'}
                  </Button>
                  <span className="gl-small gl-faint">
                    Last pull: {settings.pinterestSyncAt ? new Date(settings.pinterestSyncAt).toLocaleString() : 'never on this device'}
                  </span>
                </div>
                {pinPull ? <div className="gl-note">{describeSync(pinPull)}</div> : null}
                <Toggle
                  checked={settings.imageAnalysis}
                  onChange={(v) => void patch({ imageAnalysis: v })}
                  label="On-device image tools"
                  hint="Cropping, guides, comparison sliders and the photo tone read. Off: no colour is read off your photographs — a new shot is filed with an empty palette and empty colour tags, and the tone card refuses itself. The one exception is the 64-bit look-alike fingerprint, which is still written because the shot grid and the duplicate review queue cannot work without it; it is a comparison key, not a reading of the picture. This app contains no face or body analysis model."
                />
                <Toggle
                  checked={settings.allowExternalProcessing}
                  onChange={(v) => void patch({ allowExternalProcessing: v })}
                  label="Allow external processing"
                  hint="Required before any content is sent to a provider you configured. Off, three paths refuse themselves before a request is built: a remote image fetch, a Pexels/Unsplash/Pixabay search — which would carry your query text and your key — and the sync push. A saved provider key is not consent to send; this switch is. The one thing it does not cover is the Pinterest authorisation you start yourself in Integrations: that exchange only happens when you click it, and clicking it is its own consent. Disconnecting Pinterest there is what stops it."
                />
                <div className="gl-field">
                  <span className="gl-field__label">App lock on this device</span>
                  <p className="gl-small gl-muted">
                    A passcode gate in front of the lab. Arming it below is what switches the lock on — the setting is a
                    promise about this passcode, never a lock by itself, so if the app is ever told to require a lock it
                    does not have, it opens on a "choose your passcode" screen instead of your records. It re-locks after
                    three minutes with the tab hidden. The hash is kept in this browser profile only — it never enters a
                    backup archive or the sync queue, and Glow Lab cannot recover it for you.
                  </p>
                  <input
                    className="gl-input"
                    type="password"
                    autoComplete="off"
                    aria-label="App lock passcode"
                    placeholder={lockArmed ? 'Current passcode to disarm' : 'Choose a passcode, four characters minimum'}
                    value={lockCode}
                    onChange={(e) => setLockCode(e.target.value)}
                    style={{ marginTop: 'var(--glow-sp-2)' }}
                  />
                  <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-2)' }}>
                    {lockArmed ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={lockCode.length < 4}
                        onClick={() =>
                          void disarmLock(lockCode).then((r) => {
                            toast(r.detail, r.ok ? 'ok' : 'bad');
                            if (r.ok) {
                              setLockArmed(false);
                              setLockCode('');
                              void patch({ requireAppLock: false });
                            }
                          })
                        }
                      >
                        Disarm
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={lockCode.length < 4}
                        onClick={() =>
                          void armLock(lockCode).then((r) => {
                            toast(r.detail, r.ok ? 'ok' : 'bad');
                            if (r.ok) {
                              setLockArmed(true);
                              setLockCode('');
                              void patch({ requireAppLock: true });
                            }
                          })
                        }
                      >
                        Arm lock
                      </Button>
                    )}
                    {lockArmed ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          lockNow();
                          toast('Locked. Reload or return to this tab to unlock.', 'ok');
                        }}
                      >
                        Lock now
                      </Button>
                    ) : null}
                    <Chip tone={lockArmed ? 'gold' : 'info'}>{lockArmed ? 'Armed' : 'Not armed'}</Chip>
                  </div>
                </div>
                <Toggle
                  checked={settings.reminders}
                  onChange={(v) => void patch({ reminders: v })}
                  label="In-app reminders"
                  hint="Off, nothing due is listed anywhere in the app. Shown inside the app only: this build requests no notification permission, schedules nothing outside itself and makes no request, which is why it ships on — it is a reading of your own records, not a channel to anybody else."
                />
                <Toggle
                  checked={settings.measurementsTracking}
                  onChange={(v) => void patch({ measurementsTracking: v })}
                  label="Body measurements"
                />
                <Toggle
                  checked={settings.weightTracking}
                  onChange={(v) => void patch({ weightTracking: v })}
                  label="Weight tracking"
                  hint="Optional. The app is complete without it."
                />
              </div>
            </Card>
            <div className="gl-stack">
              <Card accent>
                <CardHead title="Guarantees" />
                <ul className="gl-settings__list">
                  <li>No analytics, telemetry or third-party scripts are loaded.</li>
                  <li>No account, no sign-in, no subscription, no paid API is required for any feature.</li>
                  <li>Photos are stored in this device's IndexedDB. They are only sent where you point sync yourself.</li>
                  <li>Nothing here diagnoses, prescribes, or scores attractiveness.</li>
                </ul>
              </Card>
              <Card>
                <CardHead title="What is stored where" sub={footprint ? `${footprint.rows} rows · ${footprint.mediaFiles} media blobs` : 'counting…'} />
                {footprint ? (
                  <details className="gl-details">
                    <summary>Table by table</summary>
                    <div className="gl-details__body">
                      <KvList items={footprint.perTable.filter((t) => t.count).map((t) => ({ k: t.table, v: String(t.count) }))} />
                    </div>
                  </details>
                ) : null}
              </Card>
            </div>
          </div>
        </Section>
      ) : null}

      {tab === 'advisor' ? (
        <Section eyebrow="Central Glow Advisor" title="How it answers">
          <div className="gl-split">
            <Card>
              <CardHead title="Engine" sub="Every answer comes from the local rules engine, whatever you choose here. The rules are what refuse unsafe requests. Glow Lab never calls a provider on its own, so this setting records your intent rather than changing the text you receive." />
              <div className="gl-stack">
                <Field label="Engine">
                  <SegmentedControl
                    value={settings.advisorEngine}
                    onChange={(v) => void patch({ advisorEngine: v as AppSettings['advisorEngine'] })}
                    options={[
                      { value: 'local', label: 'Local rules only' },
                      { value: 'local+provider', label: 'Rules + your provider' }
                    ]}
                  />
                </Field>
                <Field label="Tone">
                  <SegmentedControl
                    value={settings.advisorBluntness}
                    onChange={(v) => void patch({ advisorBluntness: v as AppSettings['advisorBluntness'] })}
                    options={[
                      { value: 'gentle', label: 'Gentle' },
                      { value: 'balanced', label: 'Balanced' },
                      { value: 'technical', label: 'Technical' }
                    ]}
                  />
                </Field>
                <Field label="Provider base URL" hint="OpenAI-compatible endpoint you host or pay for yourself. Never required.">
                  <TextInput value={settings.providerBaseUrl} onChange={(v) => void patch({ providerBaseUrl: v })} placeholder="https://…" />
                </Field>
                <Field label="Key reference" hint="A label, not the secret. The key itself is not stored in this database.">
                  <TextInput value={settings.providerApiKeyRef} onChange={(v) => void patch({ providerApiKeyRef: v })} placeholder="e.g. saved in my device keychain" />
                </Field>
                {settings.advisorEngine === 'local+provider' ? (
                  <div className="gl-note gl-note--warn">
                    {settings.providerBaseUrl
                      ? 'An endpoint is saved, but this build has no provider call wired up — answers are produced by local rules and every message stays stamped “local-rules”. The endpoint you entered is only used if you later run a client that reads it.'
                      : 'Rules + provider is selected with no endpoint, so every answer still comes from local rules and is labelled that way.'}
                  </div>
                ) : null}
              </div>
            </Card>
            <Card>
              <CardHead title="Honesty rules baked in" />
              <ul className="gl-settings__list">
                <li>Every reply carries the engine that produced it.</li>
                <li>Attractiveness scores, diagnosis and unsafe practices are refused before any other rule runs.</li>
                <li>No product, price, retailer or review is named unless it is a record you entered.</li>
                <li>Where evidence is weak or absent, the answer says so and cites the technique record.</li>
              </ul>
            </Card>
          </div>
        </Section>
      ) : null}

      {tab === 'integrations' ? (
        <>
          <Section eyebrow="Discovery providers" title="Optional image sources" description="Everything here is off until you paste your own key — and a saved key is not enough on its own: with Settings → Privacy → “Allow external processing” off, no search is ever sent, so your query text stays here. Without a key the bundled library and your own uploads still fill the feed — the app never invents results.">
            <div className="gl-grid gl-grid--2">
              {DISCOVERY_SOURCES.map((s) => (
                <ProviderCard key={s.id} source={s} row={integrations.find((i) => i.service === s.id)} onChanged={refreshFootprint} />
              ))}
            </div>
          </Section>

          <Section eyebrow="Pinterest" title="Authorised access only">
            <div className="gl-split">
              <Card>
                <CardHead
                  title="Connection"
                  eyebrow={`status: ${pin?.status ?? 'disconnected'}`}
                  sub="Official OAuth 2 with PKCE and read scopes only. The app has no code path that accepts a Pinterest password, and it never scrapes or bypasses access restrictions."
                />
                <div className="gl-stack">
                  <Field label="App client ID" hint="From your own Pinterest developer app.">
                    <TextInput value={pinClientId} onChange={setPinClientId} placeholder="48-character client ID" />
                  </Field>
                  <Field label="Redirect URI" hint="Must be registered on your Pinterest app exactly as shown.">
                    <TextInput value={redirectUri} onChange={() => undefined} />
                  </Field>
                  <div className="gl-row gl-row--tight">
                    <Button
                      variant="primary"
                      icon={<Plug size={15} />}
                      onClick={() =>
                        void startAuth({ clientId: pinClientId || String(pin?.clientId ?? ''), redirectUri })
                          .then((flow) => {
                            void saveRow(TABLES.integrations, {
                              id: pin?.id,
                              service: 'pinterest',
                              status: 'configured',
                              clientId: pinClientId,
                              scopes: [REQUIRED_SCOPE, ...OPTIONAL_SCOPES.filter((x) => x !== REQUIRED_SCOPE)],
                              capabilities: ['read boards', 'read pins'],
                              notes: 'OAuth redirect issued from this device.'
                            } as never);
                            window.location.assign(flow.authorizeUrl);
                          })
                          .catch((e: Error) => toast(e.message, 'bad'))
                      }
                    >
                      Authorise
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void disconnect().then(() => {
                          setPinBoards([]);
                          toast('Disconnected. Imported items stay and remain labelled as Pinterest-sourced.', 'ok');
                        })
                      }
                    >
                      Disconnect
                    </Button>
                  </div>
                  {oauthCode ? (
                    <ExchangePanel code={oauthCode} clientId={String(pin?.clientId ?? pinClientId)} redirectUri={redirectUri} />
                  ) : null}
                  {pin?.status === 'connected' && pin.token ? (
                    <div className="gl-row gl-row--tight">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void listBoards(String(pin.token)).then((res) => {
                            if (!res.ok) {
                              toast(res.detail, 'bad');
                              return;
                            }
                            setPinBoards(res.boards.map((b) => ({ id: b.id, name: b.name, pinCount: b.pin_count })));
                            toast(`${res.boards.length} board${res.boards.length === 1 ? '' : 's'} read.`, 'ok');
                          })
                        }
                      >
                        Read my boards
                      </Button>
                      <span className="gl-small gl-faint">Last sync {pin.lastSyncAt ? formatDate(new Date(Number(pin.lastSyncAt)).toISOString().slice(0, 10)) : 'never'}</span>
                    </div>
                  ) : null}
                </div>
                {pinBoards.length ? (
                  <div className="gl-stack" style={{ marginTop: 14 }}>
                    <div className="gl-eyebrow">Your boards</div>
                    <IndexList>
                      {pinBoards.map((b, i) => (
                        <IndexRow
                          key={b.id}
                          no={i + 1}
                          title={b.name}
                          sub={`${b.pinCount ?? '—'} pins`}
                          right={
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                void (async () => {
                                  const res = await listPins(String(pin?.token), b.id);
                                  if (!res.ok) return toast(res.detail, 'bad');
                                  const n = await importPins(res.pins);
                                  toast(`${n} reference${n === 1 ? '' : 's'} imported and tagged Pinterest-sourced.`, 'ok');
                                })()
                              }
                            >
                              Import
                            </Button>
                          }
                        />
                      ))}
                    </IndexList>
                  </div>
                ) : null}
              </Card>
              <div className="gl-stack">
                <Card accent>
                  <CardHead title="What Pinterest data is used for" />
                  <ul className="gl-settings__list">
                    <li>Boards and pins you import are your references. They are excluded from Aesthetic DNA by design.</li>
                    <li>Nothing from Pinterest is used to train a model, and this app contains no model.</li>
                    <li>The token lives in the integration row on this device. It is not a secure enclave — for production-grade isolation use a server proxy, which INTEGRATIONS.md documents.</li>
                    <li>Disconnecting clears the token but keeps what you already imported.</li>
                  </ul>
                </Card>
                <Card>
                  <CardHead title="Manual reference links" sub={PINTEREST_FALLBACK_NOTE} />
                  <div className="gl-form-row">
                    <Field label="URL">
                      <TextInput value={refUrl} onChange={setRefUrl} placeholder="https://pin.example/…" />
                    </Field>
                    <Field label="Your note">
                      <TextInput value={refTitle} onChange={setRefTitle} placeholder="Why you kept it" />
                    </Field>
                  </div>
                    <div style={{ marginTop: 10 }}>
                    <Button
                      size="sm"
                      variant="gold"
                      icon={<Link2 size={14} />}
                      disabled={!refUrl.trim()}
                    onClick={() => {
                      void saveRow(TABLES.manualReferences, {
                        url: refUrl.trim(),
                        title: refTitle.trim() || refUrl.trim(),
                        note: refTitle.trim(),
                        provider: 'manual',
                        imported: false
                      } as never);
                      setRefUrl('');
                      setRefTitle('');
                      toast('Reference link saved.', 'ok');
                    }}
                  >
                    Keep reference
                  </Button>
                  </div>
                  {references.length ? (
                    <ul className="gl-settings__refs">
                      {references.slice(0, 8).map((r) => (
                        <li key={r.id}>
                          <a href={String(r.url)} target="_blank" rel="noreferrer noopener">
                            {r.title}
                          </a>
                          <span className="gl-tech gl-faint">{formatDate(r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '')}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Card>
              </div>
            </div>
          </Section>
        </>
      ) : null}

      {tab === 'sync' ? (
        <Section eyebrow="Your data" title="Backup, restore and sync">
          <div className="gl-split">
            <div className="gl-stack">
              <Card>
                <CardHead title="Export" sub="A ZIP with every table as JSON plus media blobs, with a manifest and per-table checksums. Restorable on any device running this app." />
                <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                  <Button
                    variant="primary"
                    icon={<Download size={15} />}
                    disabled={!!busy}
                    onClick={() => {
                      setBusy('export');
                      void buildBackup({ includeMedia: true, includePrivateMedia: true, includeSeedContent: true })
                        .then(async (pack) => {
                          await downloadBlob(pack.blob, pack.filename);
                          toast(`Backup downloaded — ${Object.keys(pack.manifest.counts).length} tables.`, 'ok');
                        })
                        .catch((e: Error) => toast(e.message || 'Export failed.', 'bad'))
                        .finally(() => setBusy(''));
                    }}
                  >
                    {busy === 'export' ? 'Packing…' : 'Full backup (.zip)'}
                  </Button>
                  <Button
                    variant="ghost"
                    icon={<Database size={15} />}
                    onClick={() =>
                      void exportJson().then((json) => downloadBlob(new Blob([json], { type: 'application/json' }), `glow-lab-data-${todayISO()}.json`))
                    }
                  >
                    Records only (.json)
                  </Button>
                </div>
                <div className="gl-small gl-faint" style={{ marginTop: 10 }}>
                  A free cloud account is fine as an endpoint. The app never assumes unlimited storage.
                </div>
              </Card>

              <CsvExportCard />

              <Card>
                <CardHead title="Restore" sub="Merge keeps newer local rows and files a conflict for anything older. Replace wipes this device first." />
                <input
                  ref={fileRef}
                  type="file"
                  accept=".zip"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const mode = window.confirm('Replace everything on this device with the archive? Cancel to merge instead.') ? 'replace' : 'merge';
                    setBusy('restore');
                    void restoreFromZip(f, mode)
                      .then((rep) => {
                        setRestoreReport(rep);
                        toast(rep.ok ? rep.detail : 'Restore failed.', rep.ok ? 'ok' : 'bad');
                        refreshFootprint();
                      })
                      .finally(() => setBusy(''));
                    e.target.value = '';
                  }}
                />
                <div className="gl-row gl-row--tight">
                  <Button variant="gold" icon={<Upload size={15} />} disabled={!!busy} onClick={() => fileRef.current?.click()}>
                    Choose a .zip
                  </Button>
                  {restoreReport ? <span className="gl-small gl-muted">{restoreReport.detail}</span> : null}
                </div>
              </Card>

              <Card>
                <CardHead title="Optional sync" sub="Point it at an endpoint you control. Changes queue locally with a revision number and last-write-wins resolves the rest." />
                <div className="gl-stack">
                  <Toggle
                    checked={settings.syncEnabled}
                    onChange={(v) => void patch({ syncEnabled: v })}
                    label="Enable sync"
                    hint="Off, nothing is pushed and the queue stays on this device. A flush also needs “Allow external processing” switched on above, because a push is by definition a request leaving the device."
                  />
                  <Field label="Endpoint">
                    <TextInput value={settings.syncEndpoint} onChange={(v) => void patch({ syncEndpoint: v })} placeholder="https://my-server/glow/sync" />
                  </Field>
                  <Field label="Interval (minutes)">
                    <TextInput type="number" value={settings.syncIntervalMin} onChange={(v) => void patch({ syncIntervalMin: Math.max(5, Number(v) || 60) })} />
                  </Field>
                  <div className="gl-row gl-row--between">
                    <span className="gl-small gl-faint">{queue.length} change{queue.length === 1 ? '' : 's'} queued on this device.</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<RotateCcw size={14} />}
                      onClick={() =>
                        void flushSyncQueue().then((r) => {
                          setSyncResult(r);
                          toast(r.detail, r.ok ? 'ok' : 'bad');
                          refreshFootprint();
                        })
                      }
                    >
                      Sync now
                    </Button>
                  </div>
                  {syncResult ? <KvList items={[{ k: 'Pushed', v: String(syncResult.pushed) }, { k: 'Pulled', v: String(syncResult.pulled) }, { k: 'Conflicts', v: String(syncResult.conflicts) }]} /> : null}
                </div>
              </Card>
            </div>

            <div className="gl-stack">
              <Card accent>
                <CardHead
                  title={conflicts.length ? `${conflicts.length} unresolved conflict${conflicts.length === 1 ? '' : 's'}` : 'No conflicts'}
                  sub="A conflict means two devices changed the same record. Nothing is silently overwritten."
                />
                {conflicts.length ? (
                  <Table
                    rows={conflicts}
                    columns={[
                      { label: 'Record', render: (c: AnyRow) => <span className="gl-small">{c.targetTable}</span> },
                      { label: 'Local', render: (c: AnyRow) => <span className="gl-tech">r{c.localRev}</span>, width: 60 },
                      { label: 'Remote', render: (c: AnyRow) => <span className="gl-tech">r{c.remoteRev}</span>, width: 70 },
                      {
                        label: '',
                        width: 150,
                        render: (c: AnyRow) => (
                          <span className="gl-row gl-row--tight">
                            <Button size="sm" variant="ghost" onClick={() => void resolveConflict(c.id, 'local').then(refreshFootprint)}>
                              keep local
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => void resolveConflict(c.id, 'remote').then(refreshFootprint)}>
                              keep remote
                            </Button>
                          </span>
                        )
                      }
                    ]}
                  />
                ) : null}
              </Card>

              <Card>
                <CardHead title={SEED_LABEL} sub={`Bundled reference content, version ${SEED_VERSION}. Clearly tagged and removable without touching your records.`} />
                <div className="gl-row gl-row--tight">
                  <Button
                    variant="ghost"
                    icon={<Trash2 size={14} />}
                    onClick={() => {
                      if (!window.confirm('Delete every bundled image, technique, tutorial, ingredient note and exercise?')) return;
                      void clearSeedContent().then((n) => {
                        toast(`${n} starter record${n === 1 ? '' : 's'} removed.`, 'ok');
                        refreshFootprint();
                      });
                    }}
                  >
                    Remove starter content
                  </Button>
                </div>
              </Card>

              <Card>
                <CardHead title="Danger zone" sub="Irreversible. Export first — the ZIP is the only undo." />
                <Button
                  variant="danger"
                  icon={<ShieldCheck size={14} />}
                  onClick={() => {
                    if (!window.confirm('Erase ALL records on this device?')) return;
                    if (!window.confirm('Really erase? Type this as final confirmation.')) return;
                    void eraseEverything(false).then(() => {
                      toast('Database cleared. Reloading…', 'ok');
                      setTimeout(() => window.location.reload(), 700);
                    });
                  }}
                >
                  Erase everything
                </Button>
                <div className="gl-small gl-faint" style={{ marginTop: 8 }}>
                  Removes rows, media blobs and the sync queue from this device only.
                </div>
              </Card>

              {footprint ? (
                <div className="gl-strip">
                  <Stat label="Rows" value={footprint.rows} />
                  <Stat label="Media" value={footprint.mediaFiles} hint={`${Math.round(footprint.mediaBytes / 1024 / 1024)} MB`} />
                  <Stat label="Queued" value={footprint.queued} />
                  <Stat label="Conflicts" value={footprint.conflicts} tone={footprint.conflicts ? 'rose' : 'muted'} />
                </div>
              ) : null}
            </div>
          </div>
        </Section>
      ) : null}

      {tab === 'about' ? (
        <Section eyebrow="Build" title="About this installation">
          <div className="gl-split">
            <Card>
              <CardHead title={APP_VERSION} sub="Local-first PWA. Works offline once loaded; installs to home screen or desktop." />
              <KvList
                items={[
                  { k: 'Storage', v: 'IndexedDB via Dexie, schema v1' },
                  { k: 'Search', v: 'denormalised text index per row' },
                  { k: 'Departments', v: String(DEPARTMENTS.length) },
                  { k: 'Theme default', v: 'Oxblood' },
                  { k: 'Fonts', v: 'Cormorant Garamond, Manrope Variable, IBM Plex Mono — bundled' },
                  { k: 'AI / CV', v: 'none present, by design' },
                  { k: 'Paid dependency', v: 'none' }
                ]}
              />
            </Card>
            <Card>
              <CardHead title="Read the honesty notes" sub="What each limitation actually means." />
              <div className="gl-stack">
                <Disclosure summary="Why there is no face analysis">
                  <p className="gl-small gl-muted">
                    Cosmetic computer-vision scoring has no validated ground truth for attractiveness, drifts by skin tone and
                    camera distance, and would have had to be faked to ship here. What exists instead: standardised photos you
                    control, measurement guides you place, and evidence-graded options you choose.
                  </p>
                </Disclosure>
                <Disclosure summary="Why discovery can look thin">
                  <p className="gl-small gl-muted">
                    Without your own provider keys the feed shows the bundled sets and your uploads. A bigger fake feed would have
                    been easier to build and worse to use.
                  </p>
                </Disclosure>
                <Disclosure summary="What sync does and does not do">
                  <p className="gl-small gl-muted">
                    It replays your queued changes at an endpoint you supply. It does not host accounts, resolve merges beyond
                    revision comparison, or store anything when you are offline.
                  </p>
                </Disclosure>
              </div>
            </Card>
          </div>
        </Section>
      ) : null}
    </>
  );
}

function ProviderCard({
  source,
  row,
  onChanged
}: {
  source: (typeof DISCOVERY_SOURCES)[number];
  row: AnyRow | undefined;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [key, setKey] = useState('');
  const saved = String(row?.token ?? '');
  return (
    <Card className="gl-provcard">
      <CardHead
        title={source.label}
        eyebrow={`${source.kind}${source.worksOffline ? ' · offline capable' : ' · online only'}`}
        sub={source.note}
      />
      <div className="gl-row gl-row--tight" style={{ marginBottom: 10 }}>
        <Chip>{source.license}</Chip>
        {source.needsKey ? <Chip active={!!saved}>{saved ? 'key stored' : 'no key'}</Chip> : <Chip>ready</Chip>}
      </div>
      {source.needsKey ? (
        <div className="gl-row gl-row--tight">
          <TextInput value={key} onChange={setKey} placeholder={saved ? '•••••• stored — paste to replace' : 'Your API key'} />
          <Button
            size="sm"
            variant="gold"
            disabled={!key.trim()}
            onClick={() => {
              void saveRow(TABLES.integrations, {
                id: row?.id,
                service: source.id,
                status: 'configured',
                token: key.trim(),
                capabilities: ['discovery'],
                lastSyncAt: Date.now(),
                notes: 'Key stored locally for this device only.'
              } as never).then(() => {
                setKey('');
                toast('Key stored on this device.', 'ok');
                onChanged();
              });
            }}
          >
            Save
          </Button>
          {saved ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void saveRow(TABLES.integrations, { id: row?.id, service: source.id, status: 'disconnected', token: '' } as never).then(() => {
                  toast('Key removed.', 'ok');
                  onChanged();
                })
              }
            >
              Remove
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="gl-small gl-faint">No key needed. Content comes from this device.</div>
      )}
    </Card>
  );
}

/** Exchanges the OAuth code returned to this app, and reports honestly if it fails. */
function ExchangePanel({ code, clientId, redirectUri }: { code: string; clientId: string; redirectUri: string }) {
  const toast = useToast();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [detail, setDetail] = useState('');
  return (
    <Card accent>
      <CardHead title="Finish authorisation" sub="A code came back from Pinterest. Exchange it now — codes are single-use and expire quickly." />
      <div className="gl-row gl-row--tight">
        <Button
          variant="primary"
          disabled={state !== 'idle'}
          icon={<Wand2 size={15} />}
          onClick={() => {
            setState('busy');
            void exchangeCode({ clientId, redirectUri, code })
              .then(async (r) => {
                setDetail(r.detail);
                setState('done');
                if (r.ok && r.token) {
                  await saveRow(TABLES.integrations, {
                    service: 'pinterest',
                    status: 'connected',
                    clientId,
                    token: r.token,
                    tokenExpiresAt: r.expiresAt ?? null,
                    accountLabel: 'Connected via OAuth',
                    scopes: [REQUIRED_SCOPE, ...OPTIONAL_SCOPES],
                    capabilities: ['read boards', 'read pins'],
                    lastSyncAt: Date.now()
                  } as never);
                  toast('Connected.', 'ok');
                } else {
                  toast('Not connected — see the note.', 'bad');
                }
              })
              .catch((e: Error) => {
                setDetail(e.message);
                setState('done');
              });
          }}
        >
          {state === 'busy' ? 'Exchanging…' : 'Exchange code'}
        </Button>
      </div>
      {state === 'done' ? (
        <div className="gl-note" style={{ marginTop: 12 }}>
          {detail}
        </div>
      ) : null}
    </Card>
  );
}

/** How many preview rows the card shows. The file itself carries every row. */
const CSV_PREVIEW_ROWS = 5;

/**
 * Per-department CSV export, sitting under the ZIP and JSON buttons in the
 * Export card's stack. She picks one department, sees the first rows exactly as
 * the file will hold them, and downloads. Everything on screen comes from
 * `src/db/csv.ts`, which is the only place the column rules live.
 */
function CsvExportCard() {
  const toast = useToast();
  const [table, setTable] = useState<TableName>(TABLES.clothingItems);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [withSearchText, setWithSearchText] = useState(false);
  const [writing, setWriting] = useState(false);

  const filter = includeDeleted ? { includeDeleted: true } : undefined;
  const rows = useRows(table, filter) as AnyRow[];
  /* one pass over the registry: what is live, and what is live once her
     deleted rows are counted too. Both figures are shown, so a department is
     never silently missing and never quietly padded. */
  const tallies = useLiveQuery(
    async () => {
      const live: Record<string, number> = {};
      const withDeleted: Record<string, number> = {};
      for (const dept of CSV_DEPARTMENTS) {
        withDeleted[dept.table] = (await findAll(dept.table, { includeDeleted: true })).length;
        live[dept.table] = (await findAll(dept.table)).length;
      }
      return { live, withDeleted };
    },
    [],
    { live: {}, withDeleted: {} } as { live: Record<string, number>; withDeleted: Record<string, number> }
  );

  const shown = (name: TableName) => (includeDeleted ? tallies.withDeleted[name] : tallies.live[name]) ?? 0;
  const heldBack = includeDeleted ? 0 : Math.max(0, (tallies.withDeleted[table] ?? 0) - (tallies.live[table] ?? 0));

  const grid = useMemo(
    () => csvGrid(table, rows, { includeDeleted, withSearchText }, CSV_PREVIEW_ROWS),
    [table, rows, includeDeleted, withSearchText]
  );
  const label = departmentLabel(table);
  const total = countFor(rows);
  const plural = (n: number) => (n === 1 ? 'row' : 'rows');

  const download = () => {
    setWriting(true);
    const filename = csvFileName(table);
    const body = csvFor(table, rows, { includeDeleted, withSearchText });
    void downloadBlob(csvBlob(body), filename)
      .then(() => toast(`${filename} downloaded — ${total} ${plural(total)}, ${grid.header.length} columns.`, 'ok'))
      .catch((e: Error) => toast(e.message || 'The CSV could not be written.', 'bad'))
      .finally(() => setWriting(false));
  };

  return (
    <Card>
      <div data-testid="csv-export">
        <CardHead
          title="Spreadsheet export (.csv)"
          sub="One department at a time, as a flat table you can open anywhere. Every cell is a value from your own records."
        />
        <div className="gl-form-row">
          <Field
            label="Department"
            hint={`${grid.header.length} columns · timestamps are written as ISO dates · a count of 0 means the department is empty, not missing`}
          >
            <select
              className="gl-select"
              data-testid="csv-department"
              aria-label="Department to export"
              value={table}
              onChange={(e) => setTable(e.target.value as TableName)}
            >
              {CSV_DEPARTMENTS.map((d) => (
                <option key={d.table} value={d.table}>
                  {d.label} ({shown(d.table)} {plural(shown(d.table))})
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap', marginTop: 12 }}>
          <Toggle checked={includeDeleted} onChange={setIncludeDeleted} label="Include rows I deleted" />
          <Toggle checked={withSearchText} onChange={setWithSearchText} label="Include the search copy" />
        </div>

        <div className="gl-row gl-row--between" style={{ flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <span className="gl-small gl-faint">
            {label}: {total} {plural(total)}
            {heldBack ? ` · ${heldBack} deleted ${plural(heldBack)} held back` : ''}
          </span>
          <button type="button" className="gl-btn gl-btn--gold" data-testid="csv-download" onClick={download} disabled={writing}>
            <Download size={15} />
            {writing ? 'Writing…' : `Download ${total} ${plural(total)} (.csv)`}
          </button>
        </div>

        <div data-testid="csv-preview" style={{ marginTop: 12 }}>
          <div className="gl-small gl-faint" style={{ marginBottom: 8 }}>
            {total
              ? `Preview — the first ${Math.min(CSV_PREVIEW_ROWS, total)} of ${total} ${plural(total)}, exactly as the file holds them.`
              : 'Preview — no rows in this department yet, so the file is this header row and nothing else.'}
          </div>
          <Table
            rows={grid.rows}
            keyOf={(_row, i) => `csv-row-${i}`}
            columns={grid.header.map((header, index) => ({
              label: csvDisplay(header),
              render: (row: string[]) => {
                const value = csvDisplay(row[index] ?? '');
                return (
                  <span
                    className="gl-small gl-tech"
                    title={value}
                    style={{ display: 'block', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {value}
                  </span>
                );
              }
            }))}
          />
        </div>

        <div className="gl-note" style={{ marginTop: 12 }}>
          A CSV is a flat picture of these records taken now, not a live view — change something and you need a fresh download. Nested
          training sets (the sets and reps inside a session, the steps inside a routine, the checklist inside an event) are kept as
          compact JSON inside one cell, because a spreadsheet has no shape for them and leaving them out would quietly change what you
          recorded. Photo and audio bytes are never written into a CSV: the cell says a binary was omitted, and the full backup above is
          what carries the files. Rows you deleted stay out unless you tick “Include rows I deleted”, which then adds a Deleted at column
          so you can see when each one went. The lowercase search copy the app keeps on every row stays out unless you tick “Include the
          search copy”, because it repeats words already in your own columns. Downloading writes one file to this device and nothing to
          any server, because there is no server.
        </div>
      </div>
    </Card>
  );
}
