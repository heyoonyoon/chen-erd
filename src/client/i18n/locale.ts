/**
 * 지원하는 언어 목록과 어떤 언어로 시작할지 정하는 규칙(순수 함수와 localStorage 접근).
 */

export const LOCALES = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'pt-BR', 'vi'] as const;

export type Locale = (typeof LOCALES)[number];

/** 사전의 기준 언어. 키 목록을 이 언어의 사전이 정한다. */
export const SOURCE_LOCALE: Locale = 'ko';
/** 브라우저 언어가 지원 목록에 없을 때 쓰는 언어 */
export const FALLBACK_LOCALE: Locale = 'en';

/** 언어 선택 목록에 보이는 이름. 번역하지 않고 그 언어로 적는다. */
export const LOCALE_NAMES: Record<Locale, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  'pt-BR': 'Português (Brasil)',
  vi: 'Tiếng Việt',
};

/** 사용자가 직접 고른 언어를 기억하는 localStorage 키 */
export const LOCALE_STORAGE_KEY = 'chen-erd.locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** 번체를 쓰는 지역 */
const TRADITIONAL_REGIONS = new Set(['tw', 'hk', 'mo']);

/**
 * 브라우저 언어 태그 하나를 지원 언어로 바꾼다. 지원하지 않으면 null.
 * 중국어는 번체 표기(Hant)나 대만, 홍콩, 마카오면 zh-TW, 그 밖에는 zh-CN. 포르투갈어는 모두 pt-BR.
 */
export function matchLocale(tag: string): Locale | null {
  if (typeof tag !== 'string') return null;
  const parts = tag.trim().toLowerCase().split(/[-_]/).filter(Boolean);
  const lang = parts[0];
  if (!lang) return null;
  const rest = parts.slice(1);
  switch (lang) {
    case 'ko':
    case 'en':
    case 'ja':
    case 'es':
    case 'fr':
    case 'de':
    case 'vi':
      return lang;
    case 'pt':
      return 'pt-BR';
    case 'zh':
      if (rest.includes('hant')) return 'zh-TW';
      if (rest.includes('hans')) return 'zh-CN';
      return rest.some((p) => TRADITIONAL_REGIONS.has(p)) ? 'zh-TW' : 'zh-CN';
    default:
      return null;
  }
}

/** 브라우저가 알려 준 선호 언어 목록에서 앞에서부터 처음 맞는 언어를 고른다. 없으면 영어. */
export function detectLocale(languages: readonly string[] | null | undefined): Locale {
  for (const tag of languages ?? []) {
    const match = matchLocale(tag);
    if (match) return match;
  }
  return FALLBACK_LOCALE;
}

/**
 * 시작 언어를 정한다. 사용자가 직접 고른 값이 가장 먼저고, 없으면 브라우저 언어, 그것도 맞지 않으면 영어.
 * 테스트(mode === 'test')에서는 고른 값이 없으면 한국어로 시작한다(기존 테스트가 한국어 화면을 확인한다).
 */
export function chooseLocale(input: { stored?: string | null; languages?: readonly string[] | null; mode?: string }): Locale {
  if (isLocale(input.stored)) return input.stored;
  if (input.mode === 'test') return SOURCE_LOCALE;
  return detectLocale(input.languages);
}

export function readStoredLocale(): Locale | null {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* 사생활 보호 모드 등에서는 저장하지 못해도 동작은 계속한다 */
  }
}

/** 브라우저의 선호 언어 목록. 브라우저가 아니면 빈 배열 */
export function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}
