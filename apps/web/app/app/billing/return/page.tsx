import type { Metadata } from 'next';
import { BillingReturnView } from '@/components/app/views/billing-return-view';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), { ar: 'نتيجة الدفع', fr: 'Résultat du paiement' }) };
}

export default async function BillingReturnPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const raw = one(sp.status);
  const status = raw === 'paid' || raw === 'success' ? 'paid' : raw === 'pending' ? 'pending' : 'failed';
  const paymentId = one(sp.paymentId);
  return <BillingReturnView status={status} paymentId={paymentId && UUID.test(paymentId) ? paymentId : undefined} />;
}
