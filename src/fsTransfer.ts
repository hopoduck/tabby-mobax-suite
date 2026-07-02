import {
  createWriteStream,
  closeSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
  WriteStream,
} from 'fs';
import { join as joinLocal } from 'path';
import { ProgressSink, CancelledError } from './transferWrap';

const CHUNK = 256 * 1024;

/**
 * FileDownload that streams remote bytes to an arbitrary local path (no save dialog).
 * SFTPSession.download() only calls write() / close() / cancel(). Generalises the former
 * TempFileDownload (which targeted an OS temp file). The CALLER owns the local path, so deleting a
 * partial file on cancel/error is the caller's job.
 */
export class FsFileDownload {
  private stream: WriteStream;
  private done: Promise<void>;

  constructor(
    private name: string,
    private mode: number,
    private size: number,
    localPath: string,
    private sink?: ProgressSink,
  ) {
    this.stream = createWriteStream(localPath);
    this.done = new Promise<void>((resolve, reject) => {
      this.stream.on('close', () => resolve());
      this.stream.on('error', reject);
    });
  }

  getName(): string {
    return this.name;
  }

  getMode(): number {
    return this.mode;
  }

  getSize(): number {
    return this.size;
  }

  write(buffer: Uint8Array): Promise<void> {
    if (this.sink?.isCancelRequested()) {
      return Promise.reject(new CancelledError());
    }
    return new Promise<void>((resolve, reject) => {
      this.stream.write(buffer, (err) => {
        if (err) {
          reject(err);
        } else {
          this.sink?.addBytes(buffer.length);
          resolve();
        }
      });
    });
  }

  close(): void {
    this.stream.end();
  }

  cancel(): void {
    this.stream.destroy();
  }

  /** Resolves once the write stream has fully flushed to disk. */
  whenClosed(): Promise<void> {
    return this.done;
  }
}

/**
 * FileUpload that streams a local file to the remote.
 * SFTPSession.upload() calls read() until it returns an empty array (EOF), then close(); on failure
 * it calls cancel(). Generalises the former TempFileUpload. Cancel/progress for folder uploads is
 * added by wrapping this with transferWrap.wrapUpload().
 */
export class FsFileUpload {
  private fd: number | null = null;
  private offset = 0;
  private buf = Buffer.allocUnsafe(CHUNK);
  private size: number;

  constructor(
    private name: string,
    private mode: number,
    private localPath: string,
  ) {
    this.size = statSync(localPath).size;
  }

  getName(): string {
    return this.name;
  }

  getMode(): number {
    return this.mode;
  }

  getSize(): number {
    return this.size;
  }

  async read(): Promise<Uint8Array> {
    if (this.fd === null) {
      this.fd = openSync(this.localPath, 'r');
    }
    const bytes = readSync(this.fd, this.buf, 0, CHUNK, this.offset);
    if (bytes <= 0) {
      return new Uint8Array(0);
    }
    this.offset += bytes;
    return new Uint8Array(this.buf.subarray(0, bytes)); // copy out (buf is reused)
  }

  close(): void {
    if (this.fd !== null) {
      closeSync(this.fd);
      this.fd = null;
    }
  }

  cancel(): void {
    this.close();
  }
}

export interface LocalWalkFile {
  path: string; // absolute local path
  size: number;
}

export interface LocalWalkResult {
  dirs: string[]; // absolute local dir paths, INCLUDING root, pre-order (parent before children)
  files: LocalWalkFile[];
  skippedSymlinks: number;
}

/**
 * Recursively walk a local directory (the upload source). Returns `root` plus every sub-directory in
 * pre-order (a parent always precedes its children — required because SFTP mkdir is non-recursive),
 * and every regular file with its size. Symlinks are skipped (avoids cycles) and counted.
 */
export function walkLocalDir(root: string): LocalWalkResult {
  const dirs: string[] = [root];
  const files: LocalWalkFile[] = [];
  let skippedSymlinks = 0;
  const visit = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = joinLocal(dir, ent.name);
      if (ent.isSymbolicLink()) {
        skippedSymlinks++;
      } else if (ent.isDirectory()) {
        dirs.push(full);
        visit(full);
      } else if (ent.isFile()) {
        files.push({ path: full, size: statSync(full).size });
      }
    }
  };
  visit(root);
  return { dirs, files, skippedSymlinks };
}
