import { describe, expect, it } from 'vitest';
import { extractRoomId, relativeTime } from './homeUtils';

describe('extractRoomId', () => {
  it('방 코드만 적으면 그대로 돌려준다', () => {
    expect(extractRoomId('abc234xyz9')).toBe('abc234xyz9');
    expect(extractRoomId('  My_Room-1  ')).toBe('My_Room-1');
  });

  it('전체 주소에서 id를 뽑는다', () => {
    expect(extractRoomId('https://erd.example.com/r/abc234xyz9')).toBe('abc234xyz9');
    expect(extractRoomId('http://localhost:5173/r/abc234xyz9/')).toBe('abc234xyz9');
    expect(extractRoomId('https://erd.example.com/r/abc234xyz9?from=kakao')).toBe('abc234xyz9');
    expect(extractRoomId('https://erd.example.com/r/abc234xyz9#top')).toBe('abc234xyz9');
    expect(extractRoomId('https://erd.example.com/r/abc234xyz9/?a=1#b')).toBe('abc234xyz9');
  });

  it('주소 앞부분이 빠져도 받는다', () => {
    expect(extractRoomId('erd.example.com/r/abc234xyz9')).toBe('abc234xyz9');
    expect(extractRoomId('/r/abc234xyz9')).toBe('abc234xyz9');
    expect(extractRoomId('r/abc234xyz9')).toBe('abc234xyz9');
  });

  it('id가 r인 방도 구분한다', () => {
    expect(extractRoomId('r')).toBe('r');
    expect(extractRoomId('https://erd.example.com/r/r')).toBe('r');
  });

  it('형식에 맞지 않으면 null', () => {
    expect(extractRoomId('')).toBeNull();
    expect(extractRoomId('   ')).toBeNull();
    expect(extractRoomId('방 코드')).toBeNull();
    expect(extractRoomId('abc def')).toBeNull();
    expect(extractRoomId('a'.repeat(65))).toBeNull();
    expect(extractRoomId('https://erd.example.com/')).toBeNull();
    expect(extractRoomId('https://erd.example.com/r/')).toBeNull();
    expect(extractRoomId('https://erd.example.com/r/abc/extra')).toBeNull();
    expect(extractRoomId('https://erd.example.com/room/abc234xyz9')).toBeNull();
    expect(extractRoomId('https://erd.example.com/r/한글방')).toBeNull();
    expect(extractRoomId(`https://erd.example.com/r/${'a'.repeat(65)}`)).toBeNull();
  });
});

describe('relativeTime', () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  // 시간대에 상관없이 같은 결과가 나오도록 현지 시각으로 만든다
  const now = new Date(2026, 10, 11, 15, 0, 0).getTime();

  it('1분이 안 되면 방금 전', () => {
    expect(relativeTime(now, now)).toBe('방금 전');
    expect(relativeTime(now - 59_999, now)).toBe('방금 전');
  });

  it('미래로 찍힌 값도 방금 전', () => {
    expect(relativeTime(now + 5 * MIN, now)).toBe('방금 전');
  });

  it('분, 시간, 일 단위', () => {
    expect(relativeTime(now - MIN, now)).toBe('1분 전');
    expect(relativeTime(now - 59 * MIN - 59_000, now)).toBe('59분 전');
    expect(relativeTime(now - HOUR, now)).toBe('1시간 전');
    expect(relativeTime(now - 23 * HOUR - 59 * MIN, now)).toBe('23시간 전');
    expect(relativeTime(now - DAY, now)).toBe('1일 전');
    expect(relativeTime(now - 7 * DAY + 1, now)).toBe('6일 전');
  });

  it('일주일이 넘으면 날짜', () => {
    expect(relativeTime(new Date(2026, 10, 4, 15, 0, 0).getTime(), now)).toBe('11월 4일');
    expect(relativeTime(new Date(2026, 0, 2, 9, 0, 0).getTime(), now)).toBe('1월 2일');
  });

  it('해가 다르면 연도를 붙인다', () => {
    expect(relativeTime(new Date(2025, 11, 31, 23, 0, 0).getTime(), now)).toBe('2025년 12월 31일');
  });

  it('올바르지 않은 값은 빈 문자열', () => {
    expect(relativeTime(Number.NaN, now)).toBe('');
    expect(relativeTime(undefined as unknown as number, now)).toBe('');
  });
});
