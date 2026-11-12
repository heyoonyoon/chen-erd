/**
 * 밑줄 구간 ↔ 일반 텍스트 교환 표기(_이름_). 계약은 ./userSchema.ts에 있다.
 *
 * 밑줄(Y.Text 서식)이 원본이고, _이름_ 표기는 밑줄을 담을 수 없는 곳(API, CLI, MCP, 일반 텍스트 클립보드)에서만 쓴다.
 * 편집기에 적힌 _ 는 그냥 이름의 글자다. _이름_ 을 밑줄로 읽는 것은 fromMarkup뿐이다.
 *
 * toMarkup 규칙(낱말 단위. 낱말 나누기는 파서와 같은 lexer.ts)
 *   1. 이름 글자(공백 제외)에 밑줄이 하나라도 걸린 이름은 통째로 _ 로 감싼다: Film_ID → _Film_ID_, "Film ID" → _"Film ID"_.
 *      일부만 그은 밑줄도 이름 전체로 넓힌다(파서도 기본키로 본다).
 *   2. 공백, 구두점, 따옴표만 덮은 밑줄과 주석 안의 밑줄은 버린다(파서도 무시한다).
 *   3. 따옴표가 닫히지 않은 이름의 밑줄은 버린다(감쌀 수 없다).
 *   4. 밑줄이 없는데 표시로 읽힐 낱말은 큰따옴표로 묶는다: 앞뒤가 모두 _ 인 세 글자 이상의 이름(_x_ → "_x_"),
 *      그리고 바로 뒤에 큰따옴표가 붙은 낱말 _ 하나.
 *   5. 나머지 글자는 그대로 둔다.
 * fromMarkup 규칙
 *   앞뒤가 모두 _ 인 세 글자 이상의 낱말(_Film_ID_)과 _"따옴표 이름"_ 에서 앞뒤 _ 하나씩을 빼고 그 사이에 밑줄을 긋는다
 *   (따옴표 이름은 따옴표까지 밑줄). Film_ID, _Film_ID, Film_ID_ 처럼 한쪽만 _ 인 낱말, 따옴표 안, 주석 안은 건드리지 않는다.
 * 그래서 밑줄이 이름(따옴표 이름은 따옴표까지) 하나를 꼭 덮고 앞뒤가 _ 인 맨 이름이 없는 보통 글에서는 fromMarkup(toMarkup(s))가 s와 같다.
 */
import { lex, underlineMask, underlineState, isMarkerWord } from './lexer';
import type { RelationalSource, TextRange } from './userSchema';

/** 겹치거나 맞닿은 구간을 합치고 정렬한다. 빈 구간과 범위 밖은 버린다 */
export function normalizeRanges(ranges: ReadonlyArray<TextRange>, length: number): TextRange[] {
  const mask = underlineMask(length, ranges);
  return maskToRanges(mask);
}

export function maskToRanges(mask: Uint8Array): TextRange[] {
  const out: TextRange[] = [];
  let i = 0;
  while (i < mask.length) {
    if (!mask[i]) {
      i++;
      continue;
    }
    const from = i;
    while (i < mask.length && mask[i]) i++;
    out.push({ from, to: i });
  }
  return out;
}

const quote = (name: string) => '"' + name.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

export function toMarkup(source: RelationalSource): string {
  const text = source.text;
  const mask = underlineMask(text.length, source.underlines);
  let out = '';
  let at = 0;
  for (const t of lex(text)) {
    if (t.type !== 'name') continue;
    const raw = text.slice(t.start, t.end);
    let written = raw;
    if (underlineState(text, mask, t) !== 'none') {
      if (!t.unterminated) written = `_${raw}_`;
    } else if (!t.quoted && (isMarkerWord(raw) || (raw === '_' && text[t.end] === '"'))) {
      written = quote(raw);
    }
    if (written === raw) continue;
    out += text.slice(at, t.start) + written;
    at = t.end;
  }
  return out + text.slice(at);
}

/** fromMarkup과 함께, 바꾼 글의 자리 → 표기 글의 자리(길이 text.length + 1) */
export function convertMarkup(markup: string): { source: RelationalSource; toMarkupIndex: number[] } {
  let text = '';
  const toMarkupIndex: number[] = [];
  const ranges: TextRange[] = [];
  let at = 0;
  const copy = (end: number) => {
    for (let k = at; k < end; k++) toMarkupIndex.push(k);
    text += markup.slice(at, end);
    at = end;
  };
  for (const t of lex(markup, true)) {
    if (!t.marker) continue;
    copy(t.start);
    at = t.start + 1; // 여는 _ 를 뺀다
    const from = text.length;
    copy(t.end - 1);
    ranges.push({ from, to: text.length });
    at = t.end; // 닫는 _ 를 뺀다
  }
  copy(markup.length);
  toMarkupIndex.push(markup.length);
  return { source: { text, underlines: normalizeRanges(ranges, text.length) }, toMarkupIndex };
}

export function fromMarkup(markup: string): RelationalSource {
  return convertMarkup(markup).source;
}
