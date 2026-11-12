/**
 * 밑줄이 있는 관계 모델 글을 다루는 작은 순수 함수들(편집기, 클립보드, 겹쳐 그리기가 함께 쓴다).
 * 밑줄은 Y.Text의 서식 속성(UNDERLINE_ATTR)이고, 화면 밖에서는 RelationalSource(글 + 밑줄 구간)로 주고받는다.
 * 사람이 쓰는 표기는 진짜 밑줄뿐이다. 클립보드의 일반 텍스트에는 밑줄 표시 문자를 넣지 않는다.
 */
import { UNDERLINE_ATTR, type RelationalSource, type TextRange } from '../../shared/relational/userSchema';

export type { RelationalSource, TextRange };

/** 한 구간의 글과 밑줄 여부 */
export interface Run {
  text: string;
  underline: boolean;
}

/** 구간을 정렬하고 겹치거나 맞닿은 것을 합친다. 빈 구간은 버린다 */
export function normalizeRanges(ranges: readonly TextRange[]): TextRange[] {
  const sorted = ranges.filter((r) => r.to > r.from).sort((a, b) => a.from - b.from);
  const out: TextRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else out.push({ from: r.from, to: r.to });
  }
  return out;
}

/** Y.Text의 toDelta() 결과에서 밑줄 구간을 읽는다 */
export function rangesFromDelta(delta: ReadonlyArray<{ insert?: unknown; attributes?: Record<string, unknown> }>): TextRange[] {
  const out: TextRange[] = [];
  let pos = 0;
  for (const op of delta) {
    const len = typeof op.insert === 'string' ? op.insert.length : op.insert === undefined ? 0 : 1;
    if (len > 0 && op.attributes?.[UNDERLINE_ATTR]) out.push({ from: pos, to: pos + len });
    pos += len;
  }
  return normalizeRanges(out);
}

/** 글과 밑줄 구간을 한 덩어리씩 나눈다(빈 글이면 빈 배열) */
export function toRuns(source: RelationalSource): Run[] {
  const { text } = source;
  const out: Run[] = [];
  let pos = 0;
  for (const r of normalizeRanges(source.underlines)) {
    const from = Math.max(pos, Math.min(text.length, r.from));
    const to = Math.max(from, Math.min(text.length, r.to));
    if (from > pos) out.push({ text: text.slice(pos, from), underline: false });
    if (to > from) out.push({ text: text.slice(from, to), underline: true });
    pos = to;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), underline: false });
  return out;
}

/** 덩어리들을 글과 밑줄 구간으로 모은다. 줄바꿈에는 밑줄을 두지 않는다 */
export function fromRuns(runs: readonly Run[]): RelationalSource {
  let text = '';
  const underlines: TextRange[] = [];
  for (const run of runs) {
    if (run.underline) {
      let start = text.length;
      for (let i = 0; i < run.text.length; i++) {
        if (run.text[i] === '\n') {
          underlines.push({ from: start, to: text.length + i });
          start = text.length + i + 1;
        }
      }
      underlines.push({ from: start, to: text.length + run.text.length });
    }
    text += run.text;
  }
  return { text, underlines: normalizeRanges(underlines) };
}

/** 글의 [from, to) 부분과 그 안의 밑줄 */
export function sliceSource(source: RelationalSource, from: number, to: number): RelationalSource {
  const underlines: TextRange[] = [];
  for (const r of source.underlines) {
    const a = Math.max(from, r.from);
    const b = Math.min(to, r.to);
    if (b > a) underlines.push({ from: a - from, to: b - from });
  }
  return { text: source.text.slice(from, to), underlines: normalizeRanges(underlines) };
}

/** [from, to) 안의 글자(줄바꿈 제외)가 모두 밑줄인지. 줄바꿈만 있으면 false */
export function isAllUnderlined(source: RelationalSource, from: number, to: number): boolean {
  let any = false;
  for (let i = from; i < to; i++) {
    if (source.text[i] === '\n') continue;
    any = true;
    if (!source.underlines.some((r) => r.from <= i && i < r.to)) return false;
  }
  return any;
}

/** 이름 안에 들어가지 않는 글자. 이어 치던 밑줄은 여기서 끝난다 */
const BREAKS = /[,()\n]/;

/**
 * 새로 친 글을 어떻게 넣을지. 밑줄을 잇는 중이면 이름을 끝내는 글자(쉼표, 괄호, 줄바꿈)에서 밑줄을 끝낸다.
 * ended는 그 글자를 만나 밑줄 잇기가 끝났는지.
 */
