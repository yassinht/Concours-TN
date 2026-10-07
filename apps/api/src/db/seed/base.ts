import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { PLANS } from '@ctn/shared';
import { env } from '../../config/env';
import { plans, promoCodes, userProfiles, userStats, users, watchedSources } from '../schema';
import type { SeedLog } from './log';
import type { Db } from './types';

export async function seedPlans(db: Db, log: SeedLog): Promise<void> {
  for (const p of PLANS) {
    const values = {
      nameAr: p.name_ar, nameFr: p.name_fr, priceMillimes: p.price_millimes, period: p.period, durationDays: p.duration_days,
      features: p.features as Record<string, unknown>,
    };
    await db.insert(plans).values({ code: p.code, ...values }).onConflictDoUpdate({ target: plans.code, set: values });
    log.inc('upserted.plans');
  }
}

/** Launch promo code; an existing code keeps its usage counter and any admin change. */
export async function seedPromo(db: Db, log: SeedLog): Promise<void> {
  const r = await db.insert(promoCodes).values({ code: 'LANCEMENT', percentOff: 30, maxUses: 500 }).onConflictDoNothing().returning();
  if (r.length) log.inc('created.promoCodes');
}

function referralCode(): string {
  return `ADM${randomBytes(5).toString('hex').toUpperCase()}`;
}

/** Admin account from ADMIN_EMAIL / ADMIN_PASSWORD. The password is only set at creation (never reset by a re-seed). */
export async function seedAdmin(db: Db, log: SeedLog): Promise<void> {
  if (env().NODE_ENV === 'production' && env().ADMIN_PASSWORD === 'admin12345') {
    throw new Error('ADMIN_PASSWORD is still the development default: set a strong password before seeding production');
  }
  const email = env().ADMIN_EMAIL.trim().toLowerCase();
  const [existing] = await db.select({ id: users.id, passwordHash: users.passwordHash }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  let userId: string;
  if (existing) {
    userId = existing.id;
    await db
      .update(users)
      .set({
        role: 'ADMIN', isGuest: false, deletedAt: null,
        ...(existing.passwordHash ? {} : { passwordHash: await bcrypt.hash(env().ADMIN_PASSWORD, 10) }),
      })
      .where(eq(users.id, userId));
  } else {
    const [row] = await db
      .insert(users)
      .values({
        email, passwordHash: await bcrypt.hash(env().ADMIN_PASSWORD, 10), name: 'Admin', role: 'ADMIN', isGuest: false, locale: 'fr',
        referralCode: referralCode(), emailVerifiedAt: new Date(),
      })
      .returning({ id: users.id });
    userId = row.id;
    log.inc('created.adminUser');
  }
  await db.insert(userStats).values({ userId }).onConflictDoNothing();
  await db.insert(userProfiles).values({ userId, alertsEnabled: false }).onConflictDoNothing();
}

const WATCHED = [
  { url: 'https://www.concours.gov.tn', label: 'Portail national des concours (concours.gov.tn)', familySlug: null },
  { url: 'https://www.douane.gov.tn', label: 'Douane tunisienne', familySlug: null },
  { url: 'https://www.interieur.gov.tn', label: 'Ministère de l’Intérieur', familySlug: null },
  { url: 'https://www.education.gov.tn', label: 'Ministère de l’Éducation', familySlug: null },
  { url: 'http://www.santetunisie.rns.tn', label: 'Ministère de la Santé', familySlug: null },
  { url: 'https://www.ena.tn', label: 'École nationale d’administration (ENA)', familySlug: null },
  { url: 'https://www.finances.gov.tn', label: 'Ministère des Finances', familySlug: null },
];

export async function seedWatchedSources(db: Db, log: SeedLog): Promise<void> {
  for (const w of WATCHED) {
    const r = await db.insert(watchedSources).values(w).onConflictDoNothing().returning({ id: watchedSources.id });
    if (r.length) log.inc('created.watchedSources');
  }
}
