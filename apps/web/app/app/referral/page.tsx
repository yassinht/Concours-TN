import type { Metadata } from 'next';
import { ReferralView } from '@/components/app/views/referral-view';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), { ar: 'ادعُ أصدقاءك', fr: 'Parrainage' }) };
}

export default function ReferralPage() {
  return <ReferralView />;
}
