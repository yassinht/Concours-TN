import { describe, expect, it } from 'vitest';
import { ageAt, ageRangeText, checkEligibility, shouldAlert } from './eligibility';
import { READINESS_LABEL_TEXT } from './enums';
import { buildDailyPlan, computeReadiness, gradeAnswer, levelFromXp, shrunkMastery, updateRating, updateStreak } from './learning';

describe('eligibility', () => {
  const rules = { min_age: 20, max_age: 24, genders: ['M' as const], min_diploma: 'SECONDARY' as const, min_height_cm_male: 170 };
  it('computes age at reference date', () => {
    expect(ageAt('2000-06-15', '2024-06-14')).toBe(23);
    expect(ageAt('2000-06-15', '2024-06-15')).toBe(24);
  });
  it('eligible profile', () => {
    const r = checkEligibility(rules, { birth_date: '2003-01-01', gender: 'M', diploma_level: 'BAC', height_cm: 175 }, '2026-01-01');
    expect(r.status).toBe('ELIGIBLE');
  });
  it('fails on age and gender', () => {
    const r = checkEligibility(rules, { birth_date: '1990-01-01', gender: 'F', diploma_level: 'BAC', height_cm: 175 }, '2026-01-01');
    expect(r.status).toBe('NOT_ELIGIBLE');
    expect(r.checks.filter((c) => c.status === 'FAIL').map((c) => c.code).sort()).toEqual(['AGE', 'GENDER']);
    expect(shouldAlert(r)).toBe(false);
  });
  it('partial when profile incomplete, still alertable', () => {
    const r = checkEligibility(rules, { gender: 'M' }, '2026-01-01');
    expect(r.status).toBe('PARTIAL');
    expect(shouldAlert(r)).toBe(true);
  });
  it('diploma at least', () => {
    expect(checkEligibility({ min_diploma: 'LICENCE' }, { diploma_level: 'MASTER' }, '2026-01-01').status).toBe('ELIGIBLE');
    expect(checkEligibility({ min_diploma: 'LICENCE' }, { diploma_level: 'BAC' }, '2026-01-01').status).toBe('NOT_ELIGIBLE');
  });
});

describe('grading', () => {
  it('mcq single/multi', () => {
    expect(gradeAnswer('MCQ_SINGLE', ['b'], ['b'])).toBe(true);
    expect(gradeAnswer('MCQ_SINGLE', ['b'], ['a'])).toBe(false);
    expect(gradeAnswer('MCQ_MULTI', ['a', 'c'], ['c', 'a'])).toBe(true);
    expect(gradeAnswer('MCQ_MULTI', ['a', 'c'], ['a'])).toBe(false);
  });
  it('numeric with tolerance', () => {
    expect(gradeAnswer('NUMERIC', { value: 12.5, tolerance: 0.1 }, { value: 12.45 })).toBe(true);
    expect(gradeAnswer('NUMERIC', { value: 12.5 }, { value: 12 })).toBe(false);
  });
  it('matching & ordering', () => {
    expect(gradeAnswer('MATCHING', { pairs: [['l1', 'r2'], ['l2', 'r1']] }, { pairs: [['l2', 'r1'], ['l1', 'r2']] })).toBe(true);
    expect(gradeAnswer('ORDERING', { order: ['c', 'a', 'b'] }, { order: ['c', 'a', 'b'] })).toBe(true);
    expect(gradeAnswer('ORDERING', { order: ['c', 'a', 'b'] }, { order: ['a', 'c', 'b'] })).toBe(false);
  });
});

