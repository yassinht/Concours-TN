import { BadRequestException, Injectable, Logger, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { asc, count, desc, eq, sql } from 'drizzle-orm';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AuditService } from '../../common/audit.service';
import { env } from '../../config/env';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { sourceChunks, sourceDocuments, sources } from '../../db/schema';
import { extractPdfPages, meaningfulChars } from './pdf-text';
import { chunkPage, detectLanguage, htmlToText, sha256, splitPages, type PageText } from './text.util';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** Below this many letters/digits in the whole PDF, the text layer is considered absent (scanned document). */
const MIN_TEXT_LAYER_CHARS = 30;

/** Minimal shape of an uploaded file (multer memory storage). */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

type Kind = { ext: 'pdf'; mime: 'application/pdf' } | { ext: 'txt'; mime: 'text/plain' } | { ext: 'html'; mime: 'text/html' };

export interface DocumentSummaryDTO {
  id: string;
  filename: string | null;
  mime: string;
  sha256: string;
  pageCount: number | null;
  language: string | null;
  /** TEXT_LAYER (text extracted) | NEEDS_OCR (scanned PDF, no text layer — OCR is not part of V1) */
  ocrStatus: string;
  source: { id: string; title: string; url: string | null } | null;
  uploadedBy: string | null;
  createdAt: string;
  chunkCount: number;
}

export interface DocumentDetailDTO extends DocumentSummaryDTO {
  textLength: number;
  chunks: { id: string; page: number; chunkIndex: number; text: string }[];
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Official documents (avis de concours, programmes, past papers): stored once by content hash, text layer extracted
 * page by page and split into chunks that keep their page number, so every extracted fact can cite "page N".
 *
 * OCR is out of scope for V1: a PDF without a text layer is stored with ocr_status NEEDS_OCR and no chunks; an editor
 * can paste the text into POST /admin/ai/extract instead.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger('DocumentsService');

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async upload(file: UploadedFileLike | undefined, sourceId: string | null, actorId: string): Promise<{ duplicate: boolean; document: DocumentDetailDTO }> {
    if (!file || !file.buffer?.length) throw new BadRequestException('FILE_REQUIRED');
    if (file.size > MAX_UPLOAD_BYTES || file.buffer.length > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException('FILE_TOO_LARGE');
    const kind = this.detectKind(file);

    if (sourceId) {
      const [src] = await this.db.select({ id: sources.id }).from(sources).where(eq(sources.id, sourceId)).limit(1);
      if (!src) throw new BadRequestException('SOURCE_NOT_FOUND');
    }

    const hash = sha256(file.buffer);
    const existing = await this.findIdBySha(hash);
    if (existing) return { duplicate: true, document: await this.detail(existing) };

    const { pages, pageCount, ocrStatus } = await this.extract(kind, file.buffer);
    const storageKey = `${hash}.${kind.ext}`;
    const dir = resolve(env().UPLOAD_DIR);
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, storageKey), file.buffer);

