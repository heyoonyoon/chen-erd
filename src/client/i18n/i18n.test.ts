// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { msg } from '../../shared/messages';
import { validateDiagram, canConnect } from '../../shared/rules';
import type { ErdEdge, ErdNode } from '../../shared/types';
import { createNodeFromPreset } from '../collab/docOps';
import { relativeTime } from '../pages/homeUtils';
import { capitalizeFirst, formatMessage, josa, placeholdersOf, type MessageValue } from './format';
import {
  APP_NAME,
  LOCALES,
  LOCALE_STORAGE_KEY,
  getLocale,
  loadLocale,
  presetLabel,
  presetText,
  setLocale,
  t,
  tSentence,
  tm,
  type Dictionary,
  type Locale,
} from './index';
import { ko } from './locales/ko';

async function allDictionaries(): Promise<Array<[Locale, Dictionary]>> {
  return Promise.all(LOCALES.map(async (locale): Promise<[Locale, Dictionary]> => [locale, await loadLocale(locale)]));
}

afterEach(async () => {
  await setLocale('ko', { persist: false });
  localStorage.clear();
});

describe('언어 사전', () => {
  it('모든 언어가 한국어 사전과 똑같은 키를 가진다', async () => {
    const keys = Object.keys(ko).sort();
    for (const [locale, dict] of await allDictionaries()) {
      expect(Object.keys(dict).sort(), locale).toEqual(keys);
    }
  });

  it('키마다 자리 표시({name})가 모든 언어에서 같다', async () => {
    const dicts = await allDictionaries();
    for (const key of Object.keys(ko) as Array<keyof typeof ko>) {
      const expected = placeholdersOf(ko[key]);
      for (const [locale, dict] of dicts) {
        expect(placeholdersOf(dict[key]), `${locale} ${key}`).toEqual(expected);
      }
    }
  });

  it('빈 문장이 없고 복수형 묶음은 other를 가지며 모든 형태가 같은 자리 표시를 쓴다', async () => {
    for (const [locale, dict] of await allDictionaries()) {
      for (const [key, value] of Object.entries(dict) as Array<[string, MessageValue]>) {
        if (typeof value === 'string') {
          expect(value.trim(), `${locale} ${key}`).not.toBe('');
          continue;
        }
        expect(value.other, `${locale} ${key}`).toBeTruthy();
        for (const form of Object.values(value)) {
          expect(form.trim(), `${locale} ${key}`).not.toBe('');
          expect(placeholdersOf(form), `${locale} ${key}`).toEqual(placeholdersOf(value));
        }
      }
    }
  });

  it('한국어 조사 표기({name:이/가})는 한국어 사전에만 있다', async () => {
    for (const [locale, dict] of await allDictionaries()) {
      if (locale === 'ko') continue;
      for (const [key, value] of Object.entries(dict) as Array<[string, MessageValue]>) {
        const texts = typeof value === 'string' ? [value] : Object.values(value);
        for (const text of texts) expect(text, `${locale} ${key}`).not.toMatch(/\{\w+:[^}]*\}/);
      }
    }
  });

  it('한국어가 아닌 사전에는 한글이 남아 있지 않다', async () => {
    for (const [locale, dict] of await allDictionaries()) {
      if (locale === 'ko') continue;
      for (const [key, value] of Object.entries(dict) as Array<[string, MessageValue]>) {
        const texts = typeof value === 'string' ? [value] : Object.values(value);
        for (const text of texts) expect(text, `${locale} ${key}`).not.toMatch(/[ㄱ-ㆎ가-힣]/);
      }
    }
  });
});

