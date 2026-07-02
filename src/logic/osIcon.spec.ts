import { describe, it, expect } from 'vitest';
import { parseOsRelease, osIconSlug } from './osIcon';
import { OS_ICONS } from './osIcons';

describe('parseOsRelease', () => {
  it('reads ID and ID_LIKE with quotes', () => {
    const r = parseOsRelease('NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\n');
    expect(r.id).toBe('ubuntu');
    expect(r.idLike).toEqual(['debian']);
  });

  it('reads unquoted values and splits multi-token ID_LIKE', () => {
    const r = parseOsRelease('ID=rocky\nID_LIKE="rhel centos fedora"');
    expect(r.id).toBe('rocky');
    expect(r.idLike).toEqual(['rhel', 'centos', 'fedora']);
  });

  it('returns nulls/empties when fields are absent', () => {
    const r = parseOsRelease('NAME=Whatever\nVERSION=1');
    expect(r.id).toBeNull();
    expect(r.idLike).toEqual([]);
  });
});

describe('osIconSlug', () => {
  it('matches IDs that equal a slug directly', () => {
    expect(osIconSlug('ID=ubuntu')).toBe('ubuntu');
    expect(osIconSlug('ID=debian')).toBe('debian');
    expect(osIconSlug('ID=almalinux')).toBe('almalinux');
    expect(osIconSlug('ID=fedora')).toBe('fedora');
  });

  it('resolves aliased IDs to their slug', () => {
    expect(osIconSlug('ID=rhel')).toBe('redhat');
    expect(osIconSlug('ID=rocky')).toBe('rockylinux');
    expect(osIconSlug('ID=alpine')).toBe('alpinelinux');
    expect(osIconSlug('ID=arch')).toBe('archlinux');
    expect(osIconSlug('ID=kali')).toBe('kalilinux');
    expect(osIconSlug('ID=raspbian')).toBe('raspberrypi');
    expect(osIconSlug('ID=opensuse-leap')).toBe('opensuse');
    expect(osIconSlug('ID=sles')).toBe('suse');
  });

  it('detects Synology via the ID_SYNO hint regardless of os-release', () => {
    expect(osIconSlug('ID_SYNO=1')).toBe('synology');
    expect(osIconSlug('NAME="Synology DSM"\nID_SYNO=1')).toBe('synology');
  });

  it('falls back to the distro family via ID_LIKE', () => {
    expect(osIconSlug('ID=scientific\nID_LIKE="rhel fedora"')).toBe('redhat');
    expect(osIconSlug('ID=pop\nID_LIKE="ubuntu debian"')).toBe('debian');
  });

  it('falls back to generic Tux when os-release exists but distro is unknown', () => {
    expect(osIconSlug('ID=somethingexotic')).toBe('linux');
  });

  it('returns null when there is no probe data', () => {
    expect(osIconSlug('')).toBeNull();
    expect(osIconSlug('   ')).toBeNull();
  });

  it('only ever returns slugs that exist in OS_ICONS', () => {
    const probes = ['ID=ubuntu', 'ID=rhel', 'ID_SYNO=1', 'ID=x\nID_LIKE=rhel', 'ID=exotic'];
    for (const p of probes) {
      const slug = osIconSlug(p);
      expect(slug && OS_ICONS[slug]).toBeTruthy();
    }
  });
});
