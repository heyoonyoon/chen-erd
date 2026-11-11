import { describe, expect, it } from 'vitest';
import { LOCALES, LOCALE_NAMES, chooseLocale, detectLocale, isLocale, matchLocale } from './locale';

describe('matchLocale', () => {
  it('지원하는 언어는 지역이 붙어도 그 언어로 받는다', () => {
    expect(matchLocale('ko')).toBe('ko');
    expect(matchLocale('ko-KR')).toBe('ko');
    expect(matchLocale('en-US')).toBe('en');
    expect(matchLocale('en_GB')).toBe('en');
    expect(matchLocale('ja-JP')).toBe('ja');
    expect(matchLocale('es-419')).toBe('es');
    expect(matchLocale('fr-CA')).toBe('fr');
    expect(matchLocale('de-AT')).toBe('de');
    expect(matchLocale('vi-VN')).toBe('vi');
    expect(matchLocale('DE')).toBe('de');
  });

  it('중국어는 번체 지역과 표기면 zh-TW, 그 밖에는 zh-CN', () => {
    expect(matchLocale('zh-TW')).toBe('zh-TW');
    expect(matchLocale('zh-HK')).toBe('zh-TW');
    expect(matchLocale('zh-MO')).toBe('zh-TW');
    expect(matchLocale('zh-Hant')).toBe('zh-TW');
    expect(matchLocale('zh-Hant-HK')).toBe('zh-TW');
    expect(matchLocale('zh-Hant-CN')).toBe('zh-TW');
    expect(matchLocale('zh')).toBe('zh-CN');
    expect(matchLocale('zh-CN')).toBe('zh-CN');
    expect(matchLocale('zh-SG')).toBe('zh-CN');
    expect(matchLocale('zh-Hans')).toBe('zh-CN');
    expect(matchLocale('zh-Hans-TW')).toBe('zh-CN');
  });

  it('포르투갈어는 모두 pt-BR', () => {
    expect(matchLocale('pt')).toBe('pt-BR');
    expect(matchLocale('pt-BR')).toBe('pt-BR');
    expect(matchLocale('pt-PT')).toBe('pt-BR');
  });

  it('지원하지 않는 언어와 이상한 값은 null', () => {
    expect(matchLocale('it')).toBeNull();
    expect(matchLocale('ru-RU')).toBeNull();
    expect(matchLocale('')).toBeNull();
    expect(matchLocale('   ')).toBeNull();
    expect(matchLocale(undefined as unknown as string)).toBeNull();
  });
});

describe('detectLocale', () => {
  it('선호 순서대로 처음 맞는 언어를 고른다', () => {
    expect(detectLocale(['it-IT', 'fr-FR', 'en'])).toBe('fr');
    expect(detectLocale(['zh-TW', 'zh', 'en'])).toBe('zh-TW');
    expect(detectLocale(['pt-PT', 'es'])).toBe('pt-BR');
  });

  it('맞는 언어가 없으면 영어', () => {
    expect(detectLocale(['it', 'ru'])).toBe('en');
    expect(detectLocale([])).toBe('en');
    expect(detectLocale(null)).toBe('en');
    expect(detectLocale(undefined)).toBe('en');
  });
});

describe('chooseLocale', () => {
  it('사용자가 고른 값이 브라우저 언어보다 먼저다', () => {
    expect(chooseLocale({ stored: 'ja', languages: ['de-DE'] })).toBe('ja');
    expect(chooseLocale({ stored: 'zh-TW', languages: ['ko'], mode: 'test' })).toBe('zh-TW');
  });

  it('고른 값이 없거나 지원 목록에 없으면 브라우저 언어를 따른다', () => {
    expect(chooseLocale({ stored: null, languages: ['de-DE', 'en'] })).toBe('de');
    expect(chooseLocale({ stored: 'xx', languages: ['vi'] })).toBe('vi');
    expect(chooseLocale({ languages: ['it'] })).toBe('en');
    expect(chooseLocale({})).toBe('en');
  });

  it('테스트에서는 고른 값이 없으면 한국어', () => {
    expect(chooseLocale({ stored: null, languages: ['en-US'], mode: 'test' })).toBe('ko');
    expect(chooseLocale({ languages: [], mode: 'production' })).toBe('en');
  });
});

describe('언어 목록', () => {
  it('열 개 언어가 있고 모두 이름을 가진다', () => {
    expect(LOCALES).toEqual(['ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'pt-BR', 'vi']);
    for (const locale of LOCALES) {
      expect(LOCALE_NAMES[locale]).toBeTruthy();
      expect(isLocale(locale)).toBe(true);
    }
    expect(isLocale('it')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});
