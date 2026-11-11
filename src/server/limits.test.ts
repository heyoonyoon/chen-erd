import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { ClientLimits, clientIp, isPrivateAddress } from './limits';

function request(remoteAddress: string, forwarded?: string): IncomingMessage {
  return {
    socket: { remoteAddress },
    headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
  } as unknown as IncomingMessage;
}

describe('ClientLimits', () => {
  it('동시 연결 수를 주소별로 센다', () => {
    const limits = new ClientLimits({ maxConnectionsPerIp: 2 });
    expect(limits.acquire('1.1.1.1')).toBe(true);
    expect(limits.acquire('1.1.1.1')).toBe(true);
    expect(limits.acquire('1.1.1.1')).toBe(false);
    expect(limits.acquire('2.2.2.2')).toBe(true);
    limits.release('1.1.1.1');
    expect(limits.acquire('1.1.1.1')).toBe(true);
  });

  it('한도가 0이면 연결을 막지 않는다', () => {
    const limits = new ClientLimits();
    for (let i = 0; i < 100; i++) expect(limits.acquire('1.1.1.1')).toBe(true);
  });

  it('새 방은 정해진 시간에 하나만 만들 수 있다', () => {
    let now = 1_000_000;
    const limits = new ClientLimits({ roomCreateIntervalMs: 60_000, now: () => now });
    expect(limits.tryCreateRoom('1.1.1.1', 'room-a')).toBe(true);
    expect(limits.tryCreateRoom('1.1.1.1', 'room-b')).toBe(false);
    // 다른 주소는 따로 센다
    expect(limits.tryCreateRoom('2.2.2.2', 'room-c')).toBe(true);
    // 방금 만든 방에 다시 들어오는 것은 막지 않고, 기다리는 시간도 늘리지 않는다
    now += 30_000;
    expect(limits.tryCreateRoom('1.1.1.1', 'room-a')).toBe(true);
    now += 30_000;
    expect(limits.tryCreateRoom('1.1.1.1', 'room-b')).toBe(true);
    expect(limits.tryCreateRoom('1.1.1.1', 'room-d')).toBe(false);
  });
});

describe('clientIp', () => {
  it('인터넷에서 바로 온 요청은 X-Forwarded-For를 믿지 않는다', () => {
    expect(clientIp(request('8.8.8.8', '1.2.3.4'))).toBe('8.8.8.8');
  });

  it('프록시를 거친 요청은 X-Forwarded-For의 마지막 값을 쓴다', () => {
    expect(clientIp(request('172.18.0.3', '9.9.9.9, 1.2.3.4'))).toBe('1.2.3.4');
    expect(clientIp(request('::ffff:127.0.0.1', '1.2.3.4'))).toBe('1.2.3.4');
  });

  it('헤더가 없으면 연결한 주소를 쓴다', () => {
    expect(clientIp(request('::ffff:10.0.0.7'))).toBe('10.0.0.7');
  });

  it('사설망 주소를 가려낸다', () => {
    for (const addr of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.0.1', '172.31.255.1', '::1', 'fd00::1']) {
      expect(isPrivateAddress(addr), addr).toBe(true);
    }
    for (const addr of ['8.8.8.8', '172.32.0.1', '13.209.183.19', '2001:db8::1']) {
      expect(isPrivateAddress(addr), addr).toBe(false);
    }
  });
});
