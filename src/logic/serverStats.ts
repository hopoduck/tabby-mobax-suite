// Pure, dependency-free stats logic: build the remote command, parse its output,
// and format values. No Angular/Tabby imports so the vitest suite stays runnable.

import { osIconSlug } from './osIcon';

export interface CpuSample {
  total: number;
  idle: number;
}

export interface MemUsage {
  usedBytes: number;
  totalBytes: number;
}

export interface DiskUsage {
  mount: string;
  usePct: number;
}

export interface ServerStats {
  ok: boolean;
  host: string | null;
  cpuPct: number | null;
  cpuSample: CpuSample | null;
  mem: MemUsage | null;
  uptimeSec: number | null;
  user: string | null;
  sessions: number | null;
  disks: DiskUsage[];
  /** simple-icons slug for the detected OS (see osIcon.ts), or null for fa-server fallback. */
  osId: string | null;
}

export type Severity = 'normal' | 'warn' | 'danger';

const MARKERS = ['@@HOST', '@@OS', '@@UP', '@@CPU', '@@MEM', '@@WHO', '@@DF'] as const;
type Marker = (typeof MARKERS)[number];

/** Single shell command whose output parseStats() consumes. Linux/procfs only. */
export function buildStatsCommand(): string {
  return [
    'echo "@@HOST"; hostname',
    // OS probe: os-release for the distro, plus a Synology hint (DSM's os-release is
    // unreliable, so flag it by the presence of its config files). osIconSlug() reads this.
    'echo "@@OS"; cat /etc/os-release 2>/dev/null; { [ -f /etc/synoinfo.conf ] || [ -f /etc.defaults/VERSION ]; } && echo "ID_SYNO=1"',
    'echo "@@UP"; cat /proc/uptime',
    'echo "@@CPU"; head -1 /proc/stat',
    'echo "@@MEM"; cat /proc/meminfo',
    'echo "@@WHO"; id -un; who | wc -l',
    'echo "@@DF"; df -P -k -x tmpfs -x devtmpfs -x overlay -x squashfs -x efivarfs',
    // Terminal sentinel: statsExec waits for this line so it never returns truncated output.
    'echo "@@END"',
  ].join('\n');
}

function splitSections(raw: string): Record<Marker, string[]> {
  const out: Record<Marker, string[]> = {
    '@@HOST': [],
    '@@OS': [],
    '@@UP': [],
    '@@CPU': [],
    '@@MEM': [],
    '@@WHO': [],
    '@@DF': [],
  };
  let current: Marker | null = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '@@END') {
      break;
    }
    if ((MARKERS as readonly string[]).includes(trimmed)) {
      current = trimmed as Marker;
      continue;
    }
    if (current) {
      out[current].push(line);
    }
  }
  return out;
}

function parseCpu(lines: string[]): CpuSample | null {
  const line = lines.find((l) => l.trim().startsWith('cpu'));
  if (!line) {
    return null;
  }
  const nums = line
    .trim()
    .split(/\s+/)
    .slice(1)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  if (nums.length < 5) {
    return null;
  }
  const total = nums.reduce((a, b) => a + b, 0);
  const idle = nums[3] + nums[4]; // idle + iowait
  return { total, idle };
}

