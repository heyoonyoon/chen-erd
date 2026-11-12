/**
 * <textarea>와 방의 Y.Text를 잇는다. 팀원이 고친 글이 바로 보이고, 내가 고친 글은 바뀐 구간만 문서에 쓴다.
 *
 * - 내 입력: 입력 직전 글과 지금 글을 비교해 바뀐 한 구간(지우기 + 넣기)만 Y.Text에 쓴다. 통째로 바꾸지 않는다.
 * - 남의 입력: Y.Text의 바뀜(delta)으로 내 선택 범위와 스크롤 자리를 옮겨서 그대로 둔다.
 * - 한글 조합(IME): 조합하는 동안에는 문서에 쓰지 않는다(조합이 깨지지 않게). 조합이 끝날 때 한 번에 쓴다.
 *   조합하는 동안 들어온 남의 입력은 모아 두었다가, 조합이 끝나면 내 구간을 그만큼 옮겨 쓰고 화면을 맞춘다.
 * - 되돌리기: 이 글과 이 편집기(이 사람)의 입력만 되돌리는 Y.UndoManager를 쓴다. 잠깐(0.5초) 사이의 입력은 한 번에 되돌리고,
 *   줄을 바꾸면 묶음을 끊는다. 브라우저의 되돌리기는 막는다(글을 코드로 바꾸면 브라우저의 기록이 어긋난다).
 * - 밑줄(기본키): Y.Text의 서식 속성(UNDERLINE_ATTR)이다. ⌘U(맥)나 Ctrl+U로 고른 구간에 긋거나 지운다.
 *   새로 친 글은 바로 앞 글자의 밑줄을 잇는다(고른 구간을 바꿔 칠 때는 고른 첫 글자를 따른다). 줄 처음에서는 잇지 않고,
 *   이름을 끝내는 글자(쉼표, 괄호, 줄바꿈)를 치면 잇기가 끝난다. 아무것도 고르지 않고 누르면 캐럿을 옮기기 전까지
 *   칠 글자의 밑줄을 켜거나 끈다. 서식 바꾸기도 같은 되돌리기 기록에 들어가고 팀원에게 바로 보인다.
 * - 클립보드: 복사하면 text/plain에는 밑줄 표시 없는 글을, text/html에는 밑줄을 <u>로 넣는다.
 *   붙여 넣을 때는 text/html의 밑줄만 읽고, 일반 텍스트는 친 그대로 넣는다.
 */
import * as Y from 'yjs';
import { UNDERLINE_ATTR } from '../../shared/relational/userSchema';
import {
  clipboardSource,
  insertionRuns,
  isAllUnderlined,
  rangesFromDelta,
  shiftRanges,
  sliceSource,
  sourceToHtml,
  toRuns,
  type RelationalSource,
  type Run,
} from './richText';

/** 한 구간의 바뀜: index에서 remove만큼 지우고 insert를 넣는다 */
export interface TextChange {
  index: number;
  remove: number;
  insert: string;
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/**
 * prev에서 next로 바뀐 가장 작은 한 구간. 같으면 null.
 * cursor(바뀐 뒤의 캐럿, selectionEnd)를 주면 같은 글자가 이어진 곳('aa'에 'a'를 넣기 등)에서도 실제로 친 자리를 고른다.
 */
export function diffText(prev: string, next: string, cursor?: number): TextChange | null {
  if (prev === next) return null;
  const min = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < min && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
  if (cursor !== undefined && cursor >= 0) prefix = Math.min(prefix, Math.max(0, cursor - Math.max(0, next.length - prev.length)));
  // 서로게이트 쌍(이모지 등) 가운데를 가르지 않는다
  if (prefix > 0 && isHigh(prev.charCodeAt(prefix - 1))) prefix--;
  let suffix = 0;
  const maxSuffix = min - prefix;
  while (suffix < maxSuffix && prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)) suffix++;
  if (suffix > 0 && isLow(prev.charCodeAt(prev.length - suffix))) suffix--;
  return { index: prefix, remove: prev.length - prefix - suffix, insert: next.slice(prefix, next.length - suffix) };
}

/** Y.Text의 바뀜(Yjs delta) */
export type TextDelta = ReadonlyArray<{ insert?: unknown; retain?: number; delete?: number }>;

const insertLength = (insert: unknown) => (typeof insert === 'string' ? insert.length : 1);

/**
 * 바뀌기 전 글의 자리 index가 바뀐 뒤 어디로 가는지. 바로 그 자리에 글이 들어오면
 * 'before'는 들어온 글 앞에, 'after'는 뒤에 둔다. 지워진 구간 안의 자리는 지운 자리로 모인다.
 */
