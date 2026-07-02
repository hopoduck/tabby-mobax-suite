import { Injectable } from '@angular/core';
import * as http from 'http';
import { randomBytes } from 'crypto';
import type { AddressInfo } from 'net';
import { FileDownload, NotificationsService } from 'tabby-core';
import { SFTPSession } from 'tabby-ssh';
import { CancelledError, ProgressSink } from './transferWrap';
import { TransferService } from './services/transfer.service';

interface Ticket {
  sftp: SFTPSession;
  path: string;
  filename: string;
  size: number;
  started: boolean;
}

// A no-op ProgressSink for a drag-out that does NOT own the bottom strip (another transfer already
// does). It never reports cancel, so such a transfer streams to completion silently.
const NULL_SINK: ProgressSink = {
  addBytes: () => undefined,
  isCancelRequested: () => false,
};

/**
 * FileDownload that streams remote SFTP bytes straight to an HTTP response (drag-out). Mirrors
 * FsFileDownload but targets an `http.ServerResponse` instead of a local WriteStream:
 * `SFTPSession.download()` pushes chunks to `write()`, then calls `close()`; `cancel()` aborts.
 * Per-chunk `write()` resolves only once the chunk is flushed, which backpressures the SFTP read.
 */
class ResFileDownload {
  private readonly done: Promise<void>;

  constructor(
    private name: string,
    private size: number,
    private res: http.ServerResponse,
    private sink: ProgressSink,
  ) {
    this.done = new Promise<void>((resolve) => {
      this.res.on('finish', resolve); // all body bytes flushed to the socket
      this.res.on('close', resolve); // or the socket was torn down (cancel / error)
    });
  }

  getName(): string {
    return this.name;
  }

  getMode(): number {
    return 0;
  }

  getSize(): number {
    return this.size;
  }

  write(buffer: Uint8Array): Promise<void> {
    if (this.sink.isCancelRequested()) {
      return Promise.reject(new CancelledError());
    }
    return new Promise<void>((resolve, reject) => {
      this.res.write(buffer, (err) => {
        if (err) {
          reject(err);
        } else {
          this.sink.addBytes(buffer.length);
          resolve();
        }
      });
    });
  }

  close(): void {
    this.res.end();
  }

  cancel(): void {
    if (!this.res.destroyed) {
      this.res.destroy();
    }
  }

  /** Resolves once the response has fully flushed (or was aborted). */
  whenClosed(): Promise<void> {
    return this.done;
  }
}

/**
 * Localhost HTTP server that hands Chromium's DownloadURL drag-out machinery a one-shot URL per
 * dragged file and streams that file's bytes from SFTP at fetch time. One shared instance per plugin
 * (root singleton). See the plan's "Phase 0 RESULTS" for why this shape is mandatory:
 *
 * - The OS shows NO progress UI for DownloadURL drag-out, so we drive our own bottom strip
 *   (`TransferService`) from the request handler.
 * - Cancel needs a ONE-SHOT token: `res.destroy()` (how we abort) makes Chrome auto-retry the same
 *   URL several times; serving a token exactly once and refusing retries (404, no strip) makes a
 *   single cancel stick.
 *
 * Concurrent drag-outs are handled non-destructively here (only the first owns the strip; the rest
 * stream silently); the serial-queue UX (1/2) is a planned follow-up.
 */
@Injectable({ providedIn: 'root' })
export class DragOutServer {
  private server?: http.Server;
  private port = 0;
  private readonly tickets = new Map<string, Ticket>();
  private static readonly TICKET_TTL_MS = 60_000;

  constructor(
    private transfer: TransferService,
    private notifications: NotificationsService,
  ) {}

  /** Lazily bind the localhost server; returns the bound port. */
  async ensureStarted(): Promise<number> {
    if (this.server) {
      return this.port;
    }
    const server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    this.server = server;
    this.port = (server.address() as AddressInfo).port;
    return this.port;
  }

  /** Register a one-shot ticket for a file; returns its token (used by `urlFor`). */
  register(t: { sftp: SFTPSession; path: string; filename: string; size: number }): string {
    const token = randomBytes(16).toString('hex');
    this.tickets.set(token, { ...t, started: false });
    // Expire an unfetched ticket (drag dropped back inside / aborted / ended as an internal move) so
    // the map can't grow unbounded holding SFTP-session refs. A fetched ticket is already deleted by
    // then; deleting mid-stream is harmless (the handler holds its own ref) and only refuses late
    // retries — exactly the one-shot behaviour we want.
    setTimeout(() => this.tickets.delete(token), DragOutServer.TICKET_TTL_MS);
    return token;
  }

  /** True once the server is listening (so `urlFor` yields a usable port). Lets a synchronous
   * `dragstart` skip setting DownloadURL if the eager `ensureStarted()` hasn't bound yet. */
  get ready(): boolean {
    return this.port > 0;
  }

  urlFor(token: string): string {
    return `http://127.0.0.1:${this.port}/dl/${token}`;
  }

  dispose(): void {
    this.server?.close();
    this.server = undefined;
    this.tickets.clear();
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const m = /^\/dl\/([a-f0-9]{32})$/.exec(req.url ?? '');
    const token = m ? m[1] : undefined;
    const ticket = token ? this.tickets.get(token) : undefined;
    // One-shot gate: a missing or already-served token is refused with no strip. This defeats
    // Chrome's auto-retry-on-cancel, which re-requests the same URL and would otherwise restart the
    // transfer (the strip kept reappearing until we added this — see Phase 0 RESULTS #4).
    if (!token || !ticket || ticket.started) {
      res.statusCode = 404;
      res.end();
      return;
    }
    ticket.started = true;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(ticket.size));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(ticket.filename)}`,
    );

    // Drive the bottom strip only when nothing else owns it (mirrors editLocally's showProgress) — a
    // concurrent toolbar transfer or another drag-out keeps its own progress; this one still streams.
    const showProgress = !this.transfer.state.active;
    const sink: ProgressSink = showProgress ? this.transfer : NULL_SINK;
    if (showProgress) {
      this.transfer.start('download', 1);
      this.transfer.setCurrent(ticket.filename, ticket.size);
    }

    const dl = new ResFileDownload(ticket.filename, ticket.size, res, sink);
    try {
      await ticket.sftp.download(ticket.path, dl as unknown as FileDownload);
      await dl.whenClosed();
      if (showProgress) {
        this.transfer.completeFile();
      }
    } catch (err) {
      // Cancel (CancelledError) or a mid-stream SFTP error: abort the HTTP download so the OS stops.
      if (!res.destroyed) {
        res.destroy();
      }
      // A user cancel is intentional (no toast); a real read error is surfaced.
      if (!(err instanceof CancelledError)) {
        this.notifications.error(
          '드래그 내보내기 실패',
          String((err as Error)?.message ?? err),
        );
      }
    } finally {
      if (showProgress) {
        this.transfer.finish();
      }
      this.tickets.delete(token);
    }
  }
}
