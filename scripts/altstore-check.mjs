/**
 * Validates the AltStore source before anything is uploaded.
 *
 *   npm run ios:check          structure, placeholders, local artifacts
 *   npm run ios:check -- --net also HEAD-checks every hosted URL
 *
 * AltStore refuses a source it cannot parse, and the failure it produces on the
 * phone is a bare "unable to refresh source" with no field named. Every rule here
 * is one AltStore enforces and reports badly: the version object needs a real
 * byte count, the bundle identifier is case-sensitive against the app's own
 * Info.plist, and a date it can parse. Anything the platform does NOT require is
 * a warning, not an error, so this never blocks a source that would work.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'altstore', 'apps.json');
const ipaDir = path.join(root, 'altstore');
const wantNet = process.argv.slice(2).includes('--net');

const errors = [];
const warnings = [];
const info = [];

const bad = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);
const note = (msg) => info.push(msg);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?$/;
const httpsUrl = (v) => typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v);

/* Placeholders are the difference between a source that publishes and one that
   looks fine locally and fails on the phone. Anything still carrying the marker
   from the template is unfinished work, not a valid value. */
const PLACEHOLDER = /REPLACE-[A-Z-]+/;

function isPlaceholder(v) {
  return typeof v === 'string' && PLACEHOLDER.test(v);
}

function describe(what, value, { required = true, check } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) bad(`${what} is missing.`);
    return false;
  }
  if (isPlaceholder(value)) {
    bad(`${what} is still the template placeholder: ${value}`);
    return false;
  }
  if (check && !check(value)) return false;
  return true;
}

if (!existsSync(sourcePath)) {
  console.error(`No source file at ${sourcePath}`);
  process.exit(1);
}

let source;
try {
  source = JSON.parse(await readFile(sourcePath, 'utf8'));
} catch (e) {
  console.error(`altstore/apps.json is not valid JSON: ${e.message}`);
  console.error('AltStore will not tell you this on the phone — it will just refuse to refresh.');
  process.exit(1);
}

/* --- top level ------------------------------------------------------------ */
describe('name', source.name);
describe('subtitle', source.subtitle, { required: false });
describe('description', source.description);
describe('iconURL', source.iconURL, {
  check: (v) => {
    if (!httpsUrl(v)) bad(`iconURL must be an absolute https URL, got ${v}`);
    return true;
  }
});
describe('website', source.website, {
  required: false,
  check: (v) => {
    if (!httpsUrl(v)) bad(`website must be an absolute https URL, got ${v}`);
    return true;
  }
});
if (source.tintColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(source.tintColor))) {
  bad(`tintColor must be #rrggbb, got ${source.tintColor}`);
}
if (!Array.isArray(source.apps) || source.apps.length === 0) {
  bad('apps must be a non-empty array.');
}
if (source.news !== undefined && !Array.isArray(source.news)) bad('news must be an array.');

/* --- apps ----------------------------------------------------------------- */
const seenBundleIds = new Set();
const listedDownloadUrls = new Set();