function cpuPercent(prev: CpuSample | null, cur: CpuSample | null): number | null {
  if (!prev || !cur) {
    return null;
  }
  const dTotal = cur.total - prev.total;
  const dIdle = cur.idle - prev.idle;
  if (dTotal <= 0) {
    return null;
  }
  const pct = (1 - dIdle / dTotal) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function parseMem(lines: string[]): MemUsage | null {
  const get = (key: string): number | null => {
    const l = lines.find((x) => x.startsWith(key + ':'));
    if (!l) {
      return null;
    }
    const m = l.match(/(\d+)\s*kB/);
    return m ? Number(m[1]) * 1024 : null;
  };
  const totalBytes = get('MemTotal');
  const availBytes = get('MemAvailable');
  if (totalBytes == null || availBytes == null) {
    return null;
  }
  return { usedBytes: Math.max(0, totalBytes - availBytes), totalBytes };
}

function parseUptime(lines: string[]): number | null {
  const first = lines.map((l) => l.trim()).find((l) => l.length > 0);
  if (!first) {
    return null;
  }
  const sec = parseFloat(first.split(/\s+/)[0]);
  return Number.isFinite(sec) ? sec : null;
}

function parseWho(lines: string[]): { user: string | null; sessions: number | null } {
  const nonEmpty = lines.map((l) => l.trim()).filter((l) => l.length > 0);
  const user = nonEmpty[0] ?? null;
  const sessionsNum = nonEmpty[1] != null ? Number(nonEmpty[1]) : NaN;
  return { user, sessions: Number.isFinite(sessionsNum) ? sessionsNum : null };
}

function parseDf(lines: string[]): DiskUsage[] {
  const out: DiskUsage[] = [];
  // Same physical device shown under multiple mountpoints (e.g. Synology Btrfs exposes a
  // snapshot view of /volumeN at /volumeN/.../#snapshot, an exact df duplicate) is reported
  // once — keep the first row, drop later rows for an already-seen device.
  const seenDev = new Set<string>();
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('Filesystem')) {
      continue;
    }
    const cols = t.split(/\s+/);
    if (cols.length < 6) {
      continue;
    }
    const usePct = Number(cols[4].replace('%', ''));
    const mount = cols.slice(5).join(' ');
    if (!Number.isFinite(usePct)) {
      continue;
    }
    if (isPseudoMount(mount)) {
      continue;
    }
    const device = cols[0];
    if (seenDev.has(device)) {
      continue;
    }
    seenDev.add(device);
    out.push({ mount, usePct });
  }
  return out;
}

// Pseudo/virtual mounts (efivarfs, sysfs, /dev/shm, /run/...) carry no meaningful disk usage,
// so drop them like MobaXterm does. Real partitions mount at /, /boot, /boot/efi, /data, etc.
function isPseudoMount(mount: string): boolean {
  return /^\/(sys|proc|dev|run)(\/|$)/.test(mount);
}

export function parseStats(raw: string, prevCpu: CpuSample | null): ServerStats {
  const hasMarker = (MARKERS as readonly string[]).some((m) => raw.includes(m));
  if (!hasMarker) {
    return {
      ok: false,
      host: null,
      cpuPct: null,
      cpuSample: null,
      mem: null,
      uptimeSec: null,
      user: null,
      sessions: null,
      disks: [],
      osId: null,
    };
  }
  const s = splitSections(raw);
  const host = s['@@HOST'].map((l) => l.trim()).find((l) => l.length > 0) ?? null;
  const cpuSample = parseCpu(s['@@CPU']);
  const { user, sessions } = parseWho(s['@@WHO']);
  return {
    ok: true,
    host,
    cpuSample,
    cpuPct: cpuPercent(prevCpu, cpuSample),
    mem: parseMem(s['@@MEM']),
    uptimeSec: parseUptime(s['@@UP']),
    user,
    sessions,
    disks: parseDf(s['@@DF']),
    osId: osIconSlug(s['@@OS'].join('\n')),
  };
}

export function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d >= 1) {
    return `${d}d ${h}h`;
  }
  if (h >= 1) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
}

export function formatGB(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(2);
}

export function formatMemPair(mem: MemUsage): string {
  return `${formatGB(mem.usedBytes)} / ${formatGB(mem.totalBytes)} GB`;
}

export function memPercent(mem: MemUsage): number {
  if (mem.totalBytes <= 0) {
    return 0;
  }
  return Math.round((mem.usedBytes / mem.totalBytes) * 100);
}

export function severityOf(pct: number | null): Severity {
  if (pct == null) {
    return 'normal';
  }
  if (pct >= 90) {
    return 'danger';
  }
  if (pct >= 75) {
    return 'warn';
  }
  return 'normal';
}
