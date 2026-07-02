import { describe, it, expect } from 'vitest';
import { isBinaryName } from './openWith';

describe('isBinaryName', () => {
  it('classifies known binary extensions as binary', () => {
    expect(isBinaryName('photo.png')).toBe(true);
    expect(isBinaryName('archive.tar.gz')).toBe(true); // outermost extension decides
    expect(isBinaryName('report.hwp')).toBe(true);
    expect(isBinaryName('app.jar')).toBe(true);
    expect(isBinaryName('movie.mp4')).toBe(true);
    expect(isBinaryName('font.woff2')).toBe(true);
    expect(isBinaryName('data.sqlite')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isBinaryName('PHOTO.JPG')).toBe(true);
    expect(isBinaryName('Setup.EXE')).toBe(true);
  });

  it('treats non-listed extensions as text', () => {
    expect(isBinaryName('notes.txt')).toBe(false);
    expect(isBinaryName('nginx.conf')).toBe(false);
    expect(isBinaryName('script.py')).toBe(false); // scripts open in the editor, never execute
    expect(isBinaryName('run.bat')).toBe(false);
    expect(isBinaryName('image.svg')).toBe(false); // SVG is XML text
  });

  it('treats extensionless names and dotfiles as text', () => {
    expect(isBinaryName('Makefile')).toBe(false);
    expect(isBinaryName('.bashrc')).toBe(false);
    expect(isBinaryName('')).toBe(false);
    expect(isBinaryName('archive.')).toBe(false); // trailing dot = empty extension
  });
});
