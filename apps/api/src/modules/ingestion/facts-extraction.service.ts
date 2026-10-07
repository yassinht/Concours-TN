import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { AiExtractInput } from '@ctn/shared';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { aiJobs, competitionFamilies } from '../../db/schema';
import { AiService } from '../ai/ai.service';
import { toJobDTO, type AiJobDTO } from './ai-jobs.service';
import { DocumentsService } from './documents.service';
import {
  EXTRACT_PROMPT_VERSION, EXTRACT_SCHEMA_HINT, HEURISTIC_VERSION, countItems, extractSystemPrompt, extractUserPrompt, finalizeProposal,
  heuristicExtract, normalizeAiProposal, type FactsBody,
} from './extraction';
import { sha256, splitPages, type PageText } from './text.util';

type ExtractInput = z.infer<typeof AiExtractInput>;

const AI_EXTRACT_MAX_TOKENS = 12_000;

/**
 * POST /admin/ai/extract — turns an announcement into a DRAFT facts proposal (editions, eligibility, phases, subjects,
 * required documents), each item with a verbatim source quote and a page. The proposal is stored in ai_jobs only:
 * nothing is written to catalog tables, an editor applies it through the admin endpoints after checking the quotes.
 */
@Injectable()
export class FactsExtractionService {
  private readonly logger = new Logger('FactsExtraction');

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly ai: AiService,
    private readonly documents: DocumentsService,
  ) {}

  async extract(input: ExtractInput, actorId: string): Promise<AiJobDTO> {
    if (!input.documentId && !input.text?.trim()) throw new BadRequestException('DOCUMENT_OR_TEXT_REQUIRED');

    let family: { slug: string; nameAr: string; nameFr: string } | null = null;
    if (input.familySlug) {
      const [f] = await this.db
        .select({ slug: competitionFamilies.slug, nameAr: competitionFamilies.nameAr, nameFr: competitionFamilies.nameFr })
        .from(competitionFamilies)
        .where(eq(competitionFamilies.slug, input.familySlug))
        .limit(1);
      if (!f) throw new NotFoundException('FAMILY_NOT_FOUND');
      family = f;
    }

    let pages: PageText[];
    if (input.documentId) {
      const doc = await this.documents.pagesOf(input.documentId);
      if (!doc.pages.length) throw new BadRequestException(doc.ocrStatus === 'NEEDS_OCR' ? 'DOCUMENT_NEEDS_OCR' : 'DOCUMENT_HAS_NO_TEXT');
      pages = doc.pages;
    } else {
      pages = splitPages(input.text ?? '');
    }
    const fullText = pages.map((p) => p.text).join('\f');

    const warnings: string[] = [];
    let body: FactsBody | null = null;
    let method: 'AI' | 'HEURISTIC' = 'HEURISTIC';
    let model: string | null = null;
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;

    if (this.ai.enabled) {
      try {
        const { prompt, truncated } = extractUserPrompt(pages, family);
        if (truncated) warnings.push('TEXT_TRUNCATED: the document was too long, only its beginning was analysed by AI.');
        const r = await this.ai.json<unknown>({
          model: 'content', system: extractSystemPrompt(), prompt, schemaHint: EXTRACT_SCHEMA_HINT, maxTokens: AI_EXTRACT_MAX_TOKENS,
        });
        const norm = normalizeAiProposal(r.data, pages);
        body = norm.body;
        method = 'AI';
        model = r.model;
        tokensIn = r.tokensIn;
        tokensOut = r.tokensOut;
        if (norm.stats.dropped) warnings.push(`QUOTE_MISSING: ${norm.stats.dropped} item(s) without a source quote were discarded.`);
        if (norm.stats.unverified) warnings.push(`QUOTE_NOT_FOUND: ${norm.stats.unverified} quote(s) were not found verbatim in the text (quote_verified=false) — check them first.`);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        this.logger.warn(`AI extraction failed, using the heuristic extractor: ${reason}`);
        warnings.push(`AI_FAILED: ${reason.slice(0, 200)} — heuristic extraction used instead.`);
      }
    }
    if (!body) body = heuristicExtract(pages);
    if (countItems(body) === 0) warnings.push('NOTHING_FOUND: no fact could be extracted from this text.');
    warnings.push('DRAFT: every item must be checked against the source before it is applied; applied facts stay "needs verification" until a reviewer confirms them.');

    const proposal = finalizeProposal(body, { method, familySlug: family?.slug ?? null, documentId: input.documentId ?? null, warnings });
    const [job] = await this.db.insert(aiJobs).values({
      kind: 'EXTRACT_FACTS',
      status: 'DONE',
      input: {
        documentId: input.documentId ?? null,
        familySlug: family?.slug ?? null,
        textSha256: sha256(fullText),
        textLength: fullText.length,
        pages: pages.length,
      },
      output: proposal,
      model,
      promptVersion: method === 'AI' ? EXTRACT_PROMPT_VERSION : HEURISTIC_VERSION,
      tokensIn,
      tokensOut,
      createdBy: actorId,
      finishedAt: new Date(),
    }).returning();
    return toJobDTO(job);
  }
}
