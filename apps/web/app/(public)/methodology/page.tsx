import Link from 'next/link';
import type { Metadata } from 'next';
import { Bot, FileSearch, Gauge, Quote, RefreshCw, UserCheck } from 'lucide-react';
import { READINESS_LABEL_TEXT, type Locale } from '@ctn/shared';
import { Badge } from '@/components/ui';
import { SCOPE_LABELS } from '@/components/public/labels';
import { ContactLine, Container, PageHeader, Prose, ProvenanceLegend, Section } from '@/components/public/sections';
import { pageMetadata } from '@/components/public/server-data';
import { getLocale } from '@/lib/i18n-server';
import { t, type Bi } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return pageMetadata(locale, {
    title: { ar: 'كيف نتحقق من المعلومات', fr: 'Comment nous vérifions les informations' },
    description: {
      ar: 'مصادر المعلومات ودرجات التحقق، سياسة الذكاء الاصطناعي (لا شيء يُنشر دون مراجعة بشرية)، وكيف نحسب مؤشر الجاهزية وحدوده.',
      fr: 'Sources et niveaux de vérification, politique IA (rien n’est publié sans relecture humaine), calcul de l’indicateur de préparation et ses limites.',
    },
    path: '/methodology',
  });
}

const PROCESS: { icon: typeof FileSearch; title: Bi; body: Bi }[] = [
  { icon: FileSearch, title: { ar: 'الجمع', fr: 'Collecte' }, body: { ar: 'نبحث أولًا عن النص الرسمي: بلاغ المناظرة، القرار المنظم لها، الرائد الرسمي، concours.gov.tn أو موقع الهيكل المنظم.', fr: 'Nous cherchons d’abord le texte officiel : avis, arrêté d’organisation, JORT, concours.gov.tn ou site de l’organisme.' } },
  { icon: Quote, title: { ar: 'الاقتباس', fr: 'Citation' }, body: { ar: 'كل معلومة رسمية (شرط، تاريخ، مرحلة، مادة) تُحفظ مع اقتباس حرفي من المصدر ورقم الصفحة.', fr: 'Chaque fait officiel (condition, date, épreuve, matière) est enregistré avec une citation exacte de la source et le numéro de page.' } },
  { icon: UserCheck, title: { ar: 'المراجعة البشرية', fr: 'Relecture humaine' }, body: { ar: 'عضو من الفريق يقارن المعلومة بالمصدر قبل نشرها. ما لم يُتحقق منه يُعرض بشارة «للتحقق».', fr: 'Un membre de l’équipe compare l’information à la source avant publication. Ce qui n’est pas vérifié porte le badge « À vérifier ».' } },
  { icon: RefreshCw, title: { ar: 'إعادة التحقق', fr: 'Revérification' }, body: { ar: 'نراقب الصفحات الرسمية دوريًا. أي بلاغ جديد يُقترح كمسودة ولا يُنشر ولا يُرسل كتنبيه قبل مراجعته، ونعرض تاريخ آخر تحقق لكل مصدر.', fr: 'Les pages officielles sont surveillées régulièrement. Tout nouvel avis devient un brouillon, ni publié ni envoyé en alerte avant relecture ; la date de dernière vérification de chaque source est affichée.' } },
];

const ORIGINS: { label: Bi; body: Bi }[] = [
  { label: { ar: 'على نمط امتحان سابق', fr: 'Dans le style d’un ancien examen' }, body: { ar: 'سؤال أعيدت صياغته جوهريًا انطلاقًا من موضوع ورد في امتحان سابق. لا ننشر نصوص الامتحانات حرفيًا.', fr: 'Question substantiellement reformulée à partir d’un thème déjà tombé. Nous ne republions pas les sujets tels quels.' } },
  { label: { ar: 'من إعداد الفريق', fr: 'Rédigée par l’équipe' }, body: { ar: 'سؤال أصلي كتبه مختص في المادة انطلاقًا من البرنامج.', fr: 'Question originale rédigée par un spécialiste à partir du programme.' } },
  { label: { ar: 'مولّد آليًا ومراجَع', fr: 'Générée puis relue' }, body: { ar: 'سؤال اقترحه الذكاء الاصطناعي ثم مرّ بفحوص آلية ومراجعة بشرية قبل نشره.', fr: 'Question proposée par l’IA, passée par des contrôles automatiques puis une relecture humaine avant publication.' } },
  { label: { ar: 'خوارزمي', fr: 'Algorithmique' }, body: { ar: 'تمارين حساب ومنطق تُولّد بقواعد رياضية مضبوطة، فالإجابة صحيحة بالبناء.', fr: 'Exercices de calcul et de logique générés par des règles mathématiques : la réponse est juste par construction.' } },
];

