import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOAST_DURATION, toast, useToasts } from './toast';

describe('toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToasts.getState().clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('알림을 쌓고 시간이 지나면 지운다', () => {
    toast('링크를 복사했습니다');
    toast('실패했습니다', 'error');
    expect(useToasts.getState().items.map((t) => [t.message, t.kind])).toEqual([
      ['링크를 복사했습니다', 'info'],
      ['실패했습니다', 'error'],
    ]);

    vi.advanceTimersByTime(TOAST_DURATION.info);
    expect(useToasts.getState().items.map((t) => t.message)).toEqual(['실패했습니다']);

    vi.advanceTimersByTime(TOAST_DURATION.error - TOAST_DURATION.info);
    expect(useToasts.getState().items).toEqual([]);
  });

  it('error는 info보다 오래 떠 있다', () => {
    expect(TOAST_DURATION.error).toBeGreaterThan(TOAST_DURATION.info);
    toast('오류', 'error');
    vi.advanceTimersByTime(TOAST_DURATION.error - 1);
    expect(useToasts.getState().items).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToasts.getState().items).toHaveLength(0);
  });

  it('같은 알림은 쌓지 않고 새것으로 바꾸며, 새것의 시간은 다시 센다', () => {
    toast('저장했습니다');
    vi.advanceTimersByTime(2000);
    toast('저장했습니다');
    expect(useToasts.getState().items).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(useToasts.getState().items).toHaveLength(1);
    vi.advanceTimersByTime(TOAST_DURATION.info);
    expect(useToasts.getState().items).toHaveLength(0);
  });

  it('너무 많이 쌓이면 오래된 것부터 지운다', () => {
    for (let i = 0; i < 7; i++) toast(`알림 ${i}`);
    const messages = useToasts.getState().items.map((t) => t.message);
    expect(messages).toHaveLength(4);
    expect(messages[messages.length - 1]).toBe('알림 6');
  });
});
