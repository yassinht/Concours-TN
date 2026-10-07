import { z } from 'zod';

const bool = z.union([z.boolean(), z.string()]).transform((v) => v === true || v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/concours_tn'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  /** Public URL of the web app (used in emails, payment return URLs, push links). */
  APP_URL: z.string().default('http://localhost:3000'),
  /** Public URL where the API is reachable from the outside (payment webhooks). Through the web proxy by default. */
  API_PUBLIC_URL: z.string().default('http://localhost:3000/api'),
  JWT_SECRET: z.string().min(16).default('dev-secret-change-me-please-32chars!!'),
  COOKIE_SECURE: bool.default(false),
  /** Serve AI_REVIEWED (not yet human-reviewed) questions with a "beta" badge. Must be false in production once the bank is reviewed. */
  CONTENT_BETA_MODE: bool.default(true),
  ADMIN_EMAIL: z.string().default('admin@concours.tn'),
  ADMIN_PASSWORD: z.string().default('admin12345'),
  // AI
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL_TUTOR: z.string().default('claude-haiku-4-5-20251001'),
  AI_MODEL_CONTENT: z.string().default('claude-sonnet-5-5'),
  // Google OAuth (optional)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Email (optional — when SMTP_HOST is unset, emails are written to email_outbox with status LOGGED)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Concours TN <no-reply@concours.tn>'),
  // Web push (optional — generate with `npx web-push generate-vapid-keys`)
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:contact@concours.tn'),
  // Payments
  PAYMENTS_MOCK_ENABLED: bool.default(true),
  KONNECT_API_URL: z.string().default('https://api.sandbox.konnect.network/api/v2'),
  KONNECT_API_KEY: z.string().optional(),
  KONNECT_WALLET_ID: z.string().optional(),
  FLOUCI_API_URL: z.string().default('https://developers.flouci.com/api'),
  FLOUCI_APP_TOKEN: z.string().optional(),
  FLOUCI_APP_SECRET: z.string().optional(),
  MANUAL_PAYMENT_D17_NUMBER: z.string().default('XX XXX XXX'),
  MANUAL_PAYMENT_RIB: z.string().default('RIB à configurer'),
  // Storage
  UPLOAD_DIR: z.string().default('uploads'),
  // Jobs
  CRON_ENABLED: bool.default(true),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;
export function env(): Env {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}