export function mapIndex(delta: TextDelta, index: number, assoc: 'before' | 'after' = 'before'): number {
  let oldPos = 0;
  let newPos = 0;
  for (const op of delta) {
    if (op.retain !== undefined) {
      if (index < oldPos + op.retain) return newPos + (index - oldPos);
      oldPos += op.retain;
      newPos += op.retain;
    } else if (op.insert !== undefined) {
      if (index === oldPos && assoc === 'before') return newPos;
      newPos += insertLength(op.insert);
    } else if (op.delete !== undefined) {
      if (index < oldPos + op.delete) return newPos;
      oldPos += op.delete;
    }
  }
  return newPos + (index - oldPos);
}

/** 바뀐 뒤 글에서 마지막으로 바뀐 곳의 끝(되돌리기 뒤의 캐럿 자리). 바뀐 것이 없으면 null */
export function lastChangeEnd(delta: TextDelta): number | null {
  let pos = 0;
  let last: number | null = null;
  for (const op of delta) {
    if (op.retain !== undefined) pos += op.retain;
    else if (op.insert !== undefined) {
      pos += insertLength(op.insert);
      last = pos;
    } else if (op.delete !== undefined) last = pos;
  }
  return last;
}

/** 바뀜을 Y.Text에 쓴다(한 트랜잭션) */
export function applyChange(ytext: Y.Text, change: TextChange, origin: unknown): void {
  const run = () => {
    if (change.remove > 0) ytext.delete(change.index, change.remove);
    if (change.insert) ytext.insert(change.index, change.insert);
  };
  if (ytext.doc) ytext.doc.transact(run, origin);
  else run();
}

/** 덩어리들을 index부터 차례로 넣는다. 밑줄이 아닌 덩어리는 밑줄을 지운 채로 넣는다(앞 글자의 밑줄을 물려받지 않게) */
export function insertRuns(ytext: Y.Text, index: number, runs: readonly Run[]): number {
  let at = index;
  for (const run of runs) {
    if (!run.text) continue;
    ytext.insert(at, run.text, { [UNDERLINE_ATTR]: run.underline ? true : null });
    at += run.text.length;
  }
  return at;
}

/** Y.Text의 글과 밑줄 구간 */
export function readSource(ytext: Y.Text): RelationalSource {
  return { text: ytext.toString(), underlines: rangesFromDelta(ytext.toDelta()) };
}

/** [from, to)의 글자에 밑줄을 긋거나(on) 지운다. 줄바꿈에는 긋지 않는다 */
export function formatUnderline(ytext: Y.Text, from: number, to: number, on: boolean): void {
  if (!on) {
    if (to > from) ytext.format(from, to - from, { [UNDERLINE_ATTR]: null });
    return;
  }
  const text = ytext.toString();
  let start = from;
  for (let i = from; i <= to; i++) {
    if (i === to || text[i] === '\n') {
      if (i > start) ytext.format(start, i - start, { [UNDERLINE_ATTR]: true });
      start = i + 1;
    }
  }
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');

/** 편집기 안의 되돌리기와 다시 하기 키 */
export function historyKey(e: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>, mac = IS_MAC): 'undo' | 'redo' | null {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || e.altKey) return null;
  const z = e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z';
  const y = e.code === 'KeyY' || e.key === 'y' || e.key === 'Y';
  if (z) return e.shiftKey ? 'redo' : 'undo';
  if (y && !mac && !e.shiftKey) return 'redo';
  return null;
}

/** 밑줄 키(⌘U, Ctrl+U). 한글 입력 중에도 code로 본다 */
export function underlineKey(e: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>, mac = IS_MAC): boolean {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || e.altKey || e.shiftKey) return false;
  return e.code === 'KeyU' || e.key === 'u' || e.key === 'U';
}

/** 화면에 적는 밑줄 키 */
export const UNDERLINE_KEYS = IS_MAC ? '⌘U' : 'Ctrl+U';

/** 캐럿을 옮기는 키. 누르면 '다음에 칠 글자의 밑줄' 상태를 버린다 */
const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

export interface BindingOptions {
  /** 같은 사람의 입력을 묶어 한 번에 되돌리는 시간(ms) */
  captureTimeout?: number;
  /** 밑줄 상태(캐럿 자리의 밑줄, 다음에 칠 글자의 밑줄)가 바뀔 수 있을 때 부른다 */
  onFormatState?: () => void;
}

