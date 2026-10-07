import { PrimaryFamilyRedirect } from '@/components/learn/views/primary-redirect';

/** /app/checklist → the checklist of the primary concours. */
export default function ChecklistIndex() {
  return <PrimaryFamilyRedirect to="checklist" />;
}
