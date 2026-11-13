/**
 * A fit sheet: the pieces of one outfit laid side by side, each drawn from the
 * photograph already stored for it.
 *
 * This is the closet's own arithmetic, not a model: it composes pictures the
 * app already holds. It never decides what goes with what, never retouches, and
 * never claims the result is a photograph of the outfit being worn — the try-on
 * simulation on /try-on is a different record with a different label.
 */

export interface FitSheetPiece {
  /** the garment's own name, drawn as the caption under its picture */
  label: string;
  /** an object URL for the stored picture of that piece */
  url: string;
}

export interface FitSheetOptions {
  columns?: number;
  cellWidth?: number;
  cellHeight?: number;
  gap?: number;
  padding?: number;
  header?: number;
}

const DEFAULTS = { columns: 3, cellWidth: 300, cellHeight: 400, gap: 14, padding: 22, header: 62 } as const;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.decoding = 'async';
    img.src = url;
  });
}

/** Contain-fit inside the cell, centred — nothing is cropped and nothing is stretched. */
function fitBox(w: number, h: number, cellW: number, cellH: number) {
  const scale = Math.min(cellW / w, cellH / h, 1);
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  return { x: Math.round((cellW - dw) / 2), y: Math.round((cellH - dh) / 2), w: dw, h: dh };
}

/**
 * Rows of the pieces' own photographs with their names under them. Returns null
 * when the browser hands back no pixels at all, so a caller can say so instead
 * of exporting a blank sheet.
 */
export async function composeFitSheet(pieces: FitSheetPiece[], opts: FitSheetOptions = {}): Promise<Blob | null> {
  const o = { ...DEFAULTS, ...opts };
  const cells = pieces.length ? Math.ceil(pieces.length / o.columns) : 0;
  if (!cells) return null;
  const canvas = document.createElement('canvas');
  canvas.width = o.padding * 2 + o.columns * o.cellWidth + (o.columns - 1) * o.gap;
  canvas.height = o.padding * 2 + o.header + cells * (o.cellHeight + 26) + (cells - 1) * o.gap;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let drawn = 0;
  for (let i = 0; i < pieces.length; i += 1) {
    const img = await loadImage(pieces[i].url);
    if (!img || !img.naturalWidth || !img.naturalHeight) continue;
    const col = drawn % o.columns;
    const row = Math.floor(drawn / o.columns);
    const x = o.padding + col * (o.cellWidth + o.gap);
    const y = o.padding + o.header + row * (o.cellHeight + 26 + o.gap);
    const box = fitBox(img.naturalWidth, img.naturalHeight, o.cellWidth, o.cellHeight);
    ctx.drawImage(img, x + box.x, y + box.y, box.w, box.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.14)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, o.cellWidth - 1, o.cellHeight - 1);
    ctx.fillStyle = '#111111';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    const label = pieces[i].label || '';
    ctx.fillText(label.length > 34 ? `${label.slice(0, 33)}…` : label, x, y + o.cellHeight + 6, o.cellWidth);
    drawn += 1;
  }
  if (!drawn) return null;

  ctx.fillStyle = '#111111';
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('FIT SHEET — composed from the photographs of these pieces', o.padding, o.padding + 6, canvas.width - o.padding * 2);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = '#555555';
  ctx.fillText('Not a photograph of the outfit being worn, and no fit is judged here.', o.padding, o.padding + 26, canvas.width - o.padding * 2);

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/webp', 0.92);
  });
}
