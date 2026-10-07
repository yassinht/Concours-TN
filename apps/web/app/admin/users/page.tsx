import type { Metadata } from 'next';
import { UsersView } from '@/components/admin/users';

export const metadata: Metadata = { title: 'Utilisateurs' };

export default function AdminUsersPage() {
  return <UsersView />;
}