export function insertionRuns(text: string, underline: boolean): { runs: Run[]; ended: boolean } {
  if (!text) return { runs: [], ended: false };
  if (!underline) return { runs: [{ text, underline: false }], ended: false };
  const stop = text.search(BREAKS);
  if (stop < 0) return { runs: [{ text, underline: true }], ended: false };
  const runs: Run[] = [];
  if (stop > 0) runs.push({ text: text.slice(0, stop), underline: true });
  runs.push({ text: text.slice(stop), underline: false });
  return { runs, ended: true };
}

/**
 * 글의 한 구간이 바뀔 때(index에서 remove만큼 지우고 inserted를 넣는다) 밑줄 구간을 옮긴다.
 * inserted의 밑줄은 넣은 글 기준의 구간이다(조합 중 미리 보기에 쓴다).
 */
export function shiftRanges(ranges: readonly TextRange[], index: number, remove: number, inserted: RelationalSource): TextRange[] {
  const added = inserted.text.length;
  const out: TextRange[] = [];
  const end = index + remove;
  // 넣은 글의 밑줄은 inserted가 정한다. 둘레의 구간은 넣은 글을 덮지 않는다
  const from = (p: number) => (p < index ? p : p < end ? index + added : p - remove + added);
  const to = (p: number) => (p <= index ? p : p <= end ? index : p - remove + added);
  for (const r of ranges) {
    if (r.from < index && r.to > end) {
      // 넣은 자리를 사이에 두면 둘로 나뉜다
      out.push({ from: r.from, to: index });
      out.push({ from: index + added, to: r.to - remove + added });
      continue;
    }
    out.push({ from: from(r.from), to: to(r.to) });
  }
  for (const u of inserted.underlines) out.push({ from: index + u.from, to: index + u.to });
  return normalizeRanges(out);
}

// ───────────────────────── 클립보드 ─────────────────────────

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 연속한 공백이 문서 편집기에서 하나로 줄지 않게 둘째부터 nbsp로 바꾼다 */
const keepSpaces = (s: string) => s.replace(/ {2,}/g, (m) => ' ' + '&nbsp;'.repeat(m.length - 1)).replace(/^ /, '&nbsp;');

/**
 * 복사할 HTML. 줄마다 문단 하나이고 밑줄 구간은 <u>로 감싼다(Word, 한글, Google 문서에 붙여도 밑줄이 남는다).
 * 글자는 모두 이스케이프한다.
 */
export function sourceToHtml(source: RelationalSource): string {
  const lines: string[] = [];
  let line = '';
  for (const run of toRuns(source)) {
    const parts = run.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) {
        lines.push(line);
        line = '';
      }
      if (!part) return;
      const html = keepSpaces(escapeHtml(part));
      line += run.underline ? `<u>${html}</u>` : html;
    });
  }
  lines.push(line);
  const body = lines.map((l) => `<p style="margin:0">${l || '<br>'}</p>`).join('');
  return `<meta charset="utf-8"><div style="font-family:Consolas,'D2Coding',monospace;white-space:pre-wrap">${body}</div>`;
}

/** 속 글을 읽지 않는 요소 */
const SKIP = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'img', 'video', 'audio', 'canvas', 'button', 'select', 'input', 'textarea']);
/** 앞뒤로 줄을 바꾸는 요소 */
const BLOCKS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tr', 'ul', 'body', 'html',
]);

/** 한 요소의 style 글에서 밑줄 여부. true: 밑줄, false: 밑줄 없음을 정함, null: 말하지 않음 */
export function underlineFromStyle(style: string): boolean | null {
  let result: boolean | null = null;
  for (const decl of style.split(';')) {
    const at = decl.indexOf(':');
    if (at < 0) continue;
    const prop = decl.slice(0, at).trim().toLowerCase();
    const value = decl.slice(at + 1).trim().toLowerCase();
    if (prop === 'text-decoration' || prop === 'text-decoration-line') {
      if (/\bunderline\b/.test(value)) result = true;
      else if (/\bnone\b/.test(value) || /\b(line-through|overline)\b/.test(value)) result = false;
    } else if (prop === 'text-underline' || prop === 'text-underline-style') {
      // Word(mso)의 밑줄 표시
      result = value !== 'none';
    }
  }
  return result;
}

