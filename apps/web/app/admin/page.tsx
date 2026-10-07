import type { Metadata } from 'next';
import { DashboardView } from '@/components/admin/dashboard';

export const metadata: Metadata = { title: 'Tableau de bord' };

export default function AdminHomePage() {
  return <DashboardView />;
}
