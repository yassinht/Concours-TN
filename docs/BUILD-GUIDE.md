# Build guide (for contributors and coding agents)

## Layout
```
packages/shared     @ctn/shared — enums, zod input schemas, DTO types, pure algorithms (eligibility, grading, Elo mastery, readiness, daily plan, XP/streaks, pricing). Built to dist/ (CJS).
apps/api            @ctn/api — NestJS 11 + Drizzle ORM (PostgreSQL 16). Port 4000.
  src/db/schema.ts  the database schema (single source of truth)
  src/db/seed.ts    loads content/** JSON into the DB (idempotent upserts)
  src/common/       session (JWT cookie), guards (UserGuard, RegisteredGuard, RolesGuard+@Roles), @CurrentUser, ZodPipe, AuditService, dates
  src/modules/<m>/  one folder per module (controllers, services, specs)
apps/web            @ctn/web — Next.js 15 App Router PWA, Tailwind v4, RTL-first. Port 3000. Calls the API via /api/* proxy.
  components/providers.tsx  Providers, useLocale, useT, <T ar fr/>, useSession (me, ensureSession, refresh, logout)
  components/ui/            Button, ButtonLink, Card, Badge, ProgressBar, Field/Input/Select/Textarea, Spinner, PageLoader, EmptyState, Stat, Alert, Modal, Tabs, scoreTone
  components/ui/provenance.tsx  <ProvenanceBadge p={...}/> — REQUIRED next to every concours fact
  lib/api.ts (client) · lib/api-server.ts (server, forwards cookies) · lib/i18n.ts (t, pick, formatDate, daysUntil) · lib/i18n-server.ts (getLocale)
content/            seed content (see content/SCHEMA.md)
docs/api-contract.md  every endpoint, guard, body and DTO
```

## Rules
1. **Ownership**: only edit files inside the directories you own. Never edit `apps/api/src/db/schema.ts`, `packages/shared/**`, `apps/api/src/app.module.ts`, `apps/web/components/providers.tsx`, `apps/web/components/ui/**`, or another agent's module. If you need a change there, work around it (jsonb fields, local helpers) and report it in your final result under "requests".
2. **Contracts**: implement endpoints exactly as in `docs/api-contract.md` with the DTOs/zod schemas from `@ctn/shared`. Cross-module services (MasteryService, ReadinessService, GamificationService, NotificationsService, MailService, AlertsService, EntitlementsService, AiService) are global providers: inject them by class; their contract is in the stub's doc comment. The owner implements the body without changing the signature.
3. **Typecheck without stepping on others**: other modules are being written at the same time, so filter output to your own paths:
   - API: `cd apps/api && npx tsc -p tsconfig.json --noEmit 2>&1 | grep 'src/modules/<yours>'`
   - Web: `cd apps/web && npx tsc --noEmit 2>&1 | grep -E 'app/<your-routes>|components/<yours>'`
   Do **not** run `nest build`, `next build`, `next dev` or start servers on ports 3000/4000 during the parallel phase (shared dist/.next would collide).
4. **API tests**: Jest + `@nestjs/testing` + supertest, files `*.spec.ts` next to your code. Build a testing module with `DbModule`, `CommonModule`, your module, and only the global modules you need. Use the real DB (`DATABASE_URL`, default `postgres://postgres:postgres@localhost:5432/concours_tn`), create your own users with random emails, never truncate tables. Run: `cd apps/api && npx jest src/modules/<yours>`. (ts-jest diagnostics are off so other modules' type errors don't block you; still keep your own files type-clean.)
5. **Security**: validate every body with `new ZodPipe(Schema)`; check ownership (`attempt.userId === user.id`) on every user-scoped resource; never return `correct`/`explanation` for exam-mode attempts before submit; never expose password hashes or other users' emails; parameterised queries only (Drizzle); rate-limit sensitive endpoints with a simple in-memory limiter where noted.
6. **Content integrity**: nothing reaches `PUBLISHED` without a human reviewer; AI output is always `DRAFT`/`AI_REVIEWED`. Facts with `needs_verification=true` are shown with the "À vérifier / للتحقق" badge, never as official.
7. **Web UX**: mobile-first (design at 360px, then `sm:`/`md:`), RTL-first using logical utilities (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`) — never `ml-/mr-/left-/right-` for layout. All user-visible text bilingual via `<T ar fr/>` / `useT()` (client) or `t(locale, {ar, fr})` (server). French/English question text gets `dir="auto"`. Use the tokens (`bg-surface`, `text-muted`, `bg-primary`, `text-primary`, `bg-accent`…) — no hard-coded colors. Touch targets ≥ 44px. Every page handles loading, empty and error states. Keep client JS small: prefer server components for read-only pages, `'use client'` only where interactive.
8. **Accessibility**: semantic headings in order, labels on inputs, `aria-live` for answer feedback, visible focus, color is never the only signal (icons + text for correct/wrong).
9. Code style: TypeScript strict, small functions, comments only where they explain *why*. Match the existing files.
