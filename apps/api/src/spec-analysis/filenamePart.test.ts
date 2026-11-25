import { describe, expect, it } from 'vitest';
import { partNumberFromFilename } from './filenamePart.js';

describe('partNumberFromFilename', () => {
  it.each([
    ['P01273549.pdf', 'P01273549'],
    ['p01273549.PDF', 'P01273549'],
    ['P01273549 rev A.pdf', 'P01273549'],
    ['SEPL-P01273549.pdf', 'P01273549'],
    ['drawing_P01273550_final.png', 'P01273550'],
  ])('finds the code-like part number in %s', (file, expected) => {
    expect(partNumberFromFilename(file)).toBe(expected);
  });

  it('falls back to a bare long digit run', () => {
    expect(partNumberFromFilename('spec 12345678 v2.pdf')).toBe('12345678');
  });

  it('uses a single id-like token containing a digit', () => {
    expect(partNumberFromFilename('NEWPART-99001.pdf')).toBe('NEWPART-99001'.toUpperCase());
  });

  it('returns null when nothing looks like a part number', () => {
    expect(partNumberFromFilename('drawing.pdf')).toBeNull();
    expect(partNumberFromFilename('.pdf')).toBeNull();
  });
});