const LABELS: { key: keyof typeof READINESS_LABEL_TEXT; rule: Bi }[] = [
  { key: 'EXCELLENT', rule: { ar: 'تحضير ≥ 80% وتغطية ≥ 80% وامتحانان تجريبيان على الأقل', fr: 'Préparation ≥ 80 %, couverture ≥ 80 % et au moins deux examens blancs' } },
  { key: 'GOOD', rule: { ar: 'تحضير ≥ 65% وتغطية ≥ 60%', fr: 'Préparation ≥ 65 % et couverture ≥ 60 %' } },
  { key: 'NEEDS_IMPROVEMENT', rule: { ar: 'تحضير ≥ 45% وتغطية ≥ 30%', fr: 'Préparation ≥ 45 % et couverture ≥ 30 %' } },
  { key: 'NOT_READY', rule: { ar: 'دون ذلك', fr: 'En dessous' } },
];

function readinessLabel(locale: Locale, key: keyof typeof READINESS_LABEL_TEXT): string {
  // READINESS_LABEL_TEXT has English in its `fr` slot; French wording is kept here.
  const fr: Record<keyof typeof READINESS_LABEL_TEXT, string> = { EXCELLENT: 'Préparation excellente', GOOD: 'Bonne préparation', NEEDS_IMPROVEMENT: 'À améliorer', NOT_READY: 'Pas encore prêt(e)' };
  return locale === 'fr' ? fr[key] : READINESS_LABEL_TEXT[key].ar;
}

