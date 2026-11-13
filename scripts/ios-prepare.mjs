/**
 * Stages the built web app into the iOS bundle and proves the copy is whole.
 *
 *   npm run build && npm run ios:prepare
 *
 * The wrapper serves its bundle, so a file missing here is a broken screen on a
 * phone. Rather than trust the copy, this reads the app's own entry document and
 * checks that every file it points at arrived — which is the failure mode that
 * actually bites: a half-finished dist, a renamed hash, a stale www.
 */

import { cp, mkdir, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const www = path.join(root, 'ios', 'AppBundle', 'www');

if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/index.html is not there. Run `npm run build` first — this script stages a build, it does not make one.');
  process.exit(1);
}

/* Windows locks a directory it is still indexing, and the copy target is 200+
   fresh files, so the first rm after a stage often fails with EBUSY for no
   reason a retry will not fix. Bounded, then say what is actually wrong. */
async function removeStale(dir) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (e.code !== 'EBUSY' && e.code !== 'EPERM' && e.code !== 'ENOTEMPTY') throw e;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw new Error(
    `Could not clear ${dir} — Windows still has it locked (an Explorer window, a search index or an antivirus scan). ` +
      'Close whatever is holding it and run this again; staging a half-cleared bundle is how a phone ends up with a blank screen.'
  );
}

await removeStale(www);
await mkdir(path.dirname(www), { recursive: true });
await cp(dist, www, { recursive: true });

async function walk(dir, base = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await walk(path.join(dir, entry.name), rel));
    else out.push({ rel, bytes: (await stat(path.join(dir, entry.name))).size });
  }
  return out;
}

const files = await walk(www);
const total = files.reduce((n, f) => n + f.bytes, 0);
const index = await readFile(path.join(www, 'index.html'), 'utf8');

/* Every ./assets/... and ./icons/... reference the entry document makes, plus
   whatever the generated manifest asks for. Hashed filenames make this exact:
   a stale www fails here rather than showing a blank page on the device. */
const refs = [...new Set([...index.match(/\.\/[\w./-]+\.(?:js|css|webp|png|svg|json|woff2|webmanifest)/g) ?? []])];
const manifestPath = path.join(www, 'manifest.webmanifest');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const icon of manifest.icons ?? []) refs.push(`./${String(icon.src).replace(/^\.?\//, '')}`);
}
const present = new Set(files.map((f) => `./${f.rel}`));
const missing = refs.filter((r) => !present.has(r));

/* The entry document only names its own module. Everything behind a route is a
   hashed lazy chunk, and the one place all of them are listed is the service
   worker's precache manifest — so check the bundle against that too. A chunk
   missing here is a department that opens blank on the phone, and the app will
   not say which file it could not fetch. */
const swPath = path.join(www, 'sw.js');
let precached = [];
if (existsSync(swPath)) {
  const sw = await readFile(swPath, 'utf8');
  /* Workbox writes this as JS object literals — `{url:"index.html",revision:"…"}`
     — not JSON, so the key is unquoted. Accept either spelling. */
  precached = [...new Set([...sw.matchAll(/\b"?url"?\s*:\s*"([^"]+)"/g)].map((m) => m[1]))]
    .map((u) => `./${u.replace(/^\.?\//, '')}`)
    .filter((u) => !/^\.\/(https?:)?\/\//.test(u));
}
const absent = precached.filter((u) => !present.has(u));
if (absent.length) {
  console.error(`The service worker precaches ${absent.length} file(s) that are not in the bundle:`);
  for (const a of absent) console.error(`  ${a}`);
  console.error('Those screens will work online and fail offline. Rebuild, do not hand-edit dist.');
  process.exit(1);
}

if (missing.length) {
  console.error(`Staged ${files.length} files, but the entry document asks for ${missing.length} that are not in the bundle:`);
  for (const m of missing) console.error(`  ${m}`);
  console.error('The build is incomplete or dist is stale. Rebuild and run this again.');
  process.exit(1);
}

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await writeFile(
  path.join(root, 'ios', 'BUILD-INFO.json'),
  JSON.stringify({
    stagedAt: new Date().toISOString(),
    packageVersion: pkg.version,
    files: files.length,
    bytes: total,
    entryRefsChecked: refs.length,
    precachedChecked: precached.length
  }, null, 2) + '\n'
);

console.log(`staged    ios/AppBundle/www — ${files.length} files, ${(total / 1024 / 1024).toFixed(1)} MiB`);
console.log(`checked   ${refs.length} references out of index.html and the manifest, all present`);
console.log(`checked   ${precached.length} precached files named by sw.js, all present`);
console.log(`version   ${pkg.version}`);
console.log('next      cd ios && xcodegen generate   (macOS only — see IOS_ALTSTORE.md)');
