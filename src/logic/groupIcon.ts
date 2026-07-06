// Pure helpers for folder (group) icon strings. Dependency-free per the repo's logic policy —
// Buffer is the Node/Electron global (no import), so the vitest suite stays runnable.

const ACCEPTED_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

// Stored icon strings live inside the config YAML; cap them so one oversized image can't bloat
// the whole config file (~100 KB).
export const ICON_SIZE_CAP = 100_000;

/** Lowercased extension of a filename/path without the dot; '' when there is none. */
export function extOf(filename: string): string {
  const m = /\.([^./\\]+)$/.exec(filename);
  return m ? m[1].toLowerCase() : '';
}

export function isAcceptedImageExt(filename: string): boolean {
  return ACCEPTED_EXTS.includes(extOf(filename));
}

export function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

/** Base64 data URI for raw SVG text (kept vector — no rasterization). */
export function svgDataUri(svgText: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svgText, 'utf-8').toString('base64')}`;
}

/**
 * The stored icon string for an image icon. Starts with '<' so the existing isSvgIcon /
 * iconHtml render path (same semantics as Tabby profile icons) picks it up as raw HTML.
 */
export function imgIconHtml(dataUri: string): string {
  return `<img src="${dataUri}">`;
}

export function withinIconSizeCap(iconString: string): boolean {
  return iconString.length <= ICON_SIZE_CAP;
}
