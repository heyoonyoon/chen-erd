import { describe, expect, it } from 'vitest';
import { formatStars } from './githubStars';

describe('formatStars', () => {
  it('천 미만은 그대로 적는다', () => {
    expect(formatStars(0)).toBe('0');
    expect(formatStars(7)).toBe('7');
    expect(formatStars(999)).toBe('999');
  });

  it('천 이상은 k로 줄이고 소수 첫째 자리 아래는 버린다', () => {
    expect(formatStars(1000)).toBe('1k');
    expect(formatStars(1234)).toBe('1.2k');
    expect(formatStars(1999)).toBe('1.9k');
    expect(formatStars(12000)).toBe('12k');
    expect(formatStars(121500)).toBe('121.5k');
  });

  it('숫자가 아니거나 음수면 0으로 적는다', () => {
    expect(formatStars(-3)).toBe('0');
    expect(formatStars(Number.NaN)).toBe('0');
    expect(formatStars(Number.POSITIVE_INFINITY)).toBe('0');
  });
});
