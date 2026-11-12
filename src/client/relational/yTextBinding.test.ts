// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { TextareaBinding, diffText, historyKey, lastChangeEnd, lineAt, mapIndex, offsetAt, underlineKey, type TextDelta } from './yTextBinding';

describe('diffText', () => {
  it('같으면 null, 다르면 바뀐 한 구간만', () => {
    expect(diffText('abc', 'abc')).toBeNull();
    expect(diffText('학생(이름)', '학생(학번, 이름)')).toEqual({ index: 3, remove: 0, insert: '학번, ' });
    expect(diffText('학생(학번, 이름)', '학생(학번)')).toEqual({ index: 5, remove: 4, insert: '' });
    expect(diffText('abcdef', 'abXYef')).toEqual({ index: 2, remove: 2, insert: 'XY' });
  });

  it('같은 글자가 이어진 곳에서는 캐럿으로 친 자리를 고른다', () => {
    // 'aa'의 1번 자리에 a를 넣었다(캐럿 2)
    expect(diffText('aa', 'aaa', 2)).toEqual({ index: 1, remove: 0, insert: 'a' });
    // 'aaa'의 2번 자리 앞에서 Backspace(캐럿 1)
    expect(diffText('aaa', 'aa', 1)).toEqual({ index: 1, remove: 1, insert: '' });
    // 캐럿이 없으면 앞에서부터 맞춘다
    expect(diffText('aa', 'aaa')).toEqual({ index: 2, remove: 0, insert: 'a' });
  });

  it('서로게이트 쌍을 가르지 않는다', () => {
    const c = diffText('a\u{1F600}b', 'a\u{1F601}b')!;
    expect(c.index).toBe(1);
    expect(c.remove).toBe(2);
    expect(c.insert).toBe('\u{1F601}');
  });
});

describe('mapIndex, lastChangeEnd', () => {
  const delta: TextDelta = [{ retain: 2 }, { insert: 'XY' }, { retain: 3 }, { delete: 2 }];
  it('앞쪽 자리는 그대로, 뒤쪽 자리는 바뀐 만큼 옮긴다', () => {
    expect(mapIndex(delta, 0)).toBe(0);
    expect(mapIndex(delta, 1)).toBe(1);
    expect(mapIndex(delta, 2, 'before')).toBe(2);
    expect(mapIndex(delta, 2, 'after')).toBe(4);
    expect(mapIndex(delta, 4)).toBe(6);
    // 지운 구간 안은 지운 자리로
    expect(mapIndex(delta, 5)).toBe(7);
    expect(mapIndex(delta, 6)).toBe(7);
    expect(mapIndex(delta, 9)).toBe(9);
  });
  it('마지막으로 바뀐 곳', () => {
    expect(lastChangeEnd(delta)).toBe(7);
    expect(lastChangeEnd([{ retain: 3 }, { insert: 'ab' }])).toBe(5);
    expect(lastChangeEnd([{ retain: 3 }])).toBeNull();
  });
});

describe('offsetAt, lineAt, historyKey', () => {
  it('줄과 칸', () => {
    const text = 'ab\ncde\n';
    expect(offsetAt(text, 1, 1)).toBe(0);
    expect(offsetAt(text, 2, 2)).toBe(4);
    expect(offsetAt(text, 2, 99)).toBe(6);
    expect(offsetAt(text, 9, 1)).toBe(text.length);
    expect(lineAt(text, 0)).toBe(1);
    expect(lineAt(text, 4)).toBe(2);
    expect(lineAt(text, text.length)).toBe(3);
  });
  it('되돌리기 키(한글 입력 중에도 code로 본다)', () => {
    const k = (o: Partial<KeyboardEvent>) => ({ code: '', key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });
    expect(historyKey(k({ code: 'KeyZ', key: 'ㅋ', metaKey: true }), true)).toBe('undo');
    expect(historyKey(k({ code: 'KeyZ', metaKey: true, shiftKey: true }), true)).toBe('redo');
    expect(historyKey(k({ code: 'KeyZ', ctrlKey: true }), false)).toBe('undo');
    expect(historyKey(k({ code: 'KeyY', ctrlKey: true }), false)).toBe('redo');
    expect(historyKey(k({ code: 'KeyY', metaKey: true }), true)).toBeNull();
    expect(historyKey(k({ code: 'KeyZ' }), false)).toBeNull();
  });
});

