/**
 * 홈 화면에서 쓰는 순수 함수. [담당: home 에이전트]
 */
import { ROOM_ID_PATTERN } from '../../shared/types';
import { formatDate, t } from '../i18n';

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
 * 시각 ms를 now 기준으로 "방금 전 / N분 전 / N시간 전 / N일 전 / 날짜"로 적는다(현재 언어의 표현으로).
 * 일주일이 넘으면 날짜로 적고, 해가 다르면 연도를 붙인다. 값이 올바르지 않으면 빈 문자열.
 */
export function relativeTime(ms: number, now: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const diff = now - ms;
  // 시계가 어긋나 미래로 찍힌 값도 방금으로 본다
  if (diff < MINUTE) return t('time.justNow');
  if (diff < HOUR) return t('time.minutesAgo', { count: Math.floor(diff / MINUTE) });
  if (diff < DAY) return t('time.hoursAgo', { count: Math.floor(diff / HOUR) });
  if (diff < 7 * DAY) return t('time.daysAgo', { count: Math.floor(diff / DAY) });
  // 날짜는 언어마다 순서와 표기가 달라 Intl에 맡긴다(한국어 3월 5일, 영어 Mar 5)
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return formatDate(ms, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}
