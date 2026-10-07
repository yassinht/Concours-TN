import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_PAGE_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = 'ConcoursTN-Watcher/1.0 (+https://concours.tn; official announcements monitor)';

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

/** Loopback, private, link-local, CGNAT, multicast and unspecified ranges (IPv4, IPv6 and IPv4-mapped IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPrivateAddress(mapped[1]);
    return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff');
  }
  return true;
}

/** Charset from the Content-Type header, else from <meta charset> / http-equiv (old ministry sites use windows-1256). */
export function detectCharset(contentType: string, head: Buffer): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const sniff = head.subarray(0, 4096).toString('latin1');
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(sniff)?.[1];
  return (fromMeta ?? 'utf-8').toLowerCase();
}

function decode(buf: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

export interface FetchedFile {
  url: string;
  contentType: string;
  buffer: Buffer;
}

interface GetOptions {
  accept: string;
  maxBytes: number;
  allowed: (contentType: string) => boolean;
}

/**
 * Fetches watched official pages and the announcements they link to. Admin-supplied URLs are fetched server-side, so
 * the fetcher refuses non-http(s) schemes and hosts resolving to internal addresses (re-checked on every redirect hop),
 * caps the body size and the whole request at 15 s.
 */
@Injectable()
export class PageFetcher {
  /** An HTML/text page, decoded with its declared charset (5 MB max). */
  async fetchPage(rawUrl: string): Promise<FetchedPage> {
    const f = await this.get(rawUrl, {
      accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
      maxBytes: MAX_PAGE_BYTES,
      allowed: (ct) => !ct || /text\/|html|xml/i.test(ct),
    });
    return { url: f.url, status: 200, contentType: f.contentType, body: decode(f.buffer, detectCharset(f.contentType, f.buffer)) };
  }

  /** A linked announcement (PDF, HTML or plain text), as raw bytes (20 MB max, like uploads). */
  async fetchDocument(rawUrl: string): Promise<FetchedFile> {
    return this.get(rawUrl, {
      accept: 'application/pdf,text/html;q=0.9,text/plain;q=0.8',
      maxBytes: MAX_DOCUMENT_BYTES,
      allowed: (ct) => !ct || /pdf|text\/|html/i.test(ct) || /octet-stream/i.test(ct),
    });
  }

  private async get(rawUrl: string, opts: GetOptions): Promise<FetchedFile> {
    let url = new URL(rawUrl);
    const deadline = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await this.assertPublic(url);
      const res = await fetch(url, {
        redirect: 'manual',
        signal: deadline,
        headers: { 'user-agent': USER_AGENT, accept: opts.accept, 'accept-language': 'ar,fr;q=0.9' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location')!, url);
        await res.body?.cancel();
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`HTTP ${res.status}`);
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (!opts.allowed(contentType)) {
        await res.body?.cancel();
        throw new Error(`UNSUPPORTED_CONTENT_TYPE ${contentType.split(';')[0]}`);
      }
      return { url: url.toString(), contentType, buffer: await this.readCapped(res, opts.maxBytes) };
    }
    throw new Error('TOO_MANY_REDIRECTS');
  }

  private async assertPublic(url: URL): Promise<void> {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('UNSUPPORTED_SCHEME');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
    if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error('BLOCKED_HOST');
  }

  private async readCapped(res: Response, maxBytes: number): Promise<Buffer> {
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > maxBytes) {
      await res.body?.cancel();
      throw new Error('TOO_LARGE');
    }
    if (!res.body) return Buffer.alloc(0);
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('TOO_LARGE');
      }
      parts.push(value);
    }
    return Buffer.concat(parts);
  }
}
