// Pure, dependency-free logic for SFTP drag-out. No Tabby/Electron/Node imports.

const MIME_BY_EXT: Record<string, string> = {
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  js: 'text/javascript',
  ts: 'text/plain',
  css: 'text/css',
  sh: 'text/x-shellscript',
  conf: 'text/plain',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

export function mimeForName(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) {
    return 'application/octet-stream';
  }
  const ext = name.slice(dot + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

// Chromium DownloadURL dataTransfer format: "<mime>:<filename>:<absolute-url>".
export function buildDownloadUrl(filename: string, url: string, mime?: string): string {
  return `${mime ?? mimeForName(filename)}:${filename}:${url}`;
}
