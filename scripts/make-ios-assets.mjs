/**
 * Builds the iOS icon set and the AltStore source artwork from the app's own
 * SVG mark, so the wrapper never ships a placeholder image.
 *
 *   node scripts/make-ios-assets.mjs
 *
 * This runs anywhere sharp runs — it is not a Mac-only step. The output is a
 * 1024×1024 opaque PNG, which is what Xcode wants for a single-size icon and
 * what AltStore wants for a source tile.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'public', 'icons', 'icon.svg');
const appIconSet = path.join(root, 'ios', 'Assets.xcassets', 'AppIcon.appiconset');
const altstoreDir = path.join(root, 'altstore');
const background = '#08070a';

/* The SVG declares a 512 viewBox and no size, so density 192 renders it at
   exactly 1024. Rasterising the vector is deliberate: upscaling the 512 PNG
   would ship a soft icon. */
const svg = await readFile(source);
const flat = await sharp(svg, { density: 192 })
  .resize(1024, 1024, { fit: 'cover', background })
  .flatten({ background })
  .removeAlpha()
  .png()
  .toBuffer();

await mkdir(appIconSet, { recursive: true });
await mkdir(path.join(root, 'ios', 'Assets.xcassets'), { recursive: true });
await mkdir(altstoreDir, { recursive: true });

await writeFile(path.join(appIconSet, 'icon-1024.png'), flat);
await writeFile(path.join(appIconSet, 'Contents.json'), JSON.stringify({
  images: [{ idiom: 'universal', platform: 'ios', version: 1, size: '1024x1024', filename: 'icon-1024.png' }],
  info: { author: 'xcode', version: 1 }
}, null, 2) + '\n');
await writeFile(path.join(root, 'ios', 'Assets.xcassets', 'Contents.json'), JSON.stringify({
  info: { author: 'xcode', version: 1 }
}, null, 2) + '\n');

/* AltStore needs the same art at a public URL; it is written next to the source
   file so there is one thing to upload, not two to keep in step. */
await writeFile(path.join(altstoreDir, 'AppIcon-1024.png'), flat);
await writeFile(path.join(altstoreDir, 'source-icon-512.png'), await sharp(flat)
  .resize(512, 512, { fit: 'cover' })
  .flatten({ background })
  .removeAlpha()
  .png()
  .toBuffer());

const meta = await sharp(flat).metadata();
const altIcon = existsSync(path.join(altstoreDir, 'AppIcon-1024.png'));

console.log(`icon      ${meta.width}×${meta.height} ${meta.format} channels=${meta.channels} alpha=${meta.hasAlpha ? 'yes' : 'no'} ${flat.byteLength} bytes`);
console.log(`assets    ios/Assets.xcassets/AppIcon.appiconset/icon-1024.png + Contents.json`);
console.log(`altstore  altstore/AppIcon-1024.png + source-icon-512.png ${altIcon ? 'written' : 'MISSING'}`);
console.log('note      the mark carries its own rounded frame; iOS masks the square again');