/** <style> 안의 .클래스 규칙에서 밑줄을 정한 클래스 */
function classRules(doc: Document): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const el of Array.from(doc.querySelectorAll('style'))) {
    const css = (el.textContent ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--|-->/g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decided = underlineFromStyle(m[2]);
      if (decided === null) continue;
      for (const sel of m[1].split(',')) {
        const cls = /^\s*[a-z0-9]*\.([\w-]+)\s*$/i.exec(sel);
        if (cls) out.set(cls[1].toLowerCase(), decided);
      }
    }
  }
  return out;
}

/**
 * 붙여 넣은 HTML에서 글과 밑줄만 꺼낸다. <u>, <ins>, text-decoration: underline, Word와 Google 문서의 밑줄 스타일을 읽는다.
 * 문서는 화면에 붙이지 않고(DOMParser는 스크립트를 돌리지 않고 그림도 받지 않는다) 글자만 읽는다.
 * HTML을 읽을 수 없으면 null.
 */
export function htmlToSource(html: string): RelationalSource | null {
  if (typeof DOMParser === 'undefined') return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }
  const classes = classRules(doc);
  const chars: string[] = [];
  const marks: boolean[] = [];
  /** 하나로 줄일 수 있는 공백(pre가 아닌 곳의 공백) */
  const soft: boolean[] = [];

  const lastChar = () => chars[chars.length - 1];
  const dropSoftTail = () => {
    while (chars.length > 0 && soft[soft.length - 1] && lastChar() === ' ') {
      chars.pop();
      marks.pop();
      soft.pop();
    }
  };
  const newline = (force: boolean) => {
    dropSoftTail();
    if (!force && (chars.length === 0 || lastChar() === '\n')) return;
    chars.push('\n');
    marks.push(false);
    soft.push(false);
  };
  const push = (text: string, underline: boolean, pre: boolean) => {
    for (const raw of Array.from(text)) {
      let c = raw;
      if (c === '​' || c === '﻿' || c === '\r') continue;
      if (!pre && /[\t\n\f ]/.test(c)) {
        if (chars.length === 0 || lastChar() === '\n' || lastChar() === ' ') continue;
        chars.push(' ');
        marks.push(underline);
        soft.push(true);
        continue;
      }
      if (c === ' ') c = ' ';
      chars.push(c);
      marks.push(c === '\n' ? false : underline);
      soft.push(false);
    }
  };

  const walk = (node: Node, underline: boolean, pre: boolean) => {
    if (node.nodeType === 3) {
      push(node.nodeValue ?? '', underline, pre);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.localName.toLowerCase();
    if (SKIP.has(tag)) return;
    if (tag === 'br') {
      newline(true);
      return;
    }
    let ul = underline;
    if (tag === 'u' || tag === 'ins') ul = true;
    for (const cls of Array.from(el.classList)) {
      const decided = classes.get(cls.toLowerCase());
      if (decided !== undefined) ul = decided;
    }
    const style = el.getAttribute('style') ?? '';
    const decided = underlineFromStyle(style);
    if (decided !== null) ul = decided;
    let isPre = pre;
    if (tag === 'pre' || tag === 'listing' || tag === 'xmp') isPre = true;
    const ws = /white-space\s*:\s*([\w-]+)/i.exec(style);
    if (ws) isPre = /^(pre|pre-wrap|break-spaces)$/i.test(ws[1]);
    const block = BLOCKS.has(tag);
    if (block) newline(false);
    for (const child of Array.from(el.childNodes)) walk(child, ul, isPre);
    if (block) newline(false);
    if (tag === 'td' || tag === 'th') push(' ', ul, false);
  };
  walk(doc.body ?? doc.documentElement, false, false);
  dropSoftTail();
  while (chars.length > 0 && lastChar() === '\n') {
    chars.pop();
    marks.pop();
    soft.pop();
    dropSoftTail();
  }
  const runs: Run[] = [];
  chars.forEach((c, i) => {
    const last = runs[runs.length - 1];
    if (last && last.underline === marks[i]) last.text += c;
    else runs.push({ text: c, underline: marks[i] });
  });
  return fromRuns(runs);
}

/** 붙여 넣을 글. HTML이 있으면 그 밑줄을 쓰고, 없으면 일반 텍스트를 밑줄 없이 그대로 쓴다(_이름_ 을 밑줄로 바꾸지 않는다) */
export function clipboardSource(html: string, plain: string): RelationalSource {
  const fromHtml = html ? htmlToSource(html) : null;
  if (fromHtml && fromHtml.text) return fromHtml;
  return { text: plain.replace(/\r\n?/g, '\n'), underlines: [] };
}
