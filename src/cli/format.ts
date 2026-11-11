/**
 * CLI가 내보내는 글자를 만드는 순수 함수. 검증 결과만 화면과 같은 사전(한국어, 영어)으로 풀고 나머지는 영어다.
 */
import { capitalizeFirst, formatMessage } from '../client/i18n/format';
import { en } from '../client/i18n/locales/en';
import { ko } from '../client/i18n/locales/ko';
import { APP_NAME } from '../shared/app';
import type { Issue } from '../shared/types';

export type Lang = 'ko' | 'en';

const DICTIONARIES = { ko, en };

/** 검증 결과의 언어를 고른다. --lang, MODELLL_LANG, LANG 순으로 보고 ko로 시작할 때만 한국어다 */
export function pickLang(flag: string | undefined, env: Record<string, string | undefined>): Lang {
  const value = flag || env.MODELLL_LANG || env.LANG || '';
  return value.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

/** 검증 결과 하나를 그 언어의 문장으로 바꾼다 */
export function issueText(issue: Issue, lang: Lang): string {
  const text = formatMessage(DICTIONARIES[lang], lang, issue.message.key, { app: APP_NAME, ...issue.message.params });
  return capitalizeFirst(text, lang);
}

/** 'error: …' 또는 'warning: …' 한 줄 */
export function issueLine(issue: Issue, lang: Lang): string {
  return `${issue.severity}: ${issueText(issue, lang)}`;
}

export interface ChangeSummary {
  added: number;
  updated: number;
  removed: number;
}

/** '+12 added, ~3 changed, -1 removed'. 0인 항목은 빼고, 모두 0이면 'no changes' */
export function formatSummary(summary: ChangeSummary): string {
  const parts: string[] = [];
  if (summary.added > 0) parts.push(`+${summary.added} added`);
  if (summary.updated > 0) parts.push(`~${summary.updated} changed`);
  if (summary.removed > 0) parts.push(`-${summary.removed} removed`);
  return parts.length > 0 ? parts.join(', ') : 'no changes';
}

/** 컴파일러와 같은 꼴의 위치 표시. 표준 입력은 <stdin>으로 적는다 */
export function formatSyntaxError(file: string, error: { message: string; line: number; column: number }): string {
  return `${file === '-' ? '<stdin>' : file}:${error.line}:${error.column}: ${error.message}`;
}

/** 모델을 그리면서 나온 경고(영어 문장)와 검증 결과를 줄 목록으로 만든다 */
export function reportLines(warnings: readonly string[], issues: readonly Issue[], lang: Lang): string[] {
  return [...warnings.map((w) => `warning: ${w}`), ...issues.map((issue) => issueLine(issue, lang))];
}

export interface HttpFailure {
  status: number;
  /** 서버가 준 오류 코드. JSON이 아니거나 없으면 '' */
  code: string;
  /** Retry-After 헤더의 초. 없으면 0 */
  retryAfter: number;
  server: string;
  roomId: string;
}

/** 서버가 거절한 이유를 한 문장으로 바꾼다 */
export function httpErrorMessage(failure: HttpFailure): string {
  const { status, code, retryAfter, server, roomId } = failure;
  switch (code) {
    case 'not-found':
      return `room "${roomId}" does not exist on ${server}`;
    case 'invalid-room':
      return `"${roomId}" is not a valid room id`;
    case 'rate':
      return retryAfter > 0
        ? `too many requests from this address; try again in ${retryAfter} second${retryAfter === 1 ? '' : 's'}`
        : 'too many requests from this address; try again shortly';
    case 'room-rate':
      return 'this address can create one new room per minute; try again shortly';
    case 'body-too-large':
      return 'the model text is too large (the limit is 256 KB)';
    case 'too-large':
      return 'the diagram would have more than 3000 shapes, which the server does not accept';
    case 'bad-request':
      return 'the server could not read the request body';
    case 'unavailable':
      return 'the server is restarting or could not load this room; try again shortly';
    default:
      break;
  }
  if (status === 404) return `${server} does not provide the model API (is it an older version?)`;
  if (status === 413) return 'the model text is too large (the limit is 256 KB)';
  if (status === 429) return 'too many requests from this address; try again shortly';
  if (status >= 500) return `${server} failed to handle the request (HTTP ${status}); try again shortly`;
  return `${server} refused the request (HTTP ${status}${code ? `, ${code}` : ''})`;
}
