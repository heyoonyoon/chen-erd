/**
 * 홈 화면에서 쓰는 순수 함수. [담당: home 에이전트]
 */
import { ROOM_ID_PATTERN } from '../../shared/types';

/**
 * 사용자가 붙여 넣은 값에서 방 id를 뽑는다.
 * 초대 링크(`…/r/<id>`, 뒤에 `/`, `?…`, `#…`가 붙어도 된다)와 방 코드만 적은 경우를 모두 받는다.
 * 방 코드 형식에 맞지 않으면 null.
 */
export function extractRoomId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (ROOM_ID_PATTERN.test(s)) return s;
  // 주소의 마지막 경로가 /r/<id> 인 경우만 인정한다(라우터가 받는 형태와 같다)
  const m = /(?:^|\/)r\/([^/?#\s]+)\/?(?:[?#]\S*)?$/.exec(s);
  if (m && ROOM_ID_PATTERN.test(m[1])) return m[1];
  return null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 시각 ms를 now 기준으로 "방금 전 / N분 전 / N시간 전 / N일 전 / 날짜"로 적는다.
 * 일주일이 넘으면 날짜로 적고, 해가 다르면 연도를 붙인다. 값이 올바르지 않으면 빈 문자열.
 */
export function relativeTime(ms: number, now: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const diff = now - ms;
  // 시계가 어긋나 미래로 찍힌 값도 방금으로 본다
  if (diff < MINUTE) return '방금 전';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}분 전`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}시간 전`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}일 전`;
  const d = new Date(ms);
  const monthDay = `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return d.getFullYear() === new Date(now).getFullYear() ? monthDay : `${d.getFullYear()}년 ${monthDay}`;
}
