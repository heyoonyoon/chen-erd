/**
 * 화면 글자의 다국어 처리. 한국어 사전(locales/ko.ts)이 키 목록을 정하고 다른 언어는 그 타입에 맞춘다.
 *
 * 쓰는 법
 *   컴포넌트 안: const t = useT();  t('common.close')  언어가 바뀌면 컴포넌트가 다시 그려진다.
 *   컴포넌트 밖(이벤트 처리, 순수 함수): import { t } from '../i18n';  부른 시점의 언어로 바꾼다.
 *   공용 코드가 돌려준 메시지(키와 값): tm(message), 문장으로 보일 때는 tSentence(message)
 *
 * 한국어와 영어 사전은 처음부터 싣고, 나머지는 그 언어를 고를 때 내려받는다.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import { APP_NAME } from '../../shared/app';
import type { Message, SharedMessageKey } from '../../shared/messages';
import type { PresetId } from '../../shared/types';
import { capitalizeFirst, formatMessage, type MessageParams } from './format';
import {
  FALLBACK_LOCALE,
  browserLanguages,
  chooseLocale,
  readStoredLocale,
  storeLocale,
  type Locale,
} from './locale';
import { en } from './locales/en';
import { ko, type Dictionary, type MessageKey } from './locales/ko';

export { APP_NAME };
export { LOCALES, LOCALE_NAMES, LOCALE_STORAGE_KEY, type Locale } from './locale';
export type { Dictionary, MessageKey } from './locales/ko';
export type { MessageParams } from './format';

/** 공용 코드가 쓰는 키가 사전에 빠져 있으면 여기서 컴파일 오류가 난다. */
type MissingSharedKeys = Exclude<SharedMessageKey, MessageKey>;
const sharedKeysCovered: [MissingSharedKeys] extends [never] ? true : { missing: MissingSharedKeys } = true;
void sharedKeysCovered;

type LazyLocale = Exclude<Locale, 'ko' | 'en'>;

const dictionaries: Partial<Record<Locale, Dictionary>> = { ko, en };

const LOADERS: Record<LazyLocale, () => Promise<Dictionary>> = {
  ja: () => import('./locales/ja').then((m) => m.ja),
  'zh-CN': () => import('./locales/zh-CN').then((m) => m.zhCN),
  'zh-TW': () => import('./locales/zh-TW').then((m) => m.zhTW),
  es: () => import('./locales/es').then((m) => m.es),
  fr: () => import('./locales/fr').then((m) => m.fr),
  de: () => import('./locales/de').then((m) => m.de),
  'pt-BR': () => import('./locales/pt-BR').then((m) => m.ptBR),
  vi: () => import('./locales/vi').then((m) => m.vi),
};

/** 사전을 준비한다. 이미 있으면 바로 돌려준다. */
export async function loadLocale(locale: Locale): Promise<Dictionary> {
  const ready = dictionaries[locale];
  if (ready) return ready;
  const dict = await LOADERS[locale as LazyLocale]();
  dictionaries[locale] = dict;
  return dict;
}

function testMode(): string | undefined {
  try {
    return import.meta.env?.MODE;
  } catch {
    return undefined;
  }
}

/** 이 브라우저에서 쓰려는 언어(직접 고른 값, 브라우저 언어, 영어 순서) */
function wantedLocale(): Locale {
  return chooseLocale({ stored: readStoredLocale(), languages: browserLanguages(), mode: testMode() });
}

const initial = wantedLocale();

/** 지금 화면에 쓰이는 언어. 사전을 다 받은 언어만 들어간다. */
export const useLocaleStore = create<{ locale: Locale }>(() => ({
  locale: dictionaries[initial] ? initial : FALLBACK_LOCALE,
}));

function syncDocumentLang(locale: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}
syncDocumentLang(useLocaleStore.getState().locale);
useLocaleStore.subscribe((s) => syncDocumentLang(s.locale));

export function getLocale(): Locale {
  return useLocaleStore.getState().locale;
}

let lastRequest = 0;

