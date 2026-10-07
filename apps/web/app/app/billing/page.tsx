import type { Metadata } from 'next';
import { BillingView } from '@/components/app/views/billing-view';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), { ar: 'الاشتراك', fr: 'Abonnement' }) };
}

export default function BillingPage() {
  return <BillingView />;
}
