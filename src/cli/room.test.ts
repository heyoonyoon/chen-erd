import { describe, expect, it } from 'vitest';
import { ROOM_ID_PATTERN } from '../shared/types';
import { CliError } from './errors';
import { DEFAULT_SERVER, newRoomId, normalizeServer, parseRoomRef, resolveServer, roomUrl } from './room';

describe('resolveServer', () => {
  it('--server, MODELLL_SERVER, 기본 주소 순으로 고른다', () => {
    expect(resolveServer(undefined, {})).toBe('https://modelll.app');
    expect(resolveServer(undefined, { MODELLL_SERVER: 'http://localhost:18790' })).toBe('http://localhost:18790');
    expect(resolveServer('https://erd.example.com', { MODELLL_SERVER: 'http://localhost:18790' })).toBe('https://erd.example.com');
    expect(DEFAULT_SERVER).toBe('https://modelll.app');
  });

  it('주소를 origin으로 다듬는다', () => {
    expect(normalizeServer('https://modelll.app/')).toBe('https://modelll.app');
    expect(normalizeServer(' http://localhost:8787/r/abc ')).toBe('http://localhost:8787');
    // 스킴이 없으면 내 컴퓨터는 http, 나머지는 https로 본다
    expect(normalizeServer('localhost:8787')).toBe('http://localhost:8787');
    expect(normalizeServer('127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(normalizeServer('modelll.app')).toBe('https://modelll.app');
  });

  it('http(s)가 아닌 주소는 받지 않는다', () => {
    expect(() => normalizeServer('ftp://modelll.app')).toThrow(CliError);
    expect(() => normalizeServer('http://')).toThrow(CliError);
  });
});

describe('parseRoomRef', () => {
  const fallback = 'http://localhost:18790';

  it('id만 적으면 기본 서버를 쓴다', () => {
    expect(parseRoomRef('abc123', fallback)).toEqual({ server: fallback, roomId: 'abc123' });
    expect(parseRoomRef(' Room_1-x ', fallback)).toEqual({ server: fallback, roomId: 'Room_1-x' });
  });

  it('주소를 적으면 그 주소의 origin이 서버가 된다', () => {
    expect(parseRoomRef('https://modelll.app/r/abc123', fallback)).toEqual({ server: 'https://modelll.app', roomId: 'abc123' });
    expect(parseRoomRef('https://modelll.app/r/abc123/?x=1#top', fallback)).toEqual({ server: 'https://modelll.app', roomId: 'abc123' });
    expect(parseRoomRef('http://localhost:8787/r/k3m9p2', fallback)).toEqual({ server: 'http://localhost:8787', roomId: 'k3m9p2' });
    expect(parseRoomRef('modelll.app/r/abc123', fallback)).toEqual({ server: 'https://modelll.app', roomId: 'abc123' });
  });

  it('방을 가리키지 않는 값은 거절한다', () => {
    for (const bad of ['https://modelll.app/', 'https://modelll.app/abc123', 'https://modelll.app/r/', 'https://modelll.app/r/a.b', 'a/b', '한글', 'a b', '', 'x'.repeat(65)]) {
      expect(() => parseRoomRef(bad, fallback), bad).toThrow(CliError);
    }
  });

  it('roomUrl은 브라우저에서 여는 주소를 만든다', () => {
    expect(roomUrl({ server: 'https://modelll.app', roomId: 'abc123' })).toBe('https://modelll.app/r/abc123');
  });
});

describe('newRoomId', () => {
  it('웹 화면과 같은 글자 10개로 된 id를 만든다', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = newRoomId();
      expect(id).toMatch(/^[abcdefghijkmnpqrstuvwxyz23456789]{10}$/);
      expect(ROOM_ID_PATTERN.test(id)).toBe(true);
      ids.add(id);
    }
    expect(ids.size).toBe(200);
  });

  it('바이트를 글자표에 고르게 대응시킨다', () => {
    expect(newRoomId(() => Uint8Array.from([0, 1, 31, 32, 33, 63, 64, 255, 10, 20]))).toBe('ab9ab9a9kw');
  });
});
