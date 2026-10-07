import {
  BadGatewayException, BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import {
  formatTnd, type BillingMeDTO, type CheckoutInput, type CheckoutResultDTO, type PaymentProvider as PaymentProviderCode,
  type PaymentStatus, type PlanDTO,
} from '@ctn/shared';
import { AuditService } from '../../common/audit.service';
import { tunisToday } from '../../common/dates';
import { env } from '../../config/env';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { payments, plans, promoCodes, usageCounters, users } from '../../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { EntitlementsService, type Entitlements } from './entitlements.service';
import { PaymentsService } from './payments.service';
import {
  discountedAmount, extractUuid, isUuid, normalizePromo, pickLocale, promoRejection, type PromoRejection,
} from './billing.util';
import { ManualProvider } from './providers/manual.provider';
import { ProviderError, type CreatePaymentResult, type ProviderPayment, type VerifyResult } from './providers/payment-provider';
import { PaymentProviders } from './providers/payment-providers.service';
import { currentSubscription } from './subscription';

type PaymentRow = typeof payments.$inferSelect;
type PlanRow = typeof plans.$inferSelect;

/** Unconfirmed checkouts a user may open per hour (each one may call a provider API). */
const MAX_PENDING_PER_HOUR = 6;
/** A MANUAL checkout repeated within this window reuses the pending payment instead of creating a second one. */
const MANUAL_REUSE_MS = 7 * 86_400_000;
/** Provider checkouts still unconfirmed after this long are closed as FAILED by the reconciliation job. */
const PROVIDER_EXPIRY_MS = 72 * 3_600_000;
/** Provider checkouts without a provider reference (the init call failed half-way) are abandoned after this long. */
const NO_REF_EXPIRY_MS = 3_600_000;
/** Manual checkouts with no proof submitted are abandoned after this long. */
const MANUAL_EXPIRY_MS = 14 * 86_400_000;
const HISTORY_LIMIT = 20;
const PROVIDER_REF_RE = /^[A-Za-z0-9_.:-]{4,128}$/;

export type ReturnStatus = 'paid' | 'pending' | 'failed';

export interface PromoValidationDTO {
  valid: boolean;
  percentOff: number;
  amountMillimes: number;
  priceMillimes: number;
  reason: PromoRejection | null;
}

/** Pre-contract information (Loi 2000-83 on electronic commerce): what is bought, for how long and the full TTC price. */
export interface CheckoutSummary {
  plan: { code: string; name_ar: string; name_fr: string; durationDays: number; period: string };
  priceMillimes: number;
  discountMillimes: number;
  amountMillimes: number;
  percentOff: number;
  promoCode: string | null;
  currency: 'TND';
  taxIncluded: true;
  /** When the user is already premium, the new period is added after this date. */
  currentPremiumEndsAt: string | null;
}

export type CheckoutResponse = CheckoutResultDTO & { status: PaymentStatus; reference: string; summary: CheckoutSummary };

export type BillingMeResponse = BillingMeDTO & {
  subscription: (NonNullable<BillingMeDTO['subscription']> & { planName_ar: string; planName_fr: string; source: string; daysLeft: number }) | null;
  payments: (BillingMeDTO['payments'][number] & {
    planName_ar: string; planName_fr: string; paidAt: string | null; manualReference: string | null;
    instructions_ar?: string; instructions_fr?: string;
  })[];
  entitlements: Entitlements;
  usageToday: { date: string; questions: number; tutor: number };
  providers: { code: PaymentProviderCode; available: boolean }[];
};

interface Quote {
  plan: PlanRow;
  promo: { code: string; percentOff: number } | null;
  rejection: PromoRejection | null;
  priceMillimes: number;
  amountMillimes: number;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly entitlements: EntitlementsService,
    private readonly providers: PaymentProviders,
    private readonly manual: ManualProvider,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  // ───────────── Catalogue ─────────────

  async plans(): Promise<PlanDTO[]> {
    const rows = await this.db
      .select()
      .from(plans)
      .where(eq(plans.isActive, true))
      .orderBy(sql`case when ${plans.code} = 'FREE' then 0 else 1 end`, asc(plans.priceMillimes), asc(plans.durationDays));
    return rows.map((p) => ({
      code: p.code,
      name_ar: p.nameAr,
      name_fr: p.nameFr,
      priceMillimes: p.priceMillimes,
      period: p.period,
      durationDays: p.durationDays,
      features: (p.features ?? {}) as Record<string, unknown>,
    }));
  }

  availableProviders() {
    return this.providers.available();
  }

  async validatePromo(userId: string, code: string, planCode: string): Promise<PromoValidationDTO> {
    const q = await this.quote(userId, planCode, code);
    return {
      valid: !!q.promo,
      percentOff: q.promo?.percentOff ?? 0,
      amountMillimes: q.amountMillimes,
      priceMillimes: q.priceMillimes,
      reason: q.rejection,
    };
  }

  // ───────────── Checkout ─────────────

  async checkout(userId: string, input: CheckoutInput): Promise<CheckoutResponse> {
    const user = await this.activeUser(userId);
    const q = await this.quote(userId, input.planCode, input.promoCode);
    if (q.rejection) throw new BadRequestException({ message: 'PROMO_INVALID', reason: q.rejection });
    const provider = this.providers.get(input.provider);
    const current = await currentSubscription(this.db, userId);
    const summary = this.summary(q, current?.endsAt ?? null);

    if (input.provider === 'MANUAL') {
      const reused = await this.reusableManual(userId, q);
      if (reused) return this.manualResult(reused, q.plan, summary);
    }
    await this.assertPendingBudget(userId);

    const [payment] = await this.db
      .insert(payments)
      .values({
        userId,
        planId: q.plan.id,
        amountMillimes: q.amountMillimes,
        provider: input.provider,
        promoCode: q.promo?.code ?? null,
        status: 'PENDING',
      })
      .returning();

    // A 100 % promo (partners, ambassadors) needs no payment provider at all.
    if (q.amountMillimes === 0) {
      await this.payments.markPaid(payment.id, { raw: { freeByPromo: q.promo?.code ?? null } });
      return this.result(payment, 'PAID', this.appReturnUrl('paid', payment.id), summary);
    }

    const providerPayment: ProviderPayment = {
      id: payment.id, amountMillimes: payment.amountMillimes, planCode: q.plan.code, planName_ar: q.plan.nameAr, planName_fr: q.plan.nameFr,
    };
    let created: CreatePaymentResult;
    try {
      created = await provider.createPayment(providerPayment, {
        id: user.id, name: user.name, email: user.email, phone: user.phone, locale: pickLocale(user.locale),
      });
    } catch (e) {
      const msg = e instanceof ProviderError ? e.message : (e as Error).message;
      this.logger.error(`checkout ${payment.id} (${input.provider}) failed: ${msg}`);
      await this.payments.markFailed(payment.id, `PROVIDER_ERROR: ${msg}`).catch(() => undefined);
      throw new BadGatewayException('PROVIDER_ERROR');
    }

    if (input.provider === 'MOCK') {
      await this.payments.markPaid(payment.id, { providerRef: created.providerRef ?? undefined, raw: created.raw });
      return this.result(payment, 'PAID', created.redirectUrl, summary);
    }
    if (created.providerRef || created.raw !== undefined) {
      await this.db
        .update(payments)
        .set({ providerRef: created.providerRef, raw: (created.raw ?? null) as object | null })
        .where(eq(payments.id, payment.id));
    }
    if (input.provider === 'MANUAL') return this.manualResult(payment, q.plan, summary);
    return this.result(payment, 'PENDING', created.redirectUrl, summary);
  }

  /** The user's D17 / transfer operation number for a pending MANUAL payment; admins are told to check it. */
  async manualProof(userId: string, paymentId: string, reference: string): Promise<{ ok: true }> {
    const ref = reference.trim().replace(/\s+/g, ' ');
    if (ref.length < 3) throw new BadRequestException('VALIDATION_FAILED');
    const [p] = await this.db
      .select({ payment: payments, planNameFr: plans.nameFr, planNameAr: plans.nameAr })
      .from(payments)
      .innerJoin(plans, eq(plans.id, payments.planId))
      .where(and(eq(payments.id, paymentId), eq(payments.userId, userId)))
      .limit(1);
    if (!p) throw new NotFoundException('NOT_FOUND');
    if (p.payment.provider !== 'MANUAL') throw new BadRequestException('NOT_MANUAL_PAYMENT');
    if (p.payment.status !== 'PENDING') throw new BadRequestException('PAYMENT_NOT_PENDING');
    if (p.payment.manualReference === ref) return { ok: true };

    await this.db
      .update(payments)
      .set({ manualReference: ref })
      .where(and(eq(payments.id, paymentId), eq(payments.status, 'PENDING')));
    await this.safe('audit', () =>
      this.audit.log(userId, 'payment.manual_proof', 'payment', paymentId, { reference: ref, previous: p.payment.manualReference }),
    );
    await this.notifyAdminsOfProof(p.payment, ref, p.planNameFr, p.planNameAr);
    return { ok: true };
  }

  // ───────────── My billing ─────────────

  async me(userId: string): Promise<BillingMeResponse> {
    const date = tunisToday();
    const [sub, ent, history, usage] = await Promise.all([
      currentSubscription(this.db, userId),
      this.entitlements.get(userId),
      this.db
        .select({ payment: payments, plan: { code: plans.code, nameAr: plans.nameAr, nameFr: plans.nameFr } })
        .from(payments)
        .innerJoin(plans, eq(plans.id, payments.planId))
        .where(eq(payments.userId, userId))
        .orderBy(desc(payments.createdAt))
        .limit(HISTORY_LIMIT),
      this.db
        .select({ questions: usageCounters.questions, tutor: usageCounters.tutor })
        .from(usageCounters)
        .where(and(eq(usageCounters.userId, userId), eq(usageCounters.date, date)))
        .limit(1),
    ]);

    return {
      subscription: sub
        ? {
            planCode: sub.planCode,
            planName_ar: sub.planNameAr,
            planName_fr: sub.planNameFr,
            status: sub.status,
            source: sub.source,
            startsAt: sub.startsAt.toISOString(),
            endsAt: sub.endsAt.toISOString(),
            daysLeft: Math.max(0, Math.ceil((sub.endsAt.getTime() - Date.now()) / 86_400_000)),
          }
        : null,
      payments: history.map(({ payment: p, plan }) => ({
        id: p.id,
        amountMillimes: p.amountMillimes,
        provider: p.provider,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        paidAt: p.paidAt?.toISOString() ?? null,
        planCode: plan.code,
        planName_ar: plan.nameAr,
        planName_fr: plan.nameFr,
        manualReference: p.manualReference,
        ...(p.provider === 'MANUAL' && p.status === 'PENDING'
          ? this.manual.instructions({ id: p.id, amountMillimes: p.amountMillimes, planCode: plan.code, planName_ar: plan.nameAr, planName_fr: plan.nameFr })
          : {}),
      })),
      entitlements: ent,
      usageToday: { date, questions: usage[0]?.questions ?? 0, tutor: usage[0]?.tutor ?? 0 },
      providers: this.providers.available(),
    };
  }

  // ───────────── Provider callbacks ─────────────

  /** Browser return from a provider page: verify server-side, then tell the web app what happened. */
  async handleReturn(rawPaymentId: unknown): Promise<string> {
    const id = extractUuid(rawPaymentId);
    if (!id) return this.appReturnUrl('failed', null);
    const [p] = await this.db.select().from(payments).where(eq(payments.id, id)).limit(1);
    if (!p) return this.appReturnUrl('failed', null);
    const status = p.status === 'PENDING' ? await this.reconcile(p) : p.status;
    return this.appReturnUrl(toReturnStatus(status), p.id);
  }

  /** Konnect calls GET {webhook}?payment_ref=…; the query is only a hint, the status comes from Konnect's API. */
  async konnectWebhook(rawRef: unknown): Promise<{ ok: true; status: PaymentStatus }> {
    const ref = typeof rawRef === 'string' ? rawRef.trim() : '';
    if (!PROVIDER_REF_RE.test(ref)) throw new BadRequestException('VALIDATION_FAILED');
    const [p] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.provider, 'KONNECT'), eq(payments.providerRef, ref)))
      .limit(1);
    if (!p) throw new NotFoundException('NOT_FOUND');
    const status = p.status === 'PENDING' ? await this.reconcile(p) : p.status;
    return { ok: true, status };
  }

  /** Flouci notification: located by its payment_id (or our tracking id), always re-verified with Flouci's API. */
  async flouciWebhook(input: { paymentId?: unknown; trackingId?: unknown }): Promise<{ ok: true; status: PaymentStatus }> {
    const ref = typeof input.paymentId === 'string' ? input.paymentId.trim() : '';
    let p: PaymentRow | undefined;
    if (PROVIDER_REF_RE.test(ref)) {
      [p] = await this.db.select().from(payments).where(and(eq(payments.provider, 'FLOUCI'), eq(payments.providerRef, ref))).limit(1);
    }
    const tracking = extractUuid(input.trackingId);
    if (!p && tracking) {
      [p] = await this.db.select().from(payments).where(and(eq(payments.provider, 'FLOUCI'), eq(payments.id, tracking))).limit(1);
    }
    if (!p) throw new NotFoundException('NOT_FOUND');
    const status = p.status === 'PENDING' ? await this.reconcile(p) : p.status;
    return { ok: true, status };
  }

  /**
   * Asks the provider for the truth about one pending payment and applies it. Provider outages leave the payment
   * PENDING (the reconciliation job retries); an amount or order mismatch is never activated and is audited instead.
   */
  async reconcile(p: PaymentRow): Promise<PaymentStatus> {
    if (p.status !== 'PENDING') return p.status;
    if (p.provider === 'MANUAL' || !p.providerRef) return 'PENDING';
    let v: VerifyResult;
    try {
      v = await this.providers.raw(p.provider).verify(p.providerRef);
    } catch (e) {
      this.logger.warn(`verify ${p.id} (${p.provider}) failed: ${(e as Error).message}`);
      return 'PENDING';
    }
    if (v.status === 'PAID') {
      const mismatch = verificationMismatch(p, v);
      if (mismatch) {
        this.logger.error(`payment ${p.id} verification mismatch: ${mismatch}`);
        await this.safe('audit', () =>
          this.audit.log(null, 'payment.verification_mismatch', 'payment', p.id, { mismatch, verified: v.raw ?? null }),
        );
        return 'PENDING';
      }
      await this.payments.markPaid(p.id, { raw: v.raw ?? { status: 'PAID' } });
      return 'PAID';
    }
    if (v.status === 'FAILED') {
      await this.payments.markFailed(p.id, `${p.provider}_FAILED`);
      return 'FAILED';
    }
    return 'PENDING';
  }

  /**
   * Safety net for lost webhooks and closed browser tabs: re-verifies recent provider checkouts and closes the ones
   * that can no longer complete. Returns counters for logs/tests.
   */
  async reconcilePending(now = new Date()): Promise<{ checked: number; paid: number; failed: number; expired: number }> {
    const out = { checked: 0, paid: 0, failed: 0, expired: 0 };
    const recent = await this.db
      .select()
      .from(payments)
      .where(and(
        eq(payments.status, 'PENDING'),
        inArray(payments.provider, ['KONNECT', 'FLOUCI']),
        isNotNull(payments.providerRef),
        gt(payments.createdAt, new Date(now.getTime() - PROVIDER_EXPIRY_MS)),
        lt(payments.createdAt, new Date(now.getTime() - 5 * 60_000)),
      ))
      .orderBy(asc(payments.createdAt))
      .limit(200);
    for (const p of recent) {
      out.checked++;
      const s = await this.reconcile(p);
      if (s === 'PAID') out.paid++;
      else if (s === 'FAILED') out.failed++;
    }

    const stale = await this.db
      .select({ id: payments.id, provider: payments.provider, providerRef: payments.providerRef })
      .from(payments)
      .where(and(
        eq(payments.status, 'PENDING'),
        or(
          and(ne(payments.provider, 'MANUAL'), isNull(payments.providerRef), lt(payments.createdAt, new Date(now.getTime() - NO_REF_EXPIRY_MS))),
          and(ne(payments.provider, 'MANUAL'), lt(payments.createdAt, new Date(now.getTime() - PROVIDER_EXPIRY_MS))),
          and(eq(payments.provider, 'MANUAL'), isNull(payments.manualReference), lt(payments.createdAt, new Date(now.getTime() - MANUAL_EXPIRY_MS))),
        ),
      ))
      .orderBy(asc(payments.createdAt))
      .limit(500);
    for (const p of stale) {
      await this.payments.markFailed(p.id, p.provider !== 'MANUAL' && p.providerRef ? 'EXPIRED' : 'ABANDONED');
      out.expired++;
    }
    return out;
  }

  // ───────────── Helpers ─────────────

  private async activeUser(userId: string) {
    const [u] = await this.db
      .select({ id: users.id, name: users.name, email: users.email, phone: users.phone, locale: users.locale, isGuest: users.isGuest })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (!u) throw new UnauthorizedException('SESSION_REQUIRED');
    if (u.isGuest) throw new UnauthorizedException('REGISTRATION_REQUIRED');
    return u;
  }

  private async quote(userId: string, planCode: string, promoCode?: string | null): Promise<Quote> {
    const [plan] = await this.db
      .select()
      .from(plans)
      .where(and(eq(plans.code, planCode), eq(plans.isActive, true)))
      .limit(1);
    if (!plan || plan.priceMillimes <= 0 || plan.durationDays <= 0) throw new NotFoundException('PLAN_NOT_FOUND');
    const base = { plan, priceMillimes: plan.priceMillimes };
    if (!promoCode || !promoCode.trim()) return { ...base, promo: null, rejection: null, amountMillimes: plan.priceMillimes };

    const code = normalizePromo(promoCode);
    const [row] = await this.db.select().from(promoCodes).where(sql`upper(${promoCodes.code}) = ${code}`).limit(1);
    let rejection = promoRejection(row);
    if (!rejection && row) {
      const [used] = await this.db
        .select({ n: count() })
        .from(payments)
        .where(and(eq(payments.userId, userId), eq(payments.promoCode, row.code), eq(payments.status, 'PAID')));
      if (Number(used?.n ?? 0) > 0) rejection = 'ALREADY_USED';
    }
    if (rejection || !row) return { ...base, promo: null, rejection: rejection ?? 'NOT_FOUND', amountMillimes: plan.priceMillimes };
    const percentOff = Math.min(100, Math.max(0, row.percentOff));
    return { ...base, promo: { code: row.code, percentOff }, rejection: null, amountMillimes: discountedAmount(plan.priceMillimes, percentOff) };
  }

  private summary(q: Quote, currentEndsAt: Date | null): CheckoutSummary {
    return {
      plan: { code: q.plan.code, name_ar: q.plan.nameAr, name_fr: q.plan.nameFr, durationDays: q.plan.durationDays, period: q.plan.period },
      priceMillimes: q.priceMillimes,
      discountMillimes: q.priceMillimes - q.amountMillimes,
      amountMillimes: q.amountMillimes,
      percentOff: q.promo?.percentOff ?? 0,
      promoCode: q.promo?.code ?? null,
      currency: 'TND',
      taxIncluded: true,
      currentPremiumEndsAt: currentEndsAt?.toISOString() ?? null,
    };
  }

  private async reusableManual(userId: string, q: Quote): Promise<PaymentRow | null> {
    const [p] = await this.db
      .select()
      .from(payments)
      .where(and(
        eq(payments.userId, userId),
        eq(payments.provider, 'MANUAL'),
        eq(payments.status, 'PENDING'),
        eq(payments.planId, q.plan.id),
        eq(payments.amountMillimes, q.amountMillimes),
        q.promo ? eq(payments.promoCode, q.promo.code) : isNull(payments.promoCode),
        gt(payments.createdAt, new Date(Date.now() - MANUAL_REUSE_MS)),
      ))
      .orderBy(desc(payments.createdAt))
      .limit(1);
    return p ?? null;
  }

  private async assertPendingBudget(userId: string): Promise<void> {
    const [row] = await this.db
      .select({ n: count() })
      .from(payments)
      .where(and(eq(payments.userId, userId), eq(payments.status, 'PENDING'), gt(payments.createdAt, new Date(Date.now() - 3_600_000))));
    if (Number(row?.n ?? 0) >= MAX_PENDING_PER_HOUR) throw new HttpException('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
  }

  private manualResult(payment: PaymentRow, plan: PlanRow, summary: CheckoutSummary): CheckoutResponse {
    const instructions = this.manual.instructions({
      id: payment.id, amountMillimes: payment.amountMillimes, planCode: plan.code, planName_ar: plan.nameAr, planName_fr: plan.nameFr,
    });
    return { ...this.result(payment, 'PENDING', null, summary), ...instructions };
  }

  private result(payment: PaymentRow, status: PaymentStatus, redirectUrl: string | null, summary: CheckoutSummary): CheckoutResponse {
    return {
      paymentId: payment.id,
      provider: payment.provider,
      status,
      redirectUrl,
      amountMillimes: payment.amountMillimes,
      reference: payment.id,
      summary,
    };
  }

  private appReturnUrl(status: ReturnStatus, paymentId: string | null): string {
    const base = `${env().APP_URL.replace(/\/+$/, '')}/app/billing/return?status=${status}`;
    return paymentId ? `${base}&paymentId=${paymentId}` : base;
  }

  private async notifyAdminsOfProof(payment: PaymentRow, reference: string, planNameFr: string, planNameAr: string): Promise<void> {
    if (!this.notifications) return;
    const admins = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'ADMIN'), isNull(users.deletedAt)));
    if (!admins.length) {
      this.logger.warn(`manual proof for ${payment.id} but no admin account to notify`);
      return;
    }
    const digest = createHash('sha256').update(reference).digest('hex').slice(0, 12);
    await this.safe('notify admins', () =>
      this.notifications!.notifyMany(admins.map((a) => a.id), {
        type: 'SYSTEM',
        title: 'Paiement manuel à vérifier · دفع يدوي للتحقق',
        body: `${planNameFr} / ${planNameAr} — ${formatTnd(payment.amountMillimes, 'fr')} — opération : ${reference} — paiement ${payment.id}`,
        url: '/admin/payments?status=PENDING',
        data: { paymentId: payment.id, reference, amountMillimes: payment.amountMillimes },
        dedupeKey: `manual-proof:${payment.id}:${digest}`,
      }),
    );
  }

  private async safe(what: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.error(`${what} failed: ${(e as Error).message}`);
    }
  }
}

function toReturnStatus(s: PaymentStatus): ReturnStatus {
  return s === 'PAID' ? 'paid' : s === 'PENDING' ? 'pending' : 'failed';
}

/** Why a provider's "paid" answer does not match our payment, or null when it does. */
export function verificationMismatch(p: Pick<PaymentRow, 'id' | 'amountMillimes'>, v: VerifyResult): string | null {
  if (v.orderId && isUuid(v.orderId) && v.orderId.toLowerCase() !== p.id) return `order ${v.orderId} ≠ ${p.id}`;
  if (v.amountMillimes != null) {
    // Accept millimes or dinars: providers are not consistent about the unit they echo back.
    const ok = v.amountMillimes === p.amountMillimes || Math.round(v.amountMillimes * 1000) === p.amountMillimes;
    if (!ok) return `amount ${v.amountMillimes} ≠ ${p.amountMillimes}`;
  }
  return null;
}
