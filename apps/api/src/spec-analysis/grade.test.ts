import { describe, expect, it } from 'vitest';
import { isPlaceholderGrade, matchGrade, normGrade } from './grade.js';

const G = (...codes: string[]) => codes.map((gradeCode, i) => ({ id: i + 1, gradeCode }));
const code = (text: string | null, grades: ReturnType<typeof G>) => matchGrade(text, grades)?.gradeCode ?? null;

describe('isPlaceholderGrade', () => {
  it.each(['AS PER BOM', 'as per standard', 'TBD', 'N/A', 'NA', 'REFER BOM', 'Not specified', '', '   ', null, undefined])(
    'treats %j as "no grade named"',
    (t) => expect(isPlaceholderGrade(t)).toBe(true)
  );
  it.each(['304L SS', 'EN8', 'SS316', 'C45', 'EN19', 'NORMALISED 18CRNIMO7-6', 'STAINLESS 316L'])(
    'treats %j as a real grade',
    (t) => expect(isPlaceholderGrade(t)).toBe(false)
  );
});

describe('normGrade', () => {
  it('keeps letters and digits only, upper-cased', () => expect(normGrade('en-8 d')).toBe('EN8D'));
});

describe('matchGrade', () => {
  const grades = G('EN8', 'EN19', 'EN24', '304L', '316L', 'SS316', 'C45', '20MNCR5');

  it('matches ignoring case, spaces and punctuation', () => {
    expect(code('en 8', grades)).toBe('EN8');
    expect(code('EN-19', grades)).toBe('EN19');
    expect(code('c45', grades)).toBe('C45');
  });

  it('matches a grade written with a family word: "304L SS" -> 304L', () => {
    expect(code('304L SS', grades)).toBe('304L');
    expect(code('SS 304L', grades)).toBe('304L');
    expect(code('304L STAINLESS STEEL', grades)).toBe('304L');
  });

  it('matches the master code when the drawing adds extra words', () => {
    expect(code('EN24 HARDENED & TEMPERED', grades)).toBe('EN24');
    expect(code('MATERIAL: 20MnCr5 CASE HARDEN', grades)).toBe('20MNCR5');
  });

  it('prefers an exact match over a partial one', () => {
    expect(code('SS316', grades)).toBe('SS316');
    expect(code('316L', grades)).toBe('316L');
  });

  it('picks the longest code contained in the text', () => {
    expect(code('EN19 + EN8', G('EN19', 'EN8'))).toBe('EN19');
  });

  it('refuses to guess between equally good candidates', () => {
    expect(code('EN24 OR EN19', G('EN24', 'EN19'))).toBeNull();
  });

  it('returns null for placeholders, empty text and unknown grades', () => {
    expect(code('AS PER BOM', grades)).toBeNull();
    expect(code(null, grades)).toBeNull();
    expect(code('', grades)).toBeNull();
    expect(code('TITANIUM GR5', grades)).toBeNull();
  });

  it('ignores very short master codes so "A" or "S" never match inside a word', () => {
    expect(code('ALUMINIUM', G('A', 'S', 'AL'))).toBeNull();
  });

  it('works with an empty master list', () => {
    expect(code('EN8', [])).toBeNull();
  });
});
