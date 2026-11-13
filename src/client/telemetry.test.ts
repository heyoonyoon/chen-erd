// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ANON_ID_PATTERN } from '../shared/telemetry';
import { anonId, entryKind, noteCreated, noteNavigation, resetTelemetryForTest, track } from './telemetry';

describe('클라이언트 지표', () => {
  beforeEach(() => {
    resetTelemetryForTest();
    localStorage.clear();
  });

  it('익명 ID는 128비트 16진수이고 이 브라우저에 남는다', () => {
    const id = anonId();
    expect(id).toMatch(ANON_ID_PATTERN);
    resetTelemetryForTest();
    expect(anonId()).toBe(id);
  });

  it('방에 들어온 경로를 가린다', () => {
    expect(entryKind('r1', false)).toBe('link');
    expect(entryKind('r1', true)).toBe('recent');
    noteNavigation();
    expect(entryKind('r1', false)).toBe('home');
    noteCreated('r2');
    expect(entryKind('r2', false)).toBe('new');
  });

  it('처음 연 이벤트에만 유입을 싣고, 개인정보는 싣지 않는다', async () => {
    const sent: string[] = [];
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: (_url: string, blob: Blob) => (void blob.text().then((t) => sent.push(t)), true) });
    track('home_view');
    track('create_click');
    await new Promise((r) => setTimeout(r, 0));
    vi.unstubAllGlobals();
    const [first, second] = sent.map((t) => JSON.parse(t));
    expect(first).toMatchObject({ e: 'home_view', land: 1, ref: 'direct' });
    expect(second.land).toBeUndefined();
    for (const key of Object.keys(first)) expect(['a', 'dev', 'e', 'land', 'lang', 'ref', 'utm']).toContain(key);
  });
});
