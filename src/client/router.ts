/**
 * 아주 작은 라우터. '/' 는 홈, '/r/<roomId>' 는 방. (CORE 파일)
 */
import { useSyncExternalStore } from 'react';
import { nanoid } from 'nanoid';
import { ROOM_ID_PATTERN } from '../shared/types';

export type Route = { page: 'home' } | { page: 'room'; roomId: string };

function parse(pathname: string): Route {
  const m = /^\/r\/([^/]+)\/?$/.exec(pathname);
  if (m && ROOM_ID_PATTERN.test(m[1])) return { page: 'room', roomId: m[1] };
  return { page: 'home' };
}

const listeners = new Set<() => void>();
let current: Route = typeof location !== 'undefined' ? parse(location.pathname) : { page: 'home' };

function update(): void {
  const next = parse(location.pathname);
  if (JSON.stringify(next) !== JSON.stringify(current)) current = next;
  for (const l of listeners) l();
}
if (typeof window !== 'undefined') window.addEventListener('popstate', update);

export function navigate(path: string): void {
  history.pushState(null, '', path);
  update();
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** 새 방 id (읽고 불러 주기 쉽게 소문자와 숫자만) */
export function newRoomId(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  const bytes = nanoid(10);
  for (let i = 0; i < 10; i++) s += alphabet[bytes.charCodeAt(i) % alphabet.length];
  return s;
}

export function roomPath(roomId: string): string {
  return `/r/${roomId}`;
}
export function roomUrl(roomId: string): string {
  return `${location.origin}${roomPath(roomId)}`;
}
