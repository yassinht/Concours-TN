import type { EditionDTO } from '@ctn/shared';

/** RFC 5545 text escaping. */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds a content line at 75 octets without splitting UTF-8 characters (Arabic is multi-byte). */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8');
    const limit = out.length ? 74 : 75; // continuation lines start with a space
    if (bytes + b > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const ymd = (iso: string) => iso.replace(/-/g, '');
function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * iCalendar feed of registration openings, deadlines and exam dates — all-day events with a reminder.
 * Unverified dates are labelled "À vérifier / للتحقق" in the title so they are never mistaken for official ones.
 */
export function editionsToIcs(editions: EditionDTO[], appUrl: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Concours TN//Calendrier des concours//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Concours TN', 'X-WR-TIMEZONE:Africa/Tunis',
  ];
  for (const e of editions) {
    const flag = e.needsVerification ? ' (À vérifier / للتحقق)' : '';
    const url = `${appUrl.replace(/\/$/, '')}/concours/${encodeURIComponent(e.familySlug)}`;
    const descParts = [
      e.sessionLabel ?? `${e.familyName_fr} ${e.year}`,
      e.source ? `Source : ${e.source.title}${e.source.url ? ` — ${e.source.url}` : ''}` : 'Source : non confirmée',
      e.needsVerification ? 'Information à vérifier auprès de la source officielle. / معلومة للتحقق من المصدر الرسمي.' : '',
      url,
    ].filter(Boolean);
    const events: { key: string; date: string | null; label: string }[] = [
      { key: 'open', date: e.registrationOpen, label: 'Ouverture des inscriptions / فتح باب الترشح' },
      { key: 'deadline', date: e.registrationDeadline, label: 'Clôture des inscriptions / آخر أجل للترشح' },
      { key: 'exam', date: e.examDate, label: 'Épreuves / الاختبارات' },
    ];
    for (const ev of events) {
      if (!ev.date) continue;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${e.id}-${ev.key}@concours-tn`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${ymd(ev.date)}`,
        `DTEND;VALUE=DATE:${ymd(nextDay(ev.date))}`,
        `SUMMARY:${esc(`${ev.label} — ${e.familyName_fr} / ${e.familyName_ar}${flag}`)}`,
        `DESCRIPTION:${esc(descParts.join('\n'))}`,
        `URL:${url}`,
        'TRANSP:TRANSPARENT',
        ...(ev.key === 'open' ? [] : ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(ev.label)}`, `TRIGGER:-P${ev.key === 'deadline' ? 2 : 1}D`, 'END:VALARM']),
        'END:VEVENT',
      );
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
