import { describe, it, expect } from 'vitest';
import {
  buildStatsCommand,
  parseStats,
  formatUptime,
  formatGB,
  formatMemPair,
  memPercent,
  severityOf,
} from './serverStats';

const RAW = [
  '@@HOST',
  'myhost',
  '@@UP',
  '123456.78 987654.32',
  '@@CPU',
  'cpu  100 0 50 1000 20 0 5 0 0 0',
  '@@MEM',
  'MemTotal:       263168000 kB',
  'MemFree:          1000000 kB',
  'MemAvailable:   131584000 kB',
  '@@WHO',
  'e7works',
  '5',
  '@@DF',
  'Filesystem     1024-blocks      Used Available Capacity Mounted on',
  '/dev/sda1        263192304 209340000  53852304      85% /',
  '/dev/sda2          1000000    480000    520000      48% /boot',
  '/dev/sda3        500000000 240000000 260000000      48% /data',
  '',
].join('\n');

describe('buildStatsCommand', () => {
  it('includes every section marker', () => {
    const cmd = buildStatsCommand();
    for (const m of ['@@HOST', '@@OS', '@@UP', '@@CPU', '@@MEM', '@@WHO', '@@DF']) {
      expect(cmd).toContain(m);
    }
  });

  it('emits the @@END completion sentinel as the last line', () => {
    expect(buildStatsCommand().trimEnd().endsWith('echo "@@END"')).toBe(true);
  });
});

describe('parseStats', () => {
  it('parses host, mem, uptime, user, sessions, disks from a realistic blob', () => {
    const s = parseStats(RAW, null);
    expect(s.ok).toBe(true);
    expect(s.host).toBe('myhost');
    expect(s.uptimeSec).toBeCloseTo(123456.78, 2);
    expect(s.user).toBe('e7works');
    expect(s.sessions).toBe(5);
    expect(s.mem).toEqual({
      usedBytes: 131584000 * 1024,
      totalBytes: 263168000 * 1024,
    });
    expect(s.disks).toEqual([
      { mount: '/', usePct: 85 },
      { mount: '/boot', usePct: 48 },
      { mount: '/data', usePct: 48 },
    ]);
  });

  it('returns the raw cpu sample but null cpuPct when there is no previous sample', () => {
    const s = parseStats(RAW, null);
    expect(s.cpuSample).toEqual({ total: 1175, idle: 1020 });
    expect(s.cpuPct).toBeNull();
  });

  it('computes cpuPct from the delta against the previous sample', () => {
    const s = parseStats(RAW, { total: 1075, idle: 960 });
    // dTotal = 100, dIdle = 60 -> (1 - 0.6) * 100 = 40
    expect(s.cpuPct).toBe(40);
  });

  it('marks ok=false for output without any markers', () => {
    const s = parseStats('totally unrelated text', null);
    expect(s.ok).toBe(false);
    expect(s.disks).toEqual([]);
  });

  it('excludes pseudo filesystems (efivarfs, /sys, /dev/shm) but keeps /boot/efi', () => {
    const raw = [
      '@@DF',
      'Filesystem     1024-blocks      Used Available Capacity Mounted on',
      '/dev/sda1        100 85 15      85% /',
      '/dev/sda2        100 48 52      48% /boot/efi',
      'efivarfs              4  3  1      75% /sys/firmware/efi/efivars',
      'tmpfs               100  1 99       1% /dev/shm',
      '@@END',
    ].join('\n');
    expect(parseStats(raw, null).disks).toEqual([
      { mount: '/', usePct: 85 },
      { mount: '/boot/efi', usePct: 48 },
    ]);
  });

  it('drops duplicate-device rows (Synology Btrfs snapshot mount of the same filesystem)', () => {
    const raw = [
      '@@DF',
      'Filesystem     1024-blocks       Used  Available Capacity Mounted on',
      '/dev/md0           2385528    1560496     706248      69% /',
      '/dev/vg1000/lv   229791500   21153384  208638116      10% /volume2',
      '/dev/md3        1870744844  717183616 1153561228      39% /volume1',
      '/dev/md2        7496836364 7203854252  292982112      97% /volume3',
      '/dev/md2        7496836364 7203854252  292982112      97% /volume3/web/#snapshot',
      '@@END',
    ].join('\n');
    expect(parseStats(raw, null).disks).toEqual([
      { mount: '/', usePct: 69 },
      { mount: '/volume2', usePct: 10 },
      { mount: '/volume1', usePct: 39 },
      { mount: '/volume3', usePct: 97 },
    ]);
  });

  it('ignores the @@END sentinel (and anything after it) without polluting disks', () => {
    const s = parseStats(RAW + '@@END\nsome trailing noise\n', null);
    expect(s.disks).toEqual([
      { mount: '/', usePct: 85 },
      { mount: '/boot', usePct: 48 },
      { mount: '/data', usePct: 48 },
    ]);
  });
});

describe('formatters', () => {
  it('formatUptime renders days/hours/minutes', () => {
    expect(formatUptime(0)).toBe('0m');
    expect(formatUptime(3661)).toBe('1h 1m');
    expect(formatUptime(123456.78)).toBe('1d 10h');
  });

  it('formatGB and formatMemPair render gigabytes with 2 decimals', () => {
    expect(formatGB(2 * 1024 ** 3)).toBe('2.00');
    expect(formatMemPair({ usedBytes: 1024 ** 3, totalBytes: 2 * 1024 ** 3 })).toBe(
      '1.00 / 2.00 GB',
    );
  });

  it('memPercent rounds used/total to a percentage', () => {
    expect(memPercent({ usedBytes: 131584000, totalBytes: 263168000 })).toBe(50);
    expect(memPercent({ usedBytes: 0, totalBytes: 0 })).toBe(0);
  });

  it('severityOf bands at 75 and 90', () => {
    expect(severityOf(null)).toBe('normal');
    expect(severityOf(74)).toBe('normal');
    expect(severityOf(75)).toBe('warn');
    expect(severityOf(89)).toBe('warn');
    expect(severityOf(90)).toBe('danger');
  });
});
