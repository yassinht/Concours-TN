import type { Metadata } from 'next';
import { LeaderboardScreen } from '@/components/learn/views/leaderboard-screen';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), { ar: 'الترتيب', fr: 'Classement' }) };
}

export default function LeaderboardPage() {
  return <LeaderboardScreen />;
}
