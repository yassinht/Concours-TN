import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { EDITION_STATUSES, EligibilityInput, FIELDS } from '@ctn/shared';
import { readSession } from '../../common/session';
import { ZodPipe } from '../../common/zod.pipe';
import { env } from '../../config/env';
import { CatalogService } from './catalog.service';
import { toCandidateProfile } from './catalog.util';
import { editionsToIcs } from './ics';
import { SyllabusService } from './syllabus.service';

const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);
const opt = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(blankToUndefined, schema.optional());
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const csv = (v: unknown) => {
  const parts = (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).flatMap((s) => String(s).split(','));
  const list = parts.map((s) => s.trim().toUpperCase()).filter(Boolean);
  return list.length ? list : undefined;
};

const FamiliesQuery = z.object({ field: opt(z.enum(FIELDS)), q: opt(z.string().max(100)) });
const EditionsQuery = z.object({
  status: z.preprocess(csv, z.array(z.enum(EDITION_STATUSES)).optional()),
  from: opt(isoDate),
  to: opt(isoDate),
  familySlug: opt(z.string().max(80)),
  field: opt(z.enum(FIELDS)),
});
const LessonsQuery = z.object({ lang: opt(z.enum(['ar', 'fr', 'en'])) });
const SearchQuery = z.object({ q: opt(z.string().max(100)) });
/** Extra (not in the base contract): scan every family against a profile — "which concours can I apply to?". */
const EligibilityScanInput = z.object({
  profile: EligibilityInput.shape.profile,
  field: z.enum(FIELDS).optional(),
  upcomingOnly: z.boolean().optional(),
});

type FamiliesQuery = z.infer<typeof FamiliesQuery>;
type EditionsQuery = z.infer<typeof EditionsQuery>;

/** Anonymous responses are cacheable by shared caches; personalised ones are not. */
function cacheHeaders(res: Response, personal: boolean, maxAge = 60) {
  res.setHeader('Cache-Control', personal ? 'private, no-cache' : `public, max-age=${maxAge}`);
  res.setHeader('Vary', 'Cookie, Authorization');
}

/** Public catalog — no guard; an optional session personalises (mastery, saved profile). */
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly syllabus: SyllabusService,
  ) {}

  @Get('families')
  async families(@Query(new ZodPipe(FamiliesQuery)) q: FamiliesQuery, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    cacheHeaders(res, !!readSession(req));
    return this.catalog.families(q);
  }

  @Get('families/:slug')
  async family(@Param('slug') slug: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = readSession(req);
    cacheHeaders(res, !!session);
    return this.catalog.familyDetail(slug, session?.id ?? null);
  }

  @Get('editions')
  async editions(@Query(new ZodPipe(EditionsQuery)) q: EditionsQuery, @Res({ passthrough: true }) res: Response) {
    cacheHeaders(res, false);
    return this.catalog.editions({ statuses: q.status, from: q.from, to: q.to, familySlug: q.familySlug, field: q.field });
  }

  /** iCalendar feed (subscribe from a phone calendar); same filters as /catalog/editions. */
  @Get('editions.ics')
  async editionsIcs(@Query(new ZodPipe(EditionsQuery)) q: EditionsQuery, @Res({ passthrough: true }) res: Response) {
    const editions = await this.catalog.editions({ statuses: q.status, from: q.from, to: q.to, familySlug: q.familySlug, field: q.field });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="concours-tn${q.familySlug ? `-${q.familySlug.replace(/[^a-z0-9-]/gi, '')}` : ''}.ics"`);
    res.setHeader('Cache-Control', 'public, max-age=900');
    return editionsToIcs(editions, env().APP_URL);
  }

  @Post('eligibility')
  @HttpCode(200)
  async eligibility(@Body(new ZodPipe(EligibilityInput)) body: EligibilityInput, @Req() req: Request) {
    const profile = body.profile ?? (await this.catalog.savedProfile(readSession(req)?.id ?? null));
    return this.catalog.eligibility(body.familySlug, body.positionSlug, toCandidateProfile(profile));
  }

  @Post('eligibility/scan')
  @HttpCode(200)
  async eligibilityScan(@Body(new ZodPipe(EligibilityScanInput)) body: z.infer<typeof EligibilityScanInput>, @Req() req: Request) {
    const profile = body.profile ?? (await this.catalog.savedProfile(readSession(req)?.id ?? null));
    return this.catalog.eligibilityScan(toCandidateProfile(profile), { field: body.field, upcomingOnly: body.upcomingOnly });
  }

  @Get('syllabus/:familySlug')
  async familySyllabus(@Param('familySlug') familySlug: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = readSession(req);
    cacheHeaders(res, !!session);
    return this.syllabus.familyTreeBySlug(familySlug, session?.id ?? null);
  }

  @Get('lessons/:topicKey')
  async lessons(
    @Param('topicKey') topicKey: string,
    @Query(new ZodPipe(LessonsQuery)) q: z.infer<typeof LessonsQuery>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = readSession(req);
    cacheHeaders(res, !!session);
    return this.syllabus.lessons(topicKey, q.lang, session?.id ?? null);
  }

  @Get('search')
  async search(@Query(new ZodPipe(SearchQuery)) q: z.infer<typeof SearchQuery>, @Res({ passthrough: true }) res: Response) {
    cacheHeaders(res, false);
    return this.catalog.search(q.q);
  }

  @Get('stats')
  async stats(@Res({ passthrough: true }) res: Response) {
    cacheHeaders(res, false, 300);
    return this.catalog.stats();
  }
}
