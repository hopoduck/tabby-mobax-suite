import { readFileSync } from 'fs';
import {
  extOf,
  isAcceptedImageExt,
  mimeForExt,
  svgDataUri,
  imgIconHtml,
  withinIconSizeCap,
} from './logic/groupIcon';

export type GroupIconErrorKind = 'read' | 'decode' | 'too-large' | 'unsupported';

/** Distinct failure kinds so the picker can choose the right notification. */
export class GroupIconError extends Error {
  constructor(
    public kind: GroupIconErrorKind,
    message: string,
  ) {
    super(message);
  }
}

// Max raster edge: 32px ≈ 2× the 15px display footprint, for high-DPI crispness. Never upscale.
const MAX_EDGE = 32;

/**
 * Convert a local image file into the stored icon string (`<img src="data:...">`).
 * SVG stays vector (text → base64 data URI); raster formats are decoded and downscaled to fit
 * 32×32 (aspect preserved) via canvas → PNG. Animated GIFs become a static frame (accepted
 * trade-off). Throws GroupIconError('read' | 'decode' | 'too-large' | 'unsupported').
 */
export async function buildImageIcon(filePath: string): Promise<string> {
  if (!isAcceptedImageExt(filePath)) {
    throw new GroupIconError('unsupported', `unsupported image type: ${filePath}`);
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(filePath);
  } catch {
    throw new GroupIconError('read', `cannot read file: ${filePath}`);
  }
  const ext = extOf(filePath);
  if (ext === 'svg') {
    return capped(imgIconHtml(svgDataUri(bytes.toString('utf-8'))));
  }
  const img = await loadImage(`data:${mimeForExt(ext)};base64,${bytes.toString('base64')}`);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) {
    throw new GroupIconError('decode', 'image has no dimensions');
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new GroupIconError('decode', 'cannot create canvas context');
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return capped(imgIconHtml(canvas.toDataURL('image/png')));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new GroupIconError('decode', 'image decode failed'));
    img.src = src;
  });
}

function capped(icon: string): string {
  if (!withinIconSizeCap(icon)) {
    throw new GroupIconError('too-large', 'icon string exceeds size cap');
  }
  return icon;
}