describe('learning', () => {
  it('rating moves toward performance and mastery is shrunk', () => {
    const up = updateRating(1000, 1000, true, 0);
    expect(up.user).toBeGreaterThan(1000);
    expect(shrunkMastery(1300, 2)).toBeLessThan(0.6);
    expect(shrunkMastery(1300, 200)).toBeGreaterThan(0.85);
  });
  it('readiness labels are conservative without mocks', () => {
    const r = computeReadiness({
      topics: [{ topicId: 't1', domain: 'FRENCH', rating: 1400, attempts: 100 }],
      weights: [{ domain: 'FRENCH', weight: 1, topicCount: 1 }],
      mockScores: [],
      formatOfficial: false,
    });
    expect(r.label).not.toBe('EXCELLENT');
    expect(r.reasons.length).toBeGreaterThan(0);
  });
  it('daily plan fits the budget', () => {
    const items = buildDailyPlan({
      topics: [
        { topicId: 'a', domain: 'FRENCH', title: 'A', examWeight: 0.4, mastery: 0.3, dueForReview: false, daysSinceSeen: 3 },
        { topicId: 'b', domain: 'LOGIC', title: 'B', examWeight: 0.3, mastery: 0.8, dueForReview: true, daysSinceSeen: 5 },
        { topicId: 'c', domain: 'CULTURE_GENERALE', title: 'C', examWeight: 0.3, mastery: 0.5, dueForReview: false, daysSinceSeen: null },
      ],
      dailyMinutes: 30, daysToExam: 60, dayOfWeek: 1, mistakesPending: 4,
    });
    const total = items.reduce((a, i) => a + i.minutes, 0);
    expect(total).toBeLessThanOrEqual(40);
    expect(items.some((i) => i.kind === 'PRACTICE')).toBe(true);
  });
  it('levels and streaks', () => {
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(150).level).toBe(2);
    const s = updateStreak({ current: 3, longest: 5, lastActive: '2026-10-06', freezes: 0 }, '2026-10-07');
    expect(s.current).toBe(4);
    const broken = updateStreak({ current: 3, longest: 5, lastActive: '2026-10-01', freezes: 0 }, '2026-10-07');
    expect(broken.current).toBe(1);
  });
  it('plan items carry bilingual titles and the topic key', () => {
    const items = buildDailyPlan({
      topics: [{ topicId: 'a', topicKey: 'fr.grammaire', domain: 'FRENCH', title: 'Grammaire', title_ar: 'القواعد', title_fr: 'Grammaire', examWeight: 1, mastery: 0.2, dueForReview: true, daysSinceSeen: null }],
      dailyMinutes: 40, daysToExam: 60, dayOfWeek: 1, mistakesPending: 3,
    });
    const mistakes = items.find((i) => i.kind === 'MISTAKES')!;
    expect(mistakes.title_fr).toBe('Revoir mes erreurs');
    expect(mistakes.title_ar).toBe('مراجعة الأخطاء');
    const practice = items.find((i) => i.kind === 'PRACTICE')!;
    expect(practice).toEqual(expect.objectContaining({ topicKey: 'fr.grammaire', title_ar: 'القواعد', title_fr: 'Grammaire' }));
  });
});

describe('wording', () => {
  it('describes age conditions without dangling dashes', () => {
    expect(ageRangeText(null, 27).fr).toBe('27 ans au plus');
    expect(ageRangeText(18, null).ar).toBe('18 سنة على الأقل');
    expect(ageRangeText(20, 35).fr).toBe('de 20 à 35 ans');
    const r = checkEligibility({ max_age: 27 }, { birth_date: '1990-01-01' }, '2026-10-07');
    expect(r.checks[0].message_fr).not.toContain('—');
  });
  it('readiness labels and reasons are French in the fr field', () => {
    expect(READINESS_LABEL_TEXT.EXCELLENT.fr).toBe('Excellente préparation');
    const r = computeReadiness({
      topics: [{ topicId: 't', domain: 'NUMERICAL', rating: 700, attempts: 30 }],
      weights: [{ domain: 'NUMERICAL', weight: 1, topicCount: 1 }], mockScores: [], formatOfficial: true,
    });
    expect(r.reasons.some((x) => x.fr.includes('Calcul') && x.ar.includes('الحساب'))).toBe(true);
    expect(r.reasons.some((x) => x.fr.includes('NUMERICAL'))).toBe(false);
  });
});