describe('formatMessage', () => {
  const dict: Record<string, MessageValue> = {
    plain: '안녕하세요',
    hello: '{name}님, 반갑습니다',
    subject: '{who:이/가} 왔습니다',
    pair: '{a:과/와} {b:은/는} 다릅니다',
    files: { one: '{count} file', other: '{count} files' },
    quoted: "'{name}'",
    list: '목록: {items}',
    'list.separator': ', ',
  };

  it('자리 표시에 글자와 숫자를 넣는다', () => {
    expect(formatMessage(dict, 'ko', 'plain')).toBe('안녕하세요');
    expect(formatMessage(dict, 'ko', 'hello', { name: '희윤' })).toBe('희윤님, 반갑습니다');
    expect(formatMessage(dict, 'en', 'files', { count: 3 })).toBe('3 files');
  });

  it('값이 없는 자리 표시와 없는 키는 그대로 둔다', () => {
    expect(formatMessage(dict, 'ko', 'hello')).toBe('{name}님, 반갑습니다');
    expect(formatMessage(dict, 'ko', 'missing.key')).toBe('missing.key');
  });

  it('받침에 맞는 조사를 고른다', () => {
    expect(formatMessage(dict, 'ko', 'subject', { who: '학생' })).toBe('학생이 왔습니다');
    expect(formatMessage(dict, 'ko', 'subject', { who: '교수' })).toBe('교수가 왔습니다');
    expect(formatMessage(dict, 'ko', 'pair', { a: '관계', b: '속성' })).toBe('관계와 속성은 다릅니다');
    // 한글로 끝나지 않으면 받침이 없는 쪽을 쓰고, 끝의 기호는 건너뛴다
    expect(josa('TEAM', '이', '가')).toBe('TEAM가');
    expect(josa("'선수'", '을', '를')).toBe("'선수'를");
    expect(josa('특수화 원(d)', '이', '가')).toBe('특수화 원(d)가');
  });

  it('개수에 맞는 복수형을 고른다', () => {
    expect(formatMessage(dict, 'en', 'files', { count: 1 })).toBe('1 file');
    expect(formatMessage(dict, 'en', 'files', { count: 0 })).toBe('0 files');
    // 프랑스어는 0도 단수로 센다
    expect(formatMessage(dict, 'fr', 'files', { count: 0 })).toBe('0 file');
    // 그 언어에 없는 형태는 other로 받는다
    expect(formatMessage({ n: { other: '{count}개' } }, 'en', 'n', { count: 1 })).toBe('1개');
  });

  it('값으로 받은 메시지와 메시지 목록을 같은 사전으로 푼다', () => {
    expect(formatMessage(dict, 'ko', 'subject', { who: msg('quoted', { name: '팀' }) })).toBe("'팀'이 왔습니다");
    expect(formatMessage(dict, 'ko', 'list', { items: [msg('quoted', { name: 'A' }), msg('quoted', { name: 'B' })] })).toBe(
      "목록: 'A', 'B'",
    );
  });

  it('첫 글자를 대문자로 바꾼다', () => {
    expect(capitalizeFirst('entity “A” has no key', 'en')).toBe('Entity “A” has no key');
    expect(capitalizeFirst("l’entité « A »", 'fr')).toBe("L’entité « A »");
    expect(capitalizeFirst('“A” is fine', 'en')).toBe('“A” is fine');
    expect(capitalizeFirst("'팀' 엔티티", 'ko')).toBe("'팀' 엔티티");
    expect(capitalizeFirst('', 'en')).toBe('');
  });
});

describe('언어 바꾸기', () => {
  it('테스트에서는 한국어로 시작한다', () => {
    expect(getLocale()).toBe('ko');
    expect(t('common.close')).toBe('닫기');
  });

  it('언어를 바꾸면 t가 바로 그 언어로 답하고 html lang과 저장 값이 따라 바뀐다', async () => {
    await setLocale('de');
    expect(getLocale()).toBe('de');
    expect(t('common.close')).toBe('Schließen');
    expect(document.documentElement.lang).toBe('de');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('de');

    await setLocale('ja', { persist: false });
    expect(t('common.close')).toBe('閉じる');
    expect(document.documentElement.lang).toBe('ja');
    // persist: false는 사용자가 고른 값을 건드리지 않는다
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('de');
  });

  it('연달아 바꾸면 마지막에 고른 언어가 남는다', async () => {
    const first = setLocale('vi');
    const second = setLocale('fr');
    await Promise.all([first, second]);
    expect(getLocale()).toBe('fr');
  });

  it('{app}에는 제품 이름이 들어간다', async () => {
    expect(t('import.error.notObject')).toContain(APP_NAME);
    await setLocale('en');
    expect(t('import.error.notJson')).toContain(APP_NAME);
  });

  it('개수 문장은 언어의 복수형을 따른다', async () => {
    await setLocale('en');
    expect(t('count.errors', { count: 1 })).toBe('1 error');
    expect(t('count.errors', { count: 2 })).toBe('2 errors');
    await setLocale('ko');
    expect(t('count.errors', { count: 2 })).toBe('오류 2개');
  });
});

