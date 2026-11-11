import { describe, expect, it } from 'vitest';
import { analyticsEnabled } from './analytics';

describe('방문 통계', () => {
  it('운영 주소에서만 켠다', () => {
    expect(analyticsEnabled('modelll.app')).toBe(true);
    expect(analyticsEnabled('localhost')).toBe(false);
    expect(analyticsEnabled('127.0.0.1')).toBe(false);
    expect(analyticsEnabled('13-209-183-19.sslip.io')).toBe(false);
    expect(analyticsEnabled('evil-modelll.app')).toBe(false);
  });
});
