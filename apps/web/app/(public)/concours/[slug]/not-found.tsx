import { SearchX } from 'lucide-react';
import { ButtonLink, EmptyState } from '@/components/ui';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

export default async function FamilyNotFound() {
  const locale = await getLocale();
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <EmptyState
        icon={<SearchX className="size-8" aria-hidden />}
        title={t(locale, { ar: 'لم نجد هذه المناظرة', fr: 'Concours introuvable' })}
        body={t(locale, { ar: 'ربما تغيّر الرابط أو لم نضف هذه المناظرة بعد. ابحث في القائمة أو أعلمنا بها.', fr: 'Le lien a peut-être changé ou ce concours n’est pas encore ajouté. Cherchez dans la liste ou signalez-le-nous.' })}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <ButtonLink href="/concours">{t(locale, { ar: 'كل المناظرات', fr: 'Tous les concours' })}</ButtonLink>
            <ButtonLink href="/#waitlist" variant="secondary">{t(locale, { ar: 'اقترح مناظرة', fr: 'Proposer un concours' })}</ButtonLink>
          </div>
        }
      />
    </div>
  );
}
