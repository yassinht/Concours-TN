# Concours TN 🇹🇳

منصة تونسية للتحضير للمناظرات العمومية — *استعد لمناظرتك خطوة بخطوة*.
Tunisian PWA that turns each public-sector concours into a full preparation path: verified information (with sources), eligibility check, **alerts when a concours matches your profile**, diagnostic test, adaptive practice, timed mock exams, AI tutor, readiness score, daily plan.

- Strategy & research: [`docs/00-README.md`](docs/00-README.md)
- Screenshots: [`docs/screenshots/`](docs/screenshots)
- API contract: [`docs/api-contract.md`](docs/api-contract.md)

## Stack
pnpm monorepo · `packages/shared` (types + algorithms) · `apps/api` NestJS 11 + Drizzle + PostgreSQL 16 · `apps/web` Next.js 15 PWA (Arabic RTL / French) · `content/` seed data (26 concours families with sources, 840 questions, 73 lessons).

## Run locally

Requirements: Node 22, pnpm 10, PostgreSQL 16 (or Docker).

```bash
docker compose up -d postgres          # or use a local PostgreSQL (db: concours_tn, user/pass: postgres)
cp .env.example .env                   # optional — defaults work for local dev
pnpm install
pnpm --filter @ctn/shared build
pnpm db:migrate                        # create tables
pnpm db:seed                           # load concours, questions, lessons, plans, admin user
pnpm --filter @ctn/api build && (cd apps/api && node dist/main.js) &   # API on :4000
pnpm --filter @ctn/web build && (cd apps/web && npx next start -p 3000) # Web on :3000
```

Open **http://localhost:3000**

| Account | Login | Password |
|---|---|---|
| Admin (dashboard at `/admin`) | `admin@concours.tn` | `admin12345` (change via `ADMIN_EMAIL` / `ADMIN_PASSWORD` before seeding in production) |
| Candidate | no account needed for the diagnostic; register at `/register` | — |

Test payment: in dev, `/app/billing` offers a **"Paiement test" (MOCK)** provider; promo code `LANCEMENT` = −30%.

## What to try
1. `/` → **اختبار تشخيصي مجاني** (no account) → results → register (progress is kept).
2. `/app/profile`: fill birth date / diploma / gender → enable alerts → `/app/alerts` shows the open concours matching your profile.
3. As admin: `/admin/concours/<slug>` → open a session → matching candidates are notified (in-app, web push, email).
4. `/app/mock` → "Simulation réelle" (timed, same structure as the real exam when the format is official).
5. `/admin/review` → approve/publish AI-generated questions (nothing is published without a human).

## Tests
```bash
pnpm --filter @ctn/shared test        # algorithms
cd apps/api && npx jest               # API specs (needs the DB)
```

## Production checklist
- `CONTENT_BETA_MODE=false` once questions are human-reviewed (until then AI-reviewed items show a "beta" badge).
- Verify all concours facts flagged **À vérifier / للتحقق** in `/admin/facts`.
- Strong `JWT_SECRET`, `COOKIE_SECURE=true`, HTTPS.
- `VAPID_*` keys (web push), `SMTP_*` (emails), Konnect / Flouci keys + webhook URL (`API_PUBLIC_URL`), `ANTHROPIC_API_KEY` (tutor & content tools — optional, deterministic fallbacks exist).
- Legal: INPDP declaration, hosting decision, terms/privacy review — see [`docs/10-legal.md`](docs/10-legal.md).

## Status
Built and smoke-tested end to end (guest diagnostic → register → practice → alerts → premium checkout → mock exam → admin). Not yet done: Playwright e2e suite, 8 of 27 question banks (spec-* banks for douane, fiscalité, pédagogie, santé, banque, électricité, informatique, rédaction), human review of content.