    const fullText = pages.map((p) => p.text).join('\f');
    const filename = sanitizeFilename(file.originalname);
    let documentId: string;
    try {
      documentId = await this.db.transaction(async (tx) => {
        const [doc] = await tx.insert(sourceDocuments).values({
          sourceId, storageKey, filename, sha256: hash, mime: kind.mime, pageCount, language: detectLanguage(fullText),
          ocrStatus, extractedText: fullText || null, uploadedBy: actorId,
        }).returning({ id: sourceDocuments.id });
        const rows: { documentId: string; page: number; chunkIndex: number; text: string }[] = [];
        let index = 0;
        for (const p of pages) for (const text of chunkPage(p.text)) rows.push({ documentId: doc.id, page: p.page, chunkIndex: index++, text });
        for (let i = 0; i < rows.length; i += 500) await tx.insert(sourceChunks).values(rows.slice(i, i + 500));
        return doc.id;
      });
    } catch (e) {
      // Same file uploaded concurrently: the unique index on sha256 decides, the loser returns the winner's row.
      const winner = await this.findIdBySha(hash);
      if (winner) return { duplicate: true, document: await this.detail(winner) };
      throw e;
    }
    await this.audit.log(actorId, 'document.upload', 'source_document', documentId, { filename, sha256: hash, pageCount, ocrStatus });
    this.logger.log(`Stored document ${documentId} (${kind.mime}, ${pageCount} page(s), ${ocrStatus})`);
    return { duplicate: false, document: await this.detail(documentId) };
  }

  async list(limit: number, offset: number): Promise<{ items: DocumentSummaryDTO[]; total: number }> {
    const rows = await this.db
      .select({
        doc: sourceDocuments,
        sourceTitle: sources.title,
        sourceUrl: sources.url,
        chunkCount: sql<number>`(select count(*) from source_chunks c where c.document_id = "source_documents"."id")::int`,
      })
      .from(sourceDocuments)
      .leftJoin(sources, eq(sources.id, sourceDocuments.sourceId))
      .orderBy(desc(sourceDocuments.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db.select({ total: count() }).from(sourceDocuments);
    return { items: rows.map((r) => toSummary(r.doc, r.sourceTitle, r.sourceUrl, r.chunkCount)), total };
  }

  async detail(id: string): Promise<DocumentDetailDTO> {
    const [row] = await this.db
      .select({ doc: sourceDocuments, sourceTitle: sources.title, sourceUrl: sources.url })
      .from(sourceDocuments)
      .leftJoin(sources, eq(sources.id, sourceDocuments.sourceId))
      .where(eq(sourceDocuments.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('NOT_FOUND');
    const chunks = await this.db
      .select({ id: sourceChunks.id, page: sourceChunks.page, chunkIndex: sourceChunks.chunkIndex, text: sourceChunks.text })
      .from(sourceChunks)
      .where(eq(sourceChunks.documentId, id))
      .orderBy(asc(sourceChunks.page), asc(sourceChunks.chunkIndex));
    return {
      ...toSummary(row.doc, row.sourceTitle, row.sourceUrl, chunks.length),
      textLength: row.doc.extractedText?.length ?? 0,
      chunks,
    };
  }

  /** Pages of a stored document rebuilt from its chunks (used by fact extraction). */
  async pagesOf(id: string): Promise<{ pages: PageText[]; ocrStatus: string }> {
    const [doc] = await this.db.select({ ocrStatus: sourceDocuments.ocrStatus }).from(sourceDocuments).where(eq(sourceDocuments.id, id)).limit(1);
    if (!doc) throw new NotFoundException('DOCUMENT_NOT_FOUND');
    const chunks = await this.db
      .select({ page: sourceChunks.page, text: sourceChunks.text })
      .from(sourceChunks)
      .where(eq(sourceChunks.documentId, id))
      .orderBy(asc(sourceChunks.page), asc(sourceChunks.chunkIndex));
    const byPage = new Map<number, string[]>();
    for (const c of chunks) byPage.set(c.page, [...(byPage.get(c.page) ?? []), c.text]);
    return { pages: [...byPage.entries()].map(([page, texts]) => ({ page, text: texts.join('\n') })), ocrStatus: doc.ocrStatus };
  }

  private async findIdBySha(hash: string): Promise<string | null> {
    const [row] = await this.db.select({ id: sourceDocuments.id }).from(sourceDocuments).where(eq(sourceDocuments.sha256, hash)).limit(1);
    return row?.id ?? null;
  }

  /** Trusts the bytes, not the client-supplied mime type: "%PDF-" magic for PDFs, valid UTF-8 for text/HTML. */
  private detectKind(file: UploadedFileLike): Kind {
    const head = file.buffer.subarray(0, 1024).toString('latin1');
    const name = file.originalname.toLowerCase();
    if (head.startsWith('%PDF-')) return { ext: 'pdf', mime: 'application/pdf' };
    const textualMime = file.mimetype.startsWith('text/');
    // A declared text type wins over the name (official sites serve HTML notices under ".pdf" links).
    if (!textualMime && (file.mimetype === 'application/pdf' || name.endsWith('.pdf'))) throw new BadRequestException('INVALID_PDF');
    const textual = textualMime || /\.(txt|html?|text)$/.test(name);
    if (!textual) throw new BadRequestException('UNSUPPORTED_FILE_TYPE');
    try {
      UTF8.decode(file.buffer);
    } catch {
      throw new BadRequestException('TEXT_MUST_BE_UTF8');
    }
    const looksHtml = file.mimetype === 'text/html' || /\.html?$/.test(name) || /<(html|body|p|div|table)\b/i.test(head);
    return looksHtml ? { ext: 'html', mime: 'text/html' } : { ext: 'txt', mime: 'text/plain' };
  }

  private async extract(kind: Kind, buffer: Buffer): Promise<{ pages: PageText[]; pageCount: number; ocrStatus: 'TEXT_LAYER' | 'NEEDS_OCR' }> {
    if (kind.ext === 'pdf') {
      let parsed: Awaited<ReturnType<typeof extractPdfPages>>;
      try {
        parsed = await extractPdfPages(buffer);
      } catch (e) {
        this.logger.warn(`PDF parsing failed: ${(e as Error).message}`);
        throw new BadRequestException('INVALID_PDF');
      }
      const chars = parsed.pages.reduce((n, p) => n + meaningfulChars(p.text), 0);
      if (chars < MIN_TEXT_LAYER_CHARS) return { pages: [], pageCount: parsed.pageCount, ocrStatus: 'NEEDS_OCR' };
      return { pages: parsed.pages, pageCount: parsed.pageCount, ocrStatus: 'TEXT_LAYER' };
    }
    const raw = buffer.toString('utf8').replace(/^﻿/, '');
    const text = kind.ext === 'html' ? htmlToText(raw) : raw;
    const pages = splitPages(text);
    if (!pages.length) throw new BadRequestException('EMPTY_FILE');
    return { pages, pageCount: Math.max(1, text.split('\f').length), ocrStatus: 'TEXT_LAYER' };
  }
}

function toSummary(doc: typeof sourceDocuments.$inferSelect, sourceTitle: string | null, sourceUrl: string | null, chunkCount: number): DocumentSummaryDTO {
  return {
    id: doc.id,
    filename: doc.filename,
    mime: doc.mime,
    sha256: doc.sha256,
    pageCount: doc.pageCount,
    language: doc.language,
    ocrStatus: doc.ocrStatus,
    source: doc.sourceId && sourceTitle ? { id: doc.sourceId, title: sourceTitle, url: sourceUrl } : null,
    uploadedBy: doc.uploadedBy,
    createdAt: doc.createdAt.toISOString(),
    chunkCount: Number(chunkCount),
  };
}

/** Display name only (never used as a path): basename, control characters stripped, bounded length. */
export function sanitizeFilename(name: string | undefined): string | null {
  if (!name) return null;
  // multer decodes the multipart filename as latin1; re-decode so Arabic file names survive.
  let decoded = name;
  try {
    const utf8 = Buffer.from(name, 'latin1').toString('utf8');
    if (!utf8.includes('�')) decoded = utf8;
  } catch {
    // keep the original
  }
  const base = decoded.split(/[\\/]/).pop() ?? decoded;
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return clean || null;
}