export default async function MethodologyPage() {
  const locale = await getLocale();
  return (
    <>
      <PageHeader
        title={t(locale, { ar: 'كيف نتحقق من المعلومات', fr: 'Comment nous vérifions les informations' })}
        lead={t(locale, {
          ar: 'خطأ في السن الأقصى أو في آخر أجل قد يكلف مترشحًا سنة كاملة. لذلك نفضّل أن نقول «لا نعرف بعد» على أن نخمّن، ونعرض مصدر كل معلومة.',
          fr: 'Une erreur sur l’âge maximal ou la date limite peut coûter une année à un candidat. Nous préférons dire « nous ne savons pas encore » plutôt que deviner, et affichons la source de chaque information.',
        })}
      />
      <Container className="flex flex-col gap-12 py-8">
        <Section id="levels" title={t(locale, { ar: 'درجات الثقة', fr: 'Niveaux de confiance' })} lead={t(locale, { ar: 'هذه الشارات تظهر بجانب كل معلومة عن مناظرة.', fr: 'Ces badges accompagnent chaque information sur un concours.' })}>
          <ProvenanceLegend locale={locale} />
        </Section>

        <Section id="process" title={t(locale, { ar: 'مسار التحقق', fr: 'Processus de vérification' })}>
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PROCESS.map((s, i) => {
              const Icon = s.icon;
              return (
                <li key={i} className="card flex flex-col gap-2 p-4">
                  <span className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-bold text-primary-contrast">{i + 1}</span><Icon className="size-5 text-primary" aria-hidden /></span>
                  <h3 className="font-bold">{t(locale, s.title)}</h3>
                  <p className="text-sm text-muted">{t(locale, s.body)}</p>
                </li>
              );
            })}
          </ol>
        </Section>

        <Section id="ai" title={t(locale, { ar: 'سياسة الذكاء الاصطناعي', fr: 'Politique d’intelligence artificielle' })}>
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
            <p className="flex items-start gap-3 text-[15px]">
              <Bot className="mt-0.5 size-6 shrink-0 text-primary" aria-hidden />
              <strong>{t(locale, { ar: 'الذكاء الاصطناعي لا ينشر أي شيء. كل محتوى يمر بمراجعة بشرية قبل أن يراه المستعمل.', fr: 'L’IA ne publie rien. Tout contenu est relu par un humain avant d’être visible.' })}</strong>
            </p>
            <Prose>
              <ul>
                <li>{t(locale, { ar: 'نستعمله لاقتراح أسئلة تدريبية، ولاستخراج المعلومات من ملفات PDF الرسمية، ولشرح الأخطاء («اشرح لي»).', fr: 'Nous l’utilisons pour proposer des questions, extraire des informations des PDF officiels et expliquer les erreurs (« Explique-moi »).' })}</li>
                <li>{t(locale, { ar: 'كل اقتراح يبدأ «مسودة»، ثم فحوص آلية، ثم مراجعة بشرية، ثم النشر. المرور إلى «منشور» مستحيل تقنيًا دون مراجع بشري.', fr: 'Chaque proposition commence en brouillon, passe des contrôles automatiques, puis une relecture humaine avant publication. Le passage à « publié » est techniquement impossible sans relecteur humain.' })}</li>
                <li>{t(locale, { ar: 'المعلومات المستخرجة آليًا من البلاغات تُحفظ مع الاقتباس والصفحة، وتبقى «للتحقق» حتى يؤكدها إنسان.', fr: 'Les informations extraites automatiquement des avis sont stockées avec citation et page, et restent « À vérifier » jusqu’à confirmation humaine.' })}</li>
                <li>{t(locale, { ar: 'شروحات «اشرح لي» مولّدة لحظيًا وتذكر مصادرها؛ إن بدا لك شرح خاطئ أبلغ عنه.', fr: 'Les explications « Explique-moi » sont générées à la demande et citent leurs sources ; signalez toute explication douteuse.' })}</li>
              </ul>
            </Prose>
          </div>
        </Section>

        <Section id="questions" title={t(locale, { ar: 'أصل الأسئلة', fr: 'Origine des questions' })} lead={t(locale, { ar: 'كل سؤال يعرض أصله. لا «أسئلة مسربة» أبدًا.', fr: 'Chaque question affiche son origine. Jamais de « fuites ».' })}>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {ORIGINS.map((o, i) => (
              <li key={i} className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
                <span className="font-bold">{t(locale, o.label)}</span>
                <span className="text-sm text-muted">{t(locale, o.body)}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="syllabus" title={t(locale, { ar: 'البرنامج', fr: 'Programme' })} lead={t(locale, { ar: 'نادرًا ما تنشر الهياكل برنامجًا مفصلًا، لذلك نصنّف كل مادة حسب أصلها.', fr: 'Les organismes publient rarement un programme détaillé : chaque matière est classée selon son origine.' })}>
          <ul className="flex flex-wrap gap-2">
            {(Object.keys(SCOPE_LABELS) as (keyof typeof SCOPE_LABELS)[]).map((k) => (
              <li key={k}><Badge tone={SCOPE_LABELS[k].tone}>{t(locale, SCOPE_LABELS[k])}</Badge></li>
            ))}
          </ul>
        </Section>

        <Section id="readiness" title={t(locale, { ar: 'كيف نحسب مؤشر الجاهزية', fr: 'Comment l’indicateur de préparation est calculé' })}>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr]">
            <Prose>
              <ol>
                <li>{t(locale, { ar: 'الإتقان لكل موضوع: تقييم يرتفع أو ينخفض مع كل إجابة حسب صعوبة السؤال. مع عدد قليل من الإجابات، يُقرَّب التقييم من مستوى حذر حتى لا تمنحك ثلاث إجابات محظوظة إتقانًا وهميًا.', fr: 'Maîtrise par thème : une note qui monte ou baisse à chaque réponse selon la difficulté. Avec peu de réponses, elle est ramenée vers un niveau prudent, pour que trois réponses chanceuses ne donnent pas une fausse maîtrise.' })}</li>
                <li>{t(locale, { ar: 'نتيجة كل مادة: معدل إتقان مواضيعها، والمواضيع التي لم تتدرب عليها تُحتسب بمستوى ضعيف (20%) حتى يظهر إهمال مادة كاملة.', fr: 'Score par matière : moyenne de ses thèmes ; les thèmes jamais travaillés comptent à un niveau faible (20 %) pour qu’une matière négligée se voie.' })}</li>
                <li>{t(locale, { ar: 'الترجيح: كل مادة توزن بثقلها في الامتحان الحقيقي (الضارب أو عدد الأسئلة). إن لم تكن الصيغة الرسمية منشورة، نستعمل توزيعًا تقديريًا ونقول ذلك.', fr: 'Pondération : chaque matière pèse comme dans l’examen réel (coefficient ou nombre de questions). Si le format officiel n’est pas publié, la pondération est estimée et nous l’indiquons.' })}</li>
                <li>{t(locale, { ar: 'التغطية: يُعتبر الموضوع مغطى بعد 5 أسئلة على الأقل.', fr: 'Couverture : un thème est couvert après au moins 5 questions.' })}</li>
                <li>{t(locale, { ar: 'التحضير: دون امتحان تجريبي = 90% من نتيجة المعارف (تقديرية). مع امتحانات تجريبية = 60% معارف + 40% معدل آخر امتحانين تجريبيين.', fr: 'Préparation : sans examen blanc = 90 % du score de connaissances (indicatif). Avec examens blancs = 60 % connaissances + 40 % moyenne des deux derniers.' })}</li>
              </ol>
            </Prose>
            <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
              <p className="flex items-center gap-2 font-bold"><Gauge className="size-5 text-primary" aria-hidden />{t(locale, { ar: 'المستويات', fr: 'Niveaux' })}</p>
              <ul className="flex flex-col gap-2 text-sm">
                {LABELS.map((l) => (
                  <li key={l.key} className="flex flex-col rounded-xl bg-surface-2 p-3">
                    <span className="font-semibold">{readinessLabel(locale, l.key)}</span>
                    <span className="text-muted">{t(locale, l.rule)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-warning/30 bg-warning-soft p-4 text-sm">
            <p className="font-bold">{t(locale, { ar: 'حدود المؤشر', fr: 'Limites de l’indicateur' })}</p>
            <ul className="mt-2 list-disc space-y-1 ps-5">
              <li>{t(locale, { ar: 'ليس توقعًا لنتيجة المناظرة: لا يعرف عدد المترشحين ولا عدد الخطط ولا قرارات اللجان.', fr: 'Ce n’est pas une prédiction : il ignore le nombre de candidats, de postes et les décisions des jurys.' })}</li>
              <li>{t(locale, { ar: 'لا يقيس المراحل الأخرى (الرياضية، الشفاهية، الطبية، النفسية).', fr: 'Il ne mesure pas les autres épreuves (sport, oral, médical, psychologique).' })}</li>
              <li>{t(locale, { ar: 'يعتمد على بنك أسئلتنا الذي قد يختلف في صعوبته عن الامتحان الحقيقي.', fr: 'Il dépend de notre banque de questions, dont la difficulté peut différer de l’examen réel.' })}</li>
              <li>{t(locale, { ar: 'يصبح أدق كلما تدربت أكثر وأجريت امتحانات تجريبية.', fr: 'Il devient plus fiable à mesure que vous vous entraînez et passez des examens blancs.' })}</li>
            </ul>
          </div>
        </Section>

        <Section id="alerts" title={t(locale, { ar: 'كيف تعمل تنبيهات المطابقة', fr: 'Comment fonctionnent les alertes' })}>
          <Prose>
            <ul>
              <li>{t(locale, { ar: 'نقارن ملفك بشروط كل رتبة بنفس الخوارزمية المستعملة في صفحة «تحقق من أهليتك»، دون أي ذكاء اصطناعي.', fr: 'Votre profil est comparé aux conditions de chaque grade avec le même algorithme que « Vérifiez votre éligibilité », sans IA.' })}</li>
              <li>{t(locale, { ar: 'يُحسب السن في تاريخ آخر أجل للترشح عندما يكون معروفًا (النصوص الرسمية قد تعتمد مرجعًا آخر، لذا راجع البلاغ).', fr: 'L’âge est calculé à la date limite d’inscription lorsqu’elle est connue (les textes peuvent retenir une autre date : vérifiez l’avis).' })}</li>
              <li>{t(locale, { ar: 'ننبّهك إن كنت تستوفي الشروط، أو إن كانت معطيات ملفك ناقصة دون أن يفشل أي شرط — مع دعوة لإكمال ملفك. لا ننبّهك إن كان شرط واضح غير مستوفى.', fr: 'Vous êtes alerté(e) si vous remplissez les conditions, ou si votre profil est incomplet sans condition échouée — avec une invitation à le compléter. Jamais si une condition n’est clairement pas remplie.' })}</li>
              <li>{t(locale, { ar: 'لا يُرسل أي تنبيه عن دورة قبل أن يراجعها إنسان.', fr: 'Aucune alerte n’est envoyée pour une session avant relecture humaine.' })}</li>
            </ul>
            <p><Link href="/alerts">{t(locale, { ar: 'فعّل التنبيهات', fr: 'Activer les alertes' })}</Link></p>
          </Prose>
        </Section>

        <Section id="corrections" title={t(locale, { ar: 'التصحيحات والإبلاغ عن خطأ', fr: 'Corrections et signalements' })}>
          <Prose>
            <p>{t(locale, { ar: 'وجدت خطأ في سؤال؟ استعمل زر «أبلغ عن خطأ» تحت السؤال. يراجع فريقنا كل بلاغ، ونصحح السؤال أو نسحبه عند الحاجة.', fr: 'Une erreur dans une question ? Utilisez « Signaler une erreur » sous la question. Chaque signalement est examiné par l’équipe, qui corrige ou retire la question si nécessaire.' })}</p>
            <p>{t(locale, { ar: 'لديك البلاغ الرسمي لمناظرة أو معلومة أدق؟ أرسلها لنا مع رابط المصدر: نصحح المعلومة ونحدّث تاريخ آخر تحقق.', fr: 'Vous avez l’avis officiel d’un concours ou une information plus précise ? Envoyez-la-nous avec le lien de la source : nous corrigeons et mettons à jour la date de vérification.' })}</p>
            <ContactLine locale={locale} />
          </Prose>
        </Section>
      </Container>
    </>
  );
}
