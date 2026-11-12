/**
 * 관계 모델 글을 낱말(토큰)로 나눈다. 파서(text.ts)와 밑줄 표기 변환(markup.ts)이 같은 규칙을 쓴다.
 *
 *   줄바꿈은 토큰, 다른 공백과 BOM은 건너뛴다. # 뒤는 줄 끝까지 주석이다.
 *   ( ) , 와 화살표(-> 또는 →)는 한 글자짜리 토큰이다. 화살표 표기는 이제 받지 않지만, 잘못 적은 곳을 알려 주려고 따로 읽는다.
 *   큰따옴표로 묶은 이름은 줄 안에서 닫혀야 한다(안의 \" 와 \\ 는 글자 하나). 닫히지 않으면 줄 끝까지를 이름으로 본다.
 *   그 밖의 글자가 이어진 것은 이름 하나다. 밑줄 문자(_)도 이름의 글자다.
 *
 * markers가 true면(일반 텍스트 교환 표기, fromMarkup만 쓴다) _이름_ 과 _"이름"_ 을 밑줄 표시로 읽는다.
 *   앞뒤가 모두 _ 이고 세 글자 이상인 이름만 표시다. Film_ID, _Film_ID, Film_ID_ 는 표시가 아니다.
 */

export type LexType = 'name' | '(' | ')' | ',' | '->' | 'nl';

export interface LexToken {
  type: LexType;
  /** 글에서의 자리(UTF-16). end는 포함하지 않는다 */
  start: number;
  end: number;
  /** 줄과 칸(1부터). 토큰은 줄을 넘지 않는다 */
  line: number;
  column: number;
  endColumn: number;
  /** 이름이면 이름(따옴표와 이스케이프를 푼 것), 아니면 그 글자 */
  value: string;
  quoted: boolean;
  /** 따옴표가 줄 안에서 닫히지 않았다 */
  unterminated: boolean;
  /** markers일 때 _이름_ 표시였다 */
  marker: boolean;
  /** 이름 글자의 자리(따옴표와 표시 밑줄을 뺀 것) */
  nameStart: number;
  nameEnd: number;
}

const isSpace = (c: string) => /\s/.test(c) || c === '﻿';

/** 이름이 끝나는 글자 */
function endsWord(text: string, i: number): boolean {
  const c = text[i];
  return isSpace(c) || c === '(' || c === ')' || c === ',' || c === '"' || c === '#' || c === '→' || (c === '-' && text[i + 1] === '>');
}

/** _이름_ 표시 모양인지(앞뒤가 모두 _ 이고 세 글자 이상) */
export function isMarkerWord(word: string): boolean {
  return word.length >= 3 && word.startsWith('_') && word.endsWith('_');
}

export function lex(text: string, markers = false): LexToken[] {
  const tokens: LexToken[] = [];
  const n = text.length;
  let line = 1;
  let lineStart = 0;
  let i = 0;
  const push = (type: LexType, start: number, value: string, extra: Partial<LexToken> = {}) =>
    tokens.push({
      type,
      start,
      end: i,
      line,
      column: start - lineStart + 1,
      endColumn: i - lineStart + 1,
      value,
      quoted: false,
      unterminated: false,
      marker: false,
      nameStart: start,
      nameEnd: i,
      ...extra,
    });
  /** i는 여는 따옴표. 닫는 따옴표 다음(또는 줄 끝)까지 읽는다 */
  const readQuoted = (): { value: string; closed: boolean } => {
    let value = '';
    i++;
    while (i < n && text[i] !== '\n') {
      const c = text[i];
      if (c === '"') {
        i++;
        return { value, closed: true };
      }
      if (c === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) {
        value += text[i + 1];
        i += 2;
        continue;
      }
      value += c;
      i++;
    }
    return { value, closed: false };
  };

  while (i < n) {
    const ch = text[i];
    const start = i;
    if (ch === '\n') {
      i++;
      push('nl', start, '\n');
      line++;
      lineStart = i;
      continue;
    }
    if (isSpace(ch)) {
      i++;
      continue;
    }
    if (ch === '#') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === ',') {
      i++;
      push(ch, start, ch);
      continue;
    }
    if (ch === '→' || (ch === '-' && text[i + 1] === '>')) {
      i += ch === '→' ? 1 : 2;
      push('->', start, '->');
      continue;
    }
    if (ch === '"') {
      const q = readQuoted();
      push('name', start, q.value, { quoted: true, unterminated: !q.closed, nameStart: start + 1, nameEnd: q.closed ? i - 1 : i });
      continue;
    }
    if (markers && ch === '_' && text[i + 1] === '"') {
      i++;
      const q = readQuoted();
      if (q.closed && text[i] === '_') {
        i++;
        push('name', start, q.value, { quoted: true, marker: true, nameStart: start + 2, nameEnd: i - 2 });
      } else {
        // 닫는 _ 가 없으면 표시가 아니다. 글자는 그대로 둔다
        push('name', start, '_', { quoted: false, unterminated: !q.closed });
      }
      continue;
    }
    while (i < n && !endsWord(text, i)) i++;
    const word = text.slice(start, i);
    if (markers && isMarkerWord(word)) push('name', start, word.slice(1, -1), { marker: true, nameStart: start + 1, nameEnd: i - 1 });
    else push('name', start, word);
  }
  return tokens;
}

/** 밑줄 구간을 글자마다의 표시로. 범위를 벗어난 부분은 버린다 */
export function underlineMask(length: number, ranges: ReadonlyArray<{ from: number; to: number }>): Uint8Array {
  const mask = new Uint8Array(length);
  for (const r of ranges) {
    const from = Math.max(0, Math.floor(Number(r.from)));
    const to = Math.min(length, Math.floor(Number(r.to)));
    if (!(to > from)) continue;
    mask.fill(1, from, to);
  }
  return mask;
}

export type UnderlineState = 'none' | 'partial' | 'full';

/** 이름 토큰의 이름 글자(공백 제외)에 밑줄이 얼마나 걸렸는지. 따옴표, 구두점, 공백에 걸린 밑줄은 따지지 않는다 */
export function underlineState(text: string, mask: Uint8Array, t: LexToken): UnderlineState {
  if (t.type !== 'name') return 'none';
  let total = 0;
  let covered = 0;
  for (let k = t.nameStart; k < t.nameEnd; k++) {
    if (isSpace(text[k])) continue;
    total++;
    if (mask[k]) covered++;
  }
  if (covered === 0) return 'none';
  return covered === total ? 'full' : 'partial';
}
