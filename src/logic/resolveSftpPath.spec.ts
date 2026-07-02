import { describe, it, expect } from 'vitest';
import { pathCandidates, derivePrefixMapping, applyPrefixMapping } from './resolveSftpPath';

describe('pathCandidates', () => {
  it('strips leading segments, longest suffix first, excluding the input and root', () => {
    expect(pathCandidates('/volume3/web/share')).toEqual(['/web/share', '/share']);
  });

  it('returns [] when there is nothing to strip (single segment)', () => {
    expect(pathCandidates('/web')).toEqual([]);
  });

  it('returns [] for root and empty', () => {
    expect(pathCandidates('/')).toEqual([]);
    expect(pathCandidates('')).toEqual([]);
  });

  it('collapses redundant/trailing slashes', () => {
    expect(pathCandidates('/volume1//web/share/')).toEqual(['/web/share', '/share']);
  });

  it('never yields "/" as a candidate', () => {
    expect(pathCandidates('/a/b')).not.toContain('/');
  });
});

describe('derivePrefixMapping', () => {
  it('derives the stripped prefix from input + resolved suffix', () => {
    expect(derivePrefixMapping('/volume3/web/share', '/web/share')).toEqual({
      from: '/volume3',
      to: '',
    });
  });

  it('derives a multi-segment prefix', () => {
    expect(derivePrefixMapping('/mnt/pool0/data/web', '/data/web')).toEqual({
      from: '/mnt/pool0',
      to: '',
    });
  });

  it('returns null when resolved is not a whole-segment suffix of input', () => {
    expect(derivePrefixMapping('/volume3/web/share', '/eb/share')).toBeNull();
    expect(derivePrefixMapping('/volume3/web/share', '/other')).toBeNull();
  });

  it('returns null when resolved is not strictly shorter than input', () => {
    expect(derivePrefixMapping('/web/share', '/web/share')).toBeNull();
    expect(derivePrefixMapping('/web/share', '/x/web/share')).toBeNull();
  });
});

describe('applyPrefixMapping', () => {
  const map = { from: '/volume3', to: '' };

  it('rewrites a matching shell path to the SFTP namespace', () => {
    expect(applyPrefixMapping('/volume3/web/share', map)).toBe('/web/share');
  });

  it('is idempotent on an already-mapped path (loop guard)', () => {
    expect(applyPrefixMapping('/web/share', map)).toBe('/web/share');
  });

  it('maps the prefix itself to root', () => {
    expect(applyPrefixMapping('/volume3', map)).toBe('/');
  });

  it('does not partial-match a longer segment name', () => {
    expect(applyPrefixMapping('/volume30/x', map)).toBe('/volume30/x');
  });

  it('leaves unrelated paths untouched', () => {
    expect(applyPrefixMapping('/home/user', map)).toBe('/home/user');
  });

  it('supports a non-empty target prefix', () => {
    expect(applyPrefixMapping('/volume3/web', { from: '/volume3', to: '/data' })).toBe('/data/web');
  });

  it('is a no-op for an empty/root mapping', () => {
    expect(applyPrefixMapping('/x', { from: '', to: '' })).toBe('/x');
    expect(applyPrefixMapping('/x', { from: '/', to: '' })).toBe('/x');
  });
});
