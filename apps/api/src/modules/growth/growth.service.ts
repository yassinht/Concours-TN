import { BadRequestException, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { WaitlistInput } from '@ctn/shared';
import { InjectDb } from '../../db/db.module';
import type { Database } from '../../db/client';
import { analyticsEvents, waitlist } from '../../db/schema';

export type WaitlistBody = z.infer<typeof WaitlistInput>;

/** Funnel events the product tracks (any `snake_case` name is accepted; these are the documented ones). */
export const KNOWN_EVENTS = ['landing_view', 'diagnostic_start', 'diagnostic_done', 'signup', 'paywall_view', 'checkout_start', 'paid'] as const;

export const EventInput = z.object({
  name: z.string().min(1).max(60).regex(/^[a-z0-9][a-z0-9_.:-]*$/i, 'letters, digits, _ . : -'),
  props: z.record(z.unknown()).optional(),
});
export type EventInput = z.infer<typeof EventInput>;

const MAX_PROPS_BYTES = 2048;
const DEDUPE_WINDOW = sql`now() - interval '24 hours'`;
const MAX_UTM_KEYS = 12;

function invalid(path: string, message: string) {
  return new BadRequestException({ message: 'VALIDATION_FAILED', issues: [{ path: [path], message }] });
}

@Injectable()
export class GrowthService {
  constructor(@InjectDb() private readonly db: Database) {}

  /** Demand capture for concours/features not served yet. Same contact + family within 24 h is stored once. */
  async joinWaitlist(input: WaitlistBody): Promise<{ ok: true }> {
    const email = input.email?.trim().toLowerCase() || null;
    const phone = input.phone?.replace(/\s+/g, '') || null;
    if (phone && !/^\+?[0-9]{6,15}$/.test(phone)) throw invalid('phone', 'invalid phone number');
    const familySlug = input.familySlug?.trim().slice(0, 120) || null;

    const sameFamily = familySlug ? eq(waitlist.familySlug, familySlug) : isNull(waitlist.familySlug);
    const sameContact = email ? sql`lower(${waitlist.email}) = ${email}` : eq(waitlist.phone, phone as string);
    const [dupe] = await this.db
      .select({ id: waitlist.id })
      .from(waitlist)
      .where(and(sameContact, sameFamily, gt(waitlist.createdAt, DEDUPE_WINDOW)))
      .limit(1);
    if (dupe) return { ok: true };

    await this.db.insert(waitlist).values({
      email,
      phone,
      familySlug,
      willingness: input.willingness ?? null,
      utm: input.utm ? this.cleanUtm(input.utm) : null,
    });
    return { ok: true };
  }

  /** Lightweight funnel analytics. The session is optional; a stale session (deleted/merged user) is recorded anonymously. */
  async track(userId: string | null, input: EventInput): Promise<{ ok: true }> {
    const props = input.props ?? {};
    if (Buffer.byteLength(JSON.stringify(props), 'utf8') > MAX_PROPS_BYTES) throw invalid('props', `max ${MAX_PROPS_BYTES} bytes`);
    await this.db.insert(analyticsEvents).values({
      userId: userId ? sql`(select id from users where id = ${userId})` : null,
      name: input.name.toLowerCase(),
      props,
    });
    return { ok: true };
  }

  private cleanUtm(utm: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(utm).slice(0, MAX_UTM_KEYS)) out[k.slice(0, 40)] = String(v).slice(0, 200);
    return out;
  }
}
