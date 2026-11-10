/**
 * 도형 글자 편집기. ui.editingId가 가리키는 노드 위에 입력창을 겹쳐 띄운다. [담당: text-editor 에이전트]
 * Canvas가 .canvas-root 안(svg의 형제)에 렌더링한다. 위치는 뷰포트로 계산한 화면 좌표.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, SyntheticEvent } from 'react';
import { STYLE, type ErdNode } from '../../shared/types';
import { transact, updateNode } from '../collab/docOps';
import { useRoom } from '../collab/hooks';
import type { Room } from '../collab/room';
import { ui, useUi } from '../state/ui';
import { growToFit } from '../text/measure';
import { worldToScreen } from './coords';
import './TextEditor.css';

/** 줄 끝 공백과 앞뒤의 빈 줄을 없앤다. 가운데 빈 줄은 그대로 둔다. */
export function normalizeText(raw: string): string {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd());
  while (lines.length > 0 && lines[0] === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n').trimStart();
}

/**
 * 입력한 글자를 문서에 반영한다. 글자와 크기 변경을 실행 취소 한 단계로 묶는다.
 * 노드가 이미 지워졌거나 글자가 그대로면 아무것도 하지 않는다.
 */
export function commitNodeText(room: Room, id: string, raw: string): void {
  const node = room.nodes.get(id);
  if (!node) return;
  const text = normalizeText(raw);
  if (text === node.text) return;
  transact(room.doc, () => {
    updateNode(room.doc, id, { text });
    const grown = growToFit(node, text);
    if (grown) updateNode(room.doc, id, grown);
  });
}

export function TextEditor() {
  const room = useRoom();
  const editingId = useUi((s) => s.editingId);
  // 편집 중인 노드만 구독한다. 그 노드가 바뀌거나 지워질 때만 다시 그린다.
  const node = useSyncExternalStore(room.nodes.subscribe, () => (editingId ? room.nodes.get(editingId) : undefined));

  useEffect(() => {
    if (!editingId || ui().editingId !== editingId) return;
    const cur = room.nodes.get(editingId);
    if (!cur) {
      // 다른 사람이 지웠다(또는 없는 id). 조용히 닫는다.
      ui().setEditing(null);
      return;
    }
    if (cur.kind === 'spec') {
      // 특수화 원은 글자를 입력하지 않고 d와 o를 서로 바꾼다.
      updateNode(room.doc, cur.id, { specType: cur.specType === 'o' ? 'd' : 'o' });
      ui().setEditing(null);
    }
  }, [editingId, node, room]);

  if (!node || node.kind === 'spec') return null;
  // key를 노드 id로 두어 편집 대상이 바뀌면 이전 입력창이 내려가면서 내용을 확정한다.
  return <NodeTextEditor key={node.id} node={node} />;
}