// ───────────────────────── textarea와 잇기 ─────────────────────────

function setup(initial = '') {
  const doc = new Y.Doc();
  const ytext = doc.getText('relational-text');
  if (initial) ytext.insert(0, initial);
  const el = document.createElement('textarea');
  document.body.appendChild(el);
  const binding = new TextareaBinding(ytext, el, { captureTimeout: 0 });
  const deltas: TextDelta[] = [];
  ytext.observe((e) => deltas.push(e.delta as TextDelta));
  return { doc, ytext, el, binding, deltas };
}

/** 사용자가 친 것처럼: 값과 캐럿을 바꾸고 input을 보낸다 */
function type(el: HTMLTextAreaElement, value: string, caret: number, composing = false) {
  el.value = value;
  el.setSelectionRange(caret, caret);
  const e = new Event('input', { bubbles: true }) as Event & { isComposing?: boolean };
  Object.defineProperty(e, 'isComposing', { value: composing });
  el.dispatchEvent(e);
}

/** 다른 사람의 편집(다른 문서에서 고친 것을 받는다) */
function remote(doc: Y.Doc, edit: (text: Y.Text) => void) {
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  const before = Y.encodeStateVector(other);
  edit(other.getText('relational-text'));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, before), 'remote');
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  document.body.innerHTML = '';
});

