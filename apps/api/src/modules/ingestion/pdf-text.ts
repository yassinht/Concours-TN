import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import type { PageText } from './text.util';

export interface PdfPages {
  pageCount: number;
  /** One entry per page (1-based), empty string for pages without a text layer. */
  pages: PageText[];
}

/**
 * Text layer of a PDF, page by page. pdf-parse calls `pagerender` for each page in order; we keep each page's text in
 * a map keyed by its page number so chunks keep exact page references (needed for source quotes).
 * Lines are rebuilt from the text items' vertical position, as pdf-parse's default renderer does.
 */
export async function extractPdfPages(buffer: Buffer): Promise<PdfPages> {
  const byPage = new Map<number, string>();
  let rendered = 0;
  // pdf.js reads the whole underlying ArrayBuffer and ignores byteOffset; small Node Buffers are slices of a shared
  // pool, so hand it a tightly-sized copy or it parses unrelated bytes.
  const result = await pdfParse(new Uint8Array(buffer), {
    pagerender: async (page) => {
      rendered++;
      const pageNo = page.pageNumber ?? (typeof page.pageIndex === 'number' ? page.pageIndex + 1 : rendered);
      const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
      let lastY: number | undefined;
      let text = '';
      for (const item of content.items) {
        const y = item.transform[5];
        text += lastY === undefined || lastY === y ? item.str : `\n${item.str}`;
        lastY = y;
      }
      byPage.set(pageNo, text);
      return `${text}\f`;
    },
  });
  const pageCount = result.numpages || byPage.size;
  const pages: PageText[] = [];
  for (let p = 1; p <= pageCount; p++) pages.push({ page: p, text: (byPage.get(p) ?? '').trim() });
  return { pageCount, pages };
}

/** A page "has text" when it carries a meaningful amount of letters/digits (scans often hold a few stray glyphs). */
export function meaningfulChars(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}
