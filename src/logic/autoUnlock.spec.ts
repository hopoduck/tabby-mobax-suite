import { describe, it, expect } from 'vitest';
import { decideUnlock } from './autoUnlock';

describe('decideUnlock', () => {
  it('supplies when a passphrase is stored and nothing has failed', () => {
    expect(decideUnlock({ hasStored: true, lastFailed: false })).toBe('supply');
  });

  it('prompts when the stored passphrase previously failed', () => {
    expect(decideUnlock({ hasStored: true, lastFailed: true })).toBe('prompt');
  });

  it('prompts when nothing is stored', () => {
    expect(decideUnlock({ hasStored: false, lastFailed: false })).toBe('prompt');
    expect(decideUnlock({ hasStored: false, lastFailed: true })).toBe('prompt');
  });
});