describe('TextareaBinding', () => {
  it('처음 글을 보여 주고, 내 입력은 바뀐 구간만 문서에 쓴다', () => {
    const { ytext, el, binding, deltas } = setup('학생(학번)');
    cleanups.push(() => binding.destroy());
    expect(el.value).toBe('학생(학번)');
    type(el, '학생(학번, 이름)', 9);
    expect(ytext.toString()).toBe('학생(학번, 이름)');
    expect(deltas.at(-1)).toEqual([{ retain: 5 }, { insert: ', 이름' }]);
    // 지우기도 그 구간만
    type(el, '학생(학번)', 5);
    expect(deltas.at(-1)).toEqual([{ retain: 5 }, { delete: 4 }]);
    // 고른 구간을 바꾸면 지우기와 넣기 한 번
    type(el, '과목(학번)', 2);
    expect(deltas.at(-1)).toEqual([{ delete: 2 }, { insert: '과목' }]);
    expect(ytext.toString()).toBe('과목(학번)');
  });

  it('남이 앞쪽을 고쳐도 내 캐럿과 선택 범위, 스크롤은 같은 글자에 머문다', () => {
    const { doc, el, binding } = setup('학생(학번, 이름)\n과목(과목코드)');
    cleanups.push(() => binding.destroy());
    el.focus();
    // '이름'을 고른 채로
    el.setSelectionRange(7, 9);
    el.scrollTop = 0;
    remote(doc, (t) => t.insert(0, '학과(학과코드)\n'));
    expect(el.value).toBe('학과(학과코드)\n학생(학번, 이름)\n과목(과목코드)');
    expect(el.value.slice(el.selectionStart, el.selectionEnd)).toBe('이름');
    // 내 캐럿 뒤쪽을 고치면 캐럿은 그대로
    el.setSelectionRange(3, 3);
    remote(doc, (t) => t.insert(t.length, '\n교수(교수번호)'));
    expect(el.selectionStart).toBe(3);
    expect(el.selectionEnd).toBe(3);
    // 캐럿이 든 구간을 남이 지우면 지운 자리로 모인다
    el.setSelectionRange(12, 12);
    remote(doc, (t) => t.delete(10, 4));
    expect(el.selectionStart).toBe(10);
  });

  it('한글 조합 중에는 문서에 쓰지 않고, 조합이 끝날 때 한 번에 쓴다', () => {
    const { ytext, el, binding, deltas } = setup('학생(');
    cleanups.push(() => binding.destroy());
    const before = deltas.length;
    el.dispatchEvent(new Event('compositionstart'));
    type(el, '학생(ㅎ', 4, true);
    type(el, '학생(하', 4, true);
    type(el, '학생(학', 4, true);
    expect(deltas.length).toBe(before);
    expect(ytext.toString()).toBe('학생(');
    expect(binding.isComposing).toBe(true);
    el.dispatchEvent(new Event('compositionend'));
    expect(ytext.toString()).toBe('학생(학');
    expect(deltas.length).toBe(before + 1);
    expect(deltas.at(-1)).toEqual([{ retain: 3 }, { insert: '학' }]);
    // 조합이 끝난 뒤의 input(브라우저에 따라 온다)은 아무것도 쓰지 않는다
    type(el, '학생(학', 4);
    expect(deltas.length).toBe(before + 1);
  });

  it('조합 중에 들어온 남의 입력은 조합을 깨지 않고, 조합이 끝나면 둘 다 남는다', () => {
    const { doc, ytext, el, binding } = setup('학생()\n과목()');
    cleanups.push(() => binding.destroy());
    el.dispatchEvent(new Event('compositionstart'));
    type(el, '학생(이)\n과목()', 4, true);
    remote(doc, (t) => t.insert(0, '학과(학과코드)\n'));
    // 조합 중인 textarea는 건드리지 않는다
    expect(el.value).toBe('학생(이)\n과목()');
    type(el, '학생(이름)\n과목()', 5, true);
    el.dispatchEvent(new Event('compositionend'));
    expect(ytext.toString()).toBe('학과(학과코드)\n학생(이름)\n과목()');
    expect(el.value).toBe(ytext.toString());
    // 캐럿은 내가 친 글자 바로 뒤
    expect(el.selectionStart).toBe('학과(학과코드)\n학생(이름'.length);
  });

  it('되돌리기는 이 편집기의 입력만 되돌리고, 다시 하기도 된다', () => {
    const { doc, ytext, el, binding } = setup('');
    cleanups.push(() => binding.destroy());
    type(el, '학생(학번)', 6);
    binding.undo.stopCapturing();
    remote(doc, (t) => t.insert(t.length, '\n과목(과목코드)'));
    type(el, '학생(학번, 이름)\n과목(과목코드)', 10);
    const z = new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', ctrlKey: !isMac(), metaKey: isMac(), bubbles: true, cancelable: true });
    el.dispatchEvent(z);
    expect(z.defaultPrevented).toBe(true);
    expect(ytext.toString()).toBe('학생(학번)\n과목(과목코드)');
    expect(el.value).toBe(ytext.toString());
    // 캐럿은 되돌린 자리(지운 ', 이름'이 있던 곳)
    expect(el.selectionStart).toBe(5);
    binding.history('undo');
    // 남이 쓴 줄은 남는다
    expect(ytext.toString()).toBe('\n과목(과목코드)');
    binding.history('redo');
    expect(ytext.toString()).toBe('학생(학번)\n과목(과목코드)');
    // 브라우저 메뉴의 되돌리기도 같은 길로
    const before = new InputEvent('beforeinput', { inputType: 'historyRedo', cancelable: true });
    el.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    expect(ytext.toString()).toBe('학생(학번, 이름)\n과목(과목코드)');
  });

  it('끊으면 더는 따라가지 않는다', () => {
    const { doc, el, binding, ytext } = setup('a');
    binding.destroy();
    remote(doc, (t) => t.insert(1, 'b'));
    expect(el.value).toBe('a');
    type(el, 'ax', 2);
    expect(ytext.toString()).toBe('ab');
  });
});

function isMac(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
}

// ───────────────────────── 밑줄(기본키) ─────────────────────────

const ul = (b: TextareaBinding) => {
  const s = b.source();
  return s.underlines.map((r) => s.text.slice(r.from, r.to));
};

/** 밑줄 키(⌘U 또는 Ctrl+U). 한글 자판이면 key는 'ㅕ'다 */
function underlineKeyDown(el: HTMLTextAreaElement, composing = false): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { code: 'KeyU', key: 'ㅕ', ctrlKey: !isMac(), metaKey: isMac(), bubbles: true, cancelable: true, isComposing: composing });
  el.dispatchEvent(e);
  return e;
}

