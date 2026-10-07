import type { Metadata } from 'next';
import { AuditView } from '@/components/admin/audit';

export const metadata: Metadata = { title: 'Audit' };

export default function AdminAuditPage() {
  return <AuditView />;
}
