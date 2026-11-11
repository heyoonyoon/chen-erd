/**
 * 언어 사전의 문장에 값을 끼워 넣는 순수 함수. 저장소와 React를 모르므로 어디서든(테스트 포함) 쓸 수 있다.
 *
 * 문장 안의 자리 표시
 *   {name}       params.name 값을 넣는다. 값이 메시지면 같은 사전으로 풀고, 메시지 배열이면 풀어서 쉼표로 잇는다.
 *   {name:이/가}  한국어 조사. 넣은 값이 받침으로 끝나면 앞의 것, 아니면 뒤의 것을 붙인다.
 *
 * 값이 문자열이 아니라 { one, other } 같은 묶음이면 params.count에 맞는 복수형을 고른다(Intl.PluralRules).
 */
import type { Message, MessageParam } from '../../shared/messages';

/** 복수형 묶음. other는 반드시 있어야 한다. */
export type PluralForms = { other: string } & Partial<Record<'zero' | 'one' | 'two' | 'few' | 'many', string>>;

export type MessageValue = string | PluralForms;

export type MessageParams = Record<string, MessageParam>;

/** 메시지 배열을 이을 때 쓰는 구분자의 키 */
const LIST_SEPARATOR_KEY = 'list.separator';

const PLACEHOLDER = /\{(\w+)(?::([^{}]*))?\}/g;

const pluralRules = new Map<string, Intl.PluralRules>();

function pluralCategory(locale: string, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(locale);
    } catch {
      rules = new Intl.PluralRules('en');
    }
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

/** 받침에 따라 조사를 고른다. 한글로 끝나지 않으면 받침 없는 쪽을 쓴다. */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const stripped = word.replace(/[^가-힣A-Za-z0-9]+$/, '');
  const code = stripped.charCodeAt(stripped.length - 1);
  const hasFinal = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
  return word + (hasFinal ? withFinal : withoutFinal);
}

/** 문장에 쓰인 자리 표시의 이름(중복 없이, 정렬해서). 복수형 묶음은 모든 형태를 합친다. */
export function placeholdersOf(value: MessageValue): string[] {
  const texts = typeof value === 'string' ? [value] : Object.values(value);
  const names = new Set<string>();
  for (const text of texts) {
    for (const m of text.matchAll(PLACEHOLDER)) names.add(m[1]);
  }
  return [...names].sort();
}

export function formatMessage(
  dict: Readonly<Record<string, MessageValue>>,
  locale: string,
  key: string,
  params?: MessageParams,
): string {
  const value = dict[key];
  // 사전에 없는 키는 그대로 보여 준다(타입 검사를 통과한 코드에서는 일어나지 않는다)
  if (value === undefined) return key;

  let template: string;
  if (typeof value === 'string') {
    template = value;
  } else {
    const count = params?.count;
    const form = typeof count === 'number' ? value[pluralCategory(locale, count) as keyof PluralForms] : undefined;
    template = form ?? value.other;
  }
  if (!template.includes('{')) return template;

  const resolve = (param: MessageParam): string => {
    if (typeof param === 'string') return param;
    if (typeof param === 'number') return String(param);
    if (Array.isArray(param)) {
      const separator = dict[LIST_SEPARATOR_KEY];
      return (param as readonly Message[])
        .map((m) => formatMessage(dict, locale, m.key, m.params))
        .join(typeof separator === 'string' ? separator : ', ');
    }
    const message = param as Message;
    return formatMessage(dict, locale, message.key, message.params);
  };

  return template.replace(PLACEHOLDER, (whole, name: string, modifier: string | undefined) => {
    const param = params?.[name];
    if (param === undefined) return whole;
    const text = resolve(param);
    if (modifier === undefined) return text;
    const slash = modifier.indexOf('/');
    return slash < 0 ? text : josa(text, modifier.slice(0, slash), modifier.slice(slash + 1));
  });
}

/** 문장의 첫 글자를 대문자로 바꾼다. 도형 이름으로 시작하는 검증 메시지에 쓴다(대소문자가 없는 글자는 그대로다). */
export function capitalizeFirst(text: string, locale: string): string {
  if (!text) return text;
  const first = String.fromCodePoint(text.codePointAt(0)!);
  let upper: string;
  try {
    upper = first.toLocaleUpperCase(locale);
  } catch {
    upper = first.toUpperCase();
  }
  // 'ß'처럼 대문자가 여러 글자가 되는 경우는 건드리지 않는다
  return upper.length === first.length && upper !== first ? upper + text.slice(first.length) : text;
}