describe('공용 코드의 메시지', () => {
  const node = (kind: ErdNode['kind'], id: string, text: string, extra: Partial<ErdNode> = {}): ErdNode => ({
    id,
    kind,
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    text,
    ...extra,
  });
  const team = node('entity', 'TEAM', 'TEAM');
  const player = node('entity', 'PLAYER', 'PLAYER');
  const edge: ErdEdge = { id: 'e', source: 'TEAM', target: 'PLAYER', double: false, label: '', role: '' };

  it('연결할 수 없는 이유를 현재 언어로 보여 준다', async () => {
    const check = canConnect(team, player, []);
    expect(check.ok).toBe(false);
    expect(tm(check.reason!)).toBe('엔티티끼리는 관계(마름모)를 거쳐 연결합니다');
    await setLocale('en');
    expect(tm(check.reason!)).toBe('Connect entities through a relationship (diamond)');
    await setLocale('zh-CN');
    expect(tm(check.reason!)).toBe('实体之间要通过联系（菱形）相连');
  });

  it('검증 메시지는 같은 결과를 언어만 바꿔서 다시 풀 수 있다', async () => {
    const issues = validateDiagram([team, player], [edge]);
    const invalid = issues.find((i) => i.id === 'edge-invalid:e')!;
    const noKey = issues.find((i) => i.id === 'entity-no-key:TEAM')!;
    expect(tSentence(invalid.message)).toBe("'TEAM' 엔티티와 'PLAYER' 엔티티가 선으로 이어져 있습니다. 엔티티끼리는 관계(마름모)를 거쳐 연결합니다");

    await setLocale('en');
    expect(tSentence(noKey.message)).toBe('Entity “TEAM” has no key attribute.');
    expect(tSentence(invalid.message)).toBe(
      'Entity “TEAM” and entity “PLAYER” are connected by a line. Connect entities through a relationship (diamond).',
    );

    await setLocale('de');
    expect(tSentence(noKey.message)).toBe('Entität „TEAM“ hat kein Schlüsselattribut.');

    await setLocale('fr');
    expect(tSentence(noKey.message)).toBe('L’entité « TEAM » n’a pas d’attribut clé.');

    await setLocale('ja');
    expect(tSentence(noKey.message)).toBe('エンティティ「TEAM」にキー属性がありません。');
  });

  it('모든 언어에서 검증 메시지에 풀리지 않은 자리 표시가 남지 않는다', async () => {
    const nodes: ErdNode[] = [
      team,
      player,
      node('entity', 'W', 'Weak', { weak: true }),
      node('relationship', 'R', 'has'),
      node('relationship', 'I', '', { identifying: true }),
      node('attribute', 'A1', 'Name', { keyType: 'key', multivalued: true, derived: true }),
      node('attribute', 'A2', ''),
      node('attribute', 'A3', 'x'),
      node('attribute', 'A4', 'y'),
      node('attribute', 'A5', 'z'),
      node('attribute', 'A6', 'w'),
      node('spec', 'S', '', { specType: 'd' }),
      node('note', 'N', 'memo'),
    ];
    const link = (id: string, source: string, target: string): ErdEdge => ({ id, source, target, double: false, label: '', role: '' });
    const edges = [
      edge,
      link('e1', 'TEAM', 'R'),
      link('e2', 'TEAM', 'R'),
      link('e3', 'TEAM', 'R'),
      link('e4', 'A1', 'TEAM'),
      link('e5', 'A1', 'PLAYER'),
      link('e6', 'A3', 'A4'),
      link('e7', 'A4', 'A5'),
      link('e8', 'A5', 'A3'),
      link('e9', 'A5', 'A6'),
      link('e10', 'N', 'TEAM'),
      link('e11', 'S', 'TEAM'),
      link('e12', 'W', 'I'),
      link('e13', 'TEAM', 'TEAM'),
      link('e14', 'TEAM', 'ghost'),
      link('e15', 'ghost1', 'ghost2'),
    ];
    const issues = validateDiagram(nodes, edges);
    expect(issues.length).toBeGreaterThan(12);
    for (const locale of LOCALES) {
      await setLocale(locale, { persist: false });
      for (const issue of issues) {
        const text = tSentence(issue.message);
        expect(text, `${locale} ${issue.id}`).not.toMatch(/[{}]/);
        expect(text, `${locale} ${issue.id}`).not.toContain('issue.');
        expect(text, `${locale} ${issue.id}`).not.toContain('rules.');
        if (locale !== 'ko') expect(text, `${locale} ${issue.id}`).not.toMatch(/[가-힣]/);
      }
    }
  });
});