for (const app of source.apps ?? []) {
  const label = app?.name ? `app "${app.name}"` : 'app';
  if (!app || typeof app !== 'object') {
    bad(`${label} is not an object.`);
    continue;
  }
  describe(`${label} name`, app.name);
  describe(`${label} developerName`, app.developerName);
  describe(`${label} localizedDescription`, app.localizedDescription);
  describe(`${label} subtitle`, app.subtitle, { required: false });

  const bundle = String(app.bundleIdentifier ?? '');
  if (describe(`${label} bundleIdentifier`, bundle)) {
    if (bundle.length > 125) bad(`${label} bundleIdentifier is longer than 125 characters.`);
    if (!/^[A-Za-z0-9.-]+$/.test(bundle)) bad(`${label} bundleIdentifier has characters outside A-Za-z0-9.- : ${bundle}`);
    if (seenBundleIds.has(bundle)) bad(`${label} repeats bundleIdentifier ${bundle}; AltStore keys the install on it.`);
    seenBundleIds.add(bundle);
  }

  if (app.iconURL !== undefined && !httpsUrl(app.iconURL)) bad(`${label} iconURL must be an absolute https URL, got ${app.iconURL}`);
  if (app.tintColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(app.tintColor))) {
    bad(`${label} tintColor must be #rrggbb, got ${app.tintColor}`);
  }
  if (app.screenshots === undefined || (Array.isArray(app.screenshots) && app.screenshots.length === 0)) {
    warn(`${label} has no screenshots — the source works, but the install page shows nothing.`);
  }
  for (const shot of app.screenshots ?? []) {
    if (isPlaceholder(shot)) bad(`${label} screenshot is still a placeholder: ${shot}`);
    else if (!httpsUrl(shot)) bad(`${label} screenshot must be an absolute https URL, got ${shot}`);
  }

  if (!Array.isArray(app.versions) || app.versions.length === 0) {
    bad(`${label} versions must be a non-empty array — this is what AltStore installs from.`);
    continue;
  }

  for (const v of app.versions) {
    const vlabel = `${label} version ${v?.version ?? '?'}`;
    describe(`${vlabel} version`, v?.version);

    if (describe(`${vlabel} date`, v?.date, { check: () => true }) && !ISO_DATE.test(String(v.date))) {
      bad(`${vlabel} date must be ISO-8601 (YYYY-MM-DD), got ${v.date}. AltStore parses it for the "last updated" line.`);
    }

    if (typeof v?.size !== 'number' || !Number.isInteger(v?.size) || v.size <= 0) {
      bad(
        `${vlabel} size must be the .ipa byte count as an integer, got ${JSON.stringify(v.size)}. ` +
          'AltStore reads it before downloading and a zero or a string makes the install hang at "waiting".'
      );
    }

    if (describe(`${vlabel} downloadURL`, v?.downloadURL)) {
      if (!httpsUrl(v.downloadURL)) bad(`${vlabel} downloadURL must be an absolute https URL, got ${v.downloadURL}`);
      else if (!/\.ipa(?:$|[?#])/i.test(v.downloadURL)) {
        warn(`${vlabel} downloadURL does not end in .ipa — AltStore expects the archive itself, not a page linking to it.`);
      } else listedDownloadUrls.add(v.downloadURL);
    }
  }
}

/* --- cross-check the wrapper project -------------------------------------- */
const projectYml = path.join(root, 'ios', 'project.yml');
if (existsSync(projectYml)) {
  const yml = await readFile(projectYml, 'utf8');
  const ids = [...new Set([...yml.matchAll(/(?:CFBundleIdentifier|PRODUCT_BUNDLE_IDENTIFIER):\s*['"]?([\w.-]+)/g)].map((m) => m[1]))];
  for (const id of ids) {
    if (!seenBundleIds.has(id)) {
      bad(
        `ios/project.yml builds bundle id "${id}" but no app in the source has it. ` +
          'AltStore matches the identifier case-sensitively against the Info.plist inside the .ipa; a mismatch installs a second app or fails to update.'
      );
    }
  }
  for (const id of seenBundleIds) {
    if (!ids.includes(id)) warn(`source bundle id "${id}" is not the one ios/project.yml builds (${ids.join(', ')}).`);
  }
  note(`bundle ids   ios/project.yml: ${ids.join(', ') || 'none found'}`);
} else {
  warn('ios/project.yml is not here, so the bundle identifier could not be cross-checked.');
}

/* --- cross-check the app version ------------------------------------------ */
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
for (const app of source.apps ?? []) {
  for (const v of app.versions ?? []) {
    if (v?.version && v.version !== pkg.version) {
      warn(`source version ${v.version} is not package.json version ${pkg.version} — the .ipa and the source should say the same thing.`);
    }
  }
}

/* --- local build artifacts ------------------------------------------------ */
for (const f of ['AppIcon-1024.png', 'source-icon-512.png']) {
  const p = path.join(ipaDir, f);
  if (existsSync(p)) {
    const s = await stat(p);
    if (s.size === 0) bad(`altstore/${f} is empty.`);
    else note(`artifacts    altstore/${f} — ${(s.size / 1024).toFixed(1)} KiB`);
  } else {
    warn(`altstore/${f} is not there yet — run npm run ios:assets.`);
  }
}

const ipas = existsSync(ipaDir)
  ? (await readdir(ipaDir)).filter((f) => f.toLowerCase().endsWith('.ipa'))
  : [];
if (ipas.length === 0) {
  note('ipa          none in altstore/ yet (built by CI or Xcode, not by this script).');
} else {
  for (const f of ipas) {
    const s = await stat(path.join(ipaDir, f));
    note(`ipa          altstore/${f} — ${s.size.toLocaleString('en-US')} bytes`);
    const inSource = [...listedDownloadUrls].some((u) => u.endsWith(`/${f}`) || u.endsWith(f));
    if (!inSource) warn(`altstore/${f} is not referenced by any downloadURL in the source.`);
    for (const app of source.apps ?? []) {
      for (const v of app.versions ?? []) {
        if (typeof v?.size === 'number' && v.size > 0 && v.size !== s.size && inSource) {
          bad(`source says size ${v.size} but altstore/${f} is ${s.size} bytes. AltStore shows a wrong progress bar and may abort.`);
        }
      }
    }
    const named = f.match(/-(\d+\.\d+\.\d+)\.ipa$/i)?.[1];
    if (named) {
      for (const app of source.apps ?? []) {
        for (const v of app.versions ?? []) {
          if (v?.version && v.version !== named) {
            warn(`${f} is version ${named} but the source lists ${v.version}.`);
          }
        }
      }
    }
  }
}

/* --- optional network check ---------------------------------------------- */
if (wantNet) {
  const urls = new Set();
  const collect = (u) => typeof u === 'string' && /^https:\/\//.test(u) && !PLACEHOLDER.test(u) && urls.add(u);
  collect(source.iconURL);
  collect(source.website);
  for (const app of source.apps ?? []) {
    collect(app.iconURL);
    for (const shot of app.screenshots ?? []) collect(shot);
    for (const v of app.versions ?? []) collect(v?.downloadURL);
  }
  note(`net          HEAD-checking ${urls.size} URL(s)`);
  for (const u of [...urls]) {
    try {
      const res = await fetch(u, { method: 'HEAD' });
      if (!res.ok) bad(`HEAD ${u} → ${res.status} ${res.statusText}`);
      else {
        const len = Number(res.headers.get('content-length'));
        const ct = res.headers.get('content-type') ?? '';
        const mismatch = [...(source.apps ?? [])]
          .flatMap((a) => a.versions ?? [])
          .find((v) => v?.downloadURL === u && typeof v.size === 'number' && v.size > 0 && len > 0 && v.size !== len);
        note(`  ${res.status} ${ct || '?'} ${len ? `${len.toLocaleString('en-US')} bytes` : '?'} ${u}`);
        if (mismatch) bad(`hosted ${u} is ${len} bytes but the source declares ${mismatch.size}.`);
      }
    } catch (e) {
      bad(`HEAD ${u} failed: ${e.message} — either the file is not hosted yet or the host is unreachable from here.`);
    }
  }
} else {
  note('net          skipped (pass --net to HEAD-check the hosted URLs).');
}

/* --- report --------------------------------------------------------------- */
console.log('altstore source check — altstore/apps.json');
for (const line of info) console.log(`  ${line}`);
for (const line of warnings) console.log(`  warn    ${line}`);
for (const line of errors) console.log(`  ERROR   ${line}`);

if (errors.length) {
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s). Not ready to publish.`);
  console.log('Every error above is a field AltStore requires and reports on the phone only as "unable to refresh the source".');
  process.exit(1);
}
console.log(`\nOK — ${warnings.length} warning(s), no blocking errors.`);
if (warnings.length) console.log('Warnings do not stop the source from working.');
