'use client';

import { useEffect, useState } from 'react';
import { CalendarPlus, Download } from 'lucide-react';
import type { Field } from '@ctn/shared';
import { useT } from '@/components/providers';
import { track } from './track';

const link = 'inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-semibold hover:bg-surface-2';

/**
 * Subscribe to the concours calendar (iCalendar feed served by the API): phone calendar (webcal),
 * Google Calendar, or a one-off .ics download. Unverified dates are flagged in the event titles by the API.
 */
export function CalendarSubscribe({ familySlug, field }: { familySlug?: string; field?: Field | null }) {
  const tr = useT();
  const [host, setHost] = useState<string | null>(null);
  useEffect(() => setHost(window.location.host), []);

  const params = new URLSearchParams();
  if (familySlug) params.set('familySlug', familySlug);
  if (field) params.set('field', field);
  const qs = params.toString();
  const path = `/api/catalog/editions.ics${qs ? `?${qs}` : ''}`;
  const webcal = host ? `webcal://${host}${path}` : null;
  const google = webcal ? `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}` : null;
  const props = { familySlug: familySlug ?? null, field: field ?? null };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {webcal && (
        <a href={webcal} className={link} onClick={() => track('calendar_subscribe', { ...props, via: 'webcal' })}>
          <CalendarPlus className="size-4" aria-hidden />
          {tr({ ar: 'أضف إلى رزنامة هاتفي', fr: 'Ajouter à mon agenda' })}
        </a>
      )}
      {google && (
        <a href={google} target="_blank" rel="noopener noreferrer" className={link} onClick={() => track('calendar_subscribe', { ...props, via: 'google' })}>
          <CalendarPlus className="size-4" aria-hidden />
          Google Agenda
        </a>
      )}
      <a href={path} download className={link} onClick={() => track('calendar_subscribe', { ...props, via: 'ics' })}>
        <Download className="size-4" aria-hidden />
        {tr({ ar: 'تنزيل ملف ‎.ics', fr: 'Télécharger le fichier .ics' })}
      </a>
    </div>
  );
}
