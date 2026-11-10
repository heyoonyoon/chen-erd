/**
 * 내 이름과 색, 최근에 들어간 방 목록을 브라우저(localStorage)에 기억한다. (CORE 파일)
 */
import { nanoid } from 'nanoid';
import { USER_COLORS, type UserInfo } from '../shared/types';

const KEY = 'chen-erd.identity';
const RECENT_KEY = 'chen-erd.recent';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 사생활 보호 모드 등에서는 저장하지 못해도 동작은 계속한다 */
  }
}

/** 저장된 내 정보. 처음이면 임의 id와 색을 만들고 이름은 빈 문자열이다. */
export function getIdentity(): UserInfo {
  const raw = safeGet(KEY);
  if (raw) {
    try {
      const v = JSON.parse(raw) as Partial<UserInfo>;
      if (v.id && v.color) return { id: v.id, name: v.name ?? '', color: v.color };
    } catch {
      /* 손상된 값은 버린다 */
    }
  }
  const fresh: UserInfo = {
    id: nanoid(8),
    name: '',
    color: USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)],
  };
  safeSet(KEY, JSON.stringify(fresh));
  return fresh;
}

export function saveIdentity(patch: Partial<Pick<UserInfo, 'name' | 'color'>>): UserInfo {
  const next = { ...getIdentity(), ...patch };
  safeSet(KEY, JSON.stringify(next));
  return next;
}

export interface RecentRoom {
  id: string;
  title: string;
  /** 마지막으로 들어간 시각(ms) */
  visitedAt: number;
}

export function getRecentRooms(): RecentRoom[] {
  const raw = safeGet(RECENT_KEY);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as RecentRoom[];
    return Array.isArray(v) ? v.filter((r) => r && typeof r.id === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberRoom(id: string, title: string): void {
  const list = getRecentRooms().filter((r) => r.id !== id);
  list.unshift({ id, title, visitedAt: Date.now() });
  safeSet(RECENT_KEY, JSON.stringify(list.slice(0, 12)));
}

export function forgetRoom(id: string): void {
  safeSet(RECENT_KEY, JSON.stringify(getRecentRooms().filter((r) => r.id !== id)));
}