function NodeTextEditor({ node }: { node: ErdNode }) {
  const room = useRoom();
  const viewport = useUi((s) => s.viewport);
  const id = node.id;

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 열릴 때의 글자. 편집 중 다른 사람이 글자를 바꿔도 입력창 값은 건드리지 않는다.
  const [initial] = useState(node.text);
  // 복제 글자(크기 계산용)에만 쓰는 값. 입력창 자체는 비제어로 둔다(한글 조합이 끊기지 않게).
  const [value, setValue] = useState(initial);
  const draftRef = useRef(initial);
  const doneRef = useRef(false);

  /** 내가 손댄 적이 없으면 쓰지 않는다(그 사이 다른 사람이 바꾼 글자를 되돌리지 않기 위해). */
  const commit = useCallback(() => {
    const raw = inputRef.current?.value ?? draftRef.current;
    if (raw !== initial) commitNodeText(room, id, raw);
  }, [room, id, initial]);

  /** 확정 또는 취소. Enter 뒤에 따라오는 blur처럼 겹쳐 불려도 한 번만 실행한다. */
  const finish = useCallback(
    (save: boolean) => {
      if (doneRef.current) return;
      doneRef.current = true;
      if (save) commit();
      if (ui().editingId === id) ui().setEditing(null);
    },
    [commit, id],
  );

  // 열릴 때 포커스를 주고 전체 선택한다.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
  }, []);

  // 줄이 늘어난 직후 브라우저가 입력창 안을 스크롤해 둔 것을 되돌린다.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (el.scrollTop !== 0) el.scrollTop = 0;
    if (el.scrollLeft !== 0) el.scrollLeft = 0;
  }, [value]);

  // 입력창이 화면 밖으로 넘칠 때 브라우저가 커서를 보이려고 캔버스 영역을 스크롤하면 좌표가 어긋난다. 막는다.
  useEffect(() => {
    const parent = rootRef.current?.parentElement;
    if (!parent) return;
    const reset = () => {
      if (parent.scrollLeft !== 0) parent.scrollLeft = 0;
      if (parent.scrollTop !== 0) parent.scrollTop = 0;
    };
    parent.addEventListener('scroll', reset);
    return () => parent.removeEventListener('scroll', reset);
  }, []);

  // 확정이나 취소 없이 내려가는 경우(editingId가 다른 노드로 바뀜 등)에는 내용을 확정한다.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    doneRef.current = false;
    return () => {
      if (doneRef.current) return;
      doneRef.current = true;
      commitRef.current();
    };
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // 전역 단축키로 새지 않게 한다.
    e.stopPropagation();
    if (e.key === 'Enter') {
      // 한글 조합 중 Enter는 글자 확정이다. 편집을 끝내지 않는다.
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      if (e.shiftKey) return;
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      finish(true);
    }
  };

  const onBlur = () => {
    // 창이나 탭을 잠깐 떠난 경우에는 닫지 않는다. 돌아오면 포커스가 그대로 돌아온다.
    if (!document.hasFocus()) return;
    finish(true);
  };

  // 도형 안의 빈 곳(입력창 위아래)을 눌러도 편집이 끝나지 않게 한다.
  const onRootMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.target === inputRef.current) return;
    if (e.button === 0) {
      e.preventDefault();
      inputRef.current?.focus({ preventScroll: true });
    }
  };

  const origin = worldToScreen(viewport, { x: node.x, y: node.y });
  const keyType = node.kind === 'attribute' ? node.keyType : undefined;
  const keyClass = keyType === 'key' ? ' is-key' : keyType === 'partial' ? ' is-partial-key' : '';

  return (
    <div
      ref={rootRef}
      className={`text-editor${keyClass}`}
      style={{
        left: origin.x,
        top: origin.y,
        width: node.w,
        height: node.h,
        // 글자 크기를 직접 곱하지 않고 통째로 확대한다. 보이는 크기는 fontSize * zoom으로 같고,
        // 브라우저의 최소 글자 크기 제한(한국어 크롬은 10px)에 걸리지 않아 축소 화면에서도 도형과 맞는다.
        transform: `scale(${viewport.zoom})`,
        fontFamily: STYLE.fontFamily,
        fontSize: STYLE.fontSize,
        lineHeight: `${STYLE.lineHeight}px`,
      }}
      onPointerDown={stop}
      onMouseDown={onRootMouseDown}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
    >
      <div className="text-editor-grow">
        {/* 마지막 줄이 비어 있어도 높이에 들어가도록 폭 없는 글자를 붙인다 */}
        <div className="text-editor-mirror" aria-hidden="true">
          {value + '​'}
        </div>
        <textarea
          ref={inputRef}
          className="text-editor-input"
          data-testid="text-editor"
          aria-label="도형 글자"
          defaultValue={initial}
          rows={1}
          wrap="off"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          onChange={(e) => {
            draftRef.current = e.target.value;
            setValue(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={stop}
          onCopy={stop}
          onCut={stop}
          onPaste={stop}
          onBlur={onBlur}
        />
      </div>
    </div>
  );
}

function stop(e: SyntheticEvent) {
  e.stopPropagation();
}