/**
 * 언어를 바꾼다. 화면은 새로 고치지 않고 바로 바뀐다.
 * persist가 true(기본)면 사용자가 고른 것으로 보고 브라우저에 기억한다.
 */
export async function setLocale(locale: Locale, options: { persist?: boolean } = {}): Promise<void> {
  const request = ++lastRequest;
  if (options.persist !== false) storeLocale(locale);
  await loadLocale(locale);
  // 받는 사이에 다른 언어를 또 골랐으면 나중 것만 적용한다
  if (request !== lastRequest) return;
  if (getLocale() !== locale) useLocaleStore.setState({ locale });
}

/**
 * 앱을 처음 그리기 전에 부른다. 시작 언어의 사전이 아직 없으면 받아 온다.
 * 받지 못하면 영어로 시작한다.
 */
export async function initLocale(): Promise<void> {
  if (initial === getLocale()) return;
  try {
    await setLocale(initial, { persist: false });
  } catch {
    /* 사전을 받지 못해도 영어 화면으로 계속한다 */
  }
}

const BASE_PARAMS: MessageParams = { app: APP_NAME };

function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const dict = dictionaries[locale] ?? en;
  return formatMessage(dict, locale, key, params ? { ...BASE_PARAMS, ...params } : BASE_PARAMS);
}

export type TFunction = (key: MessageKey, params?: MessageParams) => string;

/** 현재 언어의 문장. {app}에는 제품 이름이 들어간다. */
export const t: TFunction = (key, params) => translate(getLocale(), key, params);

/** 공용 코드가 돌려준 메시지를 현재 언어의 글자로 바꾼다. */
export function tm(message: Message<MessageKey>): string {
  return translate(getLocale(), message.key, message.params);
}

/** tm과 같되 문장의 첫 글자를 대문자로 맞춘다(도형 이름으로 시작하는 검증 메시지). */
export function tSentence(message: Message<MessageKey>): string {
  const locale = getLocale();
  return capitalizeFirst(translate(locale, message.key, message.params), locale);
}

/** 현재 언어. 언어가 바뀌면 컴포넌트를 다시 그린다. */
export function useLocale(): Locale {
  return useLocaleStore((s) => s.locale);
}

/** 번역 함수. 언어가 바뀌면 컴포넌트를 다시 그리고 함수도 새것이 된다(useMemo 의존성에 넣을 수 있다). */
export function useT(): TFunction {
  const locale = useLocale();
  return useMemo<TFunction>(() => (key, params) => translate(locale, key, params), [locale]);
}

// ───────────── 도형 프리셋 ─────────────

/** 기본 글자가 있는 프리셋(특수화 원은 글자 대신 d, o를 그린다) */
type TextPresetId = Exclude<PresetId, 'spec-d' | 'spec-o'>;

/** 프리셋 이름(도구 팔레트, 도움말, 인스펙터) */
export function presetLabel(id: PresetId): string {
  return t(`preset.${id}.label`);
}

/** 새 도형에 넣는 기본 글자. 만드는 사람의 현재 언어로 정해지고, 한번 문서에 들어간 글자는 번역하지 않는다. */
export function presetText(id: PresetId): string {
  if (id === 'spec-d' || id === 'spec-o') return '';
  return t(`preset.${id as TextPresetId}.text`);
}

// ───────────── 날짜와 숫자 ─────────────

/** 현재 언어의 날짜 표기 */
export function formatDate(ms: number, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(getLocale(), options).format(ms);
  } catch {
    return new Intl.DateTimeFormat(FALLBACK_LOCALE, options).format(ms);
  }
}

/** 현재 언어의 날짜와 시각 표기(목록의 시각에 마우스를 올렸을 때 보이는 자세한 값) */
export function formatDateTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString(getLocale());
  } catch {
    return new Date(ms).toLocaleString(FALLBACK_LOCALE);
  }
}

/** 현재 언어의 숫자 표기(자릿수 구분 기호) */
export function formatNumber(value: number): string {
  try {
    return new Intl.NumberFormat(getLocale()).format(value);
  } catch {
    return String(value);
  }
}
