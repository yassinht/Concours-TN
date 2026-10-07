import type { Metadata } from 'next';
import { BlueprintsView } from '@/components/admin/blueprints';

export const metadata: Metadata = { title: 'Blueprints' };

export default function AdminBlueprintsPage() {
  return <BlueprintsView />;
}
