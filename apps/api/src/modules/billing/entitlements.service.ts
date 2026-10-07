import { Injectable } from '@nestjs/common';

export interface Entitlements {
  premium: boolean;
  planCode: string | null;
  endsAt: string | null;
  limits: { questionsPerDay: number | null; tutorPerDay: number; mocksTotal: number | null; offline: boolean };
}

/**
 * CONTRACT (owned by the billing module):
 * - get(userId) → active subscription (status ACTIVE and ends_at > now) → plan features, else FREE limits (@ctn/shared FREE_LIMITS).
 * - consume(userId, kind, n=1) → checks & increments usage_counters for today (Africa/Tunis). Returns { allowed, remaining }.
 *   remaining = null when unlimited.
 * - canStartMock(userId) → free users get FREE_LIMITS.mocks_total submitted mocks in total.
 * - grantDays(userId, days, source, planCode='PREMIUM_MONTH') → extends/creates an ACTIVE subscription (referrals, admin grants).
 */
@Injectable()
export class EntitlementsService {
  async get(_userId: string): Promise<Entitlements> {
    throw new Error('NOT_IMPLEMENTED');
  }
  async consume(_userId: string, _kind: 'questions' | 'tutor', _n = 1): Promise<{ allowed: boolean; remaining: number | null }> {
    throw new Error('NOT_IMPLEMENTED');
  }
  async canStartMock(_userId: string): Promise<boolean> {
    throw new Error('NOT_IMPLEMENTED');
  }
  async grantDays(_userId: string, _days: number, _source: string, _planCode = 'PREMIUM_MONTH'): Promise<void> {
    throw new Error('NOT_IMPLEMENTED');
  }
}
