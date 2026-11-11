/**
 * 방을 가리키는 인자(주소 전체 또는 id)와 서버 주소를 푸는 순수 함수.
 */
import { randomBytes } from 'node:crypto';
import { ROOM_ID_PATTERN } from '../shared/types';
import { CliError } from './errors';

export const DEFAULT_SERVER = 'https://modelll.app';

export interface RoomRef {
  /** 서버의 origin. 끝에 '/'가 없다 */
  server: string;
  roomId: string;
}

/** 스킴 없이 적은 주소에 스킴을 붙인다. 내 컴퓨터를 가리키면 http, 아니면 https */
function withScheme(value: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  return /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(value) ? `http://${value}` : `https://${value}`;
}

/** 서버 주소를 origin으로 다듬는다. http(s) 주소가 아니면 CliError */
export function normalizeServer(value: string): string {
  let url: URL;
  try {
    url = new URL(withScheme(value.trim()));
  } catch {
    throw new CliError(`"${value}" is not a valid server address`, 2);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CliError(`"${value}" is not a valid server address (expected http or https)`, 2);
  }
  return url.origin;
}

/** 서버를 고른다. --server, 환경변수 MODELLL_SERVER, 기본 주소 순이다 */
export function resolveServer(flag: string | undefined, env: Record<string, string | undefined>): string {
  return normalizeServer(flag || env.MODELLL_SERVER || DEFAULT_SERVER);
}

/**
 * 방 인자를 푼다. 주소(https://modelll.app/r/abc123)면 그 origin이 서버가 되고,
 * id만 적었으면 defaultServer를 쓴다.
 */
export function parseRoomRef(ref: string, defaultServer: string): RoomRef {
  const value = ref.trim();
  if (ROOM_ID_PATTERN.test(value)) return { server: defaultServer, roomId: value };

  if (value.includes('/')) {
    let url: URL | null = null;
    try {
      url = new URL(withScheme(value));
    } catch {
      // 아래에서 알린다
    }
    const m = url && (url.protocol === 'http:' || url.protocol === 'https:') ? /^\/r\/([^/]+)\/?$/.exec(url.pathname) : null;
    if (url && m && ROOM_ID_PATTERN.test(m[1])) return { server: url.origin, roomId: m[1] };
    throw new CliError(`"${ref}" is not a room URL (expected something like ${DEFAULT_SERVER}/r/abc123)`, 2);
  }
  throw new CliError(`"${ref}" is not a valid room id (letters, digits, "-" and "_", up to 64 characters)`, 2);
}

export function roomUrl(ref: RoomRef): string {
  return `${ref.server}/r/${ref.roomId}`;
}

/** 새 방 id. 웹 화면의 newRoomId(src/client/router.ts)와 같은 글자와 길이를 쓴다 */
export function newRoomId(random: (size: number) => Uint8Array = randomBytes): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = random(10);
  let s = '';
  // 글자가 32개라 바이트를 나눈 나머지가 고르게 나온다
  for (let i = 0; i < 10; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}
