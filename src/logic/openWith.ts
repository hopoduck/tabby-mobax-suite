/**
 * MobaXterm-style open policy: a filename whose extension is on the known-binary list opens
 * via the OS file association; everything else (extensionless names, dotfiles, scripts, SVG)
 * opens in the configured text editor. Extension matching only — no content sniffing.
 */
const BINARY_EXTENSIONS = new Set([
  // images
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'tif', 'tiff', 'heic', 'avif',
  // media
  'mp3', 'mp4', 'm4a', 'avi', 'mkv', 'mov', 'wav', 'flac', 'ogg', 'webm', 'wmv',
  // archives
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz', 'zst', '7z', 'rar',
  // documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'hwp', 'hwpx', 'odt', 'ods', 'odp',
  // executables / compiled objects
  'exe', 'dll', 'msi', 'com', 'so', 'dylib', 'bin', 'iso', 'img', 'dmg', 'deb', 'rpm',
  'apk', 'jar', 'class', 'o', 'obj', 'pyc', 'wasm',
  // fonts
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  // opaque data blobs
  'sqlite', 'db', 'mdb',
]);

/** True when the filename's (outermost, case-insensitive) extension marks a known-binary file. */
export function isBinaryName(filename: string): boolean {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) {
    return false; // no extension, dotfile (".bashrc"), or trailing dot → text
  }
  return BINARY_EXTENSIONS.has(filename.slice(dot + 1).toLowerCase());
}
