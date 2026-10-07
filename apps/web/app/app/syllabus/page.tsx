import { PrimaryFamilyRedirect } from '@/components/learn/views/primary-redirect';

/** /app/syllabus → the programme of the primary concours. */
export default function SyllabusIndex() {
  return <PrimaryFamilyRedirect to="syllabus" />;
}