/** 복사, 잘라 내기, 붙여 넣기 이벤트(jsdom에는 ClipboardEvent가 없어서 흉내 낸다) */
function clip(el: HTMLTextAreaElement, type: 'copy' | 'cut' | 'paste', data: Record<string, string> = {}) {
  const store = { ...data };
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', {
    value: { setData: (k: string, v: string) => (store[k] = v), getData: (k: string) => store[k] ?? '' },
  });
  el.dispatchEvent(e);
  return { prevented: e.defaultPrevented, data: store };
}

describe('밑줄', () => {
  it('밑줄 키는 ⌘U(맥)나 Ctrl+U이고 한글 자판에서도 된다', () => {
    const k = (o: Partial<KeyboardEvent>) => ({ code: '', key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });
    expect(underlineKey(k({ code: 'KeyU', key: 'ㅕ', metaKey: true }), true)).toBe(true);
    expect(underlineKey(k({ code: 'KeyU', ctrlKey: true }), false)).toBe(true);
    expect(underlineKey(k({ code: 'KeyU', ctrlKey: true }), true)).toBe(false);
    expect(underlineKey(k({ code: 'KeyU', metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(underlineKey(k({ code: 'KeyI', metaKey: true }), true)).toBe(false);
  });

  it('고른 구간에 긋고, 모두 밑줄이면 지운다. 줄바꿈에는 긋지 않는다', () => {
    const { el, binding, ytext } = setup('Player (SSN, Name)\nFilm (Film_ID)');
    cleanups.push(() => binding.destroy());
    el.setSelectionRange(8, 11);
    const e = underlineKeyDown(el);
    expect(e.defaultPrevented).toBe(true);
    expect(ul(binding)).toEqual(['SSN']);
    expect(ytext.toDelta()).toEqual([{ insert: 'Player (' }, { insert: 'SSN', attributes: { underline: true } }, { insert: ', Name)\nFilm (Film_ID)' }]);
    expect(binding.underlineActive()).toBe(true);
    // 일부만 밑줄이면 모두 긋는다
    el.setSelectionRange(8, 17);
    binding.toggleUnderline();
    expect(ul(binding)).toEqual(['SSN, Name']);
    // 모두 밑줄이면 지운다
    binding.toggleUnderline();
    expect(ul(binding)).toEqual([]);
    // 여러 줄을 고르면 줄바꿈은 빼고 긋는다
    el.setSelectionRange(13, 23);
    binding.toggleUnderline();
    expect(ul(binding)).toEqual(['Name)', 'Film']);
    expect(el.value).toBe('Player (SSN, Name)\nFilm (Film_ID)');
  });

  it('밑줄 뒤나 안에서 친 글자는 밑줄을 잇고, 앞이나 줄 처음에서는 잇지 않는다. 쉼표나 괄호에서 끝난다', () => {
    const { el, binding } = setup('Player (SSN)\nX');
    cleanups.push(() => binding.destroy());
    el.setSelectionRange(8, 11);
    binding.toggleUnderline();
    // 바로 뒤
    type(el, 'Player (SSN2)\nX', 12);
    expect(ul(binding)).toEqual(['SSN2']);
    // 안
    type(el, 'Player (S_SN2)\nX', 10);
    expect(ul(binding)).toEqual(['S_SN2']);
    // 앞
    type(el, 'Player (aS_SN2)\nX', 9);
    expect(ul(binding)).toEqual(['S_SN2']);
    // 이름을 끝내는 글자
    type(el, 'Player (aS_SN2, b)\nX', 17);
    expect(ul(binding)).toEqual(['S_SN2']);
    // 고른 밑줄 구간을 바꿔 치면 고른 첫 글자를 따른다
    type(el, 'Player (aID, b)\nX', 11);
    expect(ul(binding)).toEqual(['ID']);
  });

  it('줄 처음에서는 앞 줄의 밑줄을 잇지 않는다', () => {
    const { el, binding } = setup('ab\n');
    cleanups.push(() => binding.destroy());
    el.setSelectionRange(0, 2);
    binding.toggleUnderline();
    type(el, 'ab\nc', 4);
    expect(ul(binding)).toEqual(['ab']);
  });

  it('고른 것 없이 누르면 캐럿을 옮기기 전까지 칠 글자의 밑줄을 켜거나 끈다', () => {
    const { el, binding } = setup('Player ()');
    cleanups.push(() => binding.destroy());
    el.setSelectionRange(8, 8);
    expect(binding.underlineActive()).toBe(false);
    underlineKeyDown(el);
    expect(binding.underlineActive()).toBe(true);
    expect(ul(binding)).toEqual([]);
    type(el, 'Player (S)', 9);
    type(el, 'Player (SS)', 10);
    type(el, 'Player (SSN)', 11);
    expect(ul(binding)).toEqual(['SSN']);
    // 쉼표를 치면 끝난다
    type(el, 'Player (SSN,)', 12);
    type(el, 'Player (SSN, N)', 14);
    expect(ul(binding)).toEqual(['SSN']);
    // 밑줄 바로 뒤에서 끄면 다음 글자는 밑줄 없이
    el.setSelectionRange(11, 11);
    expect(binding.underlineActive()).toBe(true);
    binding.toggleUnderline();
    expect(binding.underlineActive()).toBe(false);
    type(el, 'Player (SSNx, N)', 12);
    expect(ul(binding)).toEqual(['SSN']);
    // 캐럿을 옮기면 상태를 버린다
    el.setSelectionRange(14, 14);
    binding.toggleUnderline();
    expect(binding.underlineActive()).toBe(true);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(binding.underlineActive()).toBe(false);
    binding.toggleUnderline();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(binding.underlineActive()).toBe(false);
  });

  it('밑줄 바꾸기는 되돌리고 다시 할 수 있다', () => {
    const { el, binding } = setup('Player (SSN, Name)');
    cleanups.push(() => binding.destroy());
    el.setSelectionRange(8, 11);
    binding.toggleUnderline();
    type(el, 'Player (SSN, Name, DOB)', 23);
    binding.history('undo');
    expect(el.value).toBe('Player (SSN, Name)');
    expect(ul(binding)).toEqual(['SSN']);
    binding.history('undo');
    expect(ul(binding)).toEqual([]);
    binding.history('redo');
    expect(ul(binding)).toEqual(['SSN']);
    // 지운 밑줄 글자를 되돌리면 밑줄도 돌아온다
    binding.undo.stopCapturing();
    type(el, 'Player (, Name)', 8);
    expect(ul(binding)).toEqual([]);
    binding.history('undo');
    expect(el.value).toBe('Player (SSN, Name)');
    expect(ul(binding)).toEqual(['SSN']);
  });

  it('팀원이 바꾼 밑줄이 바로 보이고, 내 글과 캐럿은 그대로다', () => {
    const { doc, el, binding } = setup('Player (SSN, Name)');
    cleanups.push(() => binding.destroy());
    const changes: number[] = [];
    el.setSelectionRange(3, 3);
    remote(doc, (t) => t.format(8, 3, { underline: true }));
    changes.push(el.selectionStart);
    expect(ul(binding)).toEqual(['SSN']);
    expect(el.value).toBe('Player (SSN, Name)');
    expect(changes).toEqual([3]);
    // 남이 앞에 글을 넣어도 '다음 글자' 상태는 같은 자리를 따라간다
    el.setSelectionRange(13, 13);
    binding.toggleUnderline();
    remote(doc, (t) => t.insert(0, '# x\n'));
    expect(el.selectionStart).toBe(17);
    expect(binding.underlineActive()).toBe(true);
    type(el, '# x\nPlayer (SSN, QName)', 18);
    expect(ul(binding)).toEqual(['SSN', 'Q']);
  });

  it('복사하면 일반 텍스트는 밑줄 표시 없이, HTML은 <u>로 담는다. 잘라 내기는 지우고 되돌릴 수 있다', () => {
    const { el, binding } = setup('Player (SSN, Name)');
    cleanups.push(() => binding.destroy());
    el.setSelectionRange(8, 11);
    binding.toggleUnderline();
    el.setSelectionRange(8, 17);
    const copied = clip(el, 'copy');
    expect(copied.prevented).toBe(true);
    expect(copied.data['text/plain']).toBe('SSN, Name');
    expect(copied.data['text/html']).toContain('<u>SSN</u>, Name');
    expect(copied.data['text/plain']).not.toContain('_');
    // 고른 것이 없으면 브라우저에 맡긴다
    el.setSelectionRange(3, 3);
    expect(clip(el, 'copy').prevented).toBe(false);

    el.setSelectionRange(8, 13);
    const cut = clip(el, 'cut');
    expect(cut.data['text/plain']).toBe('SSN, ');
    expect(el.value).toBe('Player (Name)');
    expect(binding.source().text).toBe('Player (Name)');
    binding.history('undo');
    expect(el.value).toBe('Player (SSN, Name)');
    expect(ul(binding)).toEqual(['SSN']);
  });

  it('Word나 Google 문서의 HTML을 붙이면 밑줄과 함께 들어가고, 일반 텍스트는 친 그대로 들어간다', () => {
    const { el, binding } = setup('');
    cleanups.push(() => binding.destroy());
    el.setSelectionRange(0, 0);
    const pasted = clip(el, 'paste', {
      'text/html': '<p class=MsoNormal>Player (<u>SSN</u>, Name)</p><p class=MsoNormal><span style="text-decoration:underline">Performer_ID</span>, Role</p>',
      'text/plain': 'Player (SSN, Name)\nPerformer_ID, Role',
    });
    expect(pasted.prevented).toBe(true);
    expect(el.value).toBe('Player (SSN, Name)\nPerformer_ID, Role');
    expect(ul(binding)).toEqual(['SSN', 'Performer_ID']);
    expect(el.selectionStart).toBe(el.value.length);
    // 일반 텍스트의 _이름_ 은 밑줄로 바꾸지 않는다. 밑줄 뒤에 붙여도 밑줄을 잇지 않는다
    el.setSelectionRange(11, 11);
    clip(el, 'paste', { 'text/plain': ', _DOB_' });
    expect(el.value).toBe('Player (SSN, _DOB_, Name)\nPerformer_ID, Role');
    expect(ul(binding)).toEqual(['SSN', 'Performer_ID']);
    // 붙여 넣기는 한 번에 되돌린다
    binding.history('undo');
    expect(el.value).toBe('Player (SSN, Name)\nPerformer_ID, Role');
    // 고른 구간을 바꾼다
    el.setSelectionRange(8, 11);
    clip(el, 'paste', { 'text/html': '<u>ID</u>', 'text/plain': 'ID' });
    expect(el.value).toBe('Player (ID, Name)\nPerformer_ID, Role');
    expect(ul(binding)).toEqual(['ID', 'Performer_ID']);
  });

  it('한글 조합은 그대로: 조합 중에는 문서에 쓰지 않고 미리 보기에만 밑줄을 잇는다. 조합 중의 밑줄 키는 조합이 끝난 뒤에 적용한다', () => {
    const { el, binding, ytext, deltas } = setup('학생 (학번)');
    cleanups.push(() => binding.destroy());
    el.setSelectionRange(4, 6);
    binding.toggleUnderline();
    const before = deltas.length;
    el.dispatchEvent(new Event('compositionstart'));
    type(el, '학생 (학번ㅇ)', 7, true);
    type(el, '학생 (학번이)', 7, true);
    expect(deltas.length).toBe(before);
    expect(binding.previewSource()).toEqual({ text: '학생 (학번이)', underlines: [{ from: 4, to: 7 }] });
    // 조합 중의 밑줄 키는 기본 동작을 막지 않는다(조합을 깨지 않게)
    const e = underlineKeyDown(el, true);
    expect(e.defaultPrevented).toBe(false);
    expect(ul(binding)).toEqual(['학번']);
    el.dispatchEvent(new Event('compositionend'));
    expect(ytext.toString()).toBe('학생 (학번이)');
    // 조합한 글자는 밑줄을 잇고, 조합이 끝난 뒤 밑줄 키가 적용됐다(캐럿만 있으니 다음 글자 상태가 꺼진다)
    expect(ul(binding)).toEqual(['학번이']);
    expect(binding.underlineActive()).toBe(false);
    type(el, '학생 (학번이, 이름)', 11);
    expect(ul(binding)).toEqual(['학번이']);
  });
});
