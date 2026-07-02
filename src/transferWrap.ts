import { FileDownload, FileUpload } from 'tabby-core';

// Thrown by a wrapped transfer's write()/read() when a cancel was requested. A marker class so the
// caller reports "취소됨" instead of treating it as a failure. SFTPSession.download/upload catch it,
// release the remote side (upload also unlinks its <file>.tabby-upload temp), and rethrow.
export class CancelledError extends Error {
  constructor() {
    super('transfer cancelled');
    this.name = 'CancelledError';
  }
}

// The minimal hooks a wrapped transfer needs from the progress service: report transferred bytes and
// poll whether a cancel was requested. Angular-free so sftpOps can depend on it.
export interface ProgressSink {
  addBytes(n: number): void;
  isCancelRequested(): boolean;
}

// Wrap a platform FileDownload so each chunk reports bytes to `sink` and a pending cancel aborts by
// throwing. SFTPSession.download only calls write()/close()/cancel() on it.
export function wrapDownload(inner: FileDownload, sink: ProgressSink): FileDownload {
  return new DownloadWrap(inner, sink) as unknown as FileDownload;
}

// Wrap a platform FileUpload likewise. The caller reads getName() to build the remote path;
// SFTPSession.upload calls read()/close()/cancel().
export function wrapUpload(inner: FileUpload, sink: ProgressSink): FileUpload {
  return new UploadWrap(inner, sink) as unknown as FileUpload;
}

class DownloadWrap {
  constructor(
    private inner: FileDownload,
    private sink: ProgressSink,
  ) {}

  getName(): string {
    return this.inner.getName();
  }
  getMode(): number {
    return this.inner.getMode();
  }
  getSize(): number {
    return this.inner.getSize();
  }
  async write(buffer: Uint8Array): Promise<void> {
    if (this.sink.isCancelRequested()) {
      throw new CancelledError();
    }
    await this.inner.write(buffer);
    this.sink.addBytes(buffer.length);
  }
  close(): void {
    this.inner.close();
  }
  cancel(): void {
    this.inner.cancel();
  }
}

class UploadWrap {
  constructor(
    private inner: FileUpload,
    private sink: ProgressSink,
  ) {}

  getName(): string {
    return this.inner.getName();
  }
  getMode(): number {
    return this.inner.getMode();
  }
  getSize(): number {
    return this.inner.getSize();
  }
  async read(): Promise<Uint8Array> {
    if (this.sink.isCancelRequested()) {
      throw new CancelledError();
    }
    const chunk = await this.inner.read();
    this.sink.addBytes(chunk.length);
    return chunk;
  }
  close(): void {
    this.inner.close();
  }
  cancel(): void {
    this.inner.cancel();
  }
}
