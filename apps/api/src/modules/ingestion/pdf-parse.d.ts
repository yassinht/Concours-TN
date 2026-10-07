/**
 * Local typing for pdf-parse 1.1.1. We import `pdf-parse/lib/pdf-parse.js` directly: the package entry point runs a
 * debug harness (reads a sample PDF from disk) when it believes it is the main module.
 */
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfTextItem {
    str: string;
    transform: number[];
  }
  interface PdfPageProxy {
    pageNumber?: number;
    pageIndex?: number;
    getTextContent(opts?: { normalizeWhitespace?: boolean; disableCombineTextItems?: boolean }): Promise<{ items: PdfTextItem[] }>;
  }
  interface PdfParseOptions {
    pagerender?: (page: PdfPageProxy) => Promise<string>;
    max?: number;
    version?: string;
  }
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    text: string;
    version: string | null;
  }
  function pdfParse(data: Buffer | Uint8Array, options?: PdfParseOptions): Promise<PdfParseResult>;
  export = pdfParse;
}
