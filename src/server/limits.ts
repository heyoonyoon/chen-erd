/**
 * 접속 제한. 한 IP가 동시에 열 수 있는 연결 수와 새 방을 만드는 빈도를 막는다.
 * 닫기 코드는 4400~4499라서 y-websocket 클라이언트가 다시 접속을 시도하지 않는다.
 */
import type { IncomingMessage } from 'node:http';

export const CLOSE_TOO_MANY_CONNECTIONS = 4429;
export const CLOSE_ROOM_RATE_LIMIT = 4430;

export interface ClientLimitOptions {
  /** IP당 동시 연결 수. 0 이하면 제한하지 않는다 */
  maxConnectionsPerIp?: number;
  /** 같은 IP가 새 방을 다시 만들 수 있기까지의 시간. 0 이하면 제한하지 않는다 */
  roomCreateIntervalMs?: number;
  now?: () => number;
}

export class ClientLimits {
  readonly maxConnectionsPerIp: number;
  readonly roomCreateIntervalMs: number;
  private readonly now: () => number;
  private readonly connections = new Map<string, number>();
  /** IP별 마지막으로 새 방을 만든 시각과 그 방 */
  private readonly created = new Map<string, { at: number; roomId: string }>();

  constructor(opts: ClientLimitOptions = {}) {
    this.maxConnectionsPerIp = opts.maxConnectionsPerIp ?? 0;
    this.roomCreateIntervalMs = opts.roomCreateIntervalMs ?? 0;
    this.now = opts.now ?? Date.now;
  }

  /** 연결 하나를 잡는다. 한도를 넘으면 false */
  acquire(ip: string): boolean {
    const count = this.connections.get(ip) ?? 0;
    if (this.maxConnectionsPerIp > 0 && count >= this.maxConnectionsPerIp) return false;
    this.connections.set(ip, count + 1);
    return true;
  }

  release(ip: string): void {
    const count = (this.connections.get(ip) ?? 0) - 1;
    if (count > 0) this.connections.set(ip, count);
    else this.connections.delete(ip);
  }

  get roomRateLimited(): boolean {
    return this.roomCreateIntervalMs > 0;
  }

  /**
   * 새 방을 만들어도 되는지 보고, 되면 기록한다.
   * 방금 만든 같은 방에 다시 들어오는 것(새로 고침)은 새 방으로 세지 않는다.
   */
  tryCreateRoom(ip: string, roomId: string): boolean {
    if (!this.roomRateLimited) return true;
    const now = this.now();
    this.prune(now);
    const last = this.created.get(ip);
    if (last && last.roomId !== roomId && now - last.at < this.roomCreateIntervalMs) return false;
    if (!last || last.roomId !== roomId) this.created.set(ip, { at: now, roomId });
    return true;
  }

  private prune(now: number): void {
    if (this.created.size < 10_000) return;
    for (const [ip, entry] of this.created) {
      if (now - entry.at >= this.roomCreateIntervalMs) this.created.delete(ip);
    }
  }
}

function stripV4Mapped(addr: string): string {
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr;
}

/** 루프백이나 사설망 주소인지. 이런 주소에서 온 요청은 앞단 프록시(Caddy)를 거친 것으로 본다 */
export function isPrivateAddress(raw: string): boolean {
  const addr = stripV4Mapped(raw);
  if (addr === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(addr)) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(addr);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * 요청을 보낸 사람의 IP. 사설망에서 온 요청(같은 서버의 프록시)이면 X-Forwarded-For의 마지막 값을 쓴다.
 * 인터넷에서 바로 들어온 요청의 X-Forwarded-For는 꾸밀 수 있으므로 믿지 않는다.
 */
export function clientIp(req: IncomingMessage): string {
  const remote = stripV4Mapped(req.socket.remoteAddress ?? '');
  const header = req.headers['x-forwarded-for'];
  const forwarded = Array.isArray(header) ? header.join(',') : header;
  if (forwarded && isPrivateAddress(remote)) {
    const last = forwarded.split(',').pop()?.trim();
    if (last) return stripV4Mapped(last);
  }
  return remote || 'unknown';
}