describe('새 도형의 기본 글자와 날짜', () => {
  it('새 도형은 만드는 사람의 현재 언어로 된 글자를 받는다', async () => {
    expect(createNodeFromPreset('entity', { x: 0, y: 0 }).text).toBe('엔티티');
    await setLocale('en');
    expect(createNodeFromPreset('entity', { x: 0, y: 0 }).text).toBe('Entity');
    expect(presetLabel('weak-entity')).toBe('Weak entity');
    expect(presetText('spec-d')).toBe('');
    // 직접 준 글자는 그대로 쓴다
    expect(createNodeFromPreset('attribute', { x: 0, y: 0 }, '이름').text).toBe('이름');
  });

  it('기본 글자가 긴 언어에서는 도형이 글자에 맞게 커지고 중심은 그대로다', async () => {
    const base = createNodeFromPreset('multivalued-attribute', { x: 100, y: 100 });
    await setLocale('pt-BR');
    const wide = createNodeFromPreset('multivalued-attribute', { x: 100, y: 100 });
    expect(wide.text).toBe('Multivalorado');
    expect(wide.w).toBeGreaterThanOrEqual(base.w);
    expect(wide.x + wide.w / 2).toBeCloseTo(100, 0);
    expect(wide.y + wide.h / 2).toBeCloseTo(100, 0);
  });

  it('지난 시간을 현재 언어로 적는다', async () => {
    const now = new Date(2026, 5, 15, 12, 0, 0).getTime();
    const minute = 60_000;
    expect(relativeTime(now - 5 * minute, now)).toBe('5분 전');
    expect(relativeTime(new Date(2026, 2, 5).getTime(), now)).toBe('3월 5일');
    expect(relativeTime(new Date(2025, 2, 5).getTime(), now)).toBe('2025년 3월 5일');

    await setLocale('en');
    expect(relativeTime(now - 10_000, now)).toBe('Just now');
    expect(relativeTime(now - 60 * minute, now)).toBe('1 hour ago');
    expect(relativeTime(now - 3 * 60 * minute, now)).toBe('3 hours ago');
    expect(relativeTime(new Date(2026, 2, 5).getTime(), now)).toBe('Mar 5');
    expect(relativeTime(new Date(2025, 2, 5).getTime(), now)).toBe('Mar 5, 2025');

    await setLocale('de');
    expect(relativeTime(now - 2 * 24 * 60 * minute, now)).toBe('Vor 2 Tagen');
    await setLocale('ja');
    expect(relativeTime(new Date(2026, 2, 5).getTime(), now)).toBe('3月5日');
  });
});