/**
 * textarea 하나와 Y.Text 하나를 잇는다. destroy()로 끊는다.
 * textarea는 제어하지 않는 요소로 쓴다(React의 value를 주지 않는다).
 */
export class TextareaBinding {
  /** 이 편집기가 쓴 트랜잭션의 표시. 되돌리기는 이것만 따라간다 */
  readonly origin: object = { binding: 'relational-text' };
  readonly undo: Y.UndoManager;
  /** 문서에 이미 쓴(또는 받은) 글. 조합 중이 아니면 textarea의 글과 같다 */
  private shown: string;
  private composing = false;
  /** 조합하는 동안 받은 남의 바뀜 */
  private pending: TextDelta[] = [];
  private readonly off: Array<() => void> = [];
  /** 아무것도 고르지 않고 밑줄을 눌렀을 때: 캐럿 자리 at에서 칠 글자의 밑줄. 캐럿을 옮기면 버린다 */
  private mark: { at: number; on: boolean } | null = null;
  /** 조합 중에 밑줄 키를 눌렀다(조합이 끝나면 적용한다) */
  private toggleAfterComposition = false;
  private readonly onFormatState: () => void;

  constructor(
    private readonly ytext: Y.Text,
    private readonly el: HTMLTextAreaElement,
    options: BindingOptions = {},
  ) {
    this.undo = new Y.UndoManager(ytext, { trackedOrigins: new Set([this.origin]), captureTimeout: options.captureTimeout ?? 500 });
    this.onFormatState = options.onFormatState ?? (() => undefined);
    this.shown = ytext.toString();
    el.value = this.shown;

    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      el.addEventListener(type, fn);
      this.off.push(() => el.removeEventListener(type, fn));
    };
    on('compositionstart', () => {
      this.composing = true;
    });
    on('compositionend', () => {
      this.composing = false;
      this.flush();
      if (this.toggleAfterComposition) {
        this.toggleAfterComposition = false;
        this.toggleUnderline();
      }
    });
    on('input', (e) => {
      if (this.composing || (e as InputEvent).isComposing) return;
      this.flush();
    });
    on('beforeinput', (e) => {
      const type = (e as InputEvent).inputType;
      if (type !== 'historyUndo' && type !== 'historyRedo') return;
      e.preventDefault();
      this.history(type === 'historyUndo' ? 'undo' : 'redo');
    });
    on('keydown', (e) => {
      if (underlineKey(e)) {
        // 조합 중이면 조합을 깨지 않게 기본 동작을 두고, 조합이 끝난 뒤에 적용한다
        if (this.composing || e.isComposing) this.toggleAfterComposition = true;
        else {
          e.preventDefault();
          this.toggleUnderline();
        }
        return;
      }
      if (CARET_KEYS.has(e.key)) this.dropMark();
      if (this.composing || e.isComposing) return;
      const which = historyKey(e);
      if (!which) return;
      e.preventDefault();
      this.history(which);
    });
    on('mousedown', () => this.dropMark());
    on('blur', () => this.dropMark());
    on('copy', (e) => this.copy(e, false));
    on('cut', (e) => this.copy(e, true));
    on('paste', (e) => this.paste(e));

