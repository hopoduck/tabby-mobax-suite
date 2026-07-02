import { describe, it, expect } from 'vitest';
import { mimeForName, buildDownloadUrl } from './dragOut';

describe('mimeForName', () => {
  it('maps known extensions case-insensitively', () => {
    expect(mimeForName('photo.PNG')).toBe('image/png');
    expect(mimeForName('a.txt')).toBe('text/plain');
  });
  it('falls back to octet-stream for unknown or extension-less names', () => {
    expect(mimeForName('README')).toBe('application/octet-stream');
    expect(mimeForName('archive.weirdext')).toBe('application/octet-stream');
    expect(mimeForName('trailingdot.')).toBe('application/octet-stream');
  });
});

describe('buildDownloadUrl', () => {
  it('formats as mime:filename:url and infers mime when omitted', () => {
    expect(buildDownloadUrl('a.txt', 'http://127.0.0.1:9/dl/x')).toBe(
      'text/plain:a.txt:http://127.0.0.1:9/dl/x',
    );
  });
  it('uses an explicit mime when provided', () => {
    expect(buildDownloadUrl('blob', 'http://127.0.0.1:9/dl/x', 'application/zip')).toBe(
      'application/zip:blob:http://127.0.0.1:9/dl/x',
    );
  });
});
