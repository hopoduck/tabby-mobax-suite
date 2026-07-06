import { describe, it, expect } from 'vitest';
import {
  extOf,
  isAcceptedImageExt,
  mimeForExt,
  svgDataUri,
  imgIconHtml,
  withinIconSizeCap,
  ICON_SIZE_CAP,
} from './groupIcon';

describe('extOf', () => {
  it('returns the lowercased extension without the dot', () => {
    expect(extOf('photo.PNG')).toBe('png');
    expect(extOf('C:\\dir\\pic.jpeg')).toBe('jpeg');
    expect(extOf('/home/u/a.webp')).toBe('webp');
  });

  it('returns empty string when there is no extension', () => {
    expect(extOf('noext')).toBe('');
    expect(extOf('C:\\di.r\\noext')).toBe('');
    expect(extOf('')).toBe('');
  });

  it('uses only the last extension', () => {
    expect(extOf('archive.tar.gz')).toBe('gz');
  });
});

describe('isAcceptedImageExt', () => {
  it('accepts png/jpg/jpeg/gif/webp/svg case-insensitively', () => {
    for (const f of ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.WebP', 'f.svg']) {
      expect(isAcceptedImageExt(f)).toBe(true);
    }
  });

  it('rejects other or missing extensions', () => {
    for (const f of ['a.bmp', 'b.txt', 'noext', 'evil.png.exe']) {
      expect(isAcceptedImageExt(f)).toBe(false);
    }
  });
});

describe('mimeForExt', () => {
  it('maps accepted extensions to their mime types', () => {
    expect(mimeForExt('png')).toBe('image/png');
    expect(mimeForExt('jpg')).toBe('image/jpeg');
    expect(mimeForExt('jpeg')).toBe('image/jpeg');
    expect(mimeForExt('gif')).toBe('image/gif');
    expect(mimeForExt('webp')).toBe('image/webp');
    expect(mimeForExt('svg')).toBe('image/svg+xml');
  });

  it('is case-insensitive and falls back to octet-stream', () => {
    expect(mimeForExt('PNG')).toBe('image/png');
    expect(mimeForExt('bmp')).toBe('application/octet-stream');
  });
});

describe('svgDataUri', () => {
  it('builds a base64 svg data URI', () => {
    expect(svgDataUri('<svg/>')).toBe('data:image/svg+xml;base64,PHN2Zy8+');
  });

  it('handles non-ASCII text via UTF-8', () => {
    expect(svgDataUri('한')).toBe('data:image/svg+xml;base64,7ZWc');
  });
});

describe('imgIconHtml', () => {
  it('wraps a data URI in an img tag', () => {
    expect(imgIconHtml('data:image/png;base64,AAA')).toBe(
      '<img src="data:image/png;base64,AAA">',
    );
  });
});

describe('withinIconSizeCap', () => {
  it('accepts strings up to exactly the cap', () => {
    expect(withinIconSizeCap('x'.repeat(ICON_SIZE_CAP))).toBe(true);
  });

  it('rejects strings one char over the cap', () => {
    expect(withinIconSizeCap('x'.repeat(ICON_SIZE_CAP + 1))).toBe(false);
  });
});
