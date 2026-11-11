import { describe, expect, it } from 'vitest';
import { msg } from '../shared/messages';
import type { Issue } from '../shared/types';
import { formatSummary, formatSyntaxError, httpErrorMessage, issueLine, pickLang, reportLines, type HttpFailure } from './format';

const noKey: Issue = {
  id: 'entity-no-key:e1',
  severity: 'warning',
  message: msg('issue.entityNoKey', { node: msg('rules.node.entity.named', { name: '학생' }) }),
  elementIds: ['e1'],
};

const degree: Issue = {
  id: 'relationship-degree:r1',
  severity: 'error',
  message: msg('issue.relationshipDegree', { node: msg('rules.node.relationship.named', { name: '수강' }), count: 1 }),
  elementIds: ['r1'],
};

describe('pickLang', () => {
  it('--lang, MODELLL_LANG, LANG 순으로 보고 ko로 시작할 때만 한국어다', () => {
    expect(pickLang(undefined, {})).toBe('en');
    expect(pickLang(undefined, { LANG: 'ko_KR.UTF-8' })).toBe('ko');
    expect(pickLang(undefined, { LANG: 'en_US.UTF-8' })).toBe('en');
    expect(pickLang(undefined, { LANG: 'ko_KR.UTF-8', MODELLL_LANG: 'en' })).toBe('en');
    expect(pickLang('ko', { LANG: 'en_US.UTF-8', MODELLL_LANG: 'en' })).toBe('ko');
    expect(pickLang('KO-kr', {})).toBe('ko');
    // 사전이 없는 언어는 영어로 낸다
    expect(pickLang('ja', { LANG: 'ko_KR.UTF-8' })).toBe('en');
  });
});

describe('검증 결과', () => {
  it('영어 사전으로 풀고 첫 글자를 대문자로 맞춘다', () => {
    expect(issueLine(noKey, 'en')).toBe('warning: Entity “학생” has no key attribute.');
    expect(issueLine(degree, 'en')).toBe('error: Relationship “수강” must be connected to entities by at least 2 lines. It has 1 now.');
  });

  it('한국어 사전으로 풀고 조사를 받침에 맞춘다', () => {
    expect(issueLine(noKey, 'ko')).toBe("warning: '학생' 엔티티에 식별자(키 속성)가 없습니다");
    expect(issueLine(degree, 'ko')).toBe("error: '수강' 관계는 엔티티와 선 2개 이상으로 이어져야 합니다(현재 1개)");
  });

  it('그리면서 나온 경고를 먼저, 검증 결과를 뒤에 적는다', () => {
    expect(reportLines(['entity "Ghost" is not defined'], [degree, noKey], 'en')).toEqual([
      'warning: entity "Ghost" is not defined',
      'error: Relationship “수강” must be connected to entities by at least 2 lines. It has 1 now.',
      'warning: Entity “학생” has no key attribute.',
    ]);
    expect(reportLines([], [], 'ko')).toEqual([]);
  });
});

describe('formatSummary', () => {
  it('0이 아닌 항목만 적는다', () => {
    expect(formatSummary({ added: 12, updated: 3, removed: 1 })).toBe('+12 added, ~3 changed, -1 removed');
    expect(formatSummary({ added: 0, updated: 2, removed: 0 })).toBe('~2 changed');
    expect(formatSummary({ added: 5, updated: 0, removed: 0 })).toBe('+5 added');
    expect(formatSummary({ added: 0, updated: 0, removed: 0 })).toBe('no changes');
  });
});

describe('formatSyntaxError', () => {
  it('파일:줄:칸: 설명 꼴로 적는다', () => {
    expect(formatSyntaxError('a.mdl', { message: 'expected "}"', line: 3, column: 7 })).toBe('a.mdl:3:7: expected "}"');
    expect(formatSyntaxError('-', { message: 'unknown keyword', line: 1, column: 1 })).toBe('<stdin>:1:1: unknown keyword');
  });
});

describe('httpErrorMessage', () => {
  const base: HttpFailure = { status: 400, code: '', retryAfter: 0, server: 'https://modelll.app', roomId: 'abc123' };

  it('서버의 오류 코드를 문장으로 바꾼다', () => {
    expect(httpErrorMessage({ ...base, status: 404, code: 'not-found' })).toBe('room "abc123" does not exist on https://modelll.app');
    expect(httpErrorMessage({ ...base, status: 429, code: 'room-rate' })).toBe(
      'this address can create one new room per minute; try again shortly',
    );
    expect(httpErrorMessage({ ...base, status: 429, code: 'rate', retryAfter: 42 })).toBe(
      'too many requests from this address; try again in 42 seconds',
    );
    expect(httpErrorMessage({ ...base, status: 429, code: 'rate', retryAfter: 1 })).toContain('in 1 second');
    expect(httpErrorMessage({ ...base, status: 413, code: 'body-too-large' })).toContain('256 KB');
    expect(httpErrorMessage({ ...base, status: 422, code: 'too-large' })).toContain('3000 shapes');
    expect(httpErrorMessage({ ...base, status: 400, code: 'invalid-room' })).toContain('not a valid room id');
    expect(httpErrorMessage({ ...base, status: 503, code: 'unavailable' })).toContain('try again shortly');
  });

  it('코드가 없으면 상태 코드로 설명한다', () => {
    // 모델 API가 없는 예전 서버는 /api 아래의 모르는 경로에 404를 준다
    expect(httpErrorMessage({ ...base, status: 404, code: 'not found' })).toContain('does not provide the model API');
    expect(httpErrorMessage({ ...base, status: 502 })).toBe('https://modelll.app failed to handle the request (HTTP 502); try again shortly');
    expect(httpErrorMessage({ ...base, status: 418, code: 'teapot' })).toBe('https://modelll.app refused the request (HTTP 418, teapot)');
  });
});
