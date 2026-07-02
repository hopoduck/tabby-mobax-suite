// Pure mapping from the status command's @@OS probe to a simple-icons slug present
// in OS_ICONS. No Tabby/Angular imports so the vitest suite stays runnable.

import { OS_ICONS } from './osIcons';

// os-release IDs whose value differs from our icon slug. IDs that already equal a
// slug (ubuntu, debian, centos, fedora, almalinux, manjaro, linuxmint, gentoo,
// nixos, freebsd, ...) match OS_ICONS directly and need no entry here.
const ID_ALIAS: Record<string, string> = {
  rhel: 'redhat',
  redhatenterpriseserver: 'redhat',
  ol: 'redhat', // Oracle Linux: no dedicated logo, RHEL-compatible
  rocky: 'rockylinux',
  alpine: 'alpinelinux',
  arch: 'archlinux',
  archarm: 'archlinux',
  kali: 'kalilinux',
  raspbian: 'raspberrypi',
  sles: 'suse',
  sled: 'suse',
  'opensuse-leap': 'opensuse',
  'opensuse-tumbleweed': 'opensuse',
  'opensuse-microos': 'opensuse',
};

// ID_LIKE tokens tried in order when ID itself maps to nothing.
const ID_LIKE_FALLBACK: Array<[string, string]> = [
  ['rhel', 'redhat'],
  ['fedora', 'fedora'],
  ['centos', 'centos'],
  ['suse', 'suse'],
  ['arch', 'archlinux'],
  ['debian', 'debian'],
];

export interface OsRelease {
  id: string | null;
  idLike: string[];
}

/** Parse the `ID=` / `ID_LIKE=` lines of /etc/os-release (quotes optional). */
export function parseOsRelease(text: string): OsRelease {
  let id: string | null = null;
  let idLike: string[] = [];
  for (const raw of text.split('\n')) {
    const m = raw.trim().match(/^(ID|ID_LIKE)=(.*)$/);
    if (!m) {
      continue;
    }
    const value = m[2]
      .trim()
      .replace(/^["']|["']$/g, '')
      .toLowerCase();
    if (m[1] === 'ID') {
      id = value || null;
    } else {
      idLike = value.split(/\s+/).filter(Boolean);
    }
  }
  return { id, idLike };
}

// Maps the @@OS probe text to an OS_ICONS slug, or null when nothing matches
// (caller then keeps the generic fa-server icon). Synology is detected by the
// ID_SYNO=1 hint the command emits, since DSM's os-release is unreliable.
export function osIconSlug(probeText: string): string | null {
  const text = (probeText || '').trim();
  if (!text) {
    return null;
  }
  if (/^ID_SYNO=1$/m.test(text)) {
    return 'synology';
  }
  const { id, idLike } = parseOsRelease(text);
  if (id && OS_ICONS[id]) {
    return id;
  }
  if (id && ID_ALIAS[id] && OS_ICONS[ID_ALIAS[id]]) {
    return ID_ALIAS[id];
  }
  for (const [token, slug] of ID_LIKE_FALLBACK) {
    if (idLike.includes(token) && OS_ICONS[slug]) {
      return slug;
    }
  }
  // os-release present (so it's a Linux box) but distro unknown -> generic Tux.
  if (id || idLike.length > 0) {
    return OS_ICONS['linux'] ? 'linux' : null;
  }
  return null;
}
