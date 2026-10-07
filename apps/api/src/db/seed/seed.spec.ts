import { checkEligibility } from '@ctn/shared';
import { mapEligibility } from './eligibility';
import { InvalidItem, bilingual, intIn, isoDate, oneOf } from './normalize';
import { validateAnswer } from './questions';

describe('seed normalizers', () => {
  it('parses dates strictly and ranges leniently', () => {
    const warns: string[] = [];
    const warn = (m: string) => warns.push(m);
    expect(isoDate('2026-02-30', warn)).toBeNull();
    expect(isoDate('2026-03-15T10:00:00Z')).toBe('2026-03-15');
    expect(intIn('24', 14, 70)).toBe(24);
    expect(intIn(300, 14, 70, warn)).toBeNull();
    expect(oneOf('medium', ['HIGH', 'MEDIUM', 'LOW'] as const, 'LOW')).toBe('MEDIUM');
    expect(oneOf('bogus', ['HIGH', 'MEDIUM', 'LOW'] as const, 'LOW', warn)).toBe('LOW');
    expect(warns.length).toBe(3);
    expect(bilingual('عربي', null, 'name')).toEqual({ ar: 'عربي', fr: 'عربي' });
    expect(() => bilingual('', null, 'name')).toThrow(InvalidItem);
  });
});

describe('mapEligibility', () => {
  const noop = () => undefined;

  it('treats a single diploma equal to the position level as a minimum', () => {
    const rules = mapEligibility({ diplomas: ['SECONDARY'], min_age: 20, max_age: 24, genders: ['M'], min_height_cm_male: 170, needs_verification: false }, 'SECONDARY', noop);
    expect(rules.min_diploma).toBe('SECONDARY');
    expect(rules.diplomas).toBeNull();
    // A bac holder satisfies "4th year of secondary completed".
    const r = checkEligibility(rules, { birth_date: '2004-05-01', gender: 'M', diploma_level: 'BAC', height_cm: 178 }, '2026-01-01');
    expect(r.status).toBe('ELIGIBLE');
    expect(r.rules_unverified).toBe(false);
  });

  it('keeps an explicit multi-diploma list and maps marital status / genders', () => {
    const rules = mapEligibility({ diplomas: ['MASTER', 'ENGINEER'], marital_status: 'célibataire', genders: ['M', 'F', 'X'] }, 'MASTER', noop);
    expect(rules.diplomas).toEqual(['MASTER', 'ENGINEER']);
    expect(rules.min_diploma).toBeNull();
    expect(rules.marital_status).toBe('SINGLE');
    expect(rules.genders).toEqual(['M', 'F']);
    expect(rules.needs_verification).toBe(true);
  });

  it('swaps inverted age bounds', () => {
    const rules = mapEligibility({ min_age: 35, max_age: 18 }, 'BAC', noop);
    expect([rules.min_age, rules.max_age]).toEqual([18, 35]);
  });
});

describe('validateAnswer', () => {
  const opts = [{ id: 'a', text: '1' }, { id: 'b', text: '2' }];

  it('accepts well-formed answers of every type', () => {
    expect(validateAnswer('MCQ_SINGLE', opts, ['b'], 'fr').correct).toEqual(['b']);
    expect(validateAnswer('MCQ_MULTI', opts, ['a', 'b'], 'fr').correct).toEqual(['a', 'b']);
    expect(validateAnswer('TRUE_FALSE', [], true, 'ar')).toEqual({ options: [{ id: 'true', text: 'صحيح' }, { id: 'false', text: 'خطأ' }], correct: ['true'] });
    expect(validateAnswer('NUMERIC', [], { value: '4,5' }, 'fr').correct).toEqual({ value: 4.5, tolerance: 0 });
    expect(validateAnswer('ORDERING', opts, { order: ['b', 'a'] }, 'fr').correct).toEqual({ order: ['b', 'a'] });
    const m = [{ id: 'l1', text: 'A', side: 'left' }, { id: 'l2', text: 'B', side: 'left' }, { id: 'r1', text: '1', side: 'right' }, { id: 'r2', text: '2', side: 'right' }];
    expect(validateAnswer('MATCHING', m, { pairs: [['l1', 'r2'], ['l2', 'r1']] }, 'fr').correct).toEqual({ pairs: [['l1', 'r2'], ['l2', 'r1']] });
  });

  it('rejects inconsistent answers', () => {
    expect(() => validateAnswer('MCQ_SINGLE', opts, ['a', 'b'], 'fr')).toThrow(InvalidItem);
    expect(() => validateAnswer('MCQ_SINGLE', opts, ['z'], 'fr')).toThrow(/unknown option/);
    expect(() => validateAnswer('MCQ_SINGLE', [{ id: 'a', text: '1' }, { id: 'a', text: '2' }], ['a'], 'fr')).toThrow(/duplicate/);
    expect(() => validateAnswer('ORDERING', opts, { order: ['a'] }, 'fr')).toThrow(/permutation/);
    expect(() => validateAnswer('NUMERIC', [], { value: 'x' }, 'fr')).toThrow(InvalidItem);
    expect(() => validateAnswer('MATCHING', opts, { pairs: [] }, 'fr')).toThrow(/side/);
  });
});