    const observer = (event: Y.YTextEvent, tr: Y.Transaction) => this.onRemote(event, tr);
    ytext.observe(observer);
    this.off.push(() => ytext.unobserve(observer));
  }

  /** 지금 조합 중인지(테스트와 화면 표시용) */
  get isComposing(): boolean {
    return this.composing;
  }

  history(which: 'undo' | 'redo'): void {
    this.flush();
    if (which === 'undo') this.undo.undo();
    else this.undo.redo();
    this.onFormatState();
  }

  /** 지금 글과 밑줄(문서 기준) */
  source(): RelationalSource {
    return readSource(this.ytext);
  }

  /**
   * 화면의 글과 밑줄. 조합 중이면 아직 문서에 쓰지 않은 글자까지 넣고, 그 글자의 밑줄은 쓸 때와 같은 규칙으로 정한다.
   * 조합 중에 남의 바뀜이 쌓였으면 문서 기준으로 돌려준다.
   */
  previewSource(): RelationalSource {
    const source = this.source();
    if (!this.composing || this.pending.length > 0) return source;
    const change = diffText(this.shown, this.el.value, this.el.selectionEnd);
    if (!change) return source;
    const { runs } = insertionRuns(change.insert, this.underlineFor(change.index, change.remove));
    const inserted = { text: change.insert, underlines: rangesOfRuns(runs) };
    return { text: this.el.value, underlines: shiftRanges(source.underlines, change.index, change.remove, inserted) };
  }

  /** 글자 자리 index의 앞 글자에서 밑줄을 이을지(줄 처음이면 잇지 않는다) */
  private continues(index: number): boolean {
    if (index <= 0) return false;
    const source = this.source();
    if (source.text[index - 1] === '\n') return false;
    return source.underlines.some((r) => r.from <= index - 1 && index - 1 < r.to);
  }

  /** index에서 remove만큼 바꿔 칠 글자를 밑줄로 넣을지 */
  private underlineFor(index: number, remove: number): boolean {
    if (this.mark && this.mark.at === index && remove === 0) return this.mark.on;
    if (remove > 0) {
      const source = this.source();
      if (source.text[index] !== '\n') return source.underlines.some((r) => r.from <= index && index < r.to);
    }
    return this.continues(index);
  }

  /** 캐럿(또는 고른 구간)의 밑줄 상태. 도구 버튼이 눌린 모양으로 보인다 */
  underlineActive(): boolean {
    const { selectionStart: s, selectionEnd: e } = this.el;
    if (s === e) return this.mark && this.mark.at === s ? this.mark.on : this.continues(s);
    return isAllUnderlined(this.source(), s, e);
  }

  /**
   * 밑줄 켜고 끄기. 고른 구간이 있으면 그 구간이 모두 밑줄일 때 지우고, 아니면 긋는다.
   * 고른 것이 없으면 캐럿을 옮기기 전까지 칠 글자의 밑줄을 바꾼다.
   */
  toggleUnderline(): void {
    if (this.composing) {
      this.toggleAfterComposition = true;
      return;
    }
    this.flush();
    const { selectionStart: s, selectionEnd: e } = this.el;
    if (s === e) {
      this.mark = { at: s, on: !this.underlineActive() };
      this.onFormatState();
      return;
    }
    const on = !isAllUnderlined(this.source(), s, e);
    this.mark = null;
    this.undo.stopCapturing();
    this.transact(() => formatUnderline(this.ytext, s, e, on));
    this.undo.stopCapturing();
    this.onFormatState();
  }

  private dropMark(): void {
    if (!this.mark) return;
    this.mark = null;
    this.onFormatState();
  }

  private transact(fn: () => void): void {
    if (this.ytext.doc) this.ytext.doc.transact(fn, this.origin);
    else fn();
  }

  /** 복사와 잘라 내기: 일반 텍스트(밑줄 표시 없이)와 밑줄을 <u>로 담은 HTML */
  private copy(e: ClipboardEvent, cut: boolean): void {
    const { selectionStart: s, selectionEnd: end } = this.el;
    if (this.composing || s === end || !e.clipboardData) return;
    this.flush();
    const part = sliceSource(this.source(), s, end);
    e.preventDefault();
    e.clipboardData.setData('text/plain', part.text);
    e.clipboardData.setData('text/html', sourceToHtml(part));
    if (!cut) return;
    const v = this.el.value;
    this.el.value = v.slice(0, s) + v.slice(end);
    this.el.setSelectionRange(s, s);
    this.undo.stopCapturing();
    this.flush();
    this.undo.stopCapturing();
  }

  /** 붙여 넣기: HTML이 있으면 그 밑줄과 함께, 없으면 일반 텍스트를 친 그대로 넣는다 */
  private paste(e: ClipboardEvent): void {
    if (this.composing || !e.clipboardData) return;
    const source = clipboardSource(e.clipboardData.getData('text/html'), e.clipboardData.getData('text/plain'));
    e.preventDefault();
    if (!source.text && this.el.selectionStart === this.el.selectionEnd) return;
    this.pasteSource(source);
  }

  /** 고른 구간을 글과 밑줄로 바꾼다(붙여 넣기). 한 번에 되돌린다 */
  pasteSource(source: RelationalSource): void {
    this.flush();
    const { selectionStart: s, selectionEnd: e } = this.el;
    this.mark = null;
    this.undo.stopCapturing();
    this.transact(() => {
      if (e > s) this.ytext.delete(s, e - s);
      insertRuns(this.ytext, s, toRuns(source));
    });
    this.undo.stopCapturing();
    const caret = s + source.text.length;
    this.render(caret, caret);
    this.onFormatState();
  }

  /** textarea의 글을 문서에 쓴다(조합 중이면 쓰지 않는다) */
  flush(): void {
    if (this.composing) return;
    const el = this.el;
    const next = el.value;
    const change = diffText(this.shown, next, el.selectionEnd);
    if (this.pending.length === 0) {
      if (!change) return;
      this.shown = next;
      this.write(change);
      // 줄을 바꾸면 되돌리기 묶음을 끊는다(한 번에 여러 줄이 되돌아가지 않게)
      if (change.insert.includes('\n')) this.undo.stopCapturing();
      return;
    }
    // 조합하는 동안 남의 바뀜이 있었다: 내 구간을 그 바뀜만큼 옮겨 쓰고 화면을 문서에 맞춘다
    const deltas = this.pending;
    this.pending = [];
    const through = (i: number, assoc: 'before' | 'after') => deltas.reduce((pos, d) => mapIndex(d, pos, assoc), i);
    let caret: number;
    let anchor: number;
    if (change) {
      const start = through(change.index, 'after');
      const end = Math.max(start, through(change.index + change.remove, 'before'));
      this.write({ index: start, remove: end - start, insert: change.insert });
      caret = anchor = start + change.insert.length;
    } else {
      anchor = through(el.selectionStart, 'before');
      caret = through(el.selectionEnd, 'before');
    }
    this.render(Math.min(anchor, caret), Math.max(anchor, caret));
  }

  /** 내 바뀜 하나를 문서에 쓴다. 넣는 글의 밑줄은 앞 글자(또는 '다음 글자' 상태)를 따른다 */
  private write(change: TextChange): void {
    const underline = this.underlineFor(change.index, change.remove);
    const { runs, ended } = insertionRuns(change.insert, underline);
    this.transact(() => {
      if (change.remove > 0) this.ytext.delete(change.index, change.remove);
      insertRuns(this.ytext, change.index, runs);
    });
    if (this.mark) {
      // 이어 치는 동안 상태를 지킨다. 이름을 끝내는 글자를 쳤거나 지우기만 했으면 버린다
      if (this.mark.at === change.index && change.insert && !ended) this.mark.at = change.index + change.insert.length;
      else this.mark = null;
      this.onFormatState();
    }
  }

  private onRemote(event: Y.YTextEvent, tr: Y.Transaction): void {
    if (tr.origin === this.origin) return;
    const delta = event.delta as TextDelta;
    if (this.mark) this.mark.at = mapIndex(delta, this.mark.at, 'before');
    this.onFormatState();
    if (this.composing) {
      this.pending.push(delta);
      return;
    }
    const el = this.el;
    if (tr.origin === this.undo) {
      const at = lastChangeEnd(delta);
      if (at !== null) {
        this.render(at, at);
        return;
      }
    }
    const collapsed = el.selectionStart === el.selectionEnd;
    const start = mapIndex(delta, el.selectionStart, collapsed ? 'before' : 'after');
    const end = collapsed ? start : Math.max(start, mapIndex(delta, el.selectionEnd, 'before'));
    this.render(start, end);
  }

  /** 문서의 글을 textarea에 넣고 선택 범위와 스크롤을 지킨다 */
  private render(start: number, end: number): void {
    const el = this.el;
    const text = this.ytext.toString();
    this.shown = text;
    if (el.value === text) return;
    const { scrollTop, scrollLeft } = el;
    const direction = el.selectionDirection ?? 'none';
    el.value = text;
    const clamp = (n: number) => Math.max(0, Math.min(text.length, n));
    try {
      el.setSelectionRange(clamp(start), clamp(end), direction);
    } catch {
      /* 화면에 붙지 않은 요소 */
    }
    el.scrollTop = scrollTop;
    el.scrollLeft = scrollLeft;
  }

  destroy(): void {
    for (const off of this.off.splice(0)) off();
    this.undo.destroy();
  }
}

/** 덩어리들의 밑줄 구간(덩어리를 이은 글 기준) */
function rangesOfRuns(runs: readonly Run[]): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  let pos = 0;
  for (const r of runs) {
    if (r.underline) out.push({ from: pos, to: pos + r.text.length });
    pos += r.text.length;
  }
  return out;
}

/** 글에서 줄과 칸(1부터)이 가리키는 글자 자리(0부터). 범위를 벗어나면 그 줄이나 글의 끝으로 맞춘다 */
export function offsetAt(text: string, line: number, column: number): number {
  let pos = 0;
  for (let l = 1; l < line; l++) {
    const nl = text.indexOf('\n', pos);
    if (nl < 0) return text.length;
    pos = nl + 1;
  }
  const end = text.indexOf('\n', pos);
  const lineEnd = end < 0 ? text.length : end;
  return Math.min(lineEnd, pos + Math.max(0, column - 1));
}

/** 글자 자리(0부터)가 있는 줄(1부터) */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}
